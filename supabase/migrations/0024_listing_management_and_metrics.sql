-- ============================================================================
-- Bale Drop — listing management + the denormalised metrics that were never
-- maintained. Apply after 0023_escrow_auto_release.sql.
--
-- 0002_metrics.sql shipped the counters with the note "(Production: maintain
-- via triggers on reviews/orders; seed sets values.)" and the triggers never
-- arrived, so `products.views`, `products.sold_count`, `products.rating_avg`
-- and `vendor_profiles.sales_count` stayed at seed/zero forever. That made the
-- vendor KPI cards read 0 and degraded two sort orders ("Top rated" and
-- "Relevance" both rank on columns that never moved).
--
-- Vendors could also only *create* listings: `status` updates are revoked from
-- `authenticated` (0005) with no RPC to replace them, so there was no pause,
-- resume or resubmit path.
-- ============================================================================

-- ---------- listing status transitions ----------

create or replace function public.set_listing_status(
  p_product_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_vendor public.vendor_profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_status not in ('active', 'paused', 'pending') then
    raise exception 'a seller can only pause, resume or resubmit a listing';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'listing not found'; end if;
  select * into v_vendor from public.vendor_profiles
  where id = v_product.vendor_id and profile_id = auth.uid() for update;
  if not found then raise exception 'you do not own this listing'; end if;

  -- Moderation stays admin-only: a seller may never move pending → active.
  if p_status = 'active' and v_product.status <> 'paused' then
    raise exception 'only a paused listing can be resumed by the seller';
  end if;
  if p_status = 'paused' and v_product.status <> 'active' then
    raise exception 'only a live listing can be paused';
  end if;
  if p_status = 'pending' and v_product.status <> 'rejected' then
    raise exception 'only a rejected listing can be resubmitted for review';
  end if;

  -- Pausing a listing with a live split would strand claimants.
  if p_status = 'paused' and exists (
    select 1 from public.bale_listings bl
    where bl.product_id = v_product.id and bl.status in ('open', 'full', 'processing')
  ) then
    raise exception 'close the live split before pausing this listing';
  end if;

  update public.products
  set status = p_status, updated_at = now()
  where id = v_product.id;

  return jsonb_build_object('product_id', v_product.id, 'status', p_status);
end;
$$;

revoke all on function public.set_listing_status(uuid, text) from public, anon;
grant execute on function public.set_listing_status(uuid, text) to authenticated;

-- ---------- listing views ----------

-- Granted to anon as well: most storefront traffic is signed out, and a view
-- count that only counts members is not a count. The client dedupes per mount
-- (`ViewTracker` + the recently-viewed store) and the Edge-level rate limiter
-- in 0028 covers the abuse case.
create or replace function public.record_product_view(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_views int;
begin
  update public.products
  set views = views + 1
  where id = p_product_id and status = 'active'
  returning views into v_views;
  if not found then
    return jsonb_build_object('product_id', p_product_id, 'recorded', false);
  end if;
  return jsonb_build_object('product_id', p_product_id, 'recorded', true, 'views', v_views);
end;
$$;

revoke all on function public.record_product_view(uuid) from public;
grant execute on function public.record_product_view(uuid) to anon, authenticated, service_role;

-- ---------- sold units + vendor sales ----------

create or replace function public.handle_order_paid_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and (old.status is distinct from 'paid') then
    update public.products p
    set sold_count = p.sold_count + oi.qty
    from public.order_items oi
    where oi.order_id = new.id
      and oi.product_id is not null
      and p.id = oi.product_id;

    update public.vendor_profiles
    set sales_count = sales_count + 1
    where id = new.vendor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists order_paid_metrics on public.orders;
create trigger order_paid_metrics
  after update on public.orders
  for each row execute function public.handle_order_paid_metrics();

-- ---------- ratings ----------

-- Recomputed (never incremented) so a deleted or re-inserted review cannot
-- drift the average. `create_order_review` also refreshes the vendor average;
-- this trigger is the safety net for any other insert path and adds the
-- per-product average that nothing maintained before.
create or replace function public.handle_review_metrics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.product_id is not null then
    update public.products
    set rating_avg = coalesce(
      (select round(avg(rating)::numeric, 2) from public.reviews
       where product_id = new.product_id),
      0
    )
    where id = new.product_id;
  end if;

  update public.vendor_profiles
  set rating_avg = coalesce(
        (select round(avg(rating)::numeric, 2) from public.reviews where vendor_id = new.vendor_id),
        0
      ),
      reviews_count = (select count(*) from public.reviews where vendor_id = new.vendor_id)
  where id = new.vendor_id;

  return new;
end;
$$;

drop trigger if exists review_metrics on public.reviews;
create trigger review_metrics
  after insert on public.reviews
  for each row execute function public.handle_review_metrics();
