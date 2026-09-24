// Junction geometry, worked out once and used by everything: the carriageway (with proper kerb
// radii at the corners, or a roundabout with flared entries), the footway around it, the islands,
// the slip road, where each road's own markings stop, and where its stop or give-way line is.
// Drawing, traffic and the land registry all read the same shape, so they can't disagree.
import { circlePoly, bandPolys, type XZ } from './land';
import { kerbOf, halfOf, type RoadDef } from './catalog';
import { STD } from './standards';

// `path`, if given, is the leg's centreline from the node outwards as it's drawn (see approachPath):
// the junction is then built along the road as it really runs, not a straight line from the node,
// so where the road's own drawing takes over (its mouth) the two meet exactly even on a curve.
export interface ShapeLeg { id: number; dir: XZ; ang: number; def: RoadDef; len: number; path?: XZ[] }
export type ShapeForm = 'priority' | 'signals' | 'mini' | 'roundabout' | 'merge' | 'diverge';
// `kind`: a slip road joining or leaving a one-way carriageway (interchange/slips.ts), whose course
// runs `len` metres alongside it, rather than a left-turn slip cutting a corner
export interface SlipShape { from: number; to: number; path: XZ[]; island: XZ[]; outer: XZ[]; R: number; centre: XZ; kind?: 'merge' | 'diverge'; len?: number }
// The markings a merge or diverge paints itself (interchange/slips.ts): lines as polylines with a
// half-width, broken lines with their dash and gap, hatching as quads; and, for each carriageway
// through it, the stretch (along the road from its a end) where the junction paints its nearside
// edge instead of the road
export interface SlipMarks { solid: { pts: XZ[]; w: number }[]; broken: { pts: XZ[]; w: number; dash: number; gap: number }[]; hatch: XZ[][]; edgeGap: Record<number, [number, number]> }
export interface Shape {
  form: ShapeForm;
  mouth: Record<number, number>; // where each road's own cross-section ends
  line: Record<number, number>; // where its stop / give-way line is (0: it has none)
  paveTrim: Record<number, [number, number]>; // where its footway ends, on its +b and -b sides
  medianTrim: Record<number, number>; // where its central reservation's nose is
  apron: XZ[]; // the carriageway inside the mouths (its outline, which may cross itself where roads meet at awkward angles)
  pave: XZ[]; // the outer edge of the footway around it (the same)
  // the same as simple pieces, overlapping: drawn (and claimed) as their union, so however
  // awkwardly the roads meet there's never a fill that crosses itself
  aprons: XZ[][];
  paves: XZ[][];
  islands: XZ[][];
  splitter: Record<number, number>; // roundabout: how far out each road's splitter island reaches (0: it has none)
  slip: SlipShape | null;
  R: number; // roundabout: outer edge of the circulating carriageway
  island: number; // roundabout: radius of the central island
  claims: XZ[][]; // the land it takes
  marks?: SlipMarks; // a merge or diverge's own markings
  // where two roads meet a roundabout close together with no footway between: the V between them
  // is carriageway, painted with chevrons (a ghost island) rather than left as a sliver of grass
  ghost?: { polys: XZ[][]; chevrons: XZ[][] };
  // which road each of `paves` is the footway (or verge) of, where it's only one road's (null: shared)
  paveLeg?: (number | null)[];
}

const add = (p: XZ, u: XZ, k: number) => ({ x: p.x + u.x * k, z: p.z + u.z * k });
const len = (u: XZ) => Math.hypot(u.x, u.z);
const norm = (u: XZ) => { const l = len(u) || 1; return { x: u.x / l, z: u.z / l }; };
// a leg's frame: `a` metres out along it, `b` across (+b is the side traffic arrives on)
export const W = (n: XZ, u: XZ, a: number, b: number) => ({ x: n.x + u.x * a - u.z * b, z: n.z + u.z * a + u.x * b });
// where two lines p + u·s and q + w·t meet: the s and t
function meet(p: XZ, u: XZ, q: XZ, w: XZ) {
  const det = -u.x * w.z + w.x * u.z;
  if (Math.abs(det) < 1e-6) return null;
  const dx = q.x - p.x, dz = q.z - p.z;
  return { s: (dx * -w.z + w.x * dz) / det, t: (u.x * dz - u.z * dx) / det };
}
// points along an arc about c from p to q, the short way round
function arc(c: XZ, p: XZ, q: XZ, step = 0.25) {
  const r = Math.hypot(p.x - c.x, p.z - c.z);
  const a0 = Math.atan2(p.z - c.z, p.x - c.x);
  let da = Math.atan2(q.z - c.z, q.x - c.x) - a0;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const n = Math.max(2, Math.ceil(Math.abs(da) / step));
  const out: XZ[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (da * i) / n; out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }); }
  return out;
}
// the long way round (for the circulating carriageway between two entries)
function arcCCW(c: XZ, r: number, a0: number, a1: number, step = 0.12) {
  while (a1 <= a0) a1 += Math.PI * 2;
  const n = Math.max(1, Math.ceil((a1 - a0) / step));
  const out: XZ[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }); }
  return out;
}
// the convex hull of some points (anticlockwise, as x right and z down count it)
function convexHull(pts: XZ[]): XZ[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: XZ, a: XZ, b: XZ) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: XZ[] = [], hi: XZ[] = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}
const gapOf = (a: { ang: number }, b: { ang: number }) => { let g = b.ang - a.ang; while (g <= 0) g += Math.PI * 2; return g; };

// ---- a leg's own frame, following its centreline ----
// Every junction arm is measured `a` metres out along the road's centreline and `b` across it (+b
// the side traffic arrives on), square to the piece of centreline there, exactly as the road's own
// strips are drawn: so a stop line, an island or a kerb built in this frame sits where the road is.
export const APPROACH = 6; // metres: how far out a leg's direction is taken (junction.legsAt)
// The centreline a junction's arm is drawn along: the road's own path from the node, run straight
// out to the first point APPROACH or more from the node (the way legsAt measures the arm's
// direction), so a kink in the first few metres (common in mapped data) doesn't twist the mouth.
export function approachPath<T extends XZ>(p: T[]): T[] {
  let k = 1;
  while (k < p.length - 1 && Math.hypot(p[k].x - p[0].x, p[k].z - p[0].z) < APPROACH) k++;
  return k > 1 ? [p[0], ...p.slice(k)] : p;
}
// the piece of the leg's centreline at distance a (a vertex belongs to the piece after it, as drawn)
function pieceAt(l: ShapeLeg, a: number) {
  const p = l.path!;
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const L = Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    if (a < acc + L - 1e-6 || i === p.length - 1) return { p: p[i - 1], u: L ? { x: (p[i].x - p[i - 1].x) / L, z: (p[i].z - p[i - 1].z) / L } : l.dir, s: a - acc };
    acc += L;
  }
  return { p: p[0], u: l.dir, s: a };
}
const curved = (l: ShapeLeg) => !!l.path && l.path.length > 1;
// the point a out along leg l and b across
export function legAt(n: XZ, l: ShapeLeg, a: number, b: number): XZ {
  if (!curved(l)) return W(n, l.dir, a, b);
  const q = pieceAt(l, a);
  return W(q.p, q.u, q.s, b);
}
// the way the leg runs at distance a
export function legDir(l: ShapeLeg, a: number): XZ { return curved(l) ? pieceAt(l, a).u : l.dir; }
// a straight leg standing in for l, touching its centreline at distance a: same frame there
function frameAt(n: XZ, l: ShapeLeg, a: number): ShapeLeg {
  if (!curved(l)) return l;
  const u = legDir(l, a), c = legAt(n, l, a, 0), o = add(c, u, -a);
  return { ...l, path: undefined, dir: u, ang: Math.atan2(u.z, u.x), o } as ShapeLeg & { o: XZ };
}
const originOf = (n: XZ, l: ShapeLeg) => (l as ShapeLeg & { o?: XZ }).o ?? n;
// points along the line b across leg l, strictly between a0 and a1 (either way round): at most a
// metre apart, and at each corner of the centreline, so a curving kerb is followed
function run(n: XZ, l: ShapeLeg, a0: number, a1: number, b: number): XZ[] {
  if (!curved(l) || Math.abs(a1 - a0) < 0.05) return [];
  const at = new Set<number>(), lo = Math.min(a0, a1), hi = Math.max(a0, a1);
  for (let a = Math.ceil(lo) ; a < hi; a += 1) at.add(a);
  let acc = 0;
  const p = l.path!;
  for (let i = 1; i < p.length - 1; i++) { acc += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); at.add(acc); }
  const out = [...at].filter((a) => a > lo + 0.05 && a < hi - 0.05).sort((x, y) => x - y);
  return (a1 < a0 ? out.reverse() : out).map((a) => legAt(n, l, a, b));
}
// Where a point is in leg l's frame: `a` along its centreline (from the node) and `b` across; the
// nearest point of the centreline, run on straight past its far end.
export function legFrameOf(n: XZ, l: ShapeLeg, p: XZ) {
  const path = curved(l) ? l.path! : [n, add(n, l.dir, l.len)];
  let best = { a: 0, b: Infinity, d: Infinity }, acc = 0;
  for (let i = 1; i < path.length; i++) {
    const q = path[i - 1], r = path[i], L = Math.hypot(r.x - q.x, r.z - q.z) || 1e-9, u = { x: (r.x - q.x) / L, z: (r.z - q.z) / L };
    // (run on straight both ways: behind the node `a` goes negative)
    const t = (p.x - q.x) * u.x + (p.z - q.z) * u.z, tc = Math.max(i === 1 ? -Infinity : 0, i === path.length - 1 ? t : Math.min(L, t));
    const c = add(q, u, tc), d = Math.hypot(p.x - c.x, p.z - c.z);
    // (+b is W's side: (-u.z, u.x))
    if (d < best.d) best = { a: acc + tc, b: (p.x - c.x) * -u.z + (p.z - c.z) * u.x, d };
    acc += L;
  }
  return { a: best.a, b: best.b };
}
// Where two roads leave a junction close together, the thin V of ground between their footways is
// paved over, out to where the footways are NOSE metres apart: a paved nose, not a sliver of grass.
const NOSE = 0.8;
function nose(n: XZ, l: ShapeLeg, nx: ShapeLeg, bl: number, bn: number, from: number): XZ[] | null {
  if (gapOf(l, nx) > 1.3) return null;
  const P: XZ[] = [], Q: XZ[] = [];
  for (let a = from; a < Math.min(l.len, 90); a += 0.5) {
    const p = legAt(n, l, a, bl), f = legFrameOf(n, nx, p);
    if (f.a < 0 || f.a > nx.len) break;
    const gap = -f.b - bn;
    if (gap > NOSE) break;
    P.push(p); Q.push(gap > 0 ? legAt(n, nx, f.a, -bn) : p);
  }
  return P.length > 1 ? [n, ...P, ...Q.reverse()] : null;
}
// where the line b across leg l reaches radius R from the node (going out from it)
export function ringA(n: XZ, l: ShapeLeg, b: number, R: number) {
  if (Math.abs(b) >= R) return 0;
  const r = (a: number) => { const p = legAt(n, l, a, b); return Math.hypot(p.x - n.x, p.z - n.z); };
  let lo = 0, hi = R + 2;
  while (r(hi) < R && hi < R * 4 + 40) hi += R;
  if (r(lo) >= R) return 0;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (r(m) < R) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// the nearside general lane's centre, measured from the road's centreline
const nearLane = (d: RoadDef) => d.median / 2 + (d.lanes - 0.5) * d.lane;

// A corner between leg i's +b kerb and leg j's -b kerb, rounded with radius r (lines at offsets ki, kj).
// On a curving road each kerb is taken as its tangent where the corner meets it, found by trying again
// from where the last try met it.
function corner(n: XZ, li: ShapeLeg, lj: ShapeLeg, ki: number, kj: number, r: number) {
  let ai = 0, aj = 0, c = cornerOf(n, li, lj, ki, kj, r);
  for (let it = 0; it < 5 && (curved(li) || curved(lj)) && c.centre; it++) {
    const ni = Math.max(0, Math.min(li.len, c.ti)), nj = Math.max(0, Math.min(lj.len, c.tj));
    if (Math.abs(ni - ai) < 0.01 && Math.abs(nj - aj) < 0.01) break;
    ai = ni; aj = nj;
    const d = cornerOf(n, frameAt(n, li, ai), frameAt(n, lj, aj), ki, kj, r);
    if (!d.centre) break;
    c = d;
  }
  return c;
}
function cornerOf(n0: XZ, li: ShapeLeg, lj: ShapeLeg, ki: number, kj: number, r: number) {
  // (a leg that isn't a straight line from the node is first taken as straight along its first piece)
  if (curved(li)) li = frameAt(n0, li, 0);
  if (curved(lj)) lj = frameAt(n0, lj, 0);
  const g = gapOf(li, lj);
  const pi = W(originOf(n0, li), li.dir, 0, ki), pj = W(originOf(n0, lj), lj.dir, 0, -kj);
  if (g > Math.PI - 0.1) {
    // straight on, or the outside of a bend: the kerbs simply meet
    const m = g < Math.PI + 0.1 ? null : meet(pi, li.dir, pj, lj.dir);
    if (m && m.s < 0 && m.s > -3 * Math.max(ki, kj)) return { ti: 0, tj: 0, pts: [add(pi, li.dir, m.s)], x: add(pi, li.dir, m.s), centre: null as XZ | null };
    return { ti: 0, tj: 0, pts: [pi, pj], x: null as XZ | null, centre: null as XZ | null };
  }
  const m = meet(pi, li.dir, pj, lj.dir)!;
  const X = add(pi, li.dir, m.s);
  const rr = Math.max(0.3, Math.min(r, Math.min(li.len, lj.len) * 0.35 * Math.tan(g / 2)));
  const t = rr / Math.tan(g / 2);
  const Ti = add(X, li.dir, t), Tj = add(X, lj.dir, t);
  const bis = norm({ x: li.dir.x + lj.dir.x, z: li.dir.z + lj.dir.z });
  const C = add(X, bis, rr / Math.sin(g / 2));
  return { ti: m.s + t, tj: m.t + t, pts: arc(C, Ti, Tj), x: X, centre: C };
}

// A left-turn slip from leg i to leg j: a curved lane cutting the corner with an island inside it.
// On curving roads it's built on the kerbs' tangents where it meets them, and only where the roads
// run straight enough for a slip and its island to sit on them.
function slipFor(n: XZ, li0: ShapeLeg, lj0: ShapeLeg): SlipShape | null {
  let sl = slipOn(n, frameAt(n, li0, 0), frameAt(n, lj0, 0));
  if (!curved(li0) && !curved(lj0)) return sl?.shape ?? null;
  for (let it = 0; it < 3 && sl; it++) sl = slipOn(n, frameAt(n, li0, sl.ti), frameAt(n, lj0, sl.tj));
  if (!sl) return null;
  const f = [frameAt(n, li0, sl.ti), frameAt(n, lj0, sl.tj)];
  for (const [k, l0] of [li0, lj0].entries()) for (let a = 0; a <= (k ? sl.tj : sl.ti) + 4; a += 1) {
    const p = legAt(n, l0, a, 0), q = W(originOf(n, f[k]), f[k].dir, a, 0);
    if (Math.hypot(p.x - q.x, p.z - q.z) > 0.3) return null;
  }
  return sl.shape;
}
function slipOn(n0: XZ, li: ShapeLeg, lj: ShapeLeg): { shape: SlipShape; ti: number; tj: number } | null {
  const oi = originOf(n0, li), oj = originOf(n0, lj);
  const g = gapOf(li, lj);
  if (g < 0.6 || g > 2.2) return null;
  const s = Math.sin(g / 2), w = STD.slipWidth;
  const bi = nearLane(li.def), bj = nearLane(lj.def), ki = kerbOf(li.def), kj = kerbOf(lj.def);
  const d = Math.max(ki - bi, kj - bj);
  // big enough that a proper island (6 m deep) fits between the slip and the junction
  const R = Math.max(STD.slipRadius(Math.max(li.def.mph, lj.def.mph)), (6.3 + w / 2 + d / s) / (1 / s - 1));
  if (R > 48) return null;
  const pi = W(oi, li.dir, 0, bi), pj = W(oj, lj.dir, 0, -bj);
  const m = meet(pi, li.dir, pj, lj.dir);
  if (!m) return null;
  const Xs = add(pi, li.dir, m.s), t = R / Math.tan(g / 2);
  if (m.s + t > li.len - 12 || m.t + t > lj.len - 12) return null;
  const bis = norm({ x: li.dir.x + lj.dir.x, z: li.dir.z + lj.dir.z });
  const C = add(Xs, bis, R / Math.sin(g / 2));
  const Ti = add(Xs, li.dir, t), Tj = add(Xs, lj.dir, t);
  const path = arc(C, Ti, Tj, 0.08);
  // the island: between the two kerbs and the slip's inside edge
  const Ri = R + w / 2 + 0.4;
  const onLine = (p: XZ, u: XZ) => {
    // where the circle (C, Ri) crosses the line p + u·s, the crossing nearer the junction
    const f = (C.x - p.x) * u.x + (C.z - p.z) * u.z, q = add(p, u, f), h = Math.hypot(C.x - q.x, C.z - q.z);
    if (h >= Ri) return null;
    return f - Math.sqrt(Ri * Ri - h * h);
  };
  const Ki = W(oi, li.dir, 0, ki + 0.4), Kj = W(oj, lj.dir, 0, -(kj + 0.4));
  const mk = meet(Ki, li.dir, Kj, lj.dir);
  const si = onLine(Ki, li.dir), sj = onLine(Kj, lj.dir);
  if (!mk || si === null || sj === null || si <= mk.s + 2 || sj <= mk.t + 2) return null;
  const X = add(Ki, li.dir, mk.s), P1 = add(Ki, li.dir, si), P2 = add(Kj, lj.dir, sj);
  const edge = arc(C, P1, P2, 0.1);
  const island = [X, ...edge];
  // the slip's outside footway edge
  const outer = arc(C, Ti, Tj, 0.08).map((p) => { const v = norm({ x: p.x - C.x, z: p.z - C.z }); return add(C, v, R - w / 2 - STD.slipFootway); });
  return { shape: { from: li.id, to: lj.id, path, island, outer, R, centre: C }, ti: m.s + t, tj: m.t + t };
}

// Lines where a leg's kerb (offset k) meets a circle of radius R about the node, rounded by radius re.
// (On a curving road, on the kerb's tangent where the rounding meets it, found by trying again.)
function flare(n: XZ, l: ShapeLeg, k: number, R: number, re: number, side: 1 | -1) {
  let f = flareOn(n, frameAt(n, l, 0), k, R, re, side);
  for (let it = 0; it < 5 && curved(l); it++) {
    const g = flareOn(n, frameAt(n, l, Math.max(0, f.a)), k, R, re, side);
    const done = Math.abs(g.a - f.a) < 0.01;
    f = g;
    if (done) break;
  }
  return f;
}
function flareOn(n: XZ, l: ShapeLeg, k: number, R: number, re: number, side: 1 | -1) {
  const o = originOf(n, l), bc = k + re, dc = R + re;
  // the rounding's centre runs along the line bc across the leg: where it's dc from the node
  const w = { x: W(o, l.dir, 0, side * bc).x - n.x, z: W(o, l.dir, 0, side * bc).z - n.z };
  const wu = w.x * l.dir.x + w.z * l.dir.z;
  const ac = -wu + Math.sqrt(Math.max(0, wu * wu - (w.x * w.x + w.z * w.z) + dc * dc));
  const C = W(o, l.dir, ac, side * bc);
  const T = W(o, l.dir, ac, side * k);
  const v = norm({ x: C.x - n.x, z: C.z - n.z });
  const Q = add(n, v, R);
  return { a: ac, onLine: T, onRing: Q, centre: C, ringAng: Math.atan2(Q.z - n.z, Q.x - n.x) };
}

// The outline of a ring of radius R about the node with each leg (kerb offset k) flared into it by
// radius re: a roundabout's kerb, or a turning head's. `at` says where each leg's own kerbs meet the flare.
// `mouth`, if given, is the least distance out each leg's outline crosses the road (so a footway's
// outline reaches as far as its road's footway starts, which is where the kerb's flare starts).
function ringOutline(n: XZ, legs: ShapeLeg[], R: number, k: (l: ShapeLeg) => number, re: number, mouth?: (l: ShapeLeg) => number) {
  const pts: XZ[] = [], at: { hi: number; lo: number; m: number }[] = [];
  // (and as pieces: the ring, and each arm from the middle out to its mouth)
  const pieces: XZ[][] = [circlePoly(n, R, 48)];
  legs.forEach((l, i) => {
    const nx = legs[(i + 1) % legs.length];
    const lo = flare(n, l, k(l), R, re, -1), hi = flare(n, l, k(l), R, re, 1);
    const m = Math.max(lo.a, hi.a, mouth?.(l) ?? 0);
    at.push({ hi: hi.a, lo: lo.a, m });
    const arm = [...arc(lo.centre, lo.onRing, lo.onLine), ...run(n, l, lo.a, m, -k(l)), legAt(n, l, m, -k(l)), legAt(n, l, m, k(l)), ...run(n, l, m, hi.a, k(l)), ...arc(hi.centre, hi.onLine, hi.onRing)];
    pts.push(...arm);
    pieces.push([n, ...arm]);
    pts.push(...arcCCW(n, R, hi.ringAng, flare(n, nx, k(nx), R, re, -1).ringAng));
  });
  return { pts, at, pieces };
}

// The turning head at the end of a cul-de-sac: a turning circle about the road's end, flared in from
// its kerbs (a roundabout with one arm and no island), with the footway or verge carried round it.
export interface EndShape { mouth: number; paveTrim: [number, number]; apron: XZ[]; pave: XZ[]; claims: XZ[][] }
export function headShape(n: XZ, l: ShapeLeg): EndShape {
  const { R, entry } = STD.turningHead;
  const K = kerbOf(l.def), B = halfOf(l.def), F = B - K;
  const apron = ringOutline(n, [l], R, () => K, entry);
  // the footway's outline is concentric with the kerb's, so the two flares start at the same place
  const pave = ringOutline(n, [l], R + F, () => B, Math.max(1, entry - F));
  const { hi, lo } = apron.at[0];
  return { mouth: Math.max(hi, lo), paveTrim: [hi, lo], apron: apron.pts, pave: pave.pts, claims: [pave.pts] };
}

// Where two roads meet end to end with no junction (a bend, or one road running on as another), the
// road simply carries on round a curve. Each road's own drawing stops `cut` metres from the node and
// the gap between is a curve about X, the point where the inside kerbs meet: every line of the road
// (kerbs, footways, lanes, the centre line) runs round X concentrically, so on the inside of the bend
// the kerbs meet, on the outside they follow an arc, and the carriageway keeps its width all the way
// round. `arc[i]` runs from the middle of the bend out to road i's cut (just the node when the roads
// run straight on). `inner[i]` is the inside of the bend, as a side of road i's path from the node
// outwards (+1 left, as Flat.strip counts it); `fill[i]` is its half of the footway's inside corner;
// `dir[i]` is the way arc i leaves the middle, which both roads share so they meet without a seam.
export interface JoinLeg { path: XZ[]; kerb: number; back: number } // path from the node outwards
export interface JoinShape { cut: [number, number]; arc: [XZ[], XZ[]]; dir: [XZ, XZ]; X: XZ | null; inner: [number, number]; fill: [XZ[], XZ[]]; turn: number }
const left = (u: XZ) => ({ x: u.z, z: -u.x }); // Flat.strip's +offset side
function along(path: XZ[], s: number) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === path.length - 1) { const t = L ? Math.min(1, Math.max(0, s / L)) : 0, u = norm({ x: b.x - a.x, z: b.z - a.z }); return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, u }; }
    s -= L;
  }
  return { p: path[0], u: { x: 1, z: 0 } };
}
const pathLen = (p: XZ[]) => p.reduce((t, q, i) => (i ? t + Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0);
export const STRAIGHT = 1e-3; // radians: any bend sharper than this is drawn as a curve, so no join shows a seam
export function joinShape(n: XZ, A: JoinLeg, B: JoinLeg): JoinShape {
  const dA = along(A.path, 0).u, dB = along(B.path, 0).u;
  const vin = { x: -dA.x, z: -dA.z };
  const cr = vin.x * dB.z - vin.z * dB.x, turn = Math.atan2(cr, vin.x * dB.x + vin.z * dB.z);
  const through = norm({ x: dA.x - dB.x, z: dA.z - dB.z });
  const none: JoinShape = { cut: [0, 0], arc: [[n], [n]], dir: [through, { x: -through.x, z: -through.z }], X: null, inner: [0, 0], fill: [[], []], turn };
  if (Math.abs(turn) < STRAIGHT) return none;
  // the inside of the bend: the side of travel (from A into B) the road turns towards
  const sig = cr < 0 ? 1 : -1, inA = -sig, inB = sig;
  // the inside kerbs, run on straight until they meet
  const m = meet(add(n, left(dA), inA * A.kerb), dA, add(n, left(dB), inB * B.kerb), dB);
  if (!m) return none;
  const cutA = Math.max(0, Math.min(m.s, pathLen(A.path) * 0.45)), cutB = Math.max(0, Math.min(m.t, pathLen(B.path) * 0.45));
  const a = along(A.path, cutA), b = along(B.path, cutB);
  // the centre: where the two roads' cross-sections at their cuts meet
  const c = meet(a.p, left(a.u), b.p, left(b.u));
  if (!c) return none;
  const X = add(a.p, left(a.u), c.s);
  const rA = Math.hypot(a.p.x - X.x, a.p.z - X.z), rB = Math.hypot(b.p.x - X.x, b.p.z - X.z);
  const fA = Math.atan2(a.p.z - X.z, a.p.x - X.x);
  let da = Math.atan2(b.p.z - X.z, b.p.x - X.x) - fA;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const N = 2 * Math.max(1, Math.ceil(Math.abs(da) / 0.12));
  const pts: XZ[] = [];
  for (let k = 0; k <= N; k++) { const f = fA + (da * k) / N, r = rA + ((rB - rA) * k) / N; pts.push({ x: X.x + Math.cos(f) * r, z: X.z + Math.sin(f) * r }); }
  pts[0] = a.p; pts[N] = b.p;
  // the inside corner of the footway: the back edges run on until they meet (or are cut across
  // if they'd meet far away, on a hairpin)
  const QA = (o: number) => add(a.p, left(a.u), inA * o), QB = (o: number) => add(b.p, left(b.u), inB * o);
  const mb = meet(QA(A.back), a.u, QB(B.back), b.u);
  const M = mb && mb.s < 0 && mb.s > -3 * Math.max(A.back, B.back) ? add(QA(A.back), a.u, mb.s) : null;
  const mid = M ?? { x: (QA(A.back).x + QB(B.back).x) / 2, z: (QA(A.back).z + QB(B.back).z) / 2 };
  const fill: [XZ[], XZ[]] = [[QA(A.kerb), QA(A.back), mid, X], [X, mid, QB(B.back), QB(B.kerb)]];
  // at the middle the curve runs square to its radius
  const c0 = pts[N / 2], t = norm({ x: -(c0.z - X.z) * Math.sign(da), z: (c0.x - X.x) * Math.sign(da) });
  return { cut: [cutA, cutB], arc: [pts.slice(0, N / 2 + 1).reverse(), pts.slice(N / 2)], dir: [{ x: -t.x, z: -t.z }, t], X, inner: [inA, inB], fill, turn };
}

export function shapeJunction(n: XZ, legs: ShapeLeg[], form: ShapeForm, major: number[], slipPair: [number, number] | null, R0 = 0): Shape {
  const mouth: Record<number, number> = {}, line: Record<number, number> = {}, paveTrim: Record<number, [number, number]> = {}, medianTrim: Record<number, number> = {};
  const islands: XZ[][] = [];
  const K = (l: ShapeLeg) => kerbOf(l.def), B = (l: ShapeLeg) => halfOf(l.def);
  const N = legs.length;
  if (form === 'roundabout' || form === 'mini') {
    const multi = legs.some((l) => l.def.lanes > 1), fast = legs.some((l) => l.def.mph >= 50);
    const std = form === 'mini' ? { R: Math.max(STD.mini.R, Math.max(...legs.map(K)) + 2), island: 1.6, entryRadius: 6, footway: STD.mini.footway } : STD.roundabout(multi ? 2 : 1, fast);
    const R = R0 || std.R;
    const F = std.footway;
    const kerb = ringOutline(n, legs, R, K, std.entryRadius);
    legs.forEach((l, i) => {
      const { hi, lo } = kerb.at[i], edge = ringA(n, l, 0, R); // (where the leg's centreline meets the ring)
      mouth[l.id] = Math.max(lo, hi);
      line[l.id] = R + 0.4; // (as traffic reads it; the give-way line itself is drawn on the ring's edge, ringA)
      medianTrim[l.id] = edge + 1;
      paveTrim[l.id] = [hi, lo];
    });
    // (the footway's outline crosses each road no nearer than its road's footway starts)
    const pv = ringOutline(n, legs, R + F, B, Math.max(1, std.entryRadius - F), (l) => Math.max(...paveTrim[l.id]));
    const apron = kerb.pts, pave = pv.pts, aprons = kerb.pieces, paves = pv.pieces;
    const paveLeg: (number | null)[] = [null, ...legs.map((l) => l.id)]; // (the ring, then each road's arm)
    legs.forEach((l, i) => { const nx = legs[(i + 1) % N], q = nose(n, l, nx, B(l), B(nx), pv.at[i].m); if (q) { paves.push(q); paveLeg.push(null); } });
    const ghost = ghostIslands(n, legs, R, (l) => Math.max(...paveTrim[l.id], mouth[l.id]));
    aprons.push(...ghost.polys);
    const claims = paves;
    // splitter islands at single-lane entries: only where one fits on its own road, clear of the
    // next road's carriageway (where mapped roads meet the ring close together, say)
    const splitter: Record<number, number> = {};
    if (form === 'roundabout') for (const l of legs) if (l.def.lanes === 1 && l.def.median === 0 && !l.def.oneway) {
      const { length: sl, width: sw } = STD.splitter, a0 = ringA(n, l, 0, R) + 0.8;
      const isl = [legAt(n, l, a0, -sw / 2), legAt(n, l, a0, sw / 2), legAt(n, l, a0 + sl - 0.8, 0)];
      const clear = legs.every((o) => o === l || isl.every((p) => { const f = legFrameOf(n, o, p); return f.a < 0 || Math.abs(f.b) > K(o) + 0.3; }));
      if (a0 + sl - 0.8 > l.len - 6 || !clear) continue;
      islands.push(isl);
      splitter[l.id] = a0 + sl - 0.8;
    }
    return { form, mouth, line, paveTrim, medianTrim, apron, pave, aprons, paves, islands, splitter, slip: null, R, island: std.island, claims, paveLeg, ghost };
  }
  // priority and signals: corners with proper kerb radii, one of them perhaps a slip road
  let slip: SlipShape | null = null;
  if (slipPair) {
    const li = legs.find((l) => l.id === slipPair[0]), lj = legs.find((l) => l.id === slipPair[1]);
    if (li && lj && legs[(legs.indexOf(li) + 1) % N] === lj) slip = slipFor(n, li, lj);
  }
  const corners = legs.map((l, i) => {
    const nx = legs[(i + 1) % N];
    const isSlip = !!slip && slip.from === l.id && slip.to === nx.id;
    const r = isSlip ? 0.3 : STD.cornerRadius(Math.max(l.def.mph, nx.def.mph));
    const kerb = corner(n, l, nx, K(l), K(nx), r);
    // the footway's outer edge follows the same centre, less the footway's width
    const fw = Math.max(B(l) - K(l), B(nx) - K(nx));
    const back = isSlip ? { ti: 0, tj: 0, pts: kerb.x ? [kerb.x] : kerb.pts, x: kerb.x, centre: null } : corner(n, l, nx, B(l), B(nx), Math.max(0.3, r - fw));
    return { kerb, back, isSlip };
  });
  legs.forEach((l, i) => {
    const prev = corners[(i - 1 + N) % N], here = corners[i];
    const tPlus = here.kerb.ti, tMinus = prev.kerb.tj;
    const m = Math.max(tPlus, tMinus, 0) + 0.5;
    mouth[l.id] = m;
    medianTrim[l.id] = m + 0.5;
    const isMajor = form === 'priority' && major.includes(l.id);
    line[l.id] = isMajor ? 0 : form === 'signals' ? m + STD.crossing : m;
    // footway: stops where the corner (or the slip road) takes over
    const tp = here.isSlip && slip ? Math.hypot(slip.path[0].x - n.x, slip.path[0].z - n.z) : Math.max(here.back.ti, here.kerb.ti);
    const tm = prev.isSlip && slip ? Math.hypot(slip.path[slip.path.length - 1].x - n.x, slip.path[slip.path.length - 1].z - n.z) : Math.max(prev.back.tj, prev.kerb.tj);
    paveTrim[l.id] = [Math.max(0, tp), Math.max(0, tm)];
  });
  const apron: XZ[] = [], pave: XZ[] = [];
  // as pieces: the middle, where every road's kerbs leave the node; each road out to its mouth; each
  // corner's rounding (or, round the outside of a bend, the bit behind the node)
  const hull = (b: (l: ShapeLeg) => number) => convexHull(legs.flatMap((l) => [legAt(n, l, 0, -b(l)), legAt(n, l, 0, b(l))]));
  const aprons: XZ[][] = [hull(K)], paves: XZ[][] = [hull(B)], paveLeg: (number | null)[] = [null];
  const half = (l: ShapeLeg, b: number, a: number) => [legAt(n, l, 0, 0), ...run(n, l, 0, a, 0), legAt(n, l, a, 0), legAt(n, l, a, b), ...run(n, l, a, 0, b), legAt(n, l, 0, b)];
  const arm = (l: ShapeLeg, b: number, a0: number, a1: number) => [legAt(n, l, 0, -b), ...run(n, l, 0, a0, -b), legAt(n, l, a0, -b), legAt(n, l, a1, b), ...run(n, l, a1, 0, b), legAt(n, l, 0, b)];
  // (a rounded corner is fanned from the node, so it meets both roads' arms whichever way they curve)
  const round = (c: { pts: XZ[]; x: XZ | null; centre: XZ | null }, l: ShapeLeg, nx: ShapeLeg, bl: number, bn: number) =>
    c.centre ? [n, ...c.pts] : c.x ? [legAt(n, l, 0, bl), c.x, legAt(n, nx, 0, -bn), n] : c.pts.length > 1 ? [legAt(n, l, 0, bl), ...c.pts, legAt(n, nx, 0, -bn), n] : null;
  legs.forEach((l, i) => {
    const nx = legs[(i + 1) % N], c = corners[i], m = mouth[l.id], [tp, tm] = paveTrim[l.id];
    aprons.push(arm(l, K(l), m, m));
    // (the footway a half at a time, each ending square where its road's own footway starts)
    paves.push(half(l, -B(l), Math.max(m, tm)), half(l, B(l), Math.max(m, tp)));
    paveLeg.push(l.id, l.id);
    const ka = round(c.kerb, l, nx, K(l), K(nx));
    if (ka) aprons.push(ka);
    // (a slip road's corner: the footway runs out to the kerbs' corner, the island sitting on it)
    const kb = c.isSlip && c.kerb.x ? [legAt(n, l, 0, B(l)), legAt(n, l, Math.max(m, tp), B(l)), c.kerb.x, legAt(n, nx, Math.max(mouth[nx.id], paveTrim[nx.id][1]), -B(nx)), legAt(n, nx, 0, -B(nx)), n] : round(c.back, l, nx, B(l), B(nx));
    if (kb) { paves.push(kb); paveLeg.push(null); }
    const q = c.isSlip ? null : nose(n, l, nx, B(l), B(nx), Math.max(m, tp));
    if (q) { paves.push(q); paveLeg.push(null); }
  });
  // (along a curving road the outlines follow its kerb and footway between the corners and the mouth)
  legs.forEach((l, i) => {
    const m = mouth[l.id], prev = corners[(i - 1 + N) % N], here = corners[i];
    apron.push(...run(n, l, prev.kerb.tj, m, -K(l)), legAt(n, l, m, -K(l)), legAt(n, l, m, K(l)), ...run(n, l, m, here.kerb.ti, K(l)), ...here.kerb.pts);
    const [tp, tm] = paveTrim[l.id];
    pave.push(...(prev.isSlip ? [] : run(n, l, prev.back.tj, Math.max(m, tm), -B(l))), legAt(n, l, Math.max(m, tm), -B(l)), legAt(n, l, Math.max(m, tp), B(l)), ...(here.isSlip ? [] : run(n, l, Math.max(m, tp), here.back.ti, B(l))), ...here.back.pts);
  });
  const claims: XZ[][] = [...paves];
  if (slip) {
    islands.push(slip.island);
    claims.push(...bandPolys(slip.path, STD.slipWidth / 2 + 0.5, STD.slipWidth / 2 + STD.slipFootway + 0.5), slip.island);
  }
  return { form, mouth, line, paveTrim, medianTrim, apron, pave, aprons, paves, islands, splitter: {}, slip, R: 0, island: 0, claims, paveLeg };
}

// Ghost islands: between each pair of neighbouring arms whose facing edges (a kerb, or the back of a
// footway where there is one, which stays as it is) run close together out from the ring, from the
// ring's edge out to where they're GHOST metres apart (GHOST_PAIR for a motorway's two carriageways
// splaying in: out to where its reservation's barriers start). Chevrons (TSRGD diagram 1042) point
// at the ring from where its arms' own flares end, CHEVRON apart, each stroke inset from the edges.
// Chevrons (TSRGD diagram 1042) filling an area between two edges P(a) and Q(a), from a0 to a1: a
// solid line along each edge, and V's of solid bars inside, their points towards a1 (the wide end, as
// they're laid), each arm meeting the edge a half-width back. Returns quads.
export function chevronsIn(P: (a: number) => XZ, Q: (a: number) => XZ, a0: number, a1: number, mph: number): { bars: XZ[][]; lines: XZ[][] } {
  const c = STD.chevron(mph), bars: XZ[][] = [], lines: XZ[][] = [];
  const dir = Math.sign(a1 - a0) || 1, len = Math.abs(a1 - a0);
  const at = (a: number, f: number) => { const p = P(a), q = Q(a); return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f }; };
  const width = (a: number) => Math.hypot(P(a).x - Q(a).x, P(a).z - Q(a).z);
  // the edge lines, just inside each edge
  for (const f of [0, 1]) for (let k = 0; k < Math.ceil(len); k++) {
    const u0 = a0 + dir * k, u1 = a0 + dir * Math.min(len, k + 1), w0 = width(u0), w1 = width(u1);
    if (w0 < 0.05 && w1 < 0.05) continue;
    const i0 = Math.min(0.5, c.edge / Math.max(0.1, w0)), i1 = Math.min(0.5, c.edge / Math.max(0.1, w1));
    const s0 = f ? 1 - i0 : i0, s1 = f ? 1 - i1 : i1;
    lines.push([at(u0, f), at(u1, f), at(u1, s1), at(u0, s0)]);
  }
  // the bars: an apex on the middle at a, arms back to each edge (inside its line) half a width back
  for (let d = c.bar + c.gap; d < len; d += c.bar + c.gap) {
    const a = a0 + dir * d, w = width(a);
    if (w < 1.2) continue;
    const back = w / 2, inset = (c.edge * 2) / w;
    if (d - back < 0.5) continue;
    for (const f of [inset, 1 - inset]) {
      const tipA = at(a, 0.5), tipB = at(a - dir * c.bar, 0.5), endA = at(a - dir * back, f), endB = at(a - dir * (back + c.bar), f);
      bars.push([endB, tipB, tipA, endA]);
    }
  }
  return { bars, lines };
}
export const GHOST = 5, GHOST_PAIR = 12;
const unitv = (p: XZ, c: XZ) => { const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
function ghostIslands(n: XZ, legs: ShapeLeg[], R: number, from: (l: ShapeLeg) => number) {
  const polys: XZ[][] = [], chevrons: XZ[][] = [];
  if (legs.length < 2) return { polys, chevrons };
  const edge = (l: ShapeLeg) => (l.def.pave > 0 ? halfOf(l.def) : kerbOf(l.def));
  legs.forEach((l, i) => {
    const nx = legs[(i + 1) % legs.length];
    if (gapOf(l, nx) > 1.2) return;
    const el = edge(l), en = edge(nx), a0 = Math.max(from(l), from(nx)), max = l.def.oneway && nx.def.oneway ? GHOST_PAIR : GHOST;
    const P = (a: number) => legAt(n, l, a, el), Q = (a: number) => legAt(n, nx, a, -en);
    const gap = (a: number) => Math.hypot(P(a).x - Q(a).x, P(a).z - Q(a).z);
    if (gap(a0) > max) return;
    let a1 = a0;
    while (a1 < Math.min(l.len, nx.len) - 10 && gap(a1 + 1) <= max) a1 += 1;
    if (a1 - a0 < 3) return;
    const side: XZ[] = [], other: XZ[] = [];
    const mid = (a: number) => { const p = P(a), q = Q(a); return { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; };
    // (from inside the ring's edge, so it meets the ring with no sliver between; out to the grass
    // beyond, which ends in a rounded nose: the island's far end curves round it)
    const r = gap(a1) / 2, c = mid(a1 + r), e1 = unitv(P(a1 + r), c), d = unitv(mid(a1), c);
    for (let a = Math.max(0, R - 3); a <= a1 + r + 1e-6; a += 1) { side.push(P(a)); other.push(Q(a)); }
    const nose: XZ[] = [];
    for (let k = 1; k < 12; k++) { const t = (Math.PI * k) / 12; nose.push({ x: c.x + r * (Math.cos(t) * e1.x + Math.sin(t) * d.x), z: c.z + r * (Math.cos(t) * e1.z + Math.sin(t) * d.z) }); }
    polys.push([...side, P(a1 + r), ...nose, Q(a1 + r), ...other.reverse()]);
    // chevrons, their points towards the grass nose, from where the ring's own flares end
    // (inside the roads' own edge lines, which border it: a carriageway's is its hard strip in from the kerb)
    const lineIn = (d: RoadDef) => (d.oneway ? d.strip ?? 0 : 0) + 0.1;
    const ch = chevronsIn((a) => legAt(n, l, a, el - lineIn(l.def)), (a) => legAt(n, nx, a, -(en - lineIn(nx.def))), a0, a1 + r * 0.6, Math.max(l.def.mph, nx.def.mph));
    chevrons.push(...ch.bars);
  });
  return { polys, chevrons };
}

// Where people cross a junction's arm (game/crowdsites.ts walks them there, roaddraw paints it): a
// little way back from the corner on a single carriageway with footways, clear of a roundabout's
// splitter island; null where there's no crossing (a dual carriageway, a raised junction, too short).
export function crossingAt(sh: Shape, form: string, l: ShapeLeg, y = 0): number | null {
  const d = l.def;
  if (d.pave <= 0 || d.lanes > 1 || d.median > 0 || Math.abs(y) > 0.3) return null;
  const trim = sh.paveTrim[l.id];
  if (!trim) return null;
  let t = Math.max(trim[0], trim[1]) + 1.2;
  if (form === 'roundabout') t = Math.max(t, sh.R + STD.splitter.length + 1.5);
  return t > l.len - 12 ? null : t;
}

// The footprint of a roundabout of radius R: can it go here? (the ring and its footway)
export const ringFootprint = (n: XZ, R: number, footway = 3) => circlePoly(n, R + footway, 28);
