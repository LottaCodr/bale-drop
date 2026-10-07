-- ============================================================================
-- Bale Drop — promo code accounting. Apply after 0024.
--
-- `paystack-initialize` read `promo_codes.used` to enforce `max_uses` but
-- nothing ever incremented it, so every cap was decorative and one buyer could
-- replay a code forever. This adds an atomic reserve/release pair owned by the
-- payment session, plus a per-buyer redemption record.
--
-- Reserve happens when the session is created (so concurrent checkouts cannot
-- oversubscribe a capped code); release happens when that session ends up
-- failed/abandoned, so an unpaid attempt does not burn a redemption.
-- ============================================================================

create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  payment_reference text not null,
  amount_naira int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists promo_redemptions_code_buyer_idx
  on public.promo_redemptions (code, profile_id);
create unique index if not exists promo_redemptions_reference_idx
  on public.promo_redemptions (payment_reference);

alter table public.promo_redemptions enable row level security;

create policy "redemptions buyer read" on public.promo_redemptions for select
  using (profile_id = auth.uid());
create policy "redemptions admin read" on public.promo_redemptions for select
  using (public.is_admin());

-- ---------- reserve ----------

create or replace function public.reserve_promo_code(
  p_code text,
  p_profile_id uuid,
  p_payment_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_promo public.promo_codes%rowtype;
  v_amount int;
begin
  if v_code = '' or p_profile_id is null or nullif(trim(p_payment_reference), '') is null then
    return jsonb_build_object('valid', false, 'reason', 'missing input', 'amount_naira', 0);
  end if;

  select * into v_promo from public.promo_codes
  where code = v_code for update;
  if not found or not v_promo.active then
    return jsonb_build_object('valid', false, 'reason', 'unknown code', 'amount_naira', 0);
  end if;
  if v_promo.expires_at is not null and v_promo.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired', 'amount_naira', 0);
  end if;
  if v_promo.max_uses is not null and v_promo.used >= v_promo.max_uses then
    return jsonb_build_object('valid', false, 'reason', 'fully redeemed', 'amount_naira', 0);
  end if;
  if exists (
    select 1 from public.promo_redemptions
    where code = v_code and profile_id = p_profile_id
  ) then
    return jsonb_build_object('valid', false, 'reason', 'already used by this buyer', 'amount_naira', 0);
  end if;

  v_amount := greatest(0, v_promo.amount_naira);

  -- A replayed initialize (same idempotency key → same reference) must not
  -- double-count. Upsert on the reference and only bump `used` on a real insert.
  insert into public.promo_redemptions (code, profile_id, payment_reference, amount_naira)
  values (v_code, p_profile_id, p_payment_reference, v_amount)
  on conflict (payment_reference) do nothing;

  if found then
    update public.promo_codes
    set used = used + 1
    where code = v_code;
  end if;

  return jsonb_build_object(
    'valid', true, 'code', v_code, 'kind', v_promo.kind, 'amount_naira', v_amount
  );
end;
$$;

revoke all on function public.reserve_promo_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_promo_code(text, uuid, text) to service_role;

-- ---------- release ----------

create or replace function public.release_promo_reservation(p_payment_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.promo_redemptions%rowtype;
begin
  select * into v_row from public.promo_redemptions
  where payment_reference = p_payment_reference for update;
  if not found then
    return jsonb_build_object('released', false);
  end if;

  delete from public.promo_redemptions where id = v_row.id;
  update public.promo_codes
  set used = greatest(0, used - 1)
  where code = v_row.code;

  return jsonb_build_object('released', true, 'code', v_row.code);
end;
$$;

revoke all on function public.release_promo_reservation(text) from public, anon, authenticated;
grant execute on function public.release_promo_reservation(text) to service_role;

-- ---------- give the redemption back when a session dies ----------

create or replace function public.handle_payment_session_promo_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('failed', 'abandoned')
     and old.status = 'pending'
     and nullif(trim(coalesce(new.meta ->> 'promo_code', '')), '') is not null then
    perform public.release_promo_reservation(new.reference);
  end if;
  return new;
end;
$$;

drop trigger if exists payment_session_promo_release on public.payment_sessions;
create trigger payment_session_promo_release
  after update on public.payment_sessions
  for each row execute function public.handle_payment_session_promo_release();
