-- Rotate a failed/reversed transfer reference only if the caller verified the
-- exact reference currently stored. This makes retry ownership atomic when
-- several admins reconcile the same payout at once.
create or replace function public.rotate_vendor_payout_reference_checked(
  p_payout_id uuid,
  p_expected_reference text
)
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
  if v_payout.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'duplicate', true, 'claimed', false);
  end if;
  if v_payout.status <> 'processing' or v_payout.paystack_transfer_reference is distinct from p_expected_reference then
    return jsonb_build_object('status', v_payout.status, 'claimed', false, 'transfer_reference', v_payout.paystack_transfer_reference, 'conflict', true);
  end if;

  v_attempt := greatest(v_payout.attempts + 1, 1);
  v_reference := format('bd-payout-%s-%s', v_payout.id, v_attempt);
  update public.vendor_payouts
  set status = 'processing', attempts = v_attempt,
      paystack_transfer_reference = v_reference,
      paystack_transfer_code = null,
      processing_started_at = now(), last_checked_at = now(), last_error = null
  where id = v_payout.id;
  return jsonb_build_object('status', 'processing', 'claimed', true, 'transfer_reference', v_reference, 'attempts', v_attempt);
end;
$$;

revoke all on function public.rotate_vendor_payout_reference_checked(uuid, text) from public, anon, authenticated;
grant execute on function public.rotate_vendor_payout_reference_checked(uuid, text) to service_role;
