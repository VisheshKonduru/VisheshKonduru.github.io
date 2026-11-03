// node assets/3d/ur5e/test_ur5e.mjs
import * as R from './robot.js';
import * as P from './planner.js';
import * as S from './sim.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const rng = P.mulberry32(501);
const rq = () => Array.from({ length: 6 }, () => (rng() * 2 - 1) * Math.PI);
const maxAbs = a => Math.max(...a.flat().map(Math.abs));

// 1. PoE FK equals UR's DH FK
{
  let worst = 0;
  for (let k = 0; k < 500; k++) {
    const q = rq(), A = R.fk(q).T, B = R.fkDH(q);
    worst = Math.max(worst, maxAbs(A.map((r, i) => r.map((x, j) => x - B[i][j]))));
  }
  ok(worst < 1e-9, `PoE FK = DH FK over 500 random q (max diff ${worst.toExponential(2)})`);
}
// 2. Space Jacobian equals finite differences: [V_s] = Tdot T^-1
{
  let worst = 0; const h = 1e-6;
  for (let k = 0; k < 100; k++) {
    const q = rq(), J = R.jacobianSpace(q), T = R.fk(q).T, Ti = R.inv4(T);
    for (let j = 0; j < 6; j++) {
      const qp = [...q]; qp[j] += h; const qm = [...q]; qm[j] -= h;
      const Tp = R.fk(qp).T, Tm = R.fk(qm).T;
      const Td = Tp.map((r, a) => r.map((x, b) => (x - Tm[a][b]) / (2 * h)));
      const X = R.mul4(Td, Ti);
      const Vs = [X[2][1], X[0][2], X[1][0], X[0][3], X[1][3], X[2][3]];
      for (let r = 0; r < 6; r++) worst = Math.max(worst, Math.abs(Vs[r] - J[r][j]));
    }
  }
  ok(worst < 1e-7, `J_s matches finite differences (max diff ${worst.toExponential(2)})`);
}
// 3a. RNEA equals M(q) qdd + c(q,qd) + g(q), with M from RNEA columns and fast path agreeing
{
  let worst = 0, worstFast = 0;
  for (let k = 0; k < 100; k++) {
    const q = rq(), qd = rq(), qdd = rq();
    const tau = R.rnea(q, qd, qdd), Mq = R.massMatrix(q), h = R.biasTorque(q, qd);
    const t2 = R.matVec(Mq, qdd).map((x, i) => x + h[i]);
    worst = Math.max(worst, ...tau.map((x, i) => Math.abs(x - t2[i])));
    const { M: M2, h: h2 } = R.dynamicsMh(q, qd);
    worstFast = Math.max(worstFast, maxAbs(Mq.map((r, i) => r.map((x, j) => x - M2[i][j]))), ...h.map((x, i) => Math.abs(x - h2[i])));
  }
  ok(worst < 1e-9, `RNEA = M qdd + c + g (max diff ${worst.toExponential(2)})`);
  ok(worstFast < 1e-9, `fast M, h path = reference RNEA (max diff ${worstFast.toExponential(2)})`);
}
// 3b. M(q) symmetric positive definite
{
  let symErr = 0, minEig = Infinity;
  for (let k = 0; k < 50; k++) {
    const Mq = R.massMatrix(rq());
    symErr = Math.max(symErr, maxAbs(Mq.map((r, i) => r.map((x, j) => x - Mq[j][i]))));
    minEig = Math.min(minEig, ...R.eigSym(Mq).vals);
  }
  ok(symErr < 1e-12 && minEig > 0, `M(q) symmetric (${symErr.toExponential(1)}) and positive definite (min eig ${minEig.toExponential(2)})`);
}
// 3c. Energy check: dE/dt = qd^T tau for tau = RNEA(q, qd, qdd)
{
  let worst = 0; const h = 1e-5;
  for (let k = 0; k < 50; k++) {
    const q = rq(), qd = rq(), qdd = rq();
    const at = t => R.energy(q.map((x, i) => x + qd[i] * t + 0.5 * qdd[i] * t * t), qd.map((x, i) => x + qdd[i] * t)).E;
    const dE = (at(h) - at(-h)) / (2 * h);
    const P = qd.reduce((s, x, i) => s + x * R.rnea(q, qd, qdd)[i], 0);
    worst = Math.max(worst, Math.abs(dE - P) / Math.max(1, Math.abs(P)));
  }
  ok(worst < 1e-5, `energy: dE/dt = qd^T tau (max rel diff ${worst.toExponential(2)})`);
}
// 3d. Free-fall simulation conserves energy (tau = 0, RK4 1 kHz, 2 s)
{
  let q = [0.2, -1.0, 1.0, -1.2, 1.4, 0.3], qd = [0, 0, 0, 0, 0, 0];
  const E0 = R.energy(q, qd).E; let drift = 0;
  for (let k = 0; k < 2000; k++) { ({ q, qd } = S.rk4Step(q, qd, [0,0,0,0,0,0], null)); }
  drift = Math.abs(R.energy(q, qd).E - E0);
  ok(drift < 1e-3, `unforced RK4 sim conserves energy over 2 s (drift ${drift.toExponential(2)} J)`);
}
// 3e. Static check: tau = J^T F for a tool force, with gravity off
{
  const q = rq(), kin = R.fk(q), Js = R.jacobianSpace(q, kin);
  const f = [3, -2, 5], p = [kin.T[0][3], kin.T[1][3], kin.T[2][3]];
  const m = [p[1]*f[2]-p[2]*f[1], p[2]*f[0]-p[0]*f[2], p[0]*f[1]-p[1]*f[0]];
  const Fs = [...m, ...f];
  const tauJ = Js[0].map((_, j) => Js.reduce((s, r, i) => s + r[j] * Fs[i], 0));
  const Ft = R.matVec(R.transpose(R.Ad(kin.T)), Fs);  // wrench in tool frame
  const tauR = R.rnea(q, [0,0,0,0,0,0], [0,0,0,0,0,0], 0, Ft);
  const d = Math.max(...tauJ.map((x, i) => Math.abs(x - tauR[i])));
  ok(d < 1e-9, `RNEA tip wrench = J_s^T F (max diff ${d.toExponential(2)})`);
}
// 4. DLS IK converges
{
  let conv = 0, trials = 100;
  for (let k = 0; k < trials; k++) {
    const qt = rq(), Td = R.fk(qt).T;
    const q0 = qt.map(x => x + (rng() * 2 - 1) * 0.5);
    const r = R.ikDLS(q0, Td, { iters: 300 });
    if (r.ok) conv++;
  }
  ok(conv >= 95, `DLS IK converges from +-0.5 rad perturbations: ${conv}/${trials}`);
}
// 5. Planner gives collision-free paths
{
  const qs = [-1.2, -1.6, 1.6, -1.57, -1.57, 0], qg = [1.2, -1.6, 1.6, -1.57, -1.57, 0];
  let found = 0, free = 0, trials = 20, limitsOk = true;
  for (let k = 0; k < trials; k++) {
    const sph = [{ c: [ (rng() - 0.5) * 0.4, -0.5 - rng() * 0.2, 0.25 + rng() * 0.3], r: 0.08 + rng() * 0.05 }];
    if (R.inCollision(qs, sph) || R.inCollision(qg, sph)) { trials--; continue; }
    const res = P.plan(qs, qg, sph, { rng, timeBudgetMs: 3000, maxIter: 20000 });
    if (!res) continue;
    found++;
    // dense check of the time-parameterized trajectory
    let bad = false;
    for (let t = 0; t <= res.traj.duration; t += 0.002) {
      const s = P.sampleTraj(res.traj, t);
      if (R.inCollision(s.q, sph, 0)) bad = true;
      const tau = R.rneaFast(s.q, s.qd, s.qdd);
      for (let i = 0; i < 6; i++) if (Math.abs(s.qd[i]) > Math.PI + 1e-9 || Math.abs(tau[i]) > [150,150,150,28,28,28][i]) limitsOk = false;
    }
    if (!bad && P.pathFree(res.path, sph)) free++;
  }
  ok(found >= trials * 0.9, `RRT-Connect found ${found}/${trials} paths`);
  ok(free === found, `all ${found} smoothed, time-scaled paths collision-free (dense 2 ms check)`);
  ok(limitsOk, `trajectories stay within UR5e velocity and torque limits`);
}
// 6. Controllers hold a pose against gravity; computed torque tracks best
{
  const q0 = [0, -1.0, 1.2, -1.5, -1.57, 0];
  const ref = { q: q0, qd: [0,0,0,0,0,0], qdd: [0,0,0,0,0,0] };
  const errs = {};
  for (const kind of ['pd', 'pdg', 'ct']) {
    let q = q0.map(x => x + 0.2), qd = [0,0,0,0,0,0];
    for (let k = 0; k < 3000; k++) ({ q, qd } = S.rk4Step(q, qd, S.controlTorque(kind, q, qd, ref), null));
    errs[kind] = Math.hypot(...q.map((x, i) => x - q0[i]));
  }
  ok(errs.pd > 1e-3 && errs.pdg < 1e-4 && errs.ct < 1e-4, `steady-state error after 3 s from a 0.2 rad offset per joint: PD ${errs.pd.toExponential(2)}, PD+g ${errs.pdg.toExponential(2)}, CT ${errs.ct.toExponential(2)} rad`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
