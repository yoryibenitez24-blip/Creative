// GET /functions/v1/stripe-connect-status?store=<id>  (or POST { storeId }) — owner only.
// Reads the connected account's live state from Stripe (capabilities, requirements) and stores it.
// → { connected: false } | { connected: true, accountId, onboardingStatus (admin vocabulary), status, chargesEnabled,
//     payoutsEnabled, detailsSubmitted, requirementsDue, pastDue, disabledReason, currentDeadline, capabilities, livemode }
import { serve, admin, stripe, json, errorJson } from '../_shared/runtime.ts';
import { readJson } from '../_shared/http.ts';
import { requireOwner } from '../_shared/owner.ts';
import { connectSummary, connectedAccountRow } from '../_shared/connect.ts';

serve(['GET', 'POST'], async (req, cors) => {
  const storeId = req.method === 'GET' ? new URL(req.url).searchParams.get('store') : (await readJson<{ storeId?: string }>(req))?.storeId;
  const auth = await requireOwner(req, storeId, cors);
  if (!auth.ok) return auth.response;
  if (!auth.store) return errorJson(404, 'unknown_store', 'Sync the store or connect Stripe first.', cors);
  const acct = auth.store.stripe_account_id;
  if (!acct) return json({ connected: false, onboardingStatus: 'not_connected' }, 200, cors);
  const s = connectSummary(await stripe().accounts.retrieve(acct));
  await admin().from('connected_accounts').upsert(connectedAccountRow(s, auth.store.id, auth.user.id), { onConflict: 'stripe_account_id' });
  const onboardingStatus = s.onboardingStatus === 'complete' ? 'connected' : s.onboardingStatus === 'restricted' || s.onboardingStatus === 'rejected' ? 'restricted' : 'pending';
  return json({ connected: true, ...s, onboardingStatus, status: s.onboardingStatus }, 200, cors);
});
