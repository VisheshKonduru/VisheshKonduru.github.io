// OpenManipulator-X kinematics. All values from ROBOTIS open_manipulator_x_arm.urdf.xacro.
// Frame: ROS convention, metres, z up, x forward. All joint rpy are zero in the URDF.
export const URDF = {
  j1: { xyz: [0.012, 0, 0], axis: [0, 0, 1], lower: -Math.PI, upper: Math.PI },
  j2: { xyz: [0, 0, 0.0595], axis: [0, 1, 0], lower: -1.5, upper: 1.5 },
  j3: { xyz: [0.024, 0, 0.128], axis: [0, 1, 0], lower: -1.5, upper: 1.4 },
  j4: { xyz: [0.124, 0, 0], axis: [0, 1, 0], lower: -1.7, upper: 1.97 },
  ee: { xyz: [0.126, 0, 0] },
  gripper: { xyz: [0.0817, 0.021, 0], lower: -0.011, upper: 0.02 },
};
export const LIMITS = [URDF.j1, URDF.j2, URDF.j3, URDF.j4].map(j => [j.lower, j.upper]);

const L1 = Math.hypot(URDF.j3.xyz[0], URDF.j3.xyz[2]);      // 0.13023 m
const ELBOW_OFFSET = Math.atan2(URDF.j3.xyz[2], URDF.j3.xyz[0]); // elevation of link at q2=0 (79.38 deg)
const L2 = URDF.j4.xyz[0];
const L3 = URDF.ee.xyz[0];
const BASE_X = URDF.j1.xyz[0];
const SHOULDER_Z = URDF.j2.xyz[2];

// Rotation about +y by q maps (x,z) -> (x cos q + z sin q, -x sin q + z cos q).
// Forward kinematics, chained exactly as the URDF. Returns {p:[x,y,z], pitch} (pitch: down positive).
export function fk(q) {
  const [q1, q2, q3, q4] = q;
  let r = 0, z = SHOULDER_Z, a = 0;
  const step = (dx, dz) => { r += dx * Math.cos(a) + dz * Math.sin(a); z += -dx * Math.sin(a) + dz * Math.cos(a); };
  a = q2; step(URDF.j3.xyz[0], URDF.j3.xyz[2]);
  a += q3; step(L2, 0);
  a += q4; step(L3, 0);
  const dir = [Math.cos(a) * Math.cos(q1), Math.cos(a) * Math.sin(q1), -Math.sin(a)];
  return { p: [BASE_X + r * Math.cos(q1), r * Math.sin(q1), z], pitch: a, dir };
}

const within = (q) => q.every((v, i) => v >= LIMITS[i][0] - 1e-9 && v <= LIMITS[i][1] + 1e-9);
const clampQ = (q) => q.map((v, i) => Math.min(LIMITS[i][1], Math.max(LIMITS[i][0], v)));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Geometric IK. target [x,y,z] in base frame, pitch = gripper angle below horizontal (rad).
// Returns {q, reachable, note}. If unreachable, q is a clamped, limit-respecting nearest pose.
export function ik(target, pitch, prev) {
  const [x, y, z] = target;
  const dx = x - BASE_X;
  const rT = Math.hypot(dx, y);
  const yaw = rT < 1e-9 ? (prev ? prev[0] : 0) : Math.atan2(y, dx);
  let note = '';
  const cands = [];
  // Two base-yaw branches (facing the target, or facing away and reaching back over the top),
  // each with elbow-up and elbow-down solutions of the planar 2-link problem.
  for (const [q1, rTarget, pit] of [[yaw, rT, pitch], [wrap(yaw + Math.PI), -rT, Math.PI - pitch]]) {
    // Wrist (joint 4) position in the arm plane, relative to joint 2.
    const wr = rTarget - L3 * Math.cos(pit);
    const wz = z - SHOULDER_Z + L3 * Math.sin(pit);
    const D = Math.hypot(wr, wz);
    let Dc = D, exact = true;
    const Dmax = L1 + L2, Dmin = Math.abs(L1 - L2);
    if (D > Dmax) { exact = false; note = 'Out of reach'; Dc = Dmax - 1e-9; }
    if (D < Dmin) { exact = false; note = 'Too close to base'; Dc = Dmin + 1e-9; }
    const s = D > 1e-12 ? Dc / D : 1;
    const r = wr * s, h = wz * s;
    const cosB = (Dc * Dc - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    const B = Math.acos(Math.max(-1, Math.min(1, cosB)));
    for (const beta of [-B, B]) {            // -B: elbow up
      const aA = Math.atan2(h, r) - Math.atan2(L2 * Math.sin(beta), L1 + L2 * Math.cos(beta));
      const q2 = wrap(ELBOW_OFFSET - aA);
      const q3 = wrap(-(aA + beta) - q2);
      const q4 = wrap(pit - q2 - q3);
      const c = [q1, q2, q3, q4]; c.exact = exact; cands.push(c);
    }
  }
  // Prefer the solution closest to the previous pose (smooth live dragging), else the first valid.
  const valid = cands.filter(c => c.exact && within(c));
  if (prev) valid.sort((a, b) => jd(a, prev) - jd(b, prev));
  if (valid[0]) return { q: [...valid[0]], reachable: true, note: '' };
  // Violates joint limits: clamp each candidate, pick the one whose FK lands nearest the target.
  let best = null, bestErr = Infinity;
  for (const c of cands) {
    const qc = clampQ([...c]);
    const e = dist(fk(qc).p, target);
    if (e < bestErr) { bestErr = e; best = qc; }
  }
  return { q: best, reachable: false, note: note || 'Joint limit' };
}

const jd = (a, b) => a.reduce((t, v, i) => t + Math.abs(v - b[i]), 0);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export { within, clampQ };
