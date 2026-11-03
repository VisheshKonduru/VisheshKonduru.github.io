// UR5e dynamics and control demo. Mounts into every element with [data-ur5e3d].
// Everything shown is computed live in robot.js / sim.js / planner.js (planning runs in plan-worker.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as R from './robot.js';
import * as P from './planner.js';
import { DT, CONTROLLERS, controlTorqueParts, rk4Step, Q_NOMINAL } from './sim.js';
import { TAU_MAX, QD_MAX } from './ur5e-model.js';
import { css, timePlot, torqueBars, quinticPlot, JOINT_COLORS_LIGHT, JOINT_COLORS_DARK } from './plots.js';

const BASE = new URL('.', import.meta.url).href;
const DEG = 180 / Math.PI;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const GOAL_START = [-2.0, -1.75, 1.85, -1.67, -1.57, 0];
const PUSH_N = 60, PUSH_S = 0.2;   // applied at the wrist 1 joint, the end of the forearm
const PLAN_BUDGET_MS = 3000;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) e.append(k);
  return e;
}
const fmt = (x, d = 3) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d).replace('-', '−');

export function mount(root) {
  root.classList.add('u5');
  const uid = 'u5' + Math.random().toString(36).slice(2, 7);

  // ---------- DOM ----------
  const view = h('div', { class: 'u5-view', tabindex: '0', role: 'application' });
  const overlay = h('div', { class: 'u5-overlay', 'aria-hidden': 'true' });
  const loading = h('p', { class: 'u5-loading', text: 'Loading the UR5e model' });
  view.append(overlay, loading);

  const bMove = h('button', { type: 'button', 'aria-pressed': 'true', text: 'Drag the tool' });
  const bPlan = h('button', { type: 'button', 'aria-pressed': 'false', text: 'Plan a path' });
  const bGo = h('button', { type: 'button', class: 'u5-go', text: 'Plan and move', hidden: true });
  const sel = h('select', { id: uid + 'c' });
  for (const [k, v] of Object.entries(CONTROLLERS)) sel.append(h('option', { value: k, text: v }));
  sel.value = 'ct';
  const bPush = h('button', { type: 'button', text: 'Push the arm' });
  const bFrames = h('button', { type: 'button', 'aria-pressed': 'false', text: 'Show frames' });
  const sep = () => h('span', { class: 'u5-sep', 'aria-hidden': 'true' });
  const line = h('div', { class: 'u5-line' }, bMove, bPlan, bGo, sep(),
    h('label', { for: uid + 'c', text: 'Controller' }), sel, sep(), bPush, bFrames);
  const status = h('p', { class: 'u5-status', role: 'status', 'aria-live': 'polite' });

  const plotBox = (title, cls = '') => {
    const c = h('canvas', { class: 'u5-plot ' + cls, 'aria-hidden': 'true' });
    const cap = h('p', { class: 'u5-cap' });
    const fig = h('figure', { class: 'u5-fig' }, h('p', { class: 'u5-title', html: title }), c, cap);
    return { c, cap, fig };
  };
  const pTau = plotBox('Joint torque <i>τ</i><sub>i</sub> against the UR5e limit (N&nbsp;m)', 'u5-tall');
  const pErr = plotBox('Tracking error ‖<i>q</i><sub>d</sub> − <i>q</i>‖ (deg)');
  const pMu = plotBox('Manipulability <i>μ</i><sub>3</sub> = √det(<i>J</i><sub>v</sub><i>J</i><sub>v</sub><sup>T</sup>)');
  const pQ = plotBox('Joint positions <i>q</i> (solid) and reference <i>q</i><sub>d</sub> (dashed), deg');
  const pQd = plotBox('Joint velocities <i>q̇</i> (deg/s), limit ±180');
  const pS = plotBox('Quintic time scaling of the current segment');
  const plots = h('div', { class: 'u5-plots' }, pTau.fig, pErr.fig, pMu.fig, pQ.fig, pQd.fig, pS.fig);

  const mT = h('table', { class: 'u5-mat' }), mJ = h('table', { class: 'u5-mat' });
  const math = h('div', { class: 'u5-math' },
    h('div', {}, h('p', { class: 'u5-title', html: 'Forward kinematics, <i>T</i>(<i>θ</i>) = <i>e</i><sup>[<i>S</i><sub>1</sub>]<i>θ</i><sub>1</sub></sup> ⋯ <i>e</i><sup>[<i>S</i><sub>6</sub>]<i>θ</i><sub>6</sub></sup><i>M</i>, metres' }), mT),
    h('div', {}, h('p', { class: 'u5-title', html: 'Space Jacobian <i>J</i><sub>s</sub>(<i>θ</i>); column <i>i</i> is the screw axis <i>S</i><sub>i</sub> in the current pose' }), mJ));
  const simNote = h('p', { class: 'u5-cap' });
  root.append(view, line, status, plots, math, simNote);

  // ---------- state ----------
  const kin0 = R.fk(Q_NOMINAL);
  const st = {
    mode: 'move', ctrl: 'ct', frames: false,
    q: [...Q_NOMINAL], qd: [0,0,0,0,0,0], parts: null, qdd: [0,0,0,0,0,0],
    ref: { q: [...Q_NOMINAL], qd: [0,0,0,0,0,0], qdd: [0,0,0,0,0,0] },
    qik: [...Q_NOMINAL], ik: null, target: [kin0.T[0][3], kin0.T[1][3], kin0.T[2][3]],
    targetR: kin0.T.slice(0, 3).map(r => r.slice(0, 3)),
    push: 0, pushShow: 0, pushF: [0,0,0],
    phase: 'idle', traj: null, tTraj: 0, goalQ: [...GOAL_START], goalTip: null, hold: [...Q_NOMINAL],
    planId: 0, showUntil: 0, lastPlan: null,
    obstacles: [{ c: [-0.36, 0.31, 0.47], r: 0.1 }, { c: [-0.45, 0, 0.3], r: 0.08 }],   // the first blocks the straight joint-space line to the first goal
    simTime: 0, hist: { t: [], e: [], mu: [], q: [[],[],[],[],[],[]], qr: [[],[],[],[],[],[]], qd: [[],[],[],[],[],[]] },
    marks: [{ t: 0, label: CONTROLLERS.ct }], hinted: false, rate: 1,
  };
  { const T = R.fk(st.goalQ).T; st.goalTip = [T[0][3], T[1][3], T[2][3]]; st.goalR = T.slice(0, 3).map(r => r.slice(0, 3)); }

  // ---------- three.js ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  let pixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 1.6, 0.05, 20);
  cam.position.set(1.45, 1.05, 1.35);
  const orbit = new OrbitControls(cam, renderer.domElement);
  orbit.target.set(-0.1, 0.32, 0); orbit.enableDamping = !reduceMotion; orbit.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(2, 4, 3); scene.add(sun);
  const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);   // robot z-up -> three y-up

  const col = {};
  const mats = [];
  const mat = (kind, key, extra = {}) => { const m = new THREE[kind]({ ...extra }); m.userData.key = key; mats.push(m); return m; };
  function readColors() {
    for (const [k, v, fb] of [['ink', '--ink', '#16171a'], ['ink2', '--ink-2', '#3d4047'], ['ink3', '--ink-3', '#5f646c'], ['rule', '--rule', '#dedad2'], ['mark', '--mark', '#0f8b8d'], ['frame', '--frame', '#eeebe4']])
      col[k] = new THREE.Color(css(root, v, fb));
    scene.background = col.frame;
    for (const m of mats) m.color = col[m.userData.key];
  }
  const grid = new THREE.GridHelper(2, 20); grid.rotation.x = Math.PI / 2; world.add(grid);

  // arm and ghost arm (goal pose)
  const links = [...Array(7)].map(() => { const g = new THREE.Group(); g.matrixAutoUpdate = false; world.add(g); return g; });
  const ghost = [...Array(7)].map(() => { const g = new THREE.Group(); g.matrixAutoUpdate = false; g.visible = false; world.add(g); return g; });
  const ghostMat = mat('MeshBasicMaterial', 'ink3', { transparent: true, opacity: 0.22, depthWrite: false });
  new GLTFLoader().load(BASE + 'ur5e.glb', gltf => {
    const parts = []; gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    for (const o of parts) {
      const k = +(/link(\d)/.exec(o.name) || [0, 0])[1];
      o.geometry.computeVertexNormals();
      links[k].add(o);
      ghost[k].add(new THREE.Mesh(o.geometry, ghostMat));
    }
    loading.remove();
  }, undefined, () => { loading.textContent = 'The UR5e model did not load.'; });

  // screw axes S1..S6 as arrows
  const axisMat = mat('MeshBasicMaterial', 'mark'), axisLineMat = mat('LineBasicMaterial', 'mark');
  const cone = new THREE.ConeGeometry(0.012, 0.035, 12); cone.translate(0, -0.0175, 0);
  const axes = [...Array(6)].map(() => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, axisLineMat); const c = new THREE.Mesh(cone, axisMat);
    world.add(l, c); return { l, c };
  });
  // manipulability ellipsoid: translucent neutral surface plus its three principal axes
  const ellMat = mat('MeshBasicMaterial', 'ink3', { transparent: true, opacity: 0.13, depthWrite: false });
  const ell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), ellMat); ell.matrixAutoUpdate = false; world.add(ell);
  const ellAxMat = mat('LineBasicMaterial', 'ink3');
  const ellAx = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3)), ellAxMat); world.add(ellAx);
  // drag handles: solid ink knob, a ring that faces the camera, a large invisible hit sphere
  function handle(key) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.017, 20, 14), mat('MeshBasicMaterial', key)));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.0035, 8, 48), mat('MeshBasicMaterial', key)); g.add(ring);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ visible: false })); g.add(hit);
    g.userData = { ring, hit }; world.add(g); return g;
  }
  const tgt = handle('ink'), goalH = handle('ink2');
  const obsMat = mat('MeshStandardMaterial', 'ink3', { roughness: 0.85 });
  const obsMeshes = st.obstacles.map(o => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), obsMat); m.scale.setScalar(o.r); world.add(m); return m; });
  // RRT-Connect trees (tool-tip traces), raw and shortcut paths
  const MAXF = 240000;
  const tree = key => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAXF), 3)); g.setDrawRange(0, 0); const l = new THREE.LineSegments(g, mat('LineBasicMaterial', key, { transparent: true, opacity: 0.55 })); l.frustumCulled = false; world.add(l); l.userData.n = 0; return l; };
  const treeA = tree('ink3'), treeB = tree('mark');
  const rawLine = new THREE.Line(new THREE.BufferGeometry(), mat('LineDashedMaterial', 'ink2', { dashSize: 0.02, gapSize: 0.015 })); world.add(rawLine);
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), mat('LineBasicMaterial', 'ink')); world.add(pathLine);
  // push arrow
  const pushArrow = new THREE.Group();
  const pushShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 8), mat('MeshBasicMaterial', 'ink'));
  const pushHead = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.045, 12), mat('MeshBasicMaterial', 'ink'));
  pushArrow.add(pushShaft, pushHead); pushArrow.visible = false; world.add(pushArrow);
  // frames: {s} at the base, {b} at the tool, M = home pose of the tool
  const fS = new THREE.AxesHelper(0.15), fB = new THREE.AxesHelper(0.1), fM = new THREE.AxesHelper(0.1);
  fB.matrixAutoUpdate = false; fM.matrixAutoUpdate = false;
  for (const f of [fS, fB, fM]) { f.visible = false; world.add(f); }
  readColors();
  grid.material.color = col.rule; grid.material.vertexColors = false;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); grid.material.color = col.rule; });

  // overlay labels
  const labels = {};
  const label = (key, text, cls = '') => (labels[key] = overlay.appendChild(h('span', { class: 'u5-lab ' + cls, text })));
  for (let i = 1; i <= 6; i++) label('S' + i, '', 'u5-lab-s').innerHTML = `S<sub>${i}</sub>`;
  label('tgt', 'Drag to move the tool', 'u5-lab-hint');
  label('goal', 'Goal: drag to move', 'u5-lab-hint');
  label('obs0', 'Obstacle'); label('obs1', 'Obstacle');
  label('push', `${PUSH_N} N`);
  label('fs', '{s}'); label('fb', '{b}'); label('fm', 'M');
  const v3 = new THREE.Vector3();
  function place(key, p, show = true, dx = 10, dy = -10) {
    const el = labels[key];
    if (!show) { el.style.display = 'none'; return; }
    v3.set(p[0], p[1], p[2]); world.localToWorld(v3); v3.project(cam);
    if (v3.z > 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(${((v3.x + 1) / 2) * view.clientWidth + dx}px, ${((1 - v3.y) / 2) * view.clientHeight + dy}px)`;
  }

  // ---------- dragging ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane();
  let drag = null;
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
  }
  const candidates = () => st.mode === 'move' ? [tgt.userData.hit] : [goalH.userData.hit, ...obsMeshes];
  view.addEventListener('pointerdown', ev => {
    pick(ev);
    const hit = ray.intersectObjects(candidates())[0];
    if (!hit) return;
    const o = hit.object;
    const which = o === tgt.userData.hit ? 'tgt' : o === goalH.userData.hit ? 'goal' : obsMeshes.indexOf(o);
    plane.setFromNormalAndCoplanarPoint(cam.getWorldDirection(new THREE.Vector3()), o.getWorldPosition(new THREE.Vector3()));
    drag = which; orbit.enabled = false; st.hinted = true;
    renderer.domElement.setPointerCapture(ev.pointerId); view.style.cursor = 'grabbing';
    ev.preventDefault(); ev.stopPropagation();
  }, { capture: true });
  renderer.domElement.addEventListener('pointermove', ev => {
    pick(ev);
    if (drag == null) { view.style.cursor = ray.intersectObjects(candidates()).length ? 'grab' : ''; return; }
    const p = ray.ray.intersectPlane(plane, new THREE.Vector3()); if (!p) return;
    const q = world.worldToLocal(p), v = [q.x, q.y, Math.max(0.03, q.z)];
    if (drag === 'tgt') setTarget(v); else if (drag === 'goal') setGoal(v); else moveObstacle(drag, v);
  });
  const endDrag = () => { if (drag != null) { if (drag === 'goal') goalDone(); drag = null; orbit.enabled = true; view.style.cursor = ''; } };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);
  view.addEventListener('keydown', ev => {
    const d = ev.shiftKey ? 0.05 : 0.02;
    const m = { ArrowLeft: [0, d, 0], ArrowRight: [0, -d, 0], ArrowUp: [-d, 0, 0], ArrowDown: [d, 0, 0], PageUp: [0, 0, d], PageDown: [0, 0, -d] }[ev.key];
    if (ev.key === 'Enter' && st.mode === 'plan') { ev.preventDefault(); startPlan(); return; }
    if (!m) return;
    ev.preventDefault(); st.hinted = true;
    if (st.mode === 'move') setTarget(st.target.map((x, i) => x + m[i]));
    else { setGoal(st.goalTip.map((x, i) => x + m[i])); goalDone(); }
  });
  function setTarget(v) {
    const r = Math.hypot(v[0], v[1], v[2] - 0.1625), k = r > 0.95 ? 0.95 / r : 1;
    st.target = [v[0] * k, v[1] * k, 0.1625 + (v[2] - 0.1625) * k];
  }
  function setGoal(v) {
    const Td = [[...st.goalR[0], v[0]], [...st.goalR[1], v[1]], [...st.goalR[2], v[2]], [0,0,0,1]];
    const r = R.ikDLS(st.goalQ, Td, { iters: 60 });
    st.goalTip = v; st.goalQ = r.q; st.goalOk = r.ok;
  }
  function goalDone() {
    const T = R.fk(st.goalQ).T; st.goalTip = [T[0][3], T[1][3], T[2][3]];
    if (!st.goalOk) say('The goal point is out of reach for this tool orientation, so the goal pose is the closest one damped least squares found.');
    else if (R.inCollision(st.goalQ, st.obstacles)) say('The goal pose touches an obstacle. Move the goal or the obstacle.');
    else say('Goal set by inverse kinematics (the faint arm). Press Plan and move.');
  }
  function moveObstacle(i, v) {
    st.obstacles[i].c = v;
    if (st.phase === 'planning') startPlan('An obstacle moved. Planning again.');
    else if (st.phase === 'moving' && !P.pathFree(P.remainingPath(st.traj, st.tTraj), st.obstacles)) startPlan('An obstacle blocked the rest of the path. Holding and planning again from here.');
  }

  // ---------- planning worker ----------
  let worker = null;
  function newWorker() {
    if (worker) worker.terminate();
    worker = new Worker(new URL('./plan-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => onPlan(e.data);
    worker.onerror = () => { st.phase = 'failed'; say('The planner stopped with an error. The arm is holding.'); };
  }
  function clearTrees() { for (const t of [treeA, treeB]) { t.userData.n = 0; t.geometry.setDrawRange(0, 0); } rawLine.visible = pathLine.visible = false; }
  function startPlan(why) {
    st.hold = [...st.q]; st.traj = null; st.phase = 'planning'; st.planId++;
    clearTrees(); newWorker();
    st.planT0 = performance.now();
    say(why || 'Growing two RRT-Connect trees, one from the current pose and one from the goal.');
    worker.postMessage({ id: st.planId, qs: [...st.q], qg: [...st.goalQ], spheres: st.obstacles.map(o => ({ c: [...o.c], r: o.r })), budgetMs: PLAN_BUDGET_MS });
  }
  function appendTree(t, arr) {
    const pos = t.geometry.attributes.position, n = t.userData.n, m = Math.min(arr.length, MAXF - n);
    pos.array.set(arr.slice(0, m), n); t.userData.n = n + m;
    pos.addUpdateRange?.(n, m); pos.needsUpdate = true; t.geometry.setDrawRange(0, t.userData.n / 3);
  }
  const tipLine = (line, qs) => {
    const pts = qs.map(q => { const T = R.fk(q).T; return new THREE.Vector3(T[0][3], T[1][3], T[2][3]); });
    line.geometry.dispose(); line.geometry = new THREE.BufferGeometry().setFromPoints(pts); line.computeLineDistances?.(); line.visible = true;
  };
  function densify(path, n = 12) { const out = [path[0]]; for (let k = 1; k < path.length; k++) for (let i = 1; i <= n; i++) out.push(path[k - 1].map((x, j) => x + (i / n) * (path[k][j] - x))); return out; }
  function onPlan(m) {
    if (m.id !== st.planId) return;
    if (m.type === 'progress') {
      appendTree(treeA, m.a); appendTree(treeB, m.b);
      say(`Growing two RRT-Connect trees: ${m.nodes} joint-space nodes so far (${(m.ms / 1000).toFixed(1)} s of ${PLAN_BUDGET_MS / 1000} s). Each line is the tool tip moving between two nodes.`);
      return;
    }
    if (m.type === 'fail') {
      st.phase = 'failed';
      say(m.reason === 'start' ? 'The arm is touching an obstacle now, so there is no collision-free start. Move the obstacle away.'
        : m.reason === 'goal' ? 'The goal pose touches an obstacle. Move the goal or the obstacle, then press Plan and move.'
        : `No collision-free path found in ${PLAN_BUDGET_MS / 1000} s (${m.nodes} nodes). The arm is holding. Move an obstacle or the goal and try again.`);
      return;
    }
    tipLine(rawLine, densify(m.raw)); tipLine(pathLine, densify(m.path));
    st.lastPlan = m;
    const peak = peakTorque(m.traj);
    st.phase = 'found'; st.pendingTraj = m.traj;
    st.showUntil = performance.now() + (reduceMotion ? 400 : 1600);
    say(`Trees met after ${m.nodes} nodes. Shortcutting cut the path from ${m.raw.length} to ${m.path.length} waypoints (dashed: before, solid: after). Time scaling: ${m.traj.duration.toFixed(1)} s, peak torque ${Math.round(peak * 100)}% of the limit.`);
  }
  function peakTorque(traj) {
    let w = 0;
    for (let t = 0; t <= traj.duration; t += 0.05) { const s = P.sampleTraj(traj, t), tau = R.rneaFast(s.q, s.qd, s.qdd); tau.forEach((x, i) => (w = Math.max(w, Math.abs(x) / TAU_MAX[i]))); }
    return w;
  }

  // ---------- modes and controls ----------
  function setMode(m) {
    st.mode = m;
    bMove.setAttribute('aria-pressed', m === 'move'); bPlan.setAttribute('aria-pressed', m === 'plan'); bGo.hidden = m !== 'plan';
    tgt.visible = m === 'move'; goalH.visible = m === 'plan'; ghost.forEach(g => (g.visible = m === 'plan'));
    obsMeshes.forEach(o => (o.visible = m === 'plan'));
    clearTrees(); if (worker) { worker.terminate(); worker = null; }
    st.traj = null; st.phase = 'idle'; st.hold = [...st.q];
    if (m === 'move') {
      const k = R.fk(st.q).T;
      st.target = [k[0][3], k[1][3], k[2][3]]; st.targetR = k.slice(0, 3).map(r => r.slice(0, 3));
      st.qik = [...st.q]; st.ref = { q: [...st.q], qd: [0,0,0,0,0,0], qdd: [0,0,0,0,0,0] };
      view.setAttribute('aria-label', 'UR5e arm. Drag the ring handle to move the tool. Arrow keys move it across the table; Page Up and Page Down move it up and down.');
      say('Drag the ring at the tool. Inverse kinematics finds the joint angles and the controller drives the simulated arm there.');
    } else {
      view.setAttribute('aria-label', 'UR5e arm with a goal pose and two obstacles. Arrow keys and Page Up or Page Down move the goal; Enter plans and moves.');
      say('The faint arm is the goal. Drag its ring or the grey obstacles, then press Plan and move.');
    }
  }
  bMove.addEventListener('click', () => setMode('move'));
  bPlan.addEventListener('click', () => setMode('plan'));
  bGo.addEventListener('click', () => startPlan());
  sel.addEventListener('change', () => { st.ctrl = sel.value; st.marks.push({ t: st.simTime, label: CONTROLLERS[sel.value] }); });
  bPush.addEventListener('click', () => {
    const d = new THREE.Vector3(); cam.getWorldDirection(d); d.cross(cam.up).normalize();
    const o = world.worldToLocal(new THREE.Vector3()), e = world.worldToLocal(d.clone());
    const f = [e.x - o.x, e.y - o.y, 0], n = Math.hypot(f[0], f[1]) || 1;
    st.pushF = f.map(x => PUSH_N * x / n); st.push = PUSH_S; st.pushShow = PUSH_S + 0.4;
    say(`A ${PUSH_N} N push on the end of the forearm for ${PUSH_S} s. It enters the dynamics as τ = J_sᵀF through joints 1 to 3. Watch the error and torque plots.`);
  });
  bFrames.addEventListener('click', () => { st.frames = !st.frames; bFrames.setAttribute('aria-pressed', st.frames); [fS, fB, fM].forEach(f => (f.visible = st.frames)); });
  let lastSaid = '';
  function say(s) { if (s !== lastSaid) { status.textContent = lastSaid = s; } }

  // ---------- reference ----------
  const Z6 = [0,0,0,0,0,0];
  function referenceMove(dt) {
    const Td = [[...st.targetR[0], st.target[0]], [...st.targetR[1], st.target[1]], [...st.targetR[2], st.target[2]], [0,0,0,1]];
    st.ik = R.ikDLS(st.qik, Td, { iters: 3, lambda: 0.08 }); st.qik = st.ik.q;
    const qd = st.qik.map((x, i) => Math.max(-0.5 * QD_MAX[i], Math.min(0.5 * QD_MAX[i], (x - st.ref.q[i]) / dt)));
    st.ref = { q: st.ref.q.map((x, i) => x + qd[i] * dt), qd, qdd: Z6 };
  }
  function beginMove() {
    st.traj = st.pendingTraj; st.tTraj = 0; st.phase = 'moving'; treeA.geometry.setDrawRange(0, 0); treeB.geometry.setDrawRange(0, 0);
    say(`Moving along the shortcut path with quintic time scaling, ${st.traj.duration.toFixed(1)} s, tracked by the ${CONTROLLERS[st.ctrl]} controller.`);
  }
  function referencePlan(dt) {
    if (st.phase === 'moving') {
      st.tTraj += dt;
      st.ref = P.sampleTraj(st.traj, st.tTraj);
      if (st.tTraj > st.traj.duration + 0.5) {
        st.phase = 'arrived'; st.hold = [...st.ref.q]; st.traj = null;
        say('Arrived at the goal. Drag the goal somewhere else, or move an obstacle, and press Plan and move again.');
      }
      return;
    }
    st.ref = { q: st.hold, qd: Z6, qdd: Z6 };
  }

  // ---------- loop (adaptive) ----------
  let last = performance.now(), running = true, ikTick = 0, msPerStep = 0.4, frameMs = 16, frameN = 0, lastMath = 0, lastSample = -1;
  const io = new IntersectionObserver(es => { const r = es[0].isIntersecting; if (r && !running) { last = performance.now(); requestAnimationFrame(frame); } running = r; });
  io.observe(root);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && running) last = performance.now(); });

  function step() {
    if (st.mode === 'move') { if (ikTick++ % 10 === 0) referenceMove(DT * 10); } else referencePlan(DT);
    const ref = st.ref;
    const parts = controlTorqueParts(st.ctrl, st.q, st.qd, ref);
    let tauExt = null;
    if (st.push > 0) {
      // force f at point p on link 3 (wrist 1 joint origin): wrench F_s = [p x f; f]; only joints 1..3 carry it
      const kin = R.fk(st.q), Js = R.jacobianSpace(st.q, kin), L3 = kin.links[3], p = [L3[0][3], L3[1][3], L3[2][3]], f = st.pushF;
      const Fs = [p[1]*f[2]-p[2]*f[1], p[2]*f[0]-p[0]*f[2], p[0]*f[1]-p[1]*f[0], ...f];
      tauExt = Js[0].map((_, j) => j < 3 ? Js.reduce((s, r, i) => s + r[j] * Fs[i], 0) : 0);
      st.push -= DT;
    }
    const qd0 = st.qd;
    const nx = rk4Step(st.q, st.qd, parts.tau, tauExt);
    st.qdd = nx.qd.map((x, i) => (x - qd0[i]) / DT);
    st.q = nx.q; st.qd = nx.qd; st.parts = parts; st.simTime += DT;
    if (Math.floor(st.simTime * 50) !== lastSample) {          // record at 50 Hz of sim time
      lastSample = Math.floor(st.simTime * 50);
      const H = st.hist; H.t.push(st.simTime);
      H.e.push(Math.hypot(...ref.q.map((x, i) => x - st.q[i])) * DEG);
      for (let i = 0; i < 6; i++) { H.q[i].push(st.q[i] * DEG); H.qr[i].push(ref.q[i] * DEG); H.qd[i].push(st.qd[i] * DEG); }
      if (st.mu != null) H.mu.push(st.mu); else H.mu.push(0);
      if (H.t.length > 700) { H.t.shift(); H.e.shift(); H.mu.shift(); for (let i = 0; i < 6; i++) { H.q[i].shift(); H.qr[i].shift(); H.qd[i].shift(); } }
    }
  }

  function frame(now) {
    if (!running) return;
    const wall = Math.min(0.1, (now - last) / 1000); last = now;
    frameMs = 0.9 * frameMs + 0.1 * wall * 1000; frameN++;
    // Adaptive: physics gets up to 8 ms per frame, or 40% of a slow frame (at most 25 ms). If that is
    // not enough the simulation runs slower than real time; it never takes a larger step than 1 ms.
    const want = Math.round(wall / DT), budget = Math.min(25, Math.max(8, 0.4 * frameMs));
    const steps = Math.max(1, Math.min(want, Math.floor(budget / msPerStep)));
    if (st.phase === 'found' && now > st.showUntil) beginMove();
    const t0 = performance.now();
    for (let k = 0; k < steps; k++) step();
    msPerStep = 0.9 * msPerStep + 0.1 * ((performance.now() - t0) / steps);
    st.rate = 0.95 * st.rate + 0.05 * (want ? steps / want : 1);
    if (frameMs > 34 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); }
    draw3d();
    const slow = frameMs > 30;
    if (!slow || frameN % 3 === 0) drawPlots();
    if (now - lastMath > (slow ? 400 : 120)) { lastMath = now; drawMath(); }
    requestAnimationFrame(frame);
  }

  const m4 = new THREE.Matrix4();
  const setM = (obj, T) => { m4.set(...T[0], ...T[1], ...T[2], ...T[3]); obj.matrix.copy(m4); obj.matrixWorldNeedsUpdate = true; };
  const up = new THREE.Vector3(0, 1, 0);
  function draw3d() {
    const w = view.clientWidth, hh = view.clientHeight;
    if (renderer.domElement.width !== Math.round(w * pixelRatio) || renderer.domElement.height !== Math.round(hh * pixelRatio)) { renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); }
    const kin = R.fk(st.q);
    st.kin = kin;
    setM(links[0], R.I4());
    for (let i = 0; i < 6; i++) setM(links[i + 1], kin.links[i]);
    if (st.mode === 'plan') { const gk = R.fk(st.goalQ); setM(ghost[0], R.I4()); for (let i = 0; i < 6; i++) setM(ghost[i + 1], gk.links[i]); }
    const man = R.manipulability(st.q, kin); st.man = man; st.mu = man.mu;
    // screw axes S_i(theta) = columns of J_s; drawn through the joint origin along omega_i
    for (let i = 0; i < 6; i++) {
      const T = kin.links[i], wv = [man.Js[0][i], man.Js[1][i], man.Js[2][i]], p = [T[0][3], T[1][3], T[2][3]];
      const a0 = p.map((x, k) => x - 0.1 * wv[k]), a1 = p.map((x, k) => x + 0.2 * wv[k]);
      const pos = axes[i].l.geometry.attributes.position; pos.setXYZ(0, ...a0); pos.setXYZ(1, ...a1); pos.needsUpdate = true;
      axes[i].c.position.set(...a1); axes[i].c.quaternion.setFromUnitVectors(up, new THREE.Vector3(...wv));
      place('S' + (i + 1), a1, true, 6, -18);
    }
    const s = 0.25, V = man.vecs, ax = man.axes.map(x => Math.max(x * s, 0.002)), p = [kin.T[0][3], kin.T[1][3], kin.T[2][3]];
    setM(ell, [[V[0][0]*ax[0], V[0][1]*ax[1], V[0][2]*ax[2], p[0]], [V[1][0]*ax[0], V[1][1]*ax[1], V[1][2]*ax[2], p[1]], [V[2][0]*ax[0], V[2][1]*ax[1], V[2][2]*ax[2], p[2]], [0,0,0,1]]);
    const ea = ellAx.geometry.attributes.position;
    for (let k = 0; k < 3; k++) { ea.setXYZ(2*k, p[0]-V[0][k]*ax[k], p[1]-V[1][k]*ax[k], p[2]-V[2][k]*ax[k]); ea.setXYZ(2*k+1, p[0]+V[0][k]*ax[k], p[1]+V[1][k]*ax[k], p[2]+V[2][k]*ax[k]); }
    ea.needsUpdate = true;
    // handles face the camera
    const camLocal = world.worldToLocal(cam.position.clone());
    tgt.position.set(...st.target); goalH.position.set(...st.goalTip);
    for (const g of [tgt, goalH]) g.userData.ring.lookAt(world.localToWorld(camLocal.clone()));
    place('tgt', st.target, st.mode === 'move' && !st.hinted && drag == null, 30, -12);
    place('goal', st.goalTip, st.mode === 'plan' && st.phase !== 'moving', 30, -12);
    st.obstacles.forEach((o, i) => { obsMeshes[i].position.set(...o.c); obsMeshes[i].scale.setScalar(o.r); place('obs' + i, [o.c[0], o.c[1], o.c[2] + o.r], st.mode === 'plan', -28, -26); });
    // push arrow, drawn ending at the wrist 1 joint, length 0.004 m per N
    if (st.pushShow > 0) {
      st.pushShow -= 1 / 60;
      const L3 = kin.links[3], p = [L3[0][3], L3[1][3], L3[2][3]];
      const f = st.pushF, n = Math.hypot(...f), d = f.map(x => x / n), L = n * 0.004;
      const tail = p.map((x, k) => x - d[k] * L);
      const dir = new THREE.Vector3(...d);
      pushShaft.scale.set(1, L - 0.045, 1); pushShaft.position.set(...tail.map((x, k) => x + d[k] * (L - 0.045) / 2)); pushShaft.quaternion.setFromUnitVectors(up, dir);
      pushHead.position.set(...p.map((x, k) => x - d[k] * 0.0225)); pushHead.quaternion.setFromUnitVectors(up, dir);
      pushArrow.visible = true; place('push', tail, true, -10, -24);
    } else { pushArrow.visible = false; place('push', p, false); }
    if (st.frames) { setM(fB, kin.T); setM(fM, R.M_tool); }
    place('fs', [0, 0, 0.02], st.frames, 8, 4); place('fb', p, st.frames, -30, 8);
    place('fm', [R.M_tool[0][3], R.M_tool[1][3], R.M_tool[2][3]], st.frames, 8, 8);
    if (st.mode === 'move' && drag === 'tgt') {
      if (man.invCond < 0.01) say(`Near a singularity: the smallest singular value of J_s is ${(man.invCond * 100).toFixed(2)}% of the largest, and the ellipsoid flattens.`);
      else if (st.ik && st.ik.eV > 0.005) say(`The target is ${(st.ik.eV * 1000).toFixed(0)} mm from where the tool can reach with this orientation; damped least squares settles at the closest pose.`);
      else say('Inverse kinematics by damped least squares, 100 times per second while you drag.');
    }
    orbit.update();
    renderer.render(scene, cam);
  }

  function drawPlots() {
    const JC = dark() ? JOINT_COLORS_DARK : JOINT_COLORS_LIGHT;
    const H = st.hist, tNow = st.simTime;
    const pc = [css(root, '--mark', '#0f8b8d'), css(root, '--ink-3', '#5f646c'), css(root, '--ink-2', '#3d4047')];
    const pr = st.parts;
    if (pr) torqueBars(pTau.c, root, pr.tau.map((t, i) => ({ name: `τ${i + 1}`, limit: TAU_MAX[i], total: t, parts: [{ v: pr.grav[i] }, { v: pr.ff[i] }, { v: pr.fb[i] }] })), pc);
    pTau.cap.innerHTML = `Black tick: applied torque. Bars, top to bottom: <span style="color:${pc[0]}">gravity term <i>g</i>(<i>q</i>)</span>, <span style="color:${pc[1]}">model feedforward <i>M</i><i>q̈</i><sub>d</sub> + <i>C</i><i>q̇</i></span>, <span style="color:${pc[2]}">feedback on the error</span>.${pr && pr.saturated ? ' The command is clipped at the limit right now.' : ''}`;
    timePlot(pErr.c, root, { series: [{ t: H.t, y: H.e, color: css(root, '--ink', '#16171a') }], marks: st.marks, tNow, zero: true });
    pErr.cap.textContent = 'Dotted lines mark a change of controller. PD alone leaves a steady offset under gravity; gravity compensation removes it.';
    timePlot(pMu.c, root, { series: [{ t: H.t, y: H.mu, color: css(root, '--mark', '#0f8b8d') }], tNow, zero: true, yLabel: 'm³/s³ per (rad/s)³' });
    pMu.cap.textContent = `Now ${st.mu != null ? st.mu.toFixed(4) : ''}. It drops toward zero as the arm nears a singularity, where the grey ellipsoid at the tool flattens.`;
    timePlot(pQ.c, root, { series: [...H.q.map((y, i) => ({ t: H.t, y, color: JC[i], label: String(i + 1) })), ...H.qr.map((y, i) => ({ t: H.t, y, color: JC[i], dash: [4, 3], width: 1 }))], tNow });
    pQ.cap.textContent = 'Numbers at the right are joint numbers.';
    timePlot(pQd.c, root, { series: H.qd.map((y, i) => ({ t: H.t, y, color: JC[i], label: String(i + 1) })), tNow, zero: true });
    pQd.cap.textContent = '';
    const show = st.mode === 'plan' && (st.phase === 'moving' || st.phase === 'found' || st.phase === 'arrived');
    pS.fig.hidden = !show;
    if (show) {
      let u = null, k = 0, n = 0;
      if (st.phase === 'moving') { const segs = st.traj.segs; n = segs.length; k = segs.findIndex(s => st.tTraj <= s.t0 + s.T); if (k < 0) k = n - 1; u = Math.min(1, Math.max(0, (st.tTraj - segs[k].t0) / segs[k].T)); }
      quinticPlot(pS.c, root, u, css(root, '--mark', '#0f8b8d'));
      pS.cap.innerHTML = `<i>s</i> = 10<i>τ</i>³ − 15<i>τ</i>⁴ + 6<i>τ</i>⁵ on each path segment${n ? `; segment ${k + 1} of ${n}, ${st.traj.segs[k].T.toFixed(2)} s long` : ''}. Each segment is stretched until speeds and Newton-Euler torques fit the UR5e limits.`;
    }
  }

  const rowsT = ['', '', '', ''], rowsJ = ['<i>ω</i><sub>x</sub>', '<i>ω</i><sub>y</sub>', '<i>ω</i><sub>z</sub>', '<i>v</i><sub>x</sub>', '<i>v</i><sub>y</sub>', '<i>v</i><sub>z</sub>'];
  function matrixHTML(A, rows, head, d) {
    const hd = head ? `<thead><tr><th></th>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead>` : '';
    return hd + '<tbody>' + A.map((r, i) => `<tr><th>${rows[i]}</th>${r.map(x => `<td>${fmt(x, d)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }
  function drawMath() {
    if (!st.kin || !st.man) return;
    mT.innerHTML = matrixHTML(st.kin.T, rowsT, null, 3);
    mJ.innerHTML = matrixHTML(st.man.Js, rowsJ, [1, 2, 3, 4, 5, 6].map(i => `<i>S</i><sub>${i}</sub>`), 3);
    simNote.textContent = `Simulation: fourth-order Runge-Kutta at 1 kHz with the full UR5e dynamics, ${st.rate > 0.95 ? 'in real time' : `at ${st.rate.toFixed(2)} times real time because this device is busy`}.`;
  }

  root.ur5eState = st;   // for inspection from the console and the screenshot script
  setMode(root.dataset.mode === 'plan' ? 'plan' : 'move');
  requestAnimationFrame(frame);
}

document.querySelectorAll('[data-ur5e3d]').forEach(mount);
