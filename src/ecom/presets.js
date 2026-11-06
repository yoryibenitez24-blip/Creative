// Marketplace output presets, the per-preset checklist and the export naming template.
// Pure JS (no DOM). The numbers are the marketplaces' published image guidelines as of 2026;
// "ideal" values only produce a warning, hard requirements produce a failure.

const MB = 1024 * 1024;

/**
 * Preset fields:
 *   w, h           output canvas size in px
 *   minSide        smallest acceptable long side (hard requirement)
 *   white          'required' | 'recommended' | undefined — pure #FFFFFF background
 *   fill           target share of the canvas the product's long side should cover (0..1)
 *   fillTol        allowed deviation before a warning
 *   maxBytes       file-size limit (hard) ; idealBytes: recommended maximum (warning)
 *   format         preferred export format
 */
export const PRESETS = [
  { id: 'amazon', name: 'Amazon main image', w: 2000, h: 2000, minSide: 1000, white: 'required', fill: 0.85, fillTol: 0.05, maxBytes: 10 * MB, format: 'jpeg', note: 'Pure white background (RGB 255,255,255); the product should fill about 85 % of the frame.' },
  { id: 'shopify', name: 'Shopify', w: 2048, h: 2048, minSide: 800, fill: 0.8, fillTol: 0.1, maxBytes: 20 * MB, format: 'jpeg', note: 'Square 2048 × 2048 keeps zoom sharp and the collection grid even.' },
  { id: 'etsy', name: 'Etsy 2000 × 1600', w: 2000, h: 1600, minSide: 2000, fill: 0.75, fillTol: 0.12, maxBytes: 20 * MB, idealBytes: 1 * MB, format: 'jpeg', note: '5:4 listing photo, shortest side at least 2000 px recommended for zoom.' },
  { id: 'etsy-xl', name: 'Etsy 3000 × 2400', w: 3000, h: 2400, minSide: 2000, fill: 0.75, fillTol: 0.12, maxBytes: 20 * MB, idealBytes: 1 * MB, format: 'jpeg', note: 'Large 5:4 listing photo.' },
  { id: 'ebay', name: 'eBay', w: 1600, h: 1600, minSide: 500, white: 'recommended', fill: 0.85, fillTol: 0.08, maxBytes: 12 * MB, format: 'jpeg', note: 'At least 500 px on the long side; 1600 px enables zoom. White or neutral background recommended.' },
  { id: 'instagram', name: 'Instagram Shop 1:1', w: 1080, h: 1080, minSide: 1080, fill: 0.7, fillTol: 0.15, maxBytes: 8 * MB, format: 'jpeg', note: 'Square feed post.' },
  { id: 'instagram-portrait', name: 'Instagram Shop 4:5', w: 1080, h: 1350, minSide: 1080, fill: 0.7, fillTol: 0.15, maxBytes: 8 * MB, format: 'jpeg', note: 'Portrait feed post.' },
  { id: 'mercadolibre', name: 'Mercado Libre', w: 1200, h: 1200, minSide: 500, white: 'required', fill: 0.85, fillTol: 0.08, maxBytes: 10 * MB, format: 'jpeg', note: 'Main photo on a pure white background, at least 1200 × 1200 for zoom.' },
  { id: 'google', name: 'Google Shopping', w: 1600, h: 1600, minSide: 800, white: 'recommended', fill: 0.85, fillTol: 0.1, maxBytes: 16 * MB, format: 'jpeg', note: 'At least 800 × 800 recommended; plain white, grey or light background.' },
  { id: 'custom', name: 'Custom', w: 1500, h: 1500, minSide: 1, fill: 0.8, fillTol: 0.2, format: 'jpeg', custom: true, note: 'Your own size.' },
];
export const PRESET_BY_ID = Object.fromEntries(PRESETS.map(p => [p.id, p]));

/** Resolve a preset id (with the custom size for 'custom') into a full preset object. */
export function resolvePreset(id, custom = {}) {
  const p = PRESET_BY_ID[id] || PRESET_BY_ID.amazon;
  if (!p.custom) return p;
  const w = Math.max(16, Math.min(8000, Math.round(custom.w || p.w))), h = Math.max(16, Math.min(8000, Math.round(custom.h || p.h)));
  return { ...p, w, h, name: `Custom ${w} × ${h}` };
}

/** Margin (% of the shorter canvas side, per edge) that makes a product fill `fill` of the frame. */
export const marginForFill = fill => Math.round((1 - fill) / 2 * 1000) / 10;

const fmtBytes = b => b >= MB ? (b / MB).toFixed(2) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const pct = x => (x * 100).toFixed(1).replace(/\.0$/, '') + ' %';

/**
 * Background statistics of a rendered output.
 * buf: RGBA output. place: {x,y,w,h} of the product. product: RGBA buffer of the placed product
 * (place.w × place.h), whose alpha decides which pixels belong to the product.
 * Returns { bgPixels, whitePixels, whiteFraction, borderPixels, borderWhite, borderFraction }.
 */
export function backgroundStats(buf, place, product) {
  const { w, h, data } = buf;
  let bg = 0, white = 0, border = 0, borderWhite = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x - place.x, py = y - place.y;
    const inside = product && px >= 0 && py >= 0 && px < place.w && py < place.h && product.data[(py * place.w + px) * 4 + 3] > 0;
    const i = (y * w + x) * 4, isWhite = data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
    if (!inside) { bg++; if (isWhite) white++; }
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { border++; if (isWhite) borderWhite++; }
  }
  return { bgPixels: bg, whitePixels: white, whiteFraction: bg ? white / bg : 1, borderPixels: border, borderWhite, borderFraction: border ? borderWhite / border : 1 };
}

/**
 * Checklist for one rendered output against a preset.
 * info: { w, h, place:{x,y,w,h}, stats (backgroundStats), bytes?, format?, upscale? (output px per
 *         source px of the product) }
 * Returns [{ id, label, status: 'pass'|'warn'|'fail', detail }].
 */
export function checkPreset(preset, info) {
  const rows = [], add = (id, label, status, detail) => rows.push({ id, label, status, detail });
  // size
  const long = Math.max(info.w, info.h), exact = info.w === preset.w && info.h === preset.h;
  if (long < preset.minSide) add('size', 'Image size', 'fail', `${info.w} × ${info.h} px — the long side must be at least ${preset.minSide} px`);
  else if (!exact) add('size', 'Image size', 'warn', `${info.w} × ${info.h} px — recommended ${preset.w} × ${preset.h} px`);
  else add('size', 'Image size', 'pass', `${info.w} × ${info.h} px`);
  // resolution of the product (upscaling makes it soft)
  if (info.upscale != null) {
    if (info.upscale > 1.5) add('resolution', 'Product resolution', 'warn', `product enlarged ${info.upscale.toFixed(2)}× from the photo — it may look soft; use a larger original`);
    else add('resolution', 'Product resolution', 'pass', info.upscale > 1 ? `enlarged ${info.upscale.toFixed(2)}×` : 'no enlargement');
  }
  // background
  const s = info.stats;
  if (s && preset.white) {
    const label = 'Pure white background';
    if (s.borderFraction < 1) add('white', label, preset.white === 'required' ? 'fail' : 'warn', `only ${pct(s.borderFraction)} of the edge pixels are #FFFFFF`);
    else if (s.whiteFraction < 0.95) add('white', label, 'warn', `${pct(s.whiteFraction)} of the background is #FFFFFF (shadow or reflection) — edges are pure white`);
    else add('white', label, 'pass', `${pct(s.whiteFraction)} of the background is #FFFFFF`);
  } else if (s) add('white', 'Background', 'pass', `${pct(s.whiteFraction)} of the background is pure white`);
  // product fill
  if (info.place) {
    const fill = Math.max(info.place.w / info.w, info.place.h / info.h), d = fill - preset.fill;
    add('fill', 'Product fill', Math.abs(d) <= preset.fillTol + 1e-9 ? 'pass' : 'warn', `product covers ${pct(fill)} of the frame — target about ${pct(preset.fill)}`);
  }
  // file size
  if (info.bytes != null) {
    if (preset.maxBytes && info.bytes > preset.maxBytes) add('bytes', 'File size', 'fail', `${fmtBytes(info.bytes)} — limit ${fmtBytes(preset.maxBytes)}`);
    else if (preset.idealBytes && info.bytes > preset.idealBytes) add('bytes', 'File size', 'warn', `${fmtBytes(info.bytes)} — under ${fmtBytes(preset.idealBytes)} loads faster`);
    else add('bytes', 'File size', 'pass', fmtBytes(info.bytes) + (preset.maxBytes ? ` (limit ${fmtBytes(preset.maxBytes)})` : ''));
  } else add('bytes', 'File size', 'warn', 'not measured yet — run the full-size check');
  if (info.format && preset.format && info.format !== preset.format) add('format', 'Format', 'warn', `${info.format.toUpperCase()} — ${preset.format.toUpperCase()} is preferred`);
  return rows;
}

export const FORMATS = { jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG' }, png: { mime: 'image/png', ext: 'png', label: 'PNG' }, webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' } };

/** Replace characters that are not safe in file names on Windows/macOS/Linux. */
export const safeName = s => String(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'image';
export const baseName = n => String(n).replace(/\.[a-z0-9]{2,5}$/i, '');

/**
 * Expand a naming template. Tokens: {name} (original file name without extension), {preset}
 * (preset id), {n} (1-based index, zero-padded to `pad`), {w}, {h}. The extension is appended.
 */
export function formatName(template, { name, preset, n, w, h, pad = 2 }, ext) {
  const t = (template || '{name}').replace(/\{(\w+)\}/g, (m, k) => k === 'name' ? baseName(name) : k === 'preset' ? preset : k === 'n' ? String(n).padStart(pad, '0') : k === 'w' ? String(w) : k === 'h' ? String(h) : m);
  return safeName(t) + (ext ? '.' + ext : '');
}

/** Make every name in the list unique by appending " (2)", " (3)", … before the extension. */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map(n => {
    const key = n.toLowerCase();
    if (!seen.has(key)) { seen.set(key, 1); return n; }
    let k = seen.get(key) + 1, cand;
    const dot = n.lastIndexOf('.'), stem = dot > 0 ? n.slice(0, dot) : n, ext = dot > 0 ? n.slice(dot) : '';
    do { cand = `${stem} (${k})${ext}`; k++; } while (seen.has(cand.toLowerCase()));
    seen.set(key, k - 1); seen.set(cand.toLowerCase(), 1);
    return cand;
  });
}
