# Architecture Decision Records

> Short, dated, reversible-by-default. Revisit when facts change.

---

## ADR-001 — Mobile: React Native (Expo) over Flutter — 2026-09-22

**Status:** Accepted (mobile build starts ~Week 5; web PWA first)

**Context:** Marketplace needs web + iOS + Android. Team is small (1 lead dev),
deadline is Dec 31, web is Next.js/TypeScript, backend is Supabase.

**Decision:** React Native with Expo. (Web ships first as mobile-first PWA so
Android/iOS review never blocks launch.)

| Factor | React Native + Expo | Flutter |
|---|---|---|
| Language sharing | TypeScript everywhere: web + mobile + Edge Functions (Deno). Shared Supabase types, zod schemas, money utils | Dart = second language, second toolchain, duplicated logic |
| Team velocity | One dev stays in one ecosystem; copy patterns web→mobile | Context-switching + learning curve on a 14-week deadline |
| Hiring (Nigeria) | Large JS/TS pool in Lagos/Abuja; easy to find help | Smaller Dart pool |
| OTA updates | EAS Update: push fixes without store review (critical for escrow bugs) | Shorebird exists but less mature; store review for most fixes |
| Supabase DX | Same `supabase-js` client, same Realtime channels as web | `supabase-flutter` is good but a separate API surface |
| Performance | More than enough for lists/forms/checkout (our workload) | Wins on 60fps custom animation — which we don't need |
| Risk | JS ecosystem churn | Rewriting shared logic twice; slower hiring |

**When we'd pick Flutter instead:** existing Dart expertise on the team, a
single mobile-only app (no web), or heavy custom animation/gaming UI.

**Consequences:** monorepo gets `apps/mobile` (Expo) sharing
`packages/database`, `packages/ui` (future), `packages/utils`.

---

## ADR-002 — Backend: Supabase (Postgres) — 2026-09-22

**Status:** Accepted

**Context:** Relational marketplace data (orders, escrow ledger, splits),
need auth + storage + realtime + serverless functions, fast.

| Option | Verdict |
|---|---|
| **Supabase** | ✅ Postgres (joins for orders/payouts/ledger), Auth, Storage, Realtime, Edge Functions, RLS, generated TS types, self-hostable exit. Free tier → paid with PITR before real money. |
| Firebase | ❌ NoSQL fights relational escrow/ledger logic; unpredictable billing; lock-in. |
| Custom NestJS + Postgres | ⏸️ Best long-term control, but 4–6 weeks to rebuild auth/storage/realtime. Revisit post-PMF. Migration is easy anyway — data already lives in Postgres. |
| Appwrite / PocketBase | ❌ Smaller ecosystems, weaker realtime/function story. |

**Risks & mitigations:**
- RLS misconfiguration → strict policies in migration, `supabase gen types`, security review before launch, no `service_role` in apps.
- Realtime scale → fine for MVP counters; move to broadcast channels if needed.
- Money safety → all Paystack secrets + refunds + transfers in Edge Functions; `claim_bale_slot()` RPC is transactional with row locks; append-only `transactions` audit.

---

## ADR-003 — Web: Next.js App Router + Tailwind + shadcn — 2026-09-22

**Status:** Accepted

**Rationale:** Server Components for fast product/listing pages (SEO + low-end
Android), one framework for storefront + vendor + admin (`/admin` route),
shadcn = owned components (no dependency churn), Lucide icons, CSS-variable
theming ready for dark mode and white-labeling later.
