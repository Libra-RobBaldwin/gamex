// The economy: the model behind towns, industries and your services (docs/ENGINE.md, "The
// economy layer"). It's told what the world holds (towns in zones of buildings, industries,
// stops, lines) and asks the game how long journeys take; it hands back what towns should do
// (build, densify, empty, abandon, clear), money, line and stop figures, and where vehicles are.
//
// It runs on game time, never per frame: `advance(minutes)` steps it in fixed steps (an hour by
// default) and reviews every town once a month. A step costs lines x stops + stops + industries;
// a review costs zones x nearby zones + stops x stops + buildings. Nothing is per person.
import {
  BUILDINGS, FREIGHT, INDUSTRIES, INDUSTRY_SITE_M, STOPS, TUNE, hourShape,
  type Action, type BuildingIn, type BuildingKind, type CargoId, type EconEvent, type IndustryDef, type IndustryIn, type IndustryKind,
  type LineIn, type LineStats, type Oracles, type StopDef, type StopIn, type StopKind, type StopStats, type TownIn, type TownReport,
  type Tune, type Use, type VehiclePos, type WorldIn, type ZoneIn,
} from './econdefs';
import { LineState, NC, type LineCtx, type StopPos } from './econlines';
import { Pairs, Skim, assignTrips, installTrips, reach, type Reach, type ZoneAccess } from './econaccess';
import { newTown, perUse, reviewTown, type BState, type TState, type TownCtx, type ZState } from './econtowns';

export { LineState } from './econlines';
export type { TState, ZState, BState } from './econtowns';

export interface EconomyOptions {
  seed?: number;
  tune?: { [K in keyof Tune]?: Tune[K] extends object ? Partial<Tune[K]> : Tune[K] };
  // apply requests to build at once, placing buildings in their zone (headless runs, tests)
  autoBuild?: boolean;
  // take the towns as they stand at the start to be in balance (default true)
  calibrate?: boolean;
  clock?: number; // minutes past midnight at time 0
  nextId?: number; // first id for buildings placed by autoBuild
}

const FI = Object.fromEntries(FREIGHT.map((c, i) => [c, i])) as Record<CargoId, number>;
const MAX_EVENTS = 10000;

interface SState extends StopPos {
  def: StopDef; radius: number;
  pool: Float64Array; // freight waiting, by FREIGHT index
  slots: { line: LineState; slot: number }[];
  served: boolean; skim: number; // has a running passenger line; index in the skim
  consumes: (IState | TState | null)[]; // who takes each freight cargo delivered here
  carries: Uint8Array; // some line loads this cargo here
  visit: { town: TState; w: number }[]; // whose workplaces passengers getting off here arrive at
  inds: IState[]; // industries in reach of a freight stop, nearest first
  near: SState[]; // other freight stops close enough to hand freight between
  fare: number; // taken this step
  month: { boarded: number; alighted: number; overflow: number };
  last: { boarded: number; alighted: number; overflow: number };
}
interface IState {
  id: number; kind: IndustryKind; def: IndustryDef; x: number; z: number; name: string; zoneHint?: number; zone: ZState | null;
  rate: number; stock: Float64Array; input: Float64Array;
  produced: number; moved: number; received: number; converted: number; // this month
  last: { produced: number; moved: number; received: number };
  out: SState[][]; // by cargo: stops that will take it away
}
interface Pending { req: number; t: 'add' | 'densify'; zone: ZState; kind: BuildingKind; use: Use; gain: number; month: number; building?: BState }

class Rand {
  constructor(public s: number) {}
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export interface IndustryReport { id: number; name: string; kind: IndustryKind; rate: number; produced: number; collected: number; received: number; jobs: number; stock: Partial<Record<CargoId, number>>; input: Partial<Record<CargoId, number>> }

export class Economy {
  readonly tune: Tune;
  readonly oracles: Oracles;
  time = 0; // game minutes stepped so far
  month = 0; // reviews done
  quiet = false; // no events (catching up)
  work = 0; // inner-loop iterations in steps, for the cost tests
  reviewWork = 0;
  // milliseconds spent, for a performance readout
  timing = { steps: 0, times: 0, service: 0, review: 0, parts: { skim: 0, cover: 0, pairs: 0, trips: 0, reach: 0, towns: 0 } };
  totals = { fares: 0, running: 0, delivered: {} as Partial<Record<CargoId, number>> };
  private opts: EconomyOptions;
  private clock: number;
  private acc = 0;
  private nextDay: number;
  private nextReview: number;
  private rand: Rand;
  private townMap = new Map<number, TState>();
  private zoneMap = new Map<number, ZState>();
  private zoneList: ZState[] = [];
  private buildingMap = new Map<number, BState>();
  private indMap = new Map<number, IState>();
  private stopMap = new Map<number, SState>();
  private lineMap = new Map<number, LineState>();
  private lineList: LineState[] = [];
  private pending = new Map<number, Pending>();
  private reqNo = 1;
  private nextId: number;
  private actions: Action[] = [];
  private events: EconEvent[] = [];
  private skim: Skim;
  private cars: (Float32Array | undefined)[] = []; // the car oracle's answers, kept until the network changes
  private pairs: Pairs | null = null;
  private svc = new Map<TState, { stops: number; lines: number }>();
  private lastReach: { work: Reach; shop: Reach; leisure: Reach } | null = null;
  private dirty = { times: true, service: true };
  private fareStops: SState[] = []; // stops that took fares this step
  private paxStops: SState[] = []; // passenger stops with lines calling
  private ctx: LineCtx;

  private static restoring = false; // set by load(): the save brings the towns' memory

  constructor(world: WorldIn, oracles: Oracles, opts: EconomyOptions = {}) {
    // tuning overrides merge one level deep, so { industry: { max: 3 } } keeps the other rules
    const tune: Record<string, unknown> = { ...TUNE };
    for (const [k, v] of Object.entries(opts.tune ?? {}))
      tune[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(tune[k] as object), ...v } : v;
    this.tune = tune as Tune;
    this.oracles = oracles;
    this.opts = opts;
    this.clock = opts.clock ?? 0;
    this.rand = new Rand((opts.seed ?? 1) >>> 0);
    this.nextId = opts.nextId ?? 1_000_000;
    this.nextDay = 1440;
    this.nextReview = this.monthMin;
    this.skim = new Skim([], [], this.tune);
    const site = (L: LineState, slot: number) => L.sites[slot] as SState | undefined;
    const none = new Float64Array(NC);
    this.ctx = {
      fare: (L, slot, amount) => {
        if (amount <= 0) return;
        const st = site(L, slot);
        if (st) { if (st.fare === 0) this.fareStops.push(st); st.fare += amount; }
        this.totals.fares += amount;
      },
      arrive: (L, slot, people) => {
        const st = site(L, slot);
        this.totals.delivered.pax = (this.totals.delivered.pax ?? 0) + people;
        if (!st) return;
        for (const v of st.visit) v.town.month.visitors += people * v.w;
      },
      pool: (L, slot) => site(L, slot)?.pool ?? none,
      freight: (L, slot, c, amount) => this.freightArrives(site(L, slot), c, amount),
    };
    for (const t of world.towns) this.setTown(t);
    for (const z of world.zones) this.setZone(z);
    for (const b of world.buildings) this.addBuilding(b);
    this.setIndustries(world.industries ?? []);
    this.setStops(world.stops ?? []);
    this.setLines(world.lines ?? []);
    if (!Economy.restoring) this.review(true);
  }

  get monthMin() { return this.tune.monthDays * 1440; }

  // ================= the world tells the economy =================
  setTown(t: TownIn) {
    const cur = this.townMap.get(t.id);
    if (cur) { cur.name = t.name; cur.x = t.x; cur.z = t.z; cur.carShare = t.carShare ?? this.tune.carShare; return; }
    this.townMap.set(t.id, newTown(t.id, t.name, t.x, t.z, t.carShare ?? this.tune.carShare));
  }

  setZone(z: ZoneIn) {
    const town = this.townMap.get(z.town);
    if (!town) return;
    const cur = this.zoneMap.get(z.id);
    const allow = z.allow ? new Set(z.allow) : null;
    if (cur) {
      if (cur.x !== z.x || cur.z !== z.z) { this.cars.length = 0; this.dirty.service = true; }
      Object.assign(cur, { x: z.x, z: z.z, r: z.r ?? cur.r, plots: z.plots, allow, blocked: 0 });
      if (cur.town !== town) { cur.town.zones = cur.town.zones.filter((q) => q !== cur); cur.town = town; town.zones.push(cur); }
      return;
    }
    const zs: ZState = {
      id: z.id, idx: -1, town, x: z.x, z: z.z, r: z.r ?? 120, plots: z.plots, reserved: 0, blocked: 0, allow,
      buildings: [], indJobs: 0, cov: 0, centre: 0.5, acc: [], cap: perUse(), occCap: perUse(), pHome: 1, labour: 1, customers: 1,
    };
    this.zoneMap.set(z.id, zs);
    town.zones.push(zs);
    this.reindexZones();
  }

  private reindexZones() {
    this.zoneList = [...this.zoneMap.values()].sort((a, b) => a.id - b.id);
    this.zoneList.forEach((z, i) => (z.idx = i));
    this.cars.length = 0;
    this.dirty.service = true;
  }

  // A building the game has put up: answering a request to build (`req`), or its own.
  addBuilding(b: BuildingIn, req?: number) {
    const z = this.zoneMap.get(b.zone);
    if (!z) return;
    if (this.buildingMap.has(b.id)) { this.updateBuilding(b.id, b, req); return; }
    const def = BUILDINGS[b.kind];
    let p = req !== undefined ? this.pending.get(req) : undefined;
    if (!p) for (const q of this.pending.values()) if (q.t === 'add' && q.zone === z && q.use === def.use) { p = q; break; }
    if (p && p.t === 'add') {
      this.pending.delete(p.req);
      z.reserved = Math.max(0, z.reserved - 1);
      z.plots = Math.max(0, z.plots - 1);
    } else p = undefined;
    const occ = b.occupancy ?? (p ? this.tune.newOccupancy : 1);
    const s: BState = {
      id: b.id, zone: z, x: b.x, z: b.z, kind: b.kind, use: def.use, cap: b.capacity ?? def.cap,
      occ, abandoned: false, since: -1, site: 0.5, shown: Math.round((1 - occ) * 100) / 100, densify: 0,
    };
    z.buildings.push(s);
    this.buildingMap.set(b.id, s);
  }

  // A building changed: densified (answering `req`), resized or moved.
  updateBuilding(id: number, patch: Partial<Pick<BuildingIn, 'kind' | 'capacity' | 'x' | 'z' | 'occupancy'>>, req?: number) {
    const b = this.buildingMap.get(id);
    if (!b) return;
    if (patch.x !== undefined) b.x = patch.x;
    if (patch.z !== undefined) b.z = patch.z;
    if (patch.kind && patch.kind !== b.kind) {
      const people = b.cap * b.occ;
      b.kind = patch.kind;
      b.use = BUILDINGS[patch.kind].use;
      b.cap = patch.capacity ?? BUILDINGS[patch.kind].cap;
      b.occ = Math.min(1, people / Math.max(1, b.cap)); // the same people, in a bigger building
    } else if (patch.capacity !== undefined) b.cap = patch.capacity;
    if (patch.occupancy !== undefined) b.occ = patch.occupancy;
    const p = req !== undefined ? this.pending.get(req) : b.densify ? this.pending.get(b.densify) : undefined;
    if (p && p.building === b) this.pending.delete(p.req);
    b.densify = 0;
  }

  removeBuilding(id: number) {
    const b = this.buildingMap.get(id);
    if (!b) return;
    this.buildingMap.delete(id);
    b.zone.buildings = b.zone.buildings.filter((x) => x !== b);
    for (const p of this.pending.values()) if (p.building === b) this.pending.delete(p.req);
  }

  // The game couldn't do what was asked (no plot fits, say): the zone rests a while.
  decline(req: number) {
    const p = this.pending.get(req);
    if (!p) return;
    this.pending.delete(req);
    if (p.t === 'add') { p.zone.reserved = Math.max(0, p.zone.reserved - 1); p.zone.blocked = 3; }
    if (p.building) p.building.densify = 0;
  }

  setIndustries(list: IndustryIn[]) {
    const keep = new Map<number, IState>();
    for (const i of [...list].sort((a, b) => a.id - b.id)) {
      const cur = this.indMap.get(i.id);
      if (cur && cur.kind === i.kind) { Object.assign(cur, { x: i.x, z: i.z, name: i.name ?? cur.name, zoneHint: i.zone }); keep.set(i.id, cur); continue; }
      const def = INDUSTRIES[i.kind];
      keep.set(i.id, {
        id: i.id, kind: i.kind, def, x: i.x, z: i.z, name: i.name ?? def.name, zoneHint: i.zone, zone: null, rate: 1,
        stock: new Float64Array(NC), input: new Float64Array(NC), produced: 0, moved: 0, received: 0, converted: 0,
        last: { produced: 0, moved: 0, received: 0 }, out: FREIGHT.map(() => []),
      });
    }
    this.indMap = keep;
    this.dirty.service = true;
  }

  setStops(list: StopIn[]) {
    const keep = new Map<number, SState>();
    for (const s of [...list].sort((a, b) => a.id - b.id)) {
      const def = STOPS[s.kind], cur = this.stopMap.get(s.id);
      if (cur && cur.kind === s.kind) { Object.assign(cur, { x: s.x, z: s.z, name: s.name ?? cur.name, radius: s.radius ?? def.radius }); keep.set(s.id, cur); continue; }
      keep.set(s.id, {
        id: s.id, kind: s.kind as StopKind, x: s.x, z: s.z, name: s.name ?? `${def.name} ${s.id}`, def, radius: s.radius ?? def.radius,
        pool: new Float64Array(NC), slots: [], served: false, skim: -1, consumes: FREIGHT.map(() => null), carries: new Uint8Array(NC), visit: [], inds: [], near: [], fare: 0,
        month: { boarded: 0, alighted: 0, overflow: 0 }, last: { boarded: 0, alighted: 0, overflow: 0 },
      });
    }
    this.stopMap = keep;
    this.relink();
    this.dirty.times = this.dirty.service = true;
  }

  // Lines keep their queues and loads unless their stops or vehicle type change.
  setLines(list: LineIn[]) {
    const keep = new Map<number, LineState>();
    for (const l of [...list].sort((a, b) => a.id - b.id)) {
      const cur = this.lineMap.get(l.id);
      if (cur && cur.vehicle === l.vehicle && cur.stops.length === l.stops.length && cur.stops.every((s, i) => s === l.stops[i])) {
        cur.count = Math.max(0, Math.floor(l.count));
        cur.name = l.name ?? cur.name;
        keep.set(l.id, cur);
      } else keep.set(l.id, new LineState(l, this.tune));
    }
    this.lineMap = keep;
    this.lineList = [...keep.values()];
    this.relink();
    this.dirty.times = this.dirty.service = true;
  }

  // The road or rail network changed (or congestion shifted a lot): ask the oracles again.
  networkChanged() { this.dirty.times = this.dirty.service = true; this.cars.length = 0; }

  private relink() {
    for (const s of this.stopMap.values()) s.slots = [];
    for (const L of this.lineList) {
      L.sites = L.stops.map((id) => this.stopMap.get(id));
      L.stops.forEach((id, slot) => this.stopMap.get(id)?.slots.push({ line: L, slot }));
    }
    this.paxStops = [...this.stopMap.values()].filter((s) => s.def.pax && s.slots.length);
  }

  // ================= running =================
  advance(minutes: number) {
    this.acc += Math.max(0, minutes);
    const dt = this.tune.stepMin;
    while (this.acc >= dt) { this.acc -= dt; this.step(); }
  }

  private step() {
    const T = this.tune, dt = T.stepMin;
    let t0 = performance.now();
    if (this.dirty.times) { this.refreshTimes(); const t = performance.now(); this.timing.times += t - t0; t0 = t; }
    if (this.dirty.service) { this.refreshService(); const t = performance.now(); this.timing.service += t - t0; t0 = t; }
    const hour = hourShape(((this.clock + this.time) / 60) % 24);
    for (const ind of this.indMap.values()) this.industryStep(ind, dt);
    for (const L of this.lineList) if (L.pax && L.running) L.generate(dt, hour);
    for (const L of this.lineList) {
      L.step(dt, this.ctx);
      if (!L.running) continue;
      for (let i = 0; i < L.k; i++) {
        const st = L.sites[i] as SState | undefined;
        if (st) st.month.boarded += L.boarded[i], st.month.alighted += L.alighted[i];
      }
    }
    // a stop only holds so many; the rest give up
    for (const st of this.paxStops) {
      let tot = 0;
      for (const s of st.slots) tot += s.line.qsum[s.slot];
      if (tot > st.def.cap) {
        const f = st.def.cap / tot;
        for (const s of st.slots) s.line.scaleWaiting(s.slot, f);
        st.month.overflow += tot - st.def.cap;
      }
    }
    let running = 0;
    for (const L of this.lineList) {
      if (L.count <= 0) continue;
      const cost = (L.count * L.def.running * dt) / 60;
      L.month.running += cost;
      running += cost;
    }
    this.totals.running += running;
    for (const st of this.fareStops) {
      if (!this.quiet && st.fare >= 1) this.emit({ t: 'money', kind: 'fare', amount: Math.round(st.fare), stop: st.id, x: st.x, z: st.z });
      st.fare = 0;
    }
    this.fareStops.length = 0;
    if (!this.quiet && running > 0) this.emit({ t: 'money', kind: 'running', amount: -Math.round(running) });
    for (const L of this.lineList) { this.work += L.work; L.work = 0; }
    this.work += this.stopMap.size + this.indMap.size;
    this.time += dt;
    const t1 = performance.now();
    this.timing.steps += t1 - t0;
    if (this.time >= this.nextDay) { this.nextDay += 1440; this.dirty.times = true; }
    if (this.time >= this.nextReview) {
      this.nextReview += this.monthMin; this.month++;
      this.review(false);
      this.timing.review += performance.now() - t1;
    }
  }

  private emit(e: EconEvent) {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS / 2);
  }

  private pos = (id: number): StopPos | undefined => this.stopMap.get(id);

  private refreshTimes() {
    const was = this.lineList.map((L) => L.running);
    for (const L of this.lineList) L.refresh(this.oracles, this.pos);
    if (this.lineList.some((L, i) => L.running !== was[i])) this.dirty.service = true;
    this.dirty.times = false;
  }

  // ---------------- industries (the 2D rules, per game hour) ----------------
  private industryStep(ind: IState, dt: number) {
    const d = ind.def, h = dt / 60, S = this.tune.industry.stockHours;
    if (d.produces && d.rate) {
      const c = FI[d.produces], add = d.rate * ind.rate * h;
      ind.stock[c] = Math.min(d.rate * ind.rate * S, ind.stock[c] + add);
      ind.produced += add;
    }
    if (d.converts) {
      const f = FI[d.converts.from], use = Math.min(ind.input[f], d.converts.perHour * ind.rate * h);
      if (use > 0) {
        ind.input[f] -= use;
        ind.converted += use;
        if (d.converts.to) {
          const o = FI[d.converts.to], out = use * d.converts.ratio;
          ind.stock[o] = Math.min(d.converts.perHour * d.converts.ratio * ind.rate * S, ind.stock[o] + out);
          ind.produced += out;
        }
      }
    }
    // hand what's made to the stops that have a line to take it away, shared between them
    for (let c = 0; c < NC; c++) {
      const amt = ind.stock[c], to = ind.out[c];
      if (amt < 0.01 || !to.length) continue;
      let moved = 0;
      for (const st of to) {
        let held = 0;
        for (let k = 0; k < NC; k++) held += st.pool[k];
        const m = Math.max(0, Math.min(st.def.cap - held, amt / to.length));
        st.pool[c] += m;
        moved += m;
      }
      ind.stock[c] = amt - moved;
      ind.moved += moved;
    }
  }

  private freightArrives(st: SState | undefined, c: number, amount: number) {
    if (!st) return;
    const who = st.consumes[c], cargo = FREIGHT[c];
    if (who) {
      if ('def' in who) {
        const cap = (who.def.converts?.perHour ?? 60) * 4 * this.tune.industry.stockHours;
        who.input[c] = Math.min(cap, who.input[c] + amount);
        who.received += amount;
      } else if (cargo === 'goods') who.month.goods += amount;
      else if (cargo === 'materials') who.month.materials += amount;
      this.totals.delivered[cargo] = (this.totals.delivered[cargo] ?? 0) + amount;
      return;
    }
    // nobody takes it here: it waits for the next line on (a transfer), here or at a freight stop
    // next door (lorries bringing coal to a railhead, say), if there's room
    const to = st.carries[c] ? st : st.near.find((n) => n.carries[c]) ?? st;
    let held = 0;
    for (let k = 0; k < NC; k++) held += to.pool[k];
    to.pool[c] += Math.max(0, Math.min(amount, to.def.cap - held));
  }

  private reviewIndustries() {
    const I = this.tune.industry, hours = this.monthMin / 60;
    for (const ind of this.indMap.values()) {
      const d = ind.def, before = ind.rate;
      if (d.produces) {
        const frac = ind.moved / Math.max(1, ind.produced);
        if (frac > I.collectedUp && ind.rate < I.max) ind.rate = Math.min(I.max, ind.rate * I.up);
        else if (frac < I.collectedDown && ind.rate > I.min) ind.rate = Math.max(I.min, ind.rate * I.down);
      } else if (d.converts) {
        // a works grows when it's kept busy and what it makes is taken away
        const busy = ind.converted / Math.max(1, d.converts.perHour * ind.rate * hours);
        const taken = d.converts.to ? ind.moved / Math.max(1, ind.produced) : 1;
        if (busy > I.inputUp && taken > I.collectedUp && ind.rate < I.max) ind.rate = Math.min(I.max, ind.rate * I.up);
        else if (busy < 0.1 && ind.rate > I.min) ind.rate = Math.max(I.min, ind.rate * I.down);
      }
      if (ind.rate > before && !this.quiet) this.emit({ t: 'news', text: `${ind.name} increases production (${Math.round(ind.rate * 100)}%).`, x: ind.x, z: ind.z, industry: ind.id });
      ind.last = { produced: ind.produced, moved: ind.moved, received: ind.received };
      ind.produced = ind.moved = ind.received = ind.converted = 0;
    }
  }

  // ---------------- catchments, skims, trips ----------------
  // Service changed (or it's the monthly review): rebuild who is near which stop, the transit
  // skim, zone-pair times and the trip tables the lines run on.
  private refreshService(trips = true) {
    if (this.dirty.times) this.refreshTimes();
    const paxStops = [...this.stopMap.values()].filter((s) => s.def.pax && s.slots.some((x) => x.line.pax && x.line.running));
    for (const s of this.stopMap.values()) { s.served = false; s.skim = -1; }
    paxStops.forEach((s, i) => { s.served = true; s.skim = i; });
    const p = this.timing.parts, t0 = performance.now();
    this.skim = new Skim(paxStops, this.lineList, this.tune);
    this.reviewWork += this.skim.work;
    const t1 = performance.now();
    this.cover();
    const t2 = performance.now();
    this.pairs = new Pairs(this.zoneList, this.skim, this.oracles, this.tune, this.cars);
    this.reviewWork += this.pairs.work;
    const t3 = performance.now();
    if (trips) this.trips();
    p.skim += t1 - t0; p.cover += t2 - t1; p.pairs += t3 - t2; p.trips += performance.now() - t3;
    this.dirty.service = false;
  }

  private cover() {
    const T = this.tune, grid = new Map<number, SState[]>();
    let cell = 500;
    for (const s of this.stopMap.values()) cell = Math.max(cell, s.radius);
    const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
    for (const s of this.stopMap.values()) {
      const k = key(Math.floor(s.x / cell), Math.floor(s.z / cell));
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(s);
      s.visit = [];
      s.inds = [];
      s.near = [];
      s.consumes = FREIGHT.map(() => null);
    }
    const near = (x: number, z: number, fn: (s: SState, d: number) => void) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const g = grid.get(key(cx + dx, cz + dz));
        if (g) for (const s of g) { const dx = s.x - x, dz = s.z - z, d = Math.sqrt(dx * dx + dz * dz); if (d <= s.radius) fn(s, d); }
      }
    };
    // towns: how far out they reach, so buildings know how central they are
    const radius = new Map<TState, number>();
    for (const t of this.townMap.values()) radius.set(t, Math.max(150, ...t.zones.map((z) => Math.hypot(z.x - t.x, z.z - t.z) + z.r)));
    const visit = new Map<SState, Map<TState, number>>(), shops = new Map<SState, Map<TState, number>>(), works = new Map<SState, Map<TState, number>>();
    const bump = (m: Map<SState, Map<TState, number>>, s: SState, t: TState, v: number) => {
      let q = m.get(s);
      if (!q) m.set(s, (q = new Map()));
      q.set(t, (q.get(t) ?? 0) + v);
    };
    for (const z of this.zoneList) {
      const acc = new Map<number, { cap: number; dcap: number }>();
      let total = 0, covered = 0;
      const R = radius.get(z.town)!;
      z.centre = 1 - Math.min(1, Math.hypot(z.x - z.town.x, z.z - z.town.z) / R);
      for (const b of z.buildings) {
        if (b.abandoned) continue;
        total += b.cap;
        let best = Infinity;
        near(b.x, b.z, (s, d) => {
          if (s.served) {
            const a = acc.get(s.skim) ?? { cap: 0, dcap: 0 };
            a.cap += b.cap; a.dcap += b.cap * d;
            acc.set(s.skim, a);
            if (d < best) best = d;
            if (b.use !== 'home') bump(visit, s, z.town, b.cap);
          }
          if (s.def.freight) {
            if (b.use === 'shop') bump(shops, s, z.town, b.cap);
            if (b.use === 'works') bump(works, s, z.town, b.cap);
          }
        });
        if (best < Infinity) covered += b.cap;
        const bx = b.x - z.town.x, bz = b.z - z.town.z, centre = 1 - Math.min(1, Math.sqrt(bx * bx + bz * bz) / R);
        const stop = this.skim.S ? (best < Infinity ? 1 - best / 800 : 0) : 0.3;
        b.site = 0.35 * centre + 0.65 * Math.max(0, stop);
      }
      z.acc = [...acc.entries()].sort((a, b) => a[0] - b[0])
        .map(([s, a]): ZoneAccess => ({ s, walk: ((a.dcap / a.cap) * T.detour) / T.walkMpm, cov: total > 0 ? a.cap / total : 0 }));
      z.cov = total > 0 ? covered / total : 0;
    }
    for (const [s, m] of visit) {
      const sum = [...m.values()].reduce((a, v) => a + v, 0);
      s.visit = [...m.entries()].sort((a, b) => a[0].id - b[0].id).map(([town, v]) => ({ town, w: v / sum }));
    }
    // freight: who takes what at each freight stop (industries first, then towns)
    for (const ind of this.indMap.values()) {
      ind.out = FREIGHT.map(() => []);
      // an industry's jobs count for the zone it names, or the nearest within commuting range
      ind.zone = ind.zoneHint !== undefined ? this.zoneMap.get(ind.zoneHint) ?? null : null;
      if (!ind.zone) {
        let bd = T.indCommuteM;
        for (const z of this.zoneList) { const d = Math.hypot(z.x - ind.x, z.z - ind.z); if (d < bd) { bd = d; ind.zone = z; } }
      }
    }
    const stops = [...this.stopMap.values()];
    for (const s of stops) {
      if (!s.def.freight) continue;
      const inds = [...this.indMap.values()].filter((i) => Math.hypot(i.x - s.x, i.z - s.z) <= s.radius + INDUSTRY_SITE_M)
        .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z) || a.id - b.id);
      for (let c = 0; c < NC; c++) s.consumes[c] = inds.find((i) => i.def.accepts.includes(FREIGHT[c])) ?? null;
      const most = (m: Map<TState, number> | undefined) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0]?.[0] ?? null : null);
      s.consumes[FI.goods] ??= most(shops.get(s));
      s.consumes[FI.materials] ??= most(works.get(s));
      s.inds = inds;
      s.near = stops.filter((o) => o !== s && o.def.freight && Math.hypot(o.x - s.x, o.z - s.z) <= T.transferWalkM);
    }
    this.freightRoutes();
    for (const z of this.zoneList) z.indJobs = 0;
    for (const ind of this.indMap.values()) if (ind.zone) ind.zone.indJobs += ind.def.jobs * ind.rate;
    // which towns have service, for the panel
    this.svc.clear();
    for (const t of this.townMap.values()) {
      const seen = new Set<number>(), lines = new Set<number>();
      for (const z of t.zones) for (const a of z.acc) seen.add(a.s);
      for (const i of seen) { const st = this.stopMap.get(this.skim.ids[i]); for (const s of st?.slots ?? []) if (s.line.pax && s.line.running) lines.add(s.line.id); }
      this.svc.set(t, { stops: seen.size, lines: lines.size });
    }
  }

  // Where each freight line takes each cargo from each stop: the first stop on that consumes it,
  // or failing that, the first where another line goes on to a stop that does (a transfer),
  // as the 2D game's `wants`.
  private freightRoutes() {
    const lines = this.lineList.filter((L) => !L.pax && L.running);
    const at = (L: LineState, j: number) => this.stopMap.get(L.stops[j]);
    for (const s of this.stopMap.values()) s.carries.fill(0);
    const onward = new Map<SState, Uint8Array>(); // stops with a line on to a consumer, by cargo
    for (const L of lines) {
      L.dest.fill(-1);
      for (let i = 0; i < L.k; i++)
        for (let c = 0; c < NC; c++)
          for (let d = 1; d < L.k; d++) {
            const j = (i + d) % L.k, st = at(L, j);
            if (L.stops[j] === L.stops[i] || !st?.consumes[c]) continue;
            L.dest[c * L.k + i] = j;
            const here = at(L, i);
            if (here) (onward.get(here) ?? onward.set(here, new Uint8Array(NC)).get(here)!)[c] = 1;
            break;
          }
    }
    for (const L of lines)
      for (let i = 0; i < L.k; i++)
        for (let c = 0; c < NC; c++) {
          if (L.dest[c * L.k + i] >= 0) continue;
          for (let d = 1; d < L.k; d++) {
            const j = (i + d) % L.k, st = at(L, j);
            if (!st || L.stops[j] === L.stops[i]) continue;
            const here = !!onward.get(st)?.[c] && st.slots.some((x) => x.line !== L && !x.line.pax && x.line.running && x.line.dest[c * x.line.k + x.slot] >= 0);
            if (!here && !st.near.some((n) => onward.get(n)?.[c])) continue;
            L.dest[c * L.k + i] = j;
            break;
          }
        }
    for (const L of lines)
      for (let i = 0; i < L.k; i++) {
        const st = at(L, i);
        if (st) for (let c = 0; c < NC; c++) if (L.dest[c * L.k + i] >= 0) st.carries[c] = 1;
      }
    for (const s of this.stopMap.values())
      for (const ind of s.inds) for (let c = 0; c < NC; c++) if (s.carries[c]) ind.out[c].push(s);
  }

  // zone figures for the reach and trip models
  private zoneArrays() {
    const Z = this.zoneList.length, T = this.tune;
    const a = {
      residents: new Float64Array(Z), workers: new Float64Array(Z), work: new Float64Array(Z), shop: new Float64Array(Z),
      leisure: new Float64Array(Z), car: new Float64Array(Z), attraction: new Float64Array(Z), cover: new Float64Array(Z),
    };
    for (const z of this.zoneList) {
      const i = z.idx, h = z.town.health;
      let res = 0, jobs = z.indJobs, shop = 0, civic = 0;
      for (const b of z.buildings) {
        if (b.abandoned) continue;
        if (b.use === 'home') res += b.cap * b.occ;
        else if (b.use === 'civic') civic += b.cap;
        else jobs += b.cap * h[b.use];
        if (b.use === 'shop') shop += b.cap * h.shop;
      }
      jobs += civic;
      a.residents[i] = res; a.workers[i] = res * T.workerShare; a.work[i] = jobs;
      a.shop[i] = shop * T.customersPerShopJob;
      a.leisure[i] = civic * T.leisurePerCivicJob + shop * T.leisurePerShopJob;
      a.car[i] = z.town.carShare;
      a.attraction[i] = jobs + 2 * shop + 2 * civic + 0.1 * res;
      a.cover[i] = z.cov;
    }
    return a;
  }

  private trips() {
    if (!this.pairs) return;
    const a = this.zoneArrays();
    const t = assignTrips(this.pairs, this.skim, a.residents, a.attraction, a.car, a.cover, this.tune);
    installTrips(this.lineList, t);
    this.reviewWork += t.work;
  }

  // ---------------- the monthly review ----------------
  private review(assess: boolean) {
    const T = this.tune;
    if (!assess) {
      this.reviewIndustries();
      const hours = this.monthMin / 60, a = T.supplyAlpha;
      for (const t of this.townMap.values()) {
        t.supply.goods += a * (t.month.goods / hours - t.supply.goods);
        t.supply.materials += a * (t.month.materials / hours - t.supply.materials);
        t.supply.visitors += a * (t.month.visitors / hours - t.supply.visitors);
        t.month = { goods: 0, materials: 0, visitors: 0 };
      }
      for (const L of this.lineList) L.roll();
      for (const s of this.stopMap.values()) { s.last = s.month; s.month = { boarded: 0, alighted: 0, overflow: 0 }; }
      for (const p of [...this.pending.values()]) if (this.month - p.month >= T.pendingMonths) this.decline(p.req);
      for (const z of this.zoneList) if (z.blocked > 0) z.blocked--;
    }
    // trips are worked out once the towns have changed, below
    this.refreshService(false);
    const t0 = performance.now();
    const za = this.zoneArrays(), p = this.pairs!;
    const work = reach(p, za.workers, za.work, za.car, T.workMin, true);
    const shop = reach(p, za.residents, za.shop, za.car, T.shopMin, true);
    const leisure = reach(p, za.residents, za.leisure, za.car, T.leisureMin, false);
    this.lastReach = { work, shop, leisure };
    const t1 = performance.now();
    this.timing.parts.reach += t1 - t0;
    const pendingCap = (t: TState, u: Use) => { let s = 0; for (const q of this.pending.values()) if (q.zone.town === t && q.use === u) s += q.gain; return s; };
    const ctx: TownCtx = {
      tune: T, month: this.month, calibrate: this.opts.calibrate !== false, assess,
      work, shop, leisure, workSupply: za.work, shopSupply: za.shop, pendingCap,
      add: (z, kind) => this.requestAdd(z, kind),
      densify: (b, kind) => this.requestDensify(b, kind),
      abandon: (b) => { b.abandoned = true; b.since = this.month; b.occ = 0; b.shown = 1; this.actions.push({ t: 'abandon', building: b.id }); },
      restore: (b) => { b.abandoned = false; b.occ = T.newOccupancy; b.shown = Math.round((1 - b.occ) * 100) / 100; this.actions.push({ t: 'restore', building: b.id }); },
      demolish: (b) => { this.removeBuilding(b.id); b.zone.plots++; this.actions.push({ t: 'demolish', building: b.id }); },
      vacate: (b, fraction) => { if (!assess) this.actions.push({ t: 'vacate', building: b.id, fraction }); },
      service: (t) => this.svc.get(t) ?? { stops: 0, lines: 0 },
    };
    for (const t of [...this.townMap.values()].sort((a, b) => a.id - b.id)) {
      const before = t.report;
      reviewTown(t, ctx);
      if (!assess) this.townNews(t, before);
    }
    const t2 = performance.now();
    this.timing.parts.towns += t2 - t1;
    // the month's changes feed next month's trips
    this.trips();
    this.timing.parts.trips += performance.now() - t2;
  }

  private townNews(t: TState, before: TownReport | null) {
    const r = t.report;
    if (!r || !before || this.quiet) return;
    for (const m of [1000, 2500, 5000, 10000, 20000, 50000])
      if (before.residents < m && r.residents >= m) this.emit({ t: 'news', text: `${t.name} has grown to ${r.residents.toLocaleString('en-GB')} people!`, x: t.x, z: t.z, town: t.id });
    if (r.status !== before.status && (r.status === 'declining' || before.status === 'declining'))
      this.emit({ t: 'news', text: `${t.name}: ${r.headline.charAt(0).toLowerCase()}${r.headline.slice(1)}.`, x: t.x, z: t.z, town: t.id });
  }

  private requestAdd(z: ZState, kind: BuildingKind) {
    const req = this.reqNo++;
    this.pending.set(req, { req, t: 'add', zone: z, kind, use: BUILDINGS[kind].use, gain: BUILDINGS[kind].cap, month: this.month });
    z.reserved++;
    this.actions.push({ t: 'add', req, zone: z.id, kind });
    if (this.opts.autoBuild) {
      // somewhere in the zone, away from its middle a little each time
      const a = this.rand.next() * Math.PI * 2, d = Math.sqrt(this.rand.next()) * z.r * 0.8;
      this.addBuilding({ id: this.nextId++, zone: z.id, x: z.x + Math.cos(a) * d, z: z.z + Math.sin(a) * d, kind }, req);
    }
  }

  private requestDensify(b: BState, kind: BuildingKind) {
    const req = this.reqNo++;
    b.densify = req;
    this.pending.set(req, { req, t: 'densify', zone: b.zone, kind, use: b.use, gain: BUILDINGS[kind].cap - b.cap, month: this.month, building: b });
    this.actions.push({ t: 'densify', req, building: b.id, kind });
    if (this.opts.autoBuild) this.updateBuilding(b.id, { kind }, req);
  }

  // ================= what the game reads =================
  takeActions(): Action[] { const a = this.actions; this.actions = []; return a; }
  takeEvents(): EconEvent[] { const e = this.events; this.events = []; return e; }

  town(id: number): TownReport | null { return this.townMap.get(id)?.report ?? null; }
  townReports(): TownReport[] { return [...this.townMap.values()].sort((a, b) => a.id - b.id).map((t) => t.report!).filter(Boolean); }

  line(id: number): LineStats | null {
    const L = this.lineMap.get(id);
    if (!L) return null;
    let waiting = 0;
    if (L.pax) for (let i = 0; i < L.k; i++) waiting += L.qsum[i];
    const m = L.month, running = Number.isFinite(L.cycle);
    return {
      id: L.id, name: L.name, vehicle: L.vehicle, vehicles: L.count, ok: L.ok, problem: L.problem,
      cycleMin: running ? L.cycle : Infinity, headwayMin: L.headway, capacityPerHour: running && L.count ? (L.def.capacity * L.count * 60) / L.cycle : 0,
      carried: m.carried, carriedLastMonth: L.last.carried, loadFactor: m.loadDen > 0 ? m.loadNum / m.loadDen : L.last.loadFactor,
      revenue: m.revenue, running: m.running, profit: m.revenue - m.running,
      revenueLastMonth: L.last.revenue, profitLastMonth: L.last.revenue - L.last.running, waiting,
    };
  }
  lineStats(): LineStats[] { return this.lineList.map((L) => this.line(L.id)!); }

  stop(id: number): StopStats | null {
    const s = this.stopMap.get(id);
    if (!s) return null;
    let waiting = 0;
    for (const x of s.slots) if (x.line.pax) waiting += x.line.qsum[x.slot];
    const cargo: Partial<Record<CargoId, number>> = {};
    FREIGHT.forEach((c, i) => { if (s.pool[i] >= 0.5) cargo[c] = s.pool[i]; });
    return { id, name: s.name, waiting, cargo, boarded: s.month.boarded, alighted: s.month.alighted, lines: [...new Set(s.slots.map((x) => x.line.id))] };
  }

  industry(id: number): IndustryReport | null {
    const i = this.indMap.get(id);
    if (!i) return null;
    const pick = (a: Float64Array) => Object.fromEntries(FREIGHT.map((c, k) => [c, a[k]]).filter(([, v]) => (v as number) >= 0.5)) as Partial<Record<CargoId, number>>;
    const p = i.produced || i.last.produced, m = i.produced ? i.moved : i.last.moved;
    return { id, name: i.name, kind: i.kind, rate: i.rate, produced: p, collected: p > 0 ? m / p : 0, received: i.received || i.last.received, jobs: i.def.jobs * i.rate, stock: pick(i.stock), input: pick(i.input) };
  }

  // Where every vehicle is (or those of one line), `at` game minutes (default now).
  vehicles(line?: number, at = this.time + this.acc): VehiclePos[] {
    const since = Math.max(0, at - this.time);
    const out: VehiclePos[] = [];
    for (const L of this.lineList) if (line === undefined || L.id === line) out.push(...L.positions(since, this.pos));
    return out;
  }

  // A zone's reach at the last review (1 = enough in reach), for a map overlay: with a car, and
  // without (on foot or your lines), to work, shops and leisure; and its pressure for homes.
  zoneReach(id: number) {
    const z = this.zoneMap.get(id), r = this.lastReach;
    if (!z || !r || z.idx < 0 || z.idx >= r.work.car.length) return null;
    const pick = (x: Reach) => ({ car: x.car[z.idx], noCar: x.nc[z.idx], transit: x.pt[z.idx] });
    return { work: pick(r.work), shop: pick(r.shop), leisure: pick(r.leisure), labour: z.labour, customers: z.customers, homes: z.pHome, cover: z.cov };
  }

  // everyone living in the towns, and the jobs there
  population() {
    let residents = 0, jobs = 0;
    for (const b of this.buildingMap.values()) {
      if (b.abandoned) continue;
      if (b.use === 'home') residents += b.cap * b.occ; else jobs += b.cap;
    }
    return { residents, jobs };
  }
  buildingState(id: number) {
    const b = this.buildingMap.get(id);
    return b ? { id: b.id, zone: b.zone.id, kind: b.kind, use: b.use, capacity: b.cap, occupancy: b.occ, abandoned: b.abandoned } : null;
  }
  buildingIds() { return [...this.buildingMap.keys()]; }

  // ================= saving =================
  // What the economy owns (building use and occupancy, town memory, industries, loads) is saved;
  // catchments, skims and trip tables are rebuilt on load, as ENGINE.md has it.
  save() {
    const arr = (a: Float64Array) => [...a];
    return {
      v: 1, time: this.time, month: this.month, acc: this.acc, nextDay: this.nextDay, nextReview: this.nextReview, rand: this.rand.s,
      reqNo: this.reqNo, nextId: this.nextId, totals: structuredClone(this.totals),
      towns: [...this.townMap.values()].map((t) => ({
        id: t.id, base: { ...t.base }, bias: { ...t.bias }, calibrated: t.calibrated, primed: t.primed, labour: t.labour, customers: t.customers,
        supply: { ...t.supply }, month: { ...t.month }, use: structuredClone(t.use), health: { ...t.health }, history: [...t.history], report: t.report ? structuredClone(t.report) : null,
      })),
      zones: this.zoneList.map((z) => ({ id: z.id, plots: z.plots, reserved: z.reserved, blocked: z.blocked })),
      buildings: [...this.buildingMap.values()].map((b) => ({ id: b.id, zone: b.zone.id, x: b.x, z: b.z, kind: b.kind, cap: b.cap, occ: b.occ, abandoned: b.abandoned, since: b.since, shown: b.shown, densify: b.densify })),
      industries: [...this.indMap.values()].map((i) => ({ id: i.id, rate: i.rate, stock: arr(i.stock), input: arr(i.input), produced: i.produced, moved: i.moved, received: i.received, converted: i.converted, last: { ...i.last } })),
      stops: [...this.stopMap.values()].map((s) => ({ id: s.id, pool: arr(s.pool), month: { ...s.month }, last: { ...s.last } })),
      lines: this.lineList.map((L) => ({ id: L.id, ...L.save() })),
      pending: [...this.pending.values()].map((p) => ({ req: p.req, t: p.t, zone: p.zone.id, kind: p.kind, use: p.use, gain: p.gain, month: p.month, building: p.building?.id })),
    };
  }

  // `world` is what the game has now (towns, zones, stops, lines, industries); buildings come
  // from the save, since the economy is the authority on what they're used for.
  static load(world: WorldIn, oracles: Oracles, s: EconomySave, opts: EconomyOptions = {}) {
    Economy.restoring = true;
    let e: Economy;
    try { e = new Economy({ ...world, buildings: [] }, oracles, opts); } finally { Economy.restoring = false; }
    Object.assign(e, { time: s.time, month: s.month, acc: s.acc, nextDay: s.nextDay, nextReview: s.nextReview, reqNo: s.reqNo, nextId: s.nextId });
    e.rand.s = s.rand;
    e.totals = structuredClone(s.totals);
    for (const z of s.zones) { const q = e.zoneMap.get(z.id); if (q) Object.assign(q, z); }
    for (const b of s.buildings) {
      e.addBuilding({ id: b.id, zone: b.zone, x: b.x, z: b.z, kind: b.kind, capacity: b.cap, occupancy: b.occ });
      const q = e.buildingMap.get(b.id);
      if (q) Object.assign(q, { abandoned: b.abandoned, since: b.since, shown: b.shown, densify: b.densify });
    }
    for (const t of s.towns) {
      const q = e.townMap.get(t.id);
      if (q) Object.assign(q, structuredClone({ ...t, id: q.id }));
    }
    for (const i of s.industries) {
      const q = e.indMap.get(i.id);
      if (!q) continue;
      Object.assign(q, { rate: i.rate, produced: i.produced, moved: i.moved, received: i.received, converted: i.converted, last: { ...i.last } });
      q.stock.set(i.stock); q.input.set(i.input);
    }
    for (const st of s.stops) { const q = e.stopMap.get(st.id); if (q) { q.pool.set(st.pool); q.month = { ...st.month }; q.last = { ...st.last }; } }
    for (const l of s.lines) e.lineMap.get(l.id)?.restore(l);
    for (const p of s.pending) {
      const zone = e.zoneMap.get(p.zone);
      if (zone) e.pending.set(p.req, { req: p.req, t: p.t as Pending['t'], zone, kind: p.kind, use: p.use, gain: p.gain, month: p.month, building: p.building !== undefined ? e.buildingMap.get(p.building) : undefined });
    }
    e.dirty.times = e.dirty.service = true;
    return e;
  }
}

export type EconomySave = ReturnType<Economy['save']>;
