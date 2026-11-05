// MQP perception demo on the shared shell. Embed: <div data-mqpvis></div>, load this file as a module
// (needs an import map for "three"). Four corner cameras render the field, the frames go through the
// report's illumination correction, a colour detector boxes the blocks, and each box's bottom-centre
// pixel is projected onto the floor. The map only ever shows what the pixels say.
import { createShell, h } from '../demo-shell.js';
import { CAM, CAMS, HALF, FIELD, BLOCK, MOUNT_H, PITCH, undistort, pixelToField, onField, createPipe, boxesFromAlpha, mergeEstimates, blur8, gaussKernel, BETA, TINT, SEND } from './percep.js';

const params = new URLSearchParams(location.search);
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RED = '#d23a2f', BLUE = '#2d6ee0';

// Goal and loader geometry, field inches. Lengths from the report (p51-52: 3 in cells, long goal
// 15 cells, centre goal 7 cells, four loaders). Positions and heights are not in the report: they
// follow the official Push Back field drawing, rounded.
const LONG_Y = 48, LONG_LEN = 45, CENTER_LEN = 21, GOAL_Z = 11;
const LOADERS = [[-69, 48], [-69, -48], [69, 48], [69, -48]], LOADER_H = 19, LOADER_Z = 15;

// Pinhole render that the lens model resamples. Covers the undistorted rays of every image pixel.
const XR = 2.2, YR = 1.4, RW = 352, RH = 224;
const SW = CAM.W * 4, SH = CAM.H;

function mount(root) {
  if (root.dataset.mounted) return; root.dataset.mounted = '1';
  const shell = createShell(root, {
    id: 'mqpvis', label: 'MQP block perception',
    viewLabel: 'Push Back field with the MQP robot and red and blue blocks. Drag a block or the robot. Focus here to drive with W A S D, Q and E turn.',
    side: true, scenes: [{ id: 'main', label: 'Perception' }], scene: 'main',
  });
  shell.col.querySelector('.ds-ro-more')?.setAttribute('hidden', '');
  const view = shell.view;
  view.append(h('p', { class: 'ds-loading', text: 'Loading field' }));

  // Camera strip with its stage toggle, under the view.
  const STAGES = [['raw', 'Raw'], ['wb', 'Balanced'], ['illum', 'Illumination'], ['out', 'Corrected']];
  const stageBtns = {};
  const stageRow = h('div', { class: 'ds-group mq-stages', role: 'group', 'aria-label': 'Camera image stage' },
    ...STAGES.map(([id, label]) => (stageBtns[id] = h('button', { type: 'button', 'aria-pressed': String(id === 'out'), text: label, onclick: () => pickStage(id) }))));
  const strip = h('canvas', { class: 'mq-strip', width: SW, height: SH, role: 'img', 'aria-label': 'The four camera images side by side, with a box on each detected block' });
  const stripWrap = h('div', { class: 'mq-stripwrap' }, h('h3', { class: 'ds-ro-h', text: 'Four corner cameras' }), stageRow, strip);
  view.after(stripWrap);

  const map = h('canvas', { class: 'mq-map', role: 'img', 'aria-label': 'Top-down map: true block positions as rings, estimates from the cameras as dots' });
  const legend = h('p', { class: 'mq-key' },
    h('span', {}, h('i', { class: 'mq-k-ring' }), 'Block'), h('span', {}, h('i', { class: 'mq-k-dot' }), 'Estimate'), h('span', {}, h('i', { class: 'mq-k-x', text: '×' }), 'Dropped'));
  shell.sideBody.append(h('h3', { class: 'ds-ro-h', text: 'Top-down map' }), map, legend);

  let api = null;
  shell.setFlow([{ step: 'Drag a block', id: 'drag' }, { step: 'Drop one into a goal', id: 'goal' }, { step: 'Move the robot', id: 'robot' }],
    [{ label: 'Turn left', id: 'tl', onClick: () => api && api.turn(1) }, { label: 'Turn right', id: 'tr', onClick: () => api && api.turn(-1) },
     { label: 'Reset', id: 'reset', onClick: () => api && api.reset() }]);
  shell.coach('main', [
    { key: 'drag', text: 'Drag a block onto the open floor.', target: () => view },
    { key: 'stage', text: 'Show the illumination map.', target: () => stageBtns.illum },
    { key: 'goal', text: 'Drop a block into a goal.', target: () => view },
    { key: 'robot', text: 'Drag the robot to a new spot.', target: () => view },
  ]);
  let stage = 'out';
  function pickStage(id) {
    stage = id; for (const [k, b] of Object.entries(stageBtns)) b.setAttribute('aria-pressed', String(k === id));
    api && api.drawStrip(); if (id === 'illum') shell.done('stage');
  }
  shell.say('Loading field');
  let started = false;
  const go = () => {
    if (started) return; started = true;
    init(shell, { strip, map, getStage: () => stage }).then(a => { api = a; shell.startCoach(); })
      .catch(e => { console.error(e); shell.say('Could not load the field'); });
  };
  if (params.has('autoload') || !('IntersectionObserver' in window)) go();
  else { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' }); io.observe(view); }
}

// Starting layout: a spread of blocks near the robot. Not the official match layout.
const START = [
  [-20, 22, 'red'], [-8, 30, 'blue'], [6, 18, 'red'], [-40, 30, 'blue'], [-52, 8, 'red'], [-14, -24, 'blue'],
  [8, -12, 'red'], [-36, -34, 'red'], [-58, -20, 'blue'], [22, 4, 'blue'], [-4, 6, 'red'], [-26, -6, 'blue'],
  [30, 30, 'red'], [26, -36, 'blue'],
];
const START_POSE = { x: -34, y: -4, th: 0.35 };

async function init(shell, { strip, map, getStage }) {
  const THREE = await import('three');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  // Static parts that share a material become one mesh: fewer draw calls in each of the five renders.
  const statics = new Map();
  const addStatic = (geo, mat, pos) => { geo.translate(pos.x, pos.y, pos.z); if (!statics.has(mat)) statics.set(mat, []); statics.get(mat).push(geo); };
  const view = shell.view, root = shell.root;
  const T = (x, y, z = 0) => new THREE.Vector3(x, z, -y);       // field (z up) -> three (y up)

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  const canvas = renderer.domElement; view.insertBefore(canvas, view.firstChild);
  view.querySelector('.ds-loading')?.remove();

  const scene = new THREE.Scene();
  const frame = () => getComputedStyle(root).getPropertyValue('--frame').trim() || '#eeebe4';
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-60, 160, 90); scene.add(sun);

  // ---------- field ----------
  const lam = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(FIELD, FIELD), lam(0x8d9196)); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  // Tile seams every 24 in (VEX field tiles are 2 ft; report p27 says one tile is about 2 ft).
  const seams = [];
  for (let i = -2; i <= 2; i++) { seams.push(T(-HALF, i * 24, 0.05), T(HALF, i * 24, 0.05), T(i * 24, -HALF, 0.05), T(i * 24, HALF, 0.05)); }
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seams), new THREE.LineBasicMaterial({ color: 0x7a7e83 })));
  const wallM = lam(0xc9ccd0);
  for (const [x, y, w, d] of [[0, HALF + 1, FIELD + 4, 2], [0, -HALF - 1, FIELD + 4, 2], [HALF + 1, 0, 2, FIELD], [-HALF - 1, 0, 2, FIELD]]) {
    addStatic(new THREE.BoxGeometry(w, 4, d), wallM, T(x, y, 2));
  }
  // Alliance colour strips on the two driver walls.
  for (const [x, c] of [[-HALF - 1, RED], [HALF + 1, BLUE]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, FIELD), lam(c)); m.position.copy(T(x, 0, 4.2)); m.layers.set(1); scene.add(m); }

  const goalM = lam(0xe3e5e8, { transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const postM = lam(0x55595f);
  const targets = [];
  function tube(cx, cy, len, ang, z, kind) {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, len, 18, 1, true), goalM.clone());
    g.rotation.order = 'YXZ'; g.rotation.y = ang; g.rotation.z = Math.PI / 2; g.position.copy(T(cx, cy, z)); scene.add(g);
    for (const s of [-1, 1]) {
      const px = cx + Math.cos(ang) * s * (len / 2 - 2), py = cy + Math.sin(ang) * s * (len / 2 - 2);
      addStatic(new THREE.BoxGeometry(1, z - 2.4, 1), postM, T(px, py, (z - 2.4) / 2));
    }
    targets.push({ kind, cx, cy, len, ang, z, mesh: g, n: 0 });
  }
  tube(0, LONG_Y, LONG_LEN, 0, GOAL_Z, 'long'); tube(0, -LONG_Y, LONG_LEN, 0, GOAL_Z, 'long');
  tube(0, 0, CENTER_LEN, Math.PI / 4, GOAL_Z, 'center');
  { const lo = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, CENTER_LEN, 18, 1, true), goalM.clone()); lo.rotation.order = 'YXZ'; lo.rotation.y = -Math.PI / 4; lo.rotation.z = Math.PI / 2; lo.position.copy(T(0, 0, 4)); scene.add(lo); }
  for (const [x, y] of LOADERS) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, LOADER_H, 18, 1, true), goalM.clone()); m.position.copy(T(x, y, LOADER_H / 2)); scene.add(m);
    targets.push({ kind: 'loader', cx: x, cy: y, z: LOADER_Z, mesh: m, n: 0 });
  }

  for (const [mat, geos] of statics) scene.add(new THREE.Mesh(mergeGeometries(geos), mat));

  // ---------- blocks ----------
  const blockGeo = new THREE.CylinderGeometry(BLOCK / 2, BLOCK / 2, BLOCK, 6);
  const mats = { red: lam(0xc92a22), blue: lam(0x1f4fd0) };
  const blocks = START.map(([x, y, color], i) => {
    const mesh = new THREE.Mesh(blockGeo, mats[color]); mesh.userData.block = i; scene.add(mesh);
    return { i, color, x, y, z: BLOCK / 2, in: null, mesh };
  });
  const placeBlock = (b) => b.mesh.position.copy(T(b.x, b.y, b.z));
  blocks.forEach(placeBlock);

  // ---------- robot (main view only: layer 1, the corner cameras do not see it) ----------
  const robot = new THREE.Group(); scene.add(robot);
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(15, 10, 15), lam(0x3a3d42)); proxy.position.y = 5; robot.add(proxy);
  const arrowShape = new THREE.Shape([new THREE.Vector2(15, 0), new THREE.Vector2(10, 4), new THREE.Vector2(10, -4)]);
  const nose = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xffffff })); nose.rotation.x = -Math.PI / 2; nose.position.y = 0.1; robot.add(nose);
  const hit = new THREE.Mesh(new THREE.BoxGeometry(17, 16, 17), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 8; hit.userData.robot = true; robot.add(hit);
  const camDots = CAMS.map(c => { const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), lam(0x111111)); m.position.set(c.ox, MOUNT_H, -c.oy); robot.add(m); return m; });
  const setLayer = (o) => o.traverse(n => n.layers.set(1));
  setLayer(robot);
  const pose = { ...START_POSE };
  const placeRobot = () => { robot.position.copy(T(pose.x, pose.y, 0)); robot.rotation.y = pose.th; };
  placeRobot();
  loadRobot(THREE, robot, proxy, nose, setLayer, () => { needMain = true; kick(); });

  // ---------- main camera ----------
  const cam = new THREE.PerspectiveCamera(34, 1, 5, 2000); cam.layers.enable(1);
  function fit() {
    const w = view.clientWidth, hh = view.clientHeight; if (!w || !hh) return;
    renderer.setSize(w, hh, false); cam.aspect = w / hh;
    const need = (FIELD * 0.56) / Math.tan((cam.fov / 2) * Math.PI / 180) / Math.min(1, cam.aspect * 0.95);
    const tilt = cam.aspect < 1 ? 0.3 : 0.58;                      // narrow screens look more from above
    cam.position.set(0, need * Math.sqrt(1 - tilt * tilt), need * tilt); cam.lookAt(0, 0, 6); cam.updateProjectionMatrix();
    needMain = true; kick();
  }

  // ---------- corner cameras ----------
  const rt = new THREE.WebGLRenderTarget(RW * 4, RH); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cams = CAMS.map(() => { const c = new THREE.PerspectiveCamera(2 * Math.atan(YR) * 180 / Math.PI, XR / YR, 0.5, 400); c.rotation.order = 'YXZ'; return c; });
  function renderCams() {
    // The cameras never see the robot (layer 1); taking it out skips its CAD meshes four times over.
    const bg = scene.background; scene.background = null; scene.remove(robot);
    scene.updateMatrixWorld(); scene.matrixWorldAutoUpdate = false;
    renderer.setClearColor(0x5b5e62, 1);
    rt.scissorTest = true;
    CAMS.forEach((c, i) => {
      const P = cams[i], ct = Math.cos(pose.th), st = Math.sin(pose.th);
      const X = pose.x + ct * c.ox - st * c.oy, Y = pose.y + st * c.ox + ct * c.oy, a = pose.th + c.psi;
      P.position.copy(T(X, Y, MOUNT_H)); P.rotation.set(PITCH, a - Math.PI / 2, 0); P.updateMatrixWorld();
      rt.viewport.set(i * RW, 0, RW, RH); rt.scissor.set(i * RW, 0, RW, RH);
      renderer.setRenderTarget(rt);                                  // viewport is read on bind
      renderer.render(scene, P);
    });
    rt.scissorTest = false;
    renderer.setRenderTarget(null);
    scene.matrixWorldAutoUpdate = true; scene.add(robot); scene.background = bg;
  }
  // Lens, sensor look, the sender's correction, illumination correction and colour classes run on
  // the GPU (gpuPipe). Without async readback the same maths runs on the CPU (createPipe in percep.js).
  const pipe = typeof renderer.readRenderTargetPixelsAsync === 'function' ? gpuPipe(THREE, renderer, rt) : cpuPipe(THREE, renderer, rt);

  // ---------- pipeline ----------
  let boxes = [], est = [], blocksSeen = [], busy = false;
  async function pipeline() {
    busy = true;
    let t = performance.now(); const t0 = t;
    renderCams();
    const job = pipe.run(getStage()); let ms = performance.now() - t;
    boxes = await job;
    t = performance.now();
    const ct = Math.cos(pose.th), st = Math.sin(pose.th);
    est = boxes.map(b => {
      const c = CAMS[b.cam], p = pixelToField((b.x0 + b.x1) / 2, b.y1, pose, c);
      const from = { x: pose.x + ct * c.ox - st * c.oy, y: pose.y + st * c.ox + ct * c.oy };
      if (!p || p.above) return { b, drop: true, from, dir: pose.th + c.psi + Math.atan(-(p ? p.xn : 0)) };
      return { b, drop: !onField(p), from, x: p.x, y: p.y, dir: Math.atan2(p.y - from.y, p.x - from.x) };
    });
    blocksSeen = mergeEstimates(est.filter(e => !e.drop).map(e => ({ color: e.b.color, cam: e.b.cam, x: e.x, y: e.y })));
    drawStrip(); drawMap(); report();
    ms += performance.now() - t + pipe.t;       // main-thread time only; the GPU waits are not counted
    performance.measure('mqp-update', { start: t0, duration: ms });
    busy = false; needMain = true; kick();
  }

  // ---------- camera strip ----------
  const sctx = strip.getContext('2d');
  let grid = false;
  function layoutStrip() {
    const g = strip.clientWidth > 0 && strip.parentElement.clientWidth < 700;
    if (g !== grid || !strip.dataset.l) { grid = g; strip.dataset.l = '1'; strip.width = grid ? CAM.W * 2 : SW; strip.height = grid ? SH * 2 : SH; strip.classList.toggle('mq-grid', grid); drawStrip(); }
  }
  const tileXY = (i) => grid ? [(i % 2) * CAM.W, Math.floor(i / 2) * SH] : [i * CAM.W, 0];
  let stripSeen = true;
  new IntersectionObserver(es => { stripSeen = es.some(e => e.isIntersecting); if (stripSeen) drawStrip(); }).observe(strip);
  function drawStrip() {
    if (!pipe.ready || !stripSeen) return;
    const img = pipe.image(getStage());
    if (!grid) sctx.putImageData(img, 0, 0);
    else for (let i = 0; i < 4; i++) { const [ox, oy] = tileXY(i); sctx.putImageData(img, ox - i * CAM.W, oy, i * CAM.W, 0, CAM.W, SH); }
    sctx.lineWidth = grid ? 2 : 1.5;
    for (const e of est) {
      const [ox, oy] = tileXY(e.b.cam), b = e.b;
      sctx.strokeStyle = e.drop ? '#ffd23f' : '#ffffff'; sctx.setLineDash(e.drop ? [3, 2] : []);
      sctx.strokeRect(ox + b.x0 - 1.5, oy + b.y0 - 1.5, b.x1 - b.x0 + 3, b.y1 - b.y0 + 3);
      sctx.setLineDash([]); sctx.fillStyle = e.drop ? '#ffd23f' : '#ffffff';
      sctx.beginPath(); sctx.arc(ox + (b.x0 + b.x1) / 2, oy + b.y1 + 1.5, 2, 0, 7); sctx.fill();
    }
    const fs = Math.round(16 * strip.width / Math.max(1, strip.clientWidth)); sctx.font = `600 ${fs}px system-ui, sans-serif`;
    CAMS.forEach((c, i) => { const [ox, oy] = tileXY(i); sctx.fillStyle = '#000'; sctx.fillRect(ox, oy, sctx.measureText(c.name).width + fs * 0.8, fs * 1.5); sctx.fillStyle = '#fff'; sctx.fillText(c.name, ox + fs * 0.4, oy + fs * 1.1); });
    if (grid) { sctx.fillStyle = '#000'; sctx.fillRect(CAM.W - 1, 0, 2, SH * 2); sctx.fillRect(0, SH - 1, CAM.W * 2, 2); }
    else { sctx.fillStyle = '#000'; for (let i = 1; i < 4; i++) sctx.fillRect(i * CAM.W - 1, 0, 2, SH); }
  }

  // ---------- top-down map ----------
  const mctx = map.getContext('2d');
  function drawMap() {
    const d = Math.min(devicePixelRatio || 1, 2), w = map.clientWidth; if (!w) return;
    if (map.width !== Math.round(w * d)) { map.width = map.height = Math.round(w * d); }
    const cs = getComputedStyle(root), ink = cs.getPropertyValue('--ink').trim() || '#16171a', ink2 = cs.getPropertyValue('--ink-2').trim() || '#3d4047';
    const ctx = mctx; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, w);
    const pad = w * 0.09, s = (w - 2 * pad) / FIELD, X = (x) => pad + (x + HALF) * s, Y = (y) => pad + (HALF - y) * s;
    ctx.fillStyle = frame(); ctx.fillRect(X(-HALF), Y(HALF), FIELD * s, FIELD * s);
    ctx.strokeStyle = ink2; ctx.lineWidth = 1.5; ctx.strokeRect(X(-HALF), Y(HALF), FIELD * s, FIELD * s);
    ctx.fillStyle = RED; ctx.fillRect(X(-HALF) - 4, Y(HALF), 3, FIELD * s); ctx.fillStyle = BLUE; ctx.fillRect(X(HALF) + 1, Y(HALF), 3, FIELD * s);
    // goals and loaders
    ctx.strokeStyle = ink2; ctx.lineCap = 'round'; ctx.lineWidth = 4.8 * s;
    for (const t of targets) {
      ctx.globalAlpha = t.hot ? 1 : 0.35; ctx.strokeStyle = t.hot ? (getComputedStyle(root).getPropertyValue('--mark').trim() || '#0f8b8d') : ink2;
      ctx.beginPath();
      if (t.kind === 'loader') { ctx.lineWidth = 1.6 * s; ctx.arc(X(t.cx), Y(t.cy), 2.6 * s, 0, 7); }
      else { ctx.lineWidth = 4.8 * s; const c = Math.cos(t.ang) * t.len / 2, sn = Math.sin(t.ang) * t.len / 2; ctx.moveTo(X(t.cx - c), Y(t.cy - sn)); ctx.lineTo(X(t.cx + c), Y(t.cy + sn)); }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.35; ctx.lineWidth = 4.8 * s; ctx.strokeStyle = ink2;
    { const c = Math.cos(-Math.PI / 4) * CENTER_LEN / 2, sn = Math.sin(-Math.PI / 4) * CENTER_LEN / 2; ctx.beginPath(); ctx.moveTo(X(-c), Y(-sn)); ctx.lineTo(X(c), Y(sn)); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    // camera views: each corner camera's horizontal field of view, flat and faint
    const hf = Math.atan((CAM.W / 2) / CAM.fx * 1.17);
    ctx.save(); ctx.beginPath(); ctx.rect(X(-HALF), Y(HALF), FIELD * s, FIELD * s); ctx.clip();
    for (const c of CAMS) {
      const ct = Math.cos(pose.th), st = Math.sin(pose.th), cx = pose.x + ct * c.ox - st * c.oy, cy = pose.y + st * c.ox + ct * c.oy, a = pose.th + c.psi;
      ctx.fillStyle = ink; ctx.globalAlpha = 0.05; ctx.beginPath(); ctx.moveTo(X(cx), Y(cy));
      ctx.lineTo(X(cx + Math.cos(a + hf) * 300), Y(cy + Math.sin(a + hf) * 300)); ctx.lineTo(X(cx + Math.cos(a - hf) * 300), Y(cy + Math.sin(a - hf) * 300)); ctx.fill();
    }
    ctx.restore(); ctx.globalAlpha = 1;
    // robot
    ctx.save(); ctx.translate(X(pose.x), Y(pose.y)); ctx.rotate(-pose.th);
    ctx.fillStyle = ink; ctx.globalAlpha = 0.85; ctx.fillRect(-7.5 * s, -7.5 * s, 15 * s, 15 * s); ctx.globalAlpha = 1;
    ctx.fillStyle = frame(); ctx.beginPath(); ctx.moveTo(6 * s, 0); ctx.lineTo(1 * s, -3.5 * s); ctx.lineTo(1 * s, 3.5 * s); ctx.fill();
    ctx.restore();
    // true positions: rings
    const col = (c) => c === 'red' ? RED : BLUE, br = Math.max(3.5, BLOCK / 2 * s);
    ctx.lineWidth = 2;
    for (const b of blocks) { ctx.strokeStyle = col(b.color); ctx.beginPath(); ctx.arc(X(b.x), Y(b.y), br, 0, 7); ctx.stroke(); }
    // estimates: error line to the nearest true floor block of the same colour, then the dot
    for (const e of est) {
      const c = col(e.b.color);
      if (e.drop) {
        // Off the field: follow the camera ray to the wall and mark it just outside.
        const t = rayExit(e.from, e.dir), ex = e.from.x + Math.cos(e.dir) * (t + 4), ey = e.from.y + Math.sin(e.dir) * (t + 4);
        ctx.strokeStyle = c; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.25; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(X(e.from.x), Y(e.from.y)); ctx.lineTo(X(ex), Y(ey)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        const k = 5; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(ex) - k, Y(ey) - k); ctx.lineTo(X(ex) + k, Y(ey) + k); ctx.moveTo(X(ex) + k, Y(ey) - k); ctx.lineTo(X(ex) - k, Y(ey) + k); ctx.stroke();
        continue;
      }
    }
    // one dot per block: detections of the same block from overlapping cameras are merged
    for (const g of blocksSeen) {
      let best = null, bd = 18;
      for (const b of blocks) { if (b.in || b.color !== g.color) continue; const dd = Math.hypot(b.x - g.x, b.y - g.y); if (dd < bd) { bd = dd; best = b; } }
      if (best) { ctx.strokeStyle = ink; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.moveTo(X(best.x), Y(best.y)); ctx.lineTo(X(g.x), Y(g.y)); ctx.stroke(); }
      ctx.fillStyle = col(g.color); ctx.beginPath(); ctx.arc(X(g.x), Y(g.y), 3.2, 0, 7); ctx.fill();
    }
  }
  function rayExit(p, a) {
    const dx = Math.cos(a), dy = Math.sin(a); let t = 1e9;
    if (dx > 1e-6) t = Math.min(t, (HALF - p.x) / dx); if (dx < -1e-6) t = Math.min(t, (-HALF - p.x) / dx);
    if (dy > 1e-6) t = Math.min(t, (HALF - p.y) / dy); if (dy < -1e-6) t = Math.min(t, (-HALF - p.y) / dy);
    return Math.max(0, t);
  }

  function report() {
    const on = blocksSeen.length, off = est.filter(e => e.drop).length;
    shell.say(`${on} block${on === 1 ? '' : 's'} found on the floor.` + (off ? ` ${off} detection${off === 1 ? '' : 's'} landed off the field and ${off === 1 ? 'was' : 'were'} dropped.` : ''));
  }

  // ---------- scheduling: nothing runs until something changes ----------
  let needMain = true, needPipe = true, lastPipe = 0, raf = 0, pipeTimer = 0;
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  function wantPipe() { needPipe = true; kick(); }
  const keys = new Set(); let lastT = 0;
  function loop(t) {
    raf = 0;
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0; lastT = t;
    if (keys.size) {
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const sd = (keys.has('a') ? 1 : 0) - (keys.has('d') ? 1 : 0);
      const r = (keys.has('q') || keys.has('arrowleft') ? 1 : 0) - (keys.has('e') || keys.has('arrowright') ? 1 : 0);
      const c = Math.cos(pose.th), s = Math.sin(pose.th);
      moveRobot(pose.x + (f * c - sd * s) * 36 * dt, pose.y + (f * s + sd * c) * 36 * dt, pose.th + r * 1.6 * dt);
    } else lastT = 0;
    if (needPipe) {
      const now = performance.now();
      if (busy) { /* the running update re-kicks when it lands */ }
      else if (now - lastPipe >= 120) { needPipe = false; lastPipe = now; pipeline(); }
      else if (!pipeTimer) pipeTimer = setTimeout(() => { pipeTimer = 0; kick(); }, 120 - (now - lastPipe));
    }
    if (needMain) { needMain = false; scene.background = new THREE.Color(frame()); renderer.render(scene, cam); }
    if (keys.size || anim) kick();
  }
  function moveRobot(x, y, th) {
    pose.x = Math.max(-HALF + 9, Math.min(HALF - 9, x)); pose.y = Math.max(-HALF + 9, Math.min(HALF - 9, y)); pose.th = th;
    placeRobot(); needMain = true; wantPipe();
  }

  // ---------- pointer ----------
  const ray = new THREE.Raycaster(); ray.layers.enableAll();
  const ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
  function ground(e) {
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam); return ray.ray.intersectPlane(plane, hitP) ? { x: hitP.x, y: -hitP.z } : null;
  }
  function pick(e) {
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hs = ray.intersectObjects([...blocks.map(b => b.mesh), hit], false);
    if (hs.length) return hs[0].object.userData.robot ? { robot: true } : { block: blocks[hs[0].object.userData.block] };
    // generous touch target: the nearest block within 4 in of the floor point
    const g = ground(e); if (!g) return null;
    let best = null, bd = 4.5; for (const b of blocks) { const d = Math.hypot(b.x - g.x, b.y - g.y); if (d < bd) { bd = d; best = b; } }
    if (best) return { block: best };
    if (Math.hypot(g.x - pose.x, g.y - pose.y) < 10) return { robot: true };
    return null;
  }
  function targetAt(p) {
    for (const t of targets) {
      if (t.kind === 'loader') { if (Math.hypot(p.x - t.cx, p.y - t.cy) < 6) return t; continue; }
      const c = Math.cos(t.ang), s = Math.sin(t.ang), dx = p.x - t.cx, dy = p.y - t.cy, along = dx * c + dy * s, across = -dx * s + dy * c;
      if (Math.abs(along) < t.len / 2 + 1 && Math.abs(across) < 5) return t;
    }
    return null;
  }
  let drag = null, hot = null, anim = 0;
  const setHot = (t) => {
    if (t === hot) return;
    if (hot) { hot.hot = false; hot.mesh.material.color.set(0xe3e5e8); hot.mesh.material.opacity = 0.45; }
    hot = t; if (t) { t.hot = true; t.mesh.material.color.set(getComputedStyle(root).getPropertyValue('--mark').trim() || '#0f8b8d'); t.mesh.material.opacity = 0.8; }
    needMain = true; drawMap();
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = pick(e); if (!p) return;
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
    const g = ground(e) || { x: 0, y: 0 };
    if (p.block) { const b = p.block; if (b.in) { b.in.n = Math.max(0, b.in.n - 1); b.in = null; } drag = { block: b, dx: b.x - g.x, dy: b.y - g.y }; b.z = BLOCK / 2 + 2; placeBlock(b); }
    else drag = { robot: true, dx: pose.x - g.x, dy: pose.y - g.y };
    canvas.style.cursor = 'grabbing'; needMain = true; kick();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { const p = pick(e); canvas.style.cursor = p ? 'grab' : 'default'; return; }
    const g = ground(e); if (!g) return;
    if (drag.robot) { moveRobot(g.x + drag.dx, g.y + drag.dy, pose.th); return; }
    const b = drag.block; b.x = Math.max(-HALF + 2, Math.min(HALF - 2, g.x + drag.dx)); b.y = Math.max(-HALF + 2, Math.min(HALF - 2, g.y + drag.dy));
    setHot(targetAt(b)); placeBlock(b); needMain = true; wantPipe();
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; canvas.style.cursor = 'default';
    if (d.block) {
      const b = d.block, t = hot; setHot(null);
      if (t) {
        if (t.kind === 'loader') { b.x = t.cx; b.y = t.cy; }
        else { const c = Math.cos(t.ang), s = Math.sin(t.ang), along = Math.max(-t.len / 2 + 2, Math.min(t.len / 2 - 2, (b.x - t.cx) * c + (b.y - t.cy) * s)); b.x = t.cx + along * c; b.y = t.cy + along * s; }
        b.in = t; t.n++; settle(b, t.z); shell.done('goal'); shell.current('robot');
      } else { settle(b, BLOCK / 2); shell.done('drag'); shell.current('goal'); }
    } else { shell.done('robot'); }
    wantPipe();
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  // A short drop or lift into place; instant with reduced motion.
  function settle(b, z) {
    const z0 = b.z, t0 = performance.now(), dur = reduce() ? 0 : 220;
    const step = () => {
      const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1, e = 1 - (1 - k) ** 3;
      b.z = z0 + (z - z0) * e; placeBlock(b); needMain = true;
      if (k < 1) { anim++; requestAnimationFrame(() => { anim--; step(); }); } else { wantPipe(); }
      kick();
    };
    step();
  }

  view.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(); if (!['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault(); if (!keys.has(k)) { keys.add(k); kick(); }
  });
  view.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (!keys.size) shell.done('robot'); });
  view.addEventListener('blur', () => keys.clear());

  new ResizeObserver(() => { fit(); layoutStrip(); drawMap(); }).observe(view);
  new ResizeObserver(() => { layoutStrip(); drawMap(); }).observe(shell.col);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { needMain = true; drawMap(); kick(); });
  fit(); layoutStrip(); shell.current('drag');
  wantPipe();

  return {
    drawStrip,
    turn(dir) { const target = pose.th + dir * Math.PI / 8, from = pose.th, t0 = performance.now(), dur = reduce() ? 0 : 240;
      const step = () => { const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1; moveRobot(pose.x, pose.y, from + (target - from) * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(step); };
      step(); },
    reset() {
      Object.assign(pose, START_POSE); placeRobot();
      for (const t of targets) t.n = 0;
      blocks.forEach((b, i) => { b.x = START[i][0]; b.y = START[i][1]; b.z = BLOCK / 2; b.in = null; placeBlock(b); });
      needMain = true; wantPipe(); shell.current('drag');
    },
  };
}

// ---------- GPU pipeline ----------
// The robot's chain (Autonomous-VEXU/camera_stream): the sender (stream_raw.py) brightens and
// colour-corrects each frame, the receiver (IE.py) removes the lighting. Passes, each a full-screen
// quad into its own target:
//   sense:   strip pixel -> undistorted ray -> pinhole render texel; dark, yellow, hot-centred sensor
//   small:   the 1/8 grayscale of the sender's output (4 samples per block, as INTER_LINEAR), read back
//   correct: sender's output / L * 120, truncated to uint8; colour class in alpha; read back
//   flags:   which 8x8 blocks hold any class pixel, so the box search skips the rest
// The 31x31 Gaussian on the 160x25 image runs on the CPU (blur8 in percep.js, same as the tests).
// Readbacks are asynchronous, so the main thread never waits on the GPU.
const VS = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
const SENSE = `precision highp float; precision highp int;
uniform sampler2D pin; uniform float fx, fy, cx, cy, k1, k2, XR, YR; uniform int RW, RH, TW, W; uniform vec3 tint;
float s8(float c) { c = clamp(c, 0.0, 1.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy); int tile = p.x / TW, lu = p.x - tile * TW, v = p.y;
  float xd = (float(lu) + 0.5 - cx) / fx, yd = (float(v) + 0.5 - cy) / fy, rd = length(vec2(xd, yd)), s = 1.0;
  bool ok = true;
  if (rd > 1e-9) {
    float r = rd;
    for (int i = 0; i < 12; i++) { float r2 = r * r, df = 1.0 + 3.0 * k1 * r2 + 5.0 * k2 * r2 * r2; if (df <= 1e-6) { ok = false; break; } r -= (r * (1.0 + k1 * r2 + k2 * r2 * r2) - rd) / df; }
    if (!(r > 0.0) || 1.0 + 3.0 * k1 * r * r + 5.0 * k2 * r * r * r * r <= 0.0) ok = false;
    s = r / rd;
  }
  float xu = xd * s, yu = yd * s; vec3 c = vec3(0.0);
  if (ok && abs(xu) < XR && abs(yu) < YR) {
    int rx = int(floor((xu / XR * 0.5 + 0.5) * float(RW))), ry = int(floor((yu / YR * 0.5 + 0.5) * float(RH)));
    vec3 t = texelFetch(pin, ivec2(tile * RW + rx, RH - 1 - ry), 0).rgb;
    vec3 b8 = floor(vec3(s8(t.r), s8(t.g), s8(t.b)) * 255.0 + 0.5);
    float dx = (float(lu) - cx) / cx, dy = (float(v) - cy) / cx, g = (0.22 + 1.05 * exp(-(dx * dx + dy * dy) / 0.16)) * 0.55;
    uint h = (uint(v) * uint(W) + uint(p.x)) * 2654435761u; float nz = (float(h) / 4294967296.0 - 0.5) * 3.0;
    c = (b8 * g * tint + nz) / 255.0;
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
// stream_raw.py on uint8 RGB: convertScaleAbs(alpha, beta) rounds, then the R, G, B gains truncate.
// The tiny epsilon keeps float32 products such as 160 * 0.95 from landing just under the integer.
const SENDER = `vec3 send(vec3 x) { vec3 v = min(vec3(255.0), floor(abs(x * ${SEND.alpha.toFixed(4)} + ${SEND.beta.toFixed(1)}) + 0.5));
  return min(vec3(255.0), floor(v * vec3(${SEND.gain.map(g => g.toFixed(4)).join(', ')}) + 1e-4)); }
int gray8(vec3 c) { ivec3 i = ivec3(c); return (i.r * 4899 + i.g * 9617 + i.b * 1868 + 8192) >> 14; }
vec3 r8at(sampler2D t, ivec2 p) { return floor(texelFetch(t, p, 0).rgb * 255.0 + 0.5); }`;
const SMALL = `precision highp float; precision highp int; uniform sampler2D raw;
${SENDER}
void main() { ivec2 p = ivec2(gl_FragCoord.xy) * 8 + 3;
  int a = gray8(send(r8at(raw, p))) + gray8(send(r8at(raw, p + ivec2(1, 0)))) + gray8(send(r8at(raw, p + ivec2(0, 1)))) + gray8(send(r8at(raw, p + ivec2(1, 1))));
  gl_FragColor = vec4(float((a + 2) >> 2) / 255.0, 0.0, 0.0, 1.0); }`;
const CORRECT = `precision highp float; precision highp int;
uniform sampler2D raw, Ls; uniform float beta; uniform int mode, sw, sh;
${SENDER}
float Lat(ivec2 p) {
  float fx = clamp((float(p.x) + 0.5) / 8.0 - 0.5, 0.0, float(sw - 1)), fy = clamp((float(p.y) + 0.5) / 8.0 - 0.5, 0.0, float(sh - 1));
  int x0 = int(floor(fx)), y0 = int(floor(fy)), x1 = min(sw - 1, x0 + 1), y1 = min(sh - 1, y0 + 1); float tx = fx - float(x0), ty = fy - float(y0);
  float a = texelFetch(Ls, ivec2(x0, y0), 0).r, b = texelFetch(Ls, ivec2(x1, y0), 0).r, c = texelFetch(Ls, ivec2(x0, y1), 0).r, d = texelFetch(Ls, ivec2(x1, y1), 0).r;
  return clamp(floor((a * (1.0 - tx) + b * tx) * (1.0 - ty) + (c * (1.0 - tx) + d * tx) * ty + 0.5), 1.0, 255.0);   // resize to uint8, then clip [1, 255]
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy); vec3 r8 = r8at(raw, p), w = send(r8);
  if (mode == 1) { gl_FragColor = vec4(r8 / 255.0, 1.0); return; }
  if (mode == 2) { gl_FragColor = vec4(w / 255.0, 1.0); return; }
  float L = Lat(p);
  if (mode == 3) { gl_FragColor = vec4(vec3(L) / 255.0, 1.0); return; }
  vec3 o = floor(min(vec3(255.0), w / L * beta));                 // np.clip, then astype(uint8) truncates
  float cl = (o.r > 80.0 && o.r - max(o.g, o.b) > 40.0) ? 1.0 : (o.b > 80.0 && o.b - max(o.r, o.g) > 30.0) ? 2.0 : 0.0;   // classOf in percep.js
  gl_FragColor = vec4(o / 255.0, (255.0 - cl) / 255.0);   // alpha: 255 none, 254 red, 253 blue
}`;
const FLAGS = `precision highp float; uniform sampler2D outT;
void main() { ivec2 p = ivec2(gl_FragCoord.xy) * 8; float any = 0.0;
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) if (texelFetch(outT, p + ivec2(x, y), 0).a < 0.998) any = 1.0;
  gl_FragColor = vec4(any, 0.0, 0.0, 1.0); }`;

function gpuPipe(THREE, renderer, pinRT) {
  const sw = SW / 8, sh = SH / 8, M = sw * sh;
  const tgt = (w, h, type = THREE.UnsignedByteType) => new THREE.WebGLRenderTarget(w, h, { type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const rawRT = tgt(SW, SH), smallRT = tgt(sw, sh), outRT = tgt(SW, SH), stageRT = tgt(SW, SH), flagRT = tgt(sw, sh);
  const LsTex = new THREE.DataTexture(new Float32Array(M), sw, sh, THREE.RedFormat, THREE.FloatType); LsTex.minFilter = LsTex.magFilter = THREE.NearestFilter;
  const mat = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
  const sense = mat(SENSE, { pin: { value: pinRT.texture }, fx: { value: CAM.fx }, fy: { value: CAM.fy }, cx: { value: CAM.cx }, cy: { value: CAM.cy }, k1: { value: CAM.k1 }, k2: { value: CAM.k2 },
    XR: { value: XR }, YR: { value: YR }, RW: { value: RW }, RH: { value: RH }, TW: { value: CAM.W }, W: { value: SW }, tint: { value: new THREE.Vector3(...TINT) } });
  const smallM = mat(SMALL, { raw: { value: rawRT.texture } });
  const correct = mat(CORRECT, { raw: { value: rawRT.texture }, Ls: { value: LsTex }, beta: { value: BETA }, mode: { value: 0 }, sw: { value: sw }, sh: { value: sh } });
  const flagsM = mat(FLAGS, { outT: { value: outRT.texture } });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sense); quad.frustumCulled = false;
  const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (m, t) => { quad.material = m; renderer.setRenderTarget(t); renderer.render(qs, qc); };
  const sbuf = new Uint8Array(M * 4), small = new Uint8Array(M), tmp = new Float32Array(M), L8 = new Uint8Array(M), Ls = LsTex.image.data, G = gaussKernel();
  const out = new ImageData(SW, SH), stage = new ImageData(SW, SH), seen = new Uint8Array(SW * SH), stack = new Int32Array(SW * SH), fbuf = new Uint8Array(M * 4);
  const outBytes = new Uint8Array(out.data.buffer), stageBytes = new Uint8Array(stage.data.buffer);
  let stageFor = null;
  const P = {
    ready: false,
    t: 0,                                                // main-thread time of the last run, ms
    async run(st = 'out') {
      let t = performance.now();
      pass(sense, rawRT); pass(smallM, smallRT); renderer.setRenderTarget(null);
      P.t = performance.now() - t;
      await renderer.readRenderTargetPixelsAsync(smallRT, 0, 0, sw, sh, sbuf);
      t = performance.now();
      for (let b = 0; b < M; b++) small[b] = sbuf[b * 4];
      blur8(small, tmp, L8, sw, sh, G); Ls.set(L8); LsTex.needsUpdate = true;     // IE.py: GaussianBlur((31, 31), 0)
      correct.uniforms.mode.value = 0; pass(correct, outRT); pass(flagsM, flagRT);
      const reads = [renderer.readRenderTargetPixelsAsync(outRT, 0, 0, SW, SH, outBytes), renderer.readRenderTargetPixelsAsync(flagRT, 0, 0, sw, sh, fbuf)];
      if (st !== 'out') {   // the stage on screen comes back with the same batch
        correct.uniforms.mode.value = st === 'raw' ? 1 : st === 'wb' ? 2 : 3; pass(correct, stageRT);
        reads.push(renderer.readRenderTargetPixelsAsync(stageRT, 0, 0, SW, SH, stageBytes));
      }
      renderer.setRenderTarget(null);
      P.t += performance.now() - t;
      await Promise.all(reads);
      t = performance.now();
      const boxes = boxesFromAlpha(outBytes, fbuf, seen, stack, SW, SH, CAM.W, 8, 3);
      P.ready = true; stageFor = st === 'out' ? null : st;
      P.t += performance.now() - t;
      return boxes;
    },
    // The stage on screen; only Corrected comes free with the update.
    image(st) {
      if (st === 'out') return out;
      if (stageFor !== st) {
        correct.uniforms.mode.value = st === 'raw' ? 1 : st === 'wb' ? 2 : 3; pass(correct, stageRT);
        renderer.readRenderTargetPixels(stageRT, 0, 0, SW, SH, stageBytes); renderer.setRenderTarget(null); stageFor = st;
      }
      return stage;
    },
  };
  return P;
}

// Same steps on the CPU, for devices without float render targets.
function cpuPipe(THREE, renderer, pinRT) {
  const lut = new Int32Array(SW * SH), vg = new Float32Array(CAM.W * SH), noise = new Float32Array(SW * SH), buf = new Uint8Array(RW * 4 * RH * 4);
  for (let v = 0; v < SH; v++) for (let u = 0; u < SW; u++) {
    const ci = Math.floor(u / CAM.W), lu = u - ci * CAM.W, n = undistort((lu + 0.5 - CAM.cx) / CAM.fx, (v + 0.5 - CAM.cy) / CAM.fy);
    let k = -1;
    if (n && Math.abs(n[0]) < XR && Math.abs(n[1]) < YR) k = ((RH - 1 - Math.floor((n[1] / YR * 0.5 + 0.5) * RH)) * RW * 4 + ci * RW + Math.floor((n[0] / XR * 0.5 + 0.5) * RW)) * 4;
    lut[v * SW + u] = k; noise[v * SW + u] = ((((v * SW + u) * 2654435761) >>> 0) / 4294967296 - 0.5) * 3;
  }
  for (let v = 0; v < SH; v++) for (let u = 0; u < CAM.W; u++) { const dx = (u - CAM.cx) / CAM.cx, dy = (v - CAM.cy) / CAM.cx; vg[v * CAM.W + u] = (0.22 + 1.05 * Math.exp(-(dx * dx + dy * dy) / 0.16)) * 0.55; }
  const p = createPipe({ W: SW, H: SH }), out = new ImageData(p.out, SW, SH), stage = new ImageData(SW, SH);
  return {
    ready: false,
    t: 0,
    async run() { const t = performance.now(); renderer.readRenderTargetPixels(pinRT, 0, 0, RW * 4, RH, buf); renderer.setRenderTarget(null); p.sense(buf, lut, vg, noise, TINT); this.ready = true; const b = p.correct(); this.t = performance.now() - t; return b; },
    image(st) {
      if (st === 'out') return out;
      const d = stage.data;
      if (st === 'raw') d.set(p.raw); else if (st === 'wb') p.balanced(d); else for (let i = 0; i < SW * SH; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = p.lmap[i]; d[i * 4 + 3] = 255; }
      return stage;
    },
  };
}

// The robot's CAD model, scaled to the 15 in frame. Keeps the box proxy if it fails to load.
async function loadRobot(THREE, robot, proxy, nose, setLayer, done) {
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/'));
    const gltf = await loader.loadAsync(new URL('mqp_robot.glb', import.meta.url).href);
    const m = gltf.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3());
    const s = 15 / Math.max(size.x, size.z);
    m.scale.setScalar(s);
    const b2 = new THREE.Box3().setFromObject(m), c = b2.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -b2.min.y, -c.z);
    const wrap = new THREE.Group(); wrap.add(m); wrap.rotation.y = ROBOT_YAW;
    m.traverse(n => { if (n.isMesh) { const o = n.material; n.material = new THREE.MeshLambertMaterial({ color: o.color || 0x888888, map: o.map || null }); } });
    setLayer(wrap); robot.add(wrap); robot.remove(proxy);
    done();
  } catch (e) { console.warn('robot model', e); }
}
// Turns the CAD so its intake faces the robot's +x (forward).
const ROBOT_YAW = 0;

const el = document.querySelector('[data-mqpvis]');
if (el) mount(el);
