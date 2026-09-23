// 3D prototype: free-form roads, plots along any street, buses and cars, rotating camera.
import * as THREE from 'three';
import './proto.css';
import { DEFAULT_OPTS, HALF, Network, ROAD_W, rng, closestOnPath, pointAt, subPath, pathLength, type Check, type End, type Lot, type P, type RSeg, type RoadOpts } from './roads';
import { GRADE_STEPS } from './grade';
import { makeBuilding as generate, USE } from './buildgen';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

// ---------------- world ----------------
const LAKE = { x: 250, z: -190, r: 90 };
const isWater = (p: P) => Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 4;
const BOUND = 520;
const net = new Network(isWater, BOUND, 11);
const CENTRE = { x: 0, z: 0 };
const rand = rng(99);

// ---------------- three setup ----------------
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9cbe3');

scene.add(new THREE.HemisphereLight('#e8f3ff', '#5d7040', 1.25));
const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
const view = { x: 0, z: 20, az: Math.PI / 4, el: 0.6, h: 300 };
const HOME = { az: Math.PI / 4, el: 0.6 };
const EL_MIN = 0.35, EL_MAX = 1.52, H_MIN = 35, H_MAX = 900;
// animated camera moves (buttons, double-tap); any touch cancels them
let goal: Partial<typeof view> | null = null;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function placeCamera() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const aspect = w / h;
  cam.left = (-view.h * aspect) / 2; cam.right = (view.h * aspect) / 2;
  cam.top = view.h / 2; cam.bottom = -view.h / 2;
  cam.updateProjectionMatrix();
  const d = 1200;
  cam.position.set(view.x + Math.sin(view.az) * Math.cos(view.el) * d, Math.sin(view.el) * d, view.z + Math.cos(view.az) * Math.cos(view.el) * d);
  cam.lookAt(view.x, 0, view.z);
  cam.updateMatrixWorld();
  // the sun follows the view so shadows stay sharp where you're looking
  sun.position.set(view.x - 160, 260, view.z + 110);
  sun.target.position.set(view.x, 0, view.z);
  const r = Math.max(120, view.h * 0.9);
  const sc = sun.shadow.camera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 900;
  sc.updateProjectionMatrix();
}

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  placeCamera();
}
window.addEventListener('resize', resize);

// ---------------- textures ----------------
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

const grassTex = canvasTex(256, 256, (x) => {
  x.fillStyle = '#6f9e48';
  x.fillRect(0, 0, 256, 256);
  const r = rng(3);
  for (let i = 0; i < 5000; i++) {
    const g = 120 + r() * 60;
    x.fillStyle = `rgba(${60 + r() * 40},${g},${40 + r() * 30},0.35)`;
    x.fillRect(r() * 256, r() * 256, 2, 2);
  }
});
grassTex.repeat.set(60, 60);

// ---------------- ground, water ----------------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(BOUND * 2.6, BOUND * 2.6), new THREE.MeshLambertMaterial({ map: grassTex }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const beach = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 7, 72), new THREE.MeshLambertMaterial({ color: '#d9c894' }));
beach.rotation.x = -Math.PI / 2;
beach.position.set(LAKE.x, 0.05, LAKE.z);
const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 72), new THREE.MeshPhongMaterial({ color: '#3f86bf', shininess: 90, specular: '#cfe6ff' }));
lake.rotation.x = -Math.PI / 2;
lake.position.set(LAKE.x, 0.1, LAKE.z);
lake.receiveShadow = true;
scene.add(beach, lake);

// ---------------- trees (instanced) ----------------
interface Tree { x: number; z: number; s: number; kind: number }
let trees: Tree[] = [];
for (let i = 0; i < 1400; i++) {
  const p = { x: (rand() * 2 - 1) * BOUND, z: (rand() * 2 - 1) * BOUND };
  // woods on the outskirts, a few in town
  const dc = Math.hypot(p.x, p.z);
  if (dc < 140 && rand() < 0.85) continue;
  if (isWater(p) || Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 10) continue;
  trees.push({ ...p, s: 0.8 + rand() * 0.7, kind: rand() < 0.3 ? 1 : 0 });
}
const crownGeo = new THREE.IcosahedronGeometry(3.4, 1);
const pineGeo = new THREE.ConeGeometry(3, 9, 7);
const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);
const crownMat = new THREE.MeshLambertMaterial({ color: '#4f8a36', flatShading: true });
const pineMat = new THREE.MeshLambertMaterial({ color: '#2f6b35', flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
const MAXT = 1600;
const crowns = new THREE.InstancedMesh(crownGeo, crownMat, MAXT);
const pines = new THREE.InstancedMesh(pineGeo, pineMat, MAXT);
const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAXT);
for (const m of [crowns, pines, trunks]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

function treeBlocked(t: Tree) {
  for (const s of net.segs.values()) if (closestOnPath(t, net.path(s)).d < HALF + 3) return true;
  for (const l of net.lots) if (Math.hypot(t.x - l.x, t.z - l.z) < Math.max(l.w, l.d) * 0.75 + 2) return true;
  return false;
}

function refreshTrees() {
  trees = trees.filter((t) => !treeBlocked(t));
  const m = new THREE.Matrix4();
  let nc = 0, np = 0;
  trees.forEach((t, i) => {
    m.compose(new THREE.Vector3(t.x, 1.75 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m);
    if (t.kind === 0) { m.compose(new THREE.Vector3(t.x, 5.6 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s * 1.1, t.s)); crowns.setMatrixAt(nc++, m); }
    else { m.compose(new THREE.Vector3(t.x, 7 * t.s, t.z), new THREE.Quaternion(), new THREE.Vector3(t.s, t.s, t.s)); pines.setMatrixAt(np++, m); }
  });
  trunks.count = trees.length; crowns.count = nc; pines.count = np;
  for (const x of [trunks, crowns, pines]) x.instanceMatrix.needsUpdate = true;
}


// ---------------- roads ----------------
const paveMat = new THREE.MeshLambertMaterial({ color: '#bdb8ad', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const asphaltMat = new THREE.MeshLambertMaterial({ color: '#484c52', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const lineMat = new THREE.MeshLambertMaterial({ color: '#f1f1f1', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const roadGroup = new THREE.Group();
scene.add(roadGroup);

class Flat {
  pos: number[] = [];
  // a strip of half-width hw following a path, mitred at the bends
  ribbon(path: P[], hw: number, y: number) {
    const n = path.length;
    const side: P[] = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      side.push({ x: -(b.z - a.z) / L, z: (b.x - a.x) / L });
    }
    for (let i = 1; i < n; i++) {
      const p = path[i - 1], q = path[i], s0 = side[i - 1], s1 = side[i];
      const a = { x: p.x + s0.x * hw, z: p.z + s0.z * hw }, b = { x: q.x + s1.x * hw, z: q.z + s1.z * hw };
      const c = { x: q.x - s1.x * hw, z: q.z - s1.z * hw }, d = { x: p.x - s0.x * hw, z: p.z - s0.z * hw };
      const yp = (p.y ?? 0) + y, yq = (q.y ?? 0) + y;
      this.tri3(a.x, yp, a.z, b.x, yq, b.z, c.x, yq, c.z);
      this.tri3(a.x, yp, a.z, c.x, yq, c.z, d.x, yp, d.z);
    }
  }
  disc(c: P, r: number, y: number, n = 20) {
    y += c.y ?? 0;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.tri(c.x, c.z, c.x + Math.cos(a1) * r, c.z + Math.sin(a1) * r, c.x + Math.cos(a0) * r, c.z + Math.sin(a0) * r, y);
    }
  }
  ring(c: P, r0: number, r1: number, y: number, n = 24) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a: number, r: number) => [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r] as const;
      const [x0, z0] = p(a0, r0), [x1, z1] = p(a1, r0), [x2, z2] = p(a1, r1), [x3, z3] = p(a0, r1);
      this.tri(x0, z0, x1, z1, x2, z2, y);
      this.tri(x0, z0, x2, z2, x3, z3, y);
    }
  }
  tri(x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, y: number) {
    // keep triangles facing up
    const cross = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
    if (cross > 0) this.pos.push(x0, y, z0, x2, y, z2, x1, y, z1);
    else this.pos.push(x0, y, z0, x1, y, z1, x2, y, z2);
  }
  // same, for a triangle that may slope
  tri3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
    const cross = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
    if (cross > 0) this.pos.push(x0, y0, z0, x2, y2, z2, x1, y1, z1);
    else this.pos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
  }
  mesh(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }
}

// Bridges and ramps: deck edges (retaining walls near the ground), underside, parapets, piers.
const concreteMat = new THREE.MeshLambertMaterial({ color: '#b9b5ac', side: THREE.DoubleSide });
const parapetMat = new THREE.MeshLambertMaterial({ color: '#dcd8d0', side: THREE.DoubleSide });
class Solid {
  pos: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[]) { this.pos.push(...a, ...b, ...c, ...a, ...c, ...d); }
  box(cx: number, cz: number, ux: number, uz: number, along: number, across: number, y0: number, y1: number) {
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [cx + ux * along * i - uz * across * j, cz + uz * along * i + ux * across * j]);
    for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]); }
    this.quad([c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]]);
  }
  mesh(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}
const DECK = 1.2;
function structures(path: P[], body: Solid, rails: Solid | null) {
  const n = path.length;
  if (!path.some((p) => (p.y ?? 0) > 0.05)) return;
  const side = path.map((_, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / L, z: (b.x - a.x) / L };
  });
  const Y = (i: number) => path[i].y ?? 0;
  for (let i = 1; i < n; i++) {
    if (Y(i - 1) < 0.05 && Y(i) < 0.05) continue;
    const p = path[i - 1], q = path[i], s0 = side[i - 1], s1 = side[i];
    const t0 = Y(i - 1) + 0.15, t1 = Y(i) + 0.15, b0 = Math.max(0, Y(i - 1) - DECK), b1 = Math.max(0, Y(i) - DECK);
    for (const k of [1, -1]) {
      const e0 = [p.x + s0.x * HALF * k, p.z + s0.z * HALF * k], e1 = [q.x + s1.x * HALF * k, q.z + s1.z * HALF * k];
      body.quad([e0[0], b0, e0[1]], [e1[0], b1, e1[1]], [e1[0], t1, e1[1]], [e0[0], t0, e0[1]]);
      if (rails && Y(i - 1) > 1.5 && Y(i) > 1.5) rails.quad([e0[0], t0, e0[1]], [e1[0], t1, e1[1]], [e1[0], t1 + 1, e1[1]], [e0[0], t0 + 1, e0[1]]);
    }
    if (b0 > 0 || b1 > 0) {
      const l0 = [p.x + s0.x * HALF, p.z + s0.z * HALF], r0 = [p.x - s0.x * HALF, p.z - s0.z * HALF];
      const l1 = [q.x + s1.x * HALF, q.z + s1.z * HALF], r1 = [q.x - s1.x * HALF, q.z - s1.z * HALF];
      body.quad([l0[0], b0, l0[1]], [l1[0], b1, l1[1]], [r1[0], b1, r1[1]], [r0[0], b0, r0[1]]);
    }
  }
  if (!rails) return;
  // piers every 24 m where the deck is high enough to need them
  const L = pathLength(path);
  for (let t = 12; t < L; t += 24) {
    const q = pointAt(path, t);
    if (q.y < 2.6) continue;
    body.box(q.x, q.z, q.ux, q.uz, 0.7, 0.9, 0, q.y - DECK);
    body.box(q.x, q.z, q.ux, q.uz, 0.8, HALF - 0.6, q.y - DECK - 0.9, q.y - DECK);
  }
}

function rebuildRoads() {
  for (const c of [...roadGroup.children]) { roadGroup.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const pave = new Flat(), asph = new Flat(), lines = new Flat(), body = new Solid(), rails = new Solid();
  for (const s of net.segs.values()) {
    const path = net.path(s);
    structures(path, body, rails);
    pave.ribbon(path, HALF, 0.15);
    asph.ribbon(path, ROAD_W / 2, 0.25);
    // dashed centre line, kept clear of junctions
    const L = pathLength(path);
    const trimA = net.segsAt(s.a).length > 2 ? HALF + 1 : 0, trimB = net.segsAt(s.b).length > 2 ? HALF + 1 : 0;
    for (let t = trimA + 1; t + 3 < L - trimB; t += 6) lines.ribbon(subPath(path, t, t + 3), 0.12, 0.35);
  }
  for (const n of net.nodes.values()) {
    pave.disc(n, HALF, 0.15);
    asph.disc(n, ROAD_W / 2, 0.25);
  }
  roadGroup.add(pave.mesh(paveMat), asph.mesh(asphaltMat), lines.mesh(lineMat));
  if (body.pos.length) roadGroup.add(body.mesh(concreteMat));
  if (rails.pos.length) roadGroup.add(rails.mesh(parapetMat));
}

// ---------------- buildings ----------------
interface Built { lot: Lot; group: THREE.Group; born: number; height: number; name: string; detail: string; dying?: number }
const buildings: Built[] = [];
const cityGroup = new THREE.Group();
scene.add(cityGroup);

let queue: Lot[] = [];
function spawnLot(l: Lot, animate = true) {
  net.lots.push(l);
  const b = generate(l);
  if (animate) b.group.scale.y = 0.01;
  cityGroup.add(b.group);
  buildings.push({ lot: l, born: performance.now(), ...b });
}
const shortName = (b: Built) => b.name.split(' · ')[0];

function queuePlots(segs: number[]) {
  for (const id of segs) {
    const plots = net.plotsFor(id, CENTRE);
    // denser, taller near the centre; a few gaps elsewhere
    for (const p of plots) if (Math.hypot(p.x, p.z) < 200 || rand() < 0.75) queue.push(p);
  }
  queue.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
}

// ---------------- vehicles ----------------
interface Veh { mesh: THREE.Group; seg: RSeg; from: number; s: number; speed: number; heading: number; bus: boolean }
const vehicles: Veh[] = [];
const vMat = new Map<string, THREE.Material>();
const plainMat = (c: string) => { let m = vMat.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); vMat.set(c, m); } return m; };

function busMesh(color: string) {
  const g = new THREE.Group();
  const box = (w: number, h: number, d: number, c: string, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plainMat(c));
    m.position.y = y; m.castShadow = true; g.add(m); return m;
  };
  box(11, 2.6, 2.5, color, 1.9);
  box(10.4, 1.05, 2.56, '#26343f', 2.35);
  box(0.06, 1.3, 2.3, '#3d5566', 2.3).position.x = 5.52;
  box(10.6, 0.25, 2.3, '#f2f2f2', 3.3);
  box(2.2, 0.5, 1.4, '#cfd3d6', 3.6).position.x = -2;
  for (const [x, z] of [[3.6, 1.2], [3.6, -1.2], [-3.4, 1.2], [-3.4, -1.2]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 12), plainMat('#1c1d20'));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.55, z);
    g.add(w);
  }
  return g;
}

function carMesh(color: string) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.9, 1.8), plainMat(color));
  body.position.y = 0.85; body.castShadow = true;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.75, 1.62), plainMat('#2b3640'));
  cab.position.set(-0.3, 1.65, 0); cab.castShadow = true;
  g.add(body, cab);
  for (const [x, z] of [[1.3, 0.9], [1.3, -0.9], [-1.3, 0.9], [-1.3, -0.9]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.25, 10), plainMat('#1c1d20'));
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.4, z);
    g.add(w);
  }
  return g;
}

function addVehicle(bus: boolean) {
  const segs = [...net.segs.values()];
  if (!segs.length) return;
  const seg = segs[Math.floor(rand() * segs.length)];
  const colours = ['#c9302c', '#2f6fb8', '#f2f2f2', '#2b2b2b', '#e0a526', '#5a8f4a', '#8d8f93'];
  const mesh = bus ? busMesh(rand() < 0.5 ? '#c9302c' : '#e8a21f') : carMesh(colours[Math.floor(rand() * colours.length)]);
  mesh.rotation.order = 'YZX'; // yaw, then pitch up and down the ramps
  scene.add(mesh);
  vehicles.push({ mesh, seg, from: rand() < 0.5 ? seg.a : seg.b, s: rand() * net.length(seg), speed: bus ? 11 : 14 + rand() * 4, heading: 0, bus });
}

function moveVehicles(dt: number) {
  for (const v of vehicles) {
    if (!net.segs.has(v.seg.id)) {
      // road was split: hop onto whichever piece is nearest
      const p = v.mesh.position;
      const n = net.nearestSeg({ x: p.x, z: p.z }, 50);
      if (!n) continue;
      v.seg = n.seg; v.from = n.seg.a; v.s = n.s;
    }
    let L = net.length(v.seg);
    v.s += v.speed * dt;
    while (v.s >= L) {
      v.s -= L;
      const at = net.other(v.seg, v.from);
      const options = net.segsAt(at).filter((s) => s.id !== v.seg.id);
      // U-turn only at dead ends
      const next = options.length ? options[Math.floor(rand() * options.length)] : v.seg;
      v.seg = next;
      v.from = at;
      L = net.length(next);
    }
    const q = pointAt(net.pathFrom(v.seg, v.from), v.s);
    // drive on the left
    const x = q.x + q.uz * 1.9, z = q.z - q.ux * 1.9;
    const target = Math.atan2(q.uz, q.ux);
    let dh = target - v.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    v.heading += dh * Math.min(1, dt * 8);
    v.mesh.position.set(x, q.y + 0.25, z);
    v.mesh.rotation.y = -v.heading;
    v.mesh.rotation.z = Math.atan(q.grade);
  }
}

// ---------------- starter town ----------------
function seedTown() {
  const road = (a: P, b: P, c?: P, o = DEFAULT_OPTS) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), c, o);
  road({ x: -230, z: 0 }, { x: 230, z: 0 });
  road({ x: 0, z: -200 }, { x: 0, z: 200 });
  road({ x: 0, z: 0 }, { x: 170, z: -98 }); // a 30° diagonal
  road({ x: -200, z: -96 }, { x: 0, z: -96 });
  road({ x: -110, z: -96 }, { x: -170, z: 0 }); // a slanting link
  road({ x: 0, z: 70 }, { x: -80, z: 150 }, { x: 0, z: 150 }); // a crescent
  road({ x: 60, z: 0 }, { x: 60, z: 110 });
  road({ x: 0, z: 110 }, { x: 110, z: 110 });
  road({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 }); // a sweeping bypass
  const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
  road({ x: -215, z: -150 }, { x: -215, z: 150 }, undefined, over); // a flyover across the main road
  road({ x: 40, z: -190 }, { x: 470, z: -190 }, undefined, over); // a bridge over the lake
  for (const s of net.segs.values()) queuePlots([s.id]);
  // most of the town exists at the start, the rest grows in front of you
  const now = Math.floor(queue.length * 0.8);
  for (const l of queue.splice(0, now)) if (net.lotFree(l)) spawnLot(l, false);
}

// ---------------- UI ----------------
type Mode = 'look' | 'road';
type RoadKind = 'straight' | 'curve' | 'smooth';
let mode: Mode = 'look';
let roadKind: RoadKind = 'straight';
interface Draft { a: End; b: End; c?: P }
let draft: Draft | null = null;
let picks: End[] = []; // curve tool: taps placed so far (start, bend)
let dragging = false;
let draftCheck: Check | null = null;
let trace: P[] = []; // curve tool: where the finger has been during a drag
const opts: RoadOpts = { ...DEFAULT_OPTS };
const HEIGHTS = [['auto', '⛰️ Auto height'], ['level', '➖ Keep level'], ['up', '↗️ Climb']] as const;

$('#ui').innerHTML = `
  <div id="info" class="glass"><b>Tracks &amp; Towns · 3D test</b><div id="stats"></div></div>
  <div id="side">
    <button id="compass" title="Reset north and tilt"><span id="needle">➤</span></button>
    <button id="rotL" title="Rotate left">⟲</button>
    <button id="rotR" title="Rotate right">⟳</button>
    <button id="top" title="Top-down view">🗺️</button>
  </div>
  <div id="card" class="glass hidden"></div>
  <div id="dock">
    <div id="hint"></div>
    <div id="bp" class="glass hidden"></div>
    <div id="grade" class="glass hidden">
      <button id="g-h"></button><button id="g-g"></button><button id="g-x"></button>
    </div>
    <div id="kinds" class="glass hidden">
      <button data-k="straight"><i>📏</i>Straight</button>
      <button data-k="curve"><i>⤵️</i>Curve</button>
      <button data-k="smooth"><i>〰️</i>Smooth</button>
    </div>
    <div id="tools" class="glass">
      <button data-t="look"><i>👆</i>Look</button>
      <button data-t="road"><i>🛣️</i>Road</button>
      <button data-t="bus"><i>🚌</i>Add bus</button>
      <button data-t="cars"><i>🚗</i>Add cars</button>
      <button data-t="reset"><i>🔄</i>Reset</button>
    </div>
  </div>`;

const ctrlOf = (d: Draft) => (roadKind === 'smooth' ? net.smoothCtrl(d.a, d.b) : d.c);
function draftChanged() {
  draftCheck = draft ? net.check(draft.a, draft.b, ctrlOf(draft), opts) : null;
  drawGhost();
  renderBar();
}
function clearDraft() { draft = null; picks = []; draftChanged(); hint(); }

function setMode(m: Mode) {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.t === m));
  $('#kinds').classList.toggle('hidden', m !== 'road');
  $('#grade').classList.toggle('hidden', m !== 'road');
  clearDraft();
}
function setKind(k: RoadKind) {
  roadKind = k;
  document.querySelectorAll<HTMLButtonElement>('#kinds button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
  clearDraft();
}
function hint(text?: string) {
  let t = text;
  if (t === undefined) {
    if (mode !== 'road') t = 'Drag to move · pinch to zoom · twist to turn · two fingers up/down to tilt · tap a building';
    else if (draft) t = 'Drag the white handles to adjust, then Build';
    else if (roadKind === 'straight') t = 'Drag to draw a straight road · snaps to 15° and to other roads';
    else if (roadKind === 'smooth') t = 'Drag from a road: the new road curves smoothly out of it';
    else t = ['Drag along the curve you want · or tap start, bend, end', '2/3 · Tap the bend point: the curve pulls towards it', '3/3 · Tap where the curve ends'][picks.length];
  }
  $('#hint').textContent = t;
}
document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.t!;
  if (t === 'look' || t === 'road') return setMode(t);
  if (t === 'bus') { addVehicle(true); hint('Bus added. It follows the roads and only turns round at dead ends.'); }
  if (t === 'cars') { for (let i = 0; i < 5; i++) addVehicle(false); hint('Five cars added.'); }
  if (t === 'reset') location.reload();
}));
// height, gradient and crossing options apply live to the blueprint
function renderGrade() {
  $('#g-h').textContent = HEIGHTS.find((h) => h[0] === opts.height)![1];
  $('#g-g').textContent = `∠ ${Math.round(opts.grade * 100)}% max`;
  $('#g-x').textContent = opts.cross === 'junction' ? '✚ Junctions' : '🌉 Bridge over';
}
const gradeNote = {
  auto: 'Auto height: stays low, climbs only to clear what it crosses',
  level: 'Keep level: holds the starting height all the way',
  up: 'Climb: rises at the chosen gradient the whole way',
};
$('#g-h').addEventListener('click', () => {
  opts.height = HEIGHTS[(HEIGHTS.findIndex((h) => h[0] === opts.height) + 1) % HEIGHTS.length][0];
  renderGrade(); draftChanged(); hint(gradeNote[opts.height]);
});
$('#g-g').addEventListener('click', () => {
  opts.grade = GRADE_STEPS[(GRADE_STEPS.indexOf(opts.grade) + 1) % GRADE_STEPS.length];
  renderGrade(); draftChanged();
  hint(`Steepest gradient ${Math.round(opts.grade * 100)}% (roads allow up to ${Math.round(opts.spec.max * 100)}%): gentler means longer ramps`);
});
$('#g-x').addEventListener('click', () => {
  opts.cross = opts.cross === 'junction' ? 'bridge' : 'junction';
  renderGrade(); draftChanged();
  hint(opts.cross === 'bridge' ? `Roads you cross are bridged, with ${opts.spec.clear} m clearance` : 'Roads you cross at the same height become junctions');
});
renderGrade();
document.querySelectorAll<HTMLButtonElement>('#kinds button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.k as RoadKind)));
$('#rotL').addEventListener('click', () => { goal = { az: view.az - Math.PI / 4 }; });
$('#rotR').addEventListener('click', () => { goal = { az: view.az + Math.PI / 4 }; });
$('#compass').addEventListener('click', () => { goal = { az: view.az + wrap(HOME.az - view.az), el: HOME.el }; });
$('#top').addEventListener('click', () => {
  goal = { el: view.el > 1.2 ? HOME.el : EL_MAX };
});

// what a road would knock down, in words
function demolitionSummary(lots: Lot[]) {
  const counts = new Map<string, number>();
  let residents = 0, jobs = 0;
  for (const l of lots) {
    const b = buildings.find((x) => x.lot === l);
    const n = b ? shortName(b) : l.kind;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    const u = USE[l.kind];
    if (u.unit === 'jobs') jobs += u.pop; else residents += u.pop;
  }
  const list = [...counts].map(([n, c]) => `${c} × ${n}`).join(', ');
  const people = [residents && `${residents} residents rehoused`, jobs && `${jobs} jobs moved`].filter(Boolean).join(' · ');
  return { list, people };
}

function renderBar() {
  const el = $('#bp');
  if (!draft || !draftCheck) { el.classList.add('hidden'); return; }
  const c = draftCheck;
  const n = c.clears.length;
  const kind = ctrlOf(draft) ? 'Curved road' : 'New road';
  const demo = n ? demolitionSummary(c.clears) : null;
  const pr = c.profile;
  const lift = pr && pr.maxY > 0.05
    ? `<div class="lift">${c.ok ? `⛰️ up to <b>${pr.maxY.toFixed(1)} m</b> · steepest <b>${(pr.maxGrade * 100).toFixed(1)}%</b>${c.bridges ? ` · ${c.bridges} bridge${c.bridges > 1 ? 's' : ''}` : ''} · ${Math.round(c.raised)} m raised` : `⛰️ would need <b>${pr.maxY.toFixed(1)} m</b> — red line shows the lowest it could go`}</div>${profileSvg(c)}` : '';
  el.innerHTML = `<div class="row"><span>📐 ${kind} <b>${Math.round(c.length)} m</b> · <b style="color:var(--gold)">${money(c.cost)}</b></span>
    <span class="btns"><button id="bpc">Cancel</button><button id="bpb" class="${n ? 'danger' : 'primary'}" ${c.ok && !dragging ? '' : 'disabled'}>${n ? `💥 Demolish ${n} &amp; build` : 'Build'}</button></span></div>
    ${demo ? `<div class="demo"><b>⚠️ This road demolishes ${n} building${n > 1 ? 's' : ''}</b> (flashing red): ${demo.list}.<br>${demo.people} · ${money(n * 6000)} compensation included</div>` : ''}
    ${lift}
    ${c.ok ? '' : `<div class="bad">${c.reason}</div>`}`;
  el.classList.remove('hidden');
  $('#bpc').addEventListener('click', clearDraft);
  $('#bpb').addEventListener('click', () => {
    if (!draft) return;
    const doomed = new Set(draftCheck?.clears ?? []);
    const summary = doomed.size ? demolitionSummary([...doomed]) : null;
    const made = net.build(draft.a, draft.b, ctrlOf(draft), opts);
    // demolished buildings sink away rather than vanishing
    for (const b of buildings) if (!net.lots.includes(b.lot) && !b.dying) b.dying = performance.now();
    draft = null;
    draftChanged();
    rebuildRoads();
    queuePlots(made);
    refreshTrees();
    hint(summary ? `💥 Demolished ${doomed.size}: ${summary.list}` : 'Built. New plots will fill in along it.');
  });
}

// Long section of the blueprint: ground, the road's height, and what it has to clear.
function profileSvg(c: Check) {
  const p = c.profile!;
  const W = 320, H = 62, L = p.s[p.s.length - 1] || 1, top = Math.max(8, p.maxY + 1.5);
  const X = (s: number) => ((s / L) * W).toFixed(1), Y = (y: number) => (H - 8 - (y / top) * (H - 16)).toFixed(1);
  const parts: string[] = [`<line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="#6f9e48" stroke-width="2"/>`];
  for (const l of p.limits) {
    const x0 = X(Math.max(0, l.s0)), w = Math.max(3, (Math.min(L, l.s1) - Math.max(0, l.s0)) / L * W).toFixed(1);
    if (l.why === 'the water') parts.push(`<rect x="${x0}" y="${Y(0)}" width="${w}" height="6" fill="#3f86bf"/>`);
    else if (l.lo !== undefined && l.hi === undefined) parts.push(`<rect x="${x0}" y="${Y(l.lo - opts.spec.clear)}" width="${w}" height="4" fill="#9aa0a8"/><line x1="${x0}" y1="${Y(l.lo)}" x2="${(+x0 + +w).toFixed(1)}" y2="${Y(l.lo)}" stroke="#ffd35a" stroke-dasharray="3 2"/>`);
    else if (l.hi !== undefined && l.lo === undefined) parts.push(`<rect x="${x0}" y="${Y(l.hi + opts.spec.clear)}" width="${w}" height="4" fill="#9aa0a8"/>`);
  }
  const pts = p.s.map((s, i) => `${X(s)},${Y(p.y[i])}`).join(' ');
  parts.push(`<polyline points="${pts}" fill="none" stroke="${c.ok ? '#4cc3ff' : '#ff5a4d'}" stroke-width="2.5" stroke-linejoin="round"/>`);
  return `<svg class="prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${parts.join('')}</svg>`;
}

// ---------------- blueprint ghost ----------------
const ghostMat = new THREE.MeshBasicMaterial({ color: '#4cc3ff', transparent: true, opacity: 0.55, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: '#ff5a4d', transparent: true, opacity: 0.55, depthWrite: false });
const handleMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false });
const handleRing = new THREE.MeshBasicMaterial({ color: '#1f8fd6', depthTest: false });
const guideMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
const doomMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0.45, depthWrite: false });
const ghost = new THREE.Group();
ghost.renderOrder = 5;
scene.add(ghost);

function handles(): { p: P; key: 'a' | 'b' | 'c' }[] {
  if (draft) {
    const at = (e: End) => ({ ...e, y: net.endHeight(e) ?? 0 });
    const hs: { p: P; key: 'a' | 'b' | 'c' }[] = [{ p: at(draft.a), key: 'a' }, { p: at(draft.b), key: 'b' }];
    if (roadKind === 'curve' && draft.c) hs.push({ p: draft.c, key: 'c' });
    return hs;
  }
  return picks.map((p, i) => ({ p, key: i === 0 ? 'a' : 'c' }));
}

function drawGhost() {
  for (const c of [...ghost.children]) { ghost.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const hr = Math.max(2, view.h * 0.016);
  const hf = new Flat(), rf = new Flat(), gf = new Flat();
  for (const h of handles()) { rf.disc(h.p, hr * 1.35, 1.2); hf.disc(h.p, hr, 1.3); }
  // guide lines from the ends to the bend point, like Cities: Skylines
  const guide = (a: P, b: P) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 0; t < L; t += 4) gf.ribbon(subPath([a, b], t, Math.min(L, t + 2.2)), 0.35, 1.0);
  };
  if (!draft && picks.length === 2) guide(picks[0], picks[1]);
  if (draft && roadKind === 'curve' && draft.c) { guide(draft.a, draft.c); guide(draft.c, draft.b); }
  if (draft && draftCheck) {
    const f = new Flat();
    f.ribbon(draftCheck.path, HALF, 0.6);
    f.disc(draft.a, HALF, 0.6);
    f.disc(draft.b, HALF, 0.6);
    const m = f.mesh(draftCheck.ok ? ghostMat : badMat);
    m.renderOrder = 5;
    ghost.add(m);
    // the bridge's sides, so its shape reads in 3D
    const sides = new Solid();
    structures(draftCheck.path, sides, null);
    if (sides.pos.length) { const sm = sides.mesh(draftCheck.ok ? ghostMat : badMat); sm.castShadow = false; sm.renderOrder = 5; ghost.add(sm); }
    // every building in the way gets a flashing red block over it
    for (const l of draftCheck.clears) {
      const b = buildings.find((x) => x.lot === l);
      const h = (b?.height ?? l.h) + 1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(l.w + 1, h, l.d + 1), doomMat);
      box.position.set(l.x, h / 2, l.z);
      box.rotation.y = -l.rot;
      box.renderOrder = 6;
      ghost.add(box);
    }
  }
  for (const [f, mat, order] of [[gf, guideMat, 9], [rf, handleRing, 10], [hf, handleMat, 11]] as const) {
    if (!f.pos.length) continue;
    const m = f.mesh(mat);
    m.renderOrder = order;
    ghost.add(m);
  }
}

// ---------------- building card ----------------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function ndc(sx: number, sy: number) {
  const r = canvas.getBoundingClientRect();
  return new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
}
function pickBuilding(sx: number, sy: number) {
  ray.setFromCamera(ndc(sx, sy), cam);
  const hit = ray.intersectObjects(cityGroup.children, true)[0];
  let o: THREE.Object3D | null = hit?.object ?? null;
  while (o && !o.userData.lot) o = o.parent;
  return o ? buildings.find((b) => b.group === o) ?? null : null;
}
function showCard(b: Built | null) {
  const el = $('#card');
  if (!b) { el.classList.add('hidden'); return; }
  const u = USE[b.lot.kind];
  el.innerHTML = `<b>${b.name}</b><div>${b.detail}</div><div class="use">${u.label} · ${u.pop} ${u.unit}</div>`;
  el.classList.remove('hidden');
}

// ---------------- input (Google Maps style) ----------------
function groundAt(sx: number, sy: number): P {
  ray.setFromCamera(ndc(sx, sy), cam);
  const hit = new THREE.Vector3();
  ray.ray.intersectPlane(plane, hit);
  return { x: hit.x, z: hit.z };
}
function toScreen(p: P) {
  const v = new THREE.Vector3(p.x, p.y ?? 0, p.z).project(cam);
  return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight };
}
// move the camera so world point w sits under screen point (sx, sy)
function keepUnder(w: P, sx: number, sy: number) {
  placeCamera();
  const g = groundAt(sx, sy);
  view.x += w.x - g.x;
  view.z += w.z - g.z;
  placeCamera();
}

const pts = new Map<number, { x: number; y: number; t: number }>();
type G = 'none' | 'maybe' | 'pan' | 'draw' | 'handle' | 'two';
let gesture: G = 'none';
let downAt = { x: 0, y: 0, t: 0 };
let lastTap = { x: 0, y: 0, t: 0 };
let fling = { vx: 0, vz: 0 };
let panAnchor: P = { x: 0, z: 0 };
let vel: { x: number; z: number; t: number }[] = [];
let grabbed: 'a' | 'b' | 'c' = 'b';
// two-finger state, measured from the moment the second finger landed
let two = {
  d0: 0, a0: 0, m0: { x: 0, y: 0 }, anchor: { x: 0, z: 0 }, h0: 0, az0: 0, el0: 0,
  rotating: false, rotOff: 0, tilting: false, moved: false, t: 0,
};
const tol = () => view.h * 0.035;
const ROT_START = (12 * Math.PI) / 180;

function startTwo() {
  const [a, b] = [...pts.values()];
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  two = {
    d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), m0: m,
    anchor: groundAt(m.x, m.y), h0: view.h, az0: view.az, el0: view.el,
    rotating: false, rotOff: 0, tilting: false, moved: false, t: performance.now(),
  };
}
function startPan(x: number, y: number) {
  panAnchor = groundAt(x, y);
  vel = [];
}
function handleUnder(x: number, y: number) {
  if (mode !== 'road') return null;
  let best: 'a' | 'b' | 'c' | null = null, bd = 34;
  for (const h of handles()) { const s = toScreen(h.p); const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = h.key; } }
  return best;
}
// move a blueprint handle to a new spot, re-snapping it
function moveHandle(key: 'a' | 'b' | 'c', raw: P) {
  if (!draft) {
    if (key === 'a' && picks[0]) picks[0] = net.snapStart(raw, tol());
    if (key === 'c' && picks[0] && picks[1]) picks[1] = net.snapAngle(picks[0], raw);
    drawGhost();
    return;
  }
  if (key === 'a') draft.a = net.snapStart(raw, tol());
  if (key === 'b') draft.b = net.snapEnd(draft.a, raw, tol(), roadKind !== 'straight');
  if (key === 'c') draft.c = { ...raw };
  draftChanged();
}
// Bend point for a curve that passes through the middle of the finger's path: B(½) = ¼a + ½c + ¼b.
function fitCurve(a: P, b: P, tr: P[]): P | undefined {
  const L = pathLength(tr);
  if (L < 10) return undefined;
  const m = pointAt(tr, L / 2);
  return { x: 2 * m.x - (a.x + b.x) / 2, z: 2 * m.z - (a.z + b.z) / 2 };
}
function curveTap(raw: P) {
  if (draft) return;
  if (picks.length === 0) picks = [net.snapStart(raw, tol())];
  else if (picks.length === 1) picks.push(net.snapAngle(picks[0], raw));
  else {
    const b = net.snapEnd(picks[0], raw, tol(), true);
    draft = { a: picks[0], c: { x: picks[1].x, z: picks[1].z }, b };
    picks = [];
    draftChanged();
  }
  drawGhost();
  hint();
}

canvas.addEventListener('pointerdown', (e) => {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  goal = null;
  fling = { vx: 0, vz: 0 };
  if (pts.size === 1) {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    const h = handleUnder(e.clientX, e.clientY);
    if (h) { gesture = 'handle'; grabbed = h; dragging = true; return; }
    gesture = 'maybe';
    startPan(e.clientX, e.clientY);
  } else if (pts.size === 2) {
    if (gesture === 'draw') { draft = null; draftChanged(); }
    if (gesture === 'handle') { dragging = false; renderBar(); }
    dragging = false;
    gesture = 'two';
    startTwo();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (gesture === 'two' && pts.size >= 2) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const rot = wrap(Math.atan2(b.y - a.y, b.x - a.x) - two.a0);
    const scale = d / two.d0;
    const dy = m.y - two.m0.y;
    if (Math.abs(scale - 1) > 0.04 || Math.abs(rot) > 0.05 || Math.hypot(m.x - two.m0.x, dy) > 8) two.moved = true;
    // two fingers sliding up/down together (not pinching or turning) tilts, like Google Maps
    if (!two.rotating && !two.tilting && Math.abs(dy) > 14 && Math.abs(scale - 1) < 0.08 && Math.abs(rot) < 0.1 && Math.abs(m.x - two.m0.x) < Math.abs(dy) * 0.6) two.tilting = true;
    if (two.tilting) {
      view.el = Math.max(EL_MIN, Math.min(EL_MAX, two.el0 - dy * 0.006));
      placeCamera();
      return;
    }
    // rotation only kicks in after a deliberate twist, so pinching doesn't wobble
    if (!two.rotating && Math.abs(rot) > ROT_START) { two.rotating = true; two.rotOff = Math.sign(rot) * ROT_START; }
    view.h = Math.max(H_MIN, Math.min(H_MAX, two.h0 / scale));
    view.az = two.az0 + (two.rotating ? rot - two.rotOff : 0);
    keepUnder(two.anchor, m.x, m.y);
    return;
  }
  if (gesture === 'handle') { moveHandle(grabbed, groundAt(e.clientX, e.clientY)); return; }
  if (gesture === 'maybe' && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) {
    // straight and smooth roads are drawn by dragging; the curve tool uses taps, so dragging pans
    // (the curve tool draws on a drag too, unless you've started placing it by taps)
    gesture = mode === 'road' && !draft && !(roadKind === 'curve' && picks.length) ? 'draw' : 'pan';
    if (gesture === 'draw') {
      const a = net.snapStart(groundAt(downAt.x, downAt.y), tol());
      draft = { a, b: { ...a } };
      trace = [a];
      dragging = true;
    }
  }
  if (gesture === 'pan') {
    keepUnder(panAnchor, e.clientX, e.clientY);
    vel.push({ x: view.x, z: view.z, t: performance.now() });
    if (vel.length > 6) vel.shift();
  } else if (gesture === 'draw' && draft) {
    const raw = groundAt(e.clientX, e.clientY);
    draft.b = net.snapEnd(draft.a, raw, tol(), roadKind !== 'straight');
    if (roadKind === 'curve') { trace.push(raw); draft.c = fitCurve(draft.a, draft.b, trace); }
    draftChanged();
  }
});

const end = (e: PointerEvent) => {
  if (!pts.has(e.pointerId)) return;
  const now = performance.now();
  pts.delete(e.pointerId);
  if (gesture === 'two') {
    if (pts.size === 1) {
      // a quick two-finger tap zooms out
      if (!two.moved && now - two.t < 300) animateZoom(2, two.m0.x, two.m0.y);
      // carry on panning with the finger that's left, without a jump
      const [p] = [...pts.values()];
      startPan(p.x, p.y);
      gesture = 'pan';
      two.moved = true; // only the first finger lift counts for the tap
    }
    return;
  }
  if (pts.size) return;
  if (gesture === 'draw' || gesture === 'handle') { dragging = false; renderBar(); hint(); }
  if (gesture === 'pan' && vel.length >= 2) {
    const a = vel[0], b = vel[vel.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt > 0 && now - b.t < 80) fling = { vx: (b.x - a.x) / dt, vz: (b.z - a.z) / dt };
  }
  if (gesture === 'maybe' && now - downAt.t < 400) {
    if (mode === 'road' && roadKind === 'curve') curveTap(groundAt(e.clientX, e.clientY));
    else if (mode === 'look') {
      showCard(pickBuilding(e.clientX, e.clientY));
      // double-tap zooms in on the spot
      if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        animateZoom(0.5, e.clientX, e.clientY);
        lastTap.t = 0;
      } else lastTap = { x: e.clientX, y: e.clientY, t: now };
    }
  }
  gesture = 'none';
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const w = groundAt(e.clientX, e.clientY);
  view.h = Math.max(H_MIN, Math.min(H_MAX, view.h * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
  keepUnder(w, e.clientX, e.clientY);
}, { passive: false });

// Zoom by a factor, keeping the tapped spot in place.
function animateZoom(f: number, sx: number, sy: number) {
  const w = groundAt(sx, sy);
  const h = Math.max(H_MIN, Math.min(H_MAX, view.h * f));
  // where the camera centre should end up so w stays under the finger
  const c = groundAt(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const k = h / view.h;
  goal = { h, x: view.x + (w.x - c.x) * (1 - k), z: view.z + (w.z - c.z) * (1 - k) };
}

function stepCamera(dt: number) {
  if (goal) {
    const t = Math.min(1, dt * 7);
    let done = true;
    for (const k of Object.keys(goal) as (keyof typeof view)[]) {
      const g = goal[k]!;
      view[k] += (g - view[k]) * t;
      if (Math.abs(g - view[k]) > (k === 'h' || k === 'x' || k === 'z' ? 0.05 : 0.002)) done = false;
    }
    if (done) { Object.assign(view, goal); goal = null; }
  }
  if (gesture !== 'pan' && gesture !== 'two' && (fling.vx || fling.vz)) {
    view.x += fling.vx * dt;
    view.z += fling.vz * dt;
    const decay = Math.exp(-dt * 4);
    fling.vx *= decay; fling.vz *= decay;
    if (Math.hypot(fling.vx, fling.vz) < 2) fling = { vx: 0, vz: 0 };
  }
  view.x = Math.max(-BOUND, Math.min(BOUND, view.x));
  view.z = Math.max(-BOUND, Math.min(BOUND, view.z));
  // point the compass needle at north (-z) as it appears on screen
  const a = new THREE.Vector3(view.x, 0, view.z).project(cam), b = new THREE.Vector3(view.x, 0, view.z - 50).project(cam);
  const ang = Math.atan2(-(b.y - a.y) * canvas.clientHeight, (b.x - a.x) * canvas.clientWidth);
  $('#needle').style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
  $('#top').classList.toggle('on', view.el > 1.2);
}

// ---------------- loop ----------------
seedTown();
rebuildRoads();
refreshTrees();
for (let i = 0; i < 4; i++) addVehicle(true);
for (let i = 0; i < 14; i++) addVehicle(false);
setMode('look');
setKind('straight');
resize();

let last = performance.now();
let growAt = 0;
let lastH = view.h;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  stepCamera(dt);
  placeCamera();
  // keep blueprint handles a finger's width wide at any zoom
  if ((draft || picks.length) && Math.abs(view.h - lastH) > view.h * 0.08) { lastH = view.h; drawGhost(); }
  doomMat.opacity = 0.3 + 0.25 * Math.sin(now / 160);
  // the town grows: one new building every few tenths of a second
  growAt -= dt;
  if (growAt <= 0 && queue.length) {
    growAt = 0.35;
    const l = queue.shift()!;
    if (net.lotFree(l)) { spawnLot(l); refreshTrees(); }
  }
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (b.dying) {
      const k = (now - b.dying) / 700;
      b.group.scale.y = Math.max(0.01, 1 - k);
      if (k >= 1) { cityGroup.remove(b.group); for (const m of b.group.children) (m as THREE.Mesh).geometry.dispose(); buildings.splice(i, 1); }
    } else if (b.group.scale.y < 1) b.group.scale.y = Math.min(1, (now - b.born) / 700);
  }
  moveVehicles(dt);
  const pop = buildings.reduce((s, b) => s + (USE[b.lot.kind].unit === 'jobs' ? 0 : USE[b.lot.kind].pop), 0);
  $('#stats').textContent = `Population ${pop.toLocaleString('en-GB')} · ${buildings.length} buildings · ${vehicles.length} vehicles`;
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { proto: unknown }).proto = { net, view, vehicles, buildings, setMode, setKind, groundAt, toScreen, cam, THREE, pickBuilding };
