-- ============================================================================
-- Migration 0037 — Paystack subaccounts + manual settlement (N-7)
-- ============================================================================

alter table public.vendor_profiles
  add column if not exists subaccount_code text,
  add column if not exists settlement_schedule text not null default 'automatic' check (settlement_schedule in ('automatic', 'manual'));

comment on column public.vendor_profiles.subaccount_code is 'Paystack subaccount code for split settlement (manual settlement schedule).';
comment on column public.vendor_profiles.settlement_schedule is 'manual = vendor controls payout timing; automatic = platform settles on delivery.';
