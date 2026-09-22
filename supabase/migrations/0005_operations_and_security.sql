-- ============================================================================
-- Bale Drop — operations, fulfillment, disputes, payouts and RLS hardening.
-- Apply after 0004_payment_spine.sql.
--
-- This migration closes the dangerous MVP gaps: clients cannot promote their
-- own role/vendor/listing/order/payment state; all operational mutations are
-- performed by the authenticated Edge Functions below.
-- ============================================================================

-- ---------- safe auth role trigger ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone, city)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'vendor' then 'vendor' else 'buyer' end,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'city', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------- shipping snapshot + fulfillment/audit tables ----------

alter table public.orders add column if not exists address_id uuid references public.addresses (id);
alter table public.orders add column if not exists shipping_address_snapshot text;
alter table public.orders add column if not exists shipping_city text;
alter table public.orders add column if not exists shipping_phone text;

with ranked as (
  select id, row_number() over (partition by profile_id order by is_default desc, created_at asc, id) as rn
  from public.addresses
)
update public.addresses a
set is_default = (ranked.rn = 1)
from ranked
where a.id = ranked.id and a.is_default is distinct from (ranked.rn = 1);
create unique index if not exists addresses_one_default_idx
  on public.addresses (profile_id) where is_default;

create table public.fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  provider text not null default 'bale_drop',
  external_event_id text unique,
  status text not null,
  tracking_number text,
  tracking_url text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index fulfillment_events_order_idx on public.fulfillment_events (order_id, created_at desc);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index admin_audit_entity_idx on public.admin_audit_log (entity_type, entity_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('dispute-evidence', 'dispute-evidence', false)
on conflict (id) do nothing;

create unique index vendor_payouts_order_unique
  on public.vendor_payouts (order_id)
  where order_id is not null;

alter table public.fulfillment_events enable row level security;
alter table public.admin_audit_log enable row level security;

-- ---------- safer RLS policies ----------

-- Security-definer role helper avoids recursive profiles RLS checks. It is
-- callable by authenticated clients only for policy evaluation; it returns a
-- boolean and exposes no profile data.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Profiles: users can read/update profile fields, never role.
drop policy if exists "profiles own" on public.profiles;
create policy "profiles own read" on public.profiles for select
  using (auth.uid() = id);
create policy "profiles own update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles admin read" on public.profiles for select
  using (public.is_admin());
revoke update (role) on public.profiles from authenticated;
grant update (full_name, phone, city, avatar_url) on public.profiles to authenticated;

-- Vendor profiles: owners can submit/edit business details; review and payout
-- state are service/admin-only.
drop policy if exists "vendors owner" on public.vendor_profiles;
create policy "vendors owner read" on public.vendor_profiles for select
  using (profile_id = auth.uid());
create policy "vendors owner insert" on public.vendor_profiles for insert
  with check (profile_id = auth.uid() and verification_status = 'pending' and subscription_status in ('pending', 'inactive'));
create policy "vendors owner update" on public.vendor_profiles for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "vendors admin read" on public.vendor_profiles for select
  using (public.is_admin());
revoke update (verification_status, rejection_reason, paystack_recipient_code, subscription_status, inspected_at, strikes)
  on public.vendor_profiles from authenticated;
grant update (shop_name, city, market_address, bank_code, account_number, account_name, subscription_plan)
  on public.vendor_profiles to authenticated;

-- Vendor documents: owner can upload/delete their pending files, never review
-- or approve them.
drop policy if exists "vendor docs owner" on public.vendor_documents;
drop policy if exists "vendor docs owner read" on public.vendor_documents;
drop policy if exists "vendor docs owner insert" on public.vendor_documents;
drop policy if exists "vendor docs owner update" on public.vendor_documents;
drop policy if exists "vendor docs owner delete" on public.vendor_documents;
create policy "vendor docs owner read" on public.vendor_documents for select
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));
create policy "vendor docs owner insert" on public.vendor_documents for insert
  with check (
    status = 'pending'
    and exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid())
  );
create policy "vendor docs owner delete" on public.vendor_documents for delete
  using (status = 'pending' and exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));
create policy "vendor docs admin read" on public.vendor_documents for select
  using (public.is_admin());

-- Listings: vendors submit draft/pending listings. Moderation state is not a
-- client-writable column.
drop policy if exists "products owner" on public.products;
create policy "products owner read" on public.products for select
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));
create policy "products owner insert" on public.products for insert
  with check (
    status in ('draft', 'pending')
    and exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid() and vp.verification_status in ('approved', 'inspected'))
  );
create policy "products owner update" on public.products for update
  using (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()))
  with check (exists (select 1 from public.vendor_profiles vp where vp.id = vendor_id and vp.profile_id = auth.uid()));
create policy "products admin read" on public.products for select
  using (public.is_admin());
revoke update (status, views, sold_count, rating_avg) on public.products from authenticated;
grant update (title, description, category, grade, kind, price_naira, old_price_naira, qty, city, weight_kg, pieces_estimate)
  on public.products to authenticated;

-- Orders and items are created by paystack-initialize only. Remove the old
-- buyer insert loophole that allowed arbitrary totals.
drop policy if exists "orders buyer create" on public.orders;
drop policy if exists "order items buyer create" on public.order_items;
create policy "orders admin read" on public.orders for select
  using (public.is_admin());

-- Disputes: buyer can read and open; resolution state is service/admin-only.
drop policy if exists "disputes buyer" on public.disputes;
create policy "disputes buyer read" on public.disputes for select
  using (buyer_id = auth.uid());
create policy "disputes buyer insert" on public.disputes for insert
  with check (buyer_id = auth.uid() and status = 'open');
create policy "disputes admin read" on public.disputes for select
  using (public.is_admin());

-- Fulfillment read access: buyer/vendor/admin; writes are service-role only.
create policy "fulfillment buyer read" on public.fulfillment_events for select
  using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = auth.uid()));
create policy "fulfillment vendor read" on public.fulfillment_events for select
  using (exists (select 1 from public.orders o join public.vendor_profiles vp on vp.id = o.vendor_id where o.id = order_id and vp.profile_id = auth.uid()));
create policy "fulfillment admin read" on public.fulfillment_events for select
  using (public.is_admin());

-- Admin operational reads. All mutations still happen in admin-action or a
-- dedicated money function and are written to admin_audit_log.
create policy "transactions admin read" on public.transactions for select
  using (public.is_admin());
create policy "payouts admin read" on public.vendor_payouts for select
  using (public.is_admin());
create policy "payment sessions admin read" on public.payment_sessions for select
  using (public.is_admin());
create policy "audit admin read" on public.admin_audit_log for select
  using (admin_id = auth.uid() or public.is_admin());

-- Reviews require a delivered order owned by the buyer and the same vendor.
drop policy if exists "reviews buyer insert" on public.reviews;
create policy "reviews verified buyer insert" on public.reviews for insert
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.buyer_id = auth.uid()
        and o.status = 'delivered' and o.escrow_status = 'released'
        and o.vendor_id = vendor_id
    )
  );

create unique index if not exists reviews_one_per_order_idx on public.reviews (order_id);
revoke insert, update, delete on public.reviews from authenticated;

-- ---------- service-role operational functions ----------

create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_buyer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_plan text;
  v_gross int;
  v_commission int;
  v_rate numeric;
  v_payout_id uuid;
begin
  select * into v_order from public.orders
  where id = p_order_id and buyer_id = p_buyer_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status not in ('processing', 'ready', 'in_transit') then
    raise exception 'order is not ready for delivery confirmation';
  end if;
  if v_order.escrow_status <> 'held' then raise exception 'escrow is not held'; end if;
  if exists (select 1 from public.disputes where order_id = v_order.id and status in ('open', 'under_review')) then
    raise exception 'resolve the open dispute first';
  end if;

  select subscription_plan into v_plan from public.vendor_profiles where id = v_order.vendor_id;
  v_rate := case when v_plan = 'pro' then 0.04 else 0.07 end;
  v_gross := greatest(0, v_order.subtotal_naira);
  v_commission := round(v_gross * v_rate);

  update public.orders
  set status = 'delivered', escrow_status = 'released', delivered_at = now()
  where id = v_order.id;

  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, 'delivered', 'Buyer confirmed delivery — escrow released');

  insert into public.vendor_payouts (
    vendor_id, order_id, gross_naira, commission_naira, net_naira, status
  ) values (
    v_order.vendor_id, v_order.id, v_gross, v_commission, greatest(0, v_gross - v_commission), 'pending'
  )
  on conflict do nothing
  returning id into v_payout_id;

  if v_commission > 0 then
    insert into public.transactions (
      kind, amount_naira, order_id, vendor_id, buyer_id, meta
    ) values (
      'commission', v_commission, v_order.id, v_order.vendor_id, v_order.buyer_id,
      jsonb_build_object('rate', v_rate, 'source', 'delivery_confirmation')
    ) on conflict do nothing;
  end if;

  insert into public.notifications (profile_id, title, body, href)
  select vp.profile_id, 'Order delivered — payout queued',
         'The buyer confirmed delivery. Your payout is now queued for transfer.', '/vendor'
  from public.vendor_profiles vp where vp.id = v_order.vendor_id;

  return jsonb_build_object('order_id', v_order.id, 'status', 'delivered', 'payout_id', v_payout_id);
end;
$$;

create or replace function public.release_disputed_order_to_vendor(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_plan text;
  v_gross int;
  v_commission int;
  v_rate numeric;
  v_payout_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status <> 'disputed' or v_order.escrow_status <> 'held' then raise exception 'disputed escrow is not releasable'; end if;
  select subscription_plan into v_plan from public.vendor_profiles where id = v_order.vendor_id;
  v_rate := case when v_plan = 'pro' then 0.04 else 0.07 end;
  v_gross := greatest(0, v_order.subtotal_naira);
  v_commission := round(v_gross * v_rate);
  update public.orders set status = 'delivered', escrow_status = 'released', delivered_at = coalesce(delivered_at, now()) where id = v_order.id;
  insert into public.order_timeline (order_id, status, note) values (v_order.id, 'delivered', 'Admin resolved dispute in vendor favour — escrow released');
  insert into public.vendor_payouts (vendor_id, order_id, gross_naira, commission_naira, net_naira, status)
  values (v_order.vendor_id, v_order.id, v_gross, v_commission, greatest(0, v_gross - v_commission), 'pending')
  on conflict do nothing returning id into v_payout_id;
  if v_commission > 0 then
    insert into public.transactions (kind, amount_naira, order_id, vendor_id, buyer_id, meta)
    values ('commission', v_commission, v_order.id, v_order.vendor_id, v_order.buyer_id, jsonb_build_object('rate', v_rate, 'source', 'dispute_vendor_release'))
    on conflict do nothing;
  end if;
  insert into public.notifications (profile_id, title, body, href)
  values (v_order.buyer_id, 'Dispute resolved', 'Our team reviewed the evidence and released this order to the vendor.', '/orders');
  insert into public.notifications (profile_id, title, body, href)
  select vp.profile_id, 'Dispute resolved — payout queued', 'The dispute was resolved in your favour. Your payout is queued.', '/vendor'
  from public.vendor_profiles vp where vp.id = v_order.vendor_id;
  return jsonb_build_object('order_id', v_order.id, 'status', 'delivered', 'payout_id', v_payout_id);
end;
$$;

create or replace function public.create_order_review(
  p_order_id uuid,
  p_buyer_id uuid,
  p_rating int,
  p_body text default null,
  p_product_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_review_id uuid;
  v_rating numeric;
begin
  if p_rating < 1 or p_rating > 5 then raise exception 'rating must be between 1 and 5'; end if;
  select * into v_order from public.orders where id = p_order_id and buyer_id = p_buyer_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.status <> 'delivered' or v_order.escrow_status <> 'released' then
    raise exception 'reviews unlock after delivery confirmation';
  end if;
  if exists (select 1 from public.reviews where order_id = v_order.id) then raise exception 'order has already been reviewed'; end if;
  if p_product_id is not null and not exists (select 1 from public.order_items where order_id = v_order.id and product_id = p_product_id) then
    raise exception 'product was not part of this order';
  end if;

  insert into public.reviews (order_id, buyer_id, vendor_id, product_id, rating, body)
  values (v_order.id, p_buyer_id, v_order.vendor_id, p_product_id, p_rating, nullif(trim(p_body), ''))
  returning id into v_review_id;

  select avg(rating)::numeric(3,2) into v_rating from public.reviews where vendor_id = v_order.vendor_id;
  update public.vendor_profiles
  set rating_avg = v_rating,
      reviews_count = (select count(*) from public.reviews where vendor_id = v_order.vendor_id)
  where id = v_order.vendor_id;
  insert into public.notifications (profile_id, title, body, href)
  select vp.profile_id, 'New buyer review', format('A buyer left you a %s-star review.', p_rating), '/vendor'
  from public.vendor_profiles vp where vp.id = v_order.vendor_id;
  return jsonb_build_object('review_id', v_review_id, 'rating', p_rating);
end;
$$;

create or replace function public.open_order_dispute(
  p_order_id uuid,
  p_buyer_id uuid,
  p_reason text,
  p_description text,
  p_evidence_urls text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_dispute_id uuid;
begin
  select * into v_order from public.orders
  where id = p_order_id and buyer_id = p_buyer_id for update;
  if not found then raise exception 'order not found'; end if;
  if v_order.escrow_status <> 'held' then raise exception 'this order is not in held escrow'; end if;
  if exists (select 1 from public.disputes where order_id = v_order.id and status in ('open', 'under_review')) then
    raise exception 'a dispute is already open';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'a dispute reason is required'; end if;
  if exists (
    select 1 from unnest(coalesce(p_evidence_urls, '{}')) as evidence(path)
    where evidence.path !~ ('^' || p_buyer_id::text || '/' )
  ) then raise exception 'invalid evidence path'; end if;

  insert into public.disputes (order_id, buyer_id, reason, description, evidence_urls, status)
  values (v_order.id, p_buyer_id, trim(p_reason), nullif(trim(p_description), ''), coalesce(p_evidence_urls, '{}'), 'open')
  returning id into v_dispute_id;

  update public.orders set status = 'disputed' where id = v_order.id;
  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, 'disputed', 'Buyer opened a dispute — escrow remains held');
  insert into public.notifications (profile_id, title, body, href)
  select vp.profile_id, 'New buyer dispute', 'A buyer opened a dispute on an order. Review it in the admin console.', '/admin'
  from public.vendor_profiles vp where vp.id = v_order.vendor_id;

  return jsonb_build_object('dispute_id', v_dispute_id, 'order_id', v_order.id, 'status', 'open');
end;
$$;

create or replace function public.set_order_fulfillment_status(
  p_order_id uuid,
  p_vendor_profile_id uuid,
  p_status text,
  p_tracking_number text default null,
  p_tracking_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_previous text;
  v_label text;
begin
  select * into v_order from public.orders
  where id = p_order_id and vendor_id = p_vendor_profile_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_status not in ('processing', 'ready', 'in_transit') then raise exception 'invalid fulfillment status'; end if;
  if v_order.status = p_status
     and v_order.tracking_number is not distinct from nullif(trim(p_tracking_number), '') then
    return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'duplicate', true, 'tracking_number', v_order.tracking_number);
  end if;
  if v_order.status in ('delivered', 'refunded', 'cancelled', 'disputed') then raise exception 'order is not actionable'; end if;
  if p_status = 'in_transit' and nullif(trim(coalesce(p_tracking_number, '')), '') is null then
    raise exception 'tracking number required before dispatch';
  end if;

  v_previous := v_order.status;
  v_label := replace(initcap(replace(p_status, '_', ' ')), 'In Transit', 'In transit');
  update public.orders
  set status = p_status,
      tracking_number = coalesce(nullif(trim(p_tracking_number), ''), tracking_number),
      tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url)
  where id = v_order.id;
  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, p_status, format('Vendor moved order from %s to %s', v_previous, v_label));
  insert into public.notifications (profile_id, title, body, href)
  values (v_order.buyer_id, 'Order update', format('Your order is now %s.', v_label), '/orders');

  return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'tracking_number', coalesce(p_tracking_number, v_order.tracking_number));
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_disputed_order_to_vendor(uuid) from public, anon, authenticated;
revoke all on function public.create_order_review(uuid, uuid, int, text, uuid) from public, anon, authenticated;
revoke all on function public.open_order_dispute(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.set_order_fulfillment_status(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_order_delivery(uuid, uuid) to service_role;
grant execute on function public.release_disputed_order_to_vendor(uuid) to service_role;
grant execute on function public.create_order_review(uuid, uuid, int, text, uuid) to service_role;
grant execute on function public.open_order_dispute(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.set_order_fulfillment_status(uuid, uuid, text, text, text) to service_role;

-- Storage writes are vendor-only. The user-folder check prevents one vendor
-- from deleting another vendor's files; the profile check prevents buyers from
-- using the public image bucket as an upload sink.
drop policy if exists "product images owner insert" on storage.objects;
drop policy if exists "product images owner update" on storage.objects;
drop policy if exists "product images owner delete" on storage.objects;
create policy "product images owner insert" on storage.objects for insert
  with check (
    bucket_id = 'product-images' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );
create policy "product images owner update" on storage.objects for update
  using (
    bucket_id = 'product-images' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  )
  with check (
    bucket_id = 'product-images' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );
create policy "product images owner delete" on storage.objects for delete
  using (
    bucket_id = 'product-images' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );

drop policy if exists "vendor docs owner read" on storage.objects;
drop policy if exists "vendor docs owner insert" on storage.objects;
drop policy if exists "vendor docs owner update" on storage.objects;
drop policy if exists "vendor docs owner delete" on storage.objects;
create policy "vendor docs owner read" on storage.objects for select
  using (
    bucket_id = 'vendor-documents' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );
create policy "vendor docs owner insert" on storage.objects for insert
  with check (
    bucket_id = 'vendor-documents' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );
create policy "vendor docs owner update" on storage.objects for update
  using (
    bucket_id = 'vendor-documents' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  )
  with check (
    bucket_id = 'vendor-documents' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );
create policy "vendor docs owner delete" on storage.objects for delete
  using (
    bucket_id = 'vendor-documents' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );

drop policy if exists "dispute evidence buyer read" on storage.objects;
drop policy if exists "dispute evidence buyer insert" on storage.objects;
create policy "dispute evidence buyer read" on storage.objects for select
  using (
    bucket_id = 'dispute-evidence' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.orders o
      where o.id = case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$' then (storage.foldername(name))[2]::uuid end
        and o.buyer_id = auth.uid()
    )
  );
create policy "dispute evidence buyer insert" on storage.objects for insert
  with check (
    bucket_id = 'dispute-evidence' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.orders o
      where o.id = case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$' then (storage.foldername(name))[2]::uuid end
        and o.buyer_id = auth.uid()
    )
  );
create policy "dispute evidence buyer delete" on storage.objects for delete
  using (
    bucket_id = 'dispute-evidence' and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.orders o
      where o.id = case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$' then (storage.foldername(name))[2]::uuid end
        and o.buyer_id = auth.uid()
    )
  );

-- Realtime for live order status and fulfillment updates.
do $$ begin
  alter publication supabase_realtime add table public.fulfillment_events;
exception when duplicate_object then null;
end $$;
