-- ============================================================================
-- Migration 0036 — Referral / share codes with tracked payouts (N-6)
-- ============================================================================

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create policy "referral codes owner" on public.referral_codes for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create index if not exists idx_referral_codes_active on public.referral_codes (code) where active = true;
