// Camera model, calibration and ball detection for the RBE-3001 arm demo.
// Pure JS (no three.js), so the same code runs in the browser and in Node tests.
// Conventions: base frame is the arm's URDF base (metres, z up). Image pixels are
// continuous coordinates with pixel (i, j) centred at (i + 0.5, j + 0.5), v pointing down.

// ---------- small linear algebra ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map(v => v / l); };
export const mat3mul = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const mat3vec = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
export function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
          [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

// Symmetric eigen-decomposition (cyclic Jacobi). Returns {values, vectors (columns)}.
function jacobiEigen(S) {
  const n = S.length, A = S.map(r => [...r]), V = A.map((_, i) => A.map((__, j) => +(i === j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

// ---------- camera model (simulated camera, not the course camera) ----------
export const INTRINSICS = { W: 480, H: 320, fx: 380, fy: 380, cx: 240, cy: 160, k1: -0.12, k2: 0.02 };

// Camera looking from C at target, image x right, y down, z forward (OpenCV convention).
export function makeCamera(C, target, K = INTRINSICS) {
  const f = norm(sub(target, C));
  const r = norm(cross(f, [0, 0, 1]));
  const d = cross(f, r);
  return { ...K, C: [...C], R: [r, d, f] };   // rows of R: camera axes expressed in base frame
}
export function distortNorm(x, y, K) {
  const r2 = x * x + y * y, s = 1 + K.k1 * r2 + K.k2 * r2 * r2;
  return [x * s, y * s];
}
export function undistortNorm(xd, yd, K) {
  let x = xd, y = yd;
  for (let i = 0; i < 12; i++) { const r2 = x * x + y * y, s = 1 + K.k1 * r2 + K.k2 * r2 * r2; x = xd / s; y = yd / s; }
  return [x, y];
}
// Base-frame point -> pixel. distorted=false gives the ideal (undistorted) pixel.
export function project(cam, P, distorted = true) {
  const pc = mat3vec(cam.R, sub(P, cam.C));
  let x = pc[0] / pc[2], y = pc[1] / pc[2];
  if (distorted) [x, y] = distortNorm(x, y, cam);
  return [cam.fx * x + cam.cx, cam.fy * y + cam.cy, pc[2]];
}
export function undistortPixel(u, v, K) {
  const [x, y] = undistortNorm((u - K.cx) / K.fx, (v - K.cy) / K.fy, K);
  return [K.fx * x + K.cx, K.fy * y + K.cy];
}

// ---------- board ----------
// Checkerboard 7 x 10 squares of 25 mm. Board frame: origin at the outer corner nearest the arm
// on its right, xb along base x (away from the arm), yb along base y, on the board's top surface.
export const BOARD = { sq: 0.025, nx: 7, ny: 10, origin: [0.075, -0.125, 0.002] };
BOARD.Lx = BOARD.sq * BOARD.nx; BOARD.Ly = BOARD.sq * BOARD.ny;
export const boardToBase = (b, h = 0) => [b[0] + BOARD.origin[0], b[1] + BOARD.origin[1], BOARD.origin[2] + h];
export const baseToBoard = (p) => [p[0] - BOARD.origin[0], p[1] - BOARD.origin[1]];
export function innerCorners() {
  const pts = [];
  for (let i = 1; i < BOARD.nx; i++) for (let j = 1; j < BOARD.ny; j++) pts.push([i * BOARD.sq, j * BOARD.sq]);
  return pts;
}

// ---------- homography (normalised DLT) ----------
function normT(pts) {
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  const md = pts.reduce((s, p) => s + Math.hypot(p[0] - mx, p[1] - my), 0) / n, k = Math.SQRT2 / md;
  return [[k, 0, -k * mx], [0, k, -k * my], [0, 0, 1]];
}
// Solves img ~ H * [board; 1] from >= 4 correspondences.
export function dlt(board, img) {
  const Tb = normT(board), Ti = normT(img);
  const A = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const addRow = (r) => { for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) A[i][j] += r[i] * r[j]; };
  for (let k = 0; k < board.length; k++) {
    const [X, Y] = mat3vec(Tb, [board[k][0], board[k][1], 1]), [u, v] = mat3vec(Ti, [img[k][0], img[k][1], 1]);
    addRow([-X, -Y, -1, 0, 0, 0, u * X, u * Y, u]);
    addRow([0, 0, 0, -X, -Y, -1, v * X, v * Y, v]);
  }
  const { values, vectors } = jacobiEigen(A);
  const m = values.indexOf(Math.min(...values));
  const h = vectors.map(r => r[m]);
  const Hn = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]]];
  const H = mat3mul(mat3mul(inv3(Ti), Hn), Tb);
  return H.map(r => r.map(v => v / H[2][2]));
}
export const applyH = (H, x, y) => { const p = mat3vec(H, [x, y, 1]); return [p[0] / p[2], p[1] / p[2]]; };

// Extrinsics from H = K [r1 r2 t]. Returns camera centre in the board frame.
export function decomposeH(H, K) {
  const Ki = inv3([[K.fx, 0, K.cx], [0, K.fy, K.cy], [0, 0, 1]]);
  const M = mat3mul(Ki, H);
  const m1 = [M[0][0], M[1][0], M[2][0]], m2 = [M[0][1], M[1][1], M[2][1]], m3 = [M[0][2], M[1][2], M[2][2]];
  let lam = 2 / (Math.hypot(...m1) + Math.hypot(...m2));
  if (m3[2] * lam < 0) lam = -lam;                       // board must be in front of the camera
  const r1 = m1.map(v => v * lam), r2 = m2.map(v => v * lam), t = m3.map(v => v * lam), r3 = cross(r1, r2);
  const C = [-(r1[0] * t[0] + r1[1] * t[1] + r1[2] * t[2]), -(r2[0] * t[0] + r2[1] * t[1] + r2[2] * t[2]), -(r3[0] * t[0] + r3[1] * t[1] + r3[2] * t[2])];
  return { C };
}
export function makeCalibration(H, K) {
  return { H, Hinv: inv3(H), Cb: decomposeH(H, K).C };
}
// Undistorted pixel of a ball centroid -> base-frame ball centre.
// The ray through the pixel is intersected with the plane of ball centres (height h above the
// board), not the board itself, using the camera centre recovered from the homography.
export function pixelToBase(cal, u, v, h) {
  const b = applyH(cal.Hinv, u, v);
  const C = cal.Cb, s = (C[2] - h) / C[2];
  const bc = [C[0] + (b[0] - C[0]) * s, C[1] + (b[1] - C[1]) * s];
  return { board: b, boardC: bc, base: boardToBase(bc, h) };
}

// ---------- image processing ----------
// Lookup from undistorted pixel -> raw (distorted) sample position.
export function buildUndistortLUT(K) {
  const lut = new Float32Array(K.W * K.H * 2);
  for (let j = 0; j < K.H; j++) for (let i = 0; i < K.W; i++) {
    const [xd, yd] = distortNorm((i + 0.5 - K.cx) / K.fx, (j + 0.5 - K.cy) / K.fy, K);
    const k = (j * K.W + i) * 2; lut[k] = K.fx * xd + K.cx - 0.5; lut[k + 1] = K.fy * yd + K.cy - 0.5;
  }
  return lut;
}
// raw, out: RGBA Uint8 top-down. Bilinear remap.
export function undistortImage(raw, out, lut, W, H) {
  for (let p = 0, n = W * H; p < n; p++) {
    const x = lut[2 * p], y = lut[2 * p + 1], o = 4 * p;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[o] = out[o + 1] = out[o + 2] = 0; out[o + 3] = 255; continue; }
    const fx = x - x0, fy = y - y0, a = 4 * (y0 * W + x0), b = a + 4, c = a + 4 * W, d = c + 4;
    for (let ch = 0; ch < 3; ch++)
      out[o + ch] = (raw[a + ch] * (1 - fx) + raw[b + ch] * fx) * (1 - fy) + (raw[c + ch] * (1 - fx) + raw[d + ch] * fx) * fy;
    out[o + 3] = 255;
  }
}
// 1 inside the board region (as the calibration sees it), 0 outside.
export function boardMask(cal, W, H, inset = 0.004) {
  const m = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const [x, y] = applyH(cal.Hinv, i + 0.5, j + 0.5);
    m[j * W + i] = x > inset && y > inset && x < BOARD.Lx - inset && y < BOARD.Ly - inset ? 1 : 0;
  }
  return m;
}
export const COLORS = ['red', 'orange', 'yellow', 'green'];
// HSV thresholds (hue in degrees, s and v 0..1) on the 8-bit sRGB image.
export const HSV = {
  red: { h: [[0, 10], [345, 360]], s: 0.5, v: 0.22 },
  orange: { h: [[13, 32]], s: 0.55, v: 0.3 },
  yellow: { h: [[38, 66]], s: 0.45, v: 0.3 },
  green: { h: [[95, 170]], s: 0.35, v: 0.12 },
};
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
  if (h < 0) h += 360;
  return [h, mx ? d / mx : 0, mx / 255];
}
// Label image: 0 background, 1..4 colour index + 1.
export function colourLabels(img, mask, W, H, out = new Uint8Array(W * H)) {
  for (let p = 0, n = W * H; p < n; p++) {
    out[p] = 0;
    if (!mask[p]) continue;
    const [h, s, v] = hsv(img[4 * p], img[4 * p + 1], img[4 * p + 2]);
    for (let c = 0; c < 4; c++) {
      const t = HSV[COLORS[c]];
      if (s >= t.s && v >= t.v && t.h.some(([a, b]) => h >= a && h < b)) { out[p] = c + 1; break; }
    }
  }
  return out;
}
// 4-connected components per colour. Returns blobs with area, centroid, bbox and boundary pixels.
export function components(labels, W, H) {
  const seen = new Uint8Array(W * H), blobs = [], stack = new Int32Array(W * H);
  for (let p0 = 0; p0 < W * H; p0++) {
    const L = labels[p0];
    if (!L || seen[p0]) continue;
    let sp = 0, area = 0, su = 0, sv = 0, minx = W, miny = H, maxx = 0, maxy = 0; const edge = [];
    stack[sp++] = p0; seen[p0] = 1;
    while (sp) {
      const p = stack[--sp], x = p % W, y = (p / W) | 0;
      area++; su += x + 0.5; sv += y + 0.5;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      let boundary = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { boundary = true; continue; }
        const q = ny * W + nx;
        if (labels[q] !== L) { boundary = true; continue; }
        if (!seen[q]) { seen[q] = 1; stack[sp++] = q; }
      }
      if (boundary) edge.push(x, y);
    }
    blobs.push({ colour: COLORS[L - 1], area, u: su / area, v: sv / area, bbox: [minx, miny, maxx, maxy], edge });
  }
  return blobs;
}
// Expected image area of a ball of radius R whose centre is at base point P, seen by the calibration.
export function expectedArea(cal, P, R, K) {
  const Cbase = boardToBase(cal.Cb, cal.Cb[2]);
  const d = Math.hypot(P[0] - Cbase[0], P[1] - Cbase[1], P[2] - Cbase[2]);
  return Math.PI * (K.fx * R / d) ** 2;
}
// Full detection on one undistorted frame.
export function detect(img, mask, cal, K, R, labels) {
  const lab = colourLabels(img, mask, K.W, K.H, labels);
  const out = [];
  for (const b of components(lab, K.W, K.H)) {
    if (b.area < 12) continue;                          // speckle from noise
    const w = pixelToBase(cal, b.u, b.v, R);
    const ratio = b.area / expectedArea(cal, w.base, R, K);
    b.ratio = ratio; Object.assign(b, w);
    b.ok = ratio > 0.45 && ratio < 1.8;
    out.push(b);
  }
  return { labels: lab, blobs: out };
}

// ---------- checkerboard corners (for recalibration from the image) ----------
// ChESS-style X-corner response on a grey image, sampled on a 16-point circle.
const RING = Array.from({ length: 16 }, (_, k) => [Math.cos(k * Math.PI / 8), Math.sin(k * Math.PI / 8)]);
function chess(gray, W, x, y, r) {
  const s = RING.map(([c, sn]) => gray[Math.round(y + r * sn) * W + Math.round(x + r * c)]);
  let sum = 0, diff = 0;
  for (let n = 0; n < 4; n++) sum += Math.abs(s[n] + s[n + 8] - s[n + 4] - s[n + 12]);
  for (let n = 0; n < 8; n++) diff += Math.abs(s[n] - s[n + 8]);
  return sum - diff;
}
export function toGray(img, W, H, out = new Float32Array(W * H)) {
  for (let p = 0; p < W * H; p++) out[p] = 0.299 * img[4 * p] + 0.587 * img[4 * p + 1] + 0.114 * img[4 * p + 2];
  return out;
}
// Search a window around each predicted corner for the strongest X-corner, refined to sub-pixel.
export function findCorners(gray, W, H, predicted, win = 12, r = 5) {
  const found = [];
  for (const [pu, pv] of predicted) {
    let best = -Infinity, bx = 0, by = 0;
    const resp = new Map();
    for (let y = Math.round(pv) - win; y <= Math.round(pv) + win; y++) for (let x = Math.round(pu) - win; x <= Math.round(pu) + win; x++) {
      if (x < r + 1 || y < r + 1 || x >= W - r - 1 || y >= H - r - 1) continue;
      const v = chess(gray, W, x, y, r); resp.set(y * W + x, v);
      if (v > best) { best = v; bx = x; by = y; }
    }
    if (best < 150) { found.push(null); continue; }   // no clear corner (occluded or off-image)
    let sw = 0, sx = 0, sy = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const v = resp.get((by + dy) * W + bx + dx); if (!(v > 0)) continue;
      sw += v; sx += v * (bx + dx + 0.5); sy += v * (by + dy + 0.5);
    }
    found.push([sx / sw, sy / sw]);
  }
  return found;
}
// Calibrate from an undistorted image: corners seeded by a prediction (initial guess or old H).
export function calibrateFromImage(img, K, predict) {
  const gray = toGray(img, K.W, K.H);
  const board = innerCorners();
  let pred = board.map(b => predict(b));
  // 1. Global shift: the grid of predictions is slid over the image and scored by the summed
  //    corner response. The board border breaks the pattern's periodicity, so a shift by one
  //    whole square scores lower than the true one.
  let best = -Infinity, sh = [0, 0];
  const inImg = (u, v) => u > 7 && v > 7 && u < K.W - 8 && v < K.H - 8;
  for (let dy = -24; dy <= 24; dy++) for (let dx = -24; dx <= 24; dx++) {
    let sc = 0;
    for (const [u, v] of pred) { const x = Math.round(u + dx), y = Math.round(v + dy); if (inImg(x, y)) sc += Math.max(0, chess(gray, K.W, x, y, 5)); }
    if (sc > best) { best = sc; sh = [dx, dy]; }
  }
  pred = pred.map(([u, v]) => [u + sh[0], v + sh[1]]);
  // 2. Local search around each shifted prediction.
  const found = findCorners(gray, K.W, K.H, pred, 7);
  const B = [], I = [];
  found.forEach((f, k) => { if (f) { B.push(board[k]); I.push(f); } });
  if (B.length < 12) return null;
  let H = dlt(B, I);
  // Reject corners that disagree with the fit (e.g. a ball edge mistaken for a corner), refit.
  for (let it = 0; it < 2; it++) {
    const keep = B.map((b, k) => { const p = applyH(H, b[0], b[1]); return Math.hypot(p[0] - I[k][0], p[1] - I[k][1]) < 1.5; });
    if (keep.every(Boolean)) break;
    for (let k = B.length - 1; k >= 0; k--) if (!keep[k]) { B.splice(k, 1); I.splice(k, 1); }
    if (B.length < 12) return null;
    H = dlt(B, I);
  }
  // reprojection error
  const rms = Math.sqrt(B.reduce((s, b, k) => { const p = applyH(H, b[0], b[1]); return s + (p[0] - I[k][0]) ** 2 + (p[1] - I[k][1]) ** 2; }, 0) / B.length);
  return { cal: makeCalibration(H, K), used: B.length, total: board.length, rms };
}
