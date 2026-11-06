// Content-Aware Fill: coarse-to-fine patch-based synthesis (PatchMatch nearest-neighbour search
// + patch voting, after Barnes et al. 2009 / Wexler et al. 2007). Original implementation.
// Missing pixels (hole mask > 127) are rebuilt from patches of the known region (optionally
// restricted by a sampling mask). Deterministic for a given seed.

import { rng } from './color.js';

const P = 3; // patch radius (7×7 patches)

function downsample(img, w, h, hole) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), o = new Float32Array(nw * nh * 3), oh = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let r = 0, g = 0, b = 0, n = 0, holes = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const sx = Math.min(w - 1, x * 2 + i), sy = Math.min(h - 1, y * 2 + j), k = sy * w + sx; if (hole[k]) { holes++; continue; } r += img[k * 3]; g += img[k * 3 + 1]; b += img[k * 3 + 2]; n++; }
    const k = y * nw + x; if (n) { o[k * 3] = r / n; o[k * 3 + 1] = g / n; o[k * 3 + 2] = b / n; } oh[k] = holes > 0 ? 1 : 0;
  }
  return { img: o, w: nw, h: nh, hole: oh };
}

/**
 * buf: RGBA {w,h,data}; hole: Uint8Array(w*h) (>127 = fill); source: optional Uint8Array (>127 = may sample).
 * Returns a new RGBA buffer with the hole filled (alpha of filled pixels = 255).
 */
export function contentAwareFill(buf, hole, { source = null, seed = 1, iterations = 5 } = {}) {
  const { w, h, data } = buf, N = w * h, rand = rng(seed);
  const img0 = new Float32Array(N * 3), H0 = new Uint8Array(N);
  let any = false;
  for (let i = 0; i < N; i++) { img0[i * 3] = data[i * 4]; img0[i * 3 + 1] = data[i * 4 + 1]; img0[i * 3 + 2] = data[i * 4 + 2]; H0[i] = hole[i] > 127 ? 1 : 0; if (H0[i]) any = true; }
  if (!any) return { w, h, data: new Uint8ClampedArray(data) };
  // pyramid
  const levels = [{ img: img0, w, h, hole: H0 }];
  const countOk = L => { let n = 0; for (let y = P; y < L.h - P; y++) for (let x = P; x < L.w - P; x++) { let ok = true; for (let j = -P; j <= P && ok; j++) for (let i = -P; i <= P; i++) if (L.hole[(y + j) * L.w + x + i]) { ok = false; break; } if (ok && ++n >= 64) return n; } return n; };
  while (levels.length < 7) { const L = levels.at(-1); if (L.w < 24 || L.h < 24) break; const next = downsample(L.img, L.w, L.h, L.hole); if (countOk(next) < 64) break; levels.push(next); }
  const srcOk = (L, x, y, lvl) => {
    if (x < P || y < P || x >= L.w - P || y >= L.h - P) return false;
    for (let j = -P; j <= P; j++) for (let i = -P; i <= P; i++) if (L.hole[(y + j) * L.w + x + i]) return false;
    if (source && lvl === 0 && source[y * L.w + x] <= 127) return false;
    return true;
  };
  let nnf = null, prevW = 0, prevH = 0;
  for (let lvl = levels.length - 1; lvl >= 0; lvl--) {
    const L = levels[lvl], { w: lw, h: lh } = L, img = Float32Array.from(L.img);
    // candidate source centres
    const cands = []; for (let y = P; y < lh - P; y++) for (let x = P; x < lw - P; x++) if (srcOk(L, x, y, lvl)) cands.push(y * lw + x);
    if (!cands.length) throw Error('Not enough surrounding pixels to sample from');
    const valid = new Uint8Array(lw * lh); for (const c of cands) valid[c] = 1;
    // initial target: coarsest level → mean of known colours; finer → upsampled from previous result
    if (lvl === levels.length - 1) {
      let m = [0, 0, 0], n = 0; for (let i = 0; i < lw * lh; i++) if (!L.hole[i]) { m[0] += img[i * 3]; m[1] += img[i * 3 + 1]; m[2] += img[i * 3 + 2]; n++; }
      m = m.map(v => v / Math.max(1, n)); for (let i = 0; i < lw * lh; i++) if (L.hole[i]) img.set(m, i * 3);
    } else {
      const up = levels[lvl + 1].res; for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) { const i = y * lw + x; if (!L.hole[i]) continue; const k = Math.min(prevH - 1, y >> 1) * prevW + Math.min(prevW - 1, x >> 1); img[i * 3] = up[k * 3]; img[i * 3 + 1] = up[k * 3 + 1]; img[i * 3 + 2] = up[k * 3 + 2]; }
    }
    // pixels to synthesise: hole dilated by the patch radius (their patches overlap the hole)
    const targets = []; for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) { let near = false; for (let j = -P; j <= P && !near; j++) for (let i = -P; i <= P; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < lw && yy < lh && L.hole[yy * lw + xx]) { near = true; break; } } if (near) targets.push(y * lw + x); }
    const field = new Int32Array(lw * lh).fill(-1);
    for (const t of targets) {
      let s = -1;
      if (nnf) { const x = t % lw, y = (t / lw) | 0, k = Math.min(prevH - 1, y >> 1) * prevW + Math.min(prevW - 1, x >> 1), ps = nnf[k]; if (ps >= 0) { const sx = Math.min(lw - P - 1, (ps % prevW) * 2 + (x & 1)), sy = Math.min(lh - P - 1, ((ps / prevW) | 0) * 2 + (y & 1)), c = sy * lw + sx; if (valid[c]) s = c; } }
      field[t] = s >= 0 ? s : cands[Math.floor(rand() * cands.length)];
    }
    const dist = (t, s, best) => { const tx = t % lw, ty = (t / lw) | 0, sx = s % lw, sy = (s / lw) | 0; let d = 0; for (let j = -P; j <= P; j++) { const yy = ty + j; if (yy < 0 || yy >= lh) continue; for (let i = -P; i <= P; i++) { const xx = tx + i; if (xx < 0 || xx >= lw) continue; const a = (yy * lw + xx) * 3, b = ((sy + j) * lw + sx + i) * 3; d += (img[a] - img[b]) ** 2 + (img[a + 1] - img[b + 1]) ** 2 + (img[a + 2] - img[b + 2]) ** 2; if (d > best) return d; } } return d; };
    const its = lvl === 0 ? iterations : iterations + 2;
    for (let it = 0; it < its; it++) {
      const cost = new Float64Array(targets.length);
      targets.forEach((t, k) => { cost[k] = dist(t, field[t], Infinity); });
      const order = it % 2 ? [...targets.keys()].reverse() : [...targets.keys()], step = it % 2 ? 1 : -1;
      for (const k of order) {
        const t = targets[k]; let best = field[t], bc = cost[k];
        // propagation from left/up (or right/down) neighbours
        for (const nb of [t + step, t + step * lw]) { if (nb < 0 || nb >= lw * lh || field[nb] < 0) continue; const c = field[nb] - step; if (c >= 0 && valid[c]) { const d = dist(t, c, bc); if (d < bc) { bc = d; best = c; } } }
        // random search
        let r = Math.max(lw, lh); const bx = best % lw, by = (best / lw) | 0;
        while (r >= 1) { const cx = Math.round(bx + (rand() * 2 - 1) * r), cy = Math.round(by + (rand() * 2 - 1) * r); if (cx >= 0 && cy >= 0 && cx < lw && cy < lh) { const c = cy * lw + cx; if (valid[c]) { const d = dist(t, c, bc); if (d < bc) { bc = d; best = c; } } } r = Math.floor(r / 2); }
        field[t] = best; cost[k] = bc;
      }
      // voting: each hole pixel = weighted mean of the overlapping source patches' pixels
      const acc = new Float64Array(lw * lh * 4);
      for (const t of targets) { const s = field[t], tx = t % lw, ty = (t / lw) | 0, sx = s % lw, sy = (s / lw) | 0, wgt = 1; for (let j = -P; j <= P; j++) for (let i = -P; i <= P; i++) { const xx = tx + i, yy = ty + j; if (xx < 0 || yy < 0 || xx >= lw || yy >= lh) continue; const q = yy * lw + xx; if (!L.hole[q]) continue; const b = ((sy + j) * lw + sx + i) * 3; acc[q * 4] += img[b] * wgt; acc[q * 4 + 1] += img[b + 1] * wgt; acc[q * 4 + 2] += img[b + 2] * wgt; acc[q * 4 + 3] += wgt; } }
      for (let q = 0; q < lw * lh; q++) if (L.hole[q] && acc[q * 4 + 3]) { img[q * 3] = acc[q * 4] / acc[q * 4 + 3]; img[q * 3 + 1] = acc[q * 4 + 1] / acc[q * 4 + 3]; img[q * 3 + 2] = acc[q * 4 + 2] / acc[q * 4 + 3]; }
    }
    L.res = img; nnf = field; prevW = lw; prevH = lh;
  }
  const out = new Uint8ClampedArray(data), res = levels[0].res;
  for (let i = 0; i < N; i++) if (H0[i]) { out[i * 4] = res[i * 3]; out[i * 4 + 1] = res[i * 3 + 1]; out[i * 4 + 2] = res[i * 3 + 2]; out[i * 4 + 3] = 255; }
  return { w, h, data: out };
}
