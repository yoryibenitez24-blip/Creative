# Zertake Studio architecture

Status: Milestone 0 plan plus the parts built in the first Milestone 1 slice. Items marked **(planned)** do not exist yet. Their state is tracked in `docs/CAPABILITY_LEDGER.csv`.

## Layers of the system

```
UI (React 19 JSX)            src/main.jsx, src/editor/*.jsx, src/FilterGallery.jsx, src/Recovery.jsx
  │  tool state machines      src/main.jsx (pointer → tool handlers), src/editor/tools.js (registry ↔ ledger)
  │  commands / history       src/main.jsx commit/undo/redo (immutable snapshots)
  ▼
Engine (pure JS, no DOM)      src/engine/*.js        ← unit-tested in Node
  schema.js     versioned document schema + migrations + native envelope
  selection.js  selection descriptors → 8-bit masks, feather, outline
  brush.js      deterministic document-space dab sampler
  raster.js     RGBA8 stroke/fill compositing with selection masks
  assets.js     content-addressed asset store (backend injected)
  ▼
Platform adapters             src/workspace.js (IndexedDB), src/editor/surfaces.js (canvases),
                              src/psd-worker.js + src/worker-import.js (PSD worker)
```

Rule: `src/engine` never touches the DOM, React or IndexedDB. The browser supplies backends, so the same code runs in Node tests and later in workers.

## Document model (schema v2)

`src/engine/schema.js` holds the full schema history. The fields that matter here:

| Field | Meaning |
|---|---|
| `schemaVersion` | `2`. Older (v1, no field) is migrated on open. A newer version is refused with a message and nothing is changed. |
| `id` | Stable document id (UUID) |
| `w`, `h`, `bg` | Artboard size in px and background colour |
| `units`, `resolution`, `color` | `px`, `72`, `{mode:'RGB', profile:'sRGB IEC61966-2.1', bitDepth:8}`. The values are stored now, but there is no UI or behaviour behind them yet. |
| `layers[]` | Bottom-to-top. Types: `rect`, `ellipse`, `text`, `image`, `raster` |
| `groups[]` | `{id,name,parent,visible,opacity,blend,source}`. Built from v1 `psdGroups` and `layer.group` tags. Nesting is stored but not rendered. |
| `selection` | Pixel selection descriptor (see below) or `null` |
| `lastSelection` | Used by Reselect |
| `migrations[]` | Log of applied migrations |

A raster layer is `{type:'raster', x, y, w, h, assetId}`. `w` and `h` are integer pixel dimensions. `assetId` is `sha256-<hex>` or `null` (fully transparent). Raster layers are not resampled. Move changes `x`/`y` by whole pixels. Free transform for raster layers is a ledger item (`XFORM-RASTER-RESAMPLE`).

Unknown document and layer fields are carried through migrations untouched.

### Native file (.zertake v2)

```json
{ "format": "zertake-project", "schemaVersion": 2,
  "document": { ... },
  "assets": { "sha256-…": { "type": "image/png", "data": "<base64>" } } }
```

Each referenced asset is stored once. On open, every asset is re-hashed and a mismatch rejects the file. Bare v1 documents (the old format) still open.

## Assets and persistence

* `AssetStore` (`src/engine/assets.js`) keys blobs by SHA-256. Undo snapshots and documents hold only ids, so a stroke costs one PNG in storage, not one per history entry, and identical content is deduplicated.
* The browser backend is the IndexedDB database `zertake-studio`, version 2, with a new `assets` object store (`src/workspace.js`). The v1 `workspace` store is untouched by the upgrade.
* Write order: the asset is persisted **before** the document that references it is committed. If the asset write fails (for example on quota), the stroke is rolled back on screen and the user is told. The document never references unsaved pixels.
* Known gaps (ledger): image layers still embed data URLs (`DOC-ASSET-IMAGE`). There is no asset garbage collection (`DOC-ASSET-GC`), because two app tabs could otherwise delete each other's in-flight assets. OPFS, atomic multi-store transactions and crash journals are **(planned)**.

## Selection engine

A selection is an immutable descriptor `{ops:[…]}` replayed onto a W×H coverage buffer:

* Shapes: `rect` (exact fractional coverage), `ellipse` and `polygon` (4 sub-scanlines per pixel, exact horizontal coverage, non-zero winding), `all`.
* Ops: `replace`, `add` = max, `subtract` = min(a, 1−s), `intersect` = min, `invert`, `feather`.
* Feather: Gaussian approximated with 3 box-blur passes, σ = radius / 2, edge-clamped.
* Output: an 8-bit mask (0–255), cached per descriptor object. The marching ants are the 50% iso-boundary, merged into straight SVG runs.

Because history stores descriptors, selection undo costs a few bytes. The cost is that masks recompute on the main thread. That takes about 10–40 ms for a 1200×1400 document and is unmeasured for 8000². Moving mask computation to a worker is ledger item `RENDER-WORKERS`.

## Brush engine

* `brush.js` samples dabs from input already converted to **document coordinates** (`svg.getScreenCTM().inverse()`). Spacing is `spacing × current diameter`, walked along the smoothed path with a carried residual. Zoom, pan and pointer sample density therefore do not change dab placement. Acceptance test A1 found 0 differing pixels between 100% and 200%.
* Pressure: pen pressure maps to size and/or flow. Mouse and touch count as pressure 1.
* `raster.js` uses a Photoshop-style opacity-vs-flow model. Per-pixel stroke coverage accumulates `cov += (1−cov)·dab·flow`, and the pixel is recomputed from an untouched `before` copy as `before OVER (colour, min(cov,1)·opacity·selection)`. The eraser multiplies alpha by `1 − effective`. Overlapping dabs can never exceed the stroke opacity.
* Working space: 8-bit sRGB-encoded values, straight alpha, compositing in encoded space. This matches the browser's SVG compositing, so the canvas, the preview and the PNG export agree (export delta ≤ 1). Linear-light, 16-bit and 32-bit pipelines are ledger items in the `COLOR` area.

## Rendering

Today the browser renders composition through SVG. Raster layers are `<foreignObject>` canvases owned by a surface registry (`src/editor/surfaces.js`). The registry is not React-owned, so live strokes paint directly and undo reloads by asset id. Export swaps those canvases for embedded PNG `<image>` elements and rasterises the SVG at document size.

**(planned) Tile compositor.** The planned design is a render graph of nodes (layer, group, adjustment, mask, effect) evaluated into 256×256 tiles in a worker pool:
* invalidation by dirty rectangle and node-version hash;
* preview pyramids with a full-resolution export through the same graph;
* WebGL2 kernels where feature-detected, with a CPU (JS/WASM) fallback;
* GPU context-loss and worker-crash recovery that re-runs dirty tiles.

The SVG path stays as the reference renderer until the golden-image suite (`QA-GOLDEN`) shows the tile compositor matches it. Isolated group compositing, full blend-mode coverage and masks depend on this compositor, which is why they remain `missing`.

## Commands and history

`commit(next)` pushes the previous immutable document onto `past` (80 entries) and clears `future`. Raster commits go through a promise queue: encode PNG, persist the asset, mark the surface as already showing that asset, then commit. Undo and redo are refused with a message while a raster commit is pending, which prevents history interleaving. **(planned)** Named commands with labels for a History panel, transactions and persisted history.

## Threads and long work

* The PSD import runs in a worker with cancellation, a timeout and size/memory limits.
* Brush dabs run on the main thread, limited to the dab's bounding box per pointer event and flushed once per animation frame.
* The legacy Filter gallery still bakes pixels on the main thread (ledger `FILT-LEGACY-PANEL` is `partial`). Moving it to workers belongs to the Develop milestone.

## Colour assumptions (current)

All pixel data is treated as 8-bit sRGB. No ICC profiles are read or written. The label "RGB / sRGB" in the canvas header reflects this. CMYK, Lab, grayscale and high-bit work will each get a support matrix before any UI exposes them.
