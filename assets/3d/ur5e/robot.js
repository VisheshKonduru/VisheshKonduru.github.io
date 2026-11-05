// UR5e kinematics and dynamics in the RBE 501 notation (same formulation as Lynch and Park, Modern Robotics):
// twists and screws are 6-vectors [omega; v], PoE in the space frame,
// Jacobian columns J_si = Ad_{e^[S1]th1 ... e^[S(i-1)]th(i-1)} S_i,
// recursive Newton-Euler with A_i = Ad_{M_i^-1} S_i and Vdot_0 = [0; -g].
// No dependencies; runs in the browser and in node.

import { JOINTS, LINKS, DH, CAPSULES } from './ur5e-model.js';

export const N = 6;
export const GRAV = 9.81;

// ---------- small linear algebra ----------
export const I4 = () => [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
export function mul4(A, B) {
  const C = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0; for (let k = 0; k < 4; k++) s += A[i][k] * B[k][j]; C[i][j] = s;
  }
  return C;
}
export function inv4(T) {
  const R = [[T[0][0],T[1][0],T[2][0]],[T[0][1],T[1][1],T[2][1]],[T[0][2],T[1][2],T[2][2]]];
  const p = [T[0][3],T[1][3],T[2][3]];
  const q = [0,1,2].map(i => -(R[i][0]*p[0] + R[i][1]*p[1] + R[i][2]*p[2]));
  return [[...R[0], q[0]], [...R[1], q[1]], [...R[2], q[2]], [0,0,0,1]];
}
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function rpyToR(r, p, y) { // URDF: R = Rz(y) Ry(p) Rx(r)
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  return [[cy*cp, cy*sp*sr - sy*cr, cy*sp*cr + sy*sr],
          [sy*cp, sy*sp*sr + cy*cr, sy*sp*cr - cy*sr],
          [-sp, cp*sr, cp*cr]];
}
function Txyzrpy(xyz, rpy) {
  const R = rpyToR(...rpy);
  return [[...R[0], xyz[0]], [...R[1], xyz[1]], [...R[2], xyz[2]], [0,0,0,1]];
}
export function matVec(A, x) { return A.map(r => r.reduce((s, a, j) => s + a * x[j], 0)); }
export function transpose(A) { return A[0].map((_, j) => A.map(r => r[j])); }
export function matMul(A, B) { return A.map(r => B[0].map((_, j) => r.reduce((s, a, k) => s + a * B[k][j], 0))); }

// Adjoint [Ad_T] (6x6) for twists [w; v]
export function Ad(T) {
  const R = [[T[0][0],T[0][1],T[0][2]],[T[1][0],T[1][1],T[1][2]],[T[2][0],T[2][1],T[2][2]]];
  const p = [T[0][3],T[1][3],T[2][3]];
  const P = [[0,-p[2],p[1]],[p[2],0,-p[0]],[-p[1],p[0],0]];
  const PR = matMul(P, R);
  const A = [];
  for (let i = 0; i < 3; i++) A.push([...R[i], 0, 0, 0]);
  for (let i = 0; i < 3; i++) A.push([...PR[i], ...R[i]]);
  return A;
}
// ad_V (6x6)
export function adV(V) {
  const w = [[0,-V[2],V[1]],[V[2],0,-V[0]],[-V[1],V[0],0]];
  const v = [[0,-V[5],V[4]],[V[5],0,-V[3]],[-V[4],V[3],0]];
  const A = [];
  for (let i = 0; i < 3; i++) A.push([...w[i], 0, 0, 0]);
  for (let i = 0; i < 3; i++) A.push([...v[i], ...w[i]]);
  return A;
}
// e^[S]theta for a screw S = [w; v] with |w| = 1 (revolute)
export function expS(S, th) {
  const w = [S[0], S[1], S[2]], v = [S[3], S[4], S[5]];
  const c = Math.cos(th), s = Math.sin(th), vc = 1 - c;
  const W = [[0,-w[2],w[1]],[w[2],0,-w[0]],[-w[1],w[0],0]];
  const W2 = matMul(W, W);
  const R = [0,1,2].map(i => [0,1,2].map(j => (i === j ? 1 : 0) + s * W[i][j] + vc * W2[i][j]));
  // G(theta) v = (I th + (1-c)[w] + (th - s)[w]^2) v
  const G = [0,1,2].map(i => [0,1,2].map(j => (i === j ? th : 0) + vc * W[i][j] + (th - s) * W2[i][j]));
  const p = matVec(G, v);
  return [[...R[0], p[0]], [...R[1], p[1]], [...R[2], p[2]], [0,0,0,1]];
}
// matrix log of T -> twist [w; v]*theta (6-vector)
export function logT(T) {
  const R = [[T[0][0],T[0][1],T[0][2]],[T[1][0],T[1][1],T[1][2]],[T[2][0],T[2][1],T[2][2]]];
  const p = [T[0][3],T[1][3],T[2][3]];
  const tr = R[0][0] + R[1][1] + R[2][2];
  const ct = Math.min(1, Math.max(-1, (tr - 1) / 2));
  const th = Math.acos(ct);
  if (th < 1e-9) return [0, 0, 0, p[0], p[1], p[2]];
  let w;
  if (Math.PI - th < 1e-6) {
    const k = R[2][2] > -1 + 1e-9 ? 2 : R[1][1] > -1 + 1e-9 ? 1 : 0;
    const d = Math.sqrt(2 * (1 + R[k][k]));
    w = [0,1,2].map(i => (R[i][k] + (i === k ? 1 : 0)) / d);
  } else {
    const s2 = 2 * Math.sin(th);
    w = [(R[2][1]-R[1][2]) / s2, (R[0][2]-R[2][0]) / s2, (R[1][0]-R[0][1]) / s2];
  }
  const W = [[0,-w[2],w[1]],[w[2],0,-w[0]],[-w[1],w[0],0]];
  const W2 = matMul(W, W);
  const k = 1 / th - 0.5 / Math.tan(th / 2);
  const Gi = [0,1,2].map(i => [0,1,2].map(j => (i === j ? 1 / th : 0) - 0.5 * W[i][j] + k * W2[i][j]));
  const v = matVec(Gi, p);
  return [w[0]*th, w[1]*th, w[2]*th, v[0]*th, v[1]*th, v[2]*th];
}
// Solve A x = b (dense, partial pivoting). A is n x n.
export function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r];
  }
  return x;
}
// Symmetric eigen-decomposition by cyclic Jacobi. Returns {vals, vecs (columns)}.
export function eigSym(Ain) {
  const n = Ain.length, A = Ain.map(r => [...r]);
  const V = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = c*a - s*b; A[k][q] = s*a + c*b; }
      for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = c*a - s*b; A[q][k] = s*a + c*b; }
      for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c*a - s*b; V[k][q] = s*a + c*b; }
    }
  }
  return { vals: A.map((r, i) => r[i]), vecs: V };
}

// ---------- model setup from the URDF chain ----------
// Home transforms of the link frames {link i} in {0} (q = 0).
export const M_link = [];   // M_link[i], i = 0..5 for links shoulder..wrist_3
{
  let T = I4();
  for (const j of JOINTS) { T = mul4(T, Txyzrpy(j.xyz, j.rpy)); M_link.push(T); }
}
// Tool (flange) home configuration M = home pose of wrist_3_link.
export const M_tool = M_link[5];
// Space-frame screw axes S_i = [w; -w x q] with w the joint z axis at home.
export const S = M_link.map(T => {
  const w = [T[0][2], T[1][2], T[2][2]], q = [T[0][3], T[1][3], T[2][3]];
  const v = cross(q, w); // -w x q = q x w
  return [...w, ...v];
});
// Centre-of-mass frames {i}: link frame translated to the COM, axes parallel to the link frame.
export const M_com = LINKS.map((L, i) => mul4(M_link[i], [[1,0,0,L.com[0]],[0,1,0,L.com[1]],[0,0,1,L.com[2]],[0,0,0,1]]));
// Spatial inertia G_i = diag(I_b, m I) in {i}; I_b = R I R^T rotates the URDF inertial frame into the link frame.
export const G = LINKS.map(L => {
  const [xx, xy, xz, yy, yz, zz] = L.I;
  const Ic = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  const R = rpyToR(...L.rpy);
  const Ib = matMul(matMul(R, Ic), transpose(R));
  const g = [...Array(6)].map(() => new Array(6).fill(0));
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) g[a][b] = Ib[a][b];
  for (let a = 3; a < 6; a++) g[a][a] = L.m;
  return g;
});
// A_i = Ad_{M_i^-1} S_i
const A = M_com.map((Mi, i) => matVec(Ad(inv4(Mi)), S[i]));
// M_{i,i-1} = M_i^-1 M_{i-1}  (M_0 = I)
const Mrel = M_com.map((Mi, i) => mul4(inv4(Mi), i === 0 ? I4() : M_com[i - 1]));

// ---------- kinematics ----------
// Product of exponentials. Returns the tool pose and every link frame pose.
export function fk(q) {
  let P = I4();
  const prods = [], links = [];
  for (let i = 0; i < N; i++) {
    prods.push(P);                       // e^[S1]th1 ... e^[S(i-1)]th(i-1)
    P = mul4(P, expS(S[i], q[i]));
    links.push(mul4(P, M_link[i]));      // pose of link frame i
  }
  return { T: mul4(P, M_tool), links, prods };
}
// Standard DH FK with Universal Robots' published table, for verification.
export function fkDH(q) {
  let T = I4();
  for (let i = 0; i < N; i++) {
    const ct = Math.cos(q[i]), st = Math.sin(q[i]), ca = Math.cos(DH.alpha[i]), sa = Math.sin(DH.alpha[i]);
    T = mul4(T, [[ct, -st*ca, st*sa, DH.a[i]*ct], [st, ct*ca, -ct*sa, DH.a[i]*st], [0, sa, ca, DH.d[i]], [0,0,0,1]]);
  }
  return T;
}
// Space Jacobian (6 x N), columns J_si = Ad_{prod_{k<i}} S_i
export function jacobianSpace(q, kin = fk(q)) {
  const cols = kin.prods.map((P, i) => matVec(Ad(P), S[i]));
  return transpose(cols);
}
// Linear-velocity Jacobian of the tool point p: v_p = v_s + w_s x p  ->  Jv = Jv_s - [p] Jw_s
export function toolLinearJacobian(Js, p) {
  const out = [[], [], []];
  for (let j = 0; j < N; j++) {
    const w = [Js[0][j], Js[1][j], Js[2][j]], v = [Js[3][j], Js[4][j], Js[5][j]];
    const c = cross(w, p);
    for (let r = 0; r < 3; r++) out[r].push(v[r] + c[r]);
  }
  return out;
}
// Manipulability ellipsoid of A = Jv Jv^T: axes = eigenvectors, half-lengths = sqrt(eigenvalues).
// mu = sqrt(det(Jv Jv^T)). Also the singular values of the full 6x6 J_s.
export function manipulability(q, kin = fk(q)) {
  const Js = jacobianSpace(q, kin);
  const p = [kin.T[0][3], kin.T[1][3], kin.T[2][3]];
  const Jv = toolLinearJacobian(Js, p);
  const Av = matMul(Jv, transpose(Jv));
  const ev = eigSym(Av);
  const axes = ev.vals.map(v => Math.sqrt(Math.max(v, 0)));
  const mu = Math.sqrt(Math.max(0, ev.vals[0] * ev.vals[1] * ev.vals[2]));
  const sv = eigSym(matMul(Js, transpose(Js))).vals.map(v => Math.sqrt(Math.max(v, 0))).sort((a, b) => a - b);
  return { Js, Jv, axes, vecs: ev.vecs, mu, sigmaMin: sv[0], sigmaMax: sv[5], invCond: sv[0] / sv[5] };
}

// Damped least squares IK (RBE 501 L08): dth = J^T (J J^T + lambda^2 I)^-1 V,
// with the pose error twist V_s = Ad_T log(T^-1 T_d) in the space frame.
export function ikDLS(q0, Td, { iters = 100, lambda = 0.05, tolW = 1e-4, tolV = 1e-5, maxStep = 0.3 } = {}) {
  // lambda adapts (Levenberg-Marquardt style): shrink after a step that lowers the error, grow otherwise.
  let q = [...q0], lam = lambda;
  const err = q_ => { const kin = fk(q_); const Vb = logT(mul4(inv4(kin.T), Td));
    return { kin, Vb, eW: Math.hypot(Vb[0], Vb[1], Vb[2]), eV: Math.hypot(Vb[3], Vb[4], Vb[5]) }; };
  let cur = err(q);
  for (let it = 0; it < iters; it++) {
    if (cur.eW < tolW && cur.eV < tolV) return { q, iters: it, ok: true, eW: cur.eW, eV: cur.eV };
    const Vs = matVec(Ad(cur.kin.T), cur.Vb);
    const J = jacobianSpace(q, cur.kin);
    const JJt = matMul(J, transpose(J));
    for (let r = 0; r < 6; r++) JJt[r][r] += lam * lam;
    const dq = matVec(transpose(J), solve(JJt, Vs));
    const n = Math.hypot(...dq), k = n > maxStep ? maxStep / n : 1;
    const qn = q.map((x, i) => x + k * dq[i]);
    const nx = err(qn);
    if (nx.eW + nx.eV < cur.eW + cur.eV) { q = qn; cur = nx; lam = Math.max(1e-3, lam * 0.7); }
    else lam = Math.min(1, lam * 2);
  }
  return { q, iters, ok: cur.eW < tolW && cur.eV < tolV, eW: cur.eW, eV: cur.eV };
}

// ---------- dynamics ----------
// Recursive Newton-Euler (RBE 501 L18). Ftip is the wrench the tool applies to the
// environment, in the tool frame. g is the gravity magnitude along -z of {0}.
export function rnea(q, qd, qdd, g = GRAV, Ftip = [0,0,0,0,0,0]) {
  const Ti = new Array(N), V = new Array(N), Vd = new Array(N);
  let Vprev = [0,0,0,0,0,0], Vdprev = [0,0,0,0,0,g];   // Vdot_0 = [0; -gvec], gvec = [0,0,-g]
  for (let i = 0; i < N; i++) {
    const Ai = A[i];
    Ti[i] = mul4(expS(Ai.map(x => -x), q[i]), Mrel[i]);  // T_{i,i-1}
    const AdT = Ad(Ti[i]);
    const Vi = matVec(AdT, Vprev).map((x, k) => x + Ai[k] * qd[i]);
    const adA = matVec(adV(Vi), Ai);
    const Vdi = matVec(AdT, Vdprev).map((x, k) => x + adA[k] * qd[i] + Ai[k] * qdd[i]);
    V[i] = Vi; Vd[i] = Vdi; Vprev = Vi; Vdprev = Vdi;
  }
  const tau = new Array(N);
  const Mtip = mul4(inv4(M_tool), M_com[N - 1]);          // T_{N+1,N}: {N} expressed relative to the tool
  let F = Ftip, Tnext = Mtip;
  for (let i = N - 1; i >= 0; i--) {
    const GV = matVec(G[i], V[i]);
    const adT = transpose(adV(V[i]));
    const term = matVec(transpose(Ad(Tnext)), F);
    const GVd = matVec(G[i], Vd[i]);
    const adGV = matVec(adT, GV);
    F = term.map((x, k) => x + GVd[k] - adGV[k]);
    tau[i] = F.reduce((s, x, k) => s + x * A[i][k], 0);
    Tnext = Ti[i];
  }
  return tau;
}
export const gravityTorque = (q) => rnea(q, [0,0,0,0,0,0], [0,0,0,0,0,0]);
export const biasTorque = (q, qd) => rnea(q, qd, [0,0,0,0,0,0]);   // h = c + g
export function massMatrix(q) {
  const z = [0,0,0,0,0,0], cols = [];
  for (let j = 0; j < N; j++) { const e = [...z]; e[j] = 1; cols.push(rnea(q, z, e, 0)); }
  return transpose(cols);
}
// Forward dynamics (RBE 501 L20): qdd = M^-1 (tau + J_s^T F_ext - h)
export function forwardDynamics(q, qd, tau, Fext_s = null) {
  const Mq = massMatrix(q), h = biasTorque(q, qd);
  const rhs = tau.map((t, i) => t - h[i]);
  if (Fext_s) {
    const Js = jacobianSpace(q);
    for (let i = 0; i < N; i++) for (let r = 0; r < 6; r++) rhs[i] += Js[r][i] * Fext_s[r];
  }
  return solve(Mq, rhs);
}
// Kinetic + potential energy (for the energy check)
export function energy(q, qd) {
  const Mq = massMatrix(q);
  const K = 0.5 * qd.reduce((s, a, i) => s + a * Mq[i].reduce((t, b, j) => t + b * qd[j], 0), 0);
  const kin = fk(q);
  let P = 0;
  for (let i = 0; i < N; i++) {
    const c = matVec(kin.links[i], [...LINKS[i].com, 1]);
    P += LINKS[i].m * GRAV * c[2];
  }
  return { K, P, E: K + P };
}

// ---------- collision geometry ----------
// Capsules in world for configuration q (link 0 = fixed base).
export function capsulesWorld(q, kin = fk(q)) {
  return CAPSULES.map(c => {
    const T = c.link === 0 ? I4() : kin.links[c.link - 1];
    return { a: matVec(T, [...c.a, 1]).slice(0, 3), b: matVec(T, [...c.b, 1]).slice(0, 3), r: c.r, link: c.link };
  });
}
export function segPointDist(a, b, p) {
  const ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], ap = [p[0]-a[0], p[1]-a[1], p[2]-a[2]];
  const L = ab[0]*ab[0] + ab[1]*ab[1] + ab[2]*ab[2];
  let t = L > 0 ? (ab[0]*ap[0] + ab[1]*ap[1] + ab[2]*ap[2]) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + t*ab[0] - p[0], a[1] + t*ab[1] - p[1], a[2] + t*ab[2] - p[2]);
}
// true if configuration q collides with any sphere {c, r} or with the floor (z < 0) for links 2..6
export function inCollision(q, spheres, margin = 0.01) {
  const caps = capsulesWorld(q);
  for (const c of caps) {
    if (c.link >= 2 && Math.min(c.a[2], c.b[2]) - c.r < 0) return true;
    for (const s of spheres) if (segPointDist(c.a, c.b, s.c) < c.r + s.r + margin) return true;
  }
  return false;
}

// ---------- fast path for simulation ----------
// Same recursion as rnea(), written with 3-vectors so the 1 kHz RK4 loop runs in real time.
// Returns M(q) and h(q, qd) = c + g together, sharing the link transforms.
const Gm = G.map((g, i) => ({ I: [g[0].slice(0, 3), g[1].slice(0, 3), g[2].slice(0, 3)], m: LINKS[i].m }));
const Mtip0 = mul4(inv4(M_tool), M_com[N - 1]);
const Rp = T => ({ R: [T[0][0],T[0][1],T[0][2],T[1][0],T[1][1],T[1][2],T[2][0],T[2][1],T[2][2]], p: [T[0][3],T[1][3],T[2][3]] });
const TipRp = Rp(Mtip0);
const cr = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const Rv = (R, x) => [R[0]*x[0]+R[1]*x[1]+R[2]*x[2], R[3]*x[0]+R[4]*x[1]+R[5]*x[2], R[6]*x[0]+R[7]*x[1]+R[8]*x[2]];
const RTv = (R, x) => [R[0]*x[0]+R[3]*x[1]+R[6]*x[2], R[1]*x[0]+R[4]*x[1]+R[7]*x[2], R[2]*x[0]+R[5]*x[1]+R[8]*x[2]];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sc = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
function AdApply(T, w, v) { const Rw = Rv(T.R, w); return [Rw, add(cr(T.p, Rw), Rv(T.R, v))]; }
function AdTApply(T, m, f) { return [RTv(T.R, [m[0], m[1], m[2]].map((x, k) => x - cr(T.p, f)[k])), RTv(T.R, f)]; }
const Aw = A.map(a => a.slice(0, 3)), Av = A.map(a => a.slice(3));
function linkTransforms(q) { return q.map((qi, i) => Rp(mul4(expS(A[i].map(x => -x), qi), Mrel[i]))); }
// Generic recursion on precomputed transforms. Returns tau.
function rneaT(T, qd, qdd, g, withVel) {
  const Vw = [], Vv = [], Dw = [], Dv = [];
  let pw = [0,0,0], pv = [0,0,0], dw = [0,0,0], dv = [0,0,g];
  for (let i = 0; i < N; i++) {
    let [w, v] = AdApply(T[i], pw, pv);
    if (withVel) { w = add(w, sc(Aw[i], qd[i])); v = add(v, sc(Av[i], qd[i])); }
    let [aw, av] = AdApply(T[i], dw, dv);
    if (withVel) { // + ad_{V_i} A_i qd_i
      aw = add(aw, sc(cr(w, Aw[i]), qd[i]));
      av = add(av, sc(add(cr(v, Aw[i]), cr(w, Av[i])), qd[i]));
    }
    aw = add(aw, sc(Aw[i], qdd[i])); av = add(av, sc(Av[i], qdd[i]));
    Vw.push(w); Vv.push(v); Dw.push(aw); Dv.push(av);
    pw = w; pv = v; dw = aw; dv = av;
  }
  const tau = new Array(N);
  let m = [0,0,0], f = [0,0,0], Tn = TipRp;
  for (let i = N - 1; i >= 0; i--) {
    const [m1, f1] = AdTApply(Tn, m, f);
    const I = Gm[i].I, M = Gm[i].m;
    const Iw = [0,1,2].map(r => I[r][0]*Dw[i][0] + I[r][1]*Dw[i][1] + I[r][2]*Dw[i][2]);
    let mm = add(m1, Iw), ff = add(f1, sc(Dv[i], M));
    if (withVel) { // - ad^T_{V}(G V) = + [w x (I w) + v x (m v) ; w x (m v)]
      const w = Vw[i], v = Vv[i];
      const Iw2 = [0,1,2].map(r => I[r][0]*w[0] + I[r][1]*w[1] + I[r][2]*w[2]);
      const mv = sc(v, M);
      mm = add(mm, add(cr(w, Iw2), cr(v, mv)));
      ff = add(ff, cr(w, mv));
    }
    m = mm; f = ff;
    tau[i] = m[0]*Aw[i][0] + m[1]*Aw[i][1] + m[2]*Aw[i][2] + f[0]*Av[i][0] + f[1]*Av[i][1] + f[2]*Av[i][2];
    Tn = T[i];
  }
  return tau;
}
export function dynamicsMh(q, qd, g = GRAV) {
  const T = linkTransforms(q), z = [0,0,0,0,0,0];
  const h = rneaT(T, qd, z, g, true);
  const cols = [];
  for (let j = 0; j < N; j++) { const e = [...z]; e[j] = 1; cols.push(rneaT(T, z, e, 0, false)); }
  return { M: transpose(cols), h };
}
export function rneaFast(q, qd, qdd, g = GRAV) { return rneaT(linkTransforms(q), qd, qdd, g, true); }
export function forwardDynamicsFast(q, qd, tau, tauExt = null) {
  const { M, h } = dynamicsMh(q, qd);
  return solve(M, tau.map((t, i) => t - h[i] + (tauExt ? tauExt[i] : 0)));
}
