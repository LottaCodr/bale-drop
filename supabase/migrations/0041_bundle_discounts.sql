-- ============================================================================
-- Migration 0041 — Bundle / multi-slot discounts (N-12)
-- ============================================================================

create table if not exists public.bundle_discounts (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  min_qty int not null default 2,
  discount_percent int not null check (discount_percent > 0 and discount_percent <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
