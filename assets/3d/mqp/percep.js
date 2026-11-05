// MQP perception math, shared by the live demo and the node test. No DOM, no three.js.
// Field frame: inches, origin at field centre, x toward the blue alliance wall, y left of that, z up.
// Robot frame: x forward, y left. Camera frame (OpenCV): x right, y down, z along the optical axis.

// Report p76: 12 x 12 ft field. Report p76: block diameter about 3.25 in.
export const FIELD = 144, HALF = 72, BLOCK = 3.25;

// Report p70: each camera at h = 8 in, pitch theta = -15 deg.
export const MOUNT_H = 8, PITCH = -15 * Math.PI / 180;

// Report p43: each frame is 640x400 in a 2560x400 strip. The demo runs the same strip at half size.
// Intrinsics and distortion are demo values (the report gives no numbers): fx and k1 chosen so the
// horizontal field of view is about 120 deg, the figure the report gives on p39.
export const CAM = { W: 320, H: 200, fx: 110, fy: 110, cx: 160, cy: 100, k1: -0.05, k2: 0 };

// Report p28, p39: four cameras, one on each corner just above each wheel, facing symmetrically
// outwards from the centre. The yaws follow from that. The offsets are not in the report: the
// corners of a 15 in robot, set 1 in inside the frame.
const O = 6.5, D = Math.PI / 180;
export const CAMS = [
  { name: 'Front left', psi: 45 * D, ox: O, oy: O },
  { name: 'Rear left', psi: 135 * D, ox: -O, oy: O },
  { name: 'Rear right', psi: -135 * D, ox: -O, oy: -O },
  { name: 'Front right', psi: -45 * D, ox: O, oy: -O },
];

// ---------- lens ----------
// Radial model: x_d = x_u (1 + k1 r^2 + k2 r^4).
export function distort(xu, yu, c = CAM) {
  const r2 = xu * xu + yu * yu, s = 1 + c.k1 * r2 + c.k2 * r2 * r2;
  return [xu * s, yu * s];
}
// Inverse on the radius by Newton. Returns null past the point where the lens model folds back.
export function undistort(xd, yd, c = CAM) {
  const rd = Math.hypot(xd, yd);
  if (rd < 1e-9) return [xd, yd];
  let r = rd;
  for (let i = 0; i < 12; i++) {
    const r2 = r * r, f = r * (1 + c.k1 * r2 + c.k2 * r2 * r2) - rd, df = 1 + 3 * c.k1 * r2 + 5 * c.k2 * r2 * r2;
    if (df <= 1e-6) return null;
    const step = f / df; r -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  if (!(r > 0) || 1 + 3 * c.k1 * r * r + 5 * c.k2 * r ** 4 <= 0) return null;
  const s = r / rd; return [xd * s, yd * s];
}

// ---------- camera pose ----------
export function camPose(pose, cam, h = MOUNT_H, pitch = PITCH) {
  const c = Math.cos(pose.th), s = Math.sin(pose.th);
  const X = pose.x + c * cam.ox - s * cam.oy, Y = pose.y + s * cam.ox + c * cam.oy;
  const a = pose.th + cam.psi, al = -pitch;                      // al: tilt down, positive
  const f = [Math.cos(a), Math.sin(a), 0], l = [-Math.sin(a), Math.cos(a), 0];
  const z = [Math.cos(al) * f[0], Math.cos(al) * f[1], -Math.sin(al)];
  const y = [-Math.sin(al) * f[0], -Math.sin(al) * f[1], -Math.cos(al)];
  const x = [-l[0], -l[1], 0];
  return { C: [X, Y, h], x, y, z, yaw: a, al };
}

// Field point -> distorted pixel, or null if behind the camera. Used by the test only.
export function fieldToPixel(p, pose, cam, c = CAM) {
  const P = camPose(pose, cam), d = [p[0] - P.C[0], p[1] - P.C[1], (p[2] || 0) - P.C[2]];
  const dot = (a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  const Zc = dot(P.z); if (Zc <= 0.1) return null;
  const xu = dot(P.x) / Zc, yu = dot(P.y) / Zc, r2 = xu * xu + yu * yu;
  if (1 + 3 * c.k1 * r2 + 5 * c.k2 * r2 * r2 <= 0) return null;   // past the lens model's fold
  const [xd, yd] = distort(xu, yu, c);
  return [c.cx + c.fx * xd, c.cy + c.fy * yd];
}

// The report's chain (p69-71): pixel -> undistorted ray -> Zc -> (x_local, y_local)
// -> robot frame through psi and (ox, oy) -> field frame through the robot pose.
export function pixelToField(u, v, pose, cam, c = CAM, h = MOUNT_H, pitch = PITCH) {
  const n = undistort((u - c.cx) / c.fx, (v - c.cy) / c.fy, c);
  if (!n) return null;
  const [xn, yn] = n, al = -pitch;
  const den = Math.sin(al) + yn * Math.cos(al);
  if (den <= 1e-4) return { above: true, xn, yn };              // ray at or above the horizon
  const Zc = h / den;
  const xl = Zc * (Math.cos(al) - yn * Math.sin(al)), yl = -Zc * xn;
  const cp = Math.cos(cam.psi), sp = Math.sin(cam.psi);
  const xr = cam.ox + xl * cp - yl * sp, yr = cam.oy + xl * sp + yl * cp;
  const ct = Math.cos(pose.th), st = Math.sin(pose.th);
  return { x: pose.x + xr * ct - yr * st, y: pose.y + xr * st + yr * ct, Zc, xl, yl, xr, yr };
}
export const onField = (p, m = 0) => Math.abs(p.x) <= HALF - m && Math.abs(p.y) <= HALF - m;

// ---------- image correction (report p43-44; code: Autonomous-VEXU/camera_stream) ----------
// Two stages, as on the robot:
//   sender  (stream_raw.py, on the Jetson Nano): convertScaleAbs(alpha 1.3, beta 30), then
//           B x1.2, G x0.95, R x0.90, each clipped to [0, 255] and written back into uint8 (truncates).
//   receiver (IE.py): gray -> resize 1/8 (INTER_LINEAR) -> GaussianBlur 31x31, sigmaX 0 ->
//           resize back (INTER_LINEAR) -> clip [1, 255] -> frame / L * 120 -> clip, astype uint8.
// OpenCV picks sigma from the kernel when sigmaX is 0: 0.3 * ((31 - 1) * 0.5 - 1) + 0.8 = 5.0.
export const BETA = 120, KSIZE = 31, SIGMA = 0.3 * ((KSIZE - 1) * 0.5 - 1) + 0.8;
export const SEND = { alpha: 1.3, beta: 30, gain: [0.90, 0.95, 1.2] };   // gain in R, G, B order
// Demo sensor look: dark with a yellow cast (low blue), set so the sender's correction above brings
// a grey near the sensor's typical level (about 50) back to grey: (x * 1.3 + 30) * gain equal per channel.
export const TINT = [1, 0.92, 0.65];

// stream_raw.py, one channel value: convertScaleAbs rounds and saturates; the gain product truncates.
export const sendCh = (x, c) => { const v = Math.min(255, Math.round(Math.abs(x * SEND.alpha + SEND.beta))); return Math.min(255, Math.floor(v * SEND.gain[c])); };
export function senderCorrect(rgba, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < out.length; j += 4) { out[j] = sendCh(rgba[j], 0); out[j + 1] = sendCh(rgba[j + 1], 1); out[j + 2] = sendCh(rgba[j + 2], 2); out[j + 3] = 255; }
  return out;
}
// cv2.COLOR_BGR2GRAY on uint8: fixed-point 0.299 / 0.587 / 0.114, rounded.
export const gray8 = (r, g, b) => (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
// cv2.GaussianBlur border (BORDER_REFLECT_101).
const reflect = (i, n) => { while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i; return i; };
export function gaussKernel(ksize = KSIZE, sigma = SIGMA) {
  const r = (ksize - 1) / 2, k = new Float32Array(ksize); let s = 0;
  for (let i = -r; i <= r; i++) s += (k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)));
  for (let i = 0; i < ksize; i++) k[i] /= s;
  return { k, r };
}
// Separable blur of a uint8 image, rounded back to uint8. Tap indices precomputed per size.
const tapCache = {};
export function blur8(src, tmp, dst, w, h, G = gaussKernel()) {
  const { k, r } = G, n = 2 * r + 1, key = w + 'x' + h + 'x' + n;
  const T = tapCache[key] || (tapCache[key] = {
    x: Int32Array.from({ length: w * n }, (_, q) => reflect(((q / n) | 0) + (q % n) - r, w)),
    y: Int32Array.from({ length: h * n }, (_, q) => reflect(((q / n) | 0) + (q % n) - r, h) * w) });
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let a = 0; const o = x * n; for (let t = 0; t < n; t++) a += src[row + T.x[o + t]] * k[t]; tmp[row + x] = a; } }
  for (let y = 0; y < h; y++) { const o = y * n; for (let x = 0; x < w; x++) { let a = 0; for (let t = 0; t < n; t++) a += tmp[T.y[o + t] + x] * k[t]; dst[y * w + x] = Math.min(255, Math.round(a)); } }
}
// cv2.resize INTER_LINEAR at exactly 1/8: each output pixel is the rounded mean of source
// pixels 8x+3, 8x+4 by 8y+3, 8y+4.
export const down8 = (a, b, c, d) => (a + b + c + d + 2) >> 2;

// IE.py step by step, on an RGBA image (the sender's output). Returns every intermediate.
export function retinex(rgba, w, h, { beta = BETA, scale = 8 } = {}) {
  const N = w * h, gray = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) gray[i] = gray8(rgba[j], rgba[j + 1], rgba[j + 2]);
  const sw = w / scale, sh = h / scale, small = new Uint8Array(sw * sh), Ls = new Uint8Array(sw * sh), tmp = new Float32Array(sw * sh);
  const o = scale / 2 - 1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y * scale + o) * w + x * scale + o; small[y * sw + x] = down8(gray[i], gray[i + 1], gray[i + w], gray[i + w + 1]); }
  blur8(small, tmp, Ls, sw, sh);
  const L = new Float32Array(N), out = new Uint8ClampedArray(N * 4);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / scale - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / scale - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const v = Math.round((Ls[y0 * sw + x0] * (1 - tx) + Ls[y0 * sw + x1] * tx) * (1 - ty) + (Ls[y1 * sw + x0] * (1 - tx) + Ls[y1 * sw + x1] * tx) * ty);
      L[y * w + x] = Math.max(1, Math.min(255, v));
    }
  }
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    for (let c = 0; c < 3; c++) out[j + c] = Math.floor(Math.min(255, rgba[j + c] / L[i] * beta));
    out[j + 3] = 255;
  }
  return { gray, small, sw, sh, Ls, L, out };
}

// ---------- detections ----------
// Colour class of a corrected pixel: 1 red, 2 blue, 0 neither. The GPU shader uses the same test.
export const classOf = (R, G, B) => R > 80 && R - (G > B ? G : B) > 40 ? 1 : B > 80 && B - (R > G ? R : G) > 30 ? 2 : 0;

// A plain colour detector, one camera tile at a time, so no box spans two cameras.
export function detect(rgba, w, h, tileW = CAM.W, minArea = 3) {
  const N = w * h, cls = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    cls[i] = classOf(rgba[j], rgba[j + 1], rgba[j + 2]);
  }
  const seen = new Uint8Array(N), boxes = [], stack = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    if (!cls[i] || seen[i]) continue;
    const c = cls[i], tile = Math.floor((i % w) / tileW);
    let sp = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const k = stack[--sp], x = k % w, y = (k - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 && Math.floor((x - 1) / tileW) === tile ? k - 1 : -1, x < w - 1 && Math.floor((x + 1) / tileW) === tile ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && cls[q] === c) { seen[q] = 1; stack[sp++] = q; }
    }
    if (n >= minArea) boxes.push({ color: c === 1 ? 'red' : 'blue', cam: tile, x0: x0 - tile * tileW, y0, x1: x1 - tile * tileW + 1, y1: y1 + 1, n });
  }
  return boxes;
}

// ---------- fused per-update pipeline ----------
// Same maths as senderCorrect -> retinex -> detect above, with buffers allocated once. The 1/8
// image only needs 4 source pixels per block, so the full-size gray image is never built; the
// sender's correction is applied on the fly. Matches the reference (test_percep.mjs).
export function createPipe({ W, H, tileW = CAM.W, scale = 8, beta = BETA } = {}) {
  const N = W * H, sw = W / scale, sh = H / scale, M = sw * sh, o = scale / 2 - 1;
  const raw = new Uint8ClampedArray(N * 4), out = new Uint8ClampedArray(N * 4), lmap = new Uint8ClampedArray(N);
  const cls = new Uint8Array(N), stack = new Int32Array(N);
  const small = new Uint8Array(M), tmp = new Float32Array(M), Ls = new Uint8Array(M), lrow = new Float32Array(sw), G = gaussKernel();
  for (let j = 3; j < N * 4; j += 4) { raw[j] = 255; out[j] = 255; }
  // Sender correction as a table per channel (input is uint8).
  const S = [0, 1, 2].map(c => Uint8Array.from({ length: 256 }, (_, x) => sendCh(x, c)));
  const [S0, S1, S2] = S;
  const X0 = new Int32Array(W), X1 = new Int32Array(W), TX = new Float32Array(W);
  for (let x = 0; x < W; x++) { const f = Math.min(sw - 1, Math.max(0, (x + 0.5) / scale - 0.5)); X0[x] = Math.floor(f); X1[x] = Math.min(sw - 1, X0[x] + 1); TX[x] = f - X0[x]; }
  const P = { W, H, sw, sh, raw, out, lmap, boxes: [] };

  P.load = (rgba) => { raw.set(rgba); };
  // Pass 1 for the demo: lens lookup + sensor look into raw.
  // buf: render pixels; lut: strip pixel -> buf offset or -1; vg: per-tile-pixel gain; noise per pixel.
  let GR = null, GG = null, GB = null, gKey = null;
  P.sense = (buf, lut, vg, noise, tint) => {
    if (gKey !== vg) {
      gKey = vg; GR = new Float32Array(vg.length); GG = new Float32Array(vg.length); GB = new Float32Array(vg.length);
      for (let q = 0; q < vg.length; q++) { GR[q] = vg[q] * tint[0]; GG[q] = vg[q] * tint[1]; GB[q] = vg[q] * tint[2]; }
    }
    for (let y = 0, i = 0; y < H; y++) {
      const vrow = y * tileW;
      for (let t = 0; t < W / tileW; t++) for (let u = 0; u < tileW; u++, i++) {
        const kk = lut[i], j = i << 2;
        if (kk < 0) { raw[j] = raw[j + 1] = raw[j + 2] = 0; continue; }
        const gi = vrow + u, nz = noise[i];
        raw[j] = buf[kk] * GR[gi] + nz; raw[j + 1] = buf[kk + 1] * GG[gi] + nz; raw[j + 2] = buf[kk + 2] * GB[gi] + nz;
      }
    }
  };
  // Pass 2: 1/8 gray from 4 samples per block, blur, corrected image, colour classes, boxes.
  P.correct = () => {
    const g = (i) => { const j = i << 2; return gray8(S0[raw[j]], S1[raw[j + 1]], S2[raw[j + 2]]); };
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y * scale + o) * W + x * scale + o; small[y * sw + x] = down8(g(i), g(i + 1), g(i + W), g(i + W + 1)); }
    blur8(small, tmp, Ls, sw, sh, G);
    for (let y = 0, i = 0; y < H; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / scale - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < sw; x++) lrow[x] = Ls[y0 * sw + x] * (1 - ty) + Ls[y1 * sw + x] * ty;
      for (let x = 0; x < W; x++, i++) {
        const a = lrow[X0[x]];
        let L = Math.round(a + (lrow[X1[x]] - a) * TX[x]); if (L < 1) L = 1; else if (L > 255) L = 255;
        const k = beta / L, j = i << 2;
        lmap[i] = L;
        let R = S0[raw[j]] * k, Gc = S1[raw[j + 1]] * k, B = S2[raw[j + 2]] * k;
        R = R > 255 ? 255 : R | 0; Gc = Gc > 255 ? 255 : Gc | 0; B = B > 255 ? 255 : B | 0;
        out[j] = R; out[j + 1] = Gc; out[j + 2] = B;
        cls[i] = classOf(R, Gc, B);
      }
    }
    P.boxes = boxesFrom(cls, stack, W, H, tileW, 3);
    return P.boxes;
  };
  // Sender's output (the Balanced stage), built only when that stage is on screen.
  P.balanced = (dst) => { for (let j = 0; j < N * 4; j += 4) { dst[j] = S0[raw[j]]; dst[j + 1] = S1[raw[j + 1]]; dst[j + 2] = S2[raw[j + 2]]; dst[j + 3] = 255; } };
  return P;
}

// Connected components on a class image; clears cls as it goes, no allocation per pixel.
export function boxesFrom(cls, stack, w, h, tileW, minArea) {
  const boxes = [], N = w * h;
  for (let i = 0; i < N; i++) {
    const c = cls[i]; if (!c) continue;
    const tile = ((i % w) / tileW) | 0, lo = tile * tileW, hi = lo + tileW - 1;
    let sp = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    stack[sp++] = i; cls[i] = 0;
    while (sp) {
      const q = stack[--sp], x = q % w, y = (q - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > lo && cls[q - 1] === c) { cls[q - 1] = 0; stack[sp++] = q - 1; }
      if (x < hi && cls[q + 1] === c) { cls[q + 1] = 0; stack[sp++] = q + 1; }
      if (y > 0 && cls[q - w] === c) { cls[q - w] = 0; stack[sp++] = q - w; }
      if (y < h - 1 && cls[q + w] === c) { cls[q + w] = 0; stack[sp++] = q + w; }
    }
    if (n >= minArea) boxes.push({ color: c === 1 ? 'red' : 'blue', cam: tile, x0: x0 - lo, y0, x1: x1 - lo + 1, y1: y1 + 1, n });
  }
  return boxes;
}

// Detections of one block from overlapping cameras: same colour, close on the floor -> one block.
export function mergeEstimates(pts, r = 6) {
  const groups = [];
  for (const p of pts) {
    const g = groups.find(g => g.color === p.color && Math.hypot(g.x - p.x, g.y - p.y) < r && !g.cams.has(p.cam));
    if (g) { g.x = (g.x * g.n + p.x) / (g.n + 1); g.y = (g.y * g.n + p.y) / (g.n + 1); g.n++; g.cams.add(p.cam); }
    else groups.push({ color: p.color, x: p.x, y: p.y, n: 1, cams: new Set([p.cam]) });
  }
  return groups;
}

// Boxes from a corrected RGBA strip whose alpha carries the class (255 none, 254 red, 253 blue),
// searching only the 8x8 blocks flagged as holding any class pixel. seen is cleared after use.
export function boxesFromAlpha(bytes, flags, seen, stack, w, h, tileW = CAM.W, scale = 8, minArea = 3) {
  const boxes = [], sw = w / scale, sh = h / scale, touched = [];
  for (let by = 0; by < sh; by++) for (let bx = 0; bx < sw; bx++) {
    if (!flags[(by * sw + bx) * 4]) continue;
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
      const i = (by * scale + yy) * w + bx * scale + xx, c = bytes[i * 4 + 3];
      if (c === 255 || seen[i]) continue;
      const tile = ((i % w) / tileW) | 0, lo = tile * tileW, hi = lo + tileW - 1;
      let sp = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
      stack[sp++] = i; seen[i] = 1; touched.push(i);
      while (sp) {
        const q = stack[--sp], x = q % w, y = (q - x) / w; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        const nb = [x > lo ? q - 1 : -1, x < hi ? q + 1 : -1, y > 0 ? q - w : -1, y < h - 1 ? q + w : -1];
        for (let t = 0; t < 4; t++) { const r = nb[t]; if (r >= 0 && !seen[r] && bytes[r * 4 + 3] === c) { seen[r] = 1; touched.push(r); stack[sp++] = r; } }
      }
      if (n >= minArea) boxes.push({ color: c === 254 ? 'red' : 'blue', cam: tile, x0: x0 - lo, y0, x1: x1 - lo + 1, y1: y1 + 1, n });
    }
  }
  for (const i of touched) seen[i] = 0;
  return boxes;
}
