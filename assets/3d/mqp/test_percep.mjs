// node assets/3d/mqp/test_percep.mjs
import assert from 'node:assert/strict';
import { CAM, CAMS, distort, undistort, fieldToPixel, pixelToField, retinex, detect, senderCorrect, BETA, SIGMA, TINT, gaussKernel, createPipe, mergeEstimates, boxesFromAlpha } from './percep.js';

let n = 0; const ok = (m) => { n++; console.log('ok', m); };

// Lens round trip
for (const [x, y] of [[0, 0], [0.4, -0.2], [1.2, 0.5], [-1.5, 0.8]]) {
  const [xd, yd] = distort(x, y), u = undistort(xd, yd);
  assert.ok(Math.hypot(u[0] - x, u[1] - y) < 1e-7);
}
ok('distort / undistort round trip');

// Known block pose -> pixel -> back to the field point.
const poses = [{ x: 0, y: 0, th: 0 }, { x: -30, y: 12, th: 0.7 }, { x: 40, y: -25, th: -2.4 }];
let worst = 0, tried = 0;
for (const pose of poses) for (const cam of CAMS) for (let d = 14; d <= 90; d += 8) for (let a = -55; a <= 55; a += 11) {
  const ang = pose.th + cam.psi + a * Math.PI / 180;
  const p = [pose.x + Math.cos(ang) * d, pose.y + Math.sin(ang) * d, 0];
  const px = fieldToPixel(p, pose, cam);
  if (!px || px[0] < 0 || px[0] >= CAM.W || px[1] < 0 || px[1] >= CAM.H) continue;
  const q = pixelToField(px[0], px[1], pose, cam);
  assert.ok(q && !q.above, 'ground hit');
  worst = Math.max(worst, Math.hypot(q.x - p[0], q.y - p[1])); tried++;
}
assert.ok(tried > 100, `enough samples (${tried})`);
assert.ok(worst < 1e-4, `round trip error ${worst}`);
ok(`ground-plane projection round trip, ${tried} points, worst ${worst.toExponential(1)} in`);

// A point straight ahead on the optical axis lands at h / tan(15 deg) from the camera.
{
  const pose = { x: 0, y: 0, th: 0 }, cam = CAMS[0], q = pixelToField(CAM.cx, CAM.cy, pose, cam);
  const dist = Math.hypot(q.x - (cam.ox), q.y - cam.oy);
  assert.ok(Math.abs(dist - 8 / Math.tan(15 * Math.PI / 180)) < 1e-9);
  ok('principal point hits the floor at h / tan 15 deg');
}

// A point above the camera's height never meets the floor: dropped, like a block in a goal.
{
  const pose = { x: 0, y: 0, th: 0 }, cam = CAMS[0], ang = cam.psi;
  const px = fieldToPixel([Math.cos(ang) * 40 + cam.ox, Math.sin(ang) * 40 + cam.oy, 12], pose, cam);
  const q = pixelToField(px[0], px[1], pose, cam);
  assert.ok(q.above, 'above horizon');
  ok('raised point projects above the horizon');
}

// Retinex on a synthetic image: flat grey reflectance under a radial hotspot.
{
  const w = 640, h = 200, img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r2 = ((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2, L = 30 + 120 * Math.exp(-r2 * 0.8), j = (y * w + x) * 4;
    img[j] = img[j + 1] = img[j + 2] = L * 0.6; img[j + 3] = 255;
  }
  const R = retinex(img, w, h);
  assert.equal(R.sw, 80); assert.equal(R.sh, 25);
  assert.ok(R.L.every(v => v >= 1), 'L clipped to at least 1');
  const raw = [], cor = [];
  for (let y = 24; y < h - 24; y++) for (let x = 40; x < w - 40; x++) { const j = (y * w + x) * 4; raw.push(img[j]); cor.push(R.out[j]); }
  const spread = (a) => a.reduce((m, v) => Math.max(m, v), -1e9) - a.reduce((m, v) => Math.min(m, v), 1e9), mean = cor.reduce((s, v) => s + v, 0) / cor.length;
  assert.ok(spread(cor) < spread(raw) / 3, `hotspot flattened ${spread(raw)} -> ${spread(cor)}`);
  assert.ok(Math.abs(mean - BETA) < 12, `brought to beta, mean ${mean.toFixed(1)}`);
  ok(`retinex flattens a hotspot (spread ${spread(raw)} -> ${spread(cor)}, mean ${mean.toFixed(0)})`);
  // clipping to uint8
  const hot = new Uint8ClampedArray(64 * 16 * 4).fill(255); hot[0] = 0;
  const H = retinex(hot, 64, 16); assert.ok(H.out.every(v => v >= 0 && v <= 255));
  ok('output clipped to [0, 255]');
  // stream_raw.py: convertScaleAbs(1.3, 30) rounds, then B x1.2, G x0.95, R x0.90 truncate.
  const sc = senderCorrect(new Uint8ClampedArray([100, 100, 100, 255, 200, 10, 250, 255]), 2, 1);
  assert.deepEqual([...sc.slice(0, 3)], [144, 152, 192]);      // 160 * 0.90, 0.95, 1.2
  assert.deepEqual([...sc.slice(4, 7)], [255 * 0.9 | 0, 43 * 0.95 | 0, 255]);
  ok('sender correction matches stream_raw.py');
  // IE.py: GaussianBlur((31, 31), 0) on 320x50, scaled to 15x15 for our 160x25 -> sigma 2.6, radius 7
  const G = gaussKernel(); assert.ok(Math.abs(SIGMA - 2.6) < 1e-9); assert.equal(G.r, 7);
  assert.ok(Math.abs(gaussKernel(31, 0.3 * 14 + 0.8).r - 15) < 1e-9 && Math.abs(0.3 * 14 + 0.8 - 5) < 1e-9); assert.ok(Math.abs(G.k.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  ok('15x15 kernel, sigma 2.6 (owner 31x31, sigma 5, at full size)');
  // The demo's sensor tint is roughly undone by the sender: a neutral grey comes out near neutral.
  const grey = new Uint8ClampedArray([50 * TINT[0], 50 * TINT[1], 50 * TINT[2], 255]), n2 = senderCorrect(grey, 1, 1);
  assert.ok(grey[2] < grey[0] - 15, 'raw is yellow (low blue)'); assert.ok(Math.max(n2[0], n2[1], n2[2]) - Math.min(n2[0], n2[1], n2[2]) < 12, `balanced near neutral ${[...n2.slice(0, 3)]}`);
  ok(`sensor tint neutralised by the sender (${[...grey.slice(0, 3)]} -> ${[...n2.slice(0, 3)]})`);
}

// Detector finds a red and a blue patch, in the right tiles.
{
  const w = 640, h = 50, img = new Uint8ClampedArray(w * h * 4).fill(120);
  const put = (x0, y0, c) => { for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 5; x++) { const j = (y * w + x) * 4; img.set(c, j); } };
  put(40, 20, [220, 40, 40, 255]); put(400, 10, [30, 50, 220, 255]);
  const b = detect(img, w, h, 320);
  assert.equal(b.length, 2);
  const red = b.find(x => x.color === 'red'), blue = b.find(x => x.color === 'blue');
  assert.deepEqual([red.cam, red.x0, red.y1], [0, 40, 24]); assert.deepEqual([blue.cam, blue.x0, blue.y1], [1, 80, 14]);
  ok('colour detector boxes');
}
// The fused pipeline matches the step-by-step reference.
{
  const w = 1280, h = 200, img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lx = (x % 320 - 160) / 160, ly = (y - 100) / 160, g = 0.22 + 1.05 * Math.exp(-(lx * lx + ly * ly) / 0.16), j = (y * w + x) * 4;
    let c = [140, 140, 140]; if ((x % 97) < 6 && (y % 53) < 5) c = (x / 97 | 0) % 2 ? [200, 30, 25] : [30, 60, 210];
    img[j] = c[0] * g * 0.55 * TINT[0]; img[j + 1] = c[1] * g * 0.55 * TINT[1]; img[j + 2] = c[2] * g * 0.55 * TINT[2]; img[j + 3] = 255;
  }
  const R = retinex(senderCorrect(img, w, h), w, h), ref = detect(R.out, w, h, 320);
  const P = createPipe({ W: w, H: h }); P.load(img); const fast = P.correct();
  let worst = 0; for (let j = 0; j < R.out.length; j += 4) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(R.out[j + c] - P.out[j + c]));
  let sum = 0; for (let j = 0; j < R.out.length; j++) sum += Math.abs(R.out[j] - P.out[j]); const mean = sum / (R.out.length * 0.75);
  assert.ok(worst <= 1 && mean < 0.05, `fused vs reference, worst ${worst}, mean ${mean}`);
  assert.equal(fast.length, ref.length);
  ok(`fused pipeline matches reference (max diff ${worst} level, ${fast.length} boxes both)`);
  const g = mergeEstimates([{ color: 'red', x: 0, y: 0, cam: 0 }, { color: 'red', x: 2, y: 1, cam: 1 }, { color: 'blue', x: 1, y: 0, cam: 1 }, { color: 'red', x: 30, y: 0, cam: 0 }]);
  assert.equal(g.length, 3); ok('overlapping detections merge per block');
  // GPU readback form: class in alpha, 8x8 flags. Same boxes as the full scan.
  const Q = createPipe({ W: w, H: h }); Q.load(img); const want = Q.correct(), cls = new Uint8Array(w * h);
  const bytes = new Uint8Array(w * h * 4).fill(255), flags = new Uint8Array((w / 8) * (h / 8) * 4);
  for (const b of want) for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) { const i = y * w + b.cam * 320 + x; bytes[i * 4 + 3] = b.color === 'red' ? 254 : 253; flags[((y >> 3) * (w / 8) + (((b.cam * 320 + x)) >> 3)) * 4] = 1; }
  const got = boxesFromAlpha(bytes, flags, new Uint8Array(w * h), new Int32Array(w * h), w, h);
  const key = (a) => a.map(b => [b.color, b.cam, b.x0, b.y0, b.x1, b.y1].join()).sort().join('|');
  assert.equal(key(got), key(want)); ok(`flag-restricted search finds the same ${got.length} boxes`);
}
console.log(`${n} passed`);
