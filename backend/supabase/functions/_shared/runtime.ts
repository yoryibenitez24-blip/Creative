// Deno-side wiring shared by the Edge Functions: environment, Stripe and Supabase clients, auth, store loading.
// Secrets come ONLY from the environment (`supabase secrets set …`); nothing secret is ever read from a request.
import Stripe from 'npm:stripe@23.1.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0';
import { corsHeaders, errorJson, json, bearer } from './http.ts';

export { Stripe };
export type Db = SupabaseClient;

export function env(name: string): string { return (Deno.env.get(name) || '').trim(); }
export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new ConfigError(`${name} is not set. Run: supabase secrets set ${name}=…`);
  return v;
}
export class ConfigError extends Error {}

let stripeClient: Stripe | null = null;
/** Stripe client (pinned API version of stripe-node 23.1.0) using fetch + Web Crypto, as Deno needs. */
export function stripe(): Stripe {
  if (!stripeClient) stripeClient = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2,
    appInfo: { name: 'Zertake Studio storefront backend', version: '1.0.0' },
  });
  return stripeClient;
}
export const cryptoProvider = Stripe.createSubtleCryptoProvider();

let adminClient: Db | null = null;
/** Service-role client: bypasses RLS, only ever used server-side after validating the request. */
export function admin(): Db {
  if (!adminClient) adminClient = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

/** The signed-in Supabase user behind `Authorization: Bearer <access token>`, or null (anon key / no token). */
export async function authUser(req: Request): Promise<{ id: string; email: string } | null> {
  const token = bearer(req);
  if (!token || token.startsWith('sb_')) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email || '' };
}

export interface StoreRow {
  id: string; owner_id: string; name: string; currency: string; site_url: string; allowed_origins: string[];
  checkout_config: Record<string, unknown>; payments: Record<string, unknown>; email: Record<string, unknown>;
  stripe_account_id: string | null; connect_type: 'express' | 'standard' | 'custom' | 'none';
}
export async function loadStore(storeId: unknown): Promise<StoreRow | null> {
  if (typeof storeId !== 'string' || !storeId || storeId.length > 80) return null;
  const { data, error } = await admin().from('stores').select('*').eq('id', storeId).maybeSingle();
  if (error) throw error;
  return (data as StoreRow | null) ?? null;
}

/**
 * Wrap a handler: CORS preflight, method check, JSON errors (no stack traces to the client), config errors → 503.
 * `origins(req)` may return the allow-list for the response's CORS headers.
 */
export function serve(methods: string[], handler: (req: Request, cors: Record<string, string>) => Promise<Response>, allowed: string[] = []) {
  Deno.serve(async (req: Request) => {
    const cors = corsHeaders(req.headers.get('origin'), allowed);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!methods.includes(req.method)) return errorJson(405, 'method_not_allowed', 'Method not allowed.', { ...cors, Allow: methods.join(', ') });
    try {
      return await handler(req, cors);
    } catch (e) {
      if (e instanceof ConfigError) { console.error(e.message); return errorJson(503, 'not_configured', 'The store backend is not fully configured yet.', cors); }
      const se = e as { type?: string; message?: string; code?: string; statusCode?: number };
      if (se && typeof se.type === 'string' && se.type.startsWith('Stripe')) {
        console.error('stripe error', se.type, se.code, se.message);
        const userFacing = se.type === 'StripeCardError' || se.type === 'StripeInvalidRequestError';
        return errorJson(se.statusCode && se.statusCode < 500 ? 400 : 502, 'stripe_error', userFacing && se.message ? se.message : 'The payment provider returned an error.', cors);
      }
      console.error(e);
      return errorJson(500, 'internal', 'Something went wrong. Please try again.', cors);
    }
  });
}

export { json, errorJson };
