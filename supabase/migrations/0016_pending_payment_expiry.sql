-- Expire payment attempts that never received an authorization URL. These
-- rows can otherwise reserve inventory forever after an ambiguous provider
-- response or an Edge runtime crash. Sessions with a URL remain available for
-- the buyer and Paystack webhook reconciliation.
create or replace function public.expire_uninitialized_payment_sessions(
  p_age_minutes int default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_expired int := 0;
  v_errors int := 0;
begin
  if p_age_minutes < 1 then raise exception 'age must be positive'; end if;
  for v_session in
    select id, reference
    from public.payment_sessions
    where status = 'pending'
      and authorization_url is null
      and created_at < now() - make_interval(mins => p_age_minutes)
    order by created_at
    limit 100
    for update skip locked
  loop
    begin
      perform public.cancel_payment_session(
        v_session.reference,
        format('payment session expired without an authorization URL after %s minutes', p_age_minutes)
      );
      v_expired := v_expired + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;
  return jsonb_build_object('expired', v_expired, 'errors', v_errors);
end;
$$;

revoke all on function public.expire_uninitialized_payment_sessions(int) from public, anon, authenticated;
grant execute on function public.expire_uninitialized_payment_sessions(int) to service_role;
