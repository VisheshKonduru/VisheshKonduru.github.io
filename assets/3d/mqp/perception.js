// MQP perception demo on the shared shell. Embed: <div data-mqpvis></div>, load this file as a module
// (needs an import map for "three"). Four corner cameras render the field, the frames go through the
// report's illumination correction, a colour detector boxes the blocks, and each box's bottom-centre
// pixel is projected onto the floor. The map only ever shows what the pixels say.
import { createShell, h } from '../demo-shell.js';
import { CAM, CAMS, HALF, FIELD, BLOCK, MOUNT_H, PITCH, undistort, pixelToField, onField, retinex, whiteBalance, detect } from './percep.js';

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
  const view = shell.view, root = shell.root;
  const T = (x, y, z = 0) => new THREE.Vector3(x, z, -y);       // field (z up) -> three (y up)

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('shot') });
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
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallM); m.position.copy(T(x, y, 2)); scene.add(m);
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
      const p = new THREE.Mesh(new THREE.BoxGeometry(1, z - 2.4, 1), postM); p.position.copy(T(px, py, (z - 2.4) / 2)); scene.add(p);
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
  const buf = new Uint8Array(RW * 4 * RH * 4);
  // Lens lookup: strip pixel -> pinhole render pixel, plus the dark, yellow, hot-centred sensor look
  // the report describes (p43). Built once.
  const lut = new Int32Array(SW * SH), vig = new Float32Array(CAM.W * SH);
  for (let v = 0; v < SH; v++) for (let u = 0; u < SW; u++) {
    const ci = Math.floor(u / CAM.W), lu = u - ci * CAM.W;
    const n = undistort((lu + 0.5 - CAM.cx) / CAM.fx, (v + 0.5 - CAM.cy) / CAM.fy);
    let k = -1;
    if (n && Math.abs(n[0]) < XR && Math.abs(n[1]) < YR) {
      const rx = Math.floor((n[0] / XR * 0.5 + 0.5) * RW), ry = Math.floor((n[1] / YR * 0.5 + 0.5) * RH);
      k = ((RH - 1 - ry) * RW * 4 + ci * RW + rx) * 4;
    }
    lut[v * SW + u] = k;
  }
  for (let v = 0; v < SH; v++) for (let u = 0; u < CAM.W; u++) {
    const dx = (u - CAM.cx) / CAM.cx, dy = (v - CAM.cy) / CAM.cx;
    vig[v * CAM.W + u] = 0.22 + 1.05 * Math.exp(-(dx * dx + dy * dy) / 0.16);
  }
  const raw = new Uint8ClampedArray(SW * SH * 4);
  const noise = new Float32Array(SW * SH); for (let i = 0; i < noise.length; i++) noise[i] = (((i * 2654435761) >>> 0) / 4294967296 - 0.5) * 3;   // sensor noise, fixed

  function renderCams() {
    const bg = scene.background; scene.background = null;
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
    renderer.readRenderTargetPixels(rt, 0, 0, RW * 4, RH, buf);
    renderer.setRenderTarget(null); scene.background = bg;
    // Sensor: dark, yellow cast, bright radial hotspot.
    for (let v = 0, j = 0; v < SH; v++) for (let u = 0; u < SW; u++, j += 4) {
      const k = lut[v * SW + u];
      if (k < 0) { raw[j] = raw[j + 1] = raw[j + 2] = 0; raw[j + 3] = 255; continue; }
      const g = vig[v * CAM.W + (u % CAM.W)] * 0.55;
      const nz = noise[v * SW + u]; raw[j] = buf[k] * g + nz; raw[j + 1] = buf[k + 1] * g * 0.84 + nz; raw[j + 2] = buf[k + 2] * g * 0.4 + nz; raw[j + 3] = 255;
    }
  }

  // ---------- pipeline ----------
  let R = null, wb = null, boxes = [], est = [];
  function pipeline() {
    const tp0 = performance.now();
    renderCams();
    wb = whiteBalance(raw, SW, SH);
    R = retinex(wb, SW, SH);
    boxes = detect(R.out, SW, SH, CAM.W, 3);
    est = boxes.map(b => {
      const c = CAMS[b.cam], p = pixelToField((b.x0 + b.x1) / 2, b.y1, pose, c);
      const ct = Math.cos(pose.th), st = Math.sin(pose.th);
      const from = { x: pose.x + ct * c.ox - st * c.oy, y: pose.y + st * c.ox + ct * c.oy };
      if (!p || p.above) {
        const n = p ? [p.xn] : [0], ang = pose.th + c.psi + Math.atan(-n[0]);
        return { b, drop: true, from, dir: ang };
      }
      const drop = !onField(p);
      return { b, drop, from, x: p.x, y: p.y, dir: Math.atan2(p.y - from.y, p.x - from.x) };
    });
    drawStrip(); drawMap(); report();
    if (params.has('shot')) root.dataset.debug = JSON.stringify({ ms: Math.round(performance.now() - tp0), est: est.map(e => e.drop ? ['drop', e.b.color, e.b.cam] : [e.b.color, e.b.cam, +e.x.toFixed(1), +e.y.toFixed(1), ...(() => { let bd = 1e9; for (const b of blocks) if (b.color === e.b.color) bd = Math.min(bd, Math.hypot(b.x - e.x, b.y - e.y)); return [+bd.toFixed(1)]; })()]) });
  }

  // ---------- camera strip ----------
  const sctx = strip.getContext('2d');
  let grid = false;
  function layoutStrip() {
    const g = strip.clientWidth > 0 && strip.parentElement.clientWidth < 700;
    if (g !== grid || !strip.dataset.l) { grid = g; strip.dataset.l = '1'; strip.width = grid ? CAM.W * 2 : SW; strip.height = grid ? SH * 2 : SH; strip.classList.toggle('mq-grid', grid); drawStrip(); }
  }
  const tileXY = (i) => grid ? [(i % 2) * CAM.W, Math.floor(i / 2) * SH] : [i * CAM.W, 0];
  const img = new ImageData(CAM.W, SH);
  function drawStrip() {
    if (!R) return;
    const st = getStage();
    for (let i = 0; i < 4; i++) {
      const d = img.data;
      for (let v = 0; v < SH; v++) for (let u = 0; u < CAM.W; u++) {
        const s = v * SW + i * CAM.W + u, j = (v * CAM.W + u) * 4, k = s * 4;
        if (st === 'illum') { const l = R.L[s]; d[j] = d[j + 1] = d[j + 2] = l; }
        else { const src = st === 'raw' ? raw : st === 'wb' ? wb : R.out; d[j] = src[k]; d[j + 1] = src[k + 1]; d[j + 2] = src[k + 2]; }
        d[j + 3] = 255;
      }
      const [ox, oy] = tileXY(i); sctx.putImageData(img, ox, oy);
    }
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
      let best = null, bd = 18;
      for (const b of blocks) { if (b.in || b.color !== e.b.color) continue; const dd = Math.hypot(b.x - e.x, b.y - e.y); if (dd < bd) { bd = dd; best = b; } }
      if (best) { ctx.strokeStyle = ink; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.moveTo(X(best.x), Y(best.y)); ctx.lineTo(X(e.x), Y(e.y)); ctx.stroke(); }
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), 3.2, 0, 7); ctx.fill();
    }
  }
  function rayExit(p, a) {
    const dx = Math.cos(a), dy = Math.sin(a); let t = 1e9;
    if (dx > 1e-6) t = Math.min(t, (HALF - p.x) / dx); if (dx < -1e-6) t = Math.min(t, (-HALF - p.x) / dx);
    if (dy > 1e-6) t = Math.min(t, (HALF - p.y) / dy); if (dy < -1e-6) t = Math.min(t, (-HALF - p.y) / dy);
    return Math.max(0, t);
  }

  function report() {
    const on = est.filter(e => !e.drop).length, off = est.length - on;
    shell.say(`${on} detection${on === 1 ? '' : 's'} on the floor.` + (off ? ` ${off} landed off the field and ${off === 1 ? 'was' : 'were'} dropped.` : ''));
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
      if (now - lastPipe >= 120) { needPipe = false; lastPipe = now; pipeline(); needMain = true; }
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
  if (params.has('goaltest')) {          // screenshot check only: two blocks lifted into a goal and a loader
    const put = (b, t, x) => { b.in = t; t.n++; b.x = t.kind === 'loader' ? t.cx : x; b.y = t.cy; b.z = t.z; placeBlock(b); };
    put(blocks[1], targets[0], -8); put(blocks[3], targets.find(t => t.kind === 'loader'));
  }
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
