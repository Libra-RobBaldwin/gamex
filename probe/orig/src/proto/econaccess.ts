// Who can get where, and how. Three layers, each rebuilt only when what it depends on changes:
//  - the transit skim: quickest times between every pair of passenger stops over your lines
//    (waiting half a headway, riding, changing), with the route kept for assigning trips;
//  - zone pairs: door-to-door minutes between zones on foot, by car (the game's oracle) and by
//    bus or rail (walk to a stop, the skim, walk from the stop), for zones within reach;
//  - reach: how well each zone's people can get to work, shops and leisure in reasonable time,
//    allowing for competition (a job reached by a thousand workers is shared among them).
// Trips are then spread over destinations by a gravity model, split between car, foot and your
// lines by a logit on time, and those on your lines are loaded onto the rides of their route.
import { TUNE, type Oracles, type Tune } from './econdefs';
import type { LineState, Onward } from './econlines';

// ---------------- transit skim ----------------
export interface Ride { line: LineState; board: number; alight: number }

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
  readonly time: Float32Array; // S x S minutes, Infinity if out of reach
  private readonly pred: Int32Array; // S x S: the edge that reached it
  private eFrom: Int32Array = new Int32Array(0);
  private eLine: (LineState | null)[] = [];
  private eBoard: Int32Array = new Int32Array(0);
  private eAlight: Int32Array = new Int32Array(0);
  work = 0;

  constructor(stops: { id: number; x: number; z: number }[], lines: LineState[], tune: Tune = TUNE) {
    const S = (this.S = stops.length);
    this.ids = stops.map((s) => s.id);
    stops.forEach((s, i) => this.index.set(s.id, i));
    this.time = new Float32Array(S * S).fill(Infinity);
    this.pred = new Int32Array(S * S).fill(-1);
    if (!S) return;
    // edges: a ride from each slot to every later slot on the loop, and short walks between stops
    const from: number[] = [], to: number[] = [], cost: number[] = [], line: (LineState | null)[] = [], board: number[] = [], alight: number[] = [];
    for (const L of lines) {
      if (!L.pax || !L.running) continue;
      const wait = Math.min(L.headway / 2, tune.maxWaitMin) + tune.boardMin;
      for (let i = 0; i < L.k; i++) {
        const u = this.index.get(L.stops[i]);
        if (u === undefined) continue;
        for (let d = 1; d < L.k; d++) {
          const j = (i + d) % L.k, v = this.index.get(L.stops[j]);
          if (v === undefined || v === u) continue;
          from.push(u); to.push(v); cost.push(wait + L.ride[i * L.k + j]); line.push(L); board.push(i); alight.push(j);
        }
      }
    }
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
          from.push(u); to.push(v); cost.push((d * tune.detour) / tune.walkMpm); line.push(null); board.push(-1); alight.push(-1);
        }
    });
    // adjacency in compressed rows
    const E = from.length, off = new Int32Array(S + 1);
    for (let e = 0; e < E; e++) off[from[e] + 1]++;
    for (let i = 0; i < S; i++) off[i + 1] += off[i];
    const order = new Int32Array(E), fill = off.slice(0, S);
    for (let e = 0; e < E; e++) order[fill[from[e]]++] = e;
    this.eFrom = Int32Array.from(from);
    this.eLine = line;
    this.eBoard = Int32Array.from(board);
    this.eAlight = Int32Array.from(alight);
    const eTo = Int32Array.from(to), eCost = Float64Array.from(cost);
    const dist = new Float64Array(S), rode = new Uint8Array(S), done = new Uint8Array(S);
    for (let o = 0; o < S; o++) {
      dist.fill(Infinity); rode.fill(0); done.fill(0);
      dist[o] = 0;
      const heap = new Heap();
      heap.push(0, o);
      const row = o * S;
      while (heap.size) {
        const [d, u] = heap.pop();
        if (done[u]) continue;
        if (d > tune.maxTransitMin) break;
        done[u] = 1;
        this.time[row + u] = d;
        for (let n = off[u]; n < off[u + 1]; n++) {
          const e = order[n], v = eTo[e];
          if (done[v]) continue;
          const ride = line[e] !== null;
          // walking from the start isn't a change; boarding after a ride is
          const nd = d + eCost[e] + (ride && rode[u] ? tune.transferMin : 0);
          if (nd < dist[v]) {
            dist[v] = nd;
            this.pred[row + v] = e;
            rode[v] = ride ? 1 : rode[u];
            heap.push(nd, v);
          }
          this.work++;
        }
      }
    }
  }

  // the rides from stop index a to stop index b, in order
  path(a: number, b: number): Ride[] {
    const out: Ride[] = [];
    const row = a * this.S;
    let e = this.pred[row + b], guard = 0;
    while (e >= 0 && guard++ < 64) {
      const L = this.eLine[e];
      if (L) out.push({ line: L, board: this.eBoard[e], alight: this.eAlight[e] });
      const u = this.eFrom[e];
      if (u === a) break;
      e = this.pred[row + u];
    }
    return out.reverse();
  }
}

// ---------------- zone pairs ----------------
export interface ZoneAccess { s: number; walk: number; cov: number } // skim stop, minutes on foot, share of the zone
export interface ZoneGeo { id: number; x: number; z: number; r: number; acc: ZoneAccess[] }

export class Pairs {
  n = 0;
  readonly start: Int32Array; // pairs from origin i are start[i] .. start[i+1]-1
  i: Int32Array; j: Int32Array;
  car: Float32Array; // door to door with a car to hand (they'll walk or ride if that's quicker)
  nc: Float32Array; // without a car: on foot or your lines
  pt: Float32Array; // by your lines alone
  walk: Float32Array;
  drive: Float32Array; // by car alone
  sa: Int32Array; sb: Int32Array; // the stops of the quickest route by your lines (-1 if none)
  work = 0;

  // `cars` keeps the car oracle's answers between rebuilds, a row per origin in the order its
  // candidates come (the same while the zones stay put): roads change far less often than bus
  // routes, so the economy empties it when the network changes rather than asking every month.
  constructor(zones: ZoneGeo[], skim: Skim, oracles: Oracles, tune: Tune = TUNE, cars: (Float32Array | undefined)[] = []) {
    const Z = zones.length;
    this.start = new Int32Array(Z + 1);
    const cell = tune.maxPairM, grid = new Map<number, number[]>();
    const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
    zones.forEach((z, i) => {
      const k = key(Math.floor(z.x / cell), Math.floor(z.z / cell));
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    });
    let cap = Math.max(64, Z * 8), n = 0;
    let I = new Int32Array(cap), J = new Int32Array(cap), SA = new Int32Array(cap), SB = new Int32Array(cap);
    let CAR = new Float32Array(cap), NCs = new Float32Array(cap), PT = new Float32Array(cap), W = new Float32Array(cap), D = new Float32Array(cap);
    const grow = () => {
      cap *= 2;
      const gi = (a: Int32Array) => { const b = new Int32Array(cap); b.set(a); return b; };
      const gf = (a: Float32Array) => { const b = new Float32Array(cap); b.set(a); return b; };
      I = gi(I); J = gi(J); SA = gi(SA); SB = gi(SB); CAR = gf(CAR); NCs = gf(NCs); PT = gf(PT); W = gf(W); D = gf(D);
    };
    // beyond this nobody goes, by any means: reach stops at half as long again as its limits,
    // and trips this long are a few per cent of those next door
    const cut = Math.max(1.5 * tune.workMin, 4 * tune.gravityMin);
    const buf = new Int32Array(Z), fresh: number[] = [];
    // from this origin, the quickest (walk + ride) to every stop, and which stop it set off from
    const S = skim.S, toStop = new Float32Array(S), via = new Int32Array(S);
    for (let i = 0; i < Z; i++) {
      this.start[i] = n;
      const a = zones[i], cx = Math.floor(a.x / cell), cz = Math.floor(a.z / cell);
      toStop.fill(Infinity);
      for (const x of a.acc) {
        const r = x.s * S;
        for (let s = 0; s < S; s++) {
          if (s === x.s) continue;
          const t = x.walk + skim.time[r + s];
          if (t < toStop[s]) { toStop[s] = t; via[s] = x.s; }
        }
      }
      let nn = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const g = grid.get(key(cx + dx, cz + dz)); if (g) for (const j of g) buf[nn++] = j; }
      const near = buf.subarray(0, nn).sort();
      const row = cars[i];
      fresh.length = 0;
      let m = 0;
      for (let q = 0; q < nn; q++) {
        const j = near[q], b = zones[j], ddx = a.x - b.x, ddz = a.z - b.z, crow = Math.sqrt(ddx * ddx + ddz * ddz);
        if (crow > cell) continue;
        const walk = i === j ? Math.max(2, (a.r * 0.7 * tune.detour) / tune.walkMpm) : (crow * tune.detour) / tune.walkMpm;
        let ct: number;
        if (row && m < row.length) ct = row[m]; else { ct = oracles.carTime(a.id, b.id); fresh.push(ct); }
        m++;
        const drive = Number.isFinite(ct) && ct >= 0 ? ct + tune.carAccessMin : Infinity;
        // quickest door to door by your lines: walk to a stop, ride, walk from a stop
        let pt = Infinity, s1 = -1, s2 = -1;
        for (const y of b.acc) {
          const t = toStop[y.s] + y.walk;
          if (t < pt) { pt = t; s1 = via[y.s]; s2 = y.s; }
        }
        const nc = Math.min(walk, pt), car = Math.min(drive, nc);
        this.work++;
        if (car > cut) continue;
        if (n === cap) grow();
        I[n] = i; J[n] = j; CAR[n] = car; NCs[n] = nc; PT[n] = pt; W[n] = walk; D[n] = drive; SA[n] = s1; SB[n] = s2;
        n++;
      }
      if (!row) cars[i] = Float32Array.from(fresh);
    }
    this.start[Z] = n;
    this.n = n;
    this.i = I.slice(0, n); this.j = J.slice(0, n); this.sa = SA.slice(0, n); this.sb = SB.slice(0, n);
    this.car = CAR.slice(0, n); this.nc = NCs.slice(0, n); this.pt = PT.slice(0, n); this.walk = W.slice(0, n); this.drive = D.slice(0, n);
  }

  // the pair going the other way, or -1
  reverse(n: number) {
    const i = this.i[n], j = this.j[n];
    let lo = this.start[j], hi = this.start[j + 1] - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1, v = this.j[m];
      if (v === i) return m;
      if (v < i) lo = m + 1; else hi = m - 1;
    }
    return -1;
  }
}

// ---------------- reach ----------------
// Two-step floating catchment: each destination's supply is shared among everyone who can
// reach it in time; each origin adds up its shares. 1 means "enough within reach". With
// `share` it also shares each origin's people among the destinations they reach (a Huff
// model), which says how many workers or customers each place gets.
// `lost` is demand at each origin that reaches nowhere at all (so isn't shared out).
export interface Reach { car: Float64Array; nc: Float64Array; pt: Float64Array; ratio: Float64Array; lost: Float64Array }

export function reach(p: Pairs, demand: Float64Array, supply: Float64Array, carShare: Float64Array, T: number, share: boolean): Reach {
  const Z = demand.length, g = (t: number) => (t <= T ? 1 : t >= 1.5 * T ? 0 : (1.5 * T - t) / (0.5 * T));
  const denom = new Float64Array(Z), sc = new Float64Array(Z), sn = new Float64Array(Z);
  const out: Reach = { car: new Float64Array(Z), nc: new Float64Array(Z), pt: new Float64Array(Z), ratio: new Float64Array(Z), lost: new Float64Array(Z) };
  const lim = 1.5 * T;
  for (let n = 0; n < p.n; n++) {
    const tc = p.car[n];
    if (tc >= lim) continue;
    const i = p.i[n], j = p.j[n], gc = g(tc), gn = g(p.nc[n]), c = carShare[i];
    denom[j] += demand[i] * (c * gc + (1 - c) * gn);
    if (share) { sc[i] += supply[j] * gc; sn[i] += supply[j] * gn; }
  }
  const alloc = new Float64Array(Z);
  for (let n = 0; n < p.n; n++) {
    const tc = p.car[n];
    if (tc >= lim) continue;
    const i = p.i[n], j = p.j[n], S = supply[j];
    if (S <= 0) continue;
    const gc = g(tc), gn = g(p.nc[n]), R = denom[j] > 0 ? S / denom[j] : 0;
    out.car[i] += R * gc;
    out.nc[i] += R * gn;
    out.pt[i] += R * g(p.pt[n]);
    if (share) {
      const c = carShare[i], D = demand[i];
      if (sc[i] > 0) alloc[j] += (D * c * S * gc) / sc[i];
      if (sn[i] > 0) alloc[j] += (D * (1 - c) * S * gn) / sn[i];
    }
  }
  if (share)
    for (let j = 0; j < Z; j++) {
      out.ratio[j] = supply[j] > 0 ? alloc[j] / supply[j] : 0;
      out.lost[j] = demand[j] * (carShare[j] * (sc[j] > 0 ? 0 : 1) + (1 - carShare[j]) * (sn[j] > 0 ? 0 : 1));
    }
  return out;
}

// ---------------- trips onto lines ----------------
// Every resident makes `tripsPerDay` one-way trips, half out and half back. Destinations are
// weighted by what's there and how long it takes to get to (gravity); the mode by a logit on
// door-to-door time. The share by your lines is loaded onto the rides of the quickest route:
// the first ride as passengers turning up at the stop, later rides as people changing.
export interface TripTables { gen: Map<LineState, Map<number, number>>; onward: Map<LineState, Map<string, { to: LineState; board: number; alight: number; rate: number }>[]>; arrivals: Map<LineState, Float64Array>; perDay: number; work: number }

export function assignTrips(p: Pairs, skim: Skim, residents: Float64Array, attraction: Float64Array, carShare: Float64Array, cover: Float64Array, tune: Tune = TUNE): TripTables {
  const Z = p.start.length - 1, tau = tune.gravityMin, beta = tune.modeBeta;
  const tables: TripTables = { gen: new Map(), onward: new Map(), arrivals: new Map(), perDay: 0, work: 0 };
  // many zone pairs share the same stops: add them up first, then trace each route once
  const byStops = new Map<number, number>();
  const trip = (a: number, b: number, rate: number) => { if (a >= 0 && b >= 0) { const k = a * skim.S + b; byStops.set(k, (byStops.get(k) ?? 0) + rate); } };
  const ride = (rides: Ride[], rate: number) => {
    let prev: Ride | null = null;
    for (const r of rides) {
      const L = r.line;
      let arr = tables.arrivals.get(L);
      if (!arr) tables.arrivals.set(L, (arr = new Float64Array(L.k)));
      arr[r.alight] += rate;
      if (!prev) {
        let g = tables.gen.get(L);
        if (!g) tables.gen.set(L, (g = new Map()));
        const key = r.board * L.k + r.alight;
        g.set(key, (g.get(key) ?? 0) + rate);
      } else {
        let on = tables.onward.get(prev.line);
        if (!on) tables.onward.set(prev.line, (on = Array.from({ length: prev.line.k }, () => new Map())));
        const key = `${L.id}:${r.board}:${r.alight}`, cur = on[prev.alight].get(key);
        if (cur) cur.rate += rate; else on[prev.alight].set(key, { to: L, board: r.board, alight: r.alight, rate });
      }
      prev = r;
    }
  };
  for (let i = 0; i < Z; i++) {
    const R = residents[i];
    if (R <= 0) continue;
    const s0 = p.start[i], s1 = p.start[i + 1];
    let sumC = 0, sumN = 0;
    for (let n = s0; n < s1; n++) {
      const A = attraction[p.j[n]];
      if (A <= 0) continue;
      sumC += A * Math.exp(-p.car[n] / tau);
      sumN += A * Math.exp(-p.nc[n] / tau);
    }
    const c = carShare[i], trips = R * tune.tripsPerDay;
    for (let n = s0; n < s1; n++) {
      const j = p.j[n], pt = p.pt[n], A = attraction[j];
      if (A <= 0 || !Number.isFinite(pt)) continue;
      const cov = cover[i] * cover[j];
      if (cov <= 0) continue;
      // with a car: car, your lines or on foot; without: your lines or on foot
      const uw = -beta * p.walk[n], up = -beta * pt, ud = -beta * (p.drive[n] + tune.carBiasMin);
      const mx = Math.max(uw, up, Number.isFinite(ud) ? ud : -Infinity);
      const ew = Math.exp(uw - mx), ep = Math.exp(up - mx), ed = Number.isFinite(ud) ? Math.exp(ud - mx) : 0;
      const shareCar = ep / (ew + ep + ed), shareNc = ep / (ew + ep);
      const daily = (sumC > 0 ? (trips * c * A * Math.exp(-p.car[n] / tau)) / sumC : 0) * shareCar
        + (sumN > 0 ? (trips * (1 - c) * A * Math.exp(-p.nc[n] / tau)) / sumN : 0) * shareNc;
      const perMin = (daily * cov) / 1440 / 2;
      if (perMin < 1e-7) continue;
      tables.perDay += daily * cov;
      trip(p.sa[n], p.sb[n], perMin);
      const r = p.reverse(n);
      if (r >= 0) trip(p.sa[r], p.sb[r], perMin);
      tables.work++;
    }
  }
  for (const k of [...byStops.keys()].sort((a, b) => a - b)) ride(skim.path(Math.floor(k / skim.S), k % skim.S), byStops.get(k)!);
  return tables;
}

// Put the tables onto the lines: generation rates, and for each slot where people get off, the
// shares who change and where to.
export function installTrips(lines: LineState[], t: TripTables) {
  for (const L of lines) {
    if (!L.pax) continue;
    const g = t.gen.get(L);
    const keys = g ? [...g.keys()].sort((a, b) => a - b) : [];
    L.genIdx = Int32Array.from(keys);
    L.genRate = Float64Array.from(keys.map((k) => g!.get(k)!));
    const on = t.onward.get(L), arr = t.arrivals.get(L);
    L.onward = Array.from({ length: L.k }, (_, s): Onward[] => {
      if (!on || !arr || arr[s] <= 0) return [];
      return [...on[s].values()].sort((a, b) => a.to.id - b.to.id || a.board - b.board || a.alight - b.alight)
        .map((o) => ({ line: o.to, board: o.board, alight: o.alight, share: Math.min(1, o.rate / arr[s]) }));
    });
  }
}
