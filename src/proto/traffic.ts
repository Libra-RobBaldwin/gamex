// Background traffic: cars and lorries that aren't part of the game, but come from the city.
// Every trip starts at a real building (a home, a job, a shop, a works) or at a road leading off
// the map, is routed over the road network, and ends by turning in at its destination.
// Cars follow the car in front and take turns through junctions, so busy roads queue.
import * as THREE from 'three';
import { BAY, bayWeight, pointAt, type Lot, type Network, type P, type RSeg, type Stop } from './roads';

export interface Places { homes: Lot[]; jobs: Lot[]; shops: Lot[]; works: Lot[]; weight: (l: Lot) => number }

interface Car {
  seg: RSeg; from: number; s: number; v: number; vmax: number;
  route: number[]; // seg ids still to drive, after the current one
  goal: number; // stop at this distance along the last seg
  lorry: boolean; col: THREE.Color; heading: number;
  born: number; gone?: number; wait: number; claim?: number;
  lane: number; off: number; // lane (0 = nearside) and current sideways position
  bus?: boolean; dwell?: number; served?: number; inBay?: boolean;
}
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
  private claims = new Map<number, { car: Car; t: number }>();
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
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YZX');

  constructor(net: Network, scene: THREE.Scene, rand: () => number) {
    this.net = net;
    this.rand = rand;
    scene.add(this.carBody, this.carBase, this.carCab, this.trailer, this.cab, this.busBody, this.busWin, this.busRoof);
  }

  // the road network changed: routes, access points and anyone on a removed road are reset
  invalidate() {
    this.graph = null;
    this.access.clear();
    for (const c of this.cars) if (!this.net.segs.has(c.seg.id) || c.route.some((id) => !this.net.segs.has(id))) c.gone ??= performance.now();
  }

  private adj() {
    if (this.graph) return this.graph;
    const g = new Map<number, { seg: RSeg; to: number; len: number }[]>();
    for (const s of this.net.segs.values()) {
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
    const segs = [...this.net.segs.values()].filter((s) => s.type !== 'motorway');
    if (!segs.length) return;
    const seg = segs[Math.floor(this.rand() * segs.length)];
    this.cars.push({
      seg, from: this.rand() < 0.5 ? seg.a : seg.b, s: this.rand() * this.net.length(seg), v: 0, vmax: 11, route: [], goal: Infinity, lorry: false, bus: true,
      col: new THREE.Color(this.rand() < 0.5 ? '#c9302c' : '#e8a21f'), heading: 0, born: performance.now(), wait: 0, lane: 0, off: 0,
    });
  }

  private laneOff(s: RSeg, lane: number) {
    const d = this.net.def(s);
    return d.lanes > 1 ? d.median / 2 + (d.lanes - 1 - lane + 0.5) * d.lane : d.lane / 2;
  }
  // the next stop ahead of a bus on its side of this road, as distance along its direction
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

  update(dt: number, now: number) {
    const net = this.net;
    // who is ahead of whom in each lane (a bus pulled into a lay-by is out of the way)
    const lanes = new Map<string, Car[]>();
    for (const c of this.cars) {
      if (c.inBay) continue;
      const k = `${c.seg.id}:${c.from}:${c.lane}`;
      let l = lanes.get(k);
      if (!l) lanes.set(k, (l = []));
      l.push(c);
    }
    for (const l of lanes.values()) l.sort((a, b) => a.s - b.s);
    for (const [n, cl] of this.claims) if (cl.car.gone || now - cl.t > 5000) this.claims.delete(n);
    const clear = (c: Car, lane: number) => !(lanes.get(`${c.seg.id}:${c.from}:${lane}`) ?? []).some((o) => Math.abs(o.s - c.s) < 12);

    for (const c of this.cars) {
      if (c.gone) continue;
      const L = net.length(c.seg), d = net.def(c.seg);
      const last = !c.bus && !c.route.length;
      let target = Math.min(c.vmax, d.speed * (c.lorry || c.bus ? 0.8 : 1));
      const l = c.inBay ? [] : lanes.get(`${c.seg.id}:${c.from}:${c.lane}`) ?? [];
      const ahead = l[l.indexOf(c) + 1];
      if (ahead && !ahead.gone) {
        const gap = ahead.s - c.s - (ahead.lorry || ahead.bus ? 13 : 7);
        target = Math.min(target, Math.max(0, gap * 0.9));
        // stuck behind something stopped: move out if the next lane is clear
        if (d.lanes > 1 && gap < 20 && ahead.v < 2 && !c.bus) {
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
      if (!last) {
        // take turns through junctions: stop at the line unless it's clear
        const at = net.other(c.seg, c.from);
        const busy = (this.adj().get(at)?.length ?? 0) >= 3;
        const toLine = L - net.nodeHalf(at) - 1 - c.s;
        if (busy && toLine < 12) {
          const cl = this.claims.get(at);
          if (cl && cl.car !== c) target = Math.min(target, Math.max(0, toLine * 0.8));
          else if (toLine < 4) { this.claims.set(at, { car: c, t: now }); c.claim = at; }
        }
      }
      c.v += Math.max(-8 * dt, Math.min(3 * dt, target - c.v));
      c.wait = c.v < 0.3 && c.dwell === undefined ? c.wait + dt : 0;
      if (c.wait > 25 && !c.bus) c.gone = now; // gives up and finds another way
      c.s += c.v * dt;
      if (last && c.s >= c.goal - 0.5) { c.gone ??= now; continue; }
      if (c.s >= L) {
        const at = net.other(c.seg, c.from);
        let next: RSeg | undefined;
        if (c.bus) {
          // buses wander: any road onward but the way they came (unless it's a dead end), never a motorway
          const opts = (this.adj().get(at) ?? []).map((e) => e.seg).filter((s) => s.id !== c.seg.id && s.type !== 'motorway');
          next = opts.length ? opts[Math.floor(this.rand() * opts.length)] : c.seg;
          c.served = undefined;
        } else {
          next = net.segs.get(c.route.shift()!);
          if (!next || (next.a !== at && next.b !== at)) { c.gone ??= now; continue; }
        }
        c.s -= L; c.seg = next; c.from = at;
        const nd = net.def(next);
        if (c.lane >= nd.lanes) c.lane = nd.lanes - 1;
        else if (nd.lanes > 1 && !c.lorry && !c.bus && this.rand() < 0.5) c.lane = Math.floor(this.rand() * nd.lanes);
      }
      // leave the junction behind
      if (c.claim !== undefined && c.from === c.claim && c.s > net.nodeHalf(c.claim) + 2) { if (this.claims.get(c.claim)?.car === c) this.claims.delete(c.claim); c.claim = undefined; }
    }
    this.cars = this.cars.filter((c) => !(c.gone && now - c.gone > 600) && net.segs.has(c.seg.id));

    // draw
    let nc = 0, nl = 0, nb = 0;
    for (const c of this.cars) {
      const path = net.pathFrom(c.seg, c.from), L = net.length(c.seg);
      const q = pointAt(path, Math.min(c.s, L));
      // lane position, easing across when changing lane; buses swing into lay-bys
      let want = this.laneOff(c.seg, c.lane);
      if (c.bus) { const ns = this.nextStop(c) ?? (c.dwell !== undefined ? null : null); if (ns?.st.kind === 'layby') want += BAY.depth * bayWeight(ns.st, c.from === c.seg.a ? c.s : L - c.s); }
      c.off += (want - c.off) * Math.min(1, dt * 3);
      const x = q.x + q.uz * c.off, z = q.z - q.ux * c.off;
      let dh = Math.atan2(q.uz, q.ux) - c.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      c.heading += dh * Math.min(1, dt * 8);
      // pull out of the drive and turn in at the destination
      const k = Math.min(1, (now - c.born) / 500, c.gone ? 1 - (now - c.gone) / 600 : 1);
      this.e.set(0, -c.heading, Math.atan(q.grade));
      this.q.setFromEuler(this.e);
      this.m4.compose(new THREE.Vector3(x, q.y + 0.25, z), this.q, new THREE.Vector3(Math.max(0.01, k), Math.max(0.01, k), Math.max(0.01, k)));
      if (c.bus && nb < 40) { for (const m of [this.busBody, this.busWin, this.busRoof]) m.setMatrixAt(nb, this.m4); this.busBody.setColorAt(nb, c.col); nb++; }
      else if (c.lorry && nl < 80) { this.trailer.setMatrixAt(nl, this.m4); this.trailer.setColorAt(nl, c.col); this.cab.setMatrixAt(nl, this.m4); nl++; }
      else if (!c.lorry && !c.bus && nc < MAX) { for (const m of [this.carBody, this.carBase, this.carCab]) m.setMatrixAt(nc, this.m4); this.carBody.setColorAt(nc, c.col); nc++; }
    }
    this.carBody.count = this.carBase.count = this.carCab.count = nc;
    this.trailer.count = this.cab.count = nl;
    this.busBody.count = this.busWin.count = this.busRoof.count = nb;
    for (const m of [this.carBody, this.carBase, this.carCab, this.trailer, this.cab, this.busBody, this.busWin, this.busRoof]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
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
