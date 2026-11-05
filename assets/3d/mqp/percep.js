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

// ---------- illumination correction (report p43-44) ----------
// Gaussian sigma is not in the report; a demo value in downscaled pixels.
export const BETA = 120, SIGMA = 3;

function blur1(src, w, h, sigma, horiz) {
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) s += (k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0;
    for (let i = -r; i <= r; i++) {
      const xx = horiz ? Math.min(w - 1, Math.max(0, x + i)) : x, yy = horiz ? y : Math.min(h - 1, Math.max(0, y + i));
      a += src[yy * w + xx] * k[i + r];
    }
    out[y * w + x] = a;
  }
  return out;
}

// rgba: Uint8ClampedArray (w*h*4). Returns every intermediate so the demo can show any stage.
export function retinex(rgba, w, h, { beta = BETA, sigma = SIGMA, scale = 8 } = {}) {
  const N = w * h;
  // 1. grayscale (OpenCV weights)
  const gray = new Float32Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  // 2. downscale to 1/8 (area mean)
  const sw = Math.max(1, Math.floor(w / scale)), sh = Math.max(1, Math.floor(h / scale)), small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let a = 0, n = 0;
    for (let yy = y * scale; yy < Math.min(h, (y + 1) * scale); yy++) for (let xx = x * scale; xx < Math.min(w, (x + 1) * scale); xx++) { a += gray[yy * w + xx]; n++; }
    small[y * sw + x] = a / n;
  }
  // 3. Gaussian blur estimates the illumination L
  const Ls = blur1(blur1(small, sw, sh, sigma, true), sw, sh, sigma, false);
  // 4. resize back up (bilinear, pixel centres) and clip to a minimum of 1
  const L = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / scale - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / scale - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const v = (Ls[y0 * sw + x0] * (1 - tx) + Ls[y0 * sw + x1] * tx) * (1 - ty) + (Ls[y1 * sw + x0] * (1 - tx) + Ls[y1 * sw + x1] * tx) * ty;
      L[y * w + x] = Math.max(1, v);
    }
  }
  // 5. I / L * beta, 6. clip to uint8
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const g = beta / L[i];
    out[j] = rgba[j] * g; out[j + 1] = rgba[j + 1] * g; out[j + 2] = rgba[j + 2] * g; out[j + 3] = 255;
  }
  return { gray, small, sw, sh, Ls, L, out };
}

// Gray-world white balance. The report says the frames are colour balanced but not how.
export function whiteBalance(rgba, w, h) {
  let r = 0, g = 0, b = 0; const N = w * h;
  for (let j = 0; j < N * 4; j += 4) { r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; }
  const m = (r + g + b) / 3, kr = m / (r || 1), kg = m / (g || 1), kb = m / (b || 1);
  const out = new Uint8ClampedArray(N * 4);
  for (let j = 0; j < N * 4; j += 4) { out[j] = rgba[j] * kr; out[j + 1] = rgba[j + 1] * kg; out[j + 2] = rgba[j + 2] * kb; out[j + 3] = 255; }
  return out;
}

// ---------- detections ----------
// A plain colour detector, one camera tile at a time, so no box spans two cameras.
export function detect(rgba, w, h, tileW = CAM.W, minArea = 3) {
  const N = w * h, cls = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    if (r > 90 && r - Math.max(g, b) > 55) cls[i] = 1;
    else if (b > 90 && b - Math.max(r, g) > 40) cls[i] = 2;
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
// Same maths as whiteBalance -> retinex -> detect above, in two passes over the full strip with
// buffers allocated once. Gray-world gains and the 1/8 grayscale both come from 8x8 block sums
// gathered while the sensor image is written, so the full-size gray, wb and L images are never built.
// Matches the reference to within rounding (test_percep.mjs).
export function createPipe({ W, H, tileW = CAM.W, scale = 8, sigma = SIGMA, beta = BETA } = {}) {
  const N = W * H, sw = W / scale, sh = H / scale, M = sw * sh;
  const raw = new Uint8ClampedArray(N * 4), out = new Uint8ClampedArray(N * 4), lmap = new Uint8ClampedArray(N);
  const cls = new Uint8Array(N), stack = new Int32Array(N);
  const sR = new Float64Array(M), sG = new Float64Array(M), sB = new Float64Array(M);
  const small = new Float32Array(M), tmp = new Float32Array(M), Ls = new Float32Array(M), lrow = new Float32Array(sw);
  for (let j = 3; j < N * 4; j += 4) { raw[j] = 255; out[j] = 255; }
  // Gaussian taps and bilinear x weights, fixed.
  const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1); { let s = 0; for (let i = -r; i <= r; i++) s += (k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))); for (let i = 0; i < k.length; i++) k[i] /= s; }
  const X0 = new Int32Array(W), X1 = new Int32Array(W), TX = new Float32Array(W);
  for (let x = 0; x < W; x++) { const f = Math.min(sw - 1, Math.max(0, (x + 0.5) / scale - 0.5)); X0[x] = Math.floor(f); X1[x] = Math.min(sw - 1, X0[x] + 1); TX[x] = f - X0[x]; }
  const P = { W, H, sw, sh, raw, out, lmap, gains: [1, 1, 1], boxes: [] };

  // Pass 1 helper for callers that already have an RGB(A) image (the test): copy it in and sum.
  P.load = (rgba) => { raw.set(rgba); P.sum(); };
  P.sum = () => {
    sR.fill(0); sG.fill(0); sB.fill(0);
    for (let y = 0, j = 0; y < H; y++) { const row = (y / scale | 0) * sw; for (let x = 0; x < W; x++, j += 4) { const b = row + (x / scale | 0); sR[b] += raw[j]; sG[b] += raw[j + 1]; sB[b] += raw[j + 2]; } }
  };
  // Pass 1 for the demo: lens lookup + sensor look, written into raw, summed on the way.
  // buf: render pixels; lut: strip pixel -> buf offset or -1; vg: per-tile-pixel gain; noise per pixel.
  let GR = null, GG = null, GB = null, gKey = null;
  P.sense = (buf, lut, vg, noise, tint) => {
    if (gKey !== vg) {                                   // gain x tint per tile pixel, once
      gKey = vg; GR = new Float32Array(vg.length); GG = new Float32Array(vg.length); GB = new Float32Array(vg.length);
      for (let q = 0; q < vg.length; q++) { GR[q] = vg[q] * tint[0]; GG[q] = vg[q] * tint[1]; GB[q] = vg[q] * tint[2]; }
    }
    const tiles = W / tileW, bpt = tileW / scale;
    for (let y = 0; y < H; y++) {
      const brow = (y / scale | 0) * sw, first = y % scale === 0;
      for (let t = 0; t < tiles; t++) for (let bx = 0; bx < bpt; bx++) {
        let ar = 0, ag = 0, ab = 0;
        const x0 = t * tileW + bx * scale, g0 = y * tileW + bx * scale;
        for (let q = 0; q < scale; q++) {
          const i = y * W + x0 + q, kk = lut[i], j = i << 2;
          if (kk < 0) { raw[j] = raw[j + 1] = raw[j + 2] = 0; continue; }
          const gi = g0 + q, nz = noise[i];
          raw[j] = buf[kk] * GR[gi] + nz; raw[j + 1] = buf[kk + 1] * GG[gi] + nz; raw[j + 2] = buf[kk + 2] * GB[gi] + nz;
          ar += raw[j]; ag += raw[j + 1]; ab += raw[j + 2];
        }
        const b = brow + t * bpt + bx;
        if (first) { sR[b] = ar; sG[b] = ag; sB[b] = ab; } else { sR[b] += ar; sG[b] += ag; sB[b] += ab; }
      }
    }
  };
  // Pass 2: gains, L from the block sums, corrected image, colour classes, then boxes.
  P.correct = () => {
    let tR = 0, tG = 0, tB = 0; for (let b = 0; b < M; b++) { tR += sR[b]; tG += sG[b]; tB += sB[b]; }
    const m = (tR + tG + tB) / 3, kr = m / (tR || 1), kg = m / (tG || 1), kb = m / (tB || 1); P.gains = [kr, kg, kb];
    const n = scale * scale, wr = 0.299 * kr / n, wg = 0.587 * kg / n, wb = 0.114 * kb / n;
    for (let b = 0; b < M; b++) small[b] = sR[b] * wr + sG[b] * wg + sB[b] * wb;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let a = 0; for (let i = -r; i <= r; i++) a += small[y * sw + Math.min(sw - 1, Math.max(0, x + i))] * k[i + r]; tmp[y * sw + x] = a; }
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { let a = 0; for (let i = -r; i <= r; i++) a += tmp[Math.min(sh - 1, Math.max(0, y + i)) * sw + x] * k[i + r]; Ls[y * sw + x] = a; }
    for (let y = 0, i = 0; y < H; y++) {
      const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / scale - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < sw; x++) lrow[x] = Ls[y0 * sw + x] * (1 - ty) + Ls[y1 * sw + x] * ty;
      for (let x = 0; x < W; x++, i++) {
        const a = lrow[X0[x]], l = a + (lrow[X1[x]] - a) * TX[x], L = l < 1 ? 1 : l, g = beta / L, j = i << 2;
        lmap[i] = L;
        // balanced frame is uint8 before the division, as in the reference
        let wr = (raw[j] * kr + 0.5) | 0, wg = (raw[j + 1] * kg + 0.5) | 0, wb2 = (raw[j + 2] * kb + 0.5) | 0;
        if (wr > 255) wr = 255; if (wg > 255) wg = 255; if (wb2 > 255) wb2 = 255;
        const R = wr * g, G = wg * g, B = wb2 * g;
        out[j] = R; out[j + 1] = G; out[j + 2] = B;
        cls[i] = R > 90 && R - (G > B ? G : B) > 55 ? 1 : B > 90 && B - (R > G ? R : G) > 40 ? 2 : 0;
      }
    }
    P.boxes = boxesFrom(cls, stack, W, H, tileW, 3);
    return P.boxes;
  };
  // Balanced image, built only when that stage is on screen.
  P.balanced = (dst) => { const [kr, kg, kb] = P.gains; for (let j = 0; j < N * 4; j += 4) { dst[j] = raw[j] * kr; dst[j + 1] = raw[j + 1] * kg; dst[j + 2] = raw[j + 2] * kb; dst[j + 3] = 255; } };
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
