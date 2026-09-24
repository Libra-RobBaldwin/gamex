// The railway in one place (docs/rail.md): the stations the player (or the region generator) has
// built, the track graph and signalling made from the network, the lines and their trains. The
// game keeps one; the drawing (rail/draw.ts) reads it. This is also the API the line tool uses:
//
//   const rw = new Railway(net);
//   const { plans } = rw.plan(segId, s, side);   // a blueprint per layout, each with its cost
//   const st = rw.build(plans[0]);               // (claims its land; buildings in the way are cleared)
//   const line = rw.addLine([a.id, b.id], false, [TRAINS.dmu, TRAINS.dmu]);  // or a reason it can't
//   rw.update(dt);                               // each step, with the traffic
//
// Call `rebuild()` whenever the network changes.
import { polysOverlap, rectCorners, type Lot, type Network, type P } from '../roads';
import type { TrainDef } from '../catalog';
import { TrackGraph, type StationWorks } from './track';
import { RailSim, callOrder, type RailLine, type Train } from './sim';
import { findCrossings, zoneFrom, type CrossingSite } from './crossing';
import { DEPOT_LEN, planStation, stationShape, worksFor, type Station, type StationPlan, type StationShape } from './station';
import { pointInPoly } from '../land';

const NAMES = ['Central', 'Parkway', 'Town', 'Riverside', 'North Road', 'Market Street', 'Junction', 'Halt', 'West', 'East', 'Bridge Street', 'Mill Lane'];
export interface Road { onStretch(seg: number, z0: number, z1: number): boolean; barriers: Map<number, [number, number][]> }

export class Railway {
  stations: Station[] = [];
  graph: TrackGraph;
  sim: RailSim;
  crossings: CrossingSite[] = [];
  shapes = new Map<number, StationShape>();
  cleared: Lot[] = []; // buildings taken down for a depot siding since the game last looked (it clears them)
  version = 0; // goes up whenever the stations, the track or the crossings change (the drawing redraws)
  // a place name for a spot (the region's settlements); the game's own town has none
  placeName: (p: P) => string | undefined = () => undefined;
  private nextId = 1;
  private nextLine = 1;
  private road: Road | null = null;

  constructor(readonly net: Network) {
    this.graph = new TrackGraph(net);
    this.sim = new RailSim(this.graph);
  }
  get lines() { return this.sim.lines; }
  get trains() { return this.sim.trains; }
  // the road traffic, for level crossings: it's held at the barriers, and a train waits for it to clear
  useRoads(road: Road) {
    this.road = road;
    this.sim.roadClear = (c) => !road.onStretch(c.road, c.z0, c.z1);
  }

  // ---------- the track changed ----------
  works(): StationWorks[] { return this.stations.map((s) => worksFor(this.net, s)).filter((w): w is StationWorks => !!w); }
  rebuild() {
    const works = this.works();
    this.crossings = findCrossings(this.net);
    this.graph = new TrackGraph(this.net, works);
    this.sim.rebuild(this.graph, this.crossings);
    this.shapes.clear();
    for (const w of works) {
      if (this.graph.broken.has(w.id)) { this.net.land.release(`station:${w.id}`); continue; }
      const sh = stationShape(this.net, this.graph, w);
      if (!sh) continue;
      this.shapes.set(w.id, sh);
      this.net.land.claim(`station:${w.id}`, 'station', sh.land);
    }
    for (const s of this.stations) if (!this.shapes.has(s.id)) this.net.land.release(`station:${s.id}`);
    this.version++;
  }

  // ---------- stations ----------
  plan(segId: number, s: number, side: 1 | -1, len?: number): { plans: StationPlan[]; reason?: string } {
    return planStation(this.net, segId, s, side, { len, stations: this.stations, crossings: this.crossings });
  }
  // Build a planned station. Returns it, and the buildings that were in its way (the game takes them down).
  build(plan: StationPlan): { station: Station; cleared: Lot[] } {
    const st: Station = { ...plan.station, id: this.nextId++ };
    st.name = plan.station.name || this.nameFor(st);
    this.stations.push(st);
    const gone = new Set(plan.clears);
    this.net.lots = this.net.lots.filter((l) => !gone.has(l));
    this.rebuild();
    return { station: st, cleared: plan.clears };
  }
  remove(id: number) {
    this.stations = this.stations.filter((s) => s.id !== id);
    this.net.land.release(`station:${id}`);
    for (const l of [...this.lines]) {
      l.stops = l.stops.filter((s) => s !== id);
      if (l.depot === id) l.depot = undefined;
      if (l.stops.length < 2) this.removeLine(l);
    }
    this.rebuild();
  }
  station(id: number) { return this.stations.find((s) => s.id === id); }
  // the station standing on a spot (its platforms, building or forecourt)
  stationAt(p: P): Station | undefined {
    for (const [id, sh] of this.shapes) if (sh.land.some((poly) => pointInPoly(p, poly))) return this.station(id);
    return undefined;
  }
  private nameFor(st: Station) {
    const place = this.placeName(st);
    const used = new Set(this.stations.map((s) => s.name));
    for (const n of NAMES) { const name = place ? `${place} ${n}` : n; if (!used.has(name)) return name; }
    return `${place ?? 'Station'} ${this.stations.length + 1}`;
  }

  // ---------- lines ----------
  // A line calling at these stations in order (and back, or round again if `loop`), run by these
  // trains from a depot siding by its first station (laid if there's room). A reason if it can't.
  addLine(stops: number[], loop: boolean, trains: TrainDef[], o: { offer?: string; colour?: string; depot?: boolean } = {}): RailLine | string {
    if (stops.length < 2) return 'A line needs two stations at least';
    for (const s of stops) if (!this.shapes.has(s)) return `${this.station(s)?.name ?? 'A station'} isn’t on the track`;
    const line: RailLine = { id: this.nextLine++, num: 0, stops: [...stops], loop, offer: o.offer, colour: o.colour };
    line.num = line.id;
    if (o.depot !== false) line.depot = this.depotFor(stops[0]);
    for (const t of trains) {
      const why = this.sim.fits(t, t.cars * t.carLen + (t.cars - 1) * 0.9, line);
      if (why) { this.nextLine--; return why; }
    }
    this.sim.lines.push(line);
    for (const t of trains.slice(0, this.sim.capacity(line))) this.sim.addTrain(t, line);
    return line;
  }
  removeLine(l: RailLine) {
    for (const t of this.trains.filter((x) => x.line === l)) this.sim.removeTrain(t);
    this.sim.lines = this.sim.lines.filter((x) => x !== l);
  }
  addTrain(l: RailLine, def: TrainDef, dress?: unknown): Train | string { return this.sim.addTrain(def, l, dress); }
  removeTrain(t: Train) { this.sim.removeTrain(t); }
  trainsOn(l: RailLine) { return this.trains.filter((t) => t.line === l); }
  calls(l: RailLine) { return callOrder(l.stops, l.loop); }
  // Give a station a depot siding if it hasn't one and there's room past either end of its platforms.
  private depotFor(id: number): number | undefined {
    const st = this.station(id);
    if (!st) return undefined;
    if (st.depot) return this.graph.depots.has(id) ? id : undefined;
    for (const end of [1, -1] as const) for (const side of [(-st.building) as 1 | -1, st.building]) {
      st.depot = { end, side, len: DEPOT_LEN };
      this.rebuild();
      if (this.graph.depots.has(id) && !this.graph.broken.has(id) && this.depotClear(id)) {
        const sh = this.shapes.get(id), land = sh?.depot ? sh.land.slice(-((sh.depot.pts.length - 1) + 1)) : [];
        const gone = this.net.lots.filter((l) => land.some((poly) => polysOverlap(rectCorners(l.x, l.z, l.rot, l.w, l.d), poly)));
        if (gone.length) { const g = new Set(gone); this.net.lots = this.net.lots.filter((l) => !g.has(l)); this.cleared.push(...gone); }
        return id;
      }
    }
    st.depot = undefined;
    this.rebuild();
    return undefined;
  }
  // the siding's ground is free (bar the railway's own)
  private depotClear(id: number) {
    const p = this.graph.pieces[this.graph.depots.get(id)!];
    for (let i = 4; i < p.pts.length; i += 3) {
      const c = this.net.land.at(p.pts[i]);
      if (c && c.key !== `road:${p.seg}` && c.key !== `station:${id}`) return false;
    }
    return true;
  }

  // ---------- running ----------
  update(dt: number) {
    this.sim.update(dt);
    // tell the road which crossings are shut
    if (this.road) {
      const m = this.road.barriers;
      m.clear();
      this.sim.crossings.forEach((c) => {
        if (!c.holding) return;
        const l = m.get(c.site.road) ?? [];
        l.push([c.site.z0, c.site.z1]);
        m.set(c.site.road, l);
      });
    }
  }
  // where a car coming along a road from one end must stop for a crossing (for drawing stop lines)
  zone(c: CrossingSite, fromA: boolean) { const s = this.net.segs.get(c.road); return s ? zoneFrom(c, this.net.length(s), fromA) : [c.z0, c.z1]; }
}
