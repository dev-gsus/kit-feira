create extension if not exists pgcrypto;

create table if not exists public.raffles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  rules text not null default '',
  prize text not null,
  photo_url text,
  draw_at timestamptz not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_participants integer check (max_participants is null or max_participants > 0),
  registration_count integer not null default 0 check (registration_count >= 0),
  status text not null default 'paused' check (status in ('active', 'paused', 'finished')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint raffle_dates_valid check (ends_at > starts_at)
);

alter table public.raffles add column if not exists rules text not null default '';
alter table public.raffles add column if not exists photo_url text;
alter table public.raffles add column if not exists max_participants integer
  check (max_participants is null or max_participants > 0);
alter table public.raffles add column if not exists registration_count integer
  not null default 0 check (registration_count >= 0);
alter table public.raffles add column if not exists status text not null default 'paused'
  check (status in ('active', 'paused', 'finished'));
update public.raffles
set status = 'active'
where is_active = true and status = 'paused';

drop index if exists public.one_active_raffle;

create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.raffles (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 120),
  cpf text not null check (cpf ~ '^[0-9]{11}$'),
  phone text not null check (char_length(phone) between 10 and 15),
  created_at timestamptz not null default now(),
  constraint one_registration_per_cpf_per_raffle unique (raffle_id, cpf)
);

update public.raffles r
set registration_count = (
  select count(*)::integer
  from public.registrations reg
  where reg.raffle_id = r.id
)
where r.registration_count <> (
  select count(*)::integer
  from public.registrations reg
  where reg.raffle_id = r.id
);

create table if not exists public.draw_results (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.raffles (id) on delete cascade,
  winner_name text not null,
  prize text not null,
  drawn_at timestamptz not null default now(),
  is_published boolean not null default false,
  constraint one_draw_per_raffle unique (raffle_id)
);

update public.raffles
set status = 'finished', is_active = false
where ends_at <= now()
  and status <> 'finished';

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.admin_users (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

alter table public.admin_users enable row level security;

create or replace function public.is_feira_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users where user_id = auth.uid()
  );
$$;

revoke all on function public.is_feira_admin() from public, anon;
grant execute on function public.is_feira_admin() to authenticated;

drop policy if exists "Admins can view their own access" on public.admin_users;
create policy "Admins can view their own access"
  on public.admin_users for select to authenticated
  using (user_id = auth.uid());

alter table public.raffles enable row level security;
alter table public.registrations enable row level security;
alter table public.draw_results enable row level security;

drop policy if exists "Anyone can view active raffles" on public.raffles;
drop policy if exists "Anyone can view active raffles and published draws" on public.raffles;
create policy "Anyone can view active raffles and published draws"
  on public.raffles for select to anon, authenticated
  using (
    (is_active = true and status = 'active')
    or exists (
      select 1
      from public.draw_results
      where draw_results.raffle_id = raffles.id
        and draw_results.is_published = true
    )
  );

drop policy if exists "Admins can manage raffles" on public.raffles;
create policy "Admins can manage raffles"
  on public.raffles for all to authenticated
  using (public.is_feira_admin())
  with check (public.is_feira_admin());

drop policy if exists "Anyone can register for an open raffle" on public.registrations;
create policy "Anyone can register for an open raffle"
  on public.registrations for insert to anon, authenticated
  with check (
    exists (
      select 1
      from public.raffles
      where raffles.id = registrations.raffle_id
        and raffles.is_active = true
        and raffles.status = 'active'
        and now() between raffles.starts_at and raffles.ends_at
    )
  );

create or replace function public.enforce_raffle_registration_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  raffle_row public.raffles%rowtype;
begin
  select * into raffle_row
  from public.raffles
  where id = new.raffle_id
  for update;

  if not found
    or not raffle_row.is_active
    or raffle_row.status <> 'active'
    or now() < raffle_row.starts_at
    or now() > raffle_row.ends_at then
    raise exception using
      errcode = 'P0001',
      message = 'As inscrições para este sorteio não estão abertas.';
  end if;

  if raffle_row.max_participants is not null
    and raffle_row.registration_count >= raffle_row.max_participants then
    raise exception using
      errcode = 'P0001',
      message = 'O limite de participantes deste sorteio foi atingido.';
  end if;

  update public.raffles
  set registration_count = registration_count + 1
  where id = new.raffle_id;

  return new;
end;
$$;

drop trigger if exists enforce_raffle_registration_capacity on public.registrations;
create trigger enforce_raffle_registration_capacity
  before insert on public.registrations
  for each row execute function public.enforce_raffle_registration_capacity();

create or replace function public.prevent_raffle_limit_below_registrations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count bigint;
begin
  if new.max_participants is not null then
    select count(*) into current_count
    from public.registrations
    where raffle_id = new.id;

    if current_count > new.max_participants then
      raise exception using
        errcode = 'P0001',
        message = 'O limite não pode ser menor que o número de inscrições já recebidas.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_raffle_limit_below_registrations on public.raffles;
create trigger prevent_raffle_limit_below_registrations
  before update of max_participants on public.raffles
  for each row execute function public.prevent_raffle_limit_below_registrations();

drop policy if exists "Admins can view registrations" on public.registrations;
create policy "Admins can view registrations"
  on public.registrations for select to authenticated
  using (public.is_feira_admin());

drop policy if exists "Anyone can view published draw results" on public.draw_results;
create policy "Anyone can view published draw results"
  on public.draw_results for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Admins can manage draw results" on public.draw_results;
create policy "Admins can manage draw results"
  on public.draw_results for all to authenticated
  using (public.is_feira_admin())
  with check (public.is_feira_admin());

grant select on public.raffles to anon, authenticated;
grant insert, update on public.raffles to authenticated;
grant insert on public.registrations to anon, authenticated;
grant select on public.registrations to authenticated;
grant select on public.draw_results to anon;
grant select, insert, update on public.draw_results to authenticated;

create or replace function public.raffle_registration_count(p_raffle_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.raffles
    where id = p_raffle_id
      and is_active = true
      and status = 'active'
      and now() between starts_at and ends_at
  ) then
    return 0;
  end if;

  return (
    select registration_count::bigint
    from public.raffles
    where id = p_raffle_id
  );
end;
$$;

revoke all on function public.raffle_registration_count(uuid) from public;
grant execute on function public.raffle_registration_count(uuid) to anon, authenticated;

create or replace function public.perform_draw(p_raffle_id uuid)
returns table (
  result_id uuid,
  winner_name text,
  prize text,
  drawn_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  raffle_row public.raffles%rowtype;
  winner_row public.registrations%rowtype;
  result_row public.draw_results%rowtype;
begin
  if not public.is_feira_admin() then
    raise exception using errcode = '42501', message = 'Admin access required';
  end if;

  select * into raffle_row
  from public.raffles
  where id = p_raffle_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Raffle not found';
  end if;
  if now() < raffle_row.draw_at then
    raise exception using errcode = 'P0001', message = 'The scheduled draw time has not arrived';
  end if;
  if exists (select 1 from public.draw_results where raffle_id = p_raffle_id) then
    raise exception using errcode = '23505', message = 'This raffle already has a result';
  end if;

  select * into winner_row
  from public.registrations
  where raffle_id = p_raffle_id
  order by gen_random_uuid()
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'No registrations for this raffle';
  end if;

  insert into public.draw_results (raffle_id, winner_name, prize)
  values (p_raffle_id, winner_row.full_name, raffle_row.prize)
  returning * into result_row;

  return query
    select result_row.id, result_row.winner_name, result_row.prize, result_row.drawn_at;
end;
$$;

revoke all on function public.perform_draw(uuid) from public, anon;
grant execute on function public.perform_draw(uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('raffle-images', 'raffle-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Anyone can view raffle images" on storage.objects;
create policy "Anyone can view raffle images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'raffle-images');

drop policy if exists "Admins can upload raffle images" on storage.objects;
create policy "Admins can upload raffle images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'raffle-images' and public.is_feira_admin());

drop policy if exists "Admins can update raffle images" on storage.objects;
create policy "Admins can update raffle images"
  on storage.objects for update to authenticated
  using (bucket_id = 'raffle-images' and public.is_feira_admin())
  with check (bucket_id = 'raffle-images' and public.is_feira_admin());

drop policy if exists "Admins can delete raffle images" on storage.objects;
create policy "Admins can delete raffle images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'raffle-images' and public.is_feira_admin());

create or replace function public.admin_registration_counts()
returns table (raffle_id uuid, registration_count bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.id, r.registration_count::bigint
  from public.raffles r
  where public.is_feira_admin();
$$;

revoke all on function public.admin_registration_counts() from public, anon;
grant execute on function public.admin_registration_counts() to authenticated;

create table if not exists public.marketplace_kits (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text not null default '',
  contents text not null default '',
  image_url text,
  price numeric(10, 2) not null check (price >= 0),
  product_type text not null default 'kit' check (product_type in ('kit', 'loose')),
  sale_unit text not null default 'kit' check (char_length(btrim(sale_unit)) between 1 and 20),
  is_active boolean not null default true,
  is_featured boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (char_length(btrim(customer_name)) between 3 and 120),
  phone text not null check (phone ~ '^[0-9]{10,15}$'),
  delivery_address text not null,
  address_number text not null,
  neighborhood text not null,
  complement text not null default '',
  postal_code text not null default '',
  city text not null,
  payment_method text not null check (payment_method in ('pix', 'cash_on_delivery', 'card_on_delivery')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'preparing', 'delivered', 'cancelled')),
  total numeric(10, 2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders (id) on delete cascade,
  kit_id uuid references public.marketplace_kits (id) on delete set null,
  kit_name text not null,
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 20),
  unit_label text not null default 'kit',
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

alter table public.marketplace_order_items
  alter column quantity type numeric(12, 3) using quantity::numeric;
alter table public.marketplace_order_items
  add column if not exists unit_label text not null default 'kit';
alter table public.marketplace_order_items
  alter column unit_label set default 'kit';
alter table public.marketplace_order_items
  drop constraint if exists marketplace_order_items_quantity_check;
alter table public.marketplace_order_items
  add constraint marketplace_order_items_quantity_check
  check (quantity > 0 and quantity <= 20);

create table if not exists public.purchase_costs (
  id uuid primary key default gen_random_uuid(),
  item_name text not null check (char_length(btrim(item_name)) between 1 and 120),
  item_key text generated always as (lower(btrim(item_name))) stored,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit text not null check (char_length(btrim(unit)) between 1 and 24),
  total_cost numeric(12, 2) not null check (total_cost >= 0),
  unit_cost numeric(12, 4) generated always as (round(total_cost / quantity, 4)) stored,
  purchased_on date not null default current_date,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.marketplace_kits enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
alter table public.purchase_costs enable row level security;

drop policy if exists "Anyone can view active marketplace kits" on public.marketplace_kits;
create policy "Anyone can view active marketplace kits"
  on public.marketplace_kits for select to anon, authenticated
  using (is_active = true);

drop policy if exists "Admins can manage marketplace kits" on public.marketplace_kits;
create policy "Admins can manage marketplace kits"
  on public.marketplace_kits for all to authenticated
  using (public.is_feira_admin())
  with check (public.is_feira_admin());

drop policy if exists "Admins can view marketplace orders" on public.marketplace_orders;
create policy "Admins can view marketplace orders"
  on public.marketplace_orders for select to authenticated
  using (public.is_feira_admin());

drop policy if exists "Admins can update marketplace orders" on public.marketplace_orders;
create policy "Admins can update marketplace orders"
  on public.marketplace_orders for update to authenticated
  using (public.is_feira_admin())
  with check (public.is_feira_admin());

drop policy if exists "Admins can view marketplace order items" on public.marketplace_order_items;
create policy "Admins can view marketplace order items"
  on public.marketplace_order_items for select to authenticated
  using (public.is_feira_admin());

drop policy if exists "Admins can view purchase costs" on public.purchase_costs;
create policy "Admins can view purchase costs"
  on public.purchase_costs for select to authenticated
  using (public.is_feira_admin());

grant select on public.marketplace_kits to anon, authenticated;
grant insert, update, delete on public.marketplace_kits to authenticated;
grant select, update on public.marketplace_orders to authenticated;
grant select on public.marketplace_order_items to authenticated;
grant select on public.purchase_costs to authenticated;

insert into storage.buckets (id, name, public)
values ('kit-images', 'kit-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Anyone can view kit images" on storage.objects;
create policy "Anyone can view kit images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'kit-images');

drop policy if exists "Admins can upload kit images" on storage.objects;
create policy "Admins can upload kit images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'kit-images' and public.is_feira_admin());

drop policy if exists "Admins can update kit images" on storage.objects;
create policy "Admins can update kit images"
  on storage.objects for update to authenticated
  using (bucket_id = 'kit-images' and public.is_feira_admin())
  with check (bucket_id = 'kit-images' and public.is_feira_admin());

drop policy if exists "Admins can delete kit images" on storage.objects;
create policy "Admins can delete kit images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'kit-images' and public.is_feira_admin());

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
    raise exception using errcode = '22023', message = 'Adicione ao menos um kit ao pedido.';
  end if;

  if jsonb_array_length(p_items) not between 1 and 12 then
    raise exception using errcode = '22023', message = 'Adicione ao menos um kit ao pedido.';
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
      raise exception using errcode = '22023', message = 'A quantidade do produto deve ficar entre 0 e 20.';
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
  to anon, authenticated;

create or replace function public.admin_record_purchase_cost(
  p_item_name text,
  p_quantity numeric,
  p_unit text,
  p_total_cost numeric,
  p_purchased_on date,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  previous_unit_cost numeric(12, 4);
  inserted_cost public.purchase_costs%rowtype;
begin
  if not public.is_feira_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;
  if char_length(btrim(coalesce(p_item_name, ''))) not between 1 and 120
    or p_quantity is null or p_quantity <= 0
    or char_length(btrim(coalesce(p_unit, ''))) not between 1 and 24
    or p_total_cost is null or p_total_cost < 0
    or p_purchased_on is null
    or char_length(coalesce(p_notes, '')) > 500 then
    raise exception using errcode = '22023', message = 'Confira os dados da compra.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(lower(btrim(p_item_name))),
    hashtext(lower(btrim(p_unit)))
  );

  select unit_cost into previous_unit_cost
  from public.purchase_costs
  where item_key = lower(btrim(p_item_name))
    and lower(unit) = lower(btrim(p_unit))
    and purchased_on <= p_purchased_on
  order by purchased_on desc, created_at desc
  limit 1;

  insert into public.purchase_costs (
    item_name,
    quantity,
    unit,
    total_cost,
    purchased_on,
    notes,
    created_by
  )
  values (
    btrim(p_item_name),
    p_quantity,
    btrim(p_unit),
    p_total_cost,
    p_purchased_on,
    btrim(coalesce(p_notes, '')),
    auth.uid()
  )
  returning * into inserted_cost;

  return jsonb_build_object(
    'id', inserted_cost.id,
    'item_name', inserted_cost.item_name,
    'quantity', inserted_cost.quantity,
    'unit', inserted_cost.unit,
    'total_cost', inserted_cost.total_cost,
    'unit_cost', inserted_cost.unit_cost,
    'purchased_on', inserted_cost.purchased_on,
    'previous_unit_cost', previous_unit_cost,
    'difference', case
      when previous_unit_cost is null then null
      else round(inserted_cost.unit_cost - previous_unit_cost, 4)
    end,
    'difference_percent', case
      when previous_unit_cost is null or previous_unit_cost = 0 then null
      else round((inserted_cost.unit_cost - previous_unit_cost) / previous_unit_cost * 100, 2)
    end
  );
end;
$$;

revoke all on function public.admin_record_purchase_cost(text, numeric, text, numeric, date, text)
  from public, anon;
grant execute on function public.admin_record_purchase_cost(text, numeric, text, numeric, date, text)
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
