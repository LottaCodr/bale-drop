-- Keep the original pay-in and the later refund as separate idempotent audit
-- movements. The provider reference is shared, so `kind` must be part of the
-- uniqueness key.

drop index if exists public.transactions_paystack_order_idx;
drop index if exists public.transactions_paystack_booking_idx;
create unique index transactions_paystack_order_idx
  on public.transactions (paystack_reference, order_id, kind)
  where paystack_reference is not null and order_id is not null;
create unique index transactions_paystack_booking_idx
  on public.transactions (paystack_reference, bale_booking_id, kind)
  where paystack_reference is not null and bale_booking_id is not null;
