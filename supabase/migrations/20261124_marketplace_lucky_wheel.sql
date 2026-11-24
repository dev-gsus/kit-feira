alter table public.marketplace_orders
  add column if not exists customer_id uuid references auth.users(id) on delete set null;

create table if not exists public.marketplace_wheel_prizes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(btrim(label)) between 2 and 100),
  weight integer not null default 1 check (weight between 1 and 10000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_wheel_spins (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.marketplace_orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  prize_id uuid references public.marketplace_wheel_prizes(id) on delete set null,
  prize_label text not null,
  spun_at timestamptz not null default now()
);

alter table public.marketplace_wheel_prizes enable row level security;
alter table public.marketplace_wheel_spins enable row level security;

drop policy if exists "Admins manage wheel prizes" on public.marketplace_wheel_prizes;
create policy "Admins manage wheel prizes" on public.marketplace_wheel_prizes
  for all to authenticated using (public.is_feira_admin()) with check (public.is_feira_admin());
drop policy if exists "Customers view own wheel spins" on public.marketplace_wheel_spins;
create policy "Customers view own wheel spins" on public.marketplace_wheel_spins
  for select to authenticated using (customer_id = auth.uid() or public.is_feira_admin());
grant select on public.marketplace_wheel_prizes to anon, authenticated;
grant insert, update, delete on public.marketplace_wheel_prizes to authenticated;
grant select on public.marketplace_wheel_spins to authenticated;

create or replace function public.spin_marketplace_wheel(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prize_row public.marketplace_wheel_prizes%rowtype;
  spin_row public.marketplace_wheel_spins%rowtype;
  total_weight bigint;
  winning_point bigint;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Entre na sua conta para girar a roleta.';
  end if;
  if not exists (
    select 1 from public.marketplace_orders
    where id = p_order_id and customer_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Este pedido não pertence à sua conta.';
  end if;

  select * into spin_row from public.marketplace_wheel_spins where order_id = p_order_id;
  if found then
    return jsonb_build_object('spin_id', spin_row.id, 'prize', spin_row.prize_label, 'already_spun', true);
  end if;

  select coalesce(sum(weight), 0) into total_weight from public.marketplace_wheel_prizes where is_active;
  if total_weight = 0 then
    raise exception using errcode = 'P0002', message = 'A roleta ainda não tem prêmios disponíveis.';
  end if;
  winning_point := floor(random() * total_weight)::bigint;
  select * into prize_row from (
    select p.*, sum(p.weight) over (order by p.created_at, p.id) as weight_end
    from public.marketplace_wheel_prizes p where p.is_active
  ) weighted where weight_end > winning_point order by weight_end limit 1;

  insert into public.marketplace_wheel_spins(order_id, customer_id, prize_id, prize_label)
  values (p_order_id, auth.uid(), prize_row.id, prize_row.label)
  on conflict (order_id) do nothing
  returning * into spin_row;
  if not found then
    select * into spin_row from public.marketplace_wheel_spins where order_id = p_order_id;
  end if;
  return jsonb_build_object('spin_id', spin_row.id, 'prize', spin_row.prize_label, 'already_spun', spin_row.customer_id <> auth.uid());
end;
$$;

revoke all on function public.spin_marketplace_wheel(uuid) from public, anon;
grant execute on function public.spin_marketplace_wheel(uuid) to authenticated;
