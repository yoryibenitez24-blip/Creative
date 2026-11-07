// POST /functions/v1/stripe-connect-onboard — the merchant connects their Stripe account (Connect onboarding).
// Auth: the store owner's Supabase access token (Authorization: Bearer …) + apikey. Body (src/store/integrations.js):
//   { storeId, mode, connectType: 'express'|'standard'|'custom', accountId?, country?, email?, businessType?,
//     returnUrl, refreshUrl, storeName?, currency? }
// → { url (Stripe-hosted onboarding, or the Express dashboard once complete), accountId,
//     onboardingStatus: 'pending'|'connected'|'restricted' (admin vocabulary), status (detailed), chargesEnabled, payoutsEnabled, requirementsDue }
import type Stripe from 'npm:stripe@23.1.0';
import { serve, admin, stripe, env, json, errorJson } from '../_shared/runtime.ts';
import { readJson } from '../_shared/http.ts';
import { requireOwner, ensureStore } from '../_shared/owner.ts';
import { connectSummary, connectedAccountRow, type ConnectSummary } from '../_shared/connect.ts';
import { descriptorSuffix } from '../_shared/checkout.ts';

interface Body {
  storeId?: string; mode?: string; connectType?: string; accountId?: string; country?: string; email?: string; businessType?: string;
  returnUrl?: string; refreshUrl?: string; storeName?: string; currency?: string;
}
const TYPES = ['express', 'standard', 'custom'] as const;
type ConnectType = (typeof TYPES)[number];

const adminStatus = (s: ConnectSummary): 'pending' | 'connected' | 'restricted' =>
  s.onboardingStatus === 'complete' ? 'connected' : s.onboardingStatus === 'restricted' || s.onboardingStatus === 'rejected' ? 'restricted' : 'pending';

function linkUrl(u: unknown, fallback: string): string {
  try {
    const x = new URL(String(u || fallback));
    if (x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(x.hostname))) return x.href;
  } catch { /* fall through */ }
  return '';
}

serve(['POST'], async (req, cors) => {
  const body = await readJson<Body>(req);
  if (!body) return errorJson(400, 'bad_request', 'Invalid request.', cors);
  const auth = await requireOwner(req, body.storeId, cors, { allowAnonFirstConnect: true });
  const ownerId = auth.ok && auth.user ? auth.user.id : null, ownerEmail = auth.ok && auth.user ? auth.user.email : '';
  if (!auth.ok) return auth.response;
  const storeId = body.storeId as string, db = admin();
  const keyMode = env('STRIPE_SECRET_KEY').startsWith('sk_live_') || env('STRIPE_SECRET_KEY').startsWith('rk_live_') ? 'live' : 'test';
  if ((body.mode === 'live' || body.mode === 'test') && body.mode !== keyMode)
    return errorJson(409, 'mode_mismatch', `The backend uses a ${keyMode} Stripe key but the store is set to ${body.mode} mode. Set STRIPE_SECRET_KEY to a ${body.mode} key or switch the mode in Settings.`, cors);
  const type: ConnectType = (TYPES as readonly string[]).includes(String(body.connectType)) ? body.connectType as ConnectType : (auth.store?.connect_type as ConnectType) || 'express';
  const store = auth.store || await ensureStore(storeId, ownerId, { name: String(body.storeName || '').slice(0, 200), currency: /^[A-Z]{3}$/i.test(String(body.currency || '')) ? String(body.currency).toUpperCase() : 'USD', connect_type: type });

  let account: Stripe.Account | null = null;
  if (store.stripe_account_id) account = await stripe().accounts.retrieve(store.stripe_account_id);
  else if (body.accountId && /^acct_[A-Za-z0-9]{8,32}$/.test(body.accountId)) {
    // an account already connected to this platform (e.g. created in the Stripe dashboard) can be adopted
    try { account = await stripe().accounts.retrieve(body.accountId); } catch { return errorJson(400, 'unknown_account', 'That account is not connected to this platform. Leave the account ID empty to create a new one.', cors); }
  }
  if (!account) {
    const params: Stripe.AccountCreateParams = {
      type, email: String(body.email || ownerEmail || '').slice(0, 200) || undefined,
      metadata: { store_id: storeId, ...(ownerId ? { owner_id: ownerId } : {}) },
      business_profile: { name: store.name || undefined, ...(store.site_url && /^https:/.test(store.site_url) ? { url: store.site_url } : {}) },
    };
    if (/^[A-Z]{2}$/i.test(String(body.country || ''))) params.country = String(body.country).toUpperCase();
    if (['individual', 'company', 'non_profit', 'government_entity'].includes(String(body.businessType))) params.business_type = body.businessType as Stripe.AccountCreateParams.BusinessType;
    if (type !== 'standard') params.capabilities = { card_payments: { requested: true }, transfers: { requested: true } };
    const desc = descriptorSuffix((store.payments as { statementDescriptor?: string } | null)?.statementDescriptor);
    if (desc.length >= 5) params.settings = { payments: { statement_descriptor: desc } };
    account = await stripe().accounts.create(params, { idempotencyKey: `zt_acct_${storeId}_${type}` });
  }
  const { error } = await db.from('stores').update({ stripe_account_id: account.id, connect_type: type }).eq('id', storeId);
  if (error) throw error;
  const summary = connectSummary(account);
  await db.from('connected_accounts').upsert(connectedAccountRow(summary, storeId, ownerId), { onConflict: 'stripe_account_id' });

  let url = '';
  if (summary.onboardingStatus === 'complete' && type === 'express') url = (await stripe().accounts.createLoginLink(account.id)).url;
  else if (summary.onboardingStatus === 'complete' && type === 'standard') url = 'https://dashboard.stripe.com/';
  else {
    const returnUrl = linkUrl(body.returnUrl, store.site_url), refreshUrl = linkUrl(body.refreshUrl, returnUrl);
    if (!returnUrl) return errorJson(400, 'bad_return_url', 'returnUrl must be an https:// address (http://localhost in test mode).', cors);
    const link = await stripe().accountLinks.create({ account: account.id, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl || returnUrl, collection_options: { fields: 'eventually_due' } });
    url = link.url;
  }
  return json({ url, accountId: account.id, onboardingStatus: adminStatus(summary), status: summary.onboardingStatus, chargesEnabled: summary.chargesEnabled, payoutsEnabled: summary.payoutsEnabled, requirementsDue: summary.requirementsDue }, 200, cors);
});
