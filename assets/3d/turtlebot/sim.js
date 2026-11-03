// TurtleBot3 Burger maze simulation: no rendering, no dependencies.
// All quantities in SI units, ROS REP-103 frame (x forward, y left, z up).

// ---- Specs ------------------------------------------------------------
// From turtlebot3_description/urdf/turtlebot3_burger.urdf:
//   base_joint z = 0.010; wheel joints y = +/-0.080, z = 0.023;
//   wheel collision cylinder radius 0.033; scan_joint xyz = (-0.032, 0, 0.172).
// From ROBOTIS e-Manual / turtlebot3 node limits: 0.22 m/s, 2.84 rad/s.
// LDS-01 datasheet: 360 samples/rev, 0.12-3.5 m, 5 Hz.
export const SPEC = {
  wheelRadius: 0.033,
  wheelSeparation: 0.160,
  baseZ: 0.010,
  wheelJoint: { y: 0.080, z: 0.023 },
  scanOffset: { x: -0.032, y: 0, z: 0.172 },
  maxLin: 0.22,
  maxAng: 2.84,
  lidar: { samples: 360, rangeMin: 0.12, rangeMax: 3.5, hz: 5, noiseStd: 0.01 },
  footprint: { x: 0, r: 0.095 }, // collision circle on base_footprint (nav2 burger robot_radius ~0.1)
};
export const SCAN_HEIGHT = SPEC.baseZ + SPEC.scanOffset.z; // 0.182 m

// ---- RNG ----------------------------------------------------------------
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- Maze -----------------------------------------------------------------
// Perfect maze by randomised DFS, then a few extra openings so loops exist.
export function makeMaze(seed, n = 7, cell = 0.6, thick = 0.10, height = 0.25) {
  const r = rng(seed);
  // hWall[j][i]: wall on the south side of cell (i,j), j in 0..n
  // vWall[j][i]: wall on the west side of cell (i,j), i in 0..n
  const hWall = Array.from({ length: n + 1 }, () => Array(n).fill(true));
  const vWall = Array.from({ length: n }, () => Array(n + 1).fill(true));
  const seen = Array.from({ length: n }, () => Array(n).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = [];
    if (i > 0 && !seen[j][i - 1]) nb.push([i - 1, j, 'W']);
    if (i < n - 1 && !seen[j][i + 1]) nb.push([i + 1, j, 'E']);
    if (j > 0 && !seen[j - 1][i]) nb.push([i, j - 1, 'S']);
    if (j < n - 1 && !seen[j + 1][i]) nb.push([i, j + 1, 'N']);
    if (!nb.length) { stack.pop(); continue; }
    const [a, b, d] = nb[Math.floor(r() * nb.length)];
    if (d === 'W') vWall[j][i] = false;
    if (d === 'E') vWall[j][i + 1] = false;
    if (d === 'S') hWall[j][i] = false;
    if (d === 'N') hWall[j + 1][i] = false;
    seen[b][a] = true;
    stack.push([a, b]);
  }
  for (let k = 0; k < 5; k++) {
    if (r() < 0.5) { const j = 1 + Math.floor(r() * (n - 1)), i = Math.floor(r() * n); hWall[j][i] = false; }
    else { const i = 1 + Math.floor(r() * (n - 1)), j = Math.floor(r() * n); vWall[j][i] = false; }
  }
  // Merge collinear runs into long boxes.
  const walls = []; // {x0,y0,x1,y1} axis-aligned rectangles
  const h = thick / 2;
  for (let j = 0; j <= n; j++) {
    let i = 0;
    while (i < n) {
      if (!hWall[j][i]) { i++; continue; }
      let k = i; while (k < n && hWall[j][k]) k++;
      walls.push({ x0: i * cell - h, x1: k * cell + h, y0: j * cell - h, y1: j * cell + h });
      i = k;
    }
  }
  for (let i = 0; i <= n; i++) {
    let j = 0;
    while (j < n) {
      if (!vWall[j][i]) { j++; continue; }
      let k = j; while (k < n && vWall[k][i]) k++;
      walls.push({ x0: i * cell - h, x1: i * cell + h, y0: j * cell - h, y1: k * cell + h });
      j = k;
    }
  }
  const segs = [];
  for (const w of walls) {
    segs.push([w.x0, w.y0, w.x1, w.y0], [w.x1, w.y0, w.x1, w.y1], [w.x1, w.y1, w.x0, w.y1], [w.x0, w.y1, w.x0, w.y0]);
  }
  return { n, cell, thick, height, size: n * cell, walls, segs };
}

// ---- Ray casting ------------------------------------------------------------
// Ray p + t*d (|d| = 1) against segment a + u*(b-a), u in [0,1]. Returns t or Infinity.
export function raySeg(px, py, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const wx = ax - px, wy = ay - py;
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * dy - wy * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}
export function castRay(segs, px, py, ang) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = Infinity;
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const t = raySeg(px, py, dx, dy, s[0], s[1], s[2], s[3]);
    if (t < best) best = t;
  }
  return best;
}

// ---- Occupancy grid (log-odds, Bresenham) ----------------------------------
export class OccGrid {
  constructor(originX, originY, w, h, res = 0.05) {
    Object.assign(this, { originX, originY, w, h, res });
    this.L = new Float32Array(w * h);
    this.seen = new Uint8Array(w * h);
    this.lFree = -0.4; this.lOcc = 0.85; this.lMin = -4; this.lMax = 4;
    this.version = 0;
  }
  clear() { this.L.fill(0); this.seen.fill(0); this.version++; }
  toCell(x, y) { return [Math.floor((x - this.originX) / this.res), Math.floor((y - this.originY) / this.res)]; }
  inside(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h; }
  add(i, j, l) {
    if (!this.inside(i, j)) return;
    const k = j * this.w + i;
    this.L[k] = Math.min(this.lMax, Math.max(this.lMin, this.L[k] + l));
    this.seen[k] = 1;
  }
  // Integrate one beam from (x0,y0). hit=false means max-range return (free only).
  beam(x0, y0, x1, y1, hit) {
    let [i0, j0] = this.toCell(x0, y0);
    const [i1, j1] = this.toCell(x1, y1);
    const di = Math.abs(i1 - i0), dj = -Math.abs(j1 - j0);
    const si = i0 < i1 ? 1 : -1, sj = j0 < j1 ? 1 : -1;
    let err = di + dj;
    for (;;) {
      if (i0 === i1 && j0 === j1) break;
      this.add(i0, j0, this.lFree);
      const e2 = 2 * err;
      if (e2 >= dj) { err += dj; i0 += si; }
      if (e2 <= di) { err += di; j0 += sj; }
    }
    this.add(i1, j1, hit ? this.lOcc : this.lFree);
  }
  // 0 unknown, 1 free, 2 occupied
  state(k) {
    if (!this.seen[k]) return 0;
    const l = this.L[k];
    if (l > 0.6) return 2;
    if (l < -0.6) return 1;
    return 0;
  }
}

// ---- Planning ---------------------------------------------------------------
class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}

// Costmap (nav2-like layers): lethal within lethalR of an occupied cell centre,
// a high "inscribed" cost out to hardR (robot radius + margin), decaying cost to softR.
export function costmap(g, hardR = 0.15, softR = 0.28, lethalR = 0.10) {
  const n = g.w * g.h, cost = new Float32Array(n), st = new Uint8Array(n);
  for (let k = 0; k < n; k++) st[k] = g.state(k);
  const R = Math.ceil(softR / g.res);
  for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
    if (st[j * g.w + i] !== 2) continue;
    for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) {
      const ii = i + a, jj = j + b; if (!g.inside(ii, jj)) continue;
      const d = Math.hypot(a, b) * g.res, k = jj * g.w + ii;
      const c = d <= lethalR ? Infinity : d <= hardR ? 40 : d <= softR ? 20 * (softR - d) / (softR - hardR) : 0;
      if (c > cost[k]) cost[k] = c;
    }
  }
  return { st, cost };
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// A* on the robot's own map. unknownCost: Infinity = known-free only.
export function astar(g, cm, s, t, unknownCost = Infinity, trace = null) {
  const W = g.w, n = W * g.h, G = new Float32Array(n).fill(Infinity), P = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n), open = new Heap();
  const si = s % W, sj = (s / W) | 0, ti = t % W, tj = (t / W) | 0;
  const hfn = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  G[s] = 0; open.push(hfn(si, sj), s);
  while (open.size) {
    const u = open.pop(); if (closed[u]) continue; closed[u] = 1; if (trace) trace.closed.push(u);
    if (u === t) break;
    const ui = u % W, uj = (u / W) | 0;
    for (const [a, b, c] of NB) {
      const i = ui + a, j = uj + b; if (!g.inside(i, j)) continue;
      const k = j * W + i; if (closed[k]) continue;
      if (a && b && (!passable(cm, ui + a + uj * W, unknownCost) || !passable(cm, ui + (uj + b) * W, unknownCost))) continue;
      let step = stepCost(cm, k, unknownCost);
      if (step === Infinity && cm.st[k] === 1 && Math.max(Math.abs(i - si), Math.abs(j - sj)) <= 2) step = 60; // escape when starting inside inflation
      if (step === Infinity && k !== t) continue;
      const ng = G[u] + c * (1 + (step === Infinity ? 0 : step));
      if (ng < G[k]) { G[k] = ng; P[k] = u; open.push(ng + hfn(i, j), k); }
    }
  }
  if (trace) trace.open = open.v.filter(k => !closed[k]);
  if (P[t] < 0 && s !== t) return null;
  const path = []; for (let k = t; k >= 0; k = P[k]) { path.push(k); if (k === s) break; }
  return path.reverse();
}
function stepCost(cm, k, unknownCost) {
  if (cm.cost[k] === Infinity) return Infinity;
  if (cm.st[k] === 2) return Infinity;
  if (cm.st[k] === 0) return unknownCost === Infinity ? Infinity : cm.cost[k] + unknownCost;
  return cm.cost[k];
}
function passable(cm, k, u) { return stepCost(cm, k, u) !== Infinity; }

// Frontier detection: known-free, traversable cells touching unknown, grouped
// into 8-connected clusters. Returns clusters sorted by Dijkstra distance.
export function frontiers(g, cm, start, minSize = 3) {
  const W = g.w, n = W * g.h, D = new Float32Array(n).fill(Infinity), q = new Heap();
  const s0i = start % W, s0j = (start / W) | 0;
  D[start] = 0; q.push(0, start);
  while (q.size) {
    const u = q.pop(), ui = u % W, uj = (u / W) | 0;
    for (const [a, b, c] of NB) {
      const i = ui + a, j = uj + b; if (!g.inside(i, j)) continue;
      const k = j * W + i; let sc = stepCost(cm, k, Infinity);
      if (sc === Infinity && cm.st[k] === 1 && Math.max(Math.abs(i - s0i), Math.abs(j - s0j)) <= 2) sc = 60;
      if (sc === Infinity) continue;
      const nd = D[u] + c * (1 + sc);
      if (nd < D[k]) { D[k] = nd; q.push(nd, k); }
    }
  }
  const isF = new Uint8Array(n);
  for (let j = 1; j < g.h - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (cm.st[k] !== 1 || D[k] === Infinity || cm.cost[k] >= 40) continue;
    if (cm.st[k - 1] === 0 || cm.st[k + 1] === 0 || cm.st[k - W] === 0 || cm.st[k + W] === 0) isF[k] = 1;
  }
  const out = [], lab = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (!isF[k] || lab[k]) continue;
    const cells = [k]; lab[k] = 1;
    for (let c = 0; c < cells.length; c++) {
      const u = cells[c], ui = u % W, uj = (u / W) | 0;
      for (const [a, b] of NB) { const v = (uj + b) * W + ui + a; if (isF[v] && !lab[v]) { lab[v] = 1; cells.push(v); } }
    }
    if (cells.length < minSize) continue;
    let best = cells[0]; for (const c of cells) if (D[c] < D[best]) best = c;
    out.push({ cell: best, size: cells.length, dist: D[best], cells });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// ---- Robot -------------------------------------------------------------------
export class Robot {
  constructor(x, y, th) { this.x = x; this.y = y; this.th = th; this.wl = 0; this.wr = 0; this.phiL = 0; this.phiR = 0; this.v = 0; this.w = 0; }
  // Command (v, w) -> wheel speeds, saturated to the real limits, then integrate.
  step(v, w, dt, collides) {
    const { wheelRadius: r, wheelSeparation: b, maxLin, maxAng } = SPEC;
    v = Math.max(-maxLin, Math.min(maxLin, v));
    w = Math.max(-maxAng, Math.min(maxAng, w));
    let wr = (v + w * b / 2) / r, wl = (v - w * b / 2) / r;
    const wmax = maxLin / r, m = Math.max(Math.abs(wr), Math.abs(wl)) / wmax;
    if (m > 1) { wr /= m; wl /= m; }
    // simple first-order acceleration limit on wheel speed (rad/s^2)
    const acc = 40 * dt;
    this.wr += Math.max(-acc, Math.min(acc, wr - this.wr));
    this.wl += Math.max(-acc, Math.min(acc, wl - this.wl));
    const vr = this.wr * r, vl = this.wl * r;
    const V = (vr + vl) / 2, Wz = (vr - vl) / b;
    let nx, ny, nth = this.th + Wz * dt;
    if (Math.abs(Wz) < 1e-9) { nx = this.x + V * dt * Math.cos(this.th); ny = this.y + V * dt * Math.sin(this.th); }
    else { nx = this.x + V / Wz * (Math.sin(nth) - Math.sin(this.th)); ny = this.y - V / Wz * (Math.cos(nth) - Math.cos(this.th)); }
    if (collides && collides(nx, ny, nth)) { this.wr = this.wl = 0; this.v = this.w = 0; return false; }
    this.x = nx; this.y = ny; this.th = Math.atan2(Math.sin(nth), Math.cos(nth));
    this.phiR += this.wr * dt; this.phiL += this.wl * dt; this.v = V; this.w = Wz;
    return true;
  }
}

export function circleHitsWalls(walls, cx, cy, r) {
  for (const w of walls) {
    const qx = Math.max(w.x0, Math.min(cx, w.x1)), qy = Math.max(w.y0, Math.min(cy, w.y1));
    if ((qx - cx) ** 2 + (qy - cy) ** 2 < r * r) return true;
  }
  return false;
}

// Pure pursuit on a world-coordinate polyline.
export function purePursuit(robot, pts, lookahead = 0.2) {
  // drop points already passed
  let iBest = 0, dBest = Infinity;
  for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - robot.x, pts[i][1] - robot.y); if (d < dBest) { dBest = d; iBest = i; } }
  let tgt = pts[pts.length - 1];
  for (let i = iBest; i < pts.length; i++) if (Math.hypot(pts[i][0] - robot.x, pts[i][1] - robot.y) >= lookahead) { tgt = pts[i]; break; }
  const dx = tgt[0] - robot.x, dy = tgt[1] - robot.y;
  const alpha = Math.atan2(dy, dx) - robot.th, a = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const L = Math.max(Math.hypot(dx, dy), 1e-3);
  const end = pts[pts.length - 1], dEnd = Math.hypot(end[0] - robot.x, end[1] - robot.y);
  if (Math.abs(a) > Math.PI / 4) return { v: 0, w: Math.sign(a) * SPEC.maxAng * 0.6, iBest, dEnd };
  let v = SPEC.maxLin * Math.min(1, dEnd / 0.3 + 0.25) * (1 - 0.6 * Math.abs(a) / (Math.PI / 4));
  const kappa = 2 * Math.sin(a) / L;
  return { v, w: v * kappa, iBest, dEnd };
}

// ---- World: robot + lidar + mapping + autonomy --------------------------------
export class World {
  constructor(seed = 3) { this.reset(seed); }
  reset(seed) {
    this.seed = seed;
    this.maze = makeMaze(seed);
    this.rand = rng(seed * 7919 + 1);
    const c = this.maze.cell;
    this.robot = new Robot(c / 2, c / 2, 0);
    const m = 0.25, res = 0.05, size = this.maze.size + 2 * m;
    this.grid = new OccGrid(-m, -m, Math.round(size / res), Math.round(size / res), res);
    const S = SPEC.lidar.samples;
    this.ranges = new Float32Array(S).fill(Infinity);
    this.hits = new Float32Array(S * 2);     // world xy of each sample's return
    this.origins = new Float32Array(S * 2);  // world xy of the scan frame at sample time
    this.scanPhase = 0; this.sampleIdx = 0; this.scans = 0;
    this.time = 0; this.path = null; this.goal = null; this.mode = 'explore';
    this.status = 'Exploring: frontier search'; this.replanT = 0; this.blacklist = new Set();
    this.lastProgress = { t: 0, x: this.robot.x, y: this.robot.y };
    this.finalGoal = [(this.maze.n - 0.5) * c, (this.maze.n - 0.5) * c];
    this.doneT = 0; this.recoverT = 0; this.fails = 0; this.retried = false; this.teleop = null; this.teleopT = -1;
  }
  scanPose() {
    const r = this.robot, o = SPEC.scanOffset;
    return [r.x + Math.cos(r.th) * o.x - Math.sin(r.th) * o.y, r.y + Math.sin(r.th) * o.x + Math.cos(r.th) * o.y, r.th];
  }
  // Emit lidar samples covering dt of rotation (360 samples every 0.2 s).
  lidar(dt) {
    const L = SPEC.lidar, S = L.samples;
    this.scanPhase += dt * L.hz * S;
    while (this.scanPhase >= 1) {
      this.scanPhase -= 1;
      const k = this.sampleIdx;
      const [sx, sy, sth] = this.scanPose();
      const ang = sth + (k / S) * 2 * Math.PI; // angle_min 0, increment 1 deg, CCW
      let r = castRay(this.maze.segs, sx, sy, ang);
      if (r !== Infinity) r += gauss(this.rand) * L.noiseStd;
      const valid = r >= L.rangeMin && r <= L.rangeMax;
      this.ranges[k] = valid ? r : Infinity;
      this.origins[2 * k] = sx; this.origins[2 * k + 1] = sy;
      const rr = valid ? r : L.rangeMax, ca = Math.cos(ang), sa = Math.sin(ang);
      this.hits[2 * k] = sx + ca * rr; this.hits[2 * k + 1] = sy + sa * rr;
      // mapping: hit cell sampled 1 mm past the surface so it lands in the wall cell
      const e = valid ? rr + 0.001 : rr;
      if (!(r < L.rangeMin)) this.grid.beam(sx, sy, sx + ca * e, sy + sa * e, valid);
      this.grid.version++;
      this.sampleIdx = (k + 1) % S;
      if (this.sampleIdx === 0) this.scans++;
    }
  }
  robotCell() { const [i, j] = this.grid.toCell(this.robot.x, this.robot.y); return j * this.grid.w + i; }
  cellXY(k) { const g = this.grid; return [g.originX + ((k % g.w) + 0.5) * g.res, g.originY + (((k / g.w) | 0) + 0.5) * g.res]; }
  plan() {
    const g = this.grid, cm = costmap(g), s = this.robotCell();
    if (this.mode === 'explore') {
      const fr = frontiers(g, cm, s).filter(f => !this.blacklist.has(f.cell) && f.dist > 3);
      if (!fr.length && this.blacklist.size && !this.retried) { this.retried = true; this.blacklist.clear(); return this.plan(); }
      if (!fr.length) { this.mode = 'final'; this.goal = this.finalGoal; this.status = 'Map complete: driving to goal'; return this.plan(); }
      const f = fr[0];
      this.goal = this.cellXY(f.cell);
      const tr = { closed: [], open: [] };
      const p = astar(g, cm, s, f.cell, Infinity, tr);
      this.viz = { t: this.time, frontiers: fr, target: f.cell, closed: tr.closed, open: tr.open, n: (this.viz?.n || 0) + 1 };
      if (!p) { this.blacklist.add(f.cell); this.path = null; return; }
      this.setPath(p); this.status = `Exploring: ${fr.length} frontier${fr.length > 1 ? 's' : ''}`;
    } else if (this.goal) {
      const [ti, tj] = g.toCell(this.goal[0], this.goal[1]);
      if (!g.inside(ti, tj)) { this.status = 'Goal outside map'; this.path = null; return; }
      const tr = { closed: [], open: [] };
      const p = astar(g, cm, s, tj * g.w + ti, this.mode === 'final' ? Infinity : 8, tr);
      this.viz = { t: this.time, frontiers: [], target: tj * g.w + ti, closed: tr.closed, open: tr.open, n: (this.viz?.n || 0) + 1 };
      if (!p) { this.status = 'No path on current map'; this.path = null; return; }
      this.setPath(p);
      this.status = this.mode === 'final' ? 'Map complete: driving to goal' : 'Driving to clicked goal (A* on own map)';
    }
  }
  setPath(cells) {
    this.path = cells.map(k => this.cellXY(k));
    if (this.path.length) this.path[0] = [this.robot.x, this.robot.y];
    this.pathVersion = (this.pathVersion || 0) + 1;
  }
  setGoal(x, y) {
    this.mode = 'goal'; this.goal = [x, y]; this.path = null; this.replanT = 0; this.teleop = null;
  }
  collides = (x, y, th) => circleHitsWalls(this.maze.walls, x + Math.cos(th) * SPEC.footprint.x, y + Math.sin(th) * SPEC.footprint.x, SPEC.footprint.r - 0.01);
  step(dt) {
    this.time += dt;
    this.lidar(dt);
    if (this.scans < 1) return;
    if (this.recoverT > 0) { this.recoverT -= dt; this.robot.step(-0.08, 0, dt, this.collides); return; }
    if (this.teleop) {
      this.robot.step(this.teleop.v, this.teleop.w, dt, this.collides);
      this.status = 'Manual teleop'; return;
    }
    if (this.mode === 'done') {
      this.robot.step(0, 0, dt);
      if (this.time - this.doneT > 4) this.reset(this.seed + 1);
      return;
    }
    this.replanT -= dt;
    if (!this.path || this.replanT <= 0) { this.plan(); this.replanT = 1.0; }
    if (!this.path) { this.robot.step(0, 0, dt); return; }
    const c = purePursuit(this.robot, this.path);
    const arriveTol = this.mode === 'explore' ? 0.08 : 0.06;
    if (c.dEnd < arriveTol) {
      this.path = null; this.fails = 0; this.replanT = 0;
      if (this.mode === 'final') { this.mode = 'done'; this.doneT = this.time; this.status = 'Goal reached'; }
      else if (this.mode === 'goal') { this.mode = 'explore'; this.status = 'Goal reached'; }
      return;
    }
    let moved = this.robot.step(c.v, c.w, dt, this.collides);
    if (!moved) moved = this.robot.step(0, c.w || 1, dt, this.collides) && false;
    if (!moved) this.replanT = Math.min(this.replanT, 0.3);
    // stuck detection: no 5 cm of travel within 6 s -> reverse briefly, replan;
    // after 3 failures on the same goal, give it up.
    if (Math.hypot(this.robot.x - this.lastProgress.x, this.robot.y - this.lastProgress.y) > 0.05) this.lastProgress = { t: this.time, x: this.robot.x, y: this.robot.y };
    else if (this.time - this.lastProgress.t > 6) {
      this.lastProgress.t = this.time; this.path = null; this.replanT = 0.7; this.recoverT = 0.7;
      this.fails = (this.fails || 0) + 1;
      if (this.mode === 'explore' && this.goal) { const [i, j] = this.grid.toCell(this.goal[0], this.goal[1]); this.blacklist.add(j * this.grid.w + i); this.fails = 0; }
      else if (this.fails >= 3) {
        this.fails = 0;
        if (this.mode === 'final') { this.mode = 'done'; this.doneT = this.time; this.status = 'Goal unreachable'; }
        else { this.mode = 'explore'; this.status = 'Goal unreachable'; }
      }
    }
  }
}
