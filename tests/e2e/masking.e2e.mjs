// Browser acceptance tests: Masking (local adjustments) in the Camera Raw Filter and in
// Library · Develop. Real pointer / keyboard input; judged on the preview canvas and on the
// exported full-resolution PNG. Run: npm run build && node tests/e2e/masking.e2e.mjs
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { serve } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const evidence = join(fileURLToPath(new URL('.', import.meta.url)), '../../docs/evidence');
mkdirSync(evidence, { recursive: true });
const server = await serve(0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => { if (!errors.length) console.log('PAGE ERROR', (e.stack || e.message).split('\n').slice(0, 4).join('\n')); errors.push(e.message); });
const results = [];
let setupFailed = false;
const step = async (name, fn) => { if (setupFailed && name !== 'no uncaught page errors') { results.push({ name, ok: false, error: 'skipped' }); console.log('SKIP ' + name); return; } try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n').slice(0, 3).join(' | ')); if (name.startsWith('setup')) setupFailed = true; } };
const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const settle = () => page.waitForTimeout(150).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 30000 })).then(() => page.waitForTimeout(200));

// ---- the synthetic photo: blue gradient sky, textured ground, an orange object in the middle (1800 × 1200)
const W = 1800, H = 1200;
const inObj = (x, y) => ((x / W - 0.5) / 0.12) ** 2 + ((y / H - 0.64) / 0.17) ** 2 < 1;
const horizon = x => H * (0.42 + 0.03 * Math.sin(x / W * 6));
function paintScene(ctx) {
  const im = ctx.createImageData(W, H); let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; let c;
    if (inObj(x, y)) { const s = 1 - 0.2 * (y / H - 0.47); c = [235 * s, 125 * s, 35 * s]; }
    else if (y < horizon(x)) { const t = y / H; c = [80 + 100 * t, 135 + 80 * t, 235 - 10 * t]; }
    else { const n = rnd(), blk = ((x >> 4) + (y >> 4)) % 2; c = [95 + 50 * n + 18 * blk, 105 + 40 * n, 55 + 25 * n]; }
    im.data[i] = c[0]; im.data[i + 1] = c[1]; im.data[i + 2] = c[2]; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}
const scene = createCanvas(W, H); paintScene(scene.getContext('2d'));
const sceneData = scene.getContext('2d').getImageData(0, 0, W, H).data;
const origAt = (nx, ny) => avg((x, y) => [...sceneData.slice((y * W + x) * 4, (y * W + x) * 4 + 3)], Math.round(nx * W), Math.round(ny * H), 6);
function avg(get, cx, cy, r) { const s = [0, 0, 0]; let n = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const p = get(x, y); s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; n++; } return s.map(v => v / n); }
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = c => Math.max(...c) - Math.min(...c);
const png = { name: 'scene.png', mimeType: 'image/png', buffer: scene.toBuffer('image/png') };

// ---- Camera Raw helpers
const crs = () => page.getByRole('dialog', { name: 'Camera Raw Filter' });
const openCrs = async () => { await app().getByRole('button', { name: 'Filter', exact: true }).click(); await page.getByRole('menuitem', { name: 'Camera Raw Filter…', exact: true }).click(); await crs().waitFor(); await ready(); };
const ready = async () => { await page.waitForTimeout(350); await page.waitForFunction(() => { const s = document.querySelector('.cameraRaw .crsStatus')?.textContent || ''; return s.includes('ready') && !document.querySelector('.mkStatus')?.textContent.includes('Detecting'); }, null, { timeout: 30000 }); await page.waitForTimeout(150); };
const canvasSel = '.cameraRaw canvas[aria-label="Camera Raw preview"]';
/** average colour of the preview canvas around normalised (nx, ny) */
const prev = (nx, ny, sel = canvasSel) => page.evaluate(([sel, nx, ny]) => { const c = document.querySelector(sel), x = c.getContext('2d', { willReadFrequently: true }), px = Math.round(nx * c.width), py = Math.round(ny * c.height), d = x.getImageData(px - 3, py - 3, 7, 7).data, s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } return s.map(v => v / (d.length / 4)); }, [sel, nx, ny]);
const toScreen = async (nx, ny, sel = canvasSel) => { const b = await page.locator(sel).boundingBox(); return [b.x + nx * b.width, b.y + ny * b.height]; };
async function dragOn(pts, opts = {}, sel = canvasSel) {
  const s = []; for (const [x, y] of pts) s.push(await toScreen(x, y, sel));
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(s[0][0], s[0][1]); await page.mouse.down();
  for (const p of s.slice(1)) await page.mouse.move(p[0], p[1], { steps: 10 });
  await page.mouse.up(); if (opts.alt) await page.keyboard.up('Alt');
}
const create = async (scope, type, menu = 'Create New Mask') => { await scope.getByRole('button', { name: menu, exact: true }).click(); await scope.getByRole('menu', { name: menu }).getByRole('menuitem', { name: type, exact: true }).click(); };
const setVal = async (scope, label, v) => { const i = scope.getByLabel(label + ' value', { exact: true }); await i.fill(String(v)); await i.press('Enter'); };
const ensureCss = () => page.evaluate(() => { if (!document.querySelector('link[href$="masking.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/masking.css'; document.head.appendChild(l); } });
const overlayAt = (nx, ny) => page.evaluate(([nx, ny]) => { const c = document.querySelector('.mkOverlay'); if (!c || c.width < 2) return 0; return c.getContext('2d').getImageData(Math.floor(nx * c.width), Math.floor(ny * c.height), 1, 1).data[3]; }, [nx, ny]);

async function exportPx(name) {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const buf = readFileSync(await dl.path()); if (name) writeFileSync(join(evidence, name), buf);
  const img = await loadImage(buf); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  return { w: img.width, h: img.height, at: (nx, ny) => avg((x, y) => [...d.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)], Math.round(nx * img.width), Math.round(ny * img.height), 6) };
}

await page.goto('http://127.0.0.1:' + server.address().port + '/');
await page.waitForSelector(APP); await ensureCss();

// points of interest (normalised)
const OBJ = [0.5, 0.66], SKY = [0.3, 0.12], GROUND = [0.85, 0.9], BRUSH_A = [0.12, 0.8], BRUSH_E = [0.21, 0.8], BRUSH_OUT = [0.12, 0.97];

await step('setup: open a 1800 × 1200 photo-like PNG as a document', async () => {
  // Library · Develop import → Edit in Zertake opens the full-resolution photo as a paint-layer document
  const dvw = page.getByRole('dialog', { name: 'Library and Develop' });
  await app().getByRole('button', { name: 'Library · Develop' }).click(); await dvw.waitFor();
  await dvw.getByLabel('Import photo files').setInputFiles(png);
  const cell = dvw.locator('.dvwCell').first(); await cell.waitFor(); await cell.click(); await page.keyboard.press('d');
  await page.waitForFunction(() => document.querySelector('.dvw .crsStatus')?.textContent.includes('ready'), null, { timeout: 30000 });
  const tabs = await app().locator('.docTab').count();
  await dvw.getByRole('button', { name: 'Edit in Zertake' }).click();
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel + ' .docTab').length === n, [APP, tabs + 1], { timeout: 30000 }); await settle();
  await app().locator('.layerList .layer').first().click({ position: { x: 10, y: 10 } }); await settle();
  const e = await exportPx(); assert.equal(e.w, W); assert.ok(Math.abs(e.at(...OBJ)[0] - origAt(...OBJ)[0]) < 3, 'pixels as painted');
});

await step('Camera Raw: Subject mask (automatic, non-AI) + Exposure +1 brightens the object, not the background; overlay shows the object', async () => {
  await openCrs();
  await crs().getByRole('button', { name: 'Masking', exact: true }).click();
  await create(crs(), 'Subject'); await ready();
  assert.match(await crs().locator('.mkPanel').innerText(), /non-AI/);
  assert.ok(await overlayAt(...OBJ) > 60, 'overlay covers the object'); assert.ok(await overlayAt(...SKY) < 20 && await overlayAt(...GROUND) < 20, 'overlay off the background');
  const o0 = await prev(...OBJ), g0 = await prev(...GROUND), s0 = await prev(...SKY);
  await setVal(crs(), 'Mask Exposure', 1); await ready();
  const o1 = await prev(...OBJ), g1 = await prev(...GROUND), s1 = await prev(...SKY);
  assert.ok(lum(o1) > lum(o0) + 25, `object brightened ${o0} → ${o1}`);
  assert.ok(Math.abs(lum(g1) - lum(g0)) < 4 && Math.abs(lum(s1) - lum(s0)) < 4, `background unchanged ${g0}→${g1}, ${s0}→${s1}`);
  // O toggles the overlay, Esc does not close the dialog while a tool is active
  await crs().locator('.mkHead strong').first().click();
  await page.keyboard.press('o'); assert.equal(await crs().getByLabel('Show Overlay (O)').isChecked(), false); await page.keyboard.press('o'); assert.equal(await crs().getByLabel('Show Overlay (O)').isChecked(), true);
  await crs().getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('masking-subject.png'); assert.equal(e.w, W, 'full resolution');
  assert.ok(lum(e.at(...OBJ)) > lum(origAt(...OBJ)) + 25, 'full-res object brightened ' + e.at(...OBJ) + ' vs ' + origAt(...OBJ));
  assert.ok(Math.abs(lum(e.at(...SKY)) - lum(origAt(...SKY))) < 4 && Math.abs(lum(e.at(...GROUND)) - lum(origAt(...GROUND))) < 5, 'full-res background unchanged');
});

let before = {};
await step('Camera Raw reopens with the mask; Sky mask darkens the sky only', async () => {
  await openCrs();
  await crs().getByRole('button', { name: 'Masking', exact: true }).click();
  assert.equal(await crs().getByRole('button', { name: 'Select Mask 1', exact: true }).count(), 1, 'mask kept with the layer');
  const s0 = await prev(...SKY), g0 = await prev(...GROUND);
  await create(crs(), 'Sky'); await ready();
  assert.ok(await overlayAt(...SKY) > 60 && await overlayAt(...GROUND) < 20, 'sky overlay');
  await setVal(crs(), 'Mask Exposure', -1); await ready();
  const s1 = await prev(...SKY), g1 = await prev(...GROUND);
  assert.ok(lum(s1) < lum(s0) - 25, `sky darker ${s0} → ${s1}`); assert.ok(Math.abs(lum(g1) - lum(g0)) < 4, 'ground unchanged');
});

await step('Entire Image subtract Subject: Saturation −100 greys the background, the object keeps its colour; Background mask is the inverse of Subject', async () => {
  const o0 = await prev(...OBJ), g0 = await prev(...GROUND);
  await create(crs(), 'Entire Image'); await create(crs(), 'Subject', 'Subtract from mask'); await ready();
  assert.match(await crs().locator('.mkComps').innerText(), /Subject/);
  await setVal(crs(), 'Mask Saturation', -100); await ready();
  const o1 = await prev(...OBJ), g1 = await prev(...GROUND);
  assert.ok(sat(g1) < sat(g0) * 0.3, `ground desaturated ${g0} → ${g1}`); assert.ok(sat(o1) > sat(o0) * 0.85, `object keeps colour ${o0} → ${o1}`);
  await create(crs(), 'Background'); await ready();
  assert.ok(await overlayAt(...OBJ) < 30 && await overlayAt(...GROUND) > 60, 'background overlay is the inverse of subject');
  await page.keyboard.press('Delete'); // focus is in the dialog: Delete removes the selected component (and the now empty mask)
  await page.waitForTimeout(200); assert.equal(await crs().getByRole('button', { name: 'Select Mask 4', exact: true }).count(), 0, 'Delete removed the component and its mask');
});

await step('Brush: paint adds, Alt-drag erases; Exposure +1.5 only where painted', async () => {
  await create(crs(), 'Brush');
  assert.equal(await crs().locator('.mkLayer.active').count(), 1, 'brush tool active');
  await dragOn([[0.06, 0.8], [0.12, 0.8], [0.2, 0.8], [0.3, 0.8]]);
  await crs().getByRole('button', { name: 'Erase', exact: true }).click(); await setVal(crs(), 'Brush size', 4);
  await dragOn([[0.21, 0.78], [0.21, 0.82]]);
  await crs().getByRole('button', { name: 'Add', exact: true }).click();
  const a0 = await prev(...BRUSH_A), e0 = await prev(...BRUSH_E), x0 = await prev(...BRUSH_OUT);
  await setVal(crs(), 'Mask Exposure', 1.5); await ready();
  const a1 = await prev(...BRUSH_A), e1 = await prev(...BRUSH_E), x1 = await prev(...BRUSH_OUT);
  assert.ok(lum(a1) > lum(a0) + 25, `painted area brighter ${a0} → ${a1}`);
  assert.ok(Math.abs(lum(e1) - lum(e0)) < 6, `erased area unchanged ${e0} → ${e1}`);
  assert.ok(Math.abs(lum(x1) - lum(x0)) < 4, `outside unchanged ${x0} → ${x1}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  assert.equal(await crs().count(), 1, 'Esc left the tool, not the dialog'); assert.equal(await crs().locator('.mkLayer.active').count(), 0);
  before.brushA = a1;
});

await step('Linear gradient: drag creates it, full effect at the start, none past the end; handles shown', async () => {
  await create(crs(), 'Linear Gradient');
  const t0 = await prev(0.95, 0.97), m0 = await prev(0.95, 0.55);
  await dragOn([[0.95, 0.99], [0.95, 0.85], [0.95, 0.7]]); await ready();
  assert.equal(await crs().getByRole('button', { name: 'Gradient center handle' }).count(), 1, 'three-line handles');
  await setVal(crs(), 'Mask Exposure', 1.2); await ready();
  const t1 = await prev(0.95, 0.97), m1 = await prev(0.95, 0.55);
  assert.ok(lum(t1) > lum(t0) + 20, `start side brighter ${t0} → ${t1}`); assert.ok(Math.abs(lum(m1) - lum(m0)) < 4, 'beyond the end unchanged');
  // move the gradient up with its centre handle: the former "beyond" point is now affected
  const [hx, hy] = await (async () => { const b = await crs().getByRole('button', { name: 'Gradient center handle' }).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; })();
  const top = await toScreen(0.95, 0.5);
  await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx, top[1], { steps: 8 }); await page.mouse.up(); await ready();
  const m2 = await prev(0.95, 0.55); assert.ok(lum(m2) > lum(m0) + 10, `gradient moved ${m0} → ${m2}`);
});

await step('Radial gradient: drag an ellipse; −2 EV darkens inside only; the width handle resizes it', async () => {
  await create(crs(), 'Radial Gradient');
  const c0 = await prev(0.75, 0.2), o0 = await prev(0.55, 0.2), r0 = await prev(0.92, 0.2);
  await dragOn([[0.75, 0.2], [0.8, 0.25], [0.83, 0.32]]); await ready();
  await setVal(crs(), 'Mask Exposure', -2); await ready();
  const c1 = await prev(0.75, 0.2), o1 = await prev(0.55, 0.2), r1 = await prev(0.92, 0.2);
  assert.ok(lum(c1) < lum(c0) - 40, `centre darker ${c0} → ${c1}`); assert.ok(Math.abs(lum(o1) - lum(o0)) < 4 && Math.abs(lum(r1) - lum(r0)) < 4, 'outside unchanged');
  const hb = await crs().getByRole('button', { name: 'Radial width handle', exact: true }).boundingBox(), to = await toScreen(0.97, 0.2);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(to[0], hb.y + hb.height / 2, { steps: 8 }); await page.mouse.up(); await ready();
  const r2 = await prev(0.92, 0.2); assert.ok(lum(r2) < lum(r0) - 10, `wider ellipse now reaches x=0.92 ${r0} → ${r2}`);
  await crs().getByRole('button', { name: 'Outside', exact: true }).click(); await ready();
  const c3 = await prev(0.75, 0.2), o3 = await prev(0.55, 0.2); assert.ok(lum(c3) > lum(c1) + 30 && lum(o3) < lum(o0) - 30, 'Outside flips the effect');
  await crs().getByRole('button', { name: 'Inside', exact: true }).click(); await ready();
});

await step('OK renders every mask at full resolution', async () => {
  await crs().getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('masking-all.png'); assert.equal(e.w, W);
  const o = e.at(...OBJ), s = e.at(...SKY), g = e.at(0.85, 0.5), b = e.at(...BRUSH_A);
  assert.ok(lum(o) > lum(origAt(...OBJ)) + 20 && sat(o) > 100, 'object: brighter and still orange ' + o);
  assert.ok(lum(s) < lum(origAt(...SKY)) - 25, 'sky darker ' + s);
  assert.ok(sat(g) < 20, 'ground desaturated ' + g);
  assert.ok(lum(b) > lum(origAt(...BRUSH_A)) + 20, 'brushed area brighter ' + b);
  assert.ok(lum(e.at(0.75, 0.2)) < lum(origAt(0.75, 0.2)) - 40, 'radial darkens');
});

await step('Library · Develop: Masking with history — a Radial mask brightens the preview; the history step undoes it', async () => {
  const dvw = page.getByRole('dialog', { name: 'Library and Develop' });
  await app().getByRole('button', { name: 'Library · Develop' }).click(); await dvw.waitFor();
  const cell = dvw.locator('.dvwCell').first(); await cell.waitFor(); await cell.click(); await page.keyboard.press('d');
  const cv = '.dvw canvas[aria-label="Develop preview"]';
  await page.waitForFunction(() => document.querySelector('.dvw .crsStatus')?.textContent.includes('ready'), null, { timeout: 30000 }); await page.waitForTimeout(400);
  await dvw.getByRole('button', { name: 'Masking', exact: true }).click(); await ensureCss();
  const histBefore = await dvw.getByRole('list', { name: 'Develop history' }).getByRole('button').count();
  const c0 = await prev(0.5, 0.66, cv), out0 = await prev(0.1, 0.1, cv);
  await create(dvw, 'Radial Gradient'); await dragOn([[0.5, 0.66], [0.56, 0.74]], {}, cv);
  await setVal(dvw, 'Mask Exposure', 1); await page.waitForTimeout(500);
  await page.waitForFunction(() => document.querySelector('.dvw .crsStatus')?.textContent.includes('ready'), null, { timeout: 30000 }); await page.waitForTimeout(400);
  const c1 = await prev(0.5, 0.66, cv), out1 = await prev(0.1, 0.1, cv);
  assert.ok(lum(c1) > lum(c0) + 20 && Math.abs(lum(out1) - lum(out0)) < 4, `develop preview ${c0}→${c1}, outside ${out0}→${out1}`);
  await page.waitForTimeout(900); // history commit debounce
  const labels = await dvw.getByRole('list', { name: 'Develop history' }).innerText();
  assert.match(labels, /Mask Exposure/); assert.match(labels, /Radial Gradient/);
  assert.ok(await dvw.getByRole('list', { name: 'Develop history' }).getByRole('button').count() > histBefore);
  await dvw.getByRole('list', { name: 'Develop history' }).getByRole('button').last().click(); await page.waitForTimeout(500);
  assert.equal(await dvw.getByRole('button', { name: 'Select Mask 1', exact: true }).count(), 0, 'history step before the mask removes it');
  await dvw.getByRole('button', { name: 'Close Library and Develop' }).click();
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
