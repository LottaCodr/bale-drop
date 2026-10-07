-- ============================================================================
-- 0031 — Client privilege hardening: close a privilege-escalation hole.
--
-- THE BUG
-- -------
-- Supabase grants SELECT/INSERT/UPDATE/DELETE on every table in `public` to the
-- `anon` and `authenticated` roles (platform default privileges for the
-- `postgres` role), and treats RLS as the only boundary. 0005 tried to protect
-- server-managed columns with *column-level* revokes:
--
--     revoke update (role) on public.profiles from authenticated;
--     grant update (full_name, phone, city, avatar_url) on public.profiles to authenticated;
--
-- In PostgreSQL a column-level REVOKE only removes a column-level grant. When
-- the role also holds the *table-level* privilege — which it does here, from
-- the platform default — the table-level grant still authorises every column,
-- so the revoke is a no-op. Verified against a real cluster with the migrations
-- applied (scripts/check-migrations.py):
--
--     has_table_privilege('authenticated','public.profiles','UPDATE')  -> t
--     has_column_privilege('authenticated','public.profiles','role','UPDATE') -> t
--     update public.profiles set role = 'admin' ...                    -> UPDATE 1
--
-- Three escalations followed, all reachable with an ordinary access token and
-- a single PATCH through PostgREST:
--
--   1. any signed-in buyer could set `profiles.role = 'admin'` on their own row
--      (RLS "profiles own update" allows updating your own row, and `is_admin()`
--      reads that column) — full admin console, refunds, payouts, moderation;
--   2. any vendor could set `vendor_profiles.verification_status = 'approved'`
--      and `subscription_status = 'active'` — KYC and subscription bypass, which
--      also unlocks `products owner insert` and real payouts;
--   3. any vendor could set `products.status = 'active'` on their own listing —
--      self-publishing past moderation, plus forging `views`, `sold_count` and
--      `rating_avg` (which drive search ranking).
--
-- THE FIX
-- -------
-- Revoke the table-level privileges first, then grant back exactly the verbs and
-- columns the app uses. With no table-level UPDATE, a column-level grant really
-- is the whole privilege, so `status`/`role`/`verification_status` become
-- unwritable by clients while the legitimate edit paths keep working.
--
-- RLS is unchanged as the row-level gate; this migration fixes the column-level
-- gate. `guard_protected_columns()` triggers below make the invariant hold even
-- if a future bulk `GRANT ALL` (e.g. restoring Supabase's older defaults) puts
-- the table-level privilege back.
--
-- Trusted write paths are untouched: every RPC in this schema is
-- SECURITY DEFINER owned by `postgres` (so `current_user` inside it is
-- `postgres`, not the caller) and Edge Functions connect as `service_role`.
-- ============================================================================

-- ---------------------------------------------------------------- clean slate

revoke all on all tables in schema public from anon, authenticated;

-- Reads. RLS still decides which rows come back: anon only ever sees published
-- catalogue data, authenticated sees its own orders/ledger rows plus admin
-- reads gated by is_admin(). `search_products` is SECURITY INVOKER, so the
-- caller needs SELECT on the tables it reads.
grant select
  on public.products, public.vendor_profiles, public.product_images,
     public.bale_listings, public.bale_bookings, public.reviews,
     public.promo_codes, public.search_synonyms
  to anon, authenticated;

grant select
  on public.profiles, public.orders, public.order_items, public.order_timeline,
     public.transactions, public.notifications, public.wishlists, public.addresses,
     public.vendor_documents, public.support_messages, public.support_replies,
     public.push_subscriptions, public.disputes, public.order_refunds,
     public.bale_refunds, public.fulfillment_events, public.payment_sessions,
     public.vendor_payouts, public.promo_redemptions, public.analytics_events,
     public.admin_audit_log
  to authenticated;

-- The admin workload view (0028) is `security_invoker = on`, so it needs its own
-- grant; the blanket revoke above covers views too.
grant select on public.support_queue to authenticated;

-- Deliberately NOT granted to clients: `rate_limits` (service-only counters) and
-- every write verb on the money tables (`transactions`, `orders`, `order_items`,
-- `vendor_payouts`, `payment_sessions`, `order_refunds`, `bale_refunds`,
-- `bale_listings`, `bale_bookings`, `fulfillment_events`, `admin_audit_log`,
-- `promo_redemptions`, `reviews`). Those rows are written by SECURITY DEFINER
-- RPCs and Edge Functions only — docs/ENGINEERING-STANDARDS.md §4.

-- ------------------------------------------------------- the client write set
-- Exactly what apps/web does from the browser. Anything absent here is denied
-- with 42501 before RLS is even consulted.

-- Public analytics + guest support (both accept signed-out traffic).
grant insert on public.analytics_events to anon, authenticated;
grant insert on public.support_messages to anon, authenticated;

-- Support: the author writes the thread, admins move its state (RLS
-- "support admin update" is what actually limits this to admins).
grant update (status, resolved_at, first_response_at, last_activity_at)
  on public.support_messages to authenticated;
grant insert on public.support_replies to authenticated;

-- Buyer-local state.
grant insert, delete on public.wishlists to authenticated;
grant insert, delete on public.push_subscriptions to authenticated;
grant update (profile_id, endpoint, p256dh_key, auth_key, user_agent)
  on public.push_subscriptions to authenticated;   -- upsert on conflict (endpoint)
grant insert, update, delete on public.addresses to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Account and seller onboarding. `profiles.role` is NOT in the list: it is
-- written by `handle_new_user()` (SECURITY DEFINER) and by vendor-onboard /
-- admin-action running as service_role.
grant update (full_name, phone, city, avatar_url) on public.profiles to authenticated;
grant insert on public.vendor_profiles to authenticated;
grant update (shop_name, city, market_address, bank_code, account_number, account_name, subscription_plan)
  on public.vendor_profiles to authenticated;
grant insert on public.vendor_documents to authenticated;

-- Catalogue. Insert is constrained by RLS to status in ('draft','pending') on an
-- approved vendor profile; the update list excludes status/views/sold_count/
-- rating_avg, which are moderation and trigger-owned.
grant insert on public.products to authenticated;
grant update (title, description, category, grade, kind, price_naira, old_price_naira,
              qty, city, weight_kg, pieces_estimate)
  on public.products to authenticated;
grant insert on public.product_images to authenticated;

-- ------------------------------------------- defence in depth: column guards
-- Grants are the primary control. These triggers are the second one: if a future
-- migration or a Dashboard "reset privileges" action hands table-level UPDATE
-- back to anon/authenticated, the protected columns still cannot be changed by
-- a client session. SECURITY DEFINER functions run as their owner (`postgres`)
-- and Edge Functions run as `service_role`, so neither hits this path.

create or replace function public.guard_protected_columns()
returns trigger
language plpgsql
as $$
declare
  v_col text;
  v_changed boolean;
  v_offenders text[] := '{}';
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  foreach v_col in array tg_argv loop
    execute format('select ($1).%I is distinct from ($2).%I', v_col, v_col)
      into v_changed
      using new, old;
    if v_changed then
      v_offenders := v_offenders || v_col;
    end if;
  end loop;

  if cardinality(v_offenders) > 0 then
    raise exception '%.% is server-managed and cannot be written from a client session',
      tg_table_name, array_to_string(v_offenders, ', ')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_protected_columns() from public, anon;
grant execute on function public.guard_protected_columns() to authenticated, service_role;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_protected_columns('role');

drop trigger if exists vendor_profiles_guard_review on public.vendor_profiles;
create trigger vendor_profiles_guard_review
  before update on public.vendor_profiles
  for each row execute function public.guard_protected_columns(
    'verification_status', 'rejection_reason', 'paystack_recipient_code',
    'subscription_status', 'inspected_at', 'strikes'
  );

drop trigger if exists products_guard_moderation on public.products;
create trigger products_guard_moderation
  before update on public.products
  for each row execute function public.guard_protected_columns(
    'status', 'views', 'sold_count', 'rating_avg'
  );

-- ------------------------------------------------------ policy tightenings

-- A buyer opening a dispute used to be checked only against `buyer_id =
-- auth.uid()`, so the row could name *anyone's* order. An open dispute freezes
-- that order's escrow auto-release (0023), which made it a griefing vector:
-- insert a dispute against a stranger's order and their money never releases.
-- Clients no longer hold INSERT on `disputes` at all (disputes are opened
-- through `order-action` as service_role), but the policy is tightened too so a
-- future re-grant cannot reopen the hole.
drop policy if exists "disputes buyer insert" on public.disputes;
create policy "disputes buyer insert" on public.disputes for insert
  with check (
    buyer_id = auth.uid()
    and status = 'open'
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.buyer_id = auth.uid()
    )
  );

-- `push_subscriptions` had owner read/insert/delete but no update policy, so the
-- browser's `upsert(..., { onConflict: "endpoint" })` was denied by RLS whenever
-- the endpoint already existed — rotated keys were never persisted and push
-- silently stopped reaching that device.
drop policy if exists "push owner update" on public.push_subscriptions;
create policy "push owner update" on public.push_subscriptions for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ------------------------------------------------- defaults for new tables
-- A table created after this migration should start readable (RLS filters rows)
-- and never client-writable. Writes are opt-in, per table, in a migration.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  grant select on tables to anon, authenticated;
alter default privileges for role postgres in schema public
  grant all on tables to service_role;
