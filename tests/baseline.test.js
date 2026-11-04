// Verifies the imported snapshot commit against the delivered MANIFEST_SHA256.txt.
// 5a309f5 holds the tracked files of source commit e2360711 without .git, flattened on upload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SNAPSHOT = '5a309f5';
const UPLOAD_PATH = { // manifest path -> path in the snapshot commit
  'source/.gitignore': 'download', 'source/.openai/hosting.json': 'hosting.json', 'source/README.md': 'README.md',
  'source/dist/app.js': 'app.js', 'source/dist/index.html': 'index.html', 'source/dist/psd-worker.js': 'psd-worker.js', 'source/dist/style.css': 'style.css',
  'source/package-lock.json': 'package-lock.json', 'source/package.json': 'package.json',
  'source/src/FilterGallery.jsx': 'FilterGallery.jsx', 'source/src/Recovery.jsx': 'Recovery.jsx', 'source/src/main.jsx': 'main.jsx', 'source/src/model.js': 'model.js', 'source/src/model.test.js': 'model.test.js',
  'source/src/psd-worker.js': 'psd-worker (1).js', 'source/src/psd.js': 'psd.js', 'source/src/worker-import.js': 'worker-import.js', 'source/src/workspace.js': 'workspace.js', 'source/tests/import.test.js': 'import.test.js',
};
const DELIVERY_DOCS = { 'DOCUMENTACION_VERSION.txt': 'docs/baseline/DOCUMENTACION_VERSION.txt', 'INVENTARIO_BRECHAS.csv': 'docs/baseline/INVENTARIO_BRECHAS.csv', 'LEEME_PRIMERO.txt': 'docs/baseline/LEEME_PRIMERO.txt' };
const NOT_SUPPLIED = ['PROMPT_DESARROLLO_COMPLETO.txt']; // given as the conversation prompt, not as a file

const manifest = readFileSync(new URL('../docs/baseline/MANIFEST_SHA256.txt', import.meta.url), 'utf8').trim().split('\n').map(l => l.split(/\s+/)).map(([h, p]) => ({ h, p }));
const sha = b => createHash('sha256').update(b).digest('hex');
let haveHistory = true;
try { execFileSync('git', ['cat-file', '-e', SNAPSHOT + '^{commit}'], { stdio: 'ignore' }); } catch { haveHistory = false; }

test('baseline: every manifest entry is accounted for', () => {
  for (const { p } of manifest) assert.ok(UPLOAD_PATH[p] || DELIVERY_DOCS[p] || NOT_SUPPLIED.includes(p), 'unmapped manifest entry ' + p);
  assert.equal(manifest.length, Object.keys(UPLOAD_PATH).length + Object.keys(DELIVERY_DOCS).length + NOT_SUPPLIED.length);
});

test('baseline: snapshot commit files match MANIFEST_SHA256 byte for byte', { skip: !haveHistory && 'shallow clone without ' + SNAPSHOT }, () => {
  const tracked = execFileSync('git', ['ls-tree', '--name-only', SNAPSHOT], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual([...tracked].sort(), Object.values(UPLOAD_PATH).sort(), 'snapshot has exactly the manifest source files');
  for (const { h, p } of manifest) if (UPLOAD_PATH[p]) assert.equal(sha(execFileSync('git', ['show', `${SNAPSHOT}:${UPLOAD_PATH[p]}`], { maxBuffer: 64 << 20 })), h, p);
});

test('baseline: delivered documents match MANIFEST_SHA256', () => {
  for (const { h, p } of manifest) if (DELIVERY_DOCS[p]) assert.equal(sha(readFileSync(new URL('../' + DELIVERY_DOCS[p], import.meta.url))), h, p);
});

test('baseline: hosting manifest kept unmodified at its original path', () => {
  const { h } = manifest.find(m => m.p === 'source/.openai/hosting.json');
  assert.equal(sha(readFileSync(new URL('../.openai/hosting.json', import.meta.url))), h);
});
