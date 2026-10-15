-- ============================================================================
-- Migration 0038 — Payout batching + auto-reconciliation (N-8 / G-9)
-- ============================================================================

-- Batch field on vendor_payouts for grouping weekly payouts.
alter table public.vendor_payouts
  add column if not exists batch_id uuid default gen_random_uuid(),
  add column if not exists batch_date date default now();

create index if not exists idx_payouts_batch on public.vendor_payouts (batch_id);
