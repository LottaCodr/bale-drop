-- ============================================================================
-- Bale Drop — create OR repair the demo login accounts.       (DEV/DEMO ONLY)
--
-- Run this once in Supabase → SQL Editor if signing in as a demo account
-- (buyer1@baledrop.demo, adaeze@baledrop.demo, admin@baledrop.demo …) says
-- "Invalid login credentials" or "Database error querying schema".
-- Safe to re-run; it only touches the @baledrop.demo accounts listed below.
--
-- Why the original seed broke logins (verified against supabase/auth source):
--  1. instance_id was copied from auth.instances, which is EMPTY on hosted
--     projects → NULL. GoTrue looks users up with
--     `instance_id = '00000000-0000-0000-0000-000000000000'`, so it never
--     found them and answered "Invalid login credentials".
--  2. No auth.identities row. Current GoTrue needs an `email` identity per
--     user for password sign-in.
--  3. Token columns (confirmation_token, recovery_token, email_change, …)
--     were NULL. GoTrue scans them into Go strings → 500 "Database error
--     querying schema".
--  4. handle_new_user() fired on the insert and created every profile as
--     `buyer`; the seed's own profile insert then hit ON CONFLICT DO NOTHING,
--     so vendors weren't vendors and the admin wasn't an admin.
--
-- Prefer the Admin API instead? `npm run seed:demo-users` (scripts/
-- seed-demo-users.mjs) does the same through supabase.auth.admin.
-- ============================================================================

create extension if not exists pgcrypto;
-- Hosted Supabase installs pgcrypto in the `extensions` schema.
set search_path = public, extensions;

do $$
declare
  v_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  -- Cost 10 = GoTrue's own bcrypt cost (no silent rehash on first login).
  v_hash text := crypt('BaleDrop123!', gen_salt('bf', 10));
  u record;
begin
  for u in select * from (values
    ('10000000-0000-0000-0000-000000000001'::uuid, 'adaeze@baledrop.demo', 'vendor', 'Adaeze T.',        'Lagos'),
    ('10000000-0000-0000-0000-000000000002'::uuid, 'kano@baledrop.demo',   'vendor', 'Kano B.',          'Kano'),
    ('10000000-0000-0000-0000-000000000003'::uuid, 'ph@baledrop.demo',     'vendor', 'PH H.',            'Port Harcourt'),
    ('10000000-0000-0000-0000-000000000004'::uuid, 'abuja@baledrop.demo',  'vendor', 'Grade A.',         'Abuja'),
    ('10000000-0000-0000-0000-000000000005'::uuid, 'yaba@baledrop.demo',   'vendor', 'Yaba V.',          'Lagos'),
    ('90000000-0000-0000-0000-000000000001'::uuid, 'admin@baledrop.demo',  'admin',  'Bale Drop Admin',  'Lagos'),
    ('20000000-0000-0000-0000-000000000001'::uuid, 'buyer1@baledrop.demo', 'buyer',  'Chiamaka O.',      'Lagos'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'buyer2@baledrop.demo', 'buyer',  'Obi E.',           'Abuja'),
    ('20000000-0000-0000-0000-000000000003'::uuid, 'buyer3@baledrop.demo', 'buyer',  'Emeka A.',         'Port Harcourt'),
    ('20000000-0000-0000-0000-000000000004'::uuid, 'buyer4@baledrop.demo', 'buyer',  'Fatima S.',        'Kano'),
    ('20000000-0000-0000-0000-000000000005'::uuid, 'buyer5@baledrop.demo', 'buyer',  'Ibrahim M.',       'Kano'),
    ('20000000-0000-0000-0000-000000000006'::uuid, 'buyer6@baledrop.demo', 'buyer',  'Damilola A.',      'Lagos'),
    ('20000000-0000-0000-0000-000000000007'::uuid, 'buyer7@baledrop.demo', 'buyer',  'Tunde B.',         'Abuja'),
    ('20000000-0000-0000-0000-000000000008'::uuid, 'buyer8@baledrop.demo', 'buyer',  'Segun K.',         'Lagos'),
    ('20000000-0000-0000-0000-000000000009'::uuid, 'buyer9@baledrop.demo', 'buyer',  'Ngozi U.',         'Port Harcourt')
  ) as t(id, email, role, full_name, city)
  loop
    -- Someone may have signed this email up by hand under another id; the
    -- rest of the seed references the fixed ids, so leave that row alone.
    if exists (select 1 from auth.users where lower(email) = u.email and id <> u.id) then
      raise warning 'Skipping %: already registered with a different id. Delete that user in Authentication → Users and re-run.', u.email;
      continue;
    end if;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      v_nil, u.id, 'authenticated', 'authenticated', u.email, v_hash, now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object(
        'full_name', u.full_name, 'city', u.city, 'email_verified', true,
        -- only 'vendor' is honoured by handle_new_user(); admin is set below
        'role', case when u.role = 'vendor' then 'vendor' else 'buyer' end,
        'onboarded', true
      ),
      now(), now(),
      '', '', '', '', '', '', '', ''
    )
    on conflict (id) do update set
      instance_id                = excluded.instance_id,
      aud                        = excluded.aud,
      role                       = excluded.role,
      email                      = excluded.email,
      encrypted_password         = excluded.encrypted_password,
      email_confirmed_at         = coalesce(auth.users.email_confirmed_at, now()),
      raw_app_meta_data          = coalesce(auth.users.raw_app_meta_data, '{}'::jsonb) || excluded.raw_app_meta_data,
      raw_user_meta_data         = coalesce(auth.users.raw_user_meta_data, '{}'::jsonb) || excluded.raw_user_meta_data,
      confirmation_token         = coalesce(auth.users.confirmation_token, ''),
      recovery_token             = coalesce(auth.users.recovery_token, ''),
      email_change_token_new     = coalesce(auth.users.email_change_token_new, ''),
      email_change               = coalesce(auth.users.email_change, ''),
      email_change_token_current = coalesce(auth.users.email_change_token_current, ''),
      phone_change               = coalesce(auth.users.phone_change, ''),
      phone_change_token         = coalesce(auth.users.phone_change_token, ''),
      reauthentication_token     = coalesce(auth.users.reauthentication_token, ''),
      banned_until               = null,
      updated_at                 = now();

    -- The email identity GoTrue requires for password sign-in.
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), u.id, u.id::text, 'email',
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
      now(), now(), now()
    )
    on conflict (provider_id, provider) do update set
      user_id       = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at    = now();

    -- The signup trigger defaults to buyer — force the intended role.
    insert into public.profiles (id, role, full_name, city)
    values (u.id, u.role, u.full_name, u.city)
    on conflict (id) do update set
      role      = excluded.role,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      city      = coalesce(public.profiles.city, excluded.city);
  end loop;
end $$;

-- Sanity check: every row should say ok = true.
select
  u.email,
  p.role,
  (u.instance_id = '00000000-0000-0000-0000-000000000000'
    and u.email_confirmed_at is not null
    and u.confirmation_token is not null
    and u.recovery_token is not null
    and u.email_change is not null
    and u.email_change_token_new is not null
    and exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email')
  ) as ok
from auth.users u
left join public.profiles p on p.id = u.id
where u.email like '%@baledrop.demo'
order by p.role, u.email;
