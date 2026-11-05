// Run: node test_vision.mjs
// Ray-traces the camera's undistorted image (board + balls) in pure JS, then runs the same
// calibration and detection code the demo uses, and compares detected ball centres with the truth.
import * as V from './vision.js';
const K = V.INTRINSICS, R = 0.012;
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const CAM_C = [0.36, 0, 0.21], CAM_T = [0.12, 0, 0.02];

// Ray-traced raw fisheye frame, then the demo's own undistortion remap: the same path the browser runs.
const LUT = V.buildUndistortLUT(K);
function render(cam, balls) {
  const raw = renderRaw(cam, balls), out = new Uint8ClampedArray(K.W * K.H * 4);
  V.undistortImage(raw, out, LUT, K.W, K.H); return out;
}
function renderRaw(cam, balls) {
  const img = new Uint8ClampedArray(K.W * K.H * 4);
  const Rt = [0, 1, 2].map(j => cam.R.map(r => r[j]));   // R transpose
  const zt = V.BOARD.origin[2];
  for (let j = 0; j < K.H; j++) for (let i = 0; i < K.W; i++) {
    const n = V.rawToNorm(i + 0.5, j + 0.5, K);
    if (!n) { const o = 4 * (j * K.W + i); img[o + 3] = 255; continue; }
    const [x, y] = n;
    const d = V.mat3vec(Rt, [x, y, 1]);
    let col = [120, 110, 100], tBest = Infinity;
    const t = (zt - cam.C[2]) / d[2];
    if (t > 0) { const px = cam.C[0] + t * d[0], py = cam.C[1] + t * d[1], b = V.baseToBoard([px, py]);
      if (b[0] >= 0 && b[1] >= 0 && b[0] < V.BOARD.Lx && b[1] < V.BOARD.Ly) { const w = (Math.floor(b[0] / V.BOARD.sq) + Math.floor(b[1] / V.BOARD.sq)) % 2; col = w ? [30, 30, 30] : [225, 225, 220]; tBest = t; } }
    for (const bl of balls) {
      const oc = [cam.C[0] - bl.p[0], cam.C[1] - bl.p[1], cam.C[2] - bl.p[2]];
      const a = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, bb = 2 * (oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2]), c = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - R * R;
      const disc = bb * bb - 4 * a * c; if (disc < 0) continue;
      const tt = (-bb - Math.sqrt(disc)) / (2 * a); if (tt > 0 && tt < tBest) { tBest = tt; col = bl.rgb; }
    }
    const o = 4 * (j * K.W + i); img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255;
  }
  return img;
}
const RGB = { red: [200, 30, 30], orange: [240, 110, 20], yellow: [235, 195, 30], green: [30, 150, 70] };

// 1. distortion round trip
let dmax = 0;
for (let k = 0; k < 2000; k++) { const u = rnd() * K.W, v = rnd() * K.H; const n = V.rawToNorm(u, v, K); if (!n) continue; const [ur, vr] = V.rawPixel(n[0], n[1], K); dmax = Math.max(dmax, Math.hypot(ur - u, vr - v)); }
// How strongly the lens bends the board: sagitta (bow) of the board's two long edges, raw vs undistorted.
const camS = V.makeCamera(CAM_C, CAM_T);
function bow(dist) { let worst = 0; for (const x of [0, V.BOARD.Lx]) { const a = V.project(camS, V.boardToBase([x, 0]), dist), b = V.project(camS, V.boardToBase([x, V.BOARD.Ly]), dist), m = V.project(camS, V.boardToBase([x, V.BOARD.Ly / 2]), dist);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]); worst = Math.max(worst, Math.abs((b[0] - a[0]) * (a[1] - m[1]) - (a[0] - m[0]) * (b[1] - a[1])) / L); } return worst; }
const bowRaw = bow(true), bowUnd = bow(false);

// 2. calibration from the rendered board, seeded by a rough guess (true pose with 3 px offset)
const cam = V.makeCamera(CAM_C, CAM_T);
const empty = render(cam, []);
if (process.env.PNG) { const { writePng } = await import(process.env.PNG); writePng('raw.png', renderRaw(cam, []), K.W, K.H); writePng('und.png', empty, K.W, K.H); }
const seedPredict = (b) => { const p = V.project(cam, V.boardToBase(b), false); return [p[0] + 3, p[1] - 2]; };
const calib = V.calibrateFromImage(empty, K, seedPredict);
const camErr = Math.hypot(...V.boardToBase(calib.cal.Cb, calib.cal.Cb[2]).map((v, i) => v - CAM_C[i])) * 1000;

// 3. detection of random balls
function trial(camRender, cal, n) {
  let errs = [], missed = 0;
  for (let t = 0; t < n; t++) {
    const balls = []; const cols = V.COLORS;
    for (let k = 0; k < 4; k++) {
      let p; do { p = V.boardToBase([0.035 + rnd() * (V.BOARD.Lx - 0.055), 0.02 + rnd() * (V.BOARD.Ly - 0.04)], R); } while (balls.some(b => Math.hypot(b.p[0] - p[0], b.p[1] - p[1]) < 0.035));
      balls.push({ p, colour: cols[k], rgb: RGB[cols[k]] });
    }
    const img = render(camRender, balls);
    const mask = V.boardMask(cal, K.W, K.H);
    const { blobs } = V.detect(img, mask, cal, K, R);
    for (const b of balls) {
      const d = blobs.filter(x => x.ok && x.colour === b.colour);
      if (!d.length) { missed++; continue; }
      const e = Math.hypot(d[0].base[0] - b.p[0], d[0].base[1] - b.p[1]) * 1000; errs.push(e); if (e > 3 && process.env.DBG) console.log("outlier", e.toFixed(1), V.baseToBoard(b.p).map(v => (v*1000).toFixed(0)), d.length, d[0].ratio.toFixed(2));
    }
  }
  errs.sort((a, b) => a - b);
  return { n: errs.length, missed, mean: errs.reduce((a, b) => a + b, 0) / errs.length, max: errs[errs.length - 1] };
}
const good = trial(cam, calib.cal, 40);
// Without the ball-height correction (ray hits the board plane): shows why it matters.
const noH = (() => { const cal = { ...calib.cal }; let e = [];
  for (let t = 0; t < 20; t++) { const p = V.boardToBase([0.03 + rnd() * 0.11, 0.03 + rnd() * 0.19], R); const img = render(cam, [{ p, rgb: RGB.red }]);
    const b = V.detect(img, V.boardMask(cal, K.W, K.H), cal, K, R).blobs.find(x => x.colour === 'red'); if (!b) continue;
    const q = V.boardToBase(V.applyH(cal.Hinv, b.u, b.v)); e.push(Math.hypot(q[0] - p[0], q[1] - p[1]) * 1000); }
  return e.reduce((a, b) => a + b, 0) / e.length; })();

// 4. nudged camera, stale calibration, then recalibration from the image seeded by the stale H
const camN = V.makeCamera([CAM_C[0] + 0.006, CAM_C[1] + 0.004, CAM_C[2] - 0.003], [CAM_T[0], CAM_T[1] + 0.006, CAM_T[2]]);
const stale = trial(camN, calib.cal, 15);
const recal = V.calibrateFromImage(render(camN, []), K, (b) => V.applyH(calib.cal.H, b[0], b[1]));
const fixed = trial(camN, recal.cal, 15);

const f = (x) => x.toFixed(2);
console.log(`distortion round trip max ${dmax.toExponential(1)} px`);
console.log(`board edge bow: raw ${f(bowRaw)} px, undistorted ${f(bowUnd)} px`);
console.log(`calibration: ${calib.used}/${calib.total} corners, reprojection RMS ${f(calib.rms)} px, recovered camera centre error ${f(camErr)} mm`);
console.log(`detection, ${good.n} balls: mean ${f(good.mean)} mm, max ${f(good.max)} mm, missed ${good.missed}`);
console.log(`same without ball-height correction: mean ${f(noH)} mm`);
console.log(`camera nudged, stale calibration: mean ${f(stale.mean)} mm, max ${f(stale.max)} mm`);
console.log(`after recalibration (${recal.used} corners, RMS ${f(recal.rms)} px): mean ${f(fixed.mean)} mm, max ${f(fixed.max)} mm`);
const ok = dmax < 1e-6 && bowRaw > 12 && bowUnd < 0.01 && calib.rms < 0.5 && good.max < 2.5 && good.missed === 0 && stale.mean > 3 * fixed.mean && fixed.max < 3;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
