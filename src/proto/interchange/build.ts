// Grade-separated junctions, built from the network's own pieces: a motorway as a pair of one-way
// carriageways, slip roads that leave and join them (slips.ts), a bridge carrying the local road
// over them (chosen by the bridges library, game/bridges.ts), and roundabouts or give-way
// junctions where the slip roads meet it. Nothing here draws or drives: the network, the junction
// designer and the traffic take the pieces from there.
//
//   dumbbell  a roundabout either side of the motorway, the local road bridging it between them
//   diamond   the same with give-way junctions where the slip roads meet the local road
//   gsr       a grade-separated roundabout: a big one-way ring over the motorway on two bridges,
//             the local road and the slip roads meeting it at give-way junctions
//   trumpet   a T: the road meets the motorway from one side, as a pair of one-lane links from a
//             roundabout on it; a loop and a ramp wrapped round it carry the right turns, two
//             ramps the left turns; every join a merge or diverge (see buildTrumpet)
import { DEFAULT_OPTS, ROADS, closestOnPath, kerbOf, halfOf, minRadius, pathLength, pointAt, type End, type Network, type P, type RSeg, type RoadDef, type RoadOpts } from '../roads';
import { isSlip, laneBase, oneWay } from '../catalog';
import type { Limit } from '../grade';
import { STD } from '../standards';
import { GRADES } from '../grade';
import type { Form } from '../junction';
import { Land, bandPolys } from '../land';

export type IxForm = 'dumbbell' | 'gsr' | 'diamond' | 'trumpet';
// how much room it takes: tight, for a town (the motorway dips into a cutting under it, the local
// road climbs steeply over it, slip roads at 40 mph), or open, out in the country (everything at
// ground level, gentle gradients, 50 mph slip roads)
export type IxSize = 'tight' | 'open';
export const IX_SIZES: IxSize[] = ['tight', 'open'];
export const IX_SIZE_NAME: Record<IxSize, string> = { tight: 'Tight', open: 'Open' };
export const IX_SIZE_BLURB: Record<IxSize, string> = { tight: 'Compact, for a town: the motorway in a cutting, tighter slip roads', open: 'Spread out, for the country: at ground level, gentle curves' };
// depth: room for a deeper deck than the height solver allows for (a beam's, over a 30 m span); cut: how deep the motorway goes under it; grade: the local road's (or ring's) steepest; flat: how
// far the local road is level either side of a roundabout, past its ring; ringFlat: a ring's level
// stretch either side of each road meeting it; slip: the slip roads' type
// loop, ramp: a trumpet's loop's radius and its other ramps' curves
const SIZE: Record<IxSize, { cut: number; grade: number; flat: number; ringFlat: number; slip: string; depth: number; loop: number; ramp: number }> = {
  tight: { cut: 4, grade: 0.08, flat: 6, ringFlat: 12, slip: 'slip-40', depth: 1, loop: 48, ramp: 55 },
  open: { cut: 0, grade: 0.06, flat: 16, ringFlat: 22, slip: 'slip', depth: 2, loop: 90, ramp: 95 },
};
const MW_GRADE = 0.045; // how steeply the motorway dips into its cutting (DMRB: 3–4%, a little over at the limit)
export const IX_FORMS: IxForm[] = ['dumbbell', 'gsr', 'diamond', 'trumpet'];
export const IX_NAME: Record<IxForm, string> = { dumbbell: 'Dumbbell', gsr: 'Grade-separated roundabout', diamond: 'Diamond', trumpet: 'Trumpet' };
export const IX_BLURB: Record<IxForm, string> = {
  dumbbell: 'A roundabout either side, joined by a bridge over the motorway',
  gsr: 'One big roundabout, carried over the motorway on two bridges',
  diamond: 'Give-way junctions either side, joined by a bridge',
  trumpet: 'The road meets the motorway from one side only: a loop and a ramp round it, no traffic lights or give-ways on the motorway side',
};

// A junction built, as the junction designer and the player see it: one thing, many nodes.
export interface Interchange {
  id: number; form: IxForm; at: P; type: string; // where, and the motorway's type
  nodes: number[]; // its junctions: the slip roads' merges and diverges, the roundabouts or give-ways
  segs: number[]; // the roads it built (slip roads, the bridge, the ring)
  prefer: Record<number, Form>; // the form each of its junctions has to take
  slips: { seg: number; kind: 'merge' | 'diverge'; taper: number; nose: number; aux: number }[];
  style: SlipStyle;
  size: IxSize;
}

type V = { x: number; z: number };
const add = (p: V, u: V, k: number): P => ({ x: p.x + u.x * k, z: p.z + u.z * k });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, z: a.z - b.z });
const dot = (a: V, b: V) => a.x * b.x + a.z * b.z;
const unit = (u: V): V => { const l = Math.hypot(u.x, u.z) || 1; return { x: u.x / l, z: u.z / l }; };
const left = (u: V): V => ({ x: u.z, z: -u.x }); // left of travel (roads.sideOf's side 1)
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.z - b.z);

// How far apart a pair of carriageways' centrelines are: their verges, and between them the rest of
// the central reservation, wide enough for a bridge's pier (roaddraw puts a barrier either side).
export const RESERVATION = 10.5;
export function pairGap(type: string) { const d = oneWay(ROADS[type]); return 2 * (kerbOf(d) + d.verge) + RESERVATION; }

// A path moved sideways (left of its direction positive), mitred at its corners.
export function offsetPath(path: P[], o: number): P[] {
  const n = path.length;
  return path.map((p, i) => {
    const a = i > 0 ? unit(sub(p, path[i - 1])) : null, b = i < n - 1 ? unit(sub(path[i + 1], p)) : null;
    const u = a && b ? unit({ x: a.x + b.x, z: a.z + b.z }) : (a ?? b)!;
    const k = a && b ? 1 / Math.max(0.5, dot(u, a)) : 1;
    return add(p, left(u), o * k);
  });
}

// A cubic from p (heading hp) to q (heading hq), sampled every few metres.
function curve(p: P, hp: V, q: P, hq: V, k = 0.42): P[] {
  const L = dist(p, q), c1 = add(p, hp, L * k), c2 = add(q, hq, -L * k), n = Math.max(8, Math.ceil(L / 4)), out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * q.x, z: u * u * u * p.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * q.z });
  }
  return out;
}

// Build a road and say why not if it can't be.
function road(net: Network, a: End, b: End, o: RoadOpts, what: string): { ok: true; segs: number[] } | { ok: false; reason: string } {
  const c = net.check(a, b, undefined, o);
  if (!c.ok) return { ok: false, reason: `${what}: ${c.reason}` };
  for (const l of c.clears) net.lots = net.lots.filter((x) => x !== l);
  return { ok: true, segs: net.build(a, b, undefined, o) };
}
const at = (net: Network, p: P, tol = 1): End => { const n = net.nearestNode(p, tol, 'road'); return n ? { x: n.x, z: n.z, node: n.id } : { x: p.x, z: p.z }; };

// A motorway (or dual carriageway) as a pair of one-way carriageways either side of the line mw, run
// from its first point to its last: the one on its left runs that way, the other back.
// `heights`: height windows by distance along mw (a cutting at a junction), laid onto each carriageway.
export function buildPair(net: Network, mw: P[], type: string, opts: Partial<RoadOpts> = {}, heights: Limit[] = []) {
  const g = pairGap(type) / 2, o = { ...DEFAULT_OPTS, ...opts, type, oneway: true };
  const ab = offsetPath(mw, g), ba = offsetPath(mw, -g).reverse();
  const along = (path: P[], s: number) => closestOnPath(pointAt(mw, s), path).s;
  const lim = (path: P[]) => heights.map((h) => { const [s0, s1] = [along(path, h.s0), along(path, h.s1)].sort((x, y) => x - y); return { ...h, s0, s1 }; });
  // (a motorway in a cutting is built in 'tunnel' mode, which lets it go below the ground)
  const oc = heights.length ? { ...o, cross: 'tunnel' as const } : o;
  const A = road(net, at(net, ab[0]), at(net, ab[ab.length - 1]), { ...oc, path: ab, limits: [...(o.limits ?? []), ...lim(ab)] }, 'One carriageway');
  if (!A.ok) return A;
  const B = road(net, at(net, ba[0]), at(net, ba[ba.length - 1]), { ...oc, path: ba, limits: [...(o.limits ?? []), ...lim(ba)] }, 'The other carriageway');
  if (!B.ok) return B;
  // (the reservation between them is the motorway's land too: no trees or plots in it)
  net.land.claim(`reservation:${A.segs[0]}`, 'road', bandPolys(mw, RESERVATION / 2 + 0.5, RESERVATION / 2 + 0.5));
  return { ok: true as const, ab: A.segs, ba: B.segs };
}

// A motorway pair that ends at a junction (a roundabout, say) at the far end of mw: the two
// carriageways splay in over their last stretch and meet the node at `splay` either side of the
// line, so each has its own mouth on the ring; the one running the way mw was drawn arrives there,
// the other leaves from it. `end` is the node, or where one is to be.
export function pairToNode(net: Network, mw: P[], type: string, end: End, splay = 0.3, opts: Partial<RoadOpts> = {}) {
  const g = pairGap(type) / 2, o = { ...DEFAULT_OPTS, ...opts, type, oneway: true }, L = pathLength(mw);
  const q = pointAt(mw, L), u = { x: q.ux, z: q.uz }, n = left(u), run = Math.min(L * 0.4, g / Math.tan(splay) * 2.2);
  const side = (k: 1 | -1) => {
    const straight = offsetPath(subPathOf(mw, 0, L - run), k * g), A = straight[straight.length - 1];
    // heading in towards the node, `splay` off the line on this side (towards its middle)
    const h = unit({ x: u.x * Math.cos(splay) - n.x * k * Math.sin(splay), z: u.z * Math.cos(splay) - n.z * k * Math.sin(splay) });
    return [...straight.slice(0, -1), ...curve(A, u, { x: end.x, z: end.z }, h, 0.4)];
  };
  const ab = side(1), ba = side(-1).reverse();
  const A = road(net, at(net, ab[0]), end, { ...o, path: ab }, 'One carriageway');
  if (!A.ok) return A;
  const nd = net.nearestNode(end, 0.5);
  const B = road(net, nd ? { x: nd.x, z: nd.z, node: nd.id } : end, at(net, ba[ba.length - 1]), { ...o, path: ba }, 'The other carriageway');
  if (!B.ok) return B;
  return { ok: true as const, ab: A.segs, ba: B.segs };
}
// Every two-way motorway that runs from a dead end (off the map, say) to a junction, rebuilt as a
// pair of one-way carriageways splaying into that junction (the starter town's, laid out as the
// map's streets: src/proto/region/town.ts). Anything that can't be is left as it was.
export function pairUpMotorways(net: Network) {
  for (const s of [...net.segs.values()]) {
    if (s.oneway || s.type !== 'motorway' || s.mid.length) continue;
    const ends = [s.a, s.b].map((n) => net.segsAt(n).length);
    const [dead, jn] = ends[0] === 1 && ends[1] >= 3 ? [s.a, s.b] : ends[1] === 1 && ends[0] >= 3 ? [s.b, s.a] : [-1, -1];
    if (dead < 0) continue;
    const A = net.node(dead), J = net.node(jn), type = s.type;
    const trial = scratch(net);
    trial.removeSeg(s.id);
    if (!pairToNode(trial, [{ x: A.x, z: A.z }, { x: J.x, z: J.z }], type, { x: J.x, z: J.z, node: jn }).ok) continue;
    net.removeSeg(s.id);
    pairToNode(net, [{ x: A.x, z: A.z }, { x: J.x, z: J.z }], type, { x: J.x, z: J.z, node: jn });
  }
}

// the part of a path between two distances along it
function subPathOf(path: P[], s0: number, s1: number): P[] {
  const out: P[] = [pointAt(path, s0)];
  let acc = 0;
  for (let i = 1; i < path.length; i++) { acc += dist(path[i - 1], path[i]); if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(path[i]); }
  out.push(pointAt(path, s1));
  return out.map((p) => ({ x: p.x, z: p.z }));
}

// The carriageway of a pair running in direction w at a point (within a couple of metres).
function carriagewayAt(net: Network, p: P, w: V, type: string): RSeg | null {
  let best: RSeg | null = null, bd = 2.5;
  for (const s of net.segs.values()) {
    if (!s.oneway || s.type !== type) continue;
    const c = closestOnPath(p, net.path(s));
    if (c.d < bd && dot({ x: c.ux, z: c.uz }, w) > 0.9) { bd = c.d; best = s; }
  }
  return best;
}

// Where a junction goes: the motorway's line (its middle, the way it was drawn), how far along it
// the junction's centre is, and the local road it serves (an existing road crossing the line
// there, or `road` null: a road of `roadType` to come, the junction's own link runs square across).
// style: taper merges and diverges, or (parallel) slip roads with an auxiliary lane alongside (STD.parallel)
export type SlipStyle = 'taper' | 'parallel';
// cut: how deep the motorway is under the junction (0: at ground level)
export interface Site { mw: P[]; type: string; s: number; road: RSeg | null; roadType?: string; style?: SlipStyle; size?: IxSize; cut?: number }
type Fail = { ok: false; reason: string };

// The junction's layout: its centre and the motorway's direction there, the local road's
// direction (pointing to the carriageway running the way the line was drawn), and where the local
// road meets the junction either side (the two roundabouts or give-ways, or the ring).
function layout(net: Network | null, form: IxForm, site: Site) {
  const q = pointAt(site.mw, site.s), u = { x: q.ux, z: q.uz }, X: P = { x: q.x, z: q.z }, nl = left(u);
  const g = pairGap(site.type) / 2, Dc = oneWay(ROADS[site.type]);
  let v: V = nl, type = site.roadType ?? 'dual';
  if (site.road && net) { const c = closestOnPath(X, net.path(site.road)); v = { x: c.ux, z: c.uz }; type = site.road.type; }
  if (dot(v, nl) < 0) v = { x: -v.x, z: -v.z };
  const sin = Math.abs(u.x * v.z - u.z * v.x), half = (g + halfOf(Dc) + 1.5) / Math.max(0.3, sin);
  const SZ = SIZE[site.size ?? 'open'], rise = Math.max(3, GRADES.road.clear - (site.cut ?? 0) + SZ.depth); // (how far it climbs over the motorway)
  if (form === 'trumpet') { const T = trumpetLayout(site, v); return { X, u, v, sin, type, g, Dc, radius: 0, R1: T.Nr, R2: T.far, half }; }
  if (form === 'gsr') {
    const G = Math.min(SZ.grade, ROADS['gsr-ring'].maxGrade);
    // big enough that between the slip roads' nodes and the motorway the ring can climb over it
    const Rg = Math.ceil((rise / G + SZ.ringFlat + half * 1.2) / (Math.PI / 2 - SPREAD) + 2);
    return { X, u, v, sin, type, g, Dc, radius: Rg, R1: add(X, v, Rg), R2: add(X, v, -Rg), half };
  }
  const L = ROADS[type], G = Math.min(SZ.grade, L.maxGrade), radius = form === 'dumbbell' ? STD.roundabout(2, true).R : 0;
  // far enough out that the bridge can climb over both carriageways and be level again at the nodes
  const dR = half + rise / G + radius + SZ.flat + 8;
  return { X, u, v, sin, type, g, Dc, radius, R1: add(X, v, dR), R2: add(X, v, -dR), half };
}
const SPREAD = 0.42, ENTRY = 0.7; // how far round from the local road the slip roads meet it (radians); the angle slip roads meet a ring at

// The local road's two nodes at the junction: an existing road is cut there and the stretch
// between taken away (the bridge or the ring replaces it); otherwise two new nodes.
// (`farOptional`: a trumpet's far side, which only stops short: if the road ends before R2, all of it
// past the junction goes)
function localNodes(net: Network, site: Site, R1: P, R2: P, farOptional = false): { ok: true; n: [number, number] } | Fail {
  if (!site.road) return { ok: true, n: [net.addNode(R1.x, R1.z), net.addNode(R2.x, R2.z)] };
  const road0 = site.road, path = net.path(road0), c1 = closestOnPath(R1, path), c2 = closestOnPath(R2, path), L = net.length(road0);
  if (farOptional && c1.d <= 4 && c1.s >= 15 && c1.s <= L - 15 && (c2.d > 4 || c2.s < 15 || c2.s > L - 15)) {
    // cut at R1 and take away everything on the far side (where the road runs on past the junction)
    const na = net.split(road0.id, R1), X = pointAt(site.mw, site.s);
    const beyond = net.segsAt(na).find((x) => closestOnPath(X, net.path(x)).d < 6);
    if (beyond) net.removeSeg(beyond.id);
    return { ok: true, n: [na, -1] };
  }
  if (c1.d > 4 || c2.d > 4 || Math.min(c1.s, c2.s) < 15 || Math.max(c1.s, c2.s) > L - 15) return { ok: false, reason: 'The road needs to carry on further either side of the motorway for a junction here' };
  const [first, second] = c1.s < c2.s ? [R1, R2] : [R2, R1];
  const na = net.split(road0.id, first);
  const rest = net.segsAt(na).find((x) => closestOnPath(second, net.path(x)).d < 4 && net.other(x, na) !== road0.a);
  if (!rest) return { ok: false, reason: 'The road couldn’t be split for the junction' };
  const nb = net.split(rest.id, second);
  const mid = net.segsAt(na).find((x) => net.other(x, na) === nb);
  if (mid) net.removeSeg(mid.id);
  return { ok: true, n: first === R1 ? [na, nb] : [nb, na] };
}

// Build a junction on a motorway pair that already exists. `nodes`: the local road's two nodes, if
// already made (motorwayWithJunction cuts the road before the carriageways go through).
export function buildJunction(net: Network, form: IxForm, site: Site, id = 0, nodes?: [number, number]): { ok: true; ix: Interchange } | Fail {
  return allOrNothing(net, (n) => buildJunctionOn(n, form, { ...site, road: site.road ? n.segs.get(site.road.id) ?? null : null }, id, nodes));
}
// A junction is built whole or not at all: it's tried on a copy of the network first, and only built
// for real if every piece of it can be.
function allOrNothing<R extends { ok: boolean }>(net: Network, f: (n: Network) => R): R {
  const r = f(scratch(net));
  return r.ok ? f(net) : r;
}
function buildJunctionOn(net: Network, form: IxForm, site: Site, id = 0, nodes?: [number, number]): { ok: true; ix: Interchange } | Fail {
  const lay = layout(net, form, site);
  if (lay.sin < 0.6) return { ok: false, reason: 'The road crosses the motorway at too shallow an angle for a junction' };
  let ends = nodes;
  if (!ends) { const ln = localNodes(net, site, lay.R1, lay.R2); if (!ln.ok) return ln; ends = ln.n; }
  return form === 'gsr' ? buildGSR(net, site, lay, ends, id) : form === 'trumpet' ? buildTrumpet(net, site, ends, id) : buildTwo(net, form, site, lay, ends, id);
}

type Lay = ReturnType<typeof layout>;
function buildTwo(net: Network, form: IxForm, site: Site, lay: Lay, [n1, n2]: [number, number], id: number): { ok: true; ix: Interchange } | Fail {
  const { X, type, radius } = lay, ring = form === 'dumbbell';
  const R1 = net.node(n1), R2 = net.node(n2);
  const nodes: number[] = [n1, n2], segs: number[] = [], prefer: Record<number, Form> = {}, slips: Interchange['slips'] = [];
  // the bridge, level where it meets the roundabouts
  const SZ = SIZE[site.size ?? 'open'], flat = radius + SZ.flat, Lb = dist(R1, R2);
  const br = road(net, { x: R1.x, z: R1.z, node: n1 }, { x: R2.x, z: R2.z, node: n2 }, { ...DEFAULT_OPTS, type, grade: SZ.grade, cross: 'bridge', limits: [{ s0: 0, s1: flat, lo: 0, hi: 0, why: 'the roundabout' }, { s0: Lb - flat, s1: Lb, lo: 0, hi: 0, why: 'the roundabout' }] }, 'The bridge');
  if (!br.ok) return br;
  segs.push(...br.segs);
  // each carriageway's slip roads, on its nearside, to the node on that side
  for (const [side, R, n] of [[1, R1, n1], [-1, R2, n2]] as const) {
    const sp = slipPaths(site, side, R, Math.max(radius, 12), X);
    if (!sp) return { ok: false, reason: 'There isn’t room for the slip roads to curve round to the local road' };
    const r = slipRoads(net, site, sp, { x: R.x, z: R.z, node: n }, { x: R.x, z: R.z, node: n });
    if (!r.ok) return r;
    segs.push(...r.segs); nodes.push(...r.nodes); slips.push(...r.slips);
    prefer[n] = ring ? 'roundabout' : 'priority';
  }
  // (a roundabout's ring has its land clear: anything standing on it is bought and cleared)
  if (ring) for (const n of [n1, n2]) { const c = net.node(n); net.lots = net.lots.filter((l) => Math.hypot(l.x - c.x, l.z - c.z) > radius + 3 + Math.hypot(l.w, l.d) / 2); }
  return { ok: true, ix: { id, form, at: X, type: site.type, nodes, segs, prefer, slips, style: site.style ?? 'taper', size: site.size ?? 'open' } };
}

// A side's slip roads: the off-slip from its diverge to `offTo`, the on-slip from `onFrom` to its merge.
function slipRoads(net: Network, site: Site, sp: NonNullable<ReturnType<typeof slipPaths>>, offTo: End, onFrom: End) {
  const [r0, r1] = sp.reach, mwL = pathLength(site.mw), side = sp.side;
  if (Math.min(site.s + side * r0, site.s + side * r1) < 0 || Math.max(site.s + side * r0, site.s + side * r1) > mwL) return { ok: false as const, reason: 'The motorway needs to run further either side of the junction for its slip roads' };
  const dc = carriagewayAt(net, sp.off[0], sp.w, site.type);
  if (!dc) return { ok: false as const, reason: 'No carriageway where the slip road should leave it' };
  const off = road(net, { ...sp.off[0], seg: dc.id }, offTo, { ...DEFAULT_OPTS, type: SIZE[site.size ?? 'open'].slip, oneway: true, path: sp.off }, 'The off-slip');
  if (!off.ok) return off;
  const mc = carriagewayAt(net, sp.on[sp.on.length - 1], sp.w, site.type);
  if (!mc) return { ok: false as const, reason: 'No carriageway where the slip road should join it' };
  const on = road(net, onFrom, { ...sp.on[sp.on.length - 1], seg: mc.id }, { ...DEFAULT_OPTS, type: SIZE[site.size ?? 'open'].slip, oneway: true, path: sp.on }, 'The on-slip');
  if (!on.ok) return on;
  // (a slip road with an auxiliary lane says so: the merge or diverge lays it out from that)
  if (sp.aux) for (const id of [off.segs[0], on.segs[on.segs.length - 1]]) { const sg = net.segs.get(id); if (sg) sg.aux = sp.aux; }
  const nodes: number[] = [];
  const dn = net.nearestNode(sp.off[0], 0.6), mn = net.nearestNode(sp.on[sp.on.length - 1], 0.6);
  if (dn) nodes.push(dn.id);
  if (mn) nodes.push(mn.id);
  const slips: Interchange['slips'] = [{ seg: off.segs[0], kind: 'diverge', taper: sp.dv.taper - sp.aux, nose: sp.dv.nose, aux: sp.aux }, { seg: on.segs[on.segs.length - 1], kind: 'merge', taper: sp.mg.taper - sp.aux, nose: sp.mg.nose, aux: sp.aux }];
  return { ok: true as const, segs: [...off.segs, ...on.segs], nodes, slips };
}

// The geometry of one side's two slip roads, for the carriageway on that side (side 1: the one
// running the way the motorway's line was drawn), whose nearside is towards the node `R` they meet
// the local road at, arriving and leaving it at 45° to the local road. (`offTo`, `onFrom`: where on
// a ring they meet it instead, square to it.)
function slipPaths(site: Site, side: 1 | -1, R: P, radius: number, X: P, ring?: { offTo: P; onFrom: P; hOff: V; hOn: V; clear: number }) {
  const g = pairGap(site.type) / 2, Dc = oneWay(ROADS[site.type]), S = ROADS[SIZE[site.size ?? 'open'].slip], K = kerbOf(Dc), Ks = kerbOf(S);
  const q = pointAt(site.mw, site.s), u = { x: q.ux, z: q.uz }, w = side === 1 ? u : { x: -u.x, z: -u.z }, m = left(w);
  const eN = K + STD.noseTip + Ks; // (the nose starts exactly where the kerbs have parted by its tip: see slips.ts)
  // where the slip lane is when it's the next lane over, and so where it runs from across the nose,
  // in a straight line out to eN (slips.ts lays its lane across the nose along that same line)
  const ec = laneBase(Dc) + (Dc.lanes + 0.5) * Dc.lane, half = (e: number) => ec + (eN - ec) * e;
  // a point t metres along the carriageway from level with X (in its direction), e out from its centreline
  const F = (t: number, e: number) => { const s = site.s + side * t, c = pointAt(site.mw, s), n = left({ x: c.ux, z: c.uz }); return add(c, n, side * (g + e)); };
  const vs = unit(sub(R, X));
  // the headings they meet the local road at (into it for the off-slip, out of it for the on-slip), and a point on the way
  const hOff = ring ? ring.hOff : unit({ x: vs.x + w.x, z: vs.z + w.z }), hOn = ring ? ring.hOn : unit({ x: -vs.x + w.x, z: -vs.z + w.z });
  // (round a ring, a slip road keeps outside it, bar where it meets it)
  const outside = (pts: P[], end: P) => !ring || pts.every((p) => dist(p, end) < 40 || dist(p, X) > ring.clear);
  const offTo = ring?.offTo ?? R, onFrom = ring?.onFrom ?? R;
  // (straight for the last stretch into the node: at a ring the junction's corner, at 40° to it, runs a long way back)
  const straight = ring ? 60 : radius + 22, Qoff = add(offTo, hOff, -straight), Qon = add(onFrom, hOn, straight);
  const along = (p: P) => dot(sub(p, X), w), lateral = (p: P) => dot(sub(p, X), m) - g;
  const dv0 = STD.diverge(Dc.mph), mg0 = STD.merge(Dc.mph);
  // (the nose starts where the kerbs have parted by its tip, a little short of the point the slip road
  // is laid alongside from: laid a few metres longer, so the nose the junction finds meets the standard)
  const dv = { ...dv0, nose: dv0.nose + 5 }, mg = { ...mg0, nose: mg0.nose + 5 };
  const par = site.style === 'parallel' ? STD.parallel(Dc.mph) : null, aux = par?.length ?? 0;
  if (par) { dv.taper = par.taper + aux; mg.taper = par.taper + aux; } // (how far along the carriageway each reaches)
  for (const k of [1.1, 1.4, 1.8, 2.3]) {
    // the diverge: its node where the lanes part (td), out along the taper's line to the nose, and on
    // at that angle (it leaves the motorway as it leaves the lane) as it curves round to the road
    const spanOff = Math.max(40, k * (lateral(Qoff) - eN)), td = along(Qoff) - spanOff - dv.nose;
    const nOff = F(td + dv.nose, eN), hNoff = unit(sub(nOff, F(td + dv.nose / 2, half(0.5))));
    const off = [F(td, 0), F(td + dv.nose / 2, half(0.5)), ...curve(nOff, hNoff, Qoff, hOff), { x: offTo.x, z: offTo.z }];
    // the merge: from the road round to the nose, arriving at the taper's angle, closing in at tm
    const spanOn = Math.max(40, k * (lateral(Qon) - eN)), tm = along(Qon) + spanOn + mg.nose;
    const nOn = F(tm - mg.nose, eN), hNon = unit(sub(F(tm - mg.nose / 2, half(0.5)), nOn));
    const on = [{ x: onFrom.x, z: onFrom.z }, ...curve(Qon, hOn, nOn, hNon), F(tm - mg.nose / 2, half(0.5)), F(tm, 0)];
    if (minRadius(off.slice(1, -1)) >= S.minR && minRadius(on.slice(1, -1)) >= S.minR && outside(off, offTo) && outside(on, onFrom))
      return { off, on, w, side, reach: [td - dv.taper - 20, tm + mg.taper + 20] as [number, number], dv, mg, aux };
  }
  return null;
}

// A grade-separated roundabout: a one-way ring about the junction's centre (going round with the
// island on the right), over the motorway on two bridges, level where each road meets it.
// where on the ring each side's slip roads meet it, and the headings they meet it at (40° to it:
// turning in onto it, turning out off it)
function gsrSlips(lay: Lay, side: 1 | -1) {
  const { X, v, radius: Rg } = lay, av = Math.atan2(v.z, v.x), base = side === 1 ? av : av + Math.PI;
  const onRing = (a: number): P => ({ x: X.x + Math.cos(a) * Rg, z: X.z + Math.sin(a) * Rg });
  const tan = (p: P) => unit({ x: -(p.z - X.z), z: p.x - X.x }), rot = (h: V, a: number) => ({ x: h.x * Math.cos(a) - h.z * Math.sin(a), z: h.x * Math.sin(a) + h.z * Math.cos(a) });
  const off = onRing(base - SPREAD), on = onRing(base + SPREAD);
  return { off, on, ring: { offTo: off, onFrom: on, hOff: rot(tan(off), ENTRY), hOn: rot(tan(on), -ENTRY), clear: Rg + 14 } };
}
function buildGSR(net: Network, site: Site, lay: Lay, [rn1, rn2]: [number, number], id: number): { ok: true; ix: Interchange } | Fail {
  const { X, v, radius: Rg } = lay, av = Math.atan2(v.z, v.x);
  const onRing = (a: number): P => ({ x: X.x + Math.cos(a) * Rg, z: X.z + Math.sin(a) * Rg });
  const nodes: number[] = [], segs: number[] = [], prefer: Record<number, Form> = {}, slips: Interchange['slips'] = [];
  // the ring's nodes: the local road's either side, and the slip roads' either side of each
  const around: { a: number; node: number }[] = [{ a: av, node: rn1 }, { a: av + Math.PI, node: rn2 }];
  const slipNode = new Map<string, number>();
  for (const [side, base] of [[1, av], [-1, av + Math.PI]] as const) for (const d of [-SPREAD, SPREAD]) {
    const p = onRing(base + d), n = net.addNode(p.x, p.z);
    around.push({ a: base + d, node: n });
    slipNode.set(`${side}:${d < 0 ? 'off' : 'on'}`, n); // (off-slips meet it on the side traffic comes from)
  }
  const norm = (a: number) => ((((a - av) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  around.sort((x, y) => norm(x.a) - norm(y.a));
  for (let i = 0; i < around.length; i++) {
    const A = around[i], B = around[(i + 1) % around.length];
    let a1 = B.a;
    while (a1 <= A.a) a1 += Math.PI * 2;
    const n = Math.max(6, Math.ceil(((a1 - A.a) * Rg) / 4)), pts: P[] = [];
    for (let k = 0; k <= n; k++) pts.push(onRing(A.a + ((a1 - A.a) * k) / n));
    const Lr = pathLength(pts), fl = Math.min(SIZE[site.size ?? 'open'].ringFlat, Lr / 2);
    const r = road(net, { ...pts[0], node: A.node }, { ...pts[n], node: B.node }, { ...DEFAULT_OPTS, type: 'gsr-ring', grade: SIZE[site.size ?? 'open'].grade, oneway: true, cross: 'bridge', path: pts, limits: [{ s0: 0, s1: fl, lo: 0, hi: 0, why: 'the junction' }, { s0: Lr - fl, s1: Lr, lo: 0, hi: 0, why: 'the junction' }] }, 'The roundabout');
    if (!r.ok) return r;
    segs.push(...r.segs);
  }
  // each carriageway's slip roads, to the ring's nodes on its side
  for (const side of [1, -1] as const) {
    const offN = net.node(slipNode.get(`${side}:off`)!), onN = net.node(slipNode.get(`${side}:on`)!);
    const R = side === 1 ? net.node(rn1) : net.node(rn2);
    const sp = slipPaths(site, side, R, 8, X, { ...gsrSlips(lay, side).ring, offTo: offN, onFrom: onN });
    if (!sp) return { ok: false, reason: 'There isn’t room for the slip roads to curve round to the roundabout' };
    const r = slipRoads(net, site, sp, { x: offN.x, z: offN.z, node: offN.id }, { x: onN.x, z: onN.z, node: onN.id });
    if (!r.ok) return r;
    segs.push(...r.segs); nodes.push(...r.nodes); slips.push(...r.slips);
  }
  for (const r of around) { nodes.push(r.node); prefer[r.node] = 'priority'; }
  return { ok: true, ix: { id, form: 'gsr', at: X, type: site.type, nodes, segs, prefer, slips, style: site.style ?? 'taper', size: site.size ?? 'open' } };
}

// Where a slip road leaves (or joins) a one-way carriageway's path at distance s along it: the node,
// a point halfway along the nose on the taper's line, and the nose's tip (where the kerbs have parted
// by STD.noseTip), with the way on from the tip. sg: +1 for a diverge (the nose downstream of the
// node), -1 for a merge (upstream). The slip road's path runs node, mid, tip, on (or back).
function noseOn(path: P[], s: number, sg: 1 | -1, D: RoadDef, S: RoadDef, nose: number) {
  const F = (t: number, e: number): P => { const q = pointAt(path, s + sg * t), m = left({ x: q.ux, z: q.uz }); return add(q, m, e); };
  const eN = kerbOf(D) + STD.noseTip + kerbOf(S), ec = laneBase(D) + (D.lanes + 0.5) * D.lane;
  const node = F(0, 0), mid = F(nose / 2, (ec + eN) / 2), tip = F(nose, eN);
  return { node: { x: node.x, z: node.z }, mid: { x: mid.x, z: mid.z }, tip: { x: tip.x, z: tip.z }, h: unit(sub(tip, mid)) };
}
// a path through waypoints, each with the heading it's passed at (cubics between)
function through(pts: { p: P; h: V }[], k = 0.39): P[] { // (0.39: a quarter circle's, as near as a cubic comes)
  const out: P[] = [];
  for (let i = 1; i < pts.length; i++) out.push(...curve(pts[i - 1].p, pts[i - 1].h, pts[i].p, pts[i].h, k).slice(i > 1 ? 1 : 0));
  return out;
}

// The trumpet (see the head of the file): its layout in the motorway's frame at the junction, `a`
// metres along the motorway from the middle and `b` out towards the road's side. The road's side
// is the left of the motorway's line as drawn (flip the line for the other).
function trumpetLayout(site: Site, along?: V) {
  const q = pointAt(site.mw, site.s), X: P = { x: q.x, z: q.z }, W = { x: q.ux, z: q.uz }, n = left(W);
  const SZ = SIZE[site.size ?? 'open'], LT = SZ.slip, DL = ROADS[LT], DA = oneWay(ROADS[site.type]);
  const gA = pairGap(site.type) / 2, gL = pairGap(LT) / 2, Ks = kerbOf(DL);
  const eNA = kerbOf(DA) + STD.noseTip + Ks, eNL = kerbOf(DL) + STD.noseTip + Ks;
  const plus5 = (x: { taper: number; nose: number }) => ({ ...x, nose: x.nose + 5 });
  const dvA = plus5(STD.diverge(DA.mph)), mgA = plus5(STD.merge(DA.mph)), dvL = plus5(STD.diverge(DL.mph)), mgL = plus5(STD.merge(DL.mph));
  const Rl = SZ.loop, Rr = SZ.ramp, cz = gL + halfOf(DL) + 10; // (cz: along the motorway, clear of the links' bridges over it)
  // the links are level through their merge and diverge (b > b1, b2), and climb to their bridges over
  // the motorway between there and its near edge (bN)
  const G = Math.min(SZ.grade, DL.maxGrade), climb = (GRADES.road.clear + SZ.depth) / G, bN = gA + halfOf(DA) + 4;
  // R1: from B-in (a = gL) round to A near, its merge's nose clear of the bridges
  const b1 = Math.max(gA + eNA + Rr, bN + climb + 20), a1 = Math.max(gL + eNL + (b1 - gA - eNA) * 0.9, cz);
  // R2: from A near round to B-out (a = -gL)
  const b2 = Math.max(gA + eNA + Rr, bN + climb + 20), a2 = Math.min(-gL - eNL - (b2 - gA - eNA) * 0.9, -cz);
  // the loop: down the far side, round to the left, and alongside A far to merge (east of the bridges)
  const bL = -(gA + eNA) - Rl, a3 = Math.max(cz + mgA.nose, gL + Rl), aLE = a3 + Rl;
  // the semi-direct ramp: leaves A far beyond the loop, round outside it, north up to B-out
  const a4 = aLE + 25 + Rr, bS = bL - Rl - 25;
  const bD1 = b1 + dvL.nose, bM2 = b2 + mgL.nose, SPL = DL.minR < 50 ? 45 : 80; // (SPL: the links splay into the roundabout over this)
  const bR = Math.max(bD1 + dvL.taper + 12, bM2 + mgL.taper + 12) + SPL;
  // (a road meeting the motorway at an angle: the stem runs along it)
  const V = along ?? n;
  const Sx = { x: -left(V).x, z: -left(V).z };
  const Sp = (a: number, b: number): P => add(add(X, Sx, a), V, b);
  const M = (a: number, e: number, near: boolean): P => { const c = pointAt(site.mw, site.s + a), m = left({ x: c.ux, z: c.uz }); return add(c, m, near ? gA + e : -(gA + e)); };
  return {
    X, W, n, V, Sx, Sp, M, SZ, LT, DL, DA, gA, gL, eNA, eNL, dvA, mgA, dvL, mgL, Rl, Rr, cz,
    a1, b1, a2, b2, bL, a3, aLE, a4, bS, bD1, bM2, bR, SPL,
    Nr: Sp(0, bR), far: Sp(0, bS - 45),
    // how far along the motorway it reaches either way (its tapers)
    reach: [a2 - dvA.nose - dvA.taper - 10, Math.max(a1 + mgA.nose + mgA.taper, a4 + dvA.nose + dvA.taper) + 10] as [number, number],
  };
}

function buildTrumpet(net: Network, site: Site, [nr]: [number, number], id: number): { ok: true; ix: Interchange } | Fail {
  const q = pointAt(site.mw, site.s), T = trumpetLayout(site, unit(sub(net.node(nr), q))), { Sp, M, W, V, Sx, DL, DA, gA, gL, eNA, Rl, Rr, dvA, mgA, dvL, mgL, LT } = T;
  const mwL = pathLength(site.mw);
  if (site.s + T.reach[0] < 0 || site.s + T.reach[1] > mwL) return { ok: false, reason: 'The motorway needs to run further either side of the junction for its slip roads' };
  const near = carriagewayAt(net, M(0, 0, true), W, site.type), far = carriagewayAt(net, M(0, 0, false), { x: -W.x, z: -W.z }, site.type);
  if (!near || !far) return { ok: false, reason: 'No carriageways where the junction should be' };
  const pNear = net.path(near), pFar = net.path(far), sOn = (path: P[], p: P) => closestOnPath(p, path).s;
  const segs: number[] = [], nodes: number[] = [nr], slips: Interchange['slips'] = [];
  const o = (path: P[], cross: RoadOpts['cross'] = 'junction'): RoadOpts => ({ ...DEFAULT_OPTS, type: LT, oneway: true, path, cross, grade: T.SZ.grade });
  const Nr = net.node(nr), nodeAt = (p: P): End => { const nd = net.nearestNode(p, 0.6, 'road'); return nd ? { x: nd.x, z: nd.z, node: nd.id } : { x: p.x, z: p.z }; };
  const mV = { x: -V.x, z: -V.z }, mW = { x: -W.x, z: -W.z }, mSx = { x: -Sx.x, z: -Sx.z };
  const splayOut = unit({ x: mV.x * Math.cos(0.3) + Sx.x * Math.sin(0.3), z: mV.z * Math.cos(0.3) + Sx.z * Math.sin(0.3) });
  const splayIn = unit({ x: V.x * Math.cos(0.3) + Sx.x * Math.sin(0.3), z: V.z * Math.cos(0.3) + Sx.z * Math.sin(0.3) });
  // 1. B-in's first stretch: out of the roundabout, down to where R1 leaves it
  const top = T.bR - T.SPL, d1 = Sp(gL, T.bD1);
  let r = road(net, { x: Nr.x, z: Nr.z, node: nr }, d1, o([...curve(Nr, splayOut, Sp(gL, top), mV), d1]), 'The link down to the motorway');
  if (!r.ok) return r;
  segs.push(...r.segs);
  const nd1 = nodeAt(d1);
  // 2. B-in on over the motorway, round the loop and into A far (its merge east of the bridges)
  const m3 = noseOn(pFar, sOn(pFar, M(T.a3 - mgA.nose, 0, false)), -1, DA, DL, mgA.nose);
  const L0 = Sp(gL, T.bL), loopPts = through([
    { p: L0, h: mV }, { p: Sp(gL + Rl, T.bL - Rl), h: Sx }, ...(T.a3 > gL + Rl + 1 ? [{ p: Sp(T.a3, T.bL - Rl), h: Sx }] : []),
    { p: Sp(T.a3 + Rl, T.bL), h: V }, { p: m3.tip, h: { x: -m3.h.x, z: -m3.h.z } },
  ]);
  // (level where R1 leaves it, until it's clear)
  const level = (s0: number, s1: number): Limit => ({ s0, s1, lo: -0.02, hi: 0.02, why: 'the slip road beside it' });
  r = road(net, nd1, { ...m3.node, seg: far.id }, { ...o([d1, ...loopPts, m3.mid, m3.node], 'bridge'), limits: [level(0, dvL.nose + 20)] }, 'The loop');
  if (!r.ok) return r;
  segs.push(...r.segs);
  const loopSeg = r.segs[0];
  // 3. the semi-direct ramp: off A far beyond the loop, round outside it, north over the motorway
  const farNow = carriagewayAt(net, M(T.a4 + dvA.nose, 0, false), mW, site.type);
  if (!farNow) return { ok: false, reason: 'No carriageway where the ramp round the loop should leave it' };
  const d4 = noseOn(pFar, sOn(pFar, M(T.a4 + dvA.nose, 0, false)), 1, DA, DL, dvA.nose), m2 = Sp(-gL, T.bM2);
  const semiPts = through([
    { p: d4.tip, h: d4.h }, { p: Sp(T.a4 - Rr, -(gA + eNA) - Rr), h: mV }, { p: Sp(T.a4 - 2 * Rr, T.bS), h: mSx },
    { p: Sp(-gL + Rr, T.bS), h: mSx }, { p: Sp(-gL, T.bS + Rr), h: V },
  ]);
  const semiPath = [d4.node, d4.mid, ...semiPts, m2], semiL = pathLength(semiPath);
  r = road(net, { ...d4.node, seg: farNow.id }, m2, { ...o(semiPath, 'bridge'), limits: [level(0, dvA.nose + 20), level(semiL - mgL.nose - 20, semiL)] }, 'The ramp round the loop');
  if (!r.ok) return r;
  segs.push(...r.segs);
  const semiSeg = r.segs[r.segs.length - 1];
  const nm2 = nodeAt(m2);
  // 4. B-out's last stretch: up from where R2 joins it into the roundabout
  r = road(net, nm2, { x: Nr.x, z: Nr.z, node: nr }, o([m2, Sp(-gL, top), ...curve(Sp(-gL, top), V, Nr, splayIn).slice(1)]), 'The link up from the motorway');
  if (!r.ok) return r;
  segs.push(...r.segs);
  // 5. R1: off B-in round to A near (the left turn onto the motorway)
  const loopPath = net.path(net.segs.get(loopSeg)!);
  const d1n = noseOn(loopPath, 0, 1, DL, DL, dvL.nose);
  const nearAt = (a: number) => carriagewayAt(net, M(a, 0, true), W, site.type);
  const m1 = noseOn(pNear, sOn(pNear, M(T.a1 + mgA.nose, 0, true)), -1, DA, DL, mgA.nose), c1 = nearAt(T.a1 + mgA.nose);
  if (!c1) return { ok: false, reason: 'No carriageway where the slip road should join it' };
  r = road(net, nd1, { ...m1.node, seg: c1.id }, o([d1n.node, d1n.mid, ...through([{ p: d1n.tip, h: d1n.h }, { p: m1.tip, h: { x: -m1.h.x, z: -m1.h.z } }]), m1.mid, m1.node]), 'The slip road onto the motorway');
  if (!r.ok) return r;
  segs.push(...r.segs);
  const r1Seg = r.segs[r.segs.length - 1];
  // 6. R2: off A near round to B-out (the left turn off the motorway)
  const semiBuilt = net.path(net.segs.get(semiSeg)!);
  const m2n = noseOn(semiBuilt, pathLength(semiBuilt), -1, DL, DL, mgL.nose);
  const d2 = noseOn(pNear, sOn(pNear, M(T.a2 - dvA.nose, 0, true)), 1, DA, DL, dvA.nose), c2 = nearAt(T.a2 - dvA.nose);
  if (!c2) return { ok: false, reason: 'No carriageway where the slip road should leave it' };
  r = road(net, { ...d2.node, seg: c2.id }, nm2, o([d2.node, d2.mid, ...through([{ p: d2.tip, h: d2.h }, { p: m2n.tip, h: { x: -m2n.h.x, z: -m2n.h.z } }]), m2n.mid, m2n.node]), 'The slip road off the motorway');
  if (!r.ok) return r;
  segs.push(...r.segs);
  const r2Seg = r.segs[0];
  // its nodes: every merge and diverge, and the roundabout
  for (const p of [d1, m2, m3.node, d4.node, m1.node, d2.node]) { const nd = net.nearestNode(p, 0.6, 'road'); if (nd) nodes.push(nd.id); }
  // (the four slip roads on the motorway: the stem's own merge and diverge are the links')
  slips.push(
    { seg: r2Seg, kind: 'diverge', taper: dvA.taper, nose: dvA.nose, aux: 0 }, { seg: r1Seg, kind: 'merge', taper: mgA.taper, nose: mgA.nose, aux: 0 },
    { seg: semiSeg, kind: 'diverge', taper: dvA.taper, nose: dvA.nose, aux: 0 }, { seg: net.segsAt(nodeAt(m3.node).node ?? -1).find((x) => x.b === nodeAt(m3.node).node && isSlip(x.type))?.id ?? loopSeg, kind: 'merge', taper: mgA.taper, nose: mgA.nose, aux: 0 },
  );
  return { ok: true, ix: { id, form: 'trumpet', at: T.X, type: site.type, nodes, segs, prefer: { [nr]: 'roundabout' }, slips, style: site.style ?? 'taper', size: site.size ?? 'open' } };
}

// A new motorway drawn across a road, with a junction where it crosses: the local road is cut at
// the junction's nodes, the pair of carriageways built through the gap, then the junction's pieces.
// (Try it on scratch(net) first, for a blueprint that says what it costs and why it can't be built.)
export function motorwayWithJunction(net: Network, form: IxForm, mw: P[], type: string, road: RSeg, id = 0, style: SlipStyle = 'taper', size: IxSize = 'open') {
  return allOrNothing(net, (n) => motorwayWithJunctionOn(n, form, mw, type, n.segs.get(road.id)!, id, style, size));
}
function motorwayWithJunctionOn(net: Network, form: IxForm, mw: P[], type: string, road: RSeg, id: number, style: SlipStyle, size: IxSize, at?: number) {
  const x0 = crossingOf(mw, net.path(road)), X = x0 && at !== undefined ? { ...x0, s: at } : x0;
  if (!X) return { ok: false as const, reason: 'The motorway doesn’t cross that road' };
  // (a trumpet meets the road on its longer side: the motorway's line runs so that's its left)
  if (form === 'trumpet') {
    const rp = net.path(road), c = closestOnPath(X, rp), q = pointAt(mw, X.s), n = left({ x: q.ux, z: q.uz });
    const ahead = dot({ x: c.ux, z: c.uz }, n) > 0, longer = c.s < pathLength(rp) - c.s; // (ahead: the road runs on to the left)
    if (ahead !== longer) { const L = pathLength(mw); mw = [...mw].reverse(); return motorwayWithJunctionOn(net, form, mw, type, road, id, style, size, L - X.s); }
  }
  let site: Site = { mw, type, s: X.s, road, style, size };
  // (a tight one has the motorway in a cutting under it, as deep as there's room for; a trumpet's is at ground level)
  const cut = size === 'tight' && form !== 'trumpet' ? cutting(form, { ...site, road: null, roadType: road.type }) : null;
  if (cut) site = { ...site, cut: cut.cut };
  const lay = layout(net, form, site);
  if (lay.sin < 0.6) return { ok: false as const, reason: 'The road crosses the motorway at too shallow an angle for a junction' };
  const ln = localNodes(net, site, lay.R1, lay.R2, form === 'trumpet');
  if (!ln.ok) return ln;
  const pair = buildPair(net, mw, type, {}, cut?.heights ?? []);
  if (!pair.ok) return pair;
  const r = buildJunctionOn(net, form, { ...site, road: null, roadType: road.type }, id, ln.n);
  if (!r.ok) return r;
  return { ok: true as const, ix: r.ix, carriageways: [...pair.ab, ...pair.ba] };
}

// How deep the motorway can dip under a junction, and its heights to get there: down under the
// bridge (or the ring), up again at MW_GRADE either side, and at ground level beyond. The slip roads
// stay at ground level, so at every point along them the cutting (its grass slopes) has to be shallow
// enough there to leave them clear of its top. The deepest that fits of 4, 3 or 2 m, or none.
function cutting(form: IxForm, site: Site): { cut: number; heights: Limit[] } | null {
  const L = pathLength(site.mw), g = pairGap(site.type) / 2, Dc = oneWay(ROADS[site.type]), S = ROADS[SIZE[site.size ?? 'open'].slip];
  for (const cut of [4, 3, 2]) {
    const st = { ...site, cut }, lay = layout(null, form, st);
    // along the motorway, how far either side of the middle the bridge (or the ring) is over it
    const W = form === 'gsr' ? lay.radius + halfOf(ROADS['gsr-ring']) + 10 : halfOf(ROADS[lay.type]) / Math.max(0.3, lay.sin) + 10;
    const T0 = W + cut / MW_GRADE, depth = (t: number) => (t <= W ? cut : Math.max(0, cut - MW_GRADE * (t - W)));
    let fits = true;
    for (const side of [1, -1] as const) {
      const R = side === 1 ? lay.R1 : lay.R2;
      const sp = form === 'gsr' ? slipPaths(st, side, R, 8, lay.X, gsrSlips(lay, side).ring) : slipPaths(st, side, R, Math.max(lay.radius, 12), lay.X);
      if (!sp) { fits = false; break; }
      for (const p of [...sp.off, ...sp.on]) {
        const d = depth(Math.abs(dot(sub(p, lay.X), lay.u)));
        if (d > 0 && closestOnPath(p, site.mw).d - g < halfOf(Dc) + 0.7 * d + kerbOf(S) + S.verge + 0.5) { fits = false; break; }
      }
    }
    if ((globalThis as { CUT_DEBUG?: boolean }).CUT_DEBUG) console.log('cut', form, cut, fits, 'W', W.toFixed(0), 'T0', T0.toFixed(0), 'dR', dist(lay.R1, lay.X).toFixed(0));
    if (!fits || site.s - T0 < 20 || site.s + T0 > L - 20) continue;
    const sX = site.s, win = (s0: number, s1: number, lo: number, hi: number, why: string): Limit => ({ s0: Math.max(0, s0), s1: Math.min(L, s1), lo, hi, why });
    return { cut, heights: [win(sX - W, sX + W, -cut - 0.2, -cut + 0.2, 'the junction over it'), win(0, sX - T0, -0.05, 0.05, 'the slip roads'), win(sX + T0, L, -0.05, 0.05, 'the slip roads')] };
  }
  return null;
}

// where a polyline first crosses another: the distance along the first
export function crossingOf(a: P[], b: P[]): { s: number; x: number; z: number } | null {
  let acc = 0;
  for (let i = 1; i < a.length; i++) {
    const L = dist(a[i - 1], a[i]);
    for (let j = 1; j < b.length; j++) {
      const p = a[i - 1], r = sub(a[i], p), c = b[j - 1], sv = sub(b[j], c), den = r.x * sv.z - r.z * sv.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - p.x) * sv.z - (c.z - p.z) * sv.x) / den, uu = ((c.x - p.x) * r.z - (c.z - p.z) * r.x) / den;
      if (t >= 0 && t <= 1 && uu >= 0 && uu <= 1) return { s: acc + t * L, x: p.x + r.x * t, z: p.z + r.z * t };
    }
    acc += L;
  }
  return null;
}

// A copy of the network to try things on (a blueprint): its roads, plots and land.
export function scratch(net: Network): Network {
  const n = Object.create(Object.getPrototypeOf(net)) as Network;
  Object.assign(n, net);
  n.nodes = new Map([...net.nodes].map(([k, v]) => [k, { ...v }]));
  n.segs = new Map([...net.segs].map(([k, v]) => [k, { ...v, mid: v.mid.map((p) => ({ ...p })), stops: [...v.stops], bridges: v.bridges ? [...v.bridges] : undefined }]));
  n.lots = [...net.lots];
  n.land = new Land();
  for (const c of net.land.all()) n.land.claim(c.key, c.owner, c.polys);
  return n;
}
