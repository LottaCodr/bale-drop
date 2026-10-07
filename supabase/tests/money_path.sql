-- ============================================================================
-- Bale Drop — money-path scenario test (database level).
--
-- Runs against a real PostgreSQL with the Supabase surface stubbed
-- (see scripts/check-migrations.py). Everything happens inside one transaction
-- that is rolled back, so the scenario is repeatable and leaves no trace.
--
-- What it proves, in order:
--   1. a vendor can open a split, and only on their own live bale;
--   2. slots are claimed transactionally and the split fills;
--   3. the signed-webhook finalizer marks bookings paid and writes pay-ins;
--   4. fulfilment attributes the pay-ins to the vendor, takes commission and
--      queues a payout keyed on the bale — the settlement path that was missing;
--   5. completing the payout writes exactly one `payout` ledger row;
--   6. an order marked delivered starts the 48 h window *without* moving money;
--   7. the cron releases due escrow once, and the buyer can release it early;
--   8. sold_count / rating_avg / views counters are maintained by triggers;
--   9. full-text + synonym search ranks and paginates;
--  10. promo codes are reserved, capped per buyer and released on abandonment;
--  11. sellers can pause/resume/resubmit but never self-approve.
--
-- Assertions raise; a green run prints `PASS:` notices and ends in ROLLBACK.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- fixtures --

insert into auth.users (id, instance_id, email)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'vendor@test.local'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'buyera@test.local'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'buyerb@test.local'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'admin@test.local')
on conflict (id) do nothing;

insert into public.profiles (id, role, full_name, phone, city)
values
  ('11111111-1111-1111-1111-111111111111', 'vendor', 'Vendor One', '+2348030000001', 'Lagos'),
  ('22222222-2222-2222-2222-222222222222', 'buyer', 'Buyer Ay', '+2348030000002', 'Lagos'),
  ('33333333-3333-3333-3333-333333333333', 'buyer', 'Buyer Bee', '+2348030000003', 'Kano'),
  ('44444444-4444-4444-4444-444444444444', 'admin', 'Admin See', '+2348030000004', 'Abuja')
on conflict (id) do nothing;

insert into public.vendor_profiles (id, profile_id, shop_name, city, verification_status, subscription_plan, subscription_status)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'Test Thrift Co.', 'Lagos', 'approved', 'starter', 'active')
on conflict (id) do nothing;

insert into public.products (id, vendor_id, title, description, category, grade, kind, price_naira, qty, city, status, pieces_estimate)
values
  ('55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
   'Grade A vintage denim jackets bale', 'Forty clean denim jackets, mixed sizes.',
   'Bales', 'A', 'bale', 100000, 5, 'Lagos', 'active', '~40 pcs'),
  ('55555555-5555-5555-5555-555555555556', '66666666-6666-6666-6666-666666666666',
   'Single leather office shoe', 'One pair, size 43.',
   'Shoes', 'B', 'single', 9000, 3, 'Lagos', 'active', null)
on conflict (id) do nothing;

-- --------------------------------------------------- 1. open a split -------

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare
  v jsonb;
  v_split_count int;
begin
  v := public.create_bale_split('55555555-5555-5555-5555-555555555555', 2, 50000, 24);
  if v->>'status' <> 'open' then raise exception 'expected open split, got %', v; end if;
  if (v->>'total_naira')::int <> 100000 then raise exception 'total should be slots * price: %', v; end if;
  select split_count into v_split_count from public.bale_listings where id = (v->>'bale_id')::uuid;
  if v_split_count <> 2 then raise exception 'split_count not persisted'; end if;
  raise notice 'PASS: vendor opens a split on their own live bale';
end $$;

-- a single piece cannot be split
do $$
begin
  perform public.create_bale_split('55555555-5555-5555-5555-555555555556', 2, 4500, 24);
  raise exception 'expected a single piece to be rejected';
exception when others then
  if sqlerrm like '%only full bales%' then
    raise notice 'PASS: singles cannot be split';
  else
    raise;
  end if;
end $$;

-- a second live split on the same listing is refused
do $$
begin
  perform public.create_bale_split('55555555-5555-5555-5555-555555555555', 4, 25000, 24);
  raise exception 'expected a duplicate live split to be refused';
exception when others then
  if sqlerrm like '%already has a live split%' then
    raise notice 'PASS: one live split per listing';
  else
    raise;
  end if;
end $$;

-- another vendor cannot split someone else's listing
do $$
begin
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
  perform public.create_bale_split('55555555-5555-5555-5555-555555555555', 2, 50000, 24);
  raise exception 'expected a non-owner to be refused';
exception when others then
  if sqlerrm like '%seller profile not found%' or sqlerrm like '%do not own%' then
    raise notice 'PASS: only the owning, approved vendor can open a split';
  else
    raise;
  end if;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- ------------------------------------------------- 2. claim both slots -----

do $$
declare
  v_bale uuid;
  v jsonb;
begin
  select id into v_bale from public.bale_listings where product_id = '55555555-5555-5555-5555-555555555555';

  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
  v := public.claim_bale_slot(v_bale);
  if (v->>'booked_count')::int <> 1 or v->>'status' <> 'open' then
    raise exception 'first claim should leave the split open: %', v;
  end if;

  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
  v := public.claim_bale_slot(v_bale);
  if (v->>'booked_count')::int <> 2 or v->>'status' <> 'full' then
    raise exception 'second claim should fill the split: %', v;
  end if;
  raise notice 'PASS: slots are claimed transactionally and the split fills';
end $$;

-- ------------------------------------- 3. webhook finalizer marks paid -----

set role service_role;

do $$
declare
  v_bale uuid;
  v_booking uuid;
  v_ref text;
  v jsonb;
  v_paid int;
begin
  select id into v_bale from public.bale_listings where product_id = '55555555-5555-5555-5555-555555555555';

  for v_booking, v_ref in
    select bb.id, 'test-slot-' || bb.buyer_id
    from public.bale_bookings bb
    where bb.bale_id = v_bale and bb.status = 'pending'
  loop
    insert into public.payment_sessions (buyer_id, reference, kind, amount_naira, booking_id, status)
    select bb.buyer_id, v_ref, 'slot', bb.amount_naira, bb.id, 'pending'
    from public.bale_bookings bb where bb.id = v_booking;

    v := public.finalize_payment_session(v_ref, 50000, 'txn-test', 'card', 'Approved', '{}'::jsonb);
    if v->>'status' <> 'success' then raise exception 'slot finalize failed: %', v; end if;
  end loop;

  select count(*) into v_paid from public.bale_bookings where bale_id = v_bale and status = 'paid';
  if v_paid <> 2 then raise exception 'expected 2 paid slots, got %', v_paid; end if;

  perform 1 from public.bale_listings where id = v_bale and status = 'processing';
  if not found then raise exception 'a fully paid split must move to processing'; end if;

  if (select count(*) from public.transactions where bale_booking_id is not null and kind = 'pay_in') <> 2 then
    raise exception 'each paid slot needs a pay_in ledger row';
  end if;
  raise notice 'PASS: webhook finalizer marks slots paid and writes pay-ins';
end $$;

-- the finalizer is idempotent on replay
do $$
declare v jsonb;
begin
  v := public.finalize_payment_session('test-slot-22222222-2222-2222-2222-222222222222', 50000, 'txn-test', 'card', 'Approved', '{}'::jsonb);
  if v->>'status' <> 'duplicate' then raise exception 'replay must be a no-op: %', v; end if;
  raise notice 'PASS: replayed webhook does not double-count';
end $$;

-- ------------------------------- 4. fulfilment settles the split money -----

do $$
declare
  v_bale uuid;
  v jsonb;
  v_payout uuid;
  v_unattributed int;
begin
  select id into v_bale from public.bale_listings where product_id = '55555555-5555-5555-5555-555555555555';
  v := public.fulfil_bale_split(v_bale, '66666666-6666-6666-6666-666666666666', 'Handed over at Yaba on Saturday.');

  if v->>'status' <> 'fulfilled' then raise exception 'split should be fulfilled: %', v; end if;
  if (v->>'gross_naira')::int <> 100000 then raise exception 'gross should be the sum of paid slots: %', v; end if;
  -- starter plan = 7%
  if (v->>'commission_naira')::int <> 7000 then raise exception 'commission should be 7%%: %', v; end if;
  if (v->>'net_naira')::int <> 93000 then raise exception 'net should be gross - commission: %', v; end if;

  select id into v_payout from public.vendor_payouts where bale_id = v_bale;
  if v_payout is null then raise exception 'fulfilment must queue a payout keyed on the bale'; end if;

  select count(*) into v_unattributed
  from public.transactions
  where kind = 'pay_in' and bale_booking_id is not null and vendor_id is null;
  if v_unattributed <> 0 then raise exception 'slot pay-ins must be attributed to the vendor'; end if;

  perform 1 from public.transactions where kind = 'commission' and bale_id = v_bale and amount_naira = 7000;
  if not found then raise exception 'commission ledger row missing'; end if;

  -- fulfilling twice must not create a second payout
  v := public.fulfil_bale_split(v_bale, '66666666-6666-6666-6666-666666666666', null);
  if v->>'duplicate' <> 'true' then raise exception 'second fulfilment must be a no-op: %', v; end if;
  if (select count(*) from public.vendor_payouts where bale_id = v_bale) <> 1 then
    raise exception 'exactly one payout per split';
  end if;

  raise notice 'PASS: a filled split settles — ledger attributed, commission taken, payout queued';
end $$;

-- -------------------------------------- 5. payout completion writes once ---

do $$
declare
  v_bale uuid;
  v_payout uuid;
  v jsonb;
begin
  select id into v_bale from public.bale_listings where product_id = '55555555-5555-5555-5555-555555555555';
  select id into v_payout from public.vendor_payouts where bale_id = v_bale;

  v := public.claim_vendor_payout(v_payout, false);
  if v->>'claimed' <> 'true' then raise exception 'payout should be claimable: %', v; end if;

  v := public.complete_vendor_payout(v_payout, 'paid', 'TRF_TEST_1', null);
  if v->>'status' <> 'paid' then raise exception 'payout should complete: %', v; end if;

  v := public.complete_vendor_payout(v_payout, 'paid', 'TRF_TEST_1', null);
  if v->>'duplicate' <> 'true' then raise exception 'second completion must be a no-op: %', v; end if;

  if (select count(*) from public.transactions where kind = 'payout' and bale_id = v_bale) <> 1 then
    raise exception 'exactly one payout ledger row, carrying the bale id';
  end if;
  raise notice 'PASS: split payout completes once and is traceable to the split';
end $$;

-- --------------------------- 6/7. delivered starts the window, cron ends it -

do $$
declare
  v_order uuid;
  v jsonb;
  v_release timestamptz;
begin
  insert into public.orders (buyer_id, vendor_id, status, escrow_status, subtotal_naira, delivery_fee_naira, subsidy_naira, total_naira)
  values ('22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666', 'pending_payment', 'none', 9000, 2500, 0, 11500)
  returning id into v_order;

  insert into public.order_items (order_id, product_id, title_snapshot, qty, unit_naira)
  values (v_order, '55555555-5555-5555-5555-555555555556', 'Single leather office shoe', 1, 9000);

  insert into public.payment_sessions (buyer_id, reference, kind, amount_naira, order_ids, status)
  values ('22222222-2222-2222-2222-222222222222', 'test-order-1', 'order_batch', 11500, array[v_order], 'pending');

  v := public.finalize_payment_session('test-order-1', 11500, 'txn-order-1', 'card', 'Approved', '{}'::jsonb);
  if v->>'status' <> 'success' then raise exception 'order finalize failed: %', v; end if;

  perform 1 from public.orders where id = v_order and status = 'paid' and escrow_status = 'held';
  if not found then raise exception 'order should be paid with escrow held'; end if;

  -- counters: sold_count is maintained by the paid trigger (0024)
  perform 1 from public.products where id = '55555555-5555-5555-5555-555555555556' and sold_count = 1;
  if not found then raise exception 'sold_count should increment when an order is paid'; end if;
  perform 1 from public.vendor_profiles where id = '66666666-6666-6666-6666-666666666666' and sales_count = 1;
  if not found then raise exception 'vendor sales_count should increment when an order is paid'; end if;

  -- dispatch, then courier delivery
  v := public.set_order_fulfillment_status(v_order, '66666666-6666-6666-6666-666666666666', 'in_transit', 'BDX-123', 'https://track.example/BDX-123');
  if v->>'status' <> 'in_transit' then raise exception 'dispatch failed: %', v; end if;

  v := public.set_order_fulfillment_status(v_order, '66666666-6666-6666-6666-666666666666', 'delivered', null, null);
  if v->>'status' <> 'delivered' then raise exception 'delivery should be recordable: %', v; end if;
  if v->>'escrow_status' <> 'held' then raise exception 'delivery alone must not release escrow: %', v; end if;

  select escrow_release_at into v_release from public.orders where id = v_order;
  if v_release is null or v_release < now() + interval '47 hours' or v_release > now() + interval '49 hours' then
    raise exception 'release window should be ~48h out, got %', v_release;
  end if;
  raise notice 'PASS: delivery starts the 48h escrow window without moving money';

  -- not due yet: the cron must leave it alone
  v := public.release_due_escrows(50);
  if (v->>'released')::int <> 0 then raise exception 'nothing is due yet: %', v; end if;

  -- age the window out and release
  update public.orders set escrow_release_at = now() - interval '1 minute' where id = v_order;
  v := public.release_due_escrows(50);
  if (v->>'released')::int <> 1 then raise exception 'the due escrow should have been released: %', v; end if;

  perform 1 from public.orders where id = v_order and escrow_status = 'released';
  if not found then raise exception 'escrow should be released'; end if;
  perform 1 from public.vendor_payouts where order_id = v_order and net_naira = 9000 - 630;
  if not found then raise exception 'auto-release must queue the vendor payout net of commission'; end if;

  -- and it must not release twice
  update public.orders set escrow_release_at = now() - interval '1 minute' where id = v_order;
  v := public.release_due_escrows(50);
  if (v->>'released')::int <> 0 then raise exception 'a released order must not be released again: %', v; end if;
  raise notice 'PASS: escrow auto-releases once, 48h after delivery, and pays the vendor';
end $$;

-- an open dispute blocks auto-release
do $$
declare
  v_order uuid;
  v jsonb;
begin
  insert into public.orders (buyer_id, vendor_id, status, escrow_status, subtotal_naira, delivery_fee_naira, subsidy_naira, total_naira)
  values ('33333333-3333-3333-3333-333333333333', '66666666-6666-6666-6666-666666666666', 'pending_payment', 'none', 9000, 2500, 0, 11500)
  returning id into v_order;
  insert into public.order_items (order_id, product_id, title_snapshot, qty, unit_naira)
  values (v_order, '55555555-5555-5555-5555-555555555556', 'Single leather office shoe', 1, 9000);
  insert into public.payment_sessions (buyer_id, reference, kind, amount_naira, order_ids, status)
  values ('33333333-3333-3333-3333-333333333333', 'test-order-2', 'order_batch', 11500, array[v_order], 'pending');
  perform public.finalize_payment_session('test-order-2', 11500, 'txn-order-2', 'card', 'Approved', '{}'::jsonb);

  update public.orders set status = 'in_transit' where id = v_order;
  insert into public.disputes (order_id, buyer_id, reason, description, status)
  values (v_order, '33333333-3333-3333-3333-333333333333', 'Damaged or incomplete', 'Sole was split.', 'open');
  update public.orders set status = 'delivered', delivered_at = now(), escrow_release_at = now() - interval '1 hour' where id = v_order;

  v := public.release_due_escrows(50);
  if (v->>'released')::int <> 0 then raise exception 'a disputed order must not auto-release: %', v; end if;
  perform 1 from public.orders where id = v_order and escrow_status = 'held';
  if not found then raise exception 'disputed escrow should still be held'; end if;
  raise notice 'PASS: an open dispute freezes the auto-release';
end $$;

-- the buyer can release early by confirming
do $$
declare
  v_order uuid;
  v jsonb;
begin
  select id into v_order from public.orders
  where buyer_id = '33333333-3333-3333-3333-333333333333' and status = 'delivered';

  -- resolve the dispute in the vendor's favour first (the RPC insists)
  update public.disputes set status = 'resolved_vendor' where order_id = v_order;
  v := public.confirm_order_delivery(v_order, '33333333-3333-3333-3333-333333333333');
  if v->>'escrow_status' <> 'released' then raise exception 'buyer confirmation should release: %', v; end if;
  if v->>'confirmed_by_buyer' <> 'true' then raise exception 'confirmation should be attributed: %', v; end if;
  raise notice 'PASS: the buyer can release escrow before the window closes';
end $$;

-- --------------------------------------------- 8. review counters ----------

do $$
declare v_order uuid;
begin
  select id into v_order from public.orders where buyer_id = '33333333-3333-3333-3333-333333333333';
  v_order := public.create_order_review(v_order, '33333333-3333-3333-3333-333333333333', 4, 'Good pair.', '55555555-5555-5555-5555-555555555556')->>'order_id';

  perform 1 from public.products where id = '55555555-5555-5555-5555-555555555556' and rating_avg = 4.00;
  if not found then raise exception 'product rating_avg should be maintained by the review trigger'; end if;
  perform 1 from public.vendor_profiles where id = '66666666-6666-6666-6666-666666666666' and reviews_count = 1 and rating_avg = 4.00;
  if not found then raise exception 'vendor rating should be maintained'; end if;
  raise notice 'PASS: review counters are maintained by triggers';
end $$;

-- views counter
set role anon;
do $$
declare v jsonb;
begin
  v := public.record_product_view('55555555-5555-5555-5555-555555555556');
  if v->>'recorded' <> 'true' or (v->>'views')::int < 1 then
    raise exception 'a signed-out view should still count: %', v;
  end if;
  raise notice 'PASS: listing views count for signed-out traffic too';
end $$;

-- -------------------------------------------------- 9. search + paging -----

set role anon;

do $$
declare v jsonb;
begin
  -- synonym: "okirika" maps to the whole catalog, "denim" to Vintage/Bales
  v := public.search_products('denim jackets', null, null, null, null, null, null, null, 'relevance', 10, 0);
  if (v->>'total')::int < 1 then raise exception 'full-text search should match the denim bale: %', v; end if;
  if v#>'{rows,0,id}' <> '"55555555-5555-5555-5555-555555555555"' then
    raise exception 'the denim bale should rank first: %', v#>'{rows,0,title}';
  end if;

  -- a query with nothing to do with the catalog returns nothing (no padding)
  v := public.search_products('zzzznothing', null, null, null, null, null, null, null, 'relevance', 10, 0);
  if (v->>'total')::int <> 0 then raise exception 'non-matches must be filtered out: %', v; end if;

  -- synonym pull: "sneakers" has no sneaker listing, but the Shoes synonym does
  v := public.search_products('sneakers', null, null, null, null, null, null, null, 'relevance', 10, 0);
  if (v->>'total')::int <> 1 then raise exception 'synonym should pull the Shoes listing: %', v; end if;

  -- pagination: one row per page, exact total, stable ordering
  v := public.search_products(null, null, null, null, null, null, null, null, 'price_asc', 1, 0);
  if (v->>'total')::int <> 2 or jsonb_array_length(v->'rows') <> 1 then
    raise exception 'page 1 should be one row of two: %', v;
  end if;
  if v#>'{rows,0,price_naira}' <> '9000' then raise exception 'price_asc should start cheapest: %', v; end if;
  v := public.search_products(null, null, null, null, null, null, null, null, 'price_asc', 1, 1);
  if v#>'{rows,0,price_naira}' <> '100000' then raise exception 'page 2 should be the bale: %', v; end if;
  if (v->>'pages')::int <> 2 then raise exception 'pages should be derived from the total: %', v; end if;
  raise notice 'PASS: search ranks by full text + synonyms and paginates with an exact total';
end $$;

-- injection-ish input must not reshape the filter
do $$
declare v jsonb;
begin
  v := public.search_products('denim'') or 1=1 --', null, null, null, null, null, null, null, 'relevance', 10, 0);
  if (v->>'total')::int > 2 then raise exception 'punctuation must not widen the result set: %', v; end if;
  raise notice 'PASS: hostile query text cannot widen the search';
end $$;

-- ------------------------------------------------ 10. promo accounting -----

set role service_role;

insert into public.promo_codes (code, kind, amount_naira, max_uses, used, active)
values ('LAUNCH1500', 'delivery', 1500, 1, 0, true)
on conflict (code) do update set max_uses = 1, used = 0, active = true;

do $$
declare v jsonb; v_order uuid;
begin
  v := public.reserve_promo_code('launch1500', '22222222-2222-2222-2222-222222222222', 'test-promo-1');
  if v->>'valid' <> 'true' or (v->>'amount_naira')::int <> 1500 then
    raise exception 'first redemption should be valid: %', v;
  end if;
  perform 1 from public.promo_codes where code = 'LAUNCH1500' and used = 1;
  if not found then raise exception 'used should be incremented atomically'; end if;

  -- capped: a second buyer cannot take the last redemption
  v := public.reserve_promo_code('LAUNCH1500', '33333333-3333-3333-3333-333333333333', 'test-promo-2');
  if v->>'valid' <> 'false' then raise exception 'max_uses must be enforced: %', v; end if;

  -- the same buyer replaying the same session must not double-count
  v := public.reserve_promo_code('LAUNCH1500', '22222222-2222-2222-2222-222222222222', 'test-promo-1');
  perform 1 from public.promo_codes where code = 'LAUNCH1500' and used = 1;
  if not found then raise exception 'a replay must not burn a second redemption'; end if;

  -- an abandoned session gives the redemption back
  select id into v_order from public.orders
  where buyer_id = '22222222-2222-2222-2222-222222222222' limit 1;
  insert into public.payment_sessions (buyer_id, reference, kind, amount_naira, order_ids, status, meta)
  values ('22222222-2222-2222-2222-222222222222', 'test-promo-1', 'order_batch', 11500, array[v_order], 'pending',
          jsonb_build_object('promo_code', 'LAUNCH1500'));
  update public.payment_sessions set status = 'abandoned' where reference = 'test-promo-1';

  perform 1 from public.promo_codes where code = 'LAUNCH1500' and used = 0;
  if not found then raise exception 'an abandoned session must release the redemption'; end if;
  raise notice 'PASS: promo codes are capped, per-buyer and released on abandonment';
end $$;

-- ---------------------------------------- 11. listing management -----------

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

do $$
declare v jsonb;
begin
  v := public.set_listing_status('55555555-5555-5555-5555-555555555556', 'paused');
  if v->>'status' <> 'paused' then raise exception 'seller should be able to pause: %', v; end if;
  v := public.set_listing_status('55555555-5555-5555-5555-555555555556', 'active');
  if v->>'status' <> 'active' then raise exception 'seller should be able to resume: %', v; end if;
  raise notice 'PASS: sellers can pause and resume a listing';
end $$;

-- a seller cannot self-approve a pending listing
set role service_role;
update public.products set status = 'pending' where id = '55555555-5555-5555-5555-555555555556';
set role authenticated;

do $$
begin
  perform public.set_listing_status('55555555-5555-5555-5555-555555555556', 'active');
  raise exception 'a seller must not be able to self-approve';
exception when others then
  if sqlerrm like '%only a paused listing%' then
    raise notice 'PASS: moderation stays admin-only';
  else
    raise;
  end if;
end $$;

-- a rejected listing can be resubmitted
set role service_role;
update public.products set status = 'rejected' where id = '55555555-5555-5555-5555-555555555556';
set role authenticated;

do $$
declare v jsonb;
begin
  v := public.set_listing_status('55555555-5555-5555-5555-555555555556', 'pending');
  if v->>'status' <> 'pending' then raise exception 'a rejected listing should be resubmittable: %', v; end if;
  raise notice 'PASS: rejected listings can be resubmitted for review';
end $$;

-- RLS: a signed-out visitor sees only active listings
set role anon;
-- Clear the vendor JWT claim first: in production an anon request carries no
-- `sub`, and leaving it set would let the owner-read policy apply.
select set_config('request.jwt.claim.sub', '', false);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.products;
  if v_count <> 1 then
    raise exception 'anon should see exactly the one active listing, saw %', v_count;
  end if;
  raise notice 'PASS: RLS still hides non-active listings from signed-out traffic';
end $$;

rollback;
