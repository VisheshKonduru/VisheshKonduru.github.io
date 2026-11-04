// MQP VEX U robot viewer. Embed: <div data-mqp3d></div> and load this file as a module
// (needs an import map for "three"). Builds its own controls; loads the model when scrolled near.
const params = new URLSearchParams(location.search);
const POSTER = new URL('poster.jpg', import.meta.url).href;

function mount(viewer) {
  viewer.classList.add('mq');
  viewer.innerHTML = `
  <div class="mq-line" role="toolbar" aria-label="Viewer controls">
    <button data-k="bExplode" type="button" aria-pressed="false" disabled>Exploded view</button>
    <button data-k="bCube" type="button" aria-pressed="false" disabled>Show the 15 in start-size cube</button>
    <button data-k="bReset" type="button" disabled>Reset view</button>
  </div>
  <div class="mq-view" data-k="view" role="region" aria-label="Interactive 3D model of the MQP VEX U robot">
    <img data-k="poster" class="mq-poster" src="${POSTER}" alt="Render of the MQP VEX U robot: an X-drive robot with omni wheels and a roller column">
    <button data-k="start" class="mq-start" type="button">Load the 3D model</button>
    <p data-k="progress" class="mq-progress" aria-live="polite" hidden><span data-k="ptext">Loading model 0%</span></p>
  </div>
  <p class="mq-hint">Keys, with the view focused: arrows orbit, + and - zoom, E explode, C cube, R reset.</p>
  <p class="mq-sr" data-k="status" aria-live="polite"></p>`;
  const view = viewer.querySelector('[data-k="view"]');
  let started = false;
  const go = () => { if (started) return; started = true; init(viewer, view).catch(e => console.error(e)); };
  viewer.querySelector('[data-k="start"]').onclick = go;
  if (params.has('autoload')) go();
  else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' });
    io.observe(view);
  }
}

async function init(viewer, view){
  const $ = k => viewer.querySelector('[data-k="'+k+'"]');
  $('start').remove();
  const prog = $('progress'); prog.hidden = false;
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D view. Arrow keys orbit, plus and minus zoom, E toggles exploded view, C toggles the 15 inch cube, R resets.');
  view.insertBefore(canvas, view.firstChild);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const applyBg = () => { scene.background = new THREE.Color(getComputedStyle(viewer).getPropertyValue('--frame').trim() || (dark.matches ? '#1d1f21' : '#eeebe4')); };
  applyBg(); dark.addEventListener('change', applyBg);

  // VEX U start-size limit. NOTE: the owner has not confirmed 15 in. The CAD measures
  // about 14.6 x 17.4 x 22.9 in, so the robot may not fit this cube as modelled.
  // VEX U start-size limit; 15 in by default, ?cubesize=24 shows the larger VEX U class.
  const CUBE_IN = [15, 24].includes(+params.get('cubesize')) ? +params.get('cubesize') : 15;
  const IN = 0.0254, S = CUBE_IN * IN;
  $('bCube').textContent = `Show the ${CUBE_IN} in start-size cube`;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 0.25; controls.maxDistance = 2.2;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.autoRotate = false; // never auto-rotate (also respects prefers-reduced-motion)

  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(0.25, 2.0, -0.3);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 7; key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left:-0.45, right:0.45, top:0.45, bottom:-0.45, near:0.1, far:3 });
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0x888888, 0.4));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.3 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const ptext = $('ptext');
  const gltf = await new Promise((res, rej) => loader.load(new URL('mqp_robot.glb', import.meta.url).href, res, e => {
    if (e.total) { const p = Math.round(100 * e.loaded / e.total); ptext.textContent = `Loading model ${p}%`; }
  }, rej)).catch(err => { ptext.textContent = 'Could not load the model.'; throw err; });
  const model = gltf.scene;
  scene.add(model);

  // Seat robot on the ground, centred in x/z.
  let box = new THREE.Box3().setFromObject(model);
  const c0 = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(c0.x, box.min.y, c0.z));
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Exploded view: each assembly-level node moves outward along the direction from the
  // robot centre to its own centroid (vertical spread damped so parts stay above the floor).
  let groups = model.children;
  while (groups.length === 1 && groups[0].children.length) groups = groups[0].children;
  // The CAD splits each V5 motor into 14 sibling occurrences (v5MotorNoCap, .001 ... .013 per motor);
  // keep each motor together so it moves as one unit.
  const units = new Map();
  for (const g of groups) {
    const m = g.name.match(/v5MotorNoCap[._]?(\d{3})?$/);
    const k = m ? 'motor' + Math.floor((m[1] ? +m[1] : 0) / 14) : g.uuid;
    if (!units.has(k)) units.set(k, []);
    units.get(k).push(g);
  }
  const parts = [];
  for (const objs of units.values()) {
    const b = new THREE.Box3(); objs.forEach(o => b.expandByObject(o)); if (b.isEmpty()) continue;
    const pc = b.getCenter(new THREE.Vector3());
    const d = pc.clone().sub(centre); d.x *= 0.9; d.z *= 0.9; d.y = Math.max(d.y, 0) * 0.25;
    for (const g of objs) {
      const pl = g.parent.worldToLocal(pc.clone()), ql = g.parent.worldToLocal(pc.clone().add(d));
      parts.push({ o: g, base: g.position.clone(), dir: ql.sub(pl) });
    }
  }
  let explodeT = 0, explodeTarget = 0;

  // 15 in start-size cube at true scale, standing on the ground around the robot.
  const cube = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(S, S, S)),
    new THREE.LineBasicMaterial({ color: 0xc8461b }));
  cube.position.set(0, S / 2, 0); cube.visible = false; scene.add(cube);

  const size = box.getSize(new THREE.Vector3()), R = Math.max(size.x, size.y, size.z);
  const home = { t: new THREE.Vector3(0, size.y * 0.46, 0), p: new THREE.Vector3(-1.05, 0.62, -1.1).normalize().multiplyScalar(R * 2.35).add(new THREE.Vector3(0, size.y * 0.46, 0)) };
  controls.minDistance = R * 0.6; controls.maxDistance = R * 5;
  function reset(){ controls.target.copy(home.t); camera.position.copy(home.p); controls.update(); }
  reset();

  function resize(){ const w = view.clientWidth, h = view.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(view); resize();

  const bExplode = $('bExplode'), bCube = $('bCube'), bReset = $('bReset');
  const status = $('status');
  function toggleExplode(){ explodeTarget = explodeTarget ? 0 : 1; bExplode.setAttribute('aria-pressed', String(!!explodeTarget)); status.textContent = explodeTarget ? 'Exploded view on' : 'Exploded view off'; if (reduce) applyExplode(explodeT = explodeTarget); }
  function toggleCube(){ cube.visible = !cube.visible; bCube.setAttribute('aria-pressed', String(cube.visible)); status.textContent = `${CUBE_IN} inch cube ` + (cube.visible ? 'shown' : 'hidden'); }
  function applyExplode(t){ const k = t * t * (3 - 2 * t); for (const p of parts) p.o.position.copy(p.base).addScaledVector(p.dir, k); }
  bExplode.onclick = toggleExplode; bCube.onclick = toggleCube; bReset.onclick = reset;
  [bExplode, bCube, bReset].forEach(b => b.disabled = false);

  const sph = new THREE.Spherical(), off = new THREE.Vector3();
  canvas.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'e' || k === 'E') toggleExplode();
    else if (k === 'c' || k === 'C') toggleCube();
    else if (k === 'r' || k === 'R') reset();
    else if (k === '+' || k === '=' || k === '-' || k === '_' || k.startsWith('Arrow')) {
      off.copy(camera.position).sub(controls.target); sph.setFromVector3(off);
      const a = 0.08;
      if (k === 'ArrowLeft') sph.theta -= a; if (k === 'ArrowRight') sph.theta += a;
      if (k === 'ArrowUp') sph.phi -= a; if (k === 'ArrowDown') sph.phi += a;
      if (k === '+' || k === '=') sph.radius /= 1.12; if (k === '-' || k === '_') sph.radius *= 1.12;
      sph.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, sph.phi));
      sph.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sph.radius));
      camera.position.copy(controls.target).add(off.setFromSpherical(sph));
    } else return;
    e.preventDefault();
  });

  $('poster').remove(); prog.remove();
  const tick = () => {
    if (explodeT !== explodeTarget) {
      explodeT = Math.min(1, Math.max(0, explodeT + Math.sign(explodeTarget - explodeT) * 0.035));
      applyExplode(explodeT);
    }
    controls.update(); renderer.render(scene, camera);
  };
  // Render only while the viewer is on screen and the tab is visible.
  let onScreen = true;
  const run = () => renderer.setAnimationLoop(onScreen && !document.hidden ? tick : null);
  new IntersectionObserver(es => { onScreen = es[0].isIntersecting; run(); }).observe(viewer);
  document.addEventListener('visibilitychange', run); run();
  status.textContent = 'Model loaded';
  viewer.dataset.units = String(units.size);
  viewer.dataset.ready = '1';
  if (params.has('explode')) { toggleExplode(); explodeT = 1; applyExplode(1); }
  if (params.has('cube')) toggleCube();
}

document.querySelectorAll('[data-mqp3d]').forEach(mount);
