// Motion engine of the storefront (inlined into assets/store.js before the runtime, see render.js storeScript()).
//
// motionRuntime(win, doc) is serialised with Function.prototype.toString(), so it must stay self-contained (no imports).
// Original vanilla code; the feel is modelled on spring-based UI motion libraries: physical springs (sampled into a CSS
// linear() easing for the Web Animations API, integrated per frame for pointer effects), masked headline rises, staggers.
//
// Markup contract (written by render.js / sections.js):
//   <body class="motion-off|motion-subtle|motion-expressive">            store-wide level (theme.motion)
//   <section data-sid data-anim="fade-up|blur-in|scale-in|slide|split-text|stagger" data-anim-delay data-anim-dur data-anim-ease="spring|smooth|snappy"
//            data-fx="tilt|magnetic|spotlight|parallax|zoom|beam|aurora">
//   [data-reveal] reveal targets · [data-count] count-ups · [data-words][data-wfx] typewriter / scramble · [data-scramble] decode on reveal
//   [data-lookbook] pinned horizontal scroll · [data-stack] sticky stack cards · [data-flip] flip toggles · [data-depth] parallax layers
// Progressive enhancement: nothing is hidden by CSS. The engine adds `js-motion` to <html> first, then sets initial states inline,
// only when motion is on, the visitor did not ask for reduced motion and the builder is not in Edit mode (html.editing).
// Leaving Edit mode replays the page; entering it restores final states (and the original heading markup for inline editing).
// API: window.__zm = { scan(root), fly(img) → ms, layer(el), scramble(el, text), on() }.

export function motionRuntime(win, doc) {
  var html = doc.documentElement, mm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)');
  var reduce = !!(mm && mm.matches), IO = 'IntersectionObserver' in win, raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (f) { return win.setTimeout(f, 16); };
  var sup = function (p, v) { try { return win.CSS.supports(p, v); } catch (e) { return false; } };
  var LIN = sup('animation-timing-function', 'linear(0, 1)'), SDT = sup('animation-timeline', 'view()');
  var $$ = function (s, r) { var o = [].slice.call((r || doc).querySelectorAll(s)); if (r && r.matches && r.matches(s)) o.unshift(r); return o; };
  var level = function () { var b = doc.body; return !b ? 'subtle' : b.classList.contains('motion-off') ? 'off' : b.classList.contains('motion-expressive') ? 'expressive' : 'subtle'; };
  var editing = function () { return html.classList.contains('editing'); };
  var on = function () { return !reduce && level() !== 'off' && !!doc.body; };
  var live = function () { return on() && !editing(); };
  var X = function () { return level() === 'expressive'; };
  var fine = function (e) { return e.pointerType === 'mouse' && live(); };

  // ---------- springs: sampled into linear() for WAAPI; integrated per frame for pointer-driven values ----------
  var cache = {};
  function spring(k, c) {
    var key = k + ':' + c; if (cache[key]) return cache[key];
    var x = 0, v = 0, dt = 1 / 120, t = 0, pts = [0], calm = 0;
    while (t < 3 && calm < 12) { v += (-k * (x - 1) - c * v) * dt; x += v * dt; t += dt; pts.push(x); calm = Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02 ? calm + 1 : 0; }
    var n = 40, out = []; for (var i = 0; i < n; i++) out.push(+pts[Math.round(i * (pts.length - 1) / (n - 1))].toFixed(3)); out[n - 1] = 1;
    return (cache[key] = { e: 'linear(' + out.join(',') + ')', d: Math.round(t * 1000) });
  }
  function ease(name, dur) {
    if (name === 'snappy') return { e: 'cubic-bezier(.2,.9,.25,1)', d: dur || 620 };
    if (name === 'smooth') return { e: 'cubic-bezier(.22,.7,.2,1)', d: dur || 1100 };
    var s = spring(X() ? 120 : 150, X() ? 17 : 22);
    return LIN ? { e: s.e, d: dur || Math.min(1400, s.d) } : { e: 'cubic-bezier(.2,1.1,.3,1)', d: dur || 950 };
  }
  /** Per-frame spring towards `to` for several numeric keys; apply(values) each frame; stops when settled. */
  function follower(apply, k, c) {
    var cur = {}, vel = {}, to = {}, run = false, last = 0;
    function step(now) {
      var dt = Math.min(0.032, (now - last) / 1000 || 0.016), moving = false; last = now;
      for (var key in to) { var a = (to[key] - cur[key]) * k - vel[key] * c; vel[key] += a * dt; cur[key] += vel[key] * dt; if (Math.abs(to[key] - cur[key]) > 0.01 || Math.abs(vel[key]) > 0.01) moving = true; else { cur[key] = to[key]; vel[key] = 0; } }
      apply(cur); if (moving) raf(step); else run = false;
    }
    return function (t) { for (var key in t) { if (!(key in cur)) { cur[key] = 0; vel[key] = 0; } to[key] = t[key]; } if (!run) { run = true; last = win.performance ? win.performance.now() : Date.now(); raf(step); } };
  }

  // ---------- reveal presets ----------
  function fromOf(anim, el) {
    var x = X() ? 1.35 : 1, side = el && el.closest && el.closest('.rev,.split.rev') ? -1 : 1;
    switch (anim) {
      case 'blur-in': return { opacity: 0, filter: 'blur(' + Math.round(12 * x) + 'px)', translate: '0 ' + Math.round(10 * x) + 'px' };
      case 'scale-in': return { opacity: 0, scale: String(1 - 0.07 * x) };
      case 'slide': return { opacity: 0, translate: Math.round(-46 * x * side) + 'px 0' };
      case 'word': return { translate: '0 108%' };
      default: return { opacity: 0, translate: '0 ' + Math.round(26 * x) + 'px' };
    }
  }
  var PROPS = ['opacity', 'filter', 'translate', 'scale'];
  function pre(el, from) { el.__zmFrom = from; PROPS.forEach(function (p) { if (p in from) el.style[p] = from[p]; }); el.classList.add('zm-pre'); }
  function clear(el) { if (!el.__zmFrom) return; PROPS.forEach(function (p) { if (p in el.__zmFrom) el.style[p] = ''; }); el.classList.remove('zm-pre'); }
  function play(el, delay) {
    var from = el.__zmFrom; if (!from) return; clear(el); el.__zmFrom = null;
    var sec = el.__zmSec, ez = ease(sec.getAttribute('data-anim-ease'), +sec.getAttribute('data-anim-dur') || 0), f = {};
    for (var k in from) f[k] = from[k]; f.offset = 0;
    if (el.animate) { try { el.animate([f, {}], { duration: from.filter ? Math.min(ez.d, 900) : ez.d, delay: delay, easing: from.opacity === 0 && !from.translate && !from.scale ? 'ease-out' : ez.e, fill: 'backwards' }); } catch (e) { /* older engines without individual transform keyframes */ } }
    if (el.__zmAfter) { var fn = el.__zmAfter; el.__zmAfter = null; win.setTimeout(fn, delay); }
  }

  // ---------- split text (masked word rise) ----------
  function splitText(h) {
    if (h.__zmHTML != null) return; h.__zmHTML = h.innerHTML;
    var words = [];
    (function walk(node) {
      [].slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var parts = n.nodeValue.split(/(\s+)/), frag = doc.createDocumentFragment();
          parts.forEach(function (p) { if (!p) return; if (/^\s+$/.test(p)) { frag.appendChild(doc.createTextNode(p)); return; } var o = doc.createElement('span'), i = doc.createElement('span'); o.className = 'zm-w'; i.className = 'zm-wi'; i.textContent = p; o.appendChild(i); frag.appendChild(o); words.push(i); });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') { if (n.childNodes.length && !n.classList.contains('eh-dot')) walk(n); else { var o = doc.createElement('span'); o.className = 'zm-w'; node.replaceChild(o, n); var w = doc.createElement('span'); w.className = 'zm-wi'; w.appendChild(n); o.appendChild(w); words.push(w); } }
      });
    })(h);
    return words;
  }
  function unsplit(h) { if (h.__zmHTML != null) { h.innerHTML = h.__zmHTML; h.__zmHTML = null; } }

  // ---------- count-up, scramble, typewriter ----------
  function fmt(el, v) { var d = +el.getAttribute('data-dec') || 0, s = v.toFixed(d); if (el.hasAttribute('data-group')) { var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); s = p.join('.'); } return s; }
  function countUp(el, delay) {
    var to = +el.getAttribute('data-count'), dur = 1600 + Math.min(900, String(Math.round(to)).length * 120), t0 = 0;
    el.textContent = fmt(el, 0);
    win.setTimeout(function () { raf(function tick(now) { if (!t0) t0 = now; var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(2, -10 * p); el.textContent = fmt(el, p >= 1 ? to : to * e); if (p < 1 && !editing()) raf(tick); else el.textContent = fmt(el, to); }); }, delay);
  }
  var GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+';
  function scramble(el, text, dur) {
    text = String(text); if (!on() || editing() || !el.isConnected) { el.textContent = text; return; }
    var from = el.textContent, len = Math.max(from.length, text.length), t0 = 0; dur = dur || 520; el.__zmTo = text;
    raf(function tick(now) {
      if (el.__zmTo !== text) return; if (!t0) t0 = now; var p = Math.min(1, (now - t0) / dur), out = '';
      for (var i = 0; i < len; i++) { var ch = text.charAt(i); out += p * len * 1.15 > i + Math.random() * 2 ? ch : ch === ' ' ? ' ' : GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length)); }
      el.textContent = p >= 1 ? text : out; if (p < 1) raf(tick);
    });
  }
  function rotator(el) {
    var words = el.getAttribute('data-words').split('|'), mode = el.getAttribute('data-wfx'), i = 0, first = words[0];
    el.setAttribute('aria-hidden', 'true');
    function next() {
      if (!el.isConnected) return; if (!live() || el.__zmIdle) { win.setTimeout(next, 900); return; }
      var w = words[i = (i + 1) % words.length];
      if (mode === 'scramble') { scramble(el, w, 700); win.setTimeout(next, 2600); return; }
      var cur = el.textContent;
      (function del() { if (!el.isConnected) return; if (cur.length && live()) { cur = cur.slice(0, -1); el.textContent = cur; win.setTimeout(del, 38); } else (function type(k) { if (!el.isConnected) return; el.textContent = w.slice(0, k); if (k < w.length && live()) win.setTimeout(function () { type(k + 1); }, 70); else { el.textContent = w; win.setTimeout(next, 2200); } })(1); })();
    }
    el.classList.add('zm-caret'); win.setTimeout(next, 2400);
    el.__zmReset = function () { el.textContent = first; };
  }

  // ---------- pointer effects: tilt + glare, magnetic, spotlight ----------
  function tilt(el, max) {
    if (el.__zmT) return; el.__zmT = 1; el.classList.add('zm-tilt');
    var g = doc.createElement('i'); g.className = 'zm-glare'; g.setAttribute('aria-hidden', 'true'); el.appendChild(g);
    var go = follower(function (v) { el.style.transform = 'perspective(900px) rotateX(' + v.rx.toFixed(2) + 'deg) rotateY(' + v.ry.toFixed(2) + 'deg)'; if (Math.abs(v.rx) + Math.abs(v.ry) < 0.02) el.style.transform = ''; }, 170, 18);
    el.addEventListener('pointermove', function (e) {
      if (!fine(e)) return; var r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      go({ rx: (0.5 - py) * max, ry: (px - 0.5) * max }); g.style.opacity = '1'; g.style.transform = 'translate(' + (px * 100 - 50) + '%,' + (py * 100 - 50) + '%)';
    });
    el.addEventListener('pointerleave', function () { go({ rx: 0, ry: 0 }); g.style.opacity = ''; });
  }
  function magnet(el, k) {
    if (el.__zmM) return; el.__zmM = 1;
    var go = follower(function (v) { el.style.translate = Math.abs(v.x) + Math.abs(v.y) < 0.05 ? '' : v.x.toFixed(1) + 'px ' + v.y.toFixed(1) + 'px'; }, 220, 16);
    el.addEventListener('pointermove', function (e) { if (!fine(e)) return; var r = el.getBoundingClientRect(); go({ x: (e.clientX - r.left - r.width / 2) * k, y: (e.clientY - r.top - r.height / 2) * k }); });
    el.addEventListener('pointerleave', function () { go({ x: 0, y: 0 }); });
  }
  function spotlight(sec) {
    var s = sec.querySelector(':scope > .zm-spot'); if (!s || sec.__zmS) return; sec.__zmS = 1;
    var go = follower(function (v) { s.style.transform = 'translate3d(' + v.x.toFixed(1) + 'px,' + v.y.toFixed(1) + 'px,0)'; }, 90, 14);
    var r0 = sec.getBoundingClientRect(); go({ x: r0.width * 0.68 - 300, y: Math.min(r0.height * 0.38, 320) - 300 });
    sec.addEventListener('pointermove', function (e) { if (!fine(e)) return; var r = sec.getBoundingClientRect(); go({ x: e.clientX - r.left - 300, y: e.clientY - r.top - 300 }); });
  }

  // ---------- scroll-linked: parallax, sticky stack, pinned lookbook (CSS scroll timelines when supported, else rAF) ----------
  var scrollers = [], ticking = false;
  function onScroll() { if (ticking) return; ticking = true; raf(function () { ticking = false; var vh = win.innerHeight; scrollers = scrollers.filter(function (f) { return f.el.isConnected; }); scrollers.forEach(function (f) { if (!f.el.__zmIdle) f.fn(vh); }); }); }
  win.addEventListener('scroll', onScroll, { passive: true }); win.addEventListener('resize', function () { scrollers.forEach(function (f) { if (f.size) f.size(); }); onScroll(); });
  function parallax(sec) {
    $$('img', sec).forEach(function (img) {
      if (img.__zmP || img.closest('.pcard,.zm-glare,.avstack,.rail-hang')) return; img.__zmP = 1;
      var lay = img.closest('[data-depth]'), d = lay ? +lay.getAttribute('data-depth') : 0.6;
      img.classList.add('zm-par'); img.style.setProperty('--zd', d);
      if (!img.classList.contains('fz')) img.style.scale = String(1 + 0.1 * d);
      if (SDT) return;
      scrollers.push({ el: img, fn: function (vh) { if (!live()) { img.style.translate = ''; return; } var r = img.getBoundingClientRect(), p = (r.top + r.height / 2 - vh / 2) / vh; img.style.translate = '0 ' + (-p * 60 * d).toFixed(1) + 'px'; } });
    });
    onScroll();
  }
  function stack(box) {
    var cards = $$('.zst-card', box);
    scrollers.push({ el: box, fn: function () {
      cards.forEach(function (c, i) {
        var n = cards[i + 1]; if (!n || !live()) { c.style.scale = ''; c.style.opacity = ''; return; }
        var a = c.getBoundingClientRect(), b = n.getBoundingClientRect(), p = Math.max(0, Math.min(1, 1 - (b.top - a.top) / Math.max(1, a.height)));
        c.style.scale = String(1 - p * 0.06 * (cards.length - i - 1) / Math.max(1, cards.length - 1) - p * 0.03); c.style.opacity = String(1 - p * 0.35);
      });
    } });
    onScroll();
  }
  function lookbook(sec) {
    var track = sec.querySelector('[data-lb-track]'), bar = sec.querySelector('.zlb-bar i'); if (!track) return;
    var dist = 0;
    function size() {
      if (!live()) { sec.classList.remove('zm-pin'); sec.style.height = ''; track.style.translate = ''; return; }
      sec.classList.add('zm-pin'); dist = Math.max(0, track.scrollWidth - win.innerWidth + 32);
      sec.style.height = (win.innerHeight + dist) + 'px'; sec.style.setProperty('--lbd', -dist + 'px');
    }
    sec.__zmSize = size; size();
    scrollers.push({ el: sec, size: size, fn: function (vh) {
      if (!sec.classList.contains('zm-pin')) return; var r = sec.getBoundingClientRect(), p = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - vh)));
      if (!SDT) track.style.translate = (-p * dist).toFixed(1) + 'px 0'; if (bar) bar.style.scale = p.toFixed(3) + ' 1';
    } });
    onScroll();
  }

  // ---------- page-level: fly to cart, spring drawer ----------
  function fly(img) {
    if (!live() || !X() || !img || !img.getBoundingClientRect) return 0;
    var cart = $$('[data-cart-open]').filter(function (b) { return b.offsetParent; })[0]; if (!cart) return 0;
    var a = img.getBoundingClientRect(), b = cart.getBoundingClientRect(); if (!a.width) return 0;
    var c = doc.createElement('img'); c.src = img.currentSrc || img.src; c.alt = ''; c.className = 'zm-fly';
    var size = Math.min(160, a.width); c.style.cssText = 'left:' + (a.left + a.width / 2 - size / 2) + 'px;top:' + (a.top + a.height / 2 - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px';
    doc.body.appendChild(c);
    var dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), d = 720;
    c.animate([{ translate: '0 0', scale: '1', opacity: 1 }, { translate: dx * 0.45 + 'px ' + (Math.min(dy, 0) - 90) + 'px', scale: '.55', opacity: 1, offset: 0.45 }, { translate: dx + 'px ' + dy + 'px', scale: '.12', opacity: 0.4 }], { duration: d, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
    win.setTimeout(function () { c.remove(); cart.animate([{ scale: '1' }, { scale: '1.3', offset: 0.35 }, { scale: '1' }], { duration: 520, easing: LIN ? spring(260, 12).e : 'ease-out' }); }, d - 40);
    return d - 120;
  }
  function layer(el) {
    if (!live() || !X() || !el) return; var p = el.querySelector('.drawer-panel,.navdrawer-panel,.search-panel,.modal-panel'), sc = el.querySelector('.drawer-scrim');
    var right = p && p.classList.contains('drawer-panel'), left = p && p.classList.contains('navdrawer-panel');
    if (p) p.animate([{ translate: right ? '104% 0' : left ? '-104% 0' : '0 -30px', opacity: right || left ? 1 : 0 }, { translate: '0 0', opacity: 1 }], { duration: 760, easing: LIN ? spring(190, 21).e : 'cubic-bezier(.2,1.1,.3,1)' });
    if (sc) sc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
  }

  // ---------- scan: prepare a section tree ----------
  var PARTS = '.eyebrow,.meta,.sec-sub,.hero-text,.eh-text,.eh-meta,.mh-text,.mh-rot,.btns,.dr-tag,.dr-text,.cd,.eh-media,.hero-float,.hero-media.rounded,.mh-media,.dr-media,.split-media,.split-copy .prose,.sl-media,.sf-media,.sf-text,.prose,.rail-side,.zlb-count,.nl-form,.tq-rate,.wordmark-big';
  var STAG ='.grid,.rail-track,.bento-grid,.steps-list,.pol-board,.insta-grid,.ugc-grid,.logo-row,.zstats,.zflips,.sf-list,.sl-rows,.modules,.faq-list';
  // A watched element carries the list of targets it releases (a headline's words and copy are released by their section,
  // so masked words — clipped, thus never "visible" — and copy just below the fold animate together). Staggered items
  // watch themselves and are spaced per batch, after the section's headline when that is still playing.
  var revealIO = IO && new win.IntersectionObserver(function (es) {
    if (editing()) return; var n = {}, now = Date.now();
    es.filter(function (e) { return e.isIntersecting; }).sort(function (a, b) { return a.target.compareDocumentPosition(b.target) & 4 ? -1 : 1; }).forEach(function (e) {
      var w = e.target, list = w.__zmList || []; w.__zmList = null; revealIO.unobserve(w);
      list.forEach(function (el) {
        var sec = el.__zmSec, base = +sec.getAttribute('data-anim-delay') || 0;
        if (el.__zmItem) { var id = sec.getAttribute('data-sid') || '', k = n[id] = (n[id] || 0) + 1; play(el, base + Math.max(0, (sec.__zmHeadAt || 0) - now) + (k - 1) * (X() ? 85 : 65)); }
        else { if (el.__zmLead) sec.__zmHeadAt = now + base + el.__zmLead; play(el, base + el.__zmD); }
      });
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  var idleIO = IO && new win.IntersectionObserver(function (es) { es.forEach(function (e) { e.target.__zmIdle = !e.isIntersecting; e.target.classList.toggle('zm-idle', !e.isIntersecting); $$('[data-words]', e.target).forEach(function (w) { w.__zmIdle = !e.isIntersecting; }); }); }, { rootMargin: '120px 0px' });
  var countIO = IO && new win.IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting && !editing()) { countIO.unobserve(e.target); countUp(e.target, 120); } }); }, { threshold: 0.4 });

  var watched = [];
  function arm(el, sec, from, d, watch) {
    var w = watch || el; el.__zmSec = sec; el.__zmD = d || 0; pre(el, from);
    if (!revealIO) { play(el, 0); return; }
    if (!w.__zmList) { w.__zmList = []; watched.push(w); } w.__zmList.push(el); revealIO.observe(w);
  }
  function prepSection(sec) {
    var anim = sec.getAttribute('data-anim'), fx = sec.getAttribute('data-fx') || '', x = X();
    if (idleIO && !sec.__zmIdleObs) { sec.__zmIdleObs = 1; idleIO.observe(sec); }
    // pointer effects (Edit mode ignores them: handlers check live())
    if (fx === 'tilt' || x) $$('.pcard-media,.zflip-in,.tile,.rail-img,.mh-b', sec).forEach(function (el) { tilt(el, fx === 'tilt' ? 12 : 7); });
    if (fx === 'magnetic' || x) $$('.btn-lg,.mhero .btn,.round', sec).forEach(function (el) { magnet(el, fx === 'magnetic' ? 0.4 : 0.25); });
    if (fx === 'spotlight' || sec.classList.contains('mh-bd-spotlight')) spotlight(sec);
    if (fx === 'beam') $$('.zstat,.feature,.plan,.quote,.tile:not(.has-img),.step,.pcard-media,.zst-card', sec).forEach(function (el) { if (el.querySelector(':scope > .zm-beam')) return; var b = doc.createElement('i'); b.className = 'zm-beam'; b.setAttribute('aria-hidden', 'true'); b.innerHTML = '<i></i>'; el.classList.add('zm-beamed'); el.appendChild(b); });
    if ((fx === 'parallax' || sec.getAttribute('data-type') === 'motion-hero') && live()) parallax(sec);
    $$('[data-stack]', sec).forEach(function (b) { if (!b.__zmK) { b.__zmK = 1; stack(b); } });
    if (sec.hasAttribute('data-lookbook') && !sec.__zmL) { sec.__zmL = 1; lookbook(sec); }
    $$('[data-words]', sec).forEach(function (w) { if (!w.__zmW) { w.__zmW = 1; rotator(w); } });
    if (!anim || anim === 'none' || !live()) return;
    // reveal choreography
    var heads = anim === 'split-text' ? $$('h1,h2', sec).filter(function (h) { return !h.closest('.pcard,.zst-card,.drawer') && h.textContent.trim(); }).slice(0, 2) : [];
    var lead = 0;
    heads.forEach(function (h) {
      var ws = splitText(h) || []; h.classList.add('zm-split');
      ws.forEach(function (w, i) { arm(w, sec, fromOf('word'), lead + Math.min(i * (x ? 55 : 40), 900), h); });
      lead += Math.min(700, ws.length * (x ? 55 : 40)) + 120;
      if (ws.length) ws[ws.length - 1].__zmLead = lead;
    });
    var groups = anim === 'stagger' || anim === 'split-text' ? $$(STAG, sec).filter(function (g) { return !g.closest('.drawer,.search'); }) : [];
    var items = [];
    groups.forEach(function (g) { [].slice.call(g.children, 0, 24).forEach(function (c) { if (!c.hidden) items.push(c); }); });
    var base = anim === 'stagger' || anim === 'split-text' ? 'fade-up' : anim;
    var inAny = function (el, list) { return list.some(function (o) { return o === el || o.contains(el) || el.contains(o); }); };
    if (heads.length || items.length) {
      // the rest of the copy (eyebrow, text, buttons, media) follows the headline, then the staggered items
      var others = $$(PARTS, sec).filter(function (el) { return !inAny(el, heads) && !inAny(el, items) && !inAny(el, groups); });
      others = others.filter(function (el) { return !others.some(function (o) { return o !== el && o.contains(el); }); });
      var h0 = heads[0], top0 = h0 ? h0.getBoundingClientRect().top : 0, vh = win.innerHeight;
      others.forEach(function (k, i) { var near = h0 && Math.abs(k.getBoundingClientRect().top - top0) < vh * 0.75; arm(k, sec, fromOf(base, k), near ? lead + i * 80 : 0, near ? h0 : null); });
      items.forEach(function (it) { it.__zmItem = 1; arm(it, sec, fromOf(base, it), 0); });
    } else {
      var rest = $$('[data-reveal]', sec); if (!rest.length) rest = [].slice.call(sec.children).filter(function (c) { return !/zm-|hero-media|hero-shade|hero-orbs|mh-beams|sticker/.test(c.className) && c.tagName !== 'SCRIPT'; });
      rest.forEach(function (r, i) { arm(r, sec, fromOf(base, r), i * 80); });
    }
    if (fx === 'zoom') $$('img', sec).forEach(function (img) { var box = img.parentElement; if (img.closest('.pcard') || box.__zmZ) return; box.__zmZ = 1; box.classList.add('zm-zoom'); arm(box, sec, { opacity: 0.001 }, 0); box.__zmAfter = function () { box.classList.add('zm-zin'); }; });
  }
  function scan(root) {
    if (!doc.body) return; root = root || doc;
    if (on()) html.classList.add('js-motion'); else html.classList.remove('js-motion');
    $$('[data-anim],[data-fx]', root).forEach(prepSection);
    $$('[data-count]', root).forEach(function (el) { if (live() && countIO && !el.__zmC) { el.__zmC = 1; el.textContent = fmt(el, 0); countIO.observe(el); } });
    $$('[data-scramble]', root).forEach(function (el) { if (live() && !el.__zmX && !el.hasAttribute('data-countdown') && el.children.length === 0) { el.__zmX = 1; var t = el.textContent; el.textContent = ''; win.setTimeout(function () { scramble(el, t, 900); }, 400); } });
    $$('[data-flip]', root).forEach(function (b) { if (b.__zmF) return; b.__zmF = 1; b.addEventListener('click', function () { var c = b.closest('.zflip'), o = !c.classList.contains('flipped'); c.classList.toggle('flipped', o); b.setAttribute('aria-pressed', String(o)); }); });
  }
  function reset() {
    watched.forEach(function (w) { w.__zmList = null; if (revealIO) revealIO.unobserve(w); }); watched = [];
    $$('.zm-pre').forEach(function (el) { clear(el); el.__zmFrom = null; });
    $$('.zm-split').forEach(function (h) { unsplit(h); h.classList.remove('zm-split'); });
    $$('[data-count]').forEach(function (el) { if (countIO) countIO.unobserve(el); el.__zmC = 0; el.textContent = fmt(el, +el.getAttribute('data-count')); });
    $$('[data-words]').forEach(function (w) { if (w.__zmReset) w.__zmReset(); });
    $$('[data-lookbook]').forEach(function (s) { if (s.__zmSize) s.__zmSize(); });
    $$('.zm-zoom').forEach(function (b) { b.classList.remove('zm-zoom', 'zm-zin'); b.__zmZ = 0; });
    $$('[data-stack] .zst-card,.zm-tilt,[data-reveal]').forEach(function (c) { c.style.scale = ''; c.style.opacity = ''; c.style.transform = ''; });
  }
  // Edit ⇄ Interact in the builder: final states while editing, a fresh replay when leaving Edit mode
  var was = editing();
  if (win.MutationObserver) new win.MutationObserver(function () {
    var now = editing(); if (now === was) return; was = now;
    if (now) reset(); else { reset(); scan(doc); onScroll(); }
  }).observe(html, { attributes: true, attributeFilter: ['class'] });
  // cross-document View Transitions: opt in only on a real top-level site (not the builder's srcdoc iframe, blob: previews or
  // file://), and swallow aborted transitions (navigating mid-transition rejects their promises)
  var quiet = function (vt) { if (vt) ['ready', 'finished', 'updateCallbackDone'].forEach(function (k) { if (vt[k] && vt[k].catch) vt[k].catch(function () {}); }); };
  win.addEventListener('pageswap', function (e) { quiet(e.viewTransition); }); win.addEventListener('pagereveal', function (e) { quiet(e.viewTransition); });
  var top = false; try { top = win.top === win; } catch (e) { top = false; }
  if (on() && top && /^https?:$/.test(win.location.protocol) && win.CSS && sup('view-transition-name', 'none')) { var vs = doc.createElement('style'); vs.textContent = '@view-transition{navigation:auto}'; doc.head.appendChild(vs); }
  win.__zm = { scan: scan, fly: fly, layer: layer, scramble: scramble, on: live };
}
