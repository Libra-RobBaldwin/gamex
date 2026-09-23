// Free-form road network in metres: nodes + segments (straight, or curved as a sampled polyline),
// snapping, junction splitting, and building plots laid out along both sides of every road.

// Road types by cross-section. Widths are per side of the centreline: half the central
// reservation, the lanes in one direction, a hard shoulder, then pavement or grass verge.
export type RoadType = 'street' | 'avenue' | 'dual' | 'motorway';
export interface RoadDef {
  label: string; icon: string; lanes: number; lane: number; median: number; shoulder: number; pave: number; verge: number;
  speed: number; cost: number; minR: number; maxGrade: number; frontage: boolean; trees: boolean; blurb: string;
}
export const ROADS: Record<RoadType, RoadDef> = {
  street: { label: 'Street', icon: '🏘️', lanes: 1, lane: 3.25, median: 0, shoulder: 0, pave: 2.4, verge: 0, speed: 13.4, cost: 250, minR: 14, maxGrade: 0.08, frontage: true, trees: false, blurb: '1 lane each way · 2.4 m pavements · 30 mph' },
  avenue: { label: 'Avenue', icon: '🌳', lanes: 1, lane: 3.5, median: 0, shoulder: 0, pave: 5, verge: 0, speed: 13.4, cost: 480, minR: 25, maxGrade: 0.07, frontage: true, trees: true, blurb: '1 lane each way · 5 m tree-lined pavements · 30 mph' },
  dual: { label: 'Dual', icon: '🛣️', lanes: 2, lane: 3.5, median: 2.4, shoulder: 0, pave: 2.6, verge: 0, speed: 22, cost: 1300, minR: 60, maxGrade: 0.06, frontage: true, trees: false, blurb: '2 lanes each way · central barrier · 50 mph' },
  motorway: { label: 'Motorway', icon: '🚀', lanes: 3, lane: 3.65, median: 3, shoulder: 3.3, pave: 0, verge: 3, speed: 31, cost: 2800, minR: 180, maxGrade: 0.05, frontage: false, trees: false, blurb: '3 lanes each way · hard shoulders · no frontage or stops · 70 mph' },
};
// centreline to the kerb (edge of the carriageway, including any hard shoulder)
export const kerbOf = (d: RoadDef) => d.median / 2 + d.lanes * d.lane + d.shoulder;
// centreline to the back of the pavement or verge
export const halfOf = (d: RoadDef) => kerbOf(d) + d.pave + d.verge;
export const HALF = halfOf(ROADS.street);
export const ROAD_W = kerbOf(ROADS.street) * 2;
export const MIN_LEN = 10;
export const MIN_RADIUS = 14; // tightest curve any road can take

// Bus stops. A lay-by is 3 m deep and 35 m long: an entry taper, room for a bus, an exit taper.
export const BAY = { entry: 12, stand: 15, exit: 8, depth: 3 };
export const MIN_FOOTWAY = 2, MIN_LANE = 3;
export interface Stop { id: number; s: number; side: 1 | -1; kind: 'kerb' | 'layby'; take: { pave: number; lane: number; land: number } }
// where along its road a stop's lay-by (or kerb markings) runs, entry taper first in the bus's direction
export function stopSpan(st: Stop): [number, number] {
  const before = BAY.entry + BAY.stand / 2, after = BAY.stand / 2 + BAY.exit;
  return st.side === 1 ? [st.s - before, st.s + after] : [st.s - after, st.s + before];
}
// how far into its full depth a lay-by is at distance t along the road (0 outside, 1 at the stand)
export function bayWeight(st: Stop, t: number) {
  const d = st.side === 1 ? t - st.s : st.s - t; // along the bus's direction, from the stand's middle
  const h = BAY.stand / 2;
  if (d < -h - BAY.entry || d > h + BAY.exit) return 0;
  if (d < -h) return (d + h + BAY.entry) / BAY.entry;
  if (d > h) return 1 - (d - h) / BAY.exit;
  return 1;
}
export interface StopPlan { kind: 'kerb' | 'layby'; ok: boolean; title: string; notes: string[]; cost: number; take: Stop['take']; lots: Lot[]; blocked?: string }
export const CLEAR_COST = 6000; // compulsory purchase per building
export const RAISE_COST = 170; // extra per metre of road, per metre it's raised (embankment low, viaduct high)

import { GRADES, heightAt, solveProfile, type HeightMode, type Limit, type Profile, type Spec } from './grade';
export type { HeightMode } from './grade';

export interface RNode { id: number; x: number; z: number; y: number }
// `mid` holds the interior points of a curved road, in order from a to b (empty when straight)
export interface RSeg { id: number; a: number; b: number; mid: P[]; type: RoadType; stops: Stop[] }
export type LotKind = 'house' | 'terrace' | 'shop' | 'flats' | 'office' | 'tower' | 'industry' | 'civic';
// `row` identifies the run of plots along one side of one street, so neighbours can share a style
// The building sits at (x, z) facing the road; its plot (parcel) runs from the back of the pavement
// (`front` metres in front of the building) to `back` metres behind it, and is `pw` wide, centred
// `px` along from the building (the side gap holds a driveway or path).
export interface Lot {
  id: number; x: number; z: number; rot: number; w: number; d: number; h: number; kind: LotKind; seg: number; seed: number; row: number;
  front: number; back: number; px: number; pw: number;
  arch?: string; // chosen use for civic buildings (church, pub, school...)
}
export type Zone = 'town' | 'industrial';
const BACK: Record<LotKind, number> = { house: 14, terrace: 8, shop: 7, flats: 14, office: 13, tower: 10, industry: 16, civic: 10 };

// y is height above the ground in metres (0 when missing)
export interface P { x: number; z: number; y?: number }
export interface End extends P { node?: number; seg?: number }

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function closestOnSeg(p: P, a: P, b: P) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
  const q = { x: a.x + dx * t, z: a.z + dz * t };
  return { t, x: q.x, z: q.z, d: dist(p, q) };
}

// Crossing of two line pieces; `inclusive` also counts touching at the ends.
export function intersect(a: P, b: P, c: P, d: P, inclusive = false) {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  const e = inclusive ? -1e-9 : 1e-6;
  if (t <= e || t >= 1 - e || u <= e || u >= 1 - e) return null;
  return { t, u, x: a.x + r.x * t, z: a.z + r.z * t };
}

// ---------- polylines ----------
export function pathLength(path: P[]) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += dist(path[i - 1], path[i]);
  return L;
}

// Point and unit direction at arc length s along a path.
export function pointAt(path: P[], s: number) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = dist(a, b);
    if (s <= L || i === path.length - 1) {
      const t = L ? Math.max(0, Math.min(1, s / L)) : 0;
      const ya = a.y ?? 0, yb = b.y ?? 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: ya + (yb - ya) * t, ux: (b.x - a.x) / (L || 1), uz: (b.z - a.z) / (L || 1), grade: (yb - ya) / (L || 1) };
    }
    s -= L;
  }
  const p = path[0];
  return { x: p.x, z: p.z, y: p.y ?? 0, ux: 1, uz: 0, grade: 0 };
}

// Closest point on a path, with its arc length.
export function closestOnPath(p: P, path: P[]) {
  let best = { d: Infinity, x: 0, z: 0, y: 0, s: 0, ux: 1, uz: 0 };
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = dist(a, b);
    const c = closestOnSeg(p, a, b);
    if (c.d < best.d) best = { d: c.d, x: c.x, z: c.z, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * c.t, s: acc + c.t * L, ux: (b.x - a.x) / (L || 1), uz: (b.z - a.z) / (L || 1) };
    acc += L;
  }
  return best;
}

// The part of a path between arc lengths s0 and s1 (both ends included).
export function subPath(path: P[], s0: number, s1: number): P[] {
  const out: P[] = [pointAt(path, s0)];
  let acc = 0;
  for (let i = 1; i < path.length - 1; i++) {
    acc += dist(path[i - 1], path[i]);
    if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(path[i]);
  }
  out.push(pointAt(path, s1));
  return out.map((q) => ({ x: q.x, z: q.z, y: q.y ?? 0 }));
}

// Extra points so a height profile can be carried along long straight pieces.
export function densify(path: P[], step: number): P[] {
  const out: P[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

// Quadratic Bézier from a to b pulled towards control point c (the Cities: Skylines curve tool).
export function bezier(a: P, c: P, b: P): P[] {
  const approx = dist(a, c) + dist(c, b);
  const n = Math.max(4, Math.min(48, Math.ceil(approx / 6)));
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z });
  }
  return out;
}

// Tightest turning radius along a path (Infinity when straight).
export function minRadius(path: P[]) {
  let r = Infinity;
  for (let i = 1; i + 1 < path.length; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (area2 < 1e-9) continue;
    r = Math.min(r, (dist(a, b) * dist(b, c) * dist(a, c)) / (2 * area2));
  }
  return r;
}

// Corners of a rectangle centred at (x,z), rotated by rot, w along the rotation, d across.
export function rectCorners(x: number, z: number, rot: number, w: number, d: number): P[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: x + c * (w / 2) * i - s * (d / 2) * j, z: z + s * (w / 2) * i + c * (d / 2) * j }));
}

function project(poly: P[], ax: P) {
  let lo = Infinity, hi = -Infinity;
  for (const p of poly) { const v = p.x * ax.x + p.z * ax.z; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return [lo, hi];
}

export function polysOverlap(A: P[], B: P[]) {
  for (const poly of [A, B])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = { x: -(q.z - p.z), z: q.x - p.x };
      const [a0, a1] = project(A, ax), [b0, b1] = project(B, ax);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  return true;
}

// The paved band of a road as one rectangle per piece.
export function bandOf(path: P[], half = HALF) {
  const out: { poly: P[]; c: P; r: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = dist(a, b) || 0.1;
    const c = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    // pieces overlap slightly so the band has no gaps on the outside of a bend
    out.push({ poly: rectCorners(c.x, c.z, Math.atan2(b.z - a.z, b.x - a.x), L + 0.6, half * 2), c, r: L / 2 + half + 0.5 });
  }
  return out;
}

const hitsBand = (band: ReturnType<typeof bandOf>, poly: P[], c: P, r: number) => band.some((b) => dist(b.c, c) < b.r + r && polysOverlap(b.poly, poly));

export interface RoadOpts { height: HeightMode; grade: number; cross: 'junction' | 'bridge'; spec: Spec; type: RoadType }
export const DEFAULT_OPTS: RoadOpts = { height: 'auto', grade: 0.06, cross: 'junction', spec: GRADES.road, type: 'street' };
export interface Check { ok: boolean; reason?: string; length: number; cost: number; clears: Lot[]; path: P[]; profile?: Profile; bridges: number; raised: number }

export class Network {
  nodes = new Map<number, RNode>();
  segs = new Map<number, RSeg>();
  lots: Lot[] = [];
  nextId = 1;
  isWater: (p: P) => boolean;
  bound: number;
  private rand: () => number;
  zoneAt: (p: P) => Zone = () => 'town';
  // lots whose plots the last build() cut into (their gardens get trimmed)
  touched: Lot[] = [];

  constructor(isWater: (p: P) => boolean = () => false, bound = 560, seed = 7) {
    this.isWater = isWater;
    this.bound = bound;
    this.rand = rng(seed);
  }

  node(id: number) { return this.nodes.get(id)!; }
  segEnds(s: RSeg) { return [this.node(s.a), this.node(s.b)] as const; }
  segsAt(n: number) { return [...this.segs.values()].filter((s) => s.a === n || s.b === n); }
  other(s: RSeg, n: number) { return s.a === n ? s.b : s.a; }
  path(s: RSeg): P[] { const [a, b] = this.segEnds(s); return [a, ...s.mid, b]; }
  // the path walked starting from node `from`
  pathFrom(s: RSeg, from: number) { const p = this.path(s); return from === s.a ? p : p.reverse(); }
  length(s: RSeg) { return pathLength(this.path(s)); }
  def(s: RSeg) { return ROADS[s.type]; }
  half(s: RSeg) { return halfOf(ROADS[s.type]); }
  band(s: RSeg) { return bandOf(this.path(s), this.half(s)); }
  // widest road meeting at a node: how big the junction is
  nodeHalf(n: number) { return Math.max(HALF, ...this.segsAt(n).map((s) => this.half(s))); }

  addNode(x: number, z: number, y = 0) { const n = { id: this.nextId++, x, z, y }; this.nodes.set(n.id, n); return n.id; }
  addSeg(a: number, b: number, mid: P[] = [], type: RoadType = 'street', stops: Stop[] = []) {
    if (a === b) return -1;
    if (!mid.length) for (const s of this.segs.values()) if (!s.mid.length && ((s.a === a && s.b === b) || (s.a === b && s.b === a))) return s.id;
    const s: RSeg = { id: this.nextId++, a, b, mid, type, stops };
    this.segs.set(s.id, s);
    return s.id;
  }

  nearestNode(p: P, max: number) {
    let best: RNode | null = null, bd = max;
    for (const n of this.nodes.values()) { const d = dist(p, n); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  nearestSeg(p: P, max: number, ok: (s: RSeg) => boolean = () => true) {
    let best: { seg: RSeg; x: number; z: number; s: number; ux: number; uz: number } | null = null, bd = max;
    for (const s of this.segs.values()) {
      if (!ok(s)) continue;
      const c = closestOnPath(p, this.path(s));
      if (c.d < bd) { bd = c.d; best = { seg: s, x: c.x, z: c.z, s: c.s, ux: c.ux, uz: c.uz }; }
    }
    return best;
  }

  // Split a segment at a point, returning the new node's id.
  split(segId: number, p: P) {
    const s = this.segs.get(segId)!;
    const path = this.path(s);
    const c = closestOnPath(p, path);
    const n = this.addNode(c.x, c.z, c.y);
    this.segs.delete(segId);
    const L = pathLength(path);
    // stops go with whichever half they're on; one the split runs through is lost
    const keepA = s.stops.filter((st) => stopSpan(st)[1] < c.s - 1), keepB = s.stops.filter((st) => stopSpan(st)[0] > c.s + 1).map((st) => ({ ...st, s: st.s - c.s }));
    this.addSeg(s.a, n, subPath(path, 0, c.s).slice(1, -1), s.type, keepA);
    this.addSeg(n, s.b, subPath(path, c.s, L).slice(1, -1), s.type, keepB);
    return n;
  }

  // Directions a new road could leave an end in, following the road it starts on.
  outDirs(e: End): P[] {
    const out: P[] = [];
    if (e.node !== undefined) {
      for (const s of this.segsAt(e.node)) {
        const p = this.pathFrom(s, e.node);
        const L = dist(p[0], p[1]) || 1;
        out.push({ x: (p[0].x - p[1].x) / L, z: (p[0].z - p[1].z) / L });
      }
    } else if (e.seg !== undefined && this.segs.has(e.seg)) {
      const c = closestOnPath(e, this.path(this.segs.get(e.seg)!));
      out.push({ x: -c.uz, z: c.ux }, { x: c.uz, z: -c.ux });
    }
    return out;
  }

  // The out direction best matching a drag towards `to`.
  bestDir(e: End, to: P) {
    const v = { x: to.x - e.x, z: to.z - e.z };
    const L = Math.hypot(v.x, v.z) || 1;
    let best: P | null = null, bd = -Infinity;
    for (const d of this.outDirs(e)) { const dot = (d.x * v.x + d.z * v.z) / L; if (dot > bd) { bd = dot; best = d; } }
    return best;
  }

  // Snap a raw point for the start of a road.
  snapStart(raw: P, tol: number): End {
    const n = this.nearestNode(raw, tol);
    if (n) return { x: n.x, z: n.z, node: n.id };
    const s = this.nearestSeg(raw, tol * 0.8);
    if (s) return { x: s.x, z: s.z, seg: s.seg.id };
    return { ...raw };
  }

  // Lock a direction to 15° steps (relative to the road being continued) and the length to 4 m.
  snapAngle(start: End, raw: P): P {
    const d = this.bestDir(start, raw);
    const base = d ? Math.atan2(d.z, d.x) : 0;
    const step = Math.PI / 12;
    const ang = Math.atan2(raw.z - start.z, raw.x - start.x);
    const snapped = base + Math.round((ang - base) / step) * step;
    const len = Math.max(0, Math.round(dist(start, raw) / 4) * 4);
    return { x: start.x + Math.cos(snapped) * len, z: start.z + Math.sin(snapped) * len };
  }

  // Snap the far end: join nodes/roads nearby, otherwise (unless `free`) lock angle and length.
  snapEnd(start: End, raw: P, tol: number, free = false): End {
    const n = this.nearestNode(raw, tol);
    if (n && n.id !== start.node) return { x: n.x, z: n.z, node: n.id };
    const sg = this.nearestSeg(raw, tol * 0.7);
    if (sg && sg.seg.id !== start.seg && !(start.node && (sg.seg.a === start.node || sg.seg.b === start.node))) return { x: sg.x, z: sg.z, seg: sg.seg.id };
    return free ? { x: raw.x, z: raw.z } : this.snapAngle(start, raw);
  }

  // Control point for a smooth curve that leaves `a` along the road it starts on and ends at b.
  smoothCtrl(a: End, b: P): P | undefined {
    const u = this.bestDir(a, b);
    if (!u) return undefined;
    const v = { x: b.x - a.x, z: b.z - a.z };
    const L = Math.hypot(v.x, v.z);
    if (L < 1) return undefined;
    const cos = (u.x * v.x + u.z * v.z) / L;
    if (cos > 0.9995) return undefined; // already straight ahead
    // symmetric tangents: close to a circular arc
    const k = L / (2 * Math.max(0.3, cos));
    return { x: a.x + u.x * k, z: a.z + u.z * k };
  }

  makePath(a: P, b: P, ctrl?: P): P[] {
    if (ctrl) {
      const c = closestOnSeg(ctrl, a, b);
      if (c.d > 0.5) return bezier(a, ctrl, b);
    }
    return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
  }

  // Every place a path crosses an existing road (or runs through a junction), with that road's height.
  crossings(path: P[]) {
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + dist(path[i - 1], path[i]));
    const A = path[0], B = path[path.length - 1];
    const out: { s: number; x: number; z: number; e: number; sin: number; seg?: number; node?: number }[] = [];
    for (const n of this.nodes.values()) {
      if (dist(n, A) < 1 || dist(n, B) < 1) continue;
      const c = closestOnPath(n, path);
      if (c.d < 0.75) out.push({ s: c.s, x: n.x, z: n.z, e: n.y, sin: 1, node: n.id });
    }
    for (const s of this.segs.values()) {
      const sp = this.path(s);
      const e0 = sp[0], e1 = sp[sp.length - 1];
      for (let i = 1; i < path.length; i++)
        for (let j = 1; j < sp.length; j++) {
          const h = intersect(path[i - 1], path[i], sp[j - 1], sp[j], true);
          if (!h || [A, B, e0, e1].some((q) => dist(h, q) < 1)) continue;
          const at = cum[i - 1] + h.t * (cum[i] - cum[i - 1]);
          if (out.some((o) => Math.abs(o.s - at) < 0.5)) continue; // piece joints count once
          const e = (sp[j - 1].y ?? 0) + ((sp[j].y ?? 0) - (sp[j - 1].y ?? 0)) * h.u;
          const L1 = cum[i] - cum[i - 1] || 1, L2 = dist(sp[j - 1], sp[j]) || 1;
          const sin = Math.abs(((path[i].x - path[i - 1].x) * (sp[j].z - sp[j - 1].z) - (path[i].z - path[i - 1].z) * (sp[j].x - sp[j - 1].x)) / (L1 * L2));
          out.push({ s: at, x: h.x, z: h.z, e, sin, seg: s.id });
        }
    }
    return out.sort((p, q) => p.s - q.s);
  }

  // Height of the road an end joins, if it joins one.
  endHeight(e: End) {
    if (e.node !== undefined && this.nodes.has(e.node)) return this.node(e.node).y;
    if (e.seg !== undefined && this.segs.has(e.seg)) return closestOnPath(e, this.path(this.segs.get(e.seg)!)).y;
    return undefined;
  }

  // Check a proposed road and work out its height profile. Buildings in the way are cleared at a
  // cost; the map edge, tight curves, very short roads and impossible gradients are refused.
  check(a: End, b: End, ctrl?: P, opts: RoadOpts = DEFAULT_OPTS): Check {
    const flat = this.makePath(a, b, ctrl);
    const length = pathLength(flat);
    const def = ROADS[opts.type], half = halfOf(def);
    let cost = Math.round(length * def.cost);
    const clears: Lot[] = [];
    let path = flat, profile: Profile | undefined, bridges = 0, raised = 0;
    const res = (reason?: string): Check => ({ ok: !reason, reason, length, cost: reason ? cost : cost + clears.length * CLEAR_COST, clears, path, profile, bridges, raised });
    if (length < MIN_LEN) return res('Too short');
    if (minRadius(flat) < Math.max(MIN_RADIUS, def.minR)) return res(def.minR > MIN_RADIUS ? `Curve too tight for a ${def.label.toLowerCase()} (${def.minR} m radius at least)` : 'Curve too tight');
    // motorways only meet other roads through proper slip roads, not side-street junctions
    const local = opts.type === 'street' || opts.type === 'avenue';
    for (const e of [a, b]) {
      const on = e.seg !== undefined ? this.segs.get(e.seg) : undefined;
      const at = e.node !== undefined ? this.segsAt(e.node) : [];
      if (local && ((on && on.type === 'motorway') || at.some((x) => x.type === 'motorway')))
        return res('A street can’t join a motorway — build the slip road as a dual carriageway or motorway');
    }
    const spec = opts.spec, G = Math.min(opts.grade, spec.max, def.maxGrade);
    const limits: Limit[] = [];
    // water has to be bridged with clearance for boats
    const steps = Math.max(20, Math.ceil(length / 2));
    let w0 = -1;
    for (let k = 0; k <= steps; k++) {
      const t = (length * k) / steps, p = pointAt(flat, t);
      if (Math.abs(p.x) > this.bound || Math.abs(p.z) > this.bound) return res('Off the edge of the map');
      const wet = this.isWater(p);
      if (wet && w0 < 0) w0 = Math.max(0, t - length / steps); // from the last dry point
      if (w0 >= 0 && (!wet || k === steps)) { limits.push({ s0: w0 - 3, s1: t + 3, lo: spec.water, why: 'the water' }); w0 = -1; }
    }
    // every road crossed: join it, go over it, or pass under it if it's already up high enough
    for (const c of this.crossings(flat)) {
      const other = c.seg !== undefined ? this.segs.get(c.seg) : undefined;
      const oh = other ? this.half(other) : c.node !== undefined ? this.nodeHalf(c.node) : HALF;
      const span = Math.min(60, (oh + 1.5) / Math.max(0.25, c.sin));
      // anything crossing a motorway, or a motorway crossing anything, is grade separated
      const separate = opts.cross === 'bridge' || opts.type === 'motorway' || other?.type === 'motorway' || (c.node !== undefined && this.segsAt(c.node).some((x) => x.type === 'motorway'));
      if (c.e >= spec.clear - 0.01) limits.push({ s0: c.s - span, s1: c.s + span, hi: c.e - spec.clear, why: 'the flyover' });
      else if (!separate) limits.push({ s0: c.s, s1: c.s, lo: c.e, hi: c.e, why: 'the junction' });
      else limits.push({ s0: c.s - span, s1: c.s + span, lo: c.e + spec.clear, why: other?.type === 'motorway' ? 'the motorway' : c.e > 0.5 ? 'the raised road' : 'the road below' });
    }
    profile = solveProfile(length, this.endHeight(a) ?? 0, this.endHeight(b), G, limits, opts.height);
    if (!profile.ok) return res(profile.reason);
    const pr = profile;
    path = pr.maxY > 0.01 ? densify(flat, 3) : flat.map((p) => ({ ...p }));
    let acc = 0, up = false;
    path.forEach((p, i) => {
      if (i) acc += dist(path[i - 1], p);
      p.y = pr.maxY > 0.01 ? heightAt(pr, acc) : 0;
      if (i && (p.y > 1.5 || (path[i - 1].y ?? 0) > 1.5)) raised += dist(path[i - 1], p);
      if (i) cost += dist(path[i - 1], p) * ((p.y + (path[i - 1].y ?? 0)) / 2) * RAISE_COST;
      if (p.y > 3 && !up) bridges++;
      up = p.y > 3;
    });
    cost = Math.round(cost);
    // buildings in the way are compulsorily purchased and demolished
    const band = bandOf(path, half);
    for (const l of this.lots) if (hitsBand(band, rectCorners(l.x, l.z, l.rot, l.w, l.d), l, Math.hypot(l.w, l.d) / 2)) clears.push(l);
    // don't allow a new road to run almost on top of an existing one at the same level
    for (const s of this.segs.values()) {
      const shared = [a.node, b.node].some((id) => id === s.a || id === s.b) || a.seg === s.id || b.seg === s.id;
      if (shared) continue;
      const sp = this.path(s), near = (half + this.half(s)) * 0.7;
      for (let i = 1; i < path.length; i++) {
        const m = { x: (path[i - 1].x + path[i].x) / 2, z: (path[i - 1].z + path[i].z) / 2 };
        if (path.length > 2 && (dist(m, a) < near * 1.5 || dist(m, b) < near * 1.5)) continue;
        const c = closestOnPath(m, sp);
        if (c.d >= near || Math.abs(c.y - ((path[i - 1].y ?? 0) + (path[i].y ?? 0)) / 2) > 3) continue;
        const ang = Math.abs(Math.sin(Math.atan2(path[i].z - path[i - 1].z, path[i].x - path[i - 1].x) - Math.atan2(c.uz, c.ux)));
        if (ang < 0.25) return res('Too close to another road');
      }
    }
    return res();
  }

  // Build a road; splits roads it starts/ends on, and those it crosses at the same height, into
  // junctions. Roads crossed at a different height stay as bridges and underpasses.
  build(a: End, b: End, ctrl?: P, opts: RoadOpts = DEFAULT_OPTS): number[] {
    const path = this.check(a, b, ctrl, opts).path.map((p) => ({ ...p, y: p.y ?? 0 }));
    const resolve = (e: End, y: number) => (e.node ?? (e.seg !== undefined && this.segs.has(e.seg) ? this.split(e.seg, e) : this.nearestNode(e, 0.5)?.id ?? this.addNode(e.x, e.z, y)));
    const na = resolve(a, path[0].y);
    const nb = resolve(b, path[path.length - 1].y);
    const A = this.node(na), B = this.node(nb);
    path[0] = { x: A.x, z: A.z, y: A.y };
    path[path.length - 1] = { x: B.x, z: B.z, y: B.y };
    const L = pathLength(path);
    const cuts: { s: number; node: number }[] = [];
    for (const c of this.crossings(path)) {
      if (Math.abs(pointAt(path, c.s).y - c.e) > 0.3) continue; // grade separated
      if (c.node !== undefined) { cuts.push({ s: c.s, node: c.node }); continue; }
      // the crossed road may already have been split by an earlier crossing
      let seg: RSeg | undefined;
      for (const s of this.segs.values()) { const q = closestOnPath(c, this.path(s)); if (q.d < 0.5 && Math.abs(q.y - c.e) < 0.3) { seg = s; break; } }
      if (seg) cuts.push({ s: c.s, node: this.split(seg.id, c) });
    }
    cuts.sort((x, y) => x.s - y.s);
    const chain = [{ s: 0, node: na }, ...cuts, { s: L, node: nb }];
    const made: number[] = [];
    for (let i = 0; i + 1 < chain.length; i++) made.push(this.addSeg(chain[i].node, chain[i + 1].node, subPath(path, chain[i].s, chain[i + 1].s).slice(1, -1), opts.type));
    // lots overlapping the new road (e.g. queued ones) are dropped
    const band = bandOf(path, halfOf(ROADS[opts.type]));
    this.lots = this.lots.filter((l) => !hitsBand(band, rectCorners(l.x, l.z, l.rot, l.w, l.d), l, Math.hypot(l.w, l.d) / 2));
    this.touched = this.lots.filter((l) => hitsBand(band, this.parcelRect(l, -0.3), this.parcelCentre(l), this.parcelR(l)));
    for (const l of this.touched) this.fitParcel(l);
    return made.filter((id) => id >= 0);
  }

  // Free plots along both sides of a segment, straight or curved. `centre` makes buildings denser/taller.
  plotsFor(segId: number, centre: P = { x: 0, z: 0 }): Lot[] {
    const s = this.segs.get(segId);
    if (!s) return [];
    const path = this.path(s);
    const L = pathLength(path);
    const out: Lot[] = [];
    if (!this.def(s).frontage) return out;
    const HALF = this.half(s);
    for (const side of [1, -1]) {
      const row = (segId * 7919 + (side > 0 ? 1 : 0) * 104729) % 1000003;
      let t = HALF + 2;
      while (t < L - HALF - 2) {
        const m = pointAt(path, t);
        const dc = Math.hypot(m.x - centre.x, m.z - centre.z);
        const r = this.rand();
        const kind: LotKind = this.zoneAt(m) === 'industrial' ? 'industry'
          : dc < 60 ? (r < 0.3 ? 'tower' : r < 0.55 ? 'office' : 'flats') : dc < 110 ? (r < 0.45 ? 'shop' : r < 0.75 ? 'flats' : 'office') : dc < 170 ? 'terrace' : 'house';
        const w = kind === 'industry' ? 26 + this.rand() * 16 : kind === 'house' ? 9 + this.rand() * 3 : kind === 'terrace' ? 6 + this.rand() * 1.5 : 12 + this.rand() * 6;
        const d = kind === 'industry' ? 20 + this.rand() * 12 : kind === 'house' ? 9 + this.rand() * 3 : kind === 'terrace' ? 9 : 12 + this.rand() * 8;
        // the side gap belongs to the plot: a driveway for houses, a service lane for the rest
        const gap = kind === 'terrace' ? 0.2 : kind === 'house' ? 3.4 + this.rand() * 1.4 : kind === 'industry' ? 6 : 3 + this.rand() * 3;
        if (t + w > L - HALF - 2) break;
        const front = { house: 5.5, terrace: 2.2, shop: 4, flats: 6.5, office: 8, tower: 10, industry: 14 }[kind] + (kind === 'house' ? this.rand() * 2 : 0);
        const off = HALF + front + d / 2;
        // the building's front faces the road, square to it at the middle of the plot
        const c = pointAt(path, t + w / 2);
        // nothing fronts onto a bridge or a ramp
        if (c.y > 1 || pointAt(path, t).y > 1 || pointAt(path, t + w).y > 1) { t += w; continue; }
        const cx = c.x - c.uz * off * side, cz = c.z + c.ux * off * side;
        const rot = Math.atan2(c.uz, c.ux);
        const h = kind === 'house' ? 6 : kind === 'terrace' ? 7 + this.rand() * 2 : kind === 'shop' ? 8 + this.rand() * 6 : kind === 'flats' ? 12 + this.rand() * 12 : kind === 'office' ? 16 + this.rand() * 14 : kind === 'industry' ? 8 + this.rand() * 4 : 30 + this.rand() * 45;
        // local +x runs along the road in the direction of travel for side -1, against it for side 1
        const lot: Lot = { id: this.nextId++, x: cx, z: cz, rot: side === 1 ? rot + Math.PI : rot, w, d, h, kind, seg: segId, seed: this.rand(), row, front, back: BACK[kind], px: (side === -1 ? gap : -gap) / 2, pw: w + gap };
        if (this.lotFree(lot, out)) { this.fitParcel(lot, out); out.push(lot); }
        t += w + gap;
      }
    }
    return out;
  }

  // The plot as a rectangle (optionally grown or shrunk by `pad`).
  parcelCentre(l: Lot): P {
    const zc = (l.front - l.back) / 2, c = Math.cos(l.rot), s = Math.sin(l.rot);
    return { x: l.x + l.px * c - zc * s, z: l.z + l.px * s + zc * c };
  }
  parcelRect(l: Lot, pad = 0) {
    const c = this.parcelCentre(l);
    return rectCorners(c.x, c.z, l.rot, l.pw + pad * 2, l.d + l.front + l.back + pad * 2);
  }
  parcelR(l: Lot) { return Math.hypot(l.pw, l.d + l.front + l.back) / 2; }

  // Make the back garden as deep as it can be without running into other plots, roads or water.
  fitParcel(l: Lot, extra: Lot[] = []) {
    if (this.tryParcel(l, extra)) return true;
    // a corner plot: give up the side gap (driveway) that runs into the side street
    l.pw -= Math.abs(l.px) * 2; l.px = 0;
    return this.tryParcel(l, extra);
  }
  private tryParcel(l: Lot, extra: Lot[]) {
    const others = [...this.lots, ...extra].filter((o) => o !== l);
    for (let back = BACK[l.kind]; back >= 0; back -= 1.5) {
      l.back = Math.max(0.5, back);
      const poly = this.parcelRect(l, -0.3), c = this.parcelCentre(l), r = this.parcelR(l);
      if (poly.some((p) => this.isWater(p))) continue;
      if (others.some((o) => dist(this.parcelCentre(o), c) < r + this.parcelR(o) && polysOverlap(poly, this.parcelRect(o)))) continue;
      // the plot's own front edge meets its road; anything else it touches is a clash
      const back0 = { ...l, front: 0 };
      const rear = this.parcelRect(back0, -0.3);
      if ([...this.segs.values()].some((s) => hitsBand(this.band(s), rear, this.parcelCentre(back0), r))) continue;
      return true;
    }
    return false;
  }

  lotFree(l: Lot, extra: Lot[] = []) {
    const poly = rectCorners(l.x, l.z, l.rot, l.w + 1, l.d + 1);
    const r = Math.hypot(l.w + 1, l.d + 1) / 2;
    if (poly.some((p) => this.isWater(p) || Math.abs(p.x) > this.bound || Math.abs(p.z) > this.bound)) return false;
    for (const s of this.segs.values()) {
      const path = this.path(s), h = this.half(s);
      if (hitsBand(bandOf(path, h), poly, l, r)) return false;
      // keep plots out of junction discs
      for (const n of [path[0], path[path.length - 1]]) if (poly.some((p) => dist(p, n) < h + 1) || dist(l, n) < h + l.d / 2) return false;
    }
    // a building can't go on somebody else's plot (neighbouring plots may touch)
    const foot = rectCorners(l.x, l.z, l.rot, l.w - 0.4, l.d - 0.4);
    for (const o of [...this.lots, ...extra]) {
      if (dist(this.parcelCentre(o), l) > r + this.parcelR(o)) continue;
      if (polysOverlap(foot, this.parcelRect(o))) return false;
    }
    return true;
  }

  // ---------- bus stops ----------
  // Which side of a road a point is on: 1 = left of travel from a to b (we drive on the left).
  sideOf(s: RSeg, p: P): 1 | -1 {
    const c = closestOnPath(p, this.path(s));
    return (p.x - c.x) * c.uz - (p.z - c.z) * c.ux > 0 ? 1 : -1;
  }

  // Plots on one side of a stretch of road, whose front edge is on the pavement.
  frontLots(s: RSeg, side: 1 | -1, s0: number, s1: number) {
    const path = this.path(s), half = this.half(s);
    return this.lots.filter((l) => {
      const c = this.parcelCentre(l), q = closestOnPath(c, path);
      if (this.sideOf(s, c) !== side || q.s < s0 - l.pw / 2 || q.s > s1 + l.pw / 2) return false;
      return Math.abs(q.d - (l.d + l.front + l.back) / 2 - half) < 2.5;
    });
  }

  // Work out how a stop could fit here, the way a highways engineer would: the bus can simply stop
  // in the lane, or a lay-by can be cut into the kerb. The 3 m it needs comes first from the
  // pavement (down to a 2 m footway), then from narrowing the lanes (down to 3 m), and only then
  // from buying a strip of the front gardens behind.
  planStop(segId: number, t: number, side: 1 | -1): { plans: StopPlan[]; reason?: string } {
    const s = this.segs.get(segId);
    if (!s) return { plans: [], reason: 'No road here' };
    const def = this.def(s), path = this.path(s), L = pathLength(path);
    if (s.type === 'motorway') return { plans: [], reason: 'No bus stops on a motorway — put one on a slip road or a road nearby' };
    if (pointAt(path, t).y > 0.5) return { plans: [], reason: 'Stops can’t go on a bridge or a ramp' };
    const probe: Stop = { id: 0, s: t, side, kind: 'layby', take: { pave: 0, lane: 0, land: 0 } };
    const [s0, s1] = stopSpan(probe);
    if (s0 < this.nodeHalf(s.a) + 6 || s1 > L - this.nodeHalf(s.b) - 6) return { plans: [], reason: 'Too close to a junction or the end of the road — stops need about 35 m clear' };
    if (s.stops.some((o) => o.side === side && stopSpan(o)[0] < s1 && stopSpan(o)[1] > s0)) return { plans: [], reason: 'There’s already a stop here' };
    const plans: StopPlan[] = [];
    const multi = def.lanes > 1;
    plans.push({
      kind: 'kerb', ok: true, title: 'Kerbside stop', cost: 6000, lots: [], take: { pave: 0, lane: 0, land: 0 },
      notes: ['A shelter and a flag on the pavement, “BUS STOP” painted in the lane', multi ? 'The bus stops in the inside lane: traffic moves out to pass' : 'The bus stops in the lane: traffic behind waits while people board'],
    });
    // find the 3 m for a lay-by
    let need = BAY.depth;
    const pave = Math.min(need, Math.max(0, def.pave - MIN_FOOTWAY));
    need -= pave;
    const lanesNarrowed = multi ? def.lanes : 2;
    const lane = Math.min(need, Math.max(0, (def.lane - MIN_LANE) * lanesNarrowed));
    need -= lane;
    const land = need > 0.01 ? need : 0;
    const notes: string[] = [];
    if (pave > 0) notes.push(`Pavement narrowed from ${def.pave.toFixed(1)} m to ${(def.pave - pave).toFixed(1)} m along the stop`);
    if (lane > 0) notes.push(`Lanes narrowed from ${def.lane.toFixed(2)} m to ${(def.lane - lane / lanesNarrowed).toFixed(2)} m${multi ? '' : ', centre line moved over'} for ${Math.round(s1 - s0 + 20)} m`);
    let lots: Lot[] = [], blocked: string | undefined, cost = 45000 + (lane > 0 ? 8000 : 0);
    if (land > 0) {
      lots = this.frontLots(s, side, s0, s1);
      const tight = lots.filter((l) => l.front < land + 1);
      if (tight.length) blocked = `Needs ${land.toFixed(1)} m of land, but ${tight.length === 1 ? 'a building stands' : `${tight.length} buildings stand`} right at the pavement`;
      cost += lots.length * 12000 + Math.round(land * (s1 - s0) * 300);
      notes.push(`Buys a ${land.toFixed(1)} m strip off ${lots.length || 'no'} front garden${lots.length === 1 ? '' : 's'}; the pavement moves back into them`);
    }
    notes.push('The bus pulls in out of the traffic, which keeps moving');
    plans.push({ kind: 'layby', ok: !blocked, blocked, title: 'Bus lay-by', cost, lots, take: { pave, lane, land }, notes });
    return { plans };
  }

  addStop(segId: number, t: number, side: 1 | -1, plan: StopPlan) {
    const s = this.segs.get(segId)!;
    const st: Stop = { id: this.nextId++, s: t, side, kind: plan.kind, take: { ...plan.take } };
    s.stops.push(st);
    // the gardens that gave up land get shallower
    this.touched = plan.lots;
    for (const l of plan.lots) l.front = Math.max(0.5, l.front - plan.take.land);
    return st;
  }
}
