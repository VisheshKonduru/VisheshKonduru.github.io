// UR5e dynamics and control demo. Mounts into every element with [data-ur5e3d].
// Everything shown is computed live in robot.js / sim.js / planner.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as R from './robot.js';
import * as P from './planner.js';
import { DT, CONTROLLERS, controlTorque, rk4Step, Q_NOMINAL } from './sim.js';
import { TAU_MAX, QD_MAX } from './ur5e-model.js';

const BASE = new URL('.', import.meta.url).href;
const DEG = 180 / Math.PI;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const JNAMES = ['Shoulder pan', 'Shoulder lift', 'Elbow', 'Wrist 1', 'Wrist 2', 'Wrist 3'];
const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;

// Pick-and-place goals for the planning mode (joint space, rad).
const GOAL_A = [-1.1, -1.75, 1.85, -1.67, -1.57, 0];
const GOAL_B = [1.1, -1.75, 1.85, -1.67, -1.57, 0];

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v; else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) e.append(k);
  return e;
}

export function mount(root) {
  root.classList.add('u5');
  const view = h('div', { class: 'u5-view', tabindex: '0', role: 'application',
    'aria-label': 'UR5e arm. Drag the teal ball to move the tool. Arrow keys move it left, right, forward and back; Page Up and Page Down move it up and down.' });
  const loading = h('p', { class: 'u5-loading', text: 'Loading the UR5e model' });
  view.append(loading);

  const bMove = h('button', { type: 'button', 'aria-pressed': 'true', text: 'Move the tool' });
  const bPlan = h('button', { type: 'button', 'aria-pressed': 'false', text: 'Plan around obstacles' });
  const sel = h('select', { 'aria-label': 'Controller' });
  for (const [k, v] of Object.entries(CONTROLLERS)) sel.append(h('option', { value: k, text: v }));
  sel.value = 'ct';
  const selId = 'u5c' + Math.random().toString(36).slice(2, 7); sel.id = selId;
  const bPush = h('button', { type: 'button', text: 'Push' });
  const bDet = h('button', { type: 'button', 'aria-expanded': 'false', text: 'Details' });
  const line = h('div', { class: 'u5-line' }, bMove, bPlan, h('span', { class: 'u5-sep', 'aria-hidden': 'true' }),
    h('label', { for: selId, text: 'Controller' }), sel, h('span', { class: 'u5-sep', 'aria-hidden': 'true' }), bPush, bDet);
  const status = h('p', { class: 'u5-status', role: 'status', 'aria-live': 'polite' });
  const plot = h('canvas', { class: 'u5-plot', 'aria-hidden': 'true' });
  const plotCap = h('p', { class: 'u5-plotcap', text: 'Joint tracking error, norm of q_d minus q in degrees, last 5 s.' });
  const det = h('div', { class: 'u5-details', hidden: true });
  bDet.setAttribute('aria-controls', det.id = selId + 'd');
  root.append(view, line, status, plot, plotCap, det);

  // ---------- state ----------
  const st = {
    mode: 'move', ctrl: 'ct',
    q: [...Q_NOMINAL], qd: [0,0,0,0,0,0], tau: [0,0,0,0,0,0],
    qref: [...Q_NOMINAL], qdref: [0,0,0,0,0,0], qik: [...Q_NOMINAL], ik: null,
    target: null, targetR: null,
    push: 0, pushF: [0,0,0],
    traj: null, tTraj: 0, goal: 1, planInfo: null, hold: 0,
    obstacles: [], err: [], simTime: 0, stepsLastSec: 0, stepCount: 0, lastRate: performance.now(),
  };
  const initKin = R.fk(st.q);
  st.target = [initKin.T[0][3], initKin.T[1][3], initKin.T[2][3]];
  st.targetR = initKin.T.slice(0, 3).map(r => r.slice(0, 3));
  st.obstacles = [
    { c: [-0.45, 0, 0.3], r: 0.09 },   // starts across the straight joint-space path from A to B
    { c: [0.3, -0.4, 0.6], r: 0.07 },
  ];

  // ---------- three.js ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  view.append(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, 1.6, 0.05, 20);
  cam.position.set(1.25, 0.95, 1.15);
  const orbit = new OrbitControls(cam, renderer.domElement);
  orbit.target.set(0, 0.3, 0); orbit.enableDamping = !reduceMotion; orbit.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(2, 4, 3); scene.add(sun);
  const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world); // robot z-up -> three y-up

  const colors = {};
  function readColors() {
    colors.ink = new THREE.Color(css(root, '--ink', '#16171a'));
    colors.ink3 = new THREE.Color(css(root, '--ink-3', '#5f646c'));
    colors.rule = new THREE.Color(css(root, '--rule', '#dedad2'));
    colors.mark = new THREE.Color(css(root, '--mark', '#0f8b8d'));
    colors.frame = new THREE.Color(css(root, '--frame', '#eeebe4'));
    scene.background = colors.frame;
  }
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); restyle(); });

  const grid = new THREE.GridHelper(2, 20, colors.rule, colors.rule); grid.rotation.x = Math.PI / 2; world.add(grid);

  const links = [...Array(7)].map(() => { const g = new THREE.Group(); g.matrixAutoUpdate = false; world.add(g); return g; });
  new GLTFLoader().load(BASE + 'ur5e.glb', gltf => {
    gltf.scene.updateMatrixWorld(true);
    const parts = [];
    gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    for (const o of parts) {
      const k = +(/link(\d)/.exec(o.name) || /link(\d)/.exec(o.parent?.name || '') || [0, 0])[1];
      o.geometry.computeVertexNormals();
      o.material.flatShading = false;
      links[k].add(o);
    }
    loading.remove();
  }, undefined, () => { loading.textContent = 'The UR5e model did not load.'; });

  // screw axes: one line per joint through the joint origin along omega_i
  const axisMat = new THREE.LineBasicMaterial({ color: colors.ink3 });
  const axes = [...Array(6)].map(() => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, axisMat); world.add(l); return l;
  });
  // manipulability ellipsoid (wireframe), tool target, obstacles, plan path
  const ellMat = new THREE.MeshBasicMaterial({ color: colors.mark, wireframe: true });
  const ell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), ellMat); ell.matrixAutoUpdate = false; world.add(ell);
  const tgtMat = new THREE.MeshStandardMaterial({ color: colors.mark, roughness: 0.6 });
  const tgt = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), tgtMat); world.add(tgt);
  const obsMat = new THREE.MeshStandardMaterial({ color: colors.ink3, roughness: 0.8 });
  const obsMeshes = st.obstacles.map(o => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), obsMat); m.scale.setScalar(o.r); world.add(m); return m; });
  const pathMat = new THREE.LineBasicMaterial({ color: colors.ink });
  const pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMat); world.add(pathLine);
  const pushMat = new THREE.LineBasicMaterial({ color: colors.ink });
  const pushLine = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)), pushMat);
  pushLine.visible = false; world.add(pushLine);
  function restyle() {
    axisMat.color = colors.ink3; ellMat.color = colors.mark; tgtMat.color = colors.mark; obsMat.color = colors.ink3;
    pathMat.color = colors.ink; pushMat.color = colors.ink; grid.material.color = colors.rule;
  }

  // ---------- dragging ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane();
  let drag = null;
  const toWorld = v => world.localToWorld(v.clone());
  const toRobot = v => world.worldToLocal(v.clone());
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
  }
  view.addEventListener('pointerdown', ev => {
    pick(ev);
    const cands = st.mode === 'move' ? [tgt] : obsMeshes;
    const hit = ray.intersectObjects(cands)[0];
    if (!hit) return;
    const idx = st.mode === 'move' ? -1 : obsMeshes.indexOf(hit.object);
    const n = cam.getWorldDirection(new THREE.Vector3());
    plane.setFromNormalAndCoplanarPoint(n, hit.object.getWorldPosition(new THREE.Vector3()));
    drag = { idx, id: ev.pointerId }; orbit.enabled = false;
    renderer.domElement.setPointerCapture(ev.pointerId); ev.preventDefault(); ev.stopPropagation();
  }, { capture: true });
  renderer.domElement.addEventListener('pointermove', ev => {
    if (!drag) return;
    pick(ev);
    const p = ray.ray.intersectPlane(plane, new THREE.Vector3()); if (!p) return;
    const q = toRobot(p);
    const v = [q.x, q.y, Math.max(0.02, q.z)];
    if (drag.idx < 0) setTarget(v); else moveObstacle(drag.idx, v);
  });
  const endDrag = () => { if (drag) { drag = null; orbit.enabled = true; } };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);
  view.addEventListener('keydown', ev => {
    const d = ev.shiftKey ? 0.05 : 0.02;
    const m = { ArrowLeft: [0, d, 0], ArrowRight: [0, -d, 0], ArrowUp: [-d, 0, 0], ArrowDown: [d, 0, 0], PageUp: [0, 0, d], PageDown: [0, 0, -d] }[ev.key];
    if (!m) return;
    ev.preventDefault();
    if (st.mode === 'move') setTarget(st.target.map((x, i) => x + m[i]));
    else moveObstacle(0, st.obstacles[0].c.map((x, i) => x + m[i]));
  });
  function setTarget(v) {
    const r = Math.hypot(v[0], v[1], v[2] - 0.1625);
    const k = r > 0.95 ? 0.95 / r : 1;          // UR5e reach is 850 mm; allow a little past it to show the singular stretch
    st.target = [v[0] * k, v[1] * k, 0.1625 + (v[2] - 0.1625) * k];
  }
  function moveObstacle(i, v) { st.obstacles[i].c = v; checkReplan(); }

  // ---------- modes ----------
  function setMode(m) {
    st.mode = m;
    bMove.setAttribute('aria-pressed', m === 'move'); bPlan.setAttribute('aria-pressed', m === 'plan');
    tgt.visible = m === 'move'; obsMeshes.forEach(o => (o.visible = m === 'plan')); pathLine.visible = m === 'plan';
    view.setAttribute('aria-label', m === 'move'
      ? 'UR5e arm. Drag the teal ball to move the tool. Arrow keys move it left, right, forward and back; Page Up and Page Down move it up and down.'
      : 'UR5e arm planning around two spheres. Drag a sphere into the arm\'s way. Arrow keys and Page Up or Page Down move the larger sphere.');
    if (m === 'plan') { st.goal = 1; replan('Planning to the second pose'); }
    else { st.traj = null; const k = R.fk(st.q).T; st.target = [k[0][3], k[1][3], k[2][3]]; st.targetR = k.slice(0, 3).map(r => r.slice(0, 3)); st.qik = [...st.q]; st.qref = [...st.q]; st.qdref = [0,0,0,0,0,0]; say(''); }
  }
  bMove.addEventListener('click', () => setMode('move'));
  bPlan.addEventListener('click', () => setMode('plan'));
  sel.addEventListener('change', () => { st.ctrl = sel.value; st.err.length = 0; });
  bPush.addEventListener('click', () => {
    // 40 N horizontal push at the tool, perpendicular to the view, for 0.2 s
    const d = new THREE.Vector3(); cam.getWorldDirection(d); d.cross(cam.up).normalize();
    const dr = toRobot(toWorld(new THREE.Vector3()).add(d));
    const f = [dr.x, dr.y, 0]; const n = Math.hypot(f[0], f[1]) || 1;
    st.pushF = f.map(x => 40 * x / n); st.push = 0.2;
    say('Push: 40 N at the tool for 0.2 s.');
  });
  bDet.addEventListener('click', () => { const open = det.hidden; det.hidden = !open; bDet.setAttribute('aria-expanded', open); });
  function say(s) { if (status.textContent !== s) status.textContent = s; }

  // ---------- planning ----------
  function replan(why) {
    const goal = st.goal ? GOAL_B : GOAL_A;
    const t0 = performance.now();
    const res = P.plan([...st.q], goal, st.obstacles, { timeBudgetMs: 250 });
    const ms = performance.now() - t0;
    if (!res) { st.traj = null; st.hold = 0.5; st.planInfo = { fail: true, ms }; say(R.inCollision(st.q, st.obstacles) ? 'A sphere is touching the arm. Holding.' : 'No path found in 250 ms. Holding and trying again.'); drawPath(null); return; }
    st.traj = res.traj; st.tTraj = 0;
    st.planInfo = { raw: res.raw.length, smooth: res.path.length, dur: res.traj.duration, ms };
    say(`${why}. Path found in ${Math.round(ms)} ms, ${res.path.length} waypoints after smoothing, ${res.traj.duration.toFixed(1)} s long.`);
    drawPath(res.traj);
  }
  function checkReplan() {
    if (st.mode !== 'plan' || !st.traj) return;
    if (!P.pathFree(P.remainingPath(st.traj, st.tTraj), st.obstacles)) replan('Replanned: a sphere blocked the path');
  }
  function drawPath(traj) {
    if (!traj) { pathLine.geometry.setFromPoints([]); return; }
    const pts = [];
    for (let t = 0; t <= traj.duration; t += traj.duration / 120) {
      const T = R.fk(P.sampleTraj(traj, t).q).T; pts.push(new THREE.Vector3(T[0][3], T[1][3], T[2][3]));
    }
    pathLine.geometry.dispose(); pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  // ---------- reference generation ----------
  function reference(dt) {
    if (st.mode === 'move') {
      // DLS IK from the last solution toward the dragged target, a few iterations per control tick
      const Td = [[...st.targetR[0], st.target[0]], [...st.targetR[1], st.target[1]], [...st.targetR[2], st.target[2]], [0,0,0,1]];
      st.ik = R.ikDLS(st.qik, Td, { iters: 3, lambda: 0.08 });
      st.qik = st.ik.q;
      // rate-limit the reference to half the UR5e joint speed limit
      const qd = st.qik.map((x, i) => Math.max(-0.5 * QD_MAX[i], Math.min(0.5 * QD_MAX[i], (x - st.qref[i]) / dt)));
      st.qref = st.qref.map((x, i) => x + qd[i] * dt); st.qdref = qd;
      return { q: st.qref, qd: st.qdref, qdd: [0,0,0,0,0,0] };
    }
    if (st.traj) {
      st.tTraj += dt;
      const r = P.sampleTraj(st.traj, st.tTraj);
      if (st.tTraj > st.traj.duration + 0.6) { st.goal ^= 1; replan(st.goal ? 'Planning to the second pose' : 'Planning back to the first pose'); }
      return r;
    }
    st.hold -= dt;
    if (st.hold <= 0) { st.hold = 0.5; replan('Retrying'); }
    return { q: st.qref, qd: [0,0,0,0,0,0], qdd: [0,0,0,0,0,0] };
  }

  // ---------- main loop ----------
  let last = performance.now(), ikTick = 0, running = true;
  const io = new IntersectionObserver(es => { running = es[0].isIntersecting; if (running) { last = performance.now(); requestAnimationFrame(frame); } });
  io.observe(root);
  function frame(now) {
    if (!running) return;
    const wall = Math.min(0.05, (now - last) / 1000); last = now;
    // 1 kHz control and RK4 integration; at most 30 steps per frame (the sim slows rather than skipping steps)
    const steps = Math.min(30, Math.round(wall / DT));
    let ref = null;
    for (let k = 0; k < steps; k++) {
      if (st.mode === 'move') {
        if (ikTick++ % 10 === 0) ref = reference(DT * 10);   // IK and reference at 100 Hz
        else ref = { q: st.qref, qd: st.qdref, qdd: [0,0,0,0,0,0] };
      } else ref = reference(DT);
      if (st.mode === 'plan' && !st.traj) st.qref = [...st.q];
      st.tau = controlTorque(st.ctrl, st.q, st.qd, ref);
      let tauExt = null;
      if (st.push > 0) {
        const kin = R.fk(st.q), Js = R.jacobianSpace(st.q, kin), p = [kin.T[0][3], kin.T[1][3], kin.T[2][3]], f = st.pushF;
        const Fs = [p[1]*f[2]-p[2]*f[1], p[2]*f[0]-p[0]*f[2], p[0]*f[1]-p[1]*f[0], ...f];
        tauExt = Js[0].map((_, j) => Js.reduce((s, r, i) => s + r[j] * Fs[i], 0));   // tau = J_s^T F
        st.push -= DT;
      }
      const nx = rk4Step(st.q, st.qd, st.tau, tauExt);
      st.q = nx.q; st.qd = nx.qd; st.simTime += DT; st.stepCount++;
      if (st.stepCount % 20 === 0) {
        st.err.push(Math.hypot(...ref.q.map((x, i) => x - st.q[i])) * DEG);
        if (st.err.length > 250) st.err.shift();
      }
    }
    if (now - st.lastRate > 1000) { st.stepsLastSec = st.stepCount; st.stepCount = 0; st.lastRate = now; }
    if (steps && st.mode === 'plan' && drag) checkReplan();
    draw();
    if (!detHidden()) details();
    requestAnimationFrame(frame);
  }
  const detHidden = () => det.hidden;

  const m4 = new THREE.Matrix4();
  const setM = (obj, T) => { m4.set(...T[0], ...T[1], ...T[2], ...T[3]); obj.matrix.copy(m4); obj.matrixWorldNeedsUpdate = true; };
  function draw() {
    const w = view.clientWidth, hh = view.clientHeight;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); }
    const kin = R.fk(st.q);
    setM(links[0], R.I4());
    for (let i = 0; i < 6; i++) setM(links[i + 1], kin.links[i]);
    const man = R.manipulability(st.q, kin);
    // screw axes S_i at the current configuration: columns of J_s; point = link frame origin
    for (let i = 0; i < 6; i++) {
      const T = kin.links[i], wv = [man.Js[0][i], man.Js[1][i], man.Js[2][i]], p = [T[0][3], T[1][3], T[2][3]];
      const a = axes[i].geometry.attributes.position;
      a.setXYZ(0, p[0] - 0.18 * wv[0], p[1] - 0.18 * wv[1], p[2] - 0.18 * wv[2]);
      a.setXYZ(1, p[0] + 0.18 * wv[0], p[1] + 0.18 * wv[1], p[2] + 0.18 * wv[2]); a.needsUpdate = true;
    }
    // ellipsoid: principal axes = eigenvectors of Jv Jv^T, half-lengths sqrt(eig), drawn at 0.25 m per m/s
    const s = 0.25, V = man.vecs, ax = man.axes.map(x => Math.max(x * s, 0.002));
    setM(ell, [[V[0][0]*ax[0], V[0][1]*ax[1], V[0][2]*ax[2], kin.T[0][3]], [V[1][0]*ax[0], V[1][1]*ax[1], V[1][2]*ax[2], kin.T[1][3]], [V[2][0]*ax[0], V[2][1]*ax[1], V[2][2]*ax[2], kin.T[2][3]], [0,0,0,1]]);
    st.man = man;
    tgt.position.set(...st.target);
    st.obstacles.forEach((o, i) => obsMeshes[i].position.set(...o.c));
    if (st.push > 0) {
      const p = [kin.T[0][3], kin.T[1][3], kin.T[2][3]], f = st.pushF.map(x => x / 160);
      const a = pushLine.geometry.attributes.position; a.setXYZ(0, p[0] - f[0], p[1] - f[1], p[2]); a.setXYZ(1, p[0], p[1], p[2]); a.needsUpdate = true;
      pushLine.visible = true;
    } else pushLine.visible = false;
    if (st.mode === 'move') {
      if (man.invCond < 0.01) say(`Near a singularity: smallest to largest singular value of J_s is ${man.invCond.toFixed(3)}.`);
      else if (status.textContent.startsWith('Near a singularity')) say('');
    }
    orbit.update();
    renderer.render(scene, cam);
    drawPlot();
  }

  function drawPlot() {
    const c = plot, dpr = Math.min(devicePixelRatio, 2), W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const top = Math.max(1, ...st.err);
    const scale = [1, 2, 5, 10, 20, 50, 100, 200].find(v => v >= top) || top;
    g.strokeStyle = css(root, '--rule', '#dedad2'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(30, H - 14.5); g.lineTo(W, H - 14.5); g.stroke();
    g.fillStyle = css(root, '--ink-2', '#3d4047'); g.font = '12px ' + getComputedStyle(root).fontFamily;
    g.fillText(String(scale), 0, 12); g.fillText('0', 0, H - 10);
    g.strokeStyle = css(root, '--ink', '#16171a'); g.lineWidth = 1.5; g.beginPath();
    st.err.forEach((e, i) => { const x = 30 + (i / 249) * (W - 30), y = H - 14 - (e / scale) * (H - 20); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  }

  function details() {
    const g = R.rneaFast(st.q, [0,0,0,0,0,0], [0,0,0,0,0,0]);
    const rows = JNAMES.map((n, i) => `<tr><td>${n}</td><td>${(st.q[i] * DEG).toFixed(1)}</td><td>${(st.qd[i] * DEG).toFixed(1)}</td><td>${st.tau[i].toFixed(1)}</td><td>${g[i].toFixed(1)}</td><td>${TAU_MAX[i]}</td></tr>`).join('');
    const m = st.man, pi = st.planInfo;
    det.innerHTML = `<table><thead><tr><th>Joint</th><th>q (deg)</th><th>q&#775; (deg/s)</th><th>&tau; applied (N m)</th><th>g(q) by RNEA (N m)</th><th>Limit (N m)</th></tr></thead><tbody>${rows}</tbody></table>
<p>Manipulability &mu; = &radic;det(J<sub>v</sub>J<sub>v</sub><sup>T</sup>) = ${m ? m.mu.toFixed(4) : ''} m<sup>3</sup>/s<sup>3</sup>. Singular values of J<sub>s</sub>: smallest ${m ? m.sigmaMin.toFixed(3) : ''}, largest ${m ? m.sigmaMax.toFixed(3) : ''}.</p>
<p>${st.mode === 'move' && st.ik ? `IK: position error ${(st.ik.eV * 1000).toFixed(2)} mm, orientation error ${(st.ik.eW * DEG).toFixed(2)} deg.` : pi ? (pi.fail ? `Last plan failed after ${Math.round(pi.ms)} ms.` : `Plan: ${pi.raw} RRT-Connect waypoints, ${pi.smooth} after shortcutting, ${pi.dur.toFixed(2)} s with quintic time scaling, found in ${Math.round(pi.ms)} ms.`) : ''}</p>
<p>Simulation: RK4 at 1 kHz, ${st.stepsLastSec} steps in the last second of wall time.</p>`;
  }

  setMode(root.dataset.mode === 'plan' ? 'plan' : 'move');
  requestAnimationFrame(frame);
}

document.querySelectorAll('[data-ur5e3d]').forEach(mount);
