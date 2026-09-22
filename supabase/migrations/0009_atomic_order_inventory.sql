-- Bale Drop — atomic multi-vendor checkout inventory reservation.
-- Apply after 0008. Reserving all order lines in one transaction makes a
-- failed Paystack initialization rollback-safe without partial stock restores.

create or replace function public.reserve_order_inventory(p_order_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_reserved int := 0;
begin
  if coalesce(cardinality(p_order_ids), 0) = 0 then
    raise exception 'order batch is empty';
  end if;

  for v_product in
    select oi.product_id, sum(oi.qty)::int as qty
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.order_id = any(p_order_ids)
      and oi.product_id is not null
      and o.status = 'pending_payment'
      and o.inventory_released = false
    group by oi.product_id
    order by oi.product_id
  loop
    update public.products
    set qty = qty - v_product.qty
    where id = v_product.product_id
      and status = 'active'
      and qty >= v_product.qty;
    if not found then
      raise exception 'insufficient stock for product %', v_product.product_id;
    end if;
    v_reserved := v_reserved + v_product.qty;
  end loop;

  return jsonb_build_object('status', 'reserved', 'units', v_reserved, 'order_ids', p_order_ids);
end;
$$;

revoke all on function public.reserve_order_inventory(uuid[]) from public, anon, authenticated;
grant execute on function public.reserve_order_inventory(uuid[]) to service_role;
