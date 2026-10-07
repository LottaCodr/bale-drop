# Bale Drop — Implementation Gap Audit

Audit date: **2026-10-07**. Commit audited: `ed23b94` (branch `main`).

> **Implementation status: every item below has been worked.** Each heading now
> carries a status line naming the artifact that closes it. 27 of 30 are closed;
> #12 (browser E2E), #14 (live provisioning/backups) and #15 (a real carrier
> contract) are partial for the reasons stated. Implementing #14’s RLS audit
> also surfaced a privilege-escalation bug that was not in the original list —
> see **Addendum** at the end.
Method: full read of `apps/web`, `packages/database`, `supabase/migrations`
(0001–0021) and `supabase/functions` (12 functions), plus a local run of the
quality gates and the dev server.

Verified state of the gates on this commit:

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ passes |
| `npm run lint` | ✅ passes, no warnings |
| `npm test` | ✅ 106 tests / 11 files pass |
| `npm run build` | ✅ builds, 31 routes |
| `npm run typecheck:edge` | ⚠️ still not runnable without `deno`; `npm run check:edge` parses all 21 Edge Function files instead and **is** part of `npm run check` |
| `scripts/check-migrations.py` | ✅ 0001–0032 apply on a real PostgreSQL; `money_path.sql` 22 PASS, `rls_audit.sql` 20 PASS |
| CI | ✅ `.github/workflows/ci.yml` (web, edge functions, database) |
| E2E | ⚠️ database-level money path only; no browser E2E |

This document complements `docs/ROADMAP.md` §3.5/§4. The roadmap's own gap list
(G-2…G-9) is still accurate but incomplete: it was written before the discovery,
notification, support and auth work landed, and it does not cover the
**Bale Split lifecycle**, which is the product's headline feature and is only
half-built. Items below are grouped by severity, each with the evidence.

---

## P0 — The core product loop does not close

These are not polish items. Each one means a real buyer or vendor reaches a
dead end, or money is captured and never settled.

### 1. Vendors cannot create a Bale Split

**CLOSED.** `create_bale_split()` (`0022`) plus a “Create a split” form in `apps/web/app/vendor/vendor-dashboard.tsx`, served through the `split-action` Edge Function. Server-side validation: 2–50 slots, ≥ ₦100 per slot, 1–336 h deadline, one live split per listing, bale-only, owning approved vendor. Proven by `supabase/tests/money_path.sql` §1.

Nothing in the application ever inserts a `bale_listings` row. The only inserts
in the repo are in `supabase/seed.sql:165`.

- The vendor listing form (`apps/web/app/vendor/vendor-dashboard.tsx:105–120`)
  creates a `products` row with `kind: "bale" | "single"` — that is a *whole
  bale for sale*, not a split. There are no fields for `total_naira`,
  `split_count`, `price_per_slot_naira` or `expires_at`.
- `/sell` (`apps/web/app/sell/page.tsx`) onboards the vendor; it does not create
  listings or splits either.
- No Edge Function creates splits, and no RPC exists for it. RLS permits a
  vendor insert (`0001_init.sql:330` "bales owner insert"), so the *database* is
  ready — the product surface is simply missing.

**Consequence:** every live split on the site is seed data. The moment the seed
splits expire (the `bale-expiry` cron expires them and refunds the slots), the
group-buy mechanic disappears from the storefront and cannot be replenished.

**Needs:** a "Create a split" flow on an existing bale listing (slot count,
per-slot price with a total anchor, deadline), server-side validation that
`price_per_slot × split_count` and the deadline are sane, admin moderation of
splits, and Realtime publication (already done in `0002`).

### 2. A filled split dead-ends — no fulfilment, no settlement

**CLOSED.** `fulfil_bale_split()` (`0022`) attributes the pay-ins to the vendor, takes commission and queues a payout keyed on the bale; `complete_vendor_payout_checked` writes exactly one ledger row. Vendor UI reaches it through `split-action`. `money_path.sql` §4–5.

`finalize_payment_session()` moves a listing to `processing` when the last slot
is paid (`0004_payment_spine.sql:171–176`). Nothing ever moves it further:

- `bale_listings.status` allows `processing` and `fulfilled`
  (`0001_init.sql:108–110`) but no code anywhere sets `fulfilled`.
- The vendor dashboard only reads `orders` (`vendor-dashboard.tsx:66–70`). A
  filled split produces **no order rows**, so the vendor's "Orders to fulfill"
  list never shows it. There is no dispatch, no tracking and no delivery
  confirmation path for a split.
- **The money has no exit.** `vendor_payouts` is keyed on `order_id`
  (`0001_init.sql:199–213`, unique index `0005:80`) and is only ever created by
  `confirm_order_delivery()` / `release_disputed_order_to_vendor()`. The slot
  `pay_in` ledger row is written with `bale_booking_id` and **no `vendor_id`**
  (`0004_payment_spine.sql:154–158`), and `supabase/functions/vendor-payout/index.ts`
  contains zero references to bales or bookings.

**Consequence:** slot money is captured into the platform's Paystack balance and
held there indefinitely. That is the single most serious gap in the repo — it
fails the roadmap's own "money test" (§2: *can we prove what was paid, to whom,
why?*).

**Needs:** a split-fulfilment state machine (`processing → fulfilled`), a vendor
surface for filled splits (who collects the bale, or how portions are shipped),
and a settlement path — either extend `vendor_payouts` with a `bale_id`/booking
dimension or convert a filled split into per-buyer orders. Also decide the
commission treatment for splits (currently commission is only computed in
`confirm_order_delivery`).

### 3. Slot buyers have no post-purchase surface

**CLOSED.** `/orders` lists paid slots (`listPaidBookings`) and `/orders/[id]` is the receipt/order-truth page (server-stored amounts only, ledger rows, refund banner, escrow window).

`bale_bookings` is never read anywhere in `apps/web` — the only reference is the
Realtime joiner-chip subscription (`hooks/use-bale-live.ts:38`).

- `/orders` reads `orders` only, so a buyer who paid for a slot sees an empty
  order history — yet the notification they receive links to `/orders`
  (`0004_payment_spine.sql:161`: *"Your Bale Split slot is held in escrow until
  the split fills"*).
- No "My splits" list: no fill progress, no deadline, no refund status.
- **No dispute path.** `disputes.order_id` is `NOT NULL` (`0001_init.sql:216`),
  so a slot buyer cannot raise a dispute at all. The only slot refund is the
  automatic one when a split *expires unfilled* (`bale-expiry`). If a split
  fills and the vendor never ships, the buyer has no remedy in-product.

**Needs:** a buyer-side slot view (progress, deadline, amount held, refund
state), and either a booking-level dispute/refund path or the order conversion
from item 2.

### 4. The 48-hour escrow auto-release is promised but not implemented

**CLOSED.** `0023` sets `escrow_release_at = now() + 48 h` on delivery without moving money; `release_due_escrows(50)` runs from the `escrow-release` cron; an open dispute freezes the release; the buyer can release early. `money_path.sql` §6–7.

The copy promises it in three places:

- `apps/web/app/orders/orders-client.tsx:454` — *"Ignore this and escrow
  auto-releases 48 hours after delivery."*
- `apps/web/lib/policies.ts:128` — *"The release window closes 48 hours after
  delivery is marked complete."* (asserted by `lib/__tests__/trust.test.ts:29`)
- `apps/web/app/sell/page.tsx:429,442` — vendor-facing 48 h escrow claims.

There is no code behind it:

- The only release paths are `confirm_order_delivery()` (buyer action) and
  `release_disputed_order_to_vendor()` (admin action), both in
  `0005_operations_and_security.sql:222,296`.
- No cron function scans for stale escrow. `bale-expiry` handles splits and
  payment-session expiry; `payout-reconcile` handles transfers. Neither touches
  `orders.escrow_status`.
- `orders.delivered_at` is only ever set *inside* `confirm_order_delivery` — i.e.
  at release time — so even if a job existed, there is no "delivery marked
  complete" timestamp to measure 48 h from. `logistics-webhook` deliberately
  records `delivered` events without applying them to the order
  (`logistics-webhook/index.ts:150–165`).

**Consequence:** a buyer who never clicks "Confirm delivery" holds the vendor's
money forever; a vendor who never gets a confirmation is never paid. This is
both a money bug and a false statement on a legal page.

**Needs:** a `delivered` state distinct from `released` (courier webhook or
vendor mark), plus an `escrow-release` cron (or DB job) that releases after the
window, writes the `transactions`/payout rows and notifies both sides — and the
window value shared between SQL, `lib/policies.ts` and the UI copy.

### 5. Checkout shows a total the server will not charge

**CLOSED.** `paystack-initialize` recomputes and returns `subtotal_naira`, `delivery_fee_naira` and `subsidy_naira`; checkout and the receipt render the server’s numbers only. The ₦1,500 launch subsidy is applied server-side from env, never from the request.

- Client: `lib/taxonomy.ts:46` defines `DELIVERY_SUBSIDY_NAIRA = 1500`, and both
  the cart (`app/cart/page.tsx:65–66`) and checkout
  (`app/checkout/page.tsx:242–243`) **always** subtract it. The pay button reads
  `Pay {naira(total)}` (`checkout/page.tsx:592`).
- Server: `paystack-initialize` starts at `let subsidy = 0`
  (`index.ts:556`) and only applies one when a **valid promo code** is supplied
  (`index.ts:558–575`). Order total = `subtotal + deliveryFee - orderSubsidy`
  (`index.ts:583–588`).

**Consequence:** with no promo code — the normal case — the buyer is shown
₦1,500 less than Paystack actually charges. That breaks the repo's own rule
("the price you saw is the price you pay", `lib/cart-sync.ts`) and the FCCPA
price-transparency claim in `lib/policies.ts:166`.

**Needs:** one source of truth. Either make the launch subsidy a real server-side
rule (a `promo_codes` row auto-applied, or a subsidy constant mirrored in the
Edge Function and returned to the client in the initialize response), or remove
the unconditional client-side deduction and show the subsidy only when a code is
applied. Ideally checkout renders the totals returned by `paystack-initialize`
before the buyer commits.

### 6. The public vendor storefront is behind a login wall

**CLOSED.** `apps/web/middleware.ts` protects `/vendor` exactly (`PROTECTED_EXACT`), leaving `/vendor/[id]` public.

`middleware.ts:15` lists `"/vendor"` in `PROTECTED`, and `matches()` also matches
every sub-path — so `/vendor/[id]`, documented as the *public* shop page
(`lib/data.ts:getVendorStorefront`, `app/vendor/[id]/page.tsx:14–21`), redirects
signed-out visitors.

Reproduced locally with dummy live keys:

```
GET /vendor/abc123 → 307 /login?next=%2Fvendor%2Fabc123
GET /search        → 200
```

Every `VendorCard` "Shop" link and every vendor name on a listing is therefore a
dead end for logged-out traffic — the discovery loop the page was built for.

**Needs:** protect `/vendor` exactly (the dashboard) and leave `/vendor/[id]`
public, e.g. by matching the dashboard path only, or by moving the dashboard to
`/seller`.

---

## P1 — Launch blockers (roadmap §4) still open, with detail

### 7. Transactional email / SMS — M-4, G-3 (nothing exists)

**CLOSED.** `supabase/functions/_shared/notify.ts` — `deliver()` writes the in-app row and sends email/SMS from seven functions (receipt, refund, dispute update, vendor decision, slot closing). Provider credentials come from Edge Function env.

`apps/web/.env.example` lists `RESEND_API_KEY` and `TERMII_API_KEY`; **no file in
the repo reads either**. There is no email module, no templates, no Edge
Function for receipts, password resets (beyond Supabase's own auth mail),
slot-claimed, refund-issued, dispute-update or vendor-decision messages.
The roadmap requires five events to send mail; zero do.

### 8. Abuse controls — M-6, G-4 (nothing exists)

**CLOSED.** `_shared/rate-limit.ts` + `rate_limits` (`0027`) on ten functions, `upload_within_limits()` on all three buckets, a DB-side 3/hour support throttle, and `prune_rate_limits(180)`.

- `supabase/functions/_shared/auth.ts` authenticates but never rate-limits; no
  function has a limiter, and there is no shared one.
- No CAPTCHA/Turnstile on signup, login, slot claim, dispute or support.
- Upload limits are client-side only (`orders-client.tsx:325` rejects >5 MB in
  the browser). The Storage policies in `0003`/`0005` impose no size or MIME
  constraints, so a script can fill `dispute-evidence` and `product-images`
  directly.
- `support_messages` is guest-insertable (`0020`) with no throttle — the
  roadmap explicitly calls this out as a drain risk.

### 9. Error monitoring & alerting — M-7, G-5 (nothing exists)

**CLOSED.** `_shared/monitor.ts` (`logInfo` / `logError` / `alert`) is wired through every Edge Function.

`@vercel/analytics` is the only instrumentation (`app/layout.tsx`). There is no
Sentry-equivalent, no error shipping from Edge Functions (they `console.error`),
and no alert when a Paystack webhook fails verification or a refund gets stuck
in `processing`. `app/error.tsx` fires `track("support_open", …)` for a crash —
which both pollutes the support funnel metric and reports nothing to a human.

### 10. Buyer receipt / order truth page — M-9

**CLOSED.** `apps/web/app/orders/[id]/page.tsx`.

There is no `/orders/[id]` and no receipt. The order card shows only
`total_naira`; `subtotal_naira`, `delivery_fee_naira` and `subsidy_naira` exist
on the row and are never rendered after purchase. There is no release date and
no per-order statement of the refund rule (the roadmap's acceptance criterion).
Combined with item 7 (no email), a buyer has no durable proof of purchase.

### 11. Vendor payout calendar + statement — M-12

**CLOSED.** Payouts tab and statement in the vendor dashboard; `claim_vendor_payout` / `complete_vendor_payout_checked`; admin Payouts panel.

`vendor_payouts` has a vendor-read RLS policy (`0001_init.sql:370`) and the
dashboard subtitle promises *"follow payout status"*
(`vendor-dashboard.tsx:141`) — but the dashboard never queries the table. No
statement, no payout reference, no status, no expected date.

### 12. E2E test of the money path — M-11, G-8

**PARTIAL.** The money path is covered end-to-end at the database layer by `supabase/tests/money_path.sql` (22 assertions: split → claim → webhook → settlement → payout → escrow → refund → promo), executed on a real PostgreSQL in CI. There is still **no browser-level E2E** (Playwright) driving checkout against a Paystack test key.

No Playwright (or equivalent) anywhere: not in `package.json`, no config, no
`e2e/` or `tests/` directory. The 79 unit tests cover pure functions only
(cart maths, stores, search contract, URL state, auth validation, formatting).
Nothing exercises checkout → webhook → order timeline → confirm delivery.

### 13. No CI at all

**CLOSED.** `.github/workflows/ci.yml` — web typecheck/lint/test/build, `check:edge` for the 21 Edge Function files, and a database job that applies every migration plus both scenarios on a real PostgreSQL.

There is no `.github/` directory, so `docs/ENGINEERING-STANDARDS.md` §6
("Every PR: typecheck + lint pass") is enforced only by hand. `npm run check`
also omits `typecheck:edge`, and `deno` is not a devDependency — the 12 Edge
Functions that hold the money are never type-checked by any automated gate.

### 14. Live environment, RLS audit, backups — M-1, M-2, M-5, G-2

**PARTIAL — and it found real holes.** The RLS audit is now automated: `supabase/tests/rls_audit.sql` (20 assertions) runs in CI against Supabase-faithful default privileges and Storage RLS. It covers privilege escalation, row isolation, service-role-only money writes, bucket privacy and upload caps, and — just as importantly — every legitimate browser write, so an over-tight revoke fails the build too. It exposed a privilege-escalation bug fixed by `0031` and three weakened Storage policies fixed by `0032` (see the addendum below). **Still unverifiable from this repo:** provisioning the live project and confirming PITR backups, which need credentials.

Not verifiable from the repo and clearly not done: `/api/health` returns
`mode: unavailable` here, no deployment config exists (no `vercel.json`, no
infra-as-code), and `docs/ENGINEERING-STANDARDS.md` §5's pre-launch security
checklist is entirely unchecked. The RLS policies themselves look carefully
written (0005 hardening, 0017 grant fix), but the *audit* — exercising every
table with signed-out / buyer / vendor / admin JWTs — has no artifact.

### 15. Real delivery posture — M-10, G-6

**PARTIAL.** `logistics-create` is a real dispatch adapter — idempotent on `external_event_id = dispatch-<order_id>`, writes `fulfillment_events`, returns a tracking number and URL — and it is now callable from the vendor dashboard (“Dispatch with Bale Drop tracking”). The provider behind it is still the sandbox `testTracking()`; a real carrier contract and keys remain.

`logistics-create` returns a deterministic fake tracking number and a URL on a
domain that does not exist (`logistics-create/index.ts:14–21`,
`https://track.baledrop.demo/...`). `SANDBOX_API_KEY` / `KWIK_API_KEY` in
`.env.example` are read by nothing. Worse, **`logistics-create` is never called
by the UI** (0 references in `apps/web`): the vendor dashboard dispatches with a
free-text tracking number via `order-action` (`vendor-dashboard.tsx:130–138`),
so the tracking chip buyers see is whatever a vendor typed.

---

## P2 — Real functionality gaps that damage trust or ops

### 16. Product photos are uploaded but never displayed

**CLOSED.** `product_images` (`0022`) → `listProductImages()` → `data.ts productImages()` (one batched query per page) → `ProductArt` with `next/image`, the listing gallery, and the cart / checkout / wishlist / recently-viewed rails via persisted snapshots. The storage host is allow-listed in `next.config.mjs`.

- Vendors upload to the `product-images` bucket and insert `product_images` rows
  (`vendor-dashboard.tsx:112–119`).
- Nothing in `apps/web` ever reads `product_images` or calls
  `storage.getPublicUrl()`. Every screen renders `ProductArt` — a CSS gradient +
  category glyph (`components/commerce.tsx:67–68`, whose own comment says
  *"Replaced by Supabase Storage images in prod"*).
- `next.config.mjs` sets `images: { remotePatterns: [] }` with the comment "No
  remote images in MVP prototype".

This contradicts `docs/UX-RESEARCH.md` principle 7 ("images via Supabase Storage
with transforms in prod"), `ENGINEERING-STANDARDS.md` §7 ("`next/image` with
Storage transforms in prod") and the listing-screen decision "Gallery
dominates". For a ₦150,000 stranger-to-stranger purchase, no photo is a
conversion and trust problem, and it makes "item not as described" disputes
unwinnable for both sides.

### 17. Denormalised metrics are never maintained

**CLOSED.** `0024` maintains `sold_count`, `rating_avg` and vendor sales counters by trigger; `record_product_view()` is wired into `components/view-tracker.tsx` and counts signed-out traffic too.

`0002_metrics.sql` says it outright: *"(Production: maintain via triggers on
reviews/orders; seed sets values.)"* The triggers were never written.

| Column | Written by | Effect today |
|---|---|---|
| `products.views` | nothing (`view-tracker.tsx` only writes the client store + `analytics_events`; `0005:165` revokes client UPDATE) | Vendor KPI "Listing views" is always 0 |
| `products.sold_count` | nothing | "units sold" always 0; `relevance` sort degenerates |
| `products.rating_avg` | nothing | Product cards show 0★; `rating` sort degenerates (`queries.ts:160–166`) |
| `vendor_profiles.sales_count` | nothing | Storefront "sales" stat frozen at seed value |
| `vendor_profiles.rating_avg`, `reviews_count` | ✅ `create_order_review` (`0005:363–366`) | correct |

Because two of the five sort orders rank by columns that stay at zero,
"Top rated" and "Relevance" return effectively arbitrary orderings.

### 18. Live search has no relevance ranking (the scored path is test-only)

**CLOSED.** `search_products()` (`0026`) is the live path: `ts_rank_cd` + exact-title/description/synonym boosts + popularity, with hygiene on the query text.

`packages/database/src/search.ts` implements the token/synonym scoring,
`MATCH_THRESHOLD` and non-match filtering that `docs/ROADMAP.md` §3.2 credits as
DONE — but `filterProducts()` is imported **only** by
`apps/web/lib/__tests__/search.test.ts`. The live path
(`lib/data.ts:searchCatalog` → `queries.ts:searchProducts`) is `ILIKE` over
title/category/description ordered by `sold_count` (which is always 0, item 17).

Practical effect: synonym queries ("okirika", "sneakers" → Shoes) that the tests
prove work never work against the real database, and there is no ranking.
No `tsvector`/GIN index exists (roadmap N-15).

### 19. Search results are capped at 40 with no pagination

**CLOSED.** The RPC returns an exact `total`/`offset`/`pages`, and `/search` renders a prev/next pager (`rel=prev|next`, page size 40, `MAX_PAGE = 200`, filters reset to page 1).

`app/search/page.tsx:77` calls `searchCatalog({ ...filters, limit: 40 })`.
`lib/search-params.ts:toQueryString` accepts a `page` field that no caller ever
sets, and the page renders no pager or "load more". Once the catalog exceeds 40
matching listings, the rest are unreachable.

### 20. Vendors can create listings but never manage them

**CLOSED.** Listing management (pause / resume / resubmit through `set_listing_status`) and the split lifecycle (fulfil / cancel through `split-action`) are both in the vendor dashboard, with UI gates matching the RPC rules.

`vendor-dashboard.tsx` has a create form and fulfilment buttons only. There is
no edit, no pause/resume, no delete, no relight after rejection, no stock or
price update, and no rejection-reason display for a rejected listing. The
`ListingStatus` enum defines `draft` and `paused` (`packages/database/src/types.ts:14`)
which no code ever sets. A vendor who typos a price must ask an admin.

### 21. Admin console: KYC review is a dead button

**CLOSED.** `vendor-documents` returns 5-minute signed URLs and `admin-action` approves/rejects with a reason, writes `admin_audit_log`, and notifies the vendor. The console’s Docs button opens the signed URL.

- `admin-console.tsx:189` renders `<Button variant="outline" size="sm"><Eye /> Docs</Button>`
  with **no `onClick`**. The queue item's docs field is the literal string
  `"Pending review"` (`admin-console.tsx:59`).
- Admins can read `vendor_documents` *rows* (RLS `0005:147`) but not the files:
  the `vendor-documents` bucket policies are owner-only (`0003:75–105`) and there
  is no service-role signed-URL function for them — `dispute-evidence` has one
  (`supabase/functions/dispute-evidence/index.ts`), vendor docs do not.

So vendor approval — the gate the whole "verified vendor" promise rests on — is
currently a blind approve/reject. `ENGINEERING-STANDARDS.md` §5 requires
"signed URLs only" for that bucket; the mechanism is missing.

### 22. Admin console: dispute amounts are hardcoded to zero

**CLOSED.** The dispute panel shows the real order and ledger amounts; `resolve_dispute` refunds through Paystack and records it with `settleRefund()`.

`admin-console.tsx:61` builds each dispute row with `amount: 0`, and the render
shows `{naira(d.amount)} held` (`admin-console.tsx:239`). Every dispute in the
queue reads "₦0 held", so an admin cannot triage by exposure. The order total is
one join away (`disputes.order_id → orders.total_naira`).

### 23. No money/ledger surface for admins

**CLOSED.** Money tab: `loadLedger` / `loadRefunds` / `loadSessions` with `ledgerTotals()` per kind (`apps/web/lib/admin-ledger.ts`, unit-tested). The ledger is never netted against refunds — it stays append-only.

None of these tables is read by any `.tsx` file: `transactions`,
`payment_sessions` (failed/abandoned), `order_refunds`, `bale_refunds`,
`admin_audit_log`, `fulfillment_events`. The console shows one aggregate
("Held in escrow") and a payout queue. Missing, concretely:

- refunds stuck in `processing` (the state machine has a 15-minute lease, but
  nobody can see one that never settled);
- failed/abandoned payment sessions and the inventory they reserved;
- the append-only ledger the roadmap calls the source of truth (§1: "Ledger is
  append-only… balances are derived");
- the admin audit trail that `admin-action` carefully writes on every decision.

`payout-reconcile` and `bale-expiry` are cron-only: if they fail, nothing
surfaces it (see item 9).

### 24. No analytics read path / funnel dashboard

**CLOSED.** The same tab renders a 7-day funnel from `analytics_events` (`loadFunnel`, `funnelRate`, tested).

`analytics_events` is write-only from the browser (`lib/analytics.ts`); no page,
query or Edge Function reads it. `docs/ROADMAP.md` §6 makes "the funnel dashboard
shows every step from `view_item` to `purchase`" a launch-gate condition, and
`UX-RESEARCH.md` §5 lists the metrics to watch. There is no dashboard, no SQL
view and no export.

### 25. Support is resolve-only

**CLOSED.** Threaded support: `support_replies` + the `support_queue` SLA view (`0028`), a buyer thread view, an admin reply composer via the `support-reply` function, and a red flag when a thread passes 12 h without a first response.

`lib/support.ts` + the admin Support tab let an admin read a message, click
"Reply by email" (a `mailto:` link) and mark it resolved. There is no reply
record, no thread, no first-response-time metric (M-8 asks for a tracked median),
and no WhatsApp/email forwarding — which M-8 explicitly requires before launch.

### 26. Promo codes: usage is never recorded, and there is no admin UI

**CLOSED.** `0025` makes `max_uses` real (reserve/release, per-buyer cap, released on abandonment); `0030` adds the admin read policy and the uppercase/expiry constraints; the Promos tab creates and toggles codes through `admin-action` (`create_promo` / `set_promo_active`, audited). Rules live in `apps/web/lib/promos.ts`, unit-tested.

`paystack-initialize` reads `promo.used` to enforce `max_uses`
(`index.ts:566–569`) but nothing ever increments `used`, so every cap is
decorative and a code can be replayed forever by every buyer (there is no
per-user redemption check either). Codes can only be created by hand in
`seed.sql:221`; no admin screen manages them.

### 27. Push notifications and the service worker — G-7, N-3

**CLOSED.** `push_subscriptions` (`0029`), `push-send` driven by a Database Webhook on `notifications` INSERT, `list_push_endpoints` / `mark_push_delivery` for dead endpoints, `public/sw.js`, `lib/push.ts`, and a toggle on `/notifications` keyed on `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

`app/manifest.ts` and generated icons make the site installable, but there is no
service worker (`apps/web/public/` contains only PNGs), no push subscription
table, no VAPID keys and no `webpush` endpoint. So: no offline caching (the PWA
is install-only) and no "slot closing soon" / "refund issued" push — the urgency
loop the roadmap says the split mechanic depends on.

### 28. Unconfigured mode is inconsistent

**CLOSED.** `/`, `/search`, `/listing/[id]` and `/vendor/[id]` render `<ServiceUnavailable>` when `!isSupabaseLive()`; `notFound()` is now reserved for “configured store, no such row”.

`/` and `/search` render `<ServiceUnavailable>`; `/listing/[id]`
(`page.tsx:51`) and `/vendor/[id]` (`page.tsx:37`) call `notFound()`, so with no
Supabase keys a listing link returns a 404 "not found" page rather than the
honest "temporarily unavailable" state. Same for the 404 vs 503 distinction when
a live fetch throws (`lib/data.ts` catches and returns `null`).

### 29. Demo sign-in is documented but not built

**CLOSED.** `demoLoginsEnabled()` gates a dev-only three-role panel on `/login` that calls the same `signIn()` path as the form; `scripts/seed-demo-users.mjs` creates the 15 demo users.

`UX-RESEARCH.md` ("One-tap Buyer/Vendor/Admin demo sign-in, flagged by
`NEXT_PUBLIC_DEMO_LOGINS`") and `SUPABASE-SETUP.md` §8 describe it.
`lib/auth/demo-accounts.ts` exists but has **no importers** — `/login` renders no
demo buttons. The flag is also absent from `.env.example`, and
`demoLoginsEnabled()` requires `=== "true"` while the docs tell operators to set
it to `"false"` to disable it (a no-op either way today).

### 30. Dead code and doc drift

**CLOSED.** `apps/web/lib/mock.ts` deleted, `docs/ENGINEERING-STANDARDS.md` §3 rewritten, and every doc bumped to migration `0031`.

- `apps/web/lib/mock.ts` (160 lines, ~20 products / 7 vendors / 6 splits / demo
  reviews) has no importers since `lib/data.ts` went live-only;
  `ENGINEERING-STANDARDS.md` §3 still mandates it.
- `apps/web/lib/auth/demo-accounts.ts` — see item 29.
- `packages/database/src/search.ts`'s scoring half is test-only — see item 18.
- `docs/ROADMAP.md` §3.3 says "Migrations `0001–0019`" (now 0021) and §3.4 says
  "53 unit tests" (now 79); `README.md`'s structure block says
  "migrations `0001–0016`".

---

## P3 — Roadmap nice-to-haves: none started

For completeness, all of `docs/ROADMAP.md` §5 is unbuilt. Confirmed absent from
the code: cart drawer (N-1) · cross-device/server-side cart (N-2 — the cart is
`localStorage`-only; only the wishlist syncs, `lib/wishlist-sync.ts`) · web push
(N-3) · saved searches/alerts (N-4) · review photos + vendor replies (N-5 —
`review-create` accepts rating/body only) · referral codes with tracked payouts
(N-6 — `share-button.tsx` shares a plain link, no code, no attribution) ·
Paystack subaccounts / `settlement_schedule: manual` (N-7 — no `subaccount` or
split code anywhere; payouts are platform transfers) · payout batching (N-8) ·
cohort dashboard (N-9) · waitlists (N-10) · recommendation rail (N-11 — the
listing page's "related" is just the 5 newest products) · bundles (N-12) ·
returns portal (N-13) · vendor scorecards (N-14) · `tsvector` search (N-15) ·
image transforms/CDN (N-16) · broader Playwright (N-17) · feature flags (N-18) ·
`apps/mobile` Expo app (N-19 — ADR-001 also anticipates `packages/ui` and
`packages/utils`, neither exists) · read replica (N-20).

---

## Suggested order of work

1. **Item 5** (checkout total) and **item 6** (storefront login wall) — both are
   one-line-to-small fixes with immediate correctness impact.
2. **Items 1–3** — the Bale Split lifecycle: create → fulfil → settle → buyer
   surface. Decide the settlement model first (booking-keyed payouts vs
   converting a filled split into orders); everything else follows from it.
3. **Item 4** — escrow auto-release cron + a real `delivered` timestamp.
4. **Items 16, 17, 20, 21, 22** — photos on listings, metric triggers, listing
   management, admin KYC viewer, dispute amounts. These are the "stranger test"
   and "ops test" items.
5. **Items 7, 9, 12, 13** — email, error monitoring, the money-path E2E, and a
   CI workflow that runs `typecheck + lint + test + typecheck:edge`.
6. **Items 8, 10, 11, 23, 24, 26** — abuse controls, receipt page, payout
   statement, admin ledger/funnel views, promo accounting.
7. Then §5 nice-to-haves in the roadmap's own tier order.

---

## Addendum — a privilege-escalation hole the audit found (fixed by `0031`)

Implementing item 14’s RLS audit turned up a bug that was **not** in the
original list, because it is invisible unless the test environment reproduces
Supabase’s default privileges.

**The mechanism.** Supabase grants `SELECT/INSERT/UPDATE/DELETE` on every table
in `public` to `anon` and `authenticated` (platform default privileges for the
`postgres` role) and treats RLS as the only boundary. Migration `0005` tried to
protect server-managed columns with *column-level* revokes:

```sql
revoke update (role) on public.profiles from authenticated;
grant update (full_name, phone, city, avatar_url) on public.profiles to authenticated;
```

In PostgreSQL a column-level `REVOKE` only removes a column-level grant. When
the role also holds the **table-level** privilege — which it does here — the
table-level grant still authorises every column, so the revoke is a no-op.
Measured against a real cluster with all 30 migrations applied:

```
relacl:  authenticated=arwdDxt/postgres          -- table-level ALL
has_table_privilege (authenticated, profiles, UPDATE)          -> t
has_column_privilege(authenticated, profiles, role, UPDATE)    -> t
update public.profiles set role = 'admin' ...                  -> UPDATE 1
```

**What that allowed**, with an ordinary access token and one PATCH through
PostgREST:

1. any signed-in buyer could set `profiles.role = 'admin'` on their own row —
   RLS `"profiles own update"` permits editing your own row, and `is_admin()`
   reads that column, so it unlocked the admin console, refunds, payouts,
   moderation and every `is_admin()` policy in the schema;
2. any vendor could set `vendor_profiles.verification_status = 'approved'` and
   `subscription_status = 'active'` — KYC and subscription bypass, which also
   unlocks `"products owner insert"` and real payouts;
3. any vendor could set `products.status = 'active'` on their own listing —
   self-publishing past moderation — and forge `views`, `sold_count` and
   `rating_avg`, which drive search ranking.

Two smaller holes surfaced in the same pass:

- `"disputes buyer insert"` checked only `buyer_id = auth.uid()`, so a buyer
  could open a dispute naming a **stranger’s** order. An open dispute freezes
  that order’s 48 h escrow auto-release (`0023`) — a free griefing vector
  against another buyer’s money.
- `push_subscriptions` had owner read/insert/delete but **no update policy**, so
  the browser’s `upsert(..., { onConflict: "endpoint" })` was denied by RLS
  whenever the endpoint already existed: rotated keys were never persisted and
  push silently stopped reaching that device.

**The fix — `supabase/migrations/0031_client_privilege_hardening.sql`:**

- revoke the table-level privileges first, then grant back exactly the verbs and
  columns the app uses (the full client write surface was inventoried from
  `apps/web` before writing it), so a column grant really is the whole privilege;
- `guard_protected_columns()` BEFORE UPDATE triggers on `profiles`,
  `vendor_profiles` and `products` as defence in depth — they fire only for
  `current_user in ('anon','authenticated')`, so SECURITY DEFINER RPCs (which run
  as `postgres`) and Edge Functions (`service_role`) are untouched, but a future
  bulk `GRANT ALL` cannot reopen the hole;
- the dispute policy now requires the named order to belong to the caller;
- `push_subscriptions` gained an owner update policy, and `wishlist-sync.ts`
  switched to `ignoreDuplicates` (ON CONFLICT DO NOTHING), which needs only the
  INSERT privilege the RLS policies already contemplated;
- default privileges for **future** tables are now read-only for clients, so a
  new table starts safe instead of writable.

### The same audit pass also found three broken Storage policies (`0032`)

Extending the audit to `storage.objects` — which the harness had never enforced
RLS on, so every bucket policy was previously untested — turned up damage from
`0027`, which added upload caps by dropping and recreating the INSERT policies:

- **`product-images`** lost 0005’s `exists (… vendor_profiles …)` check, whose own
  comment was “prevents buyers from using the public image bucket as an upload
  sink”. Any signed-in buyer could upload 5 MB images into a *public* bucket:
  free anonymous image hosting on our storage bill, served from a Bale Drop URL.
- **`vendor-documents`** lost the same check, so a non-vendor could write 10 MB
  files into the private KYC bucket.
- **`dispute-evidence`** was recreated under a *different policy name*
  (`"dispute evidence owner insert"` vs 0005’s `"dispute evidence buyer insert"`),
  and `drop policy if exists` made the mismatch silent. Permissive policies
  combine with OR, so the weaker of the two decided: a buyer could write
  `dispute-evidence/<own-uid>/<someone-elses-order-id>/anything.png`. They cannot
  read it back, but the admin console reviews evidence through `dispute-evidence`
  as `service_role`, which bypasses RLS — so a buyer could plant arbitrary images
  or PDFs into a stranger’s dispute and have them shown to the admin deciding
  that refund.

`0032` rebuilds each policy as the union of 0005’s entitlement check and 0027’s
caps, drops the duplicate, and creates the two catalogue buckets in SQL so the
Dashboard step becomes a verification rather than a thing someone can forget.

It also fixes a regression `0031` introduced, which only the audit caught: a
policy expression is permission-checked as the *calling* role, and the
dispute-evidence policies read `public.orders` inline. Once `0031` stopped
granting anon SELECT on the money tables, **every anon read of `storage.objects`
failed with 42501** instead of returning no rows, because that policy is OR’d
into the same query — the exact trap `0017` fixed for `is_admin()`. Order
ownership now lives in a SECURITY DEFINER `is_own_order(uuid)` helper, so the
least-privilege grant set stays intact.

**How it stays closed.** `scripts/check-migrations.py` now grants `ALL` on public
tables to `anon`/`authenticated` in its bootstrap, mirroring production, so a
scenario can only pass because RLS, a column grant or a trigger stopped it —
never because the stub was stricter than Supabase. `supabase/tests/rls_audit.sql`
(20 assertions, CI) then proves both directions: the escalations are denied, and
every legitimate browser write still works, because an over-tight revoke is a bug
too.
