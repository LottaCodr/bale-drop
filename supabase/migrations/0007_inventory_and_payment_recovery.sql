-- ============================================================================
-- Bale Drop — single-item inventory reservation and payment recovery.
-- Apply after 0006.
-- ============================================================================

alter table public.orders add column if not exists inventory_released boolean not null default false;

create or replace function public.reserve_product_stock(
  p_product_id uuid,
  p_qty int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if p_qty < 1 then raise exception 'quantity must be positive'; end if;
  update public.products
  set qty = qty - p_qty
  where id = p_product_id and status = 'active' and qty >= p_qty;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.release_product_stock(
  p_product_id uuid,
  p_qty int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty < 1 then raise exception 'quantity must be positive'; end if;
  update public.products set qty = qty + p_qty where id = p_product_id;
  return found;
end;
$$;

create or replace function public.cancel_payment_session(
  p_reference text,
  p_reason text default 'payment failed'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.payment_sessions%rowtype;
  v_order_id uuid;
  v_restored int := 0;
  v_booking public.bale_bookings%rowtype;
begin
  select * into v_session from public.payment_sessions where reference = p_reference for update;
  if not found then raise exception 'payment session not found'; end if;
  if v_session.status = 'failed' then return jsonb_build_object('status', 'duplicate'); end if;
  if v_session.status <> 'pending' then raise exception 'payment session is %', v_session.status; end if;

  update public.payment_sessions set status = 'failed', failure_reason = p_reason where id = v_session.id;

  if v_session.kind = 'slot' then
    select * into v_booking from public.bale_bookings where id = v_session.booking_id for update;
    if found and v_booking.status = 'pending' then
      update public.bale_bookings set status = 'cancelled' where id = v_booking.id;
      update public.bale_listings
      set booked_count = greatest(0, booked_count - 1),
          status = case when status = 'full' then 'open' else status end
      where id = v_booking.bale_id;
    end if;
    return jsonb_build_object('status', 'failed', 'kind', 'slot');
  end if;

  foreach v_order_id in array v_session.order_ids loop
    if exists (select 1 from public.orders where id = v_order_id and inventory_released = false) then
      update public.products p
      set qty = p.qty + oi.qty
      from (
        select product_id, sum(qty)::int as qty
        from public.order_items
        where order_id = v_order_id and product_id is not null
        group by product_id
      ) oi
      where oi.product_id = p.id;
      update public.orders set inventory_released = true, status = 'cancelled' where id = v_order_id and status = 'pending_payment';
      insert into public.notifications (profile_id, title, body, href)
      select o.buyer_id, 'Payment not completed', 'No order was marked paid. Your reserved stock has been released.', '/checkout'
      from public.orders o where o.id = v_order_id;
      v_restored := v_restored + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'failed', 'kind', 'order_batch', 'orders_restored', v_restored);
end;
$$;

create or replace function public.restore_order_inventory(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.inventory_released then return jsonb_build_object('status', 'duplicate'); end if;
  update public.products p
  set qty = p.qty + oi.qty
  from (
    select product_id, sum(qty)::int as qty
    from public.order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) oi
  where oi.product_id = p.id;
  update public.orders set inventory_released = true where id = p_order_id;
  return jsonb_build_object('status', 'restored', 'order_id', p_order_id);
end;
$$;

revoke all on function public.reserve_product_stock(uuid, int) from public, anon, authenticated;
revoke all on function public.release_product_stock(uuid, int) from public, anon, authenticated;
revoke all on function public.cancel_payment_session(text, text) from public, anon, authenticated;
revoke all on function public.restore_order_inventory(uuid) from public, anon, authenticated;
grant execute on function public.reserve_product_stock(uuid, int) to service_role;
grant execute on function public.release_product_stock(uuid, int) to service_role;
grant execute on function public.cancel_payment_session(text, text) to service_role;
grant execute on function public.restore_order_inventory(uuid) to service_role;
