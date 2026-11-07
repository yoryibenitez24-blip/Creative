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
const shotJ = name => page.screenshot({ path: join(evidence, 'stores-' + name + '.jpg'), type: 'jpeg', quality: 82 });
const results = [], step = async (name, fn) => { try { await fn(); results.push({ name, ok: true }); console.log('ok   ' + name); } catch (e) { results.push({ name, ok: false }); console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]); } };
const APP = 'div.app[style*="display: flex"]';

const base = 'http://127.0.0.1:' + server.address().port, path = () => new URL(page.url()).pathname;
await page.goto(base + '/');
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
  assert.equal(path(), '/photography'); assert.equal(await page.title(), 'Photography · Zertake');
  await page.getByRole('dialog', { name: 'Library and Develop' }).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Design' }).click();
  await page.waitForSelector(APP);
});
await step('the last section is remembered after a reload', async () => {
  await page.reload(); await page.waitForSelector(APP); assert.equal(await page.getByRole('main', { name: 'Zertake home' }).count(), 0);
  assert.equal(path(), '/design');
});
await step('custom size from Home', async () => {
  await page.locator(APP).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Home' }).click();
  await page.getByLabel('Custom width').fill('640'); await page.getByLabel('Custom height').fill('480'); await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(sel => document.querySelector(sel + ' .artboardLabel')?.textContent.includes('640 × 480'), APP);
});
await step('E-commerce: first visit → setup wizard → template → intro → admin at /commerce/<handle>; Customize opens the builder', async () => {
  await page.locator(APP).getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'E-commerce' }).click();
  await page.getByTestId('commerce-intro').waitFor({ timeout: 20000 }); // the entrance animation plays over the setup wizard too
  await page.getByTestId('commerce-intro').waitFor({ state: 'detached', timeout: 5000 });
  await page.getByLabel('Store name').waitFor({ timeout: 20000 });
  assert.equal(path(), '/commerce/new');
  await page.getByLabel('Store name').fill('Ironclad'); await page.waitForTimeout(500); await shotJ('setup-wizard');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Use template / }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); await shotJ('setup-templates');
  await page.getByRole('button', { name: 'Use template Static Noise' }).click();
  await page.waitForTimeout(400); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit commerce' }).waitFor({ timeout: 20000 });
  assert.equal(path(), '/commerce/ironclad');
  assert.equal(await page.title(), 'Home · Ironclad · Zertake');
  await page.waitForTimeout(800); await page.screenshot({ path: join(evidence, 'commerce-home.png') });
  await page.getByRole('button', { name: 'Online Store', exact: true }).first().click();
  assert.equal(path(), '/commerce/ironclad/themes');
  await page.getByRole('button', { name: 'Customize', exact: true }).first().click();
  await page.getByRole('button', { name: 'Exit store builder' }).waitFor({ timeout: 20000 });
  assert.equal(path(), '/commerce/ironclad/editor');
  await page.getByRole('button', { name: 'Exit store builder' }).click();
  await page.reload(); await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: 'Exit commerce' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Exit commerce' }).click(); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
  assert.equal(path(), '/');
});
await step('the entrance animation plays every time E-commerce is entered from another section (also via Back), not on in-app moves', async () => {
  const intro = page.getByTestId('commerce-intro');
  await page.getByRole('main', { name: 'Zertake home' }).getByRole('button', { name: 'Open E-commerce' }).click();
  await intro.waitFor({ timeout: 10000 }); await page.keyboard.press('Escape'); await intro.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Exit commerce' }).click(); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
  await page.goBack(); await intro.waitFor({ timeout: 10000 }); await page.keyboard.press('Escape'); await intro.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Online Store', exact: true }).first().click();
  await page.waitForTimeout(300); assert.equal(await intro.count(), 0, 'moving inside commerce does not replay it');
  await page.getByRole('button', { name: 'Exit commerce' }).click(); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
});
const commerceMain = page.getByRole('main', { name: 'Commerce content' });
await step('a deep link (/commerce/ironclad/orders) reloads to that page; Back and Forward move between pages', async () => {
  await page.goto(base + '/commerce/ironclad/orders'); await page.keyboard.press('Escape').catch(() => {});
  await commerceMain.getByRole('heading', { name: 'Orders', level: 1 }).waitFor({ timeout: 20000 });
  assert.equal(await page.title(), 'Orders · Ironclad · Zertake');
  await page.reload(); await page.keyboard.press('Escape').catch(() => {});
  await commerceMain.getByRole('heading', { name: 'Orders', level: 1 }).waitFor({ timeout: 20000 });
  await page.getByRole('navigation', { name: 'Commerce' }).getByRole('button', { name: 'Products', exact: true }).click();
  await commerceMain.getByRole('heading', { name: 'Products', level: 1 }).waitFor();
  assert.equal(path(), '/commerce/ironclad/products');
  await page.goBack(); await commerceMain.getByRole('heading', { name: 'Orders', level: 1 }).waitFor();
  assert.equal(path(), '/commerce/ironclad/orders');
  await page.goForward(); await commerceMain.getByRole('heading', { name: 'Products', level: 1 }).waitFor();
  await page.goto(base + '/commerce/ironclad/settings/shipping'); await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Shipping and delivery' }).and(page.locator('[aria-current="page"]')).waitFor({ timeout: 20000 });
});
await step('the Starter plan blocks a 2nd store; switching to Growth allows it and the switcher moves between stores', async () => {
  await page.getByRole('button', { name: /Switch store/ }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Switch store' }).getByRole('button', { name: 'New store' }).isDisabled(), true);
  assert.match(await page.locator('#zsLimitMsg').textContent(), /Starter plan: 1 of 1 store used/);
  await page.getByRole('dialog', { name: 'Switch store' }).getByRole('button', { name: 'All stores' }).click();
  await page.getByRole('main', { name: 'All stores' }).waitFor(); assert.equal(path(), '/commerce/stores');
  assert.equal(await page.getByRole('button', { name: 'New store' }).first().isDisabled(), true);
  await page.goto(base + '/commerce/new');
  await page.getByRole('heading', { name: 'You’ve reached your store limit' }).waitFor();
  await page.getByRole('button', { name: 'Upgrade plan' }).click(); await page.waitForTimeout(400); await shotJ('plan-limit');
  await page.getByRole('radio', { name: /Growth/ }).click();
  await page.getByLabel('Store name').fill('Dew Ritual');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Use template Dew Ritual' }).click();
  await page.waitForTimeout(400); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit commerce' }).waitFor({ timeout: 20000 });
  assert.equal(path(), '/commerce/dew-ritual');
  await page.waitForTimeout(1300); // let the entrance animation settle before the screenshot
  await page.getByRole('button', { name: /Switch store/ }).click();
  const menu = page.getByRole('dialog', { name: 'Switch store' });
  assert.equal(await menu.getByRole('listitem').count(), 2); await page.waitForTimeout(300); await shotJ('switcher');
  await menu.getByRole('button', { name: 'All stores' }).click(); await page.getByRole('main', { name: 'All stores' }).waitFor(); await page.waitForTimeout(500); await shotJ('all-stores');
  await page.getByRole('button', { name: 'Back to Dew Ritual' }).click(); await page.getByRole('button', { name: /Switch store/ }).click();
  await menu.getByRole('button', { name: /^Ironclad/ }).click();
  await page.waitForFunction(() => location.pathname === '/commerce/ironclad');
  assert.match(await page.locator('.caBrand').textContent(), /Ironclad/);
  await page.goBack(); await page.waitForFunction(() => location.pathname === '/commerce/dew-ritual');
  await page.getByRole('button', { name: 'Exit commerce' }).click(); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
  // old hash links are aliases: /#ecom opens the active (last opened) store, /#design the editor
  await page.goto(base + '/#ecom'); await page.waitForFunction(() => location.pathname === '/commerce/dew-ritual' && !location.hash);
  await page.goto(base + '/#home'); await page.getByRole('main', { name: 'Zertake home' }).waitFor(); assert.equal(path(), '/');
});
await step('All stores: rename changes the handle; delete asks for confirmation and removes the store', async () => {
  await page.goto(base + '/commerce/stores'); await page.getByRole('main', { name: 'All stores' }).waitFor();
  await page.getByRole('button', { name: 'Rename Ironclad' }).click();
  await page.getByLabel('New store name').fill('Iron Works'); await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('/commerce/iron-works').waitFor();
  await page.getByRole('button', { name: 'Delete Dew Ritual' }).click();
  await page.getByRole('dialog', { name: 'Delete Dew Ritual?' }).getByRole('button', { name: 'Delete store' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.zsStoreCard:not(.zsAdd)').length === 1);
  await page.getByRole('button', { name: 'Back to Iron Works' }).click();
  await page.waitForFunction(() => location.pathname === '/commerce/iron-works');
  await page.waitForTimeout(700); // the workspace is saved 250 ms after the last change
  await page.goto(base + '/commerce/dew-ritual'); await page.getByRole('heading', { name: 'No store at /dew-ritual' }).waitFor();
  await page.goto(base + '/'); await page.getByRole('main', { name: 'Zertake home' }).waitFor();
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
