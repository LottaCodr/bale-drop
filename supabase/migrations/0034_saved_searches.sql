-- ============================================================================
-- Migration 0034 — Saved searches / alerts (N-4)
--
-- Buyers can save filter combinations (category, grade, price cap, city)
-- and receive a notification when a new active product matches. Best-effort:
-- no real-time push pipeline required for v1; the match runs from the search
-- RPC or a lightweight Edge Function that reads the saved filters.
-- ============================================================================

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null default 'Saved search',
  query_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: owner read/update/delete; no direct insert by clients (use RPC for audit).
create policy "saved_searches owner" on public.saved_searches for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Trigger for updated_at.
create trigger set_updated_at before update on public.saved_searches
  for each row execute function public.handle_updated_at();

-- Index for quick lookup by profile.
create index if not exists idx_saved_searches_profile
  on public.saved_searches (profile_id);

comment on table public.saved_searches is
  'Saved filter combinations for alerts. Client writes through RPC or direct insert (simple search has no money impact).';
