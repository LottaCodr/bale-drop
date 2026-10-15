-- ============================================================================
-- Migration 0040 — Waitlists (N-10)
-- ============================================================================

create table if not exists public.waitlists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, product_id)
);

create policy "waitlists owner" on public.waitlists for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
