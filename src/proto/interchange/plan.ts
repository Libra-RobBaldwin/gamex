// A motorway junction as a blueprint: drawing a motorway across a road offers "Junction here", and
// the junction is tried on a copy of the network (build.scratch) so the card can say what it costs,
// what it knocks down and why it can't be built, and the ghost can show every piece, before
// anything changes. Building it for real is then the same call on the real network.
import { CLEAR_COST, DEFAULT_OPTS, RAISE_COST, ROADS, closestOnPath, halfOf, kerbOf, pathLength, pointAt, type End, type Lot, type Network, type P, type RSeg } from '../roads';
import { isSlip, laneBase } from '../catalog';
import { STD } from '../standards';
import { crossingOf, motorwayWithJunction, scratch, type IxForm, type IxSize, type SlipStyle } from './build';

export interface IxPlan { ok: boolean; reason?: string; cost: number; clears: Lot[]; ghost: { path: P[]; half: number }[] }

// The road a motorway blueprint crosses that a junction could serve: the first one along it (an
// ordinary two-way road, not another motorway or a railway), and where.
export function roadCrossed(net: Network, mw: P[]): RSeg | null {
  let best: { seg: RSeg; s: number } | null = null;
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (d.cls !== 'road' || d.family === 'Motorway' || s.oneway) continue;
    const x = crossingOf(mw, net.path(s));
    if (x && (!best || x.s < best.s)) best = { seg: s, s: x.s };
  }
  return best?.seg ?? null;
}

export function planJunction(net: Network, form: IxForm, style: SlipStyle, mw: P[], type: string, road: RSeg, size: IxSize = 'open'): IxPlan {
  const s = scratch(net), had = new Set(net.segs.keys());
  const r = motorwayWithJunction(s, form, mw, type, s.segs.get(road.id)!, 0, style, size);
  if (!r.ok) return { ok: false, reason: r.reason, cost: 0, clears: [], ghost: [] };
  // every new road's price by the metre, and its embankments and bridges as check() prices a raised road
  let cost = 0;
  const ghost: IxPlan['ghost'] = [];
  const old = net.path(road);
  for (const x of s.segs.values()) {
    if (had.has(x.id)) continue;
    const path = s.path(x), d = s.def(x);
    // (what's left of the local road, split where the junction meets it, is already paid for)
    if (x.type === road.type && !x.oneway && path.every((p) => closestOnPath(p, old).d < 1 && Math.abs(p.y ?? 0) < 0.1)) continue;
    cost += pathLength(path) * d.cost;
    for (let i = 1; i < path.length; i++) { const ym = ((path[i].y ?? 0) + (path[i - 1].y ?? 0)) / 2; if (ym > 0) cost += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) * ym * RAISE_COST; }
    ghost.push({ path, half: s.half(x) });
  }
  const clears = net.lots.filter((l) => !s.lots.includes(l));
  return { ok: true, cost: Math.round(cost + clears.length * CLEAR_COST), clears, ghost };
}

// A slip road drawn off a motorway by the player: dragged from a carriageway, ahead and out to its
// left it leaves it (a diverge), back and out it joins it (a merge). Whatever road type is picked, a
// drag that starts on a carriageway draws a slip road, of one lane or two (two: a lane where it
// meets the motorway, widening once clear of the nose). It leaves the lane as a slip road does: at
// the node where the lanes part, along the taper's line to its nose (DMRB CD 122's lengths: see
// slips.ts), then round to wherever it was dragged to.
export interface SlipPlan {
  ok: boolean; reason?: string; kind: 'diverge' | 'merge'; lanes: 1 | 2; carriageway: number;
  cost: number; length: number; clears: Lot[]; ghost: { path: P[]; half: number }[];
  pieces: { a: End; b: End; type: string; path: P[] }[];
}
const SLIP_1 = 'slip', SLIP_2 = 'slip-2', WIDEN = 30; // (a two-lane slip road widens this far past its nose)

// the carriageway a drag starting at `from` starts on, if any (a one-way motorway, not a slip road)
export function carriagewayUnder(net: Network, from: End): RSeg | null {
  if (from.node !== undefined) return null; // (on a junction: an ordinary road from there)
  let best: RSeg | null = null, bd = Infinity;
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (!s.oneway || d.family !== 'Motorway' || isSlip(s.type) || d.cls !== 'road') continue;
    const c = closestOnPath(from, net.path(s));
    if (c.d < net.half(s) - 1 && c.d < bd) { bd = c.d; best = s; }
  }
  return best;
}

export function planSlip(net: Network, from: End, to: End, lanes: 1 | 2): SlipPlan | null {
  const cw = carriagewayUnder(net, from);
  if (!cw) return null;
  const path = net.path(cw), L = pathLength(path), c = closestOnPath(from, path), s0 = c.s;
  const D = net.def(cw), S1 = ROADS[SLIP_1], K = kerbOf(D), Ks = kerbOf(S1);
  const w = { x: c.ux, z: c.uz }, n = { x: c.uz, z: -c.ux }; // (along it, and out to its nearside)
  const B = { x: to.x, z: to.z }, fwd = (B.x - c.x) * w.x + (B.z - c.z) * w.z, lat = (B.x - c.x) * n.x + (B.z - c.z) * n.z;
  const kind: SlipPlan['kind'] = fwd >= 0 ? 'diverge' : 'merge', sg = kind === 'diverge' ? 1 : -1;
  const out = (reason: string): SlipPlan => ({ ok: false, reason, kind, lanes, carriageway: cw.id, cost: 0, length: 0, clears: [], ghost: [], pieces: [] });
  if (Math.hypot(B.x - c.x, B.z - c.z) < 20) return out(kind === 'diverge' ? 'Drag ahead and out to the left to leave the motorway, back and out to join it' : 'Drag back and out to the left to join the motorway, ahead and out to leave it');
  if (lat < K + 12) return out('Slip roads leave and join a motorway on its left, the nearside: drag out to that side');
  const std = kind === 'diverge' ? STD.diverge(D.mph) : STD.merge(D.mph), nose = std.nose + 5;
  // room along the carriageway for the taper on one side of the node and the nose on the other
  const [before, after] = kind === 'diverge' ? [s0, L - s0] : [L - s0, s0];
  if (before < std.taper + 10) return out(`Too near ${kind === 'diverge' ? 'the start' : 'the end'} of the carriageway (or another junction on it): the taper needs ${std.taper + 10} m`);
  if (after < nose + 10) return out(`Too near ${kind === 'diverge' ? 'the end' : 'the start'} of the carriageway (or another junction on it) for the nose: it needs ${nose + 10} m`);
  if (Math.abs(c.y ?? 0) > 0.3) return out('The motorway is on a bridge or in a cutting here: slip roads leave it at ground level');
  // t metres from the node along the carriageway (the way the slip road runs), e out to its nearside
  const F = (t: number, e: number): P => { const q = pointAt(path, s0 + sg * t), m = { x: q.uz, z: -q.ux }; return { x: q.x + m.x * e, z: q.z + m.z * e }; };
  const eN = K + STD.noseTip + Ks, ec = laneBase(D) + (D.lanes + 0.5) * D.lane;
  const mid = F(nose / 2, (ec + eN) / 2), tip = F(nose, eN);
  const h = { x: (tip.x - mid.x) / dist(tip, mid), z: (tip.z - mid.z) / dist(tip, mid) };
  // (it leaves along the taper's line, then curves round to where it was dragged, arriving along the
  // line from the nose to there)
  const toB = { x: B.x - tip.x, z: B.z - tip.z }, lb = Math.hypot(toB.x, toB.z) || 1;
  const course = [{ x: c.x, z: c.z }, mid, ...cubic(tip, h, B, { x: toB.x / lb, z: toB.z / lb })];
  const P0: End = { x: c.x, z: c.z, seg: cw.id };
  // one lane all the way, or a lane for its first stretch and two beyond
  const cutAt = lanes === 2 ? Math.min(nose + WIDEN, pathLength(course) - 25) : Infinity;
  const pieces: SlipPlan['pieces'] = [];
  if (lanes === 1 || cutAt < nose + 10) {
    if (lanes === 2) return out('Too short for a two-lane slip road: drag it further');
    pieces.push(kind === 'diverge' ? { a: P0, b: to, type: SLIP_1, path: course } : { a: to, b: P0, type: SLIP_1, path: [...course].reverse() });
  } else {
    // (cut at one of its points, not between two: an odd short piece reads as a tighter curve)
    let i = 1, acc = 0;
    while (i < course.length - 2 && acc + dist(course[i - 1], course[i]) < cutAt) { acc += dist(course[i - 1], course[i]); i++; }
    const stub = course.slice(0, i + 1), rest = course.slice(i), M = course[i];
    if (kind === 'diverge') pieces.push({ a: P0, b: M, type: SLIP_1, path: stub }, { a: M, b: to, type: SLIP_2, path: rest });
    else pieces.push({ a: to, b: M, type: SLIP_2, path: [...rest].reverse() }, { a: M, b: P0, type: SLIP_1, path: [...stub].reverse() });
  }
  let cost = 0, length = 0;
  const clears = new Set<Lot>(), ghost: SlipPlan['ghost'] = [];
  for (const p of pieces) {
    const ck = net.check(p.a, p.b, undefined, { ...DEFAULT_OPTS, type: p.type, oneway: true, path: p.path });
    if (!ck.ok) return out(ck.reason ?? 'It can’t be built there');
    cost += ck.cost; length += ck.length;
    for (const l of ck.clears) clears.add(l);
    ghost.push({ path: ck.path, half: halfOf(ROADS[p.type]) });
  }
  return { ok: true, kind, lanes, carriageway: cw.id, cost, length, clears: [...clears], ghost, pieces };
}
// build a planned slip road: its pieces in order (the second starting from the first's end node)
export function buildSlip(net: Network, plan: SlipPlan): number[] {
  const segs: number[] = [];
  let joinAt: End | null = null;
  for (const [i, p] of plan.pieces.entries()) {
    const a = i > 0 && joinAt ? joinAt : p.a;
    const ids = net.build(a, p.b, undefined, { ...DEFAULT_OPTS, type: p.type, oneway: true, path: p.path });
    segs.push(...ids);
    const last = net.segs.get(ids[ids.length - 1]);
    if (last) { const nd = net.node(last.b); joinAt = { x: nd.x, z: nd.z, node: nd.id }; }
  }
  return segs;
}
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
function cubic(p: P, hp: P, q: P, hq: P, k = 0.42): P[] {
  const L = dist(p, q), c1 = { x: p.x + hp.x * L * k, z: p.z + hp.z * L * k }, c2 = { x: q.x - hq.x * L * k, z: q.z - hq.z * L * k }, n = Math.max(8, Math.ceil(L / 4)), out: P[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push({ x: u * u * u * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * q.x, z: u * u * u * p.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * q.z }); }
  return out;
}
