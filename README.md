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

No keys yet? The app runs on a demo data layer (`apps/web/lib/mock.ts`) so UI
work never blocks on backend.

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
| `/login` · `/signup` · `/reset-password` | Auth: show/hide password, one-tap demo accounts, friendly errors (live Supabase; demo pass-through without keys) |
| `/welcome` | One-time onboarding (name, phone, city) after signup / first Google sign-in |
| `/admin` | Admin queues: approvals, moderation, disputes, payouts |
| `/design` | Living design system (tokens + primitives) |

## Structure

```
bale-drop/
├── apps/web/            # Next.js storefront + vendor + admin
│   ├── app/             # routes (App Router)
│   ├── components/ui/   # shadcn primitives (owned, themed)
│   └── lib/             # utils, format, supabase, mock data layer
├── packages/database/   # shared Supabase clients + DB types
├── supabase/
│   ├── migrations/      # 0001–0016 schema, RLS, escrow, recovery + reconciliation
│   └── functions/       # payment, fulfillment, dispute, payout, logistics + cron functions (Deno)
└── docs/                # DECISIONS, UX-RESEARCH, ENGINEERING-STANDARDS
```

## Backend setup

See **[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md)** — link the project →
apply migrations `0001` through `0021` → add public keys → deploy the Edge
Functions and configure Paystack webhooks/cron jobs. Until then the app runs on
the mock fallback dataset; no real money is collected.

**Demo logins fail with "Invalid login credentials"?** Run
`supabase/fix-demo-logins.sql` once in the Supabase SQL editor (details in the
setup guide).

## Docs

- [Architecture decisions](docs/DECISIONS.md) — why Expo over Flutter, why Supabase
- [UX research](docs/UX-RESEARCH.md) — evidence → principles → screen decisions
- [Engineering standards](docs/ENGINEERING-STANDARDS.md) — the rules
