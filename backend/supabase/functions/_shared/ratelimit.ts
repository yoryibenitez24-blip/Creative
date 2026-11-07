// In-memory fixed-window rate limiter (pure). It is the cheap first line of defence inside one Edge Function
// instance; the durable limit across instances is the `hit_rate_limit()` SQL function (see the migration).

export interface LimitResult { allowed: boolean; remaining: number; resetAt: number }
export interface Limiter { hit(key: string, now?: number): LimitResult; size(): number }

export function createLimiter(limit: number, windowMs: number, maxKeys = 10000): Limiter {
  const buckets = new Map<string, { start: number; count: number }>();
  function sweep(now: number) {
    for (const [k, b] of buckets) if (now - b.start >= windowMs) buckets.delete(k);
    // still too many distinct keys (an attack with random keys): drop the oldest
    if (buckets.size > maxKeys) for (const k of [...buckets.keys()].slice(0, buckets.size - maxKeys)) buckets.delete(k);
  }
  return {
    hit(key: string, now = Date.now()): LimitResult {
      let b = buckets.get(key);
      if (!b || now - b.start >= windowMs) {
        if (buckets.size >= maxKeys) sweep(now);
        b = { start: now, count: 0 }; buckets.set(key, b);
      }
      b.count++;
      return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.start + windowMs };
    },
    size: () => buckets.size,
  };
}

/** Client IP from the proxy headers Supabase Edge Functions receive (first hop of X-Forwarded-For). */
export function clientIp(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return (headers.get('cf-connecting-ip') || headers.get('x-real-ip') || '').trim();
}
