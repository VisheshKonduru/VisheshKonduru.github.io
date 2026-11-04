// node assets/3d/mqp/test_percep.mjs
import assert from 'node:assert/strict';
import { CAM, CAMS, distort, undistort, fieldToPixel, pixelToField, retinex, detect, whiteBalance, BETA } from './percep.js';

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
  const wb = whiteBalance(new Uint8ClampedArray([200, 150, 60, 255, 100, 80, 30, 255]), 2, 1);
  assert.ok(Math.abs(wb[0] - wb[2]) < 40 && Math.abs(wb[0] - wb[1]) < 20); ok('gray-world white balance');
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
console.log(`${n} passed`);
