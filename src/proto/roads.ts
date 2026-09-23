// Free-form road network in metres: nodes + straight segments, snapping, junction splitting,
// and building plots laid out along both sides of every road at any angle.

export const ROAD_W = 8; // carriageway: two 3.5 m lanes plus a little margin
export const PAVE = 2.2; // pavement each side
export const HALF = ROAD_W / 2 + PAVE; // centreline to back of pavement
export const COST_PER_M = 250;
export const MIN_LEN = 10;
export const CLEAR_COST = 6000; // compulsory purchase per building

export interface RNode { id: number; x: number; z: number }
export interface RSeg { id: number; a: number; b: number }
export type LotKind = 'house' | 'terrace' | 'shop' | 'flats' | 'tower';
export interface Lot { id: number; x: number; z: number; rot: number; w: number; d: number; h: number; kind: LotKind; seg: number; seed: number }

export interface P { x: number; z: number }
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

// Proper crossing of two segments (not touching at endpoints); returns the point and params.
export function intersect(a: P, b: P, c: P, d: P) {
  const r = { x: b.x - a.x, z: b.z - a.z }, s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return { t, u, x: a.x + r.x * t, z: a.z + r.z * t };
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

export class Network {
  nodes = new Map<number, RNode>();
  segs = new Map<number, RSeg>();
  lots: Lot[] = [];
  nextId = 1;
  isWater: (p: P) => boolean;
  bound: number;
  private rand: () => number;

  constructor(isWater: (p: P) => boolean = () => false, bound = 560, seed = 7) {
    this.isWater = isWater;
    this.bound = bound;
    this.rand = rng(seed);
  }

  node(id: number) { return this.nodes.get(id)!; }
  segEnds(s: RSeg) { return [this.node(s.a), this.node(s.b)] as const; }
  segsAt(n: number) { return [...this.segs.values()].filter((s) => s.a === n || s.b === n); }
  other(s: RSeg, n: number) { return s.a === n ? s.b : s.a; }
  length(s: RSeg) { const [a, b] = this.segEnds(s); return dist(a, b); }

  addNode(x: number, z: number) { const n = { id: this.nextId++, x, z }; this.nodes.set(n.id, n); return n.id; }
  addSeg(a: number, b: number) {
    if (a === b) return -1;
    for (const s of this.segs.values()) if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) return s.id;
    const s = { id: this.nextId++, a, b };
    this.segs.set(s.id, s);
    return s.id;
  }

  nearestNode(p: P, max: number) {
    let best: RNode | null = null, bd = max;
    for (const n of this.nodes.values()) { const d = dist(p, n); if (d < bd) { bd = d; best = n; } }
    return best;
  }

  nearestSeg(p: P, max: number) {
    let best: { seg: RSeg; x: number; z: number; t: number } | null = null, bd = max;
    for (const s of this.segs.values()) {
      const [a, b] = this.segEnds(s);
      const c = closestOnSeg(p, a, b);
      if (c.d < bd) { bd = c.d; best = { seg: s, x: c.x, z: c.z, t: c.t }; }
    }
    return best;
  }

  // Split a segment at a point, returning the new node's id.
  split(segId: number, p: P) {
    const s = this.segs.get(segId)!;
    const n = this.addNode(p.x, p.z);
    this.segs.delete(segId);
    this.addSeg(s.a, n);
    this.addSeg(n, s.b);
    return n;
  }

  // Snap a raw point for the start of a road.
  snapStart(raw: P, tol: number): End {
    const n = this.nearestNode(raw, tol);
    if (n) return { x: n.x, z: n.z, node: n.id };
    const s = this.nearestSeg(raw, tol * 0.8);
    if (s) return { x: s.x, z: s.z, seg: s.seg.id };
    return { ...raw };
  }

  // Snap the far end: join nodes/roads nearby, otherwise lock the angle to 15° steps
  // (relative to the road you're continuing, if any) and the length to 4 m.
  snapEnd(start: End, raw: P, tol: number): End {
    const n = this.nearestNode(raw, tol);
    if (n && n.id !== start.node) return { x: n.x, z: n.z, node: n.id };
    const sg = this.nearestSeg(raw, tol * 0.7);
    if (sg && sg.seg.id !== start.seg && !(start.node && (sg.seg.a === start.node || sg.seg.b === start.node))) return { x: sg.x, z: sg.z, seg: sg.seg.id };
    let base = 0;
    if (start.node) {
      const at = this.segsAt(start.node);
      if (at.length) {
        const o = this.node(this.other(at[0], start.node));
        base = Math.atan2(start.z - o.z, start.x - o.x);
      }
    } else if (start.seg) {
      const [a, b] = this.segEnds(this.segs.get(start.seg)!);
      base = Math.atan2(b.z - a.z, b.x - a.x);
    }
    const step = Math.PI / 12;
    const ang = Math.atan2(raw.z - start.z, raw.x - start.x);
    const snapped = base + Math.round((ang - base) / step) * step;
    const len = Math.max(0, Math.round(dist(start, raw) / 4) * 4);
    return { x: start.x + Math.cos(snapped) * len, z: start.z + Math.sin(snapped) * len };
  }

  // Check a proposed road. Buildings in the way, water, map edge and very short roads are refused.
  check(a: End, b: End): { ok: boolean; reason?: string; length: number; cost: number; clears: Lot[] } {
    const length = dist(a, b);
    const cost = Math.round(length * COST_PER_M);
    const clears: Lot[] = [];
    if (length < MIN_LEN) return { ok: false, reason: 'Too short', length, cost, clears };
    for (let k = 0; k <= 20; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / 20, z: a.z + ((b.z - a.z) * k) / 20 };
      if (this.isWater(p)) return { ok: false, reason: 'Water in the way', length, cost, clears };
      if (Math.abs(p.x) > this.bound || Math.abs(p.z) > this.bound) return { ok: false, reason: 'Off the edge of the map', length, cost, clears };
    }
    // buildings in the way are compulsorily purchased and cleared
    const band = this.roadPoly(a, b);
    for (const l of this.lots) if (polysOverlap(band, rectCorners(l.x, l.z, l.rot, l.w, l.d))) clears.push(l);
    // don't allow a new road to run almost on top of an existing one
    for (const s of this.segs.values()) {
      const [p, q] = this.segEnds(s);
      const shared = [a.node, b.node].some((id) => id === s.a || id === s.b) || a.seg === s.id || b.seg === s.id;
      if (shared) continue;
      const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const c = closestOnSeg(m, p, q);
      const ang = Math.abs(Math.sin(Math.atan2(b.z - a.z, b.x - a.x) - Math.atan2(q.z - p.z, q.x - p.x)));
      if (c.d < ROAD_W && ang < 0.25) return { ok: false, reason: 'Too close to another road', length, cost, clears };
    }
    return { ok: true, length, cost: cost + clears.length * CLEAR_COST, clears };
  }

  roadPoly(a: P, b: P, shrink = 0): P[] {
    const L = dist(a, b) || 1;
    const rot = Math.atan2(b.z - a.z, b.x - a.x);
    return rectCorners((a.x + b.x) / 2, (a.z + b.z) / 2, rot, Math.max(0.1, L - shrink * 2 * HALF), HALF * 2);
  }

  // Build a checked road; splits roads it starts/ends on or crosses, making junctions.
  build(a: End, b: End): number[] {
    const resolve = (e: End) => (e.node ?? (e.seg !== undefined && this.segs.has(e.seg) ? this.split(e.seg, e) : this.nearestNode(e, 0.5)?.id ?? this.addNode(e.x, e.z)));
    const na = resolve(a);
    const nb = resolve(b);
    const A = this.node(na), B = this.node(nb);
    // crossings with existing roads become junctions
    const cuts: { t: number; node: number }[] = [];
    for (const s of [...this.segs.values()]) {
      if (s.a === na || s.b === na || s.a === nb || s.b === nb) continue;
      const [p, q] = this.segEnds(s);
      const hit = intersect(A, B, p, q);
      if (hit) cuts.push({ t: hit.t, node: this.split(s.id, hit) });
    }
    cuts.sort((x, y) => x.t - y.t);
    const chain = [na, ...cuts.map((c) => c.node), nb];
    const made: number[] = [];
    for (let i = 0; i + 1 < chain.length; i++) made.push(this.addSeg(chain[i], chain[i + 1]));
    // lots overlapping the new road (e.g. queued ones) are dropped
    const band = this.roadPoly(A, B);
    this.lots = this.lots.filter((l) => !polysOverlap(band, rectCorners(l.x, l.z, l.rot, l.w, l.d)));
    return made;
  }

  // Free plots along both sides of a segment. `centre` makes buildings denser/taller.
  plotsFor(segId: number, centre: P = { x: 0, z: 0 }): Lot[] {
    const s = this.segs.get(segId);
    if (!s) return [];
    const [a, b] = this.segEnds(s);
    const L = dist(a, b);
    const rot = Math.atan2(b.z - a.z, b.x - a.x);
    const ux = Math.cos(rot), uz = Math.sin(rot);
    const out: Lot[] = [];
    for (const side of [1, -1]) {
      let t = HALF + 2;
      while (t < L - HALF - 2) {
        const mx = a.x + ux * t, mz = a.z + uz * t;
        const dc = Math.hypot(mx - centre.x, mz - centre.z);
        const kind: LotKind = dc < 60 ? (this.rand() < 0.35 ? 'tower' : 'flats') : dc < 110 ? (this.rand() < 0.5 ? 'shop' : 'flats') : dc < 170 ? 'terrace' : 'house';
        const w = kind === 'house' ? 9 + this.rand() * 3 : kind === 'terrace' ? 6 + this.rand() * 1.5 : 12 + this.rand() * 6;
        const d = kind === 'house' ? 9 + this.rand() * 3 : kind === 'terrace' ? 9 : 12 + this.rand() * 8;
        if (t + w > L - HALF - 2) break;
        const setback = kind === 'house' ? 4 : kind === 'terrace' ? 2 : 1;
        const off = HALF + setback + d / 2;
        // the building's front faces the road
        const cx = a.x + ux * (t + w / 2) - uz * off * side, cz = a.z + uz * (t + w / 2) + ux * off * side;
        const h = kind === 'house' ? 6 : kind === 'terrace' ? 7 + this.rand() * 2 : kind === 'shop' ? 8 + this.rand() * 6 : kind === 'flats' ? 12 + this.rand() * 12 : 30 + this.rand() * 45;
        const lot: Lot = { id: this.nextId++, x: cx, z: cz, rot: side === 1 ? rot + Math.PI : rot, w, d, h, kind, seg: segId, seed: this.rand() };
        if (this.lotFree(lot, out)) out.push(lot);
        t += w + (kind === 'terrace' ? 0.2 : 2 + this.rand() * 3);
      }
    }
    return out;
  }

  lotFree(l: Lot, extra: Lot[] = []) {
    const poly = rectCorners(l.x, l.z, l.rot, l.w + 1, l.d + 1);
    if (poly.some((p) => this.isWater(p) || Math.abs(p.x) > this.bound || Math.abs(p.z) > this.bound)) return false;
    for (const s of this.segs.values()) {
      const [a, b] = this.segEnds(s);
      if (polysOverlap(poly, this.roadPoly(a, b))) return false;
      // keep plots out of junction discs
      for (const n of [a, b]) if (poly.some((p) => dist(p, n) < HALF + 1) || dist(l, n) < HALF + l.d / 2) return false;
    }
    for (const o of [...this.lots, ...extra]) if (polysOverlap(poly, rectCorners(o.x, o.z, o.rot, o.w, o.d))) return false;
    return true;
  }
}
