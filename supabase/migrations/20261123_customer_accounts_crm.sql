begin;

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_profiles_email_length check (char_length(email) <= 254),
  constraint customer_profiles_name_length check (char_length(full_name) <= 120),
  constraint customer_profiles_phone_format check (phone = '' or phone ~ '^[0-9]{10,15}$')
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default 'Principal',
  delivery_address text not null,
  address_number text not null,
  neighborhood text not null,
  complement text not null default '',
  postal_code text not null default '',
  city text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint customer_addresses_label_length check (char_length(btrim(label)) between 1 and 50),
  constraint customer_addresses_address_length check (char_length(btrim(delivery_address)) between 3 and 180),
  constraint customer_addresses_number_length check (char_length(btrim(address_number)) between 1 and 30),
  constraint customer_addresses_neighborhood_length check (char_length(btrim(neighborhood)) between 2 and 100),
  constraint customer_addresses_complement_length check (char_length(complement) <= 120),
  constraint customer_addresses_postal_code_format check (postal_code = '' or postal_code ~ '^[0-9]{8}$'),
  constraint customer_addresses_city_length check (char_length(btrim(city)) between 2 and 100)
);

create unique index if not exists customer_addresses_one_default_per_user
  on public.customer_addresses (user_id)
  where is_default;
create index if not exists customer_addresses_user_created_idx
  on public.customer_addresses (user_id, created_at desc);

insert into public.customer_profiles (user_id, email, full_name, phone)
select
  id,
  coalesce(email, ''),
  left(coalesce(raw_user_meta_data->>'full_name', ''), 120),
  case
    when char_length(regexp_replace(coalesce(raw_user_meta_data->>'phone', ''), '[^0-9]', '', 'g')) between 10 and 15
      then regexp_replace(coalesce(raw_user_meta_data->>'phone', ''), '[^0-9]', '', 'g')
    else ''
  end
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    full_name = coalesce(nullif(excluded.full_name, ''), customer_profiles.full_name),
    phone = coalesce(nullif(excluded.phone, ''), customer_profiles.phone);

create or replace function public.sync_customer_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.customer_profiles (user_id, email, full_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120),
    case
      when char_length(regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '[^0-9]', '', 'g')) between 10 and 15
        then regexp_replace(coalesce(new.raw_user_meta_data->>'phone', ''), '[^0-9]', '', 'g')
      else ''
    end
  )
  on conflict (user_id) do update
  set email = excluded.email,
      full_name = coalesce(nullif(excluded.full_name, ''), customer_profiles.full_name),
      phone = coalesce(nullif(excluded.phone, ''), customer_profiles.phone),
      updated_at = now();
  return new;
end;
$$;

drop trigger if exists sync_customer_profile_after_auth_change on auth.users;
drop trigger if exists sync_customer_profile_after_auth_insert on auth.users;
drop trigger if exists sync_customer_profile_after_auth_update on auth.users;
create trigger sync_customer_profile_after_auth_insert
  after insert on auth.users
  for each row execute function public.sync_customer_profile_from_auth();
create trigger sync_customer_profile_after_auth_update
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_customer_profile_from_auth();

revoke all on function public.sync_customer_profile_from_auth() from public, anon, authenticated;

alter table public.customer_profiles enable row level security;
alter table public.customer_addresses enable row level security;

drop policy if exists "Customers and admins can view customer profiles" on public.customer_profiles;
create policy "Customers and admins can view customer profiles"
  on public.customer_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_feira_admin());

drop policy if exists "Customers can update their own profile" on public.customer_profiles;
create policy "Customers can update their own profile"
  on public.customer_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Customers and admins can view customer addresses" on public.customer_addresses;
create policy "Customers and admins can view customer addresses"
  on public.customer_addresses for select to authenticated
  using (user_id = auth.uid() or public.is_feira_admin());

drop policy if exists "Customers can create their own addresses" on public.customer_addresses;
create policy "Customers can create their own addresses"
  on public.customer_addresses for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Customers can delete their own addresses" on public.customer_addresses;
create policy "Customers can delete their own addresses"
  on public.customer_addresses for delete to authenticated
  using (user_id = auth.uid());

revoke insert, update on public.customer_profiles from authenticated;
grant select on public.customer_profiles to authenticated;
grant update (full_name, phone, updated_at) on public.customer_profiles to authenticated;
grant select, insert, delete on public.customer_addresses to authenticated;

alter table public.marketplace_orders
  add column if not exists customer_id uuid references auth.users (id) on delete set null;
create index if not exists marketplace_orders_customer_created_idx
  on public.marketplace_orders (customer_id, created_at desc)
  where customer_id is not null;

drop policy if exists "Customers can view their own marketplace orders" on public.marketplace_orders;
create policy "Customers can view their own marketplace orders"
  on public.marketplace_orders for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists "Customers can view their own marketplace order items" on public.marketplace_order_items;
create policy "Customers can view their own marketplace order items"
  on public.marketplace_order_items for select to authenticated
  using (
    exists (
      select 1
      from public.marketplace_orders
      where marketplace_orders.id = marketplace_order_items.order_id
        and marketplace_orders.customer_id = auth.uid()
    )
  );

create or replace function public.save_customer_address(
  p_label text,
  p_delivery_address text,
  p_address_number text,
  p_neighborhood text,
  p_complement text,
  p_postal_code text,
  p_city text,
  p_is_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  address_id uuid;
  existing_is_default boolean := false;
  make_default boolean;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Entre na sua conta para salvar um endereço.';
  end if;

  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 50
    or char_length(btrim(coalesce(p_delivery_address, ''))) not between 3 and 180
    or char_length(btrim(coalesce(p_address_number, ''))) not between 1 and 30
    or char_length(btrim(coalesce(p_neighborhood, ''))) not between 2 and 100
    or char_length(btrim(coalesce(p_city, ''))) not between 2 and 100
    or char_length(coalesce(p_complement, '')) > 120 then
    raise exception using errcode = '22023', message = 'Confira os dados do endereço.';
  end if;

  if coalesce(p_postal_code, '') <> '' and p_postal_code !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'O CEP deve conter 8 números.';
  end if;

  perform 1
  from public.customer_profiles
  where user_id = current_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Não foi possível validar sua conta.';
  end if;

  make_default := coalesce(p_is_default, false) or not exists (
    select 1 from public.customer_addresses where user_id = current_user_id
  );
  if make_default then
    update public.customer_addresses
    set is_default = false
    where user_id = current_user_id and is_default;
  end if;

  select id, is_default into address_id, existing_is_default
  from public.customer_addresses
  where user_id = current_user_id
    and lower(delivery_address) = lower(btrim(p_delivery_address))
    and address_number = btrim(p_address_number)
    and lower(neighborhood) = lower(btrim(p_neighborhood))
    and complement = btrim(coalesce(p_complement, ''))
    and postal_code = coalesce(p_postal_code, '')
    and lower(city) = lower(btrim(p_city))
  limit 1
  for update;

  if address_id is null then
    insert into public.customer_addresses (
      user_id, label, delivery_address, address_number, neighborhood,
      complement, postal_code, city, is_default
    )
    values (
      current_user_id, btrim(p_label), btrim(p_delivery_address), btrim(p_address_number),
      btrim(p_neighborhood), btrim(coalesce(p_complement, '')),
      coalesce(p_postal_code, ''), btrim(p_city), make_default
    )
    returning id into address_id;
  else
    update public.customer_addresses
    set label = btrim(p_label),
        is_default = existing_is_default or make_default
    where id = address_id;
  end if;

  return address_id;
end;
$$;

revoke all on function public.save_customer_address(text, text, text, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.save_customer_address(text, text, text, text, text, text, text, boolean)
  to authenticated;

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

  if auth.uid() is not null then
    insert into public.customer_profiles (user_id, email, full_name, phone)
    values (
      auth.uid(),
      coalesce(auth.jwt()->>'email', ''),
      btrim(p_customer_name),
      p_phone
    )
    on conflict (user_id) do update
    set full_name = excluded.full_name,
        phone = excluded.phone,
        updated_at = now();
  end if;

  insert into public.marketplace_orders (
    customer_id, customer_name, phone, delivery_address, address_number,
    neighborhood, complement, postal_code, city, payment_method, total
  )
  values (
    auth.uid(), btrim(p_customer_name), p_phone, btrim(p_delivery_address),
    btrim(p_address_number), btrim(p_neighborhood), btrim(coalesce(p_complement, '')),
    coalesce(p_postal_code, ''), btrim(p_city), p_payment_method, order_total
  )
  returning id into order_id;

  insert into public.marketplace_order_items (
    order_id, kit_id, kit_name, quantity, unit_label, unit_price, line_total
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

  if auth.uid() is not null then
    perform public.save_customer_address(
      'Principal',
      p_delivery_address,
      p_address_number,
      p_neighborhood,
      p_complement,
      p_postal_code,
      p_city,
      true
    );
  end if;

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
  to anon, authenticated;

create or replace function public.admin_customer_summary()
returns table (
  user_id uuid,
  email text,
  full_name text,
  phone text,
  created_at timestamptz,
  order_count bigint,
  purchase_total numeric,
  last_order_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_feira_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  return query
  select
    profile.user_id,
    profile.email,
    profile.full_name,
    profile.phone,
    profile.created_at,
    coalesce(orders.order_count, 0)::bigint,
    coalesce(orders.purchase_total, 0)::numeric,
    orders.last_order_at
  from public.customer_profiles profile
  left join lateral (
    select
      count(*) as order_count,
      coalesce(sum(order_row.total) filter (where order_row.status <> 'cancelled'), 0) as purchase_total,
      max(order_row.created_at) as last_order_at
    from public.marketplace_orders order_row
    where order_row.customer_id = profile.user_id
  ) orders on true
  where not exists (
    select 1 from public.admin_users admin_user where admin_user.user_id = profile.user_id
  )
  order by orders.last_order_at desc nulls last, profile.created_at desc;
end;
$$;

revoke all on function public.admin_customer_summary() from public, anon;
grant execute on function public.admin_customer_summary() to authenticated;

commit;
