// Drawing the road and rail network: cross-sections, markings, junctions, bridges, cuttings
// and tunnels, stops. Everything is batched into a handful of meshes per material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BAY, ROADS, bayWeight, closestOnPath, kerbOf, pointAt, stopSpan, subPath, pathLength, type Network, type P, type RSeg, type RoadType } from './roads';
import { junctionLift, legsAt, type Junction } from './junction';
import { STD } from './standards';
import { legAt, legDir, legFrameOf, ringA, type ShapeLeg } from './jshape';
import { TAPER, courseOf, normals, type Course, type Section2 } from './xsection';
import type { XZ } from './land';
import type { RoadDef } from './catalog';

export const paveMat = new THREE.MeshLambertMaterial({ color: '#bdb8ad', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
export const asphaltMat = new THREE.MeshLambertMaterial({ color: '#484c52', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
export const lineMat = new THREE.MeshLambertMaterial({ color: '#f1f1f1', polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

// While a junction on a slope is being drawn, its height above the node at (x, z) (junctionLift):
// everything laid on it is lifted onto that surface as it's added. Null otherwise.
let lift: ((x: number, z: number) => number) | null = null;
const up = (x: number, z: number) => (lift ? lift(x, z) : 0);
// The surface is taken at the corners of a fixed grid of triangles (LG metres, each square split
// corner to corner) and is flat within each, and whatever's laid on it is cut along the grid. So a
// junction's overlapping pieces (drawn as their union) lie on exactly the same planes wherever they
// overlap, however each was triangulated, and never fight for the same pixels.
const LG = 1.5;
function gridded(f: (x: number, z: number) => number) {
  const cache = new Map<number, number>();
  const at = (i: number, j: number) => { const k = i * 131071 + j; let v = cache.get(k); if (v === undefined) cache.set(k, (v = f(i * LG, j * LG))); return v; };
  return (x: number, z: number) => {
    const u = x / LG, v = z / LG, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    if (fu + fv <= 1) return at(i, j) + (at(i + 1, j) - at(i, j)) * fu + (at(i, j + 1) - at(i, j)) * fv;
    return at(i + 1, j + 1) + (at(i, j + 1) - at(i + 1, j + 1)) * (1 - fu) + (at(i + 1, j) - at(i + 1, j + 1)) * (1 - fv);
  };
}
// the part of polygon `poly` (grid units) where a·u + b·v ≤ c
function clipHalf(poly: [number, number][], a: number, b: number, c: number) {
  const out: [number, number][] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length], dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

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
    // (on a sloping junction, cut along the grid its surface is flat within)
    if (lift) {
      const T: [number, number][] = [[x0 / LG, z0 / LG], [x1 / LG, z1 / LG], [x2 / LG, z2 / LG]];
      const i0 = Math.floor(Math.min(T[0][0], T[1][0], T[2][0])), i1 = Math.floor(Math.max(T[0][0], T[1][0], T[2][0]));
      const j0 = Math.floor(Math.min(T[0][1], T[1][1], T[2][1])), j1 = Math.floor(Math.max(T[0][1], T[1][1], T[2][1]));
      const L = lift;
      lift = null; // (the pieces are flat within their grid triangle: lift them by its plane, once)
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const upper of [false, true]) {
        let q = upper ? clipHalf(clipHalf(clipHalf(T, 1, 0, i + 1), 0, 1, j + 1), -1, -1, -(i + j + 1)) : clipHalf(clipHalf(clipHalf(T, -1, 0, -i), 0, -1, -j), 1, 1, i + j + 1);
        if (q.length < 3) continue;
        q = q.map(([u, v]) => [u * LG, v * LG]);
        const h = q.map(([x, z]) => y + L(x, z));
        for (let k = 1; k + 1 < q.length; k++) this.tri3(q[0][0], h[0], q[0][1], q[k][0], h[k], q[k][1], q[k + 1][0], h[k + 1], q[k + 1][1]);
      }
      lift = L;
      return;
    }
    const cross = (x1 - x0) * (z2 - z0) - (z1 - z0) * (x2 - x0);
    if (cross > 0) this.pos.push(x0, y, z0, x2, y, z2, x1, y, z1);
    else this.pos.push(x0, y, z0, x1, y, z1, x2, y, z2);
  }
  // same, for a triangle that may slope
  tri3(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) {
    if (lift) { y0 += lift(x0, z0); y1 += lift(x1, z1); y2 += lift(x2, z2); }
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
  quad(a: number[], b: number[], c: number[], d: number[]) {
    if (lift) [a, b, c, d] = [a, b, c, d].map((p) => [p[0], p[1] + lift!(p[0], p[2]), p[2]]);
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
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
// `open`: where the road's edge opens into a junction (another road leaving it): no wall or parapet there.
export function structures(path: P[], body: Solid, rails: Solid | null, HALF: number, bridged?: [number, number][], open?: (x: number, z: number) => boolean) {
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
      // (just outside the edge: is that the junction, running on beyond this road?)
      if (open?.((e0[0] + e1[0]) / 2 + (s0.x + s1.x) * 0.25 * k, (e0[1] + e1[1]) / 2 + (s0.z + s1.z) * 0.25 * k)) continue;
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
// The give-way line's paint: a strip laid along the line carrying a texture of its dashes (two rows,
// or one at a mini-roundabout), so it's filtered like any texture. Drawn dash by dash the dashes are
// a pixel or two across at an ordinary zoom and break up into dots of every shape and size; this
// way they stay even at every zoom, and fade into a plain line when they're too small to see.
// One period of the texture along the line is a dash and a gap; across it, the rows and the space.
let giveWayTex: THREE.Material | null = null;
const giveWayMat = () => (giveWayTex ??= (() => {
  const base = { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 };
  if (typeof document === 'undefined') return lit('#f1f1f1', base);
  const G = STD.giveWay, P = G.dash + G.gap, H = 2 * G.width + G.apart;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f1f1f1';
  const dw = (128 * G.dash) / P, rh = (64 * G.width) / H;
  x.fillRect(0, 0, dw, rh); x.fillRect(0, 64 - rh, dw, rh);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return lit('#ffffff', { map: t, ...base });
})());
class Painted {
  pos: number[] = []; uv: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
    // (kept facing up)
    const up = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]) < 0;
    if (up) { this.pos.push(...a, ...b, ...c, ...a, ...c, ...d); this.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); }
    else { this.pos.push(...a, ...c, ...b, ...a, ...d, ...c); this.uv.push(...ua, ...uc, ...ub, ...ua, ...ud, ...uc); }
  }
  mesh(m: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
  }
}
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
  return d.lanes > 1 ? d.median / 2 + (d.lanes - 1 - i + 0.5) * d.lane : d.median / 2 + d.lane / 2;
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

// Stretches of a railway's course that rail/draw.ts lays itself (a station's passing loop, the
// tracks spreading round an island platform), as the points they run between. None by default.
export let trackSkip: (s: RSeg) => [XZ, XZ][] = () => [];
export function setTrackSkip(f: (s: RSeg) => [XZ, XZ][]) { trackSkip = f; }
// the railway's materials, for rail/draw.ts to lay its own track in
export const RAIL_MATS = { ballast: ballastMat, sleeper: sleeperMat, rail: railMat, verge: vergeMat };

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
  const giveWay = new Painted(); // (give-way lines: see giveWayMat)
  const tree = (x: number, y: number, z: number, s = 1) => trees.push(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 3 * s, 5).translate(x, y + 1.5 * s, z), new THREE.IcosahedronGeometry(2.2 * s, 0).translate(x, y + 4.4 * s, z));
  const courses = new Map<number, Course>();

  // the land junctions pave beyond the roads meeting there (where a raised road's walls and parapets stop)
  const jland: { box: [number, number, number, number]; polys: XZ[][] }[] = [];
  for (const [id, j] of junctions) {
    if (!j.shape || !net.nodes.has(id) || net.segsAt(id).length < 3) continue;
    const polys = [...j.shape.aprons, ...j.shape.paves], all = polys.flat();
    jland.push({ box: [Math.min(...all.map((p) => p.x)), Math.min(...all.map((p) => p.z)), Math.max(...all.map((p) => p.x)), Math.max(...all.map((p) => p.z))], polys });
  }
  const inJunction = (x: number, z: number) => jland.some((l) => x >= l.box[0] && x <= l.box[2] && z >= l.box[1] && z <= l.box[3] && l.polys.some((q) => inPoly({ x, z }, q)));
  for (const s of net.segs.values()) {
    const d = net.def(s), path = finePath(net, s), A = arcs(path), L = A[A.length - 1];

    const half = net.half(s);
    // (a raised stretch the library couldn't bridge keeps the old deck on piers, not walls to the ground)
    structures(path, body, rails, half, s.bridges ? s.bridges.map((b) => [b.s0, b.s1] as [number, number]) : path.every((p) => (p.y ?? 0) <= 6) ? [] : undefined, inJunction); // bridges: game/bridges.ts
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
      // (not where a station moves the tracks over: rail/draw.ts lays those, see trackSkip)
      const skip = trackSkip(s).map(([a, b]) => [closestOnPath(a, cp).s, closestOnPath(b, cp).s].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
      const runs: [number, number][] = [];
      let r0 = 0;
      for (const [a, b] of skip) { if (a > r0 + 0.5) runs.push([r0, a]); r0 = Math.max(r0, b); }
      if (CL > r0 + 0.5) runs.push([r0, CL]);
      const tracks = d.tracks === 2 ? [-2, 2] : [0];
      for (const [a, b] of runs) {
        const qr = skip.length ? part(a, b) : q;
        band(ballast, qr, () => [-K, K], 0.2);
        for (const c of tracks) {
          sleepers.dashes(cp, () => c, a + 0.2, b - 0.2, 0.26, 0.42, 1.3, 0.3);
          for (const r of [-0.72, 0.72]) band(railsF, qr, () => [c + r - 0.05, c + r + 0.05], 0.44);
          if (d.rack) band(rack, qr, () => [c - 0.07, c + 0.07], 0.46);
          if (d.electric) band(wires, qr, () => [c - 0.03, c + 0.03], 5.8);
        }
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
    for (const [a, b] of runs((q) => C.sec(q).median < 0.05, c0, c1)) dashRun(lines, cp, (q) => { const x = S(q); return (x.L.lane - x.R.lane) / 2; }, a, b, 3, 3, 0.07, 0.35, ...anchor(a, b));
    // lane lines: where a lane tapers away, its line closes in on the reservation's edge line
    for (const k of [1, -1] as const) for (let j = 1; j < d.lanes; j++) {
      const off = (q: number) => { const x = S(q), sd = k === 1 ? x.L : x.R, n = x.x.lanes; return k * (x.x.median + ((sd.lane - x.x.median) * (n - j)) / n); };
      for (const [a, b] of runs((q) => C.sec(q).lanes - j > 0.12, l0, l1)) dashRun(lines, cp, off, a, b, 4, 5, 0.07, 0.35, ...anchor(a, b));
    }
    // kerbside lanes (bus lanes, cycle lanes, parking), only where the road has its own full width
    const T = C.taper, k0 = C.rhoOf(T.A ? TAPER.median * T.A.len : 0), k1 = C.rhoOf(L - (T.B ? TAPER.median * T.B.len : 0));
    const ks0 = Math.max(s0, k0), ks1 = Math.min(s1, k1), kl0 = Math.max(l0, k0), kl1 = Math.min(l1, k1);
    for (const k of [1, -1] as const) {
      const S2 = (x: ReturnType<typeof S>) => (k === 1 ? x.L : x.R);
      const span = (a: number, b: number) => (k === 1 ? [a, b] : [-b, -a]) as [number, number];
      if (d.shoulder) solid(lines, l0, l1, (q) => k * S2(S(q)).lane, 0.1);
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
    for (const Tp of [T.A, T.B]) if (Tp) {
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
    // street trees along wide pavements, clear of junctions and stops
    if (d.pave >= 5) for (const k of [1, -1]) for (let t = (k === 1 ? ends.L : ends.R)[0] + 8; t < CL - (k === 1 ? ends.L : ends.R)[1] - 4; t += 14) {
      if (s.stops.some((st) => { const [a, b] = stopSpan(st).map((q) => C.rhoOf(q)); return st.side === k && t > a - 6 && t < b + 6; })) continue;
      const x = S(t), side = k === 1 ? x.L : x.R;
      if (side.back - side.kerb < 3) continue;
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
    lift = null;
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
    // on a slope, the whole junction lies on the plane its roads arrive on (junctionLift)
    { const f = junctionLift(net, n.id, sh.mouth); lift = f && gridded(f); }
    for (const q of sh.paves) (noPave ? verge : pave).poly(q, y + 0.15);
    for (const q of sh.aprons) asph.poly(q, y + 0.25);
    for (const isl of sh.islands) {
      kerbed(isl, y);
      // a keep-left bollard at the end facing oncoming traffic
      if (isl.length === 3) { const b0 = { x: (isl[0].x + isl[1].x) / 2 * 0.8 + isl[2].x * 0.2, z: (isl[0].z + isl[1].z) / 2 * 0.8 + isl[2].z * 0.2 }; kerbs.box(b0.x, b0.z, 1, 0, 0.18, 0.18, y + 0.4, y + 1.3); }
    }
    const legs = legsAt(net, n.id);
    const ring = j.form === 'roundabout' || j.form === 'mini';
    // (a junction's markings are drawn here first, and kept only where they lie on its carriageway:
    // clear of footways, islands and reservations however awkwardly its roads meet)
    const mk = new Flat(), mka = new Flat();
    const frame = (l: typeof legs[number]): ShapeLeg => ({ id: l.seg.id, dir: l.dir, ang: l.ang, def: net.def(l.seg), len: l.len, path: l.path });
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
    // A junction off the ground stands on walls down to the ground round its outline (bridges stop
    // short of it, and its roads' last stretches are walled too), except where a road runs on from
    // it (the road draws its own).
    {
      const L = lift, hAt = (p: XZ) => y + (L ? L(p.x, p.z) : 0), pts = sh.pave;
      if (pts.some((p) => hAt(p) > 0.05)) {
        lift = null;
        const own = (m: XZ) => fls.some((l) => { const f = legFrameOf(n, l, m); return f.a > 0.3 && Math.abs(f.b) < net.half(net.segs.get(l.id)!) + 0.3; });
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k], q = pts[(k + 1) % pts.length];
          if (Math.hypot(q.x - p.x, q.z - p.z) < 0.01 || own({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 })) continue;
          // (in pieces of a metre or two, so its top follows the junction's surface)
          const m = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 2);
          for (let i = 0; i < m; i++) {
            const u = { x: p.x + ((q.x - p.x) * i) / m, z: p.z + ((q.z - p.z) * i) / m }, v = { x: p.x + ((q.x - p.x) * (i + 1)) / m, z: p.z + ((q.z - p.z) * (i + 1)) / m };
            const tu = hAt(u) + 0.15, tv = hAt(v) + 0.15;
            if (tu < 0.2 && tv < 0.2) continue;
            body.quad([u.x, 0, u.z], [v.x, 0, v.z], [v.x, tv, v.z], [u.x, tu, u.z]);
          }
        }
        lift = L;
      }
    }
    for (const leg of legs) {
      // `a` out along the road as drawn and `b` across it (+b the side traffic arrives on)
      const fl = frame(leg);
      const W = (a: number, b: number) => { const p = legAt(n, fl, a, b); return [p.x, p.z] as const; };
      const rect = (f: Flat, a0: number, a1: number, b0: number, b1: number, yy: number) => { const p = [W(a0, b0), W(a1, b0), W(a1, b1), W(a0, b1)]; f.tri(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], y + yy); f.tri(p[0][0], p[0][1], p[2][0], p[2][1], p[3][0], p[3][1], y + yy); };
      const triW = (f: Flat, pts: [number, number][], yy: number) => { const q = pts.map(([a, b]) => W(a, b)); f.tri(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], y + yy); };
      const d = net.def(leg.seg), kIn = kerbOf(d);
      // at a roundabout the give-way line follows the edge of the ring
      const lineAtB = (b: number) => (ring ? ringA(n, fl, b, sh.R) + 0.3 : sh.line[leg.seg.id] ?? 0);
      const lineAt = lineAtB((d.median / 2 + kIn) / 2);
      const approaches = !(j.form === 'priority' && j.major.includes(leg.seg.id));
      // a solid stop line across the incoming half at signals; elsewhere the give-way line, right
      // across the entry as it is where the line is (a roundabout's entry flares out to the ring):
      // from the splitter island (or the centre) to the kerb, whole dashes only
      if (j.form === 'signals') rect(mk, lineAt, lineAt + 0.3, d.median / 2 + 0.2, kIn - 0.1, 0.36);
      else if (approaches) {
        const G = STD.giveWay, P = G.dash + G.gap, H = 2 * G.width + G.apart, single = j.form === 'mini';
        const wide = single ? G.width : H, v1 = single ? G.width / H : 1; // (the strip's width, and how much of the texture across)
        const b0 = Math.max(d.median / 2, sh.splitter[leg.seg.id] ? STD.splitter.width / 2 : 0) + 0.15;
        // the line's k-th period, as the four corners of its dash across the strip's width: [near start,
        // near end, far end, far start] in (x, z); a dash is painted where it lies wholly on the carriageway
        let corners: (k: number, f: number) => (readonly [number, number])[];
        if (ring) {
          // at a roundabout it's an arc round the ring's edge
          const Rg = sh.R + 0.3, at = (r: number, t: number) => [n.x + Math.cos(t) * r, n.z + Math.sin(t) * r] as const;
          const p0 = legAt(n, fl, lineAtB(b0), b0), p1 = legAt(n, fl, lineAtB(b0 + 1), b0 + 1);
          const t0 = Math.atan2(p0.z - n.z, p0.x - n.x), dir = Math.sign(Math.sin(Math.atan2(p1.z - n.z, p1.x - n.x) - t0)) || 1;
          corners = (k, f) => { const ta = t0 + (dir * k * P) / Rg, tb = ta + (dir * f * P) / Rg; return [at(Rg, ta), at(Rg, tb), at(Rg + wide, tb), at(Rg + wide, ta)]; };
        } else {
          // elsewhere straight across the road, where its line is
          corners = (k, f) => { const b = b0 + k * P, b1 = b + f * P, la = lineAtB(b); return [W(la, b), W(la, b1), W(la + wide, b1), W(la + wide, b)]; };
        }
        const good: number[] = [];
        for (let k = 0; k * P < kIn + 15; k++) {
          if (corners(k, G.dash / P).every((q) => onRoad(q[0], q[1]))) good.push(k);
          else if (k * P > kIn - b0) break;
        }
        // each period from its dash to the next dash (the last ends with its dash), the texture's
        // u running on continuously; in pieces a few tenths of a metre long, to follow the ring and
        // any slope
        for (const k of good) {
          const f = good.includes(k + 1) ? 1 : G.dash / P, m = Math.max(1, Math.ceil((f * P) / 0.3));
          for (let i = 0; i < m; i++) {
            const fa = (f * i) / m, fb = (f * (i + 1)) / m, A = corners(k + fa, 0)[0], A2 = corners(k + fa, 0)[3], B = corners(k + fb, 0)[0], B2 = corners(k + fb, 0)[3];
            const Y = (q: readonly [number, number]) => [q[0], y + 0.365 + up(q[0], q[1]), q[1]];
            giveWay.quad(Y(A), Y(B), Y(B2), Y(A2), [k + fa, 0], [k + fb, 0], [k + fb, v1], [k + fa, v1]);
          }
        }
      }
      // the give-way triangle in each approach lane, its point towards the oncoming driver
      if (approaches && j.form !== 'signals') {
        const T = STD.giveWayTriangle(d.mph), hw = T.width / 2, e = 0.15; // (e: the outline's width)
        for (let i = 0; i < d.lanes; i++) {
          const c = laneCentre(net, leg.seg, i), a0 = lineAtB(c) + T.back, a1 = a0 + T.length;
          if (a1 > leg.len - 2) continue;
          triW(mk, [[a0, c - hw], [a0, c + hw], [a1, c]], 0.36);
          // (the inside, in road colour, a stroke in from every edge: the point is long and thin, so
          // it steps back further there)
          const ti = e * (1 + (2 * T.length) / T.width);
          triW(mka, [[a0 + e, c - hw + e * 1.6], [a0 + e, c + hw - e * 1.6], [a1 - ti, c]], 0.37);
        }
      }
      // lane arrows, a pair per approach lane
      const lanes = j.lanes[leg.seg.id] ?? [];
      // arrows only where lanes actually divide the traffic (not on a plain single-lane approach)
      const arrows = lanes.length > 1 || j.form === 'signals' || n.id === editing;
      if (arrows) lanes.forEach((mv, i) => {
        const c = laneCentre(net, leg.seg, i), la = Math.max(lineAtB(c), sh.mouth[leg.seg.id] ?? 0);
        // (behind the give-way triangle, if the lane has one)
        const T = STD.giveWayTriangle(d.mph), first = approaches && j.form !== 'signals' ? lineAtB(c) + T.back + T.length + 6 : la + 9;
        for (const at of [first, first + 17]) {
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
          m.position.set(f[0], y + up(f[0], f[1]) + 3.15 - i * 0.33, f[1]);
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
      if (Ri > 5) for (let k = 0; k < 3; k++) { const a = k * 2.1, tx = n.x + Math.cos(a) * Ri * 0.4, tz = n.z + Math.sin(a) * Ri * 0.4; tree(tx, y + up(tx, tz) + 0.45, tz, 0.8); }
      // (a lane line round the ring only where it's wide enough for two lanes to circulate)
      if (sh.R - Ri >= 8) {
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
  add(bus, busMat); add(cyc, cycleMat); add(bays, bayMat); add(hint, hintMat);
  add(ballast, ballastMat); add(sleepers, sleeperMat); add(railsF, railMat); add(rack, rackMat); add(wires, poleMat);
  add(island, islandMat); add(kerbs, kerbMat); add(poles, poleMat); add(portal, portalMat);
  parked.forEach((p, i) => add(p, carCols[i]));
  lift = null;
  add(cut, cutMat); add(body, concreteMat); add(rails, parapetMat); add(barrier, barrierMat);
  add(furn.glass, shelterGlass); add(furn.frame, shelterFrame); add(furn.red, stopRed);
  const hm = add(holes, holeMat, -10);
  if (hm) { hm.receiveShadow = false; hm.castShadow = false; }
  if (boards.pos.length) group.add(boards.mesh(chevronMat()));
  if (giveWay.pos.length) group.add(giveWay.mesh(giveWayMat()));
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
