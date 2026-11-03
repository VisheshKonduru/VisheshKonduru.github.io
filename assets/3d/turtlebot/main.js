import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World, SPEC, SCAN_HEIGHT } from './sim.js';
import { LocWorld } from './loc.js';

const THEMES = {
  light: { bg: 0xd9dadc, floor: 0xc9cacc, wall: 0xb3b4b6, ray: 0x2a2a2a, path: 0x1f8a2e },
  dark:  { bg: 0x232427, floor: 0x3a3b3f, wall: 0x8d8f93, ray: 0xdddddd, path: 0x4cc35a },
};
const SCAN_COLOR = 0xe01b1b;      // RViz LaserScan, flat colour
const PARTICLE_COLOR = 0xff1900;  // RViz PoseArray default colour (255, 25, 0)
const POSE_COLOR = 0x2a63d4, COV_COLOR = 0xb03fc8;
const MAP_HZ = 5, OVERLAY_HZ = 10;

export function start(stage) {
  const qs = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const seed = +(qs.get('seed') || 3);
  const worldA = new World(seed);
  let worldB = null;
  let scene_ = qs.get('scene') === 'loc' ? 'B' : 'A';
  const W = () => (scene_ === 'A' ? worldA : worldB);

  // ---- renderer / quality ------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const quality = { level: 0, dpr: Math.min(devicePixelRatio, 1.5) };
  renderer.setPixelRatio(quality.dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;  // hardware-filtered PCF, cheaper than PCFSoft
  renderer.shadowMap.autoUpdate = false;         // walls are static; re-render shadows only when the robot moves
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.querySelector('#loading')?.remove();
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
  const ros = new THREE.Group();     // ROS frame (x fwd, y left, z up)
  ros.rotation.x = -Math.PI / 2;
  scene.add(ros);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.015;
  scene.add(sun, sun.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 14;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(82);

  // ---- static world --------------------------------------------------------------
  const floorMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.receiveShadow = true;
  ros.add(floor);
  let wallMesh = null, builtMaze = null;

  // a grid-sized canvas texture on a plane, uploaded only on change and rate-limited
  function gridLayer(z, order, opacity) {
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false }));
    mesh.renderOrder = order;
    ros.add(mesh);
    const L = { mesh, tex, ctx, canvas, img: null, last: -1e9, z };
    L.fit = g => {
      if (canvas.width !== g.w || canvas.height !== g.h) { canvas.width = g.w; canvas.height = g.h; tex.dispose(); }
      L.img = ctx.createImageData(g.w, g.h);
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(g.w * g.res, g.h * g.res);
      mesh.position.set(g.originX + g.w * g.res / 2, g.originY + g.h * g.res / 2, z);
    };
    L.upload = () => { ctx.putImageData(L.img, 0, 0); tex.needsUpdate = true; };
    return L;
  }
  const mapL = gridLayer(0.002, 1, 0.92);
  const ovL = gridLayer(0.004, 2, 1);   // frontiers + A* search (scene A)
  let mapVersion = -1, mapGrid = null;

  function buildWorld() {
    const w = W(), m = w.maze, g = w.grid;
    if (builtMaze !== m) {
      floor.geometry.dispose();
      floor.geometry = new THREE.PlaneGeometry(m.size + 3, m.size + 3);
      floor.position.set(m.size / 2, m.size / 2, 0);
      if (wallMesh) { ros.remove(wallMesh); wallMesh.dispose(); }
      wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wallMat, m.walls.length);
      const mat = new THREE.Matrix4();
      m.walls.forEach((wl, i) => {
        mat.compose(new THREE.Vector3(wl.cx, wl.cy, m.height / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), wl.ang), new THREE.Vector3(wl.len, wl.thick, m.height));
        wallMesh.setMatrixAt(i, mat);
      });
      wallMesh.castShadow = wallMesh.receiveShadow = true;
      ros.add(wallMesh);
      const c = m.size / 2;
      sun.position.set(c - 3, 6, -c - 2.5);
      sun.target.position.set(c, 0, -c);
      Object.assign(sun.shadow.camera, { left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 1, far: 16 });
      sun.shadow.camera.updateProjectionMatrix();
      builtMaze = m;
    }
    mapL.fit(g); ovL.fit(g); mapGrid = g; mapVersion = -1;
    ovL.img.data.fill(0); ovL.upload();
    renderer.shadowMap.needsUpdate = true;
  }
  function drawMap(now) {
    const g = W().grid, d = mapL.img.data;
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i, o = ((g.h - 1 - j) * g.w + i) * 4;
      let v = 128;
      if (g.seen[k]) { const p = 1 - 1 / (1 + Math.exp(g.L[k])); v = Math.round(235 * (1 - p)); }
      d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
    mapL.upload(); mapL.last = now; mapVersion = g.version;
  }

  // ---- robot ----------------------------------------------------------------------
  const robot = new THREE.Group(), baseLink = new THREE.Group();
  baseLink.position.z = SPEC.baseZ;
  robot.add(baseLink);
  const wheelL = new THREE.Group(), wheelR = new THREE.Group(), scanLink = new THREE.Group();
  wheelL.position.set(0, SPEC.wheelJoint.y, SPEC.wheelJoint.z);
  wheelR.position.set(0, -SPEC.wheelJoint.y, SPEC.wheelJoint.z);
  scanLink.position.set(SPEC.scanOffset.x, SPEC.scanOffset.y, SPEC.scanOffset.z);
  baseLink.add(wheelL, wheelR, scanLink);
  ros.add(robot);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2f3033, roughness: 0.55, metalness: 0.15 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.9 });
  const ldsMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45, metalness: 0.2 });
  // invisible pick volume for dragging (the robot's footprint cylinder)
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16), new THREE.MeshBasicMaterial({ visible: false }));
  pick.rotation.x = Math.PI / 2; pick.position.z = 0.1;
  robot.add(pick);
  new GLTFLoader().load(new URL('./tb3_burger.glb', import.meta.url).href, gltf => {
    const add = (n, parent, mat, x = 0) => {
      const o = gltf.scene.getObjectByName(n); if (!o) return;
      o.position.set(x, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
      o.traverse(c => { if (c.isMesh) { c.material = mat; c.castShadow = true; } });
      parent.add(o);
    };
    add('burger_base', baseLink, plateMat, -0.032);
    add('left_tire', wheelL, tireMat);
    add('right_tire', wheelR, tireMat);
    add('lds', scanLink, ldsMat);
    renderer.shadowMap.needsUpdate = true; needsRender = true; kick();
  });

  // ---- dynamic overlays ---------------------------------------------------------------
  const S = SPEC.lidar.samples;
  const dyn = (n, mk) => { const g = new THREE.BufferGeometry(), a = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(a, 3).setUsage(THREE.DynamicDrawUsage)); const o = mk(g); o.frustumCulled = false; ros.add(o); return { g, a, o }; };
  const pts = dyn(S, g => new THREE.Points(g, new THREE.PointsMaterial({ color: SCAN_COLOR, size: 3, sizeAttenuation: false })));
  pts.o.renderOrder = 4;
  const rayMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false });
  const rays = dyn(S * 2, g => new THREE.LineSegments(g, rayMat));
  rays.o.visible = false;
  const pathMat = new THREE.LineBasicMaterial();
  const path = dyn(4000, g => new THREE.Line(g, pathMat));
  path.o.renderOrder = 3;
  const goalMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const goal = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 32), goalMat);
  goal.visible = false; ros.add(goal);
  const targetMat = new THREE.MeshBasicMaterial({ color: 0xe07a10, side: THREE.DoubleSide });
  const target = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), targetMat);
  target.visible = false; ros.add(target);

  // particle cloud: one instanced flat arrow, as RViz PoseArray "Arrow (Flat)"
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0.07, 0); arrowShape.lineTo(0.035, 0.018); arrowShape.lineTo(0.035, 0.006); arrowShape.lineTo(-0.03, 0.006);
  arrowShape.lineTo(-0.03, -0.006); arrowShape.lineTo(0.035, -0.006); arrowShape.lineTo(0.035, -0.018); arrowShape.closePath();
  const MAXP = 4000;
  const particles = new THREE.InstancedMesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: PARTICLE_COLOR, side: THREE.DoubleSide }), MAXP);
  particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particles.frustumCulled = false; particles.count = 0; particles.renderOrder = 5; particles.position.z = 0.012;
  ros.add(particles);
  const estArrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: POSE_COLOR, side: THREE.DoubleSide }));
  estArrow.scale.setScalar(3); estArrow.renderOrder = 6;
  const ellipsePts = []; for (let i = 0; i <= 64; i++) ellipsePts.push(new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2), Math.sin(i / 64 * Math.PI * 2), 0));
  const ellipse = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ellipsePts), new THREE.LineBasicMaterial({ color: COV_COLOR }));
  const estGroup = new THREE.Group(); estGroup.add(estArrow); ros.add(estGroup, ellipse);
  estGroup.position.z = ellipse.position.z = 0.014;
  let pfDrawn = -1, pathVer = -1, vizN = -1, vizStart = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1), v3 = new THREE.Vector3();

  function setPath(p) {
    const c = Math.min(p.length, 4000);
    for (let i = 0; i < c; i++) { path.a[3 * i] = p[i][0]; path.a[3 * i + 1] = p[i][1]; path.a[3 * i + 2] = 0.006; }
    path.g.setDrawRange(0, c); path.g.attributes.position.needsUpdate = true;
  }

  // Scene A: frontier cells, then the A* closed set revealed in expansion order and fading,
  // the open set at the end, then the final path.
  const SEARCH_ANIM = 0.9, SEARCH_FADE = 0.6;
  function drawSearch(now) {
    const w = worldA, v = w.viz, g = w.grid;
    if (!v) return false;
    if (v.n !== vizN) { vizN = v.n; vizStart = now; }
    const age = (now - vizStart) / 1000, d = ovL.img.data, H = g.h, Wd = g.w;
    d.fill(0);
    const put = (k, r, gg, b, a) => { const o = ((H - 1 - ((k / Wd) | 0)) * Wd + (k % Wd)) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = a; };
    const reveal = Math.min(1, age / SEARCH_ANIM), fade = Math.max(0, 1 - Math.max(0, age - SEARCH_ANIM) / SEARCH_FADE);
    if (fade > 0) {
      const n = Math.floor(v.closed.length * reveal);
      for (let i = 0; i < n; i++) put(v.closed[i], 120, 170, 230, Math.round(150 * fade * (0.45 + 0.55 * i / Math.max(1, n))));
      if (reveal >= 1) for (const k of v.open) put(k, 240, 200, 60, Math.round(200 * fade));
    }
    for (const f of v.frontiers) for (const k of f.cells) put(k, 30, 110, 230, 230);
    ovL.upload(); ovL.last = now;
    path.o.visible = reveal >= 1;
    return age < SEARCH_ANIM + SEARCH_FADE;
  }

  function updateDynamic(now) {
    const w = W(), r = w.robot;
    if (!dragging) { robot.position.set(r.x, r.y, 0); robot.rotation.z = r.th; }
    wheelL.rotation.y = r.phiL; wheelR.rotation.y = r.phiR;
    let n = 0, m = 0;
    if (scene_ === 'A') {
      for (let k = 0; k < S; k++) {
        if (w.ranges[k] === Infinity) continue;
        const hx = w.hits[2 * k], hy = w.hits[2 * k + 1];
        pts.a[3 * n] = hx; pts.a[3 * n + 1] = hy; pts.a[3 * n + 2] = SCAN_HEIGHT; n++;
        if (rays.o.visible) { rays.a.set([w.origins[2 * k], w.origins[2 * k + 1], SCAN_HEIGHT, hx, hy, SCAN_HEIGHT], 6 * m); m++; }
      }
    } else {
      // scan drawn at the ESTIMATED pose, as RViz does in the map frame
      const e = w.estPose(), c = Math.cos(e.th), s = Math.sin(e.th);
      const lx = e.x + c * SPEC.scanOffset.x, ly = e.y + s * SPEC.scanOffset.x;
      for (let k = 0; k < S; k++) {
        const rr = w.ranges[k]; if (rr === Infinity) continue;
        const a = e.th + (k / S) * 2 * Math.PI, hx = lx + rr * Math.cos(a), hy = ly + rr * Math.sin(a);
        pts.a[3 * n] = hx; pts.a[3 * n + 1] = hy; pts.a[3 * n + 2] = SCAN_HEIGHT; n++;
        if (rays.o.visible) { rays.a.set([lx, ly, SCAN_HEIGHT, hx, hy, SCAN_HEIGHT], 6 * m); m++; }
      }
      const pf = w.pf;
      if (w.pfUpdates !== pfDrawn || w.scans !== pfDrawn2) {
        const cnt = Math.min(pf.n, MAXP);
        for (let i = 0; i < cnt; i++) { q.setFromAxisAngle(zAxis, pf.th[i]); m4.compose(v3.set(pf.x[i], pf.y[i], 0), q, one); particles.setMatrixAt(i, m4); }
        particles.count = cnt; particles.instanceMatrix.needsUpdate = true;
        pfDrawn = w.pfUpdates; pfDrawn2 = w.scans;
      }
      estGroup.position.set(e.x, e.y, 0.014); estGroup.rotation.z = e.th;
      const E = pf.est, tr = (E.cxx + E.cyy) / 2, df = Math.sqrt(((E.cxx - E.cyy) / 2) ** 2 + E.cxy ** 2);
      ellipse.position.set(e.x, e.y, 0.014);
      ellipse.rotation.z = 0.5 * Math.atan2(2 * E.cxy, E.cxx - E.cyy);
      ellipse.scale.set(Math.max(0.01, 2 * Math.sqrt(tr + df)), Math.max(0.01, 2 * Math.sqrt(Math.max(0, tr - df))), 1); // 2-sigma
    }
    pts.g.setDrawRange(0, n); pts.g.attributes.position.needsUpdate = true;
    rays.g.setDrawRange(0, m * 2); rays.g.attributes.position.needsUpdate = true;
    if (w.pathVersion !== pathVer || !w.path) { setPath(w.path || []); pathVer = w.pathVersion; }
    const showGoal = scene_ === 'B' ? !!w.goal : !!w.goal && w.mode !== 'explore';
    goal.visible = showGoal; if (w.goal) goal.position.set(w.goal[0], w.goal[1], 0.008);
    if (scene_ === 'A') {
      const busy = drawSearchMaybe(now);
      const v = worldA.viz; target.visible = !!v && worldA.mode === 'explore';
      if (v && target.visible) { const g = worldA.grid; target.position.set(g.originX + ((v.target % g.w) + 0.5) * g.res, g.originY + (((v.target / g.w) | 0) + 0.5) * g.res, 0.009); }
      if (busy) needsRender = true;
    } else { target.visible = false; path.o.visible = true; }
    if (w.grid.version !== mapVersion && now - mapL.last >= 1000 / MAP_HZ) drawMap(now);
    // shadows: only re-render the shadow map when the robot has moved, at most ~15 Hz
    if ((Math.abs(r.x - lastShadow[0]) + Math.abs(r.y - lastShadow[1]) + Math.abs(r.th - lastShadow[2]) > 0.01 || dragging) && now - lastShadow[3] > 66) {
      renderer.shadowMap.needsUpdate = true; lastShadow = [r.x, r.y, r.th, now];
    }
  }
  let pfDrawn2 = -1, lastShadow = [0, 0, 0, 0];
  function drawSearchMaybe(now) {
    const v = worldA.viz; if (!v) return false;
    const animating = v.n !== vizN || (now - vizStart) / 1000 < SEARCH_ANIM + SEARCH_FADE + 0.1;
    if (animating && now - ovL.last >= 1000 / OVERLAY_HZ) return drawSearch(now) || true;
    return animating;
  }

  function applyTheme() {
    const t = dark.matches ? THEMES.dark : THEMES.light;
    scene.background = new THREE.Color(t.bg);
    floorMat.color.set(t.floor); wallMat.color.set(t.wall);
    rayMat.color.set(t.ray); pathMat.color.set(t.path); goalMat.color.set(t.path);
    needsRender = true; kick();
  }
  dark.addEventListener('change', applyTheme);

  function resetCamera() {
    const mz = W().maze, tgt = new THREE.Vector3(mz.sizeX / 2, 0, -mz.sizeY / 2);
    const polar = THREE.MathUtils.degToRad(55), az = THREE.MathUtils.degToRad(-35), dist = 7.4;
    camera.position.set(tgt.x + dist * Math.sin(polar) * Math.sin(az), dist * Math.cos(polar), tgt.z + dist * Math.sin(polar) * Math.cos(az));
    controls.target.copy(tgt); controls.update();
  }

  // ---- scenes ----------------------------------------------------------------------------
  function showScene(sc) {
    scene_ = sc;
    if (sc === 'B') {
      // known map: the one scene A finished, if it finished this maze; otherwise the pre-mapped maze
      const done = (worldA.mode === 'final' || worldA.mode === 'done') ? cloneGrid(worldA.grid) : null;
      if (!worldB || worldB.seed !== worldA.seed) worldB = new LocWorld(worldA.seed, done);
    }
    const isB = sc === 'B';
    particles.visible = estGroup.visible = ellipse.visible = isB;
    ovL.mesh.visible = !isB;
    pathVer = -1; pfDrawn = -1;
    $('hint').textContent = isB ? 'Drag the robot to kidnap it. Click the floor to set a destination.' : 'Click the floor to send a goal. WASD or arrows to drive.';
    for (const t of tabs) { const on = t.dataset.scene === sc; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; }
    buildWorld(); needsRender = true; kick();
  }
  function cloneGrid(g) {
    const c = Object.assign(Object.create(Object.getPrototypeOf(g)), g);
    c.L = g.L.slice(); c.seen = g.seen.slice();
    for (let k = 0; k < c.L.length; k++) if (c.seen[k] && Math.abs(c.L[k]) < 0.6) c.seen[k] = 0;
    return c;
  }

  // ---- UI ----------------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const btnPlay = $('play'), statusEl = $('status');
  const tabs = [...document.querySelectorAll('[role=tab]')];
  tabs.forEach(t => {
    t.onclick = () => showScene(t.dataset.scene);
    t.onkeydown = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = (tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[i].focus(); tabs[i].click();
    };
  });
  let playing = !reduced;
  const setPlaying = p => { playing = p; btnPlay.textContent = p ? 'Pause' : 'Play'; kick(); };
  btnPlay.onclick = () => setPlaying(!playing);
  $('reset').onclick = () => {
    if (scene_ === 'A') worldA.reset(worldA.seed);
    else { worldB.kidnap(); worldB.goal = worldB.randomFree(1.5); }
    buildWorld(); needsRender = true; kick();
  };
  const toggle = (btn, obj) => { btn.onclick = () => { const on = btn.getAttribute('aria-pressed') !== 'true'; btn.setAttribute('aria-pressed', on); obj.visible = on; needsRender = true; kick(); }; };
  toggle($('map'), mapL.mesh);
  toggle($('rays'), rays.o);

  // pointer: drag the robot (scene B) or click a goal (both)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, dragging = false;
  const floorHit = e => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  };
  renderer.domElement.addEventListener('pointerdown', e => {
    down = [e.clientX, e.clientY];
    if (scene_ !== 'B') return;
    if (floorHit(e).intersectObject(pick).length) { dragging = true; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); }
  });
  renderer.domElement.addEventListener('pointermove', e => {
    if (!dragging) return;
    const h = floorHit(e).intersectObject(floor)[0];
    if (h) { robot.position.set(h.point.x, -h.point.z, 0); needsRender = true; kick(); }
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (dragging) {
      dragging = false; controls.enabled = true;
      const x = robot.position.x, y = robot.position.y;
      if (worldB.freeOk(x, y)) { worldB.kidnap(x, y, worldB.robot.th); worldB.status = 'Kidnapped: re-localizing'; }
      needsRender = true; kick(); return;
    }
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const h = floorHit(e).intersectObject(floor)[0];
    if (!h) return;
    W().setGoal(h.point.x, -h.point.z);
    if (!playing) setPlaying(true);
    kick();
  });
  // teleop (scene A)
  const keys = new Set();
  const KEYMAP = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r' };
  const teleop = () => {
    const f = keys.has('f') - keys.has('b'), t = keys.has('l') - keys.has('r');
    worldA.teleop = f || t ? { v: f * SPEC.maxLin, w: t * 1.8 } : null;
    if (!worldA.teleop) { worldA.path = null; worldA.replanT = 0; }
  };
  stage.addEventListener('keydown', e => {
    if (scene_ !== 'A') return;
    const k = KEYMAP[e.key.toLowerCase()]; if (!k) return;
    e.preventDefault(); keys.add(k); teleop(); if (!playing) setPlaying(true);
  });
  stage.addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k) { keys.delete(k); teleop(); } });
  stage.addEventListener('blur', () => { keys.clear(); teleop(); });

  // ---- loop, visibility, adaptive quality ----------------------------------------------------
  let visible = true, needsRender = true, raf = 0, last = performance.now(), acc = 0, lastStatus = 0;
  controls.addEventListener('change', () => { needsRender = true; kick(); });
  new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(stage);
  document.addEventListener('visibilitychange', kick);
  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); needsRender = true; kick();
  };
  new ResizeObserver(resize).observe(stage);

  // Only steps down when frames are genuinely slow: rolling mean frame interval over
  // 90 rendered frames above 20 ms. Level 1: pixel ratio 1. Level 2: shadows off.
  const slow = { n: 0, sum: 0 };
  function adapt(interval) {
    if (interval > 200) return; // tab switch / breakpoint, ignore
    slow.sum += interval; slow.n++;
    if (slow.n < 90) return;
    const mean = slow.sum / slow.n; slow.n = slow.sum = 0;
    if (mean <= 20 || quality.level >= 2) return;
    quality.level++;
    if (quality.level === 1 && quality.dpr > 1) { quality.dpr = 1; renderer.setPixelRatio(1); resize(); }
    else { quality.level = 2; renderer.shadowMap.enabled = false; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
  }

  const bench = qs.has('bench') ? (window.__bt = []) : null;
  function kick() {
    if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    const t0 = performance.now();
    const interval = now - last, dt = Math.min(0.1, interval / 1000); last = now;
    const moving = controls.update();
    if (playing) {
      acc += dt;
      const h = 1 / 60, w = W();
      while (acc >= h) { w.step(h); acc -= h; }
      if (scene_ === 'A' && worldA._resetSeen !== worldA.seed) { worldA._resetSeen = worldA.seed; worldB = null; buildWorld(); }
      needsRender = true;
    }
    if (needsRender) { needsRender = false; updateDynamic(now); renderer.render(scene, camera); }
    if (now - lastStatus > 250) { statusEl.textContent = playing ? W().status : `Paused · ${W().status}`; lastStatus = now; }
    if (playing) adapt(interval);
    if (bench) {
      if (!window.__bt0) window.__bt0 = performance.now(); bench.push(performance.now() - t0);
      if (bench.length === 150) {
        const a = bench.slice(30).sort((x, y) => x - y), mean = a.reduce((x, y) => x + y, 0) / a.length;
        const pre = document.createElement('pre'); pre.id = 'bench';
        pre.textContent = `BENCH mean ${mean.toFixed(2)} p95 ${a[Math.floor(a.length * 0.95)].toFixed(2)} max ${a[a.length - 1].toFixed(2)} quality ${quality.level}`;
        document.body.appendChild(pre);
      }
    }
    if (playing || moving || needsRender) raf = requestAnimationFrame(frame);
  }

  // ---- go ------------------------------------------------------------------------------------
  const pre = qs.has('t') ? +qs.get('t') : reduced ? 0.25 : 0;
  worldA._resetSeen = worldA.seed;
  if (scene_ === 'A') for (let t = 0; t < pre; t += 1 / 60) worldA.step(1 / 60);
  showScene(scene_);
  if (scene_ === 'B') for (let t = 0; t < pre; t += 1 / 60) worldB.step(1 / 60);
  applyTheme(); resetCamera();
  if (qs.has('rays')) $('rays').click();
  setPlaying(playing && !qs.has('still'));
  needsRender = true; kick();
}
