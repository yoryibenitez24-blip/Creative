// Transactional email: order confirmation template + provider adapters (pure; `fetch` is injected).
// Provider is chosen by which secret is set: RESEND_API_KEY, SENDGRID_API_KEY or POSTMARK_TOKEN (first match wins,
// or EMAIL_PROVIDER = 'resend' | 'sendgrid' | 'postmark' to force one).

export interface Mail { to: string; from: string; replyTo?: string; subject: string; html: string; text: string; tag?: string }
export type Provider = 'resend' | 'sendgrid' | 'postmark';
export interface ProviderEnv { EMAIL_PROVIDER?: string; RESEND_API_KEY?: string; SENDGRID_API_KEY?: string; POSTMARK_TOKEN?: string }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function pickProvider(env: ProviderEnv): { provider: Provider; key: string } | null {
  const forced = (env.EMAIL_PROVIDER || '').toLowerCase();
  const all: [Provider, string | undefined][] = [['resend', env.RESEND_API_KEY], ['sendgrid', env.SENDGRID_API_KEY], ['postmark', env.POSTMARK_TOKEN]];
  for (const [p, k] of all) if (k && (!forced || forced === p)) return { provider: p, key: k };
  return null;
}

/** Provider request (url, headers, JSON body) for one message. */
export function providerRequest(provider: Provider, key: string, m: Mail): { url: string; headers: Record<string, string>; body: string } {
  if (provider === 'resend') return {
    url: 'https://api.resend.com/emails', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}), ...(m.tag ? { tags: [{ name: 'category', value: m.tag }] } : {}) }),
  };
  if (provider === 'sendgrid') return {
    url: 'https://api.sendgrid.com/v3/mail/send', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ personalizations: [{ to: [{ email: m.to }] }], from: parseAddress(m.from), ...(m.replyTo ? { reply_to: parseAddress(m.replyTo) } : {}), subject: m.subject,
      content: [{ type: 'text/plain', value: m.text }, { type: 'text/html', value: m.html }], ...(m.tag ? { categories: [m.tag] } : {}) }),
  };
  return {
    url: 'https://api.postmarkapp.com/email', headers: { 'X-Postmark-Server-Token': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ From: m.from, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, MessageStream: 'outbound', ...(m.replyTo ? { ReplyTo: m.replyTo } : {}), ...(m.tag ? { Tag: m.tag } : {}) }),
  };
}

/** 'Shop <hi@shop.com>' → { email, name } (SendGrid wants objects). */
export function parseAddress(s: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(s);
  return m ? { email: m[2].trim(), ...(m[1] ? { name: m[1].replace(/^"|"$/g, '') } : {}) } : { email: s.trim() };
}

export async function sendMail(env: ProviderEnv, m: Mail, fetchImpl: FetchLike): Promise<{ ok: boolean; provider?: Provider; status?: number; error?: string }> {
  const p = pickProvider(env);
  if (!p) return { ok: false, error: 'No email provider configured (set RESEND_API_KEY, SENDGRID_API_KEY or POSTMARK_TOKEN).' };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m.to)) return { ok: false, provider: p.provider, error: 'Invalid recipient.' };
  const r = providerRequest(p.provider, p.key, m);
  try {
    const res = await fetchImpl(r.url, { method: 'POST', headers: r.headers, body: r.body });
    return res.ok ? { ok: true, provider: p.provider, status: res.status } : { ok: false, provider: p.provider, status: res.status, error: (await res.text()).slice(0, 500) };
  } catch (e) {
    return { ok: false, provider: p.provider, error: String(e).slice(0, 500) };
  }
}

// ---------- order confirmation ----------
export interface OrderForEmail {
  number: number | string; currency: string; email: string; name?: string;
  lines: { title: string; variant_title?: string; quantity: number; unit_price: number; total: number }[];
  subtotal: number; discount_total: number; shipping: number; tax: number; tax_inclusive?: boolean; total: number;
  shipping_name?: string; codes?: string[];
  shipping_address?: { name?: string; address1?: string; address2?: string; city?: string; province?: string; zip?: string; country?: string } | null;
}
export interface StoreForEmail { name: string; siteUrl?: string; replyTo?: string; orderPrefix?: string; locale?: string }

export const escapeHtml = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function formatMoney(amount: number, currency: string, locale = 'en-US'): string {
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount); } catch { return `${currency} ${amount.toFixed(2)}`; }
}

export function orderConfirmation(o: OrderForEmail, store: StoreForEmail): { subject: string; html: string; text: string } {
  const fm = (n: number) => formatMoney(n, o.currency, store.locale), ref = `${store.orderPrefix ?? '#'}${o.number}`;
  const subject = `Order ${ref} confirmed — ${store.name}`;
  const rows: [string, string][] = [['Subtotal', fm(o.subtotal)]];
  if (o.discount_total > 0) rows.push([`Discount${o.codes?.length ? ' (' + o.codes.join(', ') + ')' : ''}`, '−' + fm(o.discount_total)]);
  if (o.shipping_name || o.shipping > 0) rows.push([`Shipping${o.shipping_name ? ' (' + o.shipping_name + ')' : ''}`, o.shipping > 0 ? fm(o.shipping) : 'Free']);
  if (o.tax > 0) rows.push([o.tax_inclusive ? 'Tax (included)' : 'Tax', fm(o.tax)]);
  const a = o.shipping_address, addr = a ? [a.name, a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.province, a.country].filter(Boolean) : [];
  const hi = o.name ? `Hi ${o.name.split(' ')[0]},` : 'Hello,';
  const text = [hi, '', `Thank you for your order ${ref} at ${store.name}. We have received your payment.`, '',
    ...o.lines.map(l => `${l.quantity} × ${l.title}${l.variant_title ? ' (' + l.variant_title + ')' : ''} — ${fm(l.total)}`), '',
    ...rows.map(r => `${r[0]}: ${r[1]}`), `Total: ${fm(o.total)}`,
    ...(addr.length ? ['', 'Shipping to:', ...addr] : []), '', store.siteUrl ? `${store.name} — ${store.siteUrl}` : store.name].join('\n');
  const td = 'padding:6px 0;border-bottom:1px solid #eee';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f6;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">
<div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px">
<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(store.name)}</h1><p style="color:#666;margin:0 0 20px">Order ${escapeHtml(ref)}</p>
<p>${escapeHtml(hi)}</p><p>Thank you for your order. We have received your payment and will let you know when it ships.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:16px 0">${o.lines.map(l => `<tr><td style="${td}">${l.quantity} × ${escapeHtml(l.title)}${l.variant_title ? `<br><small style="color:#777">${escapeHtml(l.variant_title)}</small>` : ''}</td><td style="${td};text-align:right">${escapeHtml(fm(l.total))}</td></tr>`).join('')}
${rows.map(r => `<tr><td style="padding:4px 0;color:#555">${escapeHtml(r[0])}</td><td style="padding:4px 0;text-align:right;color:#555">${escapeHtml(r[1])}</td></tr>`).join('')}
<tr><td style="padding:8px 0;font-weight:700">Total</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(fm(o.total))}</td></tr></table>
${addr.length ? `<p style="margin:16px 0 0"><strong>Shipping to</strong><br>${addr.map(escapeHtml).join('<br>')}</p>` : ''}
</div><p style="color:#888;font-size:12px;text-align:center;margin-top:16px">${store.siteUrl ? `<a href="${escapeHtml(store.siteUrl)}" style="color:#888">${escapeHtml(store.name)}</a>` : escapeHtml(store.name)}${store.replyTo ? ` · Questions? Reply to this email.` : ''}</p></div></body></html>`;
  return { subject, html, text };
}
