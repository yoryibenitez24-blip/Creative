# Zertake Studio
React JSX browser-local creative editor. Run `npm install` then `npm run build`. Serve `dist/` with any static server.

## Workspace
New designs, imported native projects and PSDs open in separate document tabs. Each mounted editor retains its own selection and undo/redo history while switching tabs. All open documents and the active tab persist in IndexedDB. Previous single-document localStorage data is migrated on first use. Undo history lasts for the current page session. Autosave status reports failures instead of claiming success. Projects can also be downloaded as .zertake JSON.

## PSD import
Use File > Open / import, the folder beside the tabs, or drop a PSD on the canvas. ag-psd 34.1.0 parses the file locally. The import review shows dimensions, supported layer count and per-layer compatibility issues. Confirming opens the layers in a new document without replacing existing work.

Raster layer pixels, names, positions, order, visibility, opacity and supported blend modes are imported. Group membership/names are retained as metadata and selection groups, with inherited visibility and opacity applied to children. Group compositing may differ. Photoshop text is initially rendered pixels with preserved metadata and an explicit, undoable conversion to basic editable text using a local font. Smart objects/vector content use their existing raster previews. Unsupported masks, clipping, adjustments, effects and missing pixel layers are reported before import. No silent whole-document flattening. Layerless source PSDs are explicitly identified as composite-only.

Current limits: PSD only (not PSB), up to 100 MB and 8000 pixels per dimension. No PSD export, Photoshop effect/mask fidelity, AI, cloud collaboration or raster painting. One artboard per document. Large files may exceed browser memory or storage. Clearing browser data removes locally saved work.

## Verification
`node --test src/model.test.js tests/import.test.js`
Tests exercise real PSD serialization/parsing, layer order/offset/opacity/hidden groups, unsupported feature reports, malformed files, independent documents, native serialization and transform behavior. Browser QA covered creating and switching tabs, independent undo, file-picker PSD import, and restoring tabs after reload. General browser compatibility and arbitrary complex Photoshop documents require further testing.

## Recovery and full PSD workspace
The Full PSD editor button explicitly launches third-party Photopea in an iframe, with its complete UI and branding. The original PSD can be sent as an ArrayBuffer through its documented messaging API, only after the user chooses that route. Messages are checked against both the Photopea origin and frame window. Native and Photopea workspaces are separate, and the iframe remains mounted on return to native editing. Download advanced edits through Photopea's File > Save as PSD before reloading. Photopea needs external connectivity; exact Adobe feature parity and arbitrary font/effect fidelity are not promised.

Native PSD imports run in a dedicated worker with cancellation, timeout, dimension/file-size and decoded-memory limits. Rendering errors are isolated per document with a backup-download recovery screen. Imported optional layer fields are normalized and numeric transforms are bounded. The exact intermittent gray-screen incident reported by the user has not been reproduced with their original file.


Current update: Photopea integration removed. PSD import stays native with the previously documented compatibility limits. Native Filter gallery offers 18 original presets and 13 pixel adjustments on unlocked image layers. Original source and settings persist in project data. This is not the complete Lightroom or Photoshop toolset.
