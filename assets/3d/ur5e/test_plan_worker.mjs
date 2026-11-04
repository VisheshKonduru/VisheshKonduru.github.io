// node assets/3d/ur5e/test_plan_worker.mjs
// Runs the real plan-worker.js in a worker thread, as the page does with a Web Worker.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import * as R from './robot.js';
import * as P from './planner.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const A = [-1.1, -1.75, 1.85, -1.67, -1.57, 0], B = [1.1, -1.75, 1.85, -1.67, -1.57, 0];

function run(req) {
  return new Promise(res => {
    const w = new Worker(fileURLToPath(new URL('./plan-worker.js', import.meta.url)));
    let progress = 0, edgesA = 0, edgesB = 0, ticks = 0;
    const iv = setInterval(() => ticks++, 10);   // main thread must keep running while the worker plans
    const t0 = Date.now();
    w.on('message', m => {
      if (m.type === 'progress') { progress++; edgesA += m.a.length / 6; edgesB += m.b.length / 6; return; }
      clearInterval(iv); w.terminate();
      res({ ...m, progress, edgesA, edgesB, ticks, wall: Date.now() - t0 });
    });
    w.postMessage({ id: 1, ...req });
  });
}

// 1. A path around a sphere that blocks the straight joint-space line
{
  const spheres = [{ c: [-0.45, 0, 0.3], r: 0.09 }];
  ok(!P.edgeFree(A, B, spheres), 'test setup: the straight joint-space path A to B is blocked');
  const m = await run({ qs: A, qg: B, spheres, budgetMs: 3000, seed: 7 });
  ok(m.type === 'done', `worker found a path (${m.nodes} nodes, ${m.ms} ms)`);
  ok(m.edgesA > 0 && m.edgesB > 0, `worker streamed both trees (${m.edgesA} and ${m.edgesB} edges in ${m.progress} messages)`);
  ok(P.pathFree(m.path, spheres) && P.pathFree(m.raw, spheres), `raw (${m.raw.length}) and shortcut (${m.path.length}) paths are collision free`);
  let dense = true;
  for (let t = 0; t <= m.traj.duration; t += 0.002) if (R.inCollision(P.sampleTraj(m.traj, t).q, spheres, 0)) dense = false;
  ok(dense, `time-scaled trajectory collision free at 2 ms steps (${m.traj.duration.toFixed(2)} s)`);
  const d0 = Math.hypot(...m.path[0].map((x, i) => x - A[i])), d1 = Math.hypot(...m.path[m.path.length - 1].map((x, i) => x - B[i]));
  ok(d0 < 1e-12 && d1 < 1e-12, 'path starts at the start and ends at the goal');
}
// 2. No path: goal pose inside a sphere
{
  const T = R.fk(B).T;
  const m = await run({ qs: A, qg: B, spheres: [{ c: [T[0][3], T[1][3], T[2][3]], r: 0.1 }], budgetMs: 3000 });
  ok(m.type === 'fail' && m.reason === 'goal', `goal in collision reported as such (${m.type}, ${m.reason}, ${m.wall} ms)`);
}
// 3. No path: start pose inside a sphere
{
  const T = R.fk(A).T;
  const m = await run({ qs: A, qg: B, spheres: [{ c: [T[0][3], T[1][3], T[2][3]], r: 0.1 }], budgetMs: 3000 });
  ok(m.type === 'fail' && m.reason === 'start', `start in collision reported as such (${m.reason})`);
}
// 4. No path within the budget: the tool is walled in by spheres around the goal; the worker gives up on time
{
  const T = R.fk(B).T, c = [T[0][3], T[1][3], T[2][3]];
  const spheres = [];
  for (const dx of [-0.22, 0, 0.22]) for (const dy of [-0.22, 0, 0.22]) for (const dz of [-0.22, 0, 0.22])
    if (dx || dy || dz) spheres.push({ c: [c[0] + dx, c[1] + dy, c[2] + dz], r: 0.13 });
  const free = spheres.filter(s => !R.inCollision(B, [s]) && !R.inCollision(A, [s]));
  const budget = 600;
  const m = await run({ qs: A, qg: B, spheres: free, budgetMs: budget });
  ok(m.type === 'fail' ? m.reason === 'time' || m.reason === 'goal' : P.pathFree(m.path, free),
    `walled-in goal: ${m.type}${m.reason ? ' (' + m.reason + ')' : ''} after ${m.wall} ms`);
  ok(m.wall < budget + 1500, `worker respects its time budget (${m.wall} ms for a ${budget} ms budget)`);
  ok(m.ticks > (m.wall / 10) * 0.5, `main thread stayed responsive while planning (${m.ticks} timer ticks in ${m.wall} ms)`);
}
// 5. Budget too short to finish: clean 'time' failure, no exception
{
  const m = await run({ qs: A, qg: B, spheres: [{ c: [-0.45, 0, 0.3], r: 0.09 }], budgetMs: 1 });
  ok(m.type === 'fail' && m.reason === 'time', `1 ms budget ends in a clean 'no path in time' result (${m.reason}, ${m.nodes} nodes)`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
