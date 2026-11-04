// Tool registry. Every enabled tool names the capability-ledger rows it relies on;
// tests/ledger.test.js fails if any of them is still `missing`, `partial` without
// evidence, or `blocked`. Add a tool here only after its ledger rows are implemented.

export const TOOLS = [
  { id: 'move', label: 'Move', key: 'V', ledger: ['MOVE-001'] },
  { id: 'hand', label: 'Hand', key: 'H', ledger: ['NAV-PAN-001'] },
  { id: 'marquee', label: 'Marquee', key: 'M', ledger: ['SEL-MARQ-RECT', 'SEL-MARQ-ELLI', 'SEL-MODE-NEW', 'SEL-MODE-ADD', 'SEL-MODE-SUB', 'SEL-MODE-INT', 'SEL-FEATHER-OPT'] },
  { id: 'lasso', label: 'Lasso', key: 'L', ledger: ['SEL-LASSO-FREE', 'SEL-LASSO-POLY'] },
  { id: 'brush', label: 'Brush', key: 'B', ledger: ['PAINT-BRUSH', 'BRUSH-SIZE', 'BRUSH-HARD', 'BRUSH-OPAC', 'BRUSH-FLOW', 'BRUSH-SPACE', 'BRUSH-SMOOTH', 'BRUSH-PRESS-SIZE', 'BRUSH-PRESS-FLOW', 'MASK-PAINT'] },
  { id: 'eraser', label: 'Eraser', key: 'E', ledger: ['PAINT-ERASER', 'MASK-PAINT'] },
];

export const SHAPE_TOOLS = { marquee: ['rect', 'ellipse'], lasso: ['free', 'polygon'] };

export function modeFromModifiers(base, e) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return base;
}
