// People and animals demo: a slice of town (high street, bus stop, station, works gate, park,
// school and a field) with the game's isometric camera. The flows here stand in for the
// economy: they're simple curves of the clock. Open /people-demo.html with the Vite dev server.
import * as THREE from 'three';
import { Ground } from '../ground';
import { PeopleStore, BUDGETS, emitPerson, emitAnimal } from './store';
import { Crowds, footwaysOf, stopSite, type Flow, type QueueSite } from './flows';
import { DAY } from './schedule';
import { circleRoute, Mode, type Route } from './track';
import { dress, MIXES, ROLES, type Role } from './wardrobe';
import { DOGS, SPECIES } from './shaders';
import { hex, rng, type XZ } from './util';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9c7dd');
const hemi = new THREE.HemisphereLight('#dfe9f2', '#6b7a55', 1.1);
const sun = new THREE.DirectionalLight('#fff3dc', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.05;
scene.add(hemi, sun, sun.target);

// ---------------- the game's camera: orthographic, looking down at an angle ----------------
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
const view = { x: 20, z: -2, az: Math.PI / 4, el: 0.6, h: 60 };
function placeCamera() {
  const w = canvas.clientWidth, h = canvas.clientHeight, aspect = w / h;
  cam.left = (-view.h * aspect) / 2; cam.right = (view.h * aspect) / 2; cam.top = view.h / 2; cam.bottom = -view.h / 2;
  cam.updateProjectionMatrix();
  const d = 1200;
  cam.position.set(view.x + Math.sin(view.az) * Math.cos(view.el) * d, Math.sin(view.el) * d, view.z + Math.cos(view.az) * Math.cos(view.el) * d);
  cam.lookAt(view.x, 0, view.z);
  cam.updateMatrixWorld();
  const r = Math.max(40, view.h * 0.9);
  const sc = sun.shadow.camera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 900; sc.updateProjectionMatrix();
  sun.target.position.set(view.x, 0, view.z);
  sun.position.set(view.x - 160, 260, view.z + 110).sub(sun.target.position).normalize().multiplyScalar(320).add(sun.target.position);
}
function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); placeCamera(); }
window.addEventListener('resize', resize);

// ---------------- scenery (plain boxes; the game draws the real thing) ----------------
const mats = new Map<string, THREE.MeshLambertMaterial>();
// grass is the shared ground ('grass' in place of a colour)
mats.set('grass', new Ground().material);
const mat = (c: string) => { let m = mats.get(c); if (!m) mats.set(c, (m = new THREE.MeshLambertMaterial({ color: c }))); return m; };
function box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: string, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)), mat(c));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m);
  return m;
}
function flat(x0: number, z0: number, x1: number, z1: number, y: number, c: string) { return box(x0, z0, x1, z1, y - 0.02, y, c, false); }
function disc(x: number, z: number, r: number, y: number, c: string) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 28), mat(c)); m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); }
function tree(x: number, z: number, s = 1) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 2.4 * s, 6), mat('#5a4030')); t.position.set(x, 1.2 * s, z); t.castShadow = true; scene.add(t);
  const c = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1 * s, 0), mat('#4f7a3a')); c.position.set(x, 3.6 * s, z); c.castShadow = true; scene.add(c);
}
const PAVE_Y = 0.12, KERB = 3.25, BACK = 6.25;
flat(-400, -300, 400, 300, 0, 'grass');
// the high street
flat(-160, -KERB, 160, KERB, 0.02, '#44474c');
for (let x = -158; x < 160; x += 6) flat(x, -0.07, x + 3, 0.07, 0.03, '#e8e6e0');
for (const s of [-1, 1]) { flat(-160, s < 0 ? -BACK : KERB, 160, s < 0 ? -KERB : BACK, PAVE_Y, '#b9b5ac'); flat(-160, s < 0 ? -KERB - 0.15 : KERB, 160, s < 0 ? -KERB : KERB + 0.15, PAVE_Y + 0.01, '#d8d4ca'); }
for (let i = 0; i < 7; i++) flat(-6.5, -3 + i * 0.9, -3.5, -2.55 + i * 0.9, 0.035, '#f2f2ee'); // zebra
// shops, the pub and offices along the north side
const SHOPS = ['#8a1f2e', '#1f4a6a', '#2e5a3a', '#6a4a8a', '#c9a24a', '#1c1a18', '#2f6fb8', '#8a5a2b', '#3a6a6a', '#9e3a2e', '#2b3a5a'];
for (let i = 0, x = -70; x < 12; x += 7.5, i++) {
  box(x + 0.1, -18, x + 7.4, -BACK, 0, 7 + (i % 3), ['#c9b8a0', '#b58a6a', '#d9cdb5', '#a8745a'][i % 4]);
  box(x + 0.3, -BACK, x + 7.2, -BACK + 0.12, 2.6, 3.3, SHOPS[i % SHOPS.length], false);
  box(x + 0.8, -BACK, x + 6.7, -BACK + 0.06, 0.5, 2.5, '#6f8c9a', false);
}
box(12, -18, 24, -BACK, 0, 8.5, '#5a3a2e'); box(12.3, -BACK, 23.7, -BACK + 0.12, 2.4, 3.2, '#1f3a2e', false); // the Railway Arms
box(31, -20, 92, -BACK, 0, 8, '#b9b1a3'); for (let x = 32; x < 91; x += 3) box(x, -BACK, x + 1.8, -BACK + 0.06, 1, 7.4, '#5a7288', false);
// a little square with a memorial, west of the shops
flat(-92, -24, -72, -BACK, PAVE_Y, '#c9c2b4'); box(-83, -16, -81, -14, 0, 3.4, '#9a958a');
// bus stop: shelter and flag
box(35.6, -6.1, 39.4, -5.6, PAVE_Y, 2.4, '#9ab4c4', false); box(35.6, -6.2, 39.4, -5.5, 2.4, 2.55, '#2b2b2b', false);
box(40.9, -3.95, 41.05, -3.8, PAVE_Y, 2.8, '#2b2b2b'); box(40.6, -3.95, 41.3, -3.8, 2.3, 2.8, '#c9302c', false);
// the railway and the station platform (raised), with a path down to the high street
flat(-400, -36, 400, -32.2, 0.05, '#7a7166');
for (const z of [-34.9, -33.4]) flat(-400, z - 0.05, 400, z + 0.05, 0.2, '#5a5a5a');
box(20, -32.4, 92, -26.5, 0, 0.9, '#b0aca4'); flat(20, -32.4, 92, -32.0, 0.92, '#e0c21f');
flat(26, -26.5, 30, -BACK, PAVE_Y, '#b9b5ac');
box(40, -26.5, 70, -25.5, 0.9, 3.4, '#a88a6a'); // station building at the back of the platform
// the school, its yard and wall; the park; the works
box(-98, 10, -73, 40, 0, 8, '#a8745a'); for (let z = 12; z < 39; z += 3) box(-73.05, z, -72.95, z + 1.6, 1.2, 6.6, '#5a7288', false); flat(-70, 9, -30, 32, 0.03, '#8a8d90');
box(-70, 8.4, -52, 8.8, 0, 1.2, '#9a6a4a'); box(-48, 8.4, -30, 8.8, 0, 1.2, '#9a6a4a');
flat(-20, 9, 50, 60, 0.02, 'grass'); disc(25, 40, 7.2, 0.03, '#cfc7a8'); disc(25, 40, 6.4, 0.05, '#4f93c4');
for (const [x, z] of [[-14, 20], [-12, 50], [4, 56], [44, 14], [46, 50], [10, 30], [36, 24], [-2, 38]]) tree(x, z, 0.9 + ((x * 7 + z) % 5) / 10);
const pond = Array.from({ length: 12 }, (_, i) => ({ x: 25 + Math.cos((i / 12) * Math.PI * 2) * 7.4, z: 40 + Math.sin((i / 12) * Math.PI * 2) * 7.4 }));
const BENCHES = [{ at: { x: 2, z: 14.5 }, facing: Math.PI / 2 }, { at: { x: 22, z: 14.5 }, facing: Math.PI / 2 }, { at: { x: 40, z: 31 }, facing: Math.PI }, { at: { x: 12, z: 50 }, facing: -Math.PI / 2 }];
for (const b of BENCHES) { const c = Math.cos(b.facing + Math.PI / 2) * 0.8, s = Math.sin(b.facing + Math.PI / 2) * 0.8; box(b.at.x - Math.abs(c) - 0.2, b.at.z - Math.abs(s) - 0.2, b.at.x + Math.abs(c) + 0.2, b.at.z + Math.abs(s) + 0.2, 0.42, 0.48, '#6a4a2e'); }
box(62, 14, 130, 70, 0, 0.02, '#8a8d90', false); box(90, 24, 130, 66, 0, 11, '#7a8a96'); box(64, 40, 86, 66, 0, 7, '#8a7a6a'); box(118, 26, 122, 30, 11, 26, '#6a5a50');
box(62, 8.6, 76, 9.1, 0, 2, '#2b2b2b'); box(84, 8.6, 130, 9.1, 0, 2, '#2b2b2b'); box(75.6, 7.4, 76.2, 9.2, 0, 2.6, '#e0a526'); box(83.8, 7.4, 84.4, 9.2, 0, 2.6, '#e0a526');
// fields with hedges, out west
flat(-240, -60, -130, 70, 0.02, 'grass'); for (const [x0, z0, x1, z1] of [[-240, -61, -130, -59], [-240, 69, -130, 71], [-241, -60, -239, 70], [-131, -60, -129, 70], [-240, 4, -130, 6]]) box(x0, z0, x1, z1, 0, 1.4, '#3f6a2e');

// ---------------- people ----------------
const store = new PeopleStore();
scene.add(store.root);
const crowds = new Crowds(store);
crowds.timeScale = 60; // the demo clock runs at a minute a second so walks look right
const walkLine = (a: XZ, b: XZ) => [a, b];
const northFoot = footwaysOf([{ x: -155, z: 0 }, { x: 155, z: 0 }], KERB, BACK, PAVE_Y)[0];
const southFoot = footwaysOf([{ x: -155, z: 0 }, { x: 155, z: 0 }], KERB, BACK, PAVE_Y)[1];
const stop: QueueSite = stopSite('stop', { x: 41, z: 0 }, 0, 1, KERB, BACK, { shelter: true, y: PAVE_Y });
const platform: QueueSite = {
  id: 'platform', kind: 'platform', at: { x: 56, z: -32.4 }, along: 0, facing: -Math.PI / 2, y: 0.92, length: 62, depth: [1.3, 4.8],
  away: [[{ x: 88, z: -28.5 }, { x: 28, z: -28.5 }], [{ x: 22, z: -28.5 }, { x: 28, z: -28.5 }]],
};
const toWorks = [{ x: 28, z: -26 }, { x: 28, z: -5.2 }, { x: 34, z: -4.6 }, { x: 34, z: 4.6 }, { x: 78, z: 4.8 }, { x: 80, z: 7 }, { x: 80, z: 16 }];
const fromWorks = [...toWorks].reverse();
const ui = {
  clock: document.getElementById('clock') as HTMLInputElement, clockv: document.getElementById('clockv')!, play: document.getElementById('play')!,
  wait: document.getElementById('wait') as HTMLInputElement, waitv: document.getElementById('waitv')!, bus: document.getElementById('bus')!,
  era: document.getElementById('era') as HTMLSelectElement, rain: document.getElementById('rain')!, stress: document.getElementById('stress') as HTMLSelectElement,
  stats: document.getElementById('stats')!, views: document.getElementById('views')!,
};
let clock = 7.9 * 60, playing = true, waiting = 12, stressN = 0, platformWaiting = 14;
// the economy's stand-in for the platform: people arrive at a rate by the hour, and trains take them
const platformArrivals = (m: number, dt: number) => { platformWaiting = Math.min(60, platformWaiting + dt * MINUTES_PER_S * 0.9 * DAY.commute(m)); };
const MINUTES_PER_S = 1;

function townFlows(m: number): Flow[] {
  const st = DAY.street(m), sh = DAY.shops(m);
  return [
    { kind: 'queue', id: 'stop', site: stop, waiting },
    { kind: 'queue', id: 'platform', site: platform, waiting: Math.round(platformWaiting) },
    { kind: 'walk', id: 'north', footway: northFoot, count: Math.round(10 + 45 * Math.max(st, sh)), mix: MIXES.highStreet },
    { kind: 'walk', id: 'south', footway: southFoot, count: Math.round(8 + 35 * st) },
    { kind: 'walk', id: 'station-path', footway: { line: walkLine({ x: 28, z: -25 }, { x: 28, z: -6.5 }), width: 3.6, y: PAVE_Y }, count: Math.round(2 + 10 * DAY.commute(m)) },
    { kind: 'ride', id: 'cycle-east', line: [{ x: -155, z: -2.4 }, { x: 155, z: -2.4 }], count: Math.round(1 + 5 * st) },
    { kind: 'ride', id: 'cycle-west', line: [{ x: 155, z: 2.4 }, { x: -155, z: 2.4 }], count: Math.round(1 + 4 * st) },
    { kind: 'cross', id: 'zebra', a: { x: -5, z: -3.6 }, b: { x: -5, z: 3.6 }, count: Math.round(1 + 4 * st) },
    { kind: 'loiter', id: 'pub', at: { x: 18, z: -BACK }, facing: -Math.PI / 2, width: 11, count: Math.round(14 * DAY.pub(m)), venue: 'pub', y: PAVE_Y },
    { kind: 'loiter', id: 'shops', at: { x: -30, z: -BACK }, facing: -Math.PI / 2, width: 70, count: Math.round(12 * sh), venue: 'shop', y: PAVE_Y },
    { kind: 'loiter', id: 'square', at: { x: -82, z: -12 }, facing: -Math.PI / 2, width: 14, count: Math.round(6 * sh), venue: 'square', y: PAVE_Y },
    { kind: 'commute', id: 'shift-6', path: toWorks, total: 140, window: [5 * 60 + 40, 6 * 60 + 10], mix: { worker: 5, overalls: 3, office: 0.4 }, width: 2.4, y: PAVE_Y },
    { kind: 'commute', id: 'shift-14', path: toWorks, total: 110, window: [13 * 60 + 40, 14 * 60 + 10], mix: { worker: 5, overalls: 3 }, width: 2.4, y: PAVE_Y },
    { kind: 'commute', id: 'home-14', path: fromWorks, total: 120, window: [14 * 60 + 2, 14 * 60 + 25], mix: { worker: 5, overalls: 3 }, width: 2.4, y: PAVE_Y },
    { kind: 'commute', id: 'office-in', path: [{ x: 28, z: -26 }, { x: 28, z: -5.5 }, { x: -60, z: -5.2 }], total: 45, window: [7 * 60 + 50, 9 * 60], mix: { office: 4, public: 1, nurse: 0.3 }, width: 2.4, y: PAVE_Y },
    {
      kind: 'park', id: 'park', area: [{ x: -18, z: 10 }, { x: 48, z: 10 }, { x: 48, z: 58 }, { x: -18, z: 58 }], benches: BENCHES,
      walkers: Math.round(10 * DAY.park(m)), dogWalkers: Math.round(8 * DAY.dogs(m)), joggers: Math.round(4 * DAY.joggers(m)), looseDogs: Math.round(4 * DAY.dogs(m)),
      sitters: Math.round(7 * DAY.park(m)), avoid: [pond], kids: Math.round(7 * DAY.park(m) * (m > 15.5 * 60 ? 1 : 0.3)), play: { x: 0, z: 44 },
    },
    {
      kind: 'school', id: 'school', gate: { x: -50, z: 8.2 }, yard: [{ x: -68, z: 11 }, { x: -32, z: 11 }, { x: -32, z: 31 }, { x: -68, z: 31 }], pupils: 90, school: 0,
      approaches: [[{ x: -8, z: 4.7 }, { x: -49, z: 4.7 }, { x: -50, z: 9.5 }], [{ x: -120, z: 4.7 }, { x: -51, z: 4.7 }, { x: -50, z: 9.5 }], [{ x: -6, z: -4.8 }, { x: -5, z: 4.6 }, { x: -49, z: 5 }, { x: -50, z: 9.5 }]],
      arrive: [8 * 60 + 30, 8 * 60 + 50], leave: [15 * 60 + 15, 15 * 60 + 35],
    },
    { kind: 'animals', id: 'sheep', species: 'sheep', count: 34, area: [{ x: -236, z: -56 }, { x: -134, z: -56 }, { x: -134, z: 1 }, { x: -236, z: 1 }] },
    { kind: 'animals', id: 'cows', species: 'cow', count: 14, area: [{ x: -236, z: 9 }, { x: -134, z: 9 }, { x: -134, z: 66 }, { x: -236, z: 66 }] },
    { kind: 'animals', id: 'pigeons', species: 'pigeon', count: 16, area: [{ x: -90, z: -22 }, { x: -74, z: -22 }, { x: -74, z: -8 }, { x: -90, z: -8 }], y: PAVE_Y },
    { kind: 'animals', id: 'ducks', species: 'duck', count: 9, area: [{ x: 20, z: 35 }, { x: 30, z: 35 }, { x: 30, z: 45 }, { x: 20, z: 45 }], y: 0.1 },
    { kind: 'animals', id: 'cats', species: 'cat', count: 3, spots: [{ at: { x: -64, z: 8.6 }, facing: Math.PI / 2, y: 1.2 }, { at: { x: -36, z: 8.6 }, facing: -Math.PI / 2 + 0.3, y: 1.2 }, { at: { x: -58, z: 8.6 }, facing: 0, y: 1.2 }], lines: [{ line: [{ x: -69, z: 8.6 }, { x: -53, z: 8.6 }], y: 1.2 }] },
  ];
}
// a big even crowd for measuring: walkers on a grid of paths north of the railway
function stressFlows(n: number): Flow[] {
  const out: Flow[] = [];
  const rows = 12, per = n / (rows * 2);
  for (let i = 0; i < rows; i++) {
    const z = -60 - i * 9;
    out.push({ kind: 'walk', id: `s-row${i}`, footway: { line: [{ x: -60, z }, { x: 100, z }], width: 4 }, count: per });
    const x = -60 + i * 14;
    out.push({ kind: 'walk', id: `s-col${i}`, footway: { line: [{ x, z: -58 }, { x, z: -165 }], width: 4 }, count: per });
  }
  return out;
}

// the turntable: one of everyone, standing and walking, with the dog breeds in front
const TT = { x: 0, z: -230 };
function turntable() {
  store.add({
    id: 'turntable', centre: TT, radius: 10, count: 999,
    build: (b) => {
      const r = rng(7);
      const roles = ROLES as Role[];
      roles.forEach((role, i) => {
        const col = i % 6, row = Math.floor(i / 6), p = { x: TT.x - 5 + col * 2, z: TT.z - 3 + row * 2.4 };
        const look = dress(role, crowds.year, rng(1000 + i * 17));
        const walking = role === 'jogger' || role === 'cyclist' || role === 'parent' || role === 'wheelchair' || i % 2 === 0;
        const route: Route = walking ? circleRoute(p, 0.7, 0, true) : { legs: [{ x: p.x, z: p.z, h: Math.PI / 2, k: 0, L: 0.01, S: 0 }], length: 0.01, closed: false };
        emitPerson(b, i, route, { mode: walking ? Mode.Closed : Mode.Still, v: walking ? Math.min(look.speed, 1.6) : 0, s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y: 0 }, look, r());
      });
      DOGS.forEach((d, i) => {
        const p = { x: TT.x - 5.5 + i * 1.6, z: TT.z + 5.4 };
        const route: Route = { legs: [{ x: p.x, z: p.z, h: Math.PI / 2 + 0.6, k: 0, L: 0.01, S: 0 }], length: 0.01, closed: false };
        emitAnimal(b, 100 + i, route, { mode: Mode.Still, v: 0, s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y: 0 }, { species: SPECIES.indexOf(d), size: 1, idle: i % 3 === 2 ? 1 : 0, coat: hex(['#d9b46a', '#6a3a1e', '#f2f0ea', '#6a3a1e', '#9a9590', '#1c1a18', '#c9a46a', '#f2f0ea'][i]), second: hex('#f2f0ea'), pattern: d === 'collie' ? 2 : d === 'spaniel' ? 1 : 0, dark: hex('#1c1a18') }, r());
      });
    },
  });
}
turntable();
flat(TT.x - 8, TT.z - 6, TT.x + 8, TT.z + 7.5, 0.02, '#c9c2b4');

// ---------------- a bus that calls at the stop, and a train at the platform ----------------
const busM = new THREE.Group();
busM.add(box(-5.5, -1.25, 5.5, 1.25, 0.35, 2.95, '#c9302c'), box(-5.2, -1.28, 5.2, 1.28, 1.55, 2.55, '#26343f'));
scene.add(busM);
const bus = { x: -150, v: 9, dwell: -1, served: false, boarded: 0, until: 0 };
const BUS_STOP_X = stop.at.x - 4.2; // the front door at the flag
const trainM = new THREE.Group();
for (let i = 0; i < 3; i++) trainM.add(box(-10 + i * 20.4 - 30, -35.6, 10 + i * 20.4 - 30, -32.6, 0.5, 3.8, i === 1 ? '#2f6fb8' : '#e8e6e0'), box(-9.8 + i * 20.4 - 30, -35.62, 9.8 + i * 20.4 - 30, -32.58, 2.1, 3.0, '#26343f'));
scene.add(trainM);
const train = { x: -300, v: 0, state: 'away' as 'away' | 'in' | 'dwell' | 'out', t: 0 };
const TRAIN_STOP = 56;

function stepVehicles(dt: number) {
  // bus: drive, slow for the stop, wait while people board and get off
  if (bus.dwell >= 0) {
    bus.dwell += dt;
    if (bus.dwell > 2.5 && crowds.time > bus.until + 1) { bus.dwell = -1; bus.served = true; }
  } else {
    const togo = BUS_STOP_X - bus.x;
    const want = !bus.served && togo > 0 && togo < 30 ? Math.max(0.6, Math.sqrt(2 * 1.6 * togo)) : 11;
    bus.v += Math.max(-4, Math.min(1.5, want - bus.v)) * dt * 1.2;
    bus.x += bus.v * dt;
    if (!bus.served && Math.abs(togo) < 0.4) {
      bus.dwell = 0; bus.v = 0;
      const door = [{ x: stop.at.x + 0.2, z: -2.95 }];
      const off = crowds.alight('stop', [{ x: stop.at.x - 0.6, z: -2.9 }], 3 + Math.floor(Math.random() * 5));
      const on = crowds.board('stop', door, 99);
      waiting = Math.max(0, waiting - on.n); ui.wait.value = String(waiting);
      bus.until = Math.max(on.until, off.until);
    }
    if (bus.x > 170) { bus.x = -170; bus.served = false; }
  }
  busM.position.set(bus.x, 0, -1.62);
  platformArrivals(clock, dt);
  // train: every couple of minutes, stops, doors, people on and off
  train.t += dt;
  if (train.state === 'away' && train.t > 50) { train.state = 'in'; train.x = -260; train.v = 22; }
  if (train.state === 'in') {
    const togo = TRAIN_STOP - train.x;
    train.v = Math.min(22, Math.max(0.8, Math.sqrt(2 * 1.1 * Math.max(0, togo))));
    train.x += train.v * dt;
    if (togo < 0.2) {
      train.state = 'dwell'; train.t = 0;
      const doors: XZ[] = [];
      for (let i = 0; i < 3; i++) for (const d of [-5, 5]) doors.push({ x: train.x - 30 + i * 20.4 + d, z: -32.3 });
      crowds.alight('platform', doors, Math.round(6 + 30 * DAY.commute(clock)));
      platformWaiting -= crowds.board('platform', doors, 999).n;
    }
  } else if (train.state === 'dwell' && train.t > 22) { train.state = 'out'; train.v = 0; }
  else if (train.state === 'out') { train.v = Math.min(24, train.v + dt * 1.2); train.x += train.v * dt; if (train.x > 420) { train.state = 'away'; train.t = 0; } }
  trainM.position.set(train.x, 0, 0);
}

// ---------------- views, input and the frame loop ----------------
const VIEWS: Record<string, Partial<typeof view>> = {
  'Bus stop': { x: 36, z: -3, h: 26 }, 'High street': { x: -20, z: -2, h: 55 }, Station: { x: 50, z: -27, h: 40, el: 0.95 }, 'Works gate': { x: 70, z: 4, h: 40 },
  Park: { x: 16, z: 34, h: 60 }, School: { x: -52, z: 18, h: 44 }, Fields: { x: -185, z: 5, h: 150 }, Town: { x: -20, z: 0, h: 260 }, Turntable: { x: TT.x, z: TT.z + 1, h: 16 },
};
let spin = false;
for (const name of Object.keys(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setView(name);
  ui.views.append(b);
}
function setView(name: string) {
  Object.assign(view, { az: Math.PI / 4, el: 0.6 }, VIEWS[name]);
  spin = name === 'Turntable';
  for (const b of ui.views.querySelectorAll('button')) b.classList.toggle('on', b.textContent === name);
  placeCamera();
}
const pointers = new Map<number, { x: number; y: number }>();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointerup', (e) => pointers.delete(e.pointerId));
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (pointers.size === 1) {
    const s = view.h / canvas.clientHeight, c = Math.cos(view.az), si = Math.sin(view.az);
    view.x -= (dx * c - dy * si / Math.sin(view.el)) * s; view.z -= (-dx * si - dy * c / Math.sin(view.el)) * s;
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y);
    p.x = e.clientX; p.y = e.clientY;
    const [a1, b1] = [...pointers.values()], d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
    view.h = Math.max(8, Math.min(600, view.h * (d0 / Math.max(1, d1))));
  }
  p.x = e.clientX; p.y = e.clientY;
  placeCamera();
});
canvas.addEventListener('wheel', (e) => { view.h = Math.max(8, Math.min(600, view.h * Math.exp(e.deltaY * 0.001))); placeCamera(); e.preventDefault(); }, { passive: false });
ui.clock.oninput = () => { clock = +ui.clock.value; };
ui.play.onclick = () => { playing = !playing; ui.play.textContent = playing ? '⏸' : '▶'; };
ui.wait.oninput = () => { waiting = +ui.wait.value; };
const callBus = () => { bus.x = BUS_STOP_X - 60; bus.v = 10; bus.served = false; bus.dwell = -1; };
ui.bus.onclick = callBus;
ui.era.onchange = () => { crowds.year = +ui.era.value; store.remove('turntable'); turntable(); };
ui.rain.onclick = () => { store.rain = store.rain > 0.5 ? 0 : 1; ui.rain.classList.toggle('on', store.rain > 0.5); scene.background = new THREE.Color(store.rain > 0.5 ? '#8f9aa4' : '#a9c7dd'); };
ui.stress.onchange = () => { stressN = +ui.stress.value; if (stressN) Object.assign(view, { x: 20, z: -112, h: 150, az: Math.PI / 4, el: 0.6 }); placeCamera(); };
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

let last = performance.now(), acc = { n: 0, ms: 0, upd: 0, flows: 0 }, fps = 0, frameMs = 0, updMs = 0, flowMs = 0;
function frame(now: number) {
  const raw = now - last, dt = Math.min(0.1, raw / 1000);
  last = now;
  if (playing) clock = (clock + dt * MINUTES_PER_S) % 1440;
  if (spin) { view.az += dt * 0.35; placeCamera(); }
  const f0 = performance.now();
  crowds.set(stressN ? [...townFlows(clock), ...stressFlows(stressN)] : townFlows(clock), clock);
  const f1 = performance.now();
  stepVehicles(dt);
  store.update(cam, canvas.clientHeight, dt);
  renderer.render(scene, cam);
  acc.n++; acc.ms += raw; acc.upd += store.stats.updateMs; acc.flows += f1 - f0;
  if (acc.ms > 1000) { fps = (acc.n * 1000) / acc.ms; frameMs = acc.ms / acc.n; updMs = acc.upd / acc.n; flowMs = acc.flows / acc.n; acc = { n: 0, ms: 0, upd: 0, flows: 0 }; }
  const s = store.stats, r = renderer.info.render;
  ui.stats.textContent = `${hhmm(clock)} · ${fps.toFixed(0)} fps (${frameMs.toFixed(1)} ms) · people ${s.byLod[0]}/${s.byLod[1]}/${s.byLod[2]} near/mid/far · ${s.drawCalls} calls, ${Math.round(s.triangles / 1000)}k tris · update ${updMs.toFixed(2)} + flows ${flowMs.toFixed(2)} ms · scene ${r.calls} calls`;
  if (document.activeElement !== ui.clock) ui.clock.value = String(Math.floor(clock));
  ui.clockv.textContent = hhmm(clock); ui.waitv.textContent = String(waiting);
  requestAnimationFrame(frame);
}
resize();
setView('Bus stop');
requestAnimationFrame(frame);

declare global { interface Window { __people: unknown } }
window.__people = {
  store, crowds, renderer, cam, view, BUDGETS,
  setView, placeCamera,
  setClock: (m: number) => { clock = m; },
  // run the town forward without drawing (for screenshots on slow software GL)
  advance: (sec: number) => { for (let t = 0; t < sec; t += 0.05) { if (playing) clock = (clock + 0.05 * MINUTES_PER_S) % 1440; crowds.set(stressN ? [...townFlows(clock), ...stressFlows(stressN)] : townFlows(clock), clock); stepVehicles(0.05); store.update(cam, canvas.clientHeight, 0.05); } },
  bus, train,
  // Time n figures at one level of detail: CPU placement and store update, then GPU frames
  // (each forced to finish with a one-pixel read so the time is the real draw time).
  measure: async (n: number, lod: number, frames = 8, shadows = true) => {
    stressN = n; store.forceLod = lod; playing = false; sun.castShadow = shadows;
    store.setBudget({ ...BUDGETS[0], near: 1e6, mid: 1e6, far: 1e6, buildsPerFrame: 1e6 });
    Object.assign(view, { x: 20, z: -112, h: 170, az: Math.PI / 4, el: 0.6 }); placeCamera();
    // only the measuring crowd
    const flows = stressFlows(n);
    crowds.set(flows, clock); store.update(cam, canvas.clientHeight, 0.016);
    let cpu = 0, upd = 0;
    for (let i = 0; i < 60; i++) { const a = performance.now(); crowds.set(flows, clock); const b = performance.now(); store.update(cam, canvas.clientHeight, 0.016); upd += performance.now() - b; cpu += b - a; }
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const draw = () => { renderer.render(scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 2; i++) draw();
    for (const o of scene.children) if (o !== store.root && !(o instanceof THREE.Light)) o.visible = false;
    for (let i = 0; i < 2; i++) draw();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) { store.update(cam, canvas.clientHeight, 0.016); draw(); }
    const ms = (performance.now() - t0) / frames;
    const r = { n, lod, figures: store.stats.byLod[lod], instances: store.stats.instances, triangles: store.stats.triangles, peopleCalls: store.stats.drawCalls, calls: renderer.info.render.calls, renderTris: renderer.info.render.triangles, frameMs: ms, flowsMs: cpu / 60, updateMs: upd / 60, shadows };
    for (const o of scene.children) o.visible = true;
    return r;
  },
  setPlaying: (p: boolean) => { playing = p; },
  setWaiting: (n: number) => { waiting = n; ui.wait.value = String(n); },
  setStress: (n: number) => { stressN = n; },
  callBus,
  near: (x: number, z: number, r = 2) => store.figures().filter((f) => Math.hypot(f.x - x, f.z - z) < r && f.alpha > 0.01).map((f) => ({ g: f.group, k: f.k, x: +f.x.toFixed(2), z: +f.z.toFixed(2), prop: f.rec[30], mode: f.rec[11] })),
  stats: () => ({ fps, frameMs, updMs, flowMs, ...store.stats, calls: renderer.info.render.calls, sceneTris: renderer.info.render.triangles }),
};
