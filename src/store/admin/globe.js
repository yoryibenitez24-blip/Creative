// Canvas 2D visitor globe (no WebGL, no dependencies): an orthographic sphere with a thin lat/long wireframe,
// dot-matrix continents from the embedded land mask (landmask.js), glowing markers at visitor locations and raised
// great-circle arcs from each location to the store. Auto-rotates slowly (not with prefers-reduced-motion), pauses on
// hover, drags with the pointer (with inertia), is devicePixelRatio aware, follows its box with a ResizeObserver and
// stops its animation loop while off-screen, hidden or destroyed.
//
//   const g = createGlobe(canvas, { onHover(loc|null, x, y) });
//   g.setData({ locations: [{ country, name, lat, lon, sessions, orders, sales }], home: { lat, lon, name } | null });
//   g.focus(country | null)   // highlight a location and turn the globe towards it
//   g.destroy()
import { LAND_RLE, LAND_W, LAND_H } from './landmask.js';

const RAD = Math.PI / 180;
let landBits = null, dotCache = null;

/** Decode the run-length land mask once → Uint8Array(LAND_W * LAND_H), 1 = land. */
export function landMask() {
  if (landBits) return landBits;
  const bin = typeof atob === 'function' ? atob(LAND_RLE) : Buffer.from(LAND_RLE, 'base64').toString('binary');
  const bits = new Uint8Array(LAND_W * LAND_H);
  let i = 0, p = 0, v = 0;
  while (i < bin.length && p < bits.length) {
    let n = 0, s = 0, b;
    do { b = bin.charCodeAt(i++); n |= (b & 127) << s; s += 7; } while (b & 128 && i < bin.length);
    if (v) bits.fill(1, p, Math.min(bits.length, p + n));
    p += n; v ^= 1;
  }
  return (landBits = bits);
}

/** Is (lat, lon) on land according to the mask? */
export function isLand(lat, lon) {
  const bits = landMask();
  const y = Math.min(LAND_H - 1, Math.max(0, Math.floor((90 - lat) / 180 * LAND_H)));
  const x = ((Math.floor((lon + 180) / 360 * LAND_W) % LAND_W) + LAND_W) % LAND_W;
  return bits[y * LAND_W + x] === 1;
}

/** Land dots on an (almost) equal-area lattice, step in degrees → Float32Array [sinLat, cosLat, lonRad, …]. */
export function landDots(step = 1.25) {
  if (dotCache && dotCache.step === step) return dotCache.dots;
  const out = [];
  for (let lat = -88 + step / 2; lat < 88; lat += step) {
    const c = Math.cos(lat * RAD), n = Math.max(1, Math.round(360 * c / step));
    const off = (Math.round(lat / step) % 2) * 0.5; // stagger alternate rows for a hexagonal look
    for (let k = 0; k < n; k++) {
      const lon = -180 + (k + off) * 360 / n;
      if (isLand(lat, lon)) out.push(Math.sin(lat * RAD), c, lon * RAD);
    }
  }
  const dots = new Float32Array(out);
  dotCache = { step, dots };
  return dots;
}

const reducedMotion = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

export function createGlobe(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const calm = opts.reducedMotion ?? reducedMotion();
  const dots = landDots(opts.dotStep || 1.25);
  const st = {
    lon0: opts.lon0 ?? 10, lat0: opts.lat0 ?? 18, vLon: 0, vLat: 0, w: 0, h: 0, dpr: 1,
    hover: false, drag: null, visible: true, raf: 0, last: 0, t0: performance.now(),
    locations: [], home: null, focus: null, target: null, hit: [], hoverLoc: null, dead: false,
  };
  const AUTO = 5; // degrees per second

  function size() {
    const r = canvas.getBoundingClientRect();
    st.dpr = Math.min(3, window.devicePixelRatio || 1);
    st.w = Math.max(1, r.width); st.h = Math.max(1, r.height);
    const W = Math.round(st.w * st.dpr), H = Math.round(st.h * st.dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }

  // Orthographic projection with the view centre at (lat0, lon0).
  function proj(sinLat, cosLat, lon, alt = 1) {
    const sl0 = Math.sin(st.lat0 * RAD), cl0 = Math.cos(st.lat0 * RAD), dl = lon - st.lon0 * RAD, cd = Math.cos(dl);
    return { x: cosLat * Math.sin(dl) * alt, y: (cl0 * sinLat - sl0 * cosLat * cd) * alt, z: (sl0 * sinLat + cl0 * cosLat * cd) * alt };
  }
  const projLL = (lat, lon, alt) => proj(Math.sin(lat * RAD), Math.cos(lat * RAD), lon * RAD, alt);

  function draw(now) {
    const { w, h, dpr } = st;
    const t = (now - st.t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(w, h) * 0.42, cx = w / 2, cy = h / 2;
    const S = (p) => [cx + p.x * R, cy - p.y * R];

    // atmosphere glow + sphere body
    const glow = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.28);
    glow.addColorStop(0, 'rgba(255,122,44,0.30)'); glow.addColorStop(0.35, 'rgba(255,100,30,0.10)'); glow.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.28, 0, Math.PI * 2); ctx.fill();
    const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#1d1714'); body.addColorStop(0.7, '#0f0c0b'); body.addColorStop(1, '#090808');
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // graticule (front hemisphere only), every 15°
    ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(200,196,190,0.16)';
    ctx.beginPath();
    const seg = (pts) => { let on = false; for (const p of pts) { if (p.z > 0) { const [x, y] = S(p); if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; } } else on = false; } };
    for (let lat = -75; lat <= 75; lat += 15) { const pts = []; for (let lon = -180; lon <= 180; lon += 3) pts.push(projLL(lat, lon)); seg(pts); }
    for (let lon = -180; lon < 180; lon += 15) { const pts = []; for (let lat = -90; lat <= 90; lat += 3) pts.push(projLL(lat, lon)); seg(pts); }
    ctx.stroke();
    // rim
    ctx.strokeStyle = 'rgba(255,170,110,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // land dots: far side very faint, near side brighter towards the centre (depth cue)
    const sl0 = Math.sin(st.lat0 * RAD), cl0 = Math.cos(st.lat0 * RAD), L0 = st.lon0 * RAD;
    const dotR = Math.max(0.6, R / 260);
    const buckets = [[], [], [], [], []];
    for (let i = 0; i < dots.length; i += 3) {
      const sLat = dots[i], cLat = dots[i + 1], dl = dots[i + 2] - L0, cd = Math.cos(dl);
      const z = sl0 * sLat + cl0 * cLat * cd;
      const x = cx + cLat * Math.sin(dl) * R, y = cy - (cl0 * sLat - sl0 * cLat * cd) * R;
      buckets[z < -0.05 ? 0 : z < 0.25 ? 1 : z < 0.5 ? 2 : z < 0.75 ? 3 : 4].push(x, y);
    }
    const styles = ['rgba(255,138,60,0.07)', 'rgba(255,128,48,0.45)', 'rgba(255,134,52,0.68)', 'rgba(255,142,58,0.86)', 'rgba(255,152,66,1)'];
    for (let b = 0; b < 5; b++) {
      const arr = buckets[b]; if (!arr.length) continue;
      ctx.fillStyle = styles[b];
      const r = b === 0 ? dotR * 0.8 : dotR * (0.75 + b * 0.09);
      ctx.beginPath();
      for (let k = 0; k < arr.length; k += 2) { ctx.moveTo(arr[k] + r, arr[k + 1]); ctx.arc(arr[k], arr[k + 1], r, 0, Math.PI * 2); }
      ctx.fill();
    }

    // arcs from each location to the store, raised above the surface
    const home = st.home, locs = st.locations;
    const max = Math.max(1, ...locs.map(l => l.sessions + l.orders));
    if (home) {
      const H3 = vec(home.lat, home.lon);
      for (const l of locs) {
        const A = vec(l.lat, l.lon), ang = Math.acos(Math.max(-1, Math.min(1, dot(A, H3))));
        if (ang < 2 * RAD) continue;
        const N = 48, lift = 0.05 + 0.2 * (ang / Math.PI), pts = [];
        for (let k = 0; k <= N; k++) {
          const f = k / N, v = slerp(A, H3, ang, f), alt = 1 + lift * Math.sin(Math.PI * f);
          const lat = Math.asin(v[1]), lon = Math.atan2(v[0], v[2]);
          const p = proj(Math.sin(lat), Math.cos(lat), lon, alt);
          pts.push({ p, vis: p.z > 0 || p.x * p.x + p.y * p.y > 1 });
        }
        const strong = st.focus && st.focus === l.country;
        ctx.lineWidth = strong ? 2 : 1.3;
        ctx.strokeStyle = strong ? 'rgba(255,196,140,0.95)' : 'rgba(255,140,60,0.55)';
        ctx.beginPath(); let on = false;
        for (const q of pts) { if (q.vis) { const [x, y] = S(q.p); if (on) ctx.lineTo(x, y); else { ctx.moveTo(x, y); on = true; } } else on = false; }
        ctx.stroke();
        // travelling comet from the visitor to the store
        if (!calm) {
          const phase = ((t * 0.45 + (l.lat + l.lon) / 97) % 1 + 1) % 1, head = Math.floor(phase * N);
          for (let k = Math.max(0, head - 7); k <= head; k++) {
            const q = pts[k]; if (!q.vis) continue; const [x, y] = S(q.p), a = 1 - (head - k) / 8;
            ctx.fillStyle = `rgba(255,214,170,${a.toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, 1.1 + a * 1.4, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }

    // markers
    st.hit = [];
    const drawMarker = (lat, lon, rad, kind, key, ring = false) => {
      const p = projLL(lat, lon); if (p.z <= 0.02) return;
      const [x, y] = S(p), fade = Math.min(1, p.z * 3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.6);
      g.addColorStop(0, `rgba(255,140,50,${0.55 * fade})`); g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad * 2.6, 0, Math.PI * 2); ctx.fill();
      if (!calm) { // pulse ring
        const ph = ((t * 0.7 + (lat * 7 + lon) / 113) % 1 + 1) % 1;
        ctx.strokeStyle = `rgba(255,170,100,${(0.7 * (1 - ph) * fade).toFixed(3)})`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(x, y, rad * (1 + ph * 1.6), 0, Math.PI * 2); ctx.stroke();
      }
      const focused = key && st.focus === key;
      ctx.fillStyle = kind === 'home' ? '#fff4ea' : focused ? '#ffb27a' : '#ff7a2f';
      ctx.globalAlpha = fade; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = focused ? 2.5 : 1.5; ctx.strokeStyle = kind === 'home' ? '#ff7a2f' : 'rgba(255,230,210,0.9)'; ctx.stroke();
      icon(ctx, kind, x, y, rad, kind === 'home' ? '#c2410c' : '#1a0f08');
      ctx.globalAlpha = 1;
      if (ring) { ctx.strokeStyle = 'rgba(255,244,234,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 4, 0, Math.PI * 2); ctx.stroke(); }
      if (key) st.hit.push({ key, x, y, r: rad + 4 });
    };
    // the store's own marker; when a visitor location sits on it, that marker gets a white "home" ring instead
    const H = home && vec(home.lat, home.lon), atHome = l => H && dot(vec(l.lat, l.lon), H) > Math.cos(2 * RAD);
    if (home && !locs.some(atHome)) drawMarker(home.lat, home.lon, 8, 'home', null);
    for (const l of [...locs].reverse()) drawMarker(l.lat, l.lon, 6 + 7 * Math.sqrt((l.sessions + l.orders) / max), l.orders && !l.sessions ? 'bag' : 'user', l.country, atHome(l));
  }

  function frame(now) {
    st.raf = 0;
    if (st.dead) return;
    const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0); st.last = now;
    let moving = false;
    if (st.target) {
      const dLon = ((st.target.lon - st.lon0 + 540) % 360) - 180, dLat = st.target.lat - st.lat0;
      if (calm || (Math.abs(dLon) < 0.2 && Math.abs(dLat) < 0.2)) { st.lon0 += dLon; st.lat0 = st.target.lat; st.target = null; }
      else { const k = 1 - Math.pow(0.002, dt); st.lon0 += dLon * k; st.lat0 += dLat * k; moving = true; }
    } else if (!st.drag) {
      if (Math.abs(st.vLon) > 0.5 || Math.abs(st.vLat) > 0.5) {
        st.lon0 += st.vLon * dt; st.lat0 = clampLat(st.lat0 + st.vLat * dt);
        const decay = Math.pow(0.04, dt); st.vLon *= decay; st.vLat *= decay; moving = true;
      } else { st.vLon = st.vLat = 0; if (!calm && !st.hover && !st.focus) { st.lon0 += AUTO * dt; moving = true; } }
    }
    draw(now);
    if ((moving || !calm || st.drag) && st.visible) st.raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!st.raf && !st.dead && st.visible) { st.last = 0; st.raf = requestAnimationFrame(frame); } };

  // pointer: hover pauses, drag rotates, release keeps some inertia
  const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onEnter = () => { st.hover = true; };
  const onLeave = () => { st.hover = false; setHover(null); kick(); };
  const onDown = e => {
    if (e.button !== undefined && e.button !== 0) return;
    const [x, y] = local(e); st.drag = { x, y, t: performance.now(), lon: st.lon0, lat: st.lat0 }; st.vLon = st.vLat = 0; st.target = null;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    canvas.classList.add('dragging'); kick();
  };
  const onMove = e => {
    const [x, y] = local(e);
    if (st.drag) {
      const R = Math.min(st.w, st.h) * 0.42, k = 90 / R, now = performance.now(), d = st.drag;
      const nLon = st.lon0 - (x - d.x) * k, nLat = clampLat(st.lat0 + (y - d.y) * k), dt = Math.max(0.008, (now - d.t) / 1000);
      st.vLon = 0.8 * ((nLon - st.lon0) / dt) + 0.2 * st.vLon; st.vLat = 0.8 * ((nLat - st.lat0) / dt) + 0.2 * st.vLat;
      st.lon0 = nLon; st.lat0 = nLat; d.x = x; d.y = y; d.t = now; setHover(null); kick(); return;
    }
    const hit = st.hit.find(m => (m.x - x) ** 2 + (m.y - y) ** 2 <= m.r * m.r);
    canvas.style.cursor = hit ? 'pointer' : '';
    setHover(hit ? st.locations.find(l => l.country === hit.key) : null, hit);
  };
  const onUp = e => {
    if (!st.drag) return;
    if (performance.now() - st.drag.t > 80) { st.vLon = st.vLat = 0; }
    st.drag = null; canvas.classList.remove('dragging');
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (calm) { st.vLon = st.vLat = 0; }
    kick();
  };
  function setHover(loc, hit) {
    if (loc === st.hoverLoc && !hit) return;
    st.hoverLoc = loc;
    if (opts.onHover) opts.onHover(loc || null, hit ? hit.x : 0, hit ? hit.y : 0);
  }
  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { size(); draw(performance.now()); kick(); }) : null;
  if (ro) ro.observe(canvas);
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(es => { st.visible = es.some(e => e.isIntersecting) && !document.hidden; if (st.visible) kick(); }) : null;
  if (io) io.observe(canvas);
  const onVis = () => { st.visible = !document.hidden; if (st.visible) kick(); };
  document.addEventListener('visibilitychange', onVis);
  size(); draw(performance.now()); kick();

  return {
    setData({ locations = [], home = null } = {}) {
      st.locations = locations.filter(l => isFinite(l.lat) && isFinite(l.lon)); st.home = home && isFinite(home.lat) ? home : null;
      if (!st.didAim && st.locations.length) { // first data: face the busiest location (a little to the side so arcs show)
        st.didAim = true; const l = st.locations[0];
        st.lon0 = l.lon + (st.home ? ((((st.home.lon - l.lon + 540) % 360) - 180) / 2) : 0); st.lat0 = clampLat(l.lat * 0.6);
      }
      draw(performance.now()); kick();
    },
    focus(country) {
      st.focus = country || null;
      const l = country && st.locations.find(x => x.country === country);
      if (l) st.target = { lon: l.lon, lat: clampLat(l.lat) };
      if (l && opts.onHover) {
        // report where the marker will end up (centre of the globe) so a tooltip can follow keyboard focus
        opts.onHover(l, st.w / 2, st.h / 2, true);
      }
      draw(performance.now()); kick();
    },
    redraw() { size(); draw(performance.now()); },
    destroy() {
      st.dead = true; if (st.raf) cancelAnimationFrame(st.raf);
      if (ro) ro.disconnect(); if (io) io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('pointerenter', onEnter); canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    },
    get state() { return { lon0: st.lon0, lat0: st.lat0, running: !!st.raf }; },
  };
}

const clampLat = v => Math.max(-60, Math.min(60, v));
const vec = (lat, lon) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function slerp(a, b, ang, f) {
  const s = Math.sin(ang); if (s < 1e-6) return a;
  const ka = Math.sin((1 - f) * ang) / s, kb = Math.sin(f * ang) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

// Tiny vector icons drawn inside the markers.
function icon(ctx, kind, x, y, r, color) {
  const s = r / 7;
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 1.3 * s); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (r < 6.5) { ctx.beginPath(); ctx.arc(x, y, 1.6 * s, 0, Math.PI * 2); ctx.fill(); return; }
  if (kind === 'user') {
    ctx.beginPath(); ctx.arc(x, y - 1.6 * s, 1.9 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y + 4.4 * s, 3.4 * s, Math.PI * 1.08, Math.PI * 1.92); ctx.fill();
  } else if (kind === 'bag') {
    ctx.beginPath(); ctx.rect(x - 3 * s, y - 1.2 * s, 6 * s, 4.6 * s); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - 1.2 * s, 1.8 * s, Math.PI, 0); ctx.stroke();
  } else { // home: storefront with an awning
    ctx.beginPath(); ctx.moveTo(x - 3.6 * s, y - 1 * s); ctx.lineTo(x - 2.8 * s, y - 3.4 * s); ctx.lineTo(x + 2.8 * s, y - 3.4 * s); ctx.lineTo(x + 3.6 * s, y - 1 * s); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.rect(x - 2.8 * s, y - 0.2 * s, 5.6 * s, 3.6 * s); ctx.stroke();
    ctx.beginPath(); ctx.rect(x - 0.8 * s, y + 1 * s, 1.6 * s, 2.4 * s); ctx.fill();
  }
}
