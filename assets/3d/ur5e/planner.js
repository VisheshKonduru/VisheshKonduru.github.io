// Joint-space planning for the UR5e: RRT-Connect (Kuffner and LaValle, 2000),
// random shortcut smoothing, and quintic time scaling per segment (RBE 501 L19)
// stretched until the RNEA torques and the joint speeds stay inside the UR5e limits.

import { N, inCollision, rnea } from './robot.js';
import { TAU_MAX, QD_MAX } from './ur5e-model.js';

// Planning bounds. Joints are kept to +-pi (elbow: real +-pi limit) so paths stay compact.
const LO = [-Math.PI, -Math.PI, -Math.PI, -Math.PI, -Math.PI, -Math.PI];
const HI = [Math.PI, 0.2, Math.PI, Math.PI, Math.PI, Math.PI];

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

// Edge check: sample so no joint moves more than `res` rad between checks.
export function edgeFree(a, b, spheres, res = 0.03) {
  let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(b[i] - a[i]));
  const n = Math.max(1, Math.ceil(m / res));
  for (let k = 1; k <= n; k++) {
    const t = k / n, q = a.map((x, i) => x + t * (b[i] - x));
    if (inCollision(q, spheres)) return false;
  }
  return true;
}
export function pathFree(path, spheres) {
  if (inCollision(path[0], spheres)) return false;
  for (let i = 1; i < path.length; i++) if (!edgeFree(path[i - 1], path[i], spheres)) return false;
  return true;
}

export function rrtConnect(qs, qg, spheres, { step = 0.25, maxIter = 4000, rng = Math.random, timeBudgetMs = 400 } = {}) {
  if (inCollision(qs, spheres) || inCollision(qg, spheres)) return null;
  if (edgeFree(qs, qg, spheres)) return [qs, qg];
  const t0 = Date.now();
  let Ta = [{ q: qs, p: -1 }], Tb = [{ q: qg, p: -1 }], swapped = false;
  const nearest = (T, q) => { let bi = 0, bd = Infinity; for (let i = 0; i < T.length; i++) { const d = dist(T[i].q, q); if (d < bd) { bd = d; bi = i; } } return bi; };
  const steer = (a, b) => { const d = dist(a, b); return d <= step ? b : a.map((x, i) => x + step * (b[i] - x) / d); };
  const extend = (T, q) => {   // returns 'reached' | 'advanced' | 'trapped'
    const ni = nearest(T, q), qn = steer(T[ni].q, q);
    if (!edgeFree(T[ni].q, qn, spheres)) return 'trapped';
    T.push({ q: qn, p: ni });
    return qn === q ? 'reached' : 'advanced';
  };
  for (let it = 0; it < maxIter; it++) {
    if (Date.now() - t0 > timeBudgetMs) return null;
    const qr = LO.map((l, i) => l + rng() * (HI[i] - l));
    if (extend(Ta, qr) !== 'trapped') {
      const qnew = Ta[Ta.length - 1].q;
      let r;                                    // CONNECT: repeat extend toward qnew
      do { r = extend(Tb, qnew); } while (r === 'advanced');
      if (r === 'reached') {
        const back = (T, i) => { const out = []; while (i >= 0) { out.push(T[i].q); i = T[i].p; } return out; };
        let pa = back(Ta, Ta.length - 1).reverse(), pb = back(Tb, Tb.length - 1);
        pb = pb.slice(1);
        const path = [...pa, ...pb];
        return swapped ? path.reverse() : path;
      }
    }
    [Ta, Tb] = [Tb, Ta]; swapped = !swapped;
  }
  return null;
}

// Random shortcutting: try to replace the sub-path between two random points by a straight edge.
export function shortcut(path, spheres, { iters = 80, rng = Math.random } = {}) {
  let p = path.map(q => [...q]);
  for (let k = 0; k < iters && p.length > 2; k++) {
    const i = Math.floor(rng() * (p.length - 2)), j = i + 2 + Math.floor(rng() * (p.length - i - 2));
    if (j >= p.length) continue;
    if (edgeFree(p[i], p[j], spheres)) p = [...p.slice(0, i + 1), ...p.slice(j)];
  }
  return p;
}

// Quintic time scaling s(t) = 10 tau^3 - 15 tau^4 + 6 tau^5, rest to rest at each waypoint.
// Segment time starts from the speed limit (peak sdot = 15/8 / T) and grows until the
// RNEA torque at sampled points is within `torqueFrac` of the UR5e max_effort.
export function timeParameterize(path, { torqueFrac = 0.8, speedFrac = 0.8 } = {}) {
  const segs = [];
  let t0 = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1], b = path[k], d = b.map((x, i) => x - a[i]);
    let T = 0.2;
    for (let i = 0; i < N; i++) T = Math.max(T, 15 / 8 * Math.abs(d[i]) / (speedFrac * QD_MAX[i]));
    for (let tries = 0; tries < 30; tries++) {
      let worst = 0;
      for (let m = 0; m <= 10; m++) {
        const st = sampleSeg(a, d, T, (m / 10) * T);
        const tau = rnea(st.q, st.qd, st.qdd);
        for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(tau[i]) / TAU_MAX[i]);
      }
      if (worst <= torqueFrac) break;
      T *= 1.15;
    }
    segs.push({ a, d, T, t0 });
    t0 += T;
  }
  return { segs, duration: t0, path };
}
function sampleSeg(a, d, T, t) {
  const u = Math.min(1, Math.max(0, t / T));
  const s = 10*u**3 - 15*u**4 + 6*u**5, sd = (30*u**2 - 60*u**3 + 30*u**4) / T, sdd = (60*u - 180*u**2 + 120*u**3) / (T*T);
  return { q: a.map((x, i) => x + s * d[i]), qd: d.map(x => sd * x), qdd: d.map(x => sdd * x) };
}
// Reference (q, qd, qdd) at time t along a parameterized trajectory.
export function sampleTraj(traj, t) {
  const { segs } = traj;
  if (!segs.length) { const q = traj.path[0]; return { q: [...q], qd: new Array(N).fill(0), qdd: new Array(N).fill(0), seg: 0 }; }
  let k = 0; while (k < segs.length - 1 && t > segs[k].t0 + segs[k].T) k++;
  const s = segs[k];
  return { ...sampleSeg(s.a, s.d, s.T, t - s.t0), seg: k };
}
// Remaining path from time t: current reference point, then the remaining waypoints.
export function remainingPath(traj, t) {
  const r = sampleTraj(traj, t);
  return [r.q, ...traj.path.slice(r.seg + 1)];
}
export function plan(qs, qg, spheres, opts = {}) {
  const raw = rrtConnect(qs, qg, spheres, opts);
  if (!raw) return null;
  const path = shortcut(raw, spheres, opts);
  return { raw, path, traj: timeParameterize(path) };
}
