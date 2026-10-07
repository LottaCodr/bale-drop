-- ============================================================================
-- 0032 — Repair the Storage policies: weakened uploads, a duplicated policy, and
--        a read policy that anon cannot evaluate.
--
-- 0027 added size/mime caps by dropping and recreating the bucket INSERT
-- policies. Two of the three replacements were built from the cap alone, so the
-- entitlement checks 0005 had put there were lost, and the third was recreated
-- under a *different name*, which left two live policies behind.
--
-- 1. `product-images` — 0005 required
--        exists (select 1 from vendor_profiles vp where vp.profile_id = auth.uid())
--    with the comment "the profile check prevents buyers from using the public
--    image bucket as an upload sink". 0027 dropped that clause, so any signed-in
--    buyer could upload 5 MB images into a public bucket under their own uid
--    folder: free anonymous image hosting on our storage bill, and a way to put
--    arbitrary pictures behind a Bale Drop URL.
--
-- 2. `vendor-documents` — same loss. Any signed-in user (vendor or not) could
--    write 10 MB files into the private KYC bucket. Reads still require a vendor
--    profile, so this is storage abuse rather than disclosure, but a non-vendor
--    has no business writing KYC-shaped paths at all.
--
-- 3. `dispute-evidence` — 0027 dropped `"dispute evidence owner insert"` (which
--    never existed) and created it, while 0005's `"dispute evidence buyer
--    insert"` stayed live. Permissive policies combine with OR, so the weaker one
--    decided: any buyer could write
--        dispute-evidence/<own-uid>/<someone-elses-order-id>/anything.png
--    The uploader cannot read it back (the SELECT policy checks order ownership),
--    but the admin console reviews evidence through the `dispute-evidence` Edge
--    Function as service_role, which bypasses RLS — so a buyer could plant
--    arbitrary images or PDFs into a stranger's dispute and have them shown to
--    the admin deciding that refund.
--
-- 4. Every dispute-evidence policy tests order ownership by reading
--    `public.orders` inline. A policy expression is permission-checked as the
--    role running the query, and 0031 (correctly) no longer grants anon SELECT on
--    the money tables — so *every* anon read of storage.objects began failing
--    with 42501 "permission denied for table orders" instead of returning no
--    rows, because that policy is OR'd into the same query. This is the same trap
--    0017 fixed for `is_admin()`. The ownership test moves into a SECURITY
--    DEFINER helper below, which keeps 0031's least-privilege grant set intact.
--
-- Each policy below is the union of 0005's entitlement check and 0027's caps.
--
-- `upload_within_limits()` appears in every bucket INSERT policy, so anon needs
-- EXECUTE on it or a signed-out upload attempt fails with "permission denied for
-- function" instead of a clean RLS denial. It is a pure predicate over
-- caller-supplied metadata and exposes nothing.
--
-- Finally, the two catalogue buckets are created here rather than only in the
-- Dashboard. 0005 already created `dispute-evidence` in SQL; making all three
-- declarative removes a manual step that is easy to get wrong (`product-images`
-- must be public or every `next/image` URL 400s). Existing buckets are left
-- untouched.
-- ============================================================================

insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('vendor-documents', 'vendor-documents', false)
on conflict (id) do nothing;

-- Defined before the policies that reference it: CREATE POLICY validates its
-- expression, so the helper has to exist first. Returns a single boolean about
-- the caller and exposes no order data; `is_own_order(null)` is false, so a path
-- whose second segment is not a uuid still denies.
create or replace function public.is_own_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.buyer_id = auth.uid()
  );
$$;

revoke all on function public.is_own_order(uuid) from public;
grant execute on function public.is_own_order(uuid) to anon, authenticated, service_role;
grant execute on function public.upload_within_limits(jsonb, bigint, text[]) to anon;

-- ---------------------------------------------------------- product images --

drop policy if exists "product images owner insert" on storage.objects;
create policy "product images owner insert" on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
    and public.upload_within_limits(metadata, 5242880, array['image/'])
  );

-- --------------------------------------------------------- vendor documents --

drop policy if exists "vendor docs owner insert" on storage.objects;
create policy "vendor docs owner insert" on storage.objects for insert
  with check (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.vendor_profiles vp where vp.profile_id = auth.uid())
    and public.upload_within_limits(metadata, 10485760, array['image/', 'application/pdf'])
  );

-- --------------------------------------------------------- dispute evidence --
-- Both insert policies are dropped so exactly one remains: 0027's caps unioned
-- with 0005's order-ownership check.

drop policy if exists "dispute evidence owner insert" on storage.objects;
drop policy if exists "dispute evidence buyer insert" on storage.objects;
create policy "dispute evidence buyer insert" on storage.objects for insert
  with check (
    bucket_id = 'dispute-evidence'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.upload_within_limits(metadata, 5242880, array['image/', 'application/pdf'])
    and public.is_own_order(
      case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
        then (storage.foldername(name))[2]::uuid
      end
    )
  );

drop policy if exists "dispute evidence buyer read" on storage.objects;
create policy "dispute evidence buyer read" on storage.objects for select
  using (
    bucket_id = 'dispute-evidence'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_own_order(
      case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
        then (storage.foldername(name))[2]::uuid
      end
    )
  );

drop policy if exists "dispute evidence buyer delete" on storage.objects;
create policy "dispute evidence buyer delete" on storage.objects for delete
  using (
    bucket_id = 'dispute-evidence'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_own_order(
      case when (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
        then (storage.foldername(name))[2]::uuid
      end
    )
  );
