begin;

alter table public.marketplace_kits
  add column if not exists product_type text not null default 'kit';
alter table public.marketplace_kits
  add column if not exists sale_unit text not null default 'kit';
alter table public.marketplace_kits
  drop constraint if exists marketplace_kits_product_type_check;
alter table public.marketplace_kits
  add constraint marketplace_kits_product_type_check
  check (product_type in ('kit', 'loose'));
alter table public.marketplace_kits
  drop constraint if exists marketplace_kits_sale_unit_check;
alter table public.marketplace_kits
  add constraint marketplace_kits_sale_unit_check
  check (char_length(btrim(sale_unit)) between 1 and 20);

alter table public.marketplace_order_items
  drop constraint if exists marketplace_order_items_quantity_check;
alter table public.marketplace_order_items
  alter column quantity type numeric(12, 3) using quantity::numeric;
alter table public.marketplace_order_items
  add column if not exists unit_label text not null default 'kit';
alter table public.marketplace_order_items
  alter column unit_label set default 'kit';
alter table public.marketplace_order_items
  add constraint marketplace_order_items_quantity_check
  check (quantity > 0 and quantity <= 20);

create or replace function public.create_marketplace_order(
  p_customer_name text,
  p_phone text,
  p_delivery_address text,
  p_address_number text,
  p_neighborhood text,
  p_complement text,
  p_postal_code text,
  p_city text,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_id uuid;
  order_total numeric(10, 2) := 0;
  order_items jsonb := '[]'::jsonb;
  requested_item record;
  kit_row public.marketplace_kits%rowtype;
  line_total numeric(10, 2);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Entre na sua conta para finalizar o pedido.';
  end if;

  if char_length(btrim(coalesce(p_customer_name, ''))) not between 3 and 120
    or coalesce(p_phone, '') !~ '^[0-9]{10,15}$'
    or char_length(btrim(coalesce(p_delivery_address, ''))) not between 3 and 180
    or char_length(btrim(coalesce(p_address_number, ''))) not between 1 and 30
    or char_length(btrim(coalesce(p_neighborhood, ''))) not between 2 and 100
    or char_length(btrim(coalesce(p_city, ''))) not between 2 and 100
    or char_length(coalesce(p_complement, '')) > 120 then
    raise exception using errcode = '22023', message = 'Confira os dados de entrega do pedido.';
  end if;

  if p_payment_method not in ('pix', 'cash_on_delivery', 'card_on_delivery') then
    raise exception using errcode = '22023', message = 'Forma de pagamento inválida.';
  end if;

  if coalesce(p_postal_code, '') <> ''
    and p_postal_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'O CEP deve conter 8 números.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'Adicione ao menos um produto ao pedido.';
  end if;

  if jsonb_array_length(p_items) not between 1 and 12 then
    raise exception using errcode = '22023', message = 'Adicione entre 1 e 12 produtos ao pedido.';
  end if;

  for requested_item in
    select item.kit_id, sum(item.quantity)::numeric(12, 3) as quantity
    from jsonb_to_recordset(p_items) as item(kit_id uuid, quantity numeric)
    group by item.kit_id
    order by item.kit_id
  loop
    if requested_item.kit_id is null
      or requested_item.quantity is null
      or requested_item.quantity <= 0
      or requested_item.quantity > 20 then
      raise exception using errcode = '22023', message = 'A quantidade do produto deve ser maior que zero e não pode passar de 20.';
    end if;

    select * into kit_row
    from public.marketplace_kits
    where id = requested_item.kit_id
      and is_active = true
    for share;

    if not found then
      raise exception using errcode = 'P0002', message = 'Um dos produtos do pedido não está mais disponível.';
    end if;

    if (kit_row.product_type = 'kit' or kit_row.sale_unit not in ('kg', 'quilo'))
      and requested_item.quantity <> trunc(requested_item.quantity) then
      raise exception using errcode = '22023', message = 'Este produto só pode ser pedido em quantidades inteiras.';
    end if;

    line_total := round(kit_row.price * requested_item.quantity, 2);
    order_total := order_total + line_total;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'kit_id', kit_row.id,
      'kit_name', kit_row.name,
      'quantity', requested_item.quantity,
      'unit_label', case when kit_row.product_type = 'kit' then 'kit' else kit_row.sale_unit end,
      'unit_price', kit_row.price,
      'line_total', line_total
    ));
  end loop;

  insert into public.marketplace_orders (
    customer_name,
    phone,
    delivery_address,
    address_number,
    neighborhood,
    complement,
    postal_code,
    city,
    payment_method,
    total
  )
  values (
    btrim(p_customer_name),
    p_phone,
    btrim(p_delivery_address),
    btrim(p_address_number),
    btrim(p_neighborhood),
    btrim(coalesce(p_complement, '')),
    coalesce(p_postal_code, ''),
    btrim(p_city),
    p_payment_method,
    order_total
  )
  returning id into order_id;

  insert into public.marketplace_order_items (
    order_id,
    kit_id,
    kit_name,
    quantity,
    unit_label,
    unit_price,
    line_total
  )
  select
    order_id,
    (item.value->>'kit_id')::uuid,
    item.value->>'kit_name',
    (item.value->>'quantity')::numeric,
    item.value->>'unit_label',
    (item.value->>'unit_price')::numeric,
    (item.value->>'line_total')::numeric
  from jsonb_array_elements(order_items) as item(value);

  return jsonb_build_object(
    'order_id', order_id,
    'total', order_total,
    'items', order_items
  );
end;
$$;

revoke all on function public.create_marketplace_order(text, text, text, text, text, text, text, text, text, jsonb)
  from public;
grant execute on function public.create_marketplace_order(text, text, text, text, text, text, text, text, text, jsonb)
  to authenticated;

create or replace function public.admin_marketplace_summary()
returns table (
  active_kits bigint,
  total_orders bigint,
  pending_orders bigint,
  order_value numeric,
  total_purchase_cost numeric,
  today_orders bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.marketplace_kits where is_active and product_type = 'kit'),
    (select count(*) from public.marketplace_orders),
    (select count(*) from public.marketplace_orders where status = 'pending'),
    (select coalesce(sum(total), 0) from public.marketplace_orders where status <> 'cancelled'),
    (select coalesce(sum(total_cost), 0) from public.purchase_costs),
    (select count(*) from public.marketplace_orders
      where created_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
        at time zone 'America/Sao_Paulo')
  where public.is_feira_admin();
$$;

revoke all on function public.admin_marketplace_summary() from public, anon;
grant execute on function public.admin_marketplace_summary() to authenticated;

commit;
