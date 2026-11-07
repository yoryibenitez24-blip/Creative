# Zertake storefront backend (Supabase + Stripe)

Full guide: [`docs/BACKEND.md`](../docs/BACKEND.md). Short version:

```bash
cd backend
supabase login && supabase link --project-ref <ref>
supabase db push
supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_...
#   optional: STRIPE_CONNECT_WEBHOOK_SECRET PLATFORM_FEE_PERCENT REQUIRE_CONNECTED_ACCOUNT TURNSTILE_SECRET_KEY
#             RESEND_API_KEY | SENDGRID_API_KEY | POSTMARK_SERVER_TOKEN  EMAIL_FROM EMAIL_PROVIDER TRACK_SALT ALLOW_ANON_ONBOARDING
supabase functions deploy create-checkout-session stripe-webhook stripe-connect-onboard stripe-connect-status \
  customer-portal order-status booking-slots download track send-email sync-catalog --no-verify-jwt
```

Stripe webhook endpoint: `https://<ref>.supabase.co/functions/v1/stripe-webhook` (event list in docs/BACKEND.md).
Admin: Settings › Integrations › Backend (URL + anon key), Settings › Payments › Stripe (`pk_test_…`), Settings › Domains.

| Folder | |
| --- | --- |
| `supabase/migrations/` | schema, RLS, SQL helpers, `digital-products` bucket |
| `supabase/functions/` | Edge Functions; `_shared/` holds the shared (mostly pure, unit-tested) code |
| `scripts/gen-engine.mjs` | regenerates `_shared/engine.js` + `_shared/services.js` from `src/store/` — run after changing pricing, discounts or booking rules |
| `client/` | admin-side client (sign-in, sync-catalog, onboarding, fetch orders) and rows → admin documents |
| `typecheck/` | `tsc` check of the functions against the real Stripe / supabase-js typings |

Tests: `node --test tests/backend.test.js`, `node tests/e2e/pay.e2e.mjs`.
