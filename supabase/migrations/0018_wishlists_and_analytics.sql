-- ============================================================================
-- Bale Drop — saved items (wishlist) + first-party funnel analytics.
-- Apply after 0017_is_admin_execute_grant.sql.
--
-- Wishlists close a real gap in the storefront: the heart buttons on cards and
-- listing pages had nowhere to persist, so "saved" items vanished on refresh.
-- analytics_events gives every funnel step a durable home (view → add to cart →
-- begin checkout → purchase → claim slot) instead of only living in a tag
-- manager, which the marketplace research (docs/ROADMAP.md) shows is how you
-- find the leaks worth fixing.
-- ============================================================================

-- ---------- wishlists ----------

create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One save per (buyer, product): makes the client upsert idempotent.
create unique index if not exists wishlists_profile_product_unique
  on public.wishlists (profile_id, product_id);
create index if not exists wishlists_profile_idx on public.wishlists (profile_id, created_at desc);
create index if not exists wishlists_product_idx on public.wishlists (product_id);

alter table public.wishlists enable row level security;

-- Owner-only, in both directions. A wishlist is personal data; vendors and
-- other buyers must never be able to read or modify it.
create policy "wishlists owner read" on public.wishlists for select
  using (profile_id = auth.uid());
create policy "wishlists owner insert" on public.wishlists for insert
  with check (profile_id = auth.uid());
create policy "wishlists owner delete" on public.wishlists for delete
  using (profile_id = auth.uid());
-- Deliberately no UPDATE policy: a save is a row, it never mutates.

revoke all on public.wishlists from anon;
grant select, insert, delete on public.wishlists to authenticated;

-- Multi-device sync: a save on the phone appears on the laptop.
do $$ begin
  alter publication supabase_realtime add table public.wishlists;
exception when duplicate_object then null;
end $$;

-- ---------- analytics_events ----------

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: guests and signed-out browsers still produce funnel events.
  profile_id uuid references public.profiles (id) on delete set null,
  session_id text not null,
  event_name text not null,
  props jsonb not null default '{}'::jsonb,
  path text,
  created_at timestamptz not null default now(),
  constraint analytics_events_name_len check (char_length(event_name) between 1 and 64),
  constraint analytics_events_session_len check (char_length(session_id) between 1 and 64),
  -- Guard rail: funnel props are counts/ids, never payloads. Blocks abuse.
  constraint analytics_events_props_size check (pg_column_size(props) < 4096)
);

create index if not exists analytics_events_name_created_idx
  on public.analytics_events (event_name, created_at desc);
create index if not exists analytics_events_session_idx
  on public.analytics_events (session_id, created_at desc);
create index if not exists analytics_events_profile_idx
  on public.analytics_events (profile_id, created_at desc);

alter table public.analytics_events enable row level security;

-- Ordering matters: the BEFORE INSERT trigger fills profile_id from the JWT,
-- then the WITH CHECK below validates the same value. Clients cannot attribute
-- events to somebody else, and cannot read the table back.
create or replace function public.set_analytics_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.profile_id is null then
    new.profile_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists analytics_events_set_profile on public.analytics_events;
create trigger analytics_events_set_profile
  before insert on public.analytics_events
  for each row execute function public.set_analytics_profile();

create policy "analytics append own" on public.analytics_events for insert
  with check (profile_id is null or profile_id = auth.uid());
create policy "analytics admin read" on public.analytics_events for select
  using (public.is_admin());

revoke all on public.analytics_events from anon, authenticated;
grant insert on public.analytics_events to anon, authenticated;
grant select on public.analytics_events to authenticated;

-- Retention: run `delete from public.analytics_events where created_at < now() - interval '180 days'`
-- from the same scheduler that runs bale-expiry / payout-reconcile. Funnel data
-- is a diagnostic, not a ledger — money truth lives in `transactions`.
