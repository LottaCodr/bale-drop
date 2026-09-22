-- Never apply a provider result to a newer payout attempt. Reconciliation
-- always settles only when the stored reference still equals the verified one.
create or replace function public.complete_vendor_payout_checked(
  p_payout_id uuid,
  p_expected_reference text,
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
begin
  select * into v_payout from public.vendor_payouts where id = p_payout_id for update;
  if not found then raise exception 'payout not found'; end if;
  if v_payout.status = 'paid' then
    return jsonb_build_object('status', 'paid', 'duplicate', true, 'payout_id', p_payout_id);
  end if;
  if v_payout.paystack_transfer_reference is distinct from p_expected_reference then
    return jsonb_build_object('status', v_payout.status, 'conflict', true, 'transfer_reference', v_payout.paystack_transfer_reference);
  end if;
  return public.complete_vendor_payout(p_payout_id, p_status, p_transfer_code, p_error);
end;
$$;

revoke all on function public.complete_vendor_payout_checked(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_vendor_payout_checked(uuid, text, text, text, text) to service_role;
