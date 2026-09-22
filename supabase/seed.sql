-- ============================================================================
-- Bale Drop — demo dataset (DEV ONLY, never run on production).
-- Run AFTER 0001 + 0002 + 0003 + 0004 in the Supabase SQL editor. Re-runnable
-- (ON CONFLICT DO NOTHING throughout).
--
-- Creates: 5 vendor auth users + 9 buyer auth users (password: BaleDrop123!),
-- profiles, approved vendor shops, 8 products, 3 live bale splits with paid
-- bookings, 2 reviews, 1 promo code.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- auth users ----------
do $$
declare
  v_instance uuid;
  u record;
begin
  select id into v_instance from auth.instances limit 1;
  for u in select * from (values
    ('10000000-0000-0000-0000-000000000001', 'adaeze@baledrop.demo'),
    ('10000000-0000-0000-0000-000000000002', 'kano@baledrop.demo'),
    ('10000000-0000-0000-0000-000000000003', 'ph@baledrop.demo'),
    ('10000000-0000-0000-0000-000000000004', 'abuja@baledrop.demo'),
    ('10000000-0000-0000-0000-000000000005', 'yaba@baledrop.demo'),
    ('90000000-0000-0000-0000-000000000001', 'admin@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000001', 'buyer1@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000002', 'buyer2@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000003', 'buyer3@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000004', 'buyer4@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000005', 'buyer5@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000006', 'buyer6@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000007', 'buyer7@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000008', 'buyer8@baledrop.demo'),
    ('20000000-0000-0000-0000-000000000009', 'buyer9@baledrop.demo')
  ) as t(id, email)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_instance, u.id::uuid, 'authenticated', 'authenticated', u.email,
            crypt('BaleDrop123!', gen_salt('bf')), now(), now(), now())
    on conflict (id) do nothing;
  end loop;
end $$;

-- ---------- profiles ----------
insert into public.profiles (id, role, full_name, city) values
  ('10000000-0000-0000-0000-000000000001', 'vendor', 'Adaeze T.', 'Lagos'),
  ('10000000-0000-0000-0000-000000000002', 'vendor', 'Kano B.', 'Kano'),
  ('10000000-0000-0000-0000-000000000003', 'vendor', 'PH H.', 'Port Harcourt'),
  ('10000000-0000-0000-0000-000000000004', 'vendor', 'Grade A.', 'Abuja'),
  ('10000000-0000-0000-0000-000000000005', 'vendor', 'Yaba V.', 'Lagos'),
  ('20000000-0000-0000-0000-000000000001', 'buyer', 'Chiamaka O.', 'Lagos'),
  ('20000000-0000-0000-0000-000000000002', 'buyer', 'Obi E.', 'Abuja'),
  ('20000000-0000-0000-0000-000000000003', 'buyer', 'Emeka A.', 'Port Harcourt'),
  ('20000000-0000-0000-0000-000000000004', 'buyer', 'Fatima S.', 'Kano'),
  ('20000000-0000-0000-0000-000000000005', 'buyer', 'Ibrahim M.', 'Kano'),
  ('20000000-0000-0000-0000-000000000006', 'buyer', 'Damilola A.', 'Lagos'),
  ('20000000-0000-0000-0000-000000000007', 'buyer', 'Tunde B.', 'Abuja'),
  ('20000000-0000-0000-0000-000000000008', 'buyer', 'Segun K.', 'Lagos'),
  ('20000000-0000-0000-0000-000000000009', 'buyer', 'Ngozi U.', 'Port Harcourt')
on conflict (id) do nothing;

-- ---------- vendor shops ----------
insert into public.vendor_profiles
  (id, profile_id, shop_name, city, market_address, verification_status, inspected_at,
   subscription_plan, subscription_status, rating_avg, reviews_count, sales_count)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Adaeze Thrift Co.', 'Lagos', 'Shop 12, Katangua Market', 'inspected', now() - interval '20 days',
   'pro', 'active', 4.8, 312, 1402),
  ('11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
   'Kano Bale House', 'Kano', 'Block C, Sabon Gari Market', 'inspected', now() - interval '30 days',
   'pro', 'active', 4.9, 528, 2310),
  ('11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003',
   'PH Okirika Hub', 'Port Harcourt', 'Line 4, Mile 3 Market', 'approved', null,
   'starter', 'active', 4.7, 194, 860),
  ('11000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004',
   'Grade-A Plug Abuja', 'Abuja', 'Shop 8, Wuse Market', 'inspected', now() - interval '12 days',
   'pro', 'active', 4.9, 441, 1875),
  ('11000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005',
   'Yaba Vintage Vault', 'Lagos', 'Shop 3, Yaba Market', 'approved', null,
   'starter', 'active', 4.6, 128, 402)
on conflict (profile_id) do nothing;

-- ---------- products ----------
insert into public.products
  (id, vendor_id, title, category, grade, kind, price_naira, old_price_naira, city,
   status, weight_kg, pieces_estimate, sold_count, rating_avg)
values
  ('30000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001',
   'Grade A Unisex Vintage Denim Jackets — Full Bale', 'Bales', 'A', 'bale', 150000, null, 'Lagos',
   'active', 100, '~45 jackets', 132, 4.8),
  ('30000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002',
   'Grade A Sneakers Bale — Mixed Sizes 40–45', 'Shoes', 'A', 'bale', 220000, null, 'Kano',
   'active', 55, '~50 pairs', 210, 4.9),
  ('30000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000004',
   'Men Corporate Shirts Bale — Long Sleeve', 'Men', 'A', 'bale', 95000, 110000, 'Abuja',
   'active', 70, '~70 pcs', 98, 4.7),
  ('30000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-000000000005',
   'Vintage Levi''s-Style Trucker Jacket (Single)', 'Vintage', 'A', 'single', 12500, null, 'Lagos',
   'active', null, null, 44, 4.6),
  ('30000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-000000000003',
   'Grade B Mixed Ladies Gowns Bale', 'Women', 'B', 'bale', 90000, null, 'Port Harcourt',
   'active', 80, '~80 gowns', 76, 4.7),
  ('30000000-0000-0000-0000-000000000006', '11000000-0000-0000-0000-000000000001',
   'Kids Mix Bale — Ages 2–10', 'Kids', 'B', 'bale', 68000, null, 'Lagos',
   'active', 60, '~120 pcs', 61, 4.8),
  ('30000000-0000-0000-0000-000000000007', '11000000-0000-0000-0000-000000000004',
   'Leather Handbags — Single Pieces (5 pcs bundle)', 'Bags', 'A', 'single', 28000, 34000, 'Abuja',
   'active', null, null, 187, 4.9),
  ('30000000-0000-0000-0000-000000000008', '11000000-0000-0000-0000-000000000002',
   'Grade A Hoodies & Sweatshirts Bale', 'Men', 'A', 'bale', 130000, null, 'Kano',
   'active', 65, '~60 pcs', 143, 4.9)
on conflict (id) do nothing;

-- ---------- live bale splits ----------
insert into public.bale_listings
  (id, product_id, total_naira, split_count, price_per_slot_naira, booked_count, expires_at, status)
values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   150000, 10, 15000, 7, now() + interval '52 hours', 'open'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002',
   220000, 10, 22000, 9, now() + interval '5 hours', 'open'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005',
   90000, 6, 15000, 2, now() + interval '6 days', 'open')
on conflict (id) do nothing;

-- ---------- paid slot bookings (joiners) ----------
-- Bale 1: 7 joiners
insert into public.bale_bookings (bale_id, buyer_id, status, amount_naira, paystack_reference, display_label, created_at) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'paid', 15000, 'seed-b1-01', 'CO', now() - interval '2 days'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'paid', 15000, 'seed-b1-02', 'OE', now() - interval '2 days' + interval '1 hour'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'paid', 15000, 'seed-b3-01', 'CO', now() - interval '1 day'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'paid', 15000, 'seed-b1-03', 'EA', now() - interval '1 day'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'paid', 22000, 'seed-b2-01', 'CO', now() - interval '20 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'paid', 22000, 'seed-b2-02', 'OE', now() - interval '19 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'paid', 22000, 'seed-b2-03', 'EA', now() - interval '18 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', 'paid', 22000, 'seed-b2-04', 'FS', now() - interval '17 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005', 'paid', 22000, 'seed-b2-05', 'IM', now() - interval '16 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000006', 'paid', 22000, 'seed-b2-06', 'DA', now() - interval '15 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000007', 'paid', 22000, 'seed-b2-07', 'TB', now() - interval '14 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000008', 'paid', 22000, 'seed-b2-08', 'SK', now() - interval '13 hours'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000009', 'paid', 22000, 'seed-b2-09', 'NU', now() - interval '12 hours'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'paid', 15000, 'seed-b1-04', 'FS', now() - interval '10 hours'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'paid', 15000, 'seed-b1-05', 'IM', now() - interval '8 hours'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'paid', 15000, 'seed-b1-06', 'DA', now() - interval '6 hours'),
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000007', 'paid', 15000, 'seed-b1-07', 'TB', now() - interval '4 hours'),
  ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'paid', 15000, 'seed-b3-02', 'FS', now() - interval '2 hours')
on conflict (bale_id, buyer_id) do nothing;

-- ---------- sample delivered order + review ----------
insert into public.orders
  (id, buyer_id, vendor_id, status, escrow_status, subtotal_naira, delivery_fee_naira,
   subsidy_naira, total_naira, paystack_reference, tracking_number, delivered_at)
values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '11000000-0000-0000-0000-000000000004', 'delivered', 'released', 28000, 2500,
   1500, 29000, 'seed-order-01', 'SNB-884102', now() - interval '3 days')
on conflict (id) do nothing;

insert into public.order_items (order_id, product_id, title_snapshot, qty, unit_naira)
select '50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000007',
       'Leather Handbags — Single Pieces (5 pcs bundle)', 1, 28000
where not exists (select 1 from public.order_items
  where order_id = '50000000-0000-0000-0000-000000000001');

insert into public.reviews (order_id, buyer_id, vendor_id, product_id, rating, body)
values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        '11000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000007',
        5, 'Bale exactly as described — Grade A, no stories.')
on conflict (order_id) do nothing;

insert into public.promo_codes (code, kind, amount_naira, max_uses, active)
values ('LAUNCH1500', 'delivery_subsidy', 1500, 1000, true)
on conflict (code) do nothing;
