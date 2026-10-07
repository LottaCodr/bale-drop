-- ============================================================================
-- Bale Drop — Bale Split lifecycle: creation, fulfilment and settlement.
-- Apply after 0021_auth_profile_onboarding.sql.
--
-- Before this migration a split could only exist as seed data: nothing in the
-- product could create a `bale_listings` row, and a split that filled moved to
-- `processing` and stopped there. Slot money was captured with no `vendor_id`
-- on the ledger row and `vendor_payouts` was keyed on `order_id` only, so a
-- filled split could never be paid out. This closes both ends:
--
--   1. `create_bale_split()`  — vendor-owned, transactional, validated.
--   2. `fulfil_bale_split()`  — fills the ledger, queues the payout, notifies.
--   3. `cancel_bale_split()`  — vendor cancels an unpaid split cleanly.
--
-- Money rules respected (docs/ENGINEERING-STANDARDS.md §4): every movement
-- writes a `transactions` row, payouts go through the existing claim/complete
-- state machine, and nothing here is callable by a client that does not own the
-- listing.
-- ============================================================================

-- ---------- schema ----------

alter table public.bale_listings
  add column if not exists fulfilled_at timestamptz,
  add column if not exists handover_note text;

alter table public.vendor_payouts
  add column if not exists bale_id uuid references public.bale_listings (id);

alter table public.transactions
  add column if not exists bale_id uuid references public.bale_listings (id);

create unique index if not exists vendor_payouts_bale_unique
  on public.vendor_payouts (bale_id)
  where bale_id is not null;

create index if not exists transactions_bale_idx
  on public.transactions (bale_id);

-- One split window per product at a time. `bale_listings.product_id` is unique
-- in 0001, so a product's split row is *reused* after it reaches a terminal
-- state instead of inserting a second row.
create index if not exists bale_listings_product_status_idx
  on public.bale_listings (product_id, status);

-- ---------- commission helper ----------

-- Single source of truth for the take rate. `confirm_order_delivery` and
-- `release_disputed_order_to_vendor` (0005) inline the same numbers; new code
-- calls this so the rate can change in one place.
create or replace function public.commission_rate_for_vendor(p_vendor_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when vp.subscription_plan = 'pro' then 0.04 else 0.07 end
  from public.vendor_profiles vp
  where vp.id = p_vendor_id;
$$;

revoke all on function public.commission_rate_for_vendor(uuid) from public, anon;
grant execute on function public.commission_rate_for_vendor(uuid) to authenticated, service_role;

-- ============================================================================
-- create_bale_split — vendor opens (or re-opens) a split on their own listing.
-- Callable by the owning vendor only; the product must be live and a bale.
-- ============================================================================
create or replace function public.create_bale_split(
  p_product_id uuid,
  p_split_count int,
  p_price_per_slot_naira int,
  p_expires_hours int default 72
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendor public.vendor_profiles%rowtype;
  v_product public.products%rowtype;
  v_existing public.bale_listings%rowtype;
  v_total int;
  v_expires timestamptz;
  v_bale_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_split_count is null or p_split_count < 2 or p_split_count > 50 then
    raise exception 'a split needs between 2 and 50 slots';
  end if;
  if p_price_per_slot_naira is null or p_price_per_slot_naira < 100 then
    raise exception 'price per slot must be at least 100 naira';
  end if;
  if p_expires_hours is null or p_expires_hours < 1 or p_expires_hours > 336 then
    raise exception 'the deadline must be between 1 hour and 14 days away';
  end if;

  select * into v_vendor from public.vendor_profiles
  where profile_id = auth.uid() for update;
  if not found then raise exception 'seller profile not found'; end if;
  if v_vendor.verification_status not in ('approved', 'inspected') then
    raise exception 'your seller account must be approved before opening a split';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'listing not found'; end if;
  if v_product.vendor_id <> v_vendor.id then
    raise exception 'you do not own this listing';
  end if;
  if v_product.status <> 'active' then
    raise exception 'the listing must be live before it can be split';
  end if;
  if v_product.kind <> 'bale' then
    raise exception 'only full bales can be split into slots';
  end if;

  v_total := p_split_count * p_price_per_slot_naira;
  if v_total > 100000000 then
    raise exception 'split total is too large';
  end if;
  v_expires := date_trunc('second', now() + make_interval(hours => p_expires_hours));

  select * into v_existing from public.bale_listings where product_id = p_product_id for update;
  if found then
    if v_existing.status in ('open', 'full', 'processing') then
      raise exception 'this listing already has a live split';
    end if;
    if exists (
      select 1 from public.bale_bookings
      where bale_id = v_existing.id and status in ('pending', 'paid')
    ) then
      raise exception 'settle or refund the previous split before opening a new one';
    end if;
    -- Terminal row (expired / cancelled / fulfilled): reuse it. product_id is
    -- unique, so a second split on the same listing is an update, not an insert.
    update public.bale_listings
    set total_naira = v_total,
        split_count = p_split_count,
        price_per_slot_naira = p_price_per_slot_naira,
        booked_count = 0,
        expires_at = v_expires,
        status = 'open',
        fulfilled_at = null,
        handover_note = null,
        updated_at = now()
    where id = v_existing.id
    returning id into v_bale_id;
  else
    insert into public.bale_listings (
      product_id, total_naira, split_count, price_per_slot_naira,
      booked_count, expires_at, status
    ) values (
      p_product_id, v_total, p_split_count, p_price_per_slot_naira,
      0, v_expires, 'open'
    )
    returning id into v_bale_id;
  end if;

  insert into public.notifications (profile_id, title, body, href)
  values (
    v_vendor.profile_id,
    'Split is live',
    format('%s slots at %s naira each. Buyers can claim until the deadline.',
           p_split_count, p_price_per_slot_naira),
    '/vendor'
  );

  return jsonb_build_object(
    'bale_id', v_bale_id,
    'product_id', p_product_id,
    'split_count', p_split_count,
    'price_per_slot_naira', p_price_per_slot_naira,
    'total_naira', v_total,
    'expires_at', v_expires,
    'status', 'open'
  );
end;
$$;

revoke all on function public.create_bale_split(uuid, int, int, int) from public, anon;
grant execute on function public.create_bale_split(uuid, int, int, int) to authenticated;

-- ============================================================================
-- cancel_bale_split — vendor pulls an unfilled split. Only legal while no slot
-- has been paid; paid slots must go through the refund state machine.
-- ============================================================================
create or replace function public.cancel_bale_split(p_bale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bale public.bale_listings%rowtype;
  v_vendor public.vendor_profiles%rowtype;
  v_released int := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_bale from public.bale_listings where id = p_bale_id for update;
  if not found then raise exception 'split not found'; end if;
  select * into v_vendor from public.vendor_profiles vp
  join public.products p on p.id = v_bale.product_id
  where vp.id = p.vendor_id and vp.profile_id = auth.uid() for update of vp;
  if not found then raise exception 'you do not own this split'; end if;
  if v_bale.status in ('fulfilled', 'cancelled', 'expired') then
    return jsonb_build_object('bale_id', v_bale.id, 'status', v_bale.status, 'duplicate', true);
  end if;
  if exists (select 1 from public.bale_bookings where bale_id = v_bale.id and status = 'paid') then
    raise exception 'paid slots must be refunded, not cancelled — contact support';
  end if;

  update public.bale_bookings
  set status = 'cancelled', updated_at = now()
  where bale_id = v_bale.id and status = 'pending';
  get diagnostics v_released = row_count;

  update public.bale_listings
  set status = 'cancelled', booked_count = 0, updated_at = now()
  where id = v_bale.id;

  return jsonb_build_object(
    'bale_id', v_bale.id, 'status', 'cancelled', 'released_reservations', v_released
  );
end;
$$;

revoke all on function public.cancel_bale_split(uuid) from public, anon, authenticated;
grant execute on function public.cancel_bale_split(uuid) to service_role;

-- ============================================================================
-- fulfil_bale_split — the settlement step that was missing.
-- Called by the `split-action` Edge Function once the owning vendor confirms
-- the bale has been handed over. It:
--   * refuses unless every slot is paid (no partial settlement),
--   * attributes the historical slot `pay_in` ledger rows to the vendor,
--   * writes the commission row and queues a payout keyed on the bale,
--   * moves the listing to `fulfilled` and tells every participant.
-- The payout then travels the same claim/verify/complete state machine as an
-- order payout (`vendor-payout` + `payout-reconcile`), so no money path forks.
-- ============================================================================
create or replace function public.fulfil_bale_split(
  p_bale_id uuid,
  p_vendor_profile_id uuid,
  p_handover_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bale public.bale_listings%rowtype;
  v_vendor public.vendor_profiles%rowtype;
  v_gross int;
  v_paid_slots int;
  v_pending_slots int;
  v_rate numeric;
  v_commission int;
  v_payout_id uuid;
begin
  select * into v_bale from public.bale_listings where id = p_bale_id for update;
  if not found then raise exception 'split not found'; end if;
  if v_bale.status = 'fulfilled' then
    return jsonb_build_object('bale_id', v_bale.id, 'status', 'fulfilled', 'duplicate', true);
  end if;
  if v_bale.status not in ('full', 'processing') then
    raise exception 'only a filled split can be fulfilled (current: %)', v_bale.status;
  end if;

  select * into v_vendor from public.vendor_profiles
  where id = p_vendor_profile_id for update;
  if not found then raise exception 'vendor not found'; end if;
  if not exists (
    select 1 from public.products p
    where p.id = v_bale.product_id and p.vendor_id = v_vendor.id
  ) then
    raise exception 'vendor does not own this split';
  end if;

  select count(*), coalesce(sum(amount_naira), 0)
  into v_paid_slots, v_gross
  from public.bale_bookings
  where bale_id = v_bale.id and status = 'paid';

  select count(*) into v_pending_slots
  from public.bale_bookings
  where bale_id = v_bale.id and status = 'pending';

  if v_pending_slots > 0 then
    raise exception '% slot reservation(s) are still pending — wait for payment or expiry', v_pending_slots;
  end if;
  if v_paid_slots < v_bale.split_count then
    raise exception 'only % of % slots are paid', v_paid_slots, v_bale.split_count;
  end if;

  v_rate := public.commission_rate_for_vendor(v_vendor.id);
  if v_rate is null then v_rate := 0.07; end if;
  v_commission := round(v_gross * v_rate);

  -- Attribute the slot pay-ins to the vendor and the bale. They were written by
  -- `finalize_payment_session` with only `bale_booking_id` set.
  update public.transactions
  set vendor_id = v_vendor.id, bale_id = v_bale.id
  where kind = 'pay_in'
    and vendor_id is null
    and bale_booking_id in (
      select id from public.bale_bookings where bale_id = v_bale.id and status = 'paid'
    );

  insert into public.vendor_payouts (
    vendor_id, bale_id, gross_naira, commission_naira, net_naira, status
  ) values (
    v_vendor.id, v_bale.id, v_gross, v_commission,
    greatest(0, v_gross - v_commission), 'pending'
  )
  on conflict do nothing
  returning id into v_payout_id;

  if v_commission > 0 then
    insert into public.transactions (
      kind, amount_naira, bale_id, vendor_id, meta
    ) values (
      'commission', v_commission, v_bale.id, v_vendor.id,
      jsonb_build_object('rate', v_rate, 'source', 'split_fulfilment', 'slots', v_paid_slots)
    ) on conflict do nothing;
  end if;

  update public.bale_listings
  set status = 'fulfilled',
      fulfilled_at = now(),
      handover_note = nullif(trim(coalesce(p_handover_note, '')), ''),
      updated_at = now()
  where id = v_bale.id;

  insert into public.notifications (profile_id, title, body, href)
  values (
    v_vendor.profile_id,
    'Split settled — payout queued',
    format('All %s slots were paid. %s naira is queued for transfer.',
           v_paid_slots, greatest(0, v_gross - v_commission)),
    '/vendor'
  );

  insert into public.notifications (profile_id, title, body, href)
  select bb.buyer_id,
         'Split complete',
         coalesce(
           nullif(trim(coalesce(p_handover_note, '')), ''),
           'Every slot was claimed and the bale has been handed over. Thanks for splitting with us.'
         ),
         '/orders'
  from public.bale_bookings bb
  where bb.bale_id = v_bale.id and bb.status = 'paid';

  return jsonb_build_object(
    'bale_id', v_bale.id,
    'status', 'fulfilled',
    'gross_naira', v_gross,
    'commission_naira', v_commission,
    'net_naira', greatest(0, v_gross - v_commission),
    'payout_id', v_payout_id,
    'slots', v_paid_slots
  );
end;
$$;

revoke all on function public.fulfil_bale_split(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fulfil_bale_split(uuid, uuid, text) to service_role;

-- ============================================================================
-- complete_vendor_payout — redefined to carry the bale dimension.
-- Identical semantics to 0008 (transaction + notification only on the
-- transition into `paid`); the payout ledger row now records `bale_id` so a
-- split settlement is traceable to the split, not just to the vendor.
-- ============================================================================
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
    insert into public.transactions (kind, amount_naira, order_id, bale_id, vendor_id, paystack_reference, meta)
    values ('payout', v_payout.net_naira, v_payout.order_id, v_payout.bale_id, v_payout.vendor_id,
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

revoke all on function public.complete_vendor_payout(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_vendor_payout(uuid, text, text, text) to service_role;

-- ---------- realtime ----------
-- The vendor dashboard and admin money queues subscribe to payout changes.
alter table public.vendor_payouts replica identity full;
