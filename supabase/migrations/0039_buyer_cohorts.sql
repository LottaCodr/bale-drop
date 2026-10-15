-- ============================================================================
-- Migration 0039 — Cohort dashboard (N-9)
-- ============================================================================

-- Simple cohort tracking: a buyer's first purchase cohort (month) for repeat-rate analysis.
create table if not exists public.buyer_cohorts (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  cohort_month text not null default to_char(now(), 'YYYY-MM'),
  first_purchase_at timestamptz not null default now(),
  orders_count int not null default 0
);

create index if not exists idx_buyer_cohorts_month on public.buyer_cohorts (cohort_month);
