// Merchant (store owner) authentication for the admin-facing functions (Deno).
// The admin signs in to Supabase Auth (email magic link / password, see backend/client/api.js) and sends
// `Authorization: Bearer <access token>` + `apikey: <anon key>`. The anon key alone is NOT enough: it is public
// (it ships in the storefront), so it never authorises catalog changes or order data.
//
// One opt-in exception for single-merchant projects: with the secret ALLOW_ANON_ONBOARDING=true, stripe-connect-onboard
// also accepts the anon key, but ONLY to connect the first Stripe account of a store that has none yet (the store row is
// then "unclaimed": owner_id null). Once a store has an account, only its signed-in owner can manage it. Signing in
// later and calling sync-catalog claims an unclaimed store.
import { admin, authUser, loadStore, env, errorJson, type StoreRow } from './runtime.ts';

export type OwnerResult =
  | { ok: true; user: { id: string; email: string } | null; store: StoreRow | null }
  | { ok: false; response: Response };

export async function requireOwner(req: Request, storeId: unknown, cors: Record<string, string>, opts: { allowAnonFirstConnect?: boolean } = {}): Promise<OwnerResult> {
  if (typeof storeId !== 'string' || !/^[\w-]{1,80}$/.test(storeId)) return { ok: false, response: errorJson(400, 'bad_store_id', 'Missing or invalid storeId.', cors) };
  const user = await authUser(req);
  const store = await loadStore(storeId);
  if (!user) {
    if (opts.allowAnonFirstConnect && env('ALLOW_ANON_ONBOARDING') === 'true' && (!store || (!store.owner_id && !store.stripe_account_id)))
      return { ok: true, user: null, store };
    return { ok: false, response: errorJson(401, 'auth_required', 'Sign in to your store backend first (Settings › Backend › Sign in). The public anon key cannot manage a store.', cors) };
  }
  if (store && store.owner_id && store.owner_id !== user.id) return { ok: false, response: errorJson(403, 'not_owner', 'This store belongs to another account.', cors) };
  return { ok: true, user, store };
}

/** Create (or claim) the store row; ownerId null = unclaimed. */
export async function ensureStore(storeId: string, ownerId: string | null, fields: Partial<StoreRow> = {}): Promise<StoreRow> {
  const { data, error } = await admin().from('stores').upsert({ id: storeId, ...(ownerId ? { owner_id: ownerId } : {}), ...fields }, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  return data as StoreRow;
}
