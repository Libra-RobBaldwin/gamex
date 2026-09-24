// Water demo (water-demo.html): a phone-sized view from the game's isometric camera over three
// procedural places, with day and dusk lighting. Everything drawn comes from the water system:
// the ground (river channels cut into it) with its shore colours, one water mesh per tile, and
// one instanced mesh of reeds per tile. "Measure" times frames with and without the water.
//
// URL options: ?preset=coast|valley|lake|uplands &light=day|dusk &at=x,z &h=metres &az=radians
// &t=seconds (fix the animation time) &bench=1 (measure on load).

import * as THREE from 'three';
import { CachedHeight, ProceduralTerrain, TERRAIN_PRESETS, tileMesh, type HeightSource } from '../terrain';
import { Coastal } from './coast';
import { patchGroundMaterial, reedGeometry, reedMaterial, reedMesh, rippleTexture, setWaterLight, waterGeometry, waterMaterial, WATER_LIGHT, type WaterLight } from './material';
import { reedSpots, shoreColours, waterSurface } from './surface';
import { WaterSystem } from './water';
import { NavRig, mountNavControls } from '../kit/camera';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const Q = new URLSearchParams(location.search);

interface Place { name: string; desc: string; make: () => HeightSource; at: [number, number]; h: number; az: number }
// The seeds and spots were picked from maps of each region; change a parameter and the
// interesting places move.
const PLACES: Record<string, Place> = {
  coast: {
    name: 'Coast with an estuary', desc: 'Rolling country falling to the sea: beaches, a headland, a drowned valley and a river mouth',
    make: () => new Coastal(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 11, lakes: 0 }), { dir: [1, 0.3], at: 0, width: 3000, fall: 45, deep: 60 }),
    at: [2050, 5550], h: 900, az: Math.PI / 4,
  },
  valley: {
    name: 'River valley', desc: 'Rivers meandering on their floodplains, streams joining them',
    make: () => new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }),
    at: [5300, 3650], h: 700, az: Math.PI / 4,
  },
  lake: {
    name: 'Lake in a hollow', desc: 'A river running into a lake that fills a hollow to its spill level',
    make: () => new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }),
    at: [1500, 5800], h: 650, az: Math.PI / 4,
  },
  uplands: {
    name: 'Uplands', desc: 'A tarn in the fells, with a stream tumbling out of it',
    make: () => new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 7 }),
    at: [7050, 4050], h: 520, az: Math.PI / 4,
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
// the shared camera (kit/camera.ts): the game's gestures, on the terrain
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: 0, h: 300, az: Math.PI / 4, el: 0.6 },
  limits: { hMin: 60, hMax: 1400 },
  distance: 1500,
  // what's under the pointer (desktop): the water system's answers at that spot
  onHover: (p) => showProbe(p.ground),
});
const view = nav.view;
mountNavControls(nav, { parent: $('#phone'), top: 92 });
function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); nav.apply(); }
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
  nav.setGround((x, z) => ground.heightAt(x, z), [-120, 700]);
  nav.setView({ x: at[0], z: at[1], h: Number(Q.get('h')) || P.h, az: Q.has('az') ? Number(Q.get('az')) : P.az });
  // keep the camera over the tiles that were built
  nav.setLimits({ bounds: { minX: at[0] - 700, maxX: at[0] + 700, minZ: at[1] - 700, maxZ: at[1] + 700 } });
  $('#title').textContent = P.name; $('#desc').textContent = P.desc;
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.classList.toggle('on', b.dataset.preset === key));
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
  sun.position.copy(l.sunDir).multiplyScalar(500).add(new THREE.Vector3(view.x, view.y ?? 0, view.z)); sun.target.position.set(view.x, view.y ?? 0, view.z);
  scene.background = l.background.clone();
  $('#light').textContent = lightName === 'day' ? 'Dusk' : 'Day';
}

// ---------- input: the shared camera above; the demo's own buttons ----------
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => (b.onclick = () => { build(b.dataset.preset!); light(WATER_LIGHT[lightName]); }));
$('#light').onclick = () => { lightName = lightName === 'day' ? 'dusk' : 'day'; light(WATER_LIGHT[lightName]); };
$('#bench').onclick = () => bench();

function showProbe(g: { x: number; z: number }) {
  const { x, z } = g, p = water.probe(x, z), wc = water.watercourseAt(x, z), f = water.flowAt(x, z);
  $('#probe').innerHTML = p.level === null
    ? `Dry · ${water.distanceToShore(x, z).toFixed(0)} m to water`
    : `${p.kind} · depth ${(p.level - p.ground).toFixed(1)} m${f.speed ? ` · flow ${f.speed.toFixed(1)} m/s` : ''}${wc ? `<br>${wc.cls}, ${wc.width.toFixed(0)} m wide · bridge clearance ${wc.clearance} m${wc.channel ? ` · keep ${(2 * wc.channel).toFixed(0)} m clear` : ''}` : ''}`;
}

// ---------- measuring the water's cost ----------
// Frames timed with the water drawn and hidden, alternately. Reading back one pixel after each
// frame makes the GPU finish it before the clock stops (gl.finish() doesn't block in Chrome), so
// the difference is the water's cost. Where the browser has a GPU timer query, its numbers are
// reported too (they leave out the read-back).
function bench(frames = 30) {
  const gl = renderer.getContext() as WebGL2RenderingContext, px = new Uint8Array(4);
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number } | null;
  const gpu: Record<string, number[]> = { on: [], off: [] }, cpu: Record<string, number[]> = { on: [], off: [] };
  const queries: [WebGLQuery, boolean][] = [];
  const one = (on: boolean) => {
    waterMeshes.forEach((m) => (m.visible = on));
    waterMat.uniforms.uTime.value += 1 / 60;
    const q = tq ? gl.createQuery() : null;
    if (q) gl.beginQuery(tq!.TIME_ELAPSED_EXT, q);
    const t0 = performance.now();
    renderer.render(scene, cam);
    if (q) gl.endQuery(tq!.TIME_ELAPSED_EXT);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    cpu[on ? 'on' : 'off'].push(performance.now() - t0);
    if (q) queries.push([q, on]);
  };
  for (let i = 0; i < 4; i++) { one(true); one(false); } // warm up
  cpu.on.length = cpu.off.length = 0; queries.length = 0;
  for (let i = 0; i < frames; i++) { one(true); one(false); }
  waterMeshes.forEach((m) => (m.visible = true));
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
  // query results arrive a frame or two later
  setTimeout(() => {
    for (const [q, on] of queries) if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu[on ? 'on' : 'off'].push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    const on = med(cpu.on), off = med(cpu.off), g = gpu.on.length ? med(gpu.on) - med(gpu.off) : NaN;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const px = pixelCost(frames);
    const res = { withWater: on, withoutWater: off, water: on - off, gpuWater: g, ...px, width: canvas.width, height: canvas.height, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    (window as unknown as { waterBench: typeof res }).waterBench = res;
    $('#probe').innerHTML = `Frame ${on.toFixed(1)} ms with water, ${off.toFixed(1)} ms without: water ${(on - off).toFixed(1)} ms${g === g ? ` (GPU timer ${g.toFixed(2)} ms)` : ''} at ${canvas.width}×${canvas.height}<br>Full screen: water ${px.waterFull.toFixed(1)} ms, the game's ground ${px.groundFull.toFixed(1)} ms (${(px.waterFull / px.groundFull).toFixed(2)}×)`;
  }, 300);
}
// Cost per pixel: the water shader and the ground's material each filling the whole screen with
// nothing else drawn, so the ratio carries over to a phone's GPU better than absolute times from
// a software renderer do.
function pixelCost(frames: number) {
  const gl = renderer.getContext(), px = new Uint8Array(4), s2 = new THREE.Scene();
  s2.add(hemi.clone(), sun.clone());
  const quad = (mat: THREE.Material, extra: (g: THREE.BufferGeometry) => void) => {
    const g = new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2);
    extra(g);
    const m = new THREE.Mesh(g, mat);
    m.position.set(view.x, view.y ?? 0, view.z);
    return m;
  };
  const w = quad(waterMat, (g) => {
    g.setAttribute('aWater', new THREE.BufferAttribute(new Float32Array([2, 20, 0.6, 0.2, 0.3, 1, 0.6, 0.2, 4, 40, 0.6, 0.2, 1, 5, 0.6, 0.2]), 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array([3, 3, 3, 3]), 1));
  });
  const gr = quad(groundMat, (g) => g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16).fill(0.5), 4)));
  const time = (m: THREE.Mesh) => {
    s2.add(m);
    for (let i = 0; i < 3; i++) renderer.render(s2, cam);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t = performance.now();
    for (let i = 0; i < frames; i++) { waterMat.uniforms.uTime.value += 1 / 60; renderer.render(s2, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    s2.remove(m);
    return (performance.now() - t) / frames;
  };
  const waterFull = time(w), groundFull = time(gr);
  w.geometry.dispose(); gr.geometry.dispose();
  return { waterFull, groundFull };
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
  nav.update(dt, now);
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
(window as unknown as { demoReady: boolean; nav: NavRig }).demoReady = true;
(window as unknown as { nav: NavRig }).nav = nav;
