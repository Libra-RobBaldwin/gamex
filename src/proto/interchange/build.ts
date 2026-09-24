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
import { DEFAULT_OPTS, ROADS, closestOnPath, kerbOf, halfOf, minRadius, pathLength, pointAt, type End, type Network, type P, type RSeg, type RoadOpts } from '../roads';
import { oneWay } from '../catalog';
import { STD } from '../standards';
import { GRADES } from '../grade';
import type { Form } from '../junction';
import { Land, bandPolys } from '../land';

export type IxForm = 'dumbbell' | 'gsr' | 'diamond';
export const IX_FORMS: IxForm[] = ['dumbbell', 'gsr', 'diamond'];
export const IX_NAME: Record<IxForm, string> = { dumbbell: 'Dumbbell', gsr: 'Grade-separated roundabout', diamond: 'Diamond' };
export const IX_BLURB: Record<IxForm, string> = {
  dumbbell: 'A roundabout either side, joined by a bridge over the motorway',
  gsr: 'One big roundabout, carried over the motorway on two bridges',
  diamond: 'Give-way junctions either side, joined by a bridge',
};

// A junction built, as the junction designer and the player see it: one thing, many nodes.
export interface Interchange {
  id: number; form: IxForm; at: P; type: string; // where, and the motorway's type
  nodes: number[]; // its junctions: the slip roads' merges and diverges, the roundabouts or give-ways
  segs: number[]; // the roads it built (slip roads, the bridge, the ring)
  prefer: Record<number, Form>; // the form each of its junctions has to take
  slips: { seg: number; kind: 'merge' | 'diverge'; taper: number; nose: number; aux: number }[];
  style: SlipStyle;
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
export function buildPair(net: Network, mw: P[], type: string, opts: Partial<RoadOpts> = {}) {
  const g = pairGap(type) / 2, o = { ...DEFAULT_OPTS, ...opts, type, oneway: true };
  const ab = offsetPath(mw, g), ba = offsetPath(mw, -g).reverse();
  const A = road(net, at(net, ab[0]), at(net, ab[ab.length - 1]), { ...o, path: ab }, 'One carriageway');
  if (!A.ok) return A;
  const B = road(net, at(net, ba[0]), at(net, ba[ba.length - 1]), { ...o, path: ba }, 'The other carriageway');
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
export interface Site { mw: P[]; type: string; s: number; road: RSeg | null; roadType?: string; style?: SlipStyle }
type Fail = { ok: false; reason: string };

// The junction's layout: its centre and the motorway's direction there, the local road's
// direction (pointing to the carriageway running the way the line was drawn), and where the local
// road meets the junction either side (the two roundabouts or give-ways, or the ring).
function layout(net: Network, form: IxForm, site: Site) {
  const q = pointAt(site.mw, site.s), u = { x: q.ux, z: q.uz }, X: P = { x: q.x, z: q.z }, nl = left(u);
  const g = pairGap(site.type) / 2, Dc = oneWay(ROADS[site.type]);
  let v: V = nl, type = site.roadType ?? 'dual';
  if (site.road) { const c = closestOnPath(X, net.path(site.road)); v = { x: c.ux, z: c.uz }; type = site.road.type; }
  if (dot(v, nl) < 0) v = { x: -v.x, z: -v.z };
  const sin = Math.abs(u.x * v.z - u.z * v.x), half = (g + halfOf(Dc) + 1.5) / Math.max(0.3, sin);
  if (form === 'gsr') {
    const G = Math.min(DEFAULT_OPTS.grade, ROADS['gsr-ring'].maxGrade);
    // big enough that between the slip roads' nodes and the motorway the ring can climb over it
    const Rg = Math.ceil(((GRADES.road.clear + DEPTH) / G + RING_FLAT + half * 1.2) / (Math.PI / 2 - SPREAD) + 2);
    return { X, u, v, sin, type, g, Dc, radius: Rg, R1: add(X, v, Rg), R2: add(X, v, -Rg) };
  }
  const L = ROADS[type], G = Math.min(DEFAULT_OPTS.grade, L.maxGrade), radius = form === 'dumbbell' ? STD.roundabout(2, true).R : 0;
  // far enough out that the bridge can climb over both carriageways and be level again at the nodes
  const dR = half + (GRADES.road.clear + DEPTH) / G + radius + 24;
  return { X, u, v, sin, type, g, Dc, radius, R1: add(X, v, dR), R2: add(X, v, -dR) };
}
const RING_FLAT = 22, SPREAD = 0.42, DEPTH = 2, ENTRY = 0.7; // DEPTH: room for a deeper deck than the height solver allows for (a beam's, over a 30 m span) // a ring's level stretch either side of each node; how far round from the local road the slip roads meet it (radians)

// The local road's two nodes at the junction: an existing road is cut there and the stretch
// between taken away (the bridge or the ring replaces it); otherwise two new nodes.
function localNodes(net: Network, site: Site, R1: P, R2: P): { ok: true; n: [number, number] } | Fail {
  if (!site.road) return { ok: true, n: [net.addNode(R1.x, R1.z), net.addNode(R2.x, R2.z)] };
  const road0 = site.road, path = net.path(road0), c1 = closestOnPath(R1, path), c2 = closestOnPath(R2, path), L = net.length(road0);
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
  return form === 'gsr' ? buildGSR(net, site, lay, ends, id) : buildTwo(net, form, site, lay, ends, id);
}

type Lay = ReturnType<typeof layout>;
function buildTwo(net: Network, form: IxForm, site: Site, lay: Lay, [n1, n2]: [number, number], id: number): { ok: true; ix: Interchange } | Fail {
  const { X, type, radius } = lay, ring = form === 'dumbbell';
  const R1 = net.node(n1), R2 = net.node(n2);
  const nodes: number[] = [n1, n2], segs: number[] = [], prefer: Record<number, Form> = {}, slips: Interchange['slips'] = [];
  // the bridge, level where it meets the roundabouts
  const flat = radius + 16, Lb = dist(R1, R2);
  const br = road(net, { x: R1.x, z: R1.z, node: n1 }, { x: R2.x, z: R2.z, node: n2 }, { ...DEFAULT_OPTS, type, cross: 'bridge', limits: [{ s0: 0, s1: flat, lo: 0, hi: 0, why: 'the roundabout' }, { s0: Lb - flat, s1: Lb, lo: 0, hi: 0, why: 'the roundabout' }] }, 'The bridge');
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
  return { ok: true, ix: { id, form, at: X, type: site.type, nodes, segs, prefer, slips, style: site.style ?? 'taper' } };
}

// A side's slip roads: the off-slip from its diverge to `offTo`, the on-slip from `onFrom` to its merge.
function slipRoads(net: Network, site: Site, sp: NonNullable<ReturnType<typeof slipPaths>>, offTo: End, onFrom: End) {
  const [r0, r1] = sp.reach, mwL = pathLength(site.mw), side = sp.side;
  if (Math.min(site.s + side * r0, site.s + side * r1) < 0 || Math.max(site.s + side * r0, site.s + side * r1) > mwL) return { ok: false as const, reason: 'The motorway needs to run further either side of the junction for its slip roads' };
  const dc = carriagewayAt(net, sp.off[0], sp.w, site.type);
  if (!dc) return { ok: false as const, reason: 'No carriageway where the slip road should leave it' };
  const off = road(net, { ...sp.off[0], seg: dc.id }, offTo, { ...DEFAULT_OPTS, type: 'slip', oneway: true, path: sp.off }, 'The off-slip');
  if (!off.ok) return off;
  const mc = carriagewayAt(net, sp.on[sp.on.length - 1], sp.w, site.type);
  if (!mc) return { ok: false as const, reason: 'No carriageway where the slip road should join it' };
  const on = road(net, onFrom, { ...sp.on[sp.on.length - 1], seg: mc.id }, { ...DEFAULT_OPTS, type: 'slip', oneway: true, path: sp.on }, 'The on-slip');
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
  const g = pairGap(site.type) / 2, Dc = oneWay(ROADS[site.type]), S = ROADS.slip, K = kerbOf(Dc), Ks = kerbOf(S);
  const q = pointAt(site.mw, site.s), u = { x: q.ux, z: q.uz }, w = side === 1 ? u : { x: -u.x, z: -u.z }, m = left(w);
  const eN = K + STD.noseTip + Ks, run = 20; // (the nose starts exactly where it runs alongside: see slips.ts)
  // a point t metres along the carriageway from level with X (in its direction), e out from its centreline
  const F = (t: number, e: number) => { const s = site.s + side * t, c = pointAt(site.mw, s), n = left({ x: c.ux, z: c.uz }); return add(c, n, side * (g + e)); };
  const vs = unit(sub(R, X));
  // the headings they meet the local road at (into it for the off-slip, out of it for the on-slip), and a point on the way
  const hOff = ring ? ring.hOff : unit({ x: vs.x + w.x, z: vs.z + w.z }), hOn = ring ? ring.hOn : unit({ x: -vs.x + w.x, z: -vs.z + w.z });
  // (round a ring, a slip road keeps outside it, bar where it meets it)
  const outside = (pts: P[], end: P) => !ring || pts.every((p) => dist(p, end) < 40 || dist(p, X) > ring.clear);
  const offTo = ring?.offTo ?? R, onFrom = ring?.onFrom ?? R;
  const Qoff = add(offTo, hOff, -(radius + 22)), Qon = add(onFrom, hOn, radius + 22);
  const along = (p: P) => dot(sub(p, X), w), lateral = (p: P) => dot(sub(p, X), m) - g;
  const dv0 = STD.diverge(Dc.mph), mg0 = STD.merge(Dc.mph);
  // (the nose starts where the kerbs have parted by its tip, a little short of the point the slip road
  // is laid alongside from: laid a few metres longer, so the nose the junction finds meets the standard)
  const dv = { ...dv0, nose: dv0.nose + 5 }, mg = { ...mg0, nose: mg0.nose + 5 };
  const par = site.style === 'parallel' ? STD.parallel(Dc.mph) : null, aux = par?.length ?? 0;
  if (par) { dv.taper = par.taper + aux; mg.taper = par.taper + aux; } // (how far along the carriageway each reaches)
  for (const k of [1.1, 1.4, 1.8, 2.3]) {
    // the diverge: its node where the lanes part (td), the nose beyond, alongside, then round to the road
    const spanOff = Math.max(40, k * (lateral(Qoff) - eN)), td = along(Qoff) - spanOff - dv.nose - run;
    const off = [F(td, 0), F(td + dv.nose, eN), ...curve(F(td + dv.nose + run, eN), w, Qoff, hOff), { x: offTo.x, z: offTo.z }];
    // the merge: from the road round to alongside, past the nose, closing in at tm
    const spanOn = Math.max(40, k * (lateral(Qon) - eN)), tm = along(Qon) + spanOn + mg.nose + run;
    const on = [{ x: onFrom.x, z: onFrom.z }, ...curve(Qon, hOn, F(tm - mg.nose - run, eN), w), F(tm - mg.nose, eN), F(tm, 0)];
    if (minRadius(off.slice(1, -1)) >= S.minR && minRadius(on.slice(1, -1)) >= S.minR && outside(off, offTo) && outside(on, onFrom))
      return { off, on, w, side, reach: [td - dv.taper - 20, tm + mg.taper + 20] as [number, number], dv, mg, aux };
  }
  return null;
}

// A grade-separated roundabout: a one-way ring about the junction's centre (going round with the
// island on the right), over the motorway on two bridges, level where each road meets it.
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
    const Lr = pathLength(pts), fl = Math.min(RING_FLAT, Lr / 2);
    const r = road(net, { ...pts[0], node: A.node }, { ...pts[n], node: B.node }, { ...DEFAULT_OPTS, type: 'gsr-ring', oneway: true, cross: 'bridge', path: pts, limits: [{ s0: 0, s1: fl, lo: 0, hi: 0, why: 'the junction' }, { s0: Lr - fl, s1: Lr, lo: 0, hi: 0, why: 'the junction' }] }, 'The roundabout');
    if (!r.ok) return r;
    segs.push(...r.segs);
  }
  // each carriageway's slip roads, to the ring's nodes on its side
  for (const side of [1, -1] as const) {
    const offN = net.node(slipNode.get(`${side}:off`)!), onN = net.node(slipNode.get(`${side}:on`)!);
    const R = side === 1 ? net.node(rn1) : net.node(rn2);
    // they meet the ring at 40° to it: turning in onto it, turning out off it
    const tan = (p: P) => unit({ x: -(p.z - X.z), z: p.x - X.x }), rot = (h: V, a: number) => ({ x: h.x * Math.cos(a) - h.z * Math.sin(a), z: h.x * Math.sin(a) + h.z * Math.cos(a) });
    const sp = slipPaths(site, side, R, 8, X, { offTo: offN, onFrom: onN, hOff: rot(tan(offN), ENTRY), hOn: rot(tan(onN), -ENTRY), clear: Rg + 14 });
    if (!sp) return { ok: false, reason: 'There isn’t room for the slip roads to curve round to the roundabout' };
    const r = slipRoads(net, site, sp, { x: offN.x, z: offN.z, node: offN.id }, { x: onN.x, z: onN.z, node: onN.id });
    if (!r.ok) return r;
    segs.push(...r.segs); nodes.push(...r.nodes); slips.push(...r.slips);
  }
  for (const r of around) { nodes.push(r.node); prefer[r.node] = 'priority'; }
  return { ok: true, ix: { id, form: 'gsr', at: X, type: site.type, nodes, segs, prefer, slips, style: site.style ?? 'taper' } };
}

// A new motorway drawn across a road, with a junction where it crosses: the local road is cut at
// the junction's nodes, the pair of carriageways built through the gap, then the junction's pieces.
// (Try it on scratch(net) first, for a blueprint that says what it costs and why it can't be built.)
export function motorwayWithJunction(net: Network, form: IxForm, mw: P[], type: string, road: RSeg, id = 0, style: SlipStyle = 'taper') {
  return allOrNothing(net, (n) => motorwayWithJunctionOn(n, form, mw, type, n.segs.get(road.id)!, id, style));
}
function motorwayWithJunctionOn(net: Network, form: IxForm, mw: P[], type: string, road: RSeg, id: number, style: SlipStyle) {
  const X = crossingOf(mw, net.path(road));
  if (!X) return { ok: false as const, reason: 'The motorway doesn’t cross that road' };
  const site: Site = { mw, type, s: X.s, road, style };
  const lay = layout(net, form, site);
  if (lay.sin < 0.6) return { ok: false as const, reason: 'The road crosses the motorway at too shallow an angle for a junction' };
  const ln = localNodes(net, site, lay.R1, lay.R2);
  if (!ln.ok) return ln;
  const pair = buildPair(net, mw, type);
  if (!pair.ok) return pair;
  const r = buildJunctionOn(net, form, { ...site, road: null, roadType: road.type }, id, ln.n);
  if (!r.ok) return r;
  return { ok: true as const, ix: r.ix, carriageways: [...pair.ab, ...pair.ba] };
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
