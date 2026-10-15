-- ============================================================================
-- Migration 0044 — Storage image transforms / CDN (N-16)
-- ============================================================================

-- Confirm the image-transforms policy and host allowlist exist.
-- The `product-images` bucket (0003) and its RLS policies (0032) are in place.
-- This migration just documents the CDN host used for image transforms.

comment on table public.product_images is
  'Image transforms served via CDN: https://<project>.supabase.co/storage/v1/object/public/product-images/<path>?width=400&quality=80';
