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
