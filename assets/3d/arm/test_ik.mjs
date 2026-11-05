// Run: node test_ik.mjs   (FK/IK round-trip and limit checks)
import { ik, fk, LIMITS, within, dist } from './ik.js';
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const lerp = (a, b, t) => a + (b - a) * t;
let n = 0, maxErr = 0, fails = 0, limitViol = 0, unreach = 0;
for (let i = 0; i < 20000; i++) {
  const q = LIMITS.map(([lo, hi]) => lerp(lo, hi, rnd()));
  const { p, pitch, dir } = fk(q);
  // IK pitch is measured toward the target; flip if this pose reaches back over the top.
  const rr = (p[0] - 0.012) * Math.cos(q[0]) + p[1] * Math.sin(q[0]);
  const s = ik(p, rr < 0 ? Math.PI - pitch : pitch);
  if (!within(s.q)) limitViol++;
  if (!s.reachable) { unreach++; continue; }
  const e = dist(fk(s.q).p, p); n++; maxErr = Math.max(maxErr, e); if (e > 1e-3) fails++;
  // physical gripper direction must match (pitch is relative to the facing direction)
  const pe = Math.hypot(Math.hypot(...dir.slice(0,2)) - Math.hypot(...fk(s.q).dir.slice(0,2)), dir[2] - fk(s.q).dir[2]);
  if (pe > 1e-6) fails++;
}
// Random Cartesian targets with gripper pointing down: limits always respected; reachable ones exact.
let n2 = 0, max2 = 0, f2 = 0, lv2 = 0;
for (let i = 0; i < 20000; i++) {
  const t = [lerp(-0.4, 0.4, rnd()), lerp(-0.4, 0.4, rnd()), lerp(-0.05, 0.45, rnd())];
  const s = ik(t, Math.PI / 2);
  if (!within(s.q)) lv2++;
  if (s.reachable) { n2++; const e = dist(fk(s.q).p, t); max2 = Math.max(max2, e); if (e > 1e-3) f2++; }
}
// URDF home pose FK check: all zeros -> x = 0.012+0.024+0.124+0.126, z = 0.0595+0.128
const h = fk([0, 0, 0, 0]).p, hErr = dist(h, [0.286, 0, 0.1875]);
console.log(`joint-space round trip: ${n} solved, ${unreach} flagged unreachable, max err ${(maxErr*1000).toExponential(2)} mm, fails ${fails}, limit violations ${limitViol}`);
console.log(`cartesian pitch-down: ${n2} reachable, max err ${(max2*1000).toExponential(2)} mm, fails ${f2}, limit violations ${lv2}`);
console.log(`home FK error ${(hErr*1000).toExponential(2)} mm`);
const ok = fails === 0 && limitViol === 0 && f2 === 0 && lv2 === 0 && hErr < 1e-9 && unreach === 0;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
