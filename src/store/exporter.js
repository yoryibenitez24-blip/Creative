// Static-site exporter for the store builder.
//
//   await buildSiteFiles(store, { loadAsset? }) → [{ name, data: Uint8Array }]
//       index.html, collections/<slug>.html (incl. all.html), products/<slug>.html, pages/about.html,
//       pages/contact.html, cart.html, checkout.html, assets/styles.css, assets/store.js, images/*, README.txt
//       loadAsset(id) → Promise<Blob> resolves 'asset:<id>' image refs (the app AssetStore's get()).
//   await exportStoreZip(store, opts) → Uint8Array (store-only ZIP, src/ecom/zip.js)
//   previewShellHtml(store, imageUrl) → one self-contained HTML page that shows every page of the store in an
//       iframe and follows its internal links (used by "Preview in new tab"; imageUrl must return absolute URLs)
//   deployInstructions(store) → plain text
//
// All links are relative, so the site works opened from the file system and on any static host.

import { createZip } from '../ecom/zip.js';
import { artSvg, isGen, parseGen } from './art.js';
import { imageRefs, slugify } from './model.js';
import { renderPage, sitePages, storeCss, storeScript, esc } from './render.js';
import { PHOTO_CREDITS_NOTE } from './photos.js';

const enc = new TextEncoder();
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); }

function decodeDataUrl(u) {
  const m = /^data:([^;,]+)?(;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(u);
  if (!m) return null;
  const type = m[1] || 'application/octet-stream';
  if (m[3]) { const s = atob(m[4]); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return { type, bytes: b }; }
  return { type, bytes: enc.encode(decodeURIComponent(m[4])) };
}

/** Map every image ref of the store to a file under images/ (bytes loaded/generated). */
export async function collectImages(store, loadAsset) {
  const map = new Map(), files = [];
  for (const ref of imageRefs(store)) {
    let name = null, bytes = null;
    if (isGen(ref)) { name = `images/${parseGen(ref).kind}-${fnv(ref)}.svg`; bytes = enc.encode(artSvg(ref)); }
    else if (ref.startsWith('asset:')) {
      if (!loadAsset) continue;
      try { const blob = await loadAsset(ref.slice(6)); bytes = new Uint8Array(await blob.arrayBuffer()); name = `images/${ref.slice(13, 29) || fnv(ref)}.${EXT[blob.type] || 'png'}`; }
      catch { continue; }
    } else if (ref.startsWith('data:')) {
      const d = decodeDataUrl(ref); if (!d) continue;
      bytes = d.bytes; name = `images/img-${fnv(ref)}.${EXT[d.type] || 'png'}`;
    } else continue; // 'unsplash:' photos and absolute https URLs stay hot-linked
    map.set(ref, name); files.push({ name, data: bytes });
  }
  return { map, files };
}

export async function buildSiteFiles(store, { loadAsset } = {}) {
  const { map, files } = await collectImages(store, loadAsset);
  const imageUrl = ref => map.get(ref) || (/^https?:/.test(ref) ? ref : '');
  const out = [];
  for (const pg of sitePages(store)) out.push({ name: pg.path, data: enc.encode(renderPage(store, pg.route, { mode: 'export', imageUrl })) });
  out.push({ name: 'assets/styles.css', data: enc.encode(storeCss(store)) });
  out.push({ name: 'assets/store.js', data: enc.encode(storeScript(store, imageUrl)) });
  out.push(...files);
  out.push({ name: 'README.txt', data: enc.encode(deployInstructions(store)) });
  return out;
}

export async function exportStoreZip(store, opts = {}) {
  const files = await buildSiteFiles(store, opts);
  const folder = slugify(store.name) + '/';
  return createZip(files.map(f => ({ name: folder + f.name, data: f.data })));
}

export function deployInstructions(store) {
  const mode = { whatsapp: `WhatsApp: orders open a WhatsApp chat with ${store.checkout.phone ? '+' + store.checkout.phone.replace(/\D/g, '') : '(set your WhatsApp number in Settings → Checkout)'} containing the cart.`, email: `Email: orders open the shopper's mail app addressed to ${store.checkout.email || '(set an order email in Settings → Checkout)'}.`, paymentLinks: 'Payment links: each product sends the shopper to the payment link you pasted for it (Stripe Payment Links, PayPal.me, Gumroad, …). Products without a link ask the shopper to contact you.', none: 'Catalog only: the store shows products but takes no orders.' }[store.checkout.mode];
  return `${store.name} — static store exported from Zertake Studio

WHAT IS IN THIS FOLDER
  index.html            Home page (open it in any browser to try the store locally)
  collections/*.html    Collection pages (all.html lists every product)
  products/*.html       One page per active product
  pages/about.html, pages/contact.html, cart.html, checkout.html
  assets/styles.css     Theme and layout
  assets/store.js       Cart (saved in the browser's localStorage), variants, filters and checkout
  images/               Product and section images

PUBLISH IT (free options)
  Netlify:      app.netlify.com → "Add new site" → "Deploy manually" → drag this whole folder onto the page.
  GitHub Pages: create a repository, upload the CONTENTS of this folder to the main branch,
                then Settings → Pages → "Deploy from a branch" → main / root.
  Cloudflare Pages / Vercel / any web host: upload the folder as-is — no build step, no server needed.
  Custom domain: add it in your host's dashboard and point your DNS to it as the host explains.

HOW ORDERS WORK
  ${mode}
  This website never collects card details. Real payments need your own payment links or payment provider;
  confirm stock, shipping and payment with each customer before sending goods.

IMAGES
  Your uploaded images are included in images/. Sample template photos are loaded from images.unsplash.com,
  so they need an internet connection (offline, simple illustrations are shown instead).
  ${PHOTO_CREDITS_NOTE}

UPDATING
  Edit the store in Zertake Studio and export again, then replace the files on your host.
`;
}

/** Self-contained preview: every page pre-rendered (preview mode) inside one shell that routes internal links. */
export function previewShellHtml(store, imageUrl) {
  const pages = {};
  for (const pg of sitePages(store)) pages[pg.path] = renderPage(store, pg.route, { mode: 'preview', imageUrl });
  const json = JSON.stringify(pages).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview – ${esc(store.name)}</title>
<style>html,body{margin:0;height:100%;background:#111}iframe{border:0;width:100%;height:100%;display:block;background:#fff}</style></head>
<body><iframe id="f" title="Store preview"></iframe><script>
var P=${json};var f=document.getElementById('f');
function resolve(from,href){var parts=from.split('/').slice(0,-1);href.split(/[?#]/)[0].split('/').forEach(function(s){if(s==='..')parts.pop();else if(s&&s!=='.')parts.push(s)});return parts.join('/')}
function show(p){if(!P[p])p='index.html';f.srcdoc=P[p];if(location.hash.slice(1)!==p)history.replaceState(null,'','#'+p);document.title=(p==='index.html'?'':p+' – ')+'Preview'}
addEventListener('message',function(e){var d=e.data||{};if(d.storeNav)show(resolve(d.from||'index.html',d.storeNav))});
show(decodeURIComponent(location.hash.slice(1))||'index.html');
</script></body></html>`;
}
