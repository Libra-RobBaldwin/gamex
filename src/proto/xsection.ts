// Where a road changes type part-way (two roads of different kinds meeting end to end, with no
// junction), the wider one tapers into the narrower one instead of stopping dead. This module is
// the single description of that taper: drawing, the land it takes, and traffic (which lane
// ends where) all read it, so a lane that visibly ends is the lane cars have to leave.
//
// Measured as `u`, metres back from the join along the wider road, over its taper length Lt:
//   u ∈ [0, HOLD·Lt]            exactly the narrower road's cross-section (so the two meet cleanly)
//   u ∈ [HOLD·Lt, MEDIAN·Lt]    the reservation opens from the narrower road's width to the wider's,
//                               drawn as hatching (a ghost island), kerbs moving out to suit
//   u ∈ [MEDIAN·Lt, Lt]         the extra lanes (offside first) taper in from nothing to full width
// Beyond Lt the wider road is its own cross-section.
import { ROADS, halfOf, kerbOf, laneBase, type RoadDef } from './catalog';
import type { Network, P, RSeg } from './roads';
import { STD } from './standards';
import { approachPath, headShape, joinShape, type EndShape, type JoinShape } from './jshape';
import type { XZ } from './land';

const pathLength = (p: P[]) => p.reduce((t, q, i) => (i ? t + Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0);

export const TAPER = { hold: 0.12, median: 0.5 };

export interface Taper { node: number; atA: boolean; len: number; to: RoadDef }
export interface Ends2 { A: Taper | null; B: Taper | null }

// Two roads of different kinds meeting end to end at a node (and nothing else there).
function partner(net: Network, s: RSeg, node: number): RSeg | null {
  const at = net.segsAt(node).filter((x) => net.def(x).cls === 'road');
  if (at.length !== 2) return null;
  const o = at[0].id === s.id ? at[1] : at[0];
  return o.id === s.id ? null : o;
}
// (a one-way carriageway and a two-way road don't taper into each other: they're laid out differently)
const wider = (a: RoadDef, b: RoadDef) => !!a.oneway === !!b.oneway && (a.lanes > b.lanes || (a.lanes === b.lanes && (a.median > b.median || halfOf(a) > halfOf(b) + 0.05)));

export function taperOf(net: Network, s: RSeg): Ends2 {
  const d = net.def(s), L = net.length(s);
  const at = (node: number, atA: boolean): Taper | null => {
    if (d.cls !== 'road') return null;
    const o = partner(net, s, node);
    if (!o) return null;
    const od = net.def(o);
    if (od.id === d.id || !wider(d, od)) return null;
    return { node, atA, to: od, len: Math.max(12, Math.min(STD.taperLength(d.mph), L * 0.45)) };
  };
  return { A: at(s.a, true), B: at(s.b, false) };
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// The cross-section at distance t along s (from its a end), per side of the centreline.
export interface Section2 {
  median: number; // half-width of the reservation (hatched while it's opening); on a one-way carriageway, where its lanes start (laneBase: negative)
  hatched: boolean; // the reservation here is a painted ghost island, not a kerbed one
  lanes: number; // general lanes each way, counting a tapering lane as a fraction
  lane: number; // lane width
  kerb: number; // centreline to kerb
  back: number; // centreline to back of footway / verge
}
export function sectionAt(net: Network, s: RSeg, t: number, ends: Ends2 = taperOf(net, s)): Section2 {
  const d = net.def(s), L = net.length(s);
  const own = { median: laneBase(d), lanes: d.lanes, lane: d.lane, extra: kerbOf(d) - laneBase(d) - d.lanes * d.lane, back: halfOf(d) - kerbOf(d) };
  let T: Taper | null = null, u = Infinity;
  if (ends.A && t < ends.A.len) { T = ends.A; u = t; }
  if (ends.B && L - t < ends.B.len && L - t < u) { T = ends.B; u = L - t; }
  if (!T) return { median: own.median, hatched: false, lanes: own.lanes, lane: own.lane, kerb: kerbOf(d), back: halfOf(d) };
  const n = T.to, x = u / T.len;
  const to = { median: laneBase(n), lanes: n.lanes, lane: n.lane, extra: kerbOf(n) - laneBase(n) - n.lanes * n.lane, back: halfOf(n) - kerbOf(n) };
  const km = smooth((x - TAPER.hold) / (TAPER.median - TAPER.hold)), kl = smooth((x - TAPER.median) / (1 - TAPER.median));
  const median = to.median + (own.median - to.median) * km;
  const lanes = to.lanes + (own.lanes - to.lanes) * kl;
  const lane = to.lane + (own.lane - to.lane) * km;
  const extra = to.extra + (own.extra - to.extra) * km;
  const kerb = median + lanes * lane + extra;
  return { median, hatched: km < 0.999 && own.median > to.median, lanes, lane, kerb, back: kerb + to.back + (own.back - to.back) * km };
}

// Where general lane `lane` (0 = nearside) is usable when driving along s away from node `from`:
// [start, end] in metres from `from`. A lane that tapers away is usable until it's half gone.
export function laneSpan(net: Network, s: RSeg, from: number, lane: number, ends: Ends2 = taperOf(net, s)): [number, number] {
  const d = net.def(s), L = net.length(s);
  if (lane >= d.lanes) return [L, L];
  let s0 = 0, s1 = L;
  const half = TAPER.median + (1 - TAPER.median) / 2;
  for (const T of [ends.A, ends.B]) {
    if (!T || lane < T.to.lanes) continue;
    const gone = T.len * half; // metres from the join where the lane is half its width
    const nearFrom = (T.atA && from === s.a) || (!T.atA && from === s.b);
    if (nearFrom) s0 = Math.max(s0, gone); // the lane opens up after the join
    else s1 = Math.min(s1, L - gone); // the lane ends before the join
  }
  return [s0, Math.max(s0, s1)];
}
export const roadDef = (id: string) => ROADS[id];

// ---- the course: where a road is drawn, and the land it takes ----
// A road's own path runs node to node, but what's drawn carries on past its ends: round the curve
// into the next road where two meet with no junction (see jshape.joinShape), and on off the edge of
// the map where a road heads out of it. Drawing and the land registry both follow the course, so
// they can't disagree. Distances along the course are `rho`; along the road's own path, `t`.
export type EndKind = 'junction' | 'join' | 'edge' | 'head' | 'end';
export interface Course {
  path: P[]; // the centreline as drawn, with points every couple of metres through a taper
  rho: number[]; // distance along the course of each point
  len: number;
  kinds: [EndKind, EndKind];
  own: [number, number]; // where along the course the road's own path starts and stops
  cut: [number, number]; // how much of the road's own path each join's curve takes over
  joins: [JoinShape | null, JoinShape | null];
  heads: [EndShape | null, EndShape | null];
  fills: [XZ[] | null, XZ[] | null]; // this road's half of the inside corner of the footway at each join
  onward: [{ sec: Section2; def: RoadDef } | null, { sec: Section2; def: RoadDef } | null]; // the next road's cross-section at each join
  dirs: [XZ | null, XZ | null]; // the way the course runs at its first and last points, where a join's middle fixes it
  taper: Ends2;
  tau(r: number): number; // the road's own t for a distance along the course (beyond its ends in the joins)
  rhoOf(t: number): number;
  sec(r: number): Section2; // the cross-section (blending into the next road's round a join)
  // round the inside of a join's curve nothing can reach past its centre: which side, and how far
  limit(r: number): { side: number; r: number } | null;
}

// Whether a road at a dead end heads out of the map (and so runs on to where the ground ends).
function offEdge(net: Network, n: P, out: XZ) {
  const B = net.bound, near = B - STD.mapEdge;
  const c = { x: -out.x, z: -out.z }; // the way the road would carry on
  const heads = (p: number, u: number) => Math.abs(p) > near && Math.sign(u) === Math.sign(p) && Math.abs(u) > 0.5;
  if (!heads(n.x, c.x) && !heads(n.z, c.z)) return null;
  const G = net.edge;
  const k = Math.min(c.x ? (Math.sign(c.x) * G - n.x) / c.x : Infinity, c.z ? (Math.sign(c.z) * G - n.z) / c.z : Infinity);
  return k > 1 ? { x: n.x + c.x * k, z: n.z + c.z * k } : null;
}
// a road that ends in a cul-de-sac gets a turning head; bigger roads just stop
const turnsRound = (d: RoadDef) => d.cls === 'road' && d.lanes === 1 && d.median === 0 && (d.family === 'Street' || d.family === 'Avenue' || d.family === 'Rural' || d.family === 'Arterial');
const unit = (a: P, b: P) => { const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / L, z: (b.z - a.z) / L }; };
function at(path: P[], s: number) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === path.length - 1) { const k = L ? Math.max(0, Math.min(1, s / L)) : 0; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * k }; }
    s -= L;
  }
  return { x: path[0].x, z: path[0].z, y: path[0].y ?? 0 };
}
// points at the given (sorted) distances along a path, in one pass
function along(path: P[], ts: number[]): P[] {
  const out: P[] = [];
  let i = 1, acc = 0;
  for (const t of ts) {
    while (i < path.length - 1 && acc + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) < t) { acc += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); i++; }
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z), k = L ? Math.max(0, Math.min(1, (t - acc) / L)) : 0;
    out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * k });
  }
  return out;
}
export function endKind(net: Network, s: RSeg, node: number): EndKind {
  const n = net.segsAt(node).length;
  if (n >= 3) return 'junction';
  if (n === 2) return 'join';
  const p = net.pathFrom(s, node);
  if (offEdge(net, p[0], unit(p[0], p[1]))) return 'edge';
  // (a stub too short to hold a turning head clear of whatever it leaves just ends: a turning head
  // there would swallow the junction it comes off)
  return turnsRound(net.def(s)) && net.length(s) >= STD.turningHead.minRoad ? 'head' : 'end';
}
const lerp2 = (a: Section2, b: Section2, f: number): Section2 => ({
  median: a.median + (b.median - a.median) * f, hatched: a.hatched, lanes: a.lanes + (b.lanes - a.lanes) * f, lane: a.lane + (b.lane - a.lane) * f,
  kerb: a.kerb + (b.kerb - a.kerb) * f, back: a.back + (b.back - a.back) * f,
});

export function courseOf(net: Network, s: RSeg, taper: Ends2 = taperOf(net, s)): Course {
  const kinds: [EndKind, EndKind] = [endKind(net, s, s.a), endKind(net, s, s.b)];
  // (into a junction the road runs straight for its first few metres, as the junction is built on it)
  let own = net.path(s);
  if (kinds[0] === 'junction') own = approachPath(own);
  if (kinds[1] === 'junction') own = approachPath(own.slice().reverse()).reverse();
  const d = net.def(s), L = pathLength(own);
  const joins: [JoinShape | null, JoinShape | null] = [null, null], heads: [EndShape | null, EndShape | null] = [null, null];
  // round a join the cross-section blends to halfway between the two roads' by the middle of the curve
  const halfway: [Section2 | null, Section2 | null] = [null, null], fills: Course['fills'] = [null, null], onward: Course['onward'] = [null, null];
  const cut: [number, number] = [0, 0], dirs: [XZ | null, XZ | null] = [null, null], leg = [0, 0];
  const endSec = (x: RSeg, node: number) => sectionAt(net, x, x.a === node ? 0 : net.length(x));
  [s.a, s.b].forEach((node, e) => {
    const n = net.node(node), from = net.pathFrom(s, node);
    if (kinds[e] === 'join') {
      const o = net.segsAt(node).find((x) => x.id !== s.id)!;
      const mine = sectionAt(net, s, e ? L : 0, taper), theirs = endSec(o, node);
      // both roads work out the same curve: the lower id is always leg A
      const me = { path: from, kerb: mine.kerb, back: mine.back }, them = { path: net.pathFrom(o, node), kerb: theirs.kerb, back: theirs.back };
      const first = s.id < o.id, J = first ? joinShape(n, me, them) : joinShape(n, them, me), k = first ? 0 : 1;
      joins[e] = J;
      leg[e] = k;
      cut[e] = J.cut[k];
      const u = J.dir[k];
      dirs[e] = e ? { x: -u.x, z: -u.z } : u;
      halfway[e] = lerp2(mine, { ...theirs, hatched: mine.hatched }, 0.5);
      if (J.X) fills[e] = J.fill[k];
      onward[e] = { sec: theirs, def: net.def(o) };
    } else if (kinds[e] === 'head') {
      const u = unit(from[0], at(from, 6));
      heads[e] = headShape(n, { id: s.id, dir: u, ang: Math.atan2(u.z, u.x), def: d, len: L });
    }
  });
  // the road's own stretch, with extra points where its cross-section changes (tapers, lay-bys)
  const ts = new Set<number>([cut[0], L - cut[1]]);
  let acc = 0;
  for (let i = 1; i < own.length - 1; i++) { acc += Math.hypot(own[i].x - own[i - 1].x, own[i].z - own[i - 1].z); ts.add(acc); }
  for (const T of [taper.A, taper.B]) if (T) for (let u = 0; u <= T.len + 2; u += 2) ts.add(T.atA ? u : L - u);
  // (and near a join, where a footway may end or markings change)
  kinds.forEach((k, e) => { if (k === 'join') for (let u = 1.5; u < 9; u += 1.5) ts.add(e ? L - cut[1] - u : cut[0] + u); });
  for (const st of s.stops) { const a = st.s - 22, b = st.s + 22; for (let t = Math.max(0, a); t <= Math.min(L, b); t += 1.5) ts.add(t); }
  const mid = along(own, [...ts].filter((t) => t >= cut[0] - 1e-6 && t <= L - cut[1] + 1e-6).sort((x, y) => x - y));
  // and beyond its ends: round a join's curve, or off the edge of the map
  const beyond = (e: 0 | 1): P[] => {
    const node = e ? s.b : s.a, n = net.node(node);
    if (kinds[e] === 'join') return joins[e]!.arc[leg[e]].map((p) => ({ x: p.x, z: p.z, y: n.y }));
    if (kinds[e] === 'edge') { const f = net.pathFrom(s, node), far = offEdge(net, f[0], unit(f[0], f[1]))!; return [{ ...far, y: n.y }, { x: n.x, z: n.z, y: n.y }]; }
    return [];
  };
  const pre = beyond(0), post = beyond(1).reverse();
  // (the curve's last point is where the road's own stretch starts)
  const path = [...pre.slice(0, -1), ...mid, ...post.slice(1)];
  const rho = [0];
  for (let i = 1; i < path.length; i++) rho.push(rho[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  const len = rho[rho.length - 1];
  const o0 = pre.length ? rho[pre.length - 1] : 0, o1 = post.length ? rho[path.length - post.length] : len;
  const tau = (r: number) => r - o0 + cut[0], rhoOf = (t: number) => t - cut[0] + o0;
  // (a road with no taper is the same all along, so it's worked out once; through a taper, sectionAt
  // is asked through a stand-in for the network that already knows the road's length)
  const known = { def: () => d, length: () => L } as unknown as Network;
  const same = !taper.A && !taper.B ? sectionAt(known, s, 0, taper) : null;
  const own2 = (t: number) => same ?? sectionAt(known, s, Math.max(0, Math.min(L, t)), taper);
  const sec = (r: number): Section2 => {
    if (r >= o0 && r <= o1) return own2(tau(r));
    const e = r < o0 ? 0 : 1, base = own2(e ? L - cut[1] : cut[0]), h = halfway[e];
    if (!h) return base;
    const f = e ? (r - o1) / Math.max(1e-6, len - o1) : (o0 - r) / Math.max(1e-6, o0);
    return lerp2(base, h, f);
  };
  const limit = (r: number) => {
    if (r >= o0 - 1e-6 && r <= o1 + 1e-6) return null;
    const e = r < o0 ? 0 : 1;
    if (!joins[e]?.X) return null;
    const J = joins[e]!, k = leg[e];
    // the join's `inner` is a side of the path from the node outwards; at the b end that runs backwards
    const q = at(path, r);
    return { side: e ? -J.inner[k] : J.inner[k], r: Math.hypot(q.x - J.X!.x, q.z - J.X!.z) };
  };
  return { path, rho, len, kinds, own: [o0, o1], cut, joins, heads, fills, onward, dirs, taper, tau, rhoOf, sec, limit };
}

// The left-hand normal (Flat.strip's + side) at each point of a path: square to the pieces either
// side, or to a given direction at either end.
export function normals(path: P[], ends: [XZ | null, XZ | null] = [null, null]): XZ[] {
  const n = path.length;
  return path.map((_, i) => {
    const e = i === 0 ? ends[0] : i === n - 1 ? ends[1] : null;
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const u = e ?? { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    return { x: u.z, z: -u.x };
  });
}
