-- ============================================================================
-- Bale Drop — web push subscriptions. Apply after 0028_support_threads.sql.
--
-- G-7 / N-3: the urgency loop behind a 10-minute slot reservation cannot wait
-- for a buyer to reopen the site. Notifications already exist in-app (0019);
-- this is the delivery channel that reaches a closed tab.
--
-- Only the browser's own subscription object is stored — endpoint plus the two
-- WebCrypto keys — and only its owner can read or delete it. Sending happens
-- server-side in the `push-send` Edge Function with the VAPID keys, which
-- never reach the database.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh_key text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint push_subscriptions_endpoint_len check (char_length(endpoint) between 20 and 2048),
  constraint push_subscriptions_key_len check (char_length(p256dh_key) between 20 and 512 and char_length(auth_key) between 10 and 256),
  constraint push_subscriptions_ua_len check (user_agent is null or char_length(user_agent) <= 400)
);

create unique index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);
create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id, created_at desc);

alter table public.push_subscriptions enable row level security;

create policy "push owner read" on public.push_subscriptions for select
  using (profile_id = auth.uid());
create policy "push owner insert" on public.push_subscriptions for insert
  with check (profile_id = auth.uid());
create policy "push owner delete" on public.push_subscriptions for delete
  using (profile_id = auth.uid());
-- Deliberately no update policy: a subscription is replaced by re-subscribing,
-- and `last_used_at` is written by the sender (service role).

revoke all on public.push_subscriptions from anon;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- Called by `push-send` after a delivery attempt so a stale endpoint can be
-- pruned (browsers rotate them; a 410 means "gone").
create or replace function public.mark_push_delivery(
  p_endpoint text,
  p_drop boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_drop then
    delete from public.push_subscriptions where endpoint = p_endpoint returning id into v_id;
    return jsonb_build_object('dropped', v_id is not null, 'endpoint_hash', md5(coalesce(p_endpoint, '')));
  end if;
  update public.push_subscriptions
  set last_used_at = now()
  where endpoint = p_endpoint
  returning id into v_id;
  return jsonb_build_object('marked', v_id is not null);
end;
$$;

revoke all on function public.mark_push_delivery(text, boolean) from public, anon, authenticated;
grant execute on function public.mark_push_delivery(text, boolean) to service_role;

-- The sender needs every endpoint for a profile regardless of who is calling.
create or replace function public.list_push_endpoints(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh_key, 'auth', auth_key)),
    '[]'::jsonb
  )
  from public.push_subscriptions
  where profile_id = p_profile_id;
$$;

revoke all on function public.list_push_endpoints(uuid) from public, anon, authenticated;
grant execute on function public.list_push_endpoints(uuid) to service_role;
