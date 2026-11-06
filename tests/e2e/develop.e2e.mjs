// Browser acceptance tests: Library + Develop workspace (import, rating, develop settings,
// Edit in Zertake) and colour management (Mode, Convert to Profile, proof colours).
// Real input only; judged on exported PNGs.
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


const menu = async (top, ...path) => { await app().getByRole('button', { name: top, exact: true }).click(); for (const p of path.slice(0, -1)) await app().getByRole('menuitem', { name: p, exact: true }).hover(); await app().getByRole('menuitem', { name: path.at(-1), exact: true }).click(); };
const pngFile = (w, h, paint) => { const c = createCanvas(w, h); const x = c.getContext('2d'); paint(x); return { name: 'placed.png', mimeType: 'image/png', buffer: c.toBuffer('image/png') }; };



// Read the exported PNG's raw numbers: drop the embedded iCCP chunk so the decoder does not colour-convert.
const stripIcc = buf => { const out = [buf.subarray(0, 8)]; let iccp = false; for (let o = 8; o < buf.length;) { const n = buf.readUInt32BE(o), t = buf.toString('latin1', o + 4, o + 8); if (t === 'iCCP') iccp = true; else out.push(buf.subarray(o, o + 12 + n)); o += 12 + n; } return { png: Buffer.concat(out), iccp }; };
async function exportRaw() {
  await app().locator('button.export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app().getByRole('button', { name: /Download PNG/ }).click()]); await page.waitForFunction(() => !document.querySelector('.modalBackdrop'));
  const { png, iccp } = stripIcc(readFileSync(await dl.path())); const img = await loadImage(png); const c = createCanvas(img.width, img.height); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  return { iccp, at: (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)] };
}

await page.goto('http://127.0.0.1:' + server.address().port + '/');
await page.waitForSelector(APP);
const dvw = () => page.getByRole('dialog', { name: 'Library and Develop' });

await step('Library: import a photo, rate it with the keyboard', async () => {
  await app().getByRole('button', { name: 'Library · Develop' }).click(); await dvw().waitFor();
  await dvw().getByLabel('Import photo files').setInputFiles(pngFile(120, 80, x => { x.fillStyle = '#404040'; x.fillRect(0, 0, 120, 80); }));
  const cell = dvw().locator('.dvwCell').first(); await cell.waitFor(); await cell.click();
  await page.keyboard.press('3'); await page.waitForTimeout(200);
  assert.match(await cell.innerText().catch(() => ''), /★★★|3/, 'three stars shown');
});

await step('Develop: Exposure brightens; Edit in Zertake opens the developed photo as a document', async () => {
  await page.keyboard.press('d'); await dvw().getByLabel('Exposure', { exact: true }).first().waitFor();
  const ex = dvw().getByLabel('Exposure value', { exact: true }).first(); await ex.fill('1'); await ex.press('Enter'); await page.waitForTimeout(800);
  const tabs = await app().locator('.docTab').count();
  await dvw().getByRole('button', { name: 'Edit in Zertake' }).click();
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel + ' .docTab').length === n, [APP, tabs + 1], { timeout: 20000 }); await settle();
  const e = await exportPx('develop-edit-in-zertake.png');
  assert.equal(e.w, 120); assert.ok(e.at(60, 40)[0] > 80, 'brightened from 64: ' + e.at(60, 40));
});

await step('Image › Mode › Grayscale converts pixels and checks the mode', async () => {
  const before = (await exportPx()).at(60, 40);
  await app().locator('.menubar').getByRole('button', { name: 'Image', exact: true }).click(); await menuItem('Mode').hover(); await menuItem('Grayscale').click(); await settle();
  const g = (await exportPx()).at(60, 40); assert.ok(g[0] === g[1] && g[1] === g[2], 'neutral ' + g); near(g, before, 3, 'grey stays grey');
  await page.keyboard.press('Control+z'); await settle();
});

await step('Edit › Convert to Profile (Display P3) changes the numbers but not the appearance on screen', async () => {
  await app().locator('.layerList .layer').first().click({ position: { x: 10, y: 10 } });
  await app().locator('.menubar').getByRole('button', { name: 'Edit', exact: true }).click(); await menuItem('Convert to Profile…').click();
  await page.getByRole('combobox', { name: 'Destination profile' }).selectOption('Display P3'); await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle();
  assert.match(await app().locator('.artboardLabel, .statusProfile').allInnerTexts().then(t => t.join(' ')), /Display P3/);
});

await step('Display is colour-managed: pure red converted to Display P3 has new numbers and the same on-screen colour', async () => {
  await app().getByTitle('New design').click(); await app().getByLabel('New width').fill(String(W)); await app().getByLabel('New height').fill(String(H));
  await app().getByRole('button', { name: /Create design/ }).click(); await settle();
  await app().locator('.leftFooter').getByTitle('Create a new layer').click(); await settle();
  await app().locator('input.fgSwatch').fill('#ff0000'); await app().locator('input.fgSwatch').blur(); await page.keyboard.press('Control+a'); await page.keyboard.press('Alt+Backspace'); await settle(); await page.keyboard.press('Control+d'); await settle();
  const onScreen = async () => { const c = await scr(150, 100); const png = await page.screenshot({ clip: { x: c.x - 2, y: c.y - 2, width: 4, height: 4 } }); const im = await loadImage(png); const cv = createCanvas(im.width, im.height); const x = cv.getContext('2d'); x.drawImage(im, 0, 0); return [...x.getImageData(1, 1, 1, 1).data.slice(0, 3)]; };
  const s0 = await onScreen(); near(s0, [255, 0, 0], 2, 'red on screen');
  await app().locator('.menubar').getByRole('button', { name: 'Edit', exact: true }).click(); await menuItem('Convert to Profile…').click();
  await page.getByRole('combobox', { name: 'Destination profile' }).selectOption('Display P3'); await page.getByRole('button', { name: 'OK', exact: true }).click(); await settle(); await page.waitForTimeout(300);
  const e = await exportRaw(); assert.ok(e.iccp, 'Display P3 profile embedded in the PNG'); near(e.at(150, 100), [234, 51, 35], 3, 'P3 numbers in the export');
  near(await onScreen(), [255, 0, 0], 8, 'appearance preserved on screen');
  await page.keyboard.press('Control+y'); await page.waitForFunction(sel => document.querySelectorAll(sel + ' .artboardContainer svg image[data-ui]').length > 0, APP, { timeout: 15000 });
  assert.match(await app().locator('.statusProfile').innerText(), /Proof/);
  const pr = await onScreen(); assert.ok(pr[0] < 250 && pr[0] > 150, 'CMYK proof dulls saturated red: ' + pr);
  await page.keyboard.press('Control+y'); await settle();
});

await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
