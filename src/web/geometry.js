// 2D affine geometry for the web design document: node transforms, bounding boxes and hit-testing.
// Matrices are [a, b, c, d, e, f] (x' = a*x + c*y + e, y' = b*x + d*y + f). Pure JS.

export const I = [1, 0, 0, 1, 0, 0];
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
/** Transform a vector (no translation). */
export const applyVec = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y];

/** Local matrix of a node inside its parent: translate(x, y), rotate `rotation` degrees about the box centre. */
export function localMatrix(n) {
  const r = (n.rotation || 0) * Math.PI / 180;
  if (!r) return [1, 0, 0, 1, n.x || 0, n.y || 0];
  const cos = Math.cos(r), sin = Math.sin(r), cx = (n.w || 0) / 2, cy = (n.h || 0) / 2;
  return [cos, sin, -sin, cos, (n.x || 0) + cx - cos * cx + sin * cy, (n.y || 0) + cy - sin * cx - cos * cy];
}

/** Absolute (canvas / world) matrix of a node. */
export function absMatrix(nodes, id) {
  const chain = [];
  for (let n = nodes[id]; n; n = n.parent ? nodes[n.parent] : null) chain.push(n);
  let m = I;
  for (let i = chain.length - 1; i >= 0; i--) m = mul(m, localMatrix(chain[i]));
  return m;
}
export const parentMatrix = (nodes, id) => nodes[id]?.parent ? absMatrix(nodes, nodes[id].parent) : I;

/** Axis-aligned bounds of a node in world space: { x, y, w, h }. */
export function absBounds(nodes, id) {
  const n = nodes[id]; if (!n) return { x: 0, y: 0, w: 0, h: 0 };
  return boundsOf(absMatrix(nodes, id), n.w, n.h);
}
export function boundsOf(m, w, h) {
  const pts = [apply(m, 0, 0), apply(m, w, 0), apply(m, w, h), apply(m, 0, h)];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function unionBounds(list) {
  if (!list.length) return null;
  const x = Math.min(...list.map(b => b.x)), y = Math.min(...list.map(b => b.y));
  return { x, y, w: Math.max(...list.map(b => b.x + b.w)) - x, h: Math.max(...list.map(b => b.y + b.h)) - y };
}
export const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

/** Is local point (lx, ly) inside the node's shape? tol = extra tolerance in local px (for thin lines). */
export function insideShape(n, lx, ly, tol = 0) {
  if (n.type === 'line') return lx >= -tol && lx <= n.w + tol && Math.abs(ly) <= Math.max(tol, (n.strokeWidth || 1) / 2);
  if (n.type === 'ellipse') {
    const rx = n.w / 2, ry = n.h / 2; if (rx <= 0 || ry <= 0) return false;
    const dx = (lx - rx) / rx, dy = (ly - ry) / ry; return dx * dx + dy * dy <= 1;
  }
  return lx >= 0 && ly >= 0 && lx <= n.w && ly <= n.h;
}

/**
 * Deepest visible, unlocked node under world point (wx, wy). Respects rotation (inverse transforms) and clipping
 * (a frame with clip=true hides children outside its box). Groups are hit only through their children.
 * Returns the path of ids from the top-level node down to the hit node, or [] when nothing is hit.
 * opts.tol: tolerance in world px (for lines); opts.skip: Set of ids to ignore (with their subtrees).
 */
export function hitTest(doc, wx, wy, opts = {}) {
  const nodes = doc.nodes, tolW = opts.tol ?? 4, skip = opts.skip;
  const visit = (id, pm) => {
    const n = nodes[id];
    if (!n || n.visible === false || n.locked || skip?.has(id)) return null;
    const m = mul(pm, localMatrix(n));
    const inv = invert(m);
    const [lx, ly] = apply(inv, wx, wy);
    const scale = Math.hypot(m[0], m[1]) || 1;
    const inside = insideShape(n, lx, ly, tolW / scale);
    if (n.children?.length && !(n.type === 'frame' && n.clip && !inside)) {
      for (let i = n.children.length - 1; i >= 0; i--) {
        const p = visit(n.children[i], m); if (p) return [id, ...p];
      }
    }
    if (n.type !== 'group' && inside) return [id];
    return null;
  };
  for (let i = doc.root.length - 1; i >= 0; i--) { const p = visit(doc.root[i], I); if (p) return p; }
  return [];
}
