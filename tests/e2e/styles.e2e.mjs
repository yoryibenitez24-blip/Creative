// Browser acceptance tests: empty-layer button, right-click menus, Layer Style dialog and effects,
// Blend If, clipping masks and the Camera Raw Filter. Real input only; judged on exported PNGs.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { serve } from './serve.mjs';
import { readPsd, initializeCanvas } from 'ag-psd';
import { ImageData as NImageData } from '@napi-rs/canvas';
initializeCanvas(createCanvas, undefined, (w, h) => new NImageData(w, h));

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const evidence = join(fileURLToPath(new URL('.', import.meta.url)), '../../docs/evidence');
mkdirSync(evidence, { recursive: true });
const server = await serve(0);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => { if (!errors.length) console.log('PAGE ERROR', (e.stack || e.message).split('\n').slice(0, 4).join('\n')); errors.push(e.message); });
const results = [];
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false, error: e.message }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };
const APP = 'div.app[style*="display: flex"]';
const app = () => page.locator(APP);
const W = 300, H = 200, BG = [244, 241, 234];
const mapping = () => page.evaluate(sel => { const m = document.querySelector(sel + ' .artboardContainer svg').getScreenCTM(); return { a: m.a, d: m.d, e: m.e, f: m.f }; }, APP);
const scr = async (x, y) => { const m = await mapping(); return { x: m.a * x + m.e, y: m.d * y + m.f }; };
async function drag(points) { const m = await mapping(); const s = points.map(([x, y]) => ({ x: m.a * x + m.e, y: m.d * y + m.f })); await page.mouse.move(s[0].x, s[0].y); await page.mouse.down(); for (const p of s.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 }); await page.mouse.up(); }
const settle = () => page.waitForTimeout(150).then(() => page.waitForFunction(sel => { const a = document.querySelector(sel); return a && a.dataset.work === '0' && !document.querySelector('.opDialog') && a.querySelector('.saveStatus')?.textContent.includes('Saved locally'); }, APP, { timeout: 20000 })).then(() => page.waitForTimeout(200));
const setNum = async (label, v) => { const i = page.getByLabel(label, { exact: true }); await i.fill(String(v)); await i.blur(); };
async function exportPx(name) {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const png = readFileSync(await dl.path()); if (name) writeFileSync(join(evidence, name), png);
  const img = await loadImage(png); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  return { w: img.width, h: img.height, at: (x, y) => [...d.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)], d };
}
const near = (a, b, tol, what) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= tol), `${what}: ${a} vs ${b}`);
const rowOf = name => app().locator('.layerList .layer').filter({ has: page.locator(`input[value="${name}"]`) });
const menuItem = name => page.getByRole('menuitem', { name, exact: true });

await page.goto('http://127.0.0.1:' + server.address().port + '/#design');
await page.waitForSelector(APP);

await step('the + button creates an empty layer (not a rectangle)', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('300 × 200'), APP);
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  assert.equal(await app().locator('.layerList .layer').count(), 1);
  assert.equal(await app().locator('.floatingLabel').innerText(), 'Paint layer');
  const e = await exportPx(); near(e.at(150, 100), BG, 0, 'empty layer shows only the background');
});

await step('black square on the layer, then right-click › Blending Options opens Layer Style', async () => {
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[100, 60], [150, 100], [200, 140]]);
  await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d');
  await rowOf('Paint layer 1').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuItem('Blending Options…').click();
  await page.getByRole('dialog', { name: 'Layer Style' }).waitFor();
  assert.ok(await page.getByLabel('Fill Opacity value', { exact: true }).isVisible());
});

let base;
await step('Drop Shadow (distance 20, size 0) and outside red Stroke render and export', async () => {
  await page.getByLabel('Drop Shadow', { exact: true }).check();
  await setNum('Distance value', 20); await setNum('Size value', 0); await setNum('Opacity value', 100);
  await page.getByLabel('Stroke', { exact: true }).check();
  await setNum('Size value', 5); await page.getByLabel('Color', { exact: true }).fill('#ff0000');
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  base = await exportPx('m1-styles-shadow-stroke.png');
  near(base.at(150, 100), [0, 0, 0], 2, 'content');
  near(base.at(206, 150), [0, 0, 0], 30, 'shadow offset down-right (angle 120°)');
  near(base.at(97, 100), [255, 0, 0], 30, 'outside stroke');
  near(base.at(40, 40), BG, 2, 'background');
  assert.equal(await app().getByRole('button', { name: 'Layer style of Paint layer 1' }).count(), 1, 'fx badge');
});

await step('Color Overlay and Fill Opacity 0: overlay stays, content hidden; Cancel discards changes', async () => {
  await app().getByRole('button', { name: 'Layer style of Paint layer 1' }).click();
  await page.getByLabel('Color Overlay', { exact: true }).check(); await page.getByLabel('Color', { exact: true }).fill('#00ff00');
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  near((await exportPx()).at(150, 100), [0, 255, 0], 3, 'overlay');
  await app().getByRole('button', { name: 'Layer style of Paint layer 1' }).click();
  await page.getByRole('button', { name: 'Blending Options', exact: true }).click(); await setNum('Fill Opacity value', 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  near((await exportPx()).at(150, 100), [0, 255, 0], 3, 'cancel kept the overlay');
});

await step('Blend If (This Layer black 10) hides the black content; undo restores in one step', async () => {
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300); // remove overlay
  near((await exportPx()).at(150, 100), [0, 0, 0], 2, 'overlay undone');
  await app().getByRole('button', { name: 'Layer style of Paint layer 1' }).click();
  await page.getByRole('button', { name: 'Blending Options', exact: true }).click();
  await setNum('This Layer black value', 10); await setNum('This Layer black split value', 10);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  const e = await exportPx(); assert.ok(e.at(150, 100)[0] > 150, 'black content hidden by Blend If: ' + e.at(150, 100));
  await page.keyboard.press('Control+z'); await settle(); await page.waitForTimeout(300);
  near((await exportPx()).at(150, 100), [0, 0, 0], 2, 'undo');
});

await step('Clipping mask: a full red layer clipped to the square only shows inside it', async () => {
  await page.keyboard.press('Control+Shift+n'); await app().getByLabel('Foreground color').fill('#ff0000'); await app().getByLabel('Foreground color').blur();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d');
  near((await exportPx()).at(40, 40), [255, 0, 0], 2, 'unclipped covers all');
  await page.keyboard.press('Control+Alt+g'); await settle(); await page.waitForTimeout(400);
  const e = await exportPx('m1-styles-clip.png'); near(e.at(150, 100), [255, 0, 0], 3, 'inside'); near(e.at(40, 40), BG, 3, 'outside clipped away');
  assert.equal(await app().locator('.layer.clipped').count(), 1);
  await page.keyboard.press('Control+z'); await settle(); await page.keyboard.press('Control+z'); await settle(); await page.keyboard.press('Control+z'); await settle();
});

await step('right-click on the canvas with a selection shows selection commands', async () => {
  await rowOf('Paint layer 1').locator('.layerThumb').click();
  await app().getByTitle('Marquee (M)', { exact: true }).click(); await drag([[20, 20], [40, 40], [60, 60]]); await settle();
  const p = await scr(40, 40); await page.mouse.click(p.x, p.y, { button: 'right' });
  assert.equal(await page.getByRole('menu', { name: 'Selection menu' }).count(), 1);
  await menuItem('Deselect').click(); await settle();
  assert.equal(await app().locator('path.antsDash').count(), 0);
  // anywhere else: general menu
  await app().locator('.inspectorBottom').click({ button: 'right' });
  assert.equal(await page.getByRole('menu', { name: 'Menu' }).count(), 1); await page.keyboard.press('Escape');
});

await step('Camera Raw Filter: every panel present; Exposure +1 brightens; settings reopen with the layer', async () => {
  await app().getByRole('button', { name: 'Filter', exact: true }).click(); await menuItem('Camera Raw Filter…').click();
  await page.getByRole('dialog', { name: 'Camera Raw Filter' }).waitFor();
  for (const p of ['Effects', 'Curve', 'Color Mixer', 'Color Grading', 'Detail', 'Optics', 'Lens Blur', 'Calibration']) await page.getByRole('button', { name: new RegExp('^▸ ' + p + '$') }).click();
  for (const label of ['Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks', 'Temperature', 'Tint', 'Vibrance', 'Saturation', 'Texture', 'Clarity', 'Dehaze', 'Vignette amount', 'Grain amount', 'Grain roughness', 'Grain size', 'Vignette feather', 'Sharpening', 'Sharpening masking', 'Curve highlights', 'Grading saturation', 'Noise Reduction', 'Color Noise Reduction', 'Distortion', 'Purple Amount', 'Green Amount', 'Blur amount', 'Shadows Tint', 'Red Hue', 'Blue Saturation'])
    assert.equal(await page.getByLabel(label, { exact: true }).count(), 1, 'missing control ' + label);
  assert.equal(await page.getByLabel('Remove chromatic aberration', { exact: true }).count(), 1);
  await setNum('Exposure value', 1); await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  const e = await exportPx('m1-camera-raw.png'); assert.ok(e.at(150, 100)[0] < 40, 'black stays black'); near(e.at(40, 40), BG, 2, 'transparent area unchanged');
  await page.keyboard.press('Control+Shift+a'); await page.getByRole('dialog', { name: 'Camera Raw Filter' }).waitFor();
  assert.equal(await page.getByLabel('Exposure value', { exact: true }).inputValue(), '1.00', 'settings reopen');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

await step('Fill layer (Solid Color) and adjustment layers (Invert, Levels) affect layers below; undo removes them', async () => {
  await app().getByRole('button', { name: 'Layer', exact: true }).click(); await menuItem('New Fill Layer').hover(); await menuItem('Solid Color…').click(); await settle();
  near((await exportPx()).at(40, 40), [255, 0, 0], 2, 'solid fill uses the foreground colour');
  await page.getByLabel('Fill color', { exact: true }).fill('#0000ff'); await settle();
  near((await exportPx()).at(40, 40), [0, 0, 255], 2, 'fill colour edited from the inspector');
  await page.keyboard.press('Control+z'); await settle(); await page.keyboard.press('Control+z'); await settle();
  near((await exportPx()).at(40, 40), BG, 2, 'fill layer undone');
  await app().getByRole('button', { name: 'Layer', exact: true }).click(); await menuItem('New Adjustment Layer').hover(); await menuItem('Invert').click(); await settle(); await page.waitForTimeout(500); await settle();
  const inv = await exportPx('m1-adjustment-invert.png'); near(inv.at(40, 40), BG.map(v => 255 - v), 3, 'background inverted'); near(inv.at(150, 100), [255, 255, 255], 3, 'black square inverted');
  await page.keyboard.press('Control+z'); await settle();
  await app().getByRole('button', { name: 'Layer', exact: true }).click(); await menuItem('New Adjustment Layer').hover(); await menuItem('Levels…').click(); await settle();
  await setNum('Input black value', 200); await settle(); await page.waitForTimeout(500); await settle();
  const lv = await exportPx(); near(lv.at(40, 40), [204, 190, 158], 3, 'levels (input black 200) remaps the background');
  await page.keyboard.press('Control+z'); await settle(); await page.keyboard.press('Control+z'); await settle();
  near((await exportPx()).at(40, 40), BG, 2, 'adjustment removed');
});

await step('Export › PSD writes editable layers in Photoshop order with masks and effects', async () => {
  await rowOf('Paint layer 1').locator('.layerThumb').click();
  await app().getByRole('button', { name: 'Layer', exact: true }).click(); await menuItem('Layer Style').hover(); await menuItem('Drop Shadow…').click();
  await page.getByLabel('Drop Shadow', { exact: true }).check(); await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  await app().locator('button.export').click(); await app().getByRole('button', { name: 'Format PSD' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PSD/ }).click()]);
  const buf = readFileSync(await dl.path()); writeFileSync(join(evidence, 'm1-export.psd'), buf);
  const psd = readPsd(new Uint8Array(buf), { useImageData: true });
  const panel = (await app().locator('.layerList .layer input[aria-label="Layer name"]').evaluateAll(els => els.map(e => e.value))).reverse();
  assert.deepEqual(psd.children.map(c => c.name), panel, 'same layers, bottom-first');
  assert.deepEqual([psd.width, psd.height], [W, H]);
  const l = psd.children.find(c => c.name === 'Paint layer 1');
  assert.ok(l.effects?.dropShadow?.[0], 'drop shadow kept as an editable effect');
  assert.ok(l.imageData.data.some((v, i) => i % 4 === 3 && v === 255), 'layer pixels present');
  assert.ok(await page.getByLabel('PSD compatibility notes').count() === 1, 'compatibility notes shown');
  await page.keyboard.press('Escape');
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await page.screenshot({ path: join(evidence, 'm1-styles-ui.png') });
await browser.close(); server.close();
writeFileSync(join(evidence, 'm1-styles-e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), browser: 'chromium (Playwright)', results }, null, 2));
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.filter(r => r.ok).length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
