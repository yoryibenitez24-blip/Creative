// Mapping from the delivered gap inventory (docs/baseline/INVENTARIO_BRECHAS.csv, Spanish)
// to capability-ledger rows. Key = "Area|Capacidad" exactly as in the CSV.
// `why` explains where the ledger state intentionally differs from the inventory state.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildRows, STATES } from './source.mjs';

export const INVENTORY_MAP = {
  'Documentos|Pestañas y guardado local': { ids: ['DOC-TABS', 'DOC-AUTOSAVE', 'DOC-TAB-CLOSE', 'DOC-ATOMIC', 'CMD-HISTORY-PERSIST', 'DOC-ASSET-CAS', 'DOC-NATIVE-ENV'] },
  'Capas|Rectángulo, elipse, texto e imagen': { ids: ['VEC-RECT', 'VEC-ELLIPSE', 'TEXT-POINT', 'FILE-IMAGE-IMPORT', 'DOC-ASSET-IMAGE', 'RENDER-TILES', 'RENDER-RASTER-SURF'] },
  'Capas|Grupos': { ids: ['LAYER-GROUPS', 'LAYER-GROUP-ISOLATED', 'LAYER-GROUP-PASSTHROUGH', 'PSD-IMPORT-GROUPS'] },
  'Capas|Blend modes': { ids: ['BLEND-NORMAL', 'BLEND-MULTIPLY', 'BLEND-SCREEN', 'BLEND-OVERLAY', 'BLEND-DARKEN', 'BLEND-LIGHTEN', 'BLEND-DIFFERENCE', 'BLEND-COLOR-DODGE', 'BLEND-SOFT-LIGHT', 'BLEND-HUE', 'BLEND-UI-COMPLETE'] },
  'Capas|Máscaras raster/vector y clipping': { ids: ['MASK-RASTER', 'MASK-VECTOR', 'LAYER-CLIPPING', 'PSD-IMPORT-MASKS', 'PSD-IMPORT-CLIP'] },
  'Capas|Ajustes y estilos': { ids: ['ADJ-LEVELS', 'ADJ-CURVES', 'FX-DROP', 'FX-STROKE', 'FX-BLEND-IF', 'SMART-SF-STACK', 'PSD-IMPORT-FX', 'PSD-IMPORT-ADJ'] },
  'Pintura|Pincel, lápiz, borradores y mixer': { ids: ['PAINT-BRUSH', 'PAINT-ERASER', 'PAINT-PENCIL', 'PAINT-BG-ERASER', 'PAINT-MAGIC-ERASER', 'PAINT-MIXER', 'BRUSH-PRESS-SIZE', 'BRUSH-SHAPE-DYN', 'CMD-UNDO-STROKE'], why: 'Brush and eraser are now implemented; pencil, background/magic eraser, mixer and dynamics remain missing.' },
  'Selección|Marquee, lazos y varita': { ids: ['SEL-MARQ-RECT', 'SEL-MARQ-ELLI', 'SEL-LASSO-FREE', 'SEL-LASSO-POLY', 'SEL-LASSO-MAG', 'SEL-WAND', 'SEL-QUICK', 'SEL-FEATHER-OPT', 'SAM-EDGE-BRUSH'], why: 'Marquee and lassos with pixel selection masks are now implemented; wand, magnetic lasso, quick selection and refinement remain missing.' },
  'Retoque|Clone, heal, patch, remove': { ids: ['RETOUCH-CLONE', 'RETOUCH-HEAL', 'RETOUCH-SPOT-HEAL', 'RETOUCH-PATCH', 'RETOUCH-REMOVE', 'RETOUCH-NONDESTRUCT'] },
  'Transformación|Mover, tamaño, rotación': { ids: ['MOVE-001', 'XFORM-SCALE', 'XFORM-ROTATE', 'XFORM-PERSPECTIVE', 'XFORM-WARP', 'XFORM-PUPPET', 'CROP-TOOL'] },
  'Texto|Tipografía editable': { ids: ['TEXT-POINT', 'TEXT-FONT-LOAD', 'TEXT-RUNS', 'TEXT-PARA', 'TEXT-RTL', 'TEXT-ON-PATH'] },
  'Vectores|Pluma, curvas y formas avanzadas': { ids: ['VEC-PEN', 'VEC-CURVATURE', 'VEC-BOOLEAN', 'VEC-POLYGON', 'MASK-VECTOR'] },
  'Filtros|Galería propia': { ids: ['FILT-LEGACY-PANEL', 'FILT-LEG-PRESETS', 'FILT-STACK', 'FILT-THUMBS'] },
  'Develop|Exposición y controles tonales': { ids: ['FILT-LEG-EXPOSURE', 'FILT-LEG-CONTRAST', 'FILT-LEG-HIGHLIGHTS', 'FILT-LEG-SHADOWS', 'FILT-LEG-WHITES', 'FILT-LEG-BLACKS', 'DEV-LIGHT-EXPOSURE', 'DEV-LIGHT-HIGHLIGHTS', 'COLOR-LINEAR'], why: 'The inventory counts the legacy gallery sliders as partial Develop. The ledger keeps them as FILT-LEG-* (partial) and leaves DEV-LIGHT-* missing until a validated linear-light Develop pipeline exists.' },
  'Develop|Temperatura, tint, vibrance, saturation': { ids: ['FILT-LEG-TEMPERATURE', 'FILT-LEG-TINT', 'FILT-LEG-VIBRANCE', 'FILT-LEG-SATURATION', 'DEV-COLOR-TEMP', 'DEV-COLOR-TINT', 'DEV-COLOR-PROFILE', 'RAW-CAM-WB'], why: 'Same split: legacy sliders partial, Develop white balance and profiles missing.' },
  'Develop|Texture': { ids: ['DEV-EFFECTS-TEXTURE', 'FILT-LEG-FADE'] },
  'Develop|Clarity': { ids: ['DEV-EFFECTS-CLARITY'] },
  'Develop|Dehaze': { ids: ['DEV-EFFECTS-DEHAZE'] },
  'Develop|Grain': { ids: ['FILT-LEG-GRAIN', 'DEV-EFFECTS-LEGACY-GRAIN', 'DEV-EFFECTS-GRAIN-AMOUNT', 'DEV-EFFECTS-GRAIN-SIZE', 'DEV-EFFECTS-GRAIN-ROUGH', 'DEV-EFFECTS-GRAIN-SEED'], why: 'The legacy grain is partial. The required Amount/Size/Roughness/seed grain is missing.' },
  'Develop|Vignette': { ids: ['FILT-LEG-VIGNETTE', 'DEV-EFFECTS-VIG-AMOUNT', 'DEV-EFFECTS-VIG-MID', 'DEV-EFFECTS-VIG-ROUND', 'DEV-EFFECTS-VIG-FEATHER', 'DEV-EFFECTS-VIG-HIGHLIGHTS'] },
  'Develop|Curvas y Levels': { ids: ['DEV-CURVE-POINT', 'DEV-CURVE-PARAMETRIC', 'DEV-CURVE-CHANNELS', 'ADJ-LEVELS', 'ADJ-CURVES'] },
  'Develop|HSL, Point Color, B&W mixer': { ids: ['DEV-COLOR-HSL', 'DEV-COLOR-POINT-COLOR', 'DEV-COLOR-BW', 'ADJ-BW'] },
  'Develop|Color grading y calibration': { ids: ['DEV-COLOR-GRADING', 'DEV-COLOR-CALIBRATION'] },
  'Develop|Sharpening y denoise': { ids: ['DEV-DETAIL-SHARP-AMOUNT', 'DEV-DETAIL-SHARP-MASK', 'DEV-DETAIL-NR-LUM', 'DEV-DETAIL-NR-COLOR'] },
  'Develop|Óptica y geometría': { ids: ['DEV-OPTICS-PROFILE', 'DEV-OPTICS-DEFRINGE', 'DEV-OPTICS-UPRIGHT', 'DEV-OPTICS-TRANSFORM'] },
  'Develop|Máscaras locales': { ids: ['DEV-MASK-BRUSH', 'DEV-MASK-LINEAR', 'DEV-MASK-RADIAL', 'DEV-MASK-COLOR-RANGE', 'DEV-MASK-LUM-RANGE', 'DEV-MASK-OPS'] },
  'Develop|Lens blur': { ids: ['DEV-OPTICS-LENS-BLUR'] },
  'Archivos|PSD import': { ids: ['PSD-IMPORT-RASTER', 'PSD-IMPORT-REPORT', 'PSD-IMPORT-TEXT', 'PSD-IMPORT-FX', 'PSD-IMPORT-MASKS', 'PSD-IMPORT-SO'] },
  'Archivos|PSD export y PSB': { ids: ['PSD-EXPORT', 'PSD-PSB'] },
  'Archivos|PNG, JPEG, SVG export': { ids: ['FILE-PNG-EXPORT', 'FILE-JPEG-EXPORT', 'FILE-SVG-EXPORT', 'FILE-EXPORT-OPTS', 'COLOR-ICC-EMBED'] },
  'Archivos|RAW/DNG': { ids: ['RAW-DECODE', 'RAW-DEMOSAIC', 'RAW-COLOR-MATRIX', 'RAW-CAMERA-MATRIX'] },
  'Color|16/32 bit, ICC, CMYK, Lab, HDR': { ids: ['COLOR-16BIT', 'COLOR-32BIT', 'COLOR-ICC-IMPORT', 'COLOR-MODE-CMYK', 'COLOR-MODE-LAB', 'RAW-HDR-DISPLAY'] },
  'Catálogo|Library, metadatos y colecciones': { ids: ['LIB-CATALOG', 'LIB-EXIF-IPTC-XMP', 'LIB-COLLECTIONS', 'OUT-BATCH-EXPORT'] },
  'Output|Print, books, slideshow, web galleries': { ids: ['OUT-PRINT', 'OUT-BOOK', 'OUT-SLIDESHOW', 'OUT-WEB'] },
  'Automatización|Actions, macros y plugins': { ids: ['ADV-ACTIONS', 'ADV-BATCH', 'ADV-SCRIPTING'] },
  'Timeline|Animación y vídeo': { ids: ['ADV-FRAME-ANIM', 'ADV-VIDEO'] },
  'IA|Selección semántica y generación': { ids: ['AI-PROVIDER', 'AI-SEGMENT', 'AI-SEMANTIC', 'AI-GEN-FILL'] },
  'Infraestructura|Cloud, cuentas y colaboración': { ids: ['CLOUD-AUTH', 'CLOUD-SYNC', 'CLOUD-REVIEW', 'CLOUD-QUOTAS'], why: 'Host-level sign-in on the published site is not an app account.' },
  'Robustez|Workers y recuperación': { ids: ['RENDER-WORKERS', 'DOC-RECOVERY-UI', 'DOC-CRASH', 'RENDER-MEM-PRESSURE', 'FILT-CANCEL'] },
  'Documentación|Mensajes y README': { ids: ['M0-OBSOLETE-TEXT'], why: 'Resolved in this milestone: README rewritten, worker errors replaced; guarded by a test.' },
};

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some(v => v !== '')) rows.push(row); }
  return rows;
}

export function readInventory(url = new URL('../docs/baseline/INVENTARIO_BRECHAS.csv', import.meta.url)) {
  const [head, ...rows] = parseCsv(readFileSync(url, 'utf8').replace(/^\uFEFF/, ''));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function reconciliation() {
  const ledger = new Map(buildRows().map(r => [r.id, r]));
  const inv = readInventory();
  const sha = f => createHash('sha256').update(readFileSync(new URL('../docs/baseline/' + f, import.meta.url))).digest('hex');
  const lines = [
    '# Inventory reconciliation',
    '',
    'Generated by `npm run ledger` from `ledger/inventory.mjs`. Maps each row of the delivered gap inventory (`INVENTARIO_BRECHAS.csv`) to capability-ledger rows and shows their **current** ledger states.',
    '',
    `Inputs (kept unchanged in \`docs/baseline/\`): INVENTARIO_BRECHAS.csv sha256 \`${sha('INVENTARIO_BRECHAS.csv')}\`, DOCUMENTACION_VERSION.txt sha256 \`${sha('DOCUMENTACION_VERSION.txt')}\`.`,
    '',
    '| Area | Capacidad | Inventory state | Ledger rows (current state) | Note |',
    '|---|---|---|---|---|',
  ];
  for (const r of inv) {
    const m = INVENTORY_MAP[r['Area'] + '|' + r['Capacidad']];
    const counts = Object.fromEntries(STATES.map(s => [s, 0]));
    for (const id of m?.ids || []) counts[ledger.get(id)?.state ?? 'missing']++;
    const cell = STATES.filter(s => counts[s]).map(s => `${s} ${counts[s]}`).join(', ');
    lines.push(`| ${r['Area']} | ${r['Capacidad']} | ${r['Estado actual']} | ${cell}: ${(m?.ids || []).join(', ')} | ${m?.why || ''} |`);
  }
  lines.push('', 'Items from DOCUMENTACION_VERSION.txt that were not in the ledger and are now added: legacy Filter gallery sliders as separate rows (`FILT-LEG-*`), the gallery Cancel-after-upload behaviour, hostile project import hardening (`M0-IMPORT-HARDENING`), hosting under a sub-path (`M0-BASE-PATH`) and unused legacy CSS (`M0-DEAD-CSS`).', '');
  return lines.join('\n');
}
