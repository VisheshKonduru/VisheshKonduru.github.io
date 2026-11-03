import { ik, fk, URDF } from './ik.js';

const $ = (id) => document.getElementById(id);
const host = $('viewport');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dark = matchMedia('(prefers-color-scheme: dark)');

// Lazy start: only fetch three.js and meshes once the viewer is near the viewport.
const io = new IntersectionObserver((es) => {
  if (es.some(e => e.isIntersecting)) { io.disconnect(); start().catch(err => { $('loading').textContent = 'Could not load the 3D view.'; console.error(err); }); }
}, { rootMargin: '200px' });
io.observe(host);

async function start() {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
  const { toCreasedNormals } = await import('three/addons/utils/BufferGeometryUtils.js');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10);
  camera.position.set(0.78, 0.5, 0.66);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0.1, 0.1, -0.04);
  controls.enableDamping = true;
  controls.minDistance = 0.25; controls.maxDistance = 2;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.5, 1.2, 0.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 3 });
  sun.shadow.bias = -0.0004; sun.shadow.radius = 4;
  scene.add(sun);

  // ROS frame (z up, x forward) inside three's y-up world.
  const ros = new THREE.Group(); ros.rotation.x = -Math.PI / 2; scene.add(ros);
  const rosToWorld = (p) => new THREE.Vector3(p[0], p[2], -p[1]);
  const worldToRos = (v) => [v.x, -v.z, v.y];

  // Table and board
  const tableMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const table = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), tableMat);
  table.position.set(0.1, 0, 0); table.receiveShadow = true; ros.add(table);

  const boardGroup = new THREE.Group(); ros.add(boardGroup);
  const SQ = 0.02, BX = 0.18;
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const cx = cv.getContext('2d');
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { cx.fillStyle = (i + j) % 2 ? '#2a2a2a' : '#e8e6e0'; cx.fillRect(i * 64, j * 64, 64, 64); }
  const boardTex = new THREE.CanvasTexture(cv); boardTex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.BoxGeometry(SQ * 8 + 0.008, SQ * 8 + 0.008, 0.002),
    [0, 0, 0, 0].map(() => new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 })).concat([new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ color: 0x444444 })]));
  board.position.set(BX, 0, 0.001); board.receiveShadow = true; boardGroup.add(board);

  // Bin
  const BIN = [0.06, -0.17];
  const binMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.7 });
  const bin = new THREE.Group(); bin.position.set(BIN[0], BIN[1], 0); boardGroup.add(bin);
  const wall = (w, d, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, 0.04), binMat); m.position.set(x, y, 0.02); m.castShadow = m.receiveShadow = true; bin.add(m); };
  wall(0.08, 0.004, 0, 0.038); wall(0.08, 0.004, 0, -0.038); wall(0.004, 0.08, 0.038, 0); wall(0.004, 0.08, -0.038, 0);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.003), binMat); floor.position.z = 0.0015; floor.receiveShadow = true; bin.add(floor);

  const BALL_R = 0.012;
  const ballStarts = [[0.15, 0.05, 0xc0392b], [0.21, -0.03, 0x2563eb], [0.13, -0.05, 0xd4a017]];
  const balls = ballStarts.map(([x, y, c]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 }));
    m.castShadow = true; m.userData.home = [x, y]; boardGroup.add(m); return m;
  });
  function resetBalls() { balls.forEach(b => { boardGroup.add(b); b.position.set(...b.userData.home, BALL_R + 0.002); b.userData.done = false; }); }
  resetBalls();

  // Arm, chained exactly as in the URDF (all rpy are zero).
  const servoMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.62, metalness: 0.05 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.55, metalness: 0.05 });
  const palmMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3f, roughness: 0.5 });
  const loader = new STLLoader();
  const loadMesh = async (name, mat, parent, offset = [0, 0, 0]) => {
    let g = await loader.loadAsync(`meshes/${name}.stl`);
    g.scale(0.001, 0.001, 0.001);                    // URDF mesh scale 0.001 (STL in mm)
    g = toCreasedNormals(g, Math.PI / 6);
    const m = new THREE.Mesh(g, mat); m.position.set(...offset); m.castShadow = m.receiveShadow = true; parent.add(m);
  };
  const joint = (parent, xyz) => { const g = new THREE.Group(); g.position.set(...xyz); parent.add(g); return g; };
  const base = new THREE.Group(); ros.add(base);
  const J1 = joint(base, URDF.j1.xyz), J2 = joint(J1, URDF.j2.xyz), J3 = joint(J2, URDF.j3.xyz), J4 = joint(J3, URDF.j4.xyz);
  const GL = joint(J4, URDF.gripper.xyz), GR = joint(J4, [URDF.gripper.xyz[0], -URDF.gripper.xyz[1], 0]);
  const EE = joint(J4, URDF.ee.xyz);
  await Promise.all([
    loadMesh('link1', servoMat, base), loadMesh('link2', frameMat, J1, [0, 0, 0.019]),
    loadMesh('link3', servoMat, J2), loadMesh('link4', servoMat, J3), loadMesh('link5', frameMat, J4),
    loadMesh('gripper_left_palm', palmMat, GL), loadMesh('gripper_right_palm', palmMat, GR),
  ]);
  $('loading').remove();

  // Target marker with a larger invisible hit sphere for touch.
  const target = new THREE.Group(); ros.add(target);
  const tMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.5 });
  target.add(new THREE.Mesh(new THREE.SphereGeometry(0.007, 24, 12), tMat));
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); target.add(hit);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0008, 0.0008, 1, 6), new THREE.MeshStandardMaterial({ color: 0x9a9a9a }));
  stem.rotation.x = Math.PI / 2; ros.add(stem);
  const shadowDot = new THREE.Mesh(new THREE.RingGeometry(0.006, 0.009, 32), new THREE.MeshBasicMaterial({ color: 0xea580c }));
  ros.add(shadowDot);
  const reachMarker = new THREE.Mesh(new THREE.SphereGeometry(0.004, 16, 8), new THREE.MeshStandardMaterial({ color: 0x777777 }));
  reachMarker.visible = false; ros.add(reachMarker);

  // State
  let q = [0, 0, 0, 0], grip = 0.01;
  let tgt = [0.2, 0.0, 0.06], pitchDeg = 90;
  let busy = false, dirty = true;

  function applyPose() {
    J1.rotation.set(0, 0, q[0]); J2.rotation.set(0, q[1], 0); J3.rotation.set(0, q[2], 0); J4.rotation.set(0, q[3], 0);
    GL.position.y = URDF.gripper.xyz[1] + grip; GR.position.y = -URDF.gripper.xyz[1] - grip;
    ['q1', 'q2', 'q3', 'q4'].forEach((id, i) => { $(id).textContent = (q[i] * 180 / Math.PI).toFixed(1) + '°'; });
    $('og').textContent = (grip * 1000).toFixed(1); $('grip').value = (grip * 1000).toFixed(1);
    dirty = true;
  }
  function placeTarget() {
    target.position.set(...tgt);
    stem.position.set(tgt[0], tgt[1], tgt[2] / 2); stem.scale.set(1, Math.max(tgt[2], 1e-4), 1);
    shadowDot.position.set(tgt[0], tgt[1], 0.0025);
    $('tx').value = Math.round(tgt[0] * 1000); $('ty').value = Math.round(tgt[1] * 1000); $('tz').value = Math.round(tgt[2] * 1000);
    $('ox').textContent = Math.round(tgt[0] * 1000); $('oy').textContent = Math.round(tgt[1] * 1000); $('oz').textContent = Math.round(tgt[2] * 1000);
    dirty = true;
  }
  function setStatus(sol) {
    const s = $('status');
    s.textContent = sol.reachable ? 'Reachable' : `${sol.note}: showing nearest reachable pose`;
    s.classList.toggle('bad', !sol.reachable);
    reachMarker.visible = !sol.reachable;
    if (!sol.reachable) reachMarker.position.set(...fk(sol.q).p);
  }
  function solve() {
    const sol = ik(tgt, pitchDeg * Math.PI / 180, q);
    q = sol.q; setStatus(sol); applyPose();
  }

  // Joint-space motion
  const ease = (t) => t * t * (3 - 2 * t);
  // ?stop=N (verification only): run the pick instantly and halt after N moves.
  const stopAt = +new URLSearchParams(location.search).get('stop') || 0; let moves = 0;
  function moveTo(qGoal, gGoal = grip, speed = 1.2) {
    if (stopAt) { moves++; if (moves > stopAt) return new Promise(() => {}); q = [...qGoal]; grip = gGoal; applyPose(); tgt = fk(q).p; placeTarget(); return Promise.resolve(); }
    const q0 = [...q], g0 = grip;
    const dur = Math.max(0.35, Math.max(...qGoal.map((v, i) => Math.abs(v - q0[i]))) / speed, Math.abs(gGoal - g0) / 0.03);
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / 1000 / dur), e = ease(t);
        q = q0.map((v, i) => v + (qGoal[i] - v) * e); grip = g0 + (gGoal - g0) * e; applyPose();
        tgt = fk(q).p; placeTarget();
        t < 1 ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
  }
  const P_DOWN = Math.PI / 2, GRIP_OPEN = 0.019, GRIP_BALL = 0.0035, EE_ABOVE_BALL = 0.026;
  // Each waypoint is solved by the same IK. Gripper pointing straight down is preferred; if the wrist
  // limit forbids it at that point, the steepest reachable pitch is used instead (as on the real arm).
  function poseFor(p) {
    for (let d = 90; d >= 30; d -= 1) {
      const s = ik(p, d * Math.PI / 180, q);
      if (s.reachable) return s.q;
    }
    throw new Error('unreachable');
  }
  async function pick() {
    const ball = balls.find(b => !b.userData.done);
    if (!ball || busy) return;
    busy = true; setButtons();
    $('status').textContent = 'Running pick sequence'; $('status').classList.remove('bad'); reachMarker.visible = false;
    try {
      const [bx, by] = [ball.position.x, ball.position.y];
      const above = poseFor([bx, by, 0.08]), grasp = poseFor([bx, by, EE_ABOVE_BALL]);
      const lift = poseFor([bx, by, 0.09]), overBin = poseFor([BIN[0], BIN[1], 0.09]), home = poseFor([0.18, 0, 0.09]);
      await moveTo(above, GRIP_OPEN);
      await moveTo(grasp, GRIP_OPEN, 0.6);
      await moveTo(grasp, GRIP_BALL);
      EE.attach(ball);
      await moveTo(lift, GRIP_BALL, 0.8);
      await moveTo(overBin, GRIP_BALL, 1.0);
      await moveTo(overBin, GRIP_OPEN);
      boardGroup.attach(ball); ball.userData.done = true;
      await dropBall(ball);
      await moveTo(home, 0.01);
      tgt = fk(q).p; pitchDeg = 90; $('pitch').value = 90; $('op').textContent = 90; solve(); placeTarget();
    } catch (e) {
      $('status').textContent = 'Pick aborted: ball out of reach'; $('status').classList.add('bad');
    }
    busy = false; setButtons();
  }
  function dropBall(ball) {
    const z0 = ball.position.z, z1 = BALL_R + 0.003, n = balls.filter(b => b.userData.done).length - 1;
    const x1 = BIN[0] + [-0.015, 0.015, 0][n % 3], y1 = BIN[1] + [0.012, 0.012, -0.015][n % 3], x0 = ball.position.x, y0 = ball.position.y;
    return new Promise((res) => {
      const t0 = performance.now(), T = Math.sqrt(2 * (z0 - z1) / 9.81);
      const tick = () => {
        const t = Math.min(T, (performance.now() - t0) / 1000), k = t / T;
        ball.position.set(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, z0 - 0.5 * 9.81 * t * t); dirty = true;
        t < T ? requestAnimationFrame(tick) : res();
      };
      requestAnimationFrame(tick);
    });
  }
  function setButtons() {
    const left = balls.some(b => !b.userData.done) && $('board').checked;
    $('pick').disabled = busy || !left;
    $('reset').disabled = busy;
    ['tx', 'ty', 'tz', 'pitch', 'grip', 'board'].forEach(id => { $(id).disabled = busy; });
  }

  // UI wiring
  const onSlider = () => { if (busy) return; tgt = [$('tx').value / 1000, $('ty').value / 1000, $('tz').value / 1000]; placeTarget(); solve(); };
  ['tx', 'ty', 'tz'].forEach(id => $(id).addEventListener('input', onSlider));
  $('pitch').addEventListener('input', () => { pitchDeg = +$('pitch').value; $('op').textContent = pitchDeg; solve(); });
  $('grip').addEventListener('input', () => { grip = $('grip').value / 1000; applyPose(); });
  $('pick').addEventListener('click', pick);
  $('reset').addEventListener('click', () => { if (busy) return; resetBalls(); tgt = [0.2, 0, 0.06]; placeTarget(); solve(); setButtons(); });
  $('board').addEventListener('change', () => { boardGroup.visible = $('board').checked; setButtons(); dirty = true; });

  host.addEventListener('keydown', (e) => {
    if (busy) return;
    const step = e.shiftKey ? 0.02 : 0.005, d = { ArrowUp: [step, 0, 0], ArrowDown: [-step, 0, 0], ArrowLeft: [0, step, 0], ArrowRight: [0, -step, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    tgt = [tgt[0] + d[0], tgt[1] + d[1], Math.max(0, tgt[2] + d[2])].map((v, i) => Math.max(-0.38, Math.min(i === 2 ? 0.42 : 0.38, v)));
    placeTarget(); solve();
  });

  // Ground-plane drag of the target (mouse, pen, touch).
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let dragId = null; const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3();
  const setNdc = (e) => { const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (busy) return;
    setNdc(e);
    if (ray.intersectObject(hit, false).length) {
      dragId = e.pointerId; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId);
      dragPlane.constant = -tgt[2]; e.preventDefault();
    }
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) { if (e.pointerType === 'mouse' && dragId === null) { setNdc(e); renderer.domElement.style.cursor = ray.intersectObject(hit, false).length ? 'grab' : ''; } return; }
    setNdc(e);
    if (ray.ray.intersectPlane(dragPlane, hitPt)) {
      const p = worldToRos(hitPt);
      tgt = [Math.max(-0.38, Math.min(0.38, p[0])), Math.max(-0.38, Math.min(0.38, p[1])), tgt[2]];
      placeTarget(); solve();
    }
  });
  const endDrag = (e) => { if (e.pointerId === dragId) { dragId = null; controls.enabled = true; } };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  // Theme
  function applyTheme() {
    const d = dark.matches;
    scene.background = new THREE.Color(d ? 0x1c1c1f : 0xeeeeec);
    tableMat.color.set(d ? 0x56565a : 0xc9c6bf);
    dirty = true;
  }
  dark.addEventListener('change', applyTheme); applyTheme();

  // Render loop, paused when off-screen or tab hidden.
  let visible = true, running = false;
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; kick(); }).observe(host);
  document.addEventListener('visibilitychange', kick);
  controls.addEventListener('change', () => { dirty = true; });
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
  }
  new ResizeObserver(() => { resize(); kick(); }).observe(host); resize();
  function kick() { if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(loop); } }
  function loop() {
    if (!visible || document.hidden) { running = false; return; }
    controls.update();
    if (dirty) { renderer.render(scene, camera); dirty = false; }
    requestAnimationFrame(loop);
  }

  placeTarget(); solve(); setButtons(); kick();
  // Autoplay one pick, unless the user prefers reduced motion.
  if (stopAt) pick(); else if (!reduceMotion.matches) setTimeout(() => { if (!busy) pick(); }, 1200);
  if (new URLSearchParams(location.search).has('close')) { camera.position.set(0.32, 0.12, 0.25); controls.target.set(0.15, 0.03, -0.05); controls.update(); }
  window.__arm = { get q() { return q; }, get tgt() { return tgt; } };
}
