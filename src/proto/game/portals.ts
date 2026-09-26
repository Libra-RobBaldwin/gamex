// Ways off the map (docs/edge.md): where the motorway, the A roads and the railway run out through
// the cut face at the map's edge to the world beyond. Each leads to a place off the map (named, a
// set number of miles away), which the economy counts as a town of its own, so trips to and from
// it are made, and good links out to the edge carry them. Traffic comes in and goes out through
// each at the rate its road and the time of day call for (the motorway busiest); a sign by each
// says where it goes, and tapping it shows its flows. Vehicles leaving are cut off cleanly at the
// face (clipping planes on the vehicles' one material), as if driving on into the slice.
//
//   const portals = findPortals(net, EDGE, map)          // after the roads are laid (or loaded)
//   const flows = new PortalTraffic(net, traffic, portals)
//   flows.step(dt, hour, level, view, places)            // each traffic step: vehicles in and out
//   const signs = new PortalSigns(root, portals, { toScreen, onPick })
//   signs.update(view)                                   // each frame
import * as THREE from 'three';
import { demand, type Access, type Traffic } from '../traffic';
import { placeName } from '../region/names';
import { rng } from '../region/random';
import { pathLength, pointAt, type Lot, type Network, type P, type RSeg } from '../roads';
import { icon } from '../ui/icons';
import type { Shell } from '../ui/shell';
import type { Railway } from '../rail/railway';
import { beyondEdge, type EdgeCrossing } from './edge';

export type PortalKind = 'motorway' | 'A' | 'B' | 'lane' | 'rail';
export interface Portal {
  id: number; kind: PortalKind;
  side: number; // 0: east (+x), 1: south (+z), 2: west (-x), 3: north (-z)
  at: P; // where it meets the edge (the middle of the carriageways)
  look: P; // where to look from to see it (a little way in)
  sign: P; // where its sign stands: beside the road, a little way in
  segs: number[]; // the network's roads (or track) that run out here
  place: string; // where it leads
  route: string; // its number on the signs ('M47', 'A381'; '' for the railway)
  miles: number; // how far off the map that is
  people: number; jobs: number; // how big (for the economy's trips)
  offMin: number; // minutes of driving (or riding) beyond the edge
  town: number; // the economy's id for it
  station?: number; // the railway's: its station off the map (portalStation)
}
// how each kind leads off: the size of the place it reaches, how far, and at what pace
const KINDS: Record<PortalKind, { people: number; jobs: number; miles: [number, number]; kmh: number; word: string }> = {
  motorway: { people: 14000, jobs: 10000, miles: [16, 28], kmh: 105, word: 'Motorway' },
  A: { people: 5000, jobs: 3500, miles: [9, 17], kmh: 70, word: 'A road' },
  B: { people: 1600, jobs: 900, miles: [5, 9], kmh: 55, word: 'B road' },
  lane: { people: 900, jobs: 450, miles: [3, 7], kmh: 45, word: 'Lane' },
  rail: { people: 18000, jobs: 14000, miles: [22, 40], kmh: 110, word: 'Railway' },
};
export const SIDE_WORD = ['east', 'south', 'west', 'north'];
export const OUTSIDE_ID = 900; // the economy's towns off the map: OUTSIDE_ID + portal id
const MERGE = 3000; // (m) ways off closer than this lead to the same place
// vehicles a second each way at the busiest (demand() about 1.2), before the traffic setting
const RATE: Record<PortalKind, number> = { motorway: 0.36, A: 0.07, B: 0.025, lane: 0.012, rail: 0 };
const LORRIES: Record<PortalKind, number> = { motorway: 0.22, A: 0.1, B: 0.05, lane: 0.03, rail: 0 };
const inward = (side: number): P => [{ x: -1, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }][side];
const sideOf = (p: P) => (Math.abs(p.x) >= Math.abs(p.z) ? (p.x >= 0 ? 0 : 2) : p.z >= 0 ? 1 : 3);
const along = (side: number, p: P) => (side === 0 || side === 2 ? p.z : p.x);

// The ways off the map: every road or track that ends at the ground's edge (or runs on past it),
// grouped where they run out together (a motorway's two carriageways are one way off).
export function findPortals(net: Network, edge: number, o: { seed: number; names: string[] }): Portal[] {
  const ends: { seg: RSeg; p: P; kind: PortalKind; node: number }[] = [];
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (d.cls !== 'road' && d.cls !== 'rail') continue;
    for (const n of [s.a, s.b]) {
      const p = net.node(n), r = Math.max(Math.abs(p.x), Math.abs(p.z));
      if (r < edge - 12) continue;
      if (d.cls === 'road' && net.segsAt(n).length > 1) continue;
      // (the railway: where it passes through the edge, on to its stretch off the map)
      if (d.cls === 'rail' && Math.abs(r - edge) > 1.5) continue;
      const kind: PortalKind = d.cls === 'rail' ? 'rail' : d.family === 'Motorway' ? 'motorway' : /50|B/.test(s.type) ? 'B' : 'A';
      ends.push({ seg: s, p, kind, node: n });
    }
  }
  const groups: { kind: PortalKind; side: number; list: typeof ends }[] = [];
  for (const e of ends) {
    const side = sideOf(e.p);
    const g = groups.find((x) => x.kind === e.kind && x.side === side && x.list.some((y) => Math.abs(along(side, y.p) - along(side, e.p)) < 90));
    if (g) g.list.push(e); else groups.push({ kind: e.kind, side, list: [e] });
  }
  const rand = rng(o.seed * 7919 + 31), taken = new Set(o.names.map((n) => n.toLowerCase()));
  const used = new Set<string>();
  const out = groups.map((g, i) => {
    const K = KINDS[g.kind], grow = Math.min(3, Math.max(1, Math.sqrt(edge / 4500))), x = g.list.reduce((t, e) => t + e.p.x, 0) / g.list.length, z = g.list.reduce((t, e) => t + e.p.z, 0) / g.list.length;
    const at = { x: g.side === 0 ? edge : g.side === 2 ? -edge : x, z: g.side === 1 ? edge : g.side === 3 ? -edge : z };
    const miles = Math.round(K.miles[0] + rand() * (K.miles[1] - K.miles[0]));
    let route = '';
    for (let t = 0; t < 20 && (!route || used.has(route)); t++) route = g.kind === 'motorway' ? `M${Math.floor(4 + rand() * 60)}` : g.kind === 'A' ? `A${Math.floor(300 + rand() * 600)}` : g.kind === 'B' ? `B${Math.floor(3000 + rand() * 1000)}` : '';
    used.add(route);
    const id = i + 1;
    // (beside the road, 80 m in along it, on the left as you drive out)
    const inMap = g.list.filter((e) => !beyondEdge(edge, net.path(e.seg))), qs = (inMap.length ? inMap : g.list).map((e) => { const path = net.pathFrom(e.seg, e.node); return pointAt(path, Math.min(80, pathLength(path) / 2)); });
    const q = qs[0], mx = qs.reduce((t, v) => t + v.x, 0) / qs.length, mz = qs.reduce((t, v) => t + v.z, 0) / qs.length;
    const wide = Math.max(...qs.map((v) => Math.hypot(v.x - mx, v.z - mz))) + net.half(g.list[0].seg) + 10;
    const sign = { x: mx - q.uz * wide, z: mz + q.ux * wide };
    return {
      sign,
      id, kind: g.kind, side: g.side, at, look: { x: at.x + inward(g.side).x * 220, z: at.z + inward(g.side).z * 220 }, segs: [...new Set(g.list.map((e) => e.seg.id))],
      place: placeName(rand, false, taken), route, miles, people: Math.round(K.people * grow), jobs: Math.round(K.jobs * grow), // (a bigger map's neighbours are bigger places)
      offMin: (miles * 1.609 * 60) / K.kmh, town: OUTSIDE_ID + id,
    };
  });
  // Ways off close together (a railway and a motorway out the same way, within MERGE) lead to the same place:
  // the biggest way's (and the nearest of its miles)
  const rank: Record<PortalKind, number> = { rail: 0, motorway: 1, A: 2, B: 3, lane: 4 };
  for (const p of [...out].sort((a, b) => rank[a.kind] - rank[b.kind])) {
    const q = out.find((x) => x !== p && x.town === x.id + OUTSIDE_ID && rank[x.kind] < rank[p.kind] && Math.hypot(x.at.x - p.at.x, x.at.z - p.at.z) < MERGE);
    if (q && p.town === p.id + OUTSIDE_ID) { p.place = q.place; p.town = q.town; p.people = q.people; p.jobs = q.jobs; }
  }
  return out;
}
// The ways off a 50 km map (worldmap/): where the plan's roads run off its rim (world50's exits:
// `plan.roads` with no place at their far end) and its railways, if it has any. None of these are
// on the game's Network unless the live area reaches the rim, so they carry no seg ids; their
// traffic is the coarse economy's trips (worldmap/econ.ts). `names`: places beyond the rim, nearest
// first for a point (a real map's, from OS Open Names); else they're made up, never a place on it.
export interface WorldRoute { kind: 'motorway' | 'A' | 'B'; path: P[]; b: number | null }
export function worldPortals(plan: { half: number; seed: number; roads: WorldRoute[]; rails?: { path: P[] }[]; settlements: { name: string }[] }, o: { seeded?: boolean; names?: (at: P) => string | undefined } = {}): Portal[] {
  const E = plan.half, rand = rng(plan.seed * 7919 + 37), taken = new Set(plan.settlements.map((s) => s.name.toLowerCase()));
  const out: Portal[] = [], used = new Set<string>();
  const exit = (path: P[], kind: PortalKind) => {
    // (the last point inside the rim, and where the path crosses it)
    let i = path.length - 1;
    while (i > 0 && Math.max(Math.abs(path[i].x), Math.abs(path[i].z)) >= E) i--;
    if (i === path.length - 1) return;
    const a = path[i], b = path[i + 1], ra = Math.max(Math.abs(a.x), Math.abs(a.z)), rb = Math.max(Math.abs(b.x), Math.abs(b.z)), t = (E - ra) / Math.max(1e-6, rb - ra);
    const hit = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, side = sideOf(hit);
    const at = { x: side === 0 ? E : side === 2 ? -E : hit.x, z: side === 1 ? E : side === 3 ? -E : hit.z };
    const K = KINDS[kind], grow = Math.min(3, Math.max(1, Math.sqrt(E / 4500))), miles = Math.round(K.miles[0] + rand() * (K.miles[1] - K.miles[0]));
    let route = '';
    for (let k = 0; k < 20 && (kind === 'A' || kind === 'B' || kind === 'motorway') && (!route || used.has(route)); k++) route = kind === 'motorway' ? `M${Math.floor(4 + rand() * 60)}` : kind === 'A' ? `A${Math.floor(300 + rand() * 600)}` : `B${Math.floor(3000 + rand() * 1000)}`;
    used.add(route);
    // (the sign 80 m in along the road, on the left as you drive out)
    const q = pointAt(path.slice(0, i + 1).concat([at]).reverse(), 80), n = inward(side);
    const id = out.length + 1;
    const place = o.names?.(at) ?? placeName(rand, kind === 'lane', taken);
    out.push({
      id, kind, side, at, look: { x: at.x + n.x * 220, z: at.z + n.z * 220 }, sign: { x: q.x - q.uz * 12, z: q.z + q.ux * 12 }, segs: [],
      place, route, miles, people: Math.round(K.people * grow), jobs: Math.round(K.jobs * grow), offMin: (miles * 1.609 * 60) / K.kmh, town: OUTSIDE_ID + id,
    });
  };
  // (on a seeded start the roads off the map are lanes, not B roads: worldmap/routes.ts)
  for (const r of plan.roads) if (r.b === null) exit(r.path, r.kind === 'B' && o.seeded !== false ? 'lane' : r.kind);
  for (const r of plan.rails ?? []) { exit(r.path, 'rail'); exit([...r.path].reverse(), 'rail'); }
  return out;
}
// The cut face's roads and railways in section, where the ways off a 50 km map cross its rim.
export function portalCrossings(portals: Portal[]): EdgeCrossing[] {
  const W: Record<PortalKind, [number, number]> = { motorway: [18, 16], A: [6, 4], B: [5, 3.5], lane: [3.6, 2.6], rail: [5, 5] };
  return portals.map((p) => ({ side: p.side, u: [-p.at.z, p.at.x, p.at.z, -p.at.x][p.side], half: W[p.kind][0], kerb: W[p.kind][1], y: 0, rail: p.kind === 'rail' }));
}
// Where the place a way off leads to stands: out beyond the rim, square to it, as far as the drive
// there takes (a kilometre a minute over 1.3 times the straight line, as the economies reckon)
export const offMapPoint = (p: Portal): P => { const n = inward(p.side), far = (p.offMin * 1000) / 1.3; return { x: p.at.x - n.x * far, z: p.at.z - n.z * far }; };
// The places off the map, as the economy has them: one for each place the ways off lead to, out
// beyond the way that reaches it by road as far as the drive there takes (the economy's cars go
// about a kilometre a minute out of town, over 1.3 times the straight line), and `railMin` on by
// train from its station.
export function outsidePlaces(portals: Portal[], _edge: number, stationAt: (id: number) => P | undefined) {
  const out: { id: number; name: string; x: number; z: number; people: number; jobs: number; offMin: number; railMin?: number; station?: number; carExtra?: number }[] = [];
  for (const p of portals) {
    let t = out.find((x) => x.id === p.town);
    if (!t) {
      t = { id: p.town, name: p.place, x: p.at.x, z: p.at.z, people: p.people, jobs: p.jobs, offMin: Infinity };
      out.push(t);
    }
    if (p.station !== undefined && stationAt(p.station)) { t.station = p.station; t.railMin = p.offMin; }
    if (p.kind !== 'rail' && p.offMin < t.offMin) { t.offMin = p.offMin; t.x = p.at.x; t.z = p.at.z; }
  }
  for (const t of out) {
    if (!isFinite(t.offMin)) t.offMin = (t.railMin ?? 20) * 1.6; // (reached only by rail: by road it's the long way round)
    // (no further out than 11 km, within the economy's reach of the map: the rest of the drive is carExtra)
    // (out from the middle of the map through its way off, so places off the map lie well apart)
    const far = Math.min(11000, (t.offMin * 1000) / 1.3), r = Math.hypot(t.x, t.z) || 1;
    t.carExtra = t.offMin - (far * 1.3) / 1000;
    t.x += (t.x / r) * far; t.z += (t.z / r) * far;
  }
  return out;
}
export const portalTitle = (p: Portal) => (p.kind === 'rail' ? `Railway to ${p.place}` : p.kind === 'lane' ? `Lane to ${p.place}` : `${p.route} to ${p.place}`);
export const portalLine = (p: Portal) => `${KINDS[p.kind].word} off the map to the ${SIDE_WORD[p.side]} · ${p.miles} miles`;

// ---------------- traffic in and out ----------------
interface Ends { portal: Portal; into: Access[]; out: Access[]; onward: Access[]; back: Access[]; acc: [number, number]; live: boolean; inRun: Access[]; outRun: Access[] }
export interface NearPlaces { homes: Lot[]; jobs: Lot[]; shops: Lot[] }
// The traffic through each way off the map, while the camera's near enough to see it: vehicles
// come in off the map (to somewhere near, or on through), and go out to it (from somewhere near,
// or from further in), at the portal's rate for the time of day. Further off there's only the
// economy's count of trips.
export class PortalTraffic {
  private ends: Ends[] = [];
  stats = { in: 0, out: 0, primed: 0, tried: 0 };
  constructor(private net: Network, private traffic: Traffic, readonly portals: Portal[], private rand = rng(4242)) { this.refresh(); }
  // the roads changed: where each way off starts and ends again
  refresh() {
    this.ends = [];
    for (const p of this.portals) {
      if (p.kind === 'rail') continue;
      const e: Ends = { portal: p, into: [], out: [], onward: [], back: [], acc: [0, 0], live: false, inRun: [], outRun: [] };
      for (const id of p.segs) {
        const s = this.net.segs.get(id);
        if (!s) continue;
        const L = this.traffic.roadLength(s), atA = Math.max(Math.abs(this.net.node(s.a).x), Math.abs(this.net.node(s.a).z)) > Math.max(Math.abs(this.net.node(s.b).x), Math.abs(this.net.node(s.b).z));
        // (a one-way carriageway is in or out; a two-way road both)
        const inA: Access = { seg: s, s: atA ? 2 : L - 2 };
        if (!s.oneway || atA) { e.into.push(inA); const on = this.walk(s, atA ? s.a : s.b, 2300, true, e.inRun); if (on) e.onward.push(on); }
        if (!s.oneway || !atA) { e.out.push({ seg: s, s: atA ? 2 : L - 2 }); const bk = this.walk(s, atA ? s.a : s.b, 2300, false, e.outRun); if (bk) e.back.push(bk); }
      }
      if (e.into.length || e.out.length) this.ends.push(e);
    }
  }
  // A point `far` metres in along the roads from a way off the map, keeping to the road's line
  // through each junction (driving in along it if `ahead`, else coming out along it).
  // (`run`: points every 60 m or so along the way, for vehicles already on it: prime())
  private walk(s: RSeg, edgeNode: number, far: number, ahead: boolean, run0: Access[] = []): Access | null {
    let seg = s, from = edgeNode, run = 0;
    for (let hop = 0; hop < 60; hop++) {
      const L = this.traffic.roadLength(seg), to = this.net.other(seg, from);
      for (let k = 30; k < Math.min(L, far - run); k += 60) run0.push({ seg, s: from === seg.a ? k : L - k });
      if (run + L >= far) { const k = far - run; return { seg, s: from === seg.a ? k : L - k }; }
      run += L;
      const path = this.net.pathFrom(seg, from), q = path[path.length - 1], r = path[path.length - 2];
      const hx = q.x - r.x, hz = q.z - r.z, hl = Math.hypot(hx, hz) || 1;
      let best: RSeg | null = null, bd = -2;
      for (const n of this.net.segsAt(to)) {
        if (n.id === seg.id || this.net.def(n).cls !== 'road') continue;
        // (one-way: going in, it must leave this node; coming out, arrive at it)
        if (n.oneway && (ahead ? n.a !== to : n.b !== to)) continue;
        const p = this.net.pathFrom(n, to), dx = p[1].x - p[0].x, dz = p[1].z - p[0].z, dl = Math.hypot(dx, dz) || 1;
        const straight = (hx * dx + hz * dz) / (hl * dl) + (this.net.def(n).family === this.net.def(seg).family ? 0.3 : 0);
        if (straight > bd) { bd = straight; best = n; }
      }
      if (!best) return run > far * 0.4 ? { seg, s: from === seg.a ? L - 1 : 1 } : null;
      seg = best; from = to;
    }
    return null;
  }
  // how many vehicles a second come in (or go out) through a portal now, each way
  rate(p: Portal, hour: number, level: number) { return RATE[p.kind] * demand(hour) * level; }
  // the ways off near the camera, for the traffic's own trips to and from elsewhere
  near(view: P, r: number, to: boolean): Access[] {
    const out: Access[] = [];
    for (const e of this.ends) if (Math.hypot(e.portal.at.x - view.x, e.portal.at.z - view.z) < r) out.push(...(to ? e.out : e.into));
    return out;
  }
  // Each traffic step (dt seconds): vehicles in and out through the ways off near the camera.
  step(dt: number, hour: number, level: number, view: P, reach: number, places: NearPlaces) {
    for (const e of this.ends) {
      const d = Math.hypot(e.portal.at.x - view.x, e.portal.at.z - view.z);
      if (d > reach + 600) { e.acc = [0, 0]; e.live = false; continue; }
      const rate = this.rate(e.portal, hour, level);
      if (!e.live) { e.live = true; this.prime(e, rate, places); }
      for (const way of [0, 1] as const) {
        e.acc[way] = Math.min(3, e.acc[way] + rate * dt * (way ? e.out.length ? 1 : 0 : e.into.length ? 1 : 0));
        while (e.acc[way] >= 1) {
          e.acc[way] -= 1;
          const lorry = this.rand() < LORRIES[e.portal.kind];
          const ok = way === 0 ? this.comeIn(e, lorry, places) : this.goOut(e, lorry, places);
          if (ok) this.stats[way === 0 ? 'in' : 'out']++;
        }
      }
    }
  }
  // Coming into view: the road already carries its flow, vehicles spread along it each way (as
  // many as the rate and the time to drive it make), rather than starting empty.
  private prime(e: Ends, rate: number, places: NearPlaces) {
    for (const [run, way] of [[e.inRun, 0], [e.outRun, 1]] as const) {
      const n = Math.min(40, Math.round((rate * run.length * 60) / 28));
      for (let i = 0; i < n; i++) {
        const o = this.pick(run)!, lorry = this.rand() < LORRIES[e.portal.kind];
        const d = way === 0 ? (!this.through(e) && this.local(e, places)) || this.pick(e.onward) : this.pick(e.out);
        this.stats.tried++;
        if (d && this.traffic.trip(o, d, lorry, true)) this.stats.primed++;
      }
    }
  }
  private pick<T>(list: T[]) { return list.length ? list[Math.floor(this.rand() * list.length)] : undefined; }
  // somewhere near the portal a trip could end (or start): a home, a job or a shop within reach of it
  private local(e: Ends, places: NearPlaces): Access | null {
    const lists = [places.jobs, places.homes, places.shops];
    for (let t = 0; t < 3; t++) {
      const l = this.pick(lists[Math.floor(this.rand() * 3)]);
      if (l && Math.hypot(l.x - e.portal.at.x, l.z - e.portal.at.z) < 2400) { const a = this.traffic.accessOf(l); if (a) return a; }
    }
    return null;
  }
  // (most on the motorway are passing through; on an A road most are for somewhere near)
  private through(e: Ends) { return this.rand() < (e.portal.kind === 'motorway' ? 0.7 : 0.35); }
  private comeIn(e: Ends, lorry: boolean, places: NearPlaces) {
    const o = this.pick(e.into)!;
    const d = (!this.through(e) && this.local(e, places)) || this.pick(e.onward);
    return !!d && this.traffic.trip(o, d, lorry, true); // (in off the map already at speed)
  }
  private goOut(e: Ends, lorry: boolean, places: NearPlaces) {
    const d = this.pick(e.out)!;
    const l = !this.through(e) && this.local(e, places), o = l || this.pick(e.back);
    return !!o && this.traffic.trip(o, d, lorry, !l); // (from further in, it's under way as it comes into sight)
  }
}

// The four planes of the map's edge, for a material to be cut off by (what drives on out through the face)
export function edgePlanes(edge: number) {
  return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), edge), new THREE.Plane(new THREE.Vector3(1, 0, 0), edge), new THREE.Plane(new THREE.Vector3(0, 0, -1), edge), new THREE.Plane(new THREE.Vector3(0, 0, 1), edge)];
}

// ---------------- signs ----------------
const CSS = `
#ui > .portal-signs, .portal-signs { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.portal-sign { position: absolute; left: 0; top: 0; display: flex; align-items: stretch; gap: 0; margin: 0; padding: 0; border: 2px solid #fff; border-radius: 6px; cursor: pointer; pointer-events: none;
  transform: translate(-50%, -100%); white-space: nowrap; box-shadow: 0 2px 6px rgba(15, 51, 34, 0.45); transition: opacity 0.25s ease; font: 700 13px/1.1 'Archivo', system-ui, sans-serif; color: #fff; text-align: left; }
.portal-sign.on { pointer-events: auto; }
.portal-sign .rt { display: flex; align-items: center; gap: 4px; padding: 5px 7px; font: 800 14px/1 'League Spartan', 'Archivo', system-ui, sans-serif; letter-spacing: 0.02em; }
.portal-sign .rt svg { width: 16px; height: 16px; }
.portal-sign .to { display: flex; flex-direction: column; justify-content: center; padding: 4px 8px 4px 2px; }
.portal-sign .to small { font: 500 10.5px/1.1 'Archivo', system-ui, sans-serif; opacity: 0.9; margin-top: 2px; }
.portal-sign.motorway { background: #1f5aa6; }
.portal-sign.A { background: #0b6b3a; } .portal-sign.A .rt { color: #ffd200; }
.portal-sign.B, .portal-sign.lane { background: #fff; color: #111; border-color: #111; }
.portal-sign.lane .rt { display: none; } .portal-sign.lane .to { padding-left: 8px; }
.portal-sign.rail { background: #fff; color: #0f3322; border-color: #0f3322; } .portal-sign.rail .rt { color: #c8102e; }
.portal-sign::after { content: ''; position: absolute; left: calc(50% + var(--post, 0px)); bottom: -9px; width: 2px; height: 7px; margin-left: -1px; background: #fff; }
`;
export interface PortalSignOpts {
  toScreen: (p: { x: number; z: number; y?: number }) => { x: number; y: number };
  onPick: (p: Portal) => void;
  heightAt?: (x: number, z: number) => number;
}
// A sign by each way off the map, in the style of a UK direction sign: plain DOM (crisp, no draw
// calls), placed each frame a little way in from the edge.
export class PortalSigns {
  readonly el: HTMLDivElement;
  private items: { p: Portal; el: HTMLButtonElement; on: boolean; spot: P; w: number }[];
  constructor(parent: HTMLElement, portals: Portal[], private o: PortalSignOpts) {
    if (!document.getElementById('portal-signs-css')) { const st = document.createElement('style'); st.id = 'portal-signs-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.el = document.createElement('div');
    this.el.className = 'portal-signs';
    parent.prepend(this.el);
    this.items = portals.map((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `portal-sign ${p.kind}`;
      el.innerHTML = `<span class="rt">${p.kind === 'rail' ? icon('train') : p.kind === 'motorway' ? `${icon('motorway')}${p.route}` : p.route}</span><span class="to">${p.place}<small>${SIDE_WORD[p.side][0].toUpperCase()}${SIDE_WORD[p.side].slice(1)} · ${p.miles} mi</small></span>`;
      el.setAttribute('aria-label', `${portalTitle(p)}: ${portalLine(p)}`);
      el.style.opacity = '0';
      el.hidden = true;
      el.dataset.portal = String(p.id);
      el.addEventListener('click', (e) => { e.stopPropagation(); o.onPick(p); });
      this.el.appendChild(el);
      // (a little way in from the edge, beside the road)
      return { p, el, on: false, spot: p.sign, w: 0 };
    });
  }
  // Each frame: shown while zoomed in far enough to be near the edge, and on screen.
  update(viewH: number) {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    for (const it of this.items) {
      const want = viewH < 7000;
      const q = this.o.toScreen({ ...it.spot, y: this.o.heightAt?.(it.spot.x, it.spot.z) ?? 0 });
      const off = !want || q.x < -60 || q.x > W + 60 || q.y < 0 || q.y > H + 40;
      if (off) { if (it.on) { it.on = false; it.el.style.opacity = '0'; it.el.classList.remove('on'); } it.el.hidden = !it.on && true; continue; }
      it.el.hidden = false;
      // (kept on screen: the sign slides in from the side, its post still under the spot)
      const w = (it.w ||= it.el.offsetWidth), x = Math.max(w / 2 + 6, Math.min(W - w / 2 - 6, q.x));
      it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(q.y - 8)}px) translate(-50%, -100%)`;
      it.el.style.setProperty('--post', `${Math.round(q.x - x)}px`);
      if (!it.on) { it.on = true; it.el.style.opacity = '1'; it.el.classList.add('on'); }
    }
  }
}

// ---------------- the card ----------------
export interface PortalFacts { perDay: number; trips: { all: number; lines: number }; trains?: number; action?: { label: string; onClick: () => void } }
// Tapped: a small card, where it goes and three numbers (vehicles in and out a day, or the trains
// running there and the trips it carries for the railway), and one action at most.
export function openPortal(shell: Shell, p: Portal, f: PortalFacts) {
  const n = (x: number) => Math.round(x).toLocaleString('en-GB');
  const rail = p.kind === 'rail';
  shell.openInfo({
    key: `portal:${p.id}`, title: p.place, sub: `${rail ? 'Railway' : p.kind === 'lane' ? 'Lane' : p.route} · ${SIDE_WORD[p.side]} · ${p.miles} miles off the map`, icon: rail ? 'train' : p.kind === 'motorway' ? 'motorway' : 'road',
    stats: rail ? [['Trains running', n(f.trains ?? 0)], ['Trips a day', n(f.trips.all)], ['By your lines', n(f.trips.lines)]]
      : [['In a day', n(f.perDay)], ['Out a day', n(f.perDay)], ['Trips a day', n(f.trips.all)]],
    actions: f.action ? [{ label: f.action.label, icon: rail ? 'transport' : 'pin', kind: 'primary', onClick: f.action.onClick }] : undefined,
  });
}
// vehicles a day each way through a portal (at the traffic setting `level`)
export function perDay(p: Portal, level = 1) { let t = 0; for (let h = 0; h < 24; h += 0.25) t += demand(h) * 0.25; return RATE[p.kind] * level * 3600 * t; }

// ---------------- the railway's way off ----------------
// The station off the map where the railway's way off leads: on the stretch of line past the
// ground's edge (not drawn), so a train running there goes out through the cut face and is gone
// for its stop, then comes back. A line can end there like at any station (its badge shows just
// past the edge). Found again in a loaded game, else built now. Returns its id.
export function portalStation(rw: Railway, p: Portal, edge: number): number | undefined {
  const net = rw.net;
  const had = rw.stations.find((s) => beyondEdge(edge, [s]) && sideOf(s) === p.side && Math.abs(along(p.side, s) - along(p.side, p.at)) < 300);
  if (had) return had.id;
  const seg = p.segs.map((id) => net.segs.get(id)).filter((s): s is RSeg => !!s && beyondEdge(edge, net.path(s))).sort((a, b) => net.length(b) - net.length(a))[0];
  if (!seg) return undefined;
  const L = net.length(seg);
  for (const side of [1, -1] as const) {
    const plan = rw.plan(seg.id, L / 2, side, 150).plans.find((x) => x.ok && (net.def(seg).tracks !== 2 || x.layout === 'side'));
    if (!plan) continue;
    plan.station.name = p.place;
    return rw.build(plan).station.id;
  }
  return undefined;
}
