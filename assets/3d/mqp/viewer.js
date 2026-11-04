// MQP VEX U robot viewer on the shared demo shell. Embed: <div data-mqp3d></div> and load this file as a
// module (needs an import map for "three"). Loads the model when scrolled near.
import { createShell, h } from '../demo-shell.js';
const params = new URLSearchParams(location.search);
const POSTER = new URL('poster.jpg', import.meta.url).href;

function mount(root) {
  if (root.dataset.mounted) return; root.dataset.mounted = '1';
  let api = null;
  const shell = createShell(root, {
    id: 'mqp', label: 'MQP VEX U robot',
    viewLabel: '3D view of the MQP VEX U robot. Drag to turn, scroll or pinch to zoom. With the view focused: arrow keys turn, plus and minus zoom, R resets.',
    scenes: [{ id: 'view', label: 'View' }, { id: 'exploded', label: 'Exploded' }], scene: params.has('explode') ? 'exploded' : 'view',
    onScene: (id) => { api ? api.setExplode(id === 'exploded') : null; buildFlow(id); shell.startCoach(); },
  });
  const view = shell.view;
  view.append(h('img', { class: 'mq-poster', src: POSTER, alt: 'Render of the MQP VEX U robot: an X-drive robot with omni wheels and a roller column' }),
    h('p', { class: 'ds-loading', text: 'Loading model' }));
  const legend = h('ul', { class: 'mq-legend', role: 'list' });
  const pLegend = h('div', { class: 'ds-panel' }, h('h3', { class: 'ds-ro-h', text: 'Part groups' }), legend);
  shell.panels.append(pLegend);
  shell.readout([{ id: 'model', title: 'Model', items: [
    { id: 'tris', label: 'Triangles', desc: 'After reducing the Onshape CAD for the browser.' },
    { id: 'meshes', label: 'Meshes' }, { id: 'groups', label: 'Part groups', desc: 'Assembly nodes that move together in the exploded view.' }] }]);
  function buildFlow(id) {
    shell.setFlow([{ step: id === 'view' ? 'Drag to turn, scroll to zoom' : 'Point at a part group to highlight it', id: 'how' }],
      [{ label: 'Reset view', id: 'reset', onClick: () => api && api.reset() }]);
  }
  shell.coach('view', [{ key: 'turn', text: 'Runs in your browser. Drag the model to turn it.', target: () => view, at: [0.5, 0.5] }]);
  shell.coach('exploded', [{ key: 'hover', text: 'Point at a part group in the list.', target: () => legend }]);
  buildFlow(shell.scene);
  shell.say('Loading model');
  let started = false;
  const go = () => { if (started) return; started = true; init(root, shell, legend).then(a => { api = a; api.setExplode(shell.scene === 'exploded'); shell.startCoach(); }).catch(e => { console.error(e); shell.say('Could not load the model'); }); };
  if (params.has('autoload') || !('IntersectionObserver' in window)) go();
  else { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '200px' }); io.observe(view); }
}

async function init(root, shell, legend) {
  const view = shell.view;
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('shot') });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  view.insertBefore(canvas, view.firstChild);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const applyBg = () => { scene.background = new THREE.Color(getComputedStyle(root).getPropertyValue('--frame').trim() || (dark.matches ? '#1d1f21' : '#eeebe4')); };
  applyBg(); dark.addEventListener('change', applyBg);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduce; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.addEventListener('start', () => shell.done('turn'));

  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(0.25, 2.0, -0.3);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 7; key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.1, far: 3 });
  scene.add(key, new THREE.HemisphereLight(0xffffff, 0x888888, 0.4));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: 0.3 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await new Promise((res, rej) => loader.load(new URL('mqp_robot.glb', import.meta.url).href, res, e => {
    if (e.total) shell.say(`Loading model ${Math.round(100 * e.loaded / e.total)}%`);
  }, rej));
  const model = gltf.scene;
  scene.add(model);

  // Seat robot on the ground, centred in x/z.
  let box = new THREE.Box3().setFromObject(model);
  const c0 = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(c0.x, box.min.y, c0.z));
  model.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  let tris = 0, meshes = 0;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });

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
  function applyExplode(t) { const k = t * t * (3 - 2 * t); for (const p of parts) p.o.position.copy(p.base).addScaledVector(p.dir, k); }
  function setExplode(on) {
    explodeTarget = on ? 1 : 0;
    if (reduce) applyExplode(explodeT = explodeTarget);
    shell.say(on ? `Exploded view, ${units.size} part groups` : 'Assembled view');
  }

  // Part-group legend from the CAD node names (trailing instance numbers removed); hover highlights.
  // Groups are sorted by keywords in the CAD part names (e.g. "Aluminum C Channel (276-2289)").
  const CATS = [['Motors', /motor/i], ['Wheels', /wheel/i], ['Gears and sprockets', /gear|sprocket|pinion/i], ['Channels and plates', /channel|angle|plate|bar|beam|rail/i],
    ['Standoffs and spacers', /standoff|spacer/i], ['Shafts and inserts', /shaft|insert|collar|bearing/i], ['Brackets', /bracket|gusset/i],
    ['Electronics', /brain|battery|radio|sensor|cable|vision|distance|inertial|optical|rotation/i], ['Screws and nuts', /screw|nut|bolt|washer/i]];
  const nameOf = (g) => { const n = g.name || ''; for (const [c, re] of CATS) if (re.test(n)) return c; return 'Other parts'; };
  const byName = new Map();
  for (const g of groups) { const n = nameOf(g); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(g); }
  const hiMat = new THREE.MeshStandardMaterial({ color: getComputedStyle(root).getPropertyValue('--mark').trim() || '#0f8b8d', roughness: 0.6 });
  let lit = null;
  function highlight(list, name) {
    if (lit) { lit.forEach(([m, mat]) => (m.material = mat)); lit = null; }
    if (!list) { shell.say(explodeTarget ? `Exploded view, ${units.size} part groups` : 'Assembled view'); return; }
    lit = []; let n = 0;
    list.forEach(g => g.traverse(o => { if (o.isMesh) { lit.push([o, o.material]); o.material = hiMat; n++; } }));
    shell.say(`${name}: ${list.length} CAD node${list.length === 1 ? '' : 's'}, ${n} meshes`); shell.done('hover');
  }
  [...byName.entries()].sort((a, b) => (a[0] === 'Other parts') - (b[0] === 'Other parts') || b[1].length - a[1].length).forEach(([name, list]) => {
    const b = h('button', { type: 'button', class: 'mq-leg', text: `${name}`, 'aria-label': `Highlight ${name}` }, h('span', { class: 'mq-leg-n', text: ` ${list.length}` }));
    const on = () => highlight(list, name), off = () => highlight(null);
    b.addEventListener('pointerenter', on); b.addEventListener('pointerleave', off); b.addEventListener('focus', on); b.addEventListener('blur', off);
    legend.append(h('li', {}, b));
  });

  const size = box.getSize(new THREE.Vector3()), R = Math.max(size.x, size.y, size.z);
  const home = { t: new THREE.Vector3(0, size.y * 0.46, 0), p: new THREE.Vector3(-1.05, 0.62, -1.1).normalize().multiplyScalar(R * 2.35).add(new THREE.Vector3(0, size.y * 0.46, 0)) };
  controls.minDistance = R * 0.6; controls.maxDistance = R * 5;
  function reset() { controls.target.copy(home.t); camera.position.copy(home.p); controls.update(); }
  reset();
  function resize() { const w = view.clientWidth, hh = view.clientHeight; renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(view); resize();

  const sph = new THREE.Spherical(), off = new THREE.Vector3();
  view.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'r' || k === 'R') reset();
    else if (k === '+' || k === '=' || k === '-' || k === '_' || k.startsWith('Arrow')) {
      off.copy(camera.position).sub(controls.target); sph.setFromVector3(off);
      const a = 0.08;
      if (k === 'ArrowLeft') sph.theta -= a; if (k === 'ArrowRight') sph.theta += a;
      if (k === 'ArrowUp') sph.phi -= a; if (k === 'ArrowDown') sph.phi += a;
      if (k === '+' || k === '=') sph.radius /= 1.12; if (k === '-' || k === '_') sph.radius *= 1.12;
      sph.phi = Math.min(controls.maxPolarAngle, Math.max(0.05, sph.phi));
      sph.radius = Math.min(controls.maxDistance, Math.max(controls.minDistance, sph.radius));
      camera.position.copy(controls.target).add(off.setFromSpherical(sph)); shell.done('turn');
    } else return;
    e.preventDefault();
  });

  view.querySelector('.mq-poster')?.remove(); view.querySelector('.ds-loading')?.remove();
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
  new IntersectionObserver(es => { onScreen = es[0].isIntersecting; run(); }).observe(root);
  document.addEventListener('visibilitychange', run); run();
  shell.set('tris', Math.round(tris).toLocaleString('en-US')); shell.set('meshes', meshes); shell.set('groups', units.size);
  shell.say('Model loaded');
  root.dataset.units = String(units.size);
  root.dataset.ready = '1';
  return { setExplode, reset, get explode() { return explodeTarget; } };
}

document.querySelectorAll('[data-mqp3d]').forEach(mount);
