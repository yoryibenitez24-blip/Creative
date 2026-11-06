# Zertake Studio

A browser-local creative editor written in React 19 JSX, with a native engine in `src/engine`. It is being built in stages toward a Photoshop-class editor and a Lightroom-class Develop workspace. **It is not at parity with either product.** The delivered baseline documentation and gap inventory are in [`docs/baseline/`](docs/baseline/) with a [reconciliation](docs/baseline/RECONCILIATION.md). The versioned capability ledger in [`docs/CAPABILITY_LEDGER.csv`](docs/CAPABILITY_LEDGER.csv) is the source of truth for what works ([summary](docs/LEDGER_SUMMARY.md)).

## Setup

```bash
npm install
npm run dev          # development: http://localhost:5173, rebuilds on save and reloads the page
npm start            # build, then serve the production bundle on http://127.0.0.1:4173
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
* **Layer masks.** Every layer type can have a mask: add from all or from the selection, paint it with the brush or eraser (Ctrl/⌘ \\ or click the mask chip), and set enabled, linked, density and feather. Invert, delete and apply are available. Preview, export and Apply share one implementation.
* **Tools (Photoshop-style rail).** Move, Marquee, Lasso, Magic Wand, Crop, Eyedropper, Spot Healing / Healing Brush, Brush / Pencil, Clone Stamp, Eraser, Gradient (linear, radial, angle, reflected, diamond) / Paint Bucket, Blur / Sharpen / Smudge, Dodge / Burn / Sponge, Text, shapes, Hand and Zoom. Each tool has a contextual options bar.
* **Image menu.** 16 adjustments: Brightness/Contrast, Levels, Curves, Exposure, Vibrance, Hue/Saturation, Color Balance, Black & White, Photo Filter, Channel Mixer, Invert, Posterize, Threshold, Gradient Map, Desaturate and Equalize. They open in live-preview dialogs that run in a background worker. Also Image Size (bicubic, bilinear or nearest), Canvas Size with anchor, Image Rotation (90°, 180°, flip), Crop to selection and Trim.
* **Filter menu.** 34 filters in Blur, Sharpen, Noise, Distort, Pixelate, Stylize, Render and Other, plus Last Filter. They work on paint layers and masks and respect selections.
* **Layers.** Rasterize, Merge Down, Merge Visible and Flatten. All 16 blend modes the browser supports are in the menu. Edit › Transform flips and rotates a layer.
* **Selections.** Select › Modify (Expand, Contract, Border, Smooth, Feather) and Load mask as selection.
* **History panel.** Every step is named; click any step to go back or forward.
* **Navigation.** Zoom tool (click, Alt-click, drag to scrub), Ctrl/⌘ wheel zooms around the pointer, the wheel pans, and holding Space gives a temporary hand.
* **Camera Raw Filter** (Shift+Ctrl+A). Panels: Profile, Auto, B&W, Light, Color (white balance with eyedropper), Effects (Texture, Clarity, Dehaze, Vignette, Grain), Curve, Color Mixer, Color Grading, Detail (sharpening and noise reduction), Optics (Distortion, Remove Chromatic Aberration, Defringe), Lens Blur and Calibration. Settings are saved with the layer, so it reopens editable.
* **Layer styles.** The full Layer Style dialog: Blending Options (Fill Opacity, channels, Knockout, Blend If), Bevel & Emboss, Stroke, Inner Shadow, Inner/Outer Glow, Satin, Color/Gradient/Pattern Overlay and Drop Shadow, with multiple instances, Global Light and saved styles. Also clipping masks (Ctrl+Alt+G).
* **Adjustment and fill layers.** Levels, Curves, Hue/Saturation and the other adjustments as editable layers, plus Solid Color, Gradient and Pattern fill layers.
* **Transform.** Free Transform (Ctrl+T: scale, rotate, skew, distort, perspective) and Warp for paint layers.
* **Retouching.** Content-Aware Fill (Shift+Backspace), the Patch tool and Quick Selection.
* **More filters.** Filter Gallery families (Artistic, Brush Strokes, Sketch, Texture) and Glass.
* **Right-click menus** across the app. Layer via Copy/Cut (Ctrl+J / Shift+Ctrl+J with a selection) and Select Pixels.
* **PSD export.** Editable layers, masks, clipping and layer effects, with a compatibility report.
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
| Ctrl/⌘ `\` | Switch editing between layer and mask |
| Ctrl/⌘ Alt A | Select all layers |
| W, C, I, J, S, G, O, Z | Magic Wand, Crop, Eyedropper, Healing, Clone Stamp, Gradient/Bucket, Dodge/Burn/Sponge, Zoom |
| Shift + B / G / J / O | Cycle Brush↔Pencil, Gradient↔Bucket, Spot↔Healing, Dodge→Burn→Sponge |
| Ctrl/⌘ L, M, U, B, I | Levels, Curves, Hue/Saturation, Color Balance, Invert |
| Ctrl/⌘ ⇧ U | Desaturate |
| Ctrl/⌘ E, Ctrl/⌘ ⇧ E | Merge Down, Merge Visible |
| Ctrl/⌘ Alt F | Last Filter |
| Ctrl/⌘ Alt I, Ctrl/⌘ Alt C | Image Size, Canvas Size |
| Ctrl/⌘ 0, Ctrl/⌘ 1, Ctrl/⌘ + / − | Fit, 100%, zoom in/out |
| Space (hold) | Temporary Hand |
| Enter, Esc (Crop) | Apply / reset the crop |

## Known limits

PSD only (no PSB), up to 100 MB and 8000 px per side. All work is 8-bit sRGB with no ICC handling. Groups are flat, and group opacity is applied per child. There are no vector masks, adjustment layers, layer styles, RAW, Develop or photo library yet. Selection masks are computed on the main thread. Clearing browser data deletes locally saved work, so download `.zertake` projects to keep them. See the ledger for the full list and [`docs/MILESTONE_REPORT.md`](docs/MILESTONE_REPORT.md) for the current milestone.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
