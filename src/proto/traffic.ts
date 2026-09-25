// Background traffic: cars and lorries that aren't part of the game, but come from the city.
// Every trip starts at a real building (a home, a job, a shop, a works) or at a road leading off
// the map, is routed over the road network, and ends by turning in at its destination.
//
// Nobody drives through anybody. Each vehicle follows whatever is in front of it along the way it
// is going (IDM car-following: across plain joins, through the junction, into the lane beyond),
// changes lane only into a real gap, and never moves further than the space it has. Junctions
// are worked out from the vehicles' own footprints (see conflicts.ts): every course through a
// junction knows where it touches every other, so a car waiting to pull out knows exactly what it
// has to let past, and a car on the ring knows who it is following. Who goes first is settled
// when a vehicle commits to a junction: the road with priority, the ring, the green light, or a gap
// big enough that nobody has to brake for you. Nobody goes in unless there's room beyond.
import * as THREE from 'three';
import { section } from './roaddraw'; // (people: where a bus stands at a stop)
import { BAY, bayWeight, closestOnPath, HALF, pathLength, pointAt, type Lot, type Network, type P, type RSeg, type Stop } from './roads';
import { junctionLift, legsAt, moveOf, type Junction, type Leg, type Move } from './junction';
import { TRAINS, laneBase, trainSpeed, type TrainDef } from './catalog';
import { courseOf, laneSpan, sectionAt, taperOf, type Course, type Ends2 } from './xsection';
import { BODIES, DIMS, overlapping, steered, type Axles, type Kind, type Pose } from './footprint';
import { STEP, Track, View, table, tableStats, type Cls } from './conflicts';
import { Fleet, type Dress, type Dressed } from './game/fleet';

export interface Places { homes: Lot[]; jobs: Lot[]; shops: Lot[]; works: Lot[]; weight: (l: Lot) => number }

// A way through a junction: from one approach lane to one exit lane, followed a stretch either
// side so that vehicles waiting at the line, or just out of the junction, count as being in it.
interface JPath {
  track: Track; ext0: number; ext1: number; // the junction itself runs from ext0 to ext1 along the track
  node: number; inSeg: number; from: number; lane: number; next: number; exitLane: number;
  move: Move; slip: boolean; rank: number; // rank: who gives way to whom (lower goes first)
  lineS: number; outS: number; // where it leaves its approach lane, and joins its exit lane
  inKey: number; exitKey: number;
  env: Float32Array; // per metre along the track: the speed allowed, braking comfortably for the bends ahead
  // a slip road, for each size of vehicle: until where it's still in the lane it leaves, and where
  // it has to have found a gap in the lane it joins (worked out for each body as it's first needed)
  leave?: number[]; gate?: number[]; lanes?: [P[], P[]];
  inb?: (e: Entry) => boolean; // (see inbound)
  hold?: Map<Cls, [string, number]>; // (see holdAt)
}
// a junction, or a bend where two roads meet end to end and the road runs on round a curve
interface JData { node: number; j: Junction | null; live: boolean; legs: Leg[]; paths: Map<string, JPath> }
// wrong: heading for a slip road that's only reached from the nearside lane, from another lane (its path
// is the slip road's course, which it may only take once it's moved over)
interface Plan { seg: number; from: number; lane: number; slip: boolean; bus: boolean; jd: JData; path: JPath; node: number; next: RSeg; noWay?: boolean; wrong?: boolean }
// someone in or near a junction, at t along their path through it; adm: their place in the order
// the junction's users go in (Infinity until they commit to it)
interface User { c: Car; path: JPath; t: number; adm: number; v: number; rank?: number }
// someone in a lane: really there (0), still leaving it for a junction (1), coming out of one into
// it (2), moving across out of it (3), or waiting to be let into it (4)
interface Entry { c: Car; pos: number; kind: number }

interface Car {
  id: number; kind: Kind; front: number; back: number;
  seg: RSeg; from: number; s: number; v: number; vmax: number;
  route: number[]; // seg ids still to drive, after the current one
  goal: number; // stop at this distance along the last seg
  away?: boolean; // the trip ends off the map: drive on out rather than pulling up
  dest?: Access;
  lorry: boolean; bus?: boolean; heading: number;
  cls?: Cls; hw?: number; dress?: Dress; // the real vehicle (game/fleet.ts): its body for the conflict tables, half its width, its look
  born: number; gone?: number; wait: number;
  lane: number; off: number; // lane (0 = nearside) and current sideways position
  dwell?: number; served?: number; inBay?: boolean; bay?: Stop;
  nextSeg?: number;
  oldLane?: number; lcAt?: number; lcHold?: number; v0?: number; uturn?: boolean;
  merge?: number; mergeBy?: number; // the lane it's waiting to be let into, and where it has to stop if it isn't
  keep?: number; // the junction it turns at from the lane it's in, having waited too long to get into the right one
  turn?: { path: JPath; t: number; node: number; next: RSeg };
  plan?: Plan; merged?: boolean;
  adm?: number; admNode?: number;
  after?: { path: JPath; adm: number };
  entry?: Entry; uref: User[];
  ents?: Entry[]; ne?: number; users?: User[]; // (reused from frame to frame, so the garbage collector isn't kept busy)
  why?: string; // why it isn't going into the junction yet (for debugging)
  roomWait?: number; // how long it has stood at the line for want of room beyond
  line?: BusLine; leg?: number; // a bus on a line, and which of its calls it's making next
  sold?: boolean; // taken off the roads as soon as it's clear of junctions
  divertAt?: number; // when it last looked for another way out of a junction with no room beyond
  readmit?: number; // when it last asked, standing at the line, whether it could go ahead of whoever it waits for
  pose?: Pose; axles?: Axles; // where it was last drawn, and where its axles are (footprint.steered)
}
interface Train { def: TrainDef; seg: RSeg; from: number; s: number; v: number; trail: { seg: RSeg; from: number }[]; dress: Dress; gone?: boolean }
interface Access { seg: RSeg; s: number }
// A bus line: the stops its buses call at, in order, over and over (A, B, C, B for A-B-C and
// back). Each call is at the stop or at any stop facing it across the road, whichever side the
// bus arrives on.
export interface BusLine { id: number; seq: number[] }
interface Place { key: number; seg: RSeg; stops: Stop[] }
interface SegInfo { L: number; fwd: P[]; rev: P[]; ends: Ends2; spans: Map<number, [number, number]>; course?: Course; offs?: Map<number, Float32Array> }
type Obstacle = (gap: number, vl: number, s0?: number) => void;

const MAX = 300;
// how each kind of vehicle drives: acceleration, comfortable braking, time gap, gap when stopped
const DRIVE: Record<Kind, { a: number; b: number; T: number; s0: number }> = {
  car: { a: 2.0, b: 2.5, T: 1.1, s0: 2 },
  lorry: { a: 1.0, b: 2.0, T: 1.5, s0: 2.5 },
  bus: { a: 1.1, b: 2.0, T: 1.4, s0: 2.5 },
};
const BMAX = 9; // emergency stop
const E_IN = 10, E_OUT = 10; // how far either side of a junction its paths are followed
const E_PRE = 16; // how far back up the approach its courses run
const BUSLANE = 8, BAYLANE = 9;
const LONGEST = 10; // the furthest any vehicle reaches in front of or behind its centre (an 18.5 m bendy bus)
const WIDEST = 1.3; // half the widest vehicle's width (2.55 m buses and trailers, as game/fleet.ts rounds it)
const GIVE_UP = 90; // seconds stood still before a driver gives up and goes another way
const DIVERT = 15; // seconds stood at a junction with no room beyond before trying another way out of it
const STARVE = 20; // seconds waiting in a junction after which nobody else may go ahead of you
const CLAIM = 4; // seconds stood at the line for want of room beyond, after which that room is kept for you
const KEEP = 20; // seconds stood waiting to be let into the lane for a turn before turning from the lane you're in
const AMBER = 3, ALLRED = 2;
const LAT = 3; // m/s² sideways: how hard vehicles corner
const BEND = 0.1; // radians: a join sharper than this is driven round its curve, not straight across

// a lane's centre from the road's centreline, for a cross-section with `lanes` lanes (fractional
// where one is tapering away) of width w each side of a median of half-width m
function offIn(m: number, lanes: number, w: number, bus: number, lane: number) {
  if (lane === BUSLANE) return m + lanes * w + bus / 2;
  if (lane < Math.floor(lanes + 1e-6)) return m + lanes * w - (lane + 0.5) * w;
  return m + (Math.max(0.3, lanes - lane) * w) / 2; // the lane that's tapering away
}
// the speed allowed at t along a junction's path (for the bends at and beyond it)
const spd = (P: JPath, t: number) => P.env[Math.max(0, Math.min(P.env.length - 1, Math.floor(t / STEP)))];
// a body that swings wide of its course turning: articulated, or rigid and long (a bus, a big lorry)
const isLong = (k: Cls) => { const b = BODIES[k]; return !!b.trailer || b.front + b.back > 9; };
// Does the limit `it` at p puts on us move along with it (following it into the same lane) rather
// than stay put (a crossing)? (judged over a few metres: the table is in metre steps, and where a
// body's chord cuts a bend the limit can stand still for a metre or two while it moves on)
const movesWith = (vw: View, p: number, lim: number) => vw.limitMe(p + 5) - lim > 2.5;
const keyOf = (s: RSeg, from: number, lane: number) => s.id * 32 + (from === s.a ? 0 : 16) + lane;
const clsOf = (c: Car): Cls => c.cls ?? (c.lorry ? 1 : c.bus ? 2 : 0);

// Intelligent Driver Model: the acceleration that keeps a safe, comfortable gap to what's ahead.
function idm(v: number, v0: number, gap: number, vl: number, p: { a: number; b: number; T: number; s0: number }, s0 = p.s0) {
  const ss = s0 + Math.max(0, v * p.T + (v * (v - vl)) / (2 * Math.sqrt(p.a * p.b)));
  const r = Math.min(2, v / Math.max(0.5, v0));
  return p.a * (1 - r * r * r * r - (ss / Math.max(0.05, gap)) ** 2);
}
// Following: as IDM, but a driver whose leader is pulling away judges the gap as it will be a moment
// from now, so a queue moves off as briskly as drivers really do (IDM on its own waits for the gap
// to grow, and a queue at a give-way line trickles out). It never moves further than the space
// there is now (the caller's gmin), and following at the same speed it's IDM exactly.
// And at a crawl (in a queue, through a junction) drivers close up to a shorter time gap than at speed.
const ANTICIPATE = 1.0; // seconds
function follow(v: number, v0: number, gap: number, vl: number, p: { a: number; b: number; T: number; s0: number }, s0 = p.s0) {
  const k = 0.7 + 0.3 * Math.min(1, v / 12);
  return idm(v, v0, vl > v ? gap + (vl - v) * ANTICIPATE : gap, vl, k < 1 ? { a: p.a, b: p.b, T: p.T * k, s0: p.s0 } : p, s0);
}
const idmFree = (v: number, v0: number, p: { a: number }) => { const r = Math.min(2, v / Math.max(0.5, v0)); return p.a * (1 - r * r * r * r); };


export class Traffic {
  cars: Car[] = [];
  // the speed allowed at s (from seg.a, going in direction dir) on top of the road's own, e.g. on a bridge (m/s)
  speedCap?: (seg: RSeg, s: number, dir: 1 | -1, ahead?: number) => number;
  private net: Network;
  private graph: Map<number, { seg: RSeg; to: number; len: number }[]> | null = null;
  private access = new Map<number, Access | null>();
  junctions = new Map<number, Junction>();
  // turning counts seen at each junction: "from>to" seg ids
  seen = new Map<number, Map<string, number>>();
  trains: Train[] = [];
  // How long a bus stands at a stop (seconds). Without it, 7; the crowds (game/crowds.ts) make it
  // wait while the people at the stop walk to its door. `bus` is the bus's id.
  onBusStop?: (seg: RSeg, st: Stop, bus: number) => number;
  // People on a crossing now (game/crowds.ts), as points on each road, by the road's id. Vehicles
  // that haven't reached one stop short of it (`stand` metres short, at a zebra's or pelican's line,
  // where one that couldn't stop comfortably in time carries on over: an amber light)
  crossing = new Map<number, (P & { stand?: number })[]>();
  // Level crossings shut to the road (rail/crossing.ts), by the road's id: stretches [from, to]
  // along it (from its a end) that nobody drives onto; anyone already on one drives off it.
  barriers = new Map<number, [number, number][]>();
  // drawn along with the traffic, inside the fleet's frame (the railway's trains: rail/draw.ts)
  onDraw?: (dt: number) => void;
  stats = { spawned: 0, arrived: 0, gaveUp: 0, rerouted: 0, lapsed: 0, laneChanges: 0 };
  // how many junction conflict tables have been worked out, and how long they took (ms)
  readonly conflictStats = tableStats;
  private sig = new Map<number, { j: Junction; phases: number[][]; greens: number[]; t0: number }>();
  private gradeCache = new Map<number, number>();
  private rand: () => number;
  // per-network caches (cleared by invalidate), and per-frame indexes
  private segC = new Map<number, SegInfo>();
  private legsC = new Map<number, Leg[]>();
  private halfC = new Map<number, number>();
  private jd = new Map<number, JData>();
  private placeC = new Map<number, Place | null>(); // bus lines' calls, by stop id
  private lineC = new Map<string, number>(); // a line bus's next road, by junction, road and call (-1: no way)
  private tables = new Map<number, Map<number, { a: View; b: View }>>(); // by the two courses, then the two bodies
  private edgeList: [Access[], Access[]] | null = null;
  private buckets = new Map<number, Entry[]>();
  private users = new Map<number, User[]>();
  private committed = new Map<number, Car[]>();
  private claims = new Map<number, Car[]>(); // who has been waiting longest for room in each lane beyond a junction
  private appr = new Map<number, User[]>();
  private admSeq = 0;
  private ids = 1;
  private clock = 0;
  // the real vehicles (the vehicle library): what each one is, and drawing them all
  readonly fleet: Fleet;

  constructor(net: Network, scene: THREE.Scene, rand: () => number) {
    this.net = net;
    this.rand = rand;
    this.fleet = new Fleet(net);
    this.fleet.formAt = (node) => this.junctions.get(node)?.form;
    scene.add(this.fleet.group);
  }

  // the road network changed: routes, access points and anyone on a removed road are reset
  invalidate() {
    this.graph = null;
    this.placeC.clear();
    this.lineC.clear();
    this.edgeList = null;
    this.access.clear();
    this.gradeCache.clear();
    this.segC.clear();
    this.legsC.clear();
    this.halfC.clear();
    this.jd.clear();
    this.tables.clear();
    const has = (id: number) => this.net.segs.has(id);
    for (const c of this.cars) {
      c.plan = undefined;
      if (!has(c.seg.id) || c.route.some((id) => !has(id)) || (c.turn && !has(c.turn.next.id))) c.gone ??= this.clock;
    }
  }

  // ---------- cached geometry ----------
  private info(s: RSeg): SegInfo {
    let x = this.segC.get(s.id);
    if (!x) {
      const fwd = this.net.path(s);
      x = { L: pathLength(fwd), fwd, rev: [...fwd].reverse(), ends: taperOf(this.net, s), spans: new Map() };
      this.segC.set(s.id, x);
    }
    return x;
  }
  private len(s: RSeg) { return this.info(s).L; }
  private course(s: RSeg) { const x = this.info(s); return (x.course ??= courseOf(this.net, s, x.ends)); }
  // where two roads meet end to end at a bend: the centre both are drawn round, and how far back
  // from the node each road's own path gives way to the curve (see xsection.courseOf)
  private bendAt(node: number) {
    const legs = this.legs(node);
    if (legs.length !== 2 || this.net.segsAt(node).length !== 2) return null;
    const cut = (s: RSeg) => { const C = this.course(s), e = s.a === node ? 0 : 1; return { J: C.joins[e], cut: C.cut[e] }; };
    const a = cut(legs[0].seg), b = cut(legs[1].seg);
    if (!a.J?.X || Math.abs(a.J.turn) < BEND) return null;
    return { X: a.J.X, cut: new Map([[legs[0].seg.id, a.cut], [legs[1].seg.id, b.cut]]) };
  }
  private pathOf(s: RSeg, from: number) { const x = this.info(s); return from === s.a ? x.fwd : x.rev; }
  private legs(node: number) {
    let l = this.legsC.get(node);
    if (!l) this.legsC.set(node, (l = legsAt(this.net, node)));
    return l;
  }
  private nodeHalf(node: number) {
    let h = this.halfC.get(node);
    if (h === undefined) this.halfC.set(node, (h = Math.max(HALF, ...this.legs(node).map((l) => this.net.half(l.seg)))));
    return h;
  }
  // where general lane `lane` is usable driving away from `from` (see xsection.ts)
  private span(s: RSeg, from: number, lane: number): [number, number] {
    const x = this.info(s);
    if (lane === BUSLANE) return [0, x.L];
    const k = (from === s.a ? 0 : 16) + lane;
    let r = x.spans.get(k);
    if (!r) x.spans.set(k, (r = laneSpan(this.net, s, from, lane, x.ends)));
    return r;
  }
  // a lane's centre, from the road's centreline, following any taper where the road changes
  private laneOff(s: RSeg, from: number, at: number, lane: number) {
    const d = this.net.def(s), x = this.info(s);
    const t = Math.max(0, Math.min(x.L, from === s.a ? at : x.L - at));
    const inTaper = (x.ends.A && t < x.ends.A.len) || (x.ends.B && x.L - t < x.ends.B.len);
    if (!inTaper) return offIn(laneBase(d), d.lanes, d.lane, d.bus, lane);
    // through a taper, from a table a metre apart (worked out once: it's wanted a lot there)
    const offs = (x.offs ??= new Map());
    let tab = offs.get(lane);
    if (!tab) {
      tab = new Float32Array(Math.ceil(x.L) + 2);
      for (let i = 0; i < tab.length; i++) { const sec = sectionAt(this.net, s, Math.min(i, x.L), x.ends); tab[i] = offIn(sec.median, sec.lanes, sec.lane, d.bus, lane); }
      offs.set(lane, tab);
    }
    const i = Math.min(tab.length - 2, Math.floor(t));
    return tab[i] + (tab[i + 1] - tab[i]) * (t - i);
  }
  private lanePoint(s: RSeg, from: number, at: number, lane: number): P {
    const q = pointAt(this.pathOf(s, from), at), off = this.laneOff(s, from, at, lane);
    return { x: q.x + q.uz * off, z: q.z - q.ux * off, y: q.y };
  }
  private laneIdx(c: Car) { return c.bus && this.net.def(c.seg).bus ? BUSLANE : c.lane; }
  // How far out from the road's middle the back of the vehicle is, as last drawn (its rear dragged
  // after its front: see footprint.steered), in the same terms as c.off
  private rearOff(c: Car) {
    const r = c.pose?.parts[c.pose.parts.length - 1];
    if (!r || c.turn) return c.off;
    const path = this.pathOf(c.seg, c.from), L = this.len(c.seg), q0 = pointAt(path, Math.min(c.s, L));
    const along = (r.x - r.hx * r.hl - q0.x) * q0.ux + (r.z - r.hz * r.hl - q0.z) * q0.uz;
    const q = pointAt(path, Math.max(0, Math.min(L, c.s + along)));
    return (r.x - r.hx * r.hl - q.x) * q.uz - (r.z - r.hz * r.hl - q.z) * q.ux;
  }

  private adj() {
    if (this.graph) return this.graph;
    const g = new Map<number, { seg: RSeg; to: number; len: number }[]>();
    for (const s of this.net.segs.values()) {
      if (this.net.def(s).cls !== 'road') continue;
      const len = this.len(s);
      // (a one-way road only from a to b)
      for (const [a, b] of s.oneway ? [[s.a, s.b]] : [[s.a, s.b], [s.b, s.a]]) { let l = g.get(a); if (!l) g.set(a, (l = [])); l.push({ seg: s, to: b, len }); }
    }
    return (this.graph = g);
  }

  // where a building's traffic joins the road: the point on the nearest road in front of its plot
  accessOf(l: Lot): Access | null {
    if (this.access.has(l.id)) return this.access.get(l.id)!;
    const c = Math.cos(l.rot), s = Math.sin(l.rot), f = l.d / 2 + l.front;
    const p = { x: l.x - f * s, z: l.z + f * c };
    // traffic joins ordinary roads, never straight onto a motorway
    // (an industrial site out of town has its gate on a fast rural road: game/industry.ts lots, id <= -1000)
    const n = this.net.nearestSeg(p, 24, (s) => this.net.def(s).frontage || (l.id <= -1000 && this.net.def(s).cls === 'road' && this.net.def(s).family !== 'Motorway'));
    const a = n ? { seg: n.seg, s: n.s } : null;
    this.access.set(l.id, a);
    return a;
  }
  // dead ends out at the edge of town count as roads to elsewhere
  // (`to`: as where a trip ends; a one-way road off the map is only the one or the other)
  private edges(to = false): Access[] {
    if (this.edgeList) return to ? this.edgeList[1] : this.edgeList[0];
    const from: Access[] = [], into: Access[] = [];
    for (const [id, list] of this.adj()) {
      const n = this.net.node(id);
      if (list.length === 1 && Math.hypot(n.x, n.z) > 180) {
        const e = { seg: list[0].seg, s: list[0].seg.a === id ? 1 : this.len(list[0].seg) - 1 };
        from.push(e);
        if (!e.seg.oneway) into.push(e);
      }
    }
    // (the far end of a one-way road that leads off the map, where nothing comes back from)
    for (const s of this.net.segs.values()) if (s.oneway && this.net.def(s).cls === 'road' && this.net.segsAt(s.b).length === 1) {
      const n = this.net.node(s.b);
      if (Math.hypot(n.x, n.z) > 180) into.push({ seg: s, s: this.len(s) - 1 });
    }
    this.edgeList = [from, into];
    return to ? into : from;
  }

  // ---------- routes ----------
  // Shortest way from the given nodes (each with the distance already driven) to a point on a road.
  private search(starts: { node: number; cost: number }[], avoid: number, d: Access) {
    const g = this.adj(), L1 = this.len(d.seg);
    const dist = new Map<number, number>(), prev = new Map<number, { node: number; seg: RSeg }>(), first = new Map<number, number>();
    for (const st of starts) if (st.cost < (dist.get(st.node) ?? Infinity)) { dist.set(st.node, st.cost); first.set(st.node, st.node); }
    const open = new Set(starts.map((s) => s.node)), done = new Set<number>();
    while (open.size) {
      let u = -1, du = Infinity;
      for (const n of open) { const v = dist.get(n)!; if (v < du) { du = v; u = n; } }
      open.delete(u); done.add(u);
      if (du > 3000) break;
      for (const e of g.get(u) ?? []) {
        if (e.seg.id === avoid || done.has(e.to)) continue;
        const nd = du + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { node: u, seg: e.seg }); first.set(e.to, first.get(u)!); open.add(e.to); }
      }
    }
    const ca = (dist.get(d.seg.a) ?? Infinity) + d.s, cb = d.seg.oneway ? Infinity : (dist.get(d.seg.b) ?? Infinity) + (L1 - d.s);
    if (!isFinite(Math.min(ca, cb))) return null;
    const entry = ca <= cb ? d.seg.a : d.seg.b;
    const segs: number[] = [];
    for (let n = entry; prev.has(n); n = prev.get(n)!.node) segs.unshift(prev.get(n)!.seg.id);
    segs.push(d.seg.id);
    return { segs, start: first.get(entry)!, entry, goal: entry === d.seg.a ? d.s : L1 - d.s, cost: Math.min(ca, cb) };
  }
  // Shortest route from a point on one road to a point on another.
  private plan(o: Access, d: Access) {
    const L0 = this.len(o.seg);
    if (o.seg.id === d.seg.id && (!o.seg.oneway || d.s > o.s)) {
      return d.s > o.s ? { from: o.seg.a, s: o.s, route: [] as number[], goal: d.s, entry: o.seg.a } : { from: o.seg.b, s: L0 - o.s, route: [] as number[], goal: L0 - d.s, entry: o.seg.b };
    }
    // (on a one-way road there's only the way ahead, even to somewhere behind on the same road)
    const r = this.search(o.seg.oneway ? [{ node: o.seg.b, cost: L0 - o.s }] : [{ node: o.seg.a, cost: o.s }, { node: o.seg.b, cost: L0 - o.s }], o.seg.oneway ? -1 : o.seg.id, d);
    if (!r) return null;
    // leaving towards a means we drive from b; towards b, from a
    const from = this.net.other(o.seg, r.start);
    return { from, s: from === o.seg.a ? o.s : L0 - o.s, route: r.segs, goal: r.goal, entry: r.entry };
  }
  // A fresh route onwards from a junction, leaving it along `seg`.
  private planVia(node: number, seg: RSeg, d: Access) {
    if (seg.id === d.seg.id) return { route: [seg.id], goal: seg.a === node ? d.s : this.len(seg) - d.s, entry: node, cost: 0 };
    const r = this.search([{ node: this.net.other(seg, node), cost: this.len(seg) }], seg.id, d);
    return r ? { route: [seg.id, ...r.segs], goal: r.goal, entry: r.entry, cost: r.cost } : null;
  }
  // Where on a road traffic may start or stop: clear of the junctions at either end.
  private startGuard(s: RSeg, from: number) {
    const jd = this.jdata(from);
    if (!jd) return 0.5;
    return jd.j ? this.reachOf(jd.j, from, s) + E_OUT + 2 : (this.bendAt(from)?.cut.get(s.id) ?? 0) + 1;
  }
  private endGuard(s: RSeg, from: number) {
    const at = this.net.other(s, from), jd = this.jdata(at), L = this.len(s);
    if (!jd) return L - 0.5;
    if (!jd.j) return L - (this.bendAt(at)?.cut.get(s.id) ?? 0) - 1;
    let g = L - this.reachOf(jd.j, at, s) - E_IN - 2;
    const sl = jd.j.slip;
    if (sl && sl.from === s.id) g = Math.min(g, closestOnPath(sl.path[0], this.pathOf(s, from)).s - E_IN - 2);
    return g;
  }

  private spawn(o: Access, d: Access, lorry: boolean, now: number) {
    const p = this.plan(o, d);
    if (!p) return false;
    // the real vehicle, at its true size: a mix for where the trip starts, a lorry or van from a
    // works (game/fleet.ts, drawing its own random numbers, so the trips are the same as ever)
    const dm = this.fleet.dress(o.seg, lorry), kind = dm.kind, heavy = dm.heavy;
    const lo = this.startGuard(o.seg, p.from) + dm.back, hi = this.endGuard(o.seg, p.from) - dm.front;
    if (hi < lo) return false;
    const s = Math.max(lo, Math.min(hi, p.s));
    // the destination, likewise clear of junctions
    const glo = this.startGuard(d.seg, p.entry), ghi = this.endGuard(d.seg, p.entry);
    let goal = ghi > glo ? Math.max(glo, Math.min(ghi, p.goal)) : (glo + ghi) / 2;
    if (!p.route.length && goal < s + 8) { if (s + 8 > hi) return false; goal = s + 8; }
    const n = this.net.def(o.seg).lanes;
    const lanes = lorry || n === 1 ? [0] : [...Array(n).keys()].sort(() => this.rand() - 0.5);
    for (const lane of heavy ? [0] : lanes) {
      const sp = this.span(o.seg, p.from, lane);
      if (s - dm.back < sp[0] || s + dm.front + 10 > sp[1] || !this.canPlace(o.seg, p.from, s, lane, dm)) continue;
      dm.dress.lampAt = (this.rand() - 0.5) * 0.7; // (this number once chose the box's paint: now when the driver's lamps go on)
      const cruise = lorry ? 25 : 28 + this.rand() * 5;
      const c: Car = {
        id: this.ids++, kind, front: dm.front, back: dm.back, seg: o.seg, from: p.from, s, v: 0, vmax: Math.min(heavy ? 25 : cruise, dm.top * 0.95), route: p.route, goal, dest: d,
        away: this.offMap(d.seg, p.entry, goal), lorry: heavy, heading: 0, born: now, wait: 0, lane, off: this.laneOff(o.seg, p.from, s, lane), uref: [],
        cls: dm.cls, hw: dm.hw, dress: dm.dress,
      };
      this.cars.push(c);
      c.entry = this.put(keyOf(o.seg, p.from, lane), c, s, 0, true);
      this.stats.spawned++;
      return true;
    }
    return false;
  }
  // does a trip ending here leave the map (at the far end of a road out of town)?
  private offMap(seg: RSeg, from: number, goal: number) {
    const far = this.net.other(seg, from);
    return goal > this.len(seg) - 3 && ((this.adj().get(far)?.length ?? 0) === 1 || (!!seg.oneway && this.net.segsAt(far).length === 1)) && this.edges(true).some((e) => e.seg === seg);
  }
  // Is there room to put a vehicle here, clear of the ones in the lane and of any coming up behind?
  private canPlace(seg: RSeg, from: number, s: number, lane: number, dm: { front: number; back: number; hw: number }) {
    // (where a road narrows, the lane beside may be too close to be alongside anything in it)
    const lanes = [lane];
    // (anywhere along its length: at its tail is where anything coming up the lane beside meets it)
    // (and wherever those beside actually are: easing across as a lane opens out, they lag behind it)
    const sep = (u: number, l: number) => Math.abs(this.laneOff(seg, from, u, l) - this.laneOff(seg, from, u, lane)), near = dm.hw + WIDEST + 0.4;
    const beside: number[] = [];
    if (lane !== BUSLANE) for (const l of [lane - 1, lane + 1]) if (l >= 0 && l < this.net.def(seg).lanes) {
      lanes.push(l);
      if (Math.min(sep(s, l), sep(Math.max(0, s - dm.back), l), sep(s + dm.front, l)) < near) beside.push(l);
    }
    const mine = this.laneOff(seg, from, s, lane);
    for (const l of lanes) for (const e of this.buckets.get(keyOf(seg, from, l)) ?? []) {
      if (l !== lane && !beside.includes(l) && !(e.c.seg === seg && e.c.from === from && Math.abs(e.c.off - mine) < near)) continue;
      const pos = e.kind === 0 && e.c.seg === seg && e.c.from === from && !e.c.turn ? e.c.s : e.pos;
      if (pos >= s) { if (pos - e.c.back - (s + dm.front) < 3) return false; }
      else if (s - dm.back - (pos + e.c.front) < 3 + e.c.v + (e.c.v * e.c.v) / 5) return false;
    }
    return true;
  }

  private pickW(list: Lot[], w: (l: Lot) => number) {
    let tot = 0;
    for (const l of list) tot += w(l);
    let x = this.rand() * tot;
    for (const l of list) { x -= w(l); if (x <= 0) return l; }
    return list[list.length - 1];
  }

  // Start trips to keep the roads as busy as the time of day and the city's size call for.
  generate(places: Places, hour: number, level: number, now: number) {
    const people = places.homes.reduce((t, l) => t + places.weight(l), 0);
    const target = Math.min(MAX - 20, Math.round((people / 16) * demand(hour) * level));
    let live = 0;
    for (const c of this.cars) if (c.gone === undefined) live++;
    if (live >= target || !places.homes.length) return;
    const r = this.rand();
    const morning = hour >= 6 && hour < 10, evening = hour >= 15.5 && hour < 19.5;
    const at = (l: Lot | undefined) => (l ? this.accessOf(l) : null);
    const home = () => at(this.pickW(places.homes, places.weight));
    const job = () => at(places.jobs.length ? this.pickW(places.jobs, places.weight) : undefined);
    const shopA = () => at(places.shops.length ? this.pickW(places.shops, () => 1) : undefined);
    const works = () => at(places.works.length ? this.pickW(places.works, () => 1) : undefined);
    const edge = () => { const e = this.edges(); return e.length ? e[Math.floor(this.rand() * e.length)] : null; };
    const edgeTo = () => { const e = this.edges(true); return e.length ? e[Math.floor(this.rand() * e.length)] : null; };
    let o: Access | null, d: Access | null, lorry = false;
    if (r < 0.12) { lorry = true; o = works() ?? edge(); d = this.rand() < 0.5 ? shopA() ?? edgeTo() : edgeTo() ?? works(); }
    else if (r < 0.22) { const inbound = this.rand() < 0.5; o = inbound ? edge() : home(); d = inbound ? job() : edgeTo(); }
    else if (morning) { o = home(); d = this.rand() < 0.85 ? job() : shopA(); }
    else if (evening) { o = this.rand() < 0.85 ? job() : shopA(); d = home(); }
    else { const out = this.rand() < 0.5; o = out ? home() : shopA() ?? job(); d = out ? shopA() ?? job() : home(); }
    if (o && d && !(o.seg.id === d.seg.id && Math.abs(o.s - d.s) < 8)) this.spawn(o, d, lorry, now);
  }

  // A bus that tours the network, calling at every stop on its side of the road: one of the
  // player's, in the company livery with a fleet number (offer: which model, from the Vehicles panel).
  // On a line, it starts on the road of that call's stop if there's room, else nearby.
  // `leg`: which of the line's calls it starts at (so a line's buses spread out along it).
  addBus(offer?: string, line?: BusLine, leg = 0): Car | undefined {
    const segs = [...this.net.segs.values()].filter((s) => this.net.def(s).cls === 'road' && this.net.def(s).family !== 'Motorway');
    if (line?.seq.length) leg %= line.seq.length;
    const first = line?.seq.length ? this.place(line.seq[leg]) : null;
    const near = first ? segs.filter((s) => s !== first.seg && [s.a, s.b].some((n) => n === first.seg.a || n === first.seg.b)) : [];
    let dm: Dressed | undefined;
    for (let tries = 0; tries < 30 && segs.length; tries++) {
      const pick = first && tries < 4 ? first.seg : near.length && tries < 16 ? near[Math.floor(this.rand() * near.length)] : segs[Math.floor(this.rand() * segs.length)];
      const seg = pick, from = seg.oneway ? seg.a : first && tries < 4 ? (tries % 2 ? seg.b : seg.a) : this.rand() < 0.5 ? seg.a : seg.b;
      const bd = (dm ??= this.fleet.dressBus(offer));
      const lo = this.startGuard(seg, from) + bd.back, hi = this.endGuard(seg, from) - bd.front;
      if (hi < lo) continue;
      const s = lo + this.rand() * (hi - lo), lane = this.net.def(seg).bus ? BUSLANE : 0;
      if (!this.canPlace(seg, from, s, lane, bd)) continue;
      bd.dress.lampAt = (this.rand() - 0.5) * 0.7;
      const c: Car = {
        id: this.ids++, kind: 'bus', front: bd.front, back: bd.back, seg, from, s, v: 0, vmax: 11, route: [], goal: Infinity, lorry: false, bus: true,
        heading: 0, born: this.clock, wait: 0, lane: 0, off: this.laneOff(seg, from, s, lane), uref: [], cls: bd.cls, hw: bd.hw, dress: bd.dress,
        line, leg,
      };
      this.cars.push(c);
      c.entry = this.put(keyOf(seg, from, lane), c, s, 0, true);
      return c;
    }
    return undefined;
  }
  private nextStop(c: Car) {
    const L = this.len(c.seg), side = c.from === c.seg.a ? 1 : -1, call = c.line ? this.callOf(c) : null;
    if (c.line && call?.seg !== c.seg) return null;
    let best: { st: Stop; at: number } | null = null;
    for (const st of c.seg.stops) {
      if (st.side !== side || st.id === c.served || (call && !call.stops.includes(st))) continue;
      const at = side === 1 ? st.s : L - st.s;
      if (at > c.s - 1 && (!best || at < best.at)) best = { st, at };
    }
    return best;
  }

  // ---------- bus lines ----------
  // A line's call: the stop, and any stop facing it across the road (within a lay-by's length),
  // found again after roads are rebuilt (a stop keeps its id when its road is split).
  place(id: number): Place | null {
    const had = this.placeC.get(id);
    if (had !== undefined && (!had || (this.net.segs.get(had.seg.id) === had.seg && had.seg.stops.includes(had.stops[0])))) return had;
    let p: Place | null = null;
    for (const seg of this.net.segs.values()) {
      const st = seg.stops.find((x) => x.id === id);
      if (st) { p = { key: id, seg, stops: [st, ...seg.stops.filter((x) => x !== st && x.side !== st.side && Math.abs(x.s - st.s) < 45)] }; break; }
    }
    this.placeC.set(id, p);
    return p;
  }
  private callOf(c: Car) { const q = c.line!.seq; return q.length ? this.place(q[(c.leg ?? 0) % q.length]) : null; }
  // done at a stop: on to the line's next call (and a fresh way there, unless already turning)
  private called(c: Car) {
    if (!c.line) return;
    const call = this.callOf(c);
    if (call && call.seg === c.seg && !call.stops.some((st) => st.id === c.served)) return;
    c.leg = ((c.leg ?? 0) + 1) % Math.max(1, c.line.seq.length);
    if (!c.turn && c.adm === undefined) { c.nextSeg = undefined; c.plan = undefined; }
  }
  // The next road for a bus on a line at the end of the road it's on: the first of the shortest
  // way to its next call, arriving on the stop's side of the road. It never turns back at a
  // junction, only at a dead end. Undefined when there's no way (the call is skipped).
  private lineNext(c: Car, at: number): RSeg | undefined {
    const q = c.line!.seq, L0 = this.len(c.seg), dir = c.from === c.seg.a ? 1 : -1;
    for (let tries = 0; tries < q.length; tries++) {
      let call = this.callOf(c);
      // (a call still ahead on this road is made before the junction: route on to the one after)
      const ahead = call && call.seg === c.seg && call.stops.some((st) => st.side === dir && st.id !== c.served && (dir === 1 ? st.s : L0 - st.s) > c.s - 1);
      if (ahead) call = this.place(q[((c.leg ?? 0) + 1) % q.length]);
      if (call) {
        const key = `${at}:${c.seg.id}:${call.key}`;
        let id = this.lineC.get(key);
        if (id === undefined) this.lineC.set(key, (id = this.wayTo(at, c.seg, call)));
        const seg = id >= 0 ? this.net.segs.get(id) : undefined;
        if (seg) return seg;
      }
      if (ahead) return undefined;
      c.leg = ((c.leg ?? 0) + 1) % q.length; // no way there: skip it
    }
    return undefined;
  }
  // shortest way on, by road and direction (so a turn back is only ever at a dead end): the
  // first road's id, or -1
  private wayTo(at: number, seg0: RSeg, call: Place): number { return this.search2(at, seg0, call)?.[0]?.seg.id ?? -1; }
  // the roads, each with the end it's driven from, then where on the last the stop is
  private search2(at: number, seg0: RSeg, call: Place): { seg: RSeg; from: number }[] | null {
    const g = this.adj(), ok = (s: RSeg) => this.net.def(s).family !== 'Motorway';
    const leave = (node: number, via: RSeg) => { const o = (g.get(node) ?? []).filter((e) => e.seg !== via && ok(e.seg)); return o.length ? o : (g.get(node) ?? []).filter((e) => e.seg === via); };
    // state: a road driven from one end, keyed seg*2 + (from its b end); its cost is at its far end
    type E = { seg: RSeg; to: number; len: number };
    const dist = new Map<number, number>(), prev = new Map<number, number>(), open = new Set<number>(), edge = new Map<number, E>();
    const push = (e: E, cost: number, from: number) => {
      const k = e.seg.id * 2 + (e.to === e.seg.a ? 1 : 0);
      if (cost < (dist.get(k) ?? Infinity)) { dist.set(k, cost); prev.set(k, from); edge.set(k, e); open.add(k); }
    };
    for (const e of leave(at, seg0)) push(e, e.len, -1);
    let best = Infinity, bestK = -1;
    const T = call.seg, LT = this.len(T);
    while (open.size) {
      let k = -1, dk = Infinity;
      for (const n of open) { const v = dist.get(n)!; if (v < dk) { dk = v; k = n; } }
      open.delete(k);
      if (dk >= best) break;
      const e = edge.get(k)!, start = dk - e.len, fromA = e.to === e.seg.b;
      if (e.seg === T) for (const st of call.stops) if ((st.side === 1) === fromA) {
        const c = start + (fromA ? st.s : LT - st.s);
        if (c < best) { best = c; bestK = k; }
      }
      for (const n of leave(e.to, e.seg)) push(n, dk + n.len, k);
    }
    if (bestK < 0) return null;
    const out: { seg: RSeg; from: number }[] = [];
    for (let k = bestK; k >= 0; k = prev.get(k)!) { const e = edge.get(k)!; out.unshift({ seg: e.seg, from: this.net.other(e.seg, e.to) }); }
    return out;
  }
  // The way a line's buses go, for drawing: for each leg, runs of road (a seg, the end it's driven
  // from, and from where to where along it in that direction).
  lineRoute(seq: number[]): { seg: RSeg; from: number; s0: number; s1: number }[][] {
    const legs: { seg: RSeg; from: number; s0: number; s1: number }[][] = [];
    if (seq.length < 2) return legs;
    const along = (seg: RSeg, from: number, st: Stop) => (from === seg.a ? st.s : this.len(seg) - st.s);
    let here = this.place(seq[0]), st = here?.stops[0];
    let from = here && st ? (st.side === 1 ? here.seg.a : here.seg.b) : 0;
    for (let i = 1; i <= seq.length && here && st; i++) {
      const next = this.place(seq[i % seq.length]);
      if (!next) break;
      const s0 = along(here.seg, from, st), leg: { seg: RSeg; from: number; s0: number; s1: number }[] = [];
      const dir = from === here.seg.a ? 1 : -1;
      const onSame = next.seg === here.seg ? next.stops.find((x) => x.side === dir && along(here!.seg, from, x) > s0 + 1) : undefined;
      if (onSame) { leg.push({ seg: here.seg, from, s0, s1: along(here.seg, from, onSame) }); st = onSame; }
      else {
        const way = this.search2(this.net.other(here.seg, from), here.seg, next);
        if (!way) { legs.push(leg); here = next; st = next.stops[0]; from = st.side === 1 ? next.seg.a : next.seg.b; continue; }
        leg.push({ seg: here.seg, from, s0, s1: this.len(here.seg) });
        way.forEach((w, j) => {
          const L = this.len(w.seg);
          if (j < way.length - 1) { leg.push({ seg: w.seg, from: w.from, s0: 0, s1: L }); return; }
          const dirW = w.from === w.seg.a ? 1 : -1, end = next.stops.find((x) => x.side === dirW) ?? next.stops[0];
          leg.push({ seg: w.seg, from: w.from, s0: 0, s1: along(w.seg, w.from, end) }); st = end; from = w.from;
        });
      }
      legs.push(leg);
      here = next;
    }
    return legs;
  }
  // put a bus on a line (or take it off one, with null): it heads for the line's first call
  setBusLine(id: number, line: BusLine | null) {
    const c = this.cars.find((x) => x.id === id && x.bus);
    if (!c) return;
    c.line = line ?? undefined; c.leg = 0;
    if (!c.turn && c.adm === undefined) { c.nextSeg = undefined; c.plan = undefined; }
  }
  // take a bus off the roads (sold): it goes as soon as it isn't in a junction
  removeBus(id: number) { const c = this.cars.find((x) => x.id === id && x.bus); if (c) c.sold = true; }
  busesOn(line: number) { return this.cars.filter((c) => c.bus && c.gone === undefined && !c.sold && c.line?.id === line).map((c) => c.id); }
  // what a bus is doing, for its info sheet
  bus(id: number) {
    const c = this.cars.find((x) => x.id === id && x.bus && x.gone === undefined);
    if (!c) return null;
    const call = c.line ? this.callOf(c) : null;
    return { id: c.id, line: c.line?.id, fleetNo: c.dress?.fleetNo ?? '', model: c.dress?.chain[0]?.name ?? '', next: call?.key, dwelling: c.dwell !== undefined, speed: c.v, x: c.pose?.x ?? 0, z: c.pose?.z ?? 0 };
  }
  // the bus nearest a point on the ground, within r metres
  busNear(p: P, r = 7) {
    let best: Car | null = null, bd = r;
    for (const c of this.cars) {
      if (!c.bus || c.gone !== undefined || !c.pose) continue;
      const d = Math.hypot(c.pose.x - p.x, c.pose.z - p.z) - (c.front + c.back) / 4;
      if (d < bd) { bd = d; best = c; }
    }
    return best?.id ?? null;
  }

  // ---------- lanes: who is where ----------
  private put(key: number, c: Car, pos: number, kind: number, sorted = false): Entry {
    const pool = (c.ents ??= []), i = (c.ne = (c.ne ?? 0) + 1) - 1;
    let e = pool[i];
    if (!e) pool.push((e = { c, pos, kind }));
    else { e.pos = pos; e.kind = kind; }
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = []));
    if (!sorted) b.push(e);
    else b.splice(this.above(b, pos), 0, e);
    return e;
  }
  private above(b: Entry[], pos: number) {
    let lo = 0, hi = b.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b[m].pos <= pos) lo = m + 1; else hi = m; }
    return lo;
  }
  // The vehicle in a lane whose tail is nearest ahead of `pos` (not simply the next one along:
  // a lorry's tail can be well behind that of a car level with it), and the one whose nose is
  // nearest behind. Neither counts `self` (nor, with `lets`, anyone asking to be let in whom `lets` won't let in).
  private aheadIn(b: Entry[] | undefined, pos: number, self: Car, skip?: (e: Entry) => boolean, lets?: Car) {
    if (!b) return undefined;
    let best: Entry | undefined, rear = Infinity;
    for (let i = this.above(b, pos); i < b.length; i++) {
      const e = b[i];
      if (e.pos - LONGEST > rear) break;
      if (e.c === self || skip?.(e) || (lets && e.kind === 4 && !this.letsIn(lets, e, pos))) continue;
      if (e.pos - e.c.back < rear) { rear = e.pos - e.c.back; best = e; }
    }
    return best;
  }
  private behindIn(b: Entry[] | undefined, pos: number, self: Car) {
    if (!b) return undefined;
    let best: { e: Entry; pos: number } | undefined, nose = -Infinity;
    for (let i = this.above(b, pos) - 1; i >= 0; i--) {
      const e = b[i];
      if (e.pos + LONGEST < nose) break;
      if (e.c === self) continue;
      // (it may have moved up already this frame)
      const at = e.kind === 0 && e.c.seg === self.seg && e.c.from === self.from && !e.c.turn ? Math.max(e.pos, e.c.s) : e.pos;
      if (at + e.c.front > nose) { nose = at + e.c.front; best = { e, pos: at }; }
    }
    return best;
  }
  private leader(key: number, pos: number, self: Car) { return this.aheadIn(this.buckets.get(key), pos, self); }
  // someone still in the junction, on its way into this lane on a course related to P: the
  // junction's conflict tables settle who goes first between them, not their places in the lane
  private inbound(P: JPath) { return (P.inb ??= (e: Entry) => e.kind === 2 && !!e.c.turn && this.related(e.c.turn.path, P)); }
  private addUser(node: number, c: Car, path: JPath, t: number, adm: number) {
    const pool = (c.users ??= []), i = c.uref.length;
    let u = pool[i];
    if (!u) pool.push((u = { c, path, t, adm, v: c.v }));
    else { u.path = path; u.t = t; u.adm = adm; u.v = c.v; u.rank = undefined; }
    let l = this.users.get(node);
    if (!l) this.users.set(node, (l = []));
    l.push(u);
    c.uref.push(u);
    return u;
  }
  // vehicles committed to a junction that will need room in this lane beyond it
  private commit(key: number, c: Car) {
    let l = this.committed.get(key);
    if (!l) this.committed.set(key, (l = []));
    if (!l.includes(c)) l.push(c);
  }
  // how close to a junction a vehicle starts to take part in it: enough to stop comfortably
  private sphere(c: Car) { return Math.min(260, Math.max(E_IN + 6, 15 + c.v * 1.5 + (c.v * c.v) / 4)); }
  private horizon(c: Car) { return Math.min(250, 25 + c.v * 1.5 + (c.v * c.v) / 4); }

  // Every frame: which vehicles are in which lane, in order, and who is in or near each junction.
  private index() {
    // (the lists are kept and emptied rather than made afresh every frame)
    for (const b of this.buckets.values()) b.length = 0;
    for (const l of this.users.values()) l.length = 0;
    for (const l of this.committed.values()) l.length = 0;
    for (const l of this.claims.values()) l.length = 0;
    this.appr.clear();
    for (const c of this.cars) { c.uref.length = 0; c.entry = undefined; c.ne = 0; }
    for (const c of this.cars) {
      if (c.turn) {
        const T = c.turn, P = T.path;
        this.addUser(P.node, c, P, T.t, c.adm ?? Infinity);
        // its tail is still in the lane it came from; its nose is already in the one it's going to
        if (P.leave ? T.t < this.slipFor(P, clsOf(c))[0] : T.t - P.ext0 < c.back + 1) this.put(P.inKey, c, P.lineS + (T.t - P.ext0), 1);
        if (P.gate === undefined ? P.ext1 - T.t < E_OUT + 8 : c.merged) this.put(P.exitKey, c, P.outS - (P.ext1 - T.t), 2);
        if (c.gone === undefined) this.commit(P.exitKey, c);
        continue;
      }
      if (c.inBay) { c.entry = this.put(keyOf(c.seg, c.from, BAYLANE), c, c.s, 0); continue; }
      c.entry = this.put(keyOf(c.seg, c.from, this.laneIdx(c)), c, c.s, 0);
      if (c.gone !== undefined) continue;
      if (c.oldLane !== undefined) this.put(keyOf(c.seg, c.from, c.oldLane), c, c.s, 3);
      // a bus turning round at a dead end is across every lane, both ways, until it's straightened up
      if (c.uturn) {
        if (Math.abs(c.off - this.laneOff(c.seg, c.from, c.s, this.laneIdx(c))) < 1 && Math.abs(this.rearOff(c) - this.laneOff(c.seg, c.from, c.s, this.laneIdx(c))) < 1) c.uturn = false;
        else for (const [from, pos] of [[c.from, c.s], [this.net.other(c.seg, c.from), this.len(c.seg) - c.s]]) for (const l of [...Array(this.net.def(c.seg).lanes).keys(), BUSLANE]) if (from !== c.from || l !== this.laneIdx(c)) this.put(keyOf(c.seg, from, l), c, pos, 3);
      }
      if (c.merge !== undefined) this.put(keyOf(c.seg, c.from, c.merge), c, c.s, 4);
      if (c.after) {
        // (still on the course it came out of the junction on, unless it has moved over since)
        const P = c.after.path, t = P.ext1 + (c.s - P.outS);
        if (c.seg.id === P.next && t <= P.track.len && this.laneIdx(c) === P.exitLane && c.oldLane === undefined) this.addUser(P.node, c, P, t, c.after.adm);
        else c.after = undefined;
      }
      const pl = this.planOf(c);
      if (pl && !pl.wrong && pl.path.lineS - c.s <= this.sphere(c)) {
        const adm = c.admNode === pl.node ? c.adm ?? Infinity : Infinity;
        this.addUser(pl.node, c, pl.path, pl.path.ext0 - (pl.path.lineS - c.s), adm);
        if (adm < Infinity) this.commit(pl.path.exitKey, c);
        else if ((c.roomWait ?? 0) > CLAIM) { let l = this.claims.get(pl.path.exitKey); if (!l) this.claims.set(pl.path.exitKey, (l = [])); l.push(c); }
      }
    }
    for (const b of this.buckets.values()) b.sort((x, y) => x.pos - y.pos);
  }

  // ---------- junctions ----------
  private jdata(node: number): JData | null {
    const j = this.junctions.get(node) ?? null;
    let jd = this.jd.get(node);
    if (!jd || jd.j !== j) {
      // a plain join only counts where the road bends enough to be driven round a curve
      const live = j ? j.form !== 'join' : !!this.bendAt(node);
      jd = { node, j, live, legs: live ? this.legs(node) : [], paths: new Map() };
      this.jd.set(node, jd);
    }
    return jd.live ? jd : null;
  }
  // how far from the junction centre traffic stops, and where it rejoins the road beyond
  private reachOf(j: Junction, node: number, seg: RSeg) {
    if (j.form === 'join') return 0;
    const core = j.form === 'roundabout' || j.form === 'mini' ? j.R + 1.5 : this.nodeHalf(node) + 1;
    return Math.max(core, j.reach[seg.id] ?? 0);
  }
  private signal(j: Junction, now: number) {
    let s = this.sig.get(j.node);
    if (!s || s.j !== j) {
      const legs = this.legs(j.node), ids = legs.map((l) => l.seg.id);
      const phases = legs.length === 3 ? [j.major, ids.filter((id) => !j.major.includes(id))] : [ids.filter((_, i) => i % 2 === 0), ids.filter((_, i) => i % 2 === 1)];
      // green time in proportion to the busiest approach in each phase
      const load = phases.map((ph) => Math.max(1, ...ph.map((id) => Object.entries(j.flows).filter(([k]) => k.startsWith(`${id}>`)).reduce((t, [, v]) => t + v, 0))));
      const tot = load.reduce((t, v) => t + v, 0);
      s = { j, phases, greens: load.map((v) => 8 + (40 * v) / tot), t0: now };
      this.sig.set(j.node, s);
    }
    // each phase: green, amber, then a moment of red all round so the junction can clear
    const cyc = s.greens.reduce((t, g) => t + g + AMBER + ALLRED, 0);
    let t = ((((now - s.t0) / 1000) % cyc) + cyc) % cyc;
    for (let i = 0; i < s.phases.length; i++) {
      if (t < s.greens[i]) return { phase: i, state: 'green' as const, phases: s.phases };
      t -= s.greens[i];
      if (t < AMBER) return { phase: i, state: 'amber' as const, phases: s.phases };
      t -= AMBER;
      if (t < ALLRED) return { phase: i, state: 'red' as const, phases: s.phases };
      t -= ALLRED;
    }
    return { phase: 0, state: 'red' as const, phases: s.phases };
  }
  // what a signal head on this approach shows now (for drawing)
  lightFor(node: number, seg: number, now: number): 'red' | 'amber' | 'green' {
    const j = this.junctions.get(node);
    if (!j || j.form !== 'signals') return 'red';
    const st = this.signal(j, now);
    return st.phases[st.phase].includes(seg) && st.state !== 'red' ? st.state : 'red';
  }
  // at amber, a driver who can stop comfortably before the line does
  private stopsForAmber(c: Car, P: JPath) { return P.lineS - c.s - c.front > (c.v * c.v) / 7 + 1; }
  private greenFor(j: Junction, seg: number, now: number) {
    const st = this.signal(j, now);
    return st.state !== 'red' && st.phases[st.phase].includes(seg);
  }
  // Who gives way to whom: lower goes first. On a roundabout everyone entering gives way to the ring.
  private rankOf(j: Junction | null, inSeg: number, mv: Move, slip: boolean) {
    if (slip || !j) return 0;
    if (j.form === 'signals') return mv === 'R' ? 1 : 0;
    if (j.form === 'priority' || j.form === 'merge') return j.major.includes(inSeg) ? (mv === 'R' ? 1 : 0) : mv === 'R' ? 3 : 2;
    if (j.form === 'diverge') return 0; // (one road in: its lanes carry straight on, a slip road peels off the nearside)
    return 2;
  }
  // which exit lane a movement ends in: left turners keep left, right turners go to the offside
  private exitLaneOf(j: Junction, seg: RSeg, lane: number, next: RSeg, mv: Move, bus: boolean) {
    const nd = this.net.def(next), n = nd.lanes;
    if (bus && nd.bus) return BUSLANE;
    if (lane === BUSLANE || bus) return 0; // buses keep to the nearside, for their stops
    const marks = j.lanes[seg.id];
    const allowed = marks ? marks.map((m, i) => (m.includes(mv) ? i : -1)).filter((i) => i >= 0) : [];
    const k = Math.max(0, allowed.indexOf(lane));
    const out = mv === 'L' ? k : mv === 'R' ? n - Math.max(1, allowed.length) + k : lane;
    return Math.max(0, Math.min(n - 1, out));
  }
  // lanes marked for where this vehicle is going (a slip road is reached from the nearside lane)
  private allowedLanes(pl: Plan, c: Car) {
    const j = pl.jd.j;
    if (!j) return [];
    if (j.slip && j.slip.from === c.seg.id && j.slip.to === pl.next.id) return [0];
    const marks = j.lanes[c.seg.id];
    return marks ? marks.map((m, i) => (m.includes(pl.path.move) ? i : -1)).filter((i) => i >= 0) : [];
  }

  // The course through a junction, from this lane to the exit lane: a curve, or round the island.
  private turnPts(j: Junction, node: number, seg: RSeg, from: number, lane: number, next: RSeg, exitLane: number, lineS: number, outS: number): P[] {
    const n = this.net.node(node), y = n.y;
    const a = pointAt(this.pathOf(seg, from), lineS), A = this.lanePoint(seg, from, lineS, lane);
    const b = pointAt(this.pathOf(next, node), outS), B = this.lanePoint(next, node, outS, exitLane);
    const pts: P[] = [A];
    const bez = (p0: P, d0: { x: number; z: number }, p3: P, d3: { x: number; z: number }, k: number, steps: number) => {
      const c1 = { x: p0.x + d0.x * k, z: p0.z + d0.z * k }, c2 = { x: p3.x - d3.x * k, z: p3.z - d3.z * k };
      for (let i = 1; i < steps; i++) {
        const t = i / steps, u = 1 - t;
        pts.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x, z: u * u * u * p0.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * p3.z, y });
      }
    };
    if (j.form === 'roundabout' || j.form === 'mini') {
      // round the island (increasing angle keeps it on our right), easing on to and off the ring
      const multi = this.net.def(seg).lanes > 1 && lane > 0 && lane !== BUSLANE;
      const rr = Math.max(3.5, j.R - (multi ? 6.5 : 2.6));
      const t0 = Math.atan2(A.z - n.z, A.x - n.x);
      let t1 = Math.atan2(B.z - n.z, B.x - n.x);
      while (t1 <= t0 + 0.3) t1 += Math.PI * 2;
      const ease = Math.min(0.55, (t1 - t0) / 3), r0 = t0 + ease, r1 = t1 - ease;
      const ring = (t: number): P => ({ x: n.x + Math.cos(t) * rr, z: n.z + Math.sin(t) * rr, y });
      const tan = (t: number) => ({ x: -Math.sin(t), z: Math.cos(t) });
      const R0 = ring(r0), R1 = ring(r1);
      bez(A, { x: a.ux, z: a.uz }, R0, tan(r0), Math.hypot(R0.x - A.x, R0.z - A.z) * 0.4, 6);
      const steps = Math.max(1, Math.ceil((r1 - r0) / 0.12));
      for (let i = 0; i <= steps; i++) pts.push(ring(r0 + ((r1 - r0) * i) / steps));
      bez(R1, tan(r1), B, { x: b.ux, z: b.uz }, Math.hypot(B.x - R1.x, B.z - R1.z) * 0.4, 6);
    } else {
      // a smooth curve whose ends follow the lanes it joins
      bez(A, { x: a.ux, z: a.uz }, B, { x: b.ux, z: b.uz }, Math.hypot(B.x - A.x, B.z - A.z) * 0.45, 12);
    }
    pts.push(B);
    return pts;
  }
  // Round a bend: every lane runs round the same centre as the drawn road, easing from one road's
  // lane to the other's (which may be a different width).
  private bendPts(X: { x: number; z: number }, seg: RSeg, from: number, lane: number, lineS: number, next: RSeg, node: number, exitLane: number, outS: number): P[] {
    const a = pointAt(this.pathOf(seg, from), lineS), b = pointAt(this.pathOf(next, node), outS);
    // signed radii of the lane at either end: the side of X each road's point is on, plus the lane
    const la = { x: a.uz, z: -a.ux }, lb = { x: b.uz, z: -b.ux }; // left of travel on each road
    const oa = this.laneOff(seg, from, lineS, lane), ob = this.laneOff(next, node, outS, exitLane);
    const ra = Math.hypot(a.x - X.x, a.z - X.z), rb = Math.hypot(b.x - X.x, b.z - X.z);
    const sa = Math.sign((a.x - X.x) * la.x + (a.z - X.z) * la.z) || 1, sb = Math.sign((b.x - X.x) * lb.x + (b.z - X.z) * lb.z) || 1;
    const pa = ra + sa * oa, pb = rb + sb * ob;
    const fa = Math.atan2(a.z - X.z, a.x - X.x);
    let da = Math.atan2(b.z - X.z, b.x - X.x) - fa;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const N = Math.max(4, Math.ceil(Math.abs(da) / 0.06));
    const pts: P[] = [];
    for (let k = 0; k <= N; k++) {
      const f = fa + (da * k) / N, r = pa + ((pb - pa) * k) / N;
      pts.push({ x: X.x + Math.cos(f) * r, z: X.z + Math.sin(f) * r, y: a.y + ((b.y - a.y) * k) / N });
    }
    pts[0] = this.lanePoint(seg, from, lineS, lane);
    pts[N] = this.lanePoint(next, node, outS, exitLane);
    return pts;
  }
  private pathFor(jd: JData, seg: RSeg, from: number, lane: number, next: RSeg, slip: boolean, bus: boolean): JPath | null {
    const key = `${seg.id}:${lane}>${next.id}:${slip ? 1 : 0}:${bus ? 1 : 0}`;
    const had = jd.paths.get(key);
    if (had) return had;
    const j = jd.j, node = jd.node, y = this.net.node(node).y;
    const inLeg = jd.legs.find((l) => l.seg.id === seg.id), outLeg = jd.legs.find((l) => l.seg.id === next.id);
    if (!inLeg || !outLeg || inLeg === outLeg) return null;
    // (at a merge or diverge the slip road is only ever reached from the nearside lane, along its course)
    if (!slip && this.slipOnly(j, seg, next)) return null;
    const move = j ? moveOf(inLeg, outLeg) : 'S';
    const exitLane = j ? this.exitLaneOf(j, seg, lane, next, move, bus) : this.mapLane(next, node, lane);
    const L = this.len(seg), Lo = this.len(next);
    let lineS: number, outS: number, turn: P[];
    if (!j) {
      const bend = this.bendAt(node);
      if (!bend) return null;
      lineS = L - (bend.cut.get(seg.id) ?? 0);
      outS = bend.cut.get(next.id) ?? 0;
      turn = this.bendPts(bend.X, seg, from, lane, lineS, next, node, exitLane, outS);
    } else if (slip && j.slip) {
      const sp = j.slip.path;
      lineS = closestOnPath(sp[0], this.pathOf(seg, from)).s;
      outS = closestOnPath(sp[sp.length - 1], this.pathOf(next, node)).s;
      turn = sp.map((p) => ({ x: p.x, z: p.z, y }));
    } else {
      lineS = Math.max(0.5, L - this.reachOf(j, node, seg));
      outS = Math.min(Lo - 0.5, this.reachOf(j, node, next));
      turn = this.turnPts(j, node, seg, from, lane, next, exitLane, lineS, outS);
    }
    // across a junction on a slope, on the plane it's drawn on (its ends are on the roads already)
    const lf = j ? junctionLift(this.net, node, j.shape?.mouth) : null;
    if (lf) turn = turn.map((p, i) => (i === 0 || i === turn.length - 1 ? p : { ...p, y: (p.y ?? y) + lf(p.x, p.z) }));
    // a stretch of the approach before it and of the road beyond
    // (a little further back for the tables than E_IN: a long vehicle held short of its line by one
    // coming out of the junction across its path has to know how far short)
    const pre: P[] = [];
    for (let s = Math.max(0, lineS - E_PRE); s < lineS - 0.3; s += 2) pre.push(this.lanePoint(seg, from, s, lane));
    const post: P[] = [];
    const s1 = Math.min(Lo, outS + E_OUT);
    for (let s = outS + 2; s < s1 - 0.3; s += 2) post.push(this.lanePoint(next, node, s, exitLane));
    post.push(this.lanePoint(next, node, s1, exitLane));
    const track = new Track([...pre, ...turn, ...post]);
    const ext0 = track.cum[pre.length], ext1 = track.cum[pre.length + turn.length - 1];
    // (out of the junction the vehicles' rear axles and trailers start to settle
    // back onto the lane: footprint.ts)
    track.settle = ext1;
    // as fast as each bend allows, slowing comfortably before the tight ones (through a merge or a
    // diverge, where the carriageway runs straight on, as fast as the roads either side)
    const env = new Float32Array(track.n).fill(40);
    const top = j && (j.form === 'merge' || j.form === 'diverge') ? Math.max(15, Math.min(this.net.def(seg).speed, this.net.def(next).speed)) : 15;
    for (let i = 0; i < track.n; i++) {
      const t = i * STEP;
      if (t < ext0 - 2 || t > ext1 + 2) continue;
      const p = track.at(t - 2), q = track.at(t + 2), dh = Math.acos(Math.max(-1, Math.min(1, p.hx * q.hx + p.hz * q.hz)));
      env[i] = Math.max(3.5, Math.min(top, dh > 1e-3 ? Math.sqrt(LAT * (4 / dh)) : top));
    }
    for (let i = track.n - 2; i >= 0; i--) env[i] = Math.min(env[i], Math.sqrt(env[i + 1] ** 2 + 2 * 2 * STEP));
    const P: JPath = {
      track, ext0, ext1, node, inSeg: seg.id, from, lane, next: next.id, exitLane, move, slip, rank: this.rankOf(j, seg.id, move, slip),
      lineS, outS, inKey: keyOf(seg, from, lane), exitKey: keyOf(next, node, exitLane), env,
    };
    if (slip && j) {
      // (a merge or diverge's course runs alongside the lane it joins or leaves for all its length)
      const inPts: P[] = [], outPts: P[] = [], far = Math.max(45, (j.slip?.len ?? 0) + 5);
      for (let s = Math.max(0, lineS - 5); s <= Math.min(L, lineS + far); s += 1) inPts.push(this.lanePoint(seg, from, s, lane));
      for (let s = Math.max(0, outS - far); s <= Math.min(Lo, outS + 5); s += 1) outPts.push(this.lanePoint(next, node, s, exitLane));
      P.leave = []; P.lanes = [inPts, outPts];
      // (leaving the carriageway there's nobody to give way to: the slip road's lane is its own)
      if (j.slip?.kind !== 'diverge') P.gate = [];
    }
    jd.paths.set(key, P);
    return P;
  }
  // where a vehicle of this body on a slip road is clear of the lane it leaves, and where it has
  // to have found a gap in the lane it joins
  private slipFor(P: JPath, k: Cls): [number, number] {
    const lv = P.leave!, gt = P.gate;
    if (lv[k] === undefined) {
      const { track, ext0, ext1 } = P, [inPts, outPts] = P.lanes!;
      lv[k] = ext1;
      for (let t = ext0; t <= ext1; t += 0.5) if (this.clearOfLane2(track, t, k, inPts)) { lv[k] = t; break; }
      if (gt) { gt[k] = ext0; for (let t = ext1; t >= ext0; t -= 0.5) if (this.clearOfLane2(track, t, k, outPts)) { gt[k] = t; break; } }
    }
    return [lv[k], gt?.[k] ?? P.ext0];
  }
  // Is a vehicle of class k at t along a course wholly to one side of a lane's traffic (anything
  // in that lane, of any size, with a little room to spare)?
  private clearOfLane2(track: Track, t: number, k: Cls, lane: P[]) {
    let side = 0;
    for (const r of track.body(k)[Math.max(0, Math.min(track.n - 1, Math.round(t / STEP)))]) {
      for (const [f, w] of [[r.hl, r.hw], [r.hl, -r.hw], [-r.hl, r.hw], [-r.hl, -r.hw]]) {
        const p = { x: r.x + r.hx * f - r.hz * w, z: r.z + r.hz * f + r.hx * w }, c = closestOnPath(p, lane);
        const sd = Math.sign((p.x - c.x) * c.uz - (p.z - c.z) * c.ux) * c.d;
        if (Math.abs(sd) < WIDEST + 0.35 || (side && Math.sign(sd) !== side)) return false;
        side = Math.sign(sd);
      }
    }
    return true;
  }
  // the conflict table between two courses, as seen from `mine`
  private view(mine: JPath, cm: Cls, its: JPath, ci: Cls): View {
    const a = mine.track, b = its.track;
    const meA = a.id < b.id || (a.id === b.id && cm <= ci);
    const [A, ca, B, cb] = meA ? [a, cm, b, ci] : [b, ci, a, cm];
    const k = A.id * 1048576 + B.id, kb = ca * 65536 + cb;
    let byBody = this.tables.get(k);
    if (!byBody) this.tables.set(k, (byBody = new Map()));
    let t = byBody.get(kb);
    if (!t) { const tb = table(A, ca, B, cb); t = { a: new View(tb, true), b: new View(tb, false) }; byBody.set(kb, t); }
    return meA ? t.a : t.b;
  }
  // the vehicle's way through the junction at the end of its road, if there is one
  private planOf(c: Car): Plan | null {
    if (c.turn || c.gone !== undefined || c.inBay || (!c.bus && !c.route.length)) return null;
    // (asked for many times a frame: the one worked out last time, if nothing it depends on has changed)
    const p = c.plan;
    if (p && p.seg === c.seg.id && p.from === c.from && p.lane === (c.bus ? this.laneIdx(c) : c.lane) && p.bus === !!c.bus && c.nextSeg === p.next.id && this.jd.get(p.node) === p.jd && p.jd.j === (this.junctions.get(p.node) ?? null)) return p;
    const at = this.net.other(c.seg, c.from), jd = this.jdata(at);
    if (!jd) return null;
    const next = this.nextOf(c, at);
    if (!next) return null;
    const lane = this.laneIdx(c);
    const slip = !!jd.j?.slip && jd.j.slip.from === c.seg.id && jd.j.slip.to === next.id && lane === 0;
    const q = c.plan, bus = !!c.bus;
    if (q && q.jd === jd && q.seg === c.seg.id && q.from === c.from && q.lane === lane && q.next === next && q.slip === slip && q.bus === bus) return q;
    let path = this.pathFor(jd, c.seg, c.from, lane, next, slip, bus), wrong = false;
    if (!path && !slip && this.slipOnly(jd.j, c.seg, next)) { path = this.pathFor(jd, c.seg, c.from, 0, next, true, bus); wrong = true; }
    if (!path) return null;
    return (c.plan = { seg: c.seg.id, from: c.from, lane, slip, bus, jd, path, node: at, next, wrong });
  }
  private nextOf(c: Car, at: number): RSeg | undefined {
    if (c.nextSeg === undefined || !this.net.segs.has(c.nextSeg)) {
      const ln = c.bus && c.line ? this.lineNext(c, at) : null;
      if (ln) c.nextSeg = ln.id;
      else if (c.bus) {
        // anywhere but back, and not down a road that only leads off the map if there's a choice
        const g = this.adj(), opts = (g.get(at) ?? []).filter((e) => e.seg.id !== c.seg.id && this.net.def(e.seg).family !== 'Motorway');
        const on = opts.filter((e) => (g.get(e.to)?.length ?? 0) > 1);
        // (people: most often a road with a stop on its side, so buses call where people wait)
        const served = on.filter((e) => e.seg.stops.some((st) => st.side === (e.seg.a === at ? 1 : -1)));
        const pick = served.length && this.rand() < 0.75 ? served : on.length ? on : opts;
        c.nextSeg = (pick.length ? pick[Math.floor(this.rand() * pick.length)].seg : c.seg).id;
      } else c.nextSeg = c.route[0];
    }
    const n = c.nextSeg !== undefined ? this.net.segs.get(c.nextSeg) : undefined;
    return n && (n.a === at || n.b === at) ? n : undefined;
  }

  // Precedence between two vehicles in a junction: their places in its order. Each vehicle takes its
  // place when it commits (after everyone it waits for, ahead of anyone it goes before), so it's one
  // order for everybody there and nobody can end up waiting on somebody who is waiting on them.
  private first(x: User, u: User) {
    if (x.adm !== u.adm) return x.adm < u.adm;
    return x.c.id < u.c.id;
  }
  // The limits other vehicles in the junction put on this one: how far along its path it may come.
  private junctionLimits(u: User, ob: Obstacle) {
    const list = this.users.get(u.path.node);
    if (!list) return;
    const me = u.c, cm = clsOf(me);
    for (const x of list) {
      if (x.c === me || !this.related(u.path, x.path)) continue;
      // (nor anyone queued behind us in our lane, whatever their places in the order: they follow us)
      if (x.path.inKey === u.path.inKey && !x.c.turn && !me.turn && x.c.seg === me.seg && x.c.s < me.s) continue;
      if (x.adm === Infinity && u.adm === Infinity) {
        // Neither has a place yet: we still don't draw up into the way of one already waiting at its
        // line to go (a long vehicle's swing reaches back across the lines of the arms beside it), or
        // it could never go, and neither could we
        // (nor into where a long vehicle on its way to the junction will swing: it would have to wait for
        // us to go before it could, and we may be waiting for it)
        const swings = isLong(clsOf(x.c)) && !isLong(cm);
        if ((!this.waitingAt(x) && !swings) || (this.waitingAt(u) && me.wait >= x.c.wait && !swings) || x.path.inSeg === u.path.inSeg) continue;
        const vw = this.view(u.path, cm, x.path, clsOf(x.c));
        if (vw.empty || vw.apart(x.t, u.t)) continue;
        const lim = u.t < vw.limitMe(x.t) ? vw.limitMe(x.t) : vw.nowMe(x.t);
        if (lim < Infinity) ob(lim - u.t, 0, 0.5);
        continue;
      }
      const vw = this.view(u.path, cm, x.path, clsOf(x.c));
      if (vw.empty || vw.apart(x.t, u.t)) continue;
      const limMe = vw.limitMe(x.t), limIt = vw.limitIt(u.t);
      // whoever is already where the other would have to wait goes first; otherwise precedence
      const eIt = x.t >= limIt, eMe = u.t >= limMe;
      if (eIt && eMe) {
        // Each already where the other would have to wait (a long vehicle's swing reaching one standing
        // at its line, say): the one whose turn it is still mustn't drive into where the other is now
        // (or will be a moment on), and if that leaves it stuck behind us, we may move on instead, clear
        // of where it is now.
        if (!this.first(x, u)) { const now = vw.nowMe(x.t, 1 + x.v * 0.5); if (now < Infinity) ob(now - u.t, 0, 0.5); continue; }
        if (vw.nowIt(u.t) - x.t < 0.5) { const now = vw.nowMe(x.t, 1 + x.v * 0.5); if (now < Infinity) ob(now - u.t, 0, 0.5); continue; }
      } else if (!(eIt !== eMe ? eIt : this.first(x, u))) continue;
      const band = movesWith(vw, x.t, limMe);
      ob(limMe - u.t, band ? x.v : 0, 0.5);
    }
  }
  // Where along its lane a vehicle waiting to go stands: at its line, or short of it where the line is
  // inside the swept path of traffic it gives way to (a car's front swings out and a bus's rear cuts in
  // turning into its road), as a give-way line is set back for it. Worked out from the courses through
  // the junction there are so far, for a car's body and a bus's on them.
  private holdAt(pl: Plan, c: Car) {
    const P = pl.path, k = clsOf(c), key = `${k}:${pl.jd.paths.size}`;
    const hc = (P.hold ??= new Map());
    let h = hc.get(k);
    if (!h || h[0] !== key) {
      let lim = Infinity;
      for (const Q of pl.jd.paths.values()) {
        if (Q === P || Q.inSeg === P.inSeg || Q.rank >= P.rank || !this.related(P, Q)) continue;
        for (const q of [0, 2]) { const vw = this.view(P, k, Q, q); if (!vw.empty) lim = Math.min(lim, vw.limitMe(0)); }
      }
      // (as a place along the lane, for the reference point; only where it's short of the line)
      h = [key, lim < P.ext0 ? P.lineS - (P.ext0 - lim) - 0.3 : Infinity];
      hc.set(k, h);
    }
    return h[1];
  }
  // standing at its give-way line, first in the queue, not yet on its way
  private waitingAt(x: User) { const c = x.c; return !c.turn && c.v < 0.3 && x.t <= x.path.ext0 && x.t > x.path.ext0 - c.front - 3; }
  // A slip road only meets the rest of the junction in the lane they both join, where merging and
  // following settle who goes first; its course doesn't also hold the junction's own traffic back.
  private related(a: JPath, b: JPath) { return a.slip === b.slip; }
  // Vehicles on the way in that have priority over whoever is waiting to join (for gap acceptance).
  private approaching(jd: JData, now: number) {
    const node = jd.node;
    let list = this.appr.get(node);
    if (list) return list;
    list = [];
    for (const leg of jd.legs) {
      const seg = leg.seg, from = this.net.other(seg, node), d = this.net.def(seg);
      for (const ln of [...Array(d.lanes).keys(), BUSLANE]) {
        const b = this.buckets.get(keyOf(seg, from, ln));
        if (!b) continue;
        for (let i = b.length - 1; i >= 0; i--) {
          const e = b[i];
          if (e.kind !== 0 || e.c.gone !== undefined || e.c.turn || e.c.seg !== seg) continue;
          const pl = this.planOf(e.c);
          if (!pl || pl.node !== node) continue;
          const dist = pl.path.lineS - e.c.s;
          if (dist > Math.max(40, e.c.v * 8)) break;
          if (e.c.admNode === node) continue; // committed already: it's one of the junction's users
          // (at the lights, not those facing red, nor those who'll stop for the amber)
          if (jd.j?.form === 'signals' && !pl.path.slip && (!this.greenFor(jd.j, seg.id, now) || (this.signal(jd.j, now).state === 'amber' && this.stopsForAmber(e.c, pl.path)))) continue;
          list.push({ c: e.c, path: pl.path, t: pl.path.ext0 - dist, adm: Infinity, v: e.c.v, rank: pl.path.rank });
        }
      }
    }
    this.appr.set(node, list);
    return list;
  }
  // Where we'd be over the next few seconds if we went now: pulling away as briskly as the bends
  // allow, behind whatever is in front of us in our lane, and behind everyone we give way to.
  // Null if that would leave us standing across somebody's way in the junction.
  private trajectory(c: Car, P: JPath, me: User, lead: { gap: number; v: number }, yieldTo: { vw: View; x: User }[], ring: boolean) {
    const a = DRIVE[c.kind].a * 0.8, dt = 0.2, q0 = me.t, out = new Float32Array(61);
    // Where each of them will be. On a roundabout, one already committed and on the move keeps pulling
    // away (gently, up to what its course allows): taken as holding the crawl it's at now, it would look
    // as if it would leave us standing, and a queue would go onto the ring one car at a time with a gap
    // after each. Anyone else is taken to carry on as they are.
    const ahead = yieldTo.map(({ x }) => ({ p: x.t, v: x.v, ax: ring && x.adm !== Infinity && x.v > 0.3 ? DRIVE[x.c.kind].a * 0.5 : 0 }));
    let q = q0, vq = c.v;
    out[0] = q;
    for (let k = 1; k <= 60; k++) {
      let cap = q0 + lead.gap + lead.v * k * dt, moving = lead.v > 0.5;
      for (let i = 0; i < yieldTo.length; i++) {
        const { vw, x } = yieldTo[i], h = ahead[i];
        if (h.ax) h.v = Math.max(h.v, Math.min(spd(x.path, h.p), h.v + h.ax * dt));
        h.p += h.v * dt;
        const p = h.p;
        if (vw.apart(p, q)) continue;
        const lim = vw.limitMe(p);
        if (lim - 0.5 < cap) { cap = lim - 0.5; moving = h.v > 0.5 && movesWith(vw, p, lim); }
      }
      let nv = Math.min(spd(P, q), vq + a * dt);
      if (q + nv * dt > cap) nv = Math.max(0, (cap - q) / dt);
      q += nv * dt; vq = nv;
      out[k] = q;
      // standing still in the junction is only all right queueing behind someone moving with us,
      // and never on a roundabout (once the ring fills up it locks solid)
      if (vq < 0.3 && q > P.ext0 + 0.5 && (!moving || ring)) return null;
    }
    return out;
  }
  // Would x, going along as it is, keep out of our way if we went ahead of it along trajectory q?
  // (It keeps its speed across our path, and eases off gently to follow us where we share a lane;
  // `firm`: it mustn't have to slow at all, as for traffic already going round a roundabout.)
  // (`firm`: one already going round a roundabout, which has priority. A driver pulls out in front
  // of it only by when it would get there, not how far off it is: if it need only ease off (1 m/s²,
  // never brake) to stay 0.6 s behind. One standing on the ring is only in the way if it's right there.)
  private keepsBehind(vw: View, x: User, q: Float32Array, c: Car, firm = false) {
    let p = x.t, vp = x.v, lim = vw.limitIt(q[0]);
    if (p >= lim) return false; // it's already there
    if (firm && vp < 1 && lim - p < 3) return false; // (standing on the ring right by us)
    if (vp > 0.5 && lim - p < (vp * vp) / (2 * 2.5) + 1) return false; // it couldn't stop for us
    const buf = c.lorry || c.bus ? 1.8 : 1.3, dt = 0.2;
    for (let k = 1; k < q.length; k++) {
      const nl = vw.limitIt(q[k]);
      if (nl === Infinity) return true; // we're clear of its course
      const moving = nl - lim > 0.5 * (q[k] - q[k - 1]) && q[k] > q[k - 1];
      lim = nl;
      // (one going round eases off as it comes up to where it would meet us, whether that's behind us
      // in its lane or where we'll cut across it further round)
      if (firm ? lim - p < 3 + 2 * vp : moving && lim - p < 3 + vp) vp = Math.max(0, vp - (firm ? 1 : 1.5) * dt);
      p += vp * dt;
      // (one standing still need only stay where it is: it stopped short of us as it would for anyone)
      if (p > lim - (firm ? 1 + vp * 0.6 : moving ? 0.5 : 0.3 + vp * buf)) return false;
    }
    return true;
  }
  // Is there room in the exit lane for us, after everyone who has claimed room in it before us (all
  // of them, while we haven't committed ourselves)? The claims go in the junction's order, however
  // far off each vehicle was when it committed, so two can't take the last space from two sides.
  private exitRoom(c: Car, P: JPath, yieldToClaims = false) {
    const b = this.buckets.get(P.exitKey);
    let free = 80;
    const e = this.aheadIn(b, P.outS - LONGEST, c, this.inbound(P));
    if (e) {
      // (a vehicle getting away makes room as we come, but only as much as it has in front of it)
      let rear = e.pos - e.c.back - P.outS;
      if (e.c.v > 2) { const f = this.aheadIn(b, e.pos, e.c); rear += Math.min(e.c.v * 2, f ? Math.max(0, f.pos - f.c.back - e.pos - e.c.front - 2) : Infinity); }
      free = Math.min(free, rear);
    }
    const mine = c.admNode === P.node ? c.adm ?? Infinity : Infinity;
    for (const o of this.committed.get(P.exitKey) ?? []) if (o !== c && (o.turn || (o.adm ?? Infinity) < mine)) free -= o.front + o.back + 2;
    // and room is kept for whoever has been waiting at their line for it longer than we have (else a
    // lorry could wait for ever while cars from the other arms take each few metres as they come free;
    // `yieldToClaims`: even though we've committed, as we can still stop)
    if (mine === Infinity || yieldToClaims) for (const o of this.claims.get(P.exitKey) ?? []) if (o !== c && (o.roomWait ?? 0) > (c.roomWait ?? 0)) free -= o.front + o.back + 2;
    return free >= c.front + c.back + 1;
  }
  // A roundabout's ring holds only so many vehicles: nobody else commits while those already
  // committed to it would fill its nearside lane end to end at their true lengths, or it locks solid.
  private ringRoom(c: Car, node: number, j: Junction) {
    let used = c.front + c.back;
    // (counting those on it, and those committed to it who'll be on it within a couple of seconds:
    // one committed far back up its approach may yet find the ring moving again by the time it's there)
    for (const x of this.users.get(node) ?? []) if (x.c !== c && x.adm !== Infinity && x.t < x.path.ext1 && x.t > x.path.ext0 - 3 - 2 * x.v) used += x.c.front + x.c.back + 1;
    return used <= 2 * Math.PI * Math.max(3.5, j.R - 2.6);
  }
  // May this vehicle commit to the junction now? Returns its place in the junction's order, or null
  // to wait.
  private admit(c: Car, pl: Plan, now: number): number | null {
    const P = pl.path, j = pl.jd.j, node = pl.node;
    if (pl.wrong) return this.no(c, 'not in the lane for the slip road');
    if (!j) return this.leaderFirst(c, P, node) ? ++this.admSeq : this.no(c, 'queue'); // a bend: just the queue, in order
    if (!this.leaderFirst(c, P, node)) return this.no(c, 'queue');
    if (j.form === 'signals' && !P.slip) {
      const st = this.signal(j, now), ours = st.phases[st.phase].includes(c.seg.id);
      // a right turner who has waited at the line through the green for a gap in the traffic coming
      // the other way goes as the lights change and that traffic stops
      const clearing = ours && st.state === 'red' && P.rank > 0 && P.lineS - c.s - c.front < 1.5 && c.v < 1;
      if (!clearing && (st.state === 'red' || !ours)) return this.no(c, 'red');
      if (st.state === 'amber' && this.stopsForAmber(c, P)) return this.no(c, 'amber'); // stop if you can
    }
    if (!this.exitRoom(c, P)) return this.no(c, 'no room beyond');
    if ((j.form === 'mini' || j.form === 'roundabout') && !this.ringRoom(c, node, j)) return this.no(c, 'ring full');
    const me = c.uref.find((u) => u.path === P);
    if (!me) return this.no(c, 'not near');
    if (P.rank === 0) return ++this.admSeq;
    // giving way: work out who we'd have to wait for, and whether everyone else could let us go first
    const ld = this.leader(keyOf(c.seg, c.from, this.laneIdx(c)), c.s, c);
    const lead = ld ? { gap: ld.pos - ld.c.back - c.s - c.front - 1, v: ld.c.v } : { gap: Infinity, v: 0 };
    const near = (x: User) => { const vw = this.view(P, clsOf(c), x.path, clsOf(x.c)); return vw.empty || vw.apart(x.t, me.t) ? null : { vw, x }; };
    const inside: { vw: View; x: User }[] = [], outside: { vw: View; x: User }[] = [], yieldTo: { vw: View; x: User }[] = [];
    for (const x of this.users.get(node) ?? []) {
      if (x.c === c || !this.related(P, x.path) || (x.adm === Infinity && x.t < x.path.ext0 - E_IN)) continue;
      // (nor anyone queued behind us in our own lane: they wait for us whatever the table says. Its
      // metre steps are cautious, so a follower of a different length standing its usual couple of
      // metres behind can look as if it's already where it would have to wait for us, and we'd sit
      // waiting for it for ever)
      if (x.path.inKey === P.inKey && !x.c.turn && x.c.seg === c.seg && x.c.s < c.s) continue;
      const o = near(x);
      if (!o) continue;
      if (x.adm !== Infinity) inside.push(o);
      // someone not yet committed who is already in our way (a lorry at its line, say, that our
      // course sweeps past) is in our way until it goes, like anyone we give way to
      else if (x.t >= o.vw.limitIt(me.t)) yieldTo.push(o);
    }
    // (but we don't take a place in the order while one of those stands on our way: it hasn't a place
    // to go ahead of, so everyone after us would wait for us while we wait for it, and it may itself be
    // waiting for one of them; we wait at our line until it has gone)
    const inWay = yieldTo.find((o) => o.x.adm === Infinity && o.vw.nowMe(o.x.t) < Infinity);
    if (inWay && !c.turn) return this.no(c, `waits for #${inWay.x.c.id} to go`);
    // (not those coming up behind us on our own approach: whatever they're doing, they're queued behind us)
    for (const x of this.approaching(pl.jd, now)) { if (x.c !== c && (x.rank ?? 0) < P.rank && x.path.inSeg !== P.inSeg && this.related(P, x.path)) { const o = near(x); if (o) outside.push(o); } }
    const ring = j.form === 'roundabout' || j.form === 'mini';
    for (let it = 0; it < 5; it++) {
      const q = this.trajectory(c, P, me, lead, yieldTo, ring);
      if (!q) return this.no(c, `would be left standing${yieldTo.length ? ` behind #${yieldTo[yieldTo.length - 1].x.c.id}` : ''}`);
      // only commit once we'll be nosing over the line within a few seconds (or standing where we wait
      // to go, which may be short of the line where it's set back out of others' swept paths: holdAt)
      if (q[20] < P.ext0 - c.front + 1 && !(c.v < 0.3 && c.s >= this.holdAt(pl, c) - 0.5)) return this.no(c, 'not moving off yet');
      // vehicles still on their way in have priority: we don't go unless they needn't slow for us
      for (const o of outside) if (!this.keepsBehind(o.vw, o.x, q, c)) return this.no(c, `gives way to #${o.x.c.id}`);
      // (on a roundabout, whoever is already going round has priority: we only go ahead of them
      // if they'd never know we had)
      // (anyone who has to wait for us anyway, because we're already where they'd have to wait for,
      // keeps behind; nobody jumps ahead of someone who has already been waiting a long time, or
      // they could be kept waiting for ever)
      const more = inside.filter((o) => !yieldTo.includes(o) && !(me.t >= o.vw.limitMe(o.x.t) && o.x.t < o.vw.limitIt(me.t)) && (o.x.c.wait > STARVE || !this.keepsBehind(o.vw, o.x, q, c, ring && o.x.t > o.x.path.ext0 + 0.5)));
      if (more.length) { yieldTo.push(...more); continue; }
      // our place in the order: after everyone we wait for, ahead of everyone who'll wait for us
      let lo = -Infinity, hi = Infinity;
      for (const o of inside) if (yieldTo.includes(o)) lo = Math.max(lo, o.x.adm); else hi = Math.min(hi, o.x.adm);
      if (lo === Infinity) return this.no(c, 'no place in the order');
      if (hi === Infinity) return ++this.admSeq;
      if (lo >= hi) return this.no(c, 'no place in the order');
      return lo === -Infinity ? hi - 1 : (lo + hi) / 2;
    }
    return this.no(c, 'too busy');
  }
  private no(c: Car, why: string) { c.why = why; return null; }
  // the queue goes in order: nobody commits ahead of the vehicle in front of them in their lane
  private leaderFirst(c: Car, P: JPath, node: number) {
    const lead = this.leader(keyOf(c.seg, c.from, this.laneIdx(c)), c.s, c);
    return !(lead && lead.kind === 0 && !lead.c.turn && lead.c.admNode !== node && lead.c.seg === c.seg && lead.c.gone === undefined && lead.pos < P.lineS + 0.5);
  }
  private commitTo(c: Car, pl: Plan, adm: number) {
    c.adm = adm; c.admNode = pl.node;
    for (const u of c.uref) if (u.path === pl.path) u.adm = adm;
    this.commit(pl.path.exitKey, c);
  }
  // Standing at the line behind someone earlier in the order who has since stopped short of us: if
  // everyone would now let us go first (as a driver waiting to pull out would judge it afresh), we
  // take a place ahead of them rather than wait for them to come by.
  private readmit(c: Car, pl: Plan, now: number) {
    c.readmit = now;
    const was = c.adm!, why = c.why;
    this.uncommit(c, pl);
    const ok = this.admit(c, pl, now);
    // (at the line, with someone not yet committed standing in our way: we give our place back)
    if (ok === null && !c.turn && c.why?.startsWith('waits for')) return;
    this.commitTo(c, pl, ok !== null && ok < was ? ok : was);
    c.why = why;
  }
  // Committed, but the room beyond has gone (or we've still a lane to change into, or the one in
  // front hasn't a place) and we can still stop: give up our place and wait.
  private uncommit(c: Car, pl: Plan) {
    c.adm = undefined; c.admNode = undefined;
    for (const u of c.uref) if (u.path === pl.path) u.adm = Infinity;
  }

  // ---------- lane changes ----------
  private laneAcc(c: Car, lane: number) {
    const e = this.leader(keyOf(c.seg, c.from, lane), c.s, c), dr = DRIVE[c.kind], v0 = c.v0 ?? c.vmax;
    return e ? idm(c.v, v0, e.pos - e.c.back - c.s - c.front, e.c.v, dr) : idmFree(c.v, v0, dr);
  }
  // A real gap in the next lane: room ahead, and nobody behind who'd have to brake hard for us.
  private canChange(c: Car, to: number, must: boolean) {
    if (to < 0 || to >= this.net.def(c.seg).lanes) return false;
    const sp = this.span(c.seg, c.from, to);
    if (c.s - c.back < sp[0] || c.s + c.front + 8 > sp[1]) return false;
    const b = this.buckets.get(keyOf(c.seg, c.from, to)), dr = DRIVE[c.kind];
    const e = this.aheadIn(b, c.s, c);
    if (e) {
      const g = e.pos - e.c.back - c.s - c.front;
      if (g < 2 + c.v * 0.3 || idm(c.v, c.v0 ?? c.vmax, g, e.c.v, dr) < -(must ? 4 : 2)) return false;
    }
    const r = this.behindIn(b, c.s, c);
    if (r) {
      // (one that has to get across only needs whoever is behind to be able to wait for it: a
      // driver who has stopped to let it in, as close as they'd stop behind anyone, is enough)
      const f = r.e.c, g = c.s - c.back - r.pos - f.front;
      if (g < (must ? 1 : 2) + f.v * 0.4 || idm(f.v, f.v0 ?? f.vmax, g, c.v, DRIVE[f.kind]) < -(must ? 3.5 : 1.5)) return false;
    }
    return true;
  }
  // Does a driver let in someone asking to move into their lane in front of them? Only if they can
  // do it by easing off: one level with them or just ahead has to wait for them to go by instead,
  // so the two never stand side by side waiting for each other.
  // (`at`: where the driver is along the lane, for one still coming out of a junction into it)
  private letsIn(c: Car, e: Entry, at = c.s) {
    const g = e.pos - e.c.back - at - c.front;
    return g > 1 && idm(c.v, c.v0 ?? c.vmax, g, e.c.v, DRIVE[c.kind]) > -3;
  }
  private change(c: Car, to: number, now: number) {
    this.stats.laneChanges++;
    c.oldLane = c.lane;
    c.lane = to;
    c.plan = undefined;
    c.merge = undefined; c.mergeBy = undefined;
    c.adm = undefined; c.admNode = undefined; // a different way through the junction ahead: commit again
    c.lcAt = now + 1500;
    c.lcHold = now + 5000; // no changing back and forth for the sake of it
    if (c.entry) c.entry.kind = 3; // it keeps its place in the old lane until it's across
    c.entry = this.put(keyOf(c.seg, c.from, to), c, c.s, 0, true);
  }
  // How far a lane runs before its way through the junction ahead starts (a slip road leaves the
  // nearside lane well before the junction): lane changes have to be done before then.
  private roomIn(c: Car, lane: number) {
    const L = this.len(c.seg), at = this.net.other(c.seg, c.from), jd = c.route.length || c.bus ? this.jdata(at) : null;
    const next = jd ? this.nextOf(c, at) : undefined;
    if (!jd || !next) return L - c.s;
    const slip = !!jd.j?.slip && jd.j.slip.from === c.seg.id && jd.j.slip.to === next.id && lane === 0;
    const P = this.pathFor(jd, c.seg, c.from, lane, next, slip, !!c.bus);
    return P ? P.lineS - E_IN - c.s : L - c.s;
  }
  private laneChoice(c: Car, pl: Plan | null, now: number) {
    if (c.gone !== undefined || c.inBay || this.laneIdx(c) === BUSLANE) return;
    const n = this.net.def(c.seg).lanes, L = this.len(c.seg);
    // finish moving across before thinking again
    if (c.oldLane !== undefined) {
      // (and its rear too: a long vehicle's trails behind it across the lane it's leaving)
      const want = this.laneOff(c.seg, c.from, c.s, c.lane);
      if (Math.abs(c.off - want) < 1.0 && Math.abs(this.rearOff(c) - want) < 1.0) c.oldLane = undefined;
      else return;
    }
    if (n < 2) { c.merge = undefined; c.mergeBy = undefined; return; }
    if (now < (c.lcAt ?? 0)) return;
    c.lcAt = now + 300 + this.rand() * 300;
    // lanes we have to leave: one that's ending, or one not marked for where we're going. `end`: where
    // a lane that's ending has to be left by; `hard`: where our way through the junction ahead starts
    let want: number | undefined, end = Infinity, hard = Infinity;
    const sp = this.span(c.seg, c.from, c.lane);
    if (sp[1] < L - 0.5 && sp[1] - c.s < 250) { want = c.lane - 1; end = sp[1] - c.front; }
    let allowed: number[] = [];
    if (pl && pl.path.lineS - c.s < 200 && c.keep !== pl.node) {
      allowed = this.allowedLanes(pl, c);
      if (allowed.length && !allowed.includes(c.lane)) {
        const tgt = allowed.reduce((b, i) => (Math.abs(i - c.lane) < Math.abs(b - c.lane) ? i : b), allowed[0]);
        want = tgt > c.lane ? c.lane + 1 : c.lane - 1;
        hard = c.s + Math.min(this.roomIn(c, c.lane), this.roomIn(c, want));
      }
    }
    // (people: a bus with a stop ahead gets into the nearside lane for it, so it pulls up at the kerb)
    if (c.bus && c.lane > 0) {
      const ns = this.nextStop(c), sn = this.span(c.seg, c.from, c.lane - 1);
      if (ns && ns.at - c.s < 250 && sn[0] <= c.s - c.back - 1 && sn[1] >= ns.at + c.front + 1) { want = c.lane - 1; end = Math.min(end, ns.at - 30); }
    }
    if (want !== undefined) {
      // missing the lane for a turn, a driver goes the way their lane goes and finds another way
      // from there; with no other way, they squeeze in right up to where the junction starts
      const turn = hard < Infinity, noWay = !turn || (pl!.noWay ??= !this.rerouteTo(c, pl!));
      const by = Math.min(end, hard - 6), last = Math.min(end, noWay ? hard - 1 : by);
      if (c.s < last && this.canChange(c, want, true)) { this.change(c, want, now); return; }
      if (turn && !noWay && c.s >= by - 3 && this.reroute(c, pl!)) return;
      // (with no other way, and nobody letting us across, we go from the lane we're in in the end)
      if (turn && noWay && end === Infinity && c.wait > KEEP && c.s >= last - 1.5 && !this.slipOnly(pl!.jd.j, c.seg, pl!.next)) { c.keep = pl!.node; c.merge = undefined; c.mergeBy = undefined; return; }
      // (and one that finds itself past even that, say having started out there, turns from the lane it's in)
      if (c.s >= last) { c.merge = undefined; c.mergeBy = undefined; return; }
      // otherwise ask to be let in, and wait for it where we have to be across
      c.merge = last - c.s < 80 ? want : undefined;
      c.mergeBy = noWay ? last : undefined;
      return;
    }
    c.merge = undefined; c.mergeBy = undefined;
    if (c.bus) return; // buses only move over when they have to
    // no changing lanes close to a junction, or just after one
    if ((pl ? pl.path.lineS : L) - c.s < E_IN + 15 || c.s < this.startGuard(c.seg, c.from) + 5) return;
    if (now < (c.lcHold ?? 0)) return;
    // keep left unless there's a reason to pass: move back in once the nearside lane is as good as
    // an open road, pull out only when held up noticeably (lorries stay out of the outside lane)
    const ok = (l: number) => l >= 0 && l < n && (!allowed.length || allowed.includes(l)) && !(c.lorry && l >= 2) && this.roomIn(c, l) > 15;
    const here = this.laneAcc(c, c.lane), open = idmFree(c.v, c.v0 ?? c.vmax, DRIVE[c.kind]);
    if (ok(c.lane - 1) && this.laneAcc(c, c.lane - 1) >= Math.max(here, open) - 0.2 && this.canChange(c, c.lane - 1, false)) this.change(c, c.lane - 1, now);
    else if (ok(c.lane + 1) && here < open - 1 && this.laneAcc(c, c.lane + 1) > here + 0.8 && this.canChange(c, c.lane + 1, false)) this.change(c, c.lane + 1, now);
  }
  // Missed the lane for our turn: take a way this lane does go, and find a new route from there.
  private rerouteTo(c: Car, pl: Plan) {
    const j = pl.jd.j, marks = j?.lanes[c.seg.id]?.[c.lane], inLeg = pl.jd.legs.find((l) => l.seg.id === c.seg.id);
    if (!marks || !inLeg || !c.dest) return null;
    let best: { seg: RSeg; route: number[]; goal: number; entry: number; cost: number } | null = null;
    for (const leg of pl.jd.legs) {
      if (leg === inLeg || !marks.includes(moveOf(inLeg, leg)) || !this.leaves(leg.seg, pl.node) || (c.lane !== 0 && this.slipOnly(j, c.seg, leg.seg))) continue;
      const r = this.planVia(pl.node, leg.seg, c.dest);
      if (r && (!best || r.cost < best.cost)) best = { seg: leg.seg, ...r };
    }
    return best;
  }
  private reroute(c: Car, pl: Plan) {
    const best = this.rerouteTo(c, pl);
    if (!best || !c.dest) return false;
    this.takeRoute(c, best);
    return true;
  }
  private takeRoute(c: Car, r: { seg: RSeg; route: number[]; goal: number; entry: number }) {
    const d = c.dest!, lo = this.startGuard(d.seg, r.entry), hi = this.endGuard(d.seg, r.entry);
    c.nextSeg = r.seg.id; c.route = r.route; c.goal = hi > lo ? Math.max(lo, Math.min(hi, r.goal)) : r.goal;
    c.away = this.offMap(d.seg, r.entry, c.goal);
    c.plan = undefined; c.merge = undefined; c.mergeBy = undefined;
    this.stats.rerouted++;
  }
  // Held at a junction because the road we want is full: another way out of it that has room and
  // doesn't take us far out of our way (a bus just goes somewhere else). Keeps traffic from locking
  // solid round a block when every road in the ring is queued back into the junction before it.
  private divert(c: Car, pl: Plan) {
    const jd = pl.jd, j = jd.j, inLeg = jd.legs.find((l) => l.seg.id === c.seg.id);
    if (!j || !inLeg) return false;
    const lane = this.laneIdx(c), marks = j.lanes[c.seg.id]?.[lane];
    const here = c.dest ? this.planVia(pl.node, pl.next, c.dest)?.cost ?? Infinity : Infinity;
    let best: { seg: RSeg; route: number[]; goal: number; entry: number; cost: number } | null = null;
    for (const leg of jd.legs) {
      const d = this.net.def(leg.seg);
      if (leg === inLeg || leg.seg === pl.next || d.cls !== 'road' || (c.bus && d.family === 'Motorway') || !this.leaves(leg.seg, pl.node)) continue;
      if (marks && !marks.includes(moveOf(inLeg, leg))) continue;
      const slip = !!j.slip && j.slip.from === c.seg.id && j.slip.to === leg.seg.id && lane === 0;
      const P = this.pathFor(jd, c.seg, c.from, lane, leg.seg, slip, !!c.bus);
      if (!P || !this.exitRoom(c, P)) continue;
      if (!c.dest) { c.nextSeg = leg.seg.id; c.plan = undefined; this.stats.rerouted++; return true; }
      const r = this.planVia(pl.node, leg.seg, c.dest);
      if (r && r.cost <= here * 1.5 + 300 && (!best || r.cost < best.cost)) best = { seg: leg.seg, ...r };
    }
    if (!best) return false;
    this.takeRoute(c, best);
    return true;
  }
  // a slip road that's only reached by its own course (a merge or diverge's)
  private slipOnly(j: Junction | null, seg: RSeg, next: RSeg) { return !!j?.slip?.kind && j.slip.from === seg.id && j.slip.to === next.id; }
  // can traffic leave `node` along this road? (not the wrong way up a one-way road)

  private leaves(seg: RSeg, node: number) { return !seg.oneway || seg.a === node; }
  private mapLane(seg: RSeg, from: number, lane: number) {
    if (lane === BUSLANE) return this.net.def(seg).bus ? BUSLANE : 0;
    let l = Math.min(lane, this.net.def(seg).lanes - 1);
    while (l > 0 && this.span(seg, from, l)[0] > 0.5) l--;
    return l;
  }

  // ---------- moving ----------
  update(dt: number, now: number) {
    const net = this.net;
    this.clock = now;
    this.cars = this.cars.filter((c) => !(c.gone !== undefined && now - c.gone > 600) && net.segs.has(c.seg.id) && (!c.turn || net.segs.has(c.turn.next.id)));
    this.index();
    for (const c of this.cars) {
      if (c.gone !== undefined) { if (c.away) c.s += c.v * dt; continue; } // (one leaving the map drives on out as it fades)
      if (c.sold && !c.turn && c.adm === undefined && c.dwell === undefined && !c.inBay) { c.gone = now; continue; }
      if (c.turn) this.stepTurn(c, dt, now);
      else this.stepLane(c, dt, now);
    }
    this.moveTrains(dt);
    this.draw(dt, now);
  }

  // Look along the road from s0 (entering it from `from`, `ahead` metres in front of our centre),
  // on through plain joins, for the first vehicle in our way.
  private onward(c: Car, seg: RSeg, from: number, lane: number, s0: number, ahead: number, ri: number, ob: Obstacle) {
    const hz = this.horizon(c);
    for (let k = 0; k < 6 && ahead < hz; k++) {
      const e = this.aheadIn(this.buckets.get(keyOf(seg, from, lane)), s0 - 1e-6, c);
      if (e) { ob(ahead + e.pos - s0 - e.c.back - c.front, e.c.v); return; }
      const at = this.net.other(seg, from);
      ahead += this.len(seg) - s0;
      if (this.jdata(at)) return; // the next junction: we'll deal with it when we get there
      const nid = c.bus ? undefined : c.route[ri];
      const nx = nid !== undefined ? this.net.segs.get(nid) : undefined;
      if (!nx || (nx.a !== at && nx.b !== at) || nx === seg) return;
      lane = this.mapLane(nx, at, lane); seg = nx; from = at; s0 = 0; ri++;
    }
  }

  private stepLane(c: Car, dt: number, now: number) {
    const net = this.net, L = this.len(c.seg), d = net.def(c.seg), dr = DRIVE[c.kind];
    const last = !c.bus && !c.route.length;
    const at = net.other(c.seg, c.from);
    let v0 = Math.min(c.vmax, d.speed * (c.lorry || c.bus ? 0.8 : 1));
    if (this.speedCap) v0 = Math.min(v0, c.from === c.seg.a ? this.speedCap(c.seg, c.s, 1) : this.speedCap(c.seg, L - c.s, -1)); // a bridge's own limit (game/bridges.ts)
    c.v0 = v0;
    this.laneChoice(c, this.planOf(c), now);
    const pl = this.planOf(c);
    // nowhere to go from here (a bus pulled into a lay-by has no way through the junction until it
    // pulls out again, which isn't the same thing: without this it vanished at its first lay-by)
    if (!last && this.jdata(at) && !pl && !c.inBay) { c.gone = now; this.stats.gaveUp++; return; }
    // commit to the junction ahead when it's our turn; don't go in without room beyond
    let admitted = !!pl && c.admNode === pl.node, hold = false;
    if (pl && pl.path.lineS - c.s <= this.sphere(c)) {
      if (!admitted) {
        // (not while we've still to get into another lane: we'd be holding up everyone after us)
        const ok = c.merge !== undefined ? this.no(c, 'changing lane') : this.admit(c, pl, now);
        const signals = pl.jd.j?.form === 'signals' && !pl.path.slip;
        // at the lights, only once we're too close to stop if they change
        const close = pl.path.lineS - c.s - c.front <= Math.max(2.5, (c.v * c.v) / 6 + c.v * 0.3);
        if (ok !== null && (!signals || close)) { this.commitTo(c, pl, ok); admitted = true; }
        else if (ok === null) hold = true;
        // standing at the line with the road beyond full: after a while, try another way out
        if (ok === null && c.why === 'no room beyond' && c.v < 0.5 && pl.path.lineS - c.s - c.front < 4) {
          c.roomWait = (c.roomWait ?? 0) + dt;
          if (c.roomWait > DIVERT && now - (c.divertAt ?? 0) > 2000) { c.divertAt = now; if (this.divert(c, pl)) { c.roomWait = 0; return; } }
        } else c.roomWait = 0;
      } else if (pl.jd.j && pl.path.lineS - c.s - c.front > (c.v * c.v) / 6 + 0.5 && (c.merge !== undefined || !this.leaderFirst(c, pl.path, pl.node) || !this.exitRoom(c, pl.path, true))) {
        // (nor ahead of the one in front of us, if it has given its place back or pulled in ahead of us)
        this.uncommit(c, pl); admitted = false; hold = true;
      } else if (pl.jd.j && c.v < 0.5 && pl.path.lineS - c.s - c.front < 3 && now - (c.readmit ?? 0) > 500) {
        this.readmit(c, pl, now);
        if (c.admNode !== pl.node) { admitted = false; hold = true; } // (it gave its place back: it waits at the line)
      }
    }
    if (pl) v0 = Math.min(v0, Math.sqrt(spd(pl.path, pl.path.ext0) ** 2 + 4 * Math.max(0, pl.path.lineS - c.s)));
    // everything in the way, as the gentlest acceleration that respects all of it
    let acc = idmFree(c.v, v0, dr), gmin = Infinity;
    const ob: Obstacle = (g, vl, s0 = dr.s0) => { acc = Math.min(acc, follow(c.v, v0, g, vl, dr, s0)); gmin = Math.min(gmin, g); };
    const still = c.bus ? this.busStops(c, dt, ob) : false;
    if (c.inBay) {
      const e = this.leader(keyOf(c.seg, c.from, BAYLANE), c.s, c);
      if (e) ob(e.pos - e.c.back - c.s - c.front, e.c.v);
    } else {
      // the vehicle ahead in this lane (and the one we're moving out from behind), and anyone asking
      // to be let in ahead of us that we can make room for
      const e = this.aheadIn(this.buckets.get(keyOf(c.seg, c.from, this.laneIdx(c))), c.s, c, undefined, c);
      if (e) ob(e.pos - e.c.back - c.s - c.front, e.c.v);
      if (c.oldLane !== undefined) { const o = this.leader(keyOf(c.seg, c.from, c.oldLane), c.s, c); if (o) ob(o.pos - o.c.back - c.s - c.front, o.c.v); }
      if (c.bus) { const o = this.leader(keyOf(c.seg, c.from, BAYLANE), c.s, c); if (o && o.pos - c.s < 40) ob(o.pos - o.c.back - c.s - c.front, o.c.v); }
      this.squeezed(c, ob);
      const xs = this.crossing.get(c.seg.id); // (people crossing)
      if (xs) for (const p of xs) {
        const x = closestOnPath(p, this.pathOf(c.seg, c.from)).s, g = x - (p.stand ?? 2) - c.s - c.front;
        if (p.stand !== undefined && c.v > 3 && g < (c.v * c.v) / (2 * 6)) continue; // (too close to stop even hard: it goes on over)
        if (x > c.s + c.front) ob(Math.max(0.1, g), 0, 0.3);
      }
      const bs = this.barriers.get(c.seg.id); // (a level crossing, shut)
      // (drawing up a metre short of it; one already on it, or nearly, drives on off it)
      if (bs) for (const [z0, z1] of bs) { const x = c.from === c.seg.a ? z0 : L - z1; if (x > c.s + c.front + 0.5) ob(Math.max(0.05, x - 1 - c.s - c.front), 0, 0.3); }
      // and beyond the end of it
      if (!e || e.pos - c.s > this.horizon(c)) {
        if (pl) { if (admitted) this.onward(c, pl.next, pl.node, pl.path.exitLane, pl.path.outS, pl.path.lineS - c.s + (pl.path.ext1 - pl.path.ext0), 1, ob); }
        else if (!last) {
          const nx = this.nextOf(c, at);
          if (nx && nx !== c.seg) this.onward(c, nx, at, this.mapLane(nx, at, this.laneIdx(c)), 0, L - c.s, 1, ob);
        }
      }
      // a lane that ends (where a wider road narrows), the line at a junction, the end of a dead end
      if (this.laneIdx(c) !== BUSLANE) { const sp = this.span(c.seg, c.from, c.lane); if (sp[1] < L - 0.5) ob(sp[1] - c.s - c.front, 0, 0.3); }
      if (hold && pl) ob(Math.min(pl.path.lineS - c.front, this.holdAt(pl, c)) - c.s, 0, 0.3);
      if (c.merge !== undefined && c.mergeBy !== undefined) ob(c.mergeBy - 0.5 - c.s, 0, 0.3);
      if (c.bus && !pl && this.nextOf(c, at) === c.seg) ob(L - 1 - c.s - c.front, 0, 0.3);
      for (const u of c.uref) this.junctionLimits(u, ob);
      if (last && !c.away) ob(c.goal - c.s + 0.3, 0, 0.3);
    }
    // move, never further than the space there is
    let v = still ? 0 : Math.max(0, c.v + Math.max(-BMAX, acc) * dt);
    let ds = v * dt;
    if (ds > gmin - 0.05) { ds = Math.max(0, gmin - 0.05); v = Math.min(v, ds / dt); }
    c.v = v;
    c.s += ds;
    c.wait = v < 0.3 && c.dwell === undefined ? c.wait + dt : 0;
    if (c.wait > GIVE_UP && !c.bus) { c.gone = now; this.stats.gaveUp++; return; } // gives up and finds another way
    if (last && c.s >= c.goal - 1) { c.gone = now; this.stats.arrived++; return; }
    if (pl) { if (admitted && c.s >= pl.path.lineS) this.enter(c, pl); return; }
    // (a lane change never leaves us past where our new way through the junction starts: see roomIn)
    if (c.bus && this.nextOf(c, at) === c.seg) { if (c.s >= L - 1.5 - c.front) this.uTurn(c, at); return; }
    if (c.s >= L && !last) this.crossJoin(c, at, now);
  }

  // Where a road narrows, the lane that's ending and the one beside it close in until there isn't
  // room for two abreast (a vehicle is drawn square to the road at its middle's place across it, so
  // a long one reaching back past the end of a lane sits further over than the lane beside it).
  // Whoever is in the lane that's ending keeps out of the way of anyone who'd then have no room to
  // get past it; anyone coming up behind it who'd have no room waits behind it.
  private squeezed(c: Car, ob: Obstacle) {
    const x = this.info(c.seg);
    if ((!x.ends.A && !x.ends.B) || this.laneIdx(c) === BUSLANE) return;
    const nose = c.s + c.front, tail = c.s - c.back;
    // (away from the tapers the lanes are a full lane apart)
    const a = c.from === c.seg.a, near = (T: typeof x.ends.A, atA: boolean) => {
      if (!T) return false;
      const [z0, z1] = atA === a ? [0, T.len] : [x.L - T.len, x.L];
      return tail - 2 * LONGEST < z1 && nose + 30 + 2 * LONGEST > z0;
    };
    if (!near(x.ends.A, true) && !near(x.ends.B, false)) return;
    const mine = this.span(c.seg, c.from, c.lane)[1], mineEnds = mine < x.L - 0.5;
    for (const l of [c.lane - 1, c.lane + 1]) {
      if (l < 0 || l >= this.net.def(c.seg).lanes) continue;
      const b = this.buckets.get(keyOf(c.seg, c.from, l));
      if (!b) continue;
      const its = this.span(c.seg, c.from, l)[1], itsEnds = its < x.L - 0.5;
      if (!mineEnds && !itsEnds) continue;
      for (let i = this.above(b, tail - LONGEST); i < b.length; i++) {
        const e = b[i], o = e.c;
        if (o === c || e.kind === 4) continue;
        const rear = e.pos - o.back, front = e.pos + o.front;
        if (rear - nose > 30) break;
        if (front < tail) continue; // behind us: it's up to them
        let hold: boolean;
        if (mineEnds && !itsEnds) {
          // we're merging: it has to be able to get past us wherever we get to, up to the end of our lane
          const p = mine - c.front;
          hold = this.tight(o, l, e.pos, p + c.front + o.back, c, c.lane, p, 0.4);
        } else if (itsEnds && !mineEnds) {
          // it's merging: coming up to it, we need room to get past it even at the end of its lane;
          // already beside it, it waits for us unless we'd actually touch
          if (rear >= nose) { const p = Math.max(e.pos, its - o.front); hold = this.tight(c, c.lane, Math.max(c.s, p - o.back - c.front), p + o.front + c.back, o, l, p, 0.4); }
          else hold = this.tight(c, c.lane, c.s, e.pos + o.front + c.back, o, l, e.pos, -0.25);
        } else {
          if (rear < nose && front < nose) continue; // whoever is further back waits
          hold = this.tight(c, c.lane, Math.max(c.s, e.pos - o.back - c.front), e.pos + o.front + c.back, o, l, e.pos, 0.4);
        }
        if (hold) ob(rear - nose, o.v);
      }
    }
  }
  // Would vehicle a, with its middle anywhere from q0 to q1 along lane la of our road, come within
  // `margin` of b standing with its middle at p in lane lb?
  private tight(a: Car, la: number, q0: number, q1: number, b: Car, lb: number, p: number, margin: number) {
    const need = (a.hw ?? DIMS[a.kind].hw) + (b.hw ?? DIMS[b.kind].hw) + margin, seg = a.seg, from = a.from, off = this.laneOff(seg, from, p, lb);
    for (const q of [q0, (q0 + q1) / 2, q1]) if (Math.abs(this.laneOff(seg, from, q, la) - off) < need) return true;
    return false;
  }
  // Buses call at their stops; at a lay-by they pull right out of the traffic, and wait for a gap to rejoin it.
  private busStops(c: Car, dt: number, ob: Obstacle) {
    if (c.inBay) {
      if (c.dwell !== undefined) {
        c.dwell -= dt;
        if (c.dwell <= 0) { c.served = c.bay?.id; c.dwell = undefined; this.called(c); }
        return true;
      }
      if (c.served !== c.bay?.id) {
        // still pulling up to the stand
        const at = c.bay ? (c.from === c.seg.a ? c.bay.s : this.len(c.seg) - c.bay.s) : c.s;
        ob(at - c.s, 0, 0.2);
        if (at - c.s < 0.8 && c.v < 0.6) c.dwell = c.bay && this.onBusStop ? this.onBusStop(c.seg, c.bay, c.id) : 7;
        return false;
      }
      if (!this.canChange(c, this.laneIdx(c), true) || !this.clearOfLane(c)) return true;
      c.inBay = false;
      c.entry = this.put(keyOf(c.seg, c.from, this.laneIdx(c)), c, c.s, 0, true);
      return false;
    }
    const ns = this.nextStop(c);
    if (!ns) return false;
    const togo = ns.at - c.s;
    if (c.dwell !== undefined) {
      c.dwell -= dt;
      if (c.dwell <= 0) { c.served = ns.st.id; c.dwell = undefined; this.called(c); }
      return true;
    }
    // (a bus longer than a lay-by's stand, a bendy bus, calls there from the lane as at a kerbside stop)
    if (ns.st.kind === 'layby' && c.front + c.back <= BAY.stand) {
      c.bay = ns.st;
      // it's out of the lane once its side is clear of anything in the lane
      const lo = this.laneOff(c.seg, c.from, c.s, this.laneIdx(c));
      if (c.off - lo >= 2.6 && this.rearOff(c) - lo >= 2.6) { c.inBay = true; if (c.entry) c.entry.kind = 3; }
    }
    if (togo < 60) ob(togo, 0, 0.2);
    if (togo < 0.8 && c.v < 0.6) c.dwell = this.onBusStop?.(c.seg, ns.st, c.id) ?? 7;
    return false;
  }
  // a bus in the last few metres of drawing up to its stop, at walking pace
  private drawingUp(c: Car) {
    if (c.v > 2) return false;
    const ns = this.nextStop(c);
    return !!ns && ns.at - c.s < 3;
  }
  // The stop a bus is pulling in to (or standing at), if any: a lay-by it's using on this road, or
  // the next stop along it on its side.
  private pullIn(c: Car): Stop | undefined {
    const side = c.from === c.seg.a ? 1 : -1;
    if (c.bay && c.bay.side === side && c.seg.stops.includes(c.bay) && (c.inBay || c.served !== c.bay.id)) return c.bay;
    const ns = this.nextStop(c);
    return ns && ns.at - c.s < BAY.entry + BAY.stand ? ns.st : undefined;
  }
  // How far out from the road's middle a bus stands at a stop: its side 0.3 m in from the kerb
  // (the lay-by's kerb, or the kerb beyond any parking or cycle lane), worked out once per stop.
  private stands = new WeakMap<Stop, { seg: RSeg; def: unknown; off: number }>();
  standOff(seg: RSeg, st: Stop) {
    const had = this.stands.get(st), def = this.net.def(seg);
    if (had && had.seg === seg && had.def === def) return had.off;
    const C = courseOf(this.net, seg), sd = section(this.net, seg, C, C.rhoOf(st.s)), side = st.side === 1 ? sd.L : sd.R;
    const off = side.kerb - DIMS.bus.hw - 0.3;
    this.stands.set(st, { seg, def, off });
    return off;
  }
  // nothing in the lane right alongside a bus waiting to pull out of a lay-by
  private clearOfLane(c: Car) {
    const b = this.buckets.get(keyOf(c.seg, c.from, this.laneIdx(c))) ?? [];
    return !b.some((e) => e.c !== c && e.pos + e.c.front > c.s - c.back - 2 && e.pos - e.c.back < c.s + c.front + 2);
  }
  // A bus at the end of a dead end turns round, once the other side is clear.
  private uTurn(c: Car, at: number) {
    if (c.seg.oneway) { c.gone = this.clock; this.stats.gaveUp++; return; } // (never back up a one-way road)
    const L = this.len(c.seg), d = this.net.def(c.seg), lane = d.bus ? BUSLANE : 0, key = keyOf(c.seg, at, lane);
    // nobody else near the end in any lane the other way, nor within its swing this way (those
    // queued behind it are clear, and wait while it turns)
    for (const l of [...Array(d.lanes).keys(), BUSLANE]) {
      if ((this.buckets.get(keyOf(c.seg, at, l)) ?? []).some((e) => e.c !== c && e.pos - e.c.back < 25)) return;
      if ((this.buckets.get(keyOf(c.seg, c.from, l)) ?? []).some((e) => e.c !== c && e.pos + e.c.front > c.s - c.back - 1.5)) return;
    }
    c.from = at; c.s = Math.max(c.back + 0.5, L - c.s); c.off = -c.off; c.uturn = true;
    c.nextSeg = undefined; c.served = undefined; c.plan = undefined;
    c.entry = this.put(key, c, c.s, 0, true);
  }
  // a plain join (or a road end): carry straight on to the next road
  private crossJoin(c: Car, at: number, now: number) {
    const next = this.nextOf(c, at);
    if (!next || next === c.seg) { c.gone = now; this.stats.gaveUp++; return; }
    const L = this.len(c.seg);
    if (!c.bus) c.route.shift();
    c.s -= L; c.seg = next; c.from = at; c.nextSeg = undefined; c.served = undefined; c.plan = undefined; c.oldLane = undefined; c.merge = undefined; c.mergeBy = undefined;
    c.lane = c.bus ? 0 : this.mapLane(next, at, c.lane);
    c.entry = this.put(keyOf(next, at, this.laneIdx(c)), c, c.s, 0, true);
  }
  private enter(c: Car, pl: Plan) {
    const P = pl.path;
    c.turn = { path: P, t: P.ext0 + (c.s - P.lineS), node: pl.node, next: pl.next };
    c.merged = false;
    if (!c.bus) c.route.shift();
    c.plan = undefined; c.oldLane = undefined; c.merge = undefined; c.mergeBy = undefined; c.nextSeg = undefined; c.keep = undefined;
    // count what really turns where, so junctions can be re-optimised on real traffic
    if (!pl.jd.j) return;
    let m = this.seen.get(pl.node);
    if (!m) this.seen.set(pl.node, (m = new Map()));
    const k = `${c.seg.id}>${pl.next.id}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  private stepTurn(c: Car, dt: number, now: number) {
    const T = c.turn!, P = T.path, dr = DRIVE[c.kind];
    const v0 = Math.min(c.vmax, spd(P, T.t));
    let acc = idmFree(c.v, v0, dr), gmin = Infinity;
    const ob: Obstacle = (g, vl, s0 = dr.s0) => { acc = Math.min(acc, follow(c.v, v0, g, vl, dr, s0)); gmin = Math.min(gmin, g); };
    // Standing in the junction behind someone earlier in the order who is still some way off (going
    // round the ring behind us to cut across our lane on the way out, say): as at the line, if they'd
    // all let us go first we take a place ahead of them, rather than wait for them to come by
    if (c.v < 0.5 && c.adm !== undefined && !P.slip && now - (c.readmit ?? 0) > 500) {
      const jd = this.jdata(T.node);
      if (jd?.j) this.readmit(c, { seg: c.seg.id, from: c.from, lane: P.lane, slip: false, bus: !!c.bus, jd, path: P, node: T.node, next: T.next }, now);
    }
    for (const u of c.uref) this.junctionLimits(u, ob);
    // a slip road: until it's clear of the lane it's leaving, it follows the traffic in that lane
    if (P.leave && T.t < this.slipFor(P, clsOf(c))[0]) {
      const here = P.lineS + (T.t - P.ext0), e = this.aheadIn(this.buckets.get(P.inKey), here, c);
      if (e) ob(e.pos - e.c.back - here - c.front, e.c.v);
    }
    // and gives way to the road it joins
    if (P.gate && !c.merged) {
      const g = this.slipFor(P, clsOf(c))[1];
      if (T.t >= g - 1 && this.mayMerge(c, P)) {
        c.merged = true;
        this.put(P.exitKey, c, P.outS - (P.ext1 - T.t), 2, true);
      } else ob(g - T.t, 0, 0.3);
    }
    if (P.gate === undefined || c.merged) {
      // what's in the lane we're heading into, and beyond
      const mine = P.outS - (P.ext1 - T.t);
      // (anyone asking to be let into it only if we can let them in by easing off, as in a lane: one
      // level with us waits for us to go by, else we'd each stand waiting for the other)
      const e = this.aheadIn(this.buckets.get(P.exitKey), mine, c, this.inbound(P), c);
      if (e) ob(e.pos - e.c.back - mine - c.front, e.c.v);
      else this.onward(c, T.next, T.node, P.exitLane, this.len(T.next), P.ext1 - T.t + this.len(T.next) - P.outS, 0, ob);
    }
    let v = Math.max(0, c.v + Math.max(-BMAX, acc) * dt), ds = v * dt;
    if (ds > gmin - 0.05) { ds = Math.max(0, gmin - 0.05); v = Math.min(v, ds / dt); }
    c.v = v;
    T.t += ds;
    c.wait = v < 0.3 ? c.wait + dt : 0;
    if (c.wait > GIVE_UP && !c.bus) { c.gone = now; this.stats.gaveUp++; return; }
    if (T.t < P.ext1) return;
    // out onto the road beyond
    c.seg = T.next; c.from = T.node; c.s = P.outS + (T.t - P.ext1);
    c.lane = P.exitLane === BUSLANE ? 0 : P.exitLane;
    c.off = this.laneOff(c.seg, c.from, c.s, this.laneIdx(c));
    c.after = { path: P, adm: c.adm ?? 0 };
    c.adm = undefined; c.admNode = undefined; c.turn = undefined; c.nextSeg = undefined; c.served = undefined; c.merged = false;
    c.entry = this.put(keyOf(c.seg, c.from, this.laneIdx(c)), c, c.s, 0, true);
  }
  // A slip road joining the main road: a gap ahead, and nobody behind who'd have to brake hard.
  private mayMerge(c: Car, P: JPath) {
    const b = this.buckets.get(P.exitKey);
    const mine = P.outS - (P.ext1 - c.turn!.t) + 2;
    const e = this.aheadIn(b, mine, c);
    if (e && e.pos - e.c.back - mine - c.front < 3) return false;
    const r = this.behindIn(b, mine, c);
    if (r) {
      const f = r.e.c, g = mine - c.back - r.pos - f.front;
      if (g < 3 + f.v * 0.6 || idm(f.v, f.v0 ?? f.vmax, g, c.v, DRIVE[f.kind]) < -2) return false;
    }
    return true;
  }

  // ---------- trains ----------
  // a train of one of the game's kinds (catalog.ts), or a set bought from the vehicle library
  // (game/fleet.ts defFor), made up of the year's real rolling stock
  addTrain(kind: string | TrainDef) {
    const def = typeof kind === 'string' ? TRAINS[kind] : kind;
    const segs = [...this.net.segs.values()].filter((s) => this.trackOk(def, s));
    if (!segs.length) return false;
    const seg = segs[Math.floor(this.rand() * segs.length)], dress = this.fleet.dressTrain(def);
    this.trains.push({ def, seg, from: seg.a, s: Math.min(this.len(seg) - 1, dress.length + 1), v: 0, trail: [], dress });
    return true;
  }
  private steepest(s: RSeg) {
    let g = this.gradeCache.get(s.id);
    if (g === undefined) {
      const p = this.net.path(s);
      g = 0;
      for (let i = 1; i < p.length; i++) g = Math.max(g, Math.abs((p[i].y ?? 0) - (p[i - 1].y ?? 0)) / (Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z) || 1));
      this.gradeCache.set(s.id, g);
    }
    return g;
  }
  // can this train run on that track? (rack, wires, and how steep it is)
  trackOk(t: TrainDef, s: RSeg) {
    const d = this.net.def(s);
    if (d.cls !== 'rail') return false;
    if (d.rack && !t.rack) return false;
    if (t.needsWires && !d.electric) return false;
    return this.steepest(s) <= t.maxGrade + 0.002;
  }
  private moveTrains(dt: number) {
    const net = this.net;
    for (const tr of this.trains) {
      if (!net.segs.has(tr.seg.id)) { tr.gone = true; continue; }
      const L = this.len(tr.seg), d = net.def(tr.seg);
      const q = pointAt(this.pathOf(tr.seg, tr.from), Math.min(tr.s, L));
      let target = trainSpeed(tr.def, d, q.grade);
      // a bridge's own limit, braking for it in time (game/bridges.ts)
      if (this.speedCap) target = Math.min(target, tr.from === tr.seg.a ? this.speedCap(tr.seg, tr.s, 1, tr.v * tr.v / 2.4 + 20) : this.speedCap(tr.seg, L - tr.s, -1, tr.v * tr.v / 2.4 + 20));
      tr.v += Math.max(-1.2 * dt, Math.min(0.7 * dt, target - tr.v));
      tr.s += tr.v * dt;
      if (tr.s >= L) {
        const at = net.other(tr.seg, tr.from);
        // the most nearly straight-on track it's allowed to use; at a dead end it reverses
        const here = this.pathOf(tr.seg, tr.from), a = here[here.length - 2], b = here[here.length - 1];
        const u = { x: b.x - a.x, z: b.z - a.z }, ul = Math.hypot(u.x, u.z) || 1;
        let best: RSeg | null = null, bd = -2;
        for (const s of net.segsAt(at)) {
          if (s.id === tr.seg.id || !this.trackOk(tr.def, s)) continue;
          const p = this.pathOf(s, at), v = { x: p[1].x - p[0].x, z: p[1].z - p[0].z }, vl = Math.hypot(v.x, v.z) || 1;
          const dot = (u.x * v.x + u.z * v.z) / (ul * vl);
          if (dot > bd) { bd = dot; best = s; }
        }
        tr.trail.unshift({ seg: tr.seg, from: tr.from });
        tr.trail.length = Math.min(tr.trail.length, 6);
        if (best && bd > 0.5) { tr.s -= L; tr.seg = best; tr.from = at; }
        else { tr.s = 0.5; tr.from = at; tr.v = 0; tr.trail = []; } // reverse out
      }
    }
    this.trains = this.trains.filter((t) => !t.gone);
  }
  // position a distance back along a train from its front
  private along(tr: Train, back: number) {
    let seg = tr.seg, from = tr.from, s = tr.s - back, i = 0;
    while (s < 0 && i < tr.trail.length) { seg = tr.trail[i].seg; from = tr.trail[i].from; s += this.len(seg); i++; }
    if (!this.net.segs.has(seg.id)) { seg = tr.seg; from = tr.from; }
    return { q: pointAt(this.pathOf(seg, from), Math.max(0, s)), seg };
  }

  // Paused, nothing moves, but the view may: draw everyone again where they stand (the fleet only
  // draws what's in view).
  redraw() { this.draw(0, this.clock); }
  private draw(dt: number, now: number) {
    const net = this.net;
    this.fleet.begin(dt);
    for (const c of this.cars) {
      let x: number, z: number, y: number, grade = 0, at: (d: number) => { x: number; z: number }, settle = true;
      if (c.turn) {
        // in a junction the vehicle sits exactly where its conflicts were worked out
        const tr = c.turn.path.track, t = c.turn.t, q = tr.at(t);
        x = q.x; z = q.z; y = q.y;
        at = (d) => tr.point(t + d);
        settle = t > tr.settle;
      } else {
        const L = this.len(c.seg), path = this.pathOf(c.seg, c.from), q = pointAt(path, Math.min(c.s, L));
        // lane position, easing across on lane changes; buses swing into lay-bys
        let want = this.laneOff(c.seg, c.from, c.s, this.laneIdx(c));
        // (people: to the stop's own kerb, so its doors open where the people are; only for a stop on
        // this road and this side, which the last lay-by it used is not once it has moved on)
        const st = c.bus ? this.pullIn(c) : undefined;
        if (st) want = Math.max(want, want + (this.standOff(c.seg, st) - want) * bayWeight(st, c.from === c.seg.a ? c.s : L - c.s));
        c.off += (want - c.off) * Math.min(1, dt * 3);
        x = q.x + q.uz * c.off; z = q.z - q.ux * c.off; y = q.y; grade = q.grade;
        const off = c.off, s = c.s;
        // near a junction (or bend) the body follows the course through it, as its conflicts do;
        // elsewhere the lane, carried straight on past the road's ends
        const pl = c.plan && !c.plan.wrong && c.plan.path.lineS - s < E_IN && c.plan.path.inSeg === c.seg.id ? c.plan.path : undefined;
        const af = c.after && c.after.path.next === c.seg.id && c.after.path.exitLane === this.laneIdx(c) && c.s - c.after.path.outS < E_OUT ? c.after.path : undefined;
        const onCourse = Math.abs(off - want) < 0.3;
        if (onCourse && pl) { const tr = pl.track, t = pl.ext0 - (pl.lineS - s); at = (d) => tr.point(t + d); settle = false; }
        else if (onCourse && af) { const tr = af.track, t = af.ext1 + (s - af.outS); at = (d) => tr.point(t + d); settle = t > tr.settle; }
        else at = (d) => {
          const r = s + d, p = pointAt(path, Math.max(0, Math.min(L, r))), o = r < 0 ? r : r > L ? r - L : 0;
          return { x: p.x + p.uz * off + p.ux * o, z: p.z - p.ux * off + p.uz * o };
        };
      }
      const k = Math.min(1, Math.max(0, (now - c.born) / 500), c.gone !== undefined ? 1 - (now - c.gone) / 600 : 1);
      // the front axle on the course, the rear axle and any trailer dragged after it (footprint.ts)
      const pose = (c.pose ??= { x, z, y, k, kind: c.kind, id: c.id, parts: [] });
      // (a bus turning round at a dead end is drawn sliding across, lined up with the road, as ever;
      // and one standing at a stop stands square to its kerb, having straightened up as it drew up)
      const ax = (c.axles ??= { fx: 0, fz: 0, rx: 0, rz: 0, tx: 0, tz: 0, body: NaN });
      if (c.uturn || (c.bus && (c.dwell !== undefined || this.drawingUp(c)))) ax.body = NaN;
      const parts = steered(c.cls ?? c.kind, at, ax, k, pose.parts, settle);
      pose.x = x; pose.z = z; pose.y = y; pose.k = k;
      c.heading = Math.atan2(parts[0].hz, parts[0].hx);
      this.fleet.drawCar(c, parts, y, Math.atan(grade), k, dt);
    }
    // trains: each car on its bogies, spaced along the track behind the front
    for (const tr of this.trains) {
      const d = tr.dress;
      for (let i = 0; i < d.chain.length; i++) {
        const half = Math.min(d.chain[i].dims.length * 0.35, 12), f = this.along(tr, d.offs![i] - half), b = this.along(tr, d.offs![i] + half);
        const of = net.def(f.seg).tracks === 2 ? 2 : 0, ob = net.def(b.seg).tracks === 2 ? 2 : 0;
        const fx = f.q.x + f.q.uz * of, fz = f.q.z - f.q.ux * of, bx = b.q.x + b.q.uz * ob, bz = b.q.z - b.q.ux * ob;
        this.fleet.drawRail(d, i, (fx + bx) / 2, (f.q.y + b.q.y) / 2, (fz + bz) / 2, Math.atan2(fz - bz, fx - bx), Math.atan((f.q.grade + b.q.grade) / 2), tr.v, dt);
      }
    }
    this.onDraw?.(dt);
    this.fleet.end(now);
  }
  // Is anybody on this stretch of road ([z0, z1] from its a end)? (a level crossing waiting to be clear)
  onStretch(seg: number, z0: number, z1: number) {
    for (const c of this.cars) {
      if (c.gone !== undefined || c.turn || c.seg.id !== seg) continue;
      const L = this.len(c.seg), a = c.from === c.seg.a ? c.s - c.back : L - c.s - c.front, b = c.from === c.seg.a ? c.s + c.front : L - c.s + c.back;
      if (b > z0 && a < z1) return true;
    }
    return false;
  }

  // where every vehicle was last drawn, and which of them overlap (see footprint.ts)
  poses() { return this.cars.flatMap((c) => (c.pose && c.pose.k > 0.02 ? [c.pose] : [])); }
  overlaps(tol = 0.3) { return overlapping(this.poses(), tol); }
  // what a vehicle is doing, for debugging
  describe(id: number) {
    const c = this.cars.find((x) => x.id === id);
    if (!c) return `#${id} gone`;
    const T = c.turn;
    const where = T ? `turn@${T.node} ${T.path.move}${T.path.slip ? ' slip' : ''} t=${T.t.toFixed(1)} [${T.path.ext0.toFixed(1)}-${T.path.ext1.toFixed(1)}] lane ${T.path.lane}>${T.path.exitLane}`
      : `seg ${c.seg.id} from ${c.from} s=${c.s.toFixed(1)}/${this.len(c.seg).toFixed(1)} lane ${c.lane}${c.oldLane !== undefined ? `(from ${c.oldLane})` : ''} off=${c.off.toFixed(2)}`;
    return `${c.kind}#${id} ${where} v=${c.v.toFixed(1)} adm=${c.admNode ?? '-'}${c.inBay ? ' inBay' : ''}${c.gone !== undefined ? ' gone' : ''}`;
  }

  // which vehicles in junctions are holding this one back, and how far it may come (for debugging)
  explain(id: number) {
    const c = this.cars.find((x) => x.id === id);
    if (!c) return '';
    const out: string[] = [];
    for (const u of c.uref) for (const x of this.users.get(u.path.node) ?? []) {
      if (x.c === c || (x.adm === Infinity && u.adm === Infinity) || !this.related(u.path, x.path)) continue;
      const vw = this.view(u.path, clsOf(c), x.path, clsOf(x.c));
      if (vw.empty || vw.apart(x.t, u.t)) continue;
      const limMe = vw.limitMe(x.t), limIt = vw.limitIt(u.t), eIt = x.t >= limIt, eMe = u.t >= limMe;
      const itFirst = eIt !== eMe ? eIt : this.first(x, u);
      out.push(`${itFirst ? 'held by' : 'holds'} #${x.c.id}(${x.path.move} t=${x.t.toFixed(1)} adm=${x.adm === Infinity ? '-' : +x.adm.toFixed(2)}) gap=${((itFirst ? limMe : limIt) - (itFirst ? u.t : x.t)).toFixed(1)}${eIt ? ' it-engaged' : ''}${eMe ? ' me-engaged' : ''}`);
    }
    return `#${id} adm=${c.adm === undefined ? '-' : +c.adm.toFixed(2)} ${c.admNode === undefined ? `(waiting: ${c.why ?? '?'}) ` : ''}users=${c.uref.map((u) => `${u.path.node}:${u.path.move}@${u.t.toFixed(1)}`).join(',')} :: ${out.join('; ')}`;
  }

  // For the harness (trafficsim.ts): everyone at a give-way line (or a roundabout's entry), first
  // in the queue with room beyond, or just over it in the mouth of the junction (`mouth`, where one
  // that has committed may still be waiting), and whether anyone they have to let by is in their way
  // right now: past where it could still stop for them and not yet clear of their way (for one
  // they'd follow, until it's moving off with room behind it to pull away into), or due there sooner
  // than a driver would pull out in front of it. `own`: the one in the way came from their own
  // approach. Off the hot path: only the harness asks.
  gapProbe(): { id: number; node: number; ring: boolean; committed: boolean; mouth: boolean; v: number; blocked: boolean; own: boolean; why?: string }[] {
    const out: { id: number; node: number; ring: boolean; committed: boolean; mouth: boolean; v: number; blocked: boolean; own: boolean; why?: string }[] = [];
    for (const c of this.cars) {
      if (c.gone !== undefined) continue;
      let P: JPath, node: number, j: Junction | null | undefined, mouth = false;
      if (c.turn) {
        P = c.turn.path; node = c.turn.node; j = this.junctions.get(node); mouth = true;
        if (!j || P.slip || P.rank === 0 || j.form === 'signals' || c.turn.t > P.ext0 + 3) continue;
      } else {
        if (c.nextSeg === undefined) continue; // (working out its way on can draw random numbers: never here)
        const pl = this.planOf(c);
        j = pl?.jd.j;
        if (!pl || !j || pl.wrong || pl.path.rank === 0 || j.form === 'signals' || c.merge !== undefined) continue;
        P = pl.path; node = pl.node;
        if (P.lineS - c.s - c.front > 2.5 || !this.leaderFirst(c, P, node)) continue;
        if (c.admNode !== node && !this.exitRoom(c, P)) continue;
      }
      const committed = c.admNode === node;
      const me = c.uref.find((u) => u.path === P);
      if (!me) continue;
      const ring = j.form === 'roundabout' || j.form === 'mini', tc = ring ? 3 : 4.5;
      let blocked = false, own = false;
      const check = (x: User) => {
        const vw = this.view(P, clsOf(c), x.path, clsOf(x.c));
        if (vw.empty || vw.apart(x.t, me.t) || (vw.limitMe(x.t) >= me.t + 3 && x.v > 1)) return;
        const lim = vw.limitIt(me.t);
        // (one still coming: in the way if it will be there sooner than a driver would pull out in front of it)
        if (x.t < lim && (x.path.inSeg === P.inSeg || (lim - x.t) / Math.max(0.1, x.v) >= tc)) return;
        blocked = true;
        if (x.path.inSeg === P.inSeg) own = true;
      };
      for (const x of this.users.get(node) ?? []) {
        if (x.c === c || !this.related(P, x.path)) continue;
        if (x.path.inKey === P.inKey && !x.c.turn && x.c.seg === c.seg && x.c.s < c.s) continue;
        // (one not yet committed that doesn't have priority only counts if it's already in our way)
        if (x.adm === Infinity && x.path.rank >= P.rank) { const vw = this.view(P, clsOf(c), x.path, clsOf(x.c)); if (vw.empty || vw.apart(x.t, me.t) || x.t < vw.limitIt(me.t)) continue; }
        check(x);
      }
      out.push({ id: c.id, node, ring, committed, mouth, v: c.v, blocked, own, why: committed ? undefined : c.why });
    }
    return out;
  }

  get live() { return this.cars.filter((c) => c.gone === undefined && !c.bus).length; }
  get buses() { return this.cars.filter((c) => c.bus && c.gone === undefined).length; }
}

// How busy the roads are through the day: two rush hours, a lunchtime bump, quiet nights.
export function demand(h: number) {
  if (h < 5 || h >= 23.5) return 0.08;
  return 0.22 + Math.exp(-(((h - 8.2) / 1.1) ** 2)) + 0.9 * Math.exp(-(((h - 17.4) / 1.3) ** 2)) + 0.35 * Math.exp(-(((h - 13) / 2) ** 2));
}
export const rushLabel = (h: number) => (h >= 7 && h < 9.5 ? 'morning rush' : h >= 16.3 && h < 18.7 ? 'evening rush' : h < 5 || h >= 23 ? 'night' : '');
export type { P };
