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
import { TrackGraph, worksSpan, type StationWorks } from './track';
import { RailSim, callOrder, type RailLine, type Train } from './sim';
import { findCrossings, zoneFrom, type CrossingSite } from './crossing';
import { DEPOT_LEN, planStation, type StationOptions, stationShape, worksFor, type Station, type StationPlan, type StationShape } from './station';
import { pointInPoly } from '../land';

const NAMES = ['Central', 'Parkway', 'Town', 'Riverside', 'North Road', 'Market Street', 'Junction', 'Halt', 'West', 'East', 'Bridge Street', 'Mill Lane'];
export interface RailwaySave { nextId: number; nextLine: number; stations: Station[]; lines: RailLine[]; trains: { line: number; def: TrainDef }[] }
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
  private trackSig = NaN; // what the track, the stations and the roads about them were at the last rebuild

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
  // What the track graph and the station shapes are made from, as one number: every railway
  // segment (its ends, type, path, bridges), the stations, and the roads near enough a station to
  // shape it (a viaduct's columns keep off them). A road edit that changes none of it leaves the
  // railway, and every train on it, exactly as it was.
  private signature(works: StationWorks[]) {
    let h = 2166136261;
    const mix = (v: number) => { h ^= (v * 1000 + (v < 0 ? 7 : 0)) | 0; h = Math.imul(h, 16777619); };
    const str = (t: string) => { for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); };
    const boxes: [number, number, number, number][] = [];
    for (const s of this.net.segs.values()) {
      if (this.net.def(s).cls !== 'rail') continue;
      mix(s.id); mix(s.a); mix(s.b); str(s.type); mix(s.oneway ? 1 : 0);
      for (const q of this.net.path(s)) { mix(q.x); mix(q.z); mix(q.y ?? 0); }
      if (s.bridges) str(JSON.stringify(s.bridges));
      if (s.aux) str(JSON.stringify(s.aux));
    }
    str(JSON.stringify(this.stations));
    for (const w of works) {
      const seg = this.net.segs.get(w.seg);
      if (!seg) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of this.net.path(seg)) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
      boxes.push([x0 - 80, z0 - 80, x1 + 80, z1 + 80]);
    }
    if (boxes.length) for (const s of this.net.segs.values()) {
      if (this.net.def(s).cls === 'rail') continue;
      const p = this.net.path(s);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of p) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
      if (!boxes.some((b) => x1 >= b[0] && x0 <= b[2] && z1 >= b[1] && z0 <= b[3])) continue;
      mix(s.id); str(s.type);
      for (const q of p) { mix(q.x); mix(q.z); mix(q.y ?? 0); }
    }
    return h >>> 0;
  }
  // Called after every change to the network. It does its work only when something the railway
  // is made from changed (signature); a road built across the line on the level adds a crossing
  // without touching the track, so that alone updates the crossings. `force` rebuilds regardless.
  rebuild(force = false) {
    const works = this.works();
    const sig = this.signature(works), crossings = findCrossings(this.net);
    if (!force && sig === this.trackSig) {
      const k = (cs: CrossingSite[]) => cs.map((c) => `${c.rail}:${c.road}:${Math.round(c.railS)}`).join(',');
      if (k(crossings) !== k(this.crossings)) { this.crossings = crossings; this.sim.setCrossings(crossings); this.version++; }
      return;
    }
    this.trackSig = sig;
    this.crossings = crossings;
    this.graph = new TrackGraph(this.net, works);
    this.sim.rebuild(this.graph, this.crossings);
    this.shapes.clear();
    for (const w of works) {
      if (this.graph.broken.has(w.id)) { this.release(w.id); continue; }
      const st = this.station(w.id), sh = stationShape(this.net, this.graph, w, { style: st?.style, access: st?.access, canopy: st?.canopy, structure: st?.structure });
      if (!sh) continue;
      this.shapes.set(w.id, sh);
      this.net.land.claim(`station:${w.id}`, 'station', sh.land);
      // (a viaduct's deck is the railway's, like a bridge: roads may pass under it, buildings can't)
      if (sh.deckLand) this.net.land.claim(`station:${w.id}:deck`, 'road', sh.deckLand); else this.net.land.release(`station:${w.id}:deck`);
    }
    for (const s of this.stations) if (!this.shapes.has(s.id)) this.release(s.id);
    this.version++;
  }

  // ---------- stations ----------
  // every preset layout that fits, or (with `config`) the one asked for: tracks, platforms, style, access, canopy
  plan(segId: number, s: number, side: 1 | -1, len?: number, config?: StationOptions['config']): { plans: StationPlan[]; reason?: string } {
    return planStation(this.net, segId, s, side, { len, stations: this.stations, crossings: this.crossings, config });
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
  private release(id: number) { this.net.land.release(`station:${id}`); this.net.land.release(`station:${id}:deck`); }
  remove(id: number) {
    this.stations = this.stations.filter((s) => s.id !== id);
    this.release(id);
    for (const l of [...this.lines]) {
      l.stops = l.stops.filter((s) => s !== id);
      if (l.depot === id) l.depot = undefined;
      if (l.stops.length < 2) this.removeLine(l);
    }
    this.rebuild();
  }
  station(id: number) { return this.stations.find((s) => s.id === id); }
  // the station standing on a spot: its platforms, building, forecourt or depot on the ground (or
  // a viaduct's deck); with `below`, an underground station's platforms too (the underground view)
  stationAt(p: P, below = false): Station | undefined {
    for (const [id, sh] of this.shapes) if ((below ? sh.area : sh.deckLand ? [...sh.land, ...sh.deckLand] : sh.land).some((poly) => pointInPoly(p, poly))) return this.station(id);
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
  // (`other`: another company's, numbered apart from the player's lines: game/portals.ts)
  addLine(stops: number[], loop: boolean, trains: TrainDef[], o: { offer?: string; colour?: string; depot?: boolean; other?: string } = {}): RailLine | string {
    if (stops.length < 2) return 'A line needs two stations at least';
    for (const s of stops) if (!this.shapes.has(s)) return `${this.station(s)?.name ?? 'A station'} isn’t on the track`;
    const line: RailLine = { id: o.other ? 900 + this.lines.filter((l) => l.other).length : this.nextLine++, num: 0, stops: [...stops], loop, offer: o.offer, colour: o.colour };
    if (o.other) line.other = o.other;
    line.num = line.id;
    if (o.depot !== false) line.depot = this.depotFor(stops[0]);
    for (const t of trains) {
      const why = this.sim.fits(t, t.cars * t.carLen + (t.cars - 1) * 0.9, line);
      if (why) { if (!o.other) this.nextLine--; return why.replace(/station (\d+)/g, (_, id: string) => this.station(+id)?.name ?? `station ${id}`); }
    }
    this.sim.lines.push(line);
    for (const t of trains.slice(0, this.sim.capacity(line))) this.sim.addTrain(t, line);
    return line;
  }
  removeLine(l: RailLine) { this.sim.removeLine(l); }
  addTrain(l: RailLine, def: TrainDef, dress?: unknown): Train | string { return this.sim.addTrain(def, l, dress); }
  removeTrain(t: Train) { this.sim.removeTrain(t); }
  trainsOn(l: RailLine) { return this.trains.filter((t) => t.line === l); }
  calls(l: RailLine) { return callOrder(l.stops, l.loop); }
  // Give a station a depot siding if it hasn't one and there's room past either end of its platforms.
  private depotFor(id: number): number | undefined {
    const st = this.station(id);
    if (!st) return undefined;
    // (no siding off a viaduct or out of a station box: trains start at the platforms)
    if (st.structure && st.structure !== 'surface') return undefined;
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
  // the siding and its shed are on free ground (bar the railway's own), and cross no road
  private depotClear(id: number) {
    const sh = this.shapes.get(id), dp = this.graph.depots.get(id);
    if (!sh?.depot || dp === undefined) return false;
    const seg = this.graph.pieces[dp].seg, n = sh.depot.pts.length;
    const mine = (k: string) => k === `road:${seg}` || k === `station:${id}`;
    // (its own polygons are the last ones in the station's land: a band per piece of the siding, then the shed)
    const polys = sh.land.slice(-n);
    if (polys.some((poly) => this.net.land.hits(poly, (c) => mine(c.key)).length)) return false;
    const L = this.net.segs.get(seg) ? this.net.length(this.net.segs.get(seg)!) : 0, w = worksFor(this.net, this.station(id)!);
    if (!w) return false;
    const [a, b] = worksSpan(w, this.net.def(this.net.segs.get(seg)!).tracks);
    return !this.crossings.some((c) => c.rail === seg && c.railS > a - 10 && c.railS < b + 10) && a >= 0 && b <= L;
  }

  // ---------- saving (game/save.ts) ----------
  // The stations and lines as built, and each line's trains (which start again from its depot or
  // first station, as a new line's do). The track itself is the network's.
  save(): RailwaySave {
    return {
      nextId: this.nextId, nextLine: this.nextLine, stations: structuredClone(this.stations), lines: this.lines.map((l) => ({ ...l, stops: [...l.stops] })),
      trains: this.trains.filter((t) => t.line).map((t) => ({ line: t.line!.id, def: structuredClone(t.def) })),
    };
  }
  // (onto the restored network, with no stations or lines of its own yet)
  restore(s: RailwaySave) {
    this.nextId = s.nextId; this.nextLine = s.nextLine;
    this.stations = structuredClone(s.stations);
    this.rebuild();
    for (const l of s.lines) this.sim.lines.push({ ...l, stops: [...l.stops] });
    for (const t of s.trains) { const l = this.lines.find((x) => x.id === t.line); if (l) this.sim.addTrain(t.def, l); }
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
