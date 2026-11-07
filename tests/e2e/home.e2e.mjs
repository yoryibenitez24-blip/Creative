// Browser acceptance tests: home screen, section switcher, design templates, Photography section.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const evidence = join(fileURLToPath(new URL('.', import.meta.url)), '../../docs/evidence'); mkdirSync(evidence, { recursive: true });
const server = await serve(0), browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const results = [], step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };
const APP = 'div.app[style*="display: flex"]';

await page.goto('http://127.0.0.1:' + server.address().port + '/');
await step('the home screen offers the four sections', async () => {
  const home = page.getByRole('main', { name: 'Zertake home' }); await home.waitFor();
  for (const n of ['Photography', 'Design', 'Web & UI', 'E-commerce']) assert.equal(await home.getByRole('button', { name: 'Open ' + n }).count(), 1, n);
  await page.screenshot({ path: join(evidence, 'home.png') });
});
await step('a design template opens the editor at that size, with the section bar', async () => {
  await page.getByRole('button', { name: /^New Instagram Post design/ }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('1080 × 1080'), APP);
  assert.equal(await page.locator(APP).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Design' }).getAttribute('aria-pressed'), 'true');
});
await step('the Photography section opens Library · Develop and returns to Design', async () => {
  await page.locator(APP).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Photography' }).click();
  await page.getByRole('dialog', { name: 'Library and Develop' }).waitFor();
  await page.getByRole('dialog', { name: 'Library and Develop' }).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Design' }).click();
  await page.waitForSelector(APP);
});
await step('the last section is remembered after a reload', async () => {
  await page.reload(); await page.waitForSelector(APP); assert.equal(await page.getByRole('main', { name: 'Zertake home' }).count(), 0);
});
await step('custom size from Home', async () => {
  await page.locator(APP).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home' }).click();
  await page.getByLabel('Custom width').fill('640'); await page.getByLabel('Custom height').fill('480'); await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('640 × 480'), APP);
});
await step('E-commerce: template gallery → intro animation → Shopify-like admin; Customize opens the builder', async () => {
  await page.locator(APP).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'E-commerce' }).click();
  await page.getByRole('button', { name: /^Use template / }).first().waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Use template Static Noise' }).click();
  await page.waitForTimeout(400); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit commerce' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); await page.screenshot({ path: join(evidence, 'commerce-home.png') });
  await page.getByRole('button', { name: 'Online Store', exact: true }).first().click();
  await page.getByRole('button', { name: 'Customize', exact: true }).first().click();
  await page.getByRole('button', { name: 'Exit store builder' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Exit store builder' }).click();
  await page.reload(); await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: 'Exit commerce' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Exit commerce' }).click(); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
});
await step('the Web & UI section opens the interface designer; it persists across a reload', async () => {
  await page.getByRole('main', { name: 'Zertake home' }).getByRole('button', { name: 'Open Web & UI' }).click();
  await page.getByRole('button', { name: 'Exit Web workspace' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(evidence, 'web-ui.png') });
  await page.reload(); await page.getByRole('button', { name: 'Exit Web workspace' }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Exit Web workspace' }).click(); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
});
await step('a web template (Landing page) opens in Web & UI', async () => {
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'New web design: Landing page' }).click();
  await page.getByRole('button', { name: 'Exit Web workspace' }).waitFor();
  await page.waitForTimeout(500); await page.screenshot({ path: join(evidence, 'web-landing.png') });
  await page.getByRole('button', { name: 'Exit Web workspace' }).click();
});
await step('no uncaught page errors', async () => assert.deepEqual(errors, []));
await browser.close(); server.close();
const failed = results.filter(r => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
