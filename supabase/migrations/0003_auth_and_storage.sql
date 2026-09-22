-- ============================================================================
-- Bale Drop — auth profile trigger + storage RLS.
-- 1) Every new auth.users row auto-creates public.profiles (role/name/phone/
--    city taken from signup metadata; defaults to buyer).
-- 2) Storage access rules for `product-images` (public read, owner write)
--    and `vendor-documents` (owner only, folders keyed by auth.uid()).
-- ============================================================================

-- ---------- auto-create profile on signup ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone, city)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'buyer'),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(new.raw_user_meta_data ->> 'city', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- storage RLS (buckets are created in Dashboard → Storage) ----------

-- product-images: anyone reads; signed-in users write only their own folder
create policy "product images public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product images owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "product images owner update"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'product-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "product images owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- vendor-documents: strictly owner-only (admin reads via service_role signed URLs)
create policy "vendor docs owner read"
  on storage.objects for select
  using (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vendor docs owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vendor docs owner update"
  on storage.objects for update
  using (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "vendor docs owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'vendor-documents'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
