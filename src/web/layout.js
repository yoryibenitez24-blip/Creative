// Pure layout helpers for the Web / UI workspace. No DOM, no React: runs in Node tests and workers.
//
//   computeAutoLayout(container, items) -> { w, h, items: [{ x, y, w, h }] }
//   applyConstraints(child, oldParent, newParent) -> { x, y, w, h }
//   wrapText(text, maxWidth, measure) -> string[]
//   ALIGNS: the nine alignment keys ('top-left' … 'bottom-right', 'center' is the middle one)

export const ALIGNS = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'];

/** 'top-right' -> { v: 'start', h: 'end' } (start / center / end on each axis). */
export function alignParts(align = 'top-left') {
  const i = Math.max(0, ALIGNS.indexOf(align));
  const k = ['start', 'center', 'end'];
  return { v: k[Math.floor(i / 3)], h: k[i % 3] };
}

/** Padding may be a number, [t, r, b, l] or { top, right, bottom, left }. */
export function padArray(p) {
  if (Array.isArray(p)) return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] || 0];
  if (p && typeof p === 'object') return [p.top || 0, p.right || 0, p.bottom || 0, p.left || 0];
  const n = +p || 0; return [n, n, n, n];
}

const place = (mode, free) => mode === 'center' ? free / 2 : mode === 'end' ? free : 0;

/**
 * Auto layout (flexbox-like) for one container.
 *
 * container: { w, h, direction: 'horizontal'|'vertical', gap, padding, align (9-point key),
 *              sizingW: 'fixed'|'hug', sizingH: 'fixed'|'hug', wrap: bool, wrapGap (cross-axis gap between lines,
 *              defaults to gap), distribute: 'packed'|'space-between' }
 * items:     [{ w, h, sizingW: 'fixed'|'hug'|'fill', sizingH, visible, absolute, x, y }]
 *            w/h are the item's own (intrinsic) size. 'hug' items keep their size here (their content was already
 *            measured); 'fill' items take the remaining main-axis space or stretch on the cross axis.
 *            A 'fill' item on an axis where the container hugs behaves as fixed. Hidden and absolute items do not
 *            take part in the flow; absolute items keep their x/y.
 * Returns the container size and one box per input item (same order).
 */
export function computeAutoLayout(container, items) {
  const horiz = container.direction !== 'vertical';
  const [pt, pr, pb, pl] = padArray(container.padding);
  const gap = +container.gap || 0;
  const wrap = !!container.wrap;
  const lineGap = container.wrapGap != null ? +container.wrapGap : gap;
  const { v, h } = alignParts(container.align);
  const alignMain = horiz ? h : v, alignCross = horiz ? v : h;
  const M = horiz ? 'w' : 'h', X = horiz ? 'h' : 'w';
  const sizingMain = (horiz ? container.sizingW : container.sizingH) === 'hug' ? 'hug' : 'fixed';
  const sizingCross = (horiz ? container.sizingH : container.sizingW) === 'hug' ? 'hug' : 'fixed';
  const padMain0 = horiz ? pl : pt, padMain1 = horiz ? pr : pb, padCross0 = horiz ? pt : pl, padCross1 = horiz ? pb : pr;
  const itemMainSizing = it => (horiz ? it.sizingW : it.sizingH) || 'fixed';
  const itemCrossSizing = it => (horiz ? it.sizingH : it.sizingW) || 'fixed';
  const isFillMain = it => itemMainSizing(it) === 'fill' && sizingMain !== 'hug';
  const isFillCross = it => itemCrossSizing(it) === 'fill' && sizingCross !== 'hug';

  const out = items.map(it => ({ x: +it.x || 0, y: +it.y || 0, w: Math.max(0, +it.w || 0), h: Math.max(0, +it.h || 0) }));
  const flow = items.map((it, i) => i).filter(i => items[i].visible !== false && !items[i].absolute);
  const containerMain = horiz ? +container.w || 0 : +container.h || 0;
  const availMain0 = containerMain - padMain0 - padMain1;

  // 1. break into lines (only when wrapping with a fixed main size)
  let lines = [flow];
  if (wrap && sizingMain !== 'hug') {
    lines = []; let cur = [], used = 0;
    for (const i of flow) {
      const s = out[i][M];
      if (cur.length && used + gap + s > availMain0 + 1e-6) { lines.push(cur); cur = []; used = 0; }
      used += (cur.length ? gap : 0) + s; cur.push(i);
    }
    if (cur.length || !lines.length) lines.push(cur);
  }

  // 2. main sizes per line (fill items share what is left)
  const lineInfo = lines.map(line => {
    const fixed = line.filter(i => !isFillMain(items[i])).reduce((a, i) => a + out[i][M], 0);
    const nFill = line.filter(i => isFillMain(items[i])).length;
    const gaps = gap * Math.max(0, line.length - 1);
    if (nFill) {
      const each = Math.max(0, (availMain0 - fixed - gaps) / nFill);
      for (const i of line) if (isFillMain(items[i])) out[i][M] = each;
    }
    const content = line.reduce((a, i) => a + out[i][M], 0) + gaps;
    const cross = line.reduce((a, i) => isFillCross(items[i]) ? a : Math.max(a, out[i][X]), 0);
    return { line, content, cross };
  });

  // 3. container size
  const mainSize = sizingMain === 'hug' ? Math.max(0, ...lineInfo.map(l => l.content)) + padMain0 + padMain1 : containerMain;
  const crossContent = lineInfo.reduce((a, l) => a + l.cross, 0) + lineGap * Math.max(0, lineInfo.length - 1);
  const crossSize = sizingCross === 'hug' ? crossContent + padCross0 + padCross1 : (horiz ? +container.h || 0 : +container.w || 0);
  const availMain = mainSize - padMain0 - padMain1, availCross = crossSize - padCross0 - padCross1;
  const single = lineInfo.length <= 1 && !(wrap && sizingMain !== 'hug');

  // 4. positions
  let crossCursor = padCross0 + (single ? 0 : place(alignCross, availCross - crossContent));
  for (const li of lineInfo) {
    const lineCross = single ? availCross : li.cross;
    for (const i of li.line) if (isFillCross(items[i])) out[i][X] = Math.max(0, lineCross);
    let g = gap, mainCursor = padMain0;
    if (container.distribute === 'space-between' && sizingMain !== 'hug' && li.line.length > 1) {
      g = (availMain - (li.content - gap * (li.line.length - 1))) / (li.line.length - 1);
    } else mainCursor += place(alignMain, availMain - li.content);
    for (const i of li.line) {
      const b = out[i];
      const c = crossCursor + place(alignCross, lineCross - b[X]);
      if (horiz) { b.x = mainCursor; b.y = c; } else { b.y = mainCursor; b.x = c; }
      mainCursor += b[M] + g;
    }
    crossCursor += li.cross + lineGap;
  }
  return horiz ? { w: mainSize, h: crossSize, items: out } : { w: crossSize, h: mainSize, items: out };
}

/**
 * Constraints for a child of a (non auto layout) frame that changes size from oldP {w,h} to newP {w,h}.
 * child: { x, y, w, h, constraints: { h: 'left'|'right'|'left-right'|'center'|'scale', v: 'top'|'bottom'|'top-bottom'|'center'|'scale' } }
 */
export function applyConstraints(child, oldP, newP) {
  const c = child.constraints || {};
  const axis = (pos, size, oldS, newS, mode) => {
    const d = newS - oldS;
    switch (mode) {
      case 'right': case 'bottom': return [pos + d, size];
      case 'left-right': case 'top-bottom': return [pos, Math.max(0, size + d)];
      case 'center': return [pos + d / 2, size];
      case 'scale': { const k = oldS ? newS / oldS : 1; return [pos * k, size * k]; }
      default: return [pos, size];
    }
  };
  const [x, w] = axis(child.x, child.w, oldP.w, newP.w, c.h || 'left');
  const [y, h] = axis(child.y, child.h, oldP.h, newP.h, c.v || 'top');
  return { x, y, w, h };
}

/** Greedy word wrap. measure(str) -> width in px. maxWidth = Infinity for a single line per paragraph. */
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!(maxWidth < Infinity)) { lines.push(para); continue; }
    const words = para.split(/(\s+)/).filter(s => s !== '');
    let cur = '';
    for (const wd of words) {
      const next = cur + wd;
      if (cur === '' || measure(next.replace(/\s+$/, '')) <= maxWidth + 0.01) { cur = next; continue; }
      if (/^\s+$/.test(wd)) { lines.push(cur.replace(/\s+$/, '')); cur = ''; continue; }
      lines.push(cur.replace(/\s+$/, '')); cur = '';
      // break a word that alone is too long
      let w = wd;
      while (measure(w) > maxWidth && w.length > 1) {
        let n = w.length - 1; while (n > 1 && measure(w.slice(0, n)) > maxWidth) n--;
        lines.push(w.slice(0, n)); w = w.slice(n);
      }
      cur = w;
    }
    lines.push(cur.replace(/\s+$/, ''));
  }
  return lines;
}
