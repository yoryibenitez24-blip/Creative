// Merchant (store owner) authentication for the admin-facing functions (Deno).
// The admin signs in to Supabase Auth (email magic link / password, see backend/client/api.js) and sends
// `Authorization: Bearer <access token>` + `apikey: <anon key>`. The anon key alone is NOT enough: it is public
// (it ships in the storefront), so it can never authorise onboarding, catalog changes or order data.
import { admin, authUser, loadStore, errorJson, type StoreRow } from './runtime.ts';

export type OwnerResult = { ok: true; user: { id: string; email: string }; store: StoreRow | null } | { ok: false; response: Response };

export async function requireOwner(req: Request, storeId: unknown, cors: Record<string, string>): Promise<OwnerResult> {
  const user = await authUser(req);
  if (!user) return { ok: false, response: errorJson(401, 'auth_required', 'Sign in to your store backend first (Settings › Backend › Sign in). The public anon key cannot manage a store.', cors) };
  if (typeof storeId !== 'string' || !/^[\w-]{1,80}$/.test(storeId)) return { ok: false, response: errorJson(400, 'bad_store_id', 'Missing or invalid storeId.', cors) };
  const store = await loadStore(storeId);
  if (store && store.owner_id !== user.id) return { ok: false, response: errorJson(403, 'not_owner', 'This store belongs to another account.', cors) };
  return { ok: true, user, store };
}

/** Create the store row for a signed-in owner (first sync / first onboarding). */
export async function ensureStore(storeId: string, ownerId: string, fields: Partial<StoreRow> = {}): Promise<StoreRow> {
  const { data, error } = await admin().from('stores').upsert({ id: storeId, owner_id: ownerId, ...fields }, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  return data as StoreRow;
}
