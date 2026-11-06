// Zertake native document schema and migrations.
//
// Schema history
//   v1  (implicit, no `schemaVersion`): {name,w,h,bg,layers[],psdGroups?,importWarnings?}
//       Layer types rect | ellipse | text | image. Groups were flat `layer.group` ids.
//   v2  adds: schemaVersion, stable document id, units/resolution/color metadata,
//       explicit `groups` table (parent ids allow nesting), `raster` layers that
//       reference content-addressed pixel assets, a document pixel `selection`
//       descriptor and a `migrations` log.
//   v3  adds optional `layer.mask` (raster layer mask, see engine/mask.js). The data change is
//       additive, but the version is bumped so an older app refuses the file instead of
//       silently dropping masks on save.
//   v4  adds the `smart` layer type (Smart Object: an embedded source asset plus a non-destructive
//       smart-filter stack, see engine/smart.js), the `shape` layer type (vector path, see
//       engine/paths.js), document `paths` (saved paths), optional `layer.vectorMask`, extended
//       type properties on text layers and colour-management metadata. Additive; bumped so an
//       older app refuses the file instead of dropping the new layers on save.
//
// Migration rule: never drop fields we do not understand. Unknown document and
// layer fields are carried through untouched, so a later version can still read them.

export const SCHEMA_VERSION = 4;
export const LAYER_TYPES = ['rect', 'ellipse', 'text', 'image', 'raster', 'adjustment', 'fill', 'smart', 'shape'];
export const PROJECT_FORMAT = 'zertake-project';

const newId = () => globalThis.crypto?.randomUUID?.() || 'doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

export function detectVersion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion === undefined) return 1;
  return Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : null;
}

function v1to2(d) {
  const groups = [];
  const seen = new Set();
  for (const g of Array.isArray(d.psdGroups) ? d.psdGroups : []) {
    if (!g || typeof g.id !== 'string' || seen.has(g.id)) continue;
    seen.add(g.id);
    groups.push({ id: g.id, name: typeof g.name === 'string' ? g.name : 'Group', parent: g.parent ?? null, visible: g.visible !== false, opacity: Number.isFinite(g.opacity) ? g.opacity : 1, blend: g.blend || 'pass through', source: 'psd' });
  }
  for (const l of Array.isArray(d.layers) ? d.layers : []) {
    if (l && typeof l.group === 'string' && !seen.has(l.group)) {
      seen.add(l.group);
      groups.push({ id: l.group, name: 'Group ' + (groups.length + 1), parent: null, visible: true, opacity: 1, blend: 'pass through', source: 'v1-group-tag' });
    }
  }
  return {
    ...d,
    schemaVersion: 2,
    id: typeof d.id === 'string' ? d.id : newId(),
    units: 'px',
    resolution: 72,
    color: { mode: 'RGB', profile: 'sRGB IEC61966-2.1', bitDepth: 8 },
    groups,
    selection: null,
    migrations: [...(Array.isArray(d.migrations) ? d.migrations : []), { from: 1, to: 2 }],
  };
}

const v2to3 = d => ({ ...d, schemaVersion: 3, migrations: [...(d.migrations || []), { from: 2, to: 3 }] });

const v3to4 = d => ({ ...d, schemaVersion: 4, migrations: [...(d.migrations || []), { from: 3, to: 4 }] });

const STEPS = { 1: v1to2, 2: v2to3, 3: v3to4 };

/** Migrate any known document version to SCHEMA_VERSION. Throws for unknown/future versions. */
export function migrateDocument(raw) {
  let v = detectVersion(raw);
  if (v === null) throw Error('Unrecognised project document');
  if (v > SCHEMA_VERSION) throw Error(`This project was saved by a newer Zertake (schema ${v}). Update the app to open it; nothing was changed.`);
  let d = raw;
  while (v < SCHEMA_VERSION) {
    d = STEPS[v](d);
    v = d.schemaVersion;
  }
  return d;
}

/** Native project envelope: one manifest + each referenced asset stored once. */
export function makeEnvelope(doc, assets) {
  return { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, document: doc, assets };
}

/** Accepts a v2 envelope or a bare v1/v2 document. Returns {doc, assets}. */
export function readProjectFile(json) {
  if (json && json.format === PROJECT_FORMAT) {
    if (!json.document) throw Error('Project file has no document');
    const assets = json.assets && typeof json.assets === 'object' ? json.assets : {};
    return { doc: json.document, assets };
  }
  return { doc: json, assets: {} };
}

export function referencedAssets(doc) {
  const ids = new Set();
  for (const l of doc.layers || []) {
    if (l.type === 'raster' && typeof l.assetId === 'string') ids.add(l.assetId);
    if (l.mask && typeof l.mask.assetId === 'string') ids.add(l.mask.assetId);
    if (l.develop && typeof l.develop.sourceId === 'string') ids.add(l.develop.sourceId);
    if (l.smart) for (const k of ['sourceId', 'renderId']) if (typeof l.smart[k] === 'string') ids.add(l.smart[k]);
  }
  return [...ids];
}
