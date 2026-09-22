-- ============================================================================
-- Bale Drop — Paystack payment sessions + atomic escrow finalization.
-- Apply after 0001, 0002 and 0003.
--
-- Money rule: the browser may request a payment, but only the signed Paystack
-- webhook can call finalize_payment_session(), which marks orders paid/held
-- and writes the append-only transaction audit rows.
-- ============================================================================

create table public.payment_sessions (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  reference text not null unique,
  kind text not null check (kind in ('order_batch', 'slot')),
  amount_naira int not null check (amount_naira > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  order_ids uuid[] not null default '{}'::uuid[],
  booking_id uuid references public.bale_bookings (id),
  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed', 'abandoned')),
  preferred_channel text,
  authorization_url text,
  access_code text,
  paystack_transaction_id text,
  gateway_response text,
  channel text,
  paid_at timestamptz,
  failure_reason text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'slot' and booking_id is not null and cardinality(order_ids) = 0)
    or (kind = 'order_batch' and booking_id is null and cardinality(order_ids) > 0)
  )
);

create index payment_sessions_buyer_idx on public.payment_sessions (buyer_id, created_at desc);
create index payment_sessions_status_idx on public.payment_sessions (status, created_at desc);
create unique index payment_sessions_pending_booking_idx
  on public.payment_sessions (booking_id)
  where booking_id is not null and status = 'pending';

create trigger set_updated_at before update on public.payment_sessions
for each row execute function public.handle_updated_at();

alter table public.payment_sessions enable row level security;
create policy "payment sessions buyer read" on public.payment_sessions
  for select using (buyer_id = auth.uid());
-- No client insert/update/delete policy. Edge Functions use service_role.

-- Prevent duplicate audit rows if Paystack retries a webhook or two deliveries
-- race each other. Batch payments intentionally share a reference across their
-- individual order rows, so order_id/booking_id is part of each unique key.
create unique index transactions_paystack_order_idx
  on public.transactions (paystack_reference, order_id, kind)
  where paystack_reference is not null and order_id is not null;
create unique index transactions_paystack_booking_idx
  on public.transactions (paystack_reference, bale_booking_id, kind)
  where paystack_reference is not null and bale_booking_id is not null;

-- The return page listens for the service-role update instead of polling.
alter table public.payment_sessions replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.payment_sessions;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- Atomic finalizer. Only service_role may execute this function.
-- It trusts the payment session created by paystack-initialize, not webhook
-- metadata supplied by the browser. p_amount_naira is checked against the
-- stored session amount before any order/booking is promoted.
-- ============================================================================

create or replace function public.finalize_payment_session(
  p_reference text,
  p_amount_naira int,
  p_paystack_transaction_id text default null,
  p_channel text default null,
  p_gateway_response text default null,
  p_event jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.payment_sessions%rowtype;
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_booking public.bale_bookings%rowtype;
  v_updated int;
  v_processed int := 0;
begin
  select * into v_session
  from public.payment_sessions
  where reference = p_reference
  for update;

  if not found then
    raise exception 'payment session not found';
  end if;

  if v_session.status = 'success' then
    return jsonb_build_object(
      'status', 'duplicate',
      'kind', v_session.kind,
      'order_ids', v_session.order_ids,
      'booking_id', v_session.booking_id
    );
  end if;

  if v_session.status <> 'pending' then
    raise exception 'payment session is %', v_session.status;
  end if;

  if v_session.amount_naira <> p_amount_naira then
    raise exception 'payment amount mismatch';
  end if;

  update public.payment_sessions
  set status = 'success',
      paystack_transaction_id = p_paystack_transaction_id,
      channel = p_channel,
      gateway_response = p_gateway_response,
      paid_at = now(),
      meta = meta || jsonb_build_object('webhook_event', p_event)
  where id = v_session.id;

  if v_session.kind = 'slot' then
    select * into v_booking
    from public.bale_bookings
    where id = v_session.booking_id
    for update;

    if not found then
      raise exception 'booking not found';
    end if;

    update public.bale_bookings
    set status = 'paid', paystack_reference = p_reference
    where id = v_booking.id and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      raise exception 'booking is no longer pending';
    end if;

    insert into public.transactions (
      kind, amount_naira, bale_booking_id, buyer_id, paystack_reference, meta
    ) values (
      'pay_in', v_booking.amount_naira, v_booking.id, v_booking.buyer_id,
      p_reference, jsonb_build_object('event', p_event, 'session_id', v_session.id)
    ) on conflict do nothing;

    insert into public.notifications (profile_id, title, body, href)
    values (v_booking.buyer_id, 'Slot payment confirmed', 'Your Bale Split slot is held in escrow until the split fills.', '/orders');
    insert into public.notifications (profile_id, title, body, href)
    select vp.profile_id, 'New paid Bale Split slot', 'A buyer joined your split. Keep an eye on the fill count.', '/vendor'
    from public.bale_listings bl
    join public.products p on p.id = bl.product_id
    join public.vendor_profiles vp on vp.id = p.vendor_id
    where bl.id = v_booking.bale_id;

    update public.bale_listings
    set status = 'processing'
    where id = v_booking.bale_id
      and status = 'full'
      and booked_count >= split_count;

    return jsonb_build_object(
      'status', 'success', 'kind', 'slot', 'booking_id', v_booking.id
    );
  end if;

  if cardinality(v_session.order_ids) = 0 then
    raise exception 'payment session has no orders';
  end if;

  foreach v_order_id in array v_session.order_ids loop
    select * into v_order
    from public.orders
    where id = v_order_id and buyer_id = v_session.buyer_id
    for update;

    if not found then
      raise exception 'order not found';
    end if;

    if v_order.status <> 'pending_payment' or v_order.escrow_status <> 'none' then
      raise exception 'order is no longer pending payment';
    end if;

    update public.orders
    set status = 'paid',
        escrow_status = 'held',
        paystack_reference = p_reference
    where id = v_order.id;

    insert into public.order_timeline (order_id, status, note)
    select v_order.id, 'paid', 'Payment confirmed — held in escrow'
    where not exists (
      select 1 from public.order_timeline
      where order_id = v_order.id and status = 'paid'
    );

    insert into public.transactions (
      kind, amount_naira, order_id, vendor_id, buyer_id,
      paystack_reference, meta
    ) values (
      'pay_in', v_order.total_naira, v_order.id, v_order.vendor_id,
      v_order.buyer_id, p_reference,
      jsonb_build_object('event', p_event, 'session_id', v_session.id)
    ) on conflict do nothing;

    insert into public.notifications (profile_id, title, body, href)
    values (v_order.buyer_id, 'Payment confirmed — escrow held', 'Your order is paid and protected. We will notify you as it moves.', '/orders');
    insert into public.notifications (profile_id, title, body, href)
    select vp.profile_id, 'New paid order', 'A buyer paid for an order. Open your vendor workspace to start fulfillment.', '/vendor'
    from public.vendor_profiles vp where vp.id = v_order.vendor_id;

    v_processed := v_processed + 1;
  end loop;

  return jsonb_build_object(
    'status', 'success', 'kind', 'order_batch',
    'order_ids', v_session.order_ids, 'processed', v_processed
  );
end;
$$;

revoke all on function public.finalize_payment_session(text, int, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.finalize_payment_session(text, int, text, text, text, jsonb)
to service_role;
