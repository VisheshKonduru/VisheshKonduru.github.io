// Monte Carlo localization in the style of ROS amcl / nav2_amcl.
// Odometry motion model, likelihood-field measurement model (amcl's formula),
// low-variance resampling with KLD-sampled particle count, and augmented-MCL
// random-particle injection (w_slow / w_fast) for recovery.
import { SPEC, makeMaze, OccGrid, castRay, Robot, costmap, astar, purePursuit, circleHitsWalls, rng } from './sim.js';

// nav2_amcl defaults unless noted.
export const AMCL_PARAMS = {
  alpha1: 0.2, alpha2: 0.2, alpha3: 0.2, alpha4: 0.2,
  zHit: 0.8, zRand: 0.2, sigmaHit: 0.1, temper: 0.15, cellArea: 0.05, maxBeams: 30, likelihoodMaxDist: 2.0,
  minParticles: 500, maxParticles: 3000, pfErr: 0.05, pfZ: 2.326, // 99% normal quantile (amcl passes 0.99 raw)
  alphaSlow: 0.01, alphaFast: 0.3, // nav2 default is 0 (off); the amcl docs suggest these values
  updateMinD: 0.25, updateMinA: 0.2, // nav2_amcl defaults
  binXY: 0.5, binTh: (10 * Math.PI) / 180, clusterXY: 0.25,
};

function gaussR(r) { const u = Math.max(r(), 1e-12), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Rasterise ground-truth walls into a finished occupancy grid ("pre-mapped maze").
export function knownMap(maze, res = 0.05, margin = 0.25) {
  const size = maze.size + 2 * margin, n = Math.round(size / res);
  const g = new OccGrid(-margin, -margin, n, n, res);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x0 = g.originX + i * res, y0 = g.originY + j * res, k = j * n + i;
    const occ = circleHitsWalls(maze.walls, x0 + res / 2, y0 + res / 2, res * 0.5);
    const insideMaze = x0 + res / 2 > 0 && x0 + res / 2 < maze.sizeX && y0 + res / 2 > 0 && y0 + res / 2 < maze.sizeY;
    if (occ) { g.L[k] = 4; g.seen[k] = 1; } else if (insideMaze) { g.L[k] = -4; g.seen[k] = 1; }
  }
  return g;
}

// Distance (m) from each cell to the nearest occupied cell: two-pass chamfer transform.
export function distanceField(g, maxD) {
  const W = g.w, H = g.h, D = new Float32Array(W * H), INF = 1e9;
  for (let k = 0; k < W * H; k++) D[k] = g.state(k) === 2 ? 0 : INF;
  const s2 = Math.SQRT2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; let d = D[k];
    if (i > 0) d = Math.min(d, D[k - 1] + 1);
    if (j > 0) { d = Math.min(d, D[k - W] + 1); if (i > 0) d = Math.min(d, D[k - W - 1] + s2); if (i < W - 1) d = Math.min(d, D[k - W + 1] + s2); }
    D[k] = d;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i; let d = D[k];
    if (i < W - 1) d = Math.min(d, D[k + 1] + 1);
    if (j < H - 1) { d = Math.min(d, D[k + W] + 1); if (i < W - 1) d = Math.min(d, D[k + W + 1] + s2); if (i > 0) d = Math.min(d, D[k + W - 1] + s2); }
    D[k] = d;
  }
  for (let k = 0; k < W * H; k++) D[k] = Math.min(maxD, D[k] * g.res);
  return D;
}

export class ParticleFilter {
  constructor(map, seed = 1, params = {}) {
    this.p = { ...AMCL_PARAMS, ...params };
    this.map = map; this.rand = rng(seed);
    this.field = distanceField(map, this.p.likelihoodMaxDist);
    this.free = [];
    for (let k = 0; k < map.w * map.h; k++) if (map.state(k) === 1) this.free.push(k);
    const N = this.p.maxParticles;
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.th = new Float32Array(N); this.w = new Float64Array(N);
    this.nx = new Float32Array(N); this.ny = new Float32Array(N); this.nth = new Float32Array(N);
    this.wSlow = 0; this.wFast = 0; this.version = 0;
    this.buildLL();
    this.globalInit();
  }
  randomPose(i, xs = this.x, ys = this.y, ths = this.th) {
    const g = this.map, k = this.free[Math.floor(this.rand() * this.free.length)];
    xs[i] = g.originX + ((k % g.w) + this.rand()) * g.res;
    ys[i] = g.originY + (((k / g.w) | 0) + this.rand()) * g.res;
    ths[i] = (this.rand() * 2 - 1) * Math.PI;
  }
  // amcl "global localization": uniform over free space, max particle count.
  globalInit() {
    this.n = this.p.maxParticles;
    for (let i = 0; i < this.n; i++) { this.randomPose(i); this.w[i] = 1 / this.n; }
    this.wSlow = this.wFast = 0; this.version++;
    this.estimate();
  }
  // Sample the odometry motion model (Thrun et al., Probabilistic Robotics, table 5.6).
  motion(o0, o1) {
    const { alpha1: a1, alpha2: a2, alpha3: a3, alpha4: a4 } = this.p, r = this.rand;
    const dx = o1[0] - o0[0], dy = o1[1] - o0[1], dtr = Math.hypot(dx, dy);
    let dr1 = dtr < 0.01 ? 0 : wrap(Math.atan2(dy, dx) - o0[2]);
    let back = false;
    if (Math.abs(dr1) > Math.PI / 2) { dr1 = wrap(dr1 + Math.PI); back = true; } // driving backwards (as amcl)
    const dr2 = wrap(o1[2] - o0[2] - dr1);
    const sr1 = Math.sqrt(a1 * dr1 * dr1 + a2 * dtr * dtr), st = Math.sqrt(a3 * dtr * dtr + a4 * (dr1 * dr1 + dr2 * dr2)), sr2 = Math.sqrt(a1 * dr2 * dr2 + a2 * dtr * dtr);
    this.version++;
    for (let i = 0; i < this.n; i++) {
      const h1 = dr1 - sr1 * gaussR(r), t = (back ? -1 : 1) * (dtr - st * gaussR(r)), h2 = dr2 - sr2 * gaussR(r);
      this.x[i] += t * Math.cos(this.th[i] + h1); this.y[i] += t * Math.sin(this.th[i] + h1);
      this.th[i] = wrap(this.th[i] + h1 + h2);
    }
  }
  // Likelihood-field model (Probabilistic Robotics, table 6.3): product over beams
  // of z_hit * N(d; 0, sigma_hit) + z_rand / z_max, evaluated in log space. amcl uses a
  // softer 1 + sum(pz^3) score instead; in a dense maze that score barely separates poses.
  // Per-cell log-likelihood table (Float32Array), built once per map when the filter is created.
  buildLL() {
    const P = this.p, g = this.map, zr = P.zRand / SPEC.lidar.rangeMax, den = 2 * P.sigmaHit * P.sigmaHit;
    const norm = 1 / (Math.sqrt(2 * Math.PI) * P.sigmaHit) * P.cellArea;
    this.LL = new Float32Array(this.field.length);
    for (let k = 0; k < this.field.length; k++) { const d = this.field[k]; this.LL[k] = Math.log(P.zHit * norm * Math.exp(-(d * d) / den) + zr * P.cellArea / g.res); }
    this.LLout = Math.log(P.zHit * norm * Math.exp(-(P.likelihoodMaxDist ** 2) / den) + zr * P.cellArea / g.res);
  }
  measure(ranges) {
    const P = this.p, g = this.map, S = ranges.length, step = Math.max(1, Math.floor(S / P.maxBeams));
    const ox = SPEC.scanOffset.x; this.version++;
    // beam end points in the laser frame, computed once per scan
    const bx = [], by = [];
    for (let b = 0; b < S; b += step) { const r = ranges[b]; if (!(r < SPEC.lidar.rangeMax)) continue; const a = (b / S) * 2 * Math.PI; bx.push(r * Math.cos(a)); by.push(r * Math.sin(a)); }
    const nb = bx.length, LL = this.LL, LLout = this.LLout, ox0 = g.originX, oy0 = g.originY, ir = 1 / g.res, W = g.w, H = g.h;
    const lw = this.lw || (this.lw = new Float64Array(P.maxParticles));
    let maxL = -Infinity, fit = 0;
    for (let i = 0; i < this.n; i++) {
      const c = Math.cos(this.th[i]), s = Math.sin(this.th[i]);
      const lx = this.x[i] + c * ox, ly = this.y[i] + s * ox;
      let L = 0;
      for (let q = 0; q < nb; q++) {
        const ii = Math.floor((lx + c * bx[q] - s * by[q] - ox0) * ir), jj = Math.floor((ly + s * bx[q] + c * by[q] - oy0) * ir);
        L += ii >= 0 && jj >= 0 && ii < W && jj < H ? LL[jj * W + ii] : LLout;
      }
      lw[i] = Math.log(this.w[i]) + L * P.temper;
      fit += nb ? Math.exp(L / nb) : 0;
      if (lw[i] > maxL) maxL = lw[i];
    }
    let total = 0;
    for (let i = 0; i < this.n; i++) { this.w[i] = Math.exp(lw[i] - maxL); total += this.w[i]; }
    for (let i = 0; i < this.n; i++) this.w[i] /= total;
    // recovery statistic: mean per-beam likelihood (geometric mean over beams), averaged over particles
    const wAvg = fit / this.n;
    this.fit = wAvg;
    this.wSlow = this.wSlow ? this.wSlow + P.alphaSlow * (wAvg - this.wSlow) : wAvg;
    this.wFast = this.wFast ? this.wFast + P.alphaFast * (wAvg - this.wFast) : wAvg;
  }
  kldBound(k) {
    if (k <= 1) return this.p.minParticles;
    const b = 2 / (9 * (k - 1)), c = Math.sqrt(b) * this.p.pfZ, x = 1 - b + c;
    return Math.min(this.p.maxParticles, Math.max(this.p.minParticles, Math.ceil(((k - 1) / (2 * this.p.pfErr)) * x * x * x)));
  }
  // Integer bin keys (no per-particle strings): x, y and heading bins packed into one number.
  binKey(x, y, th) { const P = this.p; return ((Math.floor(x / P.binXY) + 512) * 1024 + (Math.floor(y / P.binXY) + 512)) * 64 + (Math.floor(th / P.binTh) + 32); }
  // Low-variance resampling of maxParticles candidates, visited in random order;
  // stop when the KLD bound for the bins filled so far is met. Each new sample is
  // replaced by a uniform random pose with probability max(0, 1 - w_fast / w_slow).
  resample() {
    const P = this.p, M = P.maxParticles, r = this.rand;
    const inject = this.wSlow > 0 ? Math.max(0, 1 - this.wFast / this.wSlow) : 0;
    this.injectProb = inject;
    const idx = new Int32Array(M);
    let u = r() / M, c = this.w[0], i = 0;
    for (let m = 0; m < M; m++) { const U = u + m / M; while (U > c && i < this.n - 1) c += this.w[++i]; idx[m] = i; }
    for (let m = M - 1; m > 0; m--) { const j = Math.floor(r() * (m + 1)); const t = idx[m]; idx[m] = idx[j]; idx[j] = t; }
    const bins = new Set(); let n = 0;
    while (n < M) {
      if (r() < inject) this.randomPose(n, this.nx, this.ny, this.nth);
      else { const s = idx[n]; this.nx[n] = this.x[s]; this.ny[n] = this.y[s]; this.nth[n] = this.th[s]; }
      bins.add(this.binKey(this.nx[n], this.ny[n], this.nth[n])); n++;
      if (n >= this.kldBound(bins.size)) break;
    }
    [this.x, this.nx] = [this.nx, this.x]; [this.y, this.ny] = [this.ny, this.y]; [this.th, this.nth] = [this.nth, this.th];
    this.n = n; for (let k = 0; k < n; k++) this.w[k] = 1 / n; this.version++;
    if (inject > 0) this.wSlow = this.wFast = 0; // amcl resets the averages after injecting
  }
  // amcl reports the mean/covariance of the heaviest particle cluster.
  estimate() {
    const P = this.p, bins = new Map(), K = 4096, key = (bx, by) => (bx + 2048) * K + (by + 2048);
    for (let i = 0; i < this.n; i++) {
      const k = key(Math.floor(this.x[i] / P.clusterXY), Math.floor(this.y[i] / P.clusterXY));
      let b = bins.get(k); if (!b) bins.set(k, (b = { w: 0, list: [] }));
      b.w += this.w[i]; b.list.push(i);
    }
    const seen = new Set(); let best = null;
    for (const k0 of bins.keys()) {
      if (seen.has(k0)) continue;
      const cl = { w: 0, list: [] }, q = [k0]; seen.add(k0);
      while (q.length) {
        const kk = q.pop(), b = bins.get(kk); cl.w += b.w; for (const i of b.list) cl.list.push(i);
        const bx = Math.floor(kk / K) - 2048, by = (kk % K) - 2048;
        for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) { const nk = key(bx + a, by + c); if (bins.has(nk) && !seen.has(nk)) { seen.add(nk); q.push(nk); } }
      }
      if (!best || cl.w > best.w) best = cl;
    }
    let sw = 0, mx = 0, my = 0, cs = 0, sn = 0;
    for (const i of best.list) { const w = this.w[i]; sw += w; mx += w * this.x[i]; my += w * this.y[i]; cs += w * Math.cos(this.th[i]); sn += w * Math.sin(this.th[i]); }
    mx /= sw; my /= sw;
    let cxx = 0, cyy = 0, cxy = 0;
    for (const i of best.list) { const w = this.w[i] / sw, dx = this.x[i] - mx, dy = this.y[i] - my; cxx += w * dx * dx; cyy += w * dy * dy; cxy += w * dx * dy; }
    const R = Math.hypot(cs, sn) / sw;
    this.est = { x: mx, y: my, th: Math.atan2(sn, cs), cxx, cyy, cxy, thStd: Math.sqrt(Math.max(0, -2 * Math.log(Math.max(R, 1e-9)))), weight: best.w };
    return this.est;
  }
  converged() {
    const e = this.est, l1 = (e.cxx + e.cyy) / 2 + Math.sqrt(((e.cxx - e.cyy) / 2) ** 2 + e.cxy ** 2);
    return e.weight > 0.9 && Math.sqrt(l1) < 0.15 && e.thStd < 0.2;
  }
}

// ---- Localization scene: kidnapped robot, known map, AMCL, A* to a goal ----
export class LocWorld {
  constructor(seed = 3, map = null) { this.reset(seed, map); }
  reset(seed, map = null) {
    this.seed = seed; this.maze = makeMaze(seed); this.rand = rng(seed * 104729 + 7);
    this.grid = map || knownMap(this.maze);
    this.mapSource = map ? 'scene A map' : 'pre-mapped maze';
    this.cm = costmap(this.grid);
    this.pf = new ParticleFilter(this.grid, seed + 11);
    this.ranges = new Float32Array(SPEC.lidar.samples).fill(Infinity);
    this.time = 0; this.scanT = 0; this.scans = 0; this.pfUpdates = 0;
    this.goal = null; this.path = null; this.pathVersion = 0; this.replanT = 0;
    this.robot = new Robot(0, 0, 0);
    this.placed = false; this.state = 'idle'; this.status = 'No robot placed'; this.odom = [0, 0, 0]; this.odomLast = null;
    this.spreadHist = []; this.essHist = [];
  }
  // The visitor drops the robot: the true pose is set, the filter starts from a uniform spread.
  place(x, y, th) { this.kidnap(x, y, th); this.placed = true; this.state = 'ready'; this.spreadHist = []; this.essHist = []; this.status = 'Robot placed'; }
  spread() { const e = this.pf.est; return Math.sqrt((e.cxx + e.cyy) / 2 + Math.sqrt(((e.cxx - e.cyy) / 2) ** 2 + e.cxy ** 2)); }
  ess() { let s2 = 0; for (let i = 0; i < this.pf.n; i++) s2 += this.pf.w[i] * this.pf.w[i]; return 1 / s2; }
  freeOk(x, y) { return !circleHitsWalls(this.maze.walls, x, y, SPEC.footprint.r + 0.02) && x > 0 && y > 0 && x < this.maze.sizeX && y < this.maze.sizeY; }
  randomFree(minFrom = 0) {
    for (let k = 0; k < 500; k++) {
      const x = this.rand() * this.maze.sizeX, y = this.rand() * this.maze.sizeY;
      if (this.freeOk(x, y) && Math.hypot(x - this.robot.x, y - this.robot.y) >= minFrom) return [x, y];
    }
    return this.maze.center(0, 0);
  }
  // Teleport the true robot; the filter is told nothing except "re-localize globally".
  kidnap(x, y, th) {
    if (x === undefined) [x, y] = this.randomFree(), th = (this.rand() * 2 - 1) * Math.PI;
    Object.assign(this.robot, { x, y, th, wl: 0, wr: 0 });
    this.odom = [0, 0, 0]; this.odomLast = null; // odometry frame restarts
    this.pf.globalInit(); this.updAtKidnap = this.pfUpdates || 0; this.travel = 0;
    this.state = this.placed ? 'localizing' : this.state; this.spun = 0; this.wanderHead = null; this.path = null; this.idleT = 0; this.lastProg = { t: this.time, x, y };
  }
  start() { if (this.placed && this.goal && this.state === 'ready') { this.state = 'localizing'; this.status = `Particle filter: ${this.pf.n} particles`; } }
  setGoal(x, y) { this.goal = [x, y]; this.path = null; this.replanT = 0; if (this.state === 'arrived') this.state = 'navigating'; }
  scanPose() { const r = this.robot, o = SPEC.scanOffset.x; return [r.x + Math.cos(r.th) * o, r.y + Math.sin(r.th) * o, r.th]; }
  sense() {
    const [sx, sy, sth] = this.scanPose(), S = SPEC.lidar.samples, L = SPEC.lidar;
    for (let k = 0; k < S; k++) {
      let r = castRay(this.maze.segs, sx, sy, sth + (k / S) * 2 * Math.PI);
      if (r !== Infinity) r += gaussR(this.rand) * L.noiseStd;
      this.ranges[k] = r >= L.rangeMin && r <= L.rangeMax ? r : Infinity;
    }
    this.scans++;
  }
  filter() {
    const P = this.pf.p;
    if (!this.odomLast) { this.odomLast = [...this.odom]; this.pf.measure(this.ranges); this.pf.estimate(); return; }
    const o0 = this.odomLast, o1 = this.odom;
    if (Math.hypot(o1[0] - o0[0], o1[1] - o0[1]) < P.updateMinD && Math.abs(wrap(o1[2] - o0[2])) < P.updateMinA) return;
    this.pf.motion(o0, o1); this.pf.measure(this.ranges);
    // selective resampling: only when the effective sample size drops below N/2
    let s2 = 0; for (let i = 0; i < this.pf.n; i++) s2 += this.pf.w[i] * this.pf.w[i];
    if (1 / s2 < this.pf.n / 2 || this.pf.wFast < this.pf.wSlow * 0.5) this.pf.resample();
    this.pf.estimate();
    this.odomLast = [...o1]; this.pfUpdates++;
    this.spreadHist.push(this.spread()); this.essHist.push(this.ess() / this.pf.n);
    if (this.spreadHist.length > 120) { this.spreadHist.shift(); this.essHist.shift(); }
  }
  collides = (x, y) => circleHitsWalls(this.maze.walls, x, y, SPEC.footprint.r - 0.01);
  drive(v, w, dt) {
    const r = this.robot, x0 = r.x, y0 = r.y, t0 = r.th;
    const moved = r.step(v, w, dt, this.collides);
    // wheel odometry with 2% slip noise, integrated in the odom frame
    const dd = Math.hypot(r.x - x0, r.y - y0) * Math.sign(r.v || 1) * (1 + 0.02 * gaussR(this.rand)), dth = wrap(r.th - t0) * (1 + 0.02 * gaussR(this.rand));
    this.travel = (this.travel || 0) + Math.abs(dd);
    const o = this.odom; o[0] += dd * Math.cos(o[2] + dth / 2); o[1] += dd * Math.sin(o[2] + dth / 2); o[2] = wrap(o[2] + dth);
    return moved;
  }
  // Pose estimate in the map frame, propagated by odometry between filter updates.
  estPose() {
    const e = this.pf.est, o0 = this.odomLast || this.odom, o = this.odom;
    const dx = o[0] - o0[0], dy = o[1] - o0[1], c = Math.cos(e.th - o0[2]), s = Math.sin(e.th - o0[2]);
    return { x: e.x + c * dx - s * dy, y: e.y + s * dx + c * dy, th: wrap(e.th + o[2] - o0[2]) };
  }
  step(dt) {
    if (!this.placed || this.state === 'ready' || this.state === 'idle') return;
    this.time += dt; this.scanT += dt;
    if (this.scanT >= 1 / SPEC.lidar.hz) { this.scanT -= 1 / SPEC.lidar.hz; this.sense(); this.filter(); this.evaluate(); }
    if (!this.scans) return;
    if (this.state === 'localizing') {
      // rotate in place once, then wander with a simple reactive rule until converged
      if (this.spun < 2 * Math.PI) { this.drive(0, 1.2, dt); this.spun += 1.2 * dt; return; }
      const S = this.ranges.length; let front = Infinity, left = 0, right = 0;
      for (let k = -30; k <= 30; k++) front = Math.min(front, this.ranges[(k + S) % S]);
      for (let k = 30; k < 120; k++) { left += Math.min(2, this.ranges[k]); right += Math.min(2, this.ranges[S - k]); }
      // wander: head for the most open direction (excluding straight back), re-pick when blocked
      if (this.wanderHead === null || this.wanderHead === undefined || front < 0.35) {
        let best = -1, bk = 0;
        for (let k = 0; k < S; k++) {
          if (k > 135 && k < 225) continue;
          let m = Infinity; for (let q = -12; q <= 12; q++) m = Math.min(m, this.ranges[(k + q + S) % S]);
          const v = Math.min(m, 3.5) + 0.3 * this.rand();
          if (v > best) { best = v; bk = k; }
        }
        this.wanderHead = wrap(this.odom[2] + (bk / S) * 2 * Math.PI); // odometry heading, not ground truth
      }
      if (this.backT > 0) { this.backT -= dt; this.drive(-0.1, 0, dt); return; }
      const err = wrap(this.wanderHead - this.odom[2]);
      if (Math.abs(err) > 0.25) this.drive(0, Math.sign(err) * 1.5, dt);
      else if (!this.drive(0.18, 2 * err, dt)) { this.wanderHead = null; this.backT = 0.6; }
    } else if (this.state === 'navigating') {
      if (!this.goal) { this.drive(0, 0, dt); return; }
      const est = this.estPose();
      this.replanT -= dt;
      if (!this.path || this.replanT <= 0) { this.plan(est); this.replanT = 2; }
      if (!this.path) { this.drive(0, 0, dt); return; }
      const c = purePursuit(est, this.path);
      if (c.dEnd < 0.08) { this.state = 'arrived'; this.path = null; this.idleT = 0; this.status = 'Goal reached'; return; }
      this.drive(c.v, c.w, dt);
      if (Math.hypot(this.robot.x - this.lastProg.x, this.robot.y - this.lastProg.y) > 0.05) this.lastProg = { t: this.time, x: this.robot.x, y: this.robot.y };
      else if (this.time - this.lastProg.t > 5) { this.lastProg.t = this.time; this.path = null; this.drive(-0.1, 0, 0.3); }
    } else if (this.state === 'arrived') {
      this.drive(0, 0, dt); this.idleT += dt;   // stops and waits for the visitor
    }
  }
  plan(est) {
    const g = this.grid, [si, sj] = g.toCell(est.x, est.y), [ti, tj] = g.toCell(this.goal[0], this.goal[1]);
    if (!g.inside(si, sj) || !g.inside(ti, tj)) { this.path = null; return; }
    const tr = { closed: [] }, p = astar(g, this.cm, sj * g.w + si, tj * g.w + ti, Infinity, tr);
    if (!p) { this.path = null; this.status = 'No path from estimated pose'; return; }
    this.path = p.map(k => [g.originX + ((k % g.w) + 0.5) * g.res, g.originY + (((k / g.w) | 0) + 0.5) * g.res]);
    this.path[0] = [est.x, est.y]; this.pathVersion++; this.astarNodes = tr.closed.length;
    let L = 0; for (let i = 1; i < this.path.length; i++) L += Math.hypot(this.path[i][0] - this.path[i - 1][0], this.path[i][1] - this.path[i - 1][1]);
    this.pathLen = L; this.status = `A* path: ${L.toFixed(1)} m`;
  }
  evaluate() {
    const conv = this.pf.converged();
    if (this.state === 'localizing' && conv && this.spun >= 2 * Math.PI && this.pfUpdates - (this.updAtKidnap || 0) >= 40 && this.travel > 1.0) { this.state = 'navigating'; this.path = null; this.replanT = 0; this.status = `Converged: spread ${this.spread().toFixed(2)} m`; }
    else if (this.state === 'navigating' && !conv && this.pf.injectProb > 0.2) { this.state = 'localizing'; this.spun = 0; this.wanderHead = null; this.path = null; this.status = `Likelihood dropped, injecting ${Math.round(this.pf.injectProb * 100)}% random particles`; }
    else if (this.state === 'localizing') this.status = `Particle filter: ${this.pf.n} particles, spread ${this.spread().toFixed(2)} m`;
  }
}
