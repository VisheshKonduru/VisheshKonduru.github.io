// Closed-loop forward-dynamics simulation of the UR5e.
// Plant: qdd = M(q)^-1 (tau + J_s^T F_ext - c(q,qd) - g(q)), integrated with RK4 at 1 kHz.
// Controllers (RBE 502): PD, PD + gravity compensation, computed torque (feedback linearization).
// Commanded torque is saturated at the UR5e max_effort values.

import { N, dynamicsMh, rneaFast, forwardDynamicsFast, solve } from './robot.js';
import { TAU_MAX } from './ur5e-model.js';

export const DT = 0.001;
export const CONTROLLERS = {
  pd: 'PD',
  pdg: 'PD + gravity compensation',
  ct: 'Computed torque',
};
// Joint-space gains. PD gains are set per joint from the diagonal of M(q) at a nominal
// pose, Kp_i = wn^2 M_ii, Kd_i = 2 zeta wn M_ii (wn = 25 rad/s, zeta = 1), so every joint gets the
// same nominal bandwidth. Computed torque uses wn = 20 rad/s on the linearized error dynamics.
export const Q_NOMINAL = [0, -1.57, 1.57, -1.57, -1.57, 0];
const Mii = dynamicsMh(Q_NOMINAL, [0,0,0,0,0,0]).M.map((r, i) => r[i]);
const WN = 25;
export const GAINS = {
  pd:  { Kp: Mii.map(m => WN * WN * m), Kd: Mii.map(m => 2 * WN * m) },
  pdg: { Kp: Mii.map(m => WN * WN * m), Kd: Mii.map(m => 2 * WN * m) },
  ct:  { Kp: Array(6).fill(400), Kd: Array(6).fill(40) },
};

// Returns the saturated torque and its parts before saturation:
// grav = gravity term g(q) (PD + g, computed torque), ff = model feedforward M qdd_d + C qd
// (computed torque only; for CT this is M(q) qdd_d + h - g), fb = feedback (gains on the error).
export function controlTorqueParts(kind, q, qd, ref) {
  const { Kp, Kd } = GAINS[kind];
  const e = ref.q.map((x, i) => x - q[i]), ed = ref.qd.map((x, i) => x - qd[i]);
  const z = [0,0,0,0,0,0];
  let grav = z, ff = z, fb;
  if (kind === 'ct') {
    const { M: Mq, h } = dynamicsMh(q, qd);
    grav = rneaFast(q, z, z);
    const Mv = v => Mq.map(r => r.reduce((s, m, j) => s + m * v[j], 0));
    const a = Mv(ref.qdd);
    ff = a.map((x, i) => x + h[i] - grav[i]);
    fb = Mv(e.map((x, i) => Kp[i] * x + Kd[i] * ed[i]));
  } else {
    fb = e.map((x, i) => Kp[i] * x + Kd[i] * ed[i]);
    if (kind === 'pdg') grav = rneaFast(q, z, z);
  }
  const raw = fb.map((x, i) => x + grav[i] + ff[i]);
  const tau = raw.map((t, i) => Math.max(-TAU_MAX[i], Math.min(TAU_MAX[i], t)));
  return { tau, grav, ff, fb, saturated: raw.some((t, i) => Math.abs(t) > TAU_MAX[i]) };
}
export const controlTorque = (kind, q, qd, ref) => controlTorqueParts(kind, q, qd, ref).tau;

// One RK4 step of the plant with torque held constant over the step (zero-order hold).
// tauExt = J_s^T F_ext for a disturbance wrench, held over the step.
export function rk4Step(q, qd, tau, tauExt, dt = DT) {
  const f = (q_, qd_) => forwardDynamicsFast(q_, qd_, tau, tauExt);
  const k1v = qd, k1a = f(q, qd);
  const q2 = q.map((x, i) => x + 0.5 * dt * k1v[i]), v2 = qd.map((x, i) => x + 0.5 * dt * k1a[i]);
  const k2a = f(q2, v2);
  const q3 = q.map((x, i) => x + 0.5 * dt * v2[i]), v3 = qd.map((x, i) => x + 0.5 * dt * k2a[i]);
  const k3a = f(q3, v3);
  const q4 = q.map((x, i) => x + dt * v3[i]), v4 = qd.map((x, i) => x + dt * k3a[i]);
  const k4a = f(q4, v4);
  return {
    q: q.map((x, i) => x + dt / 6 * (k1v[i] + 2 * v2[i] + 2 * v3[i] + v4[i])),
    qd: qd.map((x, i) => x + dt / 6 * (k1a[i] + 2 * k2a[i] + 2 * k3a[i] + k4a[i])),
  };
}
export { solve, N };
