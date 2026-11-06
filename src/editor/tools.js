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
  { id: 'wand', label: 'Magic Wand', key: 'W', ledger: ['SEL-WAND', 'SEL-MODE-ADD'] },
  { id: 'crop', label: 'Crop', key: 'C', ledger: ['CROP-TOOL', 'CROP-RATIO'] },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', ledger: ['NAV-EYEDROPPER'] },
  { id: 'heal', label: 'Healing', key: 'J', ledger: ['RETOUCH-SPOT-HEAL', 'RETOUCH-HEAL'] },
  { id: 'clone', label: 'Clone Stamp', key: 'S', ledger: ['RETOUCH-CLONE', 'RETOUCH-CLONE-ALIGN'] },
  { id: 'fill', label: 'Gradient / Paint Bucket', key: 'G', ledger: ['PAINT-BUCKET', 'GRAD-LINEAR', 'GRAD-RADIAL', 'GRAD-ANGLE', 'GRAD-REFLECTED', 'GRAD-DIAMOND', 'GRAD-REVERSE', 'GRAD-DITHER'] },
  { id: 'focus', label: 'Blur / Sharpen / Smudge', key: '', ledger: ['RETOUCH-BLUR', 'RETOUCH-SHARPEN', 'RETOUCH-SMUDGE'] },
  { id: 'tone', label: 'Dodge / Burn / Sponge', key: 'O', ledger: ['RETOUCH-DODGE', 'RETOUCH-BURN', 'RETOUCH-SPONGE'] },
  { id: 'pencil', label: 'Pencil (Brush variant)', key: 'B', ledger: ['PAINT-PENCIL'] },
  { id: 'zoom', label: 'Zoom', key: 'Z', ledger: ['NAV-ZOOM-TOOL', 'NAV-ZOOM-SCRUB'] },
];

export const SHAPE_TOOLS = { marquee: ['rect', 'ellipse'], lasso: ['free', 'polygon'] };

export function modeFromModifiers(base, e) {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return base;
}
