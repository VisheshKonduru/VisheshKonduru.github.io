import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World, SPEC, SCAN_HEIGHT } from './sim.js';

const THEMES = {
  light: { bg: 0xd9dadc, floor: 0xc9cacc, wall: 0xb3b4b6, ray: 0x2a2a2a, path: 0x1f8a2e, goal: 0x1f8a2e },
  dark:  { bg: 0x232427, floor: 0x3a3b3f, wall: 0x8d8f93, ray: 0xdddddd, path: 0x4cc35a, goal: 0x4cc35a },
};
const SCAN_COLOR = 0xe01b1b; // RViz LaserScan, flat colour transformer

export function start(stage) {
  const qs = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const world = new World(+(qs.get('seed') || 3));

  // ---- renderer / scene ----------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.querySelector('#loading')?.remove();
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
  // ROS frame (x fwd, y left, z up) lives inside this group.
  const ros = new THREE.Group();
  ros.rotation.x = -Math.PI / 2;
  scene.add(ros);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  scene.add(sun, sun.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 14;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(82);

  // ---- static world (rebuilt on reset because the maze changes) -------------
  const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.receiveShadow = true;
  ros.add(floor);
  let wallMesh = null;

  // occupancy grid: one canvas texture, one pixel per 0.05 m cell
  const mapCanvas = document.createElement('canvas');
  const mapCtx = mapCanvas.getContext('2d');
  let mapImg = null;
  const mapTex = new THREE.CanvasTexture(mapCanvas);
  mapTex.magFilter = THREE.NearestFilter;
  mapTex.minFilter = THREE.NearestFilter;
  mapTex.generateMipmaps = false;
  mapTex.colorSpace = THREE.SRGBColorSpace;
  const mapMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: mapTex, transparent: true, opacity: 0.92, depthWrite: false }));
  mapMesh.renderOrder = 1;
  ros.add(mapMesh);

  function buildWorld() {
    const m = world.maze, g = world.grid;
    floor.geometry.dispose();
    floor.geometry = new THREE.PlaneGeometry(m.size + 3, m.size + 3);
    floor.position.set(m.size / 2, m.size / 2, 0);
    if (wallMesh) { ros.remove(wallMesh); wallMesh.dispose(); }
    wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, m.walls.length);
    const mat = new THREE.Matrix4();
    m.walls.forEach((w, i) => {
      mat.makeScale(w.x1 - w.x0, w.y1 - w.y0, m.height);
      mat.setPosition((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, m.height / 2);
      wallMesh.setMatrixAt(i, mat);
    });
    wallMesh.castShadow = wallMesh.receiveShadow = true;
    ros.add(wallMesh);
    mapCanvas.width = g.w; mapCanvas.height = g.h;
    mapImg = mapCtx.createImageData(g.w, g.h);
    mapTex.dispose();
    mapTex.image = mapCanvas;
    mapMesh.geometry.dispose();
    mapMesh.geometry = new THREE.PlaneGeometry(g.w * g.res, g.h * g.res);
    mapMesh.position.set(g.originX + g.w * g.res / 2, g.originY + g.h * g.res / 2, 0.002);
    mapVersion = -1;
    const c = m.size / 2;
    sun.position.set(c - 3, 6, -c - 2.5); // three coords (y up)
    sun.target.position.set(c, 0, -c);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 16 });
    sun.shadow.camera.updateProjectionMatrix();
  }
  let mapVersion = -1;
  function drawMap() {
    const g = world.grid, d = mapImg.data;
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i, o = ((g.h - 1 - j) * g.w + i) * 4;
      let v = 128; // unknown: mid grey
      if (g.seen[k]) { const p = 1 - 1 / (1 + Math.exp(g.L[k])); v = Math.round(235 * (1 - p)); }
      d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
    mapCtx.putImageData(mapImg, 0, 0);
    mapTex.needsUpdate = true;
    mapVersion = g.version;
  }

  // ---- robot -----------------------------------------------------------------
  const robot = new THREE.Group();          // base_footprint
  const baseLink = new THREE.Group();       // base_link
  baseLink.position.z = SPEC.baseZ;
  robot.add(baseLink);
  const wheelL = new THREE.Group(), wheelR = new THREE.Group();
  wheelL.position.set(0, SPEC.wheelJoint.y, SPEC.wheelJoint.z);
  wheelR.position.set(0, -SPEC.wheelJoint.y, SPEC.wheelJoint.z);
  const scanLink = new THREE.Group();
  scanLink.position.set(SPEC.scanOffset.x, SPEC.scanOffset.y, SPEC.scanOffset.z);
  baseLink.add(wheelL, wheelR, scanLink);
  ros.add(robot);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2f3033, roughness: 0.55, metalness: 0.15 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.9 });
  const ldsMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45, metalness: 0.2 });
  new GLTFLoader().load(new URL('./tb3_burger.glb', import.meta.url).href, gltf => {
    const get = n => gltf.scene.getObjectByName(n);
    const add = (n, parent, mat, x = 0) => {
      const o = get(n); if (!o) return;
      o.position.set(x, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
      o.traverse(c => { if (c.isMesh) { c.material = mat; c.castShadow = true; c.receiveShadow = true; } });
      parent.add(o);
    };
    add('burger_base', baseLink, plateMat, -0.032); // URDF visual origin
    add('left_tire', wheelL, tireMat);
    add('right_tire', wheelR, tireMat);
    add('lds', scanLink, ldsMat);
    needsRender = true;
  });

  // ---- lidar, path, goal -----------------------------------------------------
  const S = SPEC.lidar.samples;
  const ptsGeo = new THREE.BufferGeometry();
  const ptsPos = new Float32Array(S * 3);
  ptsGeo.setAttribute('position', new THREE.BufferAttribute(ptsPos, 3).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(ptsGeo, new THREE.PointsMaterial({ color: SCAN_COLOR, size: 3, sizeAttenuation: false }));
  points.frustumCulled = false; points.renderOrder = 3;
  ros.add(points);
  const rayGeo = new THREE.BufferGeometry();
  const rayPos = new Float32Array(S * 6);
  rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rayMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false });
  const rays = new THREE.LineSegments(rayGeo, rayMat);
  rays.frustumCulled = false; rays.visible = false;
  ros.add(rays);
  const pathGeo = new THREE.BufferGeometry();
  const pathPos = new Float32Array(4000 * 3);
  pathGeo.setAttribute('position', new THREE.BufferAttribute(pathPos, 3).setUsage(THREE.DynamicDrawUsage));
  const pathMat = new THREE.LineBasicMaterial();
  const pathLine = new THREE.Line(pathGeo, pathMat);
  pathLine.frustumCulled = false; pathLine.renderOrder = 2;
  ros.add(pathLine);
  const goalMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const goal = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 32), goalMat);
  goal.visible = false;
  ros.add(goal);
  let pathVer = -1;

  function updateDynamic() {
    const r = world.robot;
    robot.position.set(r.x, r.y, 0);
    robot.rotation.z = r.th;
    wheelL.rotation.y = r.phiL;
    wheelR.rotation.y = r.phiR;
    let n = 0, m = 0;
    for (let k = 0; k < S; k++) {
      if (world.ranges[k] === Infinity) continue;
      const hx = world.hits[2 * k], hy = world.hits[2 * k + 1];
      ptsPos[3 * n] = hx; ptsPos[3 * n + 1] = hy; ptsPos[3 * n + 2] = SCAN_HEIGHT; n++;
      if (rays.visible) {
        rayPos.set([world.origins[2 * k], world.origins[2 * k + 1], SCAN_HEIGHT, hx, hy, SCAN_HEIGHT], 6 * m); m++;
      }
    }
    ptsGeo.setDrawRange(0, n); ptsGeo.attributes.position.needsUpdate = true;
    rayGeo.setDrawRange(0, m * 2); rayGeo.attributes.position.needsUpdate = true;
    if (world.pathVersion !== pathVer || !world.path) {
      const p = world.path || [], c = Math.min(p.length, 4000);
      for (let i = 0; i < c; i++) { pathPos[3 * i] = p[i][0]; pathPos[3 * i + 1] = p[i][1]; pathPos[3 * i + 2] = 0.006; }
      pathGeo.setDrawRange(0, c); pathGeo.attributes.position.needsUpdate = true;
      pathVer = world.pathVersion;
    }
    goal.visible = !!world.goal && world.mode !== 'explore';
    if (world.goal) goal.position.set(world.goal[0], world.goal[1], 0.007);
    if (world.grid.version !== mapVersion && (mapVersion < 0 || performance.now() - lastMapDraw > 100)) { drawMap(); lastMapDraw = performance.now(); }
  }
  let lastMapDraw = 0;

  function applyTheme() {
    const t = dark.matches ? THEMES.dark : THEMES.light;
    scene.background = new THREE.Color(t.bg);
    floorMat.color.set(t.floor); wallMat.color.set(t.wall);
    rayMat.color.set(t.ray); pathMat.color.set(t.path); goalMat.color.set(t.goal);
    needsRender = true;
  }
  dark.addEventListener('change', applyTheme);

  function resetCamera() {
    const c = world.maze.size / 2, target = new THREE.Vector3(c, 0, -c);
    const polar = THREE.MathUtils.degToRad(55), az = THREE.MathUtils.degToRad(-35), dist = 7.4;
    camera.position.set(target.x + dist * Math.sin(polar) * Math.sin(az), dist * Math.cos(polar), target.z + dist * Math.sin(polar) * Math.cos(az));
    controls.target.copy(target);
    controls.update();
  }

  // ---- UI --------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const btnPlay = $('play'), statusEl = $('status');
  let playing = !reduced;
  const setPlaying = p => { playing = p; btnPlay.textContent = p ? 'Pause' : 'Play'; kick(); };
  btnPlay.onclick = () => setPlaying(!playing);
  $('reset').onclick = () => { world.reset(world.seed); onReset(); };
  const toggle = (btn, obj) => { btn.onclick = () => { const on = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', on); obj.visible = on; needsRender = true; kick(); }; };
  toggle($('map'), mapMesh);
  toggle($('rays'), rays);

  // click-to-goal (distinguish from orbit drags)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(floor)[0];
    if (!hit) return;
    world.setGoal(hit.point.x, -hit.point.z); // three (x, y, z) -> ROS (x, -z)
    if (!playing) setPlaying(true);
    kick();
  });
  // teleop on the focused stage
  const keys = new Set();
  const KEYMAP = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
  const teleop = () => {
    const f = keys.has('f') - keys.has('b'), t = keys.has('l') - keys.has('r');
    world.teleop = f || t ? { v: f * SPEC.maxLin, w: t * 1.8 } : null;
    if (!world.teleop) { world.path = null; world.replanT = 0; }
  };
  stage.addEventListener('keydown', e => {
    const k = KEYMAP[e.key.toLowerCase()]; if (!k) return;
    e.preventDefault(); keys.add(k); teleop(); if (!playing) setPlaying(true);
  });
  stage.addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k) { keys.delete(k); teleop(); } });
  stage.addEventListener('blur', () => { keys.clear(); teleop(); });

  // ---- loop, visibility --------------------------------------------------------
  let visible = true, needsRender = true, raf = 0, last = performance.now(), acc = 0, lastStatus = 0;
  controls.addEventListener('change', () => { needsRender = true; kick(); });
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); });
  io.observe(stage);
  document.addEventListener('visibilitychange', kick);
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); needsRender = true; kick();
  }).observe(stage);

  function kick() {
    if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const moving = controls.update();
    if (playing) {
      acc += dt;
      const h = 1 / 60;
      while (acc >= h) { world.step(h); acc -= h; }
      if (world._resetSeen !== world.seed) onReset(true);
      needsRender = true;
    }
    if (needsRender) { updateDynamic(); renderer.render(scene, camera); needsRender = false; }
    if (now - lastStatus > 250) { statusEl.textContent = playing ? world.status : `Paused · ${world.status}`; lastStatus = now; }
    if (playing || moving) raf = requestAnimationFrame(frame);
  }
  function onReset(auto) {
    world._resetSeen = world.seed;
    buildWorld(); applyTheme();
    if (!auto) kick();
    needsRender = true;
  }

  // ---- go ------------------------------------------------------------------------
  // optional pre-roll (?t=seconds), used for still frames and screenshots
  const pre = qs.has('t') ? +qs.get('t') : reduced ? 0.25 : 0;
  for (let t = 0; t < pre; t += 1 / 60) world.step(1 / 60);
  world._resetSeen = world.seed;
  buildWorld(); applyTheme(); resetCamera();
  if (qs.has('rays')) { $('rays').click(); }
  if (qs.has('closeup')) { // inspection view around the robot
    const r = world.robot; controls.target.set(r.x, 0.08, -r.y);
    camera.position.set(r.x - 0.35, 0.45, -r.y + 0.45); controls.update();
  }
  setPlaying(playing && !qs.has('still'));
  needsRender = true; kick();
}
