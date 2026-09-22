-- ============================================================================
-- Bale Drop — expiring slot reservations and safe inventory release.
-- Apply after 0005.
-- ============================================================================

alter table public.bale_bookings add column if not exists reserved_until timestamptz;
create index if not exists bale_bookings_reservation_idx
  on public.bale_bookings (status, reserved_until)
  where status = 'pending';

create or replace function public.claim_bale_slot(p_bale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bale public.bale_listings%rowtype;
  v_booking_id uuid;
  v_name text;
  v_label text;
  v_released int := 0;
  v_reserved_until timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_bale from public.bale_listings where id = p_bale_id for update;
  if not found then raise exception 'bale not found'; end if;

  -- Abandoned checkout reservations must not consume permanent capacity.
  update public.bale_bookings
  set status = 'cancelled'
  where bale_id = p_bale_id and status = 'pending'
    and reserved_until is not null and reserved_until <= now();
  get diagnostics v_released = row_count;
  if v_released > 0 then
    update public.bale_listings
    set booked_count = greatest(0, booked_count - v_released),
        status = case when booked_count - v_released < split_count then 'open' else status end
    where id = p_bale_id
    returning * into v_bale;
  end if;

  if v_bale.status <> 'open' then raise exception 'split is %', v_bale.status; end if;
  if v_bale.expires_at <= now() then raise exception 'split expired'; end if;
  if v_bale.booked_count >= v_bale.split_count then raise exception 'split full'; end if;
  if exists (select 1 from public.bale_bookings where bale_id = p_bale_id and buyer_id = auth.uid() and status <> 'cancelled') then
    raise exception 'one slot per buyer per bale';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  v_label := upper(left(regexp_replace(coalesce(v_name, 'BD'), '[^A-Za-z]', '', 'g'), 2));
  if v_label = '' then v_label := 'BD'; end if;

  insert into public.bale_bookings (bale_id, buyer_id, status, amount_naira, display_label, reserved_until)
  values (p_bale_id, auth.uid(), 'pending', v_bale.price_per_slot_naira, v_label, v_reserved_until)
  returning id into v_booking_id;

  update public.bale_listings
  set booked_count = booked_count + 1,
      status = case when booked_count + 1 >= split_count then 'full' else 'open' end
  where id = p_bale_id
  returning * into v_bale;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'booked_count', v_bale.booked_count,
    'status', v_bale.status,
    'reserved_until', v_reserved_until
  );
end;
$$;

create or replace function public.release_expired_bale_reservations(p_bale_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bale public.bale_listings%rowtype;
  v_released int;
begin
  if p_bale_id is null then
    return 0;
  end if;
  select * into v_bale from public.bale_listings where id = p_bale_id for update;
  if not found then return 0; end if;
  update public.bale_bookings
  set status = 'cancelled'
  where bale_id = p_bale_id and status = 'pending'
    and reserved_until is not null and reserved_until <= now();
  get diagnostics v_released = row_count;
  if v_released > 0 then
    update public.bale_listings
    set booked_count = greatest(0, booked_count - v_released),
        status = case when booked_count - v_released < split_count and status = 'full' then 'open' else status end
    where id = p_bale_id;
  end if;
  return coalesce(v_released, 0);
end;
$$;

revoke all on function public.claim_bale_slot(uuid) from public, anon;
grant execute on function public.claim_bale_slot(uuid) to authenticated;
revoke all on function public.release_expired_bale_reservations(uuid) from public, anon, authenticated;
grant execute on function public.release_expired_bale_reservations(uuid) to service_role;
