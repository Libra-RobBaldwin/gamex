// Who can get where, and how. Three layers, each rebuilt only when what it depends on changes:
//  - the transit skim: the best way between every pair of passenger stops over your lines
//    (waiting, riding, changing), with the route kept for assigning trips. Lines running between
//    the same two stops are taken together, since people board whichever comes first;
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
  // S x S, by the route people choose (on `gen`), Infinity where there's none with a ride in it
  readonly time: Float32Array; // plain minutes
  readonly gen: Float32Array; // minutes as it feels: waits and walks weigh more, changes are disliked
  readonly room: Float32Array; // share of those setting off who find room on board all the way
  private readonly pred: Int32Array; // S x S: the edge that reached it
  private eFrom: Int32Array = new Int32Array(0);
  private eHop: Int32Array = new Int32Array(0); // -1 for a walk
  private hops: Hop[] = [];
  work = 0;

  constructor(stops: { id: number; x: number; z: number }[], lines: LineState[], tune: Tune = TUNE) {
    const S = (this.S = stops.length);
    this.ids = stops.map((s) => s.id);
    stops.forEach((s, i) => this.index.set(s.id, i));
    this.time = new Float32Array(S * S).fill(Infinity);
    this.gen = new Float32Array(S * S).fill(Infinity);
    this.room = new Float32Array(S * S);
    this.pred = new Int32Array(S * S).fill(-1);
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
          const key = u * S + v, ride = L.ride[i * L.k + j];
          let list = byPair.get(key);
          if (!list) byPair.set(key, (list = []));
          const cur = list.find((c) => c.L === L);
          if (!cur) list.push({ L, i, j, ride });
          else if (ride < cur.ride) { cur.i = i; cur.j = j; cur.ride = ride; }
        }
      }
    }
    const from: number[] = [], to: number[] = [], time: number[] = [], gen: number[] = [], room: number[] = [], hop: number[] = [];
    for (const [key, list] of byPair) {
      // A slower line is worth boarding if its ride beats waiting on for the quicker ones; those
      // taken together come more often, so the wait is half their combined headway.
      list.sort((a, b) => a.ride - b.ride || a.L.id - b.L.id);
      let F = 0, FR = 0, n = 0;
      for (const c of list) {
        if (n && c.ride >= Math.min(0.5 / F, tune.maxWaitMin) + FR / F) break;
        F += 1 / c.L.headway; FR += c.ride / c.L.headway; n++;
      }
      const wait = Math.min(0.5 / F, tune.maxWaitMin), ride = FR / F;
      const h: Hop = list.slice(0, n).map((c) => ({ line: c.L, board: c.i, alight: c.j, share: 1 / c.L.headway / F }));
      let r = 0;
      for (const x of h) r += x.share * x.line.room[x.board];
      from.push(Math.floor(key / S)); to.push(key % S);
      time.push(wait + tune.boardMin + ride); gen.push(tune.waitWeight * wait + tune.boardMin + ride); room.push(r);
      hop.push(this.hops.length);
      this.hops.push(h);
    }
    // short walks between stops
    const cell = tune.transferWalkM, grid = new Map<string, number[]>();
    stops.forEach((s, i) => {
      const key = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
    });
    stops.forEach((s, u) => {
      const cx = Math.floor(s.x / cell), cz = Math.floor(s.z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
        for (const v of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (v === u) continue;
          const d = Math.hypot(stops[v].x - s.x, stops[v].z - s.z);
          if (d > cell) continue;
          const t = (d * tune.detour) / tune.walkMpm;
          from.push(u); to.push(v); time.push(t); gen.push(tune.walkWeight * t); room.push(1); hop.push(-1);
        }
    });
    // adjacency in compressed rows
    const E = from.length, off = new Int32Array(S + 1);
    for (let e = 0; e < E; e++) off[from[e] + 1]++;
    for (let i = 0; i < S; i++) off[i + 1] += off[i];
    const order = new Int32Array(E), fill = off.slice(0, S);
    for (let e = 0; e < E; e++) order[fill[from[e]]++] = e;
    this.eFrom = Int32Array.from(from);
    this.eHop = Int32Array.from(hop);
    const eTo = Int32Array.from(to), eTime = Float64Array.from(time), eGen = Float64Array.from(gen), eRoom = Float64Array.from(room);
    const dist = new Float64Array(S), tm = new Float64Array(S), rm = new Float64Array(S), rode = new Uint8Array(S), done = new Uint8Array(S);
    for (let o = 0; o < S; o++) {
      dist.fill(Infinity); rode.fill(0); done.fill(0);
      dist[o] = 0; tm[o] = 0; rm[o] = 1;
      const heap = new Heap();
      heap.push(0, o);
      const row = o * S;
      while (heap.size) {
        const [d, u] = heap.pop();
        if (done[u]) continue;
        if (d > tune.maxTransitMin) break;
        done[u] = 1;
        if (rode[u]) { this.time[row + u] = tm[u]; this.gen[row + u] = d; this.room[row + u] = rm[u]; }
        for (let n = off[u]; n < off[u + 1]; n++) {
          const e = order[n], v = eTo[e];
          if (done[v]) continue;
          const ride = this.eHop[e] >= 0;
          // walking from the start isn't a change; boarding after a ride is
          const nd = d + eGen[e] + (ride && rode[u] ? tune.transferMin : 0);
          if (nd < dist[v]) {
            dist[v] = nd;
            tm[v] = tm[u] + eTime[e];
            rm[v] = rm[u] * eRoom[e];
            rode[v] = ride ? 1 : rode[u];
            this.pred[row + v] = e;
            heap.push(nd, v);
          }
          this.work++;
        }
      }
    }
  }

  // the hops from stop index a to stop index b, in order
  path(a: number, b: number): Hop[] {
    const out: Hop[] = [];
    const row = a * this.S;
    let e = this.pred[row + b], guard = 0;
    while (e >= 0 && guard++ < 64) {
      const h = this.eHop[e];
      if (h >= 0) out.push(this.hops[h]);
      const u = this.eFrom[e];
      if (u === a) break;
      e = this.pred[row + u];
    }
    return out.reverse();
  }
}

// ---------------- pairs ----------------
export interface ZoneAccess { s: number; walk: number; cov: number } // skim stop, minutes on foot, share of the zone
export interface ZoneGeo { id: number; x: number; z: number; r: number; acc: ZoneAccess[] }

// A block of zones, standing in for all of them as somewhere to go from further off: it's
// reached at its middle by car, and by bus or rail at whichever of its stops is best.
interface Block { x: number; z: number; rep: number; entry: { s: number; walk: number }[] }

// Places are zones (0 .. Z-1) and then blocks. A zone pairs one to one with the zones in the
// 3 x 3 cells of `pairCellM` round it; then with blocks one level up (cells three times the
// size) in the 3 x 3 of the level above not already covered; and so on out to `maxPairM`. Every
// zone in range is covered once, by a block no bigger than about a third of its distance.
export class Pairs {
  n = 0;
  readonly Z: number;
  readonly N: number; // places
  readonly levels: number; // levels of blocks
  readonly up: Int32Array; // Z x levels: the block each zone is in at each level
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

  // `cars` keeps the car oracle's answers between rebuilds, a row per origin in the order its
  // candidates come (the same while the zones stay put): roads change far less often than bus
  // routes, so the economy empties it when the network changes rather than asking every month.
  constructor(zones: ZoneGeo[], skim: Skim, oracles: Oracles, tune: Tune = TUNE, cars: (Float32Array | undefined)[] = []) {
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
    // a dense grid of blocks at each level (only occupied cells get one)
    const grids = Array.from({ length: L }, (_, l) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < Z; i++) { const x = CX[i * L1 + l], z = CZ[i * L1 + l]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const w = Z ? x1 - x0 + 1 : 0, h = Z ? z1 - z0 + 1 : 0;
      return { x0, z0, w, h, cell: new Int32Array(w * h).fill(-1) };
    });
    const blockAt = (l: number, x: number, z: number) => {
      const g = grids[l], a = x - g.x0, b = z - g.z0;
      return a < 0 || b < 0 || a >= g.w || b >= g.h ? -1 : g.cell[a * g.h + b];
    };
    const members: number[][] = [];
    this.up = new Int32Array(Z * L);
    for (let i = 0; i < Z; i++)
      for (let l = 0; l < L; l++) {
        const g = grids[l], k = (CX[i * L1 + l] - g.x0) * g.h + (CZ[i * L1 + l] - g.z0);
        if (g.cell[k] < 0) { g.cell[k] = members.length; members.push([]); }
        members[g.cell[k]].push(i);
        this.up[i * L + l] = Z + g.cell[k];
      }
    const blocks: Block[] = members.map((m) => {
      let x = 0, z = 0;
      for (const i of m) { x += zones[i].x; z += zones[i].z; }
      x /= m.length; z /= m.length;
      let rep = m[0], best = Infinity;
      for (const i of m) { const dx = zones[i].x - x, dz = zones[i].z - z, d = dx * dx + dz * dz; if (d < best) { best = d; rep = i; } }
      const walk = new Map<number, number>();
      for (const i of m) for (const a of zones[i].acc) if (!(walk.get(a.s)! <= a.walk)) walk.set(a.s, a.walk);
      return { x, z, rep, entry: [...walk.entries()].sort((a, b) => a[0] - b[0]).map(([s, w]) => ({ s, walk: w })) };
    });
    this.N = Z + blocks.length;
    // The places each zone pairs with, in a fixed order: the zones in the level-0 cells next to its
    // own, then at each level the blocks under the 3 x 3 cells above that aren't next to its own.
    const maxPair2 = tune.maxPairM * tune.maxPairM;
    const places = (i: number, out: Int32Array) => {
      let m = 0;
      const a = zones[i], ax = CX[i * L1], az = CZ[i * L1];
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const b = blockAt(0, ax + dx, az + dz);
        if (b >= 0) for (const j of members[b]) out[m++] = j;
      }
      for (let l = 0; l < L; l++) {
        const bx0 = CX[i * L1 + l], bz0 = CZ[i * L1 + l], px = CX[i * L1 + l + 1], pz = CZ[i * L1 + l + 1];
        for (let qx = px * 3 - 3; qx < px * 3 + 6; qx++) for (let qz = pz * 3 - 3; qz < pz * 3 + 6; qz++) {
          if (qx >= bx0 - 1 && qx <= bx0 + 1 && qz >= bz0 - 1 && qz <= bz0 + 1) continue;
          const b = blockAt(l, qx, qz);
          if (b < 0) continue;
          const B = blocks[b], dx = a.x - B.x, dz = a.z - B.z;
          if (dx * dx + dz * dz <= maxPair2) out[m++] = Z + b;
        }
      }
      return m;
    };
    let most = 0, total = 0;
    const scratch = new Int32Array(Z + blocks.length);
    for (let i = 0; i < Z; i++) { const m = places(i, scratch); total += m; if (m > most) most = m; }
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
    const backGen = new Float64Array(S), back = new Int32Array(S);
    const list = new Int32Array(Math.max(1, most));
    let n = 0;
    for (let i = 0; i < Z; i++) {
      this.start[i] = n;
      const a = zones[i];
      if (S) {
        toGen.fill(Infinity); backGen.fill(Infinity);
        for (const x of a.acc) {
          const r = x.s * S;
          for (let s = 0; s < S; s++) {
            if (s === x.s) continue;
            const t = WW * x.walk + skim.gen[r + s];
            if (t < toGen[s]) { toGen[s] = t; toTime[s] = x.walk + skim.time[r + s]; toRoom[s] = skim.room[r + s]; via[s] = x.s; }
            const h = skim.gen[s * S + x.s] + WW * x.walk;
            if (h < backGen[s]) { backGen[s] = h; back[s] = x.s; }
          }
        }
      }
      const row = cars[i], count = places(i, list);
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
// to a workplace (rather than home) are counted as its visitors when they get off.
export interface TripTables {
  gen: Map<LineState, Map<number, number>>;
  onward: Map<LineState, Map<string, { to: LineState; board: number; alight: number; rate: number }>[]>;
  arrivals: Map<LineState, Float64Array>; visits: Map<LineState, Float64Array>; perDay: number; work: number;
}

export function assignTrips(p: Pairs, skim: Skim, residents: Float64Array, attraction: Float64Array, visit: Float64Array, carShare: Float64Array, cover: Float64Array, tune: Tune = TUNE): TripTables {
  const Z = p.Z, tau = tune.gravityMin, beta = tune.modeBeta;
  const tables: TripTables = { gen: new Map(), onward: new Map(), arrivals: new Map(), visits: new Map(), perDay: 0, work: 0 };
  // what each place draws, the share of that from workplaces, and how much of it is near a stop
  const A = p.sum(attraction), V = p.sum(visit), AC = p.sum(attraction.map((a, z) => a * cover[z]));
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
      const cov = cover[i] * (AC[j] / a);
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
      // out (visiting whatever draws them there), and home again from where they got off
      trip(p.sa[n], p.sb[n], perMin, (perMin * V[j]) / a);
      trip(p.sb[n], p.rb[n], perMin, 0);
      tables.work++;
    }
  }
  for (const k of [...byStops.keys()].sort((a, b) => a - b)) ride(skim.path(Math.floor(k / skim.S), k % skim.S), byStops.get(k)!, visits.get(k) ?? 0);
  return tables;
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
