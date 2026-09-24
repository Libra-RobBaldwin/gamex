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
import { BAY, bayWeight, closestOnPath, HALF, pathLength, pointAt, type Lot, type Network, type P, type RSeg, type Stop } from './roads';
import { legsAt, moveOf, type Junction, type Leg, type Move } from './junction';
import { TRAINS, trainSpeed, type TrainDef } from './catalog';
import { courseOf, laneSpan, sectionAt, taperOf, type Course, type Ends2 } from './xsection';
import { DIMS, bodyOf, overlapping, type Kind, type Pose, type Rect } from './footprint';
import { STEP, Track, View, table, tableStats, type Cls } from './conflicts';

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
  // it has to have found a gap in the lane it joins
  leave?: number[]; gate?: number[];
}
// a junction, or a bend where two roads meet end to end and the road runs on round a curve
interface JData { node: number; j: Junction | null; live: boolean; legs: Leg[]; paths: Map<string, JPath> }
interface Plan { seg: number; from: number; lane: number; slip: boolean; bus: boolean; jd: JData; path: JPath; node: number; next: RSeg }
// someone in or near a junction, at t along their path through it; adm: when they committed to it
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
  lorry: boolean; bus?: boolean; col: THREE.Color; heading: number;
  born: number; gone?: number; wait: number;
  lane: number; off: number; // lane (0 = nearside) and current sideways position
  dwell?: number; served?: number; inBay?: boolean; bay?: Stop;
  nextSeg?: number;
  oldLane?: number; merge?: number; lcAt?: number; lcHold?: number; v0?: number; uturn?: boolean;
  turn?: { path: JPath; t: number; node: number; next: RSeg };
  plan?: Plan; merged?: boolean;
  adm?: number; admNode?: number; before?: Set<number>;
  after?: { path: JPath; adm: number };
  entry?: Entry; uref: User[];
  ents?: Entry[]; ne?: number; users?: User[]; // (reused from frame to frame, so the garbage collector isn't kept busy)
  why?: string; // why it isn't going into the junction yet (for debugging)
  pose?: Pose;
}
interface Train { def: TrainDef; seg: RSeg; from: number; s: number; v: number; trail: { seg: RSeg; from: number }[]; col: THREE.Color; gone?: boolean }
interface Access { seg: RSeg; s: number }
interface SegInfo { L: number; fwd: P[]; rev: P[]; ends: Ends2; spans: Map<number, [number, number]>; course?: Course }
type Obstacle = (gap: number, vl: number, s0?: number) => void;

const MAX = 300;
const CAR_COLS = ['#c9302c', '#2f6fb8', '#f2f2f2', '#2b2b2b', '#8d8f93', '#e0a526', '#5a8f4a', '#6b2f4a', '#b8bcbf', '#f2f2f2', '#1f3f6a'];
const LORRY_COLS = ['#f2f2f2', '#b0463a', '#2f6f9e', '#d69a2d', '#3f7a4a'];
// how each kind of vehicle drives: acceleration, comfortable braking, time gap, gap when stopped
const DRIVE: Record<Kind, { a: number; b: number; T: number; s0: number }> = {
  car: { a: 2.0, b: 2.5, T: 1.1, s0: 2 },
  lorry: { a: 1.0, b: 2.0, T: 1.5, s0: 2.5 },
  bus: { a: 1.1, b: 2.0, T: 1.4, s0: 2.5 },
};
const BMAX = 9; // emergency stop
const E_IN = 10, E_OUT = 10; // how far either side of a junction its paths are followed
const BUSLANE = 8, BAYLANE = 9;
const LONGEST = 7; // the furthest any vehicle reaches in front of or behind its centre (a lorry)
const GIVE_UP = 90; // seconds stood still before a driver gives up and goes another way
const AMBER = 3, ALLRED = 2;
const LAT = 3; // m/s² sideways: how hard vehicles corner
const BEND = 0.1; // radians: a join sharper than this is driven round its curve, not straight across

// the speed allowed at t along a junction's path (for the bends at and beyond it)
const spd = (P: JPath, t: number) => P.env[Math.max(0, Math.min(P.env.length - 1, Math.floor(t / STEP)))];
const keyOf = (s: RSeg, from: number, lane: number) => s.id * 32 + (from === s.a ? 0 : 16) + lane;
const clsOf = (c: Car): Cls => (c.lorry ? 1 : c.bus ? 2 : 0);

// Intelligent Driver Model: the acceleration that keeps a safe, comfortable gap to what's ahead.
function idm(v: number, v0: number, gap: number, vl: number, p: { a: number; b: number; T: number; s0: number }, s0 = p.s0) {
  const ss = s0 + Math.max(0, v * p.T + (v * (v - vl)) / (2 * Math.sqrt(p.a * p.b)));
  const r = Math.min(2, v / Math.max(0.5, v0));
  return p.a * (1 - r * r * r * r - (ss / Math.max(0.05, gap)) ** 2);
}
const idmFree = (v: number, v0: number, p: { a: number }) => { const r = Math.min(2, v / Math.max(0.5, v0)); return p.a * (1 - r * r * r * r); };

function im(geo: THREE.BufferGeometry, color: string, n: number) {
  const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), n);
  m.castShadow = true;
  m.count = 0;
  m.frustumCulled = false;
  return m;
}
const boxAt = (w: number, h: number, d: number, x: number, y: number) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, 0);

export class Traffic {
  cars: Car[] = [];
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
  private tables = new Map<number, { a: View; b: View }>();
  private edgeList: Access[] | null = null;
  private buckets = new Map<number, Entry[]>();
  private users = new Map<number, User[]>();
  private committed = new Map<number, Car[]>();
  private appr = new Map<number, User[]>();
  private admSeq = 0;
  private ids = 1;
  private clock = 0;
  // instanced bodies: one draw call per part for every car on the map
  private carBody = im(boxAt(4.3, 0.72, 1.8, 0, 0.38), '#ffffff', MAX);
  private carBase = im(boxAt(3.9, 0.3, 1.66, 0, 0.1), '#1c1d20', MAX);
  private carCab = im(boxAt(2.2, 0.6, 1.6, -0.3, 1.1), '#2b3640', MAX);
  private trailer = im(boxAt(11, 3.1, 2.5, -1.4, 1.0), '#ffffff', 80);
  private cab = im(boxAt(2.4, 3, 2.5, 5.4, 0.3), '#e8e6e0', 80);
  private busBody = im(boxAt(11, 2.6, 2.5, 0, 0.35), '#ffffff', 40);
  private busWin = im(boxAt(10.4, 1.0, 2.56, 0, 1.55), '#26343f', 40);
  private busRoof = im(boxAt(10.6, 0.22, 2.3, 0, 2.95), '#f2f2f2', 40);
  private trainBody = im(boxAt(20, 3.3, 2.8, 0, 0.5), '#ffffff', 160);
  private trainWin = im(boxAt(19.6, 1.0, 2.86, 0, 2.0), '#ffffff', 160);
  private trainRoof = im(boxAt(19.8, 0.3, 2.5, 0, 3.8), '#9aa0a4', 160);
  private stripe = new THREE.Color();
  private v3 = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YZX');

  constructor(net: Network, scene: THREE.Scene, rand: () => number) {
    this.net = net;
    this.rand = rand;
    scene.add(this.carBody, this.carBase, this.carCab, this.trailer, this.cab, this.busBody, this.busWin, this.busRoof, this.trainBody, this.trainWin, this.trainRoof);
  }

  // the road network changed: routes, access points and anyone on a removed road are reset
  invalidate() {
    this.graph = null;
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
    const sec = inTaper ? sectionAt(this.net, s, t, x.ends) : { median: d.median / 2, lanes: d.lanes, lane: d.lane };
    if (lane === BUSLANE) return sec.median + sec.lanes * sec.lane + d.bus / 2;
    if (lane < Math.floor(sec.lanes + 1e-6)) return sec.median + sec.lanes * sec.lane - (lane + 0.5) * sec.lane;
    return sec.median + (Math.max(0.3, sec.lanes - lane) * sec.lane) / 2; // the lane that's tapering away
  }
  private lanePoint(s: RSeg, from: number, at: number, lane: number): P {
    const q = pointAt(this.pathOf(s, from), at), off = this.laneOff(s, from, at, lane);
    return { x: q.x + q.uz * off, z: q.z - q.ux * off, y: q.y };
  }
  private laneIdx(c: Car) { return c.bus && this.net.def(c.seg).bus ? BUSLANE : c.lane; }

  private adj() {
    if (this.graph) return this.graph;
    const g = new Map<number, { seg: RSeg; to: number; len: number }[]>();
    for (const s of this.net.segs.values()) {
      if (this.net.def(s).cls !== 'road') continue;
      const len = this.len(s);
      for (const [a, b] of [[s.a, s.b], [s.b, s.a]]) { let l = g.get(a); if (!l) g.set(a, (l = [])); l.push({ seg: s, to: b, len }); }
    }
    return (this.graph = g);
  }

  // where a building's traffic joins the road: the point on the nearest road in front of its plot
  accessOf(l: Lot): Access | null {
    if (this.access.has(l.id)) return this.access.get(l.id)!;
    const c = Math.cos(l.rot), s = Math.sin(l.rot), f = l.d / 2 + l.front;
    const p = { x: l.x - f * s, z: l.z + f * c };
    // traffic joins ordinary roads, never straight onto a motorway
    const n = this.net.nearestSeg(p, 24, (s) => this.net.def(s).frontage);
    const a = n ? { seg: n.seg, s: n.s } : null;
    this.access.set(l.id, a);
    return a;
  }
  // dead ends out at the edge of town count as roads to elsewhere
  private edges(): Access[] {
    if (this.edgeList) return this.edgeList;
    const out: Access[] = [];
    for (const [id, list] of this.adj()) {
      const n = this.net.node(id);
      if (list.length === 1 && Math.hypot(n.x, n.z) > 180) out.push({ seg: list[0].seg, s: list[0].seg.a === id ? 1 : this.len(list[0].seg) - 1 });
    }
    return (this.edgeList = out);
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
    const ca = (dist.get(d.seg.a) ?? Infinity) + d.s, cb = (dist.get(d.seg.b) ?? Infinity) + (L1 - d.s);
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
    if (o.seg.id === d.seg.id) {
      return d.s > o.s ? { from: o.seg.a, s: o.s, route: [] as number[], goal: d.s, entry: o.seg.a } : { from: o.seg.b, s: L0 - o.s, route: [] as number[], goal: L0 - d.s, entry: o.seg.b };
    }
    const r = this.search([{ node: o.seg.a, cost: o.s }, { node: o.seg.b, cost: L0 - o.s }], o.seg.id, d);
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
    const kind: Kind = lorry ? 'lorry' : 'car', dm = DIMS[kind];
    const lo = this.startGuard(o.seg, p.from) + dm.back, hi = this.endGuard(o.seg, p.from) - dm.front;
    if (hi < lo) return false;
    const s = Math.max(lo, Math.min(hi, p.s));
    // the destination, likewise clear of junctions
    const glo = this.startGuard(d.seg, p.entry), ghi = this.endGuard(d.seg, p.entry);
    let goal = ghi > glo ? Math.max(glo, Math.min(ghi, p.goal)) : (glo + ghi) / 2;
    if (!p.route.length && goal < s + 8) { if (s + 8 > hi) return false; goal = s + 8; }
    const n = this.net.def(o.seg).lanes;
    const lanes = lorry || n === 1 ? [0] : [...Array(n).keys()].sort(() => this.rand() - 0.5);
    for (const lane of lanes) {
      const sp = this.span(o.seg, p.from, lane);
      if (s - dm.back < sp[0] || s + dm.front + 10 > sp[1] || !this.canPlace(o.seg, p.from, s, lane, kind)) continue;
      const col = new THREE.Color(lorry ? LORRY_COLS[Math.floor(this.rand() * LORRY_COLS.length)] : CAR_COLS[Math.floor(this.rand() * CAR_COLS.length)]);
      const c: Car = {
        id: this.ids++, kind, front: dm.front, back: dm.back, seg: o.seg, from: p.from, s, v: 0, vmax: lorry ? 25 : 28 + this.rand() * 5, route: p.route, goal, dest: d,
        away: this.offMap(d.seg, p.entry, goal), lorry, col, heading: 0, born: now, wait: 0, lane, off: this.laneOff(o.seg, p.from, s, lane), uref: [],
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
    return goal > this.len(seg) - 3 && (this.adj().get(far)?.length ?? 0) === 1 && this.edges().some((e) => e.seg === seg);
  }
  // Is there room to put a vehicle here, clear of the ones in the lane and of any coming up behind?
  private canPlace(seg: RSeg, from: number, s: number, lane: number, kind: Kind) {
    const dm = DIMS[kind];
    // (where a road narrows, the lane beside may be too close to be alongside anything in it)
    const lanes = [lane];
    if (lane !== BUSLANE) for (const l of [lane - 1, lane + 1]) if (l >= 0 && l < this.net.def(seg).lanes && Math.abs(this.laneOff(seg, from, s, l) - this.laneOff(seg, from, s, lane)) < dm.hw + DIMS.bus.hw + 0.4) lanes.push(l);
    for (const l of lanes) for (const e of this.buckets.get(keyOf(seg, from, l)) ?? []) {
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
    let o: Access | null, d: Access | null, lorry = false;
    if (r < 0.12) { lorry = true; o = works() ?? edge(); d = this.rand() < 0.5 ? shopA() ?? edge() : edge() ?? works(); }
    else if (r < 0.22) { const inbound = this.rand() < 0.5; o = inbound ? edge() : home(); d = inbound ? job() : edge(); }
    else if (morning) { o = home(); d = this.rand() < 0.85 ? job() : shopA(); }
    else if (evening) { o = this.rand() < 0.85 ? job() : shopA(); d = home(); }
    else { const out = this.rand() < 0.5; o = out ? home() : shopA() ?? job(); d = out ? shopA() ?? job() : home(); }
    if (o && d && !(o.seg.id === d.seg.id && Math.abs(o.s - d.s) < 8)) this.spawn(o, d, lorry, now);
  }

  // A bus that tours the network, calling at every stop on its side of the road.
  addBus() {
    const segs = [...this.net.segs.values()].filter((s) => this.net.def(s).cls === 'road' && this.net.def(s).family !== 'Motorway');
    for (let tries = 0; tries < 30 && segs.length; tries++) {
      const seg = segs[Math.floor(this.rand() * segs.length)], from = this.rand() < 0.5 ? seg.a : seg.b;
      const lo = this.startGuard(seg, from) + DIMS.bus.back, hi = this.endGuard(seg, from) - DIMS.bus.front;
      if (hi < lo) continue;
      const s = lo + this.rand() * (hi - lo), lane = this.net.def(seg).bus ? BUSLANE : 0;
      if (!this.canPlace(seg, from, s, lane, 'bus')) continue;
      const c: Car = {
        id: this.ids++, kind: 'bus', front: DIMS.bus.front, back: DIMS.bus.back, seg, from, s, v: 0, vmax: 11, route: [], goal: Infinity, lorry: false, bus: true,
        col: new THREE.Color(this.rand() < 0.5 ? '#c9302c' : '#e8a21f'), heading: 0, born: this.clock, wait: 0, lane: 0, off: this.laneOff(seg, from, s, lane), uref: [],
      };
      this.cars.push(c);
      c.entry = this.put(keyOf(seg, from, lane), c, s, 0, true);
      return;
    }
  }
  private nextStop(c: Car) {
    const L = this.len(c.seg), side = c.from === c.seg.a ? 1 : -1;
    let best: { st: Stop; at: number } | null = null;
    for (const st of c.seg.stops) {
      if (st.side !== side || st.id === c.served) continue;
      const at = side === 1 ? st.s : L - st.s;
      if (at > c.s - 1 && (!best || at < best.at)) best = { st, at };
    }
    return best;
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
  // nearest behind. Neither counts `self`.
  private aheadIn(b: Entry[] | undefined, pos: number, self: Car, skip?: (e: Entry) => boolean) {
    if (!b) return undefined;
    let best: Entry | undefined, rear = Infinity;
    for (let i = this.above(b, pos); i < b.length; i++) {
      const e = b[i];
      if (e.pos - LONGEST > rear) break;
      if (e.c === self || skip?.(e)) continue;
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
  private inbound(P: JPath) { return (e: Entry) => e.kind === 2 && !!e.c.turn && this.related(e.c.turn.path, P); }
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
    this.appr.clear();
    for (const c of this.cars) { c.uref.length = 0; c.entry = undefined; c.ne = 0; }
    for (const c of this.cars) {
      if (c.turn) {
        const T = c.turn, P = T.path;
        this.addUser(P.node, c, P, T.t, c.adm ?? Infinity);
        // its tail is still in the lane it came from; its nose is already in the one it's going to
        if (P.leave ? T.t < P.leave[clsOf(c)] : T.t - P.ext0 < c.back + 1) this.put(P.inKey, c, P.lineS + (T.t - P.ext0), 1);
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
        if (Math.abs(c.off - this.laneOff(c.seg, c.from, c.s, this.laneIdx(c))) < 1) c.uturn = false;
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
      if (pl && pl.path.lineS - c.s <= this.sphere(c)) {
        const adm = c.admNode === pl.node ? c.adm ?? Infinity : Infinity;
        this.addUser(pl.node, c, pl.path, pl.path.ext0 - (pl.path.lineS - c.s), adm);
        if (adm < Infinity && pl.path.lineS - c.s < 20) this.commit(pl.path.exitKey, c);
      }
      if (!c.after && c.admNode === undefined) c.before = undefined;
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
  private greenFor(j: Junction, seg: number, now: number) {
    const st = this.signal(j, now);
    return st.state !== 'red' && st.phases[st.phase].includes(seg);
  }
  // Who gives way to whom: lower goes first. On a roundabout everyone entering gives way to the ring.
  private rankOf(j: Junction | null, inSeg: number, mv: Move, slip: boolean) {
    if (slip || !j) return 0;
    if (j.form === 'signals') return mv === 'R' ? 1 : 0;
    if (j.form === 'priority' || j.form === 'merge') return j.major.includes(inSeg) ? (mv === 'R' ? 1 : 0) : mv === 'R' ? 3 : 2;
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
      const rr = Math.max(3.5, j.R - (multi ? 5 : 2.6));
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
    // a stretch of the approach before it and of the road beyond
    const pre: P[] = [];
    for (let s = Math.max(0, lineS - E_IN); s < lineS - 0.3; s += 2) pre.push(this.lanePoint(seg, from, s, lane));
    const post: P[] = [];
    const s1 = Math.min(Lo, outS + E_OUT);
    for (let s = outS + 2; s < s1 - 0.3; s += 2) post.push(this.lanePoint(next, node, s, exitLane));
    post.push(this.lanePoint(next, node, s1, exitLane));
    const track = new Track([...pre, ...turn, ...post]);
    const ext0 = track.cum[pre.length], ext1 = track.cum[pre.length + turn.length - 1];
    // as fast as each bend allows, slowing comfortably before the tight ones
    const env = new Float32Array(track.n).fill(40);
    for (let i = 0; i < track.n; i++) {
      const t = i * STEP;
      if (t < ext0 - 2 || t > ext1 + 2) continue;
      const p = track.at(t - 2), q = track.at(t + 2), dh = Math.acos(Math.max(-1, Math.min(1, p.hx * q.hx + p.hz * q.hz)));
      env[i] = Math.max(3.5, Math.min(15, dh > 1e-3 ? Math.sqrt(LAT * (4 / dh)) : 15));
    }
    for (let i = track.n - 2; i >= 0; i--) env[i] = Math.min(env[i], Math.sqrt(env[i + 1] ** 2 + 2 * 2 * STEP));
    const P: JPath = {
      track, ext0, ext1, node, inSeg: seg.id, from, lane, next: next.id, exitLane, move, slip, rank: this.rankOf(j, seg.id, move, slip),
      lineS, outS, inKey: keyOf(seg, from, lane), exitKey: keyOf(next, node, exitLane), env,
    };
    if (slip && j) {
      const inPts: P[] = [], outPts: P[] = [];
      for (let s = Math.max(0, lineS - 5); s <= Math.min(L, lineS + 45); s += 1) inPts.push(this.lanePoint(seg, from, s, lane));
      for (let s = Math.max(0, outS - 45); s <= Math.min(Lo, outS + 5); s += 1) outPts.push(this.lanePoint(next, node, s, exitLane));
      const leave = [ext1, ext1, ext1], gate = [ext0, ext0, ext0];
      for (const k of [0, 1, 2] as Cls[]) {
        for (let t = ext0; t <= ext1; t += 0.5) if (this.clearOfLane2(track, t, k, inPts)) { leave[k] = t; break; }
        for (let t = ext1; t >= ext0; t -= 0.5) if (this.clearOfLane2(track, t, k, outPts)) { gate[k] = t; break; }
      }
      P.leave = leave; P.gate = gate;
    }
    jd.paths.set(key, P);
    return P;
  }
  // Is a vehicle of class k at t along a course wholly to one side of a lane's traffic (anything
  // in that lane, of any size, with a little room to spare)?
  private clearOfLane2(track: Track, t: number, k: Cls, lane: P[]) {
    let side = 0;
    for (const r of track.body(k)[Math.max(0, Math.min(track.n - 1, Math.round(t / STEP)))]) {
      for (const [f, w] of [[r.hl, r.hw], [r.hl, -r.hw], [-r.hl, r.hw], [-r.hl, -r.hw]]) {
        const p = { x: r.x + r.hx * f - r.hz * w, z: r.z + r.hz * f + r.hx * w }, c = closestOnPath(p, lane);
        const sd = Math.sign((p.x - c.x) * c.uz - (p.z - c.z) * c.ux) * c.d;
        if (Math.abs(sd) < DIMS.bus.hw + 0.35 || (side && Math.sign(sd) !== side)) return false;
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
    const k = (A.id * 1048576 + B.id) * 9 + ca * 3 + cb;
    let t = this.tables.get(k);
    if (!t) { const tb = table(A, ca, B, cb); t = { a: new View(tb, true), b: new View(tb, false) }; this.tables.set(k, t); }
    return meA ? t.a : t.b;
  }
  // the vehicle's way through the junction at the end of its road, if there is one
  private planOf(c: Car): Plan | null {
    if (c.turn || c.gone !== undefined || c.inBay || (!c.bus && !c.route.length)) return null;
    const at = this.net.other(c.seg, c.from), jd = this.jdata(at);
    if (!jd) return null;
    const next = this.nextOf(c, at);
    if (!next) return null;
    const lane = this.laneIdx(c);
    const slip = !!jd.j?.slip && jd.j.slip.from === c.seg.id && jd.j.slip.to === next.id && lane === 0;
    const q = c.plan, bus = !!c.bus;
    if (q && q.jd === jd && q.seg === c.seg.id && q.from === c.from && q.lane === lane && q.next === next && q.slip === slip && q.bus === bus) return q;
    const path = this.pathFor(jd, c.seg, c.from, lane, next, slip, bus);
    if (!path) return null;
    return (c.plan = { seg: c.seg.id, from: c.from, lane, slip, bus, jd, path, node: at, next });
  }
  private nextOf(c: Car, at: number): RSeg | undefined {
    if (c.nextSeg === undefined || !this.net.segs.has(c.nextSeg)) {
      if (c.bus) {
        // anywhere but back, and not down a road that only leads off the map if there's a choice
        const g = this.adj(), opts = (g.get(at) ?? []).filter((e) => e.seg.id !== c.seg.id && this.net.def(e.seg).family !== 'Motorway');
        const on = opts.filter((e) => (g.get(e.to)?.length ?? 0) > 1), pick = on.length ? on : opts;
        c.nextSeg = (pick.length ? pick[Math.floor(this.rand() * pick.length)].seg : c.seg).id;
      } else c.nextSeg = c.route[0];
    }
    const n = c.nextSeg !== undefined ? this.net.segs.get(c.nextSeg) : undefined;
    return n && (n.a === at || n.b === at) ? n : undefined;
  }

  // Precedence between two vehicles in a junction: decided when the later one committed, otherwise
  // whoever committed first.
  private first(x: User, u: User) {
    if (x.c.before?.has(u.c.id)) return true;
    if (u.c.before?.has(x.c.id)) return false;
    if (x.adm !== u.adm) return x.adm < u.adm;
    return x.c.id < u.c.id;
  }
  // The limits other vehicles in the junction put on this one: how far along its path it may come.
  private junctionLimits(u: User, ob: Obstacle) {
    const list = this.users.get(u.path.node);
    if (!list) return;
    const me = u.c, cm = clsOf(me);
    for (const x of list) {
      if (x.c === me || (x.adm === Infinity && u.adm === Infinity) || !this.related(u.path, x.path)) continue;
      const vw = this.view(u.path, cm, x.path, clsOf(x.c));
      if (vw.empty || vw.apart(x.t, u.t)) continue;
      const limMe = vw.limitMe(x.t), limIt = vw.limitIt(u.t);
      // whoever is already where the other would have to wait goes first; otherwise precedence
      const eIt = x.t >= limIt, eMe = u.t >= limMe;
      let itFirst = eIt !== eMe ? eIt : this.first(x, u);
      // Precedence that isn't physical (who committed first, or who was let in) and has left us
      // both standing for a while gives way: we go first. It's standing still, so it can always
      // wait for us, and this breaks any circle of vehicles waiting on each other.
      if (itFirst && !eIt && me.wait > 3 && x.c.wait > 3 && u.adm !== Infinity) {
        (me.before ??= new Set()).add(x.c.id);
        x.c.before?.delete(me.id);
        this.stats.lapsed++;
        itFirst = false;
      }
      if (!itFirst) continue;
      const band = vw.limitMe(x.t + 2) - limMe > 1;
      ob(limMe - u.t, band ? x.v : 0, 0.5);
    }
  }
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
          if (jd.j?.form === 'signals' && !pl.path.slip && !this.greenFor(jd.j, seg.id, now)) continue;
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
    let q = q0, vq = c.v;
    out[0] = q;
    for (let k = 1; k <= 60; k++) {
      let cap = q0 + lead.gap + lead.v * k * dt, moving = lead.v > 0.5;
      for (const { vw, x } of yieldTo) {
        const p = x.t + x.v * k * dt;
        if (vw.apart(p, q)) continue;
        const lim = vw.limitMe(p);
        if (lim - 0.5 < cap) { cap = lim - 0.5; moving = x.v > 0.5 && vw.limitMe(p + 2) - lim > 1; }
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
  private keepsBehind(vw: View, x: User, q: Float32Array, c: Car, firm = false) {
    let p = x.t, vp = x.v, lim = vw.limitIt(q[0]);
    if (p >= lim || (firm && vp < 1)) return false; // it's already there (or stopped on the ring)
    if (lim - p < (vp * vp) / (2 * 2.5) + 1) return false; // it couldn't stop for us
    const buf = c.lorry || c.bus ? 1.8 : 1.3, dt = 0.2;
    for (let k = 1; k < q.length; k++) {
      const nl = vw.limitIt(q[k]);
      if (nl === Infinity) return true; // we're clear of its course
      const moving = nl - lim > 0.5 * (q[k] - q[k - 1]) && q[k] > q[k - 1];
      lim = nl;
      if (moving && !firm && lim - p < 3 + vp) vp = Math.max(0, vp - 1.5 * dt);
      p += vp * dt;
      if (p > lim - (moving && !firm ? 0.5 : 1 + vp * buf)) return false;
    }
    return true;
  }
  // Is there room in the exit lane for us, after everyone else already committed to it?
  private exitRoom(c: Car, P: JPath) {
    const b = this.buckets.get(P.exitKey);
    let free = 80;
    const e = this.aheadIn(b, P.outS - LONGEST, c, this.inbound(P));
    if (e) { const rear = e.pos - e.c.back - P.outS; free = Math.min(free, e.c.v > 2 ? rear + e.c.v * 2 : rear); } // (a vehicle getting away makes room as we come)
    for (const o of this.committed.get(P.exitKey) ?? []) if (o !== c) free -= o.front + o.back + 2;
    return free >= c.front + c.back + 1;
  }
  // May this vehicle commit to the junction now? Returns who it goes ahead of, or null to wait.
  private admit(c: Car, pl: Plan, now: number): number[] | null {
    const P = pl.path, j = pl.jd.j, node = pl.node;
    if (!j) return this.leaderFirst(c, P, node) ? [] : this.no(c, 'queue'); // a bend: just the queue, in order
    if (!this.leaderFirst(c, P, node)) return this.no(c, 'queue');
    if (j.form === 'signals' && !P.slip) {
      const st = this.signal(j, now);
      if (st.state === 'red' || !st.phases[st.phase].includes(c.seg.id)) return this.no(c, 'red');
      if (st.state === 'amber' && P.lineS - c.s - c.front > (c.v * c.v) / 7 + 1) return this.no(c, 'amber'); // stop if you can
    }
    if (!this.exitRoom(c, P)) return this.no(c, 'no room beyond');
    const me = c.uref.find((u) => u.path === P);
    if (!me) return this.no(c, 'not near');
    if (P.rank === 0) return [];
    // giving way: work out who we'd have to wait for, and whether everyone else could let us go first
    const ld = this.leader(keyOf(c.seg, c.from, this.laneIdx(c)), c.s, c);
    const lead = ld ? { gap: ld.pos - ld.c.back - c.s - c.front - 1, v: ld.c.v } : { gap: Infinity, v: 0 };
    const near = (x: User) => { const vw = this.view(P, clsOf(c), x.path, clsOf(x.c)); return vw.empty || vw.apart(x.t, me.t) ? null : { vw, x }; };
    const inside: { vw: View; x: User }[] = [], outside: { vw: View; x: User }[] = [];
    for (const x of this.users.get(node) ?? []) { if (x.c !== c && x.adm !== Infinity && this.related(P, x.path)) { const o = near(x); if (o) inside.push(o); } }
    for (const x of this.approaching(pl.jd, now)) { if (x.c !== c && (x.rank ?? 0) < P.rank && this.related(P, x.path)) { const o = near(x); if (o) outside.push(o); } }
    const yieldTo: { vw: View; x: User }[] = [], ring = j.form === 'roundabout' || j.form === 'mini';
    for (let it = 0; it < 5; it++) {
      const q = this.trajectory(c, P, me, lead, yieldTo, ring);
      if (!q) return this.no(c, `would be left standing${yieldTo.length ? ` behind #${yieldTo[yieldTo.length - 1].x.c.id}` : ''}`);
      // only commit once we'll be nosing over the line within a few seconds
      if (q[20] < P.ext0 - c.front + 1) return this.no(c, 'not moving off yet');
      // vehicles still on their way in have priority: we don't go unless they needn't slow for us
      for (const o of outside) if (!this.keepsBehind(o.vw, o.x, q, c)) return this.no(c, `gives way to #${o.x.c.id}`);
      // (on a roundabout, whoever is already going round has priority: we only go ahead of them
      // if they'd never know we had)
      const more = inside.filter((o) => !yieldTo.includes(o) && !this.keepsBehind(o.vw, o.x, q, c, ring && o.x.t > o.x.path.ext0 + 0.5));
      if (!more.length) return inside.filter((o) => !yieldTo.includes(o)).map((o) => o.x.c.id);
      yieldTo.push(...more);
    }
    return this.no(c, 'too busy');
  }
  private no(c: Car, why: string) { c.why = why; return null; }
  // the queue goes in order: nobody commits ahead of the vehicle in front of them in their lane
  private leaderFirst(c: Car, P: JPath, node: number) {
    const lead = this.leader(keyOf(c.seg, c.from, this.laneIdx(c)), c.s, c);
    return !(lead && lead.kind === 0 && !lead.c.turn && lead.c.admNode !== node && lead.c.seg === c.seg && lead.c.gone === undefined && lead.pos < P.lineS + 0.5);
  }
  private commitTo(c: Car, pl: Plan, before: number[]) {
    c.adm = ++this.admSeq; c.admNode = pl.node;
    for (const u of c.uref) if (u.path === pl.path) u.adm = c.adm;
    if (before.length) { c.before ??= new Set(); for (const id of before) c.before.add(id); }
    if (pl.path.lineS - c.s < 20) this.commit(pl.path.exitKey, c);
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
      const f = r.e.c, g = c.s - c.back - r.pos - f.front;
      if (g < 2 + f.v * 0.4 || idm(f.v, f.v0 ?? f.vmax, g, c.v, DRIVE[f.kind]) < -(must ? 3.5 : 1.5)) return false;
    }
    return true;
  }
  private change(c: Car, to: number, now: number) {
    this.stats.laneChanges++;
    c.oldLane = c.lane;
    c.lane = to;
    c.plan = undefined;
    c.merge = undefined;
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
      if (Math.abs(c.off - this.laneOff(c.seg, c.from, c.s, c.lane)) < 1.0) c.oldLane = undefined;
      else return;
    }
    if (n < 2) { c.merge = undefined; return; }
    if (now < (c.lcAt ?? 0)) return;
    c.lcAt = now + 300 + this.rand() * 300;
    // lanes we have to leave: one that's ending, or one not marked for where we're going
    let want: number | undefined, by = Infinity;
    const sp = this.span(c.seg, c.from, c.lane);
    if (sp[1] < L - 0.5 && sp[1] - c.s < 250) { want = c.lane - 1; by = sp[1] - c.front; }
    let allowed: number[] = [];
    if (pl && pl.path.lineS - c.s < 200) {
      allowed = this.allowedLanes(pl, c);
      if (allowed.length && !allowed.includes(c.lane)) {
        const tgt = allowed.reduce((b, i) => (Math.abs(i - c.lane) < Math.abs(b - c.lane) ? i : b), allowed[0]);
        want = tgt > c.lane ? c.lane + 1 : c.lane - 1;
        by = Math.min(by, c.s + Math.min(this.roomIn(c, c.lane), this.roomIn(c, want)) - 6);
      }
    }
    if (want !== undefined) {
      if (c.s < by && this.canChange(c, want, true)) { this.change(c, want, now); return; }
      // ask to be let in; too late to get across for a turn: go the way this lane goes
      c.merge = by - c.s < 80 ? want : undefined;
      if (pl && c.s >= by - 3 && allowed.length && !allowed.includes(c.lane)) this.reroute(c, pl);
      return;
    }
    c.merge = undefined;
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
  private reroute(c: Car, pl: Plan) {
    const j = pl.jd.j, marks = j?.lanes[c.seg.id]?.[c.lane], inLeg = pl.jd.legs.find((l) => l.seg.id === c.seg.id);
    if (!marks || !inLeg || !c.dest) return;
    let best: { seg: RSeg; route: number[]; goal: number; entry: number; cost: number } | null = null;
    for (const leg of pl.jd.legs) {
      if (leg === inLeg || !marks.includes(moveOf(inLeg, leg))) continue;
      const r = this.planVia(pl.node, leg.seg, c.dest);
      if (r && (!best || r.cost < best.cost)) best = { seg: leg.seg, ...r };
    }
    if (!best) return;
    const lo = this.startGuard(c.dest.seg, best.entry), hi = this.endGuard(c.dest.seg, best.entry);
    c.nextSeg = best.seg.id; c.route = best.route; c.goal = hi > lo ? Math.max(lo, Math.min(hi, best.goal)) : best.goal;
    c.plan = undefined; c.merge = undefined;
    this.stats.rerouted++;
  }
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
        const ok = this.admit(c, pl, now);
        const signals = pl.jd.j?.form === 'signals' && !pl.path.slip;
        // at the lights, only once we're too close to stop if they change
        const close = pl.path.lineS - c.s - c.front <= Math.max(2.5, (c.v * c.v) / 6 + c.v * 0.3);
        if (ok && (!signals || close)) { this.commitTo(c, pl, ok); admitted = true; }
        else if (!ok) hold = true;
      } else if (pl.jd.j && !this.exitRoom(c, pl.path) && pl.path.lineS - c.s - c.front > (c.v * c.v) / 6 + 0.5) hold = true;
    }
    if (pl) v0 = Math.min(v0, Math.sqrt(spd(pl.path, pl.path.ext0) ** 2 + 4 * Math.max(0, pl.path.lineS - c.s)));
    // everything in the way, as the gentlest acceleration that respects all of it
    let acc = idmFree(c.v, v0, dr), gmin = Infinity;
    const ob: Obstacle = (g, vl, s0 = dr.s0) => { acc = Math.min(acc, idm(c.v, v0, g, vl, dr, s0)); gmin = Math.min(gmin, g); };
    const still = c.bus ? this.busStops(c, dt, ob) : false;
    if (c.inBay) {
      const e = this.leader(keyOf(c.seg, c.from, BAYLANE), c.s, c);
      if (e) ob(e.pos - e.c.back - c.s - c.front, e.c.v);
    } else {
      // the vehicle ahead in this lane (and the one we're moving out from behind)
      const e = this.leader(keyOf(c.seg, c.from, this.laneIdx(c)), c.s, c);
      if (e) ob(e.pos - e.c.back - c.s - c.front, e.c.v);
      if (c.oldLane !== undefined) { const o = this.leader(keyOf(c.seg, c.from, c.oldLane), c.s, c); if (o) ob(o.pos - o.c.back - c.s - c.front, o.c.v); }
      if (c.bus) { const o = this.leader(keyOf(c.seg, c.from, BAYLANE), c.s, c); if (o && o.pos - c.s < 40) ob(o.pos - o.c.back - c.s - c.front, o.c.v); }
      this.squeezed(c, ob);
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
      if (hold && pl) ob(pl.path.lineS - c.s - c.front, 0, 0.3);
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

  // Where a road narrows, the lane that's going and the one beside it close in until there isn't
  // room for two abreast: there, whoever is ahead in either lane is in front of us.
  private squeezed(c: Car, ob: Obstacle) {
    const x = this.info(c.seg);
    if ((!x.ends.A && !x.ends.B) || this.laneIdx(c) === BUSLANE) return;
    const me = DIMS[c.kind].hw;
    for (const l of [c.lane - 1, c.lane + 1]) {
      if (l < 0 || l >= this.net.def(c.seg).lanes) continue;
      const e = this.leader(keyOf(c.seg, c.from, l), c.s - c.back, c);
      if (!e || e.pos - e.c.back - c.s - c.front > 30) continue;
      // how far apart the two lanes are where we'd be alongside
      const at = Math.max(c.s + c.front, e.pos - e.c.back);
      const apart = Math.abs(this.laneOff(c.seg, c.from, at, l) - this.laneOff(c.seg, c.from, at, c.lane));
      if (apart < me + DIMS[e.c.kind].hw + 0.4) ob(e.pos - e.c.back - c.s - c.front, e.c.v);
    }
  }
  // Buses call at their stops; at a lay-by they pull right out of the traffic, and wait for a gap to rejoin it.
  private busStops(c: Car, dt: number, ob: Obstacle) {
    if (c.inBay) {
      if (c.dwell !== undefined) {
        c.dwell -= dt;
        if (c.dwell <= 0) { c.served = c.bay?.id; c.dwell = undefined; }
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
      if (c.dwell <= 0) { c.served = ns.st.id; c.dwell = undefined; }
      return true;
    }
    if (ns.st.kind === 'layby') {
      c.bay = ns.st;
      // it's out of the lane once its side is clear of anything in the lane
      if (c.off - this.laneOff(c.seg, c.from, c.s, this.laneIdx(c)) >= 2.6) { c.inBay = true; if (c.entry) c.entry.kind = 3; }
    }
    if (togo < 60) ob(togo, 0, 0.2);
    if (togo < 0.8 && c.v < 0.6) c.dwell = this.onBusStop?.(c.seg, ns.st, c.id) ?? 7;
    return false;
  }
  // nothing in the lane right alongside a bus waiting to pull out of a lay-by
  private clearOfLane(c: Car) {
    const b = this.buckets.get(keyOf(c.seg, c.from, this.laneIdx(c))) ?? [];
    return !b.some((e) => e.c !== c && e.pos + e.c.front > c.s - c.back - 2 && e.pos - e.c.back < c.s + c.front + 2);
  }
  // A bus at the end of a dead end turns round, once the other side is clear.
  private uTurn(c: Car, at: number) {
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
    c.s -= L; c.seg = next; c.from = at; c.nextSeg = undefined; c.served = undefined; c.plan = undefined; c.oldLane = undefined; c.merge = undefined;
    c.lane = c.bus ? 0 : this.mapLane(next, at, c.lane);
    c.entry = this.put(keyOf(next, at, this.laneIdx(c)), c, c.s, 0, true);
  }
  private enter(c: Car, pl: Plan) {
    const P = pl.path;
    c.turn = { path: P, t: P.ext0 + (c.s - P.lineS), node: pl.node, next: pl.next };
    c.merged = false;
    if (!c.bus) c.route.shift();
    c.plan = undefined; c.oldLane = undefined; c.merge = undefined; c.nextSeg = undefined;
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
    const ob: Obstacle = (g, vl, s0 = dr.s0) => { acc = Math.min(acc, idm(c.v, v0, g, vl, dr, s0)); gmin = Math.min(gmin, g); };
    for (const u of c.uref) this.junctionLimits(u, ob);
    // a slip road: until it's clear of the lane it's leaving, it follows the traffic in that lane
    if (P.leave && T.t < P.leave[clsOf(c)]) {
      const here = P.lineS + (T.t - P.ext0), e = this.aheadIn(this.buckets.get(P.inKey), here, c);
      if (e) ob(e.pos - e.c.back - here - c.front, e.c.v);
    }
    // and gives way to the road it joins
    if (P.gate && !c.merged) {
      const g = P.gate[clsOf(c)];
      if (T.t >= g - 1 && this.mayMerge(c, P)) {
        c.merged = true;
        this.put(P.exitKey, c, P.outS - (P.ext1 - T.t), 2, true);
      } else ob(g - T.t, 0, 0.3);
    }
    if (P.gate === undefined || c.merged) {
      // what's in the lane we're heading into, and beyond
      const mine = P.outS - (P.ext1 - T.t);
      const e = this.aheadIn(this.buckets.get(P.exitKey), mine, c, this.inbound(P));
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
  addTrain(kind: string) {
    const def = TRAINS[kind];
    const segs = [...this.net.segs.values()].filter((s) => this.trackOk(def, s));
    if (!segs.length) return false;
    const seg = segs[Math.floor(this.rand() * segs.length)];
    this.trains.push({ def, seg, from: seg.a, s: Math.min(this.len(seg) - 1, def.cars * (def.carLen + 1)), v: 0, trail: [], col: new THREE.Color(def.color) });
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
      const target = trainSpeed(tr.def, d, q.grade);
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

  private place(x: number, y: number, z: number, heading: number, pitch: number, k = 1) {
    this.e.set(0, -heading, pitch);
    this.q.setFromEuler(this.e);
    this.m4.compose(this.v3.set(x, y, z), this.q, this.sc.set(Math.max(0.01, k), Math.max(0.01, k), Math.max(0.01, k)));
    return this.m4;
  }
  private draw(dt: number, now: number) {
    const net = this.net;
    let nc = 0, nl = 0, nb = 0;
    for (const c of this.cars) {
      let x: number, z: number, y: number, grade = 0, at: (d: number) => { x: number; z: number };
      if (c.turn) {
        // in a junction the vehicle sits exactly where its conflicts were worked out
        const tr = c.turn.path.track, t = c.turn.t, q = tr.at(t);
        x = q.x; z = q.z; y = q.y;
        at = (d) => tr.point(t + d);
      } else {
        const L = this.len(c.seg), path = this.pathOf(c.seg, c.from), q = pointAt(path, Math.min(c.s, L));
        // lane position, easing across on lane changes; buses swing into lay-bys
        let want = this.laneOff(c.seg, c.from, c.s, this.laneIdx(c));
        if (c.bus && c.bay && (c.inBay || c.served !== c.bay.id)) want += BAY.depth * bayWeight(c.bay, c.from === c.seg.a ? c.s : L - c.s);
        c.off += (want - c.off) * Math.min(1, dt * 3);
        x = q.x + q.uz * c.off; z = q.z - q.ux * c.off; y = q.y; grade = q.grade;
        const off = c.off, s = c.s;
        // near a junction (or bend) the body follows the course through it, as its conflicts do;
        // elsewhere the lane, carried straight on past the road's ends
        const pl = c.plan && c.plan.path.lineS - s < E_IN && c.plan.path.inSeg === c.seg.id ? c.plan.path : undefined;
        const af = c.after && c.after.path.next === c.seg.id && c.after.path.exitLane === this.laneIdx(c) && c.s - c.after.path.outS < E_OUT ? c.after.path : undefined;
        const onCourse = Math.abs(off - want) < 0.3;
        if (onCourse && pl) { const tr = pl.track, t = pl.ext0 - (pl.lineS - s); at = (d) => tr.point(t + d); }
        else if (onCourse && af) { const tr = af.track, t = af.ext1 + (s - af.outS); at = (d) => tr.point(t + d); }
        else at = (d) => {
          const r = s + d, p = pointAt(path, Math.max(0, Math.min(L, r))), o = r < 0 ? r : r > L ? r - L : 0;
          return { x: p.x + p.uz * off + p.ux * o, z: p.z - p.ux * off + p.uz * o };
        };
      }
      const k = Math.min(1, Math.max(0, (now - c.born) / 500), c.gone !== undefined ? 1 - (now - c.gone) / 600 : 1);
      const pose = (c.pose ??= { x, z, y, k, kind: c.kind, id: c.id, parts: [] }), parts = bodyOf(c.kind, at, k, pose.parts);
      pose.x = x; pose.z = z; pose.y = y; pose.k = k;
      c.heading = Math.atan2(parts[0].hz, parts[0].hx);
      // each part is placed along its own chord (a lorry's trailer follows its cab round a bend)
      const put = (r: Rect, local: number) => this.place(r.x - r.hx * local * k, y + 0.25, r.z - r.hz * local * k, Math.atan2(r.hz, r.hx), Math.atan(grade), k);
      if (c.bus && nb < 40) { const m = put(parts[0], 0); for (const i of [this.busBody, this.busWin, this.busRoof]) i.setMatrixAt(nb, m); this.busBody.setColorAt(nb, c.col); nb++; }
      else if (c.lorry && nl < 80) { this.trailer.setMatrixAt(nl, put(parts[0], -1.4)); this.trailer.setColorAt(nl, c.col); this.cab.setMatrixAt(nl, put(parts[1], 5.4)); nl++; }
      else if (!c.lorry && !c.bus && nc < MAX) { const m = put(parts[0], 0); for (const i of [this.carBody, this.carBase, this.carCab]) i.setMatrixAt(nc, m); this.carBody.setColorAt(nc, c.col); nc++; }
    }
    // trains: carriages spaced along the track behind the front
    let nt = 0;
    for (const tr of this.trains) for (let i = 0; i < tr.def.cars && nt < 160; i++) {
      const back = i * (tr.def.carLen + 1) + tr.def.carLen / 2;
      const { q, seg } = this.along(tr, back);
      const off = net.def(seg).tracks === 2 ? 2 : 0;
      const m = this.place(q.x + q.uz * off, q.y + 0.6, q.z - q.ux * off, Math.atan2(q.uz, q.ux), Math.atan(q.grade));
      m.scale(this.sc.set(tr.def.carLen / 20, 1, 1));
      for (const im of [this.trainBody, this.trainWin, this.trainRoof]) im.setMatrixAt(nt, m);
      this.trainBody.setColorAt(nt, tr.col);
      this.trainWin.setColorAt(nt, this.stripe.set(tr.def.stripe));
      nt++;
    }
    this.carBody.count = this.carBase.count = this.carCab.count = nc;
    this.trailer.count = this.cab.count = nl;
    this.busBody.count = this.busWin.count = this.busRoof.count = nb;
    this.trainBody.count = this.trainWin.count = this.trainRoof.count = nt;
    for (const i of [this.carBody, this.carBase, this.carCab, this.trailer, this.cab, this.busBody, this.busWin, this.busRoof, this.trainBody, this.trainWin, this.trainRoof]) { i.instanceMatrix.needsUpdate = true; if (i.instanceColor) i.instanceColor.needsUpdate = true; }
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
      out.push(`${itFirst ? 'held by' : 'holds'} #${x.c.id}(${x.path.move} t=${x.t.toFixed(1)} adm=${x.adm === Infinity ? '-' : x.adm}) gap=${((itFirst ? limMe : limIt) - (itFirst ? u.t : x.t)).toFixed(1)}${eIt ? ' it-engaged' : ''}${eMe ? ' me-engaged' : ''}${c.before?.has(x.c.id) ? ' (I go first)' : ''}${x.c.before?.has(c.id) ? ' (it goes first)' : ''}`);
    }
    return `#${id} adm=${c.adm ?? '-'} ${c.admNode === undefined ? `(waiting: ${c.why ?? '?'}) ` : ''}users=${c.uref.map((u) => `${u.path.node}:${u.path.move}@${u.t.toFixed(1)}`).join(',')} :: ${out.join('; ')}`;
  }

  get live() { return this.cars.filter((c) => c.gone === undefined && !c.bus).length; }
  get buses() { return this.cars.filter((c) => c.bus).length; }
}

// How busy the roads are through the day: two rush hours, a lunchtime bump, quiet nights.
export function demand(h: number) {
  if (h < 5 || h >= 23.5) return 0.08;
  return 0.22 + Math.exp(-(((h - 8.2) / 1.1) ** 2)) + 0.9 * Math.exp(-(((h - 17.4) / 1.3) ** 2)) + 0.35 * Math.exp(-(((h - 13) / 2) ** 2));
}
export const rushLabel = (h: number) => (h >= 7 && h < 9.5 ? 'morning rush' : h >= 16.3 && h < 18.7 ? 'evening rush' : h < 5 || h >= 23 ? 'night' : '');
export type { P };
