// Planning worker: RRT-Connect, shortcutting and time scaling off the main thread.
// Streams the tool-tip traces of both trees while they grow. Runs as a browser
// module worker or as a node worker_threads worker (for the tests).
import { rrtConnect, shortcut, timeParameterize, mulberry32 } from './planner.js';
import { fk } from './robot.js';

const tip = q => { const T = fk(q).T; return [T[0][3], T[1][3], T[2][3]]; };
let post;

function handle(m) {
  const t0 = Date.now();
  const rng = m.seed != null ? mulberry32(m.seed) : Math.random;
  let a = [], b = [], last = t0;
  const flush = () => { if (a.length || b.length) post({ id: m.id, type: 'progress', a, b, nodes: stats.nodes, ms: Date.now() - t0 }); a = []; b = []; last = Date.now(); };
  const stats = {};
  const onEdge = (fromStart, qp, qc) => {
    (fromStart ? a : b).push(...tip(qp), ...tip(qc));
    if (Date.now() - last > 40) flush();
  };
  const raw = rrtConnect(m.qs, m.qg, m.spheres, { rng, timeBudgetMs: m.budgetMs ?? 3000, maxIter: 1e6, onEdge, stats });
  flush();
  if (!raw) { post({ id: m.id, type: 'fail', reason: stats.reason, nodes: stats.nodes, ms: Date.now() - t0 }); return; }
  const tRaw = Date.now() - t0;
  const path = shortcut(raw, m.spheres, { rng, iters: 120 });
  const traj = timeParameterize(path);
  post({ id: m.id, type: 'done', raw, path, traj, nodes: stats.nodes, msSearch: tRaw, ms: Date.now() - t0 });
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof process === 'undefined') {
  post = msg => self.postMessage(msg);
  self.onmessage = e => handle(e.data);
} else {
  const { parentPort } = await import('node:worker_threads');
  post = msg => parentPort.postMessage(msg);
  parentPort.on('message', handle);
}
