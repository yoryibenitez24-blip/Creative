// On-device segmentation (U²-Netp, MODNet) through onnxruntime-web (WASM) — same code as the browser worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as ort from '../node_modules/onnxruntime-web/dist/ort.wasm.min.mjs';
import { segment, encodeAlpha, decodeAlpha, preprocess, AI_MODELS } from '../src/engine/aiseg.js';
import { evaluateMask } from '../src/engine/masks.js';
ort.env.wasm.numThreads = 1;
const U2 = new URL('../node_modules/@rmbg/model-u2netp/u2netp.onnx', import.meta.url), MOD = new URL('../node_modules/@dloizides/background-removal/models/modnet.onnx', import.meta.url);

// A photo-like scene: textured sky/ground with a large distinct object off-centre.
function scene(w = 360, h = 240) {
  const d = new Uint8ClampedArray(w * h * 4), gt = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, inObj = ((x - 150) / 70) ** 2 + ((y - 130) / 85) ** 2 < 1, n = ((x * 13 + y * 7) % 11) - 5;
    const c = inObj ? [210 + n, 90 + n, 40] : y < 120 ? [90 + y / 3 + n, 140 + y / 4 + n, 215] : [70 + n, 105 + (x % 9) + n, 60 + n];
    d.set([...c, 255], i * 4); gt[i] = inObj ? 1 : 0;
  }
  return { buf: { w, h, data: d }, gt };
}
const iou = (a, gt) => { let I = 0, U = 0; for (let i = 0; i < gt.length; i++) { const p = a[i] > 0.5 ? 1 : 0; I += p & gt[i]; U += p | gt[i]; } return I / U; };

test('aiseg: preprocessing shapes and normalisation', () => {
  const { buf } = scene(), t = preprocess(buf, AI_MODELS.subject);
  assert.deepEqual(t.dims, [1, 3, 320, 320]);
  const m = preprocess(buf, AI_MODELS.people); assert.equal(m.W % 32, 0); assert.equal(Math.max(m.W, m.H), 512);
});

test('aiseg: U²-Netp finds the salient object; stored alpha drives a resolution-independent mask', { skip: !existsSync(U2) && 'model not installed' }, async () => {
  const s = await ort.InferenceSession.create(readFileSync(U2)), { buf, gt } = scene();
  const a = await segment(ort, s, buf, 'subject'), ai = encodeAlpha(a);
  assert.equal(decodeAlpha(ai).length, a.w * a.h);
  const mask = { id: 'm', enabled: true, invert: false, amount: 100, components: [{ id: 'c', type: 'subject', op: 'add', invert: false, params: { sensitivity: 50, ai } }], adjust: {} };
  const alpha = evaluateMask(mask, buf, buf.w, buf.h);
  const score = iou(alpha, gt); assert.ok(score > 0.8, 'subject IoU ' + score.toFixed(3));
  const bg = evaluateMask({ ...mask, components: [{ ...mask.components[0], type: 'background' }] }, buf, buf.w, buf.h);
  let err = 0; for (let i = 0; i < bg.length; i++) err += Math.abs(bg[i] + alpha[i] - 1); assert.ok(err / bg.length < 0.02, 'background = 1 − subject');
});

test('aiseg: MODNet runs and returns a matte the size of its input', { skip: !existsSync(MOD) && 'model not installed' }, async () => {
  const s = await ort.InferenceSession.create(readFileSync(MOD)), { buf } = scene();
  const a = await segment(ort, s, buf, 'people'); assert.equal(a.w % 32, 0); assert.equal(a.data.length, a.w * a.h);
});
