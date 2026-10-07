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
| 22 | `0022_bale_split_lifecycle.sql` | `create_bale_split` / `fulfil_bale_split` / `cancel_bale_split`, split settlement and refunds |
| 23 | `0023_escrow_auto_release.sql` | 48-hour escrow window, `release_due_escrows()`, delivered-state guard rails |
| 24 | `0024_listing_management_and_metrics.sql` | Listing pause/resume, `record_product_view`, sold-units and vendor-sales counters |
| 25 | `0025_promo_accounting.sql` | Promo reservation/redemption accounting so `max_uses` is real |
| 26 | `0026_fulltext_search.sql` | `search_products()` FTS + synonyms + ranking + pagination |
| 27 | `0027_rate_limiting_and_upload_caps.sql` | `check_rate_limit()`, `upload_within_limits()`, support throttling |
| 28 | `0028_support_threads.sql` | `support_replies`, `support_queue` view with SLA columns |
| 29 | `0029_push_subscriptions.sql` | `push_subscriptions`, `list_push_endpoints()`, `mark_push_delivery()` |
| 30 | `0030_promo_admin.sql` | Admin promo read policy, uppercase/expiry constraints (writes stay on `admin-action`) |
| 31 | `0031_client_privilege_hardening.sql` | Revokes Supabase's default table-level DML from `anon`/`authenticated`, re-grants only the columns the app writes, and adds column-guard triggers |
| 32 | `0032_storage_upload_policies.sql` | Restores the bucket entitlement checks `0027` dropped, merges the duplicated dispute-evidence policy, and moves order ownership into `is_own_order()` so anon can evaluate it |
| last | `supabase/seed.sql` | Optional demo auth users (with identities + correct roles), vendors, listings, splits and one delivered order |

Do not paste only `0004`: the later functions and policies depend on the
later migrations. Verify that `payment_sessions`, `order_refunds`,
`bale_refunds`, `fulfillment_events`, `admin_audit_log`, `rate_limits`,
`support_replies` and `push_subscriptions` exist before connecting Paystack.

Two checks worth running after `db push`:

```bash
python3 scripts/check-migrations.py     # parses every migration, catches drift
npm run check:edge                      # syntax gate over all Edge Functions
```

`supabase/tests/money_path.sql` is an assertion script (22 checks over split
creation → claim → settlement → payout → refund → escrow release). Run it in the
SQL Editor against a scratch project; it prints `PASS`/`FAIL` per assertion and
ends with a `failures: 0` line.


## Step 3 — Create Storage buckets

**Storage** → **New bucket**:

- `product-images` → **Public** ON (listing photos; served as public URLs by
  `publicProductImageUrl()`, so no signed-URL round trip per card)
- `vendor-documents` → Public **OFF** (NIN/shop documents stay private; the
  admin console reads them through `vendor-documents`, which returns 5-minute
  signed URLs)
- `dispute-evidence` → Public **OFF** (buyer evidence is served through short-lived admin links)

All three buckets are created idempotently by migrations (`dispute-evidence` in
`0005`, the other two in `0032`), so this step is now a *verification*: confirm
each bucket exists and that only `product-images` is public. If you created them
by hand first, the migrations leave them alone.

Migration `0027` added the per-bucket upload caps (size and MIME allow-list) that
`upload_within_limits()` enforces; `0032` repaired them, because `0027` recreated
the INSERT policies from the cap alone and silently dropped the entitlement checks
`0005` had put there (a buyer could use the public image bucket as an upload sink,
a non-vendor could write into the KYC bucket, and a duplicated dispute-evidence
policy let a buyer plant files in a stranger's dispute folder).

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
| `SITE_URL=https://your-web-app.example` | Paystack callback URL and every notification link (use `http://localhost:3000` for local testing) |
| `CRON_SECRET=long-random-value` | `bale-expiry`, `payout-reconcile`, `escrow-release` |
| `LOGISTICS_WEBHOOK_SECRET=long-random-value` | signed courier status webhook |
| `LAUNCH_DELIVERY_SUBSIDY_NAIRA=1500` | `paystack-initialize` — the delivery discount floor. Server-authoritative; `0` disables it |
| `RESEND_API_KEY=` / `RESEND_FROM=` | `notify.ts` — receipt, refund, dispute and vendor-decision email |
| `TERMII_API_KEY=` / `TERMII_SENDER_ID=` | `notify.ts` — SMS for the same events |
| `VAPID_PUBLIC_KEY=` / `VAPID_PRIVATE_KEY=` / `VAPID_SUBJECT=mailto:ops@…` | `push-send` — web push (see below) |
| `ALERT_WEBHOOK_URL=` | `monitor.ts` — Slack/Discord-style incoming webhook for caught failures. Optional; unset means log-only |

Email and SMS are independent: with neither key set, notifications are in-app
and push only, and every function still works. Generate the VAPID pair with:

```bash
npx web-push generate-vapid-keys
```

The **public** key also goes in the web app as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`;
without it the push toggle on `/notifications` stays hidden.

Supabase injects `SUPABASE_URL` and the legacy `SUPABASE_SERVICE_ROLE_KEY`
into hosted Edge Functions automatically. Do not try to create a custom hosted
secret with a `SUPABASE_` prefix. For local serving, put the service-role key
in the gitignored `supabase/functions/.env` file.

From the repository root, with the Supabase CLI installed and linked:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set \
  PAYSTACK_SECRET_KEY=sk_test_xxx \
  SITE_URL=https://your-web-app.example \
  CRON_SECRET=long-random-value \
  LOGISTICS_WEBHOOK_SECRET=another-long-random-value \
  LAUNCH_DELIVERY_SUBSIDY_NAIRA=1500

# Both payment functions authenticate inside the function (bearer check / HMAC).
for fn in paystack-initialize paystack-webhook bale-expiry escrow-release \
          payout-reconcile admin-action vendor-payout order-action split-action \
          logistics-create logistics-webhook dispute-evidence review-create \
          vendor-onboard vendor-documents support-reply push-send; do
  supabase functions deploy "$fn" --no-verify-jwt
done
```

All 18 functions authenticate internally — either with the caller's Supabase
bearer session plus a role check, an HMAC signature (Paystack, courier), or
`x-cron-secret`. None of them trust `--verify-jwt` alone.

`paystack-initialize` still requires the caller's Supabase bearer session. The
webhook does **not** use a Supabase JWT because Paystack calls it; it verifies
`x-paystack-signature` with HMAC SHA-512 before touching money.

Configure the scheduled jobs with Supabase Cron (**Database → Cron**, or an
external scheduler hitting the function URL with `x-cron-secret`):

| Job | Schedule | What it does |
|---|---|---|
| `bale-expiry` | every 5 minutes | Releases stale slot reservations, expires unfilled splits, refunds slot buyers, reconciles slot refunds, and prunes `rate_limits` |
| `escrow-release` | every 15 minutes | Releases escrow on orders delivered more than 48 h ago (skips disputed/refunded/cancelled), writes the commission + payout rows, notifies both sides |
| `payout-reconcile` | every 15 minutes | Verifies `processing` Paystack transfers without creating a second one |

A cron row looks like:

```sql
select cron.schedule(
  'escrow-release',
  '*/15 * * * *',
  $$select net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/escrow-release',
      headers := '{"x-cron-secret": "YOUR_CRON_SECRET"}'::jsonb
    )$$
);
```

Without `escrow-release` running, money sits in escrow forever after delivery —
the buyer's receipt says "releases automatically on <date>", so the job is part
of the promise, not an optimisation.

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

## Step 7b — Notifications: email, SMS and web push

Every buyer-facing event writes a `notifications` row in Postgres. Two more
channels hang off that row, and neither is automatic until you wire them.

**Email + SMS** — `_shared/notify.ts` is called from `paystack-webhook`,
`order-action`, `split-action`, `admin-action`, `bale-expiry`, `escrow-release`
and `support-reply`. Set `RESEND_API_KEY` (+ `RESEND_FROM`) for email and
`TERMII_API_KEY` (+ `TERMII_SENDER_ID`) for SMS. With neither set the functions
skip sending and log once — nothing breaks, but a buyer gets no receipt off-app.

**Web push** — needs a Supabase **Database Webhook**, because `push-send` must
run on every new notification, not on a schedule:

1. **Integrations → Webhooks → Create a new hook** (or Database → Webhooks).
2. Name: `push-send`. Table: `public.notifications`. Events: **INSERT**.
3. Type: **Supabase Edge Function** → `push-send`.
4. Payload: the default `{"record": …}` template is what the function reads.

The function looks up the recipient's endpoints with `list_push_endpoints()`,
sends via `web-push` signed with `VAPID_PRIVATE_KEY`, and calls
`mark_push_delivery()` to delete endpoints that answer `410`/`404` (browsers
rotate them). It is secret-guarded and rate-limited like the rest.

On the client side the toggle lives on `/notifications`; it registers
`public/sw.js` and upserts into `push_subscriptions`. It only appears when
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set **and** the site is served over HTTPS
(`localhost` counts). The service worker deliberately caches nothing — a stale
cached price or stock level on a commerce page is worse than a reload.

Test it end to end: opt in on `/notifications`, then insert a `notifications`
row for your own profile in the Table Editor. A browser notification should
appear within a few seconds; **Logs → Edge Functions → push-send** shows the
delivery count.

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

One-tap demo sign-in on `/login` is **off by default**. It renders only when
both are true:

- `NEXT_PUBLIC_DEMO_LOGINS=true` in the web app's environment, and
- the build is not `NODE_ENV=production`.

The flag is inlined at build time, so a production bundle cannot be flipped on
by an environment change alone. Even so: do not create or retain seeded demo
users in production, particularly the admin account with a known password. Use
a separate local or staging project for these accounts, and delete them (or set
`NEXT_PUBLIC_DEMO_LOGINS=false`) before inviting real customers.

The buttons sign in through the same `signInWithPassword` path as the form —
there is no bypass and no synthetic session, so a demo login exercises exactly
what a real one does.

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
- Deploy and monitor all three cron jobs — `bale-expiry`, `payout-reconcile`
  and `escrow-release`. The first two reconcile asynchronous Paystack
  refunds/transfers without duplicate money movement; the third is what
  actually pays vendors 48 h after delivery.
- Confirm the `notifications` → `push-send` Database Webhook exists, or push
  opt-ins silently do nothing.
- Confirm migrations `0001`–`0032` have been applied and regenerate the shared
  database types from the linked project.
- Run the RLS audit against the live project (`supabase/tests/rls_audit.sql`).
  It asserts that no client session can escalate `profiles.role`, self-approve
  `vendor_profiles.verification_status` or self-publish `products.status`, and
  that every legitimate browser write still works — so it fails loudly if a
  Dashboard "reset privileges" action hands table-level DML back to clients. It
  also asserts the bucket rules: anon sees only `product-images`, a non-vendor
  cannot write to either vendor bucket, evidence must be filed under an order the
  caller owns, and oversize/wrong-MIME/size-less uploads fail closed.
- Delete seed users and rotate any credential that was shared during setup.
