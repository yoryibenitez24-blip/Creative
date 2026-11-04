import { AssetStore } from '../engine/assets.js';
import { idbAssetBackend } from '../workspace.js';
// One content-addressed store per page. Documents and undo snapshots reference ids only.
export const assetStore = new AssetStore(idbAssetBackend);
