// The economy in the game (docs/loop.md, M2): the library (economy.ts and econ*.ts) runs the
// town, and this is the glue. The game tells it what stands (buildings on their lots, free plots,
// stops and the player's lines) and how long journeys take; it steps on the game clock and hands
// back what the town should do: build on a free plot, build denser, empty, clear. Its figures
// feed the one town panel, the stops' sheets and the crowds waiting at the stops.
//
// One town, cut into zones on a 160 m grid so reach and catchments mean something. A game "month"
// (the economy's review, when towns decide to grow or shrink) is one game day: six minutes at 1x,
// so a line's effect shows while you watch.
import { Economy, type EconomySave } from '../economy';
import { BUILDINGS, VEHICLES, type Action, type BuildingKind, type EconEvent, type LineIn, type Oracles, type StopIn, type TownReport, type VehicleKind, type ZoneIn } from '../econdefs';
import { USE } from '../buildgen';
import type { Lot, LotKind, Network, P } from '../roads';
import type { Traffic } from '../traffic';
import type { Lines } from './lines';
import { TownNumbers, type CrowdNumbers } from './crowds';
import type { StopSite } from './crowdsites';
import { FARE, MONTH, RUNNING, type Purse } from './money';

export const TOWN_ID = 1;
export const TOWN_NAME = 'Ashcombe';
const CELL = 160;
const TOWN_KMH = 28; // cars across town, junctions and all
const SERVICE_KMH = 0.55; // a bus in town makes this share of its book speed, stops aside

export interface TownHooks {
  net: Network; traffic: Traffic; lines: Lines;
  standing(): Lot[]; // lots with a building on them (the player's town, not industrial sites)
  free(): Lot[]; // plots the town could still build on
  build(l: Lot): void; // put a building up on a free plot
  rebuild(l: Lot, kind: LotKind): void; // the same plot, built denser
  clear(l: Lot): void; // pull it down; the plot is free again
  industrial(p: P): boolean;
  clock(): number; // game minutes since the start
  purse?: Purse; // fares and running costs go here as they happen (game/money.ts)
  rail?: RailHooks; // the railway's stations and lines (rail/game.ts), alongside the bus stops and lines
}
// The railway as the economy sees it: stations as stops and rail lines as lines (their ids kept
// clear of the buses'), how long a train takes between two stations (minutes), and what a train
// costs to run for a game day.
export interface RailHooks { stops(): StopIn[]; lines(): LineIn[]; time(a: number, b: number, v: VehicleKind): number | undefined; running(v: VehicleKind): number }

// The library's tuning, set for this town (measured with the town as it starts, its starter line,
// and a second line added or the first withdrawn):
//  - a review each game day, so the town's month passes while you watch;
//  - it's taken to be in balance as it starts even though it has more jobs than workers (so it's
//    propped up further than the library's default allows), and plenty of jobs in reach keeps
//    counting towards where people want to live, so homes follow the jobs your service brings;
//  - the town finds its own goods and materials until freight is in the game;
//  - its offices live on visitors, and most of them come by your buses: the starter line about
//    holds the town steady, a second line through the housing makes it grow within a few days,
//    and withdrawing the starter line makes it decline;
//  - taking the bus carries no penalty beyond its walk, wait and ride (the town is small enough
//    to walk across, so otherwise hardly anyone would).
//  - and it answers sooner than a real town would: a day of demand a little above what stands is
//    enough to build, two days well below it to start emptying.
const GAME_TUNE = {
  monthDays: 1, calibrateMax: 3, reachCap: 4, visitsPerOfficeJobDay: 0.1, ptBiasMin: 0,
  growAt: 1.02, growAfter: 1, declineAt: 0.95, declineAfter: 2, recoverAt: 0.98,
  local: { homes: 0.5, goods: 1, materials: 1, visitors: 0.3 },
};
const zoneKey = (x: number, z: number) => (Math.floor(x / CELL) + 500) * 1000 + (Math.floor(z / CELL) + 500);
const kindOf = (k: LotKind): BuildingKind => k;
const capOf = (k: LotKind) => USE[k].pop || BUILDINGS[kindOf(k)].cap;

export class TownEconomy {
  econ: Economy;
  private lotById = new Map<number, Lot>();
  private zones = new Map<number, ZoneIn>();
  private serviceSig = '';
  private travel = new Map<string, number>();
  private events: EconEvent[] = [];
  report: TownReport | null = null;
  private carried = new Map<number, number>(); // each line's passengers this month, as last seen
  private day = -1;
  stats = { builds: 0, densified: 0, cleared: 0, declined: 0, ms: 0 };

  constructor(private h: TownHooks, seed = 1) {
    const zones = this.zoneList();
    const buildings = h.standing().map((l) => { this.lotById.set(l.id, l); return { id: l.id, zone: zoneKey(l.x, l.z), x: l.x, z: l.z, kind: kindOf(l.kind), capacity: capOf(l.kind) }; });
    this.econ = new Economy(
      { towns: [{ id: TOWN_ID, name: TOWN_NAME, x: 0, z: 0, carShare: 0.45 }], zones, buildings, stops: this.stopList(), lines: this.lineList() },
      this.oracles(),
      // Until freight is in the game the town finds its own goods and building materials; and it
      // finds most of its visitors itself, so the starter line about holds it steady and more
      // service is what tips it into growth.
      { seed, calibrate: true, clock: h.clock() % 1440, tune: GAME_TUNE },
    );
    this.serviceSig = this.sig();
    this.report = this.econ.town(TOWN_ID);
  }

  // ---------- what the game tells the economy ----------
  // zones: the grid cells with a building or a free plot in them
  private zoneList(): ZoneIn[] {
    const plots = new Map<number, number>(), at = new Map<number, P>();
    const see = (l: Lot, free: number) => { const k = zoneKey(l.x, l.z); plots.set(k, (plots.get(k) ?? 0) + free); if (!at.has(k)) at.set(k, { x: (Math.floor(l.x / CELL) + 0.5) * CELL, z: (Math.floor(l.z / CELL) + 0.5) * CELL }); };
    for (const l of this.h.standing()) see(l, 0);
    for (const l of this.h.free()) see(l, 1);
    const out: ZoneIn[] = [];
    for (const [id, n] of plots) {
      const p = at.get(id)!;
      const z: ZoneIn = { id, town: TOWN_ID, x: p.x, z: p.z, r: CELL / 2, plots: n, allow: this.h.industrial(p) ? ['industry'] : undefined };
      out.push(z);
      this.zones.set(id, z);
    }
    return out;
  }
  // one stop per place (a stop and the one facing it), keyed by the lower of their ids
  private key(stop: number) { const p = this.h.traffic.place(stop); return p ? Math.min(...p.stops.map((s) => s.id)) : stop; }
  private stopList(): StopIn[] {
    const out: StopIn[] = [], seen = new Set<number>();
    for (const seg of this.h.net.segs.values()) for (const st of seg.stops) {
      const k = this.key(st.id);
      if (seen.has(k)) continue;
      seen.add(k);
      const p = this.h.net.path(seg), q = p[Math.min(p.length - 1, Math.max(0, Math.round((st.s / Math.max(1, this.h.net.length(seg))) * (p.length - 1))))];
      out.push({ id: k, kind: 'bus_stop', x: q.x, z: q.z, name: this.h.lines.name(k) });
    }
    if (this.h.rail) out.push(...this.h.rail.stops());
    return out;
  }
  private lineList(): LineIn[] {
    return this.h.lines.list.map((l): LineIn => ({ id: l.id, name: `Line ${l.num}`, stops: l.bus.seq.map((s) => this.key(s)), vehicle: vehicleFor(l.offer, this.h.traffic, l.id), count: this.h.lines.buses(l).length }))
      .filter((l) => l.count > 0 && l.stops.length >= 2)
      .concat((this.h.rail?.lines() ?? []).filter((l) => l.count > 0 && l.stops.length >= 2));
  }
  private sig() { return JSON.stringify([this.stopList().map((s) => s.id), this.lineList().map((l) => [l.id, l.stops, l.count, l.vehicle])]); }

  private oracles(): Oracles {
    return {
      // along the roads the buses take, at a town pace
      travelTime: (a, b, v) => {
        const rail = this.h.rail?.time(a, b, v);
        if (rail !== undefined) return rail;
        const k = `${a}>${b}`;
        let m = this.travel.get(k);
        if (m === undefined) {
          const legs = this.h.traffic.lineRoute([a, b]);
          const len = legs[0]?.reduce((s, r) => s + (r.s1 - r.s0), 0) ?? 0;
          m = len > 0 ? len : Infinity;
          this.travel.set(k, m);
        }
        return m === Infinity ? Infinity : m / ((VEHICLES[v].kmh * SERVICE_KMH * 1000) / 60) + 0.3;
      },
      carTime: (a, b) => {
        const p = this.zones.get(a), q = this.zones.get(b);
        if (!p || !q) return Infinity;
        return (Math.hypot(p.x - q.x, p.z - q.z) * 1.3) / ((TOWN_KMH * 1000) / 60) + 1;
      },
    };
  }

  // Keep the economy's picture in step with the town: buildings the game added or lost (a road
  // through them), free plots per zone, stops and lines. Cheap; call it every second or two.
  sync() {
    const now = new Map(this.h.standing().map((l) => [l.id, l]));
    for (const id of this.econ.buildingIds()) if (!now.has(id)) { this.econ.removeBuilding(id); this.lotById.delete(id); }
    const zl = this.zoneList();
    for (const z of zl) this.econ.setZone(z);
    for (const [id, l] of now) if (!this.lotById.has(id)) { this.lotById.set(id, l); this.econ.addBuilding({ id, zone: zoneKey(l.x, l.z), x: l.x, z: l.z, kind: kindOf(l.kind), capacity: capOf(l.kind) }); }
    const s = this.sig();
    if (s !== this.serviceSig) {
      this.serviceSig = s;
      this.econ.setStops(this.stopList());
      this.econ.setLines(this.lineList());
    }
  }
  networkChanged() { this.travel.clear(); this.econ.networkChanged(); this.serviceSig = ''; }

  // ---------- stepping ----------
  // game minutes to run on (0 while paused)
  advance(minutes: number) {
    if (minutes <= 0) return;
    const t0 = performance.now();
    this.econ.advance(minutes);
    this.money(minutes);
    for (const a of this.econ.takeActions()) this.apply(a);
    this.events.push(...this.econ.takeEvents());
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.report = this.econ.town(TOWN_ID);
    this.stats.ms += (performance.now() - t0 - this.stats.ms) * 0.05;
  }
  // Fares for the passengers each line has carried since last time (a month's worth for each
  // day's riders: a game day is a month here), and running costs for its buses by the minute.
  private money(minutes: number) {
    const purse = this.h.purse;
    const day = Math.floor(this.h.clock() / 1440);
    if (purse && this.day >= 0 && day !== this.day) purse.newDay();
    this.day = day;
    for (const l of this.h.lines.list) {
      const s = this.econ.line(l.id), was = this.carried.get(l.id) ?? 0;
      const now = s?.carried ?? 0;
      // (the month turned over: the rest of last month, then this one's)
      const riders = now >= was ? now - was : Math.max(0, (s?.carriedLastMonth ?? 0) - was) + now;
      this.carried.set(l.id, now);
      const buses = this.h.lines.buses(l).length, kind = vehicleFor(l.offer, this.h.traffic, l.id);
      const run = buses * (RUNNING[kind as keyof typeof RUNNING] ?? RUNNING.bus) * (minutes / 1440);
      purse?.flow(l.id, riders * MONTH * FARE, run);
    }
    // the rail lines the same way, a train's running costs in place of a bus's
    for (const l of this.h.rail?.lines() ?? []) {
      const s = this.econ.line(l.id), was = this.carried.get(l.id) ?? 0, now = s?.carried ?? 0;
      const riders = now >= was ? now - was : Math.max(0, (s?.carriedLastMonth ?? 0) - was) + now;
      this.carried.set(l.id, now);
      purse?.flow(l.id, riders * MONTH * FARE * 2, l.count * this.h.rail!.running(l.vehicle) * (minutes / 1440));
    }
  }
  takeEvents() { const e = this.events; this.events = []; return e; }

  private apply(a: Action) {
    if (a.t === 'add') {
      // a free plot in that zone drawn for a building of that use (the plot decides its exact
      // kind); failing that, one wide enough re-planned for it (a house plot on the edge of town
      // can take a small office or a row of shops when that's what the town wants)
      const use = BUILDINGS[a.kind].use, here = this.h.free().filter((x) => zoneKey(x.x, x.z) === a.zone);
      const near = (p: Lot, q: Lot) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z);
      let l = here.filter((x) => BUILDINGS[kindOf(x.kind)].use === use).sort(near)[0];
      if (!l && REPLAN[a.kind]) {
        const [minW, h0, h1] = REPLAN[a.kind]!;
        l = here.filter((x) => x.w >= minW && x.kind !== 'industry').sort(near)[0];
        if (l) { l.kind = a.kind as LotKind; l.h = h0 + ((l.seed * 1000) % 1) * (h1 - h0); }
      }
      if (!l) { this.econ.decline(a.req); this.stats.declined++; return; }
      this.h.build(l);
      this.lotById.set(l.id, l);
      this.econ.addBuilding({ id: l.id, zone: a.zone, x: l.x, z: l.z, kind: kindOf(l.kind), capacity: capOf(l.kind) }, a.req);
      this.stats.builds++;
    } else if (a.t === 'densify') {
      const l = this.lotById.get(a.building);
      if (!l || !densifies(l.kind, a.kind)) { this.econ.decline(a.req); this.stats.declined++; return; }
      this.h.rebuild(l, a.kind as LotKind);
      this.econ.updateBuilding(l.id, { kind: a.kind, capacity: capOf(a.kind as LotKind) }, a.req);
      this.stats.densified++;
    } else if (a.t === 'demolish') {
      const l = this.lotById.get(a.building);
      if (l) { this.h.clear(l); this.lotById.delete(l.id); this.stats.cleared++; }
    }
    // vacate, abandon and restore are the economy's own books; the panel and sheets show them
  }

  // ---------- what the game shows ----------
  building(id: number) { return this.econ.buildingState(id); }
  stop(stopId: number) { return this.econ.stop(this.key(stopId)); }
  line(id: number) { return this.econ.line(id); }
  save(): EconomySave { return this.econ.save(); }

  // The crowds' numbers: people waiting at a stop come from the economy; the rest of the street
  // life (footways, parks, pubs) stays the town's own curve for now.
  numbers(): CrowdNumbers {
    const base = new TownNumbers(), self = this;
    return Object.assign(Object.create(base) as TownNumbers, {
      arrivals(s: StopSite, clock: number) {
        const st = self.stop(s.stop);
        if (!st) return base.arrivals(s, clock) * 0.2;
        // the queue settles to arrivals x patience (crowds.ts STOP_PATIENCE, 20 minutes): split
        // between the two sides of the road where both have a stop
        const sides = self.h.traffic.place(s.stop)?.stops.length ?? 1;
        return st.waiting / sides / 20;
      },
    });
  }
}

// what a stop's bus model counts as in the economy
function vehicleFor(offer: string | undefined, traffic: Traffic, line: number): VehicleKind {
  const bus = traffic.busesOn(line)[0], name = (bus !== undefined ? traffic.bus(bus)?.model : offer) ?? '';
  if (/double|decker/i.test(name)) return 'decker';
  if (/mini/i.test(name)) return 'minibus';
  if (/coach/i.test(name)) return 'coach';
  return 'bus';
}
// what a free plot needs to be re-planned for another kind of building: its least width, and
// the range of heights to build to
const REPLAN: Partial<Record<BuildingKind, [number, number, number]>> = { office: [8.5, 14, 22], shop: [6, 7, 11], flats: [8.5, 11, 16], house: [8.5, 6, 6], terrace: [5.5, 7, 9] };
// the game can build a plot denser along the same use: house, terrace, flats, tower
const CHAIN: LotKind[] = ['house', 'terrace', 'flats', 'tower'];
function densifies(from: LotKind, to: BuildingKind) {
  const a = CHAIN.indexOf(from), b = CHAIN.indexOf(to as LotKind);
  return a >= 0 && b > a;
}
