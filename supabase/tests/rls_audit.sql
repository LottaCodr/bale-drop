-- ============================================================================
-- Bale Drop — RLS & client-privilege audit (gap #14: "RLS audit run").
--
-- Runs against a real PostgreSQL with the Supabase surface stubbed
-- (scripts/check-migrations.py). The stub deliberately mirrors Supabase's
-- platform default privileges — SELECT/INSERT/UPDATE/DELETE on every public
-- table for `anon` and `authenticated` — so a scenario can only pass because
-- RLS, column grants or a trigger stopped it, never because the stub happened
-- to be stricter than production.
--
-- Everything happens in one transaction that ends in ROLLBACK.
--
-- What it proves:
--   A. the three privilege escalations closed by 0031 stay closed
--      (profiles.role, vendor_profiles.verification_status, products.status
--      and the trigger-owned counters);
--   B. every write the browser legitimately performs still works — an
--      over-tight revoke is a bug too, and it is the one this audit is most
--      likely to catch;
--   C. row isolation: anon sees only published catalogue data, buyers never see
--      each other's rows, vendors never see each other's unpublished rows;
--   D. the money tables stay write-only for service_role;
--   E. the guards hold even if a future bulk GRANT ALL hands table-level
--      UPDATE back to clients (defence in depth).
-- ============================================================================

begin;

-- ---------------------------------------------------------------- fixtures --
-- Distinct UUIDs from money_path.sql so the two scenarios read independently.

insert into auth.users (id, instance_id, email)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'audit-vendor@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'audit-vendor2@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'audit-buyera@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'audit-buyerb@test.local'),
  ('aaaaaaaa-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'audit-admin@test.local')
on conflict (id) do nothing;

-- `handle_new_user()` (0003) already created a row per auth.users insert with
-- role 'buyer', so this must overwrite rather than skip: `is_admin()` reads
-- profiles.role, and the admin section below depends on it being true.
insert into public.profiles (id, role, full_name, phone, city)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'vendor', 'Audit Vendor',  '+2348090000001', 'Lagos'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'vendor', 'Audit Vendor Two', '+2348090000002', 'Kano'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'buyer',  'Audit Buyer Ay', '+2348090000003', 'Lagos'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'buyer',  'Audit Buyer Bee', '+2348090000004', 'Ibadan'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'admin',  'Audit Admin',    '+2348090000005', 'Abuja')
on conflict (id) do update
  set role = excluded.role, full_name = excluded.full_name,
      phone = excluded.phone, city = excluded.city;

insert into public.vendor_profiles (id, profile_id, shop_name, city, verification_status, subscription_plan, subscription_status)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Audit Thrift',   'Lagos', 'approved', 'starter', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Audit Secondhand', 'Kano', 'approved', 'starter', 'active')
on conflict (id) do nothing;

insert into public.products (id, vendor_id, title, description, category, grade, kind, price_naira, qty, city, status)
values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Audit denim bale',   'd', 'Bales', 'A', 'bale',   50000, 3, 'Lagos', 'active'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Audit pending bale', 'd', 'Bales', 'B', 'bale',   40000, 2, 'Lagos', 'pending'),
  ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'Audit rival active', 'd', 'Shoes', 'A', 'single', 12000, 4, 'Kano',  'active'),
  ('cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002', 'Audit rival pending','d', 'Shoes', 'C', 'single',  8000, 1, 'Kano',  'pending')
on conflict (id) do nothing;

insert into public.orders (id, buyer_id, vendor_id, status, escrow_status, subtotal_naira, delivery_fee_naira, total_naira)
values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'delivered', 'held', 50000, 2500, 52500),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'paid',      'held', 40000, 2500, 42500),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'paid',      'none', 12000, 2500, 14500)
on conflict (id) do nothing;

insert into public.transactions (kind, amount_naira, order_id, buyer_id, vendor_id)
values
  ('pay_in', 52500, 'dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('pay_in', 42500, 'dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001');

insert into public.notifications (profile_id, title, body)
values
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Audit notice A', 'body'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Audit notice B', 'body');

insert into public.wishlists (profile_id, product_id)
values ('aaaaaaaa-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001');

insert into public.push_subscriptions (profile_id, endpoint, p256dh_key, auth_key)
values ('aaaaaaaa-0000-0000-0000-000000000003',
        'https://push.example.test/audit-endpoint-0001',
        'p256dh-key-audit-0000000001', 'auth-key-audit-01');

insert into public.support_messages (profile_id, name, email, topic, body)
values
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Audit Buyer', 'audit-buyer-a@test.local', 'order', 'Where is my bale?'),
  (null,                                    'Guest',       'audit-guest@test.local',   'general', 'Do you deliver to Kano?');

insert into public.analytics_events (profile_id, session_id, event_name)
values
  ('aaaaaaaa-0000-0000-0000-000000000003', 'audit-session-a', 'product_view'),
  (null,                                    'audit-session-n', 'product_view');

insert into public.admin_audit_log (admin_id, action, entity_type, entity_id)
values ('aaaaaaaa-0000-0000-0000-000000000005', 'audit_fixture', 'product', 'cccccccc-0000-0000-0000-000000000001');

insert into public.promo_codes (code, kind, amount_naira, max_uses, used, active)
values ('AUDITLIVE', 'delivery_subsidy', 1500, 10, 0, true),
       ('AUDITDEAD', 'delivery_subsidy', 1500, 10, 0, false);

insert into public.addresses (profile_id, label, full_address, city, phone)
values ('aaaaaaaa-0000-0000-0000-000000000003', 'Home', '1 Audit Street', 'Lagos', '+2348090000003');

insert into public.vendor_documents (vendor_id, type, storage_path)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'nin', 'aaaaaaaa-0000-0000-0000-000000000001/nin-audit.png');

insert into public.rate_limits (bucket, hits) values ('audit-bucket', 1);

-- Storage objects. Paths follow the convention the app uploads to:
-- `<uid>/<file>` for catalogue and KYC, `<uid>/<order_id>/<file>` for evidence.
insert into storage.objects (bucket_id, name, owner, metadata)
values
  ('product-images',   'aaaaaaaa-0000-0000-0000-000000000001/audit-bale.png',
   'aaaaaaaa-0000-0000-0000-000000000001', '{"size": 204800, "mimetype": "image/png"}'),
  ('vendor-documents', 'aaaaaaaa-0000-0000-0000-000000000001/nin-audit.png',
   'aaaaaaaa-0000-0000-0000-000000000001', '{"size": 409600, "mimetype": "image/png"}'),
  ('dispute-evidence', 'aaaaaaaa-0000-0000-0000-000000000003/dddddddd-0000-0000-0000-000000000001/proof-a.png',
   'aaaaaaaa-0000-0000-0000-000000000003', '{"size": 102400, "mimetype": "image/png"}'),
  ('dispute-evidence', 'aaaaaaaa-0000-0000-0000-000000000004/dddddddd-0000-0000-0000-000000000002/proof-b.png',
   'aaaaaaaa-0000-0000-0000-000000000004', '{"size": 102400, "mimetype": "image/png"}');

-- =============================================================== A. anon ====

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'anon', false);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.products;
  if v_count <> 2 then
    raise exception 'anon should see exactly the 2 active listings, saw %', v_count;
  end if;

  -- 0031 takes SELECT away entirely rather than relying on RLS to return an
  -- empty set: a signed-out request gets 42501, not a row count of zero.
  begin
    perform count(*) from public.profiles;
    raise exception 'anon can read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.orders;
    raise exception 'anon can read orders';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.transactions;
    raise exception 'anon can read the ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.notifications;
    raise exception 'anon can read notifications';
  exception when insufficient_privilege then null;
  end;

  select count(*) into v_count from public.promo_codes;
  if v_count <> 1 then raise exception 'anon should see only the active promo, saw %', v_count; end if;

  raise notice 'PASS: anon sees published catalogue data only';
end $$;

-- Signed-out analytics and guest support are the two writes anon may perform.
do $$
begin
  insert into public.analytics_events (profile_id, session_id, event_name)
  values (null, 'audit-anon-session', 'search');
  insert into public.support_messages (profile_id, name, email, topic, body)
  values (null, 'Guest Two', 'audit-guest2@test.local', 'general', 'Do you ship to Abuja?');
  raise notice 'PASS: anon can record analytics and open a support thread';
exception when insufficient_privilege then
  raise exception 'anon lost a legitimate write path: %', sqlerrm;
end $$;

do $$
begin
  begin
    insert into public.orders (buyer_id, vendor_id, status, subtotal_naira, delivery_fee_naira, total_naira)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'paid', 1, 1, 2);
    raise exception 'anon inserted an order';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.transactions (kind, amount_naira, buyer_id)
    values ('pay_in', 1, 'aaaaaaaa-0000-0000-0000-000000000003');
    raise exception 'anon inserted a ledger row';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS: anon cannot write orders or the ledger';
end $$;

do $$
begin
  begin
    perform count(*) from public.rate_limits;
    raise exception 'anon read the rate-limit counters';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: abuse counters are not client-readable';
end $$;

-- ======================================================= B. buyer A (own) ====

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.orders;
  if v_count <> 2 then raise exception 'buyer A should see their own 2 orders, saw %', v_count; end if;

  select count(*) into v_count from public.transactions;
  if v_count <> 1 then raise exception 'buyer A should see their own 1 ledger row, saw %', v_count; end if;

  select count(*) into v_count from public.notifications;
  if v_count <> 1 then raise exception 'buyer A should see their own 1 notification, saw %', v_count; end if;

  select count(*) into v_count from public.wishlists;
  if v_count <> 1 then raise exception 'buyer A should see their own wishlist row, saw %', v_count; end if;

  select count(*) into v_count from public.support_messages;
  if v_count <> 1 then raise exception 'buyer A should see only their own thread, saw %', v_count; end if;

  select count(*) into v_count from public.push_subscriptions;
  if v_count <> 1 then raise exception 'buyer A should see their own device, saw %', v_count; end if;

  select count(*) into v_count from public.admin_audit_log;
  if v_count <> 0 then raise exception 'buyer A must not read the admin audit log, saw %', v_count; end if;

  select count(*) into v_count from public.analytics_events;
  if v_count <> 0 then raise exception 'analytics is admin-read only, buyer saw %', v_count; end if;

  raise notice 'PASS: a buyer reads exactly their own rows, and no admin surface';
end $$;

-- Legitimate buyer writes: profile fields, address book, notification read
-- state, wishlist (including the upsert the browser performs), push device.
do $$
declare v_rows int;
begin
  update public.profiles set full_name = 'Audit Buyer Ay (edited)', city = 'Lagos'
   where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'buyer could not edit their own profile (% rows)', v_rows; end if;

  update public.notifications set read_at = now()
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'buyer could not mark their notification read (% rows)', v_rows; end if;

  insert into public.addresses (profile_id, label, full_address, city, phone)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'Work', '2 Audit Road', 'Lagos', '+2348090000003');
  update public.addresses set is_default = true
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003' and label = 'Work';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'buyer could not manage their address book (% rows)', v_rows; end if;
  delete from public.addresses
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003' and label = 'Work';

  -- The browser saves a favourite with upsert(onConflict: profile_id,product_id),
  -- which needs INSERT *and* UPDATE plus an RLS update policy.
  insert into public.wishlists (profile_id, product_id)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001')
  on conflict (profile_id, product_id) do nothing;
  insert into public.wishlists (profile_id, product_id)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003')
  on conflict (profile_id, product_id) do nothing;
  delete from public.wishlists
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000003'
     and product_id = 'cccccccc-0000-0000-0000-000000000003';

  -- Push re-subscription is an upsert on the endpoint (keys rotate).
  insert into public.push_subscriptions (profile_id, endpoint, p256dh_key, auth_key)
  values ('aaaaaaaa-0000-0000-0000-000000000003',
          'https://push.example.test/audit-endpoint-0001',
          'p256dh-key-audit-rotated-01', 'auth-key-audit-02')
  on conflict (endpoint) do update
     set p256dh_key = excluded.p256dh_key, auth_key = excluded.auth_key;

  insert into public.analytics_events (profile_id, session_id, event_name)
  values ('aaaaaaaa-0000-0000-0000-000000000003', 'audit-session-a', 'add_to_cart');

  raise notice 'PASS: every legitimate buyer write still works';
exception when insufficient_privilege then
  raise exception 'a legitimate buyer write was revoked: %', sqlerrm;
end $$;

-- =================================================== C. buyer A vs buyer B ===

do $$
declare v_count int;
begin
  select count(*) into v_count from public.orders
   where id = 'dddddddd-0000-0000-0000-000000000002';
  if v_count <> 0 then raise exception 'buyer A can read buyer B''s order'; end if;

  select count(*) into v_count from public.notifications where title = 'Audit notice B';
  if v_count <> 0 then raise exception 'buyer A can read buyer B''s notifications'; end if;

  update public.notifications set read_at = now() where title = 'Audit notice B';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'buyer A can touch buyer B''s notifications'; end if;

  select count(*) into v_count from public.support_messages where email = 'audit-guest@test.local';
  if v_count <> 0 then raise exception 'buyer A can read a guest support thread'; end if;

  delete from public.wishlists where profile_id = 'aaaaaaaa-0000-0000-0000-000000000004';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'buyer A can delete another buyer''s favourites'; end if;

  raise notice 'PASS: buyers are isolated from each other';
end $$;

-- Escalation attempts from a buyer session.
do $$
begin
  begin
    update public.profiles set role = 'admin'
     where id = 'aaaaaaaa-0000-0000-0000-000000000003';
    raise exception 'buyer promoted themselves to admin';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.transactions (kind, amount_naira, buyer_id)
    values ('payout', 100000, 'aaaaaaaa-0000-0000-0000-000000000003');
    raise exception 'buyer wrote a ledger row';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.transactions set amount_naira = 1 where true;
    raise exception 'buyer edited the ledger';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.transactions where true;
    raise exception 'buyer deleted the ledger';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.vendor_payouts (vendor_id, gross_naira, commission_naira, net_naira)
    values ('bbbbbbbb-0000-0000-0000-000000000001', 1000, 70, 930);
    raise exception 'buyer created a payout';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.order_refunds (order_id, paystack_reference, amount_naira)
    values ('dddddddd-0000-0000-0000-000000000001', 'audit-refund', 100);
    raise exception 'buyer created a refund';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.orders set status = 'delivered', escrow_status = 'released'
     where id = 'dddddddd-0000-0000-0000-000000000001';
    raise exception 'buyer moved their own order state';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.promo_codes (code, kind, amount_naira, active)
    values ('AUDITFREE', 'percentage', 100, true);
    raise exception 'buyer minted a promo code';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.promo_codes set used = 0 where code = 'AUDITLIVE';
    raise exception 'buyer edited promo accounting';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS: buyers cannot escalate, and the money tables stay service-role only';
end $$;

-- ========================================================== D. vendor =======

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

do $$
declare v_count int;
begin
  -- Own catalogue including unpublished rows; the rival's pending row is hidden.
  select count(*) into v_count from public.products;
  if v_count <> 3 then
    raise exception 'vendor should see own 2 + rival active 1 = 3 products, saw %', v_count;
  end if;

  select count(*) into v_count from public.orders;
  if v_count <> 2 then raise exception 'vendor should see the 2 orders on their shop, saw %', v_count; end if;

  select count(*) into v_count from public.vendor_documents;
  if v_count <> 1 then raise exception 'vendor should see their own KYC document, saw %', v_count; end if;

  raise notice 'PASS: a vendor sees their own shop and published rival listings only';
end $$;

do $$
declare v_rows int;
begin
  -- Legitimate seller writes: submit a listing for moderation, edit its selling
  -- terms, update shop and bank details, attach a photo.
  insert into public.products (vendor_id, title, description, category, grade, kind, price_naira, qty, city, status)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'Audit new bale', 'd', 'Bales', 'A', 'bale', 30000, 2, 'Lagos', 'pending');

  update public.products set price_naira = 45000, qty = 4, title = 'Audit denim bale (edited)'
   where id = 'cccccccc-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'vendor could not edit their own listing (% rows)', v_rows; end if;

  update public.vendor_profiles set shop_name = 'Audit Thrift Co.', bank_code = '044', account_number = '0123456789'
   where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'vendor could not edit their shop details (% rows)', v_rows; end if;

  insert into public.product_images (product_id, storage_path, sort_order)
  values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/audit.png', 0);

  raise notice 'PASS: every legitimate vendor write still works';
exception when insufficient_privilege then
  raise exception 'a legitimate vendor write was revoked: %', sqlerrm;
end $$;

do $$
declare v_rows int;
begin
  -- Moderation state and the ranking counters are server-managed.
  begin
    update public.products set status = 'active'
     where id = 'cccccccc-0000-0000-0000-000000000002';
    raise exception 'vendor self-published a pending listing';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.products set views = 99999, sold_count = 999, rating_avg = 5
     where id = 'cccccccc-0000-0000-0000-000000000001';
    raise exception 'vendor forged their ranking counters';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.vendor_profiles set verification_status = 'inspected', strikes = 0
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'vendor self-approved their own KYC';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.vendor_profiles set subscription_status = 'active', paystack_recipient_code = 'RCT_AUDIT'
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'vendor rewrote their own payout recipient';
  exception when insufficient_privilege then null;
  end;

  -- A vendor must not be able to touch a rival's row at all.
  update public.products set price_naira = 1
   where id = 'cccccccc-0000-0000-0000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'vendor edited a rival listing'; end if;

  insert into public.products (vendor_id, title, category, grade, kind, price_naira, qty, city, status)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'Audit hijack', 'Shoes', 'A', 'single', 100, 1, 'Kano', 'pending');
  raise exception 'vendor inserted a listing under a rival shop';
exception when insufficient_privilege then
  raise notice 'PASS: moderation state, counters and rival rows are all out of vendor reach';
end $$;

-- ========================================================== E. admin ========

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000005', false);

do $$
declare v_count int;
begin
  -- 4 fixtures plus the listing the vendor submitted in section D.
  select count(*) into v_count from public.products;
  if v_count <> 5 then raise exception 'admin should see all 5 products, saw %', v_count; end if;

  select count(*) into v_count from public.analytics_events;
  if v_count < 2 then raise exception 'admin should read the analytics funnel, saw %', v_count; end if;

  select count(*) into v_count from public.admin_audit_log;
  if v_count <> 1 then raise exception 'admin should read the audit log, saw %', v_count; end if;

  select count(*) into v_count from public.support_messages;
  if v_count <> 3 then raise exception 'admin should see the whole support queue, saw %', v_count; end if;

  select count(*) into v_count from public.support_queue;
  if v_count <> 3 then raise exception 'admin should read the support_queue view, saw %', v_count; end if;

  select count(*) into v_count from public.promo_codes;
  if v_count <> 2 then raise exception 'admin should see inactive promos too, saw %', v_count; end if;

  update public.support_messages set status = 'resolved', resolved_at = now()
   where email = 'audit-guest@test.local';
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'admin could not resolve a support thread (% rows)', v_count; end if;

  raise notice 'PASS: admins read every ops surface and can work the support queue';
end $$;

-- Promo writes belong to admin-action (service_role), never to the console's
-- own token — 0030 revoked them and 0031 must not hand them back.
do $$
begin
  begin
    update public.promo_codes set active = false where code = 'AUDITLIVE';
    raise exception 'admin token wrote promo_codes directly';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: promo writes stay on the audited service-role path';
end $$;

-- ================================================== G. storage buckets ======
-- 0032 restored the entitlement checks 0027 dropped, and merged the duplicated
-- dispute-evidence insert policy. These assert both halves: the private buckets
-- stay private, and the caps/ownership checks are back.

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claim.role', 'anon', false);

do $$
declare v_count int;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'product-images';
  if v_count <> 1 then raise exception 'anon should see the public catalogue image, saw %', v_count; end if;

  select count(*) into v_count from storage.objects where bucket_id = 'vendor-documents';
  if v_count <> 0 then raise exception 'anon can read the private KYC bucket, saw %', v_count; end if;

  select count(*) into v_count from storage.objects where bucket_id = 'dispute-evidence';
  if v_count <> 0 then raise exception 'anon can read dispute evidence, saw %', v_count; end if;

  raise notice 'PASS: anon sees public catalogue images and no private bucket';
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', false);
select set_config('request.jwt.claim.role', 'authenticated', false);

do $$
declare v_count int;
begin
  -- Buyer A: own evidence only, and no KYC bucket (they are not a vendor).
  select count(*) into v_count from storage.objects where bucket_id = 'dispute-evidence';
  if v_count <> 1 then raise exception 'buyer A should see only their own evidence, saw %', v_count; end if;

  select count(*) into v_count from storage.objects where bucket_id = 'vendor-documents';
  if v_count <> 0 then raise exception 'a non-vendor can read the KYC bucket, saw %', v_count; end if;

  -- 0032: a buyer is not a vendor, so the public image bucket is not their sink.
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('product-images', 'aaaaaaaa-0000-0000-0000-000000000003/sink.png',
            'aaaaaaaa-0000-0000-0000-000000000003', '{"size": 1024, "mimetype": "image/png"}');
    raise exception 'a non-vendor used the public image bucket as an upload sink';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('vendor-documents', 'aaaaaaaa-0000-0000-0000-000000000003/fake-nin.png',
            'aaaaaaaa-0000-0000-0000-000000000003', '{"size": 1024, "mimetype": "image/png"}');
    raise exception 'a non-vendor wrote into the KYC bucket';
  exception when insufficient_privilege then null;
  end;

  -- 0032: evidence must be filed under an order the caller actually owns.
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('dispute-evidence',
            'aaaaaaaa-0000-0000-0000-000000000003/dddddddd-0000-0000-0000-000000000002/planted.png',
            'aaaaaaaa-0000-0000-0000-000000000003', '{"size": 1024, "mimetype": "image/png"}');
    raise exception 'buyer A planted evidence in buyer B''s dispute folder';
  exception when insufficient_privilege then null;
  end;

  -- Their own order is fine, and so is a PDF within the cap.
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('dispute-evidence',
          'aaaaaaaa-0000-0000-0000-000000000003/dddddddd-0000-0000-0000-000000000001/receipt.pdf',
          'aaaaaaaa-0000-0000-0000-000000000003', '{"size": 204800, "mimetype": "application/pdf"}');

  raise notice 'PASS: buyers cannot use vendor buckets or plant evidence on a stranger''s order';
end $$;

-- The vendor side: own KYC readable, caps and mime types enforced.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

do $$
declare v_count int;
begin
  select count(*) into v_count from storage.objects where bucket_id = 'vendor-documents';
  if v_count <> 1 then raise exception 'a vendor should read their own KYC file, saw %', v_count; end if;

  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('product-images', 'aaaaaaaa-0000-0000-0000-000000000001/new-photo.jpg',
          'aaaaaaaa-0000-0000-0000-000000000001', '{"size": 2048000, "mimetype": "image/jpeg"}');

  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('product-images', 'aaaaaaaa-0000-0000-0000-000000000001/huge.png',
            'aaaaaaaa-0000-0000-0000-000000000001', '{"size": 9437184, "mimetype": "image/png"}');
    raise exception 'a 9 MB image passed the 5 MB catalogue cap';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('product-images', 'aaaaaaaa-0000-0000-0000-000000000001/payload.html',
            'aaaaaaaa-0000-0000-0000-000000000001', '{"size": 1024, "mimetype": "text/html"}');
    raise exception 'a non-image passed the catalogue mime filter';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('product-images', 'aaaaaaaa-0000-0000-0000-000000000002/stolen.png',
            'aaaaaaaa-0000-0000-0000-000000000001', '{"size": 1024, "mimetype": "image/png"}');
    raise exception 'a vendor wrote into another user''s folder';
  exception when insufficient_privilege then null;
  end;

  -- A missing size must fail closed, not be treated as "small enough".
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('product-images', 'aaaaaaaa-0000-0000-0000-000000000001/no-size.png',
            'aaaaaaaa-0000-0000-0000-000000000001', '{"mimetype": "image/png"}');
    raise exception 'an upload with no declared size was accepted';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS: vendor uploads are ownership-, size- and mime-checked, and fail closed';
end $$;

-- ============================================ F. defence in depth (0031) =====
-- Simulate the mistake this migration fixes: a bulk "restore default
-- privileges" hands table-level UPDATE back to clients. The column grants are
-- no longer the only thing standing between a buyer and `profiles.role`.

reset role;
select set_config('request.jwt.claim.role', '', false);

grant all on public.profiles, public.vendor_profiles, public.products to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', false);

do $$
begin
  begin
    update public.profiles set role = 'admin'
     where id = 'aaaaaaaa-0000-0000-0000-000000000003';
    raise exception 'guard trigger missed a role escalation';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: the column guard holds even after a bulk GRANT ALL';
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);

do $$
begin
  begin
    update public.products set status = 'active'
     where id = 'cccccccc-0000-0000-0000-000000000002';
    raise exception 'guard trigger missed a self-publish';
  exception when insufficient_privilege then null;
  end;

  begin
    -- Must be a real change: the fixture is already 'approved', and writing the
    -- same value back is a no-op the guard correctly ignores.
    update public.vendor_profiles set verification_status = 'inspected', strikes = 5
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'guard trigger missed a KYC self-approval';
  exception when insufficient_privilege then null;
  end;

  raise notice 'PASS: moderation and KYC guards hold even after a bulk GRANT ALL';
end $$;

-- The tightened dispute policy: with INSERT handed back, a buyer still cannot
-- freeze a stranger's escrow by naming their order.
reset role;
grant insert on public.disputes to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000003', false);

do $$
begin
  begin
    insert into public.disputes (order_id, buyer_id, reason, status)
    values ('dddddddd-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000003', 'audit griefing', 'open');
    raise exception 'buyer opened a dispute on someone else''s order';
  exception when insufficient_privilege then null;
  end;

  insert into public.disputes (order_id, buyer_id, reason, status)
  values ('dddddddd-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000003', 'audit legitimate', 'open');

  raise notice 'PASS: a dispute can only be opened on the buyer''s own order';
end $$;

-- Sanity: the trusted path is unaffected — service_role still writes freely.
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);

do $$
declare v_rows int;
begin
  update public.products set status = 'active'
   where id = 'cccccccc-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'service_role lost moderation write (% rows)', v_rows; end if;

  update public.profiles set role = 'vendor'
   where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'service_role lost the role-promotion path (% rows)', v_rows; end if;

  raise notice 'PASS: service_role (Edge Functions, webhooks, crons) is unaffected';
end $$;

rollback;
