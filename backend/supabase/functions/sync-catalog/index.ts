// POST /functions/v1/sync-catalog — the admin publishes what the checkout may charge (owner only).
// Body = catalogSnapshot(store, commerce) from src/store/commerce.js:
//   { store: { id, name, currency, siteUrl, allowedOrigins[] }, config: { discounts, zones, taxes, weights, collections, countries },
//     payments: { enabled, mode, connectType, applicationFeePercent, … }, email: { provider, fromEmail, replyTo, senderName, orderPrefix },
//     products: [{ id, title, active, price, compareAt, image, kind, recurring, variants: [{ id, title, options, price, sku, stock }] }] }
// Creates the store row on first use (owner = the signed-in user). Products missing from the snapshot are deactivated.
// → { ok: true, products: n, deactivated: m }
import { serve, admin, json, errorJson } from '../_shared/runtime.ts';
import { readJson, normalizeOrigin } from '../_shared/http.ts';
import { requireOwner, ensureStore } from '../_shared/owner.ts';
import { normalizeRecurring } from '../_shared/cart.ts';
import { normalizeCurrency } from '../_shared/money.ts';

interface Snapshot {
  store?: { id?: string; name?: string; currency?: string; siteUrl?: string; allowedOrigins?: string[] };
  config?: Record<string, unknown>; payments?: Record<string, unknown>; email?: Record<string, unknown>;
  products?: { id?: unknown; title?: unknown; active?: unknown; price?: unknown; compareAt?: unknown; image?: unknown; kind?: unknown; recurring?: unknown; variants?: unknown }[];
}
const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const money = (v: unknown): number | null => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 100) / 100; };
const SECRET = /\b(sk|rk)_(test|live)_|whsec_|sb_secret_/;

serve(['POST'], async (req, cors) => {
  const body = await readJson<Snapshot>(req, 4 * 1024 * 1024);
  if (!body?.store) return errorJson(400, 'bad_request', 'Expected a catalog snapshot.', cors);
  if (SECRET.test(JSON.stringify(body))) return errorJson(400, 'secret_in_payload', 'The snapshot contains a secret key. Secrets belong in `supabase secrets set`, never in the store settings.', cors);
  const auth = await requireOwner(req, body.store.id, cors);
  if (!auth.ok) return auth.response;
  const storeId = body.store.id as string, db = admin();
  const products = Array.isArray(body.products) ? body.products.slice(0, 5000) : [];
  const rows = [];
  for (const p of products) {
    const id = s(p.id, 120), price = money(p.price);
    if (!id || price == null) continue;
    const variants = (Array.isArray(p.variants) ? p.variants : []).slice(0, 500).map(v => {
      const o = (v || {}) as Record<string, unknown>, stock = o.stock == null || o.stock === '' ? null : Math.max(0, Math.floor(Number(o.stock) || 0));
      return { id: s(o.id, 120), title: s(o.title, 200), options: Array.isArray(o.options) ? o.options.slice(0, 3).map(x => s(x, 100)) : [], price: money(o.price), sku: s(o.sku, 100), stock };
    }).filter(v => v.id);
    const kind = p.kind === 'service' || p.kind === 'digital' ? p.kind : 'physical';
    rows.push({ store_id: storeId, id, title: s(p.title, 300), active: p.active !== false, price, compare_at: money(p.compareAt), image: /^https:\/\//.test(s(p.image, 1000)) ? s(p.image, 1000) : '', kind, recurring: normalizeRecurring(p.recurring), variants });
  }
  const site = s(body.store.siteUrl, 500), origins = [...new Set([...(body.store.allowedOrigins || []), site].map(o => normalizeOrigin(String(o || ''))).filter(Boolean))].slice(0, 20);
  const fields = {
    name: s(body.store.name, 200), currency: normalizeCurrency(body.store.currency), site_url: /^https?:\/\//.test(site) ? site : '', allowed_origins: origins,
    checkout_config: body.config || {}, payments: body.payments || {}, email: body.email || {}, catalog_synced_at: new Date().toISOString(),
    ...(['express', 'standard', 'custom', 'none'].includes(String(body.payments?.connectType)) && !auth.store?.stripe_account_id ? { connect_type: body.payments!.connectType as string } : {}),
  };
  if (auth.store) { const { error } = await db.from('stores').update(fields).eq('id', storeId); if (error) throw error; }
  else await ensureStore(storeId, auth.user.id, fields);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('products').upsert(rows.slice(i, i + 500), { onConflict: 'store_id,id' });
    if (error) throw error;
  }
  const keep = rows.map(r => r.id);
  let q = db.from('products').update({ active: false }).eq('store_id', storeId).eq('active', true);
  if (keep.length) q = q.not('id', 'in', `(${keep.map(id => `"${id.replace(/"/g, '""')}"`).join(',')})`);
  const { data: off, error: offErr } = await q.select('id');
  if (offErr) throw offErr;
  return json({ ok: true, products: rows.length, deactivated: (off || []).length }, 200, cors);
});
