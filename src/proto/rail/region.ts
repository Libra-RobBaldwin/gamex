// A railway for a generated region (docs/region.md R3, docs/rail.md): a main line through the city
// and two of the towns, a branch off it to a village, a station in each of them, and a line along
// each route. It only needs the settlements (the region generator's own types stay in
// src/proto/region/), so it's tested against a small fake region.
//
//   const plan = planRegionRail(settlements, { bound });  // pure: where the track and stations go
//   const made = layRegionRail(railway, plan);             // builds them on the network, and the lines
//
// The main line is double track, straight through each station (a station needs 400 m or so of
// straight, level line) and curving gently between them; the branch is single track with a
// passing loop at its village station, and leaves the main line at points facing the city.
import { DEFAULT_OPTS, pathLength, type End, type P } from '../roads';
import { ROADS, TRAINS, type TrainDef } from '../catalog';
import type { Railway } from './railway';
import type { RailLine } from './sim';
import type { Station } from './station';

export interface RailSettlement { id: string | number; name: string; kind: 'city' | 'town' | 'village'; x: number; z: number; r: number }
export interface RailStationPlan { settlement: RailSettlement; x: number; z: number; hx: number; hz: number; route: 'main' | 'branch' }
export interface RegionRailPlan {
  main: { legs: { a: P; b: P; ctrl?: P }[] }; // built in order, end to end
  branch: { from: P; legs: { a: P; b: P; ctrl?: P }[] } | null;
  stations: RailStationPlan[];
  lines: { name: string; route: 'main' | 'branch'; stops: (string | number)[] }[];
}
const STRAIGHT = 260; // straight track either side of a station's middle
const MAIN_R = ROADS['rail-main'].minR, BRANCH_R = ROADS['rail-branch'].minR;

const sub = (a: P, b: P) => ({ x: a.x - b.x, z: a.z - b.z });
const len = (v: P) => Math.hypot(v.x, v.z);
const unit = (v: P) => { const l = len(v) || 1; return { x: v.x / l, z: v.z / l }; };
const add = (a: P, v: P, k: number) => ({ x: a.x + v.x * k, z: a.z + v.z * k });

// Where the main line and the branch go.
export function planRegionRail(all: RailSettlement[], o: { bound: number; isWater?: (p: P) => boolean }): RegionRailPlan | null {
  const city = [...all].filter((s) => s.kind === 'city').sort((a, b) => b.r - a.r)[0] ?? [...all].sort((a, b) => b.r - a.r)[0];
  if (!city) return null;
  const towns = all.filter((s) => s !== city && s.kind === 'town');
  if (towns.length < 2) return null;
  // the pair of towns the city lies most nearly between, not too far apart; failing that (all the
  // towns off to one side), from the city out through one town to the next
  let order: RailSettlement[] | null = null, best = Infinity;
  const bend = (a: RailSettlement, m: RailSettlement, b: RailSettlement) => { const ua = unit(sub(a, m)), ub = unit(sub(b, m)); return ua.x * ub.x + ua.z * ub.z; }; // -1: dead straight through m
  for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) {
    const a = towns[i], b = towns[j], straight = bend(a, city, b);
    const score = (straight + 1) * 4000 + (len(sub(a, city)) + len(sub(b, city))) * 0.3;
    if (straight < -0.3 && score < best) { best = score; order = [a, city, b]; }
  }
  if (!order) for (const a of towns) for (const b of towns) {
    if (a === b) continue;
    const straight = bend(city, a, b), d = len(sub(a, city)) + len(sub(b, a));
    const score = (straight + 1) * 4000 + d * 0.3;
    if (straight < -0.3 && score < best) { best = score; order = [city, a, b]; }
  }
  if (!order) return null;
  // each station's heading: from the one before to the one after (a smooth run through)
  const heads = order.map((_, i) => unit(sub(order[Math.min(order.length - 1, i + 1)], order[Math.max(0, i - 1)])));
  const stations: RailStationPlan[] = order.map((s, i) => ({ settlement: s, ...stationSpot(s, heads[i]), hx: heads[i].x, hz: heads[i].z, route: 'main' as const }));
  const legs = joinUp(stations.map((s) => ({ p: s, h: { x: s.hx, z: s.hz } })), MAIN_R, o.bound);
  if (!legs) return null;
  // the branch: to the village nearest the main line (not one on it), from points on the town side of the city
  const villages = all.filter((s) => s.kind === 'village');
  // (off the city's station, on the side the line goes on from it)
  const ci = order.indexOf(city), c = stations[ci], k = ci === order.length - 1 ? -1 : 1, out = { x: c.hx * k, z: c.hz * k };
  let branch: RegionRailPlan['branch'] = null, bv: RailSettlement | null = null;
  const from = add(c, out, STRAIGHT - 40); // near the end of the city station's straight, on the way to the second town
  let bd = Infinity;
  for (const v of villages) {
    const d = len(sub(v, from)), ahead = (v.x - from.x) * out.x + (v.z - from.z) * out.z;
    const side = Math.abs((v.x - from.x) * out.z - (v.z - from.z) * out.x);
    if (d < 900 || d > 4000 || ahead < 300 || side < 400) continue;
    if (d < bd) { bd = d; bv = v; }
  }
  if (bv) {
    const toV = unit(sub(bv, from));
    // leave the main line heading on, curving round towards the village, and in straight to its station
    const vh = toV, vs = stationSpot(bv, vh);
    // (off through points at a few degrees, so it's soon clear of the main line)
    const lr = Math.sign(out.x * vh.z - out.z * vh.x) || 1, a0 = 0.3 * lr;
    const d0 = { x: out.x * Math.cos(a0) - out.z * Math.sin(a0), z: out.x * Math.sin(a0) + out.z * Math.cos(a0) };
    const turn = Math.acos(Math.max(-1, Math.min(1, d0.x * vh.x + d0.z * vh.z)));
    const k = Math.max(BRANCH_R * Math.tan(turn / 2) * 1.3, 120);
    const ctrl = add(from, d0, k), bend = add(ctrl, vh, k);
    const into = add(vs, vh, -STRAIGHT);
    if (len(sub(into, bend)) > 50 && (into.x - bend.x) * vh.x + (into.z - bend.z) * vh.z > 0) {
      const endB = add(vs, vh, STRAIGHT);
      branch = { from, legs: [{ a: from, b: bend, ctrl }, { a: bend, b: into }, { a: into, b: endB }] };
      stations.push({ settlement: bv, ...vs, hx: vh.x, hz: vh.z, route: 'branch' });
    }
  }
  const inside = (p: P) => Math.abs(p.x) < o.bound - 20 && Math.abs(p.z) < o.bound - 20;
  const allLegs = [...legs, ...(branch?.legs ?? [])];
  if (!allLegs.every((l) => inside(l.a) && inside(l.b))) return null;
  if (o.isWater && allLegs.some((l) => [0.25, 0.5, 0.75].some((t) => o.isWater!({ x: l.a.x + (l.b.x - l.a.x) * t, z: l.a.z + (l.b.z - l.a.z) * t })))) {
    // (bridged by the network's own solver: nothing to do here but carry on)
  }
  const lines: RegionRailPlan['lines'] = [{ name: `${order[0].name} – ${order[2].name}`, route: 'main', stops: order.map((s) => s.id) }];
  if (branch && bv) lines.push({ name: `${bv.name} – ${city.name}`, route: 'branch', stops: [bv.id, city.id] });
  return { main: { legs }, branch, stations, lines };
}
// the station stands by the settlement's centre, a little way off it (so the line misses the high street)
function stationSpot(s: RailSettlement, h: P) {
  const off = Math.min(120, s.r * 0.35);
  return { x: s.x - h.z * off, z: s.z + h.x * off };
}
// Straight through each station, joined by a curve where the headings differ: a quadratic Bézier
// whose control point is where the two straights would meet (or a straight, if they line up).
function joinUp(st: { p: P; h: P }[], minR: number, _bound: number): { a: P; b: P; ctrl?: P }[] | null {
  const legs: { a: P; b: P; ctrl?: P }[] = [];
  const first = st[0], last = st[st.length - 1];
  let at = add(first.p, first.h, -STRAIGHT);
  for (let i = 0; i < st.length; i++) {
    const s = st[i], a = add(s.p, s.h, -STRAIGHT), b = add(s.p, s.h, STRAIGHT);
    if (i === 0) at = a;
    if (len(sub(a, at)) > 1) {
      // from the end of the last station's straight to the start of this one's
      const prev = st[i - 1], ctrl = meet(at, prev.h, a, s.h);
      if (ctrl) legs.push({ a: at, b: a, ctrl }); else legs.push({ a: at, b: a });
    }
    legs.push({ a, b });
    at = b;
  }
  void last; void minR;
  return legs.length ? legs : null;
}
// where the line from p along u meets the line from q back along v (null if nearly parallel or behind)
function meet(p: P, u: P, q: P, v: P): P | null {
  const den = u.x * v.z - u.z * v.x;
  if (Math.abs(den) < 0.02) return null;
  const t = ((q.x - p.x) * v.z - (q.z - p.z) * v.x) / den;
  const back = ((p.x + u.x * t - q.x) * v.x + (p.z + u.z * t - q.z) * v.z);
  if (t < 20 || back > -20) return null;
  return add(p, u, t);
}

// Build the plan on the railway's network, then its stations and lines. Returns what it made, and
// whatever it couldn't (in words), so the region can say so rather than fail.
export function layRegionRail(rw: Railway, plan: RegionRailPlan, o: { mainTrains?: TrainDef[]; branchTrains?: TrainDef[] } = {}) {
  const net = rw.net, problems: string[] = [];
  const build = (a: End, b: End, ctrl: P | undefined, type: string) => {
    const opts = { ...DEFAULT_OPTS, type, cross: 'bridge' as const, grade: ROADS[type].maxGrade };
    const c = net.check(a, b, ctrl, opts);
    if (!c.ok) { problems.push(`${type} ${Math.round(a.x)},${Math.round(a.z)}: ${c.reason}`); return false; }
    net.build(a, b, ctrl, opts);
    return true;
  };
  const snap = (p: P) => { const n = net.nearestNode(p, 1, 'rail'); return n ? { x: n.x, z: n.z, node: n.id } : { ...p }; };
  for (const l of plan.main.legs) build(snap(l.a), snap(l.b), l.ctrl, 'rail-main');
  if (plan.branch) {
    // (the points: the branch starts on the main line itself)
    const sg = net.nearestSeg(plan.branch.from, 2, (s) => net.def(s).cls === 'rail');
    const [l0, ...rest] = plan.branch.legs;
    if (sg && build({ x: sg.x, z: sg.z, seg: sg.seg.id }, snap(l0.b), l0.ctrl, 'rail-branch')) for (const l of rest) build(snap(l.a), snap(l.b), l.ctrl, 'rail-branch');
    else problems.push('the branch line');
  }
  rw.rebuild();
  // the stations: on each, a plan for the layout it recommends
  const made = new Map<string | number, Station>();
  for (const sp of plan.stations) {
    const sg = net.nearestSeg(sp, 3, (s) => net.def(s).cls === 'rail');
    if (!sg) { problems.push(`no track at ${sp.settlement.name}`); continue; }
    const tracks = net.def(sg.seg).tracks;
    const L = sp.route === 'main' ? (sp.settlement.kind === 'city' ? 215 : 130) : 60;
    const side: 1 | -1 = (sp.settlement.x - sg.x) * sg.uz - (sp.settlement.z - sg.z) * sg.ux > 0 ? 1 : -1;
    const res = rw.plan(sg.seg.id, sg.s, side, L);
    const pl = res.plans.find((p) => p.ok && (tracks === 2 ? p.layout === 'side' : p.loop)) ?? res.plans.find((p) => p.ok);
    if (!pl) { problems.push(`${sp.settlement.name}: ${res.reason ?? res.plans[0]?.blocked ?? 'no layout fits'}`); continue; }
    pl.station.name = `${sp.settlement.name}${sp.settlement.kind === 'city' ? ' Central' : ''}`;
    made.set(sp.settlement.id, rw.build(pl).station);
  }
  const lines: RailLine[] = [];
  for (const l of plan.lines) {
    const stops = l.stops.map((id) => made.get(id)?.id).filter((x): x is number => x !== undefined);
    if (stops.length < 2) { problems.push(`line ${l.name}`); continue; }
    const trains = l.route === 'main' ? (o.mainTrains ?? [TRAINS.intercity, TRAINS.dmu]) : (o.branchTrains ?? [TRAINS.dmu]);
    const line = rw.addLine(stops, false, trains);
    if (typeof line === 'string') problems.push(`line ${l.name}: ${line}`); else lines.push(line);
  }
  return { stations: [...made.values()], lines, problems, length: [...net.segs.values()].filter((s) => net.def(s).cls === 'rail').reduce((a, s) => a + pathLength(net.path(s)), 0) };
}
