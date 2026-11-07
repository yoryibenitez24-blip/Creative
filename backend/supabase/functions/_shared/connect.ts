// Stripe Connect account → onboarding summary (pure).
import type Stripe from 'npm:stripe@23.1.0';

export type OnboardingStatus = 'not_started' | 'pending' | 'restricted' | 'complete' | 'rejected';
export interface ConnectSummary {
  accountId: string; type: string; country: string; defaultCurrency: string; email: string;
  chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean;
  onboardingStatus: OnboardingStatus; requirementsDue: string[]; pastDue: string[]; disabledReason: string;
  currentDeadline: number | null; capabilities: Record<string, string>; livemode: boolean;
}

type AccountLike = Pick<Stripe.Account, 'id' | 'charges_enabled' | 'payouts_enabled' | 'details_submitted'> & Partial<Pick<Stripe.Account, 'type' | 'country' | 'default_currency' | 'email' | 'requirements' | 'capabilities' | 'business_type'>> & { livemode?: boolean };

export function connectSummary(a: AccountLike): ConnectSummary {
  const req = a.requirements || null;
  const due = [...(req?.currently_due || [])], past = [...(req?.past_due || [])];
  const disabled = req?.disabled_reason || '';
  let status: OnboardingStatus;
  if (/^rejected/.test(disabled)) status = 'rejected';
  else if (a.charges_enabled && a.payouts_enabled && a.details_submitted && !due.length && !past.length) status = 'complete';
  else if (a.details_submitted) status = 'restricted';
  else status = a.business_type ? 'pending' : 'not_started';
  const caps: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.capabilities || {})) if (typeof v === 'string') caps[k] = v;
  return {
    accountId: a.id, type: a.type || '', country: a.country || '', defaultCurrency: (a.default_currency || '').toUpperCase(), email: a.email || '',
    chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted,
    onboardingStatus: status, requirementsDue: due, pastDue: past, disabledReason: disabled,
    currentDeadline: req?.current_deadline ?? null, capabilities: caps, livemode: !!a.livemode,
  };
}

/** Row for public.connected_accounts. */
export function connectedAccountRow(s: ConnectSummary, storeId: string | null, ownerId: string | null) {
  return {
    stripe_account_id: s.accountId, ...(storeId ? { store_id: storeId } : {}), ...(ownerId ? { owner_id: ownerId } : {}),
    type: s.type || 'express', country: s.country || null, default_currency: s.defaultCurrency || null, email: s.email || null,
    charges_enabled: s.chargesEnabled, payouts_enabled: s.payoutsEnabled, details_submitted: s.detailsSubmitted,
    onboarding_status: s.onboardingStatus, requirements: { currently_due: s.requirementsDue, past_due: s.pastDue, disabled_reason: s.disabledReason, current_deadline: s.currentDeadline },
    livemode: s.livemode,
  };
}
