-- ============================================================================
-- Bale Drop — the 48-hour escrow auto-release, and a real "delivered" state.
-- Apply after 0022_bale_split_lifecycle.sql.
--
-- The buyer UI, /policies/refunds and /sell all promised that escrow
-- auto-releases 48 hours after delivery is marked complete. Nothing implemented
-- it: `confirm_order_delivery()` was the only release path, `delivered_at` was
-- written *by* that release (so there was no delivery timestamp to measure
-- from), and `logistics-webhook` deliberately refused to apply `delivered`.
--
-- This migration separates the two facts:
--   * `status = 'delivered'` + `delivered_at`      → the parcel arrived.
--   * `escrow_status = 'released'` + release row   → the vendor got paid.
-- Delivery starts a 48 h window (`escrow_release_at`). The buyer can release
-- early by confirming, dispute inside the window, or stay silent and let the
-- `escrow-release` cron settle it.
--
-- The window lives in `escrow_release_window()` so SQL, the Edge Function and
-- `apps/web/lib/policies.ts` cannot drift apart.
-- ============================================================================

alter table public.orders
  add column if not exists escrow_release_at timestamptz;

create index if not exists orders_escrow_release_due_idx
  on public.orders (escrow_release_at)
  where status = 'delivered' and escrow_status = 'held';

-- ---------- the window ----------

create or replace function public.escrow_release_window()
returns interval
language sql
immutable
as $$
  select interval '48 hours';
$$;

revoke all on function public.escrow_release_window() from public, anon;
grant execute on function public.escrow_release_window() to authenticated, service_role;

-- ============================================================================
-- set_order_fulfillment_status — now accepts `delivered`.
-- Unchanged for processing/ready/in_transit (including the idempotent replay
-- guard from 0011). A courier/vendor `delivered` event marks arrival and starts
-- the release window without moving money.
-- ============================================================================
create or replace function public.set_order_fulfillment_status(
  p_order_id uuid,
  p_vendor_profile_id uuid,
  p_status text,
  p_tracking_number text default null,
  p_tracking_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_previous text;
  v_label text;
  v_release_at timestamptz;
begin
  select * into v_order from public.orders
  where id = p_order_id and vendor_id = p_vendor_profile_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_status not in ('processing', 'ready', 'in_transit', 'delivered') then
    raise exception 'invalid fulfillment status';
  end if;
  if v_order.status = p_status
     and v_order.tracking_number is not distinct from nullif(trim(p_tracking_number), '') then
    return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'duplicate', true, 'tracking_number', v_order.tracking_number);
  end if;
  if v_order.status in ('refunded', 'cancelled', 'disputed') then
    raise exception 'order is not actionable';
  end if;
  if v_order.status = 'delivered' and p_status <> 'delivered' then
    raise exception 'a delivered order cannot move backwards';
  end if;
  if p_status = 'in_transit' and nullif(trim(coalesce(p_tracking_number, '')), '') is null then
    raise exception 'tracking number required before dispatch';
  end if;

  v_previous := v_order.status;
  v_label := replace(initcap(replace(p_status, '_', ' ')), 'In Transit', 'In transit');

  if p_status = 'delivered' then
    v_release_at := date_trunc('second', now() + public.escrow_release_window());
    update public.orders
    set status = 'delivered',
        delivered_at = coalesce(delivered_at, now()),
        escrow_release_at = coalesce(escrow_release_at, v_release_at),
        tracking_number = coalesce(nullif(trim(p_tracking_number), ''), tracking_number),
        tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url)
    where id = v_order.id;

    insert into public.order_timeline (order_id, status, note)
    values (v_order.id, 'delivered', 'Courier reported delivery — escrow release window started');

    insert into public.notifications (profile_id, title, body, href)
    values (
      v_order.buyer_id,
      'Marked delivered — please confirm',
      format(
        'Your order was delivered. Confirm to release escrow now, or open a dispute. It auto-releases on %s.',
        to_char(coalesce(v_order.escrow_release_at, v_release_at), 'Dy DD Mon, HH12:MI am')
      ),
      '/orders'
    );

    return jsonb_build_object(
      'order_id', v_order.id,
      'status', 'delivered',
      'delivered_at', v_order.delivered_at,
      'escrow_release_at', coalesce(v_order.escrow_release_at, v_release_at),
      'escrow_status', v_order.escrow_status
    );
  end if;

  update public.orders
  set status = p_status,
      tracking_number = coalesce(nullif(trim(p_tracking_number), ''), tracking_number),
      tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url)
  where id = v_order.id;
  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, p_status, format('Vendor moved order from %s to %s', v_previous, v_label));
  insert into public.notifications (profile_id, title, body, href)
  values (v_order.buyer_id, 'Order update', format('Your order is now %s.', v_label), '/orders');

  return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'tracking_number', coalesce(p_tracking_number, v_order.tracking_number));
end;
$$;

revoke all on function public.set_order_fulfillment_status(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, uuid, text, text, text) to service_role;

-- ============================================================================
-- release_order_escrow — the single money-moving release routine.
-- Used by the buyer's explicit confirmation, the auto-release cron, and any
-- future scheduled job. Locks the order, refuses twice, writes the payout, the
-- commission ledger row, the timeline entry and both notifications.
-- ============================================================================
create or replace function public.release_order_escrow(
  p_order_id uuid,
  p_note text default 'Escrow released'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_rate numeric;
  v_gross int;
  v_commission int;
  v_payout_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.escrow_status = 'released' then
    return jsonb_build_object('order_id', v_order.id, 'status', 'duplicate', 'escrow_status', 'released');
  end if;
  if v_order.escrow_status <> 'held' then
    raise exception 'escrow is not held';
  end if;
  if exists (
    select 1 from public.disputes
    where order_id = v_order.id and status in ('open', 'under_review')
  ) then
    raise exception 'resolve the open dispute first';
  end if;

  v_rate := public.commission_rate_for_vendor(v_order.vendor_id);
  if v_rate is null then v_rate := 0.07; end if;
  v_gross := greatest(0, v_order.subtotal_naira);
  v_commission := round(v_gross * v_rate);

  update public.orders
  set status = 'delivered',
      escrow_status = 'released',
      delivered_at = coalesce(delivered_at, now()),
      escrow_release_at = now()
  where id = v_order.id;

  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, 'delivered', p_note);

  insert into public.vendor_payouts (
    vendor_id, order_id, gross_naira, commission_naira, net_naira, status
  ) values (
    v_order.vendor_id, v_order.id, v_gross, v_commission,
    greatest(0, v_gross - v_commission), 'pending'
  )
  on conflict do nothing
  returning id into v_payout_id;

  if v_commission > 0 then
    insert into public.transactions (kind, amount_naira, order_id, vendor_id, buyer_id, meta)
    values ('commission', v_commission, v_order.id, v_order.vendor_id, v_order.buyer_id,
            jsonb_build_object('rate', v_rate, 'source', 'escrow_release'))
    on conflict do nothing;
  end if;

  insert into public.notifications (profile_id, title, body, href)
  values (v_order.buyer_id, 'Escrow released',
          'Your payment was released to the vendor. Leave a review to help other buyers.', '/orders');
  insert into public.notifications (profile_id, title, body, href)
  select vp.profile_id, 'Order delivered — payout queued',
         'Escrow was released. Your payout is now queued for transfer.', '/vendor'
  from public.vendor_profiles vp where vp.id = v_order.vendor_id;

  return jsonb_build_object(
    'order_id', v_order.id,
    'status', 'delivered',
    'escrow_status', 'released',
    'payout_id', v_payout_id,
    'net_naira', greatest(0, v_gross - v_commission)
  );
end;
$$;

revoke all on function public.release_order_escrow(uuid, text) from public, anon, authenticated;
grant execute on function public.release_order_escrow(uuid, text) to service_role;

-- ============================================================================
-- confirm_order_delivery — buyer's explicit release.
-- Now also valid when the courier already marked the order delivered, and the
-- money movement is delegated to `release_order_escrow()` so there is exactly
-- one implementation of "release".
-- ============================================================================
create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_buyer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_result jsonb;
begin
  select * into v_order from public.orders
  where id = p_order_id and buyer_id = p_buyer_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('processing', 'ready', 'in_transit', 'delivered') then
    raise exception 'order is not ready for delivery confirmation';
  end if;
  if v_order.escrow_status <> 'held' then raise exception 'escrow is not held'; end if;

  v_result := public.release_order_escrow(
    v_order.id,
    'Buyer confirmed delivery — escrow released'
  );
  return v_result || jsonb_build_object('confirmed_by_buyer', true);
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_order_delivery(uuid, uuid) to service_role;

-- ============================================================================
-- release_due_escrows — the cron body. Batched, lock-skipping, and tolerant:
-- one stuck order must not stop the rest.
-- ============================================================================
create or replace function public.release_due_escrows(p_batch int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_released int := 0;
  v_errors int := 0;
  v_last_error text;
begin
  if p_batch < 1 or p_batch > 500 then raise exception 'batch must be between 1 and 500'; end if;
  for v_order in
    select id
    from public.orders
    where status = 'delivered'
      and escrow_status = 'held'
      and escrow_release_at is not null
      and escrow_release_at <= now()
      and not exists (
        select 1 from public.disputes d
        where d.order_id = orders.id and d.status in ('open', 'under_review')
      )
    order by escrow_release_at
    limit p_batch
    for update skip locked
  loop
    begin
      perform public.release_order_escrow(
        v_order.id,
        'Escrow auto-released 48 hours after delivery'
      );
      v_released := v_released + 1;
    exception when others then
      v_errors := v_errors + 1;
      v_last_error := sqlerrm;
    end;
  end loop;
  return jsonb_build_object('released', v_released, 'errors', v_errors, 'last_error', v_last_error);
end;
$$;

revoke all on function public.release_due_escrows(int) from public, anon, authenticated;
grant execute on function public.release_due_escrows(int) to service_role;

-- Backfill: any order already sitting at delivered+held from before this
-- migration gets a window measured from its delivery/creation time.
update public.orders
set escrow_release_at = date_trunc('second', coalesce(delivered_at, updated_at, created_at) + public.escrow_release_window())
where status = 'delivered'
  and escrow_status = 'held'
  and escrow_release_at is null;
