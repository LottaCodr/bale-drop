-- A forced payout reconciliation may verify the existing Paystack reference,
-- but it must not create a second transfer while another attempt is in flight.
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
  if v_payout.status = 'processing' then
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

revoke all on function public.claim_vendor_payout(uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_vendor_payout(uuid, boolean) to service_role;
