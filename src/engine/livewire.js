// Magnetic Lasso: live-wire / intelligent-scissors boundary tracing (after Mortensen & Barrett
// 1995). Original implementation.
//
// Cost of the link p→q (integer, so a bucket queue gives O(1) Dijkstra steps):
//   len(p,q) · (1 + KG · fG(q)) + KD · fD(p,q)
//   fG = 1 − min(1, max(0, G − threshold) / scale)  (G = colour Sobel magnitude, max over R,G,B)
//   fD = gradient-direction smoothness term (0 when the link runs along the edge)
// Gradients are computed lazily in 64×64 tiles, so creating a live wire on a large image is cheap.
// Dijkstra runs incrementally from the current anchor inside a window around anchor and cursor;
// once a pixel is settled its path never changes, so moving the cursor costs almost nothing and
// the stable prefix can be "cooled" into automatic anchors (frequency).

const TILE = 64, KG = 40, KD = 18, NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/**
 * @typedef {{ w: number, h: number, data: Uint8ClampedArray }} RGBABuffer
 * @typedef {{
 *   setAnchor(x: number, y: number, opts?: { snap?: boolean }): number[],
 *   pathTo(x: number, y: number): number[][],
 *   autoAnchor(path: number[][]): number[]|null,
 *   removeLastAnchor(): number[]|null,
 *   points(): number[][],
 *   anchors(): number[][],
 *   close(): number[][],
 *   snap(x: number, y: number): number[]
 * }} Livewire
 */

/**
 * Create a live wire over `buf` (usually the flattened composite, document size).
 * width 1..40: detection radius in px (the cursor snaps to the strongest edge within it);
 * contrast 1..100: % edge contrast below which edges are ignored; frequency 1..100: how often
 * autoAnchor() places anchors (higher = more anchors).
 * Coordinates are pixel indices (pixel x covers x..x+1); returned points are integer pixel
 * positions — add 0.5 to draw through pixel centres.
 * @param {RGBABuffer} buf
 * @param {{ width?: number, contrast?: number, frequency?: number }} [opts]
 * @returns {Livewire}
 */
export function createLivewire(buf, { width = 10, contrast = 10, frequency = 57 } = {}) {
  const { w: W, h: H, data } = buf;
  const width_ = Math.min(40, Math.max(1, width)), thr = Math.min(100, Math.max(1, contrast)) / 100 * 1020 * 0.5, scale = Math.max(2 * thr, 300);
  const spacing = 8 + (1 - Math.min(100, Math.max(1, frequency)) / 100) * 192;
  const gx = new Int16Array(W * H), gy = new Int16Array(W * H), tw = Math.ceil(W / TILE), tdone = new Uint8Array(tw * Math.ceil(H / TILE));

  // ---- lazy colour Sobel (per channel, keep the channel with the largest magnitude) ----
  let opaque = true; for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  const src = opaque ? data : (() => { const f = new Uint8ClampedArray(data.length); for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; f[i] = data[i] * a; f[i + 1] = data[i + 1] * a; f[i + 2] = data[i + 2] * a; } return f; })();
  function tile(tx, ty) {
    const t = ty * tw + tx; if (tdone[t]) return; tdone[t] = 1;
    const xe = Math.min(W, tx * TILE + TILE), ye = Math.min(H, ty * TILE + TILE);
    for (let y = ty * TILE; y < ye; y++) {
      const rm = Math.max(0, y - 1) * W * 4, r0 = y * W * 4, rp = Math.min(H - 1, y + 1) * W * 4;
      for (let x = tx * TILE; x < xe; x++) {
        const cm = Math.max(0, x - 1) * 4, c0 = x * 4, cp = Math.min(W - 1, x + 1) * 4;
        let bx = 0, by = 0, bm = -1;
        for (let c = 0; c < 3; c++) {
          const a = src[rm + cm + c], b = src[rm + c0 + c], cc = src[rm + cp + c], d = src[r0 + cm + c], f = src[r0 + cp + c], g = src[rp + cm + c], hh = src[rp + c0 + c], k = src[rp + cp + c];
          const sx = (cc + 2 * f + k) - (a + 2 * d + g), sy = (g + 2 * hh + k) - (a + 2 * b + cc), m = sx * sx + sy * sy;
          if (m > bm) { bm = m; bx = sx; by = sy; }
        }
        gx[y * W + x] = bx; gy[y * W + x] = by;
      }
    }
  }
  function ensure(x0, y0, x1, y1) {
    for (let ty = Math.max(0, Math.floor(y0 / TILE)); ty <= Math.min(Math.ceil(H / TILE) - 1, Math.floor(y1 / TILE)); ty++)
      for (let tx = Math.max(0, Math.floor(x0 / TILE)); tx <= Math.min(tw - 1, Math.floor(x1 / TILE)); tx++) tile(tx, ty);
  }
  const mag = i => Math.hypot(gx[i], gy[i]);
  const clampX = x => Math.min(W - 1, Math.max(0, Math.round(x))), clampY = y => Math.min(H - 1, Math.max(0, Math.round(y)));

  /** Strongest edge (above the contrast threshold) within `width` px of (x,y); else (x,y). */
  function snap(x, y) {
    const cx = clampX(x), cy = clampY(y), r = Math.ceil(width_);
    ensure(cx - r, cy - r, cx + r, cy + r);
    let best = [cx, cy], bs = 0;
    for (let yy = Math.max(0, cy - r); yy <= Math.min(H - 1, cy + r); yy++) for (let xx = Math.max(0, cx - r); xx <= Math.min(W - 1, cx + r); xx++) {
      const d = Math.hypot(xx - cx, yy - cy); if (d > width_) continue;
      const g = mag(yy * W + xx) - thr; if (g <= 0) continue;
      const s = g * (1 - 0.35 * d / width_);
      if (s > bs) { bs = s; best = [xx, yy]; }
    }
    return best;
  }

  // ---- incremental Dijkstra state for the current anchor ----
  let anchorList = [], committed = [], marks = [], st = null, prevPath = null;
  function makeState(ax, ay, tx, ty) {
    const m = Math.max(16, width_ * 2) + 24, span = Math.max(Math.abs(tx - ax), Math.abs(ty - ay));
    const extra = Math.round(Math.min(64, span * 0.15));
    const x0 = Math.max(0, Math.min(ax, tx) - m - extra), y0 = Math.max(0, Math.min(ay, ty) - m - extra);
    const x1 = Math.min(W - 1, Math.max(ax, tx) + m + extra), y1 = Math.min(H - 1, Math.max(ay, ty) + m + extra);
    ensure(x0, y0, x1, y1);
    const ww = x1 - x0 + 1, wh = y1 - y0 + 1, n = ww * wh;
    const fG = new Float32Array(n), Dx = new Float32Array(n), Dy = new Float32Array(n);
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const i = (y0 + y) * W + x0 + x, k = y * ww + x, g = mag(i);
      fG[k] = 1 - Math.min(1, Math.max(0, g - thr) / scale);
      if (g > 1e-6) { Dx[k] = gy[i] / g; Dy[k] = -gx[i] / g; }
    }
    const dist = new Int32Array(n).fill(0x7fffffff), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const C = Math.ceil(Math.SQRT2 * (1 + KG) + KD) + 2, buckets = Array.from({ length: C }, () => []);
    const s = (ay - y0) * ww + ax - x0; dist[s] = 0; buckets[0].push(s);
    return { x0, y0, x1, y1, ww, wh, fG, Dx, Dy, dist, prev, done, buckets, C, cur: 0, count: 1, ax, ay };
  }
  function expandUntil(S, target) {
    const { ww, wh, fG, Dx, Dy, dist, prev, done, buckets, C } = S;
    while (!done[target] && S.count > 0) {
      let bk = buckets[S.cur % C];
      while (!bk.length) { S.cur++; bk = buckets[S.cur % C]; }
      const p = bk.pop(); S.count--;
      if (done[p] || dist[p] !== S.cur) continue;
      done[p] = 1;
      const px = p % ww, py = (p / ww) | 0, dpx = Dx[p], dpy = Dy[p], base = dist[p];
      for (let k = 0; k < 8; k++) {
        const nx = px + NB[k][0], ny = py + NB[k][1];
        if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue;
        const q = ny * ww + nx; if (done[q]) continue;
        const diag = k >= 4, len = diag ? Math.SQRT2 : 1;
        let lx = NB[k][0] / len, ly = NB[k][1] / len, dp = dpx * lx + dpy * ly;
        if (dp < 0) { dp = -dp; lx = -lx; ly = -ly; }
        const dq = lx * Dx[q] + ly * Dy[q];
        const fD = (dpx === 0 && dpy === 0) || (Dx[q] === 0 && Dy[q] === 0) ? 0.67 : ((1 - dp) + (1 - dq)) / 3;
        const nd = base + Math.round(len * (1 + KG * fG[q]) + KD * fD);
        if (nd < dist[q]) { dist[q] = nd; prev[q] = p; buckets[nd % C].push(q); S.count++; }
      }
    }
  }
  function pathFromAnchor(tx, ty) {
    const a = anchorList[anchorList.length - 1];
    if (!st || tx < st.x0 || ty < st.y0 || tx > st.x1 || ty > st.y1) st = makeState(a[0], a[1], tx, ty);
    const t = (ty - st.y0) * st.ww + tx - st.x0;
    expandUntil(st, t);
    const out = [];
    for (let k = t; k >= 0; k = st.prev[k]) out.push([st.x0 + k % st.ww, st.y0 + ((k / st.ww) | 0)]);
    return out.reverse();
  }

  return {
    snap,
    /** Place an anchor (snapped to the nearest strong edge unless snap:false). Commits the path from the previous anchor. Returns the anchor [x,y]. */
    setAnchor(x, y, { snap: doSnap = true } = {}) {
      const p = doSnap ? snap(x, y) : [clampX(x), clampY(y)];
      if (anchorList.length) { const seg = pathFromAnchor(p[0], p[1]); committed.push(...seg.slice(1)); }
      else committed.push(p);
      anchorList.push(p); marks.push(committed.length); st = null; prevPath = null;
      return p;
    },
    /** Live segment from the last anchor to the (snapped) cursor: [[x,y], ...] (starts at the anchor). */
    pathTo(x, y) {
      if (!anchorList.length) return [snap(x, y)];
      const p = snap(x, y);
      return pathFromAnchor(p[0], p[1]);
    },
    /**
     * Path cooling: returns [x, y, index] — a point of `path` (the latest pathTo result) that has
     * stayed identical since the previous call and lies ≥ spacing(frequency) px along the path —
     * or null. The host then calls setAnchor(x, y, { snap: false }).
     */
    autoAnchor(path) {
      const prevP = prevPath; prevPath = path;
      if (!prevP || path.length < 2) return null;
      let k = 0; while (k < path.length && k < prevP.length && path[k][0] === prevP[k][0] && path[k][1] === prevP[k][1]) k++;
      let acc = 0;
      for (let i = 1; i < k; i++) {
        acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        if (acc >= spacing && i < path.length - 1) return [path[i][0], path[i][1], i];
      }
      return null;
    },
    /** Undo the last anchor (Backspace). Returns the new last anchor or null. */
    removeLastAnchor() {
      if (!anchorList.length) return null;
      anchorList.pop(); marks.pop(); committed.length = marks.length ? marks[marks.length - 1] : 0; st = null; prevPath = null;
      return anchorList[anchorList.length - 1] || null;
    },
    /** Committed polyline so far (anchors and the traced paths between them). */
    points: () => committed.map(p => [...p]),
    anchors: () => anchorList.map(p => [...p]),
    /** Trace back to the first anchor and return the closed polygon (first point not repeated); resets the wire. */
    close() {
      if (anchorList.length > 1) {
        const f = anchorList[0], seg = pathFromAnchor(f[0], f[1]);
        committed.push(...seg.slice(1, -1));
      }
      const poly = committed.map(p => [...p]);
      anchorList = []; committed = []; marks = []; st = null; prevPath = null;
      return poly;
    },
  };
}
