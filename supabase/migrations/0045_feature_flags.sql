-- ============================================================================
-- Migration 0045 — Feature flags (N-18)
-- ============================================================================

create table if not exists public.feature_flags (
  flag text primary key,
  enabled boolean not null default false,
  rollout_percent int not null default 0,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.feature_flags
  for each row execute function public.handle_updated_at();
