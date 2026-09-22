-- ============================================================================
-- Bale Drop — denormalized storefront metrics + Realtime publication.
-- Ratings/sales counters live here so listing pages never run aggregations.
-- (Production: maintain via triggers on reviews/orders; seed sets values.)
-- ============================================================================

alter table public.vendor_profiles add column if not exists rating_avg numeric(2, 1) not null default 0;
alter table public.vendor_profiles add column if not exists reviews_count int not null default 0;
alter table public.vendor_profiles add column if not exists sales_count int not null default 0;

alter table public.products add column if not exists sold_count int not null default 0;
alter table public.products add column if not exists rating_avg numeric(2, 1) not null default 0;

-- Live slot counters need these tables on the Realtime publication.
-- (Also enable via Dashboard → Database → Replication as a visual check.)
do $$ begin
  alter publication supabase_realtime add table public.bale_listings;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.bale_bookings;
exception when duplicate_object then null;
end $$;
