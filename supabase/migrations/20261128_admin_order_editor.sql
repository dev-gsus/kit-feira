create or replace function public.admin_update_marketplace_order(
  p_order_id uuid,
  p_order jsonb,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(10, 2);
  v_phone text;
begin
  if not public.is_feira_admin() then
    raise exception 'Acesso administrativo necessário.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'O pedido precisa ter pelo menos um item.';
  end if;

  v_phone := regexp_replace(coalesce(p_order ->> 'phone', ''), '[^0-9]', '', 'g');
  if char_length(v_phone) < 10 or char_length(v_phone) > 15 then
    raise exception 'Informe um telefone válido.';
  end if;
  if char_length(btrim(coalesce(p_order ->> 'customer_name', ''))) not between 3 and 120 then
    raise exception 'O nome do cliente precisa ter entre 3 e 120 caracteres.';
  end if;
  if coalesce(p_order ->> 'payment_method', '') not in ('pix', 'cash_on_delivery', 'card_on_delivery') then
    raise exception 'Forma de pagamento inválida.';
  end if;
  if coalesce(p_order ->> 'status', '') not in ('pending', 'confirmed', 'preparing', 'delivered', 'cancelled') then
    raise exception 'Status do pedido inválido.';
  end if;
  if nullif(btrim(coalesce(p_order ->> 'delivery_address', '')), '') is null
     or nullif(btrim(coalesce(p_order ->> 'address_number', '')), '') is null
     or nullif(btrim(coalesce(p_order ->> 'neighborhood', '')), '') is null
     or nullif(btrim(coalesce(p_order ->> 'city', '')), '') is null
     or nullif(p_order ->> 'created_at', '') is null then
    raise exception 'Preencha endereço, número, bairro, cidade e data do pedido.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      kit_id uuid, kit_name text, quantity numeric, unit_label text, unit_price numeric
    )
    where nullif(btrim(coalesce(item.kit_name, '')), '') is null
       or char_length(item.kit_name) > 180
       or nullif(btrim(coalesce(item.unit_label, '')), '') is null
       or char_length(item.unit_label) > 20
       or item.quantity is null or item.quantity <= 0 or item.quantity > 20
       or item.unit_price is null or item.unit_price < 0
  ) then
    raise exception 'Confira nome, unidade, quantidade e preço dos itens.';
  end if;

  select sum(round(item.quantity * item.unit_price, 2))
  into v_total
  from jsonb_to_recordset(p_items) as item(
    kit_id uuid, kit_name text, quantity numeric, unit_label text, unit_price numeric
  );
  if v_total is null or v_total > 99999999.99 then
    raise exception 'O total do pedido está fora do limite permitido.';
  end if;

  update public.marketplace_orders
  set customer_id = nullif(p_order ->> 'customer_id', '')::uuid,
      customer_name = btrim(p_order ->> 'customer_name'),
      phone = v_phone,
      delivery_address = btrim(p_order ->> 'delivery_address'),
      address_number = btrim(p_order ->> 'address_number'),
      neighborhood = btrim(p_order ->> 'neighborhood'),
      complement = coalesce(p_order ->> 'complement', ''),
      postal_code = regexp_replace(coalesce(p_order ->> 'postal_code', ''), '[^0-9]', '', 'g'),
      city = btrim(p_order ->> 'city'),
      payment_method = p_order ->> 'payment_method',
      status = p_order ->> 'status',
      created_at = (p_order ->> 'created_at')::timestamptz,
      total = v_total,
      updated_at = now()
  where id = p_order_id;

  if not found then
    raise exception 'Pedido não encontrado.';
  end if;

  delete from public.marketplace_order_items where order_id = p_order_id;
  insert into public.marketplace_order_items (
    order_id, kit_id, kit_name, quantity, unit_label, unit_price, line_total
  )
  select
    p_order_id,
    item.kit_id,
    btrim(item.kit_name),
    item.quantity,
    btrim(item.unit_label),
    item.unit_price,
    round(item.quantity * item.unit_price, 2)
  from jsonb_to_recordset(p_items) as item(
    kit_id uuid, kit_name text, quantity numeric, unit_label text, unit_price numeric
  );
end;
$$;

revoke all on function public.admin_update_marketplace_order(uuid, jsonb, jsonb) from public;
grant execute on function public.admin_update_marketplace_order(uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
