// People in the game. The town's people aren't simulated one by one (ENGINE.md: simulate flows,
// show agents): the game works out how many are walking along each footway, waiting at each stop,
// strolling in each park, and the people library (src/proto/people) turns those numbers into
// figures near the camera, moved and posed on the GPU.
//
// The numbers come through `CrowdNumbers`. The economy isn't wired in yet, so `TownNumbers` works
// them out from what the game already has: the traffic's time-of-day curve (traffic.ts demand), who
// lives and works on each street (the plots), and how the buses are used. The economy will supply
// its own `CrowdNumbers` later; nothing else here needs to change when it does.
//
// The buses are real: when one calls at a stop (traffic.ts onBusStop), the front of the queue
// walks to its door and the bus waits until they're aboard; its passengers get off first.
import type * as THREE from 'three';
import { PeopleStore, BUDGETS } from '../people/store';
import { Crowds, type Flow, type QueueFlow, type WalkFlow, type ParkFlow, type LoiterFlow, type AnimalFlow, type SchoolFlow, type CommuteFlow } from '../people/flows';
import { DAY } from '../people/schedule';
import { MIXES } from '../people/wardrobe';
import { demand, type Traffic } from '../traffic';
import type { Network, RSeg, Stop } from '../roads';
import type { Junction } from '../junction';
import { DIMS } from '../footprint';
import type { XZ } from '../land';
import type { Region } from '../infill';
import { gameYear, onYearChange } from './era';
import { frontage, lotSites, roadSites, PAVE_Y, type FootwaySite, type LotSites, type ParkSite, type SchoolSite, type Sites, type StopSite, type VenueSite, type WorksSite } from './crowdsites';

// ---------- the numbers ----------
export interface ParkCounts { walkers: number; dogWalkers: number; joggers: number; looseDogs: number; sitters: number; kids: number }
// How many people, where, at a time of day (`clock`: game minutes; the hour is clock / 60 mod 24).
export interface CrowdNumbers {
  footfall(f: FootwaySite, clock: number): number; // walking along a footway at once, per 100 m
  arrivals(s: StopSite, clock: number): number; // coming to wait at a bus stop, per game minute
  alighting(s: StopSite, onBoard: number, clock: number): number; // getting off a bus that calls there
  crossing(footfall: number, clock: number): number; // coming to cross at a junction's arm, per game minute, from one kerb
  park(p: ParkSite, clock: number): ParkCounts; // in a park, pocket park, playground or allotments at once
  venue(v: VenueSite, clock: number): number; // standing outside a pub, or looking in a shop window
  pupils(s: SchoolSite): number; // on a school's roll
  shift(w: WorksSite): number; // walking to (or from) a works at each change of shift
}

const PEAK = demand(8.2);
const hourOf = (clock: number) => (((clock / 60) % 24) + 24) % 24;
const minuteOf = (clock: number) => ((clock % 1440) + 1440) % 1440;

// The stand-in until the economy feeds the crowds: the same daily curve the traffic follows,
// scaled by who lives and works along each street.
export class TownNumbers implements CrowdNumbers {
  // how busy the streets are now, 0–1 (1 at the morning peak)
  busy(clock: number) { return Math.min(1, demand(hourOf(clock)) / PEAK); }
  // on foot the day is flatter than on the roads: lunchtime is busy too
  walking(clock: number) { return 0.5 * this.busy(clock) + 0.5 * Math.min(1, DAY.street(clock)); }
  footfall(f: FootwaySite, clock: number) {
    const local = 1 + f.residents * 0.06 + f.jobs * 0.08;
    return Math.min(40, local * this.walking(clock) + f.shops * 4 * DAY.shops(clock));
  }
  arrivals(s: StopSite, clock: number) { return (s.residents * 0.0004 + s.jobs * 0.00025) * this.busy(clock) + 0.01; }
  alighting(s: StopSite, onBoard: number, clock: number) {
    // more get off where the jobs are in the morning, where the homes are in the evening
    const h = hourOf(clock), work = s.jobs / (s.jobs + s.residents + 1);
    const share = 0.12 + 0.35 * (h < 12 ? work : 1 - work);
    return Math.min(onBoard, Math.round(onBoard * share + (onBoard > 0 ? 0.5 : 0)));
  }
  crossing(footfall: number, clock: number) { return 0.1 * footfall + 0.05 * this.walking(clock); }
  park(p: ParkSite, clock: number): ParkCounts {
    const n = p.cells, park = DAY.park(clock), dogs = DAY.dogs(clock), big = p.kind === 'park';
    const m = minuteOf(clock), school = m > 8.9 * 60 && m < 15.3 * 60;
    if (p.kind === 'allotments') return { walkers: Math.round(Math.min(4, n / 8) * park), dogWalkers: 0, joggers: 0, looseDogs: 0, sitters: 0, kids: 0 };
    return {
      walkers: Math.round(Math.min(10, n / 9) * park),
      dogWalkers: Math.round(Math.min(6, n / 14) * dogs),
      joggers: big ? Math.round(Math.min(3, n / 40) * DAY.joggers(clock)) : 0,
      looseDogs: big ? Math.round(Math.min(3, n / 35) * dogs) : 0,
      sitters: Math.round(p.benches.length * 1.3 * park),
      kids: p.kind === 'playground' ? Math.round(8 * park * (school ? 0.25 : 1)) : 0,
    };
  }
  venue(v: VenueSite, clock: number) { return v.venue === 'pub' ? Math.round(12 * DAY.pub(clock)) : Math.round(1.8 * DAY.shops(clock) - 0.2); }
  pupils() { return 90; }
  shift(w: WorksSite) { return Math.round(w.jobs * 0.4); }
}

// ---------- the crowds in the game ----------
// What the crowds need from the game. `regions` gives the infill (parks and the rest) as it stands.
export interface TownView {
  scene: THREE.Scene; net: Network; junctions: Map<number, Junction>; traffic: Traffic;
  regions: () => readonly { region?: Region }[];
}
// Shift changes at the works: in before the hour, out just after it.
const SHIFTS: [number, number][] = [[5 * 60 + 35, 6 * 60 + 5], [13 * 60 + 35, 14 * 60 + 5], [21 * 60 + 35, 22 * 60 + 5]];
const BUS_CAPACITY = 60;
const STOP_PATIENCE = 20, KERB_PATIENCE = 3; // game minutes a queue takes to settle to its level

export class TownCrowds {
  readonly store = new PeopleStore();
  readonly crowds = new Crowds(this.store);
  numbers: CrowdNumbers = new TownNumbers();
  // how long the crowds took this frame, smoothed (ms), and what they're drawing
  stats = { ms: 0, layoutMs: 0, flows: 0, footways: 0, stops: 0, crossings: 0, parks: 0 };
  private roads: Sites | null = null;
  private lots: LotSites | null = null;
  private roadSig = '';
  private lotSig = '';
  private placeSig = '';
  private lotRegions: unknown = null;
  private checkIn = 0;
  private list: Flow[] = [];
  private walks = new Map<string, WalkFlow>();
  private queues = new Map<string, QueueFlow>();
  private waiting = new Map<string, number>(); // at stops and kerbs, before rounding
  private loads = new Map<number, number>(); // passengers aboard each bus
  private usage = new Map<string, { day: number; boarded: number; alighted: number }>();
  private parks: { site: ParkSite; flow: ParkFlow; ducks?: AnimalFlow; plots?: LoiterFlow }[] = [];
  private venues: { site: VenueSite; flow: LoiterFlow }[] = [];
  private simAcc = 0;
  private clock = 0;
  private dirty = true;

  constructor(private t: TownView, gameMinutesPerSecond: number) {
    t.scene.add(this.store.root);
    this.crowds.timeScale = gameMinutesPerSecond * 60;
    this.crowds.year = gameYear();
    onYearChange((y) => { this.crowds.year = y; this.dirty = true; });
    t.traffic.onBusStop = (seg, st, bus) => this.busAt(seg, st, bus);
  }
  // the people's detail and budget follow the game's quality tier (the same five names)
  setTier(i: number) { this.store.setBudget(BUDGETS[Math.max(0, Math.min(BUDGETS.length - 1, i))]); }

  // Once a frame. `gdt`: game seconds (0 while paused); `dt`: real seconds; `clock`: game minutes.
  update(cam: THREE.Camera, cssH: number, gdt: number, dt: number, clock: number) {
    const t0 = performance.now();
    // the town may have changed (a road built, a stop added, a building gone up): looked at twice a second
    this.checkIn -= dt;
    if (this.checkIn <= 0) { this.checkIn = 0.5; this.layout(); }
    // counts follow the clock, a game minute at a time
    this.simAcc += gdt;
    if (this.simAcc >= 0.25 || this.dirty) { this.refresh(clock); this.simAcc = 0; }
    this.store.update(cam, cssH, gdt, dt);
    const ms = performance.now() - t0;
    this.stats.ms += (ms - this.stats.ms) * 0.1;
  }

  // ---------- the town's shape ----------
  private layout() {
    const { net, junctions } = this.t;
    let ids = 0, stops = 0;
    for (const s of net.segs.values()) { ids += s.id; stops += s.stops.length; }
    let forms = '';
    for (const j of junctions.values()) forms += `${j.node}${j.form[0]}${j.slip ? 's' : ''}${Math.round(j.R)},`;
    const roadSig = `${net.segs.size}|${net.nodes.size}|${ids}|${stops}|${forms}`;
    const regions = this.t.regions();
    // every plot counts towards who lives and works along a street; only pubs, shops, schools and
    // works (and the open spaces) are places people gather
    let lotIds = 0, places = 0, placeIds = 0;
    for (const l of net.lots) {
      lotIds += l.id;
      if (l.kind === 'shop' || l.kind === 'industry' || l.arch === 'pub' || l.arch === 'school' || l.arch === 'cornershop') { places++; placeIds += l.id; }
    }
    const lotSig = `${net.lots.length}|${lotIds}`, placeSig = `${places}|${placeIds}`;
    const roadsChanged = roadSig !== this.roadSig, placesChanged = roadsChanged || placeSig !== this.placeSig || regions !== this.lotRegions;
    if (!placesChanged && lotSig === this.lotSig) return;
    const t0 = performance.now();
    if (roadsChanged) { this.roads = roadSites(net, junctions); this.roadSig = roadSig; }
    const r = this.roads!;
    frontage(net, r);
    this.lotSig = lotSig;
    if (placesChanged) {
      this.lots = lotSites(net, regions.flatMap((b) => (b.region ? [b.region] : [])), r.footways, r.stops);
      this.placeSig = placeSig; this.lotRegions = regions;
    }
    this.build(roadsChanged, placesChanged);
    this.stats.layoutMs = performance.now() - t0;
    this.dirty = true;
  }

  // The flows, one object per place, kept from one layout to the next where the place is unchanged
  // (Crowds only rebuilds a crowd whose shape changed; counts are updated in place).
  private build(roadsChanged: boolean, placesChanged: boolean) {
    const r = this.roads!, l = this.lots!;
    if (roadsChanged) {
      const walks = new Map<string, WalkFlow>();
      for (const f of r.footways) walks.set(f.id, { kind: 'walk', id: f.id, footway: { line: f.line, width: f.width, y: f.y }, count: 0, dogs: 0.05 });
      this.walks = walks;
      const queues = new Map<string, QueueFlow>();
      for (const s of r.stops) queues.set(s.id, this.queues.get(s.id) && sameSite(this.queues.get(s.id)!, s) ? this.queues.get(s.id)! : { kind: 'queue', id: s.id, site: s.site, waiting: 0 });
      for (const c of r.crossings) for (const k of c.kerbs) queues.set(k.id, { kind: 'queue', id: k.id, site: k, waiting: 0 });
      this.queues = queues;
      for (const id of [...this.waiting.keys()]) if (!queues.has(id)) this.waiting.delete(id);
    }
    // the high-street mix where shops make up a good part of the frontage (a shop is about 7 m wide)
    for (const f of r.footways) {
      const w = this.walks.get(f.id)!, high = f.shops * 7 > 30;
      if ((w.mix === MIXES.highStreet) !== high) this.walks.set(f.id, { ...w, mix: high ? MIXES.highStreet : undefined });
    }
    if (placesChanged) this.places(l);
    this.list = [
      ...this.walks.values(), ...this.queues.values(),
      ...this.parks.flatMap((p) => [p.flow, ...(p.ducks ? [p.ducks] : []), ...(p.plots ? [p.plots] : [])]),
      ...this.venues.map((v) => v.flow), ...this.gather,
    ];
    this.stats.flows = this.list.length; this.stats.footways = r.footways.length; this.stats.stops = r.stops.length;
    this.stats.crossings = r.crossings.length; this.stats.parks = l.parks.length;
  }
  private gather: Flow[] = []; // schools and works
  private places(l: LotSites) {
    this.parks = l.parks.map((p) => {
      const flow: ParkFlow = { kind: 'park', id: p.id, area: p.area, paths: p.paths.length ? p.paths : undefined, benches: p.benches, walkers: 0, dogWalkers: 0, avoid: p.pond ? [p.pond] : undefined, play: p.play };
      if (p.kind === 'allotments') return { site: p, flow, plots: { kind: 'loiter', id: `${p.id}:plots`, at: p.centre, facing: 0, width: Math.max(4, p.width - 4), count: 0, venue: 'square' } as LoiterFlow };
      return { site: p, flow, ducks: p.pond ? { kind: 'animals', id: `${p.id}:ducks`, species: 'duck', count: 0, area: p.pond, y: 0.12 } as AnimalFlow : undefined };
    });
    this.venues = l.venues.map((v) => ({ site: v, flow: { kind: 'loiter', id: v.id, at: v.at, facing: v.facing, width: v.width, count: 0, venue: v.venue, y: v.y } }));
    const schools: SchoolFlow[] = l.schools.map((s) => ({ kind: 'school', id: s.id, gate: s.gate, yard: s.yard, approaches: s.approaches, pupils: this.numbers.pupils(s), school: s.seed % 6, arrive: [8 * 60 + 25, 8 * 60 + 52], leave: [15 * 60 + 15, 15 * 60 + 40], y: PAVE_Y }));
    const works: CommuteFlow[] = l.works.flatMap((w) => {
      const n = this.numbers.shift(w), back = [...w.path].reverse();
      return SHIFTS.flatMap(([a, b], i): CommuteFlow[] => [
        { kind: 'commute', id: `${w.id}:in${i}`, path: w.path, total: n, window: [a, b], mix: MIXES.works, width: 1.6, y: PAVE_Y },
        { kind: 'commute', id: `${w.id}:out${i}`, path: back, total: n, window: [b - 3, b + 25], mix: MIXES.works, width: 1.6, y: PAVE_Y },
      ]);
    });
    this.gather = [...schools, ...works];
  }

  // ---------- the counts ----------
  private refresh(clock: number) {
    if (!this.roads || !this.lots) return;
    const dMin = Math.max(0, Math.min(120, clock - this.clock));
    this.clock = clock;
    this.dirty = false;
    const N = this.numbers;
    const ff = new Map<string, number>();
    for (const f of this.roads.footways) {
      const per = N.footfall(f, clock);
      ff.set(f.id, per);
      this.walks.get(f.id)!.count = (per * f.length) / 100;
    }
    // a queue settles towards the level its arrivals keep up (people give up, or get a lift)
    const settle = (id: string, rate: number, patience: number, cap: number) => {
      const eq = rate * patience, w0 = this.waiting.get(id) ?? eq * 0.6;
      const w = eq + (w0 - eq) * Math.exp(-dMin / patience);
      this.waiting.set(id, w);
      this.queues.get(id)!.waiting = Math.min(cap, Math.floor(w));
    };
    for (const s of this.roads.stops) settle(s.id, N.arrivals(s, clock), STOP_PATIENCE, s.roomy ? 24 : 16);
    for (const c of this.roads.crossings) {
      const foot = c.footfall.reduce((t, id) => t + (ff.get(id) ?? 0), 0) / Math.max(1, c.footfall.length);
      for (const k of c.kerbs) settle(k.id, N.crossing(foot, clock), KERB_PATIENCE, 5);
    }
    for (const p of this.parks) {
      const n = N.park(p.site, clock);
      Object.assign(p.flow, n);
      if (p.ducks) p.ducks.count = Math.round(Math.min(8, 3 + p.site.cells / 20));
      if (p.plots) { p.plots.count = n.walkers; p.flow.walkers = 0; }
    }
    for (const v of this.venues) v.flow.count = Math.max(0, N.venue(v.site, clock));
    this.crowds.set(this.list, clock);
    if (dMin > 0) this.cross();
    else this.holdTraffic();
  }

  // People at a kerb cross when nothing is coming. Traffic doesn't stop for them yet, so they wait
  // until nothing can reach the crossing before the last of them is over: every vehicle is further
  // off than it would go in that time (at least at 4 m/s, for one about to pull away), plus a margin.
  private cross() {
    const cars = this.t.traffic.cars;
    for (const c of this.roads!.crossings) {
      const n = c.kerbs.map((k) => Math.min(4, Math.floor(this.queues.get(k.id)?.waiting ?? 0)));
      if (!n.some((k) => k >= 1)) continue;
      const w = Math.hypot(c.to[0].x - c.to[1].x, c.to[0].z - c.to[1].z);
      const T = (Math.max(...n) - 1) * 1.1 + w / 1.3 + 0.3 + 2; // (as Crowds.board spaces them: 1.1 s apart, at 1.3 m/s)
      let clear = true;
      for (const v of cars) {
        if (!v.pose || v.gone !== undefined) continue;
        const R = 14 + Math.max(4, v.v) * T;
        if (Math.abs(v.pose.x - c.mid.x) < R && Math.abs(v.pose.z - c.mid.z) < R && Math.hypot(v.pose.x - c.mid.x, v.pose.z - c.mid.z) < R) { clear = false; break; }
      }
      if (!clear) continue;
      let until = 0;
      c.kerbs.forEach((k, i) => {
        if (n[i] < 1) return;
        const b = this.crowds.board(k.id, [c.to[i]], n[i]);
        this.took(k.id, b.n);
        until = Math.max(until, b.until);
      });
      // and the traffic stops for them until they're over
      if (until > 0) this.onCrossing.push({ seg: c.seg, at: c.mid, until });
    }
    this.holdTraffic();
  }
  private onCrossing: { seg: number; at: XZ; until: number }[] = [];
  private holdTraffic() {
    const now = this.store.time, m = this.t.traffic.crossing;
    this.onCrossing = this.onCrossing.filter((x) => x.until > now);
    m.clear();
    for (const x of this.onCrossing) { let l = m.get(x.seg); if (!l) m.set(x.seg, (l = [])); l.push(x.at); }
  }
  private took(id: string, n: number) {
    const q = this.queues.get(id)!;
    q.waiting = Math.max(0, q.waiting - n);
    this.waiting.set(id, Math.max(0, (this.waiting.get(id) ?? 0) - n));
  }

  // ---------- buses ----------
  // A bus has pulled up: its passengers get off, then the front of the queue walks to its door.
  // It waits (the dwell, in seconds) until the last of them is aboard.
  private busAt(seg: RSeg, st: Stop, bus: number) {
    const id = `stop:${seg.id}:${st.id}`, s = this.roads?.stops.find((x) => x.id === id), q = this.queues.get(id);
    if (!s || !q) return 7;
    const now = this.store.time;
    this.doorsOf(s, bus);
    let load = this.loads.get(bus) ?? 6 + (bus % 9); // already some aboard when it's first seen
    const off = Math.min(load, this.numbers.alighting(s, load, this.clock));
    const a = off > 0 ? this.crowds.alight(id, [s.exit], off) : { until: now };
    load -= off;
    const b = this.crowds.board(id, [s.door], Math.min(BUS_CAPACITY - load, 16, q.waiting));
    this.took(id, b.n);
    load += b.n;
    this.loads.set(bus, load);
    const u = this.usageOf(id);
    u.boarded += b.n; u.alighted += off;
    // (as long as the last of them takes to reach the door, then a moment to close up and pull away)
    return Math.max(7, Math.min(30, Math.max(a.until, b.until) - now + 1.5));
  }
  // The doors where this bus actually stands, on its kerb side: people board at its front door and
  // get off at the one furthest back (the vehicle library's own doors, game/fleet.ts). Without a
  // pose, the site's doors at the kerb stand.
  private doorsOf(s: StopSite, bus: number) {
    const tr = this.t.traffic, c = tr.cars.find((c) => c.id === bus), parts = c?.pose?.parts;
    if (!c || !parts?.length) return;
    const ds = tr.fleet.kerbDoors(c, parts);
    if (ds.length) {
      s.door = { x: ds[0].x, z: ds[0].z };
      s.exit = { x: ds[ds.length - 1].x, z: ds[ds.length - 1].z };
      return;
    }
    const r = parts[0], at = (al: number, lat: number): XZ => ({ x: r.x + r.hx * al + r.hz * lat, z: r.z + r.hz * al - r.hx * lat });
    s.door = at(DIMS.bus.front - 0.9, DIMS.bus.hw + 0.15);
    s.exit = at(-1, DIMS.bus.hw + 0.15);
  }
  private usageOf(id: string) {
    const day = Math.floor(this.clock / 1440);
    let u = this.usage.get(id);
    if (!u || u.day !== day) this.usage.set(id, (u = { day, boarded: 0, alighted: 0 }));
    return u;
  }

  // ---------- for the HUD ----------
  // How a stop is doing, for its card: waiting now, and today's boardings and alightings.
  stopUse(seg: RSeg, st: Stop) {
    const id = `stop:${seg.id}:${st.id}`, u = this.usageOf(id);
    return { waiting: this.queues.get(id)?.waiting ?? 0, boarded: u.boarded, alighted: u.alighted };
  }
  // The same in words.
  stopLine(seg: RSeg, st: Stop) {
    const u = this.stopUse(seg, st);
    return `${u.waiting} waiting · ${u.boarded} boarded and ${u.alighted} got off today`;
  }
  // The same, as facts for the stop's info sheet.
  stopFacts(seg: RSeg, st: Stop): [string, string][] {
    const u = this.stopUse(seg, st);
    return [['Waiting', `${u.waiting}`], ['Boarded today', `${u.boarded}`], ['Got off today', `${u.alighted}`]];
  }
  // One line for the performance readout.
  readout() {
    const s = this.store.stats;
    return `people ${s.byLod[0]}/${s.byLod[1]}/${s.byLod[2]} (near/mid/far) · ${s.drawCalls} calls · ${Math.round(s.triangles / 1000)}k tris · ${this.stats.ms.toFixed(2)} ms`;
  }
}

// A stop whose site hasn't moved keeps its queue (and so its people) through a relayout.
function sameSite(q: QueueFlow, s: StopSite) {
  const a = q.site, b = s.site;
  return Math.abs(a.at.x - b.at.x) < 1e-6 && Math.abs(a.at.z - b.at.z) < 1e-6 && a.along === b.along && a.y === b.y && a.away?.length === b.away?.length;
}
