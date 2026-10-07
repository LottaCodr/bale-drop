-- ============================================================================
-- Bale Drop — abuse controls: rate limiting, upload caps, support throttling.
-- Apply after 0026_fulltext_search.sql.
--
-- Roadmap M-6 / G-4: "Limits enforced at the Edge Function + Auth level,
-- logged, tested with a burst." Edge Functions run on many isolates, so an
-- in-memory counter is not a limit — the counter lives in Postgres, where it is
-- atomic (the upsert takes a row lock) and queryable after an incident.
--
-- Everything here is deliberately cheap: one row per bucket per window, pruned
-- by the same cron that expires stale payments.
-- ============================================================================

create table if not exists public.rate_limits (
  bucket text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);

alter table public.rate_limits enable row level security;
-- No policies: only the service role (BYPASSRLS) can read or write. A buyer
-- must not be able to inspect or reset someone else's counter.

create or replace function public.check_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := left(coalesce(p_bucket, ''), 180);
  v_window interval;
  v_hits int;
  v_window_start timestamptz;
  v_allowed boolean;
  v_retry_after int;
begin
  if v_bucket = '' then raise exception 'a rate limit bucket is required'; end if;
  if p_limit < 1 or p_limit > 100000 then raise exception 'invalid limit'; end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then raise exception 'invalid window'; end if;

  v_window := make_interval(secs => p_window_seconds);

  insert into public.rate_limits as rl (bucket, window_start, hits)
  values (v_bucket, now(), 1)
  on conflict (bucket) do update
    set hits = case
                 when rl.window_start < now() - v_window then 1
                 else rl.hits + 1
               end,
        window_start = case
                         when rl.window_start < now() - v_window then now()
                         else rl.window_start
                       end
  returning rl.hits, rl.window_start into v_hits, v_window_start;

  v_allowed := v_hits <= p_limit;
  v_retry_after := case
    when v_allowed then 0
    else greatest(1, ceil(extract(epoch from (v_window_start + v_window - now())))::int)
  end;

  return jsonb_build_object(
    'allowed', v_allowed,
    'hits', v_hits,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - v_hits),
    'retry_after_seconds', v_retry_after
  );
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, int, int) to service_role;

-- Housekeeping for the cron: drop windows that can no longer be hit.
create or replace function public.prune_rate_limits(p_older_than_minutes int default 180)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed int;
begin
  delete from public.rate_limits
  where window_start < now() - make_interval(mins => greatest(1, p_older_than_minutes));
  get diagnostics v_removed = row_count;
  return jsonb_build_object('pruned', v_removed);
end;
$$;

revoke all on function public.prune_rate_limits(int) from public, anon, authenticated;
grant execute on function public.prune_rate_limits(int) to service_role;

-- ============================================================================
-- Upload caps. The client checks size before uploading, but a client check is
-- not a control: the Storage insert policies are the enforcement point.
-- `metadata->>'size'` / `'mimetype'` are populated by the Storage API on write.
-- ============================================================================

create or replace function public.upload_within_limits(
  p_metadata jsonb,
  p_max_bytes bigint,
  p_allowed_mime_prefixes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- A missing/invalid size is treated as too large: fail closed.
    coalesce(nullif(regexp_replace(coalesce(p_metadata ->> 'size', ''), '[^0-9]', '', 'g'), '')::bigint, p_max_bytes + 1)
      between 1 and p_max_bytes
    and exists (
      select 1
      from unnest(p_allowed_mime_prefixes) as allowed(prefix)
      where coalesce(p_metadata ->> 'mimetype', '') like prefix || '%'
    );
$$;

revoke all on function public.upload_within_limits(jsonb, bigint, text[]) from public;
grant execute on function public.upload_within_limits(jsonb, bigint, text[]) to authenticated, service_role;

-- Listing photos: 5 MB, images only.
drop policy if exists "product images owner insert" on storage.objects;
create policy "product images owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_within_limits(metadata, 5242880, array['image/'])
  );

-- KYC documents: 10 MB, images or PDF.
drop policy if exists "vendor docs owner insert" on storage.objects;
create policy "vendor docs owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_within_limits(metadata, 10485760, array['image/', 'application/pdf'])
  );

-- Dispute evidence: 5 MB each, images or PDF (the UI already caps at 5 files).
drop policy if exists "dispute evidence owner insert" on storage.objects;
create policy "dispute evidence owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'dispute-evidence'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_within_limits(metadata, 5242880, array['image/', 'application/pdf'])
  );

-- ============================================================================
-- Support throttling. `support_messages` is guest-insertable (0020), so the
-- only server-side identity we have for an anonymous writer is their email;
-- for a signed-in writer it is their profile id. 3 messages per hour per
-- identity is generous for a human and expensive for a script.
-- ============================================================================

create or replace function public.handle_support_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity text;
  v_result jsonb;
begin
  v_identity := coalesce(
    new.profile_id::text,
    nullif(lower(trim(new.email)), '')
  );
  if v_identity is null then
    raise exception 'a support message needs a sender';
  end if;

  v_result := public.check_rate_limit('support:' || v_identity, 3, 3600);
  if not (v_result ->> 'allowed')::boolean then
    raise exception 'too many support messages — try again in % minutes',
      greatest(1, ((v_result ->> 'retry_after_seconds')::int + 59) / 60);
  end if;
  return new;
end;
$$;

drop trigger if exists support_message_rate_limit on public.support_messages;
create trigger support_message_rate_limit
  before insert on public.support_messages
  for each row execute function public.handle_support_message_rate_limit();
