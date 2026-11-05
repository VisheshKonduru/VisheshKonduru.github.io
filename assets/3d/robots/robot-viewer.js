// Small orbit viewer for a robot .glb, used inside Activities panels.
// mount(el) reads el.dataset.model (URL of the .glb, relative to the page) and returns dispose().
// Renders only when the view changes. No auto-rotate: the visitor drags to turn.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let draco = null;

export function mount(el) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let alive = true, frame = 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', el.dataset.label || '3D robot model. Drag to turn, scroll or pinch to zoom, arrow keys turn.');
  el.prepend(canvas);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(1, 2, 1.5); scene.add(key);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reduce; controls.dampingFactor = 0.1;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.55;

  function size() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    request();
  }
  function render() {
    frame = 0;
    if (!alive) return;
    if (controls.update()) request();   // keeps damping running until it settles
    renderer.render(scene, camera);
  }
  function request() { if (!frame && alive) frame = requestAnimationFrame(render); }
  controls.addEventListener('change', request);
  const ro = new ResizeObserver(size); ro.observe(el);

  // Arrow keys turn, + and - zoom.
  function onKey(e) {
    const s = Math.PI / 18, c = controls;
    const off = camera.position.clone().sub(c.target), sph = new THREE.Spherical().setFromVector3(off);
    if (e.key === 'ArrowLeft') sph.theta -= s; else if (e.key === 'ArrowRight') sph.theta += s;
    else if (e.key === 'ArrowUp') sph.phi = Math.max(0.1, sph.phi - s); else if (e.key === 'ArrowDown') sph.phi = Math.min(c.maxPolarAngle, sph.phi + s);
    else if (e.key === '+' || e.key === '=') sph.radius = Math.max(c.minDistance, sph.radius * 0.88);
    else if (e.key === '-') sph.radius = Math.min(c.maxDistance, sph.radius / 0.88);
    else return;
    e.preventDefault(); e.stopPropagation();
    camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
    c.update(); request();
  }
  canvas.addEventListener('keydown', onKey);
  // Keep drags inside the viewer from triggering the panel's swipe-to-next.
  const stop = (e) => e.stopPropagation();
  canvas.addEventListener('pointerdown', stop); canvas.addEventListener('pointerup', stop);

  if (!draco) draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let model = null;
  loader.load(new URL(el.dataset.model, location.href).href, (gltf) => {
    if (!alive) { free(gltf.scene); return; }
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
    scene.add(model);
    const sz = box.getSize(new THREE.Vector3()), r = sz.length() / 2;
    controls.target.set(0, sz.y * 0.45, 0);
    const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.95;
    camera.position.set(d * 0.62, sz.y * 0.45 + d * 0.42, d * 0.66);
    camera.near = d / 100; camera.far = d * 10; camera.updateProjectionMatrix();
    controls.minDistance = r * 1.1; controls.maxDistance = d * 2.5;
    controls.update();
    el.classList.add('ready');
    size(); request();
  }, undefined, (e) => { console.error(e); el.classList.add('failed'); });

  function free(root) {
    root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) [].concat(o.material).forEach(m => m.dispose());
    });
  }
  return function dispose() {
    alive = false;
    if (frame) cancelAnimationFrame(frame);
    ro.disconnect(); controls.dispose();
    if (model) free(model);
    envTex.dispose(); pmrem.dispose();
    renderer.dispose(); renderer.forceContextLoss();
    canvas.remove();
    el.classList.remove('ready');
  };
}
