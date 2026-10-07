-- ============================================================================
-- Bale Drop — promo codes become an operable surface. Apply after 0029.
--
-- 0025 made `used` honest (reserve/release around a payment reference), but
-- codes could still only be created by hand in `seed.sql` or the Table Editor,
-- and the only read policy was "public can see active codes". An admin
-- therefore could not see a code they had switched off, could not see how much
-- of a cap was consumed, and had no way to stop a leaking code without SQL.
--
-- Writes still go through `admin-action` with the service role (audited, role
-- checked, rate limited) — this migration only adds the admin *read*, so the
-- console can list every code including inactive and expired ones.
-- ============================================================================

-- Admins see all codes; the public policy from 0001 still exposes active ones.
drop policy if exists "promos admin read" on public.promo_codes;
create policy "promos admin read" on public.promo_codes for select
  using (public.is_admin());

-- No client writes: insert/update/delete stay revoked from anon+authenticated
-- (0001 granted only select), so a code can only change through admin-action.
revoke insert, update, delete on public.promo_codes from anon, authenticated;
grant select on public.promo_codes to anon, authenticated;

-- A code is a money lever, so its shape is constrained at the column level
-- rather than in whichever client happens to write it.
alter table public.promo_codes drop constraint if exists promo_codes_amount_positive;
alter table public.promo_codes
  add constraint promo_codes_amount_positive check (amount_naira >= 0);

alter table public.promo_codes drop constraint if exists promo_codes_max_uses_positive;
alter table public.promo_codes
  add constraint promo_codes_max_uses_positive check (max_uses is null or max_uses > 0);

alter table public.promo_codes drop constraint if exists promo_codes_used_within_cap;
alter table public.promo_codes
  add constraint promo_codes_used_within_cap check (used >= 0);

-- Codes are compared uppercased at checkout; storing them uppercased keeps the
-- unique index from allowing `LAUNCH20` and `launch20` as two separate budgets.
update public.promo_codes
set code = upper(btrim(code))
where code is distinct from upper(btrim(code));

alter table public.promo_codes drop constraint if exists promo_codes_code_uppercase;
alter table public.promo_codes
  add constraint promo_codes_code_uppercase check (code = upper(btrim(code)) and char_length(code) between 3 and 40);

-- `used` is maintained by reserve_promo_code/release_promo_reservation (0025).
-- Nothing else may move it, so the counter that caps a budget stays trustworthy.
comment on table public.promo_codes is
  'Discount budgets. Admin-read, service-role-write via admin-action; `used` moves only through reserve_promo_code / release_promo_reservation.';
