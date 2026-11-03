// node assets/3d/turtlebot/test/pf.test.mjs [trials] [limitSeconds]
// Kidnapped-robot trials: random true pose, global init, run the localization behaviour,
// success = filter reports converged AND estimate within 0.25 m / 0.3 rad of truth by the limit.
import { LocWorld } from '../loc.js';
const trials = +(process.argv[2] || 20), limit = +(process.argv[3] || 60), dt = 1 / 30;
let ok = 0, wrong = 0; const times = [];
for (let t = 0; t < trials; t++) {
  const W = new LocWorld(3 + (t % 5)); W.auto = false; W.goal = null;
  W.rand = (() => { let s = 1000 + t; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  W.kidnap();
  let hit = null, falseConv = false;
  for (let time = 0; time < limit; time += dt) {
    W.step(dt);
    if (W.state !== 'localizing') {
      const e = W.estPose(), r = W.robot, de = Math.hypot(e.x - r.x, e.y - r.y), da = Math.abs(Math.atan2(Math.sin(e.th - r.th), Math.cos(e.th - r.th)));
      if (de < 0.25 && da < 0.3) { hit = time; break; } else { if (!falseConv) wrong++; falseConv = true; W.state = 'localizing'; W.spun = 2 * Math.PI; }
    }
  }
  if (hit !== null) { ok++; times.push(hit); }
  console.log(`trial ${t} seed ${W.seed}: ${hit !== null ? 'converged at ' + hit.toFixed(1) + ' s' : 'NOT converged'}, particles ${W.pf.n}, updates ${W.pfUpdates}`);
}
times.sort((a, b) => a - b);
console.log(`success ${ok}/${trials} (${(100 * ok / trials).toFixed(0)}%) within ${limit} s; trials with a false convergence first ${wrong}; median ${times[times.length >> 1]?.toFixed(1)} s`);
process.exit(ok / trials > 0.5 ? 0 : 1); // pass = converges in most trials
