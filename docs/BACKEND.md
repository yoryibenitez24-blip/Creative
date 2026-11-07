# Store backend: Stripe payments, Supabase, analytics

Everything is in the repository. To take real payments you add **keys only**: public values in the admin
(Settings › Payments / Integrations), secrets with `supabase secrets set`.

```
storefront (static, any host)          Supabase project (backend/supabase)                     Stripe
  checkout button ── POST cart ──▶  create-checkout-session ── prices from DB ──▶ Checkout Session ──┐
  success page   ◀── order-status ──  orders / order_lines                                           │ shopper pays
  beacons        ───────────────▶   track → analytics_events                                         │
                                     stripe-webhook ◀──────────────── signed events ◀────────────────┘
admin (local, IndexedDB) ── sign in (Bearer token) ─▶ sync-catalog (auto) · stripe-connect-onboard/-status · read orders (RLS)
```

## What is where

| Path | What |
| --- | --- |
| `backend/supabase/migrations/20261107000000_zertake_commerce.sql` | Tables, indexes, RLS, helper SQL functions, the private `digital-products` bucket |
| `backend/supabase/functions/*/index.ts` | Edge Functions (Deno, `npm:stripe@23.1.0`, `npm:@supabase/supabase-js@2.119.0`) |
| `backend/supabase/functions/_shared/` | Shared code. Pure modules (cart, checkout params, fees, signature, email, webhook mapping, …) are unit-tested from Node (`tests/backend.test.js`) |
| `backend/supabase/functions/_shared/engine.js`, `services.js` | **Generated** from `src/store/commerce.js` and `src/store/admin/services.js` (`node backend/scripts/gen-engine.mjs`), so the server prices carts and booking slots with exactly the storefront/admin code. A test fails when they are stale. |
| `backend/supabase/config.toml` | Function settings (`verify_jwt = false`: each function authenticates itself) |
| `backend/client/api.js`, `orders.js` | Browser client for the admin (sign-in, sync, onboarding, reading orders) + rows → admin documents |
| `backend/typecheck/` | `tsc` setup that checks the functions against the real Stripe / supabase-js typings |
| `src/store/commerce.js` | Storefront side: `payConfig`, the pay/analytics layer (`payRuntime`), `catalogSnapshot` |

## Functions

| Function | Caller | Auth | Purpose |
| --- | --- | --- | --- |
| `create-checkout-session` | storefront | public (rate-limited, Turnstile, origin allow-list) | Validates the cart against the `products` snapshot (client prices are ignored), recomputes discounts → shipping → tax with the shared engine, checks booking slots, creates a pending order + a Stripe Checkout Session, returns `{ url }` |
| `stripe-webhook` | Stripe | Stripe signature | Idempotent (one `webhooks_log` row per event): orders, payments, refunds, disputes, subscriptions, connected accounts; on payment: stock, `order_placed` analytics, bookings / service projects / download grants, confirmation email |
| `stripe-connect-onboard` | admin | owner token (see below) | Creates the Express/Standard/Custom account (or adopts one) and returns the onboarding link → `{ url, accountId, onboardingStatus, chargesEnabled, payoutsEnabled }` |
| `stripe-connect-status` | admin | owner token | Live account state: charges/payouts enabled, requirements |
| `customer-portal` | storefront / admin | Checkout Session id, or owner token | Stripe Billing portal session |
| `order-status` | storefront success page | Checkout Session id | Order number, payment state, masked email, download links |
| `booking-slots` | storefront checkout | public | Free times of a bookable service (admin rules + stored bookings) |
| `download` | buyer (email / success page) | grant token | Counts a download, redirects to a 60 s signed Storage URL |
| `track` | storefront (sendBeacon) | public (rate-limited) | First-party analytics (IP stored only as a daily-salted hash) |
| `send-email` | admin / server | owner token or service key | (Re)send the order confirmation (Resend, SendGrid or Postmark) |
| `sync-catalog` | admin | owner token | Upserts the store settings + product snapshot the checkout trusts |

## Set up (once, ~20 minutes)

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com) (any region). Note the **Project URL** (`https://<ref>.supabase.co`)
   and, under *Project Settings › API keys*, the **anon / publishable** key (public) and the **service_role / secret** key (secret).
2. Install the CLI (`npm i -g supabase` or `brew install supabase/tap/supabase`), then from the repository:

```bash
cd backend
supabase login
supabase link --project-ref <ref>
supabase db push                      # applies supabase/migrations/*.sql
```

3. *Authentication › Providers*: keep **Email** enabled (the admin signs in with a magic link / code). Under
   *Authentication › URL configuration* add the admin's URL (e.g. `http://localhost:4173`) to the redirect URLs.

### 2. Stripe

1. [dashboard.stripe.com](https://dashboard.stripe.com) › Developers › API keys: copy the **secret key**
   (`sk_test_…` while testing) and the **publishable key** (`pk_test_…`).
2. Selling for other merchants (Connect)? *Connect › Get started* — choose the platform profile, enable Express and/or
   Standard accounts, set your branding (shown on onboarding), and under *Connect › Settings* the countries you support.
   Running only your own shop? Skip Connect: leave the account empty and payments go to the account of `STRIPE_SECRET_KEY`.
3. *Developers › Webhooks › Add endpoint*:
   - URL: `https://<ref>.supabase.co/functions/v1/stripe-webhook` (Settings › Payments shows it too)
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
     `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,
     `payment_intent.amount_capturable_updated`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`,
     `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `account.updated`
   - Copy the **signing secret** (`whsec_…`).
   - With **Standard** accounts (direct charges) add a second endpoint with the same URL and *"Events on Connected accounts"*;
     its signing secret goes into `STRIPE_CONNECT_WEBHOOK_SECRET`.
4. Optional: *Settings › Billing › Customer portal* (needed for `customer-portal`), *Stripe Tax* registrations (for
   "automatic tax"), *Settings › Payment methods* (methods shown when none are pinned in Settings › Payments),
   Apple Pay domain verification for your shop domain.

### 3. Secrets (exact names)

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_... \
  STRIPE_WEBHOOK_SECRET=whsec_...
# optional
supabase secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...   # Standard accounts / direct charges
supabase secrets set PLATFORM_FEE_PERCENT=2.5                  # pins the platform fee (overrides the store setting)
supabase secrets set REQUIRE_CONNECTED_ACCOUNT=true            # platforms: refuse checkout until the merchant onboarded
supabase secrets set TURNSTILE_SECRET_KEY=0x4AAAA...           # set together with the Turnstile site key in Settings
supabase secrets set RESEND_API_KEY=re_...                     # or SENDGRID_API_KEY=SG.... or POSTMARK_SERVER_TOKEN=...
supabase secrets set EMAIL_FROM=orders@yourshop.com            # fallback sender (Settings › Integrations › Email wins)
supabase secrets set EMAIL_PROVIDER=resend                     # only if several provider keys are set
supabase secrets set TRACK_SALT=$(openssl rand -hex 16)        # salt of the daily IP hash in analytics
supabase secrets set ALLOW_ANON_ONBOARDING=true                # see "Admin sign-in" (single-merchant projects only)
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically by Supabase. Never put any of
these values in the admin settings — the settings end up in the public storefront (the admin rejects secret-looking values).

### 4. Deploy the functions

```bash
cd backend
supabase functions deploy create-checkout-session stripe-webhook stripe-connect-onboard stripe-connect-status \
  customer-portal order-status booking-slots download track send-email sync-catalog --no-verify-jwt
```

(`config.toml` already sets `verify_jwt = false`; the flag makes it explicit.) Logs: Dashboard › Edge Functions › *name* › Logs.

### 5. Admin settings (public values only)

- *Settings › Integrations › Backend*: provider **Supabase**, Project URL, anon/publishable key (Functions URL defaults to `<url>/functions/v1`).
- *Settings › Apps and integrations › Supabase*: **Sign in to your backend** (see "Admin steps" below).
- *Settings › Payments › Stripe*: enable, mode **Test**, `pk_test_…`, connect type, fees, capture, payment methods, statement
  descriptor, automatic tax, 3-D Secure, billing (subscriptions, customer portal, invoices, trial days). Then **Connect with Stripe**.
- *Settings › Domains*: the shop's public `https://` address — used for Stripe return URLs and the CORS/origin allow-list.
- Optional in *Integrations*: Turnstile site key, GA4 / GTM / Meta / TikTok / Pinterest / Clarity ids, Sentry DSN, email
  sender. They are rendered by the storefront (consent-gated); the checkout forwards `add_to_cart`, `begin_checkout` and
  `purchase` to GA4 / Meta / TikTok after consent.
- The catalog is published to the backend automatically while you are signed in (see below) — the checkout charges
  what the backend has, not what an old export shows. Then export / publish the store.

### Admin steps (after the keys are in)

1. *Settings › Apps and integrations › Supabase*: paste the Project URL and anon key, **Save**, then **Sign in to your backend**
   in the same card. Pick one:
   - **Magic link** — "Email me a sign-in link"; open the link in this browser. It returns to the admin page you were on
     (`…#access_token=…`); the admin takes the tokens out of the URL before routing and shows "Signed in to your backend as …".
     Add the admin URL(s) to *Authentication › URL configuration › Redirect URLs* in Supabase.
   - **One-time code** — "Email me a code", then type the 6-digit code from the same email (stays in the current tab).
     The default Supabase email template only has the link; add `{{ .Token }}` to *Authentication › Email templates ›
     Magic link* to include the code.
   - **Password** — for accounts created with a password in *Authentication › Users*.

   The session is kept in memory and in the tab's `sessionStorage` only (key `zt-backend-session:<project URL>`): it is never
   written into the commerce/store documents, JSON backups or exported sites, and it ends when the tab closes. A magic link
   signs in the tab it opens. The header shows a status chip ("Synced 2 min ago", "Sync failed", "Sign in to backend").
2. *Settings › Payments*: **Connect with Stripe** (asks you to sign in first if needed) calls `stripe-connect-onboard` with
   `Authorization: Bearer <your access token>` + `apikey: <anon key>` and opens Stripe's onboarding. Back in the admin,
   **Refresh status** calls `stripe-connect-status` and writes the account id, onboarding status, charges and payouts into the
   settings — click **Save** to keep them.
3. **Publish catalog to backend** (Products header, Settings › Payments › *Catalog on your backend*, the Supabase card) posts
   `catalogSnapshot(store, commerce)` to `sync-catalog` — the first call creates the store row owned by you. While you are
   signed in, every change to products, prices, stock, discounts, tax, shipping or payment settings is published
   automatically ~2 s after the edit; the indicator shows "Synced 2 min ago" or "Sync failed — retry". The snapshot is checked
   for secret-looking values before it is sent (and only public settings are in it).
4. **Sync orders from backend** (Orders, Services › Bookings, the Supabase card) reads paid orders, bookings and service
   projects with your token (RLS: your stores only), maps them with `backendToCommerce` and merges them into the admin
   ("Imported 2 orders, 1 booking"). Records keep their backend id (`sb_<uuid>`), so re-running only updates them — no
   duplicates. With **Auto** ticked, the Orders/Bookings page re-checks every 60 s while it is open and you are signed in.
5. Sign out in the Supabase card. An expired or revoked session (HTTP 401) signs you out with "Sign in again".

Screenshots: `docs/evidence/backend-sign-in.jpg` (sign-in prompt from Connect with Stripe), `backend-sign-in-card.jpg`,
`backend-signed-in.jpg`, `backend-synced.jpg`, `backend-sync-failed.jpg`, `backend-orders-sync.jpg`.

### Admin sign-in (owner token)

The anon key is public (it ships in the storefront), so it cannot manage a store. Owner-only functions
(`sync-catalog`, `stripe-connect-*`, `send-email`, reading orders) require the merchant's Supabase **access token**:

```js
import { createBackend } from '../backend/client/api.js';
const be = createBackend(publicConfig(commerce).backend, { storage: localStorage });
await be.sendMagicLink('me@shop.com');           // or be.verifyCode(email, '123456') / be.signInWithPassword(...)
await be.syncCatalog(catalogSnapshot(store, commerce, { imageUrl }));   // first call creates the store row owned by you
const { url } = await be.connectOnboard({ storeId: store.id, mode: 'test', connectType: 'express', returnUrl: location.href, refreshUrl: location.href });
```

The admin does all of this from the UI (see "Admin steps"); the session store is `src/store/admin/backendSync.js`, the UI
`src/store/admin/Backend.jsx`.

`stripe-connect-onboard` accepts the admin's body `{ storeId, mode, connectType, accountId, country, email,
businessType, storeName, currency, returnUrl, refreshUrl }` and answers `{ url, accountId, onboardingStatus ('pending'|'connected'|'restricted'),
chargesEnabled, payoutsEnabled }`. With only the anon key it answers **401 `auth_required`** — unless the project sets
`ALLOW_ANON_ONBOARDING=true`: then the anon key may connect the **first** account of a store that has none (the store is
"unclaimed" until you sign in and sync). Use that only in a project that serves a single merchant, and connect right
after deploying; afterwards only the signed-in owner can change it. A `mode` that does not match the secret key
(`sk_test_` vs `sk_live_`) is refused with `mode_mismatch`.

## Test mode

- Cards: `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (3-D Secure), `4000 0000 0000 9995` (declined),
  `4000 0000 0000 0259` (dispute). Any future expiry, any CVC, any postcode.
- Webhooks locally: `stripe listen --forward-to https://<ref>.supabase.co/functions/v1/stripe-webhook` (use the `whsec_`
  it prints as `STRIPE_WEBHOOK_SECRET` while testing), then `stripe trigger checkout.session.completed`.
- Connect onboarding in test mode accepts test data (SSN `000-00-0000`, routing `110000000`, account `000123456789`).
- Inspect: `orders`, `payments`, `webhooks_log` (status `processed` / `ignored` / `failed` + error) in the Table editor.
- Local stack: `supabase start` + `supabase functions serve --env-file ./supabase/.env.local` (do not commit that file).

## Go-live checklist

1. Stripe account activated; Connect platform profile completed (if used); live webhook endpoint(s) created → live `whsec_`.
2. `supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…` (+ `STRIPE_CONNECT_WEBHOOK_SECRET`).
3. Settings › Payments: `pk_live_…`, mode **Live**; reconnect / re-onboard accounts in live mode (test accounts do not carry over).
4. Settings › Domains: final `https://` domain; sync the catalog; export and publish; verify the Apple Pay domain.
5. One real low-value purchase → order in `orders` as `paid`, confirmation email received → refund it from Stripe → order `refunded`.
6. Turnstile secret + site key set together; email sender domain verified with your provider (SPF/DKIM).
7. Schedule `select public.prune_backend_logs(90);` daily (Integrations › Cron) to trim rate-limit rows and old webhook logs.
8. Supabase: enable Point-in-Time Recovery / backups; restrict dashboard access; rotate keys if they were ever pasted anywhere.

## Security model

- RLS on every table. Shoppers never touch tables; public functions validate and write with the service role.
  Owners read their store's rows (`is_store_owner()`), and may update only a few operational columns (column grants).
- Prices, stock, discounts, shipping, tax, add-ons and booking slots are recomputed server-side; the client's `price` is
  ignored (differences are stored in `orders.metadata.priceChanges`).
- Return URLs: only `https://` (or `http://localhost`) under the store's allowed origins, else the store's site URL.
- Idempotency: one pending order per checkout attempt (`orders.idempotency_key`), Stripe idempotency keys on coupons and
  sessions, one `webhooks_log` row per Stripe event, upserts keyed by Stripe ids.
- Rate limits: in-memory per instance + `hit_rate_limit()` in Postgres. Turnstile when `TURNSTILE_SECRET_KEY` is set.

## Services and digital products

- **Bookable services**: the checkout loads free times from `booking-slots` (same `bookingSlots()` as the admin, against
  the bookings stored in the backend), asks the intake questions and offers the add-ons. The server re-checks the slot,
  required answers and add-on prices. Paid → a `bookings` row with status `requested`.
- **Other services** → a `service_projects` row (stage `new`, due = paid day + turnaround, deliverables copied).
- **Retainers** (`pricing.model = 'retainer'`) → subscription Checkout with the product's `stripePriceId` (a recurring
  price on the platform account, or on the connected account for Standard/direct charges); add-ons are one-time items.
- **Digital products**: upload the file to the private Storage bucket `digital-products` at `<store id>/<file>` and set the
  product's file to `storage:<store id>/<file>` (or an `https://` URL). Paid → a `digital_downloads` grant (limit ×
  quantity, valid one year); links are in the confirmation email and on the success page (`download?token=…`).
- With WhatsApp / email ordering (no Stripe) service details are not collected online.

## The admin is still local — getting live orders into it

The admin keeps its data in the browser (IndexedDB). Orders from the live store land in Supabase. The bridge is ready
in `backend/client/`:

```js
const rows = await be.fetchOrders(store.id, { since: lastSync });               // RLS: only your stores
const { bookings, projects } = await be.fetchServiceRecords(store.id, { since: lastSync });
commerce = mergeBackend(commerce, backendToCommerce(rows, bookings, projects, store));   // ids 'sb_<uuid>', re-sync safe
```

`tests/backend.test.js` checks that the mapped orders, bookings and projects pass the admin's normalizers;
`tests/backendsync.test.js` checks the idempotent import (`importBackendRecords`) behind the **Sync orders from backend**
button, and `tests/e2e/admin.e2e.mjs` drives sign-in → Connect with Stripe (bearer token) → Refresh status → publish /
auto-sync → orders import twice → sign out → magic-link return against a mocked Supabase. Pending (unpaid) checkouts are
excluded from the sync. Imported orders do not change the admin's stock (`inventoryApplied: false`); stock decrements happen
in the backend snapshot, and the admin's stock is published again on the next catalog sync (automatic after a stock edit),
so sync orders and correct stock before editing it.

## Verified here vs. not

Verified without network: the SQL migration applies on PostgreSQL 16 with a Supabase-like `auth` stub and its RLS /
column grants / `hit_rate_limit` / `decrement_stock` / `redeem_download` behave as intended; all functions type-check
with `tsc` against `stripe@23.1.0` and `@supabase/supabase-js@2.119.0` typings (`backend/typecheck`); the pure modules
are unit-tested (`tests/backend.test.js`); the storefront flow is tested in Chromium against a mocked backend
(`tests/e2e/pay.e2e.mjs`). **Not exercised**: real Stripe / Supabase calls, the Deno runtime itself, email delivery,
Storage signed URLs, Turnstile with real tokens.
