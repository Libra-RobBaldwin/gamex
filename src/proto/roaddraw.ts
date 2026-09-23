// Drawing the road and rail network: cross-sections, markings, junctions, bridges, cuttings
// and tunnels, stops. Everything is batched into a handful of meshes per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BAY, ROADS, bayWeight, kerbOf, pointAt, stopSpan, subPath, pathLength, type Network, type P, type RSeg, type RoadType } from './roads';
import { legsAt, type Junction } from './junction';

export const paveMat = new THREE.MeshLambertMaterial({ color: '#bdb8ad', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
export const asphaltMat = new THREE.MeshLambertMaterial({ color: '#484c52', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
export const lineMat = new THREE.MeshLambertMaterial({ color: '#f1f1f1', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

export class Flat {
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
export const concreteMat = new THREE.MeshLambertMaterial({ color: '#b9b5ac', side: THREE.DoubleSide });
export const parapetMat = new THREE.MeshLambertMaterial({ color: '#dcd8d0', side: THREE.DoubleSide });
export class Solid {
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
export function structures(path: P[], body: Solid, rails: Solid | null, HALF: number) {
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

export const halfOfType = (t: RoadType) => { const d = ROADS[t]; return kerbOf(d) + d.pave + d.verge; };
const lit = (c: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
const over = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n });
export const vergeMat = lit('#6f9a4a', over(1));
const medianMat = lit('#9d9a92', over(1));
const yellowMat = lit('#e8c33a', over(3));
const busMat = lit('#9c4238', over(2.5));
const cycleMat = lit('#3f8a52', over(2.5));
const bayMat = lit('#5a5e64', over(2.5));
const ballastMat = lit('#8f887c', over(1));
const sleeperMat = lit('#5d4c3c', over(2));
const railMat = lit('#8a8e94', over(3));
const rackMat = lit('#3a3c40', over(3));
const islandMat = lit('#7aa653', over(4));
const kerbMat = lit('#c9c4ba', { side: THREE.DoubleSide });
const barrierMat = lit('#a9adb0', { side: THREE.DoubleSide });
const hintMat = lit('#8c877d', over(1));
const cutMat = lit('#6f9446');
const portalMat = new THREE.MeshBasicMaterial({ color: '#0d0f12', side: THREE.DoubleSide });
const poleMat = lit('#2b2e33');
const shelterGlass = lit('#b9d6e2', { transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
const shelterFrame = lit('#2e3136', { side: THREE.DoubleSide });
const stopRed = lit('#c9302c', { side: THREE.DoubleSide });
const carCols = ['#c9302c', '#2f6fb8', '#e8e6e0', '#2b2b2b'].map((c) => lit(c));
// what the ground is told to leave out, so cuttings can be seen into
export const holeMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp, stencilFunc: THREE.AlwaysStencilFunc });
export const LAMP_OFF = new THREE.MeshBasicMaterial({ color: '#1b1d20' });
export const LAMP_ON: Record<string, THREE.Material> = { red: new THREE.MeshBasicMaterial({ color: '#ff3b2f' }), amber: new THREE.MeshBasicMaterial({ color: '#ffb020' }), green: new THREE.MeshBasicMaterial({ color: '#35e06b' }) };
const lampGeo = new THREE.BoxGeometry(0.22, 0.22, 0.06);

// black boards with white chevrons, the kind on a roundabout's central island
const chevronMat = (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = '#111'; x.fillRect(0, 0, 128, 32);
  x.fillStyle = '#f4f4f0';
  for (let i = 0; i < 4; i++) { const o = 14 + i * 30; x.beginPath(); x.moveTo(o, 16); x.lineTo(o + 14, 3); x.lineTo(o + 22, 3); x.lineTo(o + 8, 16); x.lineTo(o + 22, 29); x.lineTo(o + 14, 29); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return lit('#ffffff', { map: t, side: THREE.DoubleSide });
})();
class Boards {
  pos: number[] = []; uv: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[]) {
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }
  mesh(m: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return new THREE.Mesh(g, m);
  }
}

// The cross-section of a road at distance t along it, allowing for bus lay-bys: where one is cut
// in, that side's kerb moves out (into parking, the pavement, and bought land) and its lanes narrow.
export function section(net: Network, s: RSeg, t: number) {
  const d = net.def(s), K = kerbOf(d), gen = d.median / 2 + d.lanes * d.lane;
  const side = () => ({ kerb: K, lane: gen, back: K + d.pave + d.verge, bay: 0, park: d.parking });
  const L = side(), R = side();
  for (const st of s.stops) {
    const w = bayWeight(st, t);
    if (!w) continue;
    const x = st.side === 1 ? L : R;
    x.park -= (st.take.park ?? 0) * w;
    if (st.kind !== 'layby') continue;
    x.kerb += (st.take.pave + st.take.land) * w;
    x.back += st.take.land * w;
    x.lane -= st.take.lane * w;
    x.bay = Math.max(x.bay, w);
  }
  return { d, L, R };
}

// Extra points along a road near its stops, so kerb lines can bend smoothly.
function finePath(net: Network, s: RSeg) {
  const path = net.path(s);
  if (!s.stops.length && net.def(s).parking === 0) return path;
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
  const b0 = at(-2, back), b1 = at(2, back);
  solid.glass.quad([b0[0], y + 0.1, b0[1]], [b1[0], y + 0.1, b1[1]], [b1[0], y + 2.3, b1[1]], [b0[0], y + 2.3, b0[1]]);
  for (const e of [-2, 2]) { const p0 = at(e, back), p1 = at(e, front + sx * 0.4); solid.glass.quad([p0[0], y + 0.1, p0[1]], [p1[0], y + 0.1, p1[1]], [p1[0], y + 2.3, p1[1]], [p0[0], y + 2.3, p0[1]]); }
  solid.frame.box((at(0, (back + front) / 2))[0], (at(0, (back + front) / 2))[1], q.ux, q.uz, 2.15, 0.8, y + 2.3, y + 2.45);
  for (const e of [-2, 2]) { const p = at(e, back); solid.frame.box(p[0], p[1], q.ux, q.uz, 0.05, 0.05, y, y + 2.3); }
  const f = at(3.2, front - sx * 0.2);
  solid.frame.box(f[0], f[1], q.ux, q.uz, 0.05, 0.05, y, y + 3);
  solid.red.box(f[0], f[1], q.ux, q.uz, 0.03, 0.35, y + 2.4, y + 2.95);
}

// lane centres, measured from the centreline on the traffic's own (left) side
export function laneCentre(net: Network, s: RSeg, i: number) {
  const d = net.def(s);
  return d.lanes > 1 ? d.median / 2 + (d.lanes - 1 - i + 0.5) * d.lane : d.median / 2 + d.lane / 2;
}
// how far from a junction's centre its markings (and the ends of lane lines) sit, per leg
export function trimFor(net: Network, junctions: Map<number, Junction>, node: number, s: RSeg) {
  const j = junctions.get(node);
  if (!j) return net.segsAt(node).length > 2 ? net.nodeHalf(node) + 1 : 0;
  if (j.form === 'roundabout') return j.R + (net.def(s).lanes === 1 ? 13 : 2);
  if (j.form === 'mini') return j.R + 1;
  if (j.form === 'priority') return j.major.includes(s.id) ? 0 : (j.reach[s.id] ?? 0) + 0.5;
  if (j.form === 'join' || j.form === 'merge') return 0;
  return (j.reach[s.id] ?? net.nodeHalf(node)) + 0.5;
}

export interface Lamp { mesh: THREE.Mesh; node: number; seg: number; col: 'red' | 'amber' | 'green' }

export function drawRoads(net: Network, group: THREE.Group, junctions: Map<number, Junction>, trunkMat: THREE.Material, crownMat: THREE.Material, editing: number | null = null): Lamp[] {
  for (const c of [...group.children]) { group.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const F = () => new Flat();
  const pave = F(), asph = F(), lines = F(), verge = F(), median = F(), yellow = F(), bus = F(), cyc = F(), bays = F();
  const ballast = F(), sleepers = F(), railsF = F(), rack = F(), holes = F(), hint = F(), island = F(), wires = F();
  const cut = new Solid(), body = new Solid(), rails = new Solid(), barrier = new Solid(), kerbs = new Solid(), portal = new Solid(), poles = new Solid();
  const parked = carCols.map(() => new Solid());
  const furn = { glass: new Solid(), frame: new Solid(), red: new Solid() };
  const boards = new Boards();
  const trees: THREE.BufferGeometry[] = [];
  const lamps: Lamp[] = [];
  const tree = (x: number, y: number, z: number, s = 1) => trees.push(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 3 * s, 5).translate(x, y + 1.5 * s, z), new THREE.IcosahedronGeometry(2.2 * s, 0).translate(x, y + 4.4 * s, z));

  for (const s of net.segs.values()) {
    const d = net.def(s), path = finePath(net, s), A = arcs(path), L = A[A.length - 1];
    const sec = A.map((t) => section(net, s, t));
    const half = net.half(s);
    structures(path, body, rails, half);
    const trimA = trimFor(net, junctions, s.a, s), trimB = trimFor(net, junctions, s.b, s);
    // ---- cuttings and tunnels: open to the sky while shallow, covered once deep ----
    const Y = (i: number) => path[i].y ?? 0;
    const DEEP = -9;
    for (let i = 1; i < path.length; i++) {
      const y0 = Y(i - 1), y1 = Y(i);
      if (y0 > -0.3 && y1 > -0.3) continue;
      const piece = [path[i - 1], path[i]];
      const flat = piece.map((p) => ({ ...p, y: 0 }));
      const open0 = y0 > DEEP, open1 = y1 > DEEP;
      if (open0 || open1) {
        // grassed slopes (about 35°) up to the surface, so the cutting opens out as it deepens
        const top = (y: number) => half + 0.7 * Math.min(-Math.max(y, DEEP), -DEEP);
        holes.strip(flat, (k) => [-top(k ? y1 : y0), top(k ? y1 : y0)], 0.02);
        // retaining walls down each side
        const nl = { x: (piece[1].z - piece[0].z) / (A[i] - A[i - 1] || 1), z: -(piece[1].x - piece[0].x) / (A[i] - A[i - 1] || 1) };
        // (single-sided, facing in: looking down into the cutting you see the far wall, not the back of the near one)
        for (const k of [1, -1]) {
          const p0 = [piece[0].x + nl.x * half * k, piece[0].z + nl.z * half * k], p1 = [piece[1].x + nl.x * half * k, piece[1].z + nl.z * half * k];
          const t0 = [piece[0].x + nl.x * top(y0) * k, piece[0].z + nl.z * top(y0) * k], t1 = [piece[1].x + nl.x * top(y1) * k, piece[1].z + nl.z * top(y1) * k];
          const q = [[p0[0], Math.max(y0, DEEP), p0[1]], [p1[0], Math.max(y1, DEEP), p1[1]], [t1[0], 0.02, t1[1]], [t0[0], 0.02, t0[1]]];
          if (k === 1) cut.quad(q[0], q[1], q[2], q[3]); else cut.quad(q[1], q[0], q[3], q[2]);
        }
        // a tunnel mouth where the cutting goes underground
        if (open0 !== open1) {
          const p = open0 ? piece[1] : piece[0], yy = open0 ? y1 : y0, tw = top(yy);
          const a = [p.x + nl.x * tw, p.z + nl.z * tw], b = [p.x - nl.x * tw, p.z - nl.z * tw];
          body.quad([a[0], Math.max(yy, DEEP) + 6.5, a[1]], [b[0], Math.max(yy, DEEP) + 6.5, b[1]], [b[0], 0.3, b[1]], [a[0], 0.3, a[1]]);
          const K = kerbOf(d);
          const c = [p.x + nl.x * K, p.z + nl.z * K], e = [p.x - nl.x * K, p.z - nl.z * K];
          const back = open0 ? 0.6 : -0.6, dx = (piece[1].x - piece[0].x) / (A[i] - A[i - 1] || 1) * back, dz = (piece[1].z - piece[0].z) / (A[i] - A[i - 1] || 1) * back;
          portal.quad([c[0] + dx, yy, c[1] + dz], [e[0] + dx, yy, e[1] + dz], [e[0] + dx, yy + 6.3, e[1] + dz], [c[0] + dx, yy + 6.3, c[1] + dz]);
        }
      } else hint.dashes(flat, () => 0, 0, A[i] - A[i - 1], 2, 2, 0.35, 0.05); // a covered tunnel: its line on the surface
    }
    if (d.cls === 'rail') {
      // ---- railway: ballast, sleepers, rails, a rack, overhead wires ----
      verge.strip(path, () => [kerbOf(d), half], 0.12);
      verge.strip(path, () => [-half, -kerbOf(d)], 0.12);
      ballast.strip(path, () => [-kerbOf(d), kerbOf(d)], 0.2);
      const tracks = d.tracks === 2 ? [-2, 2] : [0];
      for (const c of tracks) {
        sleepers.dashes(path, () => c, 0.2, L - 0.2, 0.26, 0.42, 1.3, 0.3);
        for (const r of [-0.72, 0.72]) railsF.strip(path, () => [c + r - 0.05, c + r + 0.05], 0.44);
        if (d.rack) rack.strip(path, () => [c - 0.07, c + 0.07], 0.46);
        if (d.electric) wires.strip(path, () => [c - 0.03, c + 0.03], 5.8);
      }
      if (d.electric) for (let t = 20; t < L - 5; t += 55) {
        const q = pointAt(path, t), o = kerbOf(d) + 0.6;
        const px = q.x - q.uz * o, pz = q.z + q.ux * o;
        poles.box(px, pz, q.ux, q.uz, 0.15, 0.15, q.y, q.y + 6.6);
        const mx = q.x - q.uz * (o / 2 - 0.3), mz = q.z + q.ux * (o / 2 - 0.3);
        poles.box(mx, mz, q.ux, q.uz, 0.06, o / 2 + 0.3, q.y + 6.1, q.y + 6.25);
      }
      continue;
    }
    // ---- road: pavements or verges, then the carriageway ----
    const surface = d.pave > 0 ? pave : verge;
    surface.strip(path, (i) => [sec[i].L.kerb, sec[i].L.back], 0.15);
    surface.strip(path, (i) => [-sec[i].R.back, -sec[i].R.kerb], 0.15);
    if (d.median > 0) {
      asph.strip(path, (i) => [d.median / 2, sec[i].L.kerb], 0.25);
      asph.strip(path, (i) => [-sec[i].R.kerb, -d.median / 2], 0.25);
      const mk = d.medianKind;
      // the reservation stops where the junction starts
      if (L - trimA - trimB > 2) (mk === 'grass' || mk === 'trees' ? verge : mk === 'hatch' ? asph : median).strip(subPath(path, trimA, L - trimB), () => [-d.median / 2, d.median / 2], 0.27);
      if (mk === 'hatch') {
        for (const k of [1, -1]) lines.strip(path, () => [k * d.median / 2 - 0.07, k * d.median / 2 + 0.07], 0.35);
        lines.dashes(path, () => 0, trimA + 2, L - trimB - 2, 0.5, 2.5, d.median / 2 - 0.1, 0.35); // chevron-ish hatching
      }
      if (mk === 'trees') for (let t = trimA + 10; t < L - trimB - 6; t += 16) { const q = pointAt(path, t); tree(q.x, q.y, q.z, 0.9); }
    } else asph.strip(path, (i) => [-sec[i].R.kerb, sec[i].L.kerb], 0.25);
    const secAt = (t: number) => section(net, s, t);
    // kerbside lanes: bus lanes (red), cycle lanes (green), parking bays with parked cars
    for (const k of [1, -1] as const) {
      const S = (i: number) => (k === 1 ? sec[i].L : sec[i].R);
      const gen = d.median / 2 + d.lanes * d.lane;
      const span = (a: number, b: number) => (k === 1 ? [a, b] : [-b, -a]) as [number, number];
      if (d.bus) { bus.strip(path, (i) => span(S(i).lane, S(i).lane + d.bus), 0.26); lines.dashes(path, (t) => k * (k === 1 ? secAt(t).L.lane : secAt(t).R.lane), trimA + 1, L - trimB, Math.max(1, L - trimA - trimB - 2), 1, 0.12, 0.35); }
      if (d.cycle) {
        const c0 = gen + d.bus;
        cyc.strip(path, () => span(c0, c0 + d.cycle), 0.26);
        lines.dashes(path, () => k * (c0 + 0.1), trimA + 1, L - trimB, Math.max(1, L - trimA - trimB - 2), 1, 0.08, 0.35);
      }
      if (d.parking) {
        const p0 = gen + d.bus + d.cycle;
        bays.strip(path, (i) => span(p0 + d.parking - Math.max(0, S(i).park), p0 + d.parking), 0.26);
        let n = 0;
        for (let t = trimA + 4; t < L - trimB - 5; t += 6) {
          const x = secAt(t + 3), side = k === 1 ? x.L : x.R;
          if (side.park < d.parking - 0.1) continue; // painted out by a stop
          lines.dashes(path, () => k * (p0 + d.parking / 2), t, t + 0.12, 0.12, 1, d.parking / 2, 0.35);
          if ((Math.sin(s.id * 7 + t * 13.7) + 1) / 2 < 0.65) {
            const q = pointAt(path, t + 3), o = k * (p0 + d.parking / 2);
            parked[(n++ + s.id) % parked.length].box(q.x + q.uz * o, q.z - q.ux * o, q.ux, q.uz, 2.1, 0.88, q.y + 0.3, q.y + 1.35);
          }
        }
      }
    }
    // lines, kept clear of junctions
    if (d.median === 0) {
      // centre line sits midway between the lane edges (it moves over where lanes are narrowed)
      lines.dashes(path, (t) => { const x = secAt(t); return (x.L.lane - x.R.lane) / 2; }, trimA + 1, L - trimB, 3, 3, 0.07, 0.35);
    } else {
      for (const k of [1, -1]) {
        const edge = (t: number) => (k === 1 ? secAt(t).L.lane : secAt(t).R.lane);
        for (let n = 1; n < d.lanes; n++) lines.dashes(path, (t) => k * (d.median / 2 + ((edge(t) - d.median / 2) * n) / d.lanes), trimA + 1, L - trimB, 4, 5, 0.07, 0.35);
        const run = L - trimA - trimB - 2;
        if (run > 1) {
          lines.dashes(path, () => k * (d.median / 2 + 0.25), trimA + 1, L - trimB, run, 1, 0.07, 0.35);
          if (d.shoulder) lines.dashes(path, (t) => k * edge(t), trimA + 1, L - trimB, run, 1, 0.1, 0.35);
        }
      }
      if (d.medianKind === 'barrier' || d.family === 'Motorway') for (let i = 1; i < path.length; i++) {
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
    // street trees along wide pavements, clear of junctions and stops
    if (d.pave >= 5) for (const k of [1, -1]) for (let t = trimA + 8; t < L - trimB - 4; t += 14) {
      if (s.stops.some((st) => { const [a, b] = stopSpan(st); return st.side === k && t > a - 6 && t < b + 6; })) continue;
      const x = secAt(t), side = k === 1 ? x.L : x.R;
      if (side.back - side.kerb < 3) continue;
      const q = pointAt(path, t), o = k * (side.kerb + 1.4);
      tree(q.x + q.uz * o, q.y, q.z - q.ux * o);
    }
  }

  // ---- junctions ----
  for (const n of net.nodes.values()) {
    const segs = net.segsAt(n.id);
    if (!segs.length) continue;
    if (net.def(segs[0]).cls === 'rail') { ballast.disc(n, Math.max(...segs.map((s) => kerbOf(net.def(s)))), 0.2); continue; }
    const j = junctions.get(n.id);
    const kerb = Math.max(ROADS.street.lane, ...segs.map((s) => kerbOf(net.def(s)))), back = net.nodeHalf(n.id);
    const ring = j && (j.form === 'roundabout' || j.form === 'mini');
    (segs.every((s) => net.def(s).pave === 0) ? verge : pave).disc(n, ring && j ? Math.max(back, j.R + 3) : back, 0.15, 32);
    asph.disc(n, ring && j ? Math.max(kerb, j.R) : kerb, 0.25, 32);
    if (!j || j.form === 'join' || j.form === 'merge') continue;
    const legs = legsAt(net, n.id);
    const y = n.y;
    // a frame on each leg: `a` metres out along it, `b` across (positive on the side traffic arrives)
    for (const leg of legs) {
      const W = (a: number, b: number) => [n.x + leg.dir.x * a - leg.dir.z * b, n.z + leg.dir.z * a + leg.dir.x * b] as const;
      const rect = (f: Flat, a0: number, a1: number, b0: number, b1: number, yy: number) => { const p = [W(a0, b0), W(a1, b0), W(a1, b1), W(a0, b1)]; f.tri(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], y + yy); f.tri(p[0][0], p[0][1], p[2][0], p[2][1], p[3][0], p[3][1], y + yy); };
      const triW = (f: Flat, pts: [number, number][], yy: number) => { const q = pts.map(([a, b]) => W(a, b)); f.tri(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], y + yy); };
      const d = net.def(leg.seg), kIn = kerbOf(d), reach = j.reach[leg.seg.id] ?? 0;
      const lineAt = j.form === 'roundabout' || j.form === 'mini' ? j.R + 0.3 : reach;
      const approaches = !(j.form === 'priority' && j.major.includes(leg.seg.id));
      // give-way lines (double broken) or a solid stop line across the incoming half
      if (j.form === 'signals') rect(lines, lineAt, lineAt + 0.3, d.median / 2 + 0.2, kIn - 0.1, 0.36);
      else if (approaches) for (const off of [0, 0.6]) for (let b = d.median / 2 + 0.3; b < kIn - 0.2; b += 0.9) rect(lines, lineAt + off, lineAt + off + 0.3, b, Math.min(kIn - 0.2, b + 0.6), 0.36);
      // the give-way triangle, pointing at the line
      if (approaches && j.form !== 'signals') for (let i = 0; i < d.lanes; i++) {
        const c = laneCentre(net, leg.seg, i);
        triW(lines, [[lineAt + 5, c - 0.7], [lineAt + 5, c + 0.7], [lineAt + 3, c]], 0.36);
        triW(asph, [[lineAt + 4.85, c - 0.45], [lineAt + 4.85, c + 0.45], [lineAt + 3.45, c]], 0.37);
      }
      // lane arrows, a pair per approach lane
      const lanes = j.lanes[leg.seg.id] ?? [];
      // arrows only where lanes actually divide the traffic (not on a plain single-lane approach)
      const arrows = lanes.length > 1 || j.form === 'signals' || n.id === editing;
      if (arrows) lanes.forEach((mv, i) => {
        const c = laneCentre(net, leg.seg, i);
        for (const at of [lineAt + 9, lineAt + 26]) {
          if (at > leg.len - 8) continue;
          // shaft towards the junction (smaller `a`), then a head for each movement
          rect(lines, at - 3.2, at, c - 0.12, c + 0.12, 0.36);
          for (const m of mv) {
            if (m === 'S') triW(lines, [[at - 3.2, c - 0.45], [at - 3.2, c + 0.45], [at - 4.6, c]], 0.36);
            else {
              const sd = m === 'L' ? 1 : -1; // left of arriving traffic is +b
              const p0: [number, number] = [at - 2.6, c], p1: [number, number] = [at - 3.6, c + sd * 0.9];
              const qx = [W(p0[0], p0[1] - 0.12), W(p0[0], p0[1] + 0.12), W(p1[0], p1[1] + 0.12), W(p1[0], p1[1] - 0.12)];
              lines.tri(qx[0][0], qx[0][1], qx[1][0], qx[1][1], qx[2][0], qx[2][1], y + 0.36);
              lines.tri(qx[0][0], qx[0][1], qx[2][0], qx[2][1], qx[3][0], qx[3][1], y + 0.36);
              triW(lines, [[at - 3.2, c + sd * 1.25], [at - 4.2, c + sd * 0.5], [at - 4.2, c + sd * 1.6]], 0.36);
            }
          }
        }
      });
      if (j.form === 'roundabout' && d.lanes === 1) {
        // a splitter island between the ways in and out, with a keep-left bollard
        const tri = [W(j.R + 0.8, -1.1), W(j.R + 0.8, 1.1), W(j.R + 12, 0)];
        island.tri(tri[0][0], tri[0][1], tri[1][0], tri[1][1], tri[2][0], tri[2][1], y + 0.42);
        for (let k = 0; k < 3; k++) { const p = tri[k], q = tri[(k + 1) % 3]; kerbs.quad([p[0], y + 0.25, p[1]], [q[0], y + 0.25, q[1]], [q[0], y + 0.42, q[1]], [p[0], y + 0.42, p[1]]); }
        const b0 = W(j.R + 1.6, 0);
        kerbs.box(b0[0], b0[1], leg.dir.x, leg.dir.z, 0.18, 0.18, y + 0.4, y + 1.3);
      }
      if (j.form === 'roundabout') {
        // chevron boards on the island, facing traffic coming in
        const Ri = j.R - (legs.some((l) => l.lanes > 1) ? 9 : 6.5);
        const p = W(Ri + 0.2, 1.6), q = W(Ri + 0.2, -1.6);
        boards.quad([p[0], y + 0.6, p[1]], [q[0], y + 0.6, q[1]], [q[0], y + 1.3, q[1]], [p[0], y + 1.3, p[1]]);
      }
      if (j.form === 'signals') {
        // a signal on the nearside of each approach: black head, red / amber / green lamps
        const p = W(lineAt + 0.8, kIn + 0.7);
        poles.box(p[0], p[1], leg.dir.x, leg.dir.z, 0.08, 0.08, y, y + 3.5);
        poles.box(p[0], p[1], leg.dir.x, leg.dir.z, 0.2, 0.2, y + 2.3, y + 3.4);
        (['red', 'amber', 'green'] as const).forEach((col, i) => {
          const m = new THREE.Mesh(lampGeo, LAMP_OFF);
          const f = W(lineAt + 1.02, kIn + 0.7);
          m.position.set(f[0], y + 3.15 - i * 0.33, f[1]);
          m.rotation.y = -Math.atan2(leg.dir.z, leg.dir.x) + Math.PI / 2;
          group.add(m);
          lamps.push({ mesh: m, node: n.id, seg: leg.seg.id, col });
        });
      }
      // dotted guide lines through the junction for turning traffic
      if (j.form === 'signals' || j.form === 'priority') lanes.forEach((mv, i) => {
        for (const m of mv) {
          if (m === 'S' && j.form === 'priority') continue;
          if (j.form === 'priority' && j.major.includes(leg.seg.id) && m !== 'R') continue;
          const to = legs.find((o) => o !== leg && (m === 'L' ? turnSign(leg, o) < -0.55 : m === 'R' ? turnSign(leg, o) > 0.55 : Math.abs(turnSign(leg, o)) <= 0.55));
          if (!to) continue;
          if (j.slip && j.slip.from === leg.seg.id && j.slip.to === to.seg.id) continue;
          const c = laneCentre(net, leg.seg, i);
          const ex = m === 'L' ? 0 : m === 'R' ? net.def(to.seg).lanes - 1 : Math.min(i, net.def(to.seg).lanes - 1);
          const co = laneCentre(net, to.seg, ex);
          const r0 = Math.max(lineAt, 1), r1 = Math.max(j.reach[to.seg.id] ?? 0, kIn + 1);
          const A0 = W(r0, c);
          const B0 = [n.x + to.dir.x * r1 + to.dir.z * co, n.z + to.dir.z * r1 - to.dir.x * co];
          const k = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]) * 0.45;
          const c1 = [A0[0] - leg.dir.x * k, A0[1] - leg.dir.z * k], c2 = [B0[0] - to.dir.x * k, B0[1] - to.dir.z * k];
          const pts: P[] = [];
          for (let t = 0; t <= 1.0001; t += 1 / 12) { const u = 1 - t; pts.push({ x: u * u * u * A0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * B0[0], z: u * u * u * A0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * B0[1], y }); }
          lines.dashes(pts, () => 0, 0.5, pathLength(pts) - 0.5, 0.8, 1, 0.07, 0.36);
        }
      });
    }
    if (j.form === 'roundabout') {
      // central island: kerbed, grassed, a little planting
      const Ri = j.R - (legs.some((l) => l.lanes > 1) ? 9 : 6.5);
      island.disc(n, Ri, 0.45, 28);
      for (let k = 0; k < 28; k++) {
        const a0 = (k / 28) * Math.PI * 2, a1 = ((k + 1) / 28) * Math.PI * 2;
        const p = [n.x + Math.cos(a0) * Ri, n.z + Math.sin(a0) * Ri], q = [n.x + Math.cos(a1) * Ri, n.z + Math.sin(a1) * Ri];
        kerbs.quad([p[0], y + 0.25, p[1]], [q[0], y + 0.25, q[1]], [q[0], y + 0.45, q[1]], [p[0], y + 0.45, p[1]]);
      }
      if (Ri > 5) for (let k = 0; k < 3; k++) { const a = k * 2.1; tree(n.x + Math.cos(a) * Ri * 0.4, y + 0.45, n.z + Math.sin(a) * Ri * 0.4, 0.8); }
      if (legs.some((l) => l.lanes > 1)) {
        const ringPts: P[] = [];
        const rr = (Ri + j.R) / 2;
        for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; ringPts.push({ x: n.x + Math.cos(a) * rr, z: n.z + Math.sin(a) * rr, y }); }
        lines.dashes(ringPts, () => 0, 0, pathLength(ringPts), 2, 2, 0.07, 0.35);
      }
    }
    if (j.form === 'mini') {
      // a mini-roundabout: a white domed disc you can drive over
      lines.disc(n, 2, 0.34, 20);
      asph.disc(n, 1.6, 0.35, 20);
      lines.disc(n, 1.2, 0.36, 20);
    }
    if (j.slip) {
      // the slip road, its island, and the give-way at the end
      const sp = j.slip.path.map((p) => ({ ...p, y }));
      asph.strip(sp, () => [-2.4, 2.4], 0.26);
      for (const o of [-2.2, 2.2]) lines.strip(sp, () => [o - 0.07, o + 0.07], 0.37);
      const isl = j.slip.island;
      island.tri(isl[0].x, isl[0].z, isl[1].x, isl[1].z, isl[2].x, isl[2].z, y + 0.42);
      for (let k = 0; k < 3; k++) { const p = isl[k], q = isl[(k + 1) % 3]; kerbs.quad([p.x, y + 0.25, p.z], [q.x, y + 0.25, q.z], [q.x, y + 0.42, q.z], [p.x, y + 0.42, p.z]); }
      const e = pointAt(sp, pathLength(sp) - 2);
      for (const off of [0, 0.6]) for (let b = -2; b < 2; b += 0.9) {
        const p0 = [e.x - e.ux * off + e.uz * b, e.z - e.uz * off - e.ux * b], p1 = [e.x - e.ux * (off + 0.3) + e.uz * b, e.z - e.uz * (off + 0.3) - e.ux * b];
        const p2 = [p1[0] + e.uz * 0.6, p1[1] - e.ux * 0.6], p3 = [p0[0] + e.uz * 0.6, p0[1] - e.ux * 0.6];
        lines.tri(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], y + 0.37);
        lines.tri(p0[0], p0[1], p2[0], p2[1], p3[0], p3[1], y + 0.37);
      }
    }
  }

  const add = (f: Flat | Solid, m: THREE.Material, order = 0) => { if (f.pos.length) { const mesh = f.mesh(m); mesh.renderOrder = order; group.add(mesh); return mesh; } return null; };
  add(pave, paveMat); add(asph, asphaltMat); add(lines, lineMat); add(verge, vergeMat); add(median, medianMat); add(yellow, yellowMat);
  add(bus, busMat); add(cyc, cycleMat); add(bays, bayMat); add(hint, hintMat);
  add(ballast, ballastMat); add(sleepers, sleeperMat); add(railsF, railMat); add(rack, rackMat); add(wires, poleMat);
  add(island, islandMat); add(kerbs, kerbMat); add(poles, poleMat); add(portal, portalMat);
  parked.forEach((p, i) => add(p, carCols[i]));
  add(cut, cutMat); add(body, concreteMat); add(rails, parapetMat); add(barrier, barrierMat);
  add(furn.glass, shelterGlass); add(furn.frame, shelterFrame); add(furn.red, stopRed);
  const hm = add(holes, holeMat, -10);
  if (hm) { hm.receiveShadow = false; hm.castShadow = false; }
  if (boards.pos.length) group.add(boards.mesh(chevronMat));
  if (trees.length) {
    const trunk = mergeGeometries(trees.filter((_, i) => i % 2 === 0).map((g) => g.toNonIndexed())), crown = mergeGeometries(trees.filter((_, i) => i % 2 === 1).map((g) => g.toNonIndexed()));
    for (const [g, m] of [[trunk, trunkMat], [crown, crownMat]] as const) if (g) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; group.add(mesh); }
    for (const g of trees) g.dispose();
  }
  return lamps;
}
// signed turn between legs (negative = left), like junction.turnOf but local
function turnSign(a: { dir: P }, b: { dir: P }) {
  const ux = -a.dir.x, uz = -a.dir.z;
  return Math.atan2(ux * b.dir.z - uz * b.dir.x, ux * b.dir.x + uz * b.dir.z);
}
