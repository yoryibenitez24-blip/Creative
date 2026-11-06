// Copies the on-device AI runtime and model weights from node_modules into dist/ (served statically).
// dist/ort/ and dist/models/ are build output (git-ignored); run automatically by build, dev and postinstall.
import { mkdirSync, copyFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..'), nm = join(root, 'node_modules'), dist = join(root, 'dist');
const files = [
  [join(nm, 'onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'), join(dist, 'ort/ort-wasm-simd-threaded.wasm')],
  [join(nm, 'onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'), join(dist, 'ort/ort-wasm-simd-threaded.mjs')],
  [join(nm, '@rmbg/model-u2netp/u2netp.onnx'), join(dist, 'models/u2netp.onnx')],
  [join(nm, '@dloizides/background-removal/models/modnet.onnx'), join(dist, 'models/modnet.onnx')],
];
let missing = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) { console.warn('copy-models: missing ' + from + ' (run npm install)'); missing++; continue; }
  mkdirSync(join(to, '..'), { recursive: true });
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) copyFileSync(from, to);
}
writeFileSync(join(dist, 'models/NOTICE.md'), `# Model notices\n\nu2netp.onnx — U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection, Xuebin Qin et al.\nWeights: https://github.com/xuebinqin/U-2-Net, Apache License 2.0. ONNX export as distributed by rembg (4,574,861 bytes).\n\nmodnet.onnx — MODNet: Trimap-Free Portrait Matting in Real Time, Zhanghan Ke et al.\nWeights: https://github.com/ZHKKKe/MODNet, Apache License 2.0. ONNX export as distributed in @dloizides/background-removal.\n\nRuntime: onnxruntime-web (MIT). Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0\n`);
if (missing) process.exitCode = 0; // never fail a build: masking falls back to classical detection
