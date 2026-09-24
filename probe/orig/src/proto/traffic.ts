// Background traffic: cars and lorries that aren't part of the game, but come from the city.
// Every trip starts at a real building (a home, a job, a shop, a works) or at a road leading off
// the map, is routed over the road network, and ends by turning in at its destination.
// Cars follow the car in front and take turns through junctions, so busy roads queue.
import * as THREE from 'three';
import { BAY, bayWeight, closestOnPath, pathLength, pointAt, type Lot, type Network, type P, type RSeg, type Stop } from './roads';
import { legsAt, moveOf, type Junction, type Move } from './junction';
import { TRAINS, trainSpeed, type TrainDef } from './catalog';

export interface Places { homes: Lot[]; jobs: Lot[]; shops: Lot[]; works: Lot[]; weight: (l: Lot) => number }

interface Car {
  seg: RSeg; from: number; s: number; v: number; vmax: number;
  route: number[]; // seg ids still to drive, after the current one
  goal: number; // stop at this distance along the last seg
  lorry: boolean; col: THREE.Color; heading: number;
  born: number; gone?: number; wait: number; claim?: number;
  lane: number; off: number; // lane (0 = nearside) and current sideways position
  bus?: boolean; dwell?: number; served?: number; inBay?: boolean;
  nextSeg?: number; laneLocked?: boolean;
  // crossing a junction on a turn path
  turn?: { node: number; next: RSeg; pts: P[]; t: number; outS: number; exitLane: number; move: Move; slip: boolean; sectors?: number[]; sectorLen?: number };
  turnFrom?: number; turnMove?: Move; sectors?: number[];
}
interface Train { def: TrainDef; seg: RSeg; from: number; s: number; v: number; trail: { seg: RSeg; from: number }[]; col: THREE.Color; gone?: boolean }
interface Access { seg: RSeg; s: number }

const MAX = 300;
const CAR_COLS = ['#c9302c', '#2f6fb8', '#f2f2f2', '#2b2b2b', '#8d8f93', '#e0a526', '#5a8f4a', '#6b2f4a', '#b8bcbf', '#f2f2f2', '#1f3f6a'];
const LORRY_COLS = ['#f2f2f2', '#b0463a', '#2f6f9e', '#d69a2d', '#3f7a4a'];

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
  private inJ = new Map<number, Car[]>();
  private sig = new Map<number, { legs: string; phases: number[][]; greens: number[]; t0: number }>();
  private gradeCache = new Map<number, number>();
  private rand: () => number;
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
    this.access.clear();
    this.gradeCache.clear();
    for (const c of this.cars) if (!this.net.segs.has(c.seg.id) || c.route.some((id) => !this.net.segs.has(id))) c.gone ??= performance.now();
  }

  private adj() {
    if (this.graph) return this.graph;
    const g = new Map<number, { seg: RSeg; to: number; len: number }[]>();
    for (const s of this.net.segs.values()) {
      if (this.net.def(s).cls !== 'road') continue;
      const len = this.net.length(s);
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
    const out: Access[] = [];
    for (const [id, list] of this.adj()) {
      const n = this.net.node(id);
      if (list.length === 1 && Math.hypot(n.x, n.z) > 180) out.push({ seg: list[0].seg, s: list[0].seg.a === id ? 1 : this.net.length(list[0].seg) - 1 });
    }
    return out;
  }

  // Shortest route from a point on one road to a point on another.
  private plan(o: Access, d: Access) {
    const L0 = this.net.length(o.seg), L1 = this.net.length(d.seg);
    if (o.seg.id === d.seg.id) {
      return d.s > o.s ? { from: o.seg.a, s: o.s, route: [], goal: d.s } : { from: o.seg.b, s: L0 - o.s, route: [], goal: L0 - d.s };
    }
    const g = this.adj();
    const dist = new Map<number, number>(), prev = new Map<number, { node: number; seg: RSeg }>(), first = new Map<number, number>();
    // leaving towards a means we drive from b; towards b, from a
    dist.set(o.seg.a, o.s); first.set(o.seg.a, o.seg.b);
    dist.set(o.seg.b, Math.min(dist.get(o.seg.b) ?? Infinity, L0 - o.s));
    if ((dist.get(o.seg.b) ?? Infinity) === L0 - o.s) first.set(o.seg.b, o.seg.a);
    const open = new Set([o.seg.a, o.seg.b]), done = new Set<number>();
    while (open.size) {
      let u = -1, du = Infinity;
      for (const n of open) { const v = dist.get(n)!; if (v < du) { du = v; u = n; } }
      open.delete(u); done.add(u);
      if (du > 3000) break;
      for (const e of g.get(u) ?? []) {
        if (e.seg.id === o.seg.id || done.has(e.to)) continue;
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
    const from = first.get(entry)!;
    return { from, s: from === o.seg.a ? o.s : L0 - o.s, route: segs, goal: entry === d.seg.a ? d.s : L1 - d.s };
  }

  private spawn(o: Access, d: Access, lorry: boolean, now: number) {
    const p = this.plan(o, d);
    if (!p) return;
    const col = new THREE.Color(lorry ? LORRY_COLS[Math.floor(this.rand() * LORRY_COLS.length)] : CAR_COLS[Math.floor(this.rand() * CAR_COLS.length)]);
    const lanes = this.net.def(o.seg).lanes;
    const lane = lorry || lanes === 1 ? 0 : Math.floor(this.rand() * lanes);
    this.cars.push({ seg: o.seg, from: p.from, s: p.s, v: 0, vmax: lorry ? 25 : 28 + this.rand() * 5, route: p.route, goal: p.goal, lorry, col, heading: 0, born: now, wait: 0, lane, off: this.laneOff(o.seg, lane) });
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
    const live = this.cars.filter((c) => !c.gone).length;
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
    if (!segs.length) return;
    const seg = segs[Math.floor(this.rand() * segs.length)];
    this.cars.push({
      seg, from: this.rand() < 0.5 ? seg.a : seg.b, s: this.rand() * this.net.length(seg), v: 0, vmax: 11, route: [], goal: Infinity, lorry: false, bus: true,
      col: new THREE.Color(this.rand() < 0.5 ? '#c9302c' : '#e8a21f'), heading: 0, born: performance.now(), wait: 0, lane: 0, off: 0,
    });
  }

  // general-traffic lane centres; buses use the bus lane where there is one
  private laneOff(s: RSeg, lane: number, bus = false) {
    const d = this.net.def(s);
    if (bus && d.bus) return d.median / 2 + d.lanes * d.lane + d.bus / 2;
    return d.lanes > 1 ? d.median / 2 + (d.lanes - 1 - lane + 0.5) * d.lane : d.median / 2 + d.lane / 2;
  }
  private nextStop(c: Car) {
    const L = this.net.length(c.seg), side = c.from === c.seg.a ? 1 : -1;
    let best: { st: Stop; at: number } | null = null;
    for (const st of c.seg.stops) {
      if (st.side !== side || st.id === c.served) continue;
      const at = side === 1 ? st.s : L - st.s;
      if (at > c.s - 1 && (!best || at < best.at)) best = { st, at };
    }
    return best;
  }

  // ---------- junctions ----------
  private leg(node: number, seg: RSeg) { return legsAt(this.net, node).find((l) => l.seg.id === seg.id); }
  // how far from the junction centre traffic stops, and where it rejoins the road beyond
  private reachOf(j: Junction | undefined, node: number, seg: RSeg) {
    if (!j || j.form === 'join') return 0;
    const core = j.form === 'roundabout' || j.form === 'mini' ? j.R + 1.5 : this.net.nodeHalf(node) + 1;
    return Math.max(core, j.reach[seg.id] ?? 0);
  }
  private signal(j: Junction, now: number) {
    let s = this.sig.get(j.node);
    if (!s || s.legs !== j.legs.join()) {
      const legs = legsAt(this.net, j.node), ids = legs.map((l) => l.seg.id);
      const phases = legs.length === 3 ? [j.major, ids.filter((id) => !j.major.includes(id))] : [ids.filter((_, i) => i % 2 === 0), ids.filter((_, i) => i % 2 === 1)];
      // green time in proportion to the busiest approach in each phase
      const load = phases.map((ph) => Math.max(1, ...ph.map((id) => Object.entries(j.flows).filter(([k]) => k.startsWith(`${id}>`)).reduce((t, [, v]) => t + v, 0))));
      const tot = load.reduce((t, v) => t + v, 0);
      s = { legs: j.legs.join(), phases, greens: load.map((v) => 8 + (40 * v) / tot), t0: now };
      this.sig.set(j.node, s);
    }
    const cyc = s.greens.reduce((t, g) => t + g + 4, 0);
    let t = ((now - s.t0) / 1000) % cyc;
    for (let i = 0; i < s.phases.length; i++) {
      if (t < s.greens[i]) return { phase: i, amber: false, phases: s.phases };
      if (t < s.greens[i] + 4) return { phase: i, amber: true, phases: s.phases };
      t -= s.greens[i] + 4;
    }
    return { phase: 0, amber: false, phases: s.phases };
  }
  // what a signal head on this approach shows now (for drawing)
  lightFor(node: number, seg: number, now: number): 'red' | 'amber' | 'green' {
    const j = this.junctions.get(node);
    if (!j || j.form !== 'signals') return 'red';
    const st = this.signal(j, now);
    const on = st.phases[st.phase].includes(seg);
    return on ? (st.amber ? 'amber' : 'green') : 'red';
  }
  // May this car go into the junction now?
  private mayEnter(c: Car, j: Junction, node: number, next: RSeg, mv: Move, now: number) {
    const inside = this.inJ.get(node) ?? [];
    if (j.form === 'merge' || j.form === 'join') return true;
    if (j.form === 'signals') {
      const st = this.signal(j, now);
      if (!st.phases[st.phase].includes(c.seg.id) || st.amber) return false;
      // right-turners give way to oncoming traffic already crossing
      return mv !== 'R' || !inside.some((o) => o.turnMove !== 'R' && o.turnFrom !== c.seg.id);
    }
    if (j.form === 'priority') {
      const major = j.major.includes(c.seg.id);
      if (major && mv !== 'R') return true;
      // minor roads (and right turns off the major road) wait for a clear junction
      return inside.every((o) => o.turnFrom === c.seg.id && o.turnMove === mv);
    }
    // roundabouts: give way to traffic already circulating across your path
    const legs = legsAt(this.net, node).map((l) => l.seg.id), n = legs.length;
    const i = legs.indexOf(c.seg.id), k = legs.indexOf(next.id);
    const arc = new Set<number>();
    for (let q = i; q !== k; q = (q + 1) % n) arc.add(q);
    arc.add((i - 1 + n) % n); // the car coming round towards you
    return inside.every((o) => !(o.sectors ?? []).some((x) => arc.has(x)));
  }
  // The path through the junction, from this lane to the exit lane: a curve, or round the island.
  private turnPath(c: Car, j: Junction, node: number, next: RSeg, exitLane: number, slip: boolean) {
    const n = this.net.node(node), inR = this.reachOf(j, node, c.seg), outR = this.reachOf(j, node, next);
    const inP = this.net.pathFrom(c.seg, c.from), L = this.net.length(c.seg);
    if (slip && j.slip) {
      const sp = j.slip.path, outL = this.net.pathFrom(next, node);
      const d = closestOnPath(sp[sp.length - 1], outL).s;
      return { pts: [...sp], outS: d };
    }
    const a = pointAt(inP, L - inR), offA = this.laneOff(c.seg, c.lane, c.bus);
    const A = { x: a.x + a.uz * offA, z: a.z - a.ux * offA };
    const outP = this.net.pathFrom(next, node), b = pointAt(outP, outR), offB = this.laneOff(next, exitLane, c.bus);
    const B = { x: b.x + b.uz * offB, z: b.z - b.ux * offB };
    const pts: P[] = [A];
    if (j.form === 'roundabout' || j.form === 'mini') {
      // round the island (clockwise from above: we keep it on our right)
      const rr = Math.max(3.5, j.R - (this.net.def(c.seg).lanes > 1 && c.lane > 0 ? 5 : 2.6));
      let t0 = Math.atan2(A.z - n.z, A.x - n.x), t1 = Math.atan2(B.z - n.z, B.x - n.x);
      while (t1 <= t0 + 0.2) t1 += Math.PI * 2;
      const steps = Math.max(3, Math.ceil((t1 - t0) / 0.2));
      for (let i = 1; i < steps; i++) { const t = t0 + ((t1 - t0) * i) / steps; pts.push({ x: n.x + Math.cos(t) * rr, z: n.z + Math.sin(t) * rr }); }
    } else {
      // a smooth curve whose ends follow the lanes it joins
      const k = Math.hypot(B.x - A.x, B.z - A.z) * 0.45;
      const c1 = { x: A.x + a.ux * k, z: A.z + a.uz * k }, c2 = { x: B.x - b.ux * k, z: B.z - b.uz * k };
      for (let i = 1; i < 8; i++) { const t = i / 8, u = 1 - t; pts.push({ x: u * u * u * A.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * B.x, z: u * u * u * A.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * B.z }); }
    }
    pts.push(B);
    return { pts, outS: outR };
  }

  update(dt: number, now: number) {
    const net = this.net;
    this.inJ.clear();
    for (const c of this.cars) if (c.turn) { let l = this.inJ.get(c.turn.node); if (!l) this.inJ.set(c.turn.node, (l = [])); l.push(c); }
    // who is ahead of whom in each lane (a bus pulled into a lay-by is out of the way)
    const lanes = new Map<string, Car[]>();
    for (const c of this.cars) {
      if (c.inBay || c.turn) continue;
      const k = `${c.seg.id}:${c.from}:${c.bus && net.def(c.seg).bus ? 'b' : c.lane}`;
      let l = lanes.get(k);
      if (!l) lanes.set(k, (l = []));
      l.push(c);
    }
    for (const l of lanes.values()) l.sort((a, b) => a.s - b.s);
    const clear = (c: Car, lane: number) => !(lanes.get(`${c.seg.id}:${c.from}:${lane}`) ?? []).some((o) => Math.abs(o.s - c.s) < 12);

    for (const c of this.cars) {
      if (c.gone) continue;
      // ---- in a junction: follow the turn path ----
      if (c.turn) {
        const T = c.turn, tl = pathLength(T.pts);
        const vt = T.slip ? 9 : T.move === 'S' ? 11 : 7;
        c.v += Math.max(-8 * dt, Math.min(3 * dt, Math.min(vt, c.vmax) - c.v));
        T.t += c.v * dt;
        // roundabout sectors behind the car are freed as it goes round
        if (T.sectors && T.sectorLen) c.sectors = T.sectors.slice(Math.min(T.sectors.length - 1, Math.floor(T.t / T.sectorLen)));
        if (T.t >= tl) { c.seg = T.next; c.from = T.node; c.s = T.outS; c.lane = T.exitLane; c.turn = undefined; c.sectors = undefined; c.turnFrom = undefined; c.turnMove = undefined; c.served = undefined; c.nextSeg = undefined; }
        continue;
      }
      const L = net.length(c.seg), d = net.def(c.seg);
      const last = !c.bus && !c.route.length;
      let target = Math.min(c.vmax, d.speed * (c.lorry || c.bus ? 0.8 : 1));
      const key = `${c.seg.id}:${c.from}:${c.bus && d.bus ? 'b' : c.lane}`;
      const l = c.inBay ? [] : lanes.get(key) ?? [];
      const ahead = l[l.indexOf(c) + 1];
      if (ahead && !ahead.gone) {
        const gap = ahead.s - c.s - (ahead.lorry || ahead.bus ? 13 : 7);
        target = Math.min(target, Math.max(0, gap * 0.9));
        if (d.lanes > 1 && gap < 20 && ahead.v < 2 && !c.bus && !c.laneLocked) {
          const to = c.lane > 0 ? c.lane - 1 : c.lane + 1;
          if (to < d.lanes && clear(c, to)) c.lane = to;
        }
      }
      if (last) target = Math.min(target, Math.max(2, (c.goal - c.s) * 0.8));
      if (c.bus) {
        const ns = this.nextStop(c);
        c.inBay = false;
        if (ns) {
          const togo = ns.at - c.s;
          if (ns.st.kind === 'layby') c.inBay = bayWeight(ns.st, c.from === c.seg.a ? c.s : L - c.s) > 0.4;
          if (c.dwell !== undefined) {
            target = 0;
            c.dwell -= dt;
            if (c.dwell <= 0) { c.served = ns.st.id; c.dwell = undefined; }
          } else if (togo < 30) {
            target = Math.min(target, Math.max(0, togo * 0.6));
            if (togo < 0.8 && c.v < 0.6) c.dwell = 7;
          }
        }
      }
      // ---- approaching the junction at the end of this road ----
      const at = net.other(c.seg, c.from);
      const j = this.junctions.get(at);
      if (!last) {
        if (c.nextSeg === undefined || !net.segs.has(c.nextSeg)) {
          if (c.bus) {
            const opts = (this.adj().get(at) ?? []).map((e) => e.seg).filter((s) => s.id !== c.seg.id && net.def(s).family !== 'Motorway');
            c.nextSeg = (opts.length ? opts[Math.floor(this.rand() * opts.length)] : c.seg).id;
          } else c.nextSeg = c.route[0];
        }
        const next = c.nextSeg !== undefined ? net.segs.get(c.nextSeg) : undefined;
        if (!next) { c.gone ??= now; continue; }
        const inLeg = this.leg(at, c.seg), outLeg = this.leg(at, next);
        const mv: Move = inLeg && outLeg ? moveOf(inLeg, outLeg) : 'S';
        const reach = this.reachOf(j, at, c.seg);
        const toLine = L - reach - c.s;
        // get into a lane that's marked for where we're going
        const allowed = j?.lanes[c.seg.id]?.map((m, i) => (m.includes(mv) ? i : -1)).filter((i) => i >= 0) ?? [];
        if (allowed.length && !allowed.includes(c.lane) && toLine < 120 && !c.bus) {
          const want = allowed.reduce((b, i) => (Math.abs(i - c.lane) < Math.abs(b - c.lane) ? i : b), allowed[0]);
          const step = want > c.lane ? c.lane + 1 : c.lane - 1;
          if (clear(c, step)) c.lane = step;
          else if (toLine < 20) target = Math.min(target, 2); // wait for a gap to move across
        }
        c.laneLocked = toLine < 40;
        // a slip lane peels off before the junction
        const slipHere = !!j?.slip && j.slip.from === c.seg.id && j.slip.to === next.id;
        const slipAt = slipHere ? L - closestOnPath(j!.slip!.path[0], net.pathFrom(c.seg, c.from)).s : 0;
        if (slipHere && L - c.s <= slipAt + 0.5 && c.lane === 0) { this.enter(c, j!, at, next, mv, true, now); continue; }
        if (j && j.form !== 'join') {
          if (toLine < 10 && !this.mayEnter(c, j, at, next, mv, now)) target = Math.min(target, Math.max(0, (toLine - 0.5) * 0.8));
          else if (toLine <= 0.3) { this.enter(c, j, at, next, mv, false, now); continue; }
        }
      }
      c.v += Math.max(-8 * dt, Math.min(3 * dt, target - c.v));
      c.wait = c.v < 0.3 && c.dwell === undefined ? c.wait + dt : 0;
      if (c.wait > 30 && !c.bus) c.gone = now; // gives up and finds another way
      c.s += c.v * dt;
      if (last && c.s >= c.goal - 0.5) { c.gone ??= now; continue; }
      if (c.s >= L) {
        // a plain join (or a road end): carry straight on to the next road
        const next = c.nextSeg !== undefined ? net.segs.get(c.nextSeg) : c.bus ? c.seg : undefined;
        if (!next || (next.a !== at && next.b !== at)) { c.gone ??= now; continue; }
        if (!c.bus) c.route.shift();
        c.s -= L; c.seg = next; c.from = at; c.nextSeg = undefined; c.served = undefined;
        const nd = net.def(next);
        if (c.lane >= nd.lanes) c.lane = nd.lanes - 1;
      }
    }
    this.cars = this.cars.filter((c) => !(c.gone && now - c.gone > 600) && net.segs.has(c.seg.id) && (!c.turn || net.segs.has(c.turn.next.id)));
    this.moveTrains(dt);
    this.draw(dt, now);
  }

  private enter(c: Car, j: Junction, node: number, next: RSeg, mv: Move, slip: boolean, now: number) {
    const nd = this.net.def(next);
    const exitLane = mv === 'L' ? 0 : mv === 'R' ? nd.lanes - 1 : Math.min(c.lane, nd.lanes - 1);
    const { pts, outS } = this.turnPath(c, j, node, next, exitLane, slip);
    let sectors: number[] | undefined, sectorLen: number | undefined;
    if (j.form === 'roundabout' || j.form === 'mini') {
      const legs = legsAt(this.net, node).map((l) => l.seg.id), n = legs.length;
      sectors = [];
      for (let q = legs.indexOf(c.seg.id); q !== legs.indexOf(next.id) && sectors.length < n; q = (q + 1) % n) sectors.push(q);
      sectorLen = pathLength(pts) / Math.max(1, sectors.length);
    }
    c.turn = { node, next, pts, t: 0, outS, exitLane, move: mv, slip, sectors, sectorLen };
    c.turnFrom = c.seg.id; c.turnMove = mv; c.sectors = sectors;
    if (!c.bus) c.route.shift();
    // count what really turns where, so junctions can be re-optimised on real traffic
    let m = this.seen.get(node);
    if (!m) this.seen.set(node, (m = new Map()));
    const k = `${c.seg.id}>${next.id}`;
    m.set(k, (m.get(k) ?? 0) + 1);
    void now;
  }

  // ---------- trains ----------
  addTrain(kind: string) {
    const def = TRAINS[kind];
    const segs = [...this.net.segs.values()].filter((s) => this.trackOk(def, s));
    if (!segs.length) return false;
    const seg = segs[Math.floor(this.rand() * segs.length)];
    this.trains.push({ def, seg, from: seg.a, s: Math.min(this.net.length(seg) - 1, def.cars * (def.carLen + 1)), v: 0, trail: [], col: new THREE.Color(def.color) });
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
      const L = net.length(tr.seg), d = net.def(tr.seg);
      const q = pointAt(net.pathFrom(tr.seg, tr.from), Math.min(tr.s, L));
      const target = trainSpeed(tr.def, d, q.grade);
      tr.v += Math.max(-1.2 * dt, Math.min(0.7 * dt, target - tr.v));
      tr.s += tr.v * dt;
      if (tr.s >= L) {
        const at = net.other(tr.seg, tr.from);
        // the most nearly straight-on track it's allowed to use; at a dead end it reverses
        const here = net.pathFrom(tr.seg, tr.from), a = here[here.length - 2], b = here[here.length - 1];
        const u = { x: b.x - a.x, z: b.z - a.z }, ul = Math.hypot(u.x, u.z) || 1;
        let best: RSeg | null = null, bd = -2;
        for (const s of net.segsAt(at)) {
          if (s.id === tr.seg.id || !this.trackOk(tr.def, s)) continue;
          const p = net.pathFrom(s, at), v = { x: p[1].x - p[0].x, z: p[1].z - p[0].z }, vl = Math.hypot(v.x, v.z) || 1;
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
    while (s < 0 && i < tr.trail.length) { seg = tr.trail[i].seg; from = tr.trail[i].from; s += this.net.length(seg); i++; }
    if (!this.net.segs.has(seg.id)) { seg = tr.seg; from = tr.from; }
    return { q: pointAt(this.net.pathFrom(seg, from), Math.max(0, s)), seg };
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
      let x: number, z: number, y: number, ux: number, uz: number, grade = 0;
      if (c.turn) {
        const q = pointAt(c.turn.pts, c.turn.t);
        x = q.x; z = q.z; y = net.node(c.turn.node).y; ux = q.ux; uz = q.uz;
      } else {
        const L = net.length(c.seg), q = pointAt(net.pathFrom(c.seg, c.from), Math.min(c.s, L));
        // lane position, easing across on lane changes; buses swing into lay-bys
        let want = this.laneOff(c.seg, c.lane, c.bus);
        if (c.bus) { const ns = this.nextStop(c); if (ns?.st.kind === 'layby') want += BAY.depth * bayWeight(ns.st, c.from === c.seg.a ? c.s : L - c.s); }
        c.off += (want - c.off) * Math.min(1, dt * 3);
        x = q.x + q.uz * c.off; z = q.z - q.ux * c.off; y = q.y; ux = q.ux; uz = q.uz; grade = q.grade;
      }
      let dh = Math.atan2(uz, ux) - c.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.heading += dh * Math.min(1, dt * 10);
      const k = Math.min(1, (now - c.born) / 500, c.gone ? 1 - (now - c.gone) / 600 : 1);
      const m = this.place(x, y + 0.25, z, c.heading, Math.atan(grade), k);
      if (c.bus && nb < 40) { for (const i of [this.busBody, this.busWin, this.busRoof]) i.setMatrixAt(nb, m); this.busBody.setColorAt(nb, c.col); nb++; }
      else if (c.lorry && nl < 80) { this.trailer.setMatrixAt(nl, m); this.trailer.setColorAt(nl, c.col); this.cab.setMatrixAt(nl, m); nl++; }
      else if (!c.lorry && !c.bus && nc < MAX) { for (const i of [this.carBody, this.carBase, this.carCab]) i.setMatrixAt(nc, m); this.carBody.setColorAt(nc, c.col); nc++; }
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

  get live() { return this.cars.filter((c) => !c.gone && !c.bus).length; }
  get buses() { return this.cars.filter((c) => c.bus).length; }
}

// How busy the roads are through the day: two rush hours, a lunchtime bump, quiet nights.
export function demand(h: number) {
  if (h < 5 || h >= 23.5) return 0.08;
  return 0.22 + Math.exp(-(((h - 8.2) / 1.1) ** 2)) + 0.9 * Math.exp(-(((h - 17.4) / 1.3) ** 2)) + 0.35 * Math.exp(-(((h - 13) / 2) ** 2));
}
export const rushLabel = (h: number) => (h >= 7 && h < 9.5 ? 'morning rush' : h >= 16.3 && h < 18.7 ? 'evening rush' : h < 5 || h >= 23 ? 'night' : '');
export type { P };
