// RBE-3001 arm demo: OpenManipulator-X + fixed camera + live colour detection + IK sorting / tic-tac-toe.
// Embed: <div data-arm3d></div> and load this file as a module (needs an import map for "three").
import { ik, fk, URDF } from './ik.js';
import * as V from './vision.js';
import { bestMove, winner } from './ttt.js';
import { createShell, h } from '../demo-shell.js';

const HERE = new URL('.', import.meta.url);
const K = V.INTRINSICS, BALL_R = 0.012, BOARD_TOP = V.BOARD.origin[2];
const RGB = { red: 0xb81d1d, orange: 0xe8651a, yellow: 0xe9bd22, green: 0x1d8a45 };
const LABEL = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green' };
// Camera pose estimated from the lab photos: on a stand beyond the far edge of the board,
// opposite the arm, about 21 cm up, tilted ~44 degrees down toward the board.
const CAM_C = [0.36, 0, 0.21], CAM_T = [0.12, 0, 0.02];
const ZONES = { red: [0.0, -0.175], orange: [0.075, -0.175], yellow: [0.0, 0.175], green: [0.075, 0.175] };
const SLOTS = [[-0.014, -0.014], [0.014, -0.014], [-0.014, 0.014], [0.014, 0.014], [0, 0]];
const TRAY = [[-0.03, 0.175], [0.005, 0.175], [0.04, 0.175], [0.075, 0.175], [0.11, 0.175]];
const CELL = (i) => [0.05 + 0.05 * Math.floor(i / 3), 0.075 + 0.05 * (i % 3)];    // board frame, m
const PARK = [0, -0.6, 0.3, 1.2];                // high over the base: above every camera ray to the board
const GRIP_OPEN = 0.019, GRIP_BALL = 0.0035;
const LIGHTS = [
  { name: 'Normal', sun: 1.7, env: 0.8, col: 0xffffff, gain: 1.0, wb: [1, 1, 1], noise: 3 },
  { name: 'Dim', sun: 0.16, env: 0.1, col: 0xffffff, gain: 1.0, wb: [1, 1, 1], noise: 12 },
  { name: 'Warm', sun: 1.5, env: 0.6, col: 0xffc690, gain: 1.0, wb: [1.18, 0.96, 0.7], noise: 3 },
];

const el = h;

export function mount(root) {
  if (root.dataset.mounted) return; root.dataset.mounted = '1';
  const api = { colour: 'red', stage: 4, mode: 'sort' };
  const ui = { api };
  const shell = createShell(root, {
    id: 'arm', label: 'Robot arm, checkerboard and camera',
    viewLabel: '3D view of the arm, board and camera. Drag to rotate, drag a ball to move it, click the board to place a ball. In tic-tac-toe, keys 1 to 9 place your ball.',
    scenes: [{ id: 'sort', label: 'Sort balls' }, { id: 'ttt', label: 'Play tic-tac-toe' }], scene: 'sort',
    onScene: (id) => { api.mode = id; api.setMode ? api.setMode(id) : buildFlow(id); },
    side: true, sideLabel: 'Camera stage',
    views: ['Raw', 'Undistorted', 'Board mask', 'Colours', 'Detections'].map((l, i) => ({ id: String(i), label: l })), view: '4',
    onView: (id) => { api.stage = +id; api.redraw && api.redraw(); },
  });
  ui.shell = shell; ui.view = shell.view;
  ui.loading = el('p', { class: 'ds-loading', text: 'Loading 3D model' });
  ui.view.append(ui.loading);
  // Colour choice for placing balls (part of the first flow step)
  ui.colours = V.COLORS.map(c => el('button', { type: 'button', 'aria-pressed': String(c === 'red'), 'aria-label': `${LABEL[c]} balls`, onclick: () => pickColour(c) },
    el('span', { class: 'ds-sw', style: `background:#${RGB[c].toString(16).padStart(6, '0')}` }), LABEL[c]));
  ui.place = el('span', { class: 'ds-step' }, 'Place balls ', el('span', { class: 'ds-group', role: 'group', 'aria-label': 'Ball colour to place' }, ...ui.colours));
  function buildFlow(m) {
    if (m === 'sort') {
      const b = shell.setFlow([{ node: ui.place, id: 'place' }, { primary: 'Sort', id: 'sort', onClick: () => api.runSort && api.runSort() }],
        [{ label: 'Scatter', id: 'scatter', onClick: () => api.scatter && api.scatter() }, { label: 'Reset', id: 'reset', onClick: () => api.reset && api.reset() }]);
      ui.sort = b.sort; ui.scatter = b.scatter; ui.reset = b.reset;
    } else {
      const b = shell.setFlow([{ step: 'Your move: click a square', id: 'human' }, { step: 'Arm’s move', id: 'arm' }],
        [{ label: 'New game', id: 'reset', onClick: () => api.reset && api.reset() }]);
      ui.sort = ui.scatter = null; ui.reset = b.reset;
    }
  }
  ui.buildFlow = buildFlow;
  // Camera inset
  ui.canvas = el('canvas', { width: K.W, height: K.H, role: 'img', 'aria-label': 'Camera image at the selected pipeline stage' });
  shell.sideBody.append(ui.canvas);
  // Details
  ui.light = el('button', { type: 'button', text: 'Lighting: Normal', onclick: () => api.cycleLight && api.cycleLight() });
  ui.nudge = el('button', { type: 'button', text: 'Nudge camera', onclick: () => api.nudge && api.nudge() });
  ui.recal = el('button', { type: 'button', text: 'Recalibrate', onclick: () => api.recal && api.recal() });
  ui.balls = el('ol', { 'aria-live': 'off' });
  ui.joints = el('p'); ui.ikline = el('p'); ui.calline = el('p');
  ui.frames = el('input', { type: 'checkbox' });
  const R = K.raw;
  shell.detailsBody.prepend(
    el('p', { text: 'Detected balls (pixel, board, base frame):' }), ui.balls, ui.joints, ui.ikline, ui.calline,
    el('p', { text: `Camera model: fisheye, Kannala-Brandt, f ${R.f} px, centre (${R.cx}, ${R.cy}), k1 ${R.k[0]}, k2 ${R.k[1]}, field of view ${Math.round(2 * R.thetaMax * 180 / Math.PI)}°, ${K.W} × ${K.H} px. Undistorted image: pinhole, fx ${K.fx}, fy ${K.fy}. Board: 7 × 10 squares of 25 mm, origin (${V.BOARD.origin.join(', ')}) m in the arm base frame.` }),
    el('div', { class: 'ds-more' }, ui.light, ui.nudge, ui.recal),
    el('label', { class: 'ds-check' }, ui.frames, 'Show frames (camera, board, arm base)'));
  buildFlow('sort');
  shell.coach('sort', [
    { key: 'place', text: 'Runs in your browser. Click the board to place a ball.', target: () => ui.view, at: [0.45, 0.62] },
    { key: 'drag', text: 'Drag a ball to move it.', target: () => ui.view, at: [0.45, 0.62] },
    { key: 'sort', text: 'Press Sort.', target: () => ui.sort },
  ]);
  shell.coach('ttt', [
    { key: 'move', text: 'Runs in your browser. Click a square to place a green ball.', target: () => ui.view, at: [0.45, 0.62] },
  ]);
  const io = new IntersectionObserver((es) => {
    if (es.some(e => e.isIntersecting)) { io.disconnect(); start(root, ui).catch(err => { ui.loading.textContent = 'Could not load the 3D view.'; console.error(err); }); }
  }, { rootMargin: '300px' });
  io.observe(root);
  function pickColour(c) { ui.colours.forEach((b, i) => b.setAttribute('aria-pressed', String(V.COLORS[i] === c))); api.colour = c; api.onColour && api.onColour(); }
}

async function start(root, ui) {
  const api = ui.api;
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const { toCreasedNormals } = await import('three/addons/utils/BufferGeometryUtils.js');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const params = new URLSearchParams(location.search);
  let dirty = true;
  // ?shot: drive frames with timers (headless screenshots throttle requestAnimationFrame).
  const raf = params.has('shot') ? (f) => setTimeout(() => f(performance.now()), 33) : (f) => requestAnimationFrame(f);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('shot') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  ui.view.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const view = new THREE.PerspectiveCamera(32, 1.6, 0.02, 10);
  view.layers.enable(1);
  view.position.set(0.62, 0.5, 0.62);
  const controls = new OrbitControls(view, renderer.domElement);
  controls.target.set(0.13, 0.1, 0.0);
  controls.enableDamping = true; controls.minDistance = 0.3; controls.maxDistance = 1.8; controls.maxPolarAngle = Math.PI * 0.48;
  controls.update();

  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(0.3, 1.2, 0.5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 3 });
  sun.shadow.camera.layers.enable(1); sun.shadow.bias = -0.0004; sun.shadow.radius = 3; scene.add(sun);

  const ros = new THREE.Group(); ros.rotation.x = -Math.PI / 2; scene.add(ros); ros.updateMatrixWorld();
  const toWorld = (p) => new THREE.Vector3(p[0], p[2], -p[1]);
  const toRos = (v) => [v.x, -v.z, v.y];
  const helpers = [];                                         // layer 1: main view only, never seen by the camera
  const helper = (o) => { o.traverse(c => c.layers.set(1)); helpers.push(o); return o; };

  // Table, black base plate, checkerboard (7 x 10, 25 mm) as in the lab photos
  const tableMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.4), tableMat); table.position.set(0.15, 0, -0.004); table.receiveShadow = true; ros.add(table);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.004), new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.35 }));
  plate.position.set(0.16, 0, -0.002); plate.receiveShadow = true; ros.add(plate);
  const cv = document.createElement('canvas'); cv.width = 70 * 8; cv.height = 100 * 8;
  const cx = cv.getContext('2d');
  for (let i = 0; i < 7; i++) for (let j = 0; j < 10; j++) { cx.fillStyle = (i + j) % 2 ? '#e9e8e4' : '#1b1b1b'; cx.fillRect(i * 80, j * 80, 80, 80); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  // Square (i, j) has board coords [i*25, (i+1)*25] x [j*25, (j+1)*25] mm. The plane is laid in ros x/y.
  const boardGeo = new THREE.PlaneGeometry(V.BOARD.Lx, V.BOARD.Ly);
  const uv = boardGeo.attributes.uv;
  for (let k = 0; k < uv.count; k++) { const u = uv.getX(k), v = uv.getY(k); uv.setXY(k, u, 1 - v); }   // u along x, v along y (row 0 at y=0)
  const board = new THREE.Mesh(boardGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }));
  // canvas x (i) -> board x, canvas y (j) -> board y
  board.position.set(V.BOARD.origin[0] + V.BOARD.Lx / 2, V.BOARD.origin[1] + V.BOARD.Ly / 2, BOARD_TOP); board.receiveShadow = true; ros.add(board);
  const boardEdge = new THREE.Mesh(new THREE.BoxGeometry(V.BOARD.Lx + 0.012, V.BOARD.Ly + 0.012, 0.0019), new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.8 }));
  boardEdge.position.set(board.position.x, board.position.y, 0.001); boardEdge.receiveShadow = true; ros.add(boardEdge);

  // Sorting areas (four marked mats) and tic-tac-toe supply tray
  const zoneGroup = new THREE.Group(); ros.add(zoneGroup);
  for (const c of V.COLORS) {
    const [x, y] = ZONES[c];
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.062, 0.0012), new THREE.MeshStandardMaterial({ color: RGB[c], roughness: 0.8 }));
    m.position.set(x, y, 0.0006); m.receiveShadow = true; zoneGroup.add(m);
  }
  const trayGroup = new THREE.Group(); ros.add(trayGroup); trayGroup.visible = false;
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.175, 0.03, 0.003), new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.7 }));
  tray.position.set(0.04, 0.175, 0.0015); tray.receiveShadow = true; trayGroup.add(tray);
  // 3x3 grid outline, main view only (the real board had no lines; the camera never sees these)
  const gridLines = (() => {
    const pts = [], o = V.BOARD.origin;
    for (let k = 0; k <= 3; k++) {
      const x = 0.025 + 0.05 * k, y = 0.05 + 0.05 * k;
      pts.push(new THREE.Vector3(o[0] + x, o[1] + 0.05, 0.0035), new THREE.Vector3(o[0] + x, o[1] + 0.2, 0.0035));
      pts.push(new THREE.Vector3(o[0] + 0.025, o[1] + y, 0.0035), new THREE.Vector3(o[0] + 0.175, o[1] + y, 0.0035));
    }
    return helper(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x8a8f98 })));
  })();
  gridLines.visible = false; ros.add(gridLines);

  // Arm, chained exactly as in the URDF
  const servoMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.62, metalness: 0.05 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.55, metalness: 0.05 });
  const palmMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3f, roughness: 0.5 });
  const loader = new STLLoader();
  const loadMesh = async (name, mat, parent, offset = [0, 0, 0]) => {
    let g = await loader.loadAsync(new URL(`meshes/${name}.stl`, HERE).href);
    g.scale(0.001, 0.001, 0.001); g = toCreasedNormals(g, Math.PI / 6);
    const m = new THREE.Mesh(g, mat); m.position.set(...offset); m.castShadow = m.receiveShadow = true; parent.add(m);
  };
  const joint = (parent, xyz) => { const g = new THREE.Group(); g.position.set(...xyz); parent.add(g); return g; };
  const base = new THREE.Group(); ros.add(base);
  const J1 = joint(base, URDF.j1.xyz), J2 = joint(J1, URDF.j2.xyz), J3 = joint(J2, URDF.j3.xyz), J4 = joint(J3, URDF.j4.xyz);
  const GL = joint(J4, URDF.gripper.xyz), GR = joint(J4, [URDF.gripper.xyz[0], -URDF.gripper.xyz[1], 0]);
  const EE = joint(J4, URDF.ee.xyz);
  // Fixed camera: body on a conical stand, as in the photos (main view only; the render camera sits inside it)
  const camRig = new THREE.Group(); ros.add(camRig);
  const blackMat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.5 });
  const camBody = new THREE.Group(); camRig.add(camBody);
  { const box = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.026), blackMat); box.position.z = -0.013; camBody.add(box);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.012, 24), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.25, metalness: 0.3 }));
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.004; camBody.add(lens);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.004, 0.03), blackMat); yoke.position.set(0, 0.02, -0.013); camBody.add(yoke); }
  const stand = new THREE.Group(); ros.add(stand);
  { const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.032, CAM_C[2] - 0.045, 32), blackMat);
    cone.rotation.x = Math.PI / 2; cone.position.set(CAM_C[0] + 0.012, 0, (CAM_C[2] - 0.045) / 2); stand.add(cone);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.006), blackMat); foot.position.set(CAM_C[0] + 0.012, 0, 0.003); stand.add(foot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 12), blackMat); post.rotation.x = Math.PI / 2; post.position.set(CAM_C[0] + 0.012, 0, CAM_C[2] - 0.035); stand.add(post); }
  stand.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  camBody.traverse(o => { if (o.isMesh) o.castShadow = true; });
  helper(camRig); helper(stand);

  // Frames (RGB = x, y, z)
  const frames = new THREE.Group(); ros.add(frames); frames.visible = false;
  const axes = (len) => { const a = new THREE.AxesHelper(len); a.material.depthTest = false; a.renderOrder = 9; return a; };
  const fBase = axes(0.05); frames.add(fBase);
  const fBoard = axes(0.04); fBoard.position.set(...V.BOARD.origin); frames.add(fBoard);
  const fCam = axes(0.04); frames.add(fCam);
  helper(frames);
  ui.frames.addEventListener('change', () => { frames.visible = ui.frames.checked; dirty = true; });

  await Promise.all([
    loadMesh('link1', servoMat, base), loadMesh('link2', frameMat, J1, [0, 0, 0.019]),
    loadMesh('link3', servoMat, J2), loadMesh('link4', servoMat, J3), loadMesh('link5', frameMat, J4),
    loadMesh('gripper_left_palm', palmMat, GL), loadMesh('gripper_right_palm', palmMat, GR),
  ]);
  ui.loading.remove();
  ui.shell.startCoach();

  // ---------- balls ----------
  const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 20);
  const ballMats = Object.fromEntries(V.COLORS.map(c => [c, new THREE.MeshStandardMaterial({ color: RGB[c], roughness: 0.55 })]));
  const balls = [];
  function addBall(colour, x, y, where = 'board') {
    const m = new THREE.Mesh(ballGeo, ballMats[colour]); m.castShadow = true; m.receiveShadow = true;
    m.userData = { colour, where }; ros.add(m); placeBall(m, x, y); balls.push(m); dirty = true; return m;
  }
  function onBoard(x, y) { const b = V.baseToBoard([x, y]); return b[0] >= 0 && b[1] >= 0 && b[0] <= V.BOARD.Lx && b[1] <= V.BOARD.Ly; }
  function placeBall(m, x, y) { m.position.set(x, y, (onBoard(x, y) ? BOARD_TOP : 0) + BALL_R); }
  function removeBall(m) { ros.remove(m); balls.splice(balls.indexOf(m), 1); dirty = true; }
  const free = (x, y, ignore) => balls.every(b => b === ignore || b.parent !== ros || Math.hypot(b.position.x - x, b.position.y - y) > 2.3 * BALL_R);

  // ---------- virtual camera + pipeline ----------
  let camPose = { C: [...CAM_C], T: [...CAM_T] };
  let cam = V.makeCamera(camPose.C, camPose.T);
  const MX = 48, MY = 36, WP = K.W + 2 * MX, HP = K.H + 2 * MY;
  const vcam = new THREE.PerspectiveCamera(); vcam.matrixAutoUpdate = false; vcam.layers.set(0);
  { const n = 0.01, f = 3;
    vcam.projectionMatrix.set(2 * K.fx / WP, 0, 1 - 2 * (K.cx + MX) / WP, 0, 0, 2 * K.fy / HP, 2 * (K.cy + MY) / HP - 1, 0, 0, 0, -(f + n) / (f - n), -2 * f * n / (f - n), 0, 0, -1, 0);
    vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert(); }
  function applyCamPose() {
    cam = V.makeCamera(camPose.C, camPose.T);
    const [r, d, f] = cam.R, w = (v) => new THREE.Vector3(v[0], v[2], -v[1]);
    const m = new THREE.Matrix4().makeBasis(w(r), w(d).negate(), w(f).negate()); m.setPosition(toWorld(cam.C));
    vcam.matrix.copy(m); vcam.updateMatrixWorld(true);
    const local = new THREE.Matrix4().makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...d), new THREE.Vector3(...f)).setPosition(...cam.C);
    camBody.matrixAutoUpdate = false; camBody.matrix.copy(local); fCam.matrixAutoUpdate = false; fCam.matrix.copy(local);
    camBody.updateMatrixWorld(true); fCam.updateMatrixWorld(true); dirty = true;
  }
  applyCamPose();
  const rtP = new THREE.WebGLRenderTarget(WP, HP, { type: THREE.HalfFloatType, samples: 4 });
  const rtD = new THREE.WebGLRenderTarget(K.W, K.H, { type: THREE.UnsignedByteType, depthBuffer: false });
  const warpMat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: rtP.texture }, k: { value: new THREE.Vector4(K.fx, K.fy, K.cx, K.cy) }, dist: { value: new THREE.Vector2(K.k1, K.k2) },
      size: { value: new THREE.Vector4(K.W, K.H, WP, HP) }, margin: { value: new THREE.Vector2(MX, MY) }, gain: { value: 1 }, wb: { value: new THREE.Vector3(1, 1, 1) }, noise: { value: 3 / 255 }, seed: { value: 0 } },
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tex; uniform vec4 k; uniform vec2 dist; uniform vec4 size; uniform vec2 margin; uniform float gain, noise, seed; uniform vec3 wb;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
      void main(){
        // distorted pixel (v down) -> normalised, undistort by fixed-point iteration -> pinhole sample
        vec2 pd = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
        vec2 xd = (pd - k.zw) / k.xy, x = xd;
        for (int i = 0; i < 12; i++) { float r2 = dot(x, x); x = xd / (1.0 + dist.x * r2 + dist.y * r2 * r2); }
        vec2 pp = x * k.xy + k.zw + margin;
        vec3 c = texture2D(tex, vec2(pp.x / size.z, 1.0 - pp.y / size.w)).rgb * gain * wb;
        c = c / (1.0 + 0.15 * c);                                    // gentle highlight roll-off
        c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));                 // sensor gamma
        float n1 = hash(gl_FragCoord.xy), n2 = hash(gl_FragCoord.yx + 3.1);
        c += noise * sqrt(-2.0 * log(max(n1, 1e-4))) * cos(6.2831 * n2) * vec3(1.0);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const warpScene = new THREE.Scene(); warpScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warpMat));
  const orth = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const N = K.W * K.H, readBuf = new Uint8Array(N * 4), raw = new Uint8ClampedArray(N * 4), und = new Uint8ClampedArray(N * 4), labels = new Uint8Array(N);
  const lut = V.buildUndistortLUT(K);
  const ctx = ui.canvas.getContext('2d'), imgData = ctx.createImageData(K.W, K.H);
  let cal = null, mask = null, calInfo = '', frame = { blobs: [] }, lastErr = {};

  function capture() {
    const bg = scene.background; scene.background = new THREE.Color(0x3a3530);   // the lab behind the board
    renderer.setRenderTarget(rtP); renderer.render(scene, vcam);
    warpMat.uniforms.seed.value = (warpMat.uniforms.seed.value + 1.618) % 100;
    renderer.setRenderTarget(rtD); renderer.render(warpScene, orth);
    renderer.readRenderTargetPixels(rtD, 0, 0, K.W, K.H, readBuf);
    renderer.setRenderTarget(null); scene.background = bg;
    for (let j = 0; j < K.H; j++) raw.set(readBuf.subarray((K.H - 1 - j) * K.W * 4, (K.H - j) * K.W * 4), j * K.W * 4);
    V.undistortImage(raw, und, lut, K.W, K.H);
  }
  function setCal(c, info) { cal = c; mask = V.boardMask(cal, K.W, K.H); calInfo = info; }
  function calibrate(predict, hideBalls) {
    const vis = balls.map(b => b.visible); if (hideBalls) balls.forEach(b => b.visible = false);
    const armVis = base.visible; if (hideBalls) base.visible = false;
    capture();
    balls.forEach((b, i) => b.visible = vis[i]); base.visible = armVis;
    const r = V.calibrateFromImage(und, K, predict);
    if (r) setCal(r.cal, `Homography from ${r.used} of ${r.total} checkerboard corners, reprojection RMS ${r.rms.toFixed(2)} px.`);
    return r;
  }
  // Initial calibration on the empty board (as with MATLAB's calibrator), seeded roughly from the
  // known mounting (a few pixels off, like clicking the board corners), then refined on the image.
  calibrate((b) => { const p = V.project(cam, V.boardToBase(b), false); return [p[0] + 2.5, p[1] - 2]; }, true);
  const cal0 = cal, calInfo0 = calInfo;

  function process() {
    capture();
    frame = V.detect(und, mask, cal, K, BALL_R, labels);
    frame.t = performance.now();
    // Error vs truth (for the readout only; the arm never uses this).
    const truth = balls.filter(b => b.parent === ros && onBoard(b.position.x, b.position.y));
    frame.missing = truth.filter(b => !frame.blobs.some(d => d.ok && d.colour === b.userData.colour && Math.hypot(d.base[0] - b.position.x, d.base[1] - b.position.y) < 0.03));
    for (const d of frame.blobs) {
      let best = null, bd = 0.03;
      for (const b of truth) if (b.userData.colour === d.colour) { const e = Math.hypot(d.base[0] - b.position.x, d.base[1] - b.position.y); if (e < bd) { bd = e; best = b; } }
      d.err = best ? bd * 1000 : null;
    }
    drawInset(); writeReadout();
    if (mode === 'ttt') tttTick();
  }
  const PAL = [[0, 0, 0], [215, 40, 40], [240, 120, 30], [235, 200, 40], [40, 170, 80]];
  function drawInset() {
    const d = imgData.data, st = api.stage;
    if (st === 0) d.set(raw);
    else if (st === 1 || st === 4) d.set(und);
    else if (st === 2) { for (let p = 0; p < N; p++) { const m = mask[p]; d[4 * p] = und[4 * p] * m; d[4 * p + 1] = und[4 * p + 1] * m; d[4 * p + 2] = und[4 * p + 2] * m; d[4 * p + 3] = 255; } }
    else { for (let p = 0; p < N; p++) { const c = PAL[labels[p]], m = mask[p] ? 28 : 0; d[4 * p] = labels[p] ? c[0] : m; d[4 * p + 1] = labels[p] ? c[1] : m; d[4 * p + 2] = labels[p] ? c[2] : m; d[4 * p + 3] = 255; } }
    if (st === 4) {
      for (const b of frame.blobs) {
        const col = b.ok ? [255, 255, 255] : [150, 150, 150];
        for (let k = 0; k < b.edge.length; k += 2) { const o = 4 * (b.edge[k + 1] * K.W + b.edge[k]); d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    if (st !== 4) return;
    ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top';
    if (mode === 'ttt') {        // detected 3x3 grid, projected through the current calibration
      ctx.strokeStyle = 'rgba(80,160,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let k = 0; k <= 3; k++) {
        const x = 0.025 + 0.05 * k, y = 0.05 + 0.05 * k;
        let a = V.applyH(cal.H, x, 0.05), b = V.applyH(cal.H, x, 0.2); ctx.moveTo(...a); ctx.lineTo(...b);
        a = V.applyH(cal.H, 0.025, y); b = V.applyH(cal.H, 0.175, y); ctx.moveTo(...a); ctx.lineTo(...b);
      }
      ctx.stroke();
      ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const s = ttt.seen || '.........';
      for (let i = 0; i < 9; i++) if (s[i] !== '.') { const p = V.applyH(cal.H, ...CELL(i)); ctx.fillStyle = '#fff'; ctx.fillText(s[i] === 'X' ? 'X' : 'O', p[0] + 16, p[1] - 12); }
      ctx.textAlign = 'left'; ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top';
    }
    for (const b of frame.blobs) {
      ctx.strokeStyle = b.ok ? '#fff' : '#999'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.u - 5, b.v); ctx.lineTo(b.u + 5, b.v); ctx.moveTo(b.u, b.v - 5); ctx.lineTo(b.u, b.v + 5); ctx.stroke();
      const txt = b.ok ? `${LABEL[b.colour]} (${b.u.toFixed(0)}, ${b.v.toFixed(0)}) → ${(b.boardC[0] * 1000).toFixed(0)}, ${(b.boardC[1] * 1000).toFixed(0)} mm` : `${LABEL[b.colour]}: area ${b.area}px rejected`;
      // Labels alternate above and below the blob so neighbours don't overlap.
      const below = (frame.blobs.indexOf(b) % 2) === 1;
      const w = ctx.measureText(txt).width, x = Math.max(2, Math.min(K.W - w - 4, b.u - w / 2)), y = below ? Math.min(K.H - 14, b.v + 14) : Math.max(2, b.v - 26);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 2, y - 1, w + 4, 14); ctx.fillStyle = '#fff'; ctx.fillText(txt, x, y);
    }
  }
  function writeReadout() {
    const lines = [];
    const ok = frame.blobs.filter(b => b.ok).sort((a, b) => a.v - b.v);
    for (const b of ok) {
      const cur = sorting.current && Math.hypot(sorting.current[0] - b.base[0], sorting.current[1] - b.base[1]) < 0.01;
      lines.push(`${cur ? '→ ' : ''}${LABEL[b.colour]}  u ${b.u.toFixed(0)} v ${b.v.toFixed(0)} → board ${(b.boardC[0] * 1000).toFixed(0)}, ${(b.boardC[1] * 1000).toFixed(0)} mm → base ${b.base[0].toFixed(3)}, ${b.base[1].toFixed(3)} m${b.err != null ? `, ${b.err.toFixed(1)} mm from true` : ''}`);
    }
    for (const b of frame.blobs.filter(b => !b.ok)) lines.push(`${LABEL[b.colour]} blob rejected: area ${b.area} px, expected about ${(b.area / b.ratio).toFixed(0)}`);
    for (const m of frame.missing) if (!frame.blobs.some(d => d.ok && d.colour === m.userData.colour && d.err != null)) lines.push(`${LABEL[m.userData.colour]} ball on the board not detected`);
    if (!lines.length) lines.push('No balls detected on the board.');
    const html = lines.slice(0, 9).map(l => `<li>${l}</li>`).join('');
    if (ui.balls.innerHTML !== html) ui.balls.innerHTML = html;
  }

  // ---------- arm ----------
  let q = [...PARK], grip = 0.01, busy = false, held = null, lastIK = null;
  function applyPose() {
    J1.rotation.set(0, 0, q[0]); J2.rotation.set(0, q[1], 0); J3.rotation.set(0, q[2], 0); J4.rotation.set(0, q[3], 0);
    GL.position.y = URDF.gripper.xyz[1] + grip; GR.position.y = -URDF.gripper.xyz[1] - grip; dirty = true;
    if (!ui.details.hidden) {
      ui.joints.textContent = `Joint angles: ${q.map((v, i) => `q${i + 1} ${(v * 180 / Math.PI).toFixed(1)}°`).join(', ')}; gripper ${(grip * 1000).toFixed(1)} mm (URDF range −11 to 20 mm).`;
      ui.ikline.textContent = lastIK ? `IK target: ${lastIK.p.map(v => v.toFixed(3)).join(', ')} m, gripper ${lastIK.pitch}° below horizontal, ${lastIK.ok ? 'reachable' : 'out of reach'}.` : 'IK target: none yet.';
      ui.calline.textContent = calInfo;
    }
  }
  applyPose();
  const ease = (t) => t * t * (3 - 2 * t);
  const fast = params.has('fast');
  function moveTo(qGoal, gGoal = grip, speed = 1.3) {
    const q0 = [...q], g0 = grip;
    const dur = fast ? 0.01 : Math.max(0.3, Math.max(...qGoal.map((v, i) => Math.abs(v - q0[i]))) / speed, Math.abs(gGoal - g0) / 0.035);
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / 1000 / dur), e = ease(t);
        q = q0.map((v, i) => v + (qGoal[i] - v) * e); grip = g0 + (gGoal - g0) * e; applyPose();
        t < 1 ? raf(tick) : res();
      };
      raf(tick);
    });
  }
  const wait = (ms) => new Promise(r => setTimeout(r, fast ? 0 : ms));
  // Each waypoint from the IK. Straight down is preferred; where the wrist limit forbids it,
  // the steepest reachable pitch is used.
  function poseFor(p) {
    for (let d = 90; d >= 30; d -= 2) {
      const s = ik(p, d * Math.PI / 180, q);
      if (s.reachable) { lastIK = { p, pitch: d, ok: true }; return s.q; }
    }
    lastIK = { p, pitch: 90, ok: false };
    throw new Error('Out of reach');
  }
  const eeWorld = () => { const v = new THREE.Vector3(); EE.getWorldPosition(v); return toRos(v); };
  async function pickPlace(from, to, label) {
    // from/to: [x, y, ball-centre z] in the base frame. from comes from the camera.
    const up = 0.07, g = 0.014;
    const a1 = poseFor([from[0], from[1], from[2] + up]), a2 = poseFor([from[0], from[1], from[2] + g]);
    const b1 = poseFor([to[0], to[1], to[2] + up]), b2 = poseFor([to[0], to[1], to[2] + g]);
    await moveTo(a1, GRIP_OPEN);
    await moveTo(a2, GRIP_OPEN, 0.7);
    await moveTo(a2, GRIP_BALL);
    // The ball is grasped only if it is really between the fingers.
    const e = eeWorld();
    const ball = balls.filter(b => b.parent === ros).sort((x, y) => Math.hypot(x.position.x - e[0], x.position.y - e[1]) - Math.hypot(y.position.x - e[0], y.position.y - e[1]))[0];
    const off = ball ? Math.hypot(ball.position.x - e[0], ball.position.y - e[1]) : 1;
    if (!ball || off > 0.009) { await moveTo(a2, GRIP_OPEN); await moveTo(a1, GRIP_OPEN, 0.9); return { missed: true }; }
    held = ball; EE.attach(ball);
    await moveTo(a1, GRIP_BALL, 0.9);
    await moveTo(b1, GRIP_BALL, 1.1);
    await moveTo(b2, GRIP_BALL, 0.7);
    await moveTo(b2, GRIP_OPEN);
    ros.attach(ball); placeBall(ball, ball.position.x, ball.position.y); held = null;
    await moveTo(b1, GRIP_OPEN, 0.9);
    return { ball };
  }
  const park = () => moveTo(PARK, 0.01);

  // ---------- modes ----------
  let mode = 'sort';
  const sorting = { current: null };
  function status(t) { ui.status.textContent = t; }
  function setBusy(b) {
    busy = b;
    [ui.sort, ui.scatter, ui.reset, ui.modeSort, ui.modeTtt, ui.recal, ui.nudge].forEach(x => x.disabled = b);
  }
  function defaultBalls() {
    [...balls].forEach(removeBall);
    const set = [['red', 0.05, 0.06], ['orange', 0.12, 0.2], ['yellow', 0.1, 0.11], ['green', 0.055, 0.17], ['red', 0.14, 0.04], ['green', 0.13, 0.15]];
    for (const [c, bx, by] of set) { const p = V.boardToBase([bx, by]); addBall(c, p[0], p[1]); }
  }
  function scatter() {
    if (busy) return;
    [...balls].forEach(removeBall);
    const n = 6 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 200; tries++) {
        const p = V.boardToBase([0.035 + Math.random() * (V.BOARD.Lx - 0.055), 0.02 + Math.random() * (V.BOARD.Ly - 0.04)]);
        if (free(p[0], p[1])) { addBall(V.COLORS[k % 4], p[0], p[1]); break; }
      }
    }
    status('Balls scattered at random.');
  }
  async function waitSettled(frames = 3) {
    // Wait until the detections stop changing between camera frames.
    let prev = null, same = 0; const t0 = performance.now();
    while (performance.now() - t0 < 4000) {
      await new Promise(r => setTimeout(r, 90)); process();
      const sig = frame.blobs.filter(b => b.ok).map(b => `${b.colour}${Math.round(b.u)},${Math.round(b.v)}`).sort().join('|');
      if (prev !== null && sig === prev) { if (++same >= frames) break; } else same = 0;
      prev = sig;
    }
    return frame.blobs.filter(b => b.ok);
  }
  async function runSort() {
    if (busy || mode !== 'sort') return;
    setBusy(true);
    try {
      status('Moving the arm out of the camera view…');
      await park();
      status('Reading the board…');
      const seen = (await waitSettled()).map(b => ({ colour: b.colour, base: b.base }));
      if (!seen.length) { status('No balls detected on the board.'); return; }
      const count = { red: 0, orange: 0, yellow: 0, green: 0 }; balls.forEach(b => { if (b.userData.where === 'zone') count[b.userData.colour]++; });
      let done = 0, missed = 0;
      for (const [k, d] of seen.entries()) {
        sorting.current = d.base;
        status(`Sorting ${k + 1} of ${seen.length}: ${LABEL[d.colour].toLowerCase()} ball, detected at ${d.base[0].toFixed(3)}, ${d.base[1].toFixed(3)} m.`);
        const slot = SLOTS[count[d.colour] % SLOTS.length], z = ZONES[d.colour];
        try {
          const r = await pickPlace(d.base, [z[0] + slot[0], z[1] + slot[1], BALL_R], d.colour);
          if (r.missed) { missed++; continue; }
          r.ball.userData.where = 'zone'; count[d.colour]++; done++;
        } catch (e) { missed++; }
      }
      sorting.current = null;
      await park();
      status(`Sorted ${done} ball${done === 1 ? '' : 's'}${missed ? `; ${missed} missed (out of reach or not where the camera placed it)` : ''}.`);
    } finally { sorting.current = null; setBusy(false); }
  }
  // Tic-tac-toe, driven only by what the camera sees.
  const ttt = { accepted: '.........', seen: null, hist: [], phase: 'human', expect: null, over: false, pending: false, since: 0 };
  function readGrid() {
    const s = Array(9).fill('.'); let bad = false;
    for (const b of frame.blobs) {
      if (!b.ok || (b.colour !== 'green' && b.colour !== 'red')) continue;
      let best = -1, bd = 0.03;
      for (let i = 0; i < 9; i++) { const c = CELL(i), e = Math.hypot(b.boardC[0] - c[0], b.boardC[1] - c[1]); if (e < bd) { bd = e; best = i; } }
      if (best < 0) continue;
      if (s[best] !== '.') bad = true;
      s[best] = b.colour === 'green' ? 'X' : 'O';
    }
    return { s: s.join(''), bad, pts: frame.blobs.filter(b => b.ok).map(b => [b.u, b.v]) };
  }
  function tttTick() {
    const g = readGrid(); ttt.seen = g.s;
    ttt.hist.push(g); if (ttt.hist.length > 5) ttt.hist.shift();
    if (busy || ttt.over || ttt.hist.length < 5) return;
    // Settled: same grid state for 5 frames and no centroid moved more than 1.5 px.
    const first = ttt.hist[0];
    const still = ttt.hist.every(h => h.s === g.s && !h.bad && h.pts.length === first.pts.length) &&
      g.pts.every(p => first.pts.some(r => Math.hypot(p[0] - r[0], p[1] - r[1]) < 1.5));
    if (!still || g.s === ttt.accepted) return;
    const diff = [...g.s].map((c, i) => [c, ttt.accepted[i], i]).filter(([a, b]) => a !== b);
    if (ttt.phase === 'human') {
      if (diff.length === 1 && diff[0][0] === 'X' && diff[0][1] === '.') { ttt.accepted = g.s; ttt.pending = false; armTurn(); }
      else status('The board changed in a way that isn\'t one green move. Reset to start again.');
    } else if (ttt.phase === 'verify' && g.s === ttt.expect) { ttt.accepted = g.s; ttt.phase = 'human'; endCheck() || status('Your move.'); }
  }
  function endCheck() {
    const w = winner([...ttt.accepted].map(c => c === '.' ? null : c));
    if (!w) return false;
    ttt.over = true; status(w === 'draw' ? 'Draw.' : w === 'O' ? 'Arm wins.' : 'You win.');
    return true;
  }
  async function armTurn() {
    if (endCheck()) return;
    const b = [...ttt.accepted].map(c => c === '.' ? null : c);
    const m = bestMove(b);
    const supply = balls.filter(x => x.userData.where === 'tray');
    if (!supply.length) { status('The arm has no red balls left in its tray.'); return; }
    setBusy(true); ttt.phase = 'arm';
    status(`Camera saw your move. Minimax picks cell ${m + 1}.`);
    try {
      const s = supply[0], target = V.boardToBase(CELL(m), BALL_R);
      const r = await pickPlace([s.position.x, s.position.y, BALL_R], target);
      if (r.ball) r.ball.userData.where = 'board';
      await park();
      ttt.phase = 'verify'; ttt.expect = ttt.accepted.slice(0, m) + 'O' + ttt.accepted.slice(m + 1);
      status('Checking the board with the camera…');
    } catch (e) { status('That cell is out of reach for the arm.'); ttt.phase = 'human'; }
    setBusy(false);
  }
  function tttPlace(i) {
    if (mode !== 'ttt' || busy || ttt.over || ttt.phase !== 'human' || ttt.pending) return;
    const c = V.boardToBase(CELL(i));
    if (!free(c[0], c[1])) return;
    addBall('green', c[0] + (Math.random() - 0.5) * 0.006, c[1] + (Math.random() - 0.5) * 0.006);
    ttt.pending = true; status('Waiting for the camera to see a settled board…');
  }
  function tttReset() {
    [...balls].forEach(removeBall);
    TRAY.forEach(([x, y]) => addBall('red', x, y, 'tray'));
    Object.assign(ttt, { accepted: '.........', hist: [], phase: 'human', expect: null, over: false, pending: false });
    status('Board cleared instantly (the arm does not clear it). Your move.');
  }
  function setMode(m) {
    if (busy || m === mode) return;
    mode = m;
    ui.modeSort.setAttribute('aria-pressed', String(m === 'sort')); ui.modeTtt.setAttribute('aria-pressed', String(m === 'ttt'));
    ui.sortCtl.hidden = ui.sort.hidden = ui.scatter.hidden = m !== 'sort'; ui.tttNote.hidden = m !== 'ttt';
    zoneGroup.visible = m === 'sort'; trayGroup.visible = gridLines.visible = m === 'ttt';
    if (m === 'ttt') tttReset(); else { defaultBalls(); status(''); }
    dirty = true;
  }
  function reset() {
    if (busy) return;
    camPose = { C: [...CAM_C], T: [...CAM_T] }; applyCamPose(); setCal(cal0, calInfo0); nudges = 0; lightIdx = LIGHTS.length - 1; cycleLight();
    q = [...PARK]; grip = 0.01; applyPose();
    if (mode === 'ttt') tttReset(); else { defaultBalls(); status('Reset.'); }
  }
  // Perturbations
  let lightIdx = 0, nudges = 0;
  function cycleLight() {
    lightIdx = (lightIdx + 1) % LIGHTS.length; const L = LIGHTS[lightIdx];
    sun.intensity = L.sun; sun.color.set(L.col); scene.environmentIntensity = L.env;
    warpMat.uniforms.gain.value = L.gain; warpMat.uniforms.wb.value.set(...L.wb); warpMat.uniforms.noise.value = L.noise / 255;
    ui.light.textContent = `Lighting: ${L.name}`; dirty = true;
  }
  function nudge() {
    if (busy) return;
    nudges++;
    camPose.C = [camPose.C[0] + 0.004, camPose.C[1] + 0.003, camPose.C[2] - 0.002];
    camPose.T = [camPose.T[0], camPose.T[1] + 0.005, camPose.T[2]];
    applyCamPose();
    status(`Camera moved ${nudges} time${nudges > 1 ? 's' : ''}; calibration not re-run, so positions drift.`);
  }
  function recal() {
    if (busy) return;
    const r = calibrate((b) => V.applyH(cal.H, b[0], b[1]), false);
    status(r ? `Recalibrated from ${r.used} corners found in the current image.` : 'Recalibration failed: not enough checkerboard corners visible.');
    if (r) nudges = 0;
  }
  Object.assign(api, { setMode, runSort, scatter, reset, cycleLight, nudge, recal, redraw: drawInset });

  // ---------- pointer: orbit, drag balls, click to place ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const planeAt = (z) => new THREE.Plane(new THREE.Vector3(0, 1, 0), -z);
  let drag = null, down = null;
  const setRay = (e) => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, view); };
  const hitPlane = (z) => { const v = new THREE.Vector3(); return ray.ray.intersectPlane(planeAt(z), v) ? toRos(v) : null; };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    setRay(e);
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (busy) return;
    const hit = ray.intersectObjects(balls.filter(b => b.parent === ros && b.userData.where !== 'tray'), false)[0];
    if (hit) { drag = hit.object; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag) return;
    setRay(e); const p = hitPlane(BOARD_TOP + BALL_R);
    if (!p) return;
    const x = Math.max(-0.09, Math.min(0.41, p[0])), y = Math.max(-0.22, Math.min(0.22, p[1]));
    if (free(x, y, drag) && Math.hypot(x, y) > 0.05) { placeBall(drag, x, y); drag.userData.where = 'board'; dirty = true; }
  });
  const up = (e) => {
    if (drag) { drag = null; controls.enabled = true; return; }
    if (!down || busy) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 600) return;
    setRay(e); const p = hitPlane(BOARD_TOP); if (!p || !onBoard(p[0], p[1])) return;
    if (mode === 'sort') { if (balls.length < 12 && free(p[0], p[1])) { addBall(api.colour, p[0], p[1]); status(`${LABEL[api.colour]} ball placed.`); } }
    else {
      const b = V.baseToBoard(p); let best = -1, bd = 0.025;
      for (let i = 0; i < 9; i++) { const c = CELL(i), d = Math.max(Math.abs(b[0] - c[0]), Math.abs(b[1] - c[1])); if (d < bd) { bd = d; best = i; } }
      if (best >= 0) tttPlace(best);
    }
  };
  renderer.domElement.addEventListener('pointerup', up);
  renderer.domElement.addEventListener('pointercancel', () => { drag = null; controls.enabled = true; });
  ui.view.addEventListener('keydown', (e) => { if (mode === 'ttt' && /^[1-9]$/.test(e.key)) { tttPlace(+e.key - 1); e.preventDefault(); } });
  controls.listenToKeyEvents(ui.view);

  // ---------- theme, size, loop ----------
  function applyTheme() {
    const cs = getComputedStyle(root), paper = cs.getPropertyValue('--frame').trim() || (dark.matches ? '#1d1f21' : '#eeebe4');
    scene.background = new THREE.Color(paper);
    tableMat.color.set(dark.matches ? 0x3b3833 : 0xcfc6b6); dirty = true;
  }
  dark.addEventListener('change', applyTheme); applyTheme();
  function resize() { const w = ui.view.clientWidth, h = ui.view.clientHeight;  renderer.setSize(w, h, false); view.aspect = w / h; view.updateProjectionMatrix(); dirty = true; }
  new ResizeObserver(resize).observe(ui.view); resize();
  controls.addEventListener('change', () => { dirty = true; });
  // ?shot only: headless Edge does not always composite the WebGL canvas in long pages, so the
  // frame is mirrored into a 2D canvas for screenshots. Not used in normal viewing.
  const mirror = params.has('shot') ? el('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none' }) : null;
  if (mirror) ui.view.append(mirror);
  let visible = true, running = false, lastCam = 0;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; kick(); }).observe(root);
  document.addEventListener('visibilitychange', kick);
  function kick() { if (!running && visible && !document.hidden) { running = true; raf(loop); } }
  function loop(t) {
    if (!visible || document.hidden) { running = false; return; }
    controls.update();
    if (t - lastCam > 80) { lastCam = t; process(); }          // camera pipeline at ~12 Hz
    if (dirty) { renderer.render(scene, view); dirty = false; if (mirror) { mirror.width = renderer.domElement.width; mirror.height = renderer.domElement.height; mirror.getContext('2d').drawImage(renderer.domElement, 0, 0); } }
    raf(loop);
  }
  defaultBalls(); setCal(cal, calInfo); kick();
  if (params.get('mode') === 'ttt') setMode('ttt');
  if (params.has('stage')) ui.stageBtns[+params.get('stage')]?.click();
  if (params.has('nudge')) for (let k = 0; k < +params.get('nudge'); k++) nudge();
  if (params.has('recal')) setTimeout(recal, 500);
  if (params.has('light')) for (let k = 0; k < +params.get('light'); k++) cycleLight();
  if (params.has('moves')) { // verification only: human moves given as cell digits, e.g. ?mode=ttt&moves=15
    const mv = [...params.get('moves')].map(Number); (async () => { for (const c of mv) { while (busy || ttt.phase !== 'human' || ttt.pending) await new Promise(r => setTimeout(r, 100)); if (ttt.over) break; tttPlace(c - 1); } })(); }
  if (params.has('sort') || (!reduceMotion && mode === 'sort' && !params.has('nosort'))) setTimeout(() => runSort(), params.has('sort') ? 300 : 1500);
  window.__arm3d = { get frame() { return frame; }, get ttt() { return ttt; }, get q() { return q; } };
}

document.querySelectorAll('[data-arm3d]').forEach(mount);
