# Bale Drop — Engineering Standards

> The rules that keep a small team fast without breaking money. Violations get
> caught in review — or they become incidents.

## 1. Stack & repo

- Monorepo (npm workspaces): `apps/web` (Next.js 15 + Tailwind + shadcn),
  `apps/mobile` (Expo — Week 5+), `packages/database` (Supabase clients/types),
  `supabase/` (migrations + Edge Functions), `docs/`.
- TypeScript `strict` everywhere. `npm run typecheck` must pass before merge.
- Path alias `@/*` → app root. No deep relative imports (`../../../`).

## 2. Component rules

- Server Components by default; `"use client"` only for state/effects/event
  handlers. Never `useState` in a server file.
- UI primitives live in `components/ui/*` (shadcn API). No raw `<button>`,
  `<input>`, or hardcoded hex in product code — use variants + tokens.
- One component per concern; colocate tiny helpers; shared bits go in
  `components/commerce.tsx`, `components/site-chrome.tsx`.
- Money/time formatting ONLY via `lib/format.ts` (`naira()`, `toKobo()`).
  Paystack = kobo at the boundary; UI thinks in naira.

## 3. Data rules

- Import Supabase ONLY from `@bale-drop/database` (`@/lib/supabase` in web).
  Never instantiate clients ad-hoc.
- Demo data behind `lib/mock.ts` selectors (`getProduct`, …) so swapping to
  live queries touches one file.
- Realtime for live state (slot counters, order timeline). No polling loops.
- After `supabase gen types`, UI imports Row types from the shared package —
  never redefines DB shapes.

## 4. Money rules (non-negotiable)

1. Secrets (`PAYSTACK_SECRET_KEY`, `service_role`) live ONLY in Edge Function
   env. Never `NEXT_PUBLIC_*`, never in app code, never in git.
2. The webhook is the ONLY thing that marks payments `paid`, with HMAC
   verification + locked finalization and idempotency on `paystack_reference`.
3. Checkout initialization requires a buyer-scoped idempotency key; the same
   key reuses the server-created payment session and order batch.
4. Slot booking is transactional (`claim_bale_slot()` RPC, row lock, one slot
   per buyer). No "check then insert" in app code.
5. Every money movement writes a `transactions` audit row. Refunds/payouts run
   in Edge Functions with persisted provider references, verification-before-
   retry, webhook reconciliation and status tracking.
6. RLS: money tables are read-own-only; no client insert/update/delete.

## 5. Security checklist (pre-launch gate)

- [ ] RLS enabled on every table; anon has zero write to money tables
- [ ] `vendor-documents` and `dispute-evidence` buckets private; signed URLs only
- [ ] Double-submit, webhook replay, payout timeout and refund webhook tests pass
- [ ] Webhook signature enforced; cron secret set; rate limits on
- [ ] `.env` never committed; `service_role` rotated after sharing
- [ ] Supabase PITR backups on paid plan before first real naira

## 6. Git & quality

- `main` is always deployable. Branches: `feat/<ticket>-<slug>`, squash-merge.
- Every PR: typecheck + lint pass, screenshots for UI, migration tested
  up/down on staging, no `console.log` in shipped code.
- Definition of done: works on 360px mobile, keyboard navigable, loading +
  empty + error states, analytics event added, docs updated if behavior changed.

## 7. Performance & a11y budgets

- No external fonts/images on critical path; fixed aspect-ratio media (no CLS);
  `next/image` with Storage transforms in prod.
- AA contrast, focus-visible rings, 44px targets, semantic landmarks,
  `aria-label` on icon-only buttons.

## 8. Commands

| Task | Command |
|---|---|
| Web dev | `npm run dev` (root) |
| Typecheck | `npm run typecheck` |
| DB types | `supabase gen types typescript --linked > packages/database/src/types.ts` |
| Edge typecheck | `deno check --no-config supabase/functions/*/index.ts` |
| Deploy init fn | `supabase functions deploy paystack-initialize --no-verify-jwt` |
| Deploy webhook | `supabase functions deploy paystack-webhook --no-verify-jwt` |
| Deploy reconciliation | `supabase functions deploy payout-reconcile --no-verify-jwt` |
| Set secrets | `supabase secrets set PAYSTACK_SECRET_KEY=... SITE_URL=... CRON_SECRET=...` |
