// The vehicle showroom: vehicles-demo.html. Three views, at phone size, with the game's
// isometric camera:
//   Parade    – hundreds of instanced vehicles round an oval road and railway, by day or night,
//               with fps and draw calls, to show what the library costs;
//   Showroom  – every model that matches the filters, parked in rows;
//   Turntable – one vehicle up close, with its spec card, livery and lights, and its doors
//               (the Doors button opens them; Close-up frames the first door).
// The Parade has a station and a bus stop by the start view: trains stop at the platforms and
// buses pull into the lay-by, and their doors open on the platform or kerb side while they stand.
// The URL holds the state (?mode=parade&cat=car&year=1975&night=1…) so screenshots are repeatable.
import * as THREE from 'three';
import { Ground } from '../ground';
import { MODELS, MODEL, STYLE_LABEL } from './models';
import { BRANDS, BRAND } from './brands';
import { OPERATORS, OPERATOR } from './operators';
import { VehicleRenderer, Glow, liveryColours, lodFor } from './render';
import { lookFor, type Look } from './appearance';
import { pickVehicle, pickTrain, type Area } from './spawn';
import { follow, type Pose } from './articulation';
import { FLAGS, type Category, type Lod, type Model } from './types';
import { rng, hash, pick } from './util';
import { plateCanvas, eraOf } from './era';
import { BUDGET, triangles } from './build';
import { NavRig, SunFollow } from '../kit/camera';
import { doorsOf, dwellDoors, doorSeconds, doorPositions, platformSide } from './doors';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------- state ----------------
const q = new URLSearchParams(location.search);
const S = {
  mode: (q.get('mode') ?? 'parade') as 'parade' | 'showroom' | 'turntable',
  cat: q.get('cat') ?? 'all', brand: q.get('brand') ?? 'all', op: q.get('op') ?? 'all',
  year: +(q.get('year') ?? 2000), night: q.get('night') === '1', count: +(q.get('n') ?? 300),
  area: (q.get('area') ?? 'centre') as Area, lod: q.get('lod') ?? 'auto', model: q.get('model') ?? '',
  variety: +(q.get('variety') ?? 60), fit: +(q.get('fit') ?? 1), seed: +(q.get('seed') ?? 1), zoom: +(q.get('zoom') ?? 0), shadows: q.get('shadows') !== '0',
  spin: q.get('spin') !== '0', angle: +(q.get('angle') ?? 0.6), ui: q.get('ui') !== '0', card: q.get('card') !== '0', filters: q.get('filters') === '1',
  // doors open on the turntable; the door close-up; a view preset in the parade ('stop': the station and bus stop)
  doors: q.get('doors') === '1', close: q.get('close') === '1', at: q.get('at') ?? '',
};
function saveUrl() {
  const p = new URLSearchParams();
  const on = ['spin', 'shadows', 'ui', 'card']; // switches that default to on (filters defaults off)
  for (const [k, v] of Object.entries(S)) {
    if (typeof v === 'boolean') { if (on.includes(k) ? !v : v) p.set(k, v ? '1' : '0'); continue; }
    if (v !== '' && v !== 'all') p.set(k === 'count' ? 'n' : k, String(v));
  }
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

// ---------------- three ----------------
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
const hemi = new THREE.HemisphereLight('#dfe9f5', '#5a6a4a', 1.3);
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4;
scene.add(hemi, sun, sun.target);
const vr = new VehicleRenderer({ shadows: true });
scene.add(vr.group);
const beams = new Glow('beam', 4096, 0.55), pools = new Glow('pool', 1024, 0.5);
scene.add(beams.mesh, pools.mesh);

// the shared camera (kit/camera.ts); the sun's shadow follows the view in texel steps
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: -110, az: Math.PI / 4, el: 0.6, h: 90 },
  limits: { hMin: 4, hMax: 3000 },
  distance: 2000,
  shadow: new SunFollow(sun, { dir: { x: -160, y: 260, z: 110 }, radius: 60 }),
  // on the turntable a one-finger drag turns the vehicle rather than the map
  onDragStart: () => S.mode === 'turntable' && !!tt,
  // and so does the finger left after a pinch
  onRemaining: () => S.mode === 'turntable' && !!tt,
  onClaimMove: (p) => { if (tt) tt.a += p.dx * 0.01; },
  // a tap in the showroom opens that vehicle on the turntable
  onTap: (p) => { if (S.mode === 'showroom') { tapShowroom(p.sx, p.sy); opened = p.t; } },
  // a double tap zooms in as everywhere else, but not the second tap of one that opened a vehicle
  onDoubleTap: (p) => p.t - opened < 500,
});
const view = nav.view;
let opened = -Infinity;
// the view was set by hand (a new scene): stop any glide and show it
const place = () => { nav.stop(); nav.apply(); };
function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); place(); }
addEventListener('resize', resize);

function setNight(n: boolean) {
  scene.background = new THREE.Color(n ? '#0d1320' : '#b9cfe0');
  hemi.color.set(n ? '#6d84b8' : '#dfe9f5'); hemi.groundColor.set(n ? '#1a2030' : '#5a6a4a'); hemi.intensity = n ? 0.8 : 1.3;
  sun.color.set(n ? '#9fb3d9' : '#fff4e0'); sun.intensity = n ? 0.55 : 2.2;
  beams.mesh.visible = pools.mesh.visible = n;
  sun.castShadow = S.shadows && !n;
  vr.uniforms.uNight.value = n ? 1 : 0;
  for (const m of worldMats) m.color.set(n ? m.userData.night : m.userData.day);
}

// ---------------- the world: an oval road with a railway outside it ----------------
const R = 110, SL = 380; // semicircle radius and half the straight
const P0 = 4 * SL + 2 * Math.PI * R;
// A point on an oval of the same shape, offset outward by `off`, at arc length s along that
// offset line itself: a metre of s is a metre of track or lane, so speeds, wheel turns and
// curvature come out true on the bends (1 / (rr + off) there). Each offset's loop is its own
// length, loopOf(off).
function oval(s: number, off: number, rr = R, sl = SL) {
  const Rr = rr + off;
  const p0 = 4 * sl + 2 * Math.PI * Rr;
  s = ((s % p0) + p0) % p0;
  if (s < 2 * sl) return { x: -sl + s, z: -Rr, h: 0 };
  s -= 2 * sl;
  if (s < Math.PI * Rr) { const a = -Math.PI / 2 + s / Rr; return { x: sl + Math.cos(a) * Rr, z: Math.sin(a) * Rr, h: a + Math.PI / 2 }; }
  s -= Math.PI * Rr;
  if (s < 2 * sl) return { x: sl - s, z: Rr, h: Math.PI };
  s -= 2 * sl;
  const a = Math.PI / 2 + s / Rr;
  return { x: -sl + Math.cos(a) * Rr, z: Math.sin(a) * Rr, h: a + Math.PI / 2 };
}
const loopOf = (off: number, rr = R, sl = SL) => 4 * sl + 2 * Math.PI * (rr + off);
// The same oval by the centre line's arc length u, for drawing: ribbons need both edges of a
// strip at the same u so their quads stay square across the road.
function ovalC(s: number, off: number, rr = R, sl = SL) {
  const p0 = 4 * sl + 2 * Math.PI * rr;
  s = ((s % p0) + p0) % p0;
  const Rr = rr + off;
  if (s < 2 * sl) return { x: -sl + s, z: -Rr, h: 0 };
  s -= 2 * sl;
  if (s < Math.PI * rr) { const a = -Math.PI / 2 + s / rr; return { x: sl + Math.cos(a) * Rr, z: Math.sin(a) * Rr, h: a + Math.PI / 2 }; }
  s -= Math.PI * rr;
  if (s < 2 * sl) return { x: sl - s, z: Rr, h: Math.PI };
  s -= 2 * sl;
  const a = Math.PI / 2 + s / rr;
  return { x: -sl + Math.cos(a) * Rr, z: Math.sin(a) * Rr, h: a + Math.PI / 2 };
}
const worldMats: THREE.MeshLambertMaterial[] = [];
const mat = (day: string, night: string) => { const m = new THREE.MeshLambertMaterial({ color: day }); m.userData = { day, night }; worldMats.push(m); return m; };
function ribbon(off0: number, off1: number, y: number, m: THREE.Material, rr = R, sl = SL, dash = 0) {
  const pos: number[] = [];
  const p0 = 4 * sl + 2 * Math.PI * rr;
  const n = Math.ceil(p0 / 4);
  for (let i = 0; i < n; i++) {
    if (dash && i % 3 !== 0) continue;
    const s0 = (i / n) * p0, s1 = ((i + 1) / n) * p0;
    const a = ovalC(s0, off0, rr, sl), b = ovalC(s0, off1, rr, sl), c = ovalC(s1, off1, rr, sl), d = ovalC(s1, off0, rr, sl);
    pos.push(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, a.x, y, a.z, c.x, y, c.z, d.x, y, d.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  // make sure the faces point up whatever the winding
  (m as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  return mesh;
}
const world = new THREE.Group();
scene.add(world);
// the shared ground, tinted grey at night
const grass = new Ground().material;
Object.assign(grass.userData, { day: '#ffffff', night: '#595959' }); worldMats.push(grass);
const asphalt = mat('#4a4d52', '#2a2d33'), white = mat('#e8e8e2', '#9a9a96'), ballast = mat('#8a8074', '#3a3834'), railM = mat('#5b5e62', '#4a4c50'), water = mat('#3f6f8a', '#16283a'), pave = mat('#b3aea3', '#4a4a48');
// four lanes, or eight (a motorway) when the count needs them; outer lanes run +s (UK: keep left)
let lanes = [-5.25, -1.75, 1.75, 5.25];
const setLanes = (n: number) => { lanes = n > 800 ? [-12.25, -8.75, -5.25, -1.75, 1.75, 5.25, 8.75, 12.25] : [-5.25, -1.75, 1.75, 5.25]; };
const laneSpeed = (off: number) => [11, 13, 15, 17][Math.min(3, Math.floor(Math.abs(off) / 3.5))];
let streetLamps: { x: number; z: number }[] = [];
const RAIL = [26, 30.5];
function buildWorld(lake: boolean) {
  world.clear();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), grass);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  if (lake) world.add(ribbon(-R + 1, -12, 0.02, S.cat === 'air' ? pave : water));
  const edge = Math.abs(lanes[0]) + 1.95;
  world.add(ribbon(-edge, edge, 0.03, asphalt), ribbon(-edge - 2.3, -edge, 0.05, pave), ribbon(edge, edge + 2.3, 0.05, pave));
  world.add(ribbon(-0.2, -0.08, 0.06, white), ribbon(0.08, 0.2, 0.06, white), ribbon(-edge + 0.25, -edge + 0.35, 0.06, white), ribbon(edge - 0.35, edge - 0.25, 0.06, white));
  for (let o = 3.5; o < edge - 1; o += 3.5) world.add(ribbon(-o - 0.05, -o + 0.05, 0.06, white, R, SL, 1), ribbon(o - 0.05, o + 0.05, 0.06, white, R, SL, 1));
  for (const t of RAIL) {
    world.add(ribbon(t - 2, t + 2, 0.06, ballast));
    world.add(ribbon(t - 0.78, t - 0.7, 0.28, railM), ribbon(t + 0.7, t + 0.78, 0.28, railM));
  }
  // sleepers: a quad every 0.75 m, all in one mesh
  const sp: number[] = [];
  for (const t of RAIL) {
    const n = Math.floor(P0 / 0.75);
    for (let k = 0; k < n; k++) {
      const s0 = (k / n) * P0, s1 = s0 + 0.26;
      const a = ovalC(s0, t - 1.25), b = ovalC(s0, t + 1.25), c = ovalC(s1, t + 1.25), d = ovalC(s1, t - 1.25);
      sp.push(a.x, 0.16, a.z, b.x, 0.16, b.z, c.x, 0.16, c.z, a.x, 0.16, a.z, c.x, 0.16, c.z, d.x, 0.16, d.z);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sg.computeVertexNormals();
  const sm = mat('#5a4a3a', '#2a241e'); sm.side = THREE.DoubleSide;
  const sl = new THREE.Mesh(sg, sm); sl.receiveShadow = true; world.add(sl);
  // street lamps along the road: a post, a glowing head, and a pool of light at night
  const lamps: { x: number; z: number }[] = [];
  for (let s0 = 0; s0 < P0; s0 += 36) for (const side of [-1, 1]) {
    const sl = s0 + (side > 0 ? 18 : 0);
    if (side < 0 && sl > BUS_STOP.s0 - 16 && sl < BUS_STOP.s1 + 16) continue; // not in the bus lay-by
    const p = ovalC(sl, side * (Math.abs(lanes[0]) + 3.4)); lamps.push({ x: p.x, z: p.z });
  }
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 8, 0.2).translate(0, 4, 0), mat('#6a6e72', '#3a3e44'), lamps.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.25, 0.5).translate(0, 8, 0), new THREE.MeshBasicMaterial({ color: '#ffe0a8' }), lamps.length);
  const m4 = new THREE.Matrix4();
  lamps.forEach((l, i) => { m4.makeTranslation(l.x, 0, l.z); post.setMatrixAt(i, m4); head.setMatrixAt(i, m4); });
  post.castShadow = true; world.add(post, head);
  streetLamps = lamps;
  world.add(stopsMesh());
  // a showroom floor for the parked rows
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), pave);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; floor.name = 'floor'; floor.visible = false;
  world.add(floor);
  setNight(S.night);
}

// ---------------- the station and the bus stop ----------------
// Both on the near straight, in front of the start view. Trains run +s on both tracks and stop
// with their fronts at STATION.stop; the platform for the inner track is on its inner side and the
// one for the outer track on its outer side. Buses in the innermost lane (which runs −s, kerb on
// the inner side) pull into a lay-by and stop with their fronts at BUS_STOP.
const STATION = { s0: 170, s1: 362, stop: 300, dwell: 16, platforms: [[20.9, 24.45], [32.05, 35.6]] as [number, number][], height: 0.28 + 0.92 };
const BUS_STOP = { front: 262, s0: 250, s1: 318, dwell: 10 };
const bayOff = () => -(Math.abs(lanes[0]) + 1.95 + 1.5); // the middle of the lay-by
// A flat strip between arc lengths s0..s1 and offsets off0..off1, at height y (the ribbon's
// partial cousin), or a box standing on it when top > 0.
function strip(out: THREE.BufferGeometry[], s0: number, s1: number, off0: number, off1: number, y: number, colour: string, top = 0) {
  const n = Math.max(1, Math.ceil((s1 - s0) / 4));
  const pos: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  const P = (s: number, off: number, h: number) => { const p = ovalC(s, off); return new THREE.Vector3(p.x, h, p.z); };
  for (let i = 0; i < n; i++) {
    const a = s0 + ((s1 - s0) * i) / n, b = s0 + ((s1 - s0) * (i + 1)) / n;
    const yt = y + top;
    quad(P(a, off0, yt), P(a, off1, yt), P(b, off1, yt), P(b, off0, yt));
    if (top > 0) {
      quad(P(a, off0, y), P(a, off0, yt), P(b, off0, yt), P(b, off0, y));
      quad(P(a, off1, y), P(b, off1, y), P(b, off1, yt), P(a, off1, yt));
      if (i === 0) quad(P(a, off0, y), P(a, off1, y), P(a, off1, yt), P(a, off0, yt));
      if (i === n - 1) quad(P(b, off0, y), P(b, off0, yt), P(b, off1, yt), P(b, off1, y));
    }
  }
  // wind every triangle to face up (tops) or away from the strip's middle (sides)
  const mid = P((s0 + s1) / 2, (off0 + off1) / 2, y + top / 2);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3 - mid.x, cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3 - mid.z;
    const up = Math.abs(ny) > 0.9 * Math.hypot(nx, ny, nz);
    if (up ? ny < 0 : nx * cx + nz * cz < 0) for (let j = 0; j < 3; j++) { const t = pos[i + 3 + j]; pos[i + 3 + j] = pos[i + 6 + j]; pos[i + 6 + j] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  const c = new THREE.Color(colour);
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(nrm.count).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
  out.push(g);
}
// A box at a point on the oval, turned to the track.
function post(out: THREE.BufferGeometry[], s: number, off: number, y0: number, y1: number, w: number, d: number, colour: string) {
  const p = ovalC(s, off);
  const g = new THREE.BoxGeometry(w, y1 - y0, d).toNonIndexed();
  g.rotateY(-p.h); g.translate(p.x, (y0 + y1) / 2, p.z);
  const c = new THREE.Color(colour);
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.getAttribute('position').count).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
  g.deleteAttribute('uv');
  out.push(g);
}
const stopsMat = (() => { const m = mat('#ffffff', '#4d5566'); m.vertexColors = true; return m; })();
function stopsMesh() {
  const gs: THREE.BufferGeometry[] = [];
  const { s0, s1, height: ph } = STATION;
  // platforms: concrete with a white edge line and a yellow line back from it, a canopy on posts
  STATION.platforms.forEach(([a, b], i) => {
    strip(gs, s0, s1, a, b, 0, '#a7a39a', ph);
    const edge = i === 0 ? b : a, dir = i === 0 ? -1 : 1;
    strip(gs, s0, s1, edge + dir * 0.02, edge + dir * 0.12, ph + 0.004, '#efefe8');
    strip(gs, s0, s1, edge + dir * 0.75, edge + dir * 0.85, ph + 0.004, '#e2c23a');
    // no canopy: from the game's camera it would hide the trains; lamps, nameboards and benches
    const cm = (a + b) / 2 + dir * 0.4;
    for (let s = s0 + 20; s < s1 - 10; s += 24) { post(gs, s, cm + dir * 1.1, ph, ph + 3.6, 0.1, 0.1, '#2f4f3f'); post(gs, s, cm + dir * 0.8, ph + 3.5, ph + 3.62, 0.25, 0.7, '#e8e4d0'); }
    // nameboards and benches
    for (const s of [s0 + 45, s1 - 60]) { post(gs, s, cm + dir * 1.25, ph, ph + 2.6, 0.1, 0.1, '#1f3b5a'); post(gs, s, cm + dir * 1.25, ph + 2.0, ph + 2.6, 2.2, 0.08, '#1f3b5a'); post(gs, s, cm + dir * 1.25, ph + 2.08, ph + 2.52, 2.0, 0.1, '#f2f2ee'); }
    for (let s = s0 + 60; s < s1 - 40; s += 36) post(gs, s, cm + dir * 0.85, ph, ph + 0.45, 1.6, 0.45, '#6b4a2e');
  });
  // the bus lay-by: asphalt over the verge, a kerb, the yellow box and the BUS STOP marking
  const e = Math.abs(lanes[0]) + 1.95, bo = -(e + 3.0);
  const w0 = BUS_STOP.s0, w1 = BUS_STOP.s1;
  strip(gs, w0 - 14, w1 + 14, bo, -e, 0.066, '#4a4d52');
  strip(gs, w0 - 14, w1 + 14, bo - 2.4, bo, 0.066, '#b3aea3', 0.1);
  strip(gs, w0, w1, bo + 0.2, bo + 0.3, 0.072, '#e2c23a');
  strip(gs, w0, w1, -e - 0.3, -e - 0.2, 0.072, '#e2c23a');
  // the shelter and the stop flag at the head of the stop
  const sh = w0 + 6;
  post(gs, sh, bo - 1.4, 0.16, 2.5, 3.6, 0.06, '#8fb4c4');
  post(gs, sh - 1.8, bo - 0.9, 0.16, 2.5, 0.06, 1.0, '#8fb4c4');
  post(gs, sh + 1.8, bo - 0.9, 0.16, 2.5, 0.06, 1.0, '#8fb4c4');
  post(gs, sh, bo - 0.9, 2.5, 2.6, 3.8, 1.3, '#2f4f3f');
  post(gs, sh, bo - 1.1, 0.16, 0.6, 2.4, 0.4, '#6b4a2e');
  post(gs, w0 - 1, bo - 0.4, 0.16, 2.9, 0.08, 0.08, '#6e7378');
  post(gs, w0 - 1, bo - 0.4, 2.4, 2.9, 0.06, 0.5, '#d8342c');
  const g = mergeGeometries(gs);
  const m = new THREE.Mesh(g, stopsMat);
  m.receiveShadow = true; m.castShadow = true; m.name = 'stops';
  return m;
}

// ---------------- filtering ----------------
const matches = (m: Model) =>
  (S.cat === 'all' || m.category === S.cat || (S.cat === 'lorry' && m.category === 'trailer'))
  && (S.brand === 'all' || m.brand === S.brand)
  && (S.op === 'all' || OPERATOR[S.op]?.fleet.includes(m.style))
  && (S.mode === 'turntable' || S.year >= m.from - 0 && S.year <= m.to + 10)
  && m.style !== 'bus-bendy-rear' && m.style !== 'tender';
const filtered = () => MODELS.filter(matches);

// ---------------- movers ----------------
interface Mover {
  chain: Model[]; look: Look; cols: THREE.Color[]; lane: number; s: number; v: number; poses: (Pose | undefined)[]; rail: boolean; odo: number; brake: number; ind: number; emergency: boolean; lit: boolean; lake?: boolean;
  vmax: number; len: number;
  // stopping: trains at the station, buses at the stop ('in' pulling in, 'dwell' standing, 'out' pulling out)
  st: 'run' | 'in' | 'dwell' | 'out' | 'held'; t: number; key?: number;
  // the length of its loop (each track and lane is its own length) and whether it carries passengers
  L: number; pax?: boolean;
  o: number[]; // each vehicle's middle, back from the front of the chain
  lat?: number; outS?: number; served?: boolean; bus?: boolean; stopping?: boolean; bay?: boolean;
}
let movers: Mover[] = [];
let laneMovers: Mover[][] = [];
const offsetsOf = (chain: Model[]) => { const o: number[] = []; let s = 0; for (const m of chain) { o.push(s + m.dims.length / 2); s += m.dims.length + 0.9; } return { o, len: s }; };
function chainFor(m: Model, r: () => number): Model[] {
  if (m.style === 'tractor') {
    const ts = MODELS.filter((t) => t.category === 'trailer' && S.year >= t.from && S.year <= t.to + 20 && (S.op === 'all' || OPERATOR[S.op]?.fleet.includes(t.style)));
    return ts.length ? [m, pick(r, ts)] : [m];
  }
  if (m.consist) return m.consist.map((id) => MODEL[id]).filter(Boolean);
  return [m];
}
function spawnParade() {
  movers = [];
  const r = rng(S.seed * 7919 + S.year);
  const road = S.cat === 'all' || ['car', 'van', 'lorry', 'bus', 'trailer'].includes(S.cat);
  const lake = S.cat === 'boat' || S.cat === 'air';
  const rail = S.cat === 'all' || S.cat === 'rail';
  // a pool of candidate vehicles keeps the number of distinct models (and draw calls) sane
  const pool: { chain: Model[]; lead: Model }[] = [];
  if (S.cat === 'all' && S.brand === 'all' && S.op === 'all') {
    for (let i = 0; i < S.variety * 3 && pool.length < S.variety; i++) { const p = pickVehicle(r, S.area, S.year); if (p && !pool.some((x) => x.lead === p.lead)) pool.push({ chain: p.chain, lead: p.lead }); }
  } else {
    const ms = filtered().filter((m) => m.category !== 'rail' && (lake ? m.category === 'boat' || m.category === 'air' : m.category !== 'boat' && m.category !== 'air') && !(m.category === 'trailer' && S.cat !== 'trailer'));
    for (let i = 0; i < Math.min(S.variety, ms.length * 2); i++) { const m = pick(r, ms); pool.push({ chain: chainFor(m, r), lead: m }); }
  }
  const lookOf = (lead: Model, seed: number) => lookFor(lead, S.year, seed, S.op !== 'all' && OPERATOR[S.op]?.fleet.includes(lead.style) ? S.op : undefined);
  if ((road || lake) && pool.length) {
    const lanesUsed = lake ? [0, 1] : lanes.map((_, i) => i);
    const perLane = Math.ceil(S.count / lanesUsed.length);
    for (const lane of lanesUsed) {
      const loopLen = lake ? loopOf(lane * 18 - 9, R - 60, SL - 30) : loopOf(lanes[lane]);
      // choose the lane's vehicles first, then spread them evenly round the loop
      const picks: { chain: Model[]; lead: Model; len: number }[] = [];
      let total = 0;
      for (let k = 0; k < perLane && movers.length + picks.length < S.count; k++) {
        const p = pick(r, pool);
        const { len } = offsetsOf(p.chain);
        if (total + len + (lake ? 30 : 4) > loopLen) break;
        picks.push({ ...p, len }); total += len + (lake ? 30 : 4);
      }
      const spare = (loopLen - total) / Math.max(1, picks.length);
      let s = r() * 20;
      picks.forEach((p, k) => {
        s += p.len;
        const seed = hash(`${S.seed}-${lane}-${k}`);
        const look = lookOf(p.lead, seed);
        const st = p.lead.style;
        movers.push({
          chain: p.chain, look, cols: liveryColours(look.livery), lane, s, v: lake ? 8 : laneSpeed(lanes[lane]), poses: [], rail: false, odo: r() * 100, brake: 0, ind: 0,
          emergency: st === 'police' || st === 'ambulance' || st === 'refuse' || st === 'gritter' || st === 'recovery', lit: p.lead.category === 'bus' || st === 'taxi' || st === 'ice-cream', lake,
          vmax: lake ? 8 : laneSpeed(lanes[lane]), len: p.len - 0.9, st: 'run', t: 0, L: loopLen, o: offsetsOf(p.chain).o,
          // every field set from the start, so the movers keep one shape
          key: 0, lat: undefined, outS: 0, served: false, stopping: false, pax: false, bay: false,
          // buses in the kerb lane call at the stop
          bus: !lake && lane === 0 && p.lead.category === 'bus' && st !== 'coach' && doorsOf(p.lead).length > 0,
        });
        s += (lake ? 30 : 4) + spare * (0.5 + r());
      });
    }
  }
  // make sure a bus calls at the stop soon after the start: put one in the kerb lane (swapped
  // for whatever was there) and turn the lane so it arrives a few seconds in
  const kerb = movers.filter((m) => !m.rail && !m.lake && m.lane === 0);
  if (kerb.length && !lake) {
    let bus = kerb.find((m) => m.bus);
    const cand = pool.filter((p) => p.lead.category === 'bus' && p.lead.style !== 'coach' && doorsOf(p.lead).length);
    if (!bus && cand.length) {
      bus = kerb[Math.floor(kerb.length / 2)];
      const p = pick(r, cand);
      const look = lookOf(p.lead, hash(`${S.seed}-bus`));
      Object.assign(bus, { chain: p.chain, look, cols: liveryColours(look.livery), len: offsetsOf(p.chain).len - 0.9, o: offsetsOf(p.chain).o, bus: true, lit: true, emergency: false });
    }
    // the Station preset starts with the bus already standing at the stop
    const atStop = S.at === 'stop';
    if (bus) { const shift = -BUS_STOP.front - (atStop ? 0 : 90) - bus.s; for (const m of kerb) m.s += shift; }
    if (bus && atStop) Object.assign(bus, { st: 'dwell', t: 0, v: 0, lat: bayOff() });
  }
  if (rail) {
    const trains = S.cat === 'rail' ? railTrains(r) : [0, 1, 2, 3].map(() => pickTrain(r, S.year)).filter(Boolean) as { chain: Model[]; look: Look }[];
    // passenger trains first, so the ones that start by the station are the ones with doors
    const pax = (c: Model[]) => c.some((m) => doorsOf(m).length > 0);
    trains.sort((a, b) => +pax(b.chain) - +pax(a.chain));
    for (let t = 0; t < trains.length; t++) {
      const tr = trains[t];
      // the first two trains start just short of the camera, so there's something to see at once
      const { len } = offsetsOf(tr.chain);
      const L = loopOf(RAIL[t % 2]);
      const s0 = t < 2 ? STATION.stop - 200 + t * 70 + Math.min(40, len * 0.2) : (t * L) / trains.length;
      // the Station preset starts with the first train standing at the platform
      const standing = S.at === 'stop' && t === 0 && pax(tr.chain);
      movers.push({ chain: tr.chain, look: tr.look, cols: liveryColours(tr.look.livery), lane: t % 2, s: standing ? STATION.stop : s0, v: standing ? 0 : t % 2 ? 14 : 18, poses: [], rail: true, odo: 0, brake: 0, ind: 0, emergency: false, lit: true, vmax: t % 2 ? 14 : 18, len: len - 0.9, st: standing ? 'dwell' : 'run', t: 0, L, pax: pax(tr.chain), o: offsetsOf(tr.chain).o, key: 0, lat: undefined, outS: 0, served: false, stopping: false, bus: false, bay: false });
    }
  }
}
// the road movers of each lane, in order along the lane (the lake's boats keep to themselves)
function sortLanes() {
  laneMovers = lanes.map(() => []);
  for (const mv of movers) if (!mv.rail && !mv.lake) laneMovers[mv.lane].push(mv);
}
function railTrains(r: () => number) {
  const ms = filtered().filter((m) => m.category === 'rail');
  const out: { chain: Model[]; look: Look }[] = [];
  const leads = ms.filter((m) => !m.style.startsWith('wagon-') && m.style !== 'coach-stock' && m.style !== 'hs-coach' && m.style !== 'brake-van' && !(m.design.cab === false));
  for (let i = 0; i < 6 && leads.length; i++) {
    const lead = pick(r, leads);
    let chain = chainFor(lead, r);
    if (lead.style === 'diesel-loco' || lead.style === 'electric-loco' || lead.style.startsWith('steam')) {
      const stock = ms.filter((m) => m.style === 'coach-stock' || m.style.startsWith('wagon-'));
      const s0 = stock.length ? pick(r, stock) : undefined;
      if (s0) chain = [...chain, ...Array(5 + Math.floor(r() * 5)).fill(s0)];
    }
    if ((lead.style === 'dmu-car' || lead.style === 'emu-car') && chain.length === 3) chain = [chain[0], chain[1], chain[1], chain[0]];
    if (lead.style === 'metro-car' && chain.length === 3) chain = [chain[0], chain[1], chain[1], chain[1], chain[1], chain[0]];
    out.push({ chain, look: lookFor(lead, S.year, hash(`${S.seed}-t${i}`), S.op !== 'all' ? S.op : undefined) });
  }
  return out;
}

// ---------------- showroom rows ----------------
interface Parked { m: Model; x: number; z: number; look: Look; cols: THREE.Color[] }
let parked: Parked[] = [];
function layoutShowroom() {
  const ms = filtered().slice(0, 600);
  ms.sort((a, b) => a.category.localeCompare(b.category) || a.from - b.from || a.dims.length - b.dims.length);
  parked = [];
  const rowW = Math.max(60, Math.sqrt(ms.reduce((s, m) => s + (m.dims.length + 2) * (m.dims.width + 3), 0)) * 1.4);
  let x = 0, z = 0, rowH = 0, cat = '';
  for (const m of ms) {
    const L = m.dims.length, W = Math.min(m.dims.width, 60);
    if (cat && m.category !== cat) { x = 0; z += rowH + 6; rowH = 0; }
    cat = m.category;
    if (x + L > rowW && x > 0) { x = 0; z += rowH + 2.5; rowH = 0; }
    const look = lookFor(m, Math.max(m.from, Math.min(S.year, m.to)), hash(`${m.id}-${S.seed}`), S.op !== 'all' && OPERATOR[S.op]?.fleet.includes(m.style) ? S.op : undefined);
    parked.push({ m, x: x + L / 2, z: z + W / 2, look, cols: liveryColours(look.livery) });
    x += L + 2; rowH = Math.max(rowH, W);
  }
  const w = rowW, h = z + rowH;
  for (const p of parked) { p.x -= w / 2; p.z -= h / 2; }
  const floor = world.getObjectByName('floor')!;
  floor.visible = true; floor.scale.set(w + 20, h + 20, 1); floor.position.set(0, 0.02, 0);
  view.x = 0; view.z = 0; view.h = S.zoom || Math.min(Math.max(40, h * 1.2), 600);
}

// ---------------- turntable ----------------
let tt: { m: Model; look: Look; cols: THREE.Color[]; seed: number; a: number; flags: number; door: number; odo: number } | null = null;
const ttModel = (): Model | undefined => tt?.m;
function openTurntable(m?: Model) {
  const list = filtered();
  m = m ?? MODEL[S.model] ?? list[0] ?? MODELS[0];
  S.model = m.id;
  const seed = hash(`${m.id}-${S.seed}`);
  const look = lookFor(m, Math.max(m.from, Math.min(S.year, m.to)), seed, S.op !== 'all' && OPERATOR[S.op]?.fleet.includes(m.style) ? S.op : undefined);
  tt = { m, look, cols: liveryColours(look.livery), seed, a: S.angle, flags: S.night ? FLAGS.lights | FLAGS.interior | FLAGS.sign | FLAGS.beacons : 0, door: S.doors ? 1 : 0, odo: 0 };
  // fit the longest side across the screen, whichever way up the phone is
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  view.h = S.zoom || ((Math.max(m.dims.length, m.dims.width) * 1.1 + 1.5) / Math.min(1, aspect)) * S.fit;
  // sit the vehicle in the upper half of the screen, clear of the spec card
  const k = S.ui ? view.h * 0.16 : 0;
  view.x = Math.sin(view.az) * k; view.z = Math.cos(view.az) * k;
  const fx = +(q.get('fx') ?? 0), fy = +(q.get('fy') ?? 0) / Math.tan(view.el); view.x += fx * Math.cos(S.angle) - Math.sin(view.az) * fy; view.z += fx * Math.sin(S.angle) - Math.cos(view.az) * fy;
  // the door close-up: the vehicle stood still with its kerb side to the camera, and the view on
  // its front door (the point at the door's middle height, not the ground under it)
  const door = S.close ? (doorPositions(m, { x: 0, z: 0, heading: DOOR_ANGLE }, 'left')[0] ?? doorPositions(m, { x: 0, z: 0, heading: DOOR_ANGLE })[0]) : undefined;
  if (door) {
    const dd = doorsOf(m)[door.index];
    tt.a = DOOR_ANGLE;
    view.h = S.zoom || Math.max(6.5, (dd.y1 - dd.y0) * 3.2);
    const lift = ((dd.y0 + dd.y1) / 2) / Math.tan(view.el), kk = S.ui ? view.h * 0.16 : 0;
    view.x = door.x - Math.sin(view.az) * (lift - kk); view.z = door.z - Math.cos(view.az) * (lift - kk);
  }
  showCard();
}
// the turntable angle that puts a vehicle's left (kerb) side to the camera
const DOOR_ANGLE = 2.4;
const fmt = (n: number) => n.toLocaleString('en-GB');
function showCard() {
  const card = document.getElementById('card')!;
  if (S.mode !== 'turntable' || !tt) { card.style.display = 'none'; return; }
  const { m, look } = tt, b = BRAND[m.brand];
  const d = m.dims, st = m.stats;
  const road = m.category !== 'rail' && m.category !== 'boat' && m.category !== 'air';
  const pl = road ? plateCanvas(look.plate, true).toDataURL() : '';
  const tris = [0, 1, 2].map((l) => triangles(m, l as Lod));
  card.style.display = S.ui ? 'block' : 'none';
  card.innerHTML = `
    <h2 id="cardh">${m.name} <small style="color:var(--dim);font-weight:400">${S.card ? '▾' : '▸'}</small></h2>
    <div class="sub">${STYLE_LABEL[m.style]} · ${m.from}–${m.to} · ${b?.flavour ?? ''} (${b?.country ?? ''}) · ${eraOf(m.from).label}</div>
    <table style="display:${S.card ? 'table' : 'none'}">
      <tr><td>Length × width × height</td><td>${d.length} × ${d.width} × ${d.height} m</td></tr>
      <tr><td>Wheelbase · axles</td><td>${d.wheelbase} m · ${d.axles.length}</td></tr>
      <tr><td>Capacity · top speed</td><td>${st.capacity} ${st.unit === 'pax' ? 'seats' : 't'} · ${st.speedKmh} km/h</td></tr>
      <tr><td>Price · running</td><td>£${fmt(st.cost)} · £${fmt(st.running)}/yr</td></tr>
      <tr><td>Triangles near · mid · far</td><td>${tris.join(' · ')} (budget ${BUDGET[m.category].join(' · ')})</td></tr>
      <tr><td>${look.operator ? look.operator.name : 'Private'}${look.liveryName ? ` · ${look.liveryName}` : ''}</td><td>${look.livery.map((c) => `<span class="sw" style="background:${c}"></span>`).join('')}</td></tr>
      <tr><td>${look.fleet ? `Fleet no. ${look.fleet}` : 'Registration'}</td><td>${road ? `<img class="plate" src="${pl}" alt="${look.plate}">` : look.fleet ?? '—'}</td></tr>
    </table>`;
  document.getElementById('cardh')!.onclick = () => { S.card = !S.card; showCard(); saveUrl(); };
}

// ---------------- UI ----------------
const top = document.getElementById('top')!;
function ui() {
  top.style.display = S.ui ? 'block' : 'none';
  const cats: [string, string][] = [['all', 'Everything'], ['car', 'Cars'], ['van', 'Vans'], ['lorry', 'Lorries'], ['trailer', 'Trailers'], ['bus', 'Buses & coaches'], ['rail', 'Rail'], ['boat', 'Boats'], ['air', 'Aircraft']];
  const brands = BRANDS.filter((b) => S.cat === 'all' || b.makes.includes(S.cat as Category) || (S.cat === 'lorry' && b.makes.includes('trailer')));
  const ops = OPERATORS.filter((o) => S.cat === 'all' || MODELS.some((m) => m.category === S.cat && o.fleet.includes(m.style)));
  const opt = (v: string, l: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  const mb = (k: string, l: string) => `<button data-mode="${k}" class="${S.mode === k ? 'on' : ''}">${l}</button>`;
  top.innerHTML = `
    <h1>Vehicle library <small id="stats"></small></h1>
    <div class="row">${mb('parade', 'Parade')}${mb('showroom', 'Showroom')}${mb('turntable', 'Turntable')}
      <button id="night" class="${S.night ? 'on' : ''}">${S.night ? 'Night' : 'Day'}</button>
      <button id="filt" class="${S.filters ? 'on' : ''}">Filters</button>
      ${S.mode === 'turntable' ? '<button id="prev">◀</button><button id="next">▶</button><button id="relook">New look</button>' : ''}
      ${S.mode === 'turntable' && tt && doorsOf(tt.m).some((d) => d.kind !== 'open') ? `<button id="doors" class="${S.doors ? 'on' : ''}">Doors</button><button id="close" class="${S.close ? 'on' : ''}">Close-up</button>` : ''}
      ${S.mode === 'parade' ? `<button id="at" class="${S.at === 'stop' ? 'on' : ''}">Station</button>` : ''}</div>
    <div id="fl" style="display:${S.filters ? 'block' : 'none'}"><div class="row">
      <select id="cat">${cats.map(([v, l]) => opt(v, l, S.cat)).join('')}</select>
      <select id="brand">${opt('all', 'Any maker', S.brand)}${brands.map((b) => opt(b.id, b.name, S.brand)).join('')}</select>
      <select id="op">${opt('all', 'Any operator', S.op)}${ops.map((o) => opt(o.id, o.name, S.op)).join('')}</select>
    </div>
    <div class="row">
      <label>Year <input id="year" type="range" min="1900" max="2030" value="${S.year}"><b id="yl">${S.year}</b></label>
      ${S.mode === 'parade' ? `<label>Count <input id="count" type="range" min="20" max="2000" step="10" value="${S.count}"><b id="cl">${S.count}</b></label>
      ${S.cat === 'all' ? `<select id="area">${(['centre', 'suburb', 'industrial', 'rural', 'motorway'] as Area[]).map((a) => opt(a, a[0].toUpperCase() + a.slice(1), S.area)).join('')}</select>` : ''}` : ''}
      <select id="lod">${['auto', '0', '1', '2'].map((l) => opt(l, l === 'auto' ? 'LOD auto' : `LOD ${l}`, S.lod)).join('')}</select>
    </div></div>
    <div class="row" id="summary" style="color:var(--dim)">${[S.cat === 'all' ? 'Everything' : S.cat, S.brand !== 'all' ? BRAND[S.brand]?.name : '', S.op !== 'all' ? OPERATOR[S.op]?.name : '', String(S.year), S.mode === 'parade' ? `${S.count} vehicles${S.cat === 'all' ? `, ${S.area}` : ''}` : ''].filter(Boolean).join(' · ')}</div>`;
  (top.querySelector('#filt') as HTMLButtonElement).onclick = () => { S.filters = !S.filters; ui(); saveUrl(); };
  top.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode as typeof S.mode; S.zoom = 0; rebuild(); }));
  (top.querySelector('#night') as HTMLButtonElement).onclick = () => { S.night = !S.night; setNight(S.night); if (tt) tt.flags = S.night ? FLAGS.lights | FLAGS.interior | FLAGS.sign | FLAGS.beacons : 0; ui(); saveUrl(); };
  const sel = (id: string, f: (v: string) => void) => { const e = top.querySelector<HTMLSelectElement>(`#${id}`); if (e) e.onchange = () => { f(e.value); rebuild(); }; };
  sel('cat', (v) => { S.cat = v; S.brand = 'all'; S.op = 'all'; });
  sel('brand', (v) => (S.brand = v)); sel('op', (v) => (S.op = v)); sel('area', (v) => (S.area = v as Area)); sel('lod', (v) => (S.lod = v));
  const yr = top.querySelector<HTMLInputElement>('#year')!;
  yr.oninput = () => { top.querySelector('#yl')!.textContent = yr.value; };
  yr.onchange = () => { S.year = +yr.value; rebuild(); };
  const ct = top.querySelector<HTMLInputElement>('#count');
  if (ct) { ct.oninput = () => { top.querySelector('#cl')!.textContent = ct.value; }; ct.onchange = () => { S.count = +ct.value; rebuild(); }; }
  const step = (d: number) => { const l = filtered(); const i = l.findIndex((m) => m.id === S.model); openTurntable(l[(i + d + l.length) % l.length]); ui(); saveUrl(); };
  const pb = top.querySelector<HTMLButtonElement>('#prev'), nb = top.querySelector<HTMLButtonElement>('#next'), rl = top.querySelector<HTMLButtonElement>('#relook');
  if (pb) pb.onclick = () => step(-1);
  if (nb) nb.onclick = () => step(1);
  if (rl) rl.onclick = () => { S.seed++; openTurntable(tt?.m); saveUrl(); };
  const db = top.querySelector<HTMLButtonElement>('#doors'), cb = top.querySelector<HTMLButtonElement>('#close'), ab = top.querySelector<HTMLButtonElement>('#at');
  if (db) db.onclick = () => { S.doors = !S.doors; db.classList.toggle('on', S.doors); saveUrl(); };
  if (cb) cb.onclick = () => { S.close = !S.close; if (S.close) S.spin = false; S.zoom = 0; openTurntable(tt?.m); ui(); saveUrl(); };
  if (ab) ab.onclick = () => { S.at = S.at === 'stop' ? '' : 'stop'; S.zoom = 0; rebuild(); };
}
function rebuild() {
  saveUrl();
  ui();
  setLanes(S.mode === 'parade' ? S.count : 0);
  buildWorld(S.cat === 'boat' || S.cat === 'air');
  const floor = world.getObjectByName('floor')!;
  floor.visible = false;
  tt = null; parked = []; movers = [];
  if (S.mode === 'parade') {
    spawnParade(); sortLanes();
    view.x = S.cat === 'boat' || S.cat === 'air' ? -150 : -120; view.z = S.cat === 'boat' || S.cat === 'air' ? -20 : -R - 14; view.h = S.zoom || 140;
    // the stop preset: the station and the bus stop close up
    if (S.at === 'stop') { view.x = -112; view.z = -R - 16; view.h = S.zoom || 46; }
  }
  else if (S.mode === 'showroom') layoutShowroom();
  else openTurntable();
  world.visible = S.mode !== 'turntable';
  if (S.mode === 'turntable') { floor.visible = true; const tm = ttModel(), fs = Math.max(240, (tm?.dims.length ?? 0) * 8, (tm?.dims.width ?? 0) * 8); floor.scale.set(fs, fs, 1); world.visible = true; for (const c of world.children) c.visible = c === floor; }
  else for (const c of world.children) c.visible = c.name !== 'floor' || S.mode === 'showroom';
  showCard();
  place();
}

// ---------------- input: the shared camera above ----------------
const v3 = new THREE.Vector3();
function tapShowroom(x: number, y: number) {
  const rect = canvas.getBoundingClientRect();
  let best: Parked | undefined, bd = 50;
  for (const p of parked) {
    v3.set(p.x, p.m.dims.height / 2, p.z).project(cam);
    const sx = ((v3.x + 1) / 2) * rect.width, sy = ((1 - v3.y) / 2) * rect.height;
    const d = Math.hypot(sx - x, sy - y);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) { S.mode = 'turntable'; S.model = best.m.id; S.zoom = 0; rebuild(); }
}

// ---------------- frame ----------------
const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), eu = new THREE.Euler(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
const matrix = (x: number, y: number, z: number, heading: number) => m4.compose(pos.set(x, y, z), qt.setFromEuler(eu.set(0, -heading, 0)), one);
const onScreen = (x: number, z: number, pad: number) => { v3.set(x, 0, z).project(cam); const p = 1 + pad / view.h * 2; return Math.abs(v3.x) < p * 1.2 && Math.abs(v3.y) < p; };
const lodOf = (m: Model): Lod => (S.lod === 'auto' ? lodFor(m.dims.length, canvas.clientHeight / view.h) : (+S.lod as Lod));

// ---------------- stopping ----------------
const turn = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
// The curvature of the oval at arc length s along offset off (0 on the straights).
function curveOf(s: number, off: number) {
  const Rr = R + off, L = loopOf(off);
  s = ((s % L) + L) % L;
  const bend = (s >= 2 * SL && s < 2 * SL + Math.PI * Rr) || s >= 4 * SL + Math.PI * Rr;
  return bend ? 1 / Rr : 0;
}
// distance forward from one point to another round a loop of length L
const ahead = (from: number, to: number, L: number) => (((to - from) % L) + L) % L;
// Trains: brake for the station at 0.7 m/s², stand with the doors open, then pull away at 0.5 m/s².
// Freight trains are held the same time at a signal short of the platform instead, so every
// train on a track loses the same time and they keep their spacing.
const trainHalt = (mv: Mover) => (mv.pax ? STATION.stop : STATION.s0 - 60);
function trainStop(mv: Mover, dt: number) {
  mv.stopping = false;
  if (mv.st === 'dwell' || mv.st === 'held') {
    mv.v = 0; mv.t += dt;
    if (mv.t > STATION.dwell) { mv.st = 'run'; mv.s += 0.02; }
    return;
  }
  const d = ahead(mv.s, trainHalt(mv), mv.L);
  const vb = Math.sqrt(2 * 0.7 * d);
  mv.stopping = vb < mv.v;
  mv.v = Math.min(mv.vmax, vb, mv.v + 0.5 * dt);
  if (d < 0.05 || (mv.v < 0.05 && d < 0.6)) { mv.s += d; mv.v = 0; mv.st = mv.pax ? 'dwell' : 'held'; mv.t = 0; }
}
const easeS = (u: number) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); };
// A bus's offset from the road's middle line, at mover position sm (in and out of the lay-by
// along a smooth S over 35 m in and 25 m out).
function latAt(mv: Mover, sm: number) {
  const lane = lanes[mv.lane], bay = bayOff();
  if (mv.st === 'in') return lane + (bay - lane) * easeS(1 - ahead(sm, -BUS_STOP.front, mv.L) / 35);
  if (mv.st === 'dwell') return bay;
  if (mv.st === 'out') return bay + (lane - bay) * easeS((sm - (mv.outS ?? sm)) / 25);
  return lane;
}
// in the lay-by, where the lane's traffic passes it by
const inBay = (m: Mover) => m.st === 'dwell' || (m.st === 'in' && ahead(m.s, -BUS_STOP.front, m.L) < 17) || (m.st === 'out' && m.s - (m.outS ?? m.s) < 12);
// a bus that has shut its doors and wants to pull out: the traffic coming up behind it lets it
const waiting = (m: Mover) => m.st === 'dwell' && m.t > BUS_STOP.dwell;
// One lane of road traffic. Movers keep a gap to the one in front that grows with its speed;
// buses in the kerb lane pull into the lay-by (the lane ignores them while they're in it) and,
// once their doors are shut, the next car up holds back to let them out.
function followLane(lane: Mover[], dt: number) {
  const n = lane.length;
  if (!n) return;
  const L = lane[0].L;
  // keep the lane in order along the loop (it barely changes, so insertion sort)
  for (const m of lane) { m.key = ((m.s % L) + L) % L; m.bay = m.bus === true && inBay(m); }
  for (let i = 1; i < n; i++) { const m = lane[i], km = m.key!; let j = i - 1; while (j >= 0 && lane[j].key! > km) { lane[j + 1] = lane[j]; j--; } lane[j + 1] = m; }
  for (let i = 0; i < n; i++) {
    const mv = lane[i];
    mv.stopping = false;
    const bayed = mv.bay;
    // the one in front: buses in the lay-by don't count, unless one is waiting to pull out and
    // this is the first car wholly behind it
    let lead: Mover | undefined, gap = Infinity;
    if (!bayed) for (let j = 1; j < n; j++) {
      const c = lane[(i + j) % n];
      if (c.bay) {
        const d = ahead(mv.s, c.s, L);
        if (!(waiting(c) && d > c.len + 1 && d < c.len + 40)) continue;
      }
      lead = c; gap = ahead(mv.s, c.s, L) - c.len; break;
    }
    let vDes = mv.vmax;
    if (lead) {
      vDes = Math.min(vDes, Math.max(0, lead.v + (gap - (3 + 0.3 * lead.v)) * 0.8));
      if (gap < 1.5) vDes = 0;
    }
    if (mv.bus) {
      const d = ahead(mv.s, -BUS_STOP.front, L);
      if (mv.st === 'run' && d < 70 && d > 40 && !mv.served) { mv.st = 'in'; }
      if (mv.st === 'run' && d > 100) mv.served = false;
      if (mv.st === 'in') {
        vDes = Math.min(vDes, Math.sqrt(2 * 1.3 * d));
        if (d < 0.05 || (mv.v < 0.05 && d < 0.6)) { mv.s += d; mv.v = 0; vDes = 0; mv.st = 'dwell'; mv.t = 0; }
      } else if (mv.st === 'dwell') {
        mv.t += dt; vDes = 0;
        // go once the doors are shut and the lane behind is clear, or the car behind has stopped for it
        if (waiting(mv)) {
          let clear = true;
          for (let j = 1; j < n; j++) {
            const c = lane[(i - j + n) % n];
            if (c === mv || c.bay) continue;
            const g = ahead(c.s, mv.s, L) - mv.len;
            if (g < 25 && !(g > 2 && c.v < 0.5)) clear = false;
            break;
          }
          if (clear) { mv.st = 'out'; mv.outS = mv.s; mv.served = true; }
        }
      } else if (mv.st === 'out' && mv.s - (mv.outS ?? mv.s) > 25) mv.st = 'run';
      mv.lat = mv.st === 'run' ? undefined : mv.st === 'dwell' ? bayOff() : latAt(mv, mv.s);
    }
    const acc = mv.bus ? 1.2 : 2.5;
    const v = Math.max(0, Math.min(vDes, mv.v + acc * dt, mv.vmax));
    mv.stopping = v < mv.v - 0.8 * dt;
    mv.v = Math.max(v, mv.v - 7 * dt);
    // never into the one in front
    if (gap < Infinity) mv.v = Math.min(mv.v, Math.max(0, (gap - 1) / Math.max(dt, 1e-3)));
  }
}

let last = performance.now(), fpsT = 0, frames = 0, fps = 0, cpuSum = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const t0 = performance.now();
  // the camera first, so what's culled is what this frame shows
  nav.update(dt, now);
  vr.begin(); beams.begin(); pools.begin();
  if (S.night && S.mode !== 'turntable') for (const l of streetLamps) if (onScreen(l.x, l.z, 20)) pools.add(l.x, 0.08, l.z, 0, 18, 18);
  const nightFlags = S.night ? FLAGS.lights : 0;
  if (S.mode === 'parade') {
    // road traffic keeps its distance (a bus pulling out of the stop makes the lane wait for it),
    // trains call at the station and buses at the stop
    for (const lane of laneMovers) followLane(lane, dt);
    for (const mv of movers) {
      if (mv.rail) trainStop(mv, dt);
      else if (mv.lake) mv.v = mv.vmax;
      mv.s += mv.v * dt;
      mv.odo += mv.v * dt;
      // now and then someone brakes or signals, to show the lamps working
      if (mv.brake > 0) mv.brake -= dt; else if (Math.random() < dt * 0.08) mv.brake = 1.2;
      if (mv.ind > 0) mv.ind -= dt; else if (Math.random() < dt * 0.03) mv.ind = 3 * (Math.random() < 0.5 ? 1 : -1) || 3;
      const dirSign = mv.rail || mv.lake ? 1 : lanes[mv.lane] > 0 ? 1 : -1;
      const off = mv.rail ? RAIL[mv.lane] : mv.lake ? mv.lane * 18 - 9 : lanes[mv.lane];
      let flags = nightFlags | (mv.brake > 0 || mv.stopping ? FLAGS.brake : 0) | (mv.ind > 2 ? FLAGS.indL : mv.ind > 0 && mv.ind <= 2 ? FLAGS.indR : 0);
      if (mv.bus && (mv.st === 'in' || mv.st === 'out')) flags = (flags & ~FLAGS.indR) | FLAGS.indL * (mv.st === 'in' ? 1 : 0) | FLAGS.indR * (mv.st === 'out' ? 1 : 0);
      if (mv.emergency) flags |= FLAGS.beacons;
      if (mv.lit && S.night) flags |= FLAGS.interior | FLAGS.sign;
      const o = mv.o;
      for (let i = 0; i < mv.chain.length; i++) {
        const m = mv.chain[i];
        let x: number, z: number, h: number, k = 0;
        if (mv.rail || mv.lake || i === 0 || !(mv.chain[i - 1].hitch?.rear !== undefined && m.hitch?.front !== undefined)) {
          const s = (mv.s - o[i]) * dirSign;
          // rail cars: heading from the chord between bogie centres, so long cars sit on curves,
          // and the curvature from the turn between them, for the bogies
          if (mv.rail || mv.lake) {
            const half = Math.min(m.dims.length * 0.35, 12);
            const a = mv.lake ? oval(s + half, off, R - 60, SL - 30) : oval(s + half, off), b = mv.lake ? oval(s - half, off, R - 60, SL - 30) : oval(s - half, off);
            x = (a.x + b.x) / 2; z = (a.z + b.z) / 2; h = Math.atan2(a.z - b.z, a.x - b.x);
            k = turn(a.h - b.h) / (2 * half);
          } else {
            const lat = mv.lat ?? off;
            const p = oval(s, lat);
            x = p.x; z = p.z; h = p.h + (dirSign < 0 ? Math.PI : 0);
            // pulling in or out of the stop: head along the path actually driven
            if (mv.lat !== undefined) { const q = oval(s - dirSign * 2, latAt(mv, mv.s - o[i] - 2)); h = Math.atan2(p.z - q.z, p.x - q.x); }
          }
          mv.poses[i] = { x, z, heading: h };
        } else {
          const pose = follow(mv.poses[i - 1]!, mv.chain[i - 1], m, mv.poses[i]);
          mv.poses[i] = pose; x = pose.x; z = pose.z; h = pose.heading;
        }
        if (!onScreen(x, z, m.dims.length)) continue;
        // road vehicles: the lane's curvature, for the steered wheels (only for what's drawn)
        if (!mv.rail && !mv.lake) k = dirSign * curveOf((mv.s - o[i]) * dirSign, off);
        // trains: white lamps on the leading vehicle, red on the last
        let f = flags;
        if (mv.rail) f = (i === 0 ? FLAGS.lights : 0) | (i === mv.chain.length - 1 ? FLAGS.brake : 0) | (S.night ? FLAGS.interior : 0);
        const flip = mv.rail && i === mv.chain.length - 1 && mv.chain.length > 1 && (m.design.cab === true || m.style === 'hs-power');
        const hh = flip ? h + Math.PI : h;
        if (S.night && i === 0 && !mv.lake) beams.add(x + Math.cos(h) * m.dims.length * 0.5, mv.rail ? 0.34 : 0.07, z + Math.sin(h) * m.dims.length * 0.5, h, mv.rail ? 40 : 22, mv.rail ? 5 : m.dims.width * 2.4);
        // doors: open on the platform (or kerb) side while standing, a little later on each car
        let dl = 0, dr = 0;
        if (mv.st === 'dwell' && doorsOf(m).length) {
          const open = dwellDoors(mv.t, mv.rail ? STATION.dwell : BUS_STOP.dwell, m, i);
          if (open > 0) {
            const side = mv.rail ? platformSide({ x, z, heading: hh }, oval((mv.s - o[i]), STATION.platforms[mv.lane][mv.lane === 0 ? 0 : 1])) : 'left';
            if (side === 'left') dl = open; else dr = open;
          }
        }
        vr.add(m, lodOf(m), matrix(x, m.category === 'rail' ? 0.28 : 0, z, hh), mv.cols, flip ? (f & FLAGS.brake ? FLAGS.brake : 0) | (S.night ? FLAGS.interior : 0) : f, mv.odo, dl, dr, flip ? -k : k);
      }
    }
  } else if (S.mode === 'showroom') {
    for (const p of parked) if (onScreen(p.x, p.z, p.m.dims.length)) vr.add(p.m, lodOf(p.m), matrix(p.x, 0, p.z, 0), p.cols, nightFlags | (S.night ? FLAGS.interior | FLAGS.sign | FLAGS.beacons : 0), 0);
  } else if (tt) {
    if (S.spin && nav.pointers === 0) tt.a += dt * 0.35;
    // the doors move at their own speed; the wheels turn only while they're shut
    tt.door += Math.max(-dt / doorSeconds(tt.m), Math.min(dt / doorSeconds(tt.m), (S.doors ? 1 : 0) - tt.door));
    if (tt.door === 0 && !S.close) tt.odo += dt * 3;
    vr.add(tt.m, (S.lod === 'auto' ? 0 : +S.lod) as Lod, matrix(0, 0, 0, tt.a), tt.cols, tt.flags | (Math.floor(t / 4) % 3 === 1 ? FLAGS.brake : 0) | (Math.floor(t / 4) % 3 === 2 ? FLAGS.hazard : 0), tt.odo, tt.door, 0);
  }
  vr.end(t); beams.end(); pools.end();
  const cpu = performance.now() - t0;
  renderer.render(scene, cam);
  frames++; fpsT += dt; cpuSum += cpu;
  if (fpsT > 0.5) {
    fps = Math.round(frames / fpsT);
    const cpuMs = cpuSum / frames; frames = 0; fpsT = 0; cpuSum = 0;
    const s = vr.stats, info = renderer.info.render;
    const el = document.getElementById('stats');
    if (el) el.textContent = `${fps} fps · ${info.calls} calls (${s.calls} vehicle) · ${info.triangles < 10000 ? fmt(info.triangles) : `${fmt(Math.round(info.triangles / 1000))}k`} tris · ${fmt(s.instances)} drawn of ${fmt(movers.reduce((n, m) => n + m.chain.length, 0) || parked.length || 1)} · ${cpuMs.toFixed(2)} ms JS`;
    // for the browser checks: where the stopping vehicles are and what their doors are doing
    (window as unknown as { __stops: unknown }).__stops = movers.filter((m) => m.rail || m.bus).map((m) => ({ id: m.chain[0].id, rail: m.rail, lane: m.lane, s: +m.s.toFixed(1), v: +m.v.toFixed(2), st: m.st, t: +m.t.toFixed(1), doors: m.chain.map((c) => doorsOf(c).length) }));
    (window as unknown as { __stats: unknown }).__stats = { fps, calls: info.calls, vehicleCalls: s.calls, tris: info.triangles, instances: s.instances, total: movers.reduce((n, m) => n + m.chain.length, 0) || parked.length, cpuMs: +cpuMs.toFixed(3), models: MODELS.length };
  }
  requestAnimationFrame(frame);
}

resize();
rebuild();
requestAnimationFrame(frame);
(window as unknown as { nav: NavRig }).nav = nav;
