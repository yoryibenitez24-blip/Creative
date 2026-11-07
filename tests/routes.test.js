// Unit tests for URL routing (src/routes.js), plans (src/store/admin/plans.js) and multi-store data (src/store/admin/stores.js).
// Run: node --test tests/routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation, formatRoute, slugify, uniqueHandle, routeTitle, adminRoute, commercePagePath } from '../src/routes.js';
import { PLANS, canCreateStore, storeLimit, planFor, planForCount } from '../src/store/admin/plans.js';
import { migrateStores, storeEntry, renameStore, removeStore, findStore } from '../src/store/admin/stores.js';

test('tool paths parse and format both ways', () => {
  for (const [path, section] of [['/', 'home'], ['/photography', 'photo'], ['/design', 'design'], ['/web', 'web']]) {
    assert.deepEqual(parseLocation(path), { section });
    assert.equal(formatRoute({ section }), path);
  }
  assert.deepEqual(parseLocation('/commerce'), { section: 'ecom', commerce: { view: 'auto' } });
  assert.equal(formatRoute({ section: 'ecom' }), '/commerce');
  assert.deepEqual(parseLocation('/nope/deeper'), { section: 'home' });
  assert.deepEqual(parseLocation('/design/'), { section: 'design' });
});

test('legacy hashes are aliases on the root path only', () => {
  assert.deepEqual(parseLocation('/', '#design'), { section: 'design' });
  assert.deepEqual(parseLocation('/', '#photo'), { section: 'photo' });
  assert.deepEqual(parseLocation('/', '#web'), { section: 'web' });
  assert.deepEqual(parseLocation('/', '#home'), { section: 'home' });
  assert.deepEqual(parseLocation('/', '#ecom'), { section: 'ecom', commerce: { view: 'auto' } });
  assert.deepEqual(parseLocation('/', '#unknown'), { section: 'home' });
  assert.deepEqual(parseLocation('/web', '#design'), { section: 'web' });
});

test('commerce paths round-trip', () => {
  const cases = [
    ['/commerce/new', { view: 'new' }],
    ['/commerce/stores', { view: 'stores' }],
    ['/commerce/ironclad', { view: 'store', handle: 'ironclad', page: 'home' }],
    ['/commerce/ironclad/orders', { view: 'store', handle: 'ironclad', page: 'orders' }],
    ['/commerce/ironclad/orders/o_123', { view: 'store', handle: 'ironclad', page: 'order', id: 'o_123' }],
    ['/commerce/ironclad/orders/new', { view: 'store', handle: 'ironclad', page: 'order-new' }],
    ['/commerce/ironclad/orders/new/d_9', { view: 'store', handle: 'ironclad', page: 'order-new', id: 'd_9' }],
    ['/commerce/ironclad/products/p_1', { view: 'store', handle: 'ironclad', page: 'product', id: 'p_1' }],
    ['/commerce/ironclad/products/new', { view: 'store', handle: 'ironclad', page: 'product', id: 'new' }],
    ['/commerce/ironclad/inventory', { view: 'store', handle: 'ironclad', page: 'inventory' }],
    ['/commerce/ironclad/collections/c_1', { view: 'store', handle: 'ironclad', page: 'collection', id: 'c_1' }],
    ['/commerce/ironclad/customers/u_1', { view: 'store', handle: 'ironclad', page: 'customer', id: 'u_1' }],
    ['/commerce/ironclad/discounts', { view: 'store', handle: 'ironclad', page: 'discounts' }],
    ['/commerce/ironclad/settings', { view: 'store', handle: 'ironclad', page: 'settings', tab: 'general' }],
    ['/commerce/ironclad/settings/shipping', { view: 'store', handle: 'ironclad', page: 'settings', tab: 'shipping' }],
    ['/commerce/ironclad/editor', { view: 'store', handle: 'ironclad', page: 'editor' }],
    ['/commerce/ironclad/themes', { view: 'store', handle: 'ironclad', page: 'themes' }],
  ];
  for (const [path, commerce] of cases) {
    assert.deepEqual(parseLocation(path), { section: 'ecom', commerce }, path);
    assert.equal(formatRoute({ section: 'ecom', commerce }), path, path);
  }
  assert.deepEqual(parseLocation('/commerce/ironclad/bogus'), { section: 'ecom', commerce: { view: 'store', handle: 'ironclad', page: 'home' } });
  assert.equal(formatRoute({ section: 'ecom', commerce: { view: 'store', handle: 'my shop', page: 'orders' } }), '/commerce/my%20shop/orders');
  assert.equal(parseLocation('/commerce/my%20shop').commerce.handle, 'my shop');
});

test('admin route helpers', () => {
  assert.deepEqual(adminRoute({ view: 'store', handle: 'x', page: 'settings' }), { page: 'settings', tab: 'general' });
  assert.deepEqual(adminRoute({ view: 'store', handle: 'x', page: 'order', id: 'o1' }), { page: 'order', id: 'o1' });
  assert.equal(commercePagePath({ page: 'home' }), '');
  assert.equal(commercePagePath({ page: 'settings', tab: 'taxes' }), '/settings/taxes');
});

test('handles: slugify and uniqueness', () => {
  assert.equal(slugify('Ironclad'), 'ironclad');
  assert.equal(slugify('  Café & Crème!! '), 'cafe-and-creme');
  assert.equal(slugify('***'), 'store');
  assert.equal(uniqueHandle('Ironclad', ['ironclad']), 'ironclad-2');
  assert.equal(uniqueHandle('Ironclad', new Set(['ironclad', 'ironclad-2'])), 'ironclad-3');
  assert.equal(uniqueHandle('New'), 'new-store');
  assert.equal(uniqueHandle('Stores'), 'stores-store');
});

test('page titles', () => {
  assert.equal(routeTitle({ section: 'home' }), 'Zertake Studio');
  assert.equal(routeTitle({ section: 'design' }), 'Design · Zertake');
  assert.equal(routeTitle(parseLocation('/commerce/ironclad/orders'), 'Ironclad'), 'Orders · Ironclad · Zertake');
  assert.equal(routeTitle(parseLocation('/commerce/ironclad'), 'Ironclad'), 'Home · Ironclad · Zertake');
  assert.equal(routeTitle(parseLocation('/commerce/ironclad/products/new'), 'Ironclad'), 'New product · Ironclad · Zertake');
  assert.equal(routeTitle(parseLocation('/commerce/new')), 'New store · Commerce · Zertake');
});

test('plans limit how many stores can be created', () => {
  assert.deepEqual(PLANS.map(p => [p.id, p.stores]), [['starter', 1], ['growth', 3], ['pro', 10]]);
  assert.equal(canCreateStore('starter', 0), true);
  assert.equal(canCreateStore('starter', 1), false);
  assert.equal(canCreateStore('growth', 2), true);
  assert.equal(canCreateStore('growth', 3), false);
  assert.equal(canCreateStore('pro', 9), true);
  assert.equal(canCreateStore('pro', 10), false);
  assert.equal(canCreateStore('bogus', 0), true, 'unknown plan behaves like Starter');
  assert.equal(canCreateStore('bogus', 1), false);
  assert.equal(storeLimit('growth'), 3);
  assert.equal(planFor('nope').id, 'starter');
  assert.equal(planForCount(2).id, 'growth');
  assert.equal(planForCount(11), null);
});

test('legacy single store migrates into the stores list without losing data', () => {
  const storeDoc = { kind: 'store', id: 'store_1', name: 'Ironclad', products: [{ id: 'p1' }] }, commerceDoc = { kind: 'commerce', orders: [{ id: 'o1' }] };
  const saved = { documents: [{ id: 'd1' }], activeId: 'd1', storeDoc, commerceDoc, webDoc: { x: 1 } };
  const m = migrateStores(saved);
  assert.equal(m.stores.length, 1);
  assert.equal(m.stores[0].store, storeDoc);
  assert.equal(m.stores[0].commerce, commerceDoc);
  assert.equal(m.stores[0].handle, 'ironclad');
  assert.equal(m.activeStoreId, m.stores[0].id);
  assert.equal(m.plan, 'starter');
  assert.ok(!('storeDoc' in m) && !('commerceDoc' in m));
  assert.deepEqual(m.webDoc, { x: 1 });
  assert.deepEqual(m.documents, saved.documents);
  // idempotent
  assert.equal(migrateStores(m), m);
  // empty workspace
  const e = migrateStores({ documents: [] });
  assert.deepEqual([e.stores, e.activeStoreId, e.plan], [[], null, 'starter']);
  // duplicate/reserved handles are repaired
  const r = migrateStores({ stores: [{ id: 'a', handle: 'x', store: { name: 'X' } }, { id: 'b', handle: 'x', store: { name: 'X' } }, { id: 'c', handle: 'new', store: { name: 'New' } }], activeStoreId: 'b', plan: 'pro' });
  assert.deepEqual(r.stores.map(s => s.handle), ['x', 'x-2', 'new-store']);
  assert.equal(r.activeStoreId, 'b'); assert.equal(r.plan, 'pro');
});

test('store entries: create, find, rename, remove', () => {
  const a = storeEntry({ name: 'Ironclad' }, { stores: [] });
  const b = storeEntry({ name: 'Ironclad' }, { stores: [a] });
  assert.equal(a.handle, 'ironclad'); assert.equal(b.handle, 'ironclad-2'); assert.notEqual(a.id, b.id);
  let s = { stores: [a, b], activeStoreId: b.id, plan: 'growth' };
  assert.equal(findStore(s.stores, 'ironclad-2'), b);
  assert.equal(findStore(s.stores, a.id), a);
  s = renameStore(s, b.id, 'Static Noise');
  assert.equal(s.stores[1].handle, 'static-noise'); assert.equal(s.stores[1].store.name, 'Static Noise');
  assert.equal(renameStore(s, b.id, '   '), s);
  s = removeStore(s, b.id);
  assert.deepEqual(s.stores.map(e => e.id), [a.id]); assert.equal(s.activeStoreId, a.id);
  s = removeStore(s, a.id); assert.equal(s.activeStoreId, null);
});
