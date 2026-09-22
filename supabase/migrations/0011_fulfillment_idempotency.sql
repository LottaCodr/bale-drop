-- Make repeated courier/vendor fulfillment events safe. A replay with the
-- same state and tracking data must not create another timeline/notification.

create or replace function public.set_order_fulfillment_status(
  p_order_id uuid,
  p_vendor_profile_id uuid,
  p_status text,
  p_tracking_number text default null,
  p_tracking_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_previous text;
  v_label text;
begin
  select * into v_order from public.orders
  where id = p_order_id and vendor_id = p_vendor_profile_id for update;
  if not found then raise exception 'order not found'; end if;
  if p_status not in ('processing', 'ready', 'in_transit') then raise exception 'invalid fulfillment status'; end if;
  if v_order.status = p_status
     and v_order.tracking_number is not distinct from nullif(trim(p_tracking_number), '') then
    return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'duplicate', true, 'tracking_number', v_order.tracking_number);
  end if;
  if v_order.status in ('delivered', 'refunded', 'cancelled', 'disputed') then raise exception 'order is not actionable'; end if;
  if p_status = 'in_transit' and nullif(trim(coalesce(p_tracking_number, '')), '') is null then
    raise exception 'tracking number required before dispatch';
  end if;

  v_previous := v_order.status;
  v_label := replace(initcap(replace(p_status, '_', ' ')), 'In Transit', 'In transit');
  update public.orders
  set status = p_status,
      tracking_number = coalesce(nullif(trim(p_tracking_number), ''), tracking_number),
      tracking_url = coalesce(nullif(trim(p_tracking_url), ''), tracking_url)
  where id = v_order.id;
  insert into public.order_timeline (order_id, status, note)
  values (v_order.id, p_status, format('Vendor moved order from %s to %s', v_previous, v_label));
  insert into public.notifications (profile_id, title, body, href)
  values (v_order.buyer_id, 'Order update', format('Your order is now %s.', v_label), '/orders');

  return jsonb_build_object('order_id', v_order.id, 'status', p_status, 'tracking_number', coalesce(p_tracking_number, v_order.tracking_number));
end;
$$;

revoke all on function public.set_order_fulfillment_status(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_order_fulfillment_status(uuid, uuid, text, text, text) to service_role;
