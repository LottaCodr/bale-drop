-- Prevent concurrent Edge workers from creating two provider refunds for one
-- local refund row. The updated_at trigger acts as a short claim lease, a
-- stale processing row is reclaimed only after the provider can be queried.

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

revoke all on function public.claim_order_refund(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_bale_refund(uuid) from public, anon, authenticated;
grant execute on function public.claim_order_refund(uuid, uuid) to service_role;
grant execute on function public.claim_bale_refund(uuid) to service_role;
