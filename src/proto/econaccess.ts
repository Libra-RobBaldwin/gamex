// Who can get where, and how. Three layers, each rebuilt only when what it depends on changes:
//  - the transit skim: the best way between every pair of passenger stops over your lines
//    (waiting, riding, changing), with the route kept for assigning trips. Lines running between
//    the same two places (the same stops, or stops a short walk apart) are taken together,
//    since people board whichever comes first;
//  - pairs: door-to-door minutes from each zone to the places round it, on foot, by car (the
//    game's oracle) and by bus or rail (walk to a stop, the skim, walk from the stop). Nearby
//    zones pair one to one; further off, a zone pairs with blocks of zones, coarser with
//    distance, so the cost grows with the number of zones rather than its square;
//  - reach: how well each zone's people can get to work, shops and leisure in reasonable time,
//    allowing for competition (a job reached by a thousand workers is shared among them) and
//    for full lines (a journey counts only as far as people find room on board).
// Trips are then spread over destinations by a gravity model, split between car, foot and your
// lines by a logit on how long each feels, and those on your lines are loaded onto the rides of
// their route.
import { TUNE, type Oracles, type Tune } from './econdefs';
import type { LineState, Onward } from './econlines';

// ---------------- transit skim ----------------
// One hop of a route: the lines people take between two stops, whichever comes first, each
// with its share of the riders (by how often it comes).
export interface Leg { line: LineState; board: number; alight: number; share: number }
export type Hop = Leg[];

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v, top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lk;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class Skim {
  readonly S: number;
  readonly index = new Map<number, number>(); // stop id -> skim index
  readonly ids: number[];
  // The stops each stop has a route to (out) and from (in), as compressed rows: most pairs have
  // none, so the skim keeps only the pairs with a route, and its cost grows with those rather
  // than with the square of the stops. Out rows are in stop order; for each entry, by the route
  // people choose (on `gen`):
  outOff = new Int32Array(1); outTo = new Int32Array(0);
  time = new Float32Array(0); // plain minutes
  gen = new Float32Array(0); // minutes as it feels: waits and walks weigh more, changes are disliked
  room = new Float32Array(0); // share of those setting off who find room on board all the way
  // in rows: the stop it's from, and where that pair's figures are in the out rows
  inOff = new Int32Array(1); inFrom = new Int32Array(0); inAt = new Int32Array(0);
  // every stop each origin's search settled, in stop order, with the edge that reached it
  private pOff = new Int32Array(1); private pNode = new Int32Array(0); private pEdge = new Int32Array(0);
  private eFrom: Int32Array = new Int32Array(0);
  private eHop: Int32Array = new Int32Array(0); // -1 for a walk
  private hops: Hop[] = [];
  work = 0;

  constructor(stops: { id: number; x: number; z: number }[], lines: LineState[], tune: Tune = TUNE) {
    const S = (this.S = stops.length);
    this.ids = stops.map((s) => s.id);
    stops.forEach((s, i) => this.index.set(s.id, i));
    this.outOff = new Int32Array(S + 1); this.inOff = new Int32Array(S + 1); this.pOff = new Int32Array(S + 1);
    if (!S) return;
    // the quickest ride on each line between each pair of stops it calls at
    const byPair = new Map<number, { L: LineState; i: number; j: number; ride: number }[]>();
    for (const L of lines) {
      if (!L.pax || !L.running) continue;
      for (let i = 0; i < L.k; i++) {
        const u = this.index.get(L.stops[i]);
        if (u === undefined) continue;
        for (let d = 1; d < L.k; d++) {
          const j = (i + d) % L.k, v = this.index.get(L.stops[j]);
          if (v === undefined || v === u) continue;
          const key = u * S + v, ride = L.planRide[i * L.k + j];
          let list = byPair.get(key);
          if (!list) byPair.set(key, (list = []));
          const cur = list.find((c) => c.L === L);
          if (!cur) list.push({ L, i, j, ride });
          else if (ride < cur.ride) { cur.i = i; cur.j = j; cur.ride = ride; }
        }
      }
    }
    // the stops within a short walk of each (they count as one interchange), and the walk
    const cell = tune.transferWalkM, grid = new Map<string, number[]>();
    stops.forEach((s, i) => {
      const key = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    });
    const near: { v: number; t: number }[][] = stops.map((s, u) => {
      const out: { v: number; t: number }[] = [];
      const cx = Math.floor(s.x / cell), cz = Math.floor(s.z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        for (const v of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (v === u) continue;
          const d = Math.hypot(stops[v].x - s.x, stops[v].z - s.z);
          if (d <= cell) out.push({ v, t: (d * tune.detour) / tune.walkMpm });
        }
      return out;
    });
    const from: number[] = [], to: number[] = [], time: number[] = [], gen: number[] = [], room: number[] = [], hop: number[] = [];
    // People waiting between two places board whichever comes first of the lines between them,
    // whether it calls at the stop they stand at or one a short walk off (each route often has
    // its own pole): so each pair of stops a line runs between takes the lines between the stops
    // near either end too, each with its walk (as it feels, in `cost`) added to its ride.
    type Cand = { L: LineState; i: number; j: number; walk: number; cost: number };
    for (const [key, direct] of byPair) {
      const u = Math.floor(key / S), v = key % S;
      const list: Cand[] = direct.map((c) => ({ L: c.L, i: c.i, j: c.j, walk: c.ride, cost: c.ride }));
      const ends = (x: number) => [{ v: x, t: 0 }, ...near[x]];
      for (const a of ends(u)) for (const b of ends(v)) {
        if ((a.v === u && b.v === v) || a.v === v || b.v === u) continue;
        const other = byPair.get(a.v * S + b.v);
        if (!other) continue;
        const w = a.t + b.t;
        for (const c of other) {
          const cand = { L: c.L, i: c.i, j: c.j, walk: c.ride + w, cost: c.ride + tune.walkWeight * w };
          const cur = list.findIndex((x) => x.L === c.L);
          if (cur < 0) list.push(cand);
          else if (cand.cost < list[cur].cost) list[cur] = cand;
        }
      }
      // A slower line is worth boarding if its ride beats waiting on for the quicker ones; those
      // taken together come more often, so the wait is half their combined headway.
      list.sort((a, b) => a.cost - b.cost || a.L.id - b.L.id);
      let F = 0, FC = 0, FT = 0, n = 0;
      for (const c of list) {
        if (n && c.cost >= Math.min(0.5 / F, tune.maxWaitMin) + FC / F) break;
        F += 1 / c.L.planHeadway; FC += c.cost / c.L.planHeadway; FT += c.walk / c.L.planHeadway; n++;
      }
      const wait = Math.min(0.5 / F, tune.maxWaitMin);
      const h: Hop = list.slice(0, n).map((c) => ({ line: c.L, board: c.i, alight: c.j, share: 1 / c.L.planHeadway / F }));
      let r = 0;
      for (const x of h) r += x.share * x.line.room[x.board];
      from.push(u); to.push(v);
      time.push(wait + tune.boardMin + FT / F); gen.push(tune.waitWeight * wait + tune.boardMin + FC / F); room.push(r);
      hop.push(this.hops.length);
      this.hops.push(h);
    }
    // short walks between stops
    near.forEach((list, u) => { for (const { v, t } of list) { from.push(u); to.push(v); time.push(t); gen.push(tune.walkWeight * t); room.push(1); hop.push(-1); } });
    // adjacency in compressed rows
    const E = from.length, off = new Int32Array(S + 1);
    for (let e = 0; e < E; e++) off[from[e] + 1]++;
    for (let i = 0; i < S; i++) off[i + 1] += off[i];
    const order = new Int32Array(E), fill = off.slice(0, S);
    for (let e = 0; e < E; e++) order[fill[from[e]]++] = e;
    this.eFrom = Int32Array.from(from);
    this.eHop = Int32Array.from(hop);
    const eTo = Int32Array.from(to), eTime = Float64Array.from(time), eGen = Float64Array.from(gen), eRoom = Float64Array.from(room);
    // A search from every stop. Only the stops a search touches are reset for the next, so stops
    // in networks that never meet (towns far apart, each with its own buses) cost nothing to
    // each other.
    const dist = new Float64Array(S).fill(Infinity), tm = new Float64Array(S), rm = new Float64Array(S), rode = new Uint8Array(S), done = new Uint8Array(S);
    const pred = new Int32Array(S).fill(-1), touched: number[] = [], settled: number[] = [], reached: number[] = [];
    const outOff = this.outOff, pOff = this.pOff, inCount = this.inOff;
    const outTo: number[] = [], oTime: number[] = [], oGen: number[] = [], oRoom: number[] = [], pNode: number[] = [], pEdge: number[] = [];
    const byIndex = (x: number, y: number) => x - y;
    for (let o = 0; o < S; o++) {
      dist[o] = 0; tm[o] = 0; rm[o] = 1;
      touched.push(o);
      const heap = new Heap();
      heap.push(0, o);
      while (heap.size) {
        const [d, u] = heap.pop();
        if (done[u]) continue;
        if (d > tune.maxTransitMin) break;
        done[u] = 1;
        settled.push(u);
        if (rode[u]) reached.push(u);
        for (let n = off[u]; n < off[u + 1]; n++) {
          const e = order[n], v = eTo[e];
          if (done[v]) continue;
          const ride = this.eHop[e] >= 0;
          // walking from the start isn't a change; boarding after a ride is
          const nd = d + eGen[e] + (ride && rode[u] ? tune.transferMin : 0);
          if (nd < dist[v]) {
            if (dist[v] === Infinity) touched.push(v);
            dist[v] = nd;
            tm[v] = tm[u] + eTime[e];
            rm[v] = rm[u] * eRoom[e];
            rode[v] = ride ? 1 : rode[u];
            pred[v] = e;
            heap.push(nd, v);
          }
          this.work++;
        }
      }
      reached.sort(byIndex);
      for (const u of reached) { outTo.push(u); oTime.push(tm[u]); oGen.push(dist[u]); oRoom.push(rm[u]); inCount[u + 1]++; }
      outOff[o + 1] = outTo.length;
      settled.sort(byIndex);
      for (const u of settled) { pNode.push(u); pEdge.push(pred[u]); }
      pOff[o + 1] = pNode.length;
      for (const u of touched) { dist[u] = Infinity; rode[u] = 0; done[u] = 0; pred[u] = -1; }
      touched.length = 0; settled.length = 0; reached.length = 0;
    }
    this.outTo = Int32Array.from(outTo);
    this.time = Float32Array.from(oTime); this.gen = Float32Array.from(oGen); this.room = Float32Array.from(oRoom);
    this.pNode = Int32Array.from(pNode); this.pEdge = Int32Array.from(pEdge);
    // and the same the other way round
    for (let s = 0; s < S; s++) inCount[s + 1] += inCount[s];
    const inFrom = new Int32Array(outTo.length), inAt = new Int32Array(outTo.length), at = inCount.slice(0, S);
    for (let o = 0; o < S; o++) for (let q = outOff[o]; q < outOff[o + 1]; q++) { const k = at[outTo[q]]++; inFrom[k] = o; inAt[k] = q; }
    this.inFrom = inFrom; this.inAt = inAt;
  }

  // the hops from stop index a to stop index b, in order
  path(a: number, b: number): Hop[] {
    const out: Hop[] = [], p0 = this.pOff[a], p1 = this.pOff[a + 1];
    const predOf = (v: number) => { const q = find(this.pNode, p0, p1, v); return q < 0 ? -1 : this.pEdge[q]; };
    let e = predOf(b), guard = 0;
    while (e >= 0 && guard++ < 64) {
      const h = this.eHop[e];
      if (h >= 0) out.push(this.hops[h]);
      const u = this.eFrom[e];
      if (u === a) break;
      e = predOf(u);
    }
    return out.reverse();
  }
}

// the position of v in the sorted run a[lo .. hi-1], or -1
function find(a: Int32Array, lo: number, hi: number, v: number): number {
  while (lo < hi) {
    const m = (lo + hi) >> 1, x = a[m];
    if (x === v) return m;
    if (x < v) lo = m + 1; else hi = m;
  }
  return -1;
}

// ---------------- pairs ----------------
export interface ZoneAccess { s: number; walk: number; cov: number } // skim stop, minutes on foot, share of the zone
// `size`: places in its buildings. `group`: zones with the same group (and cell) are blocked
// together: the economy gives a zone near a stop its town, so a block reached by bus or rail
// is one town's, and a railway to one town doesn't bring the next town's jobs within reach.
export interface ZoneGeo { id: number; x: number; z: number; r: number; size: number; group: number; acc: ZoneAccess[] }

// What stays the same between rebuilds while the zones stay put (and keep their groups), a row
// per zone: the places it pairs with, and the car oracle's answers for them in the same order.
// Roads change far less often than bus routes, so the economy empties `cars` when the network
// changes rather than asking every month, and both when zones move or come and go.
export interface PairCache { places: (Int32Array | undefined)[]; cars: (Float32Array | undefined)[]; groups?: Int32Array }

// A block of zones, standing in for all of them as somewhere to go from further off: it's
// reached at its middle by car, and by bus or rail at whichever of its stops is best, with the
// walk from that stop averaged over the places near it, as for a zone.
interface Block { x: number; z: number; rep: number; entry: { s: number; walk: number }[] }

// Places are zones (0 .. Z-1) and then blocks. A zone pairs one to one with the zones in the
// 3 x 3 cells of `pairCellM` round it; then with the blocks in cells three times the size, in
// the 3 x 3 of the level above, that aren't next to its own; and so on out to `maxPairM`. Every
// zone in range is covered once, by a block at least its own width away.
export class Pairs {
  n = 0;
  readonly Z: number;
  readonly N: number; // places
  readonly rep: Int32Array; // each place's zone: itself, or the zone nearest a block's middle
  readonly levels: number; // levels of blocks
  readonly up: Int32Array; // Z x levels: the block each zone is in at each level (as a place)
  readonly start: Int32Array; // pairs from zone i are start[i] .. start[i+1]-1
  i: Int32Array; j: Int32Array;
  car: Float32Array; // door to door with a car to hand (they'll walk or ride if that's quicker)
  nc: Float32Array; // without a car: on foot or your lines
  pt: Float32Array; // by your lines alone, plain minutes
  gen: Float32Array; // by your lines alone, as it feels
  room: Float32Array; // share of those going by your lines who find room
  walk: Float32Array;
  drive: Float32Array; // by car alone
  sa: Int32Array; sb: Int32Array; // the stops of the best route by your lines (-1 if none)
  rb: Int32Array; // the stop to ride back to from sb, for the journey home (-1 if none)
  readonly scratch: [Float32Array, Float32Array]; // for reach(), kept to spare the garbage collector
  work = 0;

  // `cache` keeps what doesn't change between rebuilds while the zones stay put (see PairCache).
  constructor(zones: ZoneGeo[], skim: Skim, oracles: Oracles, tune: Tune = TUNE, cache: PairCache = { places: [], cars: [] }) {
    const Z = (this.Z = zones.length), c0 = tune.pairCellM;
    let top = 1;
    while (c0 * 3 ** top < tune.maxPairM) top++;
    const L = (this.levels = top), L1 = L + 1; // blocks at levels 0 .. L-1; cells at L only bound neighbourhoods
    // each zone's cell at every level, each three times the last
    const CX = new Int32Array(Z * L1), CZ = new Int32Array(Z * L1);
    for (let i = 0; i < Z; i++) {
      CX[i * L1] = Math.floor(zones[i].x / c0); CZ[i * L1] = Math.floor(zones[i].z / c0);
      for (let l = 1; l <= L; l++) { CX[i * L1 + l] = Math.floor(CX[i * L1 + l - 1] / 3); CZ[i * L1 + l] = Math.floor(CZ[i * L1 + l - 1] / 3); }
    }
    // what the cache holds was worked out for these groups
    const groups = Int32Array.from(zones, (z) => z.group);
    if (!cache.groups || cache.groups.length !== Z || cache.groups.some((g, i) => g !== groups[i])) {
      cache.places = []; cache.cars = []; cache.groups = groups;
    }
    // a dense grid at each level, each occupied cell holding its blocks (one per group) as a list
    const grids = Array.from({ length: L }, (_, l) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < Z; i++) { const x = CX[i * L1 + l], z = CZ[i * L1 + l]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const w = Z ? x1 - x0 + 1 : 0, h = Z ? z1 - z0 + 1 : 0;
      return { x0, z0, w, h, cell: new Int32Array(w * h).fill(-1) };
    });
    const firstAt = (l: number, x: number, z: number) => {
      const g = grids[l], a = x - g.x0, b = z - g.z0;
      return a < 0 || b < 0 || a >= g.w || b >= g.h ? -1 : g.cell[a * g.h + b];
    };
    const members: number[][] = [], group: number[] = [], next: number[] = [];
    this.up = new Int32Array(Z * L);
    for (let i = 0; i < Z; i++)
      for (let l = 0; l < L; l++) {
        const g = grids[l], k = (CX[i * L1 + l] - g.x0) * g.h + (CZ[i * L1 + l] - g.z0);
        let b = g.cell[k];
        while (b >= 0 && group[b] !== groups[i]) b = next[b];
        if (b < 0) { b = members.length; members.push([]); group.push(groups[i]); next.push(g.cell[k]); g.cell[k] = b; }
        members[b].push(i);
        this.up[i * L + l] = Z + b;
      }
    const blocks: Block[] = members.map((m) => {
      let x = 0, z = 0;
      for (const i of m) { x += zones[i].x; z += zones[i].z; }
      x /= m.length; z /= m.length;
      let rep = m[0], best = Infinity;
      for (const i of m) { const dx = zones[i].x - x, dz = zones[i].z - z, d = dx * dx + dz * dz; if (d < best) { best = d; rep = i; } }
      const near = new Map<number, [number, number]>(); // stop -> places near it, and their walk
      for (const i of m) for (const a of zones[i].acc) {
        const w = Math.max(1e-6, zones[i].size * a.cov), e = near.get(a.s);
        if (e) { e[0] += w; e[1] += w * a.walk; } else near.set(a.s, [w, w * a.walk]);
      }
      return { x, z, rep, entry: [...near.entries()].sort((a, b) => a[0] - b[0]).map(([s, [w, wt]]) => ({ s, walk: wt / w })) };
    });
    this.N = Z + blocks.length;
    this.rep = new Int32Array(this.N);
    for (let i = 0; i < Z; i++) this.rep[i] = i;
    blocks.forEach((B, b) => (this.rep[Z + b] = B.rep));
    // The places each zone pairs with, in a fixed order: the zones in the level-0 cells next to its
    // own, then at each level the blocks under the 3 x 3 cells above that aren't next to its own.
    const maxPair2 = tune.maxPairM * tune.maxPairM;
    const places = (i: number, out: Int32Array) => {
      let m = 0;
      const a = zones[i], ax = CX[i * L1], az = CZ[i * L1];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        for (let b = firstAt(0, ax + dx, az + dz); b >= 0; b = next[b]) for (const j of members[b]) out[m++] = j;
      for (let l = 0; l < L; l++) {
        const bx0 = CX[i * L1 + l], bz0 = CZ[i * L1 + l], px = CX[i * L1 + l + 1], pz = CZ[i * L1 + l + 1];
        for (let qx = px * 3 - 3; qx < px * 3 + 6; qx++) for (let qz = pz * 3 - 3; qz < pz * 3 + 6; qz++) {
          if (qx >= bx0 - 1 && qx <= bx0 + 1 && qz >= bz0 - 1 && qz <= bz0 + 1) continue;
          for (let b = firstAt(l, qx, qz); b >= 0; b = next[b]) {
            const B = blocks[b], dx = a.x - B.x, dz = a.z - B.z;
            if (dx * dx + dz * dz <= maxPair2) out[m++] = Z + b;
          }
        }
      }
      return m;
    };
    const lists: Int32Array[] = [], scratch = new Int32Array(Z + blocks.length);
    let total = 0;
    for (let i = 0; i < Z; i++) {
      let list = cache.places[i];
      if (!list) cache.places[i] = list = scratch.slice(0, places(i, scratch));
      lists.push(list);
      total += list.length;
    }
    const I = new Int32Array(total), J = new Int32Array(total), SA = new Int32Array(total), SB = new Int32Array(total), RB = new Int32Array(total);
    const CAR = new Float32Array(total), NCs = new Float32Array(total), PT = new Float32Array(total), GEN = new Float32Array(total), ROOM = new Float32Array(total), W = new Float32Array(total), D = new Float32Array(total);
    this.start = new Int32Array(Z + 1);
    // beyond this nobody goes, by any means: reach stops at half as long again as its limits,
    // and trips this long are a few per cent of those next door
    const cut = Math.max(1.5 * tune.workMin, 4 * tune.gravityMin);
    const WW = tune.walkWeight, perMin = tune.detour / tune.walkMpm, fresh: number[] = [];
    // from this origin, the best (as it feels) way to every stop by walking to one of ours and
    // riding, which stop it set off from, and the way home from every stop
    const S = skim.S, toGen = new Float64Array(S), toTime = new Float64Array(S), toRoom = new Float64Array(S), via = new Int32Array(S);
    const backGen = new Float64Array(S), back = new Int32Array(S), cars = cache.cars;
    let n = 0;
    for (let i = 0; i < Z; i++) {
      this.start[i] = n;
      const a = zones[i];
      if (S) {
        toGen.fill(Infinity); backGen.fill(Infinity);
        for (const x of a.acc) {
          const w = WW * x.walk;
          for (let q = skim.outOff[x.s], q1 = skim.outOff[x.s + 1]; q < q1; q++) {
            const s = skim.outTo[q], t = w + skim.gen[q];
            if (t < toGen[s]) { toGen[s] = t; toTime[s] = x.walk + skim.time[q]; toRoom[s] = skim.room[q]; via[s] = x.s; }
          }
          for (let q = skim.inOff[x.s], q1 = skim.inOff[x.s + 1]; q < q1; q++) {
            const s = skim.inFrom[q], h = skim.gen[skim.inAt[q]] + w;
            if (h < backGen[s]) { backGen[s] = h; back[s] = x.s; }
          }
        }
      }
      const row = cars[i], list = lists[i], count = list.length;
      fresh.length = 0;
      for (let q = 0; q < count; q++) {
        const j = list[q], zone = j < Z;
        const B = zone ? null : blocks[j - Z], b = zone ? zones[j] : null;
        const dx = a.x - (zone ? b!.x : B!.x), dz = a.z - (zone ? b!.z : B!.z);
        const walk = i === j ? Math.max(2, a.r * 0.7 * perMin) : Math.sqrt(dx * dx + dz * dz) * perMin;
        let ct: number;
        if (row && q < row.length) ct = row[q]; else { ct = oracles.carTime(a.id, zones[zone ? j : B!.rep].id); fresh.push(ct); }
        const drive = Number.isFinite(ct) && ct >= 0 ? ct + tune.carAccessMin : Infinity;
        // best by your lines: walk to a stop, ride, walk from a stop
        let gen = Infinity, pt = Infinity, room = 0, s1 = -1, s2 = -1;
        if (S)
          for (const y of zone ? b!.acc : B!.entry) {
            const g = toGen[y.s] + WW * y.walk;
            if (g < gen) { gen = g; pt = toTime[y.s] + y.walk; room = toRoom[y.s]; s1 = via[y.s]; s2 = y.s; }
          }
        const nc = Math.min(walk, pt), car = Math.min(drive, nc);
        this.work++;
        if (car > cut) continue;
        I[n] = i; J[n] = j; CAR[n] = car; NCs[n] = nc; PT[n] = pt; GEN[n] = gen; ROOM[n] = room; W[n] = walk; D[n] = drive;
        SA[n] = s1; SB[n] = s2; RB[n] = s2 >= 0 && backGen[s2] < Infinity ? back[s2] : -1;
        n++;
      }
      if (!row) cars[i] = Float32Array.from(fresh);
    }
    this.start[Z] = n;
    this.n = n;
    this.i = I.subarray(0, n); this.j = J.subarray(0, n); this.sa = SA.subarray(0, n); this.sb = SB.subarray(0, n); this.rb = RB.subarray(0, n);
    this.car = CAR.subarray(0, n); this.nc = NCs.subarray(0, n); this.pt = PT.subarray(0, n); this.gen = GEN.subarray(0, n); this.room = ROOM.subarray(0, n);
    this.walk = W.subarray(0, n); this.drive = D.subarray(0, n);
    this.scratch = [new Float32Array(n), new Float32Array(n)];
  }

  // A figure per zone added up for each place (a zone is its own place; a block sums its zones).
  sum(a: ArrayLike<number>): Float64Array {
    const out = new Float64Array(this.N), L = this.levels;
    for (let z = 0; z < this.Z; z++) {
      const v = a[z];
      if (!v) continue;
      out[z] += v;
      for (let l = 0; l < L; l++) out[this.up[z * L + l]] += v;
    }
    return out;
  }
  // A figure per place brought back to each zone: its own and that of every block it's in.
  down(a: Float64Array): Float64Array {
    const out = new Float64Array(this.Z), L = this.levels;
    for (let z = 0; z < this.Z; z++) {
      let v = a[z];
      for (let l = 0; l < L; l++) v += a[this.up[z * L + l]];
      out[z] = v;
    }
    return out;
  }
}

// ---------------- reach ----------------
// Two-step floating catchment: each destination's supply is shared among everyone who can
// reach it in time; each origin adds up its shares. 1 means "enough within reach". With
// `share` it also shares each origin's people among the destinations they reach (a Huff
// model), which says how many workers or customers each place gets.
// A journey by your lines counts only for those who find room on board; the rest go on foot or
// by car if they can. The two groups are capped at `cap` separately, so a full line into a town
// with jobs to spare still leaves most of its would-be riders without one.
// `lost` is demand at each origin that reaches nowhere at all (so isn't shared out).
export interface Reach { car: Float64Array; nc: Float64Array; pt: Float64Array; ratio: Float64Array; lost: Float64Array }

export function reach(p: Pairs, demand: Float64Array, supply: Float64Array, carShare: Float64Array, T: number, share: boolean, cap = Infinity): Reach {
  const Z = demand.length, g = (t: number) => (t <= T ? 1 : t >= 1.5 * T ? 0 : (1.5 * T - t) / (0.5 * T));
  const S = p.sum(supply), denom = new Float64Array(p.N), sc = new Float64Array(Z), sn = new Float64Array(Z);
  const out: Reach = { car: new Float64Array(Z), nc: new Float64Array(Z), pt: new Float64Array(Z), ratio: new Float64Array(Z), lost: new Float64Array(Z) };
  const lim = 1.5 * T, [GC, GN] = p.scratch;
  for (let n = 0; n < p.n; n++) {
    if (p.car[n] >= lim) { GC[n] = GN[n] = 0; continue; }
    // with a car to hand (they'll walk or ride if that's quicker) and without; riders who find
    // no room fall back on the other ways
    const walk = p.walk[n], pt = p.pt[n], rho = p.room[n], alt = Math.min(p.drive[n], walk);
    const gp = rho * g(pt), gw = g(walk), ga = g(alt);
    const gn = pt < walk ? gp + (1 - rho) * gw : gw, gc = pt < alt ? gp + (1 - rho) * ga : ga;
    GC[n] = gc; GN[n] = gn;
    const i = p.i[n], j = p.j[n], c = carShare[i];
    denom[j] += demand[i] * (c * gc + (1 - c) * gn);
    if (share) { sc[i] += S[j] * gc; sn[i] += S[j] * gn; }
  }
  // each zone's supply is competed for by those reaching it, or any block it's in
  const dz = p.down(denom), rz = new Float64Array(Z);
  for (let z = 0; z < Z; z++) rz[z] = supply[z] > 0 && dz[z] > 0 ? supply[z] / dz[z] : 0;
  const R = p.sum(rz), alloc = new Float64Array(p.N); // alloc: people per unit of supply
  // by origin: reach with room on board (A) and without (B), and how much of the difference
  // comes with room, for those without a car, with one, and by your lines alone
  const An = new Float64Array(Z), Bn = new Float64Array(Z), Wn = new Float64Array(Z), Rn = new Float64Array(Z);
  const Ac = new Float64Array(Z), Bc = new Float64Array(Z), Wc = new Float64Array(Z), Rc = new Float64Array(Z);
  const Rp = new Float64Array(Z);
  for (let n = 0; n < p.n; n++) {
    if (p.car[n] >= lim) continue;
    const i = p.i[n], j = p.j[n], r = R[j];
    if (r > 0) {
      const rho = p.room[n], gw = g(p.walk[n]), ga = g(Math.min(p.drive[n], p.walk[n])), gp = g(p.pt[n]);
      const gn = Math.max(gw, gp), gc = Math.max(ga, gp);
      An[i] += r * gn; Bn[i] += r * gw; Wn[i] += r * (gn - gw); Rn[i] += r * (gn - gw) * rho;
      Ac[i] += r * gc; Bc[i] += r * ga; Wc[i] += r * (gc - ga); Rc[i] += r * (gc - ga) * rho;
      out.pt[i] += r * gp; Rp[i] += r * gp * rho;
    }
    if (share && S[j] > 0) {
      const c = carShare[i], D = demand[i];
      if (sc[i] > 0) alloc[j] += (D * c * GC[n]) / sc[i];
      if (sn[i] > 0) alloc[j] += (D * (1 - c) * GN[n]) / sn[i];
    }
  }
  for (let i = 0; i < Z; i++) {
    const kn = Wn[i] > 0 ? Rn[i] / Wn[i] : 1, kc = Wc[i] > 0 ? Rc[i] / Wc[i] : 1, kp = out.pt[i] > 0 ? Rp[i] / out.pt[i] : 1;
    out.nc[i] = kn * Math.min(cap, An[i]) + (1 - kn) * Math.min(cap, Bn[i]);
    out.car[i] = kc * Math.min(cap, Ac[i]) + (1 - kc) * Math.min(cap, Bc[i]);
    out.pt[i] = kp * Math.min(cap, out.pt[i]);
  }
  if (share) {
    const az = p.down(alloc);
    for (let j = 0; j < Z; j++) {
      out.ratio[j] = supply[j] > 0 ? az[j] : 0;
      out.lost[j] = demand[j] * (carShare[j] * (sc[j] > 0 ? 0 : 1) + (1 - carShare[j]) * (sn[j] > 0 ? 0 : 1));
    }
  }
  return out;
}

// ---------------- trips onto lines ----------------
// Every resident makes `tripsPerDay` one-way trips, half out and half back. Destinations are
// weighted by what's there and how long it takes to get to (gravity); the mode by a logit on
// how long each way feels. The share by your lines is loaded onto the hops of their route: the
// first as passengers turning up at the stop, later ones as people changing. Those going out
// to a workplace (rather than home), other than workers going to their own jobs, are counted as
// its visitors when they get off.
export interface TripTables {
  gen: Map<LineState, Map<number, number>>;
  onward: Map<LineState, Map<string, { to: LineState; board: number; alight: number; rate: number }>[]>;
  arrivals: Map<LineState, Float64Array>; visits: Map<LineState, Float64Array>; perDay: number; work: number;
}

export function assignTrips(p: Pairs, skim: Skim, residents: Float64Array, attraction: Float64Array, visit: Float64Array, carShare: Float64Array, cover: Float64Array, homeCover: Float64Array, tune: Tune = TUNE): TripTables {
  const Z = p.Z, tau = tune.gravityMin, beta = tune.modeBeta;
  const tables: TripTables = { gen: new Map(), onward: new Map(), arrivals: new Map(), visits: new Map(), perDay: 0, work: 0 };
  // what each place draws, the share of that from workplaces, and how much of it is near a stop
  const A = p.sum(attraction), V = p.sum(visit), AC = p.sum(attraction.map((a, z) => a * cover[z]));
  // the share of trips out that aren't a worker going to work (each worker goes once a day)
  const visiting = Math.max(0, 1 - tune.workerShare / (tune.tripsPerDay / 2));
  // many pairs share the same stops: add them up first, then trace each route once
  const byStops = new Map<number, number>(), visits = new Map<number, number>();
  const trip = (a: number, b: number, rate: number, visit: number) => {
    if (a < 0 || b < 0) return;
    const k = a * skim.S + b;
    byStops.set(k, (byStops.get(k) ?? 0) + rate);
    if (visit > 0) visits.set(k, (visits.get(k) ?? 0) + visit);
  };
  const ride = (hops: Hop[], rate: number, visit: number) => {
    let prev: Hop | null = null;
    hops.forEach((hop, h) => {
      for (const r of hop) {
        const L = r.line, q = rate * r.share;
        let arr = tables.arrivals.get(L);
        if (!arr) tables.arrivals.set(L, (arr = new Float64Array(L.k)));
        arr[r.alight] += q;
        if (h === hops.length - 1 && visit > 0) {
          let v = tables.visits.get(L);
          if (!v) tables.visits.set(L, (v = new Float64Array(L.k)));
          v[r.alight] += visit * r.share;
        }
        if (!prev) {
          let g = tables.gen.get(L);
          if (!g) tables.gen.set(L, (g = new Map()));
          const key = r.board * L.k + r.alight;
          g.set(key, (g.get(key) ?? 0) + q);
        } else
          // from every line of the last hop to every line of this one, in proportion
          for (const f of prev) {
            let on = tables.onward.get(f.line);
            if (!on) tables.onward.set(f.line, (on = Array.from({ length: f.line.k }, () => new Map())));
            const key = `${L.id}:${r.board}:${r.alight}`, cur = on[f.alight].get(key), m = rate * f.share * r.share;
            if (cur) cur.rate += m; else on[f.alight].set(key, { to: L, board: r.board, alight: r.alight, rate: m });
          }
      }
      prev = hop;
    });
  };
  for (let i = 0; i < Z; i++) {
    const R = residents[i];
    if (R <= 0) continue;
    const s0 = p.start[i], s1 = p.start[i + 1];
    let any = false;
    for (let n = s0; n < s1 && !any; n++) any = p.gen[n] < Infinity;
    if (!any) continue; // nowhere to go by your lines
    let sumC = 0, sumN = 0;
    for (let n = s0; n < s1; n++) {
      const a = A[p.j[n]];
      if (a <= 0) continue;
      sumC += a * Math.exp(-p.car[n] / tau);
      sumN += a * Math.exp(-p.nc[n] / tau);
    }
    const c = carShare[i], trips = R * tune.tripsPerDay;
    for (let n = s0; n < s1; n++) {
      const j = p.j[n], a = A[j], pg = p.gen[n];
      if (a <= 0 || !Number.isFinite(pg)) continue;
      // trips set out from homes near a stop to places near one
      const cov = homeCover[i] * (AC[j] / a);
      if (cov <= 0) continue;
      // with a car: car, your lines or on foot; without: your lines or on foot
      const uw = -beta * p.walk[n], up = -beta * (pg + tune.ptBiasMin), ud = -beta * (p.drive[n] + tune.carBiasMin);
      const mx = Math.max(uw, up, Number.isFinite(ud) ? ud : -Infinity);
      const ew = Math.exp(uw - mx), ep = Math.exp(up - mx), ed = Number.isFinite(ud) ? Math.exp(ud - mx) : 0;
      const shareCar = ep / (ew + ep + ed), shareNc = ep / (ew + ep);
      const daily = (sumC > 0 ? (trips * c * a * Math.exp(-p.car[n] / tau)) / sumC : 0) * shareCar
        + (sumN > 0 ? (trips * (1 - c) * a * Math.exp(-p.nc[n] / tau)) / sumN : 0) * shareNc;
      const perMin = (daily * cov) / 1440 / 2;
      if (perMin < 1e-7) continue;
      tables.perDay += daily * cov;
      // out (visiting whatever draws them there), and home again from where they got off; of
      // those going out, the workers on their way to their own jobs aren't visitors
      trip(p.sa[n], p.sb[n], perMin, (perMin * visiting * V[j]) / a);
      trip(p.sb[n], p.rb[n], perMin, 0);
      tables.work++;
    }
  }
  for (const k of [...byStops.keys()].sort((a, b) => a - b)) ride(skim.path(Math.floor(k / skim.S), k % skim.S), byStops.get(k)!, visits.get(k) ?? 0);
  return tables;
}

// Trips between towns (docs/region.md, R5): each zone's trips shared out over where they could
// go as assignTrips shares them, added up by the town at each end: `all` by any means a day, and
// `lines` the share of those that go by your lines. A block counts as the town of its middle zone.
// Only for what the panels say: it changes nothing in the economy.
export interface TownFlow { all: number; lines: number }
export function townFlows(p: Pairs, residents: Float64Array, attraction: Float64Array, carShare: Float64Array, cover: Float64Array, homeCover: Float64Array, zoneTown: Int32Array, tune: Tune = TUNE): Map<number, Map<number, TownFlow>> {
  const out = new Map<number, Map<number, TownFlow>>(), tau = tune.gravityMin, beta = tune.modeBeta;
  const A = p.sum(attraction), AC = p.sum(attraction.map((a, z) => a * cover[z]));
  for (let i = 0; i < p.Z; i++) {
    const R = residents[i];
    if (R <= 0) continue;
    const s0 = p.start[i], s1 = p.start[i + 1], from = zoneTown[i];
    let sumC = 0, sumN = 0;
    for (let n = s0; n < s1; n++) {
      const a = A[p.j[n]];
      if (a <= 0) continue;
      sumC += a * Math.exp(-p.car[n] / tau);
      sumN += a * Math.exp(-p.nc[n] / tau);
    }
    const c = carShare[i], trips = R * tune.tripsPerDay;
    let row = out.get(from);
    if (!row) out.set(from, (row = new Map()));
    for (let n = s0; n < s1; n++) {
      const j = p.j[n], a = A[j];
      if (a <= 0) continue;
      const withCar = sumC > 0 ? (trips * c * a * Math.exp(-p.car[n] / tau)) / sumC : 0;
      const noCar = sumN > 0 ? (trips * (1 - c) * a * Math.exp(-p.nc[n] / tau)) / sumN : 0;
      const to = zoneTown[p.rep[j]];
      let f = row.get(to);
      if (!f) row.set(to, (f = { all: 0, lines: 0 }));
      f.all += withCar + noCar;
      const pg = p.gen[n], cov = Number.isFinite(pg) ? homeCover[i] * (AC[j] / a) : 0;
      if (cov <= 0) continue;
      const uw = -beta * p.walk[n], up = -beta * (pg + tune.ptBiasMin), ud = -beta * (p.drive[n] + tune.carBiasMin);
      const mx = Math.max(uw, up, Number.isFinite(ud) ? ud : -Infinity);
      const ew = Math.exp(uw - mx), ep = Math.exp(up - mx), ed = Number.isFinite(ud) ? Math.exp(ud - mx) : 0;
      f.lines += (withCar * (ep / (ew + ep + ed)) + noCar * (ep / (ew + ep))) * cov;
    }
  }
  return out;
}

// Put the tables onto the lines: generation rates, for each slot where people get off the
// shares who change and where to, and the share of those who stay off that are visitors.
export function installTrips(lines: LineState[], t: TripTables) {
  for (const L of lines) {
    if (!L.pax) continue;
    const g = t.gen.get(L);
    const keys = g ? [...g.keys()].sort((a, b) => a - b) : [];
    L.genIdx = Int32Array.from(keys);
    L.genRate = Float64Array.from(keys.map((k) => g!.get(k)!));
    const on = t.onward.get(L), arr = t.arrivals.get(L), vis = t.visits.get(L);
    L.visitShare.fill(0);
    L.onward = Array.from({ length: L.k }, (_, s): Onward[] => {
      if (!arr || arr[s] <= 0) return [];
      const list = on ? [...on[s].values()].sort((a, b) => a.to.id - b.to.id || a.board - b.board || a.alight - b.alight) : [];
      let staying = arr[s];
      for (const o of list) staying -= o.rate;
      if (vis && staying > 1e-9) L.visitShare[s] = Math.min(1, vis[s] / staying);
      return list.map((o) => ({ line: o.to, board: o.board, alight: o.alight, share: Math.min(1, o.rate / arr[s]) }));
    });
  }
}
