-- ============================================================================
-- Migration 0043 — Vendor scorecards (N-14)
-- ============================================================================

create table if not exists public.vendor_scorecards (
  vendor_id uuid primary key references public.vendor_profiles (id) on delete cascade,
  dispatch_time_avg_hours int,
  dispute_rate_percent numeric(5,2) default 0,
  response_time_hours int,
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.vendor_scorecards
  for each row execute function public.handle_updated_at();
