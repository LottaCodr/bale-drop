# Supabase + Paystack test-mode setup (no CLI required for the database)

Time: ~30 minutes. The app stays usable on demo data until Supabase public
keys exist. Once live keys are present, auth, live listings, Realtime, and the
payment flow use the cloud project.

## Step 1 — Create the Supabase project

1. Go to supabase.com → **New project** (free tier is fine).
2. Name: `bale-drop-dev`. Region: **West EU (Ireland)** — lowest latency to
   Nigeria until Supabase ships an Africa region.
3. Save the database password in a password manager. Wait for provisioning.

## Step 2 — Apply the database migrations

Use the Supabase CLI for a real migration history (recommended):

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

If you are using SQL Editor, run every file in numeric order, once:

| Order | File | What it does |
|---|---|---|
| 1 | `0001_init.sql` | Core tables, RLS, escrow columns and slot-claim RPC |
| 2 | `0002_metrics.sql` | Listing metrics and rating fields |
| 3 | `0003_auth_and_storage.sql` | Signup profile trigger and Storage RLS |
| 4 | `0004_payment_spine.sql` | Payment sessions and webhook-only escrow finalizer |
| 5 | `0005_operations_and_security.sql` | Fulfillment, disputes, reviews, admin audit and hardened RLS |
| 6 | `0006_slot_reservations.sql` | Expiring pending slot reservations |
| 7 | `0007_inventory_and_payment_recovery.sql` | Atomic stock reservation/release and failed-payment recovery |
| 8 | `0008_idempotency_and_reconciliation.sql` | Checkout idempotency keys, payout state machine and order/slot refund reconciliation |
| 9 | `0009_atomic_order_inventory.sql` | All checkout order lines reserve stock in one transaction |
| 10 | `0010_refund_transaction_audit.sql` | Keeps original pay-ins and refund movements separately idempotent |
| 11 | `0011_fulfillment_idempotency.sql` | Makes tracking/status webhook replays safe |
| 12 | `0012_refund_claim_leases.sql` | Prevents concurrent refund workers from creating duplicate provider refunds |
| 13 | `0013_payout_reconcile_ownership.sql` | Prevents forced payout reconciliation from creating a second transfer |
| 14 | `0014_payout_reference_rotation_claim.sql` | Atomically owns retry after a provider-reported failed transfer |
| 15 | `0015_payout_settlement_guard.sql` | Prevents stale transfer events from settling a newer payout attempt |
| 16 | `0016_pending_payment_expiry.sql` | Releases inventory from old ambiguous sessions without an authorization URL |
| 17–21 | `0017` … `0021_auth_profile_onboarding.sql` | Admin grant, wishlists/analytics, notifications, support, OAuth-aware signup trigger |
| last | `supabase/seed.sql` | Optional demo auth users (with identities + correct roles), vendors, listings, splits and one delivered order |

Do not paste only `0004`: the later functions and policies depend on the
later migrations. Verify that `payment_sessions`, `order_refunds`,
`bale_refunds`, `fulfillment_events`, and `admin_audit_log` exist before
connecting Paystack.


## Step 3 — Create Storage buckets

**Storage** → **New bucket**:

- `product-images` → **Public** ON (listing photos)
- `vendor-documents` → Public **OFF** (NIN/shop documents stay private)
- `dispute-evidence` → Public **OFF** (buyer evidence is served through short-lived admin links)

## Step 4 — Auth configuration

**Authentication → Providers → Email**

- **Confirm email**: OFF for instant demo signups; ON before real users.
- **Minimum password length**: set to **8** (the app enforces 8, following
  NIST SP 800-63B; Supabase's default is 6).
- Optional (Pro plan): enable **Leaked password protection**. The web app
  already screens new passwords against Have I Been Pwned in the browser.

**Authentication → URL Configuration**

- **Site URL**: your production origin, e.g. `https://baledrop.ng`
- **Redirect URLs**: add every origin you use, with a wildcard path:
  - `http://localhost:3000/**`
  - `https://your-preview-domain.vercel.app/**`
  - `https://baledrop.ng/**`

  Without this, confirmation, reset and Google links fall back to the Site URL
  and new users land on the wrong page, signed out.

**Authentication → Email Templates** (recommended). Links opened in a
different browser than the one that signed up can't complete the PKCE flow.
Token-hash links work everywhere; the app handles both at `/auth/confirm`.

| Template | Link to use |
|---|---|
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/welcome` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password` |
| Magic link | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink` |
| Change email | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change` |

Keeping the default `{{ .ConfirmationURL }}` also works (it goes to
`/auth/callback?code=…`). If the user opens it in another browser, they land on
`/login` with a "Email confirmed — sign in" notice instead of an error.

**Google (optional)**: Providers → Google → add the OAuth client ID/secret, and
add `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as an authorised
redirect URI in Google Cloud. Until it is enabled, the Google button shows a
friendly "not enabled yet" message.

### The auth flow at a glance

```
/signup ── email+password ──► (confirm email?) ──► /auth/confirm ─┐
/login  ── password / demo / Google ───────────────────────────────┤
                                                                   ▼
                   first time & no phone/city? ──► /welcome (skippable, once)
                                                                   ▼
                  ?next= target ▸ else admin → /admin · vendor → /vendor · buyer → /
```

- Sellers who sign up go on to `/sell`. The wizard now checks sign-in *before*
  step 1, so nobody loses a filled-in application.
- Signed-in users who open `/login` or `/signup` are sent on to their `next`.
- `/checkout`, `/orders`, `/account`, `/notifications`, `/vendor`, `/admin`,
  `/welcome` require a session; the full path and query are kept in `next`.

## Step 5 — Copy public keys into the web app

**Project Settings** → **API** → copy:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

```bash
# apps/web/.env.local (gitignored — never commit)
NEXT_PUBLIC_SUPABASE_URL=https://xyzcompany.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Restart Next.js. The homepage should now use live rows, `/login` should use
real Supabase auth, and `/checkout` + `/orders` + `/admin` should require a
session.

## Step 6 — Paystack test-mode keys and Edge Functions

Create a Paystack account, switch to **Test mode**, and copy the test keys from
**Settings → API Keys & Webhooks**. Never put the secret key in browser code.

The functions need these secrets:

| Secret | Used by |
|---|---|
| `PAYSTACK_SECRET_KEY=sk_test_...` | initialize, webhook, refunds, transfers and reconciliation |
| `SITE_URL=https://your-web-app.example` | Paystack callback URL (use `http://localhost:3000` for local testing) |
| `CRON_SECRET=long-random-value` | bale expiry and payout reconciliation jobs |
| `LOGISTICS_WEBHOOK_SECRET=long-random-value` | signed courier status webhook |

Supabase injects `SUPABASE_URL` and the legacy `SUPABASE_SERVICE_ROLE_KEY`
into hosted Edge Functions automatically. Do not try to create a custom hosted
secret with a `SUPABASE_` prefix. For local serving, put the service-role key
in the gitignored `supabase/functions/.env` file.

From the repository root, with the Supabase CLI installed and linked:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx SITE_URL=https://your-web-app.example CRON_SECRET=long-random-value LOGISTICS_WEBHOOK_SECRET=another-long-random-value

# Both payment functions authenticate inside the function (bearer check / HMAC).
supabase functions deploy paystack-initialize --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy bale-expiry --no-verify-jwt
supabase functions deploy payout-reconcile --no-verify-jwt
supabase functions deploy admin-action --no-verify-jwt
supabase functions deploy vendor-payout --no-verify-jwt
supabase functions deploy order-action --no-verify-jwt
supabase functions deploy logistics-create --no-verify-jwt
supabase functions deploy logistics-webhook --no-verify-jwt
supabase functions deploy dispute-evidence --no-verify-jwt
supabase functions deploy review-create --no-verify-jwt
supabase functions deploy vendor-onboard --no-verify-jwt
```

`paystack-initialize` still requires the caller's Supabase bearer session. The
webhook does **not** use a Supabase JWT because Paystack calls it; it verifies
`x-paystack-signature` with HMAC SHA-512 before touching money.

Configure the scheduled jobs with Supabase Cron or an external scheduler:

- `bale-expiry`: `POST` with `x-cron-secret`; release stale slot reservations,
  expire splits and reconcile slot refunds.
- `payout-reconcile`: `POST` with `x-cron-secret`; verify processing Paystack
  transfers without creating a new transfer.

Logistics starts with a deterministic sandbox tracking adapter. Its unique
`external_event_id` makes repeated dispatch clicks safe; replace that adapter
with a courier API only after storing the provider event/reference and adding
its webhook reconciliation.

The admin **Reconcile transfer** action is the explicit recovery path when a
transfer reference is verified as missing and a new POST is safe.

For local Edge Function development, use `supabase/functions/.env` (gitignored)
with the same values and serve the function with `--env-file`.

## Step 7 — Configure the Paystack webhook

In Paystack **Settings → API Keys & Webhooks**, set the test webhook URL to:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/paystack-webhook
```

The browser flow is:

1. `/checkout?product=...` sends product IDs only to `paystack-initialize`,
   together with a browser-attempt idempotency key.
2. The function recalculates prices, atomically reserves inventory, creates
   `pending_payment` orders and a unique `payment_sessions` row, then returns
   Paystack's authorization URL. Repeating the same attempt reuses that row
   and reference.
3. The customer pays in Paystack test mode (card, bank transfer or USSD).
4. Paystack signs `charge.success`; the webhook verifies the signature and the
   stored amount.
5. `finalize_payment_session()` atomically changes orders to `paid` +
   `escrow_status = held`, creates the order timeline entry, and writes the
   transaction audit row.
6. Paystack redirects back to `/checkout?reference=...`; the page waits for
   the signed webhook's Realtime update. A redirect alone never means paid.
   Ambiguous initialization keeps the same session/reference pending; the
   scheduled expiry job cancels sessions that still have no authorization URL
   after 30 minutes and restores their reserved stock.

## Step 8 — Prove the flow in test mode

1. Sign in as `buyer1@baledrop.demo` (password below).
2. Open an active listing → **Buy now** → choose a payment method.
3. Confirm the Paystack URL opens. Use a Paystack test card or test transfer
   instructions; do not use a real card.
4. Return to Bale Drop. The confirmation screen should say the amount is held
   in escrow. In Supabase, verify:
   - `payment_sessions.status = success` and `idempotency_key` is populated;
   - `orders.status = paid`;
   - `orders.escrow_status = held`;
   - `orders.paystack_reference` is populated;
   - one `transactions.kind = pay_in` row exists per order.
5. Re-send the same webhook event from Paystack. The unique audit indexes and
   locked finalizer must not create a second payment row.
6. Double-click the Pay button or replay the same initialize request with the
   same `idempotency_key`; it must return the original authorization URL and
   must not create another order batch.
7. For a payout, simulate a lost transfer response, run `payout-reconcile`,
   and verify that the stored transfer reference is checked before any retry.
   Run two forced reconciliations concurrently; only one may own a new
   reference after Paystack reports the old transfer as failed.
8. Send two refund-resolution requests concurrently. One claim may call
   Paystack; the other must receive `processing` with a retry window, not create
   a second provider refund.
9. For a dispute refund, confirm that `order_refunds` stays `processing` until
   `refund.processed`; only then should the order become `refunded` and stock
   be restored.

**Realtime slots (separate 60-second check):** insert a paid `bale_bookings`
row in Table Editor and bump its listing counter; the listing widget updates
without refresh.

## Demo logins (password for all: `BaleDrop123!`)

`/login` shows one-tap **Buyer / Vendor / Admin** demo buttons while
`NEXT_PUBLIC_DEMO_LOGINS` is not `false`. Set it to `false` for real launches.

### "Invalid login credentials" on a demo account?

Projects seeded before this fix have broken demo users. The old seed left
`instance_id` NULL (GoTrue only finds users whose `instance_id` is the nil
UUID), created no `auth.identities` row, left token columns NULL, and gave
every demo profile the `buyer` role. Repair it, choosing **one** of:

1. **SQL Editor**: paste and run `supabase/fix-demo-logins.sql`. It is
   idempotent and ends with a check query where every row should say `ok = true`.
2. **Admin API**: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run seed:demo-users`

Still failing? Check that the app's `NEXT_PUBLIC_SUPABASE_URL` points at the
same project you repaired, and look at **Logs → Auth** for the real error.


| Email | Role | Use for |
|---|---|---|
| `admin@baledrop.demo` | admin | Admin console |
| `buyer1@baledrop.demo` … `buyer9@` | buyer | Slot claims, checkout, orders |
| `adaeze@baledrop.demo` | vendor | Inspected Lagos shop |
| `kano@baledrop.demo` | vendor | Inspected Kano shop |

## Before real money

- Replace test keys with live keys only after webhook replay/idempotency tests.
- Enable Point-in-Time Recovery and verify backups.
- Set a real `SITE_URL`; turn email confirmation back ON; set `NEXT_PUBLIC_DEMO_LOGINS=false`.
- Deploy and test `order-action` for fulfillment, buyer confirmation and disputes before releasing escrow.
- Deploy and monitor `bale-expiry` and `payout-reconcile`; they reconcile
  asynchronous Paystack refunds/transfers without duplicate money movement.
- Confirm migrations `0005`–`0017` have been applied and regenerate the shared
  database types from the linked project.
- Delete seed users and rotate any credential that was shared during setup.
