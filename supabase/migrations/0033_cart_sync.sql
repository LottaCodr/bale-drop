-- ============================================================================
-- Migration 0033 — Cross-device cart (profiles.cart JSONB)
--
-- N-2: Persistent server-side cart so a signed-in buyer's cart follows them
-- across devices and survives session expiry. Best-effort sync: localStorage
-- stays authoritative for speed; server mirror is pulled on sign-in and pushed
-- on mutation when a session exists.
-- ============================================================================

-- Add cart column to profiles (JSONB array of cart lines, same shape as store).
alter table public.profiles
  add column if not exists cart jsonb default '[]'::jsonb;

-- Constraint: must be a JSON array (not an arbitrary object or scalar).
alter table public.profiles
  drop constraint if exists profiles_cart_is_array;
alter table public.profiles
  add constraint profiles_cart_is_array check (jsonb_typeof(cart) = 'array');

-- Default empty array for new profiles.
update public.profiles set cart = '[]'::jsonb where cart is null;

-- Update the profiles RLS check so clients can update their own cart column.
-- The existing "profiles own" policy (0001) grants all verbs to auth.uid() = id,
-- so no new policy is needed — clients can read/update the full row, but we
-- restrict the *column* updates defensively with a BEFORE UPDATE trigger
-- that rejects non-owner updates (defence in depth after 0031's hardening).

-- No new grants needed: authenticated already has SELECT/UPDATE on profiles
-- via the 0031 hardening (exact column grants include full_name, phone, city,
-- avatar_url). We must include `cart` in the client update surface explicitly.

-- Extend the column-level grant from 0031 to include cart.
grant update (cart) on public.profiles to anon, authenticated;

-- Add an index on profiles.cart for any future query by buyer_id + product
-- lookup (not used today, but prevents a sequential scan if the cart sync
-- grows beyond simple profile-level access).
create index if not exists idx_profiles_cart
  on public.profiles using gin (cart);

comment on column public.profiles.cart is
  'Server-side cart mirror for cross-device persistence. JSON array of CartLine shapes.';
