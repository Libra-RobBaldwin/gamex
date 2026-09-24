// Water demo (water-demo.html): a phone-sized view from the game's isometric camera over three
// procedural places, with day and dusk lighting. Everything drawn comes from the water system:
// the ground (river channels cut into it) with its shore colours, one water mesh per tile, and
// one instanced mesh of reeds per tile. "Measure" times frames with and without the water.
//
// URL options: ?preset=coast|valley|uplands &light=day|dusk &at=x,z &h=metres &az=radians
// &t=seconds (fix the animation time) &bench=1 (measure on load).

import * as THREE from 'three';
import { CachedHeight, ProceduralTerrain, TERRAIN_PRESETS, tileMesh, type HeightSource } from '../terrain';
import { Coastal } from './coast';
import { patchGroundMaterial, reedGeometry, reedMaterial, reedMesh, rippleTexture, setWaterLight, waterGeometry, waterMaterial, WATER_LIGHT, type WaterLight } from './material';
import { reedSpots, shoreColours, waterSurface } from './surface';
import { WaterSystem } from './water';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const Q = new URLSearchParams(location.search);

interface Place { name: string; desc: string; make: () => HeightSource; at: [number, number]; h: number; az: number }
// The seeds and spots were picked from maps of each region; change a parameter and the
// interesting places move.
const PLACES: Record<string, Place> = {
  coast: {
    name: 'Coast with an estuary', desc: 'Rolling country falling to the sea; drowned valleys and a river mouth',
    make: () => new Coastal(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 11, lakes: 0 }), { dir: [1, 0.3], at: 0, width: 3000, fall: 45, deep: 60 }),
    at: [1850, 5470], h: 520, az: Math.PI / 4,
  },
  valley: {
    name: 'River valley', desc: 'A meandering river on its floodplain, streams joining, a lake in a hollow',
    make: () => new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }),
    at: [4650, 3450], h: 460, az: Math.PI / 4,
  },
  uplands: {
    name: 'Uplands', desc: 'Fells with streams running off them and a tarn',
    make: () => new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 7 }),
    at: [6500, 3800], h: 520, az: Math.PI / 4,
  },
};

// ---------- three ----------
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight('#e8f3ff', '#5d7040', 1.25);
const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
scene.add(hemi, sun, sun.target);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
const view = { x: 0, z: 0, y: 0, az: Math.PI / 4, el: 0.6, h: 300 };

function place() {
  const w = canvas.clientWidth, h = canvas.clientHeight, a = w / h;
  cam.left = (-view.h * a) / 2; cam.right = (view.h * a) / 2; cam.top = view.h / 2; cam.bottom = -view.h / 2;
  cam.updateProjectionMatrix();
  const d = 1500;
  cam.position.set(view.x + Math.sin(view.az) * Math.cos(view.el) * d, view.y + Math.sin(view.el) * d, view.z + Math.cos(view.az) * Math.cos(view.el) * d);
  cam.lookAt(view.x, view.y, view.z);
}
function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); place(); }
window.addEventListener('resize', resize);

// grass, as in the game (a speckled canvas texture)
function grass() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#6f9e48'; x.fillRect(0, 0, 256, 256);
  let s = 3;
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  for (let i = 0; i < 5000; i++) { x.fillStyle = `rgba(${60 + r() * 40},${120 + r() * 60},${40 + r() * 30},0.35)`; x.fillRect(r() * 256, r() * 256, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
const groundMat = patchGroundMaterial(new THREE.MeshLambertMaterial({ map: grass() }));
const ripple = rippleTexture(128);
const waterMat = waterMaterial(ripple);
const reedMat = reedMaterial(), reedGeo = reedGeometry();
const treeMat = new THREE.MeshLambertMaterial({ color: '#3f6b2e' }), trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4f33' });
const crownGeo = new THREE.IcosahedronGeometry(3.4, 1), trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);
crownGeo.translate(0, 5.8, 0); trunkGeo.translate(0, 1.75, 0);

let world = new THREE.Group(), waterMeshes: THREE.Mesh[] = [];
scene.add(world);
const timings: Record<string, number> = {};
let water: WaterSystem, ground: CachedHeight;

function build(key: string) {
  const P = PLACES[key];
  scene.remove(world);
  world.traverse((o) => { if ((o as THREE.Mesh).geometry && o.userData.own) (o as THREE.Mesh).geometry.dispose(); });
  world = new THREE.Group(); waterMeshes = [];
  scene.add(world);
  const at = (Q.get('at')?.split(',').map(Number) as [number, number] | undefined) ?? P.at;
  let t0 = performance.now();
  water = new WaterSystem(P.make());
  water.region(Math.floor(at[0] / water.P.region), Math.floor(at[1] / water.P.region));
  timings.region = performance.now() - t0;
  ground = new CachedHeight(water.terrain);
  // the 1 km tiles within 700 m of the spot
  timings.water = timings.mesh = 0;
  let wetTiles = 0;
  const tiles: [number, number][] = [];
  for (let ti = Math.floor((at[0] - 700) / 1000); ti <= Math.floor((at[0] + 700) / 1000); ti++) for (let tj = Math.floor((at[1] - 700) / 1000); tj <= Math.floor((at[1] + 700) / 1000); tj++) tiles.push([ti, tj]);
  for (const [ti, tj] of tiles) {
    t0 = performance.now();
    const wt = water.tile(ti, tj);
    const ws = waterSurface(wt), reeds = reedSpots(wt);
    timings.water += performance.now() - t0;
    t0 = performance.now();
    const m = tileMesh(water.terrain, ti, tj, { cells: 400, skirt: 6, uvScale: 16 });
    timings.mesh += performance.now() - t0;
    const col = shoreColours(wt, m);
    uplandColours(m.normals, m.positions, col);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    const gm = new THREE.Mesh(g, groundMat);
    gm.position.set(m.offset[0], 0, m.offset[1]); gm.userData.own = true;
    world.add(gm);
    if (ws) {
      const wm = new THREE.Mesh(waterGeometry(ws), waterMat);
      wm.position.set(ws.offset[0], 0, ws.offset[1]); wm.renderOrder = 2; wm.userData.own = true;
      world.add(wm); waterMeshes.push(wm); wetTiles++;
    }
    if (reeds.length) { const rm = reedMesh(reeds, reedGeo, reedMat); rm.renderOrder = 1; world.add(rm); }
    world.add(...trees(ti, tj));
  }
  timings.tiles = tiles.length; timings.wet = wetTiles;
  view.x = at[0]; view.z = at[1]; view.y = ground.heightAt(at[0], at[1]);
  view.h = Number(Q.get('h')) || P.h; view.az = Q.has('az') ? Number(Q.get('az')) : P.az;
  $('#title').textContent = P.name; $('#desc').textContent = P.desc;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === key));
  place();
}

// Bare rock and heather on steep upland slopes, so fells read as fells (demo only: the water
// system only colours the shore). Leaves the shore colours alone.
function uplandColours(nor: Float32Array, pos: Float32Array, col: Float32Array) {
  const rock = [0.33, 0.32, 0.29], heath = [0.22, 0.2, 0.12];
  for (let v = 0; v < nor.length / 3; v++) {
    if (col[v * 4 + 3] > 0.05) continue;
    const s = 1 - nor[v * 3 + 1], y = pos[v * 3 + 1];
    const r = Math.min(1, Math.max(0, (s - 0.22) / 0.15)), h = Math.min(1, Math.max(0, (y - 200) / 150)) * 0.5;
    if (r < 0.02 && h < 0.02) continue;
    const c = r > h ? rock : heath, a = Math.max(r, h);
    col[v * 4] = c[0]; col[v * 4 + 1] = c[1]; col[v * 4 + 2] = c[2]; col[v * 4 + 3] = a * 0.85;
  }
}

// Scattered trees for scale, kept off water and its banks by the water system's shore distance.
function trees(ti: number, tj: number): THREE.Object3D[] {
  let s = (ti * 73856093) ^ (tj * 19349663);
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const pts: THREE.Matrix4[] = [];
  for (let i = 0; i < 900; i++) {
    const x = ti * 1000 + r() * 1000, z = tj * 1000 + r() * 1000, sc = 0.8 + r() * 0.6;
    // woods in clumps: a coarse hash decides where
    const cx = Math.floor(x / 90), cz = Math.floor(z / 90), wood = (((cx * 92837111) ^ (cz * 689287499)) >>> 0) % 5 === 0;
    if (!wood && r() > 0.12) continue;
    if (water.distanceToShore(x, z) > -8 || ground.slopeAt(x, z) > 0.45) continue;
    pts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, ground.heightAt(x, z), z), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc)));
  }
  const crowns = new THREE.InstancedMesh(crownGeo, treeMat, Math.max(1, pts.length)), trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, pts.length));
  pts.forEach((m, i) => { crowns.setMatrixAt(i, m); trunks.setMatrixAt(i, m); });
  crowns.count = trunks.count = pts.length;
  crowns.computeBoundingSphere(); trunks.computeBoundingSphere();
  return [crowns, trunks];
}

// ---------- light ----------
let lightName: 'day' | 'dusk' = Q.get('light') === 'dusk' ? 'dusk' : 'day';
function light(l: WaterLight) {
  setWaterLight(waterMat, l);
  hemi.color.copy(l.hemiSky); hemi.groundColor.copy(l.hemiGround); hemi.intensity = l.hemi;
  sun.color.copy(l.sun); sun.intensity = l.sunIntensity;
  sun.position.copy(l.sunDir).multiplyScalar(500).add(new THREE.Vector3(view.x, view.y, view.z)); sun.target.position.set(view.x, view.y, view.z);
  scene.background = l.background.clone();
  $('#light').textContent = lightName === 'day' ? 'Dusk' : 'Day';
}

// ---------- input ----------
let drag: { x: number; y: number } | null = null;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag = { x: e.clientX, y: e.clientY }; pinch = 0; });
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) { showProbe(e); return; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) view.h = Math.max(60, Math.min(1400, (view.h * pinch) / d));
    pinch = d; place(); return;
  }
  if (!drag) return;
  const k = view.h / canvas.clientHeight, dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k / Math.sin(view.el);
  view.x -= dx * Math.cos(view.az) + dy * Math.sin(view.az);
  view.z -= -dx * Math.sin(view.az) + dy * Math.cos(view.az);
  drag = { x: e.clientX, y: e.clientY };
  view.y = ground.heightAt(view.x, view.z);
  place();
});
const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (!pointers.size) drag = null; pinch = 0; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { view.h = Math.max(60, Math.min(1400, view.h * Math.exp(e.deltaY * 0.001))); place(); e.preventDefault(); }, { passive: false });
$('#rotl').onclick = () => { view.az += Math.PI / 4; place(); };
$('#rotr').onclick = () => { view.az -= Math.PI / 4; place(); };
$('#zin').onclick = () => { view.h = Math.max(60, view.h / 1.4); place(); };
$('#zout').onclick = () => { view.h = Math.min(1400, view.h * 1.4); place(); };
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => (b.onclick = () => { build(b.dataset.preset!); light(WATER_LIGHT[lightName]); }));
$('#light').onclick = () => { lightName = lightName === 'day' ? 'dusk' : 'day'; light(WATER_LIGHT[lightName]); };
$('#bench').onclick = () => bench();

// What's under the pointer (desktop): the water system's answers at that spot.
const ray = new THREE.Raycaster();
function showProbe(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
  const hit = ray.intersectObjects(world.children.filter((o) => (o as THREE.Mesh).material === groundMat))[0];
  if (!hit) return;
  const { x, z } = hit.point, p = water.probe(x, z), wc = water.watercourseAt(x, z), f = water.flowAt(x, z);
  $('#probe').innerHTML = p.level === null
    ? `Dry · ${water.distanceToShore(x, z).toFixed(0)} m to water`
    : `${p.kind} · depth ${(p.level - p.ground).toFixed(1)} m${f.speed ? ` · flow ${f.speed.toFixed(1)} m/s` : ''}${wc ? `<br>${wc.cls}, ${wc.width.toFixed(0)} m wide · bridge clearance ${wc.clearance} m${wc.channel ? ` · keep ${(2 * wc.channel).toFixed(0)} m clear` : ''}` : ''}`;
}

// ---------- measuring the water's cost ----------
// Frames timed with the water drawn and hidden. gl.finish() makes each frame complete before the
// clock stops, so the difference is the water's GPU cost (roughly: the CPU side is tiny).
function bench(frames = 40) {
  const gl = renderer.getContext(), time = (on: boolean) => {
    waterMeshes.forEach((m) => (m.visible = on));
    renderer.render(scene, cam); gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) { waterMat.uniforms.uTime.value += 1 / 60; renderer.render(scene, cam); }
    gl.finish();
    return (performance.now() - t0) / frames;
  };
  const off1 = time(false), on1 = time(true), off2 = time(false), on2 = time(true);
  waterMeshes.forEach((m) => (m.visible = true));
  const on = (on1 + on2) / 2, off = (off1 + off2) / 2, px = canvas.width * canvas.height;
  const res = { withWater: on, withoutWater: off, water: on - off, pixels: px, renderer: (gl.getParameter(gl.RENDERER) as string) ?? '' };
  (window as unknown as { waterBench: typeof res }).waterBench = res;
  $('#probe').innerHTML = `Frame ${on.toFixed(1)} ms with water, ${off.toFixed(1)} ms without: water ${(on - off).toFixed(1)} ms at ${canvas.width}×${canvas.height}`;
  return res;
}

// ---------- loop ----------
let last = performance.now(), fps = 60;
const fixedT = Q.has('t') ? Number(Q.get('t')) : null;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
  const t = fixedT ?? now / 1000;
  waterMat.uniforms.uTime.value = t; reedMat.userData.time.value = t;
  renderer.render(scene, cam);
  const i = renderer.info.render;
  $('#stats').textContent = `${fps.toFixed(0)} fps · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k tris · region ${timings.region.toFixed(0)} ms · water ${(timings.water / timings.tiles).toFixed(0)} ms/tile · ground ${(timings.mesh / timings.tiles).toFixed(0)} ms/tile`;
  requestAnimationFrame(frame);
}

build(Q.get('preset') && PLACES[Q.get('preset')!] ? Q.get('preset')! : 'valley');
resize();
light(WATER_LIGHT[lightName]);
requestAnimationFrame(frame);
if (Q.has('bench')) setTimeout(() => bench(), 500);
(window as unknown as { demoReady: boolean }).demoReady = true;
