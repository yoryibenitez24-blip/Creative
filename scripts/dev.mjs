// Development server: rebuilds on save and reloads the browser.
// Bundles go to .dev/ (git-ignored) so the committed dist/app.js is never touched.
// index.html and style.css are served from dist/, where they live.
// Usage: npm run dev            (http://localhost:5173)
//        PORT=8080 npm run dev
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const out = join(root, '.dev'), dist = join(root, 'dist');
let port = +process.env.PORT || 5173;
let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}
const BUILD = `${commit} · ${new Date().toISOString().slice(0, 10)}`;
const clients = new Set();
const reload = () => { for (const res of clients) res.write('data: reload\n\n'); };

const notify = { name: 'notify', setup(b) { b.onEnd(r => { const t = new Date().toLocaleTimeString(); if (r.errors.length) console.log(`[${t}] build failed (${r.errors.length} error${r.errors.length > 1 ? 's' : ''}); the page keeps the last good build`); else { console.log(`[${t}] rebuilt`); reload(); } }); } };
const ctx = await esbuild.context({
  entryPoints: { app: join(root, 'src/main.jsx'), 'psd-worker': join(root, 'src/psd-worker.js'), 'ops-worker': join(root, 'src/engine/ops-worker.js') },
  bundle: true, outdir: out, sourcemap: true, loader: { '.jsx': 'jsx' }, define: { __ZERTAKE_BUILD__: JSON.stringify(BUILD) }, logLevel: 'error', plugins: [notify],
});
await ctx.watch();
// style.css and index.html are hand-edited in dist/: reload when they change
watch(dist, (_, f) => { if (f === 'style.css' || f === 'index.html') reload(); });

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.json': 'application/json' };
const snippet = '<script>new EventSource("/__reload").onmessage=()=>location.reload()</script>';
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  if (path === '__reload') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.write('\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
  const fromDev = /^(app|psd-worker|ops-worker)\.js(\.map)?$/.test(path);
  try {
    let body = await readFile(join(fromDev ? out : dist, path));
    if (path === 'index.html') body = body.toString().replace('</body>', snippet + '</body>');
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
// If the port is taken (often an older `npm run dev` still running from another folder), use the next free one
// and say so loudly, so the browser is not left showing the old app.
server.on('listening', () => console.log(`\n  Zertake Studio ${BUILD}\n  Open: http://localhost:${port}   (Ctrl+C to stop)\n`));
const listen = () => server.listen(port);
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && port < 5199) { console.warn(`Port ${port} is busy (another server, maybe an older Zertake, is still running there). Trying ${port + 1}…`); port++; listen(); }
  else { console.error(e.message); process.exit(1); }
});
listen();
