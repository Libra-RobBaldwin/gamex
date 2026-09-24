// Junction design. When roads meet, the junction designs itself the way a traffic engineer would:
// it estimates the turning traffic, tries the forms that suit it (a give-way T with a left-turn
// slip, a mini or full roundabout, signals, a merge onto a fast road), assigns every approach
// lane to the movements that balance the load best, and keeps the form that leaves the most
// spare capacity. The player can override any of it; the score says what that costs.
import { kerbOf, pathLength, pointAt, rectCorners, type Lot, type Network, type P, type RSeg } from './roads';
import { STD } from './standards';
import { polysTouch } from './land';
import { approachPath, legFrameOf, shapeJunction, ringFootprint, type Shape, type ShapeLeg, type SlipShape } from './jshape';

export type Form = 'join' | 'merge' | 'priority' | 'signals' | 'mini' | 'roundabout';
export type Move = 'L' | 'S' | 'R';
export const FORM_NAME: Record<Form, string> = {
  join: 'Plain join', merge: 'Merge', priority: 'Give way', signals: 'Traffic signals', mini: 'Mini-roundabout', roundabout: 'Roundabout',
};

export interface Leg { seg: RSeg; dir: P; ang: number; lanes: number; w: number; len: number; path: P[] } // path: its centreline from the node out, as drawn (jshape.approachPath)
export type Slip = SlipShape;
export interface Score { dos: number; demand: number; capacity: number; busiest: string }
export interface Junction {
  node: number; form: Form; auto: boolean; custom: boolean; complex: boolean;
  legs: number[]; // seg ids, in order round the junction
  major: number[]; // the priority road's two legs (give-way junctions)
  lanes: Record<number, Move[][]>; // per approach, per lane from the nearside: the movements allowed
  slip: Slip | null;
  R: number; // roundabout radius (outer edge of the circulating carriageway)
  reach: Record<number, number>; // per leg: how far from the centre its stop / give-way line is
  score: Score;
  flows: Record<string, number>; // "from>to" (seg ids): design flow, vehicles per hour
  shape: Shape | null; // its kerbs, islands, markings positions and land (see jshape.ts)
}

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);

// The roads meeting at a node, with the direction each leaves in.
export function legsAt(net: Network, node: number): Leg[] {
  const out: Leg[] = [];
  for (const s of net.segsAt(node)) {
    const d = net.def(s);
    if (d.cls !== 'road') continue;
    const p = net.pathFrom(s, node), L = net.length(s);
    // direction a few metres out, so a curve's first piece doesn't mislead
    let k = 1;
    while (k < p.length - 1 && dist(p[0], p[k]) < 6) k++;
    const dx = p[k].x - p[0].x, dz = p[k].z - p[0].z, dl = Math.hypot(dx, dz) || 1;
    out.push({ seg: s, dir: { x: dx / dl, z: dz / dl }, ang: Math.atan2(dz, dx), lanes: d.lanes, w: d.lanes * d.speed * (d.family === 'Motorway' ? 1.6 : 1), len: L, path: approachPath(p) });
  }
  // round the junction in the direction traffic circulates (a left turn leads to the next leg)
  return out.sort((a, b) => a.ang - b.ang);
}

// A junction on a slope. Its roads don't arrive level (one climbing through it, say), so it isn't
// level either. Each point on it takes the height of the road whose carriageway and footways it's
// on, as that road would have it there (running on straight behind the node), and between roads
// (the corners, the middle) a blend of them, weighted steeply towards the nearest. So a road meets
// the junction at its mouth at exactly its own height and cross-fall, however steeply the side road
// climbs. Everything drawn on the junction (carriageway, footways, islands, kerbs, markings) and the
// traffic crossing it sit on this surface. Returns the height above the node at (x, z), or null
// where the junction is level.
export function junctionLift(net: Network, node: number, mouth?: Record<number, number>): ((x: number, z: number) => number) | null {
  const n = net.node(node), y0 = n.y ?? 0;
  const legs: { leg: ShapeLeg; hs: number[]; slope: number; half: number }[] = [];
  let sloped = false;
  for (const l of legsAt(net, node)) {
    const p = net.pathFrom(l.seg, node), reach = Math.min(pathLength(p), (mouth?.[l.seg.id] ?? 10) + 30), hs: number[] = [];
    // (its height every metre, out to well past the mouth)
    for (let a = 0; a <= reach + 1e-6; a += 1) { const y = pointAt(p, a).y; hs.push((Number.isFinite(y) ? y : y0) - y0); }
    if (hs.some((h) => Math.abs(h) > 0.02)) sloped = true;
    const k = Math.min(3, hs.length - 1);
    legs.push({ leg: { id: l.seg.id, dir: l.dir, ang: l.ang, def: net.def(l.seg), len: l.len, path: l.path }, hs, slope: k > 0 ? (hs[k] - hs[0]) / k : 0, half: net.half(l.seg) });
  }
  if (!sloped || !legs.length) return null;
  return (x, z) => {
    let W = 0, H = 0;
    for (const g of legs) {
      const f = legFrameOf(n, g.leg, { x, z }), over = Math.max(0, Math.abs(f.b) - g.half);
      let h: number;
      if (f.a <= 0) h = g.slope * f.a;
      else { const i = Math.min(g.hs.length - 1, Math.floor(f.a)), j = Math.min(g.hs.length - 1, i + 1), t = Math.min(1, f.a - i); h = g.hs[i] + (g.hs[j] - g.hs[i]) * t; }
      const d = f.a < 0 ? Math.hypot(f.a, over) : over, w = 1 / (d ** 4 + 0.01);
      W += w; H += w * h;
    }
    return H / W;
  };
}

// Turning angle from arriving on leg a to leaving on leg b: negative is a left turn (we drive on the left).
export function turnOf(a: Leg, b: Leg) {
  const ux = -a.dir.x, uz = -a.dir.z;
  return Math.atan2(ux * b.dir.z - uz * b.dir.x, ux * b.dir.x + uz * b.dir.z);
}
export function moveOf(a: Leg, b: Leg, _form?: Form, _legs?: Leg[]): Move {
  const t = turnOf(a, b);
  return t < -0.55 ? 'L' : t > 0.55 ? 'R' : 'S';
}

// Design traffic: each leg sends traffic in proportion to its size, split between the other legs
// by theirs (a gravity model). Counts seen from live traffic take over as they accumulate.
export function designFlows(legs: Leg[], seen?: Map<string, number>) {
  const flows: Record<string, number> = {};
  const total = seen ? [...seen.values()].reduce((t, v) => t + v, 0) : 0;
  for (const a of legs) {
    const others = legs.filter((b) => b !== a);
    const W = others.reduce((t, b) => t + b.w, 0) || 1;
    for (const b of others) {
      const k = `${a.seg.id}>${b.seg.id}`;
      const model = 30 * a.w * (b.w / W);
      flows[k] = total > 60 ? 0.3 * model + 0.7 * ((seen!.get(k) ?? 0) / total) * legs.reduce((t, l) => t + 30 * l.w, 0) : model;
    }
  }
  return flows;
}

// Share a movement's traffic across the lanes it may use so the busiest one is as quiet as possible.
function fill(base: number[], lanes: number[], d: number) {
  const out = new Map<number, number>(lanes.map((k) => [k, 0]));
  let left = d;
  for (let it = 0; it < 40 && left > 1e-6; it++) {
    const lvl = Math.min(...lanes.map((k) => base[k] + out.get(k)!));
    const low = lanes.filter((k) => base[k] + out.get(k)! <= lvl + 1e-9);
    const next = Math.min(...lanes.map((k) => base[k] + out.get(k)!).filter((v) => v > lvl + 1e-9), Infinity);
    const step = Math.min(left / low.length, next - lvl);
    for (const k of low) out.set(k, out.get(k)! + step);
    left -= step * low.length;
  }
  return out;
}

// The best way to use an approach's lanes, given what each movement carries and how many lanes
// each exit can receive. Lanes run from the nearside; each takes a run of movements in L-S-R order.
export function assignLanes(n: number, moves: Move[], demand: Record<Move, number>, receive: Record<Move, number>, capOf: (m: Move[]) => number) {
  const order = (['L', 'S', 'R'] as Move[]).filter((m) => moves.includes(m));
  const m = order.length;
  if (!m || !n) return { lanes: Array.from({ length: n }, () => order.slice()), dos: 0 };
  const intervals: [number, number][] = [];
  for (let a = 0; a < m; a++) for (let b = a; b < m; b++) intervals.push([a, b]);
  let best: { lanes: Move[][]; dos: number } | null = null;
  const pick: [number, number][] = [];
  const rec = (k: number) => {
    if (k === n) {
      if (pick[0][0] !== 0 || pick[n - 1][1] !== m - 1) return;
      for (let i = 1; i < n; i++) if (pick[i][0] < pick[i - 1][0] || pick[i][1] < pick[i - 1][1] || pick[i][0] > pick[i - 1][1] + 1) return;
      const lanes = pick.map(([a, b]) => order.slice(a, b + 1));
      // an exit can only take as many turning lanes as it has lanes
      for (const mv of order) if (lanes.filter((l) => l.includes(mv)).length > Math.max(1, receive[mv])) return;
      const load = new Array(n).fill(0);
      const share = new Map<Move, Map<number, number>>();
      for (const mv of order) { const ls = lanes.map((l, i) => (l.includes(mv) ? i : -1)).filter((i) => i >= 0); share.set(mv, new Map(ls.map((i) => [i, demand[mv] / ls.length]))); }
      for (let it = 0; it < 6; it++) for (const mv of order) {
        const ls = [...share.get(mv)!.keys()];
        const base = load.map((_, i) => [...share.entries()].reduce((t, [o, sh]) => t + (o === mv ? 0 : sh.get(i) ?? 0), 0));
        share.set(mv, fill(base, ls, demand[mv]));
      }
      for (const [, sh] of share) for (const [i, v] of sh) load[i] += v;
      let dos = Math.max(...load.map((v, i) => v / capOf(lanes[i])));
      // shared lanes where right-turners wait block the traffic behind them
      dos += lanes.filter((l) => l.length > 1 && l.includes('R')).length * 0.03 + lanes.filter((l) => l.length > 1).length * 0.005;
      if (!best || dos < best.dos) best = { lanes, dos };
      return;
    }
    for (const iv of intervals) { pick[k] = iv; rec(k + 1); }
  };
  rec(0);
  return best ?? { lanes: Array.from({ length: n }, () => order.slice()), dos: 9 };
}

// What the junction may take: `fits` says whether a footprint is free of other people's land
export interface Geometry { fits: (polys: P[][]) => boolean }
export const shapeLegs = (net: Network, legs: Leg[]): ShapeLeg[] => legs.map((l) => ({ id: l.seg.id, dir: l.dir, ang: l.ang, def: net.def(l.seg), len: l.len, path: l.path }));

// Score a form: how full the busiest lane would be at design traffic (degree of saturation).
export function evaluate(net: Network, _node: number, legs: Leg[], form: Form, flows: Record<string, number>, major: number[], slip: Slip | null, fixed?: Record<number, Move[][]>) {
  const lanes: Record<number, Move[][]> = {};
  let worst = 0, busiest = '';
  const f = (a: Leg, b: Leg) => flows[`${a.seg.id}>${b.seg.id}`] ?? 0;
  const total = legs.reduce((t, a) => t + legs.reduce((u, b) => u + (a === b ? 0 : f(a, b)), 0), 0);
  // signal timing: opposite legs share a phase
  const phases = legs.length === 3 ? [major, legs.map((l) => l.seg.id).filter((id) => !major.includes(id))] : [[legs[0].seg.id, legs[2 % legs.length].seg.id], legs.slice(1).filter((_, i) => i % 2 === 0).map((l) => l.seg.id)];
  const crit = phases.map((ph) => Math.max(1, ...legs.filter((l) => ph.includes(l.seg.id)).map((l) => legs.reduce((t, b) => t + (b === l ? 0 : f(l, b)), 0) / Math.max(1, l.lanes))));
  const C = 60, lost = 5 * phases.length, green = (id: number) => { const p = phases.findIndex((ph) => ph.includes(id)); return ((C - lost) * crit[Math.max(0, p)]) / crit.reduce((t, v) => t + v, 0) / C; };
  for (const a of legs) {
    const outs = legs.filter((b) => b !== a);
    const demand: Record<Move, number> = { L: 0, S: 0, R: 0 }, receive: Record<Move, number> = { L: 0, S: 0, R: 0 };
    const moves: Move[] = [];
    for (const b of outs) {
      if (slip && slip.from === a.seg.id && slip.to === b.seg.id) continue; // left-turners take the slip
      const mv = moveOf(a, b, form, legs);
      demand[mv] += f(a, b);
      receive[mv] = Math.max(receive[mv], b.lanes);
      if (!moves.includes(mv)) moves.push(mv);
    }
    // what an approach lane can carry, by form (vehicles per hour)
    const isMajor = major.includes(a.seg.id);
    const cross = legs.filter((l) => major.includes(l.seg.id)).reduce((t, l) => t + outs.reduce((u, b) => u + (b === l ? 0 : f(l, b)), 0), 0);
    const circ = (form === 'mini' || form === 'roundabout') ? legs.reduce((t, x) => {
      // traffic already on the roundabout, passing in front of this entry
      if (x === a) return t;
      const i = legs.indexOf(x), ai = legs.indexOf(a), n = legs.length;
      return t + legs.reduce((u, y) => { if (y === x) return u; const k = (legs.indexOf(y) - i + n) % n, pass = (ai - i + n) % n; return u + (pass > 0 && pass < k ? f(x, y) : 0); }, 0);
    }, 0) : 0;
    const capOf = (mv: Move[]): number => {
      if (form === 'merge' || form === 'join') return 1800;
      if (form === 'priority') return isMajor ? (mv.includes('R') ? Math.max(250, 900 - 0.5 * cross) : 1800) : Math.max(150, 750 - 0.45 * cross);
      if (form === 'signals') return 1900 * green(a.seg.id) * (mv.includes('R') ? 0.7 : 1);
      if (form === 'mini') return Math.max(200, 1000 - 0.7 * circ);
      // a two-lane circulatory shares the circulating traffic between its lanes
      return legs.some((l) => l.lanes > 1) ? Math.max(400, 1500 - 0.45 * circ) : Math.max(300, 1350 - 0.6 * circ);
    };
    const res = fixed?.[a.seg.id] && fixed[a.seg.id].length === a.lanes ? { lanes: fixed[a.seg.id], dos: 0 } : assignLanes(a.lanes, moves, demand, receive, capOf);
    lanes[a.seg.id] = res.lanes;
    // score what's actually painted
    const load = res.lanes.map(() => 0);
    for (const mv of moves) { const ls = res.lanes.map((l, i) => (l.includes(mv) ? i : -1)).filter((i) => i >= 0); for (const i of ls.length ? ls : [0]) load[i] += demand[mv] / Math.max(1, ls.length); }
    load.forEach((v, i) => { const d = v / capOf(res.lanes[i] ?? moves); if (d > worst) { worst = d; busiest = `${net.def(a.seg).label.split(' · ')[0]} approach, lane ${i + 1}`; } });
  }
  if (slip) worst = Math.max(worst, f(legs.find((l) => l.seg.id === slip.from)!, legs.find((l) => l.seg.id === slip.to)!) / 1200);
  return { lanes, score: { dos: worst, demand: total, capacity: worst > 0 ? total / worst : total, busiest } as Score };
}

function fitsRoundabout(legs: Leg[], R: number) { return legs.every((l) => l.len > R + 14); }
// room for the ring without knocking anything down
const ringFree = (net: Network, node: number, R: number, geo: Geometry) => geo.fits([ringFootprint(net.node(node), R)]);

// Design a junction from scratch: pick the form and lane use with the most spare capacity.
export function design(net: Network, node: number, geo: Geometry, seen?: Map<string, number>, prefer?: { form?: Form; slip?: boolean }): Junction | null {
  const legs = legsAt(net, node);
  if (legs.length < 2) return null;
  const n = net.node(node);
  const flows = designFlows(legs, seen);
  const ids = legs.map((l) => l.seg.id);
  const fast = legs.filter((l) => net.def(l.seg).family === 'Motorway');
  const maxK = Math.max(...legs.map((l) => kerbOf(net.def(l.seg))));
  // the priority road: the straightest pair, favouring the bigger road
  let major: number[] = [];
  let bestPair = -Infinity;
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length; j++) {
    const straight = -Math.cos(legs[i].ang - legs[j].ang);
    const v = straight * 2 + (legs[i].w + legs[j].w) / 20;
    if (v > bestPair) { bestPair = v; major = [ids[i], ids[j]]; }
  }
  const multi = legs.some((l) => l.lanes > 1);
  const small = legs.every((l) => l.lanes === 1 && net.def(l.seg).mph <= 30);
  const R = STD.roundabout(multi ? 2 : 1, legs.some((l) => net.def(l.seg).mph >= 50)).R;
  const raised = Math.abs(n.y) > 0.5;
  const make = (form: Form, slipOn: boolean): Junction => {
    const sl = shapeLegs(net, legs);
    const shapeOf = (pair: [number, number] | null) => (form === 'join' || form === 'merge' ? null : shapeJunction(n, sl, form, major, pair, form === 'roundabout' ? R : 0));
    let shape = shapeOf(null);
    let slip: Slip | null = null;
    if (slipOn && (form === 'priority' || form === 'signals')) {
      // the busiest left turn gets a slip, if there's room for one
      let best = 0;
      for (let i = 0; i < legs.length; i++) {
        const a = legs[i], b = legs[(i + 1) % legs.length];
        if (moveOf(a, b, form, legs) !== 'L') continue;
        const q = flows[`${a.seg.id}>${b.seg.id}`] ?? 0;
        // slips are for busy turns and bigger roads; a back-street T doesn't get one
        const big = [a, b].some((l) => l.lanes > 1 || net.def(l.seg).mph >= 40);
        if (q <= best || (!big && q < 300 && !prefer?.slip)) continue;
        const sh = shapeOf([a.seg.id, b.seg.id]);
        if (sh?.slip && geo.fits(sh.claims)) { best = q; slip = sh.slip; shape = sh; }
      }
    }
    const reach: Record<number, number> = {};
    for (const l of legs) reach[l.seg.id] = shape ? shape.line[l.seg.id] ?? 0 : 0;
    const ev = evaluate(net, node, legs, form, flows, major, slip);
    return { node, form, auto: true, custom: false, complex: legs.length > 4, legs: ids, major, lanes: ev.lanes, slip, R: shape?.R || (form === 'mini' ? Math.max(maxK + 2, 7) : R), reach, score: ev.score, flows, shape };
  };
  if (legs.length === 2) return make('join', false);
  const options: Junction[] = [];
  if (prefer?.form) return make(prefer.form, prefer.slip ?? true);
  // fast roads (and the end of a motorway) meet others at a roundabout, never a side-road T
  const quick = fast.length > 0 || legs.some((l) => net.def(l.seg).mph >= 50);
  const ringOk = (r: number) => !raised && fitsRoundabout(legs, r) && ringFree(net, node, r, geo);
  if (quick && ringOk(R)) {
    const rb = make('roundabout', false);
    if (fast.length || rb.score.dos < 0.95) return rb;
    options.push(rb);
  }
  if (fast.length) options.push(make('signals', false));
  else if (legs.length === 3) {
    // a T: give way with a slip for the busiest left turn, unless signals would clearly cope better
    options.push(make('priority', true), make('priority', false));
    if (multi) options.push(make('signals', true));
  } else {
    // crossroads and bigger: a roundabout if there's room, else signals
    // mini-roundabouts suit four quiet streets at most; five or more roads want a full one
    if (ringOk(small && legs.length > 4 ? 16 : small ? 7 : R)) options.push(make(small && legs.length <= 4 ? 'mini' : 'roundabout', false));
    options.push(make('signals', legs.length === 4));
    if (small && legs.length === 4) options.push(make('priority', false));
  }
  // prefer the simplest form that copes; otherwise the one with most spare capacity
  const simple: Form[] = ['priority', 'mini', 'roundabout', 'signals'];
  options.sort((x, y) => {
    const ok = (j: Junction) => (j.score.dos < 0.85 ? 0 : 1);
    return ok(x) - ok(y) || (ok(x) === 0 ? (legs.length === 3 ? (x.slip ? 0 : 1) - (y.slip ? 0 : 1) || simple.indexOf(x.form) - simple.indexOf(y.form) : simple.indexOf(x.form) - simple.indexOf(y.form)) : x.score.dos - y.score.dos);
  });
  // four-way junctions on the flat take roundabouts where they fit, as the player asked
  if (legs.length >= 4) { const rb = options.find((o) => o.form === 'mini' || o.form === 'roundabout'); if (rb && rb.score.dos < 1.2) return rb; }
  return options[0];
}

// Re-score a junction after the player changes its form, slip or lanes.
export function rescore(net: Network, j: Junction, geo: Geometry, change: { form?: Form; slip?: boolean; lanes?: Record<number, Move[][]> }) {
  const legs = legsAt(net, j.node);
  const base = design(net, j.node, geo, undefined, { form: change.form ?? j.form, slip: change.slip ?? !!j.slip });
  if (!base) return j;
  const fixed = change.lanes ?? (change.form || change.slip !== undefined ? undefined : j.lanes);
  const ev = evaluate(net, j.node, legs, base.form, base.flows, base.major, base.slip, fixed);
  return { ...base, lanes: ev.lanes, score: ev.score, auto: false, custom: !!fixed };
}

// Which movements a lane could be given, in a sensible order to cycle through.
export function laneOptions(moves: Move[]): Move[][] {
  const order = (['L', 'S', 'R'] as Move[]).filter((m) => moves.includes(m));
  const out: Move[][] = [];
  for (let a = 0; a < order.length; a++) for (let b = a; b < order.length; b++) out.push(order.slice(a, b + 1));
  return out;
}

// Is this land free for the junction at `node` to take? Its own roads don't count; other roads,
// other junctions and buildings do (gardens can be trimmed, buildings would have to go).
export function landFits(net: Network, node: number, polys: P[][]) {
  const mine = new Set(net.segsAt(node).map((s) => `road:${s.id}`));
  mine.add(`junction:${node}`);
  for (const poly of polys) {
    if (!net.land.free(poly, (c) => mine.has(c.key))) return false;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    for (const l of net.lots) {
      const r = Math.hypot(l.w, l.d) / 2 + 1;
      if (l.x + r < x0 || l.x - r > x1 || l.z + r < z0 || l.z - r > z1) continue;
      if (polysTouch(rectCorners(l.x, l.z, l.rot, l.w + 1, l.d + 1), poly)) return false;
    }
  }
  return true;
}
export type { Lot };
