// Junction geometry, worked out once and used by everything: the carriageway (with proper kerb
// radii at the corners, or a roundabout with flared entries), the footway around it, the islands,
// the slip road, where each road's own markings stop, and where its stop or give-way line is.
// Drawing, traffic and the land registry all read the same shape, so they can't disagree.
import { circlePoly, bandPolys, type XZ } from './land';
import { kerbOf, halfOf, type RoadDef } from './catalog';
import { STD } from './standards';

export interface ShapeLeg { id: number; dir: XZ; ang: number; def: RoadDef; len: number }
export type ShapeForm = 'priority' | 'signals' | 'mini' | 'roundabout';
export interface SlipShape { from: number; to: number; path: XZ[]; island: XZ[]; outer: XZ[]; R: number; centre: XZ }
export interface Shape {
  form: ShapeForm;
  mouth: Record<number, number>; // where each road's own cross-section ends
  line: Record<number, number>; // where its stop / give-way line is (0: it has none)
  paveTrim: Record<number, [number, number]>; // where its footway ends, on its +b and -b sides
  medianTrim: Record<number, number>; // where its central reservation's nose is
  apron: XZ[]; // the carriageway inside the mouths
  pave: XZ[]; // the outer edge of the footway around it
  islands: XZ[][];
  slip: SlipShape | null;
  R: number; // roundabout: outer edge of the circulating carriageway
  island: number; // roundabout: radius of the central island
  claims: XZ[][]; // the land it takes
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
const gapOf = (a: ShapeLeg, b: ShapeLeg) => { let g = b.ang - a.ang; while (g <= 0) g += Math.PI * 2; return g; };
// the nearside general lane's centre, measured from the road's centreline
const nearLane = (d: RoadDef) => d.median / 2 + (d.lanes - 0.5) * d.lane;

// A corner between leg i's +b kerb and leg j's -b kerb, rounded with radius r (lines at offsets ki, kj).
function corner(n: XZ, li: ShapeLeg, lj: ShapeLeg, ki: number, kj: number, r: number) {
  const g = gapOf(li, lj);
  const pi = W(n, li.dir, 0, ki), pj = W(n, lj.dir, 0, -kj);
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
function slipFor(n: XZ, li: ShapeLeg, lj: ShapeLeg): SlipShape | null {
  const g = gapOf(li, lj);
  if (g < 0.6 || g > 2.2) return null;
  const s = Math.sin(g / 2), w = STD.slipWidth;
  const bi = nearLane(li.def), bj = nearLane(lj.def), ki = kerbOf(li.def), kj = kerbOf(lj.def);
  const d = Math.max(ki - bi, kj - bj);
  // big enough that a proper island (6 m deep) fits between the slip and the junction
  const R = Math.max(STD.slipRadius(Math.max(li.def.mph, lj.def.mph)), (6.3 + w / 2 + d / s) / (1 / s - 1));
  if (R > 48) return null;
  const pi = W(n, li.dir, 0, bi), pj = W(n, lj.dir, 0, -bj);
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
  const Ki = W(n, li.dir, 0, ki + 0.4), Kj = W(n, lj.dir, 0, -(kj + 0.4));
  const mk = meet(Ki, li.dir, Kj, lj.dir);
  const si = onLine(Ki, li.dir), sj = onLine(Kj, lj.dir);
  if (!mk || si === null || sj === null || si <= mk.s + 2 || sj <= mk.t + 2) return null;
  const X = add(Ki, li.dir, mk.s), P1 = add(Ki, li.dir, si), P2 = add(Kj, lj.dir, sj);
  const edge = arc(C, P1, P2, 0.1);
  const island = [X, ...edge];
  // the slip's outside footway edge
  const outer = arc(C, Ti, Tj, 0.08).map((p) => { const v = norm({ x: p.x - C.x, z: p.z - C.z }); return add(C, v, R - w / 2 - STD.slipFootway); });
  return { from: li.id, to: lj.id, path, island, outer, R, centre: C };
}

// Lines where a leg's kerb (offset k) meets a circle of radius R about the node, rounded by radius re.
function flare(n: XZ, l: ShapeLeg, k: number, R: number, re: number, side: 1 | -1) {
  const bc = k + re, dc = R + re;
  const ac = Math.sqrt(Math.max(0, dc * dc - bc * bc));
  const C = W(n, l.dir, ac, side * bc);
  const T = W(n, l.dir, ac, side * k);
  const v = norm({ x: C.x - n.x, z: C.z - n.z });
  const Q = add(n, v, R);
  return { a: ac, onLine: T, onRing: Q, centre: C, ringAng: Math.atan2(Q.z - n.z, Q.x - n.x) };
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
    const apron: XZ[] = [], pave: XZ[] = [];
    const F = std.footway;
    const ring = (outR: number, k: (l: ShapeLeg) => number, re: number, into: XZ[], record: boolean) => {
      for (let i = 0; i < N; i++) {
        const l = legs[i], nx = legs[(i + 1) % N];
        const lo = flare(n, l, k(l), outR, re, -1), hi = flare(n, l, k(l), outR, re, 1);
        const m = Math.max(lo.a, hi.a);
        if (record) {
          mouth[l.id] = m;
          line[l.id] = R + 0.4;
          medianTrim[l.id] = R + 1;
          paveTrim[l.id] = [hi.a, lo.a];
        }
        into.push(...arc(lo.centre, lo.onRing, lo.onLine), W(n, l.dir, m, -k(l)), W(n, l.dir, m, k(l)), ...arc(hi.centre, hi.onLine, hi.onRing));
        const next = flare(n, nx, k(nx), outR, re, -1);
        into.push(...arcCCW(n, outR, hi.ringAng, next.ringAng));
      }
    };
    ring(R, K, std.entryRadius, apron, true);
    ring(R + F, B, Math.max(1, std.entryRadius - F), pave, false);
    const claims = [pave];
    // splitter islands at single-lane entries
    if (form === 'roundabout') for (const l of legs) if (l.def.lanes === 1 && l.def.median === 0) {
      const { length: sl, width: sw } = STD.splitter;
      islands.push([W(n, l.dir, R + 0.8, -sw / 2), W(n, l.dir, R + 0.8, sw / 2), W(n, l.dir, R + sl, 0)]);
    }
    return { form, mouth, line, paveTrim, medianTrim, apron, pave, islands, slip: null, R, island: std.island, claims };
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
  legs.forEach((l, i) => {
    const m = mouth[l.id];
    apron.push(W(n, l.dir, m, -K(l)), W(n, l.dir, m, K(l)), ...corners[i].kerb.pts);
    const [tp, tm] = paveTrim[l.id];
    pave.push(W(n, l.dir, Math.max(m, tm), -B(l)), W(n, l.dir, Math.max(m, tp), B(l)), ...corners[i].back.pts);
  });
  const claims: XZ[][] = [pave, apron];
  if (slip) {
    islands.push(slip.island);
    claims.push(...bandPolys(slip.path, STD.slipWidth / 2 + 0.5, STD.slipWidth / 2 + STD.slipFootway + 0.5), slip.island);
  }
  return { form, mouth, line, paveTrim, medianTrim, apron, pave, islands, slip, R: 0, island: 0, claims };
}

// The footprint of a roundabout of radius R: can it go here? (the ring and its footway)
export const ringFootprint = (n: XZ, R: number, footway = 3) => circlePoly(n, R + footway, 28);
