// GET /functions/v1/download?token=<grant token> — digital products. Deploy with --no-verify-jwt (links are opened from
// emails and the success page). Counts one download (download_limit per order line, grants expire after a year, only
// for paid orders) and redirects to a 60-second signed URL of the private Storage bucket `digital-products`
// (file 'storage:<store id>/<file>') or to the product's https file URL.
import { serve, admin, errorJson } from '../_shared/runtime.ts';
import { createLimiter, clientIp } from '../_shared/ratelimit.ts';

const limiter = createLimiter(30, 60_000);
const BUCKET = 'digital-products';

serve(['GET'], async (req, cors) => {
  if (!limiter.hit(clientIp(req.headers)).allowed) return errorJson(429, 'rate_limited', 'Too many downloads. Please wait a minute.', cors);
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!/^[0-9a-f]{48}$/.test(token)) return errorJson(400, 'bad_token', 'Invalid download link.', cors);
  const db = admin();
  const { data, error } = await db.rpc('redeem_download', { p_token: token });
  if (error) throw error;
  const grant = Array.isArray(data) ? data[0] : null;
  if (!grant) return errorJson(410, 'expired', 'This download link has expired or reached its download limit. Please contact the store.', cors);
  let url = String(grant.file);
  if (url.startsWith('storage:')) {
    const path = url.slice(8);
    const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUrl(path, 60, { download: grant.file_name || true });
    if (sErr || !signed) throw sErr || new Error('could not sign');
    url = signed.signedUrl;
  }
  return new Response(null, { status: 302, headers: { ...cors, Location: url, 'Cache-Control': 'no-store' } });
});
