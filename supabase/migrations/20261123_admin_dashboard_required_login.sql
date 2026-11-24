begin;

revoke all on function public.create_marketplace_order(text, text, text, text, text, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.create_marketplace_order(text, text, text, text, text, text, text, text, text, jsonb)
  to authenticated;

create or replace function public.admin_marketplace_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_feira_admin() then
    raise exception using errcode = '42501', message = 'Acesso administrativo necessário.';
  end if;

  return jsonb_build_object(
    'totals', jsonb_build_object(
      'confirmed_sales', coalesce((
        select sum(total)
        from public.marketplace_orders
        where status in ('confirmed', 'preparing', 'delivered')
      ), 0),
      'purchase_expenses', coalesce((select sum(total_cost) from public.purchase_costs), 0),
      'confirmed_orders', (
        select count(*)::integer
        from public.marketplace_orders
        where status in ('confirmed', 'preparing', 'delivered')
      ),
      'pending_orders', (
        select count(*)::integer
        from public.marketplace_orders
        where status = 'pending'
      ),
      'customer_count', (
        select count(*)::integer
        from public.customer_profiles profile
        where not exists (
          select 1
          from public.admin_users admin_user
          where admin_user.user_id = profile.user_id
        )
      ),
      'unlinked_orders', (
        select count(*)::integer
        from public.marketplace_orders
        where customer_id is null
      )
    ),
    'months', (
      with current_month as (
        select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date as start_month
      ),
      month_series as (
        select (current_month.start_month - make_interval(months => offset_month.value))::date as month_start
        from current_month
        cross join generate_series(5, 0, -1) as offset_month(value)
      ),
      monthly_sales as (
        select
          date_trunc('month', order_row.created_at at time zone 'America/Sao_Paulo')::date as month_start,
          sum(order_row.total) as sales
        from public.marketplace_orders order_row
        where order_row.status in ('confirmed', 'preparing', 'delivered')
          and order_row.created_at >= (
            select start_month - interval '5 months'
            from current_month
          ) at time zone 'America/Sao_Paulo'
        group by 1
      ),
      monthly_expenses as (
        select date_trunc('month', cost.purchased_on::timestamp)::date as month_start,
          sum(cost.total_cost) as expenses
        from public.purchase_costs cost
        where cost.purchased_on >= (
          select start_month - interval '5 months'
          from current_month
        )
        group by 1
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'month', to_char(month_series.month_start, 'YYYY-MM'),
            'sales', coalesce(monthly_sales.sales, 0),
            'expenses', coalesce(monthly_expenses.expenses, 0)
          )
          order by month_series.month_start
        ),
        '[]'::jsonb
      )
      from month_series
      left join monthly_sales using (month_start)
      left join monthly_expenses using (month_start)
    ),
    'top_products', (
      select coalesce(
        jsonb_agg(
          to_jsonb(products)
          order by products.units_sold desc, products.revenue desc, products.name
        ),
        '[]'::jsonb
      )
      from (
        select
          order_item.kit_name as name,
          sum(order_item.quantity) as units_sold,
          sum(order_item.line_total) as revenue,
          count(distinct order_row.id)::integer as orders_count
        from public.marketplace_order_items order_item
        join public.marketplace_orders order_row on order_row.id = order_item.order_id
        where order_row.status in ('confirmed', 'preparing', 'delivered')
        group by order_item.kit_name
        order by sum(order_item.quantity) desc, sum(order_item.line_total) desc, order_item.kit_name
        limit 5
      ) products
    ),
    'customer_activity', (
      select coalesce(
        jsonb_agg(
          to_jsonb(activity)
          order by activity.last_purchase_at asc nulls first, activity.full_name asc
        ),
        '[]'::jsonb
      )
      from (
        select
          profile.user_id,
          profile.full_name,
          profile.email,
          profile.created_at,
          max(order_row.created_at) as last_purchase_at,
          case
            when count(order_row.id) = 0 then null
            else (
              (now() at time zone 'America/Sao_Paulo')::date -
              (max(order_row.created_at at time zone 'America/Sao_Paulo'))::date
            )::integer
          end as days_since_purchase,
          count(order_row.id)::integer as orders_count,
          coalesce(sum(order_row.total), 0) as purchase_total
        from public.customer_profiles profile
        left join public.marketplace_orders order_row
          on order_row.customer_id = profile.user_id
          and order_row.status in ('confirmed', 'preparing', 'delivered')
        where not exists (
          select 1
          from public.admin_users admin_user
          where admin_user.user_id = profile.user_id
        )
        group by profile.user_id, profile.full_name, profile.email, profile.created_at
        order by max(order_row.created_at) asc nulls first, profile.full_name asc
        limit 25
      ) activity
    )
  );
end;
$$;

revoke all on function public.admin_marketplace_dashboard() from public, anon;
grant execute on function public.admin_marketplace_dashboard() to authenticated;

commit;
