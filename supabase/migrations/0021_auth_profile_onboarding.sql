-- ============================================================================
-- Bale Drop — signup trigger fit for OAuth onboarding.
--
-- Google (and most OIDC providers) send `name` / `picture`, not the
-- `full_name` / `avatar_url` keys our email signup uses, so Google users got
-- a profile with no name and the /welcome step had nothing to pre-fill.
-- Role handling is unchanged and still safe: only 'vendor' is honoured from
-- client-controlled metadata; everything else becomes 'buyer' (admin is only
-- ever granted server-side).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, full_name, phone, city, avatar_url)
  values (
    new.id,
    case when meta ->> 'role' = 'vendor' then 'vendor' else 'buyer' end,
    nullif(left(btrim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), 120), ''),
    nullif(left(btrim(coalesce(meta ->> 'phone', '')), 32), ''),
    nullif(left(btrim(coalesce(meta ->> 'city', '')), 64), ''),
    nullif(coalesce(meta ->> 'avatar_url', meta ->> 'picture', ''), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger functions must not be callable through the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;
