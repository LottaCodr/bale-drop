# Bale Drop

**Trusted Okirika commerce + Bale Split (group buy).**
Verified vendors · escrow payments · tracked delivery · live bale splits.

![stack](https://img.shields.io/badge/web-Next.js_15-black) ![ui](https://img.shields.io/badge/ui-shadcn+v2B8A6) ![db](https://img.shields.io/badge/db-Supabase-3ECF8E) ![pay](https://img.shields.io/badge/pay-Paystack-00C3F7)

## Quickstart

```bash
cd bale-drop
npm install
cp apps/web/.env.example apps/web/.env   # fill in Supabase + Paystack keys
npm run dev                               # → http://localhost:3000
```

No keys yet? The public catalog and transactional screens show a service-unavailable
state. Sample inventory and simulated payments are never served to customers.

## Routes

| Route | Screen |
|---|---|
| `/` | Homepage: hero, live splits, categories, vendors, escrow |
| `/search` | Ranked catalog search (Postgres FTS) — filters, sort and paging are URL state |
| `/listing/[id]` | Listing detail — singles + Bale Split booking widget, seller photos |
| `/cart` · `/checkout` | Multi-vendor cart → delivery + promo → Paystack, server-reconciled totals |
| `/orders` | Order tracking timeline, delivery confirmation, disputes, evidence and reviews |
| `/orders/[id]` | Receipt: line items, server totals, escrow state, money movements, printable |
| `/notifications` | Notification inbox + web-push opt-in |
| `/wishlist` | Saved listings (synced per account) |
| `/account/addresses` | Persistent delivery address management |
| `/sell` | Vendor onboarding wizard (3 steps) |
| `/vendor` | Vendor workspace: listings, bale splits, orders, payouts, documents |
| `/vendor/[id]` | Public shop storefront |
| `/support` | Threaded support (buyer side) — replies land in the admin queue |
| `/policies/[slug]` | Terms, privacy, refunds & disputes, delivery |
| `/login` · `/signup` · `/reset-password` | Auth: show/hide password and friendly errors (requires configured Supabase) |
| `/welcome` | One-time onboarding (name, phone, city) after signup / first Google sign-in |
| `/admin` | Admin queues: approvals, moderation, disputes, payouts, money, audit trail, support |
| `/design` | Living design system (tokens + primitives) |

## Structure

```
bale-drop/
├── apps/web/            # Next.js storefront + vendor + admin
│   ├── app/             # routes (App Router)
│   ├── components/ui/   # shadcn primitives (owned, themed)
│   └── lib/             # utils, formatting and data access
├── packages/database/   # shared Supabase clients + DB types
├── supabase/
│   ├── migrations/      # 0001–0032 schema, RLS, escrow, splits, recovery, search, push, privileges
│   ├── functions/       # 18 Edge Functions + _shared (auth, monitor, rate-limit, notify)
│   └── tests/           # money_path.sql (22 assertions) + rls_audit.sql (20)
├── scripts/             # migration + Edge Function syntax gates, icon + demo-user helpers
└── docs/                # DECISIONS, UX-RESEARCH, ENGINEERING-STANDARDS, ROADMAP, gaps
```

## Backend setup

See **[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md)** — link the project →
apply migrations `0001` through `0032` → add public keys → deploy the Edge
Functions and configure the Paystack webhook, the cron jobs (`bale-expiry`,
`payout-reconcile`, `escrow-release`) and the `notifications` → `push-send`
Database Webhook. Until the backend is configured, commerce and account
features fail closed.

Do not seed demo accounts in a production database. See the setup guide for
local-only test account instructions.

## Docs

- [Architecture decisions](docs/DECISIONS.md) — why Expo over Flutter, why Supabase
- [UX research](docs/UX-RESEARCH.md) — evidence → principles → screen decisions
- [Engineering standards](docs/ENGINEERING-STANDARDS.md) — the rules
