-- ============================================================================
-- Bale Drop — idempotency keys and external money reconciliation.
-- Apply after 0007_inventory_and_payment_recovery.sql.
--
-- A browser retry must not create another order/charge. External transfer and
-- refund calls are persisted as state machines so an ambiguous network result
-- can be verified before a new request is sent.
-- ============================================================================

alter table public.payment_sessions
  add column if not exists idempotency_key text;
create unique index if not exists payment_sessions_buyer_idempotency_idx
  on public.payment_sessions (buyer_id, idempotency_key)
  where idempotency_key is not null;

alter table public.vendor_payouts
  add column if not exists paystack_transfer_reference text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists last_checked_at timestamptz;
create unique index if not exists vendor_payouts_transfer_reference_idx
  on public.vendor_payouts (paystack_transfer_reference)
  where paystack_transfer_reference is not null;

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete restrict,
  dispute_id uuid references public.disputes (id) on delete set null,
  paystack_reference text not null,
  paystack_refund_id text unique,
  amount_naira int not null check (amount_naira > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'needs_attention', 'processed', 'failed')),
  attempts int not null default 0,
  last_error text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_refunds_status_idx on public.order_refunds (status, updated_at desc);
create index if not exists order_refunds_reference_idx on public.order_refunds (paystack_reference);

create table if not exists public.bale_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bale_bookings (id) on delete restrict,
  paystack_reference text not null,
  paystack_refund_id text unique,
  amount_naira int not null check (amount_naira > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'needs_attention', 'processed', 'failed')),
  attempts int not null default 0,
  last_error text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bale_refunds_status_idx on public.bale_refunds (status, updated_at desc);
create index if not exists bale_refunds_reference_idx on public.bale_refunds (paystack_reference);

alter table public.order_refunds enable row level security;
alter table public.bale_refunds enable row level security;
create policy "refunds buyer read" on public.order_refunds for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()));
create policy "refunds admin read" on public.order_refunds for select
  using (public.is_admin());
create policy "bale refunds buyer read" on public.bale_refunds for select
  using (exists (select 1 from public.bale_bookings b where b.id = booking_id and b.buyer_id = auth.uid()));
create policy "bale refunds admin read" on public.bale_refunds for select
  using (public.is_admin());

create trigger set_updated_at before update on public.order_refunds
for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.bale_refunds
for each row execute function public.handle_updated_at();

-- Atomically claim a payout attempt. If an earlier request may have reached
-- Paystack, the existing reference is deliberately reused for verification.
create or replace function public.claim_vendor_payout(p_payout_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.vendor_payouts%rowtype;
  v_reference text;
begin
  select * into v_payout from public.vendor_payouts where id = p_payout_id for update;
  if not found then raise exception 'payout not found'; end if;
  if v_payout.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'duplicate', true, 'transfer_reference', v_payout.paystack_transfer_reference, 'transfer_code', v_payout.paystack_transfer_code);
  end if;
  if v_payout.status = 'processing' and not p_force then
    return jsonb_build_object('status', 'processing', 'claimed', false, 'transfer_reference', v_payout.paystack_transfer_reference, 'transfer_code', v_payout.paystack_transfer_code, 'attempts', v_payout.attempts, 'processing_started_at', v_payout.processing_started_at);
  end if;
  if v_payout.status = 'processing' and p_force then
    -- Reconciliation may verify the same reference, but it must never become
    -- a second owner allowed to POST a duplicate transfer.
    update public.vendor_payouts set last_checked_at = now() where id = v_payout.id;
    return jsonb_build_object('status', 'processing', 'claimed', false, 'transfer_reference', v_payout.paystack_transfer_reference, 'transfer_code', v_payout.paystack_transfer_code, 'attempts', v_payout.attempts, 'processing_started_at', v_payout.processing_started_at);
  end if;
  if v_payout.status not in ('pending', 'failed') then raise exception 'payout is %', v_payout.status; end if;

  v_reference := coalesce(v_payout.paystack_transfer_reference, format('bd-payout-%s-1', v_payout.id));
  update public.vendor_payouts
  set status = 'processing',
      attempts = attempts + 1,
      paystack_transfer_reference = v_reference,
      processing_started_at = now(),
      last_checked_at = now(),
      last_error = null
  where id = v_payout.id;
  return jsonb_build_object('status', 'processing', 'claimed', true, 'transfer_reference', v_reference, 'transfer_code', v_payout.paystack_transfer_code, 'attempts', v_payout.attempts + 1);
end;
$$;

-- Rotate only after Paystack has positively reported the previous reference as
-- failed/reversed (never rotate merely because our network timed out).
create or replace function public.rotate_vendor_payout_reference(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.vendor_payouts%rowtype;
  v_reference text;
  v_attempt int;
begin
  select * into v_payout from public.vendor_payouts where id = p_payout_id for update;
  if not found then raise exception 'payout not found'; end if;
  if v_payout.status = 'paid' then return jsonb_build_object('status', 'paid', 'duplicate', true); end if;
  v_attempt := greatest(v_payout.attempts + 1, 1);
  v_reference := format('bd-payout-%s-%s', v_payout.id, v_attempt);
  update public.vendor_payouts
  set status = 'processing', attempts = v_attempt,
      paystack_transfer_reference = v_reference,
      paystack_transfer_code = null,
      processing_started_at = now(), last_checked_at = now(), last_error = null
  where id = v_payout.id;
  return jsonb_build_object('status', 'processing', 'transfer_reference', v_reference, 'attempts', v_attempt);
end;
$$;

-- Complete or re-state a payout exactly once. The transaction and notification
-- are written only on the transition into paid.
create or replace function public.complete_vendor_payout(
  p_payout_id uuid,
  p_status text,
  p_transfer_code text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.vendor_payouts%rowtype;
  v_previous text;
  v_vendor_profile uuid;
begin
  if p_status not in ('processing', 'paid', 'failed') then raise exception 'invalid payout status'; end if;
  select * into v_payout from public.vendor_payouts where id = p_payout_id for update;
  if not found then raise exception 'payout not found'; end if;
  v_previous := v_payout.status;
  if v_previous = 'paid' then
    return jsonb_build_object('status', 'paid', 'duplicate', true, 'payout_id', p_payout_id);
  end if;
  update public.vendor_payouts
  set status = p_status,
      paystack_transfer_code = coalesce(p_transfer_code, paystack_transfer_code),
      last_error = p_error,
      last_checked_at = now()
  where id = p_payout_id;

  if p_status = 'paid' and v_previous <> 'paid' then
    insert into public.transactions (kind, amount_naira, order_id, vendor_id, paystack_reference, meta)
    values ('payout', v_payout.net_naira, v_payout.order_id, v_payout.vendor_id,
            coalesce(p_transfer_code, v_payout.paystack_transfer_reference),
            jsonb_build_object('source', 'payout_reconciliation'))
    on conflict do nothing;
    select profile_id into v_vendor_profile from public.vendor_profiles where id = v_payout.vendor_id;
    if v_vendor_profile is not null then
      insert into public.notifications (profile_id, title, body, href)
      values (v_vendor_profile, 'Payout sent', format('%s naira has been sent to your bank account.', v_payout.net_naira), '/vendor');
    end if;
  end if;
  return jsonb_build_object('status', p_status, 'payout_id', p_payout_id, 'previous_status', v_previous);
end;
$$;

-- Claim a refund request without calling Paystack while holding a database
-- lock. The same order always maps to the same refund row/reference.
create or replace function public.claim_order_refund(
  p_order_id uuid,
  p_dispute_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_refund public.order_refunds%rowtype;
  v_refund_id uuid;
  v_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status = 'refunded' and v_order.escrow_status = 'refunded' then
    select * into v_refund from public.order_refunds where order_id = p_order_id for update;
    if found then return jsonb_build_object('status', v_refund.status, 'refund_id', v_refund.id, 'paystack_refund_id', v_refund.paystack_refund_id, 'duplicate', true); end if;
  end if;
  if v_order.escrow_status <> 'held' then raise exception 'order escrow is no longer held'; end if;
  if v_order.paystack_reference is null then raise exception 'order has no Paystack reference'; end if;

  insert into public.order_refunds (order_id, dispute_id, paystack_reference, amount_naira, status)
  values (p_order_id, p_dispute_id, v_order.paystack_reference, v_order.total_naira, 'pending')
  on conflict (order_id) do nothing;
  select * into v_refund from public.order_refunds where order_id = p_order_id for update;
  if v_refund.status = 'processed' then
    return jsonb_build_object('status', 'processed', 'refund_id', v_refund.id, 'paystack_refund_id', v_refund.paystack_refund_id, 'duplicate', true);
  end if;
  if v_refund.status = 'processing' and v_refund.updated_at > now() - interval '15 minutes' then
    return jsonb_build_object('status', 'processing', 'refund_id', v_refund.id, 'paystack_refund_id', v_refund.paystack_refund_id, 'amount_naira', v_refund.amount_naira, 'claimed', false, 'retry_after_seconds', 900);
  end if;
  update public.order_refunds
  set status = 'processing', attempts = attempts + 1, dispute_id = coalesce(p_dispute_id, dispute_id), last_error = null
  where id = v_refund.id;
  return jsonb_build_object('status', 'processing', 'refund_id', v_refund.id, 'paystack_reference', v_refund.paystack_reference, 'paystack_refund_id', v_refund.paystack_refund_id, 'amount_naira', v_refund.amount_naira, 'claimed', true);
end;
$$;

-- Apply an asynchronous Paystack refund state transition. Only processed
-- refunds release escrow and restore stock.
create or replace function public.settle_order_refund(
  p_refund_id uuid,
  p_status text,
  p_paystack_refund_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.order_refunds%rowtype;
  v_order public.orders%rowtype;
  v_buyer_id uuid;
  v_previous text;
begin
  if p_status not in ('pending', 'processing', 'needs_attention', 'processed', 'failed') then raise exception 'invalid refund status'; end if;
  select * into v_refund from public.order_refunds where id = p_refund_id for update;
  if not found then raise exception 'refund not found'; end if;
  v_previous := v_refund.status;
  if v_previous = 'processed' then
    return jsonb_build_object('status', 'processed', 'refund_id', p_refund_id, 'duplicate', true);
  end if;
  update public.order_refunds
  set status = p_status,
      paystack_refund_id = coalesce(p_paystack_refund_id, paystack_refund_id),
      last_error = p_error,
      processed_at = case when p_status = 'processed' then coalesce(processed_at, now()) else processed_at end
  where id = p_refund_id;

  if p_status = 'processed' and v_previous <> 'processed' then
    select * into v_order from public.orders where id = v_refund.order_id for update;
    update public.orders set status = 'refunded', escrow_status = 'refunded' where id = v_order.id;
    perform public.restore_order_inventory(v_order.id);
    insert into public.disputes (id, order_id, buyer_id, status, reason, description, evidence_urls, resolution_note)
    values (coalesce(v_refund.dispute_id, gen_random_uuid()), v_order.id, v_order.buyer_id, 'resolved_buyer', 'Admin refund', null, '{}', 'Refund processed by Paystack')
    on conflict (id) do nothing;
    update public.disputes set status = 'resolved_buyer', resolution_note = 'Refund processed by Paystack' where id = v_refund.dispute_id;
    insert into public.order_timeline (order_id, status, note) values (v_order.id, 'refunded', 'Paystack refund processed — inventory restored');
    insert into public.transactions (kind, amount_naira, order_id, buyer_id, vendor_id, paystack_reference, meta)
    values ('refund', v_refund.amount_naira, v_order.id, v_order.buyer_id, v_order.vendor_id, v_refund.paystack_reference, jsonb_build_object('refund_id', v_refund.id, 'paystack_refund_id', p_paystack_refund_id))
    on conflict do nothing;
    insert into public.notifications (profile_id, title, body, href)
    values (v_order.buyer_id, 'Refund processed', 'Your Paystack refund has been processed. Check your original payment method.', '/orders');
  elsif p_status in ('failed', 'needs_attention') and v_previous not in ('failed', 'needs_attention') then
    select buyer_id into v_buyer_id from public.orders where id = v_refund.order_id;
    insert into public.notifications (profile_id, title, body, href)
    values (v_buyer_id, 'Refund needs attention', coalesce(p_error, 'Paystack could not complete the refund automatically. Our team will follow up.'), '/orders');
  end if;
  return jsonb_build_object('status', p_status, 'refund_id', p_refund_id, 'previous_status', v_previous);
end;
$$;

create or replace function public.claim_bale_refund(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bale_bookings%rowtype;
  v_refund public.bale_refunds%rowtype;
begin
  select * into v_booking from public.bale_bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found'; end if;
  if v_booking.status not in ('paid', 'refunded') then raise exception 'booking is not refundable'; end if;
  if v_booking.paystack_reference is null then raise exception 'booking has no Paystack reference'; end if;
  insert into public.bale_refunds (booking_id, paystack_reference, amount_naira, status)
  values (v_booking.id, v_booking.paystack_reference, v_booking.amount_naira, 'pending')
  on conflict (booking_id) do nothing;
  select * into v_refund from public.bale_refunds where booking_id = p_booking_id for update;
  if v_refund.status = 'processed' or v_booking.status = 'refunded' then
    return jsonb_build_object('status', v_refund.status, 'refund_id', v_refund.id, 'paystack_refund_id', v_refund.paystack_refund_id, 'duplicate', true);
  end if;
  if v_refund.status = 'processing' and v_refund.updated_at > now() - interval '15 minutes' then
    return jsonb_build_object('status', 'processing', 'refund_id', v_refund.id, 'paystack_refund_id', v_refund.paystack_refund_id, 'amount_naira', v_refund.amount_naira, 'claimed', false, 'retry_after_seconds', 900);
  end if;
  update public.bale_refunds set status = 'processing', attempts = attempts + 1, last_error = null where id = v_refund.id;
  return jsonb_build_object('status', 'processing', 'refund_id', v_refund.id, 'paystack_reference', v_refund.paystack_reference, 'paystack_refund_id', v_refund.paystack_refund_id, 'amount_naira', v_refund.amount_naira, 'claimed', true);
end;
$$;

create or replace function public.settle_bale_refund(
  p_refund_id uuid,
  p_status text,
  p_paystack_refund_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refund public.bale_refunds%rowtype;
  v_booking public.bale_bookings%rowtype;
  v_buyer_id uuid;
  v_previous text;
begin
  if p_status not in ('pending', 'processing', 'needs_attention', 'processed', 'failed') then raise exception 'invalid refund status'; end if;
  select * into v_refund from public.bale_refunds where id = p_refund_id for update;
  if not found then raise exception 'refund not found'; end if;
  v_previous := v_refund.status;
  if v_previous = 'processed' then
    return jsonb_build_object('status', 'processed', 'refund_id', p_refund_id, 'duplicate', true);
  end if;
  update public.bale_refunds
  set status = p_status,
      paystack_refund_id = coalesce(p_paystack_refund_id, paystack_refund_id),
      last_error = p_error,
      processed_at = case when p_status = 'processed' then coalesce(processed_at, now()) else processed_at end
  where id = p_refund_id;
  if p_status = 'processed' and v_previous <> 'processed' then
    select * into v_booking from public.bale_bookings where id = v_refund.booking_id for update;
    update public.bale_bookings set status = 'refunded' where id = v_booking.id;
    insert into public.transactions (kind, amount_naira, bale_booking_id, buyer_id, paystack_reference, meta)
    values ('refund', v_refund.amount_naira, v_booking.id, v_booking.buyer_id, v_refund.paystack_reference, jsonb_build_object('refund_id', v_refund.id, 'reason', 'split_expired'))
    on conflict do nothing;
    insert into public.notifications (profile_id, title, body, href)
    values (v_booking.buyer_id, 'Split expired — refund processed', 'The bale split did not fill in time. Your refund is processed through Paystack.', '/orders');
  elsif p_status in ('failed', 'needs_attention') and v_previous not in ('failed', 'needs_attention') then
    select buyer_id into v_buyer_id from public.bale_bookings where id = v_refund.booking_id;
    insert into public.notifications (profile_id, title, body, href)
    values (v_buyer_id, 'Split refund needs attention', coalesce(p_error, 'The split refund needs a manual follow-up.'), '/orders');
  end if;
  return jsonb_build_object('status', p_status, 'refund_id', p_refund_id, 'previous_status', v_previous);
end;
$$;

revoke all on function public.claim_vendor_payout(uuid, boolean) from public, anon, authenticated;
revoke all on function public.rotate_vendor_payout_reference(uuid) from public, anon, authenticated;
revoke all on function public.complete_vendor_payout(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_order_refund(uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_order_refund(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_bale_refund(uuid) from public, anon, authenticated;
revoke all on function public.settle_bale_refund(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_vendor_payout(uuid, boolean) to service_role;
grant execute on function public.rotate_vendor_payout_reference(uuid) to service_role;
grant execute on function public.complete_vendor_payout(uuid, text, text, text) to service_role;
grant execute on function public.claim_order_refund(uuid, uuid) to service_role;
grant execute on function public.settle_order_refund(uuid, text, text, text) to service_role;
grant execute on function public.claim_bale_refund(uuid) to service_role;
grant execute on function public.settle_bale_refund(uuid, text, text, text) to service_role;

-- Realtime state is useful for admin/vendor reconciliation screens.
alter table public.vendor_payouts replica identity full;
alter table public.order_refunds replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.vendor_payouts;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.order_refunds;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.bale_refunds;
exception when duplicate_object then null;
end $$;
