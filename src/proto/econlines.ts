// Lines as flows. A line's vehicles are spread evenly round its loop, so rather than simulate
// each one, a step moves the capacity that the whole fleet brings past each stop (vehicles x
// seats x step / cycle time) round the loop once: people get off, then on, up to what's left.
// Loads are kept per stop (waiting, by where they're going) and per line (on board), never per
// person. Each vehicle's position and load are worked out from the flow when the game asks, so
// the cost is lines x stops, whatever the size of the fleet or the towns.
import { CARGO, FREIGHT, STOPS, TUNE, VEHICLES, canServe, type LineIn, type Oracles, type StopKind, type Tune, type VehicleDef, type VehicleKind, type VehiclePos } from './econdefs';

export const NC = FREIGHT.length;

export interface StopPos { id: number; x: number; z: number; kind: StopKind; name: string }

// Where people changing lines go next: of those getting off at a slot, `share` board `line`
// at slot `board`, heading for slot `alight`.
export interface Onward { line: LineState; board: number; alight: number; share: number }

// What a line reports back as it runs: fares taken, people finishing their journey, freight
// arriving (the economy decides whether it's consumed there or waits for another line, and how
// much of it there's room for: what isn't taken stays on board, unpaid, and goes round again).
export interface LineCtx {
  fare(line: LineState, slot: number, amount: number): void;
  arrive(line: LineState, slot: number, people: number): void;
  pool(line: LineState, slot: number): Float64Array; // freight waiting at a slot's stop, by FREIGHT index
  // of that, what came off another line (its journey's fixed fare is paid already)
  relayed(line: LineState, slot: number): Float64Array;
  // how much of a cargo the stop at a slot could still take (for its consumer or to wait there)
  room(line: LineState, slot: number, cargo: number): number;
  // returns how much of it was taken
  freight(line: LineState, slot: number, cargo: number, amount: number): number;
}

export class LineState {
  readonly id: number;
  name: string;
  readonly vehicle: VehicleKind;
  readonly def: VehicleDef;
  readonly stops: number[];
  readonly k: number;
  count: number;
  ok = true;
  problem?: string;
  readonly tau: Float64Array; // minutes on each leg, slot i to slot i+1
  readonly dwell: Float64Array; // minutes stood at each slot
  readonly timedDwell: Float64Array; // the dwells ride times and fares were last worked out from
  // The ride times and headway the network was last planned on (the skim, freight routes and trip
  // tables): fixed when those are rebuilt, and saved, so a loaded game plans on the same.
  readonly planRide: Float64Array;
  planHeadway = Infinity;
  cycle = Infinity;
  phase = 0; // how far round the loop vehicle 0 is, 0..1
  readonly km: Float64Array; // straight-line km, slot i to slot j
  readonly ride: Float64Array; // minutes on board, slot i to slot j (downstream)
  // passengers: waiting by (board slot, alight slot), of them those changing from another line,
  // on board by alight slot, fares owed
  readonly q: Float64Array;
  readonly qx: Float64Array;
  readonly qsum: Float64Array;
  readonly onboard: Float64Array;
  readonly owed: Float64Array;
  readonly fare: Float64Array;
  readonly fixed: Float64Array; // the fixed part of `fare`, paid once a journey
  genIdx = new Int32Array(0);
  genRate = new Float64Array(0);
  onward: Onward[][];
  // of those getting off at each slot at the end of their journey, the share visiting a workplace
  // (rather than going home)
  visitShare: Float64Array;
  // Of those wanting to board at each slot, the share who found room last month (smoothed), and
  // this month's counts. Reach counts a journey on a full line only as far as people get on.
  readonly room: Float64Array;
  private readonly want: Float64Array;
  private readonly got: Float64Array;
  private readonly judged: Uint8Array; // the first month with people to judge by is taken as it is
  // last month's counts at each slot: people who came to board, and how many of them did
  readonly lastWant: Float64Array;
  readonly lastGot: Float64Array;
  sites: unknown[] = []; // whatever the owner keeps for each slot's stop
  // freight on board by (cargo, alight slot); where each cargo boarding at a slot is taken
  readonly fonb: Float64Array;
  readonly fowed: Float64Array;
  readonly dest: Int16Array;
  private readonly avail = new Float64Array(NC);
  // this step, per slot
  readonly legFlow: Float64Array;
  readonly boarded: Float64Array;
  readonly alighted: Float64Array;
  private load = 0;
  private dt: number;
  month = { carried: 0, revenue: 0, running: 0, loadNum: 0, loadDen: 0 };
  last = { carried: 0, revenue: 0, running: 0, loadFactor: 0 };
  work = 0; // inner-loop iterations, for the cost tests

  constructor(l: LineIn, private readonly tune: Tune = TUNE) {
    this.dt = tune.stepMin;
    this.id = l.id;
    this.name = l.name ?? `Line ${l.id}`;
    this.vehicle = l.vehicle;
    this.def = VEHICLES[l.vehicle];
    this.stops = [...l.stops];
    this.count = Math.max(0, Math.floor(l.count));
    const k = (this.k = this.stops.length);
    this.tau = new Float64Array(k);
    this.dwell = new Float64Array(k).fill(this.def.dwell);
    this.timedDwell = new Float64Array(k).fill(this.def.dwell);
    this.planRide = new Float64Array(k * k);
    this.km = new Float64Array(k * k);
    this.ride = new Float64Array(k * k);
    this.q = new Float64Array(this.def.pax ? k * k : 0);
    this.qx = new Float64Array(this.def.pax ? k * k : 0);
    this.qsum = new Float64Array(k);
    this.onboard = new Float64Array(k);
    this.owed = new Float64Array(k);
    this.fare = new Float64Array(this.def.pax ? k * k : 0);
    this.fixed = new Float64Array(this.def.pax ? k * k : 0);
    this.onward = Array.from({ length: k }, () => []);
    this.visitShare = new Float64Array(k);
    this.room = new Float64Array(k).fill(1);
    this.want = new Float64Array(k);
    this.got = new Float64Array(k);
    this.judged = new Uint8Array(k);
    this.lastWant = new Float64Array(k);
    this.lastGot = new Float64Array(k);
    this.fonb = new Float64Array(this.def.pax ? 0 : NC * k);
    this.fowed = new Float64Array(this.def.pax ? 0 : NC * k);
    this.dest = new Int16Array(this.def.pax ? 0 : NC * k).fill(-1);
    this.legFlow = new Float64Array(k);
    this.boarded = new Float64Array(k);
    this.alighted = new Float64Array(k);
  }

  get pax() { return this.def.pax; }
  get running() { return this.ok && this.count > 0 && Number.isFinite(this.cycle); }
  get headway() { return this.count > 0 ? this.cycle / this.count : Infinity; }

  // the network is being planned again: on the ride times and headway of the moment
  fixPlan() {
    this.planRide.set(this.ride);
    this.planHeadway = this.running ? this.headway : Infinity;
  }

  // Asks the game how long each leg takes (it knows the route and the traffic), and works out
  // ride times and fares from them. Done daily, not every step: the oracle may be pathfinding.
  // `keepDwell` works them out from the dwells they were last worked out from (a loaded game
  // carrying on where the saved one was), not from the dwells of the moment.
  refresh(oracles: Oracles, pos: (id: number) => StopPos | undefined, keepDwell = false) {
    const k = this.k;
    this.ok = true;
    this.problem = undefined;
    const ps = this.stops.map(pos);
    if (k < 2) { this.fail('A line needs at least two stops.'); return; }
    for (let i = 0; i < k; i++) {
      const p = ps[i];
      if (!p) { this.fail('One of its stops has gone.'); return; }
      if (!canServe(this.def, STOPS[p.kind])) { this.fail(`A ${this.def.name.toLowerCase()} can't use ${p.name} (${STOPS[p.kind].name.toLowerCase()}).`); return; }
      if (this.stops[(i + 1) % k] === this.stops[i]) { this.fail('The same stop twice in a row.'); return; }
    }
    for (let m = 0; m < k; m++) {
      const t = oracles.travelTime(this.stops[m], this.stops[(m + 1) % k], this.vehicle);
      if (!(t >= 0) || !Number.isFinite(t)) { this.fail(`No route from ${ps[m]!.name} to ${ps[(m + 1) % k]!.name}.`); return; }
      this.tau[m] = Math.max(0.1, t);
    }
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++) this.km[i * k + j] = Math.hypot(ps[i]!.x - ps[j]!.x, ps[i]!.z - ps[j]!.z) / 1000;
    if (!keepDwell) this.timedDwell.set(this.dwell);
    this.retime();
  }

  private fail(why: string) {
    this.ok = false;
    this.problem = why;
    this.cycle = Infinity;
  }

  // cycle time from the leg times and current dwells; ride times and fares from the leg times
  // and the dwells they are timed on
  private retime() {
    const k = this.k, dw = this.timedDwell;
    let c = 0;
    for (let m = 0; m < k; m++) c += this.tau[m] + this.dwell[m];
    this.cycle = c;
    for (let i = 0; i < k; i++) {
      let t = 0;
      this.ride[i * k + i] = 0;
      for (let d = 1; d < k; d++) {
        const m = (i + d - 1) % k;
        t += this.tau[m] + (d > 1 ? dw[m] : 0);
        this.ride[i * k + ((i + d) % k)] = t;
      }
    }
    if (this.pax)
      for (let i = 0; i < k; i++)
        for (let j = 0; j < k; j++) {
          this.fare[i * k + j] = i === j ? 0 : this.unitFare(0, i, j);
          this.fixed[i * k + j] = i === j ? 0 : this.fixedFare(0, i, j);
        }
  }

  // £ per unit carried from slot i to slot j: a fixed part (in full from `fullKm`) and a part by
  // distance, more for getting there faster than the reference speed (and less for dawdling),
  // like the 2D game. The fixed part is paid once a journey: those changing from another line (or
  // freight handed on from one) pay only the part by distance, so splitting a route into short
  // lines earns no more than running it as one.
  unitFare(cargo: number, i: number, j: number) {
    const c = CARGO[this.pax ? 'pax' : FREIGHT[cargo]];
    const km = this.km[i * this.k + j], t = this.ride[i * this.k + j];
    const speed = Math.max(0.6, Math.min(1.6, ((km / c.refKmh) * 60) / Math.max(0.5, t)));
    return this.fixedFare(cargo, i, j) + c.perKm * km * speed;
  }
  fixedFare(cargo: number, i: number, j: number) {
    const c = CARGO[this.pax ? 'pax' : FREIGHT[cargo]];
    return c.base * Math.min(1, this.km[i * this.k + j] / c.fullKm);
  }

  // people changing onto this line (their journey's fixed fare is paid)
  addWaiting(board: number, alight: number, n: number) {
    this.q[board * this.k + alight] += n;
    this.qx[board * this.k + alight] += n;
    this.qsum[board] += n;
    this.want[board] += n;
  }
  // some of those waiting at a slot give up (the stop is full)
  scaleWaiting(slot: number, f: number) {
    const row = slot * this.k;
    for (let j = 0; j < this.k; j++) { this.q[row + j] *= f; this.qx[row + j] *= f; }
    this.qsum[slot] *= f;
  }

  // New passengers turn up at each slot for each destination slot on this line.
  generate(dt: number, hour: number) {
    const f = dt * hour, k = this.k, idx = this.genIdx, rate = this.genRate;
    for (let n = 0; n < idx.length; n++) {
      const add = rate[n] * f, slot = (idx[n] / k) | 0;
      this.q[idx[n]] += add;
      this.qsum[slot] += add;
      this.want[slot] += add;
    }
    this.work += idx.length;
  }

  // One step's worth of service round the loop.
  step(dt: number, ctx: LineCtx) {
    if (!this.running) return;
    this.dt = dt;
    const k = this.k, dep = (this.count * dt) / this.cycle, cap = this.def.capacity * dep;
    this.boarded.fill(0);
    this.alighted.fill(0);
    if (this.pax) this.stepPax(cap, ctx); else this.stepFreight(cap, ctx);
    this.work += k * k;
    // stood longer at busy stops: dwell follows the people through the doors (smoothed, so a
    // crowd doesn't make the line judder between fast and slow)
    const a = this.tune.dwellAlpha, top = this.def.dwell + 8;
    for (let i = 0; i < k; i++) {
      const per = (this.boarded[i] + this.alighted[i]) / Math.max(1e-6, dep);
      const want = Math.min(top, this.def.dwell + (this.def.board * per) / 60);
      this.dwell[i] += a * (want - this.dwell[i]);
    }
    let c = 0;
    for (let m = 0; m < k; m++) {
      c += this.tau[m] + this.dwell[m];
      this.month.loadNum += this.legFlow[m] * this.tau[m];
      this.month.loadDen += cap * this.tau[m];
    }
    this.cycle = c;
    this.phase = (this.phase + dt / c) % 1;
  }

  private stepPax(cap: number, ctx: LineCtx) {
    const k = this.k, q = this.q;
    for (let i = 0; i < k; i++) {
      const a = this.onboard[i];
      if (a > 1e-9) {
        this.onboard[i] = 0;
        this.load -= a;
        ctx.fare(this, i, this.owed[i]);
        this.month.revenue += this.owed[i];
        this.owed[i] = 0;
        let rest = a;
        for (const o of this.onward[i]) {
          const m = a * o.share;
          o.line.addWaiting(o.board, o.alight, m);
          rest -= m;
        }
        if (rest > 1e-9) ctx.arrive(this, i, rest);
        this.alighted[i] = a;
      }
      const room = cap - this.load, Q = this.qsum[i];
      if (room > 1e-9 && Q > 1e-9) {
        const take = Math.min(room, Q), f = take / Q, row = i * k;
        for (let j = 0; j < k; j++) {
          const v = q[row + j];
          if (v <= 0) continue;
          const m = v * f, x = this.qx[row + j] * f;
          q[row + j] = v - m;
          this.onboard[j] += m;
          this.owed[j] += m * this.fare[row + j] - x * this.fixed[row + j];
          if (x > 0) this.qx[row + j] -= x;
        }
        this.qsum[i] = Q - take;
        this.load += take;
        this.boarded[i] = take;
        this.got[i] += take;
        this.month.carried += take;
      }
      if (this.load < 1e-9) this.load = 0;
      this.legFlow[i] = this.load;
    }
  }

  private stepFreight(cap: number, ctx: LineCtx) {
    const k = this.k;
    for (let i = 0; i < k; i++) {
      for (let c = 0; c < NC; c++) {
        const n = c * k + i, a = this.fonb[n];
        if (a <= 1e-9) continue;
        // paid only for what the stop takes; the rest stays on board and comes round again
        const took = Math.min(a, Math.max(0, ctx.freight(this, i, c, a)));
        if (took <= 1e-9) continue;
        const paid = this.fowed[n] * (took / a);
        this.fonb[n] = a - took;
        this.fowed[n] -= paid;
        if (this.fonb[n] <= 1e-9) this.fonb[n] = this.fowed[n] = 0;
        this.load -= took;
        ctx.fare(this, i, paid);
        this.month.revenue += paid;
        this.alighted[i] += took;
      }
      const room = cap - this.load;
      if (room > 1e-9) {
        const pool = ctx.pool(this, i);
        // load only what the stop it's taken to has room for, less what's on board for it already
        const avail = this.avail;
        let total = 0;
        for (let c = 0; c < NC; c++) {
          const j = this.dest[c * k + i];
          avail[c] = j >= 0 && pool[c] > 0 ? Math.min(pool[c], Math.max(0, ctx.room(this, j, c) - this.fonb[c * k + j])) : 0;
          total += avail[c];
        }
        if (total > 1e-9) {
          const take = Math.min(room, total), f = take / total, relayed = ctx.relayed(this, i);
          for (let c = 0; c < NC; c++) {
            if (avail[c] <= 0) continue;
            const j = this.dest[c * k + i], m = avail[c] * f, x = relayed[c] * (m / pool[c]);
            pool[c] -= m;
            relayed[c] -= x;
            this.fonb[c * k + j] += m;
            this.fowed[c * k + j] += m * this.unitFare(c, i, j) - x * this.fixedFare(c, i, j);
          }
          this.load += take;
          this.boarded[i] = take;
          this.month.carried += take;
        }
      }
      if (this.load < 1e-9) this.load = 0;
      this.legFlow[i] = this.load;
    }
  }

  // Close the month's books, and see how many of those who wanted to board found room.
  roll() {
    const m = this.month;
    this.last = { carried: m.carried, revenue: m.revenue, running: m.running, loadFactor: m.loadDen > 0 ? m.loadNum / m.loadDen : 0 };
    this.month = { carried: 0, revenue: 0, running: 0, loadNum: 0, loadDen: 0 };
    const a = this.tune.roomAlpha;
    for (let i = 0; i < this.k; i++) {
      // a few people aren't enough to judge by; those left from last month may board this one
      const r = this.want[i] > 1 ? Math.min(1, this.got[i] / this.want[i]) : 1;
      this.room[i] += (this.judged[i] ? a : 1) * (r - this.room[i]);
      if (this.want[i] > 1) this.judged[i] = 1;
      this.lastWant[i] = this.want[i]; this.lastGot[i] = Math.min(this.got[i], this.want[i]);
      this.want[i] = this.got[i] = 0;
    }
  }

  // Each vehicle's place on the loop, `since` minutes after the last step. Vehicles are spread
  // a headway apart; each stands at a stop for its dwell, then runs the leg to the next.
  positions(since: number, pos: (id: number) => StopPos | undefined): VehiclePos[] {
    const out: VehiclePos[] = [];
    if (!this.running) return out;
    const k = this.k, C = this.cycle, dep = Math.max(1e-6, (this.count * this.dt) / C);
    for (let v = 0; v < this.count; v++) {
      let tm = ((((this.phase + v / this.count + since / C) % 1) + 1) % 1) * C;
      let leg = 0, t = 0, dwelling = true;
      for (let i = 0; i < k; i++) {
        if (tm < this.dwell[i]) { leg = i; t = 0; dwelling = true; break; }
        tm -= this.dwell[i];
        if (tm < this.tau[i] || i === k - 1) { leg = i; t = Math.min(1, tm / this.tau[i]); dwelling = false; break; }
        tm -= this.tau[i];
      }
      const a = pos(this.stops[leg]), b = pos(this.stops[(leg + 1) % k]);
      const x = a && b ? a.x + (b.x - a.x) * t : 0, z = a && b ? a.z + (b.z - a.z) * t : 0;
      out.push({
        line: this.id, index: v, leg, from: this.stops[leg], to: this.stops[(leg + 1) % k], t, dwelling, x, z,
        load: Math.min(this.def.capacity, this.legFlow[leg] / dep), capacity: this.def.capacity,
      });
    }
    return out;
  }

  // What's saved: the queues and loads, so a loaded game carries on where it stopped.
  save() {
    return {
      phase: this.phase, dwell: [...this.dwell], timedDwell: [...this.timedDwell], planRide: [...this.planRide],
      planHeadway: Number.isFinite(this.planHeadway) ? this.planHeadway : null, q: [...this.q], qx: [...this.qx], onboard: [...this.onboard], owed: [...this.owed],
      fonb: [...this.fonb], fowed: [...this.fowed], load: this.load, month: { ...this.month }, last: { ...this.last },
      room: [...this.room], want: [...this.want], got: [...this.got], judged: [...this.judged],
      lastWant: [...this.lastWant], lastGot: [...this.lastGot],
    };
  }
  restore(s: ReturnType<LineState['save']>) {
    this.phase = s.phase;
    s.dwell.forEach((v, i) => (this.dwell[i] = v));
    if (s.timedDwell?.length === this.k) this.timedDwell.set(s.timedDwell); else this.timedDwell.set(this.dwell);
    if (s.planRide?.length === this.k * this.k) this.planRide.set(s.planRide);
    this.planHeadway = s.planHeadway ?? Infinity;
    s.q.forEach((v, i) => (this.q[i] = v));
    s.qx?.forEach((v, i) => (this.qx[i] = v));
    for (let i = 0; i < this.k; i++) { let t = 0; for (let j = 0; j < this.k; j++) t += this.q[i * this.k + j] ?? 0; this.qsum[i] = t; }
    s.onboard.forEach((v, i) => (this.onboard[i] = v));
    s.owed.forEach((v, i) => (this.owed[i] = v));
    s.fonb.forEach((v, i) => (this.fonb[i] = v));
    s.fowed.forEach((v, i) => (this.fowed[i] = v));
    this.load = s.load;
    this.month = { ...s.month };
    this.last = { ...s.last };
    s.room.forEach((v, i) => (this.room[i] = v));
    s.want.forEach((v, i) => (this.want[i] = v));
    s.got.forEach((v, i) => (this.got[i] = v));
    s.judged.forEach((v, i) => (this.judged[i] = v));
    s.lastWant?.forEach((v, i) => (this.lastWant[i] = v));
    s.lastGot?.forEach((v, i) => (this.lastGot[i] = v));
  }
}
