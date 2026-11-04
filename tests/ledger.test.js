import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildRows, toCsv, summary, STATUS, STATES } from '../ledger/source.mjs';
import { TOOLS } from '../src/editor/tools.js';

const rows = buildRows();
const byId = new Map(rows.map(r => [r.id, r]));

test('ledger: ids are unique and states valid', () => {
  assert.equal(byId.size, rows.length, 'duplicate ledger id');
  for (const r of rows) assert.ok(STATES.includes(r.state), r.id + ' has invalid state ' + r.state);
});

test('ledger: every status override points at an existing row', () => {
  for (const id of Object.keys(STATUS)) assert.ok(byId.has(id), 'STATUS references unknown row ' + id);
});

test('ledger: verified and implemented rows cite evidence; blocked rows explain why', () => {
  for (const r of rows) {
    if (['verified', 'implemented-unverified', 'partial'].includes(r.state)) assert.ok(r.evidence, r.id + ' lacks evidence');
    if (r.state === 'blocked') assert.ok(r.note || r.dependency, r.id + ' blocked without reason');
  }
});

test('ledger: committed CSV and summary are regenerated from source', () => {
  assert.equal(readFileSync(new URL('../docs/CAPABILITY_LEDGER.csv', import.meta.url), 'utf8'), toCsv(rows), 'run npm run ledger');
  assert.equal(readFileSync(new URL('../docs/LEDGER_SUMMARY.md', import.meta.url), 'utf8'), summary(rows), 'run npm run ledger');
});

test('ledger: every enabled tool relies only on implemented rows', () => {
  for (const t of TOOLS) for (const id of t.ledger) {
    assert.ok(byId.has(id), `${t.id} references unknown ledger row ${id}`);
    assert.ok(['verified', 'implemented-unverified'].includes(byId.get(id).state), `${t.id} is enabled but ${id} is ${byId.get(id).state}`);
  }
});

test('ledger: no obsolete external-editor text in shipped source or docs', () => {
  const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = [...walk(new URL('../src', import.meta.url).pathname), new URL('../README.md', import.meta.url).pathname];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.ok(!/full (PSD )?editor/i.test(s), f + ' mentions a "full editor"');
    assert.ok(!/photopea/i.test(s), f + ' mentions Photopea');
  }
});

import { INVENTORY_MAP, readInventory, reconciliation } from '../ledger/inventory.mjs';
test('ledger: every delivered inventory row maps to existing ledger rows', () => {
  const inv = readInventory();
  assert.equal(inv.length, 40);
  const keys = new Set();
  for (const r of inv) {
    const key = r['Area'] + '|' + r['Capacidad'];
    keys.add(key);
    const m = INVENTORY_MAP[key];
    assert.ok(m && m.ids.length, 'inventory row not mapped: ' + key);
    for (const id of m.ids) assert.ok(byId.has(id), `${key} maps to unknown ledger row ${id}`);
  }
  for (const key of Object.keys(INVENTORY_MAP)) assert.ok(keys.has(key), 'stale mapping ' + key);
  assert.equal(readFileSync(new URL('../docs/baseline/RECONCILIATION.md', import.meta.url), 'utf8'), reconciliation(), 'run npm run ledger');
});

import { isAiDependent, isDeferred, DECISIONS } from '../ledger/source.mjs';
test('ledger: AI-dependent rows are deferred, not implemented, and no enabled tool uses them', () => {
  const ai = rows.filter(isAiDependent);
  assert.ok(ai.length >= 20);
  for (const r of ai) assert.match(r.note, /D-001/, r.id);
  const used = new Set(TOOLS.flatMap(t => t.ledger));
  for (const r of ai) assert.ok(!used.has(r.id), r.id + ' is AI-dependent but used by an enabled tool');
});

test('ledger: rows deferred by a scope decision stay missing and unused by enabled tools', () => {
  const used = new Set(TOOLS.flatMap(t => t.ledger));
  for (const d of DECISIONS) assert.ok(rows.some(d.applies), d.id + ' applies to no rows');
  for (const r of rows.filter(isDeferred)) {
    assert.equal(r.state, 'missing', r.id);
    assert.ok(!used.has(r.id), r.id + ' is deferred but used by an enabled tool');
    for (const d of DECISIONS) if (d.applies(r)) assert.match(r.note, new RegExp(d.id), r.id);
  }
});
