// Preview agent: injected into the builder's live preview (never into exported pages).
//
// editorAgent(win, doc) is serialised with Function.prototype.toString(), so it must stay self-contained.
// It talks to the builder with postMessage:
//   → host: { storeReady } { storeSelect: sid } { storeEdit: { sid, key, value } } { storeMove: { sid, before } }
//           { storeMoveBlock: { sid, list, from, to } } { storeAction: { sid, action } } { storeKey: 'undo'|'redo' }
//           { storeFrame: { sid, key, x, y } } (alignment picked on the floating 3×3 grid over a framed image, key = its data-fr)
//   ← host: { storeMode: 'edit'|'interact', storeHighlight: sid, scroll } { storeLabels: { type: label } }
//           { storePatch: { css, title, bodyClass, bodyStyle, ann, header, footer, overlays, data, sections: { id: html }, order: [ids],
//                           frames: { id: { n, set: [[index, attrs]] } } } }   frames: image-only changes, applied to the existing <img>s
// Patches replace only the changed parts (between <!--zp:key--> comment markers), so the document, scroll position,
// focus and running carousels survive every edit.

export function editorAgent(win, doc) {
  var mode = 'edit', selected = null, labels = {}, editing = null, drag = null, hoverSec = null, hoverBlock = null, deferred = {}, hoverImg = null;
  var PRESETS = [[0, 0, 'Top left'], [50, 0, 'Top'], [100, 0, 'Top right'], [0, 50, 'Left'], [50, 50, 'Center'], [100, 50, 'Right'], [0, 100, 'Bottom left'], [50, 100, 'Bottom'], [100, 100, 'Bottom right']];
  var post = function (m) { win.parent.postMessage(m, '*'); };
  doc.documentElement.classList.add('editing');
  var css = doc.createElement('style');
  css.textContent = '[data-sid]{position:relative}' +
    '.zed-ui{position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;font:500 12px/1.2 system-ui,-apple-system,Segoe UI,sans-serif}' +
    '.zed-box{position:absolute;pointer-events:none;border:1.5px dashed rgba(59,130,246,.85);border-radius:2px;display:none}' +
    '.zed-box.sel{border:2px solid #3b82f6}.zed-box.blk{border:1.5px solid rgba(236,72,153,.9)}' +
    '.zed-tag{position:absolute;pointer-events:auto;display:none;align-items:center;gap:2px;background:#3b82f6;color:#fff;border-radius:6px;padding:2px;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
    '.zed-tag span{padding:3px 8px 3px 6px;white-space:nowrap}.zed-tag button{all:unset;cursor:pointer;width:24px;height:22px;display:grid;place-items:center;border-radius:4px;font-size:13px}' +
    '.zed-tag button:hover{background:rgba(255,255,255,.22)}.zed-tag button.grab{cursor:grab}' +
    '.zed-bh{all:unset;position:absolute;pointer-events:auto;display:none;cursor:grab;background:#ec4899;color:#fff;width:22px;height:22px;border-radius:6px;place-items:center;font-size:13px;box-shadow:0 3px 10px rgba(0,0,0,.25)}' +
    '.zed-line{position:absolute;pointer-events:none;background:#3b82f6;display:none;border-radius:3px;box-shadow:0 0 0 3px rgba(59,130,246,.25)}' +
    '.zed-dragging{opacity:.35!important}[data-edit]:hover{outline:1px dashed rgba(59,130,246,.6);outline-offset:3px;cursor:text}' +
    '[contenteditable]{outline:2px solid #3b82f6!important;outline-offset:4px;cursor:text;-webkit-user-modify:read-write-plaintext-only}' +
    'html.editing [data-reveal]{opacity:1!important;transform:none!important}' +
    '.zed-fr{position:absolute;pointer-events:auto;display:none;align-items:center;gap:8px;padding:6px 8px 6px 10px;background:rgba(17,17,20,.92);color:#fff;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);backdrop-filter:blur(6px)}' +
    '.zed-fr span{font-size:11px;opacity:.75;white-space:nowrap}.zed-fr .g{display:grid;grid-template-columns:repeat(3,16px);grid-auto-rows:16px;gap:2px;padding:3px;border-radius:6px;background:rgba(255,255,255,.08)}' +
    '.zed-fr button{all:unset;cursor:pointer;display:grid;place-items:center;border-radius:4px}.zed-fr button:hover{background:rgba(255,255,255,.18)}' +
    '.zed-fr button i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.55)}.zed-fr button.on i{width:8px;height:8px;background:#3b82f6;box-shadow:0 0 0 2px rgba(59,130,246,.35)}' +
    '.zed-box.img{border:1.5px solid rgba(250,204,21,.95);border-radius:2px}';
  doc.head.appendChild(css);

  var ui = doc.createElement('div'); ui.className = 'zed-ui'; ui.setAttribute('aria-hidden', 'true');
  ui.innerHTML = '<div class="zed-box hov"></div><div class="zed-box sel"></div><div class="zed-box blk"></div><div class="zed-line"></div>' +
    '<div class="zed-tag"><button type="button" class="grab" data-zact="drag" title="Drag to move">⠿</button><span></span>' +
    '<button type="button" data-zact="up" title="Move up">↑</button><button type="button" data-zact="down" title="Move down">↓</button>' +
    '<button type="button" data-zact="duplicate" title="Duplicate">⧉</button><button type="button" data-zact="hide" title="Hide">◌</button><button type="button" data-zact="delete" title="Delete">✕</button></div>' +
    '<button type="button" class="zed-bh" data-zact="block" title="Drag to reorder">⠿</button>' +
    '<div class="zed-box img"></div><div class="zed-fr" role="group" aria-label="Image position"><span>Image position</span><div class="g">' +
    PRESETS.map(function (p) { return '<button type="button" data-zfr="' + p[0] + ',' + p[1] + '" title="Align ' + p[2].toLowerCase() + '" aria-label="Align image ' + p[2].toLowerCase() + '"><i></i></button>'; }).join('') + '</div></div>';
  doc.documentElement.appendChild(ui);
  var q = function (s) { return ui.querySelector(s); };
  var hovBox = q('.zed-box.hov'), selBox = q('.zed-box.sel'), blkBox = q('.zed-box.blk'), line = q('.zed-line'), tag = q('.zed-tag'), bh = q('.zed-bh'), imgBox = q('.zed-box.img'), frBar = q('.zed-fr');

  function rect(el) { var r = el.getBoundingClientRect(); return { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height, r: r }; }
  function place(box, el) { if (!el || !el.isConnected) { box.style.display = 'none'; return; } var r = rect(el); box.style.cssText = 'display:block;left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px'; }
  function secOf(t) { return t && t.closest ? t.closest('[data-sid]') : null; }
  function isContent(s) { return s && s.parentElement && s.parentElement.id === 'main'; }
  function bySid(id) { return id ? doc.querySelector('[data-sid="' + id + '"]') : null; }
  function refresh() {
    place(selBox, mode === 'edit' ? bySid(selected) : null);
    place(hovBox, mode === 'edit' && hoverSec && hoverSec.getAttribute('data-sid') !== selected ? hoverSec : null);
    var s = mode === 'edit' ? (hoverSec || bySid(selected)) : null;
    if (s && s.isConnected && !drag) {
      var r = rect(s), content = isContent(s);
      tag.style.display = 'flex'; tag.style.left = Math.max(4, r.x + 8) + 'px'; tag.style.top = Math.max(win.scrollY + 4, r.y + 8) + 'px';
      tag.querySelector('span').textContent = labels[s.getAttribute('data-type')] || s.getAttribute('data-type') || 'Section';
      [].forEach.call(tag.querySelectorAll('button'), function (b) { b.style.display = content ? '' : 'none'; });
      tag.setAttribute('data-for', s.getAttribute('data-sid'));
    } else if (!drag) tag.style.display = 'none';
    if (mode === 'edit' && hoverBlock && hoverBlock.isConnected && !drag) {
      place(blkBox, hoverBlock); var b = rect(hoverBlock);
      bh.style.display = 'grid'; bh.style.left = (b.x + 6) + 'px'; bh.style.top = (b.y + 6) + 'px';
    } else if (!drag) { blkBox.style.display = 'none'; bh.style.display = 'none'; }
    placeFrameBar();
  }
  // ---------- floating alignment grid over a framed image of the selected section ----------
  function framePos(img) {
    var m = /(-?[\d.]+)%\s+(-?[\d.]+)%/.exec(img.style.objectPosition || '');
    return m ? [+m[1], +m[2]] : [50, 50];
  }
  function placeFrameBar() {
    var img = hoverImg;
    if (mode !== 'edit' || drag || editing || !img || !img.isConnected || !secOf(img) || secOf(img).getAttribute('data-sid') !== selected) { frBar.style.display = 'none'; imgBox.style.display = 'none'; return; }
    var r = img.getBoundingClientRect(), s = secOf(img).getBoundingClientRect();
    var L = Math.max(r.left, s.left, 0), T = Math.max(r.top, s.top, 0), R = Math.min(r.right, s.right, win.innerWidth), B = Math.min(r.bottom, s.bottom, win.innerHeight);
    if (R - L < 24 || B - T < 24) { frBar.style.display = 'none'; imgBox.style.display = 'none'; return; }
    imgBox.style.cssText = 'display:block;left:' + (L + win.scrollX) + 'px;top:' + (T + win.scrollY) + 'px;width:' + (R - L) + 'px;height:' + (B - T) + 'px';
    frBar.style.display = 'flex';
    var w = frBar.offsetWidth, h = frBar.offsetHeight;
    frBar.style.left = (Math.max(L + 6, R - w - 10) + win.scrollX) + 'px'; frBar.style.top = (Math.max(T + 6, B - h - 10) + win.scrollY) + 'px';
    var pos = framePos(img);
    [].forEach.call(frBar.querySelectorAll('button[data-zfr]'), function (b) { var v = b.getAttribute('data-zfr').split(','); var on = +v[0] === pos[0] && +v[1] === pos[1]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  function framedAt(x, y) {
    if (!selected || !doc.elementsFromPoint) return null;
    var list = doc.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) { var el = list[i]; if (el.tagName === 'IMG' && el.hasAttribute('data-fr')) { var s = secOf(el); return s && s.getAttribute('data-sid') === selected ? el : null; } }
    return null;
  }
  frBar.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-zfr]'); if (!b || !hoverImg) return;
    var v = b.getAttribute('data-zfr').split(','), s = secOf(hoverImg);
    post({ storeFrame: { sid: s.getAttribute('data-sid'), key: hoverImg.getAttribute('data-fr'), x: +v[0], y: +v[1] } });
  });
  var raf = 0; function soon() { if (!raf) raf = win.requestAnimationFrame(function () { raf = 0; refresh(); }); }
  win.addEventListener('scroll', soon, { passive: true }); win.addEventListener('resize', soon);

  // ---------- hover / select ----------
  doc.addEventListener('mousemove', function (e) {
    if (mode !== 'edit' || drag) return;
    if (ui.contains(e.target)) return;
    var s = secOf(e.target), b = e.target.closest ? e.target.closest('[data-block]') : null;
    if (s !== hoverSec || b !== hoverBlock) { hoverSec = s; hoverBlock = b && s && s.contains(b) ? b : null; soon(); }
    var im = framedAt(e.clientX, e.clientY);
    if (im !== hoverImg) { hoverImg = im; soon(); }
  });
  doc.addEventListener('mouseleave', function () { if (!drag) { hoverSec = null; hoverBlock = null; hoverImg = null; soon(); } });
  win.addEventListener('click', function (e) {
    if (mode !== 'edit') return;
    if (ui.contains(e.target)) return; // toolbar buttons handle their own clicks
    if (editing && editing.el.contains(e.target)) { e.stopPropagation(); return; }
    var s = secOf(e.target);
    e.preventDefault(); e.stopPropagation();
    var ed = e.target.closest && e.target.closest('[data-edit]');
    if (ed && s && s.getAttribute('data-sid') === selected && e.detail === 1) { startEdit(ed); return; }
    if (s) { selected = s.getAttribute('data-sid'); soon(); post({ storeSelect: selected }); }
  }, true);
  win.addEventListener('dblclick', function (e) {
    if (mode !== 'edit') return;
    var ed = e.target.closest && e.target.closest('[data-edit]');
    if (ed) { e.preventDefault(); e.stopPropagation(); startEdit(ed); }
  }, true);
  win.addEventListener('submit', function (e) { if (mode === 'edit') { e.preventDefault(); e.stopPropagation(); } }, true);

  // ---------- inline text editing ----------
  function startEdit(el) {
    if (editing && editing.el === el) return;
    if (editing) finish(true);
    var s = secOf(el); if (!s) return;
    editing = { el: el, sid: s.getAttribute('data-sid'), key: el.getAttribute('data-edit'), html: el.innerHTML, text: el.innerText.trim() };
    try { el.setAttribute('contenteditable', 'plaintext-only'); if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true'); } catch (err) { el.setAttribute('contenteditable', 'true'); }
    el.focus();
    var range = doc.createRange(); range.selectNodeContents(el); var sel = win.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  function finish(commit) {
    if (!editing) return;
    var ed = editing; editing = null;
    var value = ed.el.innerText.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    ed.el.removeAttribute('contenteditable');
    if (!commit || value === ed.text) ed.el.innerHTML = ed.html;
    else post({ storeEdit: { sid: ed.sid, key: ed.key, value: value } });
    var later = deferred; deferred = {};
    if (Object.keys(later).length) applyPatch({ sections: later });
  }
  doc.addEventListener('keydown', function (e) {
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      e.stopPropagation(); return;
    }
    var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key)) { e.preventDefault(); post({ storeKey: e.key.toLowerCase() === 'y' || e.shiftKey ? 'redo' : 'undo' }); }
  }, true);
  doc.addEventListener('focusout', function (e) { if (editing && e.target === editing.el) finish(true); });
  doc.addEventListener('paste', function (e) {
    if (!editing) return; e.preventDefault();
    var text = (e.clipboardData || win.clipboardData).getData('text/plain'); doc.execCommand('insertText', false, text);
  });

  // ---------- toolbar + drag & drop ----------
  ui.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-zact]'); if (!b) return;
    var act = b.getAttribute('data-zact'), sid = tag.getAttribute('data-for');
    if (act === 'drag' || act === 'block' || !sid) return;
    post({ storeAction: { sid: sid, action: act } });
  });
  function sections() { return [].filter.call(doc.getElementById('main').children, function (x) { return x.hasAttribute('data-sid'); }); }
  function blockInfo(el) { var p = el.getAttribute('data-block').split('.'); return { list: p.slice(0, -1).join('.'), index: +p[p.length - 1] }; }
  function siblingsOf(el, s) { var info = blockInfo(el); return [].filter.call(s.querySelectorAll('[data-block]'), function (x) { return blockInfo(x).list === info.list && secOf(x) === s; }); }
  ui.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('button[data-zact]'); if (!b) return;
    var act = b.getAttribute('data-zact');
    if (act === 'drag') {
      var s = bySid(tag.getAttribute('data-for')); if (!s || !isContent(s)) return;
      drag = { kind: 'section', el: s, sid: s.getAttribute('data-sid'), target: undefined };
    } else if (act === 'block' && hoverBlock) {
      var sec = secOf(hoverBlock), info = blockInfo(hoverBlock);
      drag = { kind: 'block', el: hoverBlock, sec: sec, sid: sec.getAttribute('data-sid'), list: info.list, from: info.index, to: info.index };
    } else return;
    e.preventDefault(); drag.el.classList.add('zed-dragging'); tag.style.display = 'none'; bh.style.display = 'none';
    doc.documentElement.style.cursor = 'grabbing';
  });
  doc.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var y = e.clientY + win.scrollY, x = e.clientX + win.scrollX;
    if (drag.kind === 'section') {
      var list = sections().filter(function (s) { return s !== drag.el; }), before = null;
      for (var i = 0; i < list.length; i++) { var r = rect(list[i]); if (y < r.y + r.h / 2) { before = list[i]; break; } }
      drag.target = before ? before.getAttribute('data-sid') : null;
      var ref = before ? rect(before) : rect(list[list.length - 1] || drag.el), ly = before ? ref.y : ref.y + ref.h;
      line.style.cssText = 'display:block;left:' + ref.x + 'px;width:' + ref.w + 'px;top:' + (ly - 2) + 'px;height:4px';
    } else {
      var sibs = siblingsOf(drag.el, drag.sec), best = null, bd = Infinity;
      sibs.forEach(function (s) { var r = rect(s), cx = r.x + r.w / 2, cy = r.y + r.h / 2, d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = s; } });
      if (!best) return;
      var rb = rect(best), row = sibs.some(function (s) { return s !== best && Math.abs(rect(s).y - rb.y) < 8; });
      var after = row ? x > rb.x + rb.w / 2 : y > rb.y + rb.h / 2, t = blockInfo(best).index, ins = after ? t + 1 : t;
      drag.to = drag.from < ins ? ins - 1 : ins;
      line.style.cssText = row ? 'display:block;left:' + ((after ? rb.x + rb.w : rb.x) - 2) + 'px;top:' + rb.y + 'px;width:4px;height:' + rb.h + 'px;background:#ec4899'
        : 'display:block;left:' + rb.x + 'px;top:' + ((after ? rb.y + rb.h : rb.y) - 2) + 'px;width:' + rb.w + 'px;height:4px;background:#ec4899';
    }
  });
  doc.addEventListener('pointerup', function () {
    if (!drag) return;
    var d = drag; drag = null; d.el.classList.remove('zed-dragging'); line.style.display = 'none'; doc.documentElement.style.cursor = '';
    if (d.kind === 'section' && d.target !== undefined && d.target !== d.sid) post({ storeMove: { sid: d.sid, before: d.target } });
    if (d.kind === 'block' && d.to !== d.from) post({ storeMoveBlock: { sid: d.sid, list: d.list, from: d.from, to: d.to } });
    soon();
  });

  // ---------- patches ----------
  function markers() {
    var map = {}, w = doc.createTreeWalker(doc.body, 128), n;
    while ((n = w.nextNode())) {
      var v = n.nodeValue;
      if (v.indexOf('zp:') === 0) (map[v.slice(3)] = map[v.slice(3)] || {}).s = n;
      else if (v.indexOf('/zp:') === 0) (map[v.slice(4)] = map[v.slice(4)] || {}).e = n;
    }
    return map;
  }
  function fill(r, html) {
    var n = r.s.nextSibling; while (n && n !== r.e) { var nx = n.nextSibling; n.parentNode.removeChild(n); n = nx; }
    var frag = doc.createRange().createContextualFragment(html), nodes = [].slice.call(frag.childNodes);
    r.e.parentNode.insertBefore(frag, r.e);
    nodes.forEach(function (x) { if (x.nodeType === 1 && win.__storeHydrate) win.__storeHydrate(x); });
  }
  function rangeNodes(r) { var out = [], n = r.s; while (n) { out.push(n); if (n === r.e) break; n = n.nextSibling; } return out; }
  // image-only change: set the new attributes on the existing <img>s (same elements, no reload); false → replace the section
  function patchFrames(r, f) {
    var imgs = [];
    rangeNodes(r).forEach(function (n) { if (n.nodeType !== 1) return; if (n.matches('img[data-fr]')) imgs.push(n); [].push.apply(imgs, n.querySelectorAll('img[data-fr]')); });
    if (imgs.length !== f.n) return false;
    f.set.forEach(function (e) {
      var img = imgs[e[0]], a = e[1];
      ['onerror', 'srcset', 'src', 'style', 'class'].forEach(function (k) { if (!(k in a)) return; if (a[k] == null) img.removeAttribute(k); else if (img.getAttribute(k) !== a[k]) img.setAttribute(k, a[k]); });
    });
    return true;
  }
  function applyPatch(p) {
    var map = markers(), main = doc.getElementById('main');
    if (p.css != null) { var st = doc.querySelector('style[data-store-css]'); if (st) st.textContent = p.css; }
    if (p.title != null) doc.title = p.title;
    if (p.bodyClass != null) { var keep = doc.body.classList.contains('drawer-open'); doc.body.className = p.bodyClass + (keep ? ' drawer-open' : ''); }
    if (p.bodyStyle != null) doc.body.setAttribute('style', p.bodyStyle);
    ['ann', 'header', 'footer', 'overlays'].forEach(function (k) { if (p[k] != null && map[k]) fill(map[k], p[k]); });
    var secs = p.sections || {};
    if (p.order) {
      p.order.forEach(function (id) {
        var r = map['s:' + id];
        if (!r) { var a = doc.createComment('zp:s:' + id), b = doc.createComment('/zp:s:' + id); main.appendChild(a); main.appendChild(b); map['s:' + id] = r = { s: a, e: b }; }
        else rangeNodes(r).forEach(function (n) { main.appendChild(n); });
      });
      Object.keys(map).forEach(function (k) { if (k.indexOf('s:') === 0 && p.order.indexOf(k.slice(2)) < 0) rangeNodes(map[k]).forEach(function (n) { n.parentNode.removeChild(n); }); });
    }
    Object.keys(secs).forEach(function (id) {
      var r = map['s:' + id]; if (!r) return;
      if (editing && editing.sid === id) { deferred[id] = secs[id]; return; }
      if (p.frames && p.frames[id] && patchFrames(r, p.frames[id])) return;
      fill(r, secs[id]);
    });
    if (p.data && win.__storeSetData) win.__storeSetData(JSON.parse(p.data));
    if (hoverSec && !hoverSec.isConnected) hoverSec = bySid(hoverSec.getAttribute('data-sid'));
    if (hoverBlock && !hoverBlock.isConnected) hoverBlock = null;
    if (hoverImg && !hoverImg.isConnected) hoverImg = null;
    soon();
  }

  win.addEventListener('message', function (e) {
    if (e.source !== win.parent) return;
    var d = e.data || {};
    if (d.storeLabels) labels = d.storeLabels;
    if (d.storeMode) { mode = d.storeMode; if (mode !== 'edit') { finish(true); hoverSec = null; hoverBlock = null; hoverImg = null; } doc.documentElement.classList.toggle('editing', mode === 'edit'); }
    if ('storeHighlight' in d) { selected = d.storeHighlight || null; var s = bySid(selected); if (s && d.scroll) s.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    if (d.storePatch) applyPatch(d.storePatch);
    soon();
  });
  post({ storeReady: true });
}
