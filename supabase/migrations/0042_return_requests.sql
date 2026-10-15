-- ============================================================================
-- Migration 0042 — Returns portal / RMA (N-13)
-- ============================================================================

create table if not exists public.return_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.return_requests
  for each row execute function public.handle_updated_at();

create policy "return_requests buyer" on public.return_requests for all
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
