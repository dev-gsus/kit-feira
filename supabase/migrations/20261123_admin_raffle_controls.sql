grant delete on public.raffles to authenticated;

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

  update public.raffles
  set is_active = false, status = 'finished'
  where id = p_raffle_id;

  return query
    select result_row.id, result_row.winner_name, result_row.prize, result_row.drawn_at;
end;
$$;

revoke all on function public.perform_draw(uuid) from public, anon;
grant execute on function public.perform_draw(uuid) to authenticated;
