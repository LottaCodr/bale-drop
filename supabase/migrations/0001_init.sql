-- ============================================================================
-- Bale Drop — initial schema (MVP)
-- Apply: `supabase db push` (or paste into the Supabase SQL editor).
-- Money rule: clients NEVER write to transactions / payouts. Only the
-- service_role (Edge Functions) mutates money. RLS enforces this.
-- ============================================================================

-- ---------- helpers ----------

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles (extends auth.users) ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'buyer' check (role in ('buyer', 'vendor', 'admin')),
  full_name text,
  phone text,
  city text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- vendors ----------

create table public.vendor_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  shop_name text not null,
  city text,
  market_address text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected', 'inspected')),
  rejection_reason text,
  bank_code text,
  account_number text,
  account_name text,
  paystack_recipient_code text,
  subscription_plan text not null default 'starter',
  subscription_status text not null default 'inactive',
  strikes int not null default 0,
  inspected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vendor_documents (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_profiles (id) on delete cascade,
  type text not null check (type in ('nin', 'voters_card', 'shop_photo', 'bale_sample')),
  storage_path text not null, -- private bucket `vendor-documents`
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- catalog ----------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_profiles (id) on delete cascade,
  title text not null,
  description text,
  category text not null,
  grade text not null check (grade in ('A', 'B', 'C')),
  kind text not null default 'single' check (kind in ('single', 'bale')),
  price_naira int not null check (price_naira > 0), -- singles: unit price; bales: FULL bale price
  old_price_naira int,
  qty int not null default 1,
  city text,
  status text not null default 'pending'
    check (status in ('draft', 'pending', 'active', 'rejected', 'paused')),
  weight_kg numeric,
  pieces_estimate text,
  views int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_vendor_idx on public.products (vendor_id);
create index products_browse_idx on public.products (status, category, city);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null, -- public bucket `product-images`
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id);

-- ---------- bale split (group buy) ----------

create table public.bale_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products (id) on delete cascade,
  total_naira int not null check (total_naira > 0),
  split_count int not null check (split_count between 2 and 50),
  price_per_slot_naira int not null check (price_per_slot_naira > 0),
  booked_count int not null default 0,
  expires_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'full', 'processing', 'fulfilled', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bale_listings_open_idx on public.bale_listings (status, expires_at);

create table public.bale_bookings (
  id uuid primary key default gen_random_uuid(),
  bale_id uuid not null references public.bale_listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'cancelled')),
  amount_naira int not null,
  paystack_reference text unique,
  display_label text, -- e.g. "CH" — shown publicly on slot chips (no PII)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bale_id, buyer_id) -- MVP: one slot per buyer per bale
);
create index bale_bookings_bale_idx on public.bale_bookings (bale_id, status);

-- ---------- orders + escrow ----------

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home',
  full_address text not null,
  city text not null,
  phone text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id),
  vendor_id uuid not null references public.vendor_profiles (id),
  status text not null default 'pending_payment'
    check (status in ('pending_payment','paid','processing','ready','in_transit','delivered','disputed','refunded','cancelled')),
  escrow_status text not null default 'none'
    check (escrow_status in ('none','held','released','refunded','partial_refund')),
  subtotal_naira int not null default 0,
  delivery_fee_naira int not null default 0,
  subsidy_naira int not null default 0,
  total_naira int not null default 0,
  paystack_reference text unique,
  tracking_number text,
  tracking_url text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_vendor_idx on public.orders (vendor_id, status);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id),
  bale_booking_id uuid references public.bale_bookings (id),
  title_snapshot text not null,
  qty int not null default 1,
  unit_naira int not null
);

create table public.order_timeline (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);

-- Append-only money audit trail. NO client insert/update/delete policies.
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('pay_in','commission','payout','refund','subsidy')),
  amount_naira int not null,
  order_id uuid references public.orders (id),
  bale_booking_id uuid references public.bale_bookings (id),
  vendor_id uuid references public.vendor_profiles (id),
  buyer_id uuid references public.profiles (id),
  paystack_reference text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index transactions_order_idx on public.transactions (order_id);
create index transactions_vendor_idx on public.transactions (vendor_id);

create table public.vendor_payouts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendor_profiles (id),
  order_id uuid references public.orders (id),
  gross_naira int not null,
  commission_naira int not null,
  net_naira int not null,
  status text not null default 'pending' check (status in ('pending','processing','paid','failed')),
  paystack_transfer_code text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- trust: disputes, reviews, notifications, promos ----------

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  buyer_id uuid not null references public.profiles (id),
  reason text not null,
  description text,
  evidence_urls text[] not null default '{}',
  status text not null default 'open'
    check (status in ('open','under_review','resolved_buyer','resolved_vendor','cancelled')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id),
  buyer_id uuid not null references public.profiles (id),
  vendor_id uuid not null references public.vendor_profiles (id),
  product_id uuid references public.products (id),
  rating int not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_profile_idx on public.notifications (profile_id, read_at);

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null default 'delivery_subsidy',
  amount_naira int not null,
  max_uses int,
  used int not null default 0,
  active boolean not null default true,
  expires_at timestamptz
);

-- ---------- updated_at triggers ----------

create trigger set_updated_at before update on public.profiles for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.vendor_profiles for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.products for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.bale_listings for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.bale_bookings for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.orders for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.vendor_payouts for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.disputes for each row execute function public.handle_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- Convention: public storefront = SELECT on active/open rows; owners = own
-- rows; money tables = SELECT own only, mutations via service_role (Edge Fns).
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.vendor_profiles enable row level security;
alter table public.vendor_documents enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.bale_listings enable row level security;
alter table public.bale_bookings enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_timeline enable row level security;
alter table public.transactions enable row level security;
alter table public.vendor_payouts enable row level security;
alter table public.disputes enable row level security;
alter table public.reviews enable row level security;
alter table public.notifications enable row level security;
alter table public.promo_codes enable row level security;

-- profiles: users manage only themselves
create policy "profiles own" on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

-- vendor_profiles: storefront sees approved shops; owners manage own row
create policy "vendors public approved" on public.vendor_profiles for select
  using (verification_status in ('approved', 'inspected'));
create policy "vendors owner" on public.vendor_profiles for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- vendor_documents: owner only (admin reads via service_role signed URLs)
create policy "vendor docs owner" on public.vendor_documents for all
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()))
  with check (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));

-- products: storefront sees active; vendors manage own
create policy "products public active" on public.products for select using (status = 'active');
create policy "products owner" on public.products for all
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()))
  with check (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));

-- product_images: follow product visibility
create policy "images public" on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id and p.status = 'active'));
create policy "images owner" on public.product_images for all
  using (exists (select 1 from public.products p join public.vendor_profiles vp on vp.id = p.vendor_id
                 where p.id = product_id and vp.profile_id = auth.uid()))
  with check (exists (select 1 from public.products p join public.vendor_profiles vp on vp.id = p.vendor_id
                 where p.id = product_id and vp.profile_id = auth.uid()));

-- bale_listings: public storefront (live counters); creation by owning vendor; transitions via RPC/Edge
create policy "bales public" on public.bale_listings for select using (true);
create policy "bales owner insert" on public.bale_listings for insert
  with check (exists (select 1 from public.products p join public.vendor_profiles vp on vp.id = p.vendor_id
                 where p.id = product_id and vp.profile_id = auth.uid()));

-- bale_bookings: buyer owns row; vendor sees bookings for own bales; public sees paid slot labels (live chips)
create policy "bookings buyer" on public.bale_bookings for select using (buyer_id = auth.uid());
create policy "bookings vendor" on public.bale_bookings for select
  using (exists (select 1 from public.bale_listings bl join public.products p on p.id = bl.product_id
                 join public.vendor_profiles vp on vp.id = p.vendor_id
                 where bl.id = bale_id and vp.profile_id = auth.uid()));
create policy "bookings public paid labels" on public.bale_bookings for select using (status = 'paid');
-- NOTE: inserts happen ONLY through claim_bale_slot() RPC (transactional). No insert policy = no direct inserts.

-- addresses: owner only
create policy "addresses owner" on public.addresses for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- orders: buyer + vendor read; buyer may create pending_payment rows (promote to Edge Fn when volume grows)
create policy "orders buyer read" on public.orders for select using (buyer_id = auth.uid());
create policy "orders vendor read" on public.orders for select
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));
create policy "orders buyer create" on public.orders for insert
  with check (buyer_id = auth.uid() and status = 'pending_payment' and escrow_status = 'none');

create policy "order items read" on public.order_items for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.buyer_id = auth.uid()
                      or exists (select 1 from public.vendor_profiles vp where vp.id = o.vendor_id and vp.profile_id = auth.uid()))));
create policy "order items buyer create" on public.order_items for insert
  with check (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()));

create policy "timeline read" on public.order_timeline for select
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.buyer_id = auth.uid()
                      or exists (select 1 from public.vendor_profiles vp where vp.id = o.vendor_id and vp.profile_id = auth.uid()))));

-- money: read-own only; all writes via service_role (Edge Functions)
create policy "transactions read own" on public.transactions for select
  using (buyer_id = auth.uid()
         or exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));
create policy "payouts vendor read" on public.vendor_payouts for select
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));

-- disputes: buyer files + reads own; vendor reads own orders' disputes
create policy "disputes buyer" on public.disputes for all
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
create policy "disputes vendor read" on public.disputes for select
  using (exists (select 1 from public.orders o join public.vendor_profiles vp on vp.id = o.vendor_id
                 where o.id = order_id and vp.profile_id = auth.uid()));

-- reviews: public read; verified buyers write (one per order)
create policy "reviews public" on public.reviews for select using (true);
create policy "reviews buyer insert" on public.reviews for insert with check (buyer_id = auth.uid());

-- notifications: owner read + mark-read; creation via service_role
create policy "notifications owner read" on public.notifications for select using (profile_id = auth.uid());
create policy "notifications owner update" on public.notifications for update using (profile_id = auth.uid());

-- promo codes: public can read active codes (redemption validated server-side)
create policy "promos public" on public.promo_codes for select using (active = true);

-- ============================================================================
-- claim_bale_slot — THE transactional booking RPC.
-- Row lock (FOR UPDATE) prevents overselling under concurrency. Enforces:
-- open status, not expired, not full, one slot per buyer.
-- Called by authenticated buyers BEFORE Paystack payment (booking starts
-- `pending`, webhook flips to `paid`). Harden: revoke PUBLIC, grant auth'd.
-- ============================================================================

create or replace function public.claim_bale_slot(p_bale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bale public.bale_listings%rowtype;
  v_booking_id uuid;
  v_name text;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into v_bale from public.bale_listings where id = p_bale_id for update;
  if not found then raise exception 'bale not found'; end if;
  if v_bale.status <> 'open' then raise exception 'split is %', v_bale.status; end if;
  if v_bale.expires_at <= now() then raise exception 'split expired'; end if;
  if v_bale.booked_count >= v_bale.split_count then raise exception 'split full'; end if;
  if exists (select 1 from public.bale_bookings
             where bale_id = p_bale_id and buyer_id = auth.uid() and status <> 'cancelled') then
    raise exception 'one slot per buyer per bale';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_label := upper(left(regexp_replace(coalesce(v_name, 'BD'), '[^A-Za-z]', '', 'g'), 2));
  if v_label = '' then v_label := 'BD'; end if;

  insert into public.bale_bookings (bale_id, buyer_id, status, amount_naira, display_label)
  values (p_bale_id, auth.uid(), 'pending', v_bale.price_per_slot_naira, v_label)
  returning id into v_booking_id;

  update public.bale_listings
  set booked_count = booked_count + 1,
      status = case when booked_count + 1 >= split_count then 'full' else 'open' end
  where id = p_bale_id
  returning * into v_bale;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'booked_count', v_bale.booked_count,
    'status', v_bale.status
  );
end;
$$;

revoke all on function public.claim_bale_slot(uuid) from public;
grant execute on function public.claim_bale_slot(uuid) to authenticated;

-- ============================================================================
-- STORAGE (create buckets in dashboard / config, then apply equivalent policies):
-- - `product-images`  (public): product photo reads; vendor writes own folder.
-- - `vendor-documents` (PRIVATE): no public access; owner read/write own
--   folder `vendor_id/...`; admin via service_role signed URLs (60s TTL).
-- Enable Realtime on `bale_listings` + `bale_bookings` for live counters.
-- Schedule `bale-expiry` Edge Function hourly via Supabase Cron.
-- ============================================================================
