-- ============================================================================
-- Bale Drop — support becomes a thread, not a one-way form. Apply after 0027.
--
-- 0020 gave support a queue, but the only admin action was "mark resolved" and
-- the only reply channel was a `mailto:` link, so nothing was recorded and the
-- roadmap's "median first response tracked" (M-8) was unmeasurable. This adds
-- the reply side: an admin reply is stored, notifies the buyer in-app, stamps
-- `first_response_at`, and reopens a resolved thread when the buyer answers.
-- ============================================================================

alter table public.support_messages
  add column if not exists first_response_at timestamptz,
  add column if not exists last_activity_at timestamptz;

create table if not exists public.support_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.support_messages (id) on delete cascade,
  author_profile_id uuid not null references public.profiles (id) on delete cascade,
  from_team boolean not null default false,
  body text not null,
  created_at timestamptz not null default now(),
  constraint support_replies_body_len check (char_length(body) between 2 and 4000),
  constraint support_replies_size check (pg_column_size(body) < 8192)
);

create index if not exists support_replies_message_idx
  on public.support_replies (message_id, created_at);

alter table public.support_replies enable row level security;

-- The person who asked can read the thread back.
create policy "replies author read" on public.support_replies for select
  using (exists (
    select 1 from public.support_messages m
    where m.id = message_id and m.profile_id = auth.uid()
  ));

-- Admins read and write the queue.
create policy "replies admin read" on public.support_replies for select
  using (public.is_admin());
create policy "replies admin insert" on public.support_replies for insert
  with check (public.is_admin() and author_profile_id = auth.uid() and from_team);

-- A buyer may answer their own thread (which reopens it).
create policy "replies buyer insert" on public.support_replies for insert
  with check (
    from_team = false
    and author_profile_id = auth.uid()
    and exists (
      select 1 from public.support_messages m
      where m.id = message_id and m.profile_id = auth.uid()
    )
  );

revoke all on public.support_replies from anon;
grant select, insert on public.support_replies to authenticated;

-- Replies are immutable: an audit trail you can edit is not an audit trail.
revoke update, delete on public.support_replies from authenticated;

-- ---------- bookkeeping + notification ----------

create or replace function public.handle_support_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message public.support_messages%rowtype;
  v_author_name text;
begin
  select * into v_message from public.support_messages where id = new.message_id;
  if not found then
    raise exception 'support thread not found';
  end if;

  -- The claim in the insert policies is re-checked here because this function
  -- runs as definer: `from_team` must match the author's actual role.
  if new.from_team <> (
    select p.role = 'admin' from public.profiles p where p.id = new.author_profile_id
  ) then
    raise exception 'reply origin does not match the author role';
  end if;

  update public.support_messages
  set last_activity_at = now(),
      first_response_at = case
        when new.from_team and first_response_at is null then now()
        else first_response_at
      end,
      -- A buyer answering a resolved thread reopens it; a team reply to an
      -- open thread leaves it open.
      status = case
        when new.from_team then status
        when status = 'resolved' then 'open'
        else status
      end,
      resolved_at = case when new.from_team then resolved_at else null end
  where id = v_message.id;

  if new.from_team and v_message.profile_id is not null then
    select coalesce(nullif(trim(p.full_name), ''), 'our team')
    into v_author_name
    from public.profiles p where p.id = new.author_profile_id;

    insert into public.notifications (profile_id, title, body, href)
    values (
      v_message.profile_id,
      'Support replied',
      format('%s answered your message about %s.', v_author_name, v_message.topic),
      '/support'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists support_reply_bookkeeping on public.support_replies;
create trigger support_reply_bookkeeping
  after insert on public.support_replies
  for each row execute function public.handle_support_reply();

-- ---------- first-response reporting ----------

-- One row per open/recent thread for the admin queue: age, whether anyone has
-- answered, and how long the first answer took. Median first response (M-8) is
-- a plain aggregate over `first_response_seconds`.
create or replace view public.support_queue as
select
  m.id,
  m.name,
  m.email,
  m.topic,
  m.body,
  m.order_ref,
  m.status,
  m.profile_id,
  m.created_at,
  m.resolved_at,
  m.first_response_at,
  m.last_activity_at,
  round(extract(epoch from (now() - m.created_at)))::int as age_seconds,
  round(extract(epoch from (m.first_response_at - m.created_at)))::int as first_response_seconds,
  (select count(*) from public.support_replies r where r.message_id = m.id) as reply_count,
  (select count(*) from public.support_replies r where r.message_id = m.id and r.from_team) as team_reply_count
from public.support_messages m;

alter view public.support_queue set (security_invoker = on);

-- Same visibility as the table: the author sees their own thread, admins see
-- the queue. `security_invoker` means the view inherits the caller's RLS.
grant select on public.support_queue to authenticated;
