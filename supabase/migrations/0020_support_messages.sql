-- ============================================================================
-- Bale Drop — support messages (the human door after the automated ones).
-- Apply after 0019_live_notifications.sql.
--
-- Before this, the only route to a human was email/WhatsApp copy in the footer,
-- which means a dispute that arrives by WhatsApp has no audit trail and no
-- queue. One table fixes both: signed-in buyers and guests can write, the
-- author (or an admin) can read it back, and admins resolve it with a status.
-- ============================================================================

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: a guest who never signed in can still ask a question.
  profile_id uuid references public.profiles (id) on delete set null,
  name text not null,
  email text not null,
  topic text not null default 'general',
  body text not null,
  -- Optional free-text order reference (BD-2019, a booking id, …). Deliberately
  -- not a foreign key: buyers quote references that may be from a deleted order.
  order_ref text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint support_messages_topic check (topic in ('order', 'delivery', 'refund', 'vendor', 'account', 'general')),
  constraint support_messages_status check (status in ('open', 'resolved')),
  constraint support_messages_name_len check (char_length(name) between 2 and 80),
  constraint support_messages_email_len check (char_length(email) between 5 and 160),
  constraint support_messages_body_len check (char_length(body) between 10 and 4000),
  constraint support_messages_ref_len check (order_ref is null or char_length(order_ref) <= 40),
  -- Same guard rail as analytics: no file payloads, no cards, no password dumps.
  constraint support_messages_size check (pg_column_size(body) < 8192)
);

create index if not exists support_messages_status_idx on public.support_messages (status, created_at desc);
create index if not exists support_messages_profile_idx on public.support_messages (profile_id, created_at desc);

alter table public.support_messages enable row level security;

-- Anyone (including signed-out visitors) may open a message, but only as
-- themselves: a claimed profile_id must match the JWT.
create policy "support insert anyone" on public.support_messages for insert
  with check (profile_id is null or profile_id = auth.uid());

-- The author can read their own thread back (order status page shows it).
create policy "support author read" on public.support_messages for select
  using (profile_id = auth.uid());

-- Admins run the queue: read everything, resolve items.
create policy "support admin read" on public.support_messages for select
  using (public.is_admin());
create policy "support admin update" on public.support_messages for update
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.support_messages from anon, authenticated;
grant insert on public.support_messages to anon, authenticated;
grant select on public.support_messages to authenticated;
grant update on public.support_messages to authenticated;

-- Retention: resolved threads older than a year carry no operational value.
-- Schedule alongside bale-expiry / payout-reconcile:
--   delete from public.support_messages
--    where status = 'resolved' and resolved_at < now() - interval '365 days';
