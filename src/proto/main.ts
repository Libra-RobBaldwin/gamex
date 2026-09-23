// 3D prototype: free-form roads, plots along any street, buses and cars, rotating camera.
import * as THREE from 'three';
import './proto.css';
import { HALF, Network, ROAD_W, rng, closestOnSeg, type End, type Lot, type P, type RSeg } from './roads';

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
const view = { x: 0, z: 20, az: Math.PI / 4, el: 0.6, elTarget: 0.6, h: 300 };

function placeCamera() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const aspect = w / h;
  cam.left = (-view.h * aspect) / 2; cam.right = (view.h * aspect) / 2;
  cam.top = view.h / 2; cam.bottom = -view.h / 2;
  cam.updateProjectionMatrix();
  const d = 1200;
  cam.position.set(view.x + Math.sin(view.az) * Math.cos(view.el) * d, Math.sin(view.el) * d, view.z + Math.cos(view.az) * Math.cos(view.el) * d);
  cam.lookAt(view.x, 0, view.z);
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

// One window cell = 3 m x 3 m. White walls are tinted by each material's colour.
const facadeTex = canvasTex(64, 64, (x) => {
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#5f7488';
  x.fillRect(14, 16, 36, 30);
  x.fillStyle = '#8fa6b8';
  x.fillRect(14, 16, 36, 6);
  x.fillStyle = '#e9e9e9';
  x.fillRect(12, 46, 40, 4);
});
const glassTex = canvasTex(64, 64, (x) => {
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#4d6b86';
  x.fillRect(3, 6, 58, 50);
  x.fillStyle = '#7fa3c2';
  x.fillRect(3, 6, 58, 12);
});

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
  for (const s of net.segs.values()) {
    const [a, b] = net.segEnds(s);
    if (closestOnSeg(t, a, b).d < HALF + 3) return true;
  }
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
  quad(a: P, b: P, hw: number, y: number) {
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    const nx = (-dz / L) * hw, nz = (dx / L) * hw;
    const p = [a.x + nx, a.z + nz, b.x + nx, b.z + nz, b.x - nx, b.z - nz, a.x - nx, a.z - nz];
    this.tri(p[0], p[1], p[2], p[3], p[4], p[5], y);
    this.tri(p[0], p[1], p[4], p[5], p[6], p[7], y);
  }
  disc(c: P, r: number, y: number, n = 20) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      this.tri(c.x, c.z, c.x + Math.cos(a1) * r, c.z + Math.sin(a1) * r, c.x + Math.cos(a0) * r, c.z + Math.sin(a0) * r, y);
    }
  }
  tri(x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, y: number) {
    // keep triangles facing up
    const cross = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
    if (cross > 0) this.pos.push(x0, y, z0, x2, y, z2, x1, y, z1);
    else this.pos.push(x0, y, z0, x1, y, z1, x2, y, z2);
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

function rebuildRoads() {
  for (const c of [...roadGroup.children]) { roadGroup.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const pave = new Flat(), asph = new Flat(), lines = new Flat();
  for (const s of net.segs.values()) {
    const [a, b] = net.segEnds(s);
    pave.quad(a, b, HALF, 0.15);
    asph.quad(a, b, ROAD_W / 2, 0.25);
    // dashed centre line, kept clear of junctions
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    const trimA = net.segsAt(a.id).length > 2 ? HALF + 1 : 0, trimB = net.segsAt(b.id).length > 2 ? HALF + 1 : 0;
    for (let t = trimA + 1; t + 3 < L - trimB; t += 6) lines.quad({ x: a.x + ux * t, z: a.z + uz * t }, { x: a.x + ux * (t + 3), z: a.z + uz * (t + 3) }, 0.12, 0.35);
  }
  for (const n of net.nodes.values()) {
    pave.disc(n, HALF, 0.15);
    asph.disc(n, ROAD_W / 2, 0.25);
  }
  roadGroup.add(pave.mesh(paveMat), asph.mesh(asphaltMat), lines.mesh(lineMat));
}

// ---------------- buildings ----------------
const WALLS: Record<Lot['kind'], string[]> = {
  house: ['#efe4cf', '#dcc6a4', '#c7916f', '#e9e6de', '#d8b68f'],
  terrace: ['#b86e4f', '#c98a64', '#a55d45', '#d8c1a2'],
  shop: ['#e8dfd0', '#cfc4b3', '#b9a58c'],
  flats: ['#cdbca7', '#b6a48f', '#d9d2c6', '#a88a74'],
  tower: ['#9fbdd3', '#b3c2cf', '#8ca8bf'],
};
const ROOFS = ['#9c463b', '#6d5a50', '#7b838c', '#b0633e', '#56606b'];
const matCache = new Map<string, THREE.Material>();
const mat = (key: string, make: () => THREE.Material) => { let m = matCache.get(key); if (!m) { m = make(); matCache.set(key, m); } return m; };
const wallMat = (col: string, glass = false) => mat(`w${col}${glass}`, () => new THREE.MeshLambertMaterial({ color: col, map: glass ? glassTex : facadeTex }));
const plainMat = (col: string) => mat(`p${col}`, () => new THREE.MeshLambertMaterial({ color: col }));

// Box whose side UVs repeat every 3 m so windows stay the right size.
function facadeBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const scale = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]]; // px nx py ny pz nz
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * scale[f][0]) / 3, (uv.getY(i) * scale[f][1]) / 3);
    }
  return g;
}

function gableRoof(w: number, d: number, rise: number) {
  const x = w / 2, z = d / 2;
  const v = [
    -x, 0, -z, x, 0, -z, x, rise, 0, -x, 0, -z, x, rise, 0, -x, rise, 0, // back slope
    -x, 0, z, -x, rise, 0, x, rise, 0, -x, 0, z, x, rise, 0, x, 0, z, // front slope
    -x, 0, -z, -x, rise, 0, -x, 0, z, x, 0, -z, x, 0, z, x, rise, 0, // gables
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

interface Built { lot: Lot; group: THREE.Group; born: number }
const buildings: Built[] = [];
const cityGroup = new THREE.Group();
scene.add(cityGroup);

function makeBuilding(l: Lot): THREE.Group {
  const g = new THREE.Group();
  const pick = <T,>(arr: T[]) => arr[Math.floor(l.seed * arr.length) % arr.length];
  const wall = pick(WALLS[l.kind]);
  const add = (m: THREE.Mesh, y: number) => { m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  const roofMat = plainMat(pick(ROOFS));
  if (l.kind === 'house' || l.kind === 'terrace') {
    const wallH = l.kind === 'house' ? 5.2 : l.h;
    add(new THREE.Mesh(facadeBox(l.w, wallH, l.d), [wallMat(wall), wallMat(wall), roofMat, roofMat, wallMat(wall), wallMat(wall)]), wallH / 2);
    add(new THREE.Mesh(gableRoof(l.w + 0.6, l.d + 0.6, l.kind === 'house' ? 3.6 : 3), roofMat), wallH);
    if (l.kind === 'house') add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.8), plainMat('#8a6b5a')), wallH + 2.4).position.x = l.w * 0.25;
  } else {
    const glass = l.kind === 'tower';
    add(new THREE.Mesh(facadeBox(l.w, l.h, l.d), [wallMat(wall, glass), wallMat(wall, glass), plainMat(glass ? '#c3ccd4' : '#8c8580'), roofMat, wallMat(wall, glass), wallMat(wall, glass)]), l.h / 2);
    add(new THREE.Mesh(new THREE.BoxGeometry(l.w * 0.3, 2.2, l.d * 0.3), plainMat('#a7a9ab')), l.h + 1.1);
    if (l.kind === 'shop') {
      // a coloured awning over the shopfront, on the side facing the road
      const aw = add(new THREE.Mesh(new THREE.BoxGeometry(l.w * 0.9, 0.4, 1.6), plainMat(pick(['#2e7d5b', '#b23a3a', '#2f5d9e', '#c98a1f']))), 3.4);
      aw.position.z = l.d / 2 + 0.8;
    }
  }
  g.position.set(l.x, 0, l.z);
  // local +x runs along the road; local +z faces the road
  g.rotation.y = -l.rot;
  return g;
}

let queue: Lot[] = [];
function spawnLot(l: Lot, animate = true) {
  net.lots.push(l);
  const group = makeBuilding(l);
  if (animate) group.scale.y = 0.01;
  cityGroup.add(group);
  buildings.push({ lot: l, group, born: performance.now() });
}

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
      v.seg = n.seg; v.from = n.seg.a; v.s = n.t * net.length(n.seg);
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
    const A = net.node(v.from), B = net.node(net.other(v.seg, v.from));
    const ux = (B.x - A.x) / L, uz = (B.z - A.z) / L;
    // drive on the left
    const x = A.x + ux * v.s + uz * 1.9, z = A.z + uz * v.s - ux * 1.9;
    const target = Math.atan2(uz, ux);
    let dh = target - v.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    v.heading += dh * Math.min(1, dt * 8);
    v.mesh.position.set(x, 0.25, z);
    v.mesh.rotation.y = -v.heading;
  }
}

// ---------------- starter town ----------------
function seedTown() {
  const road = (a: P, b: P) => {
    const s = net.snapStart(a, 3), e = net.snapStart(b, 3);
    return net.build(s, e);
  };
  const made: number[] = [];
  void made.length;
  made.push(...road({ x: -230, z: 0 }, { x: 230, z: 0 }));
  made.push(...road({ x: 0, z: -200 }, { x: 0, z: 200 }));
  made.push(...road({ x: 0, z: 0 }, { x: 170, z: -98 })); // a 30° diagonal
  made.push(...road({ x: -200, z: -96 }, { x: 0, z: -96 }));
  made.push(...road({ x: -110, z: -96 }, { x: -170, z: 0 })); // a slanting link
  // a crescent: short straight pieces around a curve
  let prev: P = { x: 0, z: 70 };
  for (let k = 1; k <= 7; k++) {
    const a = (k / 7) * (Math.PI / 2);
    const p = { x: -80 + 80 * Math.cos(a), z: 70 + 80 * Math.sin(a) };
    made.push(...road(prev, p));
    prev = p;
  }
  made.push(...road({ x: 60, z: 0 }, { x: 60, z: 110 }));
  made.push(...road({ x: 0, z: 110 }, { x: 110, z: 110 }));
  for (const s of net.segs.values()) queuePlots([s.id]);
  // most of the town exists at the start, the rest grows in front of you
  const now = Math.floor(queue.length * 0.8);
  for (const l of queue.splice(0, now)) if (net.lotFree(l)) spawnLot(l, false);
}

// ---------------- UI ----------------
type Mode = 'look' | 'road';
let mode: Mode = 'look';
let draft: { a: End; b: End } | null = null;
let dragging = false;

$('#ui').innerHTML = `
  <div id="info" class="glass"><b>Tracks &amp; Towns · 3D test</b><div id="stats"></div></div>
  <div id="side">
    <button id="rotL" title="Rotate left">⟲</button>
    <button id="rotR" title="Rotate right">⟳</button>
    <button id="top" title="Top-down view">🗺️</button>
  </div>
  <div id="dock">
    <div id="hint"></div>
    <div id="bp" class="glass hidden"></div>
    <div id="tools" class="glass">
      <button data-t="look"><i>👆</i>Look</button>
      <button data-t="road"><i>🛣️</i>Road</button>
      <button data-t="bus"><i>🚌</i>Add bus</button>
      <button data-t="cars"><i>🚗</i>Add cars</button>
      <button data-t="reset"><i>🔄</i>Reset</button>
    </div>
  </div>`;

function setMode(m: Mode) {
  mode = m;
  draft = null;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.t === m));
  renderBar();
  hint();
}
function hint(text?: string) {
  $('#hint').textContent = text ?? (mode === 'road'
    ? 'Drag to draw a road · it snaps to 15° and to other roads · two fingers to move, pinch, twist'
    : 'Drag to move · pinch to zoom · twist with two fingers to rotate');
}
document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.t!;
  if (t === 'look' || t === 'road') return setMode(t);
  if (t === 'bus') { addVehicle(true); hint('Bus added. It follows the roads and only turns round at dead ends.'); }
  if (t === 'cars') { for (let i = 0; i < 5; i++) addVehicle(false); hint('Five cars added.'); }
  if (t === 'reset') location.reload();
}));
$('#rotL').addEventListener('click', () => { view.az += Math.PI / 4; });
$('#rotR').addEventListener('click', () => { view.az -= Math.PI / 4; });
$('#top').addEventListener('click', () => {
  view.elTarget = view.elTarget > 1 ? 0.6 : 1.5;
  $('#top').classList.toggle('on', view.elTarget > 1);
});

function renderBar() {
  const el = $('#bp');
  if (!draft) { el.classList.add('hidden'); return; }
  const c = net.check(draft.a, draft.b);
  el.innerHTML = `<div class="row"><span>📐 New road <b>${Math.round(c.length)} m</b>${c.clears.length ? ` · clears ${c.clears.length} building${c.clears.length > 1 ? 's' : ''}` : ''} · <b style="color:var(--gold)">${money(c.cost)}</b></span>
    <span class="btns"><button id="bpc">Cancel</button><button id="bpb" class="primary" ${c.ok && !dragging ? '' : 'disabled'}>Build</button></span></div>
    ${c.ok ? '' : `<div class="bad">${c.reason}</div>`}`;
  el.classList.remove('hidden');
  $('#bpc').addEventListener('click', () => { draft = null; renderBar(); });
  $('#bpb').addEventListener('click', () => {
    if (!draft) return;
    const made = net.build(draft.a, draft.b);
    // remove meshes for buildings the road cleared
    for (let i = buildings.length - 1; i >= 0; i--)
      if (!net.lots.includes(buildings[i].lot)) { cityGroup.remove(buildings[i].group); buildings.splice(i, 1); }
    draft = null;
    rebuildRoads();
    queuePlots(made);
    refreshTrees();
    renderBar();
    hint('Built. New plots will fill in along it.');
  });
}

// ghost road for the blueprint
const ghostMat = new THREE.MeshBasicMaterial({ color: '#4cc3ff', transparent: true, opacity: 0.55, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: '#ff5a4d', transparent: true, opacity: 0.55, depthWrite: false });
let ghost: THREE.Mesh | null = null;
function drawGhost() {
  if (ghost) { scene.remove(ghost); ghost.geometry.dispose(); ghost = null; }
  if (!draft) return;
  const ok = net.check(draft.a, draft.b).ok;
  const f = new Flat();
  f.quad(draft.a, draft.b, HALF, 0.6);
  f.disc(draft.a, HALF, 0.6);
  f.disc(draft.b, HALF, 0.6);
  for (const l of net.check(draft.a, draft.b).clears) {
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: l.x + Math.cos(l.rot) * (l.w / 2) * i - Math.sin(l.rot) * (l.d / 2) * j, z: l.z + Math.sin(l.rot) * (l.w / 2) * i + Math.cos(l.rot) * (l.d / 2) * j }));
    f.tri(c[0].x, c[0].z, c[1].x, c[1].z, c[2].x, c[2].z, 0.7);
    f.tri(c[0].x, c[0].z, c[2].x, c[2].z, c[3].x, c[3].z, 0.7);
  }
  ghost = f.mesh(ok ? ghostMat : badMat);
  ghost.renderOrder = 5;
  scene.add(ghost);
}

// ---------------- input ----------------
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundAt(sx: number, sy: number): P {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  const hit = new THREE.Vector3();
  ray.ray.intersectPlane(plane, hit);
  return { x: hit.x, z: hit.z };
}

const pts = new Map<number, { x: number; y: number }>();
let gesture: 'none' | 'maybe' | 'pan' | 'draw' | 'multi' = 'none';
let start = { x: 0, y: 0 };
let multi = { d: 0, a: 0, cx: 0, cy: 0 };
const tol = () => view.h * 0.035;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) {
    start = { x: e.clientX, y: e.clientY };
    gesture = 'maybe';
  } else if (pts.size === 2) {
    if (gesture === 'draw') { draft = null; drawGhost(); renderBar(); }
    dragging = false;
    gesture = 'multi';
    const [a, b] = [...pts.values()];
    multi = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pts.has(e.pointerId)) return;
  const prev = pts.get(e.pointerId)!;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture === 'multi' && pts.size >= 2) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const g0 = groundAt(multi.cx, multi.cy);
    view.h = Math.max(40, Math.min(900, view.h * (multi.d / (d || multi.d))));
    view.az -= ang - multi.a;
    placeCamera();
    const g1 = groundAt(cx, cy);
    view.x += g0.x - g1.x;
    view.z += g0.z - g1.z;
    multi = { d, a: ang, cx, cy };
    return;
  }
  if (gesture === 'maybe' && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
    gesture = mode === 'road' ? 'draw' : 'pan';
    if (gesture === 'draw') {
      const a = net.snapStart(groundAt(start.x, start.y), tol());
      draft = { a, b: { ...a } };
      dragging = true;
    }
  }
  if (gesture === 'pan') {
    const g0 = groundAt(prev.x, prev.y), g1 = groundAt(e.clientX, e.clientY);
    view.x += g0.x - g1.x;
    view.z += g0.z - g1.z;
  } else if (gesture === 'draw' && draft) {
    draft.b = net.snapEnd(draft.a, groundAt(e.clientX, e.clientY), tol());
    drawGhost();
    renderBar();
  }
});

const end = (e: PointerEvent) => {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (pts.size) return;
  if (gesture === 'draw') { dragging = false; renderBar(); drawGhost(); }
  gesture = 'none';
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.h = Math.max(40, Math.min(900, view.h * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
}, { passive: false });

// ---------------- loop ----------------
seedTown();
rebuildRoads();
refreshTrees();
for (let i = 0; i < 4; i++) addVehicle(true);
for (let i = 0; i < 14; i++) addVehicle(false);
setMode('look');
resize();

const POP: Record<Lot['kind'], number> = { house: 4, terrace: 5, shop: 6, flats: 45, tower: 160 };
let last = performance.now();
let growAt = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  view.el += (view.elTarget - view.el) * Math.min(1, dt * 5);
  placeCamera();
  // the town grows: one new building every few tenths of a second
  growAt -= dt;
  if (growAt <= 0 && queue.length) {
    growAt = 0.35;
    const l = queue.shift()!;
    if (net.lotFree(l)) { spawnLot(l); refreshTrees(); }
  }
  for (const b of buildings) if (b.group.scale.y < 1) b.group.scale.y = Math.min(1, (now - b.born) / 700);
  moveVehicles(dt);
  const pop = buildings.reduce((s, b) => s + POP[b.lot.kind], 0);
  $('#stats').textContent = `Population ${pop.toLocaleString('en-GB')} · ${buildings.length} buildings · ${vehicles.length} vehicles`;
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { proto: unknown }).proto = { net, view, vehicles, buildings, setMode, groundAt };
