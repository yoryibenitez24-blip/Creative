// Browser acceptance test for the Web / UI workspace (src/web/WebWorkspace.jsx).
// Builds a scratch harness page that mounts <WebWorkspace> with React state (the lead can later point this at the
// real app route), then drives it with real mouse / keyboard input and checks the document, the DOM and downloads.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const repo = join(fileURLToPath(new URL('.', import.meta.url)), '../..');

// ── harness ──
const dir = mkdtempSync(join(tmpdir(), 'zertake-web-'));
writeFileSync(join(dir, 'entry.jsx'), `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import WebWorkspace, { createWebDoc } from ${JSON.stringify(join(repo, 'src/web/WebWorkspace.jsx'))};
const t = new URLSearchParams(location.search).get('t') || 'desktop';
window.__labels = [];
function App() {
  const [doc, setDoc] = useState(() => createWebDoc(t));
  window.__doc = doc;
  return <WebWorkspace doc={doc} onChange={(d, l) => { window.__labels.push(l); setDoc(d); }} onExit={() => { window.__exited = true; }} />;
}
createRoot(document.getElementById('root')).render(<App />);
`);
writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Web harness</title>
<link rel="stylesheet" href="/css/modern.css"><link rel="stylesheet" href="/css/web.css"><style>html,body{margin:0;background:#0f0f11}</style></head>
<body><div id="root"></div><script src="/web.js"></script></body></html>`);
await build({ entryPoints: [join(dir, 'entry.jsx')], bundle: true, outfile: join(dir, 'web.js'), loader: { '.jsx': 'jsx' }, nodePaths: [join(repo, 'node_modules')], logLevel: 'error' });
const server = http.createServer(async (q, r) => {
  const p = new URL(q.url, 'http://x').pathname;
  const f = p.startsWith('/css/') ? join(repo, 'dist', p) : join(dir, p === '/' ? 'index.html' : p);
  try { const b = await readFile(f); r.writeHead(200, { 'content-type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(b); }
  catch { r.writeHead(404); r.end(); }
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
const errors = []; page.on('pageerror', e => { console.log('PAGE ERROR', e.message); errors.push(e.message); });
const results = [];
const step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n').slice(0, 3).join('\n     ')); } };

const doc = () => page.evaluate(() => window.__doc);
const nodesOf = async type => Object.values((await doc()).nodes).filter(n => n.type === type);
const byName = async name => Object.values((await doc()).nodes).find(n => n.name === name);
/** world → screen using the canvas transform */
const view = () => page.evaluate(() => { const c = document.querySelector('.wbCanvas').getBoundingClientRect(); const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(document.querySelector('.wbWorld').style.transform); return { l: c.left, t: c.top, x: +m[1], y: +m[2], z: +m[3] }; });
const scr = async (wx, wy) => { const v = await view(); return [v.l + v.x + wx * v.z, v.t + v.y + wy * v.z]; };
async function drag(from, to, opts = {}) { await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(opts.wait ?? 80); }
const layerRow = name => page.locator('.wbLayer', { has: page.locator('.wbLayerName', { hasText: new RegExp('^' + name + '$') }) }).first();
const setNum = async (label, v) => { const i = page.getByLabel(label, { exact: true }); await i.fill(String(v)); await i.press('Enter'); await page.waitForTimeout(60); };
const absBox = async id => page.evaluate(id => { const r = document.querySelector(`.wbWorld [data-id="${id}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, id);
const pngPixels = async buf => { const img = await loadImage(buf); const c = createCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, img.width, img.height).data; return { w: img.width, h: img.height, at: (px, py) => [...d.slice((py * img.width + px) * 4, (py * img.width + px) * 4 + 4)] }; };

await page.goto(`http://127.0.0.1:${server.address().port}/?t=desktop`);
await page.waitForSelector('[data-testid="web-workspace"]');
let mobile, rect, text, comp, inst, small;

await step('create a frame from a device preset', async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Frame preset Mobile', exact: true }).click();
  await page.waitForTimeout(150);
  mobile = await byName('Mobile');
  assert.ok(mobile, 'Mobile frame exists'); assert.equal(mobile.w, 390); assert.equal(mobile.h, 844); assert.equal(mobile.parent, null);
  await assertVisible(layerRow('Mobile'));
});
async function deselect() { await page.locator('.wbCanvas').click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(50); }
async function assertVisible(l) { assert.ok(await l.isVisible(), 'visible'); }

await step('draw a rectangle inside the frame (R + drag)', async () => {
  await page.keyboard.press('r');
  const a = await scr(mobile.x + 40, mobile.y + 60), b = await scr(mobile.x + 240, mobile.y + 160);
  await drag(a, b);
  rect = (await nodesOf('rect'))[0];
  assert.ok(rect); assert.equal(rect.parent, mobile.id);
  assert.ok(Math.abs(rect.x - 40) <= 2 && Math.abs(rect.y - 60) <= 2 && Math.abs(rect.w - 200) <= 3 && Math.abs(rect.h - 100) <= 3, JSON.stringify([rect.x, rect.y, rect.w, rect.h]));
  const l = (await page.evaluate(() => window.__labels)).at(-1); assert.equal(l, 'Add rectangle');
});

await step('add a text layer (T + click + type)', async () => {
  await page.keyboard.press('t');
  await page.mouse.click(...await scr(mobile.x + 40, mobile.y + 300));
  const ed = page.getByLabel('Edit text', { exact: true }); await ed.waitFor();
  await page.keyboard.type('Hello web');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  text = (await nodesOf('text'))[0];
  assert.equal(text?.text, 'Hello web'); assert.equal(text.parent, mobile.id);
  assert.ok(text.w > 40 && text.h > 10, 'auto width text was measured');
  const dom = await page.locator(`.wbWorld [data-id="${text.id}"]`).innerText(); assert.equal(dom.trim(), 'Hello web');
});

await step('undo / redo inside the workspace', async () => {
  await page.locator('.wbCanvas').click({ position: { x: 5, y: 5 } }); // focus canvas area, deselect
  await page.keyboard.press('Control+z'); await page.waitForTimeout(80);
  assert.equal((await nodesOf('text')).length, 0);
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(80);
  assert.equal((await nodesOf('text')).length, 1);
});

await step('auto layout: Shift+A, then gap and padding move children', async () => {
  await layerRow('Mobile').click();
  await page.keyboard.press('Shift+A'); await page.waitForTimeout(100);
  let f = await byName('Mobile'); assert.ok(f.layout, 'frame has auto layout'); assert.equal(f.layout.direction, 'vertical');
  await setNum('Gap', 30); await setNum('Padding top', 50); await setNum('Padding left', 24);
  const d = await doc(); f = d.nodes[mobile.id];
  const [first, second] = f.children.map(id => d.nodes[id]);
  assert.equal(first.y, 50); assert.equal(first.x, 24); assert.equal(second.y, 50 + first.h + 30);
  // rendered DOM follows (screen distance = gap × zoom)
  const v = await view(); const a = await absBox(first.id), b = await absBox(second.id);
  assert.ok(Math.abs((b.y - (a.y + a.h)) - 30 * v.z) < 1.5, `rendered gap ${(b.y - (a.y + a.h))} vs ${30 * v.z}`);
  await page.getByRole('button', { name: 'Align center', exact: true }).click(); await page.waitForTimeout(60);
  const d2 = await doc(); const r2 = d2.nodes[rect.id], pad = d2.nodes[mobile.id].layout.padding;
  assert.ok(Math.abs(r2.x + r2.w / 2 - (pad[3] + (390 - pad[1] - pad[3]) / 2)) < 1, 'centered horizontally inside padding');
});

await step('components: create, insert instance, main edits propagate', async () => {
  await layerRow('Rectangle').click();
  await page.keyboard.press('Control+Alt+k'); await page.waitForTimeout(100);
  comp = Object.values((await doc()).nodes).find(n => n.isComponent);
  assert.ok(comp, 'main component created');
  await page.getByRole('tab', { name: 'Assets' }).click();
  await deselect(); // clear selection → instance goes to the canvas
  await page.getByRole('button', { name: 'Insert instance of ' + comp.name, exact: true }).click(); await page.waitForTimeout(100);
  inst = Object.values((await doc()).nodes).find(n => n.componentId === comp.id && !n.ref);
  assert.ok(inst, 'instance created'); assert.equal(inst.children.length, 1);
  // edit the main's rectangle fill
  await page.getByRole('tab', { name: 'Layers' }).click();
  await page.getByRole('button', { name: 'Go to component ' + comp.name }).count(); // assets panel no longer shown
  const d = await doc(); const mainRect = d.nodes[comp.children[0]];
  await page.evaluate(() => 0);
  await page.locator(`.wbLayer[data-layer="${comp.id}"]`).click();
  await page.keyboard.press('Enter'); await page.waitForTimeout(60); // select children
  const hex = page.getByLabel('Fill color hex', { exact: true }); await hex.fill('FF0000'); await hex.press('Enter'); await page.waitForTimeout(100);
  const d2 = await doc();
  assert.equal(d2.nodes[mainRect.id].fill, '#ff0000');
  const copy = d2.nodes[inst.children[0]]; assert.equal(copy.fill, '#ff0000');
  const bg = await page.evaluate(id => getComputedStyle(document.querySelector(`.wbWorld [data-id="${id}"]`)).backgroundColor, copy.id);
  assert.equal(bg, 'rgb(255, 0, 0)');
});

await step('prototype link + present mode navigation', async () => {
  await deselect();
  await page.getByRole('button', { name: 'Frame preset Mobile small', exact: true }).click(); await page.waitForTimeout(100);
  small = await byName('Mobile small'); assert.ok(small);
  await layerRow('Hello web').click();
  await page.getByRole('tab', { name: 'Prototype' }).click();
  await page.getByLabel('Navigate to', { exact: true }).selectOption(small.id);
  await page.getByLabel('Transition', { exact: true }).selectOption('dissolve');
  const t = (await doc()).nodes[text.id]; assert.equal(t.proto.target, small.id); assert.equal(t.proto.transition, 'dissolve');
  assert.ok(await page.locator('.wbProto path').count() >= 1, 'link arrow drawn');
  await page.getByRole('button', { name: 'Present prototype' }).click();
  const title = page.getByTestId('present-frame'); await title.waitFor();
  assert.equal(await title.innerText(), 'Mobile');
  await page.locator(`.wbPresent [data-id="${text.id}"]`).click();
  await page.waitForTimeout(450);
  assert.equal(await title.innerText(), 'Mobile small');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  assert.equal(await page.locator('.wbPresent').count(), 0); await page.getByTestId('web-workspace').waitFor();
});

await step('export PNG 2× (real pixels), SVG and HTML+CSS downloads', async () => {
  await page.getByRole('tab', { name: 'Design' }).click();
  await layerRow('Mobile').click();
  await page.getByRole('group', { name: 'Export scale' }).getByRole('button', { name: '2×' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG', exact: true }).click()]);
  assert.equal(dl.suggestedFilename(), 'Mobile@2x.png');
  const px = await pngPixels(readFileSync(await dl.path()));
  assert.equal(px.w, 780); assert.equal(px.h, 1688);
  const d = await doc(); const r = d.nodes[comp.id];
  const at = px.at(Math.round((r.x + r.w / 2) * 2), Math.round((r.y + r.h / 2) * 2));
  assert.ok(at[0] > 240 && at[1] < 20 && at[2] < 20, 'red component pixel ' + at);
  assert.deepEqual(px.at(4, px.h - 4).slice(0, 3), [255, 255, 255], 'white frame background');
  await page.getByRole('group', { name: 'Export format' }).getByRole('button', { name: 'SVG' }).click();
  const [svg] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export SVG', exact: true }).click()]);
  const svgText = readFileSync(await svg.path(), 'utf8'); assert.match(svgText, /^<svg /); assert.ok(svgText.includes('Hello web') && svgText.includes('#ff0000'));
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export frame as HTML', exact: true }).click()]);
  assert.equal(html.suggestedFilename(), 'Mobile.html');
  const h = readFileSync(await html.path(), 'utf8');
  assert.ok(h.startsWith('<!doctype html>') && h.includes('Hello web') && h.includes('display: flex;') && h.includes('gap: 30px;') && h.includes('padding: 50px'));
  // the exported HTML renders the same layout: text sits 30px below the component
  const p2 = await browser.newPage(); await p2.setContent(h);
  const pos = await p2.evaluate(() => { const els = [...document.querySelectorAll('[data-name]')]; const t = els.find(e => e.textContent === 'Hello web'); const c = els[1]; return { c: c.getBoundingClientRect().bottom, t: t.getBoundingClientRect().top }; });
  assert.ok(Math.abs(pos.t - pos.c - 30) < 1, JSON.stringify(pos)); await p2.close();
});

await step('Inspect: CSS for the selected frame (auto layout → flexbox)', async () => {
  await page.getByRole('tab', { name: 'Inspect' }).click();
  const css = await page.getByLabel('Generated CSS').innerText();
  for (const s of ['display: flex;', 'flex-direction: column;', 'gap: 30px;', 'padding: 50px ', 'width: 390px;']) assert.ok(css.includes(s), s + '\n' + css);
  await page.getByRole('tab', { name: 'Design' }).click();
});

await step('duplicate, group / ungroup, delete with shortcuts', async () => {
  await layerRow('Mobile small').click();
  await page.keyboard.press('r');
  const a = await scr(small.x + 20, small.y + 20), b = await scr(small.x + 120, small.y + 80); await drag(a, b);
  const r1 = (await doc()).nodes[(await doc()).nodes[small.id].children[0]];
  await page.keyboard.press('Control+d'); await page.waitForTimeout(80);
  let d = await doc(); assert.equal(d.nodes[small.id].children.length, 2);
  const r2 = d.nodes[d.nodes[small.id].children[1]]; assert.equal(r2.x, r1.x + 10);
  await page.keyboard.press('Shift+Escape').catch(() => {});
  await page.locator(`.wbLayer[data-layer="${r1.id}"]`).click(); await page.keyboard.down('Shift'); await page.locator(`.wbLayer[data-layer="${r2.id}"]`).click(); await page.keyboard.up('Shift');
  await page.keyboard.press('Control+g'); await page.waitForTimeout(80);
  d = await doc(); const g = d.nodes[d.nodes[small.id].children[0]]; assert.equal(g.type, 'group'); assert.equal(g.children.length, 2);
  await page.keyboard.press('Control+Shift+g'); await page.waitForTimeout(80);
  d = await doc(); assert.ok(d.nodes[small.id].children.every(id => d.nodes[id].type === 'rect'));
  await page.keyboard.press('Delete'); await page.waitForTimeout(80);
  d = await doc(); assert.equal(d.nodes[small.id].children.length, 0);
});

await step('snapping while dragging aligns edges', async () => {
  await layerRow('Mobile small').click();
  await page.keyboard.press('r'); await drag(await scr(small.x + 20, small.y + 20), await scr(small.x + 120, small.y + 80));
  await page.keyboard.press('Escape');
  await page.keyboard.press('r'); await drag(await scr(small.x + 60, small.y + 200), await scr(small.x + 160, small.y + 260));
  let d = await doc(); const [r1, r2] = d.nodes[small.id].children.map(id => d.nodes[id]);
  // drag r2 so its left edge lands 3px right of r1's left edge: it must snap to x = 20
  const v = await view(); const from = await scr(small.x + r2.x + 50, small.y + r2.y + 30);
  await drag(from, [from[0] + (-37) * v.z, from[1]]);
  d = await doc(); assert.equal(d.nodes[r2.id].x, 20, 'snapped x = ' + d.nodes[r2.id].x + ' ' + JSON.stringify([r1.x, r1.w, r2.x, r2.w, v.z]));
});

await step('place an image, switch fill / fit / crop, export it', async () => {
  await layerRow('Mobile small').click();
  const c = createCanvas(200, 100); const x = c.getContext('2d'); x.fillStyle = '#00ff00'; x.fillRect(0, 0, 100, 100); x.fillStyle = '#0000ff'; x.fillRect(100, 0, 100, 100);
  await page.getByLabel('Image file', { exact: true }).setInputFiles({ name: 'swatch.png', mimeType: 'image/png', buffer: c.toBuffer('image/png') });
  await page.waitForFunction(() => Object.values(window.__doc.nodes).some(n => n.type === 'image'));
  let img = (await nodesOf('image'))[0]; assert.equal(img.parent, small.id); assert.equal(img.imgW, 200); assert.equal(img.name, 'swatch');
  await setNum('Width', 100); await setNum('Height', 100);
  await page.getByRole('group', { name: 'Image fit' }).getByRole('button', { name: 'Fit' }).click();
  await page.getByRole('group', { name: 'Export format' }).getByRole('button', { name: 'PNG' }).click();
  await page.getByRole('group', { name: 'Export scale' }).getByRole('button', { name: '1×' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PNG', exact: true }).click()]);
  const px = await pngPixels(readFileSync(await dl.path()));
  assert.equal(px.w, 100); assert.equal(px.at(50, 10)[3], 0, 'fit leaves transparent bars'); assert.ok(px.at(20, 50)[1] > 200 && px.at(80, 50)[2] > 200, 'green left, blue right');
  await page.getByRole('group', { name: 'Image fit' }).getByRole('button', { name: 'Crop' }).click();
  await page.getByLabel('Crop horizontal', { exact: true }).fill('100');
  img = (await nodesOf('image'))[0]; assert.equal(img.fit, 'crop'); assert.equal(img.crop.x, 1);
  const bgPos = await page.evaluate(id => document.querySelector(`.wbWorld [data-id="${id}"]`).style.backgroundPosition, img.id);
  assert.equal(bgPos, '-100px 0px');
});

await step('no page errors', async () => { assert.deepEqual(errors, []); });

await browser.close(); server.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
