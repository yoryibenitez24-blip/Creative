# Milestone report: M0 + M1 vertical slices

## Slice 2: raster layer masks (ledger v0.2.0)

**What works.** Every layer type (paint, image, shape, text) can have a document-space 8-bit mask. White reveals and black hides.
* **Add:** reveal or hide all, or reveal or hide the current selection (the selection is consumed). Available from the inspector, Layer menu or layers-panel button.
* **Paint on the mask:** click the mask chip, choose *Edit mask*, or press Ctrl/⌘ \ to switch the brush, eraser, fill and clear onto the mask. The options bar says so. The brush paints the foreground luminance and the eraser paints the background luminance. Selections restrict mask painting too.
* **Properties:** enabled, linked, density 0–100% and feather 0–250 px (Gaussian, σ = feather ÷ 2). All are non-destructive and saved.
* **Commands:** invert, delete, and apply (bakes into a paint layer's alpha). Shift-click the chip to disable. A linked mask moves with its layer, including drag, arrow keys, align and duplicate.
* **Everything is undoable,** autosaved, written into `.zertake` (each mask asset once) and exported.

**One implementation for preview, export and apply.** Chromium ignores a canvas inside an SVG `<mask>`, so masks render through an `<image>`. With feather or density set, that image is the effective mask computed by `engine/mask.js` itself. An earlier version used SVG `feGaussianBlur`, which differed from Apply by up to 9 levels near document edges. Now the live mask and the applied mask differ by **0** (`docs/evidence/m1-masks-e2e-results.json`).

**Schema v3.** Masks are an additive field, but the version was bumped so an older app refuses mask documents instead of silently dropping masks on save. v1 and v2 files migrate automatically.

**Bug caught by the slice-1 E2E test.** Paint layers carry an unrelated colour string, `fill`, from the generic layer helper. The new surface code briefly read it as a mask grey value and filled new paint layers black. This was fixed before commit, and the old acceptance test now guards it.

**Tests.** `npm test` gives 53 passed (7 new mask/engine tests). The browser tests give 12/12 for masks and 11/11 for slice 1. The masks test checks:
* reveal-selection;
* mask painting and undo;
* density 50% gives half strength (±3);
* the feather ramp is symmetric;
* disable/enable;
* the linked move and its undo;
* invert;
* reload persistence (max delta ≤ 1);
* the `.zertake` envelope;
* apply equals the live mask (delta 0), and undo restores the mask.

**Ledger v0.1.4 → v0.2.0.** 9 rows changed state.
* Verified: `MASK-RASTER`, `MASK-PAINT`, `MASK-LINK`, `MASK-DENSITY`, `MASK-FEATHER`, `MASK-INVERT`, `MASK-DISABLE`, `MASK-APPLY`.
* `MASK-FROM-SEL` is partial: selection → mask works, but loading a mask as a selection doesn't.
* The brush and eraser tools now also depend on `MASK-PAINT`.

**Measured cost** (same CI container as below). Recomputing a feathered/density mask preview takes 123 ms at 1200×1400 and 590 ms at 3840×2160, on the main thread. It runs once per change and is throttled while painting. Unfeathered masks have no per-change cost. This adds to the case for moving mask and selection work into a worker next.

**Known gaps.**
* There is no load-mask-as-selection, mask overlay view (`\`) or vector mask.
* Masks on PSD import are not read yet. ag-psd exposes them, so this is a cheap next step.
* Apply works on paint layers only, because Rasterize is missing.
* A linked mask that moves off the document leaves the uncovered area at its fill value, as Photoshop does. Painting there is not possible until masks can grow.

---


Date: 2026-11-04 · Ledger v0.1.0 · Branch `claude/inspiring-curie-tsipqx`

## Summary

* **Milestone 0 is done.** The audit is complete, the repository layout is fixed and the baseline tests run. The capability ledger (763 rows) exists and is reconciled with your gap inventory. Obsolete text is removed, schema v2 has a migration, and the architecture plan is written. The baseline is verified: every file of the imported snapshot matches the delivered `MANIFEST_SHA256.txt`.
* **The first Milestone 1 vertical slice is verified.** It covers paint layers, the brush and eraser, rectangular/elliptical marquee and freehand/polygonal lasso with new/add/subtract/intersect and feather, the selection commands, fill/clear, and the content-addressed asset store. All of it runs through UI, engine, undo/redo, autosave, native save/open and PNG export.
* **Zertake is not at Photoshop or Lightroom parity.** 55 of 763 ledger rows (7.2%) are verified. Develop, RAW, masks, adjustment layers, styles, PSD export and the library are all still `missing`.

## Audit findings (baseline `5a309f5`)

| Finding | Action |
|---|---|
| Sources, tests and bundles were flattened at the repository root, while `package.json` and the tests expect `src/`, `tests/`, `dist/`. `npm run build` could not run as committed. | Restored the layout (commit `318d3de`) |
| A file named `download` held `.gitignore` contents. `psd-worker (1).js` was the worker source. | Renamed to `.gitignore` and `src/psd-worker.js` |
| Baseline commit `e2360711…` does not exist in this repository. `DOCUMENTACION_VERSION.txt` says the delivery is that commit's tracked files without `.git`, so `5a309f5` is that snapshot, flattened on upload. | Verified: all 19 snapshot files match `MANIFEST_SHA256.txt` byte for byte (`tests/baseline.test.js`). `hosting.json` was restored to its manifest path `.openai/hosting.json`, unmodified. |
| `DOCUMENTACION_VERSION.txt` and `INVENTARIO_BRECHAS.csv` were supplied after the first pass | Stored unchanged in `docs/baseline/`; every inventory row is mapped to ledger rows in [`docs/baseline/RECONCILIATION.md`](baseline/RECONCILIATION.md), enforced by a test |
| Error strings told users to "Open it in the full editor"; the README documented the removed Photopea route | Replaced with accurate limit messages; README rewritten; a test guards against regressions |
| Ctrl+Shift+Z redo never fired, because `e.key` is `"Z"` when Shift is held | Fixed (key compared lower-case) |
| Clicking a layer without moving it added an empty undo step | Fixed (history entry only when the document changed) |
| Clicking the zoom buttons cleared the layer selection, because the event reached the canvas | Fixed (zoom controls stop propagation) |
| 12 baseline tests | All pass |

## Shortcut changes (now Photoshop-aligned)

| Shortcut | Before | Now |
|---|---|---|
| Ctrl/⌘ D | Duplicate layer | Deselect |
| Ctrl/⌘ J | none | Duplicate layer |
| Ctrl/⌘ A | Select all layers | Select All pixels (all layers is Ctrl/⌘ Alt A) |
| Delete | Delete layer | Clears selected pixels on a paint layer while a selection exists; otherwise deletes the layer |

## Test results

```
npm test       → 46 passed, 0 failed  (model 7, PSD import 5, engine 21, ledger 9, baseline 4)
npm run test:e2e → 11 passed, 0 failed (Chromium via Playwright 1.63, real pointer/keyboard input)
```

Acceptance examples covered:

| # | Acceptance example | Result |
|---|---|---|
| 1 | The same stroke at different zoom levels gives identical document geometry, and undo removes exactly that stroke | 100% vs 200%: **0 pixels differ by more than 2** (max alpha delta 1). Undo leaves 0 painted pixels and keeps the layer. Redo restores identical pixels. |
| 2 | A feathered selection restricts brush/fill output, and the export has the same alpha boundary | The feathered edge is partial (alpha 40–220). Outside the selection stays 0. The exported PNG matches on-canvas alpha over the background with a **max channel delta of 1**. |
| 6 (partial) | Save and reopen preserve every asset | Reload from IndexedDB and `.zertake` save/reopen both produce identical pixels. The Develop parts of this example belong to M2. |

Evidence: `docs/evidence/m1-e2e-results.json`, `m1-feathered-selection.png`, `m1-export.png`, `m1-roundtrip.zertake`.

## Performance measurements (not budgets)

Measured with Node 22 on a 4-vCPU Intel Xeon at 2.1 GHz (CI container). This is not an agreed target device.

| Operation | 1200×1400 | 3840×2160 | 8000×8000 |
|---|---:|---:|---:|
| Selection mask (ellipse, 10 px feather) | 55 ms | 234 ms | 2060 ms |
| Marching-ants outline | 24 ms | 100 ms | 829 ms |
| 337 dabs of 100 px (one long 4K stroke, total) | | 231 ms | |

Selection masks are still computed on the main thread. At 8000² each selection change stalls the UI for about 3 s. Moving this to a worker is ledger row `RENDER-WORKERS` and should come before large-document work.

## Ledger diff

**v0.1.3 → v0.1.4.** Scope decision D-002 (no RAW decoder license for now) recorded. 11 RAW-decoder rows are annotated as deferred; their states are unchanged (`missing`).

**v0.1.2 → v0.1.3.** Scope decision D-001 (no AI yet) recorded. 23 AI-dependent rows are annotated as deferred; their states are unchanged (`missing`). `RETOUCH-REMOVE` and `DEV-OPTICS-LENS-BLUR` now name their non-AI routes.

**v0.1.1 → v0.1.2.** `M0-BASE-COMMIT`: partial → verified, checked against MANIFEST_SHA256.txt.

**v0.1.0 → v0.1.1 (inventory reconciliation).** 20 rows were added and 3 changed state.
* Added `M0-RECONCILE` (verified), `M0-IMPORT-HARDENING` (partial), `M0-BASE-PATH` (missing) and `M0-DEAD-CSS` (missing). These come from §2 and §9 of DOCUMENTACION_VERSION.
* Added 16 `FILT-LEG-*` rows (partial), one per legacy Filter gallery slider plus presets, non-destructive source and Cancel-after-upload. The ledger keeps these separate from `DEV-*` on purpose. The inventory counts the legacy sliders as partial Develop, but the Develop rows stay `missing` until a validated linear-light pipeline exists. Each such difference is explained in RECONCILIATION.md.
* `M0-INPUT-DOCS`: blocked → verified. `M0-BASE-COMMIT`: blocked → partial.

**v0.1.0** is the first ledger, so there is no earlier version to diff against. Baseline states come from the code audit. Rows this milestone moved to `verified` or `implemented-unverified`:

* **M0:** `M0-LAYOUT`, `M0-BASE-TESTS`, `M0-LEDGER`, `M0-OBSOLETE-TEXT`, `M0-SCHEMA-V2`, `M0-MIGRATE-V1`, `M0-ARCH-PLAN`, `LEG-PHOTOPEA`
* **Documents/commands:** `DOC-ASSET-CAS`, `DOC-NATIVE-ENV`, `DOC-AUTOSAVE`, `CMD-UNDO`, `CMD-UNDO-STROKE`, `CMD-UNDO-SEL`, `RENDER-RASTER-SURF`, `FILE-NATIVE-OPEN`, `FILE-PNG-EXPORT`
* **Selection:** `SEL-MARQ-RECT`, `SEL-MARQ-ELLI`*, `SEL-LASSO-FREE`, `SEL-LASSO-POLY`*, `SEL-MODE-NEW/ADD/SUB/INT`, `SEL-FEATHER-OPT`, `SEL-ALL`*, `SEL-DESELECT`, `SEL-RESELECT`, `SEL-INVERSE`, `SEL-FEATHER-CMD`*, `SEL-ANTS`
* **Paint:** `PAINT-BRUSH`, `PAINT-ERASER`, `PAINT-FILL-FG`, `PAINT-FILL-BG`*, `PAINT-CLEAR`, `PAINT-NEW-PAINT-LAYER`*, `PAINT-AUTO-LAYER`, `BRUSH-SIZE/HARD/OPAC/FLOW/SPACE/SMOOTH/PRESS-SIZE/PRESS-FLOW/DOC-SPACE`, `BRUSH-CURSOR`*
* **UI:** `NAV-OPTIONS-BAR`, `NAV-SWATCH-FGBG`*, `NAV-ZOOM-BTN`, `NAV-ACTUAL`

\* means `implemented-unverified`: it works but has no automated test yet.

## Migrations

* **Documents v1 → v2** (`src/engine/schema.js`). This runs automatically on load, on opening a file and on PSD import. Unknown fields are preserved. Documents from a future schema are refused with a message.
* **IndexedDB `zertake-studio` v1 → v2.** Adds the `assets` store and leaves `workspace` untouched.
* **Native file.** `.zertake` is now an envelope (`format: "zertake-project"`) with hash-verified assets. Bare v1 JSON still opens.

## Dependency and license inventory

| Package | Version | License | Use |
|---|---|---|---|
| react / react-dom | 19.1.0 | MIT | UI |
| lucide-react | 0.468.0 | ISC | Icons |
| ag-psd | 34.1.0 | MIT | PSD parsing (import only) |
| esbuild (dev) | 0.25.0 | MIT | Bundling |
| @napi-rs/canvas (dev) | 1.1.0 | MIT | Node canvas for tests |
| playwright (test tooling, not a dependency) | 1.63.0 | Apache-2.0 | E2E tests, preinstalled in the environment |

No new runtime dependencies were added. The brush, selection, raster and asset code is original.

## Known gaps in this slice

* No brush presets, tips, jitter, pressure curve, tilt or symmetry (`BRUSH-*` rows still `missing`).
* There are no paint-layer transforms beyond whole-pixel move, and no transparency or pixel locks.
* There is no Quick Mask, magnetic lasso, magic wand, quick selection or Select and Mask.
* Selection masks are computed on the main thread (see the measurements above).
* Image layers still embed data URLs. There is no asset garbage collection, so storage grows until browser data is cleared.
* Paint layers keep their size when the canvas is resized.
* Pen pressure is unit-tested but has not been tested on a real stylus. Only Chromium has been tested.

## Decisions and blocked items

1. ~~`M0-INPUT-DOCS`~~ Resolved: both files were received and reconciled.
2. ~~`M0-BASE-COMMIT`~~ Resolved: verified against `MANIFEST_SHA256.txt`. `LEEME_PRIMERO.txt` was supplied later and also matches. `PROMPT_DESARROLLO_COMPLETO.txt` was given as the conversation prompt rather than as a file, so its hash is unchecked.
3. ~~`AI-PROVIDER`~~ Decided: no AI yet (scope decision D-001). The 23 model-dependent rows stay `missing` and are marked deferred. Where a non-AI route exists, it is the planned implementation: patch synthesis for Remove, user-painted depth masks for Lens Blur, and classic noise reduction.
4. ~~`RAW-DECODE`~~ Decided: no RAW decoder license for now (scope decision D-002). 11 RAW-decoder rows stay `missing` and are marked deferred. The Develop workspace (M2) targets rendered images and layers. White balance keeps a documented rendered-image mode so RAW can be added later without redesign.

No decisions are currently pending.

## Demo procedure

1. Run `npm install && npm run build && npm run serve`, then open http://127.0.0.1:4173.
2. Click **+** (New design), choose 1080 × 1080, then **Create design**.
3. Press **B** and drag on the canvas. A *Paint layer 1* is created and the stroke appears. Press Ctrl+Z to undo the stroke only.
4. Change Size and Hardness in the options bar, zoom to 200% and paint again. The stroke width stays the same in document pixels.
5. Press **M**, set Feather to 20 and drag a rectangle. Hold **Shift** and drag an overlapping rectangle to add to it. Press **B** and paint across the edge: the paint stays inside the selection with a soft edge.
6. Press **Alt+Backspace** to fill the selection, **Ctrl+Shift+I** to invert, then **Delete** to clear outside. Press **Ctrl+D** to deselect and **Ctrl+Shift+D** to reselect.
7. Press **L** and draw a freehand selection. Press **Shift+L** and click points for a polygonal selection, then press Enter to close it.
8. Reload the page: the document and pixels are restored. Press **Ctrl+S** to download a `.zertake` file, then open it from the folder icon. It opens in a new tab with identical pixels.
9. Click **Export**, then **Download PNG**: the paint layers appear at full resolution.
