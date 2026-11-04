# Zertake Studio

A browser-local creative editor written in React 19 JSX, with a native engine in `src/engine`. It is being built in stages toward a Photoshop-class editor and a Lightroom-class Develop workspace. **It is not at parity with either product.** The delivered baseline documentation and gap inventory are in [`docs/baseline/`](docs/baseline/) with a [reconciliation](docs/baseline/RECONCILIATION.md). The versioned capability ledger in [`docs/CAPABILITY_LEDGER.csv`](docs/CAPABILITY_LEDGER.csv) is the source of truth for what works ([summary](docs/LEDGER_SUMMARY.md)).

## Setup

```bash
npm install
npm run build        # bundles src/ → dist/app.js and dist/psd-worker.js
npm run serve        # http://127.0.0.1:4173 (or serve dist/ with any static server)
npm test             # unit, PSD import and ledger tests (Node ≥ 20)
npm run test:e2e     # browser acceptance tests (needs Playwright + Chromium)
npm run ledger       # regenerate docs/CAPABILITY_LEDGER.csv and docs/LEDGER_SUMMARY.md
```

`dist/index.html` and `dist/style.css` are hand-maintained source files. `dist/app.js` and `dist/psd-worker.js` are build output.

## What works today

* **Documents.** Independent tabs, each with its own selection and undo history. Autosave to IndexedDB reports failures. Pixel data lives in a content-addressed asset store (SHA-256). Native `.zertake` v2 files hold each asset once and are hash-verified on open. Old v1 projects migrate automatically.
* **Selection.** Rectangular and elliptical marquee, freehand and polygonal lasso. Modes: new, add (Shift), subtract (Alt), intersect (Shift+Alt). Per-tool feather. Select All, Deselect, Reselect, Inverse and Feather…, with animated marching ants.
* **Painting.** Brush and eraser on paint layers. Controls: size, hardness, opacity, flow, spacing, smoothing, and pen pressure mapped to size and/or flow. Strokes are sampled in document space, so they come out the same at every zoom level. Paint respects the selection. Fill with foreground or background and Clear selected pixels are also available. Each stroke is one undo step.
* **Composition.** Rectangles, ellipses, text, images, move/resize, numeric transform, opacity, 7 blend modes in the menu, lock/visibility, grid, and PNG/JPEG/SVG export at full resolution. Paint layers are embedded as PNG in SVG exports.
* **PSD import.** Native, in a worker with cancel, a timeout and size limits. Raster layers, names, positions, order, visibility, opacity and supported blend modes are imported. The compatibility report lists masks, effects, clipping, adjustments, smart objects and vectors, which are **not** reproduced. Group compositing may differ. Text arrives as pixels, with an explicit, undoable conversion to editable text.
* **Filter gallery.** 18 original looks and 13 pixel sliders on image layers. The original pixels are kept. This is a legacy creative panel, **not** a Lightroom-style Develop module. Texture, Clarity, Dehaze, curves, HSL and photographic grain are Milestone 2 items.

Main shortcuts:

| Shortcut | Action |
|---|---|
| V, H | Move, Hand |
| M, Shift+M | Marquee, toggle rectangular/elliptical |
| L, Shift+L | Lasso, toggle freehand/polygonal |
| B, E | Brush, Eraser |
| `[` `]` | Brush size |
| X, D | Swap / reset colours |
| Ctrl/⌘ A | Select All |
| Ctrl/⌘ D, Ctrl/⌘ ⇧ D | Deselect, Reselect |
| Ctrl/⌘ ⇧ I | Inverse |
| Alt ⌫, Ctrl ⌫ | Fill with foreground / background |
| Delete | Clear selected pixels on a paint layer, otherwise delete the layer |
| Ctrl/⌘ J | Duplicate layer |
| Ctrl/⌘ ⇧ N | New paint layer |
| Ctrl/⌘ Alt A | Select all layers |

## Known limits

PSD only (no PSB), up to 100 MB and 8000 px per side. There is no PSD export. All work is 8-bit sRGB with no ICC handling. Groups are flat, and group opacity is applied per child. There are no layer masks, adjustment layers, layer styles, RAW, Develop or photo library yet. Selection masks are computed on the main thread. Clearing browser data deletes locally saved work, so download `.zertake` projects to keep them. See the ledger for the full list and [`docs/MILESTONE_REPORT.md`](docs/MILESTONE_REPORT.md) for the current milestone.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
