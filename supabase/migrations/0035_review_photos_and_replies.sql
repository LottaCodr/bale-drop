-- ============================================================================
-- Migration 0035 — Review photos + vendor replies (N-5)
-- ============================================================================

-- Photos uploaded with a review (buyer evidence / satisfaction proof).
create table if not exists public.review_photos (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  storage_path text not null, -- public review-photos bucket
  created_at timestamptz not null default now()
);

create policy "review photos public" on public.review_photos for select using (true);
create policy "review photos buyer insert" on public.review_photos for insert
  with check (
    exists (
      select 1 from public.reviews r
      where r.id = review_id and r.buyer_id = auth.uid()
    )
  );

-- Vendor replies to reviews (public, moderated by service_role only for removal).
create table if not exists public.review_replies (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews (id) on delete cascade,
  vendor_id uuid not null references public.vendor_profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at before update on public.review_replies
  for each row execute function public.handle_updated_at();

create policy "review replies public" on public.review_replies for select using (true);
create policy "review replies vendor insert" on public.review_replies for insert
  with check (
    vendor_id in (select vp.id from public.vendor_profiles vp where vp.profile_id = auth.uid())
  );
