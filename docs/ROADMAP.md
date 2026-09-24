# Bale Drop — Product & Engineering Roadmap

Research + audit date: **2026-09-24**. Owner: lead dev. Review cadence: weekly.

This document answers three questions the build needs settled in writing:

1. **How is a product like this normally built?** (the reference model we are
   deliberately following, and the parts we are deliberately not)
2. **What is must-have versus nice-to-have?** (the bar, then the list)
3. **Where are we?** (a status ledger of what exists in the repo today, and the
   exact acceptance criteria for what is still missing)

Status legend: **DONE** = shipped in this repo and exercised ·
**PARTIAL** = real code, but not switched on / not complete · **TODO** = not
started.

---

## 1. The reference model

A marketplace that holds money and aggregates stranger-to-stranger demand
(our case: thrift bales sold as *splits*, plus a normal cart path) is three
planes that fail independently. Every marketplace that survives being audited
keeps them separate — mixing them is what turns a bug into a lost ledger.

| Plane | What lives here | Failure mode if mixed with the others |
|---|---|---|
| **Catalog** | products, vendors, grades, media, search, reviews | Slow reads become slow money writes |
| **Order** | cart, checkout, order state machine, fulfilment, disputes | Fulfilment edits quietly change paid amounts |
| **Money** | Paystack charges, refunds, payouts, `transactions`, idempotency keys | Nobody can answer "what do we actually owe?" |

Rules the repo already encodes (keep them):

- **The webhook is the truth, not the client.** Browser redirects are
  UX; `paystack-webhook` + `payment_sessions` are the record. Checkout shows
  success *only* after a Realtime confirmation of the paid session.
- **Anything that moves money is idempotent.** `0008_idempotency_and_reconciliation`
  and the Edge Function contracts exist for exactly this.
- **Ledger is append-only.** `transactions` records every movement; balances are
  derived, never stored as a mutable number.
- **Escrow release is explicit.** Buyer confirms, or `48 h` auto-release — that
  number is our answer to "how long is the vendor's money held", and it is
  shown in the UI before it happens.
- **Group-buy is time-boxed with automatic full refund.** Mirrors Pinduoduo:
  dual pricing (per-slot vs whole bale), a hard deadline, capacity-limited
  slots, and an automatic refund when the group fails to fill.
- **Regulated lazily, designed honestly.** Holding third-party money is a
  licensed activity in most African jurisdictions; today we collect and pay out
  ourselves (`vendor-payout`), which is fine at low volume with an internal
  ledger, and is the thing to migrate away from (§4, nice-to-have N-7).

### 1.1 The build order that works

Identity → catalog → cart/checkout → payment + webhook → fulfilment/dispute/release
→ payouts → growth loops → ops/admin → analytics. Skipping to growth loops
before the money plane reconciles is the most common way these projects die:
you cannot tell whether the referral spike made money or lost it.

We are through step 6 and into step 7 with §3's status ledger.

### 1.2 What is deliberately different for Nigeria/₦

- **Paystack, not Stripe.** Card + bank transfer + USSD; NGN only; settlement
  T+1/T+2. Splits settle *directly* to vendor subaccounts and are configured at
  transaction init — you cannot split retroactively, and a refund after
  settlement is debited from the next settlement (so the platform, not the
  vendor, is exposed first). Paystack has **no true escrow**; `settlement_schedule:
  manual` on a subaccount is the closest primitive.
- **FCCPA 2018 consumer rights shape the UI, not just the footer.** Price
  transparency (all costs, including delivery, before the transaction), the
  right to return/refund for goods not as described, and cancellation of
  advance orders without unfair penalty. That is why the delivery subsidy is a
  line item before payment, and why dispute evidence + a refund path are
  must-haves rather than support tickets.
- **Data cost is UX.** CSS/SVG art, system fonts, no image carousels, PWA
  install instead of an app download.

---

## 2. The bar: must-have vs nice-to-have

> **Must-have** = without it, a real buyer cannot complete a *trusted paid*
> purchase, or the business cannot reconcile the money, or it cannot legally
> operate. These are launch blockers.
>
> **Nice-to-have** = it improves conversion, retention, or ops cost, but the
> product still works, sells, and reconciles without it.

Three tests applied to every candidate:

1. **Money test** — can we prove, after the fact, what was paid, to whom, why?
2. **Stranger test** — would a first-time buyer risk ₦45,000 on this screen?
3. **Ops test** — can one person run a day of orders on a phone?

---

## 3. Status ledger — what exists today

### 3.1 State management (the original ask) — DONE

`apps/web/lib/store/` is the single client-state layer; no component talks to
`localStorage` directly any more.

| Piece | Behaviour |
|---|---|
| `cart-store.ts` | zustand + `persist` (`skipHydration`), items + saved-for-later + promo code, `CART_MAX_QTY`/`CART_MAX_LINES` clamps, `sanitizeLine()` repairs corrupt persisted rows instead of dropping a cart |
| `wishlist-store.ts` | local favourites, `merge()` unions server rows on sign-in |
| `prefs-store.ts` | city, theme, recently-viewed (capped), checkout draft, bale slot claims |
| `notification-store.ts` | one shared unread source for the bell **and** `/notifications` |
| `storage.ts` | `persistStorage()` = lazy `localStorage` with in-memory fallback (Safari private mode, SSR, tests) + corrupt-JSON safety; `syncAcrossTabs()` re-hydrates on another tab's write |
| `hydration.tsx` | mounted once in the root layout; rehydrates every store client-side (server HTML stays deterministic) |
| `hooks.ts` | typed selectors (`useCartCount`, `useNotificationBell`, `usePreferences`, `useCheckoutDraft`) |

Rule going forward: **server data stays server data** (Supabase queries in
Server Components); zustand owns only ephemeral/interaction state. Derived
totals are selectors, never duplicated fields.

### 3.2 Discovery & catalog — DONE

- `packages/database/src/search.ts` is the one filter contract shared by live
  Postgres queries and the demo path, so demo mode cannot hide a filter bug.
- Relevance scoring: title 60 / category 30 / description 12, token hits, plus a
  synonym bump only when the synonym maps to the product's own category.
  Non-matches are **filtered out** (`MATCH_THRESHOLD`) — the earlier build
  padded "no results" with unrelated listings, which is a trust bug.
- `sanitizeRemoteQuery()` + `escapeLikePattern()` stop a buyer's punctuation
  from reshaping the PostgREST `or()` filter (security, tested).
- URL is the filter state (`lib/search-params.ts`), so every result page is
  shareable and back-button correct; header search, category pills, hero links
  and the vendor storefront all funnel into `/search`.
- Product page: graded trust block, vendor card, reviews, bale widget, sticky
  mobile buy bar.

### 3.3 Money path — DONE (needs live keys to leave demo)

Checkout: single page, address + delivery + Paystack method pills, escrow note
inside the payment card, delivery subsidy as a line item **before** the pay
button, server-side totals via `reconcileCart()` (price/stock changes surface as
amber "this changed" notices rather than silent repricing), idempotency key held
across retries, success only from the `payment_sessions` Realtime event.

Edge Functions (12 + `_shared/auth.ts`): `paystack-initialize`,
`paystack-webhook`, `bale-expiry`, `order-action`, `logistics-create`,
`logistics-webhook`, `vendor-onboard`, `vendor-payout`, `payout-reconcile`,
`admin-action`, `dispute-evidence`, `review-create`. Migrations `0001–0019`.

Orders: 5-step timeline, tracking chip, explicit "Confirm delivery (releases
escrow)" vs "Open dispute" with photo/PDF evidence, "Buy again" re-prices live
products, reviews after delivery.

### 3.4 Trust, ops & instrumentation — DONE

- Vendor: 3-step onboarding wizard (funnel-instrumented per step), listing
  submission + moderation, dashboard KPIs (live listings, views, units sold,
  order value, action-needed) and a fulfilment path.
- Admin: moderation queue, dispute evidence viewer, money actions labelled with
  the Edge Function they call.
- Notifications: shared store, Realtime INSERT/UPDATE on `notifications`
  (migration `0019`, incl. a guard trigger so `read_at` can only go
  null → now, and the row is otherwise immutable).
- Analytics: `analytics_events` (migration `0018`) with RLS, a 4 KB props
  ceiling, `sanitizeProps()` PII filtering in `lib/analytics.ts`, and the
  funnel instrumented view → cart → checkout → purchase → claim.
- Trust & support surfaces: `/policies` (terms, privacy, refunds & disputes,
  delivery — the numbers in `lib/policies.ts` are traceable to the code that
  enforces them) and `/support`, which writes to `support_messages`
  (migration `0020`, guest-insertable, author/admin read) and appears as a
  queue in the admin console. Both are linked from every footer.
- PWA: `manifest.ts`, generated maskable icons (`npm run icons`),
  offline-safe art, installable.
- Quality gates: `npm run check` (typecheck + lint + 53 unit tests over the cart
  maths, store sanitisation, search contract, URL state, formatting), `/api/health`
  reporting demo vs live, and `instrumentation.ts` which **logs a launch blocker
  in production** if Supabase env vars are missing.

### 3.5 Not implemented — the honest list

`G-1` (legal/trust pages) closed 2026-09-24 by `/policies/*` + `/support`
(migration `0020`). IDs below are unchanged so cross-references stay stable.

| # | Gap | Impact |
|---|---|---|
| G-2 | Live environment: Supabase project, Paystack keys, webhook secret, RLS audit run, PITR/backups | Everything is a demo until this exists |
| G-3 | Transactional email (receipts, reset, dispute updates) | Buyers get no proof of purchase off-app |
| G-4 | Rate limiting / CAPTCHA on auth, claims, disputes | Abuse and cost risk |
| G-5 | Error monitoring + alerting (no Sentry-equivalent wired) | Failures are discovered by buyers |
| G-6 | Real logistic integration (currently a sandbox tracking reference + webhook) | Delivery promises are cosmetic |
| G-7 | Push notifications (web + later mobile) | Urgency loop depends on the buyer revisiting |
| G-8 | E2E/browser tests (unit tests only) | Regressions in flows, not functions |
| G-9 | Payout automation still manual-ish (`vendor-payout` + `payout-reconcile`) | Ops cost grows linearly with vendors |

---

## 4. Must-haves (launch blockers)

Ordered by dependency, with the acceptance criterion that closes each one.

| # | Must-have | Why it blocks launch | Acceptance criterion | Size |
|---|---|---|---|---|
| M-1 | **Live env + secrets** (Supabase, Paystack, webhook secret, storage buckets, cron for `bale-expiry`/`payout-reconcile`) | Nothing is real until it is | `/api/health` returns `mode: live`, a ₦100 test order completes end-to-end, expiry and reconcile jobs run on schedule | M |
| M-2 | **RLS + money audit** run against the live DB | Holding money on a misconfigured policy is the one unrecoverable mistake | Every table has policies exercised by a signed-out, buyer, vendor and admin JWT; `service_role` appears only in Edge Functions | M |
| M-3 | ✅ **Legal/trust set** (`/policies/*`, footer links — was G-1) | FCCPA transparency + buyer confidence | ToS, privacy, refunds, delivery, contact reachable from the footer on every page; refund policy matches the code (48 h release, dispute window, evidence) | S |
| M-4 | **Transactional email** (G-3): receipt, slot-claimed, refund, dispute update, vendor decision | The money record must exist outside the browser | Every one of those five events sends an email; receipt matches the ledger | M |
| M-5 | **Backups & restore drill** (PITR on, one restore rehearsed) | An unrecoverable DB is an unrecoverable business | A restore into a scratch project reproduces `transactions` to the naira | S |
| M-6 | **Abuse controls** (G-4): rate limits on auth/claim/dispute/**support**, CAPTCHA on signup, upload caps | A single script can drain subsidy or fill storage | Limits enforced at the Edge Function + Auth level, logged, tested with a burst | M |
| M-7 | **Error monitoring + alerting** (G-5) | We cannot fix what we cannot see | Web + Edge errors reach one dashboard; a failed webhook alerts a human within 5 min | S |
| M-8 | ✅ **Support path** (`/support` → `support_messages` → admin queue; add WhatsApp/email forwarding before launch) | Disputes need a human door | Logged-in contact form → notification to admin, plus WhatsApp/email; median first response tracked | S |
| M-9 | **Buyer-facing order truth**: receipt page + "where is my money" copy | Stranger test | Buyer can see paid amount, escrow state, release date, and the exact refund rule for their order | S |
| M-10 | **Real delivery posture** (G-6) | Promising delivery we cannot deliver breaks the brand | Either a signed logistics partner with live status, or honest "vendor ships, tracking by <date>" copy everywhere | M |
| M-11 | **E2E smoke of the money path** (G-8) | Manual QA on payments is how refunds get lost | Playwright test: add to cart → checkout → webhook fixture → order timeline → confirm delivery | M |
| M-12 | **Vendor payout calendar + statement** | Vendors are the supply side; silence churns them | Vendor sees a dated statement per order; payout reference visible after `vendor-payout` runs | S |

---

## 5. Nice-to-haves (post-launch, in the order I would build them)

Tiered so "nice-to-have" does not mean "someday": each tier has a trigger that
justifies the work.

### Tier 1 — next sprint after launch (trigger: first 50 orders)

| # | Item | Why / evidence |
|---|---|---|
| N-1 | **Cart drawer** instead of a redirect on add | Cart UX research: a visible drawer lifts add-to-cart→checkout; the code already has the store for it |
| N-2 | **Cross-device cart** (server-side cart row, or `profiles.cart` JSONB) | Persistent carts recover roughly 10–15 % of otherwise-lost sessions; wishlist sync already proves the pattern |
| N-3 | **Web push** (`G-7`), starting with slot-closing-soon and refund-issued | Urgency drives the split loop; email alone is too slow for a 10-minute claim window |
| N-4 | **Saved searches / alerts** | "Notify me when a Grade A bale lands under ₦120k in Kano" is the local shape of this demand |
| N-5 | **Review photos + vendor replies** | Reviews are the highest-ROI trust element; photos reduce "not as described" disputes |
| N-6 | **Referral/share codes with tracked payouts** | The share loop is the group-buy growth mechanic; needs its own ledger entry per code |
| N-7 | **Paystack subaccounts + `settlement_schedule: manual`** for vendor settlement | Removes us from holding third-party funds and removes manual transfer ops; manual settlement is the closest thing to escrow. Prerequisite: vendor KYC/bank verification — which `vendor-onboard` already collects |

### Tier 2 — growth & retention (trigger: 500 orders/month or >₦50m GMV)

| # | Item | Why |
|---|---|---|
| N-8 | **Payout batching + auto-reconciliation dashboard** (G-9) | Ops time per vendor per week becomes the constraint |
| N-9 | **Cohort dashboard**: repeat rate, claim→pay by cohort, refund rate by vendor | Tells us whether the split loop is a habit or a stunt |
| N-10 | **Waitlists for sold-out bales / "similar live now"** | Turns a dead end into demand capture |
| N-11 | **Recommended rail** ("because you viewed…") | Cheap once `analytics_events` has volume; keep it a rail, not an algorithm |
| N-12 | **Bundle / multi-slot discounts** | Increases average order value without new supply |
| N-13 | **Returns portal** (RMA) for non-dispute returns | FCCPA return right at ops scale |
| N-14 | **Vendor scorecards** (dispatch time, dispute rate, response) | Moderation becomes evidence-based, not vibes |

### Tier 3 — engineering scale (trigger: pain, not a date)

| # | Item | Why |
|---|---|---|
| N-15 | **`tsvector` search + GIN index** | Relevance ordering currently proxies through popularity; Postgres full-text removes the proxy |
| N-16 | **Storage image transforms / CDN variants** | Listing photos are the heaviest payload and the main LCP risk on 3G |
| N-17 | **Playwright suite beyond the money path** (search, vendor, admin) | The flows with the most churn after money |
| N-18 | **Feature flags + staged rollout** | Needed before touching checkout for a live buyer base |
| N-19 | **`apps/mobile` (Expo) per ADR-001** | Shares `@bale-drop/database`; only worth it once push/retention is the bottleneck |
| N-20 | **Read-replica / cache layer for the catalog** | Nothing to fix until the DB is the bottleneck; do not pre-optimise |

### Explicit non-goals for v1

Multi-currency and USD settlement · BNPL/instalments (regulated, heavy) · ads or
promoted listings · auctions · in-app chat (WhatsApp/phone is the market norm) ·
custom auth · microservices · a native app before the PWA has retention ·
vendor-side analytics suites.

---

## 6. Launch gate

A release is promotable when: `/api/health` says `mode: live`; the money-path
E2E passes against staging; the RLS audit is signed off; legal pages are linked
from the footer; email receipts land; backups + one restore are proven; error
alerts page a human; the abuse limits hold under a burst; and the funnel
dashboard shows every step from `view_item` to `purchase` for the test order.

Anything not on that list is not a launch blocker — including most of §5.

---

## 7. Sources

- Marketplace MVP scope and the transaction chain —
  [mvp-development.io](https://mvp-development.io/blog/marketplace-mvp-development),
  [lowcode.agency](https://www.lowcode.agency/blog/marketplace-mvp-guide),
  [zetaton.com](https://www.zetaton.com/blog/marketplace-app-development)
- Cart/checkout UX (drawers, persistence, sticky mobile CTA) —
  [belvg.com](https://belvg.com/blog/ecommerce-shopping-cart-ux-best-practices.html),
  [convertcart.com](https://www.convertcart.com/blog/shopping-cart-best-practices),
  [cartboss.io](https://cartboss.io/blog/shopping-cart-abandonment/),
  [justinmind.com](https://www.justinmind.com/blog/ecommerce-cart-design/)
- Group-buy mechanics (dual pricing, deadline, auto-refund, share loop) —
  [acquired.fm — Pinduoduo](https://www.acquired.fm/episodes/pinduoduo),
  [miracuves teardown](https://miracuves.com/blog/what-is-pinduoduo-and-how-does-it-work/),
  [CNBC explainer](https://www.cnbc.com/2020/07/20/what-is-pinduoduo-chinas-third-largest-e-commerce-platform.html)
- Paystack splits, subaccounts, manual settlement, refund-after-settlement risk —
  [Paystack: transaction splits](https://support.paystack.com/en/articles/2132802),
  [splits & marketplaces guide](https://www.mctaba.com/learn/paystack/paystack-split-payments-and-marketplaces-complete-guide),
  [splits explained](https://www.mctaba.com/learn/paystack/paystack-split-payments-explained)
- Nigerian consumer law (price transparency, returns/refunds, complaint
  timelines) — [FCCPA 2018 summary](https://olamideoyetayolegal.com/online-vendors-nigeriaconsumer-rights-and-protectionnigeria/),
  [FCCPC DEON regulations](https://jee.africa/insights/federal-competition-and-consumer-protection-commission-digital-electronic-online-or-non-traditional-consumer-lending-regulations)
- UX principles and screen decisions — `docs/UX-RESEARCH.md`
- Architecture decisions and why (RN, Supabase, Next.js) — `docs/DECISIONS.md`
- Non-negotiable code conventions — `docs/ENGINEERING-STANDARDS.md`
