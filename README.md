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
| `/listing/[id]` | Listing detail — singles + Bale Split booking widget |
| `/checkout?product=...` | Delivery → Paystack test checkout → signed webhook escrow confirmation with retry-safe idempotency |
| `/orders` | Order tracking timeline, delivery confirmation, disputes, evidence and reviews |
| `/notifications` | Buyer/vendor notification inbox |
| `/account/addresses` | Persistent delivery address management |
| `/sell` | Vendor onboarding wizard (3 steps) |
| `/login` · `/signup` · `/reset-password` | Auth: show/hide password and friendly errors (requires configured Supabase) |
| `/welcome` | One-time onboarding (name, phone, city) after signup / first Google sign-in |
| `/admin` | Admin queues: approvals, moderation, disputes, payouts |
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
│   ├── migrations/      # 0001–0016 schema, RLS, escrow, recovery + reconciliation
│   └── functions/       # payment, fulfillment, dispute, payout, logistics + cron functions (Deno)
└── docs/                # DECISIONS, UX-RESEARCH, ENGINEERING-STANDARDS
```

## Backend setup

See **[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md)** — link the project →
apply migrations `0001` through `0021` → add public keys → deploy the Edge
Functions and configure Paystack webhooks/cron jobs. Until the backend is
configured, commerce and account features fail closed.

Do not seed demo accounts in a production database. See the setup guide for
local-only test account instructions.

## Docs

- [Architecture decisions](docs/DECISIONS.md) — why Expo over Flutter, why Supabase
- [UX research](docs/UX-RESEARCH.md) — evidence → principles → screen decisions
- [Engineering standards](docs/ENGINEERING-STANDARDS.md) — the rules
