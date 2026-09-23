// 3D prototype: free-form roads, plots along any street, buses and cars, rotating camera.
import * as THREE from 'three';
import './proto.css';
import { BAY, DEFAULT_OPTS, Network, ROADS, bayWeight, kerbOf, rng, closestOnPath, pointAt, stopSpan, subPath, pathLength, type Check, type End, type Lot, type P, type RSeg, type RoadDef, type RoadOpts, type RoadType, type Stop, type StopPlan } from './roads';
import { GRADE_STEPS } from './grade';
import { Traffic, rushLabel, type Places } from './traffic';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CIVIC, makeBuilding as generate, makeRegion, USE } from './buildgen';
import { CELL, findRegions, type Region } from './infill';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

// ---------------- world ----------------
const LAKE = { x: 250, z: -190, r: 90 };
const isWater = (p: P) => Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 4;
const BOUND = 520;
const net = new Network(isWater, BOUND, 11);
// an industrial estate south of the centre
const INDUSTRIAL = (p: P) => p.z < -215 && Math.abs(p.x) < 280;
net.zoneAt = (p) => (INDUSTRIAL(p) ? 'industrial' : 'town');
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

// light-space axes, for snapping the shadow map to its texel grid
const SUN_DIR = new THREE.Vector3(-160, 260, 110).normalize();
const SUN_X = new THREE.Vector3(0, 1, 0).cross(SUN_DIR).normalize();
const SUN_Y = SUN_DIR.clone().cross(SUN_X).normalize();
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
  // The sun follows the view so shadows stay sharp where you're looking. Its shadow area only
  // changes size in big steps and slides in whole shadow-map texels, so edges don't shimmer.
  const r = 120 * Math.pow(1.6, Math.max(0, Math.ceil(Math.log((view.h * 0.9) / 120) / Math.log(1.6))));
  const texel = (2 * r) / sun.shadow.mapSize.x;
  const c = new THREE.Vector3(view.x, 0, view.z);
  const u = c.dot(SUN_X), v = c.dot(SUN_Y);
  c.addScaledVector(SUN_X, Math.round(u / texel) * texel - u).addScaledVector(SUN_Y, Math.round(v / texel) * texel - v);
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(SUN_DIR, 320);
  const sc = sun.shadow.camera;
  if (sc.right !== r) { sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 900; sc.updateProjectionMatrix(); }
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
  for (const s of net.segs.values()) if (closestOnPath(t, net.path(s)).d < net.half(s) + 3) return true;
  // plots and parks have their own planting
  if (infillCells.has(cellKey(t.x, t.z))) return true;
  for (const l of net.lots) {
    const c = net.parcelCentre(l);
    if (Math.hypot(t.x - c.x, t.z - c.z) > net.parcelR(l) + 3) continue;
    const dx = t.x - c.x, dz = t.z - c.z, co = Math.cos(l.rot), si = Math.sin(l.rot);
    if (Math.abs(dx * co + dz * si) < l.pw / 2 + 2 && Math.abs(-dx * si + dz * co) < (l.d + l.front + l.back) / 2 + 2) return true;
  }
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
  // a strip between two sideways offsets (left of the path's direction is positive), which may vary
  strip(path: P[], off: (i: number) => [number, number], y: number) {
    const n = path.length;
    const nl = path.map((_, i) => {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { x: (b.z - a.z) / L, z: -(b.x - a.x) / L };
    });
    for (let i = 1; i < n; i++) {
      const p = path[i - 1], q = path[i], [a0, a1] = off(i - 1), [b0, b1] = off(i);
      const yp = (p.y ?? 0) + y, yq = (q.y ?? 0) + y;
      const P0 = [p.x + nl[i - 1].x * a0, p.z + nl[i - 1].z * a0], P1 = [p.x + nl[i - 1].x * a1, p.z + nl[i - 1].z * a1];
      const Q0 = [q.x + nl[i].x * b0, q.z + nl[i].z * b0], Q1 = [q.x + nl[i].x * b1, q.z + nl[i].z * b1];
      this.tri3(P0[0], yp, P0[1], Q0[0], yq, Q0[1], Q1[0], yq, Q1[1]);
      this.tri3(P0[0], yp, P0[1], Q1[0], yq, Q1[1], P1[0], yp, P1[1]);
    }
  }
  // dashes along a line at a (varying) sideways offset
  dashes(path: P[], off: (t: number) => number, t0: number, t1: number, len: number, gap: number, w: number, y: number) {
    for (let t = t0; t + len <= t1; t += len + gap) { const sp = subPath(path, t, t + len); this.strip(sp, (i) => { const o = off(t + (len * i) / (sp.length - 1 || 1)); return [o - w, o + w]; }, y); }
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
function structures(path: P[], body: Solid, rails: Solid | null, HALF: number) {
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

const halfOfType = (t: RoadType) => { const d = ROADS[t]; return kerbOf(d) + d.pave + d.verge; };
const vergeMat = new THREE.MeshLambertMaterial({ color: '#6f9a4a', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const medianMat = new THREE.MeshLambertMaterial({ color: '#9d9a92', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const yellowMat = new THREE.MeshLambertMaterial({ color: '#e8c33a', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
const barrierMat = new THREE.MeshLambertMaterial({ color: '#a9adb0', side: THREE.DoubleSide });
const shelterGlass = new THREE.MeshLambertMaterial({ color: '#b9d6e2', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
const shelterFrame = new THREE.MeshLambertMaterial({ color: '#2e3136', side: THREE.DoubleSide });
const stopRed = new THREE.MeshLambertMaterial({ color: '#c9302c', side: THREE.DoubleSide });

// The cross-section of a road at distance t along it, allowing for bus lay-bys: where one is cut
// in, that side's kerb moves out (into the pavement, and into bought land) and its lanes narrow.
function section(s: RSeg, t: number) {
  const d = net.def(s), K = kerbOf(d);
  const side = () => ({ kerb: K, lane: K - d.shoulder, back: K + d.pave + d.verge, bay: 0 });
  const L = side(), R = side();
  for (const st of s.stops) {
    const w = bayWeight(st, t);
    if (!w || st.kind !== 'layby') continue;
    const x = st.side === 1 ? L : R;
    x.kerb += (st.take.pave + st.take.land) * w;
    x.back += st.take.land * w;
    x.lane -= st.take.lane * w;
    x.bay = Math.max(x.bay, w);
  }
  return { d, L, R };
}

// Extra points along a road near its stops, so kerb lines can bend smoothly.
function finePath(s: RSeg) {
  const path = net.path(s);
  if (!s.stops.length) return path;
  const L = pathLength(path), out: P[] = [];
  const cuts = new Set<number>([0, L]);
  let acc = 0;
  for (let i = 1; i < path.length - 1; i++) { acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); cuts.add(acc); }
  for (const st of s.stops) { const [a, b] = stopSpan(st); for (let t = Math.max(0, a - 2); t <= Math.min(L, b + 2); t += 1.5) cuts.add(t); }
  for (const t of [...cuts].sort((x, y) => x - y)) { const q = pointAt(path, t); out.push({ x: q.x, z: q.z, y: q.y }); }
  return out;
}

function arcs(path: P[]) {
  const a = [0];
  for (let i = 1; i < path.length; i++) a.push(a[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  return a;
}

function shelter(solid: { glass: Solid; frame: Solid; red: Solid }, path: P[], t: number, off: number) {
  const q = pointAt(path, t), nx = q.uz, nz = -q.ux; // left of travel
  const sx = Math.sign(off);
  const at = (a: number, o: number) => [q.x + q.ux * a + nx * o, q.z + q.uz * a + nz * o];
  const back = off + sx * 1.3, front = off + sx * 0.1, y = q.y;
  // back pane, end panes and roof
  const b0 = at(-2, back), b1 = at(2, back);
  solid.glass.quad([b0[0], y + 0.1, b0[1]], [b1[0], y + 0.1, b1[1]], [b1[0], y + 2.3, b1[1]], [b0[0], y + 2.3, b0[1]]);
  for (const e of [-2, 2]) { const p0 = at(e, back), p1 = at(e, front + sx * 0.4); solid.glass.quad([p0[0], y + 0.1, p0[1]], [p1[0], y + 0.1, p1[1]], [p1[0], y + 2.3, p1[1]], [p0[0], y + 2.3, p0[1]]); }
  solid.frame.box((at(0, (back + front) / 2))[0], (at(0, (back + front) / 2))[1], q.ux, q.uz, 2.15, 0.8, y + 2.3, y + 2.45);
  for (const e of [-2, 2]) { const p = at(e, back); solid.frame.box(p[0], p[1], q.ux, q.uz, 0.05, 0.05, y, y + 2.3); }
  // the stop flag: a pole with a red and white sign
  const f = at(3.2, front - sx * 0.2);
  solid.frame.box(f[0], f[1], q.ux, q.uz, 0.05, 0.05, y, y + 3);
  solid.red.box(f[0], f[1], q.ux, q.uz, 0.03, 0.35, y + 2.4, y + 2.95);
}

function rebuildRoads() {
  for (const c of [...roadGroup.children]) { roadGroup.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const pave = new Flat(), asph = new Flat(), lines = new Flat(), verge = new Flat(), median = new Flat(), yellow = new Flat();
  const body = new Solid(), rails = new Solid(), barrier = new Solid();
  const furn = { glass: new Solid(), frame: new Solid(), red: new Solid() };
  const trees: THREE.BufferGeometry[] = [];
  for (const s of net.segs.values()) {
    const d = net.def(s), path = finePath(s), A = arcs(path), L = A[A.length - 1];
    const sec = A.map((t) => section(s, t));
    structures(path, body, rails, net.half(s));
    // pavements or verges, then the carriageway
    const surface = d.pave > 0 ? pave : verge;
    surface.strip(path, (i) => [sec[i].L.kerb, sec[i].L.back], 0.15);
    surface.strip(path, (i) => [-sec[i].R.back, -sec[i].R.kerb], 0.15);
    if (d.median > 0) {
      asph.strip(path, (i) => [d.median / 2, sec[i].L.kerb], 0.25);
      asph.strip(path, (i) => [-sec[i].R.kerb, -d.median / 2], 0.25);
      (s.type === 'motorway' ? verge : median).strip(path, () => [-d.median / 2, d.median / 2], 0.27);
    } else asph.strip(path, (i) => [-sec[i].R.kerb, sec[i].L.kerb], 0.25);
    // lines, kept clear of junctions
    const trimA = net.segsAt(s.a).length > 2 ? net.nodeHalf(s.a) + 1 : 0, trimB = net.segsAt(s.b).length > 2 ? net.nodeHalf(s.b) + 1 : 0;
    const secAt = (t: number) => section(s, t);
    if (d.median === 0) {
      // centre line sits midway between the lane edges (it moves over where lanes are narrowed)
      lines.dashes(path, (t) => { const x = secAt(t); return (x.L.lane - x.R.lane) / 2; }, trimA + 1, L - trimB, 3, 3, 0.07, 0.35);
    } else {
      for (const k of [1, -1]) {
        const edge = (t: number) => (k === 1 ? secAt(t).L.lane : secAt(t).R.lane);
        for (let n = 1; n < d.lanes; n++) lines.dashes(path, (t) => k * (d.median / 2 + ((edge(t) - d.median / 2) * n) / d.lanes), trimA + 1, L - trimB, 4, 5, 0.07, 0.35);
        // solid edge lines by the central reservation and the hard shoulder (one long dash each)
        const run = L - trimA - trimB - 2;
        if (run > 1) {
          lines.dashes(path, () => k * (d.median / 2 + 0.25), trimA + 1, L - trimB, run, 1, 0.07, 0.35);
          if (d.shoulder) lines.dashes(path, (t) => k * edge(t), trimA + 1, L - trimB, run, 1, 0.1, 0.35);
        }
      }
      // central barrier, stopping short of junctions
      for (let i = 1; i < path.length; i++) {
        if (A[i - 1] < trimA || A[i] > L - trimB) continue;
        const p = path[i - 1], q = path[i];
        barrier.quad([p.x, (p.y ?? 0) + 0.25, p.z], [q.x, (q.y ?? 0) + 0.25, q.z], [q.x, (q.y ?? 0) + 1.05, q.z], [p.x, (p.y ?? 0) + 1.05, p.z]);
      }
    }
    // bus stops: yellow bay markings, the lay-by's edge line, a shelter
    for (const st of s.stops) {
      const [a, b] = stopSpan(st), k = st.side;
      const kerb = (t: number) => k * (k === 1 ? secAt(t).L.kerb : secAt(t).R.kerb);
      const laneE = (t: number) => k * (k === 1 ? secAt(t).L.lane : secAt(t).R.lane);
      const s0 = st.s - BAY.stand / 2, s1 = st.s + BAY.stand / 2;
      const inner = st.kind === 'layby' ? laneE : (t: number) => kerb(t) - k * 3;
      yellow.dashes(path, (t) => kerb(t) - k * 0.3, s0, s1, 1, 0.01, 0.1, 0.36);
      yellow.dashes(path, inner, s0, s1, 1, 0.01, 0.1, 0.36);
      for (const t of [s0, s1]) { const sp = subPath(path, t - 0.1, t + 0.1); yellow.strip(sp, () => { const x = [inner(t), kerb(t) - k * 0.3].sort((p, q) => p - q); return [x[0], x[1]]; }, 0.36); }
      if (st.kind === 'layby') lines.dashes(path, laneE, a, b, 1, 1, 0.1, 0.35);
      shelter(furn, path, st.s, kerb(st.s) + k * 0.2);
    }
    // avenues get street trees along the pavement
    if (d.trees) for (const k of [1, -1]) for (let t = trimA + 8; t < L - trimB - 4; t += 14) {
      const x = secAt(t), side = k === 1 ? x.L : x.R;
      if (side.bay > 0 || side.back - side.kerb < 3) continue;
      const q = pointAt(path, t), o = k * (side.kerb + 1.4);
      const px = q.x + q.uz * o, pz = q.z - q.ux * o;
      trees.push(new THREE.CylinderGeometry(0.18, 0.25, 3, 5).translate(px, q.y + 1.5, pz), new THREE.IcosahedronGeometry(2.2, 0).translate(px, q.y + 4.4, pz));
    }
  }
  for (const n of net.nodes.values()) {
    const segs = net.segsAt(n.id);
    const kerb = Math.max(ROADS.street.lane, ...segs.map((s) => kerbOf(net.def(s)))), back = net.nodeHalf(n.id);
    (segs.every((s) => net.def(s).pave === 0) ? verge : pave).disc(n, back, 0.15);
    asph.disc(n, kerb, 0.25);
  }
  const add = (f: Flat | Solid, m: THREE.Material) => { if (f.pos.length) roadGroup.add(f.mesh(m)); };
  add(pave, paveMat); add(asph, asphaltMat); add(lines, lineMat); add(verge, vergeMat); add(median, medianMat); add(yellow, yellowMat);
  add(body, concreteMat); add(rails, parapetMat); add(barrier, barrierMat);
  add(furn.glass, shelterGlass); add(furn.frame, shelterFrame); add(furn.red, stopRed);
  if (trees.length) {
    const trunk = mergeGeometries(trees.filter((_, i) => i % 2 === 0).map((g) => g.toNonIndexed())), crown = mergeGeometries(trees.filter((_, i) => i % 2 === 1).map((g) => g.toNonIndexed()));
    for (const [g, m] of [[trunk, trunkMat], [crown, crownMat]] as const) if (g) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; roadGroup.add(mesh); }
    for (const g of trees) g.dispose();
  }
  onRoadsChanged();
}

// ---------------- buildings ----------------
// Each building is generated once, then baked into world space. Settled buildings are merged into
// 120 m chunks (one mesh per material per chunk) so a detailed town stays cheap to draw; only
// buildings rising or being demolished are drawn on their own.
interface Part { m: THREE.Material; g: THREE.BufferGeometry }
interface Built { lot: Lot; born: number; height: number; name: string; detail: string; parts: Part[]; solo: THREE.Group | null; chunk: string | null; dying?: number; region?: Region }
const buildings: Built[] = [];
const cityGroup = new THREE.Group();
scene.add(cityGroup);
const CH = 120;
const chunks = new Map<string, { members: Set<Built>; group: THREE.Group; dirty: boolean }>();

function bakeGroup(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const parts: Part[] = [];
  for (const o of group.children) {
    const mesh = o as THREE.Mesh;
    parts.push({ m: mesh.material as THREE.Material, g: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld) });
    mesh.geometry.dispose();
  }
  return parts;
}
function bake(l: Lot) {
  const b = generate(l);
  return { height: b.height, name: b.name, detail: b.detail, parts: bakeGroup(b.group) };
}
function soloGroup(b: Built) {
  const g = new THREE.Group();
  for (const p of b.parts) { const m = new THREE.Mesh(p.g, p.m); m.castShadow = !(p.m as THREE.MeshLambertMaterial).transparent; m.receiveShadow = true; g.add(m); }
  return g;
}
function toChunk(b: Built) {
  if (b.solo) { cityGroup.remove(b.solo); b.solo = null; }
  const key = `${Math.floor(b.lot.x / CH)},${Math.floor(b.lot.z / CH)}`;
  let c = chunks.get(key);
  if (!c) { c = { members: new Set(), group: new THREE.Group(), dirty: true }; chunks.set(key, c); cityGroup.add(c.group); }
  c.members.add(b); c.dirty = true; b.chunk = key;
}
function fromChunk(b: Built) {
  if (!b.chunk) return;
  const c = chunks.get(b.chunk)!;
  c.members.delete(b); c.dirty = true; b.chunk = null;
}
function rebuildChunk(c: { members: Set<Built>; group: THREE.Group; dirty: boolean }) {
  for (const m of [...c.group.children]) { c.group.remove(m); (m as THREE.Mesh).geometry.dispose(); }
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const b of c.members) for (const p of b.parts) { let l = byMat.get(p.m); if (!l) byMat.set(p.m, (l = [])); l.push(p.g); }
  for (const [m, list] of byMat) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = !(m as THREE.MeshLambertMaterial).transparent;
    mesh.receiveShadow = true;
    c.group.add(mesh);
  }
  c.dirty = false;
}

let queue: Lot[] = [];
let placesDirty = true;
let onRoadsChanged = () => {};
const LEVELS = [['Traffic', 1], ['Busy', 2], ['Quiet', 0.4]] as const;
let level = 0;
function spawnLot(l: Lot, animate = true) {
  net.fitParcel(l);
  net.lots.push(l);
  const b: Built = { lot: l, born: performance.now(), solo: null, chunk: null, ...bake(l) };
  buildings.push(b);
  if (animate) { b.solo = soloGroup(b); b.solo.scale.y = 0.01; cityGroup.add(b.solo); }
  else toChunk(b);
  placesDirty = true;
}
// a plot got trimmed (a road went through its garden): landscape it again
function regenerate(b: Built) {
  fromChunk(b);
  for (const p of b.parts) p.g.dispose();
  Object.assign(b, bake(b.lot));
  if (b.solo) { cityGroup.remove(b.solo); b.solo = null; }
  toChunk(b);
}
function demolish(b: Built) {
  fromChunk(b);
  if (!b.solo) { b.solo = soloGroup(b); cityGroup.add(b.solo); }
  b.dying = performance.now();
  placesDirty = true;
}
const shortName = (b: Built) => b.name.split(' · ')[0];

// ---------------- leftover land ----------------
let infill: Built[] = [];
const infillCells = new Map<string, Built>();
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
let infillDue = true;
// Find the gaps the plots leave and fill them: community buildings where one fits, else parks,
// playgrounds, allotments, car parks, verges. Plots still waiting to be built count as taken.
function refreshInfill() {
  for (const b of infill) { fromChunk(b); for (const p of b.parts) p.g.dispose(); }
  infill = [];
  infillCells.clear();
  const { regions, civics } = findRegions(net, queue);
  for (const l of civics) spawnLot(l, false);
  for (const r of regions) {
    const shape = makeRegion({ cells: r.cells, size: CELL, kind: r.kind, seed: r.seed, roadEdges: r.roadEdges });
    const lot: Lot = { id: -1, x: r.centre.x, z: r.centre.z, rot: 0, w: 0, d: 0, h: 0, kind: 'civic', seg: -1, seed: r.seed, row: 0, front: 0, back: 0, px: 0, pw: 0, arch: r.kind };
    const b: Built = { lot, born: 0, height: shape.height, name: shape.name, detail: shape.detail, parts: bakeGroup(shape.group), solo: null, chunk: null, region: r };
    toChunk(b);
    infill.push(b);
    for (const c of r.cells) infillCells.set(cellKey(c.x, c.z), b);
  }
  refreshTrees();
}

function queuePlots(segs: number[]) {
  for (const id of segs) {
    const plots = net.plotsFor(id, CENTRE);
    // denser, taller near the centre; a few gaps elsewhere
    for (const p of plots) if (Math.hypot(p.x, p.z) < 200 || rand() < 0.75) queue.push(p);
  }
  queue.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
}

// ---------------- starter town ----------------
function seedTown() {
  const road = (a: P, b: P, c?: P, o = DEFAULT_OPTS) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), c, o);
  const as = (type: RoadType, o = DEFAULT_OPTS) => ({ ...o, type });
  road({ x: -230, z: 0 }, { x: 230, z: 0 }, undefined, as('avenue')); // the high street is a tree-lined avenue
  road({ x: 0, z: -200 }, { x: 0, z: 200 });
  road({ x: 0, z: 0 }, { x: 170, z: -98 }); // a 30° diagonal
  road({ x: -200, z: -96 }, { x: 0, z: -96 });
  road({ x: -110, z: -96 }, { x: -170, z: 0 }); // a slanting link
  road({ x: 0, z: 70 }, { x: -80, z: 150 }, { x: 0, z: 150 }); // a crescent
  road({ x: 60, z: 0 }, { x: 60, z: 110 });
  road({ x: 0, z: 110 }, { x: 110, z: 110 });
  road({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 }, as('dual')); // a sweeping dual-carriageway bypass
  const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
  road({ x: -215, z: -150 }, { x: -215, z: 150 }, undefined, over); // a flyover across the main road
  road({ x: 40, z: -190 }, { x: 470, z: -190 }, undefined, over); // a bridge over the lake
  // the industrial estate
  road({ x: 0, z: -200 }, { x: 0, z: -380 });
  road({ x: -190, z: -290 }, { x: 150, z: -290 });
  road({ x: 0, z: -380 }, { x: -170, z: -370 }, { x: -110, z: -420 });
  // a motorway along the south edge, reached from the estate by a dual carriageway
  road({ x: -510, z: -470 }, { x: 510, z: -470 }, undefined, as('motorway'));
  road({ x: 0, z: -380 }, { x: 0, z: -470 }, undefined, as('dual'));
  for (const s of net.segs.values()) queuePlots([s.id]);
  // most of the town exists at the start, the rest grows in front of you
  const now = Math.floor(queue.length * 0.8);
  for (const l of queue.splice(0, now)) if (net.lotFree(l)) spawnLot(l, false);
}

// ---------------- UI ----------------
type Mode = 'look' | 'road' | 'stop';
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
  <div id="sheet" class="glass hidden"></div>
  <div id="dock">
    <div id="hint"></div>
    <div id="bp" class="glass hidden"></div>
    <div id="grade" class="glass hidden">
      <button id="g-h"></button><button id="g-g"></button><button id="g-x"></button>
    </div>
    <div id="rtype" class="glass hidden">${(Object.keys(ROADS) as RoadType[]).map((k) => `<button data-r="${k}"><i>${ROADS[k].icon}</i>${ROADS[k].label}</button>`).join('')}</div>
    <div id="kinds" class="glass hidden">
      <button data-k="straight"><i>📏</i>Straight</button>
      <button data-k="curve"><i>⤵️</i>Curve</button>
      <button data-k="smooth"><i>〰️</i>Smooth</button>
    </div>
    <div id="tools" class="glass">
      <button data-t="look"><i>👆</i>Look</button>
      <button data-t="road"><i>🛣️</i>Road</button>
      <button data-t="stop"><i>🚏</i>Bus stop</button>
      <button data-t="bus"><i>🚌</i>Add bus</button>
      <button data-t="cars"><i>🚦</i><span id="tlvl">Traffic</span></button>
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
  $('#rtype').classList.toggle('hidden', m !== 'road');
  closeSheet();
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
    if (mode === 'stop') t = 'Tap a road, on the side you want the stop · the bus will call there';
    else if (mode !== 'road') t = 'Drag to move · pinch to zoom · twist to turn · two fingers up/down to tilt · tap a building';
    else if (draft) t = 'Drag the white handles to adjust, then Build';
    else if (roadKind === 'straight') t = 'Drag to draw a straight road · snaps to 15° and to other roads';
    else if (roadKind === 'smooth') t = 'Drag from a road: the new road curves smoothly out of it';
    else t = ['Drag along the curve you want · or tap start, bend, end', '2/3 · Tap the bend point: the curve pulls towards it', '3/3 · Tap where the curve ends'][picks.length];
  }
  $('#hint').textContent = t;
}
document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.addEventListener('click', () => {
  const t = b.dataset.t!;
  if (t === 'look' || t === 'road' || t === 'stop') return setMode(t);
  if (t === 'bus') { traffic.addBus(); hint('Bus added. It wanders the roads and calls at every stop on its side.'); }
  if (t === 'cars') {
    level = (level + 1) % LEVELS.length;
    $('#tlvl').textContent = LEVELS[level][0];
    hint(`Traffic: ${LEVELS[level][0].toLowerCase()} · cars come from homes, jobs, shops and works, and follow the clock`);
  }
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
function setType(t: RoadType) {
  opts.type = t;
  opts.grade = Math.min(opts.grade, ROADS[t].maxGrade);
  document.querySelectorAll<HTMLButtonElement>('#rtype button').forEach((b) => b.classList.toggle('on', b.dataset.r === t));
  renderGrade();
  draftChanged();
}
document.querySelectorAll<HTMLButtonElement>('#rtype button').forEach((b) => b.addEventListener('click', () => {
  setType(b.dataset.r as RoadType);
  const d = ROADS[opts.type];
  hint(`${d.label}: ${d.blurb} · ${Math.round(halfOfType(opts.type) * 2)} m wide · £${d.cost}/m`);
}));
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
    for (const b of buildings) if (!net.lots.includes(b.lot) && !b.dying) demolish(b);
    for (const l of net.touched) { const b = buildings.find((x) => x.lot === l); if (b && !b.dying) regenerate(b); }
    draft = null;
    draftChanged();
    rebuildRoads();
    queuePlots(made);
    refreshTrees();
    infillDue = true;
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
    const gh = halfOfType(opts.type);
    f.ribbon(draftCheck.path, gh, 0.6);
    f.disc(draft.a, gh, 0.6);
    f.disc(draft.b, gh, 0.6);
    const m = f.mesh(draftCheck.ok ? ghostMat : badMat);
    m.renderOrder = 5;
    ghost.add(m);
    // the bridge's sides, so its shape reads in 3D
    const sides = new Solid();
    structures(draftCheck.path, sides, null, halfOfType(opts.type));
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
  if (stopPreview) {
    const { seg, t, side } = stopPreview, probe = { id: 0, s: t, side, kind: 'layby' as const, take: { pave: 0, lane: 0, land: 0 } };
    const [a, b] = stopSpan(probe), path = net.path(seg), K = kerbOf(net.def(seg));
    const sp = subPath(path, Math.max(0, a), Math.min(pathLength(path), b));
    const pf = new Flat();
    pf.strip(sp, () => (side === 1 ? [K - 3.2, K + 0.2] : [-K - 0.2, -K + 3.2]), 0.8);
    const m = pf.mesh(ghostMat); m.renderOrder = 5; ghost.add(m);
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
  if (!hit) return null;
  // the building whose footprint (or failing that, plot) the hit is on
  const inside = (b: Built, pad: number, plot: boolean) => {
    const l = b.lot, c = plot ? net.parcelCentre(l) : l, co = Math.cos(l.rot), si = Math.sin(l.rot);
    const dx = hit.point.x - c.x, dz = hit.point.z - c.z;
    const w = plot ? l.pw : l.w, d = plot ? l.d + l.front + l.back : l.d;
    return Math.abs(dx * co + dz * si) < w / 2 + pad && Math.abs(-dx * si + dz * co) < d / 2 + pad;
  };
  const live = buildings.filter((b) => !b.dying);
  return live.find((b) => inside(b, 1.5, false)) ?? live.find((b) => inside(b, 0.2, true)) ?? null;
}
const CIVIC_USE = (a: string) => ({ label: `Community · ${CIVIC[a]?.label ?? a}`, pop: CIVIC[a]?.pop ?? 0, unit: CIVIC[a]?.unit ?? 'jobs' });
function showCard(b: Built | null) {
  const el = $('#card');
  if (!b) { el.classList.add('hidden'); return; }
  const u = b.region ? { label: 'Open space', pop: 0, unit: '' } : b.lot.arch ? CIVIC_USE(b.lot.arch) : USE[b.lot.kind];
  el.innerHTML = `<b>${b.name}</b><div>${b.detail}</div><div class="use">${u.label}${u.pop ? ` · ${u.pop} ${u.unit}` : ''}</div>`;
  el.classList.remove('hidden');
}

// ---------------- bus stops ----------------
let stopPreview: { seg: RSeg; t: number; side: 1 | -1 } | null = null;
function closeSheet() { $('#sheet').classList.add('hidden'); stopPreview = null; drawGhost(); }
function stopAt(p: P) {
  for (const seg of net.segs.values()) for (const stop of seg.stops) {
    const q = closestOnPath(p, net.path(seg));
    const [a, b] = stopSpan(stop);
    if (q.s > a && q.s < b && q.d < net.half(seg) + 2 && net.sideOf(seg, p) === stop.side) return { seg, stop };
  }
  return null;
}
function showStopCard(seg: RSeg, st: Stop) {
  const d = net.def(seg), t = st.take;
  const bits = st.kind === 'kerb' ? ['buses stop in the lane'] : [
    `pavement ${(d.pave - t.pave).toFixed(1)} m (was ${d.pave.toFixed(1)} m)`,
    t.lane ? `lanes ${(d.lane - t.lane / (d.lanes > 1 ? d.lanes : 2)).toFixed(2)} m (was ${d.lane.toFixed(2)} m)` : '',
    t.land ? `${t.land.toFixed(1)} m of front gardens bought` : '',
  ].filter(Boolean);
  const el = $('#card');
  el.innerHTML = `<b>🚏 ${st.kind === 'kerb' ? 'Kerbside stop' : 'Bus lay-by'}</b><div>${d.label} · ${bits.join(' · ')}</div><div class="use">Buses call here for about 7 seconds</div>`;
  el.classList.remove('hidden');
}

// The cross-section at the stop, before and after, with the stop's side on the right.
function crossSvg(d: RoadDef, plan: StopPlan) {
  const W = 320, t = plan.take, lay = plan.kind === 'layby';
  const K = kerbOf(d), total = (K + d.pave + d.verge) * 2 + t.land + 1;
  const sc = W / total;
  const row = (y: number, after: boolean) => {
    const parts: string[] = [];
    let x = 0;
    const seg = (w: number, fill: string, label = '') => {
      if (w <= 0.01) return;
      parts.push(`<rect x="${(x * sc).toFixed(1)}" y="${y}" width="${(w * sc).toFixed(1)}" height="18" fill="${fill}"/>`);
      if (label && w * sc > 20) parts.push(`<text x="${((x + w / 2) * sc).toFixed(1)}" y="${y + 30}" text-anchor="middle">${label}</text>`);
      x += w;
    };
    const laneW = after && lay ? d.lane - t.lane / (d.lanes > 1 ? d.lanes : 2) : d.lane;
    const otherLane = after && lay && d.lanes === 1 ? laneW : d.lane;
    seg(d.pave, '#bdb8ad', d.pave.toFixed(1));
    for (let i = 0; i < d.lanes; i++) seg(otherLane, '#4a4e54', otherLane.toFixed(2));
    seg(d.median, '#9d9a92');
    for (let i = 0; i < d.lanes; i++) seg(laneW, '#4a4e54', laneW.toFixed(2));
    if (after && lay) seg(3, '#6b5f2a', 'bay 3.0');
    if (after && !lay) parts.push(`<rect x="${((x - laneW) * sc).toFixed(1)}" y="${y}" width="${(laneW * sc).toFixed(1)}" height="18" fill="none" stroke="#e8c33a" stroke-width="2"/>`);
    // with a lay-by the pavement keeps its reduced width, pushed back into any land bought
    const pv = after && lay ? d.pave - t.pave : d.pave;
    seg(pv, after && t.land ? '#d9b36a' : '#bdb8ad', after && t.land ? `${pv.toFixed(1)} moved back` : pv.toFixed(1));
    if (!after || !lay) seg(t.land, '#6aa046', t.land ? 'garden' : '');
    return parts.join('');
  };
  return `<svg class="xs" viewBox="0 0 ${W} 96"><text x="0" y="9" class="h">now</text>${row(12, false)}<text x="0" y="57" class="h">with the ${lay ? 'lay-by' : 'stop'}</text>${row(60, true)}</svg>`;
}

function stopTap(p: P) {
  const q = net.nearestSeg(p, 30);
  if (!q) { hint('Tap on a road'); return; }
  const side = net.sideOf(q.seg, p);
  const res = net.planStop(q.seg.id, q.s, side);
  const el = $('#sheet');
  stopPreview = { seg: q.seg, t: q.s, side };
  drawGhost();
  if (res.reason) {
    el.innerHTML = `<div class="row"><b>🚏 Can’t put a stop here</b><button id="sx">Close</button></div><div class="bad">${res.reason}</div>`;
  } else {
    const d = net.def(q.seg);
    el.innerHTML = `<div class="row"><b>🚏 Bus stop on this ${d.label.toLowerCase()}</b><button id="sx">Close</button></div>` +
      res.plans.map((pl, i) => `<div class="plan${pl.ok ? '' : ' no'}"><div class="row"><b>${pl.title}</b><span style="color:var(--gold)">${money(pl.cost)}</span></div>
        ${crossSvg(d, pl)}<ul>${pl.notes.map((n) => `<li>${n}</li>`).join('')}</ul>${pl.blocked ? `<div class="bad">${pl.blocked}</div>` : ''}
        <button class="primary" data-plan="${i}" ${pl.ok ? '' : 'disabled'}>Build ${pl.kind === 'kerb' ? 'kerbside stop' : 'lay-by'}</button></div>`).join('');
  }
  el.classList.remove('hidden');
  $('#sx').addEventListener('click', closeSheet);
  el.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((b) => b.addEventListener('click', () => {
    const pl = res.plans[+b.dataset.plan!];
    net.addStop(q.seg.id, q.s, side, pl);
    for (const l of net.touched) { const bb = buildings.find((x) => x.lot === l); if (bb && !bb.dying) regenerate(bb); }
    closeSheet();
    rebuildRoads();
    hint(`${pl.title} built${pl.take.land ? ` · ${pl.lots.length} front garden${pl.lots.length === 1 ? '' : 's'} trimmed` : ''}`);
  }));
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
    else if (mode === 'stop') stopTap(groundAt(e.clientX, e.clientY));
    else if (mode === 'look') {
      const g = groundAt(e.clientX, e.clientY), st = stopAt(g);
      if (st) showStopCard(st.seg, st.stop);
      else showCard(pickBuilding(e.clientX, e.clientY) ?? infillCells.get(cellKey(g.x, g.z)) ?? null);
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
setMode('look');
setKind('straight');
setType('street');
resize();
refreshInfill();

// ---------------- clock and traffic ----------------
const traffic = new Traffic(net, scene, rng(5));
onRoadsChanged = () => { traffic.invalidate(); placesDirty = true; };
for (let i = 0; i < 4; i++) traffic.addBus();
let clock = 7 * 60; // minutes since midnight: a day passes in six minutes
let places: Places | null = null;
function getPlaces(): Places {
  if (places && !placesDirty) return places;
  placesDirty = false;
  const live = buildings.filter((b) => !b.dying).map((b) => b.lot);
  const home = (l: Lot) => l.kind === 'house' || l.kind === 'terrace' || l.kind === 'flats' || l.kind === 'tower';
  return (places = {
    homes: live.filter(home),
    jobs: live.filter((l) => l.kind === 'office' || l.kind === 'shop' || l.kind === 'industry' || l.kind === 'tower'),
    shops: live.filter((l) => l.kind === 'shop'),
    works: live.filter((l) => l.kind === 'industry'),
    weight: (l) => USE[l.kind].pop,
  });
}
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

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
    if (!b.solo) continue;
    if (b.dying) {
      const k = (now - b.dying) / 700;
      b.solo.scale.y = Math.max(0.01, 1 - k);
      if (k >= 1) { cityGroup.remove(b.solo); for (const p of b.parts) p.g.dispose(); buildings.splice(i, 1); }
    } else {
      b.solo.scale.y = Math.min(1, (now - b.born) / 700);
      if (b.solo.scale.y >= 1) toChunk(b); // settled: merge into its chunk
    }
  }
  if (infillDue && !queue.length && !buildings.some((b) => b.solo)) { infillDue = false; refreshInfill(); }
  // merge at most a couple of changed chunks a frame
  let merged = 0;
  for (const c of chunks.values()) if (c.dirty && merged++ < 2) rebuildChunk(c);
  clock += dt * 4;
  const hour = (clock / 60) % 24;
  traffic.generate(getPlaces(), hour, LEVELS[level][1], now);
  traffic.generate(getPlaces(), hour, LEVELS[level][1], now);
  traffic.update(dt, now);
  const pop = buildings.reduce((s, b) => s + (USE[b.lot.kind].unit === 'jobs' ? 0 : USE[b.lot.kind].pop), 0);
  const rush = rushLabel(hour);
  $('#stats').textContent = `🕗 ${hhmm(clock)}${rush ? ` ${rush}` : ''} · 🚗 ${traffic.live} · 🚌 ${traffic.buses} · pop ${pop.toLocaleString('en-GB')}`;
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { proto: unknown }).proto = { rebuild: () => rebuildRoads(), net, view, buildings, infill: () => infill, refreshInfill: () => refreshInfill(), setMode, setKind, groundAt, toScreen, cam, THREE, pickBuilding, traffic, chunks, setClock: (m: number) => { clock = m; }, growAll: () => { for (const l of queue.splice(0)) if (net.lotFree(l)) spawnLot(l, false); refreshTrees(); } };
