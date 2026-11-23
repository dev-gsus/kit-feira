begin;

create table if not exists public.marketplace_announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(btrim(message)) between 3 and 180),
  price numeric(10, 2) check (price is null or price >= 0),
  unit text not null default '' check (char_length(unit) <= 24),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_announcements_active_created_idx
  on public.marketplace_announcements (created_at desc)
  where is_active;

alter table public.marketplace_announcements enable row level security;

drop policy if exists "Anyone can view active marketplace announcements"
  on public.marketplace_announcements;
create policy "Anyone can view active marketplace announcements"
  on public.marketplace_announcements for select to anon, authenticated
  using (is_active);

drop policy if exists "Admins can manage marketplace announcements"
  on public.marketplace_announcements;
create policy "Admins can manage marketplace announcements"
  on public.marketplace_announcements for all to authenticated
  using (public.is_feira_admin())
  with check (public.is_feira_admin());

grant select on public.marketplace_announcements to anon, authenticated;
grant insert, update on public.marketplace_announcements to authenticated;

commit;
