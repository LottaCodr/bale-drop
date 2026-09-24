-- ============================================================================
-- Bale Drop — live notifications (Realtime) + read-state hardening.
-- Apply after 0018_wishlists_and_analytics.sql.
--
-- The bell used to be poll-on-mount only: a buyer who paid for a slot sat on a
-- stale page because the "you're in" notification existed in the database but
-- the browser never heard about it. Every notification insert in this schema
-- comes from a SECURITY DEFINER RPC / Edge Function (`paid`, `order_paid`,
-- `bale_refunded`, `payout_settled`, `dispute_opened`, …), so the stream is
-- already trustworthy — it just had to be published.
--
-- Publishing a table means every subscriber sees the rows RLS lets them read,
-- so the policies in 0001 (owner read / owner update) are load-bearing here:
-- a subscriber only ever receives their own `profile_id`.
-- ============================================================================

-- ---------- realtime ----------

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- Realtime REPLICA IDENTITY: the default (primary key) is enough for INSERT,
-- and prevents old row payloads from being broadcast on UPDATE. Marking read
-- only sends the new row — enough for the badge to decrement.
alter table public.notifications replica identity default;

-- Bell queries are `where profile_id = ? and read_at is null order by created_at`.
-- The 0001 index is (profile_id, read_at); this partial index keeps the unread
-- count cheap even for a buyer with years of notification history.
create index if not exists notifications_unread_idx
  on public.notifications (profile_id, created_at desc)
  where read_at is null;

-- ---------- read-state integrity ----------

-- `read_at` is the only mutable column and it is client-settable under the
-- owner-update policy. Without a guard a client could POST read_at = null to
-- resurrect a read notification, or pre-date it to hide from the unread list.
-- Stamp the transition server-side and leave everything else immutable.
create or replace function public.touch_notification_read()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.read_at is distinct from old.read_at then
    -- Allow null → timestamp (mark read). Anything else (unread-again, or a
    -- future/backdated stamp) is overwritten with "now".
    if old.read_at is not null or new.read_at is null then
      new.read_at := old.read_at;
    else
      new.read_at := now();
    end if;
  end if;
  -- Notifications are an append-only audit trail: body/title/href never change.
  new.id := old.id;
  new.profile_id := old.profile_id;
  new.title := old.title;
  new.body := old.body;
  new.href := old.href;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists notifications_guard_update on public.notifications;
create trigger notifications_guard_update
  before update on public.notifications
  for each row execute function public.touch_notification_read();

-- The web app marks notifications read with a plain UPDATE (`markNotificationRead()`
-- in apps/web/lib/notifications.ts) — the owner-update policy plus the trigger
-- above make that safe. These RPCs are for clients that should not hold UPDATE
-- on the table at all (mobile app, future admin tooling), and they are the
-- supported path if the UPDATE policy is ever revoked.
create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
     set read_at = now()
   where id = p_id
     and profile_id = auth.uid()
     and read_at is null;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  update public.notifications
     set read_at = now()
   where profile_id = auth.uid()
     and read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------- retention ----------
-- Notifications are a courtesy copy of events that live in the ledger; keep the
-- table small. Schedule alongside bale-expiry / payout-reconcile:
--   delete from public.notifications
--    where created_at < now() - interval '120 days' and read_at is not null;
