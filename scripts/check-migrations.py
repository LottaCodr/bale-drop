#!/usr/bin/env python3
"""Run every supabase/migrations/*.sql against a real PostgreSQL and report errors.

Vanilla Postgres has no Supabase, so we stub the pieces the migrations touch:
the `auth` and `storage` schemas, the three PostgREST roles, and the
`supabase_realtime` publication. The stub grants `anon`/`authenticated` the same
table privileges Supabase's platform defaults do, so a scenario can only pass
because RLS, a column grant or a trigger stopped it.

Usage:
    check-migrations.py                 all migrations, then every scenario
    check-migrations.py rls_audit       all migrations, then matching scenarios

All migrations always run: the scenarios assert against the full schema, so a
partial migration list would fail for the wrong reason. Arguments therefore
select *scenarios*, and a filter that matches nothing is a hard error rather
than a silent pass.
"""
import sys
import pathlib
import pgserver

REPO = pathlib.Path("/home/user/bale-drop")
MIGRATIONS = sorted((REPO / "supabase" / "migrations").glob("*.sql"))

BOOTSTRAP = r"""
create schema if not exists auth;
create schema if not exists storage;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role supabase_auth_admin nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role supabase_storage_admin nologin;
exception when duplicate_object then null;
end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists auth.identities (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  provider text,
  identity_data jsonb,
  provider_id text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists auth.refresh_tokens (
  id bigint generated always as identity primary key,
  token text,
  user_id uuid,
  revoked boolean default false,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Supabase enables RLS on storage.objects and grants the API roles DML on it;
-- the bucket policies in 0003/0005/0027/0032 are the only thing standing between
-- an access token and someone else's KYC upload. Without this the stub would
-- silently skip every storage policy.
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

create or replace function storage.extension(name text) returns text
language sql immutable as $$ select reverse(split_part(reverse(name), '.', 1)) $$;

do $$ begin
  create publication supabase_realtime;
exception when duplicate_object then null;
end $$;

-- Supabase's service_role bypasses RLS; the stub must match or every
-- Edge-Function-shaped write in the scenarios would be denied.
alter role service_role bypassrls;

grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant all on all tables in schema auth, storage to service_role;
-- Supabase grants ALL on every public table to anon/authenticated/service_role
-- (default privileges on the `postgres` role) and relies on RLS -- not grants --
-- as the security boundary. The stub must match, or a scenario could "pass"
-- because a role merely lacks a table grant it would have in production. The
-- column-level revokes in 0005 (products.status, profiles.role, ...) only mean
-- something against this permissive baseline.
grant all on all tables in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to service_role;
alter default privileges in schema public grant all on sequences to service_role;
"""


CHECK_DB = "bale_drop_check"


def main() -> int:
    import subprocess
    from pgserver._commands import POSTGRES_BIN_PATH

    only = sys.argv[1:] or None
    server = pgserver.get_server("/tmp/pgdata-baledrop", cleanup_mode=None)
    psql_bin = str(POSTGRES_BIN_PATH / "psql")
    admin_uri = server.get_uri()

    def run(*args: str, uri: str = admin_uri) -> subprocess.CompletedProcess:
        return subprocess.run(
            [psql_bin, uri, "-v", "ON_ERROR_STOP=1", "-q", *args],
            capture_output=True, text=True,
        )

    # Migrations are written to run once, in order, on an empty database: a
    # second pass legitimately fails on `create table` / `create policy`. So the
    # gate runs against a scratch database that is dropped and recreated here —
    # otherwise a re-run reports "already exists" and looks like schema drift.
    reset = run(
        "-c", f"drop database if exists {CHECK_DB}",
        "-c", f"create database {CHECK_DB}",
    )
    if reset.returncode != 0:
        print("COULD NOT CREATE SCRATCH DATABASE\n", reset.stdout, reset.stderr)
        return 1

    # pgserver hands back `postgresql://user:@/dbname?host=/socket/dir`: swap the
    # database name and keep the socket path, which contains slashes of its own.
    base, _, query = admin_uri.partition("?")
    uri = f"{base.rsplit('/', 1)[0]}/{CHECK_DB}" + (f"?{query}" if query else "")

    def run(*args: str) -> subprocess.CompletedProcess:  # noqa: F811 - now bound to the scratch db
        return subprocess.run(
            [psql_bin, uri, "-v", "ON_ERROR_STOP=1", "-q", *args],
            capture_output=True, text=True,
        )

    print("PostgreSQL:", uri)
    bootstrap = run("-c", BOOTSTRAP)
    if bootstrap.returncode != 0:
        print("BOOTSTRAP FAILED\n", bootstrap.stdout, bootstrap.stderr)
        return 1
    print("bootstrap ok\n")

    failures = 0
    for path in MIGRATIONS:
        result = run("-f", str(path))
        if result.returncode == 0:
            print(f"  ok   {path.name}")
        else:
            failures += 1
            print(f"  FAIL {path.name}")
            print("  " + "\n  ".join((result.stderr or result.stdout).strip().splitlines()[-14:]))

    scenarios = sorted((REPO / "supabase" / "tests").glob("*.sql"))
    selected = [p for p in scenarios if not only or any(t in p.name for t in only)]
    if only and not selected:
        print(f"\nNOTHING MATCHED {only} — no scenario ran, so this is not a pass")
        return 1
    if selected:
        print("\nscenarios (rolled back, no data is kept):")
        for path in selected:
            result = run("-f", str(path))
            notices = [
                line.strip() for line in (result.stderr or "").splitlines()
                if "PASS:" in line or "ERROR" in line or "exception" in line
            ]
            if result.returncode == 0:
                print(f"  ok   {path.name}")
                for line in notices:
                    print(f"       {line.replace('NOTICE:  ', '')}")
            else:
                failures += 1
                print(f"  FAIL {path.name}")
                print("  " + "\n  ".join((result.stderr or result.stdout).strip().splitlines()[-16:]))

    print()
    print("failures:", failures)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
