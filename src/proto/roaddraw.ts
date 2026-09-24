// Drawing the road and rail network: cross-sections, markings, junctions, bridges, cuttings
// and tunnels, stops. Everything is batched into a handful of meshes per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BAY, ROADS, bayWeight, closestOnPath, kerbOf, pointAt, stopSpan, subPath, pathLength, type Network, type P, type RSeg, type RoadType } from './roads';
import { legsAt, type Junction } from './junction';
import { STD } from './standards';
import { PEDX, pedCrossingsOn, type PedX } from './pedx';
import { GHOST_PAIR, crossingAt, legAt, legDir, legFrameOf, ringA, type ShapeLeg } from './jshape';
import { TAPER, courseOf, normals, type Course, type Section2 } from './xsection';
import type { XZ } from './land';
import { laneBase, type RoadDef } from './catalog';

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
  // a strip between two sideways offsets (left of the path's direction is positive), which may vary;
  // `ends` fixes the direction at either end (where it meets another road's strip round a join)
  strip(path: P[], off: (i: number) => [number, number], y: number, ends: [XZ | null, XZ | null] = [null, null]) {
    const n = path.length;
    const nl = normals(path, ends);
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
  // a filled polygon (convex or not)
  poly(pts: P[], y: number) {
    const clean: THREE.Vector2[] = [];
    for (const p of pts) { const l = clean[clean.length - 1]; if (!l || Math.hypot(l.x - p.x, l.y - p.z) > 0.05) clean.push(new THREE.Vector2(p.x, p.z)); }
    if (clean.length > 2 && clean[0].distanceTo(clean[clean.length - 1]) < 0.05) clean.pop();
    if (clean.length < 3) return;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(clean, [])) this.tri(clean[i].x, clean[i].y, clean[j].x, clean[j].y, clean[k].x, clean[k].y, y);
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
// `bridged`: stretches (by distance along the path) the bridges library draws instead
// (game/bridges.ts). With it, the ramps either side get retaining walls down to the ground and no piers.
export function structures(path: P[], body: Solid, rails: Solid | null, HALF: number, bridged?: [number, number][]) {
  if (!path.some((p) => (p.y ?? 0) > 0.05)) return;
  // cut the path exactly where each bridge starts and ends, so the walls meet its abutments
  if (bridged?.length) {
    const A = arcs(path), cuts = bridged.flat().filter((t) => t > 0.05 && t < A[A.length - 1] - 0.05);
    path = [...path.map((p, i) => ({ p, t: A[i] })), ...cuts.map((t) => { const q = pointAt(path, t); return { p: { x: q.x, z: q.z, y: q.y }, t }; })].sort((a, b) => a.t - b.t).map((x) => x.p);
  }
  const n = path.length;
  const at = bridged ? arcs(path) : [];
  const inBridge = (i: number) => !!bridged?.some(([a, b]) => (at[i - 1] + at[i]) / 2 > a && (at[i - 1] + at[i]) / 2 < b);
  const side = path.map((_, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / L, z: (b.x - a.x) / L };
  });
  const Y = (i: number) => path[i].y ?? 0;
  for (let i = 1; i < n; i++) {
    if (Y(i - 1) < 0.05 && Y(i) < 0.05) continue;
    if (inBridge(i)) continue;
    const p = path[i - 1], q = path[i], s0 = side[i - 1], s1 = side[i];
    const t0 = Y(i - 1) + 0.15, t1 = Y(i) + 0.15, b0 = bridged ? 0 : Math.max(0, Y(i - 1) - DECK), b1 = bridged ? 0 : Math.max(0, Y(i) - DECK);
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
  if (!rails || bridged) return;
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
// tactile paving at a crossing's dropped kerbs: blister paving, buff (uncontrolled) or red (at signals)
const tactileBuffMat = lit('#c9a56a', over(1.5)), tactileRedMat = lit('#b0503e', over(1.5));
const cutMat = lit('#6f9446');
// the grass the roads draw themselves: verges, roundabout islands, cutting slopes (the game gives
// them the ground's own look, so they match the fields and lawns round them)
export const GRASS_MATS: THREE.MeshLambertMaterial[] = [vergeMat, islandMat, cutMat];
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
// a Belisha beacon's pole (black and white bands) and its amber globe, at a zebra crossing
const beaconWhite = lit('#f2f2ee'), beaconGlobe = new THREE.MeshBasicMaterial({ color: '#ffa726' });
// which surface each material is, for checking the drawing from above (drawcheck.ts)
export const SURFACES = { pave: [paveMat], asph: [asphaltMat], lines: [lineMat, yellowMat], verge: [vergeMat], island: [islandMat], median: [medianMat], paint: [busMat, cycleMat, bayMat] };

// black boards with white chevrons, the kind on a roundabout's central island (made when first
// needed, since it paints a canvas)
let chevrons: THREE.Material | null = null;
const chevronMat = () => (chevrons ??= (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const x = c.getContext('2d')!;
  x.fillStyle = '#111'; x.fillRect(0, 0, 128, 32);
  x.fillStyle = '#f4f4f0';
  for (let i = 0; i < 4; i++) { const o = 14 + i * 30; x.beginPath(); x.moveTo(o, 16); x.lineTo(o + 14, 3); x.lineTo(o + 22, 3); x.lineTo(o + 8, 16); x.lineTo(o + 22, 29); x.lineTo(o + 14, 29); x.closePath(); x.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return lit('#ffffff', { map: t, side: THREE.DoubleSide });
})());
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

// The cross-section of a road at distance r along its course (see xsection.courseOf): through a
// taper it follows sectionAt, round a join it blends into the next road, and where a bus lay-by is
// cut in, that side's kerb moves out (into parking, the pavement, and bought land) and its lanes narrow.
export interface Side { kerb: number; lane: number; back: number; bay: number; park: number }
export function section(net: Network, s: RSeg, C: Course, r: number) {
  const d = net.def(s), x = C.sec(r), t = C.tau(r), gen = x.median + x.lanes * x.lane;
  const side = (): Side => ({ kerb: x.kerb, lane: gen, back: x.back, bay: 0, park: d.parking });
  const L = side(), R = side();
  for (const st of s.stops) {
    const w = bayWeight(st, t);
    if (!w) continue;
    const q = st.side === 1 ? L : R;
    q.park -= (st.take.park ?? 0) * w;
    if (st.kind !== 'layby') continue;
    q.kerb += (st.take.pave + st.take.land) * w;
    q.back += st.take.land * w;
    q.lane -= st.take.lane * w;
    q.bay = Math.max(q.bay, w);
  }
  return { d, x, L, R };
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

// Dashes along a line at a (varying) sideways offset, between r0 and r1 along the path. Where the line
// runs on into the next road round a join, the pattern is fitted to finish half a gap short of the
// join (`a0`, `a1`), so the next road's dashes carry on at the same rhythm with no seam.
export function dashRun(f: Flat, path: P[], off: (r: number) => number, r0: number, r1: number, len: number, gap: number, w: number, y: number, a0 = false, a1 = false) {
  const run = r1 - r0;
  if (run < 0.3) return;
  const dash = (a: number, b: number) => {
    const sp = subPath(path, Math.max(r0, a), Math.min(r1, b)), ar = arcs(sp);
    if (ar[ar.length - 1] > 0.05) f.strip(sp, (i) => { const o = off(a + ar[i]); return [o - w, o + w]; }, y);
  };
  if (a0 && a1) {
    const n = Math.max(1, Math.round(run / (len + gap))), g = Math.max(0.2, run / n - len), l = run / n - g;
    for (let k = 0; k < n; k++) dash(r0 + g / 2 + k * (l + g), r0 + g / 2 + k * (l + g) + l);
  } else if (a1) for (let e = r1 - gap / 2; e > r0 + 0.3; e -= len + gap) dash(e - len, e);
  else for (let t = r0 + (a0 ? gap / 2 : 0); t < r1 - 0.3; t += len + gap) dash(t, Math.min(r1, t + len));
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
  // a bench along the back, where the first people to arrive sit (game/crowdsites.ts)
  const bn = at(0, back - sx * 0.3);
  solid.frame.box(bn[0], bn[1], q.ux, q.uz, 1.5, 0.17, y + 0.53, y + 0.61); // (seat height above the pavement, which is 0.15 up)
  // the flag stands ahead of the shelter in the direction the buses come (on the right-hand side
  // of the road that's back along it), where the front door stops
  const f = at(3.2 * sx, front - sx * 0.2);
  solid.frame.box(f[0], f[1], q.ux, q.uz, 0.05, 0.05, y, y + 3);
  solid.red.box(f[0], f[1], q.ux, q.uz, 0.03, 0.35, y + 2.4, y + 2.95);
}

// whether a point is inside a polygon (even-odd)
function inPoly(p: XZ, q: XZ[]) {
  let inside = false;
  for (let i = 0, k = q.length - 1; i < q.length; k = i++) {
    const a = q[i], b = q[k];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
// lane centres, measured from the centreline on the traffic's own (left) side
export function laneCentre(net: Network, s: RSeg, i: number) {
  const d = net.def(s);
  return d.lanes > 1 ? laneBase(d) + (d.lanes - 1 - i + 0.5) * d.lane : laneBase(d) + d.lane / 2;
}
// the parts of [a, b] outside every gap
function outside(a: number, b: number, gaps: [number, number][]) {
  let out: [number, number][] = [[a, b]];
  for (const [g0, g1] of gaps) out = out.flatMap(([x, y]) => (g1 <= x || g0 >= y ? [[x, y]] : [...(g0 > x ? [[x, g0]] : []), ...(g1 < y ? [[g1, y]] : [])]) as [number, number][]);
  return out.filter(([x, y]) => y - x > 0.2);
}
// Where a road's own drawing stops at each end of its course, taken from the junction's shape (or the
// turning head at a cul-de-sac): its carriageway (`strip`), its markings (`line`), its reservation
// (`median`), and its footway on each side (`L`/`R`, left and right of the road's direction from a
// to b). Where roads meet with no junction, or a road runs off the map, it's drawn to the course's end.
export interface Ends { strip: [number, number]; line: [number, number]; median: [number, number]; L: [number, number]; R: [number, number]; centre: [number, number] }
export function endsOf(junctions: Map<number, Junction>, s: RSeg, C: Course): Ends {
  const at = (node: number, e: 0 | 1) => {
    const atA = e === 0, j = junctions.get(node), sh = C.kinds[e] === 'junction' ? j?.shape : null, head = C.heads[e];
    // arriving traffic keeps left: at the a end it arrives on the road's right, at the b end on its left
    const sides = ([plus, minus]: [number, number]) => ({ L: atA ? minus : plus, R: atA ? plus : minus });
    if (j && sh) {
      const major = j.form === 'priority' && j.major.includes(s.id);
      const ring = j.form === 'roundabout' || j.form === 'mini';
      // (the centre line stops short of a splitter island's tip)
      const split = sh.splitter?.[s.id] ? sh.splitter[s.id] + 1.5 : 0;
      return { strip: sh.mouth[s.id] ?? 0, line: major ? 0 : ring ? sh.mouth[s.id] ?? 0 : sh.line[s.id] ?? 0, median: sh.medianTrim[s.id] ?? 0, ...sides(sh.paveTrim[s.id] ?? [0, 0]), centre: split };
    }
    // (the road's own surfaces run a little way under the head, which is laid square to its end, so
    // a curving road meets it without a sliver)
    if (head) return { strip: head.mouth - 0.6, line: head.mouth, median: head.mouth, ...sides([head.paveTrim[0] - 0.6, head.paveTrim[1] - 0.6]), centre: 0 };
    return { strip: 0, line: 0, median: 0, L: 0, R: 0, centre: 0 };
  };
  const A = at(s.a, 0), B = at(s.b, 1);
  return { strip: [A.strip, B.strip], line: [A.line, B.line], median: [A.median, B.median], L: [A.L, B.L], R: [A.R, B.R], centre: [A.centre, B.centre] };
}

// (pedx: a pelican crossing's, whose lights follow its people rather than a junction's)
export interface Lamp { mesh: THREE.Mesh; node: number; seg: number; col: 'red' | 'amber' | 'green'; pedx?: string }

export function drawRoads(net: Network, group: THREE.Group, junctions: Map<number, Junction>, trunkMat: THREE.Material, crownMat: THREE.Material, editing: number | null = null): Lamp[] {
  for (const c of [...group.children]) { group.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const F = () => new Flat();
  const pave = F(), asph = F(), lines = F(), verge = F(), median = F(), yellow = F(), bus = F(), cyc = F(), bays = F();
  const ballast = F(), sleepers = F(), railsF = F(), rack = F(), holes = F(), hint = F(), island = F(), wires = F();
  const tactileBuff = F(), tactileRed = F();
  const cut = new Solid(), body = new Solid(), rails = new Solid(), barrier = new Solid(), kerbs = new Solid(), portal = new Solid(), poles = new Solid();
  const parked = carCols.map(() => new Solid());
  const furn = { glass: new Solid(), frame: new Solid(), red: new Solid() };
  const boards = new Boards();
  const trees: THREE.BufferGeometry[] = [];
  const lamps: Lamp[] = [];
  const tree = (x: number, y: number, z: number, s = 1) => trees.push(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 3 * s, 5).translate(x, y + 1.5 * s, z), new THREE.IcosahedronGeometry(2.2 * s, 0).translate(x, y + 4.4 * s, z));
  const courses = new Map<number, Course>();
  const beacons = new Solid(), globes: THREE.BufferGeometry[] = [];

  for (const s of net.segs.values()) {
    const d = net.def(s), path = finePath(net, s), A = arcs(path), L = A[A.length - 1];

    const half = net.half(s);
    // (a raised stretch the library couldn't bridge keeps the old deck on piers, not walls to the ground)
    structures(path, body, rails, half, s.bridges ? s.bridges.map((b) => [b.s0, b.s1] as [number, number]) : path.every((p) => (p.y ?? 0) <= 6) ? [] : undefined); // bridges: game/bridges.ts
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
    // ---- everything else follows the road's course: round the curve into the next road, off the map ----
    const C = courseOf(net, s), cp = C.path, CL = C.len;
    courses.set(s.id, C);
    const S = (r: number) => section(net, s, C, r);
    // round the inside of a join's curve, nothing reaches past the curve's centre
    const lim = (r: number, o: number) => { const l = C.limit(r); return l && Math.sign(o) === l.side && Math.abs(o) > l.r ? l.side * l.r : o; };
    const part = (r0: number, r1: number) => {
      const a = Math.max(0, r0), b = Math.min(CL, r1), p = subPath(cp, a, b), ar = arcs(p).map((t) => t + a);
      return { p, r: ar, sec: ar.map(S), ends: [a < 1e-6 ? C.dirs[0] : null, b > CL - 1e-6 ? C.dirs[1] : null] as [XZ | null, XZ | null] };
    };
    type Part = ReturnType<typeof part>;
    const band = (f: Flat, q: Part, off: (i: number) => [number, number], y: number) => f.strip(q.p, (i) => { const [a, b] = off(i); return [lim(q.r[i], a), lim(q.r[i], b)]; }, y, q.ends);
    // a solid line along the course
    const solid = (f: Flat, r0: number, r1: number, off: (r: number) => number, w: number, y = 0.35) => { if (r1 - r0 > 0.2) { const q = part(r0, r1); f.strip(q.p, (i) => { const o = off(q.r[i]); return [o - w, o + w]; }, y, q.ends); } };
    if (d.cls === 'rail') {
      // ---- railway: ballast, sleepers, rails, a rack, overhead wires ----
      const q = part(0, CL), K = kerbOf(d);
      band(verge, q, () => [K, half], 0.12);
      band(verge, q, () => [-half, -K], 0.12);
      band(ballast, q, () => [-K, K], 0.2);
      const tracks = d.tracks === 2 ? [-2, 2] : [0];
      for (const c of tracks) {
        sleepers.dashes(cp, () => c, 0.2, CL - 0.2, 0.26, 0.42, 1.3, 0.3);
        for (const r of [-0.72, 0.72]) band(railsF, q, () => [c + r - 0.05, c + r + 0.05], 0.44);
        if (d.rack) band(rack, q, () => [c - 0.07, c + 0.07], 0.46);
        if (d.electric) band(wires, q, () => [c - 0.03, c + 0.03], 5.8);
      }
      if (d.electric) for (let t = 20; t < CL - 5; t += 55) {
        const q = pointAt(cp, t), o = K + 0.6;
        const px = q.x - q.uz * o, pz = q.z + q.ux * o;
        poles.box(px, pz, q.ux, q.uz, 0.15, 0.15, q.y, q.y + 6.6);
        const mx = q.x - q.uz * (o / 2 - 0.3), mz = q.z + q.ux * (o / 2 - 0.3);
        poles.box(mx, mz, q.ux, q.uz, 0.06, o / 2 + 0.3, q.y + 6.1, q.y + 6.25);
      }
      continue;
    }
    // ---- road: pavements or verges, then the carriageway ----
    const ends = endsOf(junctions, s, C);
    // pedestrian crossings along it (pedx.ts), and the stretch each keeps clear of other markings: the
    // crossing, its give-way or stop lines, and its zig-zags either side
    const pxs = pedCrossingsOn(net, s, C, ends);
    const pxBack = (x: PedX) => (x.kind === 'zebra' ? 1.5 : 2.5) + 0.3;
    const pxNear = (r: number, pad: number) => pxs.some((x) => Math.abs(r - x.r) < x.w / 2 + pad);
    const cutOut = (a: number, b: number, pad: (x: PedX) => number) => {
      let out: [number, number][] = [[a, b]];
      for (const x of pxs) { const lo = x.r - x.w / 2 - pad(x), hi = x.r + x.w / 2 + pad(x); out = out.flatMap(([p, q]) => (hi <= p || lo >= q ? [[p, q]] : [[p, lo], [hi, q]].filter(([u, v]) => v - u > 0.3)) as [number, number][]); }
      return out;
    };
    const surface = d.pave > 0 ? pave : verge;
    // where the road runs on into one with grass verges (out of town), the footway tapers out to the
    // kerb over its last few metres rather than stopping square
    const fade = (q: number) => C.onward.reduce((f, o, e) => (o && d.pave > 0 && o.def.pave === 0 ? Math.min(f, Math.max(0, Math.min(1, (e ? CL - q : q) / 6))) : f), 1);
    const fades = C.onward.some((o) => o && d.pave > 0 && o.def.pave === 0);
    for (const k of [1, -1] as const) {
      const [e0, e1] = k === 1 ? ends.L : ends.R;
      if (CL - e0 - e1 <= 0.2) continue;
      const q = part(e0, CL - e1), S2 = (i: number) => (k === 1 ? q.sec[i].L : q.sec[i].R);
      const mid = (i: number) => S2(i).kerb + (S2(i).back - S2(i).kerb) * fade(q.r[i]);
      band(surface, q, (i) => (k === 1 ? [S2(i).kerb, mid(i)] : [-mid(i), -S2(i).kerb]), 0.15);
      if (fades) band(verge, q, (i) => (k === 1 ? [mid(i), S2(i).back] : [-S2(i).back, -mid(i)]), 0.15);
    }
    // the inside corner of the footway at a bend
    C.fills.forEach((f, e) => { if (f) surface.poly(f, net.node(e ? s.b : s.a).y + 0.15); });
    // stretches of the course where a test holds (to a few centimetres)
    const runs = (test: (r: number) => boolean, a: number, b: number) => {
      const out: [number, number][] = [];
      if (b - a < 0.1) return out;
      const pts = [a, ...C.rho.filter((r) => r > a + 1e-6 && r < b - 1e-6), b];
      const edge = (lo: number, hi: number) => { const t0 = test(lo); for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (test(m) === t0) lo = m; else hi = m; } return (lo + hi) / 2; };
      let start: number | null = test(a) ? a : null, was = start !== null;
      for (let i = 1; i < pts.length; i++) {
        const ok = test(pts[i]);
        if (ok && !was) start = edge(pts[i - 1], pts[i]);
        if (!ok && was) { out.push([start!, edge(pts[i - 1], pts[i])]); start = null; }
        was = ok;
      }
      if (start !== null) out.push([start, b]);
      return out.filter(([x, y]) => y - x > 0.05);
    };
    const kerbed = (x: Section2, dd: RoadDef) => x.median > 0.02 && !x.hatched && dd.medianKind !== 'hatch';
    const painted = (x: Section2) => x.median > 0.03 && (x.hatched || d.medianKind === 'hatch');
    // the kerbed reservation: where it starts and stops, and whether it ends in a rounded nose there
    // (at a junction, where a ghost island opens out, or where the road stops) or carries straight on
    // (round a join into another divided road, or off the map)
    const r = d.median / 2, nose = [true, true];
    let mb: [number, number] | null = null;
    const km = d.median > 0 && d.medianKind !== 'hatch' ? runs((q) => kerbed(C.sec(q), d), 0, CL) : [];
    if (km.length) {
      let m0 = km[0][0], m1 = km[km.length - 1][1];
      for (const e of [0, 1] as const) {
        const k = C.kinds[e], on = C.onward[e], reaches = e ? CL - m1 < 0.05 : m0 < 0.05;
        // how far in from this end of the course the reservation's full width starts
        let back: number;
        if (!reaches) back = (e ? CL - m1 : m0) + r; // after a ghost island: the nose's tip is where the hatching stops
        else if (k === 'edge' || (k === 'join' && on && kerbed(on.sec, on.def))) { nose[e] = false; continue; }
        else if (k === 'join') back = (e ? CL - C.own[1] : C.own[0]) + 1 + r;
        else if (k === 'end') back = 1.5 + r;
        else back = ends.median[e];
        if (e) m1 = CL - back; else m0 = back;
      }
      if (m1 - m0 > 1) mb = [m0, m1];
    }
    const [s0, s1] = [ends.strip[0], CL - ends.strip[1]];
    const fullWidth = (a: number, b: number) => { if (b - a > 0.05) { const q = part(a, b); band(asph, q, (i) => [-q.sec[i].R.kerb, q.sec[i].L.kerb], 0.25); } };
    if (mb) {
      fullWidth(s0, mb[0]);
      fullWidth(mb[1], s1);
      const q = part(Math.max(s0, mb[0]), Math.min(s1, mb[1]));
      band(asph, q, (i) => [q.sec[i].x.median, q.sec[i].L.kerb], 0.25);
      band(asph, q, (i) => [-q.sec[i].R.kerb, -q.sec[i].x.median], 0.25);
      const mk = d.medianKind, mf = mk === 'grass' || mk === 'trees' ? verge : median;
      const mq = part(mb[0], mb[1]);
      band(mf, mq, (i) => [-mq.sec[i].x.median, mq.sec[i].x.median], 0.27);
      // a rounded kerbed nose where it ends
      for (const [t, dir, e] of [[mb[0], 1, 0], [mb[1], -1, 1]] as const) {
        if (!nose[e]) continue;
        const q = pointAt(cp, t), rr = C.sec(t).median;
        for (let k = 0; k < 8; k++) {
          const a0 = (k / 8) * Math.PI, a1 = ((k + 1) / 8) * Math.PI;
          const pt = (a: number) => [q.x + q.uz * Math.cos(a) * rr - q.ux * Math.sin(a) * rr * dir, q.z - q.ux * Math.cos(a) * rr - q.uz * Math.sin(a) * rr * dir];
          const [x0, z0] = pt(a0), [x1, z1] = pt(a1);
          mf.tri(q.x, q.z, x0, z0, x1, z1, q.y + 0.27);
        }
      }
      if (mk === 'trees') for (let t = mb[0] + 10; t < mb[1] - 6; t += 16) { const q = pointAt(cp, t); tree(q.x, q.y, q.z, 0.9); }
      if (mk === 'barrier' || d.family === 'Motorway') {
        const bq = part(mb[0] + 0.3, mb[1] - 0.3);
        for (let i = 1; i < bq.p.length; i++) {
          const p = bq.p[i - 1], q = bq.p[i];
          barrier.quad([p.x, (p.y ?? 0) + 0.25, p.z], [q.x, (q.y ?? 0) + 0.25, q.z], [q.x, (q.y ?? 0) + 1.05, q.z], [p.x, (p.y ?? 0) + 1.05, p.z]);
        }
      }
    } else fullWidth(s0, s1);
    // one carriageway of a motorway or fast dual carriageway: a safety barrier along the central
    // reservation, on its offside verge (the other carriageway has its own, a little way off)
    if (d.oneway && d.id.endsWith('~1') && d.verge > 1 && (d.family === 'Motorway' || (d.family === 'Dual' && d.mph >= 60))) {
      const o = -(kerbOf(d) + d.verge - 0.6), bq = part(s0 + 0.3, s1 - 0.3);
      // (not where it would stand on another carriageway: where the pair splays in to a junction, say)
      const others = [...net.segs.values()].filter((x) => x !== s && x.oneway && net.def(x).cls === 'road');
      const clear = (x: number, z: number) => !others.some((x2) => { const c = closestOnPath({ x, z }, net.path(x2)); // (the barrier stands d.verge - 0.6 out from the kerb: stop where the kerbs are nearer than a
        // ghost island's width, plus a metre, where the pair splays into a junction's chevrons)
        return c.d < net.half(x2) + 0.3 || c.d < kerbOf(net.def(x2)) + GHOST_PAIR + 1.6 - d.verge; });
      for (let i = 1; i < bq.p.length; i++) {
        const p = bq.p[i - 1], q = bq.p[i], L2 = Math.hypot(q.x - p.x, q.z - p.z) || 1, nx = (q.z - p.z) / L2, nz = -(q.x - p.x) / L2;
        const P0 = [p.x + nx * o, p.z + nz * o], Q0 = [q.x + nx * o, q.z + nz * o];
        if (!clear(P0[0], P0[1]) || !clear(Q0[0], Q0[1])) continue;
        barrier.quad([P0[0], (p.y ?? 0) + 0.25, P0[1]], [Q0[0], (q.y ?? 0) + 0.25, Q0[1]], [Q0[0], (q.y ?? 0) + 1.05, Q0[1]], [P0[0], (p.y ?? 0) + 1.05, P0[1]]);
      }
    }

    // ---- markings, kept clear of junctions ----
    const joinAt = (e: 0 | 1) => C.kinds[e] === 'join' || C.kinds[e] === 'edge';
    const l0 = ends.line[0] + (joinAt(0) ? 0 : 1), l1 = CL - ends.line[1];
    const anchor = (a: number, b: number) => [joinAt(0) && a < 1e-6, joinAt(1) && b > CL - 1e-6] as const;
    // a hatched area (a ghost island): solid edges and diagonal stripes; its edges become the lines
    // along the kerbed reservation where that begins, and close in to the centre line where it ends
    const edgeOff = (x: Section2) => (painted(x) ? (d.medianKind === 'hatch' ? x.median : x.median * (1 + 0.25 / Math.max(0.5, r))) : x.median + 0.25);
    for (const [a, b] of runs((q) => C.sec(q).median > 0.02, l0, l1)) for (const k of [1, -1]) solid(lines, a, b, (q) => k * edgeOff(C.sec(q)), 0.07);
    const H = STD.hatch(d.mph);
    for (const [a, b] of runs((q) => painted(C.sec(q)), l0, l1)) {
      // (phased from the far end, where a ghost island meets the nose of the kerbed reservation)
      for (let c = b - H.spacing / 2; c > a; c -= H.spacing) {
        const e = edgeOff(C.sec(c));
        if (e < 0.25) continue;
        // a stripe at 45°, clipped to the hatched area
        const u0 = Math.max(-1, (a - c) / e), u1 = Math.min(1, (b - c) / e);
        const P2 = (u: number, dw: number) => {
          const t = c + e * u + dw, q = pointAt(cp, t), o = Math.sign(u) * Math.min(Math.abs(e * u), edgeOff(C.sec(t)));
          return [q.x + q.uz * o, q.y + 0.35, q.z - q.ux * o];
        };
        const [p0, p1, p2, p3] = [P2(u0, -H.stripe / 2), P2(u0, H.stripe / 2), P2(u1, H.stripe / 2), P2(u1, -H.stripe / 2)];
        lines.tri3(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
        lines.tri3(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
      }
    }
    // the centre line of a single carriageway sits midway between the lane edges (it moves over
    // where lanes are narrowed), running on round a join into the next road
    const c0 = Math.max(l0, ends.centre[0]), c1 = Math.min(l1, CL - ends.centre[1]);
    if (!d.oneway) for (const [a0, b0] of runs((q) => C.sec(q).median < 0.05, c0, c1)) for (const [a, b] of cutOut(a0, b0, (x) => pxBack(x) + PEDX.zigzags * PEDX.zig)) dashRun(lines, cp, (q) => { const x = S(q); return (x.L.lane - x.R.lane) / 2; }, a, b, 3, 3, 0.07, 0.35, ...anchor(a, b));
    // lane lines: where a lane tapers away, its line closes in on the reservation's edge line
    // (a one-way road's lanes are all on its left: see catalog.laneBase)
    const sides = d.oneway ? ([1] as const) : ([1, -1] as const);
    for (const k of sides) for (let j = 1; j < d.lanes; j++) {
      const off = (q: number) => { const x = S(q), sd = k === 1 ? x.L : x.R, n = x.x.lanes; return k * (x.x.median + ((sd.lane - x.x.median) * (n - j)) / n); };
      for (const [a0, b0] of runs((q) => C.sec(q).lanes - j > 0.12, l0, l1)) for (const [a, b] of cutOut(a0, b0, pxBack)) dashRun(lines, cp, off, a, b, 4, 5, 0.07, 0.35, ...anchor(a, b));
    }
    // kerbside lanes (bus lanes, cycle lanes, parking), only where the road has its own full width
    const T = C.taper, k0 = C.rhoOf(T.A ? TAPER.median * T.A.len : 0), k1 = C.rhoOf(L - (T.B ? TAPER.median * T.B.len : 0));
    const ks0 = Math.max(s0, k0), ks1 = Math.min(s1, k1), kl0 = Math.max(l0, k0), kl1 = Math.min(l1, k1);
    // (where a slip road joins or leaves a one-way carriageway, the junction paints its nearside edge)
    const gaps = [s.a, s.b].flatMap((nd) => { const g = junctions.get(nd)?.shape?.marks?.edgeGap[s.id]; return g ? [[C.rhoOf(g[0]), C.rhoOf(g[1])] as [number, number]] : []; });
    // a one-way carriageway with hard strips has edge lines both sides: its offside one at the lanes' edge
    if (d.oneway && (d.strip ?? 0) > 0) solid(lines, l0, l1, (q) => C.sec(q).median, 0.1);
    for (const k of sides) {
      const S2 = (x: ReturnType<typeof S>) => (k === 1 ? x.L : x.R);
      const span = (a: number, b: number) => (k === 1 ? [a, b] : [-b, -a]) as [number, number];
      if (d.shoulder || (d.strip ?? 0) > 0) for (const [a, b] of outside(l0, l1, gaps)) solid(lines, a, b, (q) => k * S2(S(q)).lane, 0.1);
      if (ks1 - ks0 < 1) continue;
      const q = part(ks0, ks1);
      if (d.bus) { band(bus, q, (i) => span(S2(q.sec[i]).lane, S2(q.sec[i]).lane + d.bus), 0.26); solid(lines, kl0, kl1, (t) => k * S2(S(t)).lane, 0.12); }
      if (d.cycle) {
        band(cyc, q, (i) => span(S2(q.sec[i]).lane + d.bus, S2(q.sec[i]).lane + d.bus + d.cycle), 0.26);
        solid(lines, kl0, kl1, (t) => k * (S2(S(t)).lane + d.bus + 0.1), 0.08);
      }
      if (d.parking) {
        band(bays, q, (i) => { const p0 = S2(q.sec[i]).lane + d.bus + d.cycle; return span(p0 + d.parking - Math.max(0, S2(q.sec[i]).park), p0 + d.parking); }, 0.26);
        let n = 0;
        for (let t = ks0 + 4; t < ks1 - 5; t += 6) {
          const x = S(t + 3), side = S2(x);
          if (side.park < d.parking - 0.1) continue; // painted out by a stop
          if (pxs.some((x) => t + 6 > x.r - x.w / 2 - pxBack(x) - PEDX.zigzags * PEDX.zig && t < x.r + x.w / 2 + pxBack(x) + PEDX.zigzags * PEDX.zig)) continue; // (nor on a crossing's zig-zags)
          const pm = side.lane + d.bus + d.cycle + d.parking / 2;
          lines.dashes(cp, () => k * pm, t, t + 0.12, 0.12, 1, d.parking / 2, 0.35);
          if ((Math.sin(s.id * 7 + t * 13.7) + 1) / 2 < 0.65) {
            const q2 = pointAt(cp, t + 3), o = k * pm;
            parked[(n++ + s.id) % parked.length].box(q2.x + q2.uz * o, q2.z - q2.ux * o, q2.ux, q2.uz, 2.1, 0.88, q2.y + 0.3, q2.y + 1.35);
          }
        }
      }
    }
    // "lane ends" arrows (bent, TSRGD diagram 1014) in each lane that tapers away, before the taper,
    // for traffic heading into the narrower road
    for (const Tp of [T.A, T.B]) if (Tp && !(d.oneway && Tp.atA)) {
      const { length: al, gap, count } = STD.deflectionArrow(d.mph);
      const k = Tp.atA ? -1 : 1; // the side whose traffic is heading for the join (we drive on the left)
      for (let j = Tp.to.lanes; j < d.lanes; j++) for (let n = 0; n < count; n++) {
        const u = Tp.len * 0.9 + n * (al + gap), tHead = Tp.atA ? u : L - u, tTail = Tp.atA ? u + al : L - u - al;
        if (tTail < 0 || tTail > L) break;
        const rHead = C.rhoOf(tHead), rTail = C.rhoOf(tTail);
        if (Math.min(rHead, rTail) < l0 + 2 || Math.max(rHead, rTail) > l1 - 2) continue;
        if (C.sec(rHead).lanes - j < 0.85 || C.sec(rTail).lanes - j < 0.85) continue; // the lane must still be (nearly) full width
        // `a` metres ahead from the tail, `b` over towards the nearside, from the middle of lane j
        const W2 = (a: number, b: number) => {
          const t = rTail + k * a, q = pointAt(cp, t), x = S(t), sd = k === 1 ? x.L : x.R, w = (sd.lane - x.x.median) / x.x.lanes;
          const c = (Math.max(x.x.median, sd.lane - (j + 1) * w) + sd.lane - j * w) / 2, o = k * (c + b);
          return [q.x + q.uz * o, q.y + 0.36, q.z - q.ux * o];
        };
        const quad = (p: number[][]) => { lines.tri3(p[0][0], p[0][1], p[0][2], p[1][0], p[1][1], p[1][2], p[2][0], p[2][1], p[2][2]); lines.tri3(p[0][0], p[0][1], p[0][2], p[2][0], p[2][1], p[2][2], p[3][0], p[3][1], p[3][2]); };
        const hw = 0.08, bend = [0.5 * al, 0], elbow = [0.78 * al, 0.55];
        quad([W2(0, -hw), W2(bend[0], -hw), W2(bend[0], hw), W2(0, hw)]);
        const dx = elbow[0] - bend[0], dz = elbow[1] - bend[1], dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
        quad([W2(bend[0] + uz * hw, bend[1] - ux * hw), W2(elbow[0] + uz * hw, elbow[1] - ux * hw), W2(elbow[0] - uz * hw, elbow[1] + ux * hw), W2(bend[0] - uz * hw, bend[1] + ux * hw)]);
        const hl = 0.24 * al, tip = W2(elbow[0] + ux * hl, elbow[1] + uz * hl), b0 = W2(elbow[0] + uz * 0.45, elbow[1] - ux * 0.45), b1 = W2(elbow[0] - uz * 0.45, elbow[1] + ux * 0.45);
        lines.tri3(b0[0], b0[1], b0[2], tip[0], tip[1], tip[2], b1[0], b1[1], b1[2]);
      }
    }
    // bus stops: yellow bay markings, the lay-by's edge line, a shelter (stops are placed along the road's own t)
    for (const st of s.stops) {
      const [a, b] = stopSpan(st).map((t) => C.rhoOf(t)), k = st.side;
      const kerb = (t: number) => k * (k === 1 ? S(t).L.kerb : S(t).R.kerb);
      const laneE = (t: number) => k * (k === 1 ? S(t).L.lane : S(t).R.lane);
      const s0b = C.rhoOf(st.s - BAY.stand / 2), s1b = C.rhoOf(st.s + BAY.stand / 2);
      const inner = st.kind === 'layby' ? laneE : (t: number) => kerb(t) - k * 3;
      yellow.dashes(cp, (t) => kerb(t) - k * 0.3, s0b, s1b, 1, 0.01, 0.1, 0.36);
      yellow.dashes(cp, inner, s0b, s1b, 1, 0.01, 0.1, 0.36);
      for (const t of [s0b, s1b]) { const sp = subPath(cp, t - 0.1, t + 0.1); yellow.strip(sp, () => { const x = [inner(t), kerb(t) - k * 0.3].sort((p, q) => p - q); return [x[0], x[1]]; }, 0.36); }
      if (st.kind === 'layby') lines.dashes(cp, laneE, a, b, 1, 1, 0.1, 0.35);
      const rs = C.rhoOf(st.s);
      shelter(furn, cp, rs, kerb(rs) + k * 0.2);
    }
    // pedestrian crossings: a zebra (stripes, give-way blocks, Belisha beacons) or a pelican (studs,
    // stop lines, signals), both with zig-zags (TSRGD diagram 1001.1) along the kerbs and the middle
    // and red blister paving at the dropped kerbs
    for (const x of pxs) {
      const Wq = (t: number, o: number) => { const q = pointAt(cp, t); return [q.x + q.uz * o, (q.y ?? 0), q.z - q.ux * o]; };
      const quad = (f: Flat, t0: number, t1: number, o0: number, o1: number, yy: number) => {
        const p = [Wq(t0, o0), Wq(t1, o0), Wq(t1, o1), Wq(t0, o1)];
        f.tri3(p[0][0], p[0][1] + yy, p[0][2], p[1][0], p[1][1] + yy, p[1][2], p[2][0], p[2][1] + yy, p[2][2]);
        f.tri3(p[0][0], p[0][1] + yy, p[0][2], p[2][0], p[2][1] + yy, p[2][2], p[3][0], p[3][1] + yy, p[3][2]);
      };
      const X = S(x.r), kL = X.L.kerb, kR = X.R.kerb, eL = X.L.lane, eR = X.R.lane, mid = (eL - eR) / 2;
      const t0 = x.r - x.w / 2, t1 = x.r + x.w / 2, back = pxBack(x);
      if (x.kind === 'zebra') {
        // black and white stripes (road-coloured gaps) across, each parallel to the kerb
        const n = Math.max(3, Math.round((kL + kR) / 0.6)), sw = (kL + kR) / n;
        for (let i = 0; i < n; i++) if ((i + Math.round(n / 2)) % 2 === 0) quad(lines, t0, t1, -kR + i * sw + 0.02, -kR + (i + 1) * sw - 0.02, 0.35);
        // give-way blocks (diagram 1003.1) a metre and a half back, across each approach
        for (const [tA, o0, o1] of [[t0 - back, mid, eL], [t1 + back - 0.3, -eR, mid]] as const)
          for (let o = o0 + 0.15; o < o1 - 0.3; o += 0.9) quad(lines, tA, tA + 0.3, o, Math.min(o1 - 0.15, o + 0.5), 0.35);
      } else {
        // two lines of studs across (diagram 1055), and a stop line (1001) across each approach
        for (const t of [t0, t1]) for (let o = -kR + 0.3; o < kL - 0.3; o += 0.6) quad(lines, t - 0.1, t + 0.1, o, o + 0.2, 0.35);
        quad(lines, t0 - back, t0 - back + 0.3, mid, eL, 0.35);
        quad(lines, t1 + back - 0.3, t1 + back, -eR, mid, 0.35);
      }
      // zig-zags either side, out from the lines: at each kerb and along the middle
      for (const sgn of [-1, 1]) {
        const start = sgn < 0 ? t0 - back : t1 + back, room = sgn < 0 ? start - l0 - 1 : l1 - 1 - start;
        const m = Math.max(2, Math.min(PEDX.zigzags, Math.floor(room / PEDX.zig)));
        for (const [base, amp] of [[eL - 0.35, 0.22], [-(eR - 0.35), 0.22], [mid, 0.22]] as const) for (let i = 0; i < m; i++) {
          const a = start + sgn * i * PEDX.zig, b = a + sgn * PEDX.zig, oa = base + (i % 2 ? amp : -amp), ob = base + (i % 2 ? -amp : amp);
          const [A, B] = [Wq(a, oa), Wq(b, ob)], dx = B[0] - A[0], dz = B[2] - A[2], L2 = Math.hypot(dx, dz) || 1, nx = -dz / L2 * 0.05, nz = dx / L2 * 0.05;
          lines.tri3(A[0] + nx, A[1] + 0.35, A[2] + nz, B[0] + nx, B[1] + 0.35, B[2] + nz, B[0] - nx, B[1] + 0.35, B[2] - nz);
          lines.tri3(A[0] + nx, A[1] + 0.35, A[2] + nz, B[0] - nx, B[1] + 0.35, B[2] - nz, A[0] - nx, A[1] + 0.35, A[2] - nz);
        }
      }
      // red blister paving at the dropped kerbs, both sides (a controlled crossing's)
      const deep = Math.min(1.2, d.pave - 0.2);
      quad(tactileRed, t0 - 0.2, t1 + 0.2, kL + 0.05, kL + deep, 0.16);
      quad(tactileRed, t0 - 0.2, t1 + 0.2, -kR - deep, -kR - 0.05, 0.16);
      const q = pointAt(cp, x.r), u = { x: q.ux, z: q.uz }, y0 = q.y ?? 0;
      if (x.kind === 'zebra') {
        // a Belisha beacon at each end: a black-and-white banded pole and an amber globe
        for (const [t, o] of [[t0 - 0.4, kL + 0.5], [t1 + 0.4, -(kR + 0.5)]] as const) {
          const p = Wq(t, o);
          for (let b = 0; b < 8; b++) (b % 2 ? poles : beacons).box(p[0], p[2], u.x, u.z, 0.06, 0.06, y0 + 0.15 + b * 0.35, y0 + 0.15 + (b + 1) * 0.35);
          globes.push(new THREE.IcosahedronGeometry(0.24, 1).translate(p[0], y0 + 3.2, p[2]));
        }
      } else {
        // signals for each approach: on the nearside at the stop line and on the far side, facing the traffic
        for (const [t, o, dir] of [[t0 - back - 0.6, kL + 0.6, 1], [t1 + 0.8, kL + 0.6, 1], [t1 + back + 0.6, -(kR + 0.6), -1], [t0 - 0.8, -(kR + 0.6), -1]] as const) {
          const p = Wq(t, o), f = { x: -u.x * dir, z: -u.z * dir }; // (f: towards the traffic it's for)
          poles.box(p[0], p[2], u.x, u.z, 0.08, 0.08, y0 + 0.15, y0 + 3.5);
          poles.box(p[0], p[2], u.x, u.z, 0.1, 0.2, y0 + 2.3, y0 + 3.4);
          poles.box(p[0], p[2], u.x, u.z, 0.1, 0.12, y0 + 1.0, y0 + 1.3); // (the push button)
          (['red', 'amber', 'green'] as const).forEach((col, i) => {
            const m = new THREE.Mesh(lampGeo, LAMP_OFF);
            m.position.set(p[0] + f.x * 0.12, y0 + 3.15 - i * 0.33, p[2] + f.z * 0.12);
            m.rotation.y = -Math.atan2(f.z, f.x) + Math.PI / 2;
            group.add(m);
            lamps.push({ mesh: m, node: -1, seg: s.id, col, pedx: x.id });
          });
        }
      }
    }
    // street trees along wide pavements, clear of junctions and stops
    if (d.pave >= 5) for (const k of [1, -1]) for (let t = (k === 1 ? ends.L : ends.R)[0] + 8; t < CL - (k === 1 ? ends.L : ends.R)[1] - 4; t += 14) {
      if (s.stops.some((st) => { const [a, b] = stopSpan(st).map((q) => C.rhoOf(q)); return st.side === k && t > a - 6 && t < b + 6; })) continue;
      const x = S(t), side = k === 1 ? x.L : x.R;
      if (side.back - side.kerb < 3 || pxNear(t, 3)) continue;
      const q = pointAt(cp, t), o = k * (side.kerb + 1.4);
      const at = { x: q.x + q.uz * o, z: q.z - q.ux * o };
      // not on a junction's land (a slip road, an island), nor off the map
      if (net.land.at(at)?.owner === 'junction' || Math.abs(at.x) > net.bound || Math.abs(at.z) > net.bound) continue;
      tree(at.x, q.y, at.z);
    }
  }
  // ---- junctions ----
  // Each junction is drawn from its shape (jshape.ts): the carriageway with its kerb radii or
  // roundabout, the footway round it, islands, then the markings a UK road would have.
  const kerbed = (pts: P[], y: number, top = 0.42) => {
    island.poly(pts, y + top);
    for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; kerbs.quad([p.x, y + 0.25, p.z], [q.x, y + 0.25, q.z], [q.x, y + top, q.z], [p.x, y + top, p.z]); }
  };
  for (const n of net.nodes.values()) {
    const segs = net.segsAt(n.id);
    if (!segs.length) continue;
    // (track joins up round a curve like a road; only where lines branch is there a bed of ballast)
    if (net.def(segs[0]).cls === 'rail') { if (segs.length > 2) ballast.disc(n, Math.max(...segs.map((s) => kerbOf(net.def(s)))), 0.2); continue; }
    // two roads meeting end to end are drawn by their own courses, running on round the curve
    const j = junctions.get(n.id), sh = segs.length > 2 ? j?.shape : undefined;
    const y = n.y;
    const noPave = segs.every((s) => net.def(s).pave === 0);
    if (!j || !sh) {
      if (segs.length === 1) {
        // a cul-de-sac's turning head (a road running off the map, or a big road that just stops, has none)
        const s = segs[0], head = courses.get(s.id)?.heads[s.a === n.id ? 0 : 1];
        if (head) { (noPave ? verge : pave).poly(head.pave, y + 0.15); asph.poly(head.apron, y + 0.25); }
      } else if (segs.length > 2) {
        // roads meeting with no junction designed yet: fill the middle
        const kerb = Math.max(ROADS.street.lane, ...segs.map((s) => kerbOf(net.def(s))));
        (noPave ? verge : pave).disc(n, net.nodeHalf(n.id), 0.15, 32);
        asph.disc(n, kerb, 0.25, 32);
      }
      continue;
    }
    // (where some of its roads have footways and some verges, each road's own piece is what it has, the
    // shared ones footway; footway a centimetre up and verge a little down, so where they overlap the
    // footway is drawn cleanly over the verge and never at the same height, which would flicker)
    const mixed = !noPave && segs.some((x) => net.def(x).pave === 0);
    sh.paves.forEach((q, i) => {
      const leg = sh.paveLeg?.[i], ls = leg != null ? net.segs.get(leg) : undefined;
      if (!mixed) (noPave ? verge : pave).poly(q, y + 0.15);
      else if (ls && net.def(ls).pave === 0) verge.poly(q, y + 0.145);
      else pave.poly(q, y + 0.16);
    });
    for (const q of sh.aprons) asph.poly(q, y + 0.25);
    // ghost islands where roads meet a roundabout close together: chevrons on the carriageway
    for (const q of sh.ghost?.chevrons ?? []) { lines.tri3(q[0].x, y + 0.35, q[0].z, q[1].x, y + 0.35, q[1].z, q[2].x, y + 0.35, q[2].z); lines.tri3(q[0].x, y + 0.35, q[0].z, q[2].x, y + 0.35, q[2].z, q[3].x, y + 0.35, q[3].z); }
    for (const isl of sh.islands) {
      kerbed(isl, y);
      // a keep-left bollard at the end facing oncoming traffic
      if (isl.length === 3) { const b0 = { x: (isl[0].x + isl[1].x) / 2 * 0.8 + isl[2].x * 0.2, z: (isl[0].z + isl[1].z) / 2 * 0.8 + isl[2].z * 0.2 }; kerbs.box(b0.x, b0.z, 1, 0, 0.18, 0.18, y + 0.4, y + 1.3); }
    }
    // a merge or diverge (interchange/slips.ts) paints its own nose, taper and edge lines
    if (sh.marks) {
      const at = (pts: XZ[]) => pts.map((p) => ({ x: p.x, z: p.z, y }));
      for (const l of sh.marks.solid) lines.strip(at(l.pts), () => [-l.w, l.w], 0.35);
      for (const l of sh.marks.broken) { const pts = at(l.pts); lines.dashes(pts, () => 0, 0, pathLength(pts), l.dash, l.gap, l.w, 0.35); }
      for (const q of sh.marks.hatch) { lines.tri3(q[0].x, y + 0.35, q[0].z, q[1].x, y + 0.35, q[1].z, q[2].x, y + 0.35, q[2].z); lines.tri3(q[0].x, y + 0.35, q[0].z, q[2].x, y + 0.35, q[2].z, q[3].x, y + 0.35, q[3].z); }
      continue;
    }
    const legs = legsAt(net, n.id);
    const ring = j.form === 'roundabout' || j.form === 'mini';
    // (a junction's markings are drawn here first, and kept only where they lie on its carriageway:
    // clear of footways, islands and reservations however awkwardly its roads meet)
    const mk = new Flat(), mka = new Flat();
    const frame = (l: typeof legs[number]): ShapeLeg => ({ id: l.seg.id, dir: l.dir, ang: l.ang, def: net.def(l.seg), len: l.len, path: l.path });
    for (const leg of legs) {
      // `a` out along the road as drawn and `b` across it (+b the side traffic arrives on)
      const fl = frame(leg);
      const W = (a: number, b: number) => { const p = legAt(n, fl, a, b); return [p.x, p.z] as const; };
      const rect = (f: Flat, a0: number, a1: number, b0: number, b1: number, yy: number) => { const p = [W(a0, b0), W(a1, b0), W(a1, b1), W(a0, b1)]; f.tri(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], y + yy); f.tri(p[0][0], p[0][1], p[2][0], p[2][1], p[3][0], p[3][1], y + yy); };
      const triW = (f: Flat, pts: [number, number][], yy: number) => { const q = pts.map(([a, b]) => W(a, b)); f.tri(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], y + yy); };
      const d = net.def(leg.seg), kIn = kerbOf(d), lb = d.oneway ? -kIn : laneBase(d);
      // (nothing arrives along a one-way road leading away: no line across it, no arrows)
      if (!leg.into) continue;
      // at a roundabout the give-way line follows the edge of the ring
      const gw = sh.giveWay?.[leg.seg.id], lineAtB = (b: number) => (ring ? ringA(n, fl, b, sh.R) + 0.3 : gw ? gw[0] + gw[1] * b : sh.line[leg.seg.id] ?? 0);
      const lineAt = lineAtB((lb + kIn) / 2);
      const approaches = !(j.form === 'priority' && j.major.includes(leg.seg.id));
      // give-way mk (double broken) or a solid stop line across the incoming half
      if (j.form === 'signals') rect(mk, lineAt, lineAt + 0.3, lb + 0.2, kIn - 0.1, 0.36);
      else if (approaches) for (const off of [0, 0.6]) for (let b = Math.max(lb, sh.splitter[leg.seg.id] ? STD.splitter.width / 2 : -Infinity) + 0.3; b < kIn - 0.2; b += 0.9) { const la = lineAtB(b + 0.3); rect(mk, la + off, la + off + 0.3, b, Math.min(kIn - 0.2, b + 0.6), 0.36); }
      // the give-way triangle (TSRGD diagram 1023): an outline, its point towards the driver coming up
      // to the line and its base across the lane just behind the line
      if (approaches && j.form !== 'signals') for (let i = 0; i < d.lanes; i++) {
        const c = laneCentre(net, leg.seg, i), la = lineAtB(c), [len, base, w] = d.mph > 40 ? [3.75, 1.25, 0.15] : [2.8, 0.95, 0.12];
        const T: [number, number][] = [[la + 2.4, c - base / 2], [la + 2.4 + len, c], [la + 2.4, c + base / 2]];
        // (the inner edge: the outline pulled in towards its incentre by the stroke's width)
        const e = [0, 1, 2].map((k) => Math.hypot(T[(k + 1) % 3][0] - T[(k + 2) % 3][0], T[(k + 1) % 3][1] - T[(k + 2) % 3][1])), P = e[0] + e[1] + e[2];
        const ic: [number, number] = [(e[0] * T[0][0] + e[1] * T[1][0] + e[2] * T[2][0]) / P, (e[0] * T[0][1] + e[1] * T[1][1] + e[2] * T[2][1]) / P];
        const r = (len * base) / P, f = Math.max(0, (r - w) / r);
        const I = T.map(([a, b]): [number, number] => [ic[0] + (a - ic[0]) * f, ic[1] + (b - ic[1]) * f]);
        for (let k = 0; k < 3; k++) { const m = (k + 1) % 3; triW(mk, [T[k], T[m], I[m]], 0.36); triW(mk, [T[k], I[m], I[k]], 0.36); }
      }
      // where people cross the arm (jshape.crossingAt, the crossing game/crowdsites.ts walks them to):
      // tactile paving on both footways at the dropped kerbs, buff for an uncontrolled crossing, red
      // at the lights, where two lines of studs (TSRGD diagram 1055) mark it across the carriageway
      const xt = crossingAt(sh, j.form, fl, n.y);
      if (xt !== null) {
        const deep = Math.min(1.2, d.pave), wide = 1.2, lit = j.form === 'signals', f = lit ? tactileRed : tactileBuff;
        const up = segs.some((x) => net.def(x).pave === 0) ? 0.17 : 0.16; // (just over the footway, which a mixed junction lifts)
        rect(f, xt - wide, xt + wide, kIn + 0.05, kIn + deep, up);
        rect(f, xt - wide, xt + wide, -kIn - deep, -kIn - 0.05, up);
        if (lit) for (const a of [xt - wide - 0.1, xt + wide + 0.1]) for (let b = -kIn + 0.3; b < kIn - 0.3; b += 0.6) rect(mk, a - 0.08, a + 0.08, b, b + 0.2, 0.36);
      }
      // lane arrows, a pair per approach lane
      const lanes = j.lanes[leg.seg.id] ?? [];
      // arrows only where lanes actually divide the traffic (not on a plain single-lane approach)
      const arrows = lanes.length > 1 || j.form === 'signals' || n.id === editing;
      if (arrows) lanes.forEach((mv, i) => {
        const c = laneCentre(net, leg.seg, i), la = Math.max(lineAtB(c), sh.mouth[leg.seg.id] ?? 0);
        for (const at of [la + 9, la + 26]) {
          if (at > leg.len - 8) continue;
          // shaft towards the junction (smaller `a`), then a head for each movement
          rect(mk, at - 3.2, at, c - 0.12, c + 0.12, 0.36);
          for (const m of mv) {
            if (m === 'S') triW(mk, [[at - 3.2, c - 0.45], [at - 3.2, c + 0.45], [at - 4.6, c]], 0.36);
            else {
              const sd = m === 'L' ? 1 : -1; // left of arriving traffic is +b
              const p0: [number, number] = [at - 2.6, c], p1: [number, number] = [at - 3.6, c + sd * 0.9];
              const qx = [W(p0[0], p0[1] - 0.12), W(p0[0], p0[1] + 0.12), W(p1[0], p1[1] + 0.12), W(p1[0], p1[1] - 0.12)];
              mk.tri(qx[0][0], qx[0][1], qx[1][0], qx[1][1], qx[2][0], qx[2][1], y + 0.36);
              mk.tri(qx[0][0], qx[0][1], qx[2][0], qx[2][1], qx[3][0], qx[3][1], y + 0.36);
              triW(mk, [[at - 3.2, c + sd * 1.25], [at - 4.2, c + sd * 0.5], [at - 4.2, c + sd * 1.6]], 0.36);
            }
          }
        }
      });
      if (j.form === 'roundabout') {
        // chevron boards on the island, facing traffic coming in
        const p = W(sh.island + 0.2, 1.6), q = W(sh.island + 0.2, -1.6);
        boards.quad([p[0], y + 0.6, p[1]], [q[0], y + 0.6, q[1]], [q[0], y + 1.3, q[1]], [p[0], y + 1.3, p[1]]);
      }
      if (j.form === 'signals') {
        // a signal on the nearside of each approach: black head, red / amber / green lamps
        const p = W(lineAt + 0.8, kIn + 0.7), ud = legDir(fl, lineAt);
        poles.box(p[0], p[1], ud.x, ud.z, 0.08, 0.08, y, y + 3.5);
        poles.box(p[0], p[1], ud.x, ud.z, 0.2, 0.2, y + 2.3, y + 3.4);
        (['red', 'amber', 'green'] as const).forEach((col, i) => {
          const m = new THREE.Mesh(lampGeo, LAMP_OFF);
          const f = W(lineAt + 1.02, kIn + 0.7);
          m.position.set(f[0], y + 3.15 - i * 0.33, f[1]);
          m.rotation.y = -Math.atan2(ud.z, ud.x) + Math.PI / 2;
          group.add(m);
          lamps.push({ mesh: m, node: n.id, seg: leg.seg.id, col });
        });
        // dotted guides for right turns only (the ones that cross the junction), as UK junctions have
        lanes.forEach((mv, i) => {
          if (!mv.includes('R')) return;
          const to = legs.find((o) => o !== leg && turnSign(leg, o) > 0.55);
          if (!to) return;
          const c = laneCentre(net, leg.seg, i);
          const co = laneCentre(net, to.seg, net.def(to.seg).lanes - 1);
          const A0 = W(lineAt, c);
          const r1 = sh.mouth[to.seg.id] ?? 0, ft = frame(to), b1 = legAt(n, ft, r1, -co);
          const B0 = [b1.x, b1.z];
          const k = Math.hypot(B0[0] - A0[0], B0[1] - A0[1]) * 0.45, ua = legDir(fl, lineAt), ub = legDir(ft, r1);
          const c1 = [A0[0] - ua.x * k, A0[1] - ua.z * k], c2 = [B0[0] - ub.x * k, B0[1] - ub.z * k];
          const pts: P[] = [];
          for (let t = 0; t <= 1.0001; t += 1 / 16) { const u = 1 - t; pts.push({ x: u * u * u * A0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * B0[0], z: u * u * u * A0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * B0[1], y }); }
          mk.dashes(pts, () => 0, 0.5, pathLength(pts) - 0.5, 0.8, 1, 0.07, 0.36);
        });
      }
    }
    const fls = legs.map(frame);
    // (an arm is this junction's road only as far as the junction at its other end starts)
    const farMouth = (l: ShapeLeg) => { const sg = net.segs.get(l.id)!, far = sg.a === n.id ? sg.b : sg.a; return junctions.get(far)?.shape?.mouth[l.id] ?? 0; };
    const reach = new Map(fls.map((l) => [l.id, l.len - farMouth(l)]));
    const onRoad = (x: number, z: number) => {
      const p = { x, z };
      if (sh.islands.some((q) => inPoly(p, q))) return false;
      if (j.form === 'roundabout' && Math.hypot(x - n.x, z - n.z) < sh.island + 0.1) return false;
      let on = sh.aprons.some((q) => inPoly(p, q));
      for (const l of fls) {
        const f = legFrameOf(n, l, p), d = l.def, kerbedMedian = d.median > 0 && d.medianKind !== 'hatch';
        if (kerbedMedian && f.a >= (sh.medianTrim[l.id] ?? 0) - 0.05 && Math.abs(f.b) < d.median / 2 && f.a < l.len) return false;
        if (f.a >= (sh.mouth[l.id] ?? 0) - 0.5 && f.a <= reach.get(l.id)! && Math.abs(f.b) <= kerbOf(d) - 0.03) on = true;
      }
      return on;
    };
    // (kept or dropped whole: a quad's two triangles, which share an edge, go together)
    for (const [src, dst] of [[mk, lines], [mka, asph]] as const) {
      const P = src.pos, shared = (i: number, k: number) => { let c = 0; for (let a = 0; a < 9; a += 3) for (let b = 0; b < 9; b += 3) if (P[i + a] === P[k + b] && P[i + a + 2] === P[k + b + 2]) c++; return c >= 2; };
      for (let i = 0; i < P.length;) {
        let e = i + 9;
        if (e < P.length && shared(i, e)) e += 9;
        let ok = true;
        for (let k = i; k < e && ok; k += 3) ok = onRoad(P[k], P[k + 2]);
        if (ok) for (let k = i; k < e; k++) dst.pos.push(P[k]);
        i = e;
      }
    }
    if (j.form === 'roundabout') {
      // central island: kerbed, grassed, a little planting
      const Ri = sh.island;
      island.disc(n, Ri, 0.45, 28);
      for (let k = 0; k < 28; k++) {
        const a0 = (k / 28) * Math.PI * 2, a1 = ((k + 1) / 28) * Math.PI * 2;
        const p = [n.x + Math.cos(a0) * Ri, n.z + Math.sin(a0) * Ri], q = [n.x + Math.cos(a1) * Ri, n.z + Math.sin(a1) * Ri];
        kerbs.quad([p[0], y + 0.25, p[1]], [q[0], y + 0.25, q[1]], [q[0], y + 0.45, q[1]], [p[0], y + 0.45, p[1]]);
      }
      if (Ri > 5) for (let k = 0; k < 3; k++) { const a = k * 2.1; tree(n.x + Math.cos(a) * Ri * 0.4, y + 0.45, n.z + Math.sin(a) * Ri * 0.4, 0.8); }
      if (legs.some((l) => l.lanes > 1)) {
        const ringPts: P[] = [];
        const rr = (Ri + sh.R) / 2;
        for (let k = 0; k <= 64; k++) { const a = (k / 64) * Math.PI * 2; ringPts.push({ x: n.x + Math.cos(a) * rr, z: n.z + Math.sin(a) * rr, y }); }
        lines.dashes(ringPts, () => 0, 0, pathLength(ringPts), 2, 2, 0.07, 0.35);
      }
    }
    if (j.form === 'mini') {
      // a mini-roundabout: a white domed disc you can drive over
      lines.disc(n, 2, 0.34, 20);
      asph.disc(n, 1.6, 0.35, 20);
      lines.disc(n, 1.2, 0.36, 20);
    }
    const sl = sh.slip;
    if (sl) {
      // the slip road, its outside footway, edge lines, and the give-way where it rejoins
      const sp = sl.path.map((p) => ({ ...p, y }));
      const w = STD.slipWidth / 2, mid = sp[Math.floor(sp.length / 2)], nx = sp[Math.floor(sp.length / 2) + 1];
      const outside = (sl.centre.x - mid.x) * (nx.z - mid.z) - (sl.centre.z - mid.z) * (nx.x - mid.x) > 0 ? 1 : -1;
      asph.strip(sp, () => [-w, w], 0.26);
      (noPave ? verge : pave).strip(sp, () => (outside > 0 ? [w, w + STD.slipFootway] : [-w - STD.slipFootway, -w]), 0.16);
      for (const o of [-w + 0.2, w - 0.2]) lines.strip(sp, () => [o - 0.07, o + 0.07], 0.37);
      const L2 = pathLength(sp), e = pointAt(sp, L2 - 7);
      for (const off of [0, 0.6]) for (let b = -w + 0.3; b < w - 0.3; b += 0.9) {
        const p0 = [e.x - e.ux * off + e.uz * b, e.z - e.uz * off - e.ux * b], p1 = [e.x - e.ux * (off + 0.3) + e.uz * b, e.z - e.uz * (off + 0.3) - e.ux * b];
        const p2 = [p1[0] + e.uz * 0.6, p1[1] - e.ux * 0.6], p3 = [p0[0] + e.uz * 0.6, p0[1] - e.ux * 0.6];
        lines.tri(p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], y + 0.37);
        lines.tri(p0[0], p0[1], p2[0], p2[1], p3[0], p3[1], y + 0.37);
      }
    }
  }

  const add = (f: Flat | Solid, m: THREE.Material, order = 0) => { if (f.pos.length) { const mesh = f.mesh(m); mesh.renderOrder = order; group.add(mesh); return mesh; } return null; };
  add(pave, paveMat); add(asph, asphaltMat); add(lines, lineMat); add(verge, vergeMat); add(median, medianMat); add(yellow, yellowMat);
  add(bus, busMat); add(cyc, cycleMat); add(bays, bayMat); add(hint, hintMat); add(tactileBuff, tactileBuffMat); add(tactileRed, tactileRedMat);
  add(ballast, ballastMat); add(sleepers, sleeperMat); add(railsF, railMat); add(rack, rackMat); add(wires, poleMat);
  add(island, islandMat); add(kerbs, kerbMat); add(poles, poleMat); add(portal, portalMat);
  parked.forEach((p, i) => add(p, carCols[i]));
  add(cut, cutMat); add(body, concreteMat); add(rails, parapetMat); add(barrier, barrierMat);
  add(furn.glass, shelterGlass); add(furn.frame, shelterFrame); add(furn.red, stopRed); add(beacons, beaconWhite);
  if (globes.length) { const g = mergeGeometries(globes.map((x) => x.toNonIndexed())); for (const x of globes) x.dispose(); if (g) group.add(new THREE.Mesh(g, beaconGlobe)); }
  const hm = add(holes, holeMat, -10);
  if (hm) { hm.receiveShadow = false; hm.castShadow = false; }
  if (boards.pos.length) group.add(boards.mesh(chevronMat()));
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
