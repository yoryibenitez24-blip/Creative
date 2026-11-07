// Account plans (workspace-level, not per store). There is no billing: the plan is a local setting the user picks.

export const PLANS = [
  { id: 'starter', name: 'Starter', stores: 1, blurb: 'One store with every commerce feature.' },
  { id: 'growth', name: 'Growth', stores: 3, blurb: 'Up to 3 stores — run a second brand or test a niche.' },
  { id: 'pro', name: 'Pro', stores: 10, blurb: 'Up to 10 stores for agencies and multi-brand sellers.' },
];
export const DEFAULT_PLAN = 'starter';

/** The plan object for an id (unknown → Starter). */
export function planFor(id) { return PLANS.find(p => p.id === id) || PLANS.find(p => p.id === DEFAULT_PLAN); }

/** Maximum number of stores on a plan. */
export function storeLimit(plan) { return planFor(plan).stores; }

/** Can a user on `plan` who already has `count` stores create another one? */
export function canCreateStore(plan, count) { return (Number(count) || 0) < storeLimit(plan); }

/** The cheapest plan that allows at least `count` stores, or null. */
export function planForCount(count) { return PLANS.find(p => p.stores >= count) || null; }
