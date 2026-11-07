// Shareable template previews: <app>/?template=<id>[#page.html] opens a full, clickable demo of a store template
// (every page, cart, product pages) in its own tab, without opening the app. Used by the template gallery's
// "Preview" and "Copy link" buttons.
import { STORE_TEMPLATES, createStore } from './templates.js';
import { previewShellHtml } from './exporter.js';
import { genUrl } from './images.js';

export function templatePreviewUrl(id, loc = typeof location !== 'undefined' ? location : null) {
  // strip an app route (/commerce/<store>/…, /design, …) so the link points at the app's root page
  const base = loc ? loc.origin + String(loc.pathname || '/').replace(/\/(commerce|design|photography|web)(\/.*)?$/, '/') : '/';
  return base + '?template=' + encodeURIComponent(id);
}

/** Template id requested by the current URL, or null. */
export function requestedTemplate(search = typeof location !== 'undefined' ? location.search : '') {
  try { return new URLSearchParams(search).get('template'); } catch { return null; }
}

/** If the URL asks for a template preview, replace the document with it and return true. */
export function bootTemplatePreview() {
  const id = requestedTemplate(); if (!id) return false;
  const t = STORE_TEMPLATES.find(x => x.id === id);
  const html = t ? previewShellHtml(createStore(id), genUrl)
    : `<!doctype html><meta charset="utf-8"><title>Template not found</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p>There is no store template called “${String(id).replace(/[<>&"]/g, '')}”. <a style="color:#ffb36b" href="/">Open Zertake</a></p>`;
  document.open(); document.write(html); document.close();
  return true;
}
