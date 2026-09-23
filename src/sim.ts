// Simulation: network building, stations, vehicles with congestion, towns that grow, industries.
import {
  BRIDGE_MULT, BUILD, CARGO, DEMOLISH_BUILDING_COST, INDUSTRIES, LEVEL_POP, PAX_GEN, START_MONEY, START_TECH,
  STATIONS, TOWN_ACCEPT_MIN_BUILDINGS, VEHICLES, canServe,
  type BuildKind, type CargoId, type IndustryKind, type Layer, type Mode, type StationKind, type Tech, type VehicleId,
} from './defs';
import { Curve, DLEN, EdgeGrid, Heap, crossingDiagonal, dirBetween, opposite } from './geo';
import { T_FOREST, T_WATER, generateWorld, makeIndustry, rng, type Industry, type Town } from './world';

export interface Station {
  id: number;
  kind: StationKind;
  x: number;
  y: number;
  name: string;
  waiting: Partial<Record<CargoId, number>>;
  dir: number;
  overflow: number;
  foot?: number[]; // footprint tiles for off-road stations and airports
  link?: number; // street node an off-road station's driveway joins
}

export interface Load { c: CargoId; n: number; from: number }

export interface Vehicle {
  id: number;
  type: VehicleId;
  stops: number[]; // visited in order, then back to the first
  target: number; // index into stops we're heading to / sitting at
  heading: number; // direction of travel on arrival (-1 unknown)
  state: 'load' | 'move' | 'lost';
  timer: number;
  path: number[];
  dist: number;
  loads: Load[];
  profit: number;
  trips: number;
}

export interface ScenarioState {
  id: string;
  params: Record<string, number>;
  started: number;
  counters: Record<string, number>;
  deadline?: number;
}

export interface GameState {
  v: 2;
  seed: number;
  w: number;
  h: number;
  terrain: Uint8Array;
  bld: Uint8Array;
  bldTown: Int16Array;
  road: Uint8Array;
  rail: Uint8Array;
  metro: Uint8Array;
  towns: Town[];
  industries: Industry[];
  stations: Station[];
  vehicles: Vehicle[];
  money: number;
  time: number;
  nextId: number;
  tech: Tech[];
  earned: number;
  delivered: Partial<Record<CargoId, number>>;
  scenario: ScenarioState | null;
  completed: string[];
  rubble: number[];
  start: { x: number; y: number };
  review: number;
}

export interface Delivery {
  cargo: CargoId;
  amount: number;
  from: Station;
  to: Station;
  vehicle: Vehicle;
  transfer: boolean;
}

export type GameEvent =
  | { t: 'news'; text: string; x?: number; y?: number }
  | { t: 'money'; x: number; y: number; amount: number };

interface Catch {
  tiles: number[]; // building tiles
  pop: number;
  towns: Set<number>;
  industries: Industry[];
}

const LOAD_TIME = 2;
const ROAD_CAP = [0, 3, 8];
const ROAD_SPEED = [0, 1, 1.6];

export const layerOf = (m: Mode): Layer | null => (m === 'air' ? null : m);
export const loadOf = (v: Vehicle) => v.loads.reduce((a, l) => a + l.n, 0);

export function newGame(seed = (Math.random() * 2 ** 31) | 0): GameState {
  const g = generateWorld(seed);
  return {
    v: 2, seed, w: g.w, h: g.h, terrain: g.terrain, bld: g.bld, bldTown: g.bldTown,
    road: g.road.data, rail: new Uint8Array(g.w * g.h * 4), metro: new Uint8Array(g.w * g.h * 4),
    towns: g.towns, industries: g.industries, stations: [], vehicles: [], money: START_MONEY, time: 0,
    nextId: 1000, tech: [...START_TECH], earned: 0, delivered: {}, scenario: null, completed: [], rubble: [],
    start: g.start, review: 0,
  };
}

export class Game {
  s: GameState;
  road: EdgeGrid;
  rail: EdgeGrid;
  metro: EdgeGrid;
  events: GameEvent[] = [];
  quiet = false;
  onDeliver: ((d: Delivery) => void) | null = null;
  version = 0; // bumps on any network/building change (renderer caches)
  private catchments = new Map<number, Catch>();
  private coverCount = new Uint8Array(0);
  private tileStation = new Int32Array(0);
  private footTile = new Int32Array(0);
  private turnNodes = new Set<number>();
  private townPop: number[] = [];
  private townBuildings: number[] = [];
  private lineKinds = new Map<number, { pax: boolean; freight: boolean }>();
  private curves = new Map<number, { path: number[]; curve: Curve }>();
  private occupancy = new Map<number, number>();
  private rand: () => number;
  private dirty = true;
  private linesDirty = true;

  constructor(s: GameState) {
    this.s = s;
    this.road = new EdgeGrid(s.w, s.h, s.road);
    this.rail = new EdgeGrid(s.w, s.h, s.rail);
    this.metro = new EdgeGrid(s.w, s.h, s.metro);
    this.rand = rng(s.seed ^ Math.floor(s.time));
    // migrate older saves
    for (const v of s.vehicles as (Vehicle & { cargo?: Partial<Record<CargoId, number>> })[]) {
      if (!v.loads) {
        const prev = v.stops[(v.target + v.stops.length - 1) % v.stops.length];
        v.loads = (Object.entries(v.cargo ?? {}) as [CargoId, number][]).filter(([, n]) => n > 0).map(([c, n]) => ({ c, n, from: prev }));
        delete v.cargo;
      }
      if (v.heading === undefined) v.heading = -1;
    }
    this.rebuild();
  }

  // ---------------- lookups ----------------
  idx(x: number, y: number) { return y * this.s.w + x; }
  xy(n: number) { return { x: n % this.s.w, y: Math.floor(n / this.s.w) }; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.s.w && y < this.s.h; }
  has(t: Tech) { return this.s.tech.includes(t); }
  grid(layer: Layer) { return layer === 'road' ? this.road : layer === 'rail' ? this.rail : this.metro; }
  station(id: number) { return this.s.stations.find((st) => st.id === id); }
  stationAt(x: number, y: number): Station | undefined {
    if (!this.inBounds(x, y)) return;
    this.ensure();
    const id = this.tileStation[this.idx(x, y)];
    return id >= 0 ? this.station(id) : undefined;
  }
  airportAt(x: number, y: number): Station | undefined {
    if (!this.inBounds(x, y)) return;
    this.ensure();
    const id = this.footTile[this.idx(x, y)];
    return id >= 0 ? this.station(id) : undefined;
  }
  industryAt(x: number, y: number) {
    return this.s.industries.find((i) => x >= i.x && x < i.x + 2 && y >= i.y && y < i.y + 2);
  }
  townAt(x: number, y: number) {
    if (!this.inBounds(x, y)) return;
    const t = this.s.bldTown[this.idx(x, y)];
    return t >= 0 ? this.s.towns[t] : undefined;
  }
  pop(t: Town) { this.ensure(); return this.townPop[t.id] ?? 0; }
  buildings(t: Town) { this.ensure(); return this.townBuildings[t.id] ?? 0; }
  catchment(st: Station): Catch { this.ensure(); return this.catchments.get(st.id)!; }
  vehiclesAt(st: Station) { return this.s.vehicles.filter((v) => v.stops.includes(st.id)); }
  emit(e: GameEvent) { if (!this.quiet) this.events.push(e); }
  news(text: string, x?: number, y?: number) { this.emit({ t: 'news', text, x, y }); }
  curveOf(v: Vehicle): Curve {
    const c = this.curves.get(v.id);
    if (c && c.path === v.path) return c.curve;
    const curve = new Curve(v.path.map((n) => ({ x: (n % this.s.w) + 0.5, y: Math.floor(n / this.s.w) + 0.5 })));
    this.curves.set(v.id, { path: v.path, curve });
    return curve;
  }

  // Whether a tile is free of towns, industries and airports (surface building allowed).
  surfaceFree(n: number): boolean {
    this.ensure();
    const { x, y } = this.xy(n);
    return this.s.bld[n] === 0 && !this.industryAt(x, y) && this.footTile[n] < 0;
  }

  private ensure() { if (this.dirty) this.rebuild(); }
  markDirty() { this.dirty = true; this.version++; }

  rebuild() {
    const s = this.s, N = s.w * s.h;
    this.tileStation = new Int32Array(N).fill(-1);
    this.footTile = new Int32Array(N).fill(-1);
    this.turnNodes.clear();
    for (const st of s.stations) {
      const n = this.idx(st.x, st.y);
      this.tileStation[n] = st.id;
      if (st.kind === 'airport' && !st.foot) {
        st.foot = [];
        for (let y = st.y - 1; y <= st.y + 1; y++) for (let x = st.x - 1; x <= st.x + 1; x++) st.foot.push(this.idx(x, y));
      }
      for (const t of st.foot ?? []) { this.footTile[t] = st.id; this.tileStation[t] = st.id; }
      if (STATIONS[st.kind].mode === 'road' && STATIONS[st.kind].turnaround) this.turnNodes.add(n);
    }
    this.townPop = s.towns.map(() => 0);
    this.townBuildings = s.towns.map(() => 0);
    for (let i = 0; i < N; i++) {
      const t = s.bldTown[i];
      if (t >= 0 && s.bld[i]) { this.townPop[t] += LEVEL_POP[s.bld[i]]; this.townBuildings[t]++; }
    }
    this.coverCount = new Uint8Array(N);
    this.catchments.clear();
    for (const st of s.stations) {
      const r = STATIONS[st.kind].radius;
      const c: Catch = { tiles: [], pop: 0, towns: new Set(), industries: [] };
      for (let y = st.y - r; y <= st.y + r; y++)
        for (let x = st.x - r; x <= st.x + r; x++) {
          if (!this.inBounds(x, y)) continue;
          const i = this.idx(x, y);
          if (s.bld[i]) {
            c.tiles.push(i);
            c.pop += LEVEL_POP[s.bld[i]];
            if (s.bldTown[i] >= 0) c.towns.add(s.bldTown[i]);
            this.coverCount[i]++;
          }
        }
      c.industries = s.industries.filter((ind) =>
        ind.x + 1 >= st.x - r && ind.x <= st.x + r && ind.y + 1 >= st.y - r && ind.y <= st.y + r);
      this.catchments.set(st.id, c);
    }
    this.dirty = false;
    this.linesDirty = true;
  }

  private ensureLines() {
    if (!this.linesDirty) return;
    this.lineKinds.clear();
    for (const v of this.s.vehicles) {
      const pax = VEHICLES[v.type].pax;
      for (const id of v.stops) {
        const k = this.lineKinds.get(id) ?? { pax: false, freight: false };
        if (pax) k.pax = true; else k.freight = true;
        this.lineKinds.set(id, k);
      }
    }
    this.linesDirty = false;
  }

  // ---------------- simulation ----------------
  tick(dt: number) {
    this.ensure();
    this.ensureLines();
    const s = this.s;
    s.time += dt;

    // Industries
    for (const ind of s.industries) {
      const def = INDUSTRIES[ind.kind];
      if (def.produces && def.rate) {
        const add = def.rate * ind.rate * dt;
        ind.stock[def.produces] = Math.min(600, (ind.stock[def.produces] ?? 0) + add);
        ind.produced += add;
      }
      if (def.converts) {
        const have = ind.input[def.converts.from] ?? 0;
        const use = Math.min(have, 3 * dt);
        if (use > 0) {
          ind.input[def.converts.from] = have - use;
          const out = use * def.converts.ratio;
          ind.stock[def.converts.to] = Math.min(600, (ind.stock[def.converts.to] ?? 0) + out);
          ind.produced += out;
        }
      }
      // hand stock to stations with freight lines
      const sts = s.stations.filter((st) => this.lineKinds.get(st.id)?.freight && this.catchment(st).industries.includes(ind));
      if (sts.length)
        for (const [c, amt] of Object.entries(ind.stock) as [CargoId, number][]) {
          if (amt < 0.01) continue;
          let moved = 0;
          for (const st of sts) {
            const cap = STATIONS[st.kind].cap;
            const m = Math.max(0, Math.min(cap - (st.waiting[c] ?? 0), amt / sts.length));
            st.waiting[c] = (st.waiting[c] ?? 0) + m;
            moved += m;
          }
          ind.stock[c] = amt - moved;
          ind.moved += moved;
        }
    }

    // Passengers appear at stations that have a passenger line
    for (const st of s.stations) {
      if (!this.lineKinds.get(st.id)?.pax) continue;
      const c = this.catchment(st);
      let gen = 0;
      for (const t of c.tiles) gen += (LEVEL_POP[s.bld[t]] * PAX_GEN) / Math.max(1, this.coverCount[t]);
      const cap = STATIONS[st.kind].cap;
      const cur = (st.waiting.pax ?? 0) + gen * dt;
      if (cur > cap) { st.overflow += cur - cap; st.waiting.pax = cap; } else st.waiting.pax = cur;
    }

    // Road congestion: count vehicles per road edge
    this.occupancy.clear();
    for (const v of s.vehicles) {
      if (v.state !== 'move' || VEHICLES[v.type].mode !== 'road') continue;
      const slot = this.currentSlot(v);
      if (slot >= 0) this.occupancy.set(slot, (this.occupancy.get(slot) ?? 0) + 1);
    }
    for (const v of s.vehicles) this.tickVehicle(v, dt);
    for (const v of s.vehicles) s.money -= (VEHICLES[v.type].running / 60) * dt;

    // Town growth
    for (const t of s.towns) {
      const need = 25 + 1.2 * (this.townBuildings[t.id] ?? 0);
      if (t.growth >= need) {
        t.growth -= need;
        this.growTown(t);
      }
    }

    // Industry review each minute
    if (s.time - s.review >= 60) {
      s.review = s.time;
      for (const ind of s.industries) {
        const def = INDUSTRIES[ind.kind];
        if (!def.produces) { ind.produced = ind.moved = 0; continue; }
        const frac = ind.moved / Math.max(1, ind.produced);
        if (frac > 0.6 && ind.rate < 4) {
          ind.rate = Math.min(4, ind.rate * 1.12);
          this.news(`${ind.name} increases production (${Math.round(ind.rate * 100)}%).`, ind.x, ind.y);
        } else if (frac < 0.15 && ind.rate > 1) ind.rate = Math.max(1, ind.rate * 0.96);
        ind.produced = ind.moved = 0;
      }
    }
  }

  private currentSlot(v: Vehicle): number {
    if (v.path.length < 2) return -1;
    const c = this.curveOf(v);
    const p = c.at(v.dist);
    const e = Math.max(0, Math.min(v.path.length - 2, p.i - 1));
    const a = v.path[e], b = v.path[e + 1];
    const d = dirBetween(this.s.w, a, b);
    return d < 0 ? -1 : this.road.slot(a, d);
  }

  private tickVehicle(v: Vehicle, dt: number) {
    const def = VEHICLES[v.type];
    if (v.state === 'load') {
      v.timer -= dt;
      if (v.timer <= 0) this.depart(v);
      return;
    }
    if (v.state === 'lost') {
      v.timer -= dt;
      if (v.timer <= 0) this.routeFrom(v, this.vehicleNode(v));
      return;
    }
    let speed = def.speed;
    if (def.mode === 'road') {
      const slot = this.currentSlot(v);
      if (slot >= 0) {
        const kind = this.road.data[slot] || 1;
        const occ = this.occupancy.get(slot) ?? 1;
        speed *= ROAD_SPEED[kind] * Math.min(1, ROAD_CAP[kind] / occ);
        if (def.speed < 2) speed = Math.min(speed, def.speed * 1.15); // buses don't gain much on motorways
      }
    }
    v.dist += speed * dt;
    if (v.dist >= this.curveOf(v).length) this.arrive(v);
  }

  vehicleNode(v: Vehicle): number {
    if (v.state === 'move' && v.path.length > 1) {
      if (VEHICLES[v.type].mode === 'air') return v.path[v.dist < this.curveOf(v).length / 2 ? 0 : 1];
      const p = this.curveOf(v).at(v.dist);
      return v.path[Math.min(v.path.length - 1, p.i)];
    }
    if (v.state === 'lost' && v.path.length) return v.path[0];
    const st = this.station(v.stops[v.target])!;
    return this.idx(st.x, st.y);
  }

  private depart(v: Vehicle) {
    const here = this.station(v.stops[v.target])!;
    v.target = (v.target + 1) % v.stops.length;
    this.routeFrom(v, this.idx(here.x, here.y));
  }

  // Direction a road vehicle must leave `node` in (8 = free to turn round here).
  private startDir(v: Vehicle, node: number): number {
    if (VEHICLES[v.type].mode !== 'road' || v.heading < 0) return 8;
    if (this.turnNodes.has(node) || this.road.degree(node) <= 1) return 8;
    return v.heading;
  }

  private routeFrom(v: Vehicle, from: number) {
    const def = VEHICLES[v.type];
    const to = this.station(v.stops[v.target])!;
    const toN = this.idx(to.x, to.y);
    const layer = layerOf(def.mode);
    const path = !layer ? [from, toN] : this.findPath(layer, from, toN, this.startDir(v, from));
    if (!path) {
      v.state = 'lost';
      v.timer = 2;
      v.path = [from];
      v.dist = 0;
      return;
    }
    v.path = path;
    v.dist = 0;
    v.state = 'move';
  }

  private arrive(v: Vehicle) {
    const st = this.station(v.stops[v.target])!;
    const prev = this.station(v.stops[(v.target + v.stops.length - 1) % v.stops.length])!;
    const p = v.path;
    if (p.length >= 2) v.heading = dirBetween(this.s.w, p[p.length - 2], p[p.length - 1]);
    v.state = 'load';
    v.timer = LOAD_TIME;
    v.path = [this.idx(st.x, st.y)];
    v.dist = 0;
    v.trips++;
    // fares are earned per leg for everything on board
    let pay = 0;
    const d = this.distance(st, prev);
    for (const l of v.loads) pay += l.n * CARGO[l.c].pay * d;
    if (pay > 0) {
      pay = Math.round(pay);
      this.s.money += pay;
      this.s.earned += pay;
      v.profit += pay;
      this.emit({ t: 'money', x: st.x, y: st.y, amount: pay });
    }
    this.unload(v, st);
    this.load(v, st);
  }

  distance(a: Station, b: Station) {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return a.kind === 'airport' ? Math.hypot(dx, dy) : Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  // Can cargo c be delivered (consumed) at station st?
  consumes(st: Station, c: CargoId): Industry | 'town' | null {
    const ct = this.catchment(st);
    if (c === 'pax') return ct.tiles.length > 0 ? 'town' : null;
    if (c === 'goods' && ct.tiles.length >= TOWN_ACCEPT_MIN_BUILDINGS) return 'town';
    return ct.industries.find((i) => INDUSTRIES[i.kind].accepts.includes(c)) ?? null;
  }

  wants(st: Station, c: CargoId, from: Station, depth = 2, seen = new Set<number>()): boolean {
    if (this.consumes(st, c)) return true;
    if (depth <= 0) return false;
    seen.add(st.id);
    seen.add(from.id);
    for (const v of this.s.vehicles) {
      if (!v.stops.includes(st.id) || VEHICLES[v.type].pax !== (c === 'pax')) continue;
      for (const id of v.stops) {
        if (seen.has(id)) continue;
        const other = this.station(id);
        if (other && this.wants(other, c, st, depth - 1, new Set(seen))) return true;
      }
    }
    return false;
  }

  private otherStops(v: Vehicle, st: Station) {
    return v.stops.filter((id) => id !== st.id).map((id) => this.station(id)).filter((x): x is Station => !!x);
  }

  private unload(v: Vehicle, st: Station) {
    const keep: Load[] = [];
    const others = this.otherStops(v, st);
    for (const l of v.loads) {
      const from = this.station(l.from) ?? st;
      const consumer = l.from !== st.id ? this.consumes(st, l.c) : null;
      if (consumer === 'town') {
        const pts = (l.c === 'pax' ? 1 : 3) * l.n;
        const towns = new Set([...this.catchment(st).towns, ...this.catchment(from).towns]);
        for (const t of towns) { this.s.towns[t].growth += pts / towns.size; this.s.towns[t].served += l.n / towns.size; }
      } else if (consumer) consumer.input[l.c] = (consumer.input[l.c] ?? 0) + l.n;
      if (consumer) {
        this.s.delivered[l.c] = (this.s.delivered[l.c] ?? 0) + l.n;
        this.onDeliver?.({ cargo: l.c, amount: l.n, from, to: st, vehicle: v, transfer: false });
      } else if (l.from === st.id) {
        // came all the way round without finding anywhere to go
      } else if (!others.some((o) => this.consumes(o, l.c)) && this.wants(st, l.c, from)) {
        st.waiting[l.c] = Math.min(STATIONS[st.kind].cap, (st.waiting[l.c] ?? 0) + l.n);
        this.onDeliver?.({ cargo: l.c, amount: l.n, from, to: st, vehicle: v, transfer: true });
      } else keep.push(l);
    }
    v.loads = keep;
  }

  private load(v: Vehicle, st: Station) {
    const def = VEHICLES[v.type];
    let space = def.capacity - loadOf(v);
    const others = this.otherStops(v, st);
    const avail = (Object.entries(st.waiting) as [CargoId, number][])
      .filter(([c, n]) => n >= 1 && (c === 'pax') === def.pax && others.some((o) => this.wants(o, c, st)))
      .sort((a, b) => b[1] - a[1]);
    for (const [c, n] of avail) {
      if (space <= 0) break;
      const take = Math.min(space, Math.floor(n));
      st.waiting[c] = n - take;
      const ex = v.loads.find((l) => l.c === c && l.from === st.id);
      if (ex) ex.n += take; else v.loads.push({ c, n: take, from: st.id });
      space -= take;
    }
  }

  // Dijkstra over (node, heading) states. Rail and metro can only turn 45 degrees per node;
  // road vehicles can take any turn but only U-turn at dead ends and turnaround stations.
  findPath(layer: Layer, from: number, to: number, startDir = 8): number[] | null {
    const g = this.grid(layer);
    const N = this.s.w * this.s.h;
    const smooth = layer !== 'road';
    const S = 9; // state = node * 9 + incoming dir (8 = none)
    const dist = new Float64Array(N * S).fill(Infinity);
    const prev = new Int32Array(N * S).fill(-1);
    const heap = new Heap();
    const s0 = from * S + startDir;
    dist[s0] = 0;
    heap.push(0, s0);
    let goal = -1;
    while (heap.size) {
      const [dcur, st] = heap.pop();
      if (dcur > dist[st]) continue;
      const n = Math.floor(st / S), inDir = st % S;
      if (n === to && st !== s0) { goal = st; break; }
      if (n === to && from === to) { goal = st; break; }
      const canTurn = !smooth && (inDir === 8 || this.turnNodes.has(n) || g.degree(n) <= 1);
      for (let d = 0; d < 8; d++) {
        const val = g.get(n, d);
        if (!val) continue;
        if (inDir !== 8) {
          const turn = (d - inDir + 8) & 7;
          if (smooth ? turn !== 0 && turn !== 1 && turn !== 7 : turn === 4 && !canTurn) continue;
        }
        const m = g.neighbour(n, d);
        const cost = DLEN[d] / (layer === 'road' ? ROAD_SPEED[val] : 1) + (d === opposite(inDir) ? 0.6 : 0);
        const ns = m * S + d;
        const nd = dcur + cost;
        if (nd < dist[ns]) { dist[ns] = nd; prev[ns] = st; heap.push(nd, ns); }
      }
    }
    if (goal < 0) return null;
    const out: number[] = [];
    for (let st = goal; st !== -1; st = prev[st]) out.push(Math.floor(st / S));
    return out.reverse();
  }

  // ---------------- building ----------------
  // Validates a traced stroke of nodes; returns edges that can be built and the cost.
  planStroke(nodes: number[], kind: BuildKind) {
    const b = BUILD[kind];
    const g = this.grid(b.layer);
    const edges: { n: number; d: number }[] = [];
    let cost = 0;
    let bad = -1; // index of first node after which the stroke is invalid
    let lastDir = -1;
    const smooth = kind !== 'street';
    for (let i = 0; i + 1 < nodes.length; i++) {
      const a = nodes[i], c = nodes[i + 1];
      const d = dirBetween(this.s.w, a, c);
      let ok = d >= 0;
      if (ok && smooth && lastDir >= 0) {
        const turn = (d - lastDir + 8) & 7;
        ok = turn === 0 || turn === 1 || turn === 7;
      }
      if (ok && b.layer !== 'metro') ok = this.surfaceFree(a) && this.surfaceFree(c);
      if (ok && d % 2 === 1) {
        if (b.layer === 'metro') ok = !crossingDiagonal(this.metro, a, d);
        else ok = !crossingDiagonal(this.road, a, d) && !crossingDiagonal(this.rail, a, d);
      }
      if (!ok) { bad = i; break; }
      lastDir = d;
      const cur = g.get(a, d);
      if (cur === b.value || (b.layer === 'road' && cur === 2)) continue;
      const water = this.s.terrain[a] === T_WATER || this.s.terrain[c] === T_WATER;
      cost += b.cost * DLEN[d] * (water && b.layer !== 'metro' ? BRIDGE_MULT : 1);
      edges.push({ n: a, d });
    }
    return { edges, cost: Math.round(cost), bad };
  }

  buildStroke(nodes: number[], kind: BuildKind): string | null {
    const b = BUILD[kind];
    if (!this.has(b.tech)) return `${b.name} isn't unlocked yet — take on a challenge that grants it.`;
    const plan = this.planStroke(nodes, kind);
    if (!plan.edges.length) return plan.bad >= 0 ? (kind === 'street' ? 'Blocked — clear buildings first.' : 'Too sharp! Rail, metro and motorways can only turn 45° per tile.') : null;
    if (this.s.money < plan.cost) return `Not enough money (£${plan.cost.toLocaleString()} needed).`;
    const g = this.grid(b.layer);
    for (const e of plan.edges) {
      g.set(e.n, e.d, b.value);
      for (const t of [e.n, g.neighbour(e.n, e.d)]) {
        if (b.layer !== 'metro' && this.s.terrain[t] === T_FOREST) this.s.terrain[t] = 0;
        this.s.rubble = this.s.rubble.filter((r) => r !== t);
      }
    }
    this.s.money -= plan.cost;
    this.markDirty();
    this.rerouteAll();
    return null;
  }

  // Checks a station placement; returns an error, or the details needed to build it.
  planStation(x: number, y: number, kind: StationKind): string | { dir: number; foot?: number[]; link?: number } {
    const def = STATIONS[kind];
    if (!this.has(def.tech)) return `${def.name}s aren't unlocked yet.`;
    if (!this.inBounds(x, y)) return 'Out of bounds.';
    const n = this.idx(x, y);
    if (this.stationAt(x, y)) return 'There is already a station here.';
    if (this.s.terrain[n] === T_WATER) return 'Stations can\'t go on water.';
    const clear = (t: number) => t >= 0 && this.s.terrain[t] !== T_WATER && this.surfaceFree(t) && !this.road.any(t) && !this.rail.any(t) && this.tileStation[t] < 0;
    if (def.place === 'site') {
      const foot: number[] = [];
      for (let yy = y - 1; yy <= y + 1; yy++)
        for (let xx = x - 1; xx <= x + 1; xx++) {
          if (!this.inBounds(xx, yy)) return 'Too close to the edge.';
          const t = this.idx(xx, yy);
          if (!clear(t)) return 'An airport needs a clear 3×3 site (no roads, rails or buildings).';
          foot.push(t);
        }
      return { dir: 0, foot };
    }
    if (def.place === 'kerb') {
      let deg = 0, dir = 0;
      for (let d = 0; d < 8; d++) {
        const v = this.road.get(n, d);
        if (!v) continue;
        if (v === 2) return 'Stops can\'t go on a motorway.';
        deg++;
        dir = d;
      }
      if (!deg) return `A ${def.name.toLowerCase()} goes on a street. Tap a street tile.`;
      if (deg > 2) return 'Too close to a junction. Pick a plain stretch of street.';
      if (this.footTile[n] >= 0) return 'That\'s a station driveway.';
      return { dir };
    }
    if (def.place === 'offroad') {
      if (!clear(n)) return `A ${def.name.toLowerCase()} needs a clear tile right beside a street (not on it).`;
      let rd = -1;
      for (const d of [0, 2, 4, 6]) {
        const m = this.road.neighbour(n, d);
        if (m < 0 || this.footTile[m] >= 0) continue;
        let street = false;
        for (let e = 0; e < 8; e++) if (this.road.get(m, e) === 1) street = true;
        if (street) { rd = d; break; }
      }
      if (rd < 0) return `Place the ${def.name.toLowerCase()} right next to a street.`;
      const foot = [n];
      if (def.size === 2) {
        const back = this.road.neighbour(n, opposite(rd));
        let ok = false;
        for (const side of [(rd + 2) & 7, (rd + 6) & 7]) {
          const a = this.road.neighbour(n, side), b = back >= 0 ? this.road.neighbour(back, side) : -1;
          if (clear(back) && clear(a) && clear(b)) { foot.push(back, a, b); ok = true; break; }
        }
        if (!ok) return 'A bus interchange needs a clear 2×2 site beside the street.';
      }
      return { dir: rd, foot, link: this.road.neighbour(n, rd) };
    }
    const g = this.grid(def.layer!);
    if (!g.any(n)) return `Build ${kind === 'rail' ? 'track' : 'a metro tunnel'} here first.`;
    for (let d = 0; d < 8; d++) if (g.get(n, d)) return { dir: d };
    return { dir: 0 };
  }

  placeStation(x: number, y: number, kind: StationKind): string | null {
    const def = STATIONS[kind];
    const plan = this.planStation(x, y, kind);
    if (typeof plan === 'string') return plan;
    if (this.s.money < def.cost) return `Not enough money (£${def.cost.toLocaleString()} needed).`;
    this.s.money -= def.cost;
    const n = this.idx(x, y);
    if (plan.link !== undefined) {
      this.road.set(n, plan.dir, 1); // the driveway
      if (this.s.terrain[n] === T_FOREST) this.s.terrain[n] = 0;
    }
    const st: Station = { id: this.s.nextId++, kind, x, y, name: this.stationName(x, y, kind), waiting: {}, dir: plan.dir, overflow: 0, foot: plan.foot, link: plan.link };
    this.s.stations.push(st);
    this.markDirty();
    return null;
  }

  private stationName(x: number, y: number, kind: StationKind) {
    const town = this.s.towns.reduce((b, t) => (Math.hypot(t.cx - x, t.cy - y) < Math.hypot(b.cx - x, b.cy - y) ? t : b), this.s.towns[0]);
    const ind = this.s.industries.find((i) => Math.hypot(i.x + 0.5 - x, i.y + 0.5 - y) < 4);
    const used = new Set(this.s.stations.map((s) => s.name));
    const pick = (base: string, list: string[]) => {
      for (const suf of list) { const nm = suf ? `${base} ${suf}` : base; if (!used.has(nm)) return nm; }
      return `${base} ${list[0]} ${this.s.stations.length}`;
    };
    if (kind === 'airport') return pick(`${town.name}`, ['International', 'Airport', 'City Airport']);
    if (ind && kind !== 'metro' && STATIONS[kind].cargo !== 'pax') return pick(ind.name, [kind === 'rail' ? 'Sidings' : kind === 'lorry_depot' ? 'Lorry Depot' : 'Loading Bay', 'Yard', 'Gate']);
    const lists: Partial<Record<StationKind, string[]>> = {
      bus_stop: ['High Street', 'Market Square', 'Park Road', 'Church Lane', 'Station Road', 'The Green', 'Mill Lane', 'Victoria Road', 'Kings Road', 'Queens Parade'],
      bus_station: ['Bus Station', 'Coach Station', 'Bus Garage'],
      bus_interchange: ['Interchange', 'Transport Hub'],
      loading_bay: ['Goods Yard', 'Trade Park', 'Loading Bay'],
      lorry_depot: ['Lorry Depot', 'Distribution Centre', 'Freight Yard'],
      road: ['Stop', 'Road Stop'],
      rail: ['Central', 'Parkway', 'North', 'Junction', 'Road', 'East'],
      metro: ['Central', 'Market Street', 'Riverside', 'University', 'Docklands', 'Park'],
    };
    return pick(town.name, lists[kind] ?? ['Stop']);
  }

  // Checks a proposed line; returns an error or null.
  checkLine(type: VehicleId, stops: Station[]): string | null {
    const def = VEHICLES[type];
    if (!this.has(def.tech)) return `${def.name}s aren't unlocked yet.`;
    if (stops.length < 2) return 'Pick at least two stops.';
    for (const st of stops) if (!canServe(def, STATIONS[st.kind])) return `A ${def.name} can't use ${st.name} (${STATIONS[st.kind].name.toLowerCase()}).`;
    const layer = layerOf(def.mode);
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i], b = stops[(i + 1) % stops.length];
      if (a.id === b.id) return 'The same stop twice in a row.';
      if (layer && !this.findPath(layer, this.idx(a.x, a.y), this.idx(b.x, b.y)))
        return layer === 'road' ? `${a.name} and ${b.name} aren't connected by road.` : `No route from ${a.name} to ${b.name}. Check the track joins up without sharp turns.`;
    }
    return null;
  }

  buyVehicle(type: VehicleId, stops: Station[]): string | null {
    const def = VEHICLES[type];
    const err = this.checkLine(type, stops);
    if (err) return err;
    if (this.s.money < def.cost) return `Not enough money (£${def.cost.toLocaleString()} needed).`;
    this.s.money -= def.cost;
    const a = stops[0];
    const v: Vehicle = {
      id: this.s.nextId++, type, stops: stops.map((s) => s.id), target: 0, heading: -1, state: 'load', timer: 0.5,
      path: [this.idx(a.x, a.y)], dist: 0, loads: [], profit: -def.cost, trips: 0,
    };
    this.s.vehicles.push(v);
    this.linesDirty = true;
    this.ensureLines();
    this.load(v, a);
    return null;
  }

  sellVehicle(v: Vehicle) {
    const refund = Math.floor(VEHICLES[v.type].cost * 0.5);
    this.s.money += refund;
    this.s.vehicles = this.s.vehicles.filter((x) => x !== v);
    this.curves.delete(v.id);
    this.linesDirty = true;
    return refund;
  }

  removeStation(st: Station) {
    for (const v of this.vehiclesAt(st)) this.sellVehicle(v);
    this.s.stations = this.s.stations.filter((x) => x !== st);
    if (st.link !== undefined) { this.road.set(this.idx(st.x, st.y), st.dir, 0); this.rerouteAll(); }
    this.s.money += Math.floor(STATIONS[st.kind].cost * 0.4);
    this.markDirty();
  }

  // Tap-bulldoze: station, then track/road, then a town building.
  bulldoze(x: number, y: number): string | null {
    if (!this.inBounds(x, y)) return null;
    const n = this.idx(x, y);
    const st = this.stationAt(x, y) ?? this.airportAt(x, y);
    if (st) { this.removeStation(st); return `Demolished ${st.name}.`; }
    let removed = 0;
    for (const g of [this.road, this.rail]) for (let d = 0; d < 8; d++) if (g.get(n, d)) { g.set(n, d, 0); removed++; }
    if (!removed) for (let d = 0; d < 8; d++) if (this.metro.get(n, d)) { this.metro.set(n, d, 0); removed++; }
    if (removed) {
      this.s.rubble = this.s.rubble.filter((r) => r !== n);
      this.markDirty();
      this.rerouteAll();
      return null;
    }
    if (this.s.bld[n]) {
      const cost = DEMOLISH_BUILDING_COST * this.s.bld[n];
      if (this.s.money < cost) return `Compulsory purchase costs £${cost.toLocaleString()}.`;
      this.s.money -= cost;
      this.s.bld[n] = 0;
      this.s.bldTown[n] = -1;
      this.markDirty();
      return `Building demolished (£${cost.toLocaleString()}).`;
    }
    return 'Nothing to demolish here.';
  }

  // Remove edges along a traced stroke.
  bulldozeStroke(nodes: number[]) {
    let removed = 0;
    for (let i = 0; i + 1 < nodes.length; i++) {
      const d = dirBetween(this.s.w, nodes[i], nodes[i + 1]);
      if (d < 0) continue;
      for (const g of [this.road, this.rail, this.metro]) if (g.get(nodes[i], d)) { g.set(nodes[i], d, 0); removed++; }
    }
    if (removed) { this.markDirty(); this.rerouteAll(); }
    return removed;
  }

  // Disaster: knock out edges (both surface layers) at the given nodes.
  wreck(nodes: number[]) {
    for (const n of nodes) {
      for (const g of [this.road, this.rail]) for (let d = 0; d < 8; d++) g.set(n, d, 0);
      if (!this.s.rubble.includes(n)) this.s.rubble.push(n);
    }
    this.markDirty();
    this.rerouteAll();
  }

  private rerouteAll() {
    for (const v of this.s.vehicles) {
      const def = VEHICLES[v.type];
      const layer = layerOf(def.mode);
      if (!layer) continue;
      if (v.state === 'lost') { v.timer = 0; continue; }
      if (v.state !== 'move') continue;
      const g = this.grid(layer);
      let broken = false;
      for (let i = 0; i + 1 < v.path.length; i++) {
        const d = dirBetween(this.s.w, v.path[i], v.path[i + 1]);
        if (d < 0 || !g.get(v.path[i], d)) { broken = true; break; }
      }
      if (broken) this.routeFrom(v, this.vehicleNode(v));
    }
  }

  // ---------------- towns & industries ----------------
  growTown(t: Town) {
    const s = this.s;
    const pop = this.townPop[t.id];
    const R = 2 + Math.sqrt(this.townBuildings[t.id] + 1) * 0.9;
    const tiles: number[] = [];
    for (let y = Math.floor(t.cy - R); y <= t.cy + R; y++)
      for (let x = Math.floor(t.cx - R); x <= t.cx + R; x++)
        if (this.inBounds(x, y) && Math.hypot(x - t.cx, y - t.cy) <= R) tiles.push(this.idx(x, y));
    const r = this.rand();
    // Densify the centre as the town gets big.
    if (pop > 600 && r < 0.45) {
      const lvl = pop > 2500 && r < 0.2 ? 2 : 1;
      const cands = tiles.filter((i) => s.bldTown[i] === t.id && s.bld[i] === lvl);
      if (cands.length) {
        cands.sort((a, b) => this.distTo(a, t) - this.distTo(b, t));
        const pick = cands[Math.floor(this.rand() * Math.min(4, cands.length))];
        s.bld[pick] = lvl + 1;
        this.afterGrowth(t, pop);
        return;
      }
    }
    const free = tiles.filter((i) => {
      if (s.bld[i] || s.terrain[i] === T_WATER || this.road.any(i) || this.rail.any(i)) return false;
      const { x, y } = this.xy(i);
      if (this.industryAt(x, y) || this.tileStation[i] >= 0 || this.footTile[i] >= 0) return false;
      for (let d = 0; d < 8; d++) {
        const m = this.road.neighbour(i, d);
        if (m >= 0 && (this.road.any(m) || s.bldTown[m] === t.id)) return true;
      }
      return false;
    });
    if (free.length) {
      free.sort((a, b) => this.distTo(a, t) - this.distTo(b, t));
      const pick = free[Math.floor(this.rand() * Math.min(6, free.length))];
      s.bld[pick] = 1;
      s.bldTown[pick] = t.id;
      if (s.terrain[pick] === T_FOREST) s.terrain[pick] = 0;
    } else {
      // Push a new street out from the edge of town.
      const ends = tiles.filter((i) => this.road.any(i));
      const e = ends[Math.floor(this.rand() * ends.length)];
      if (e === undefined) return;
      const d = [0, 2, 4, 6][Math.floor(this.rand() * 4)];
      const m = this.road.neighbour(e, d);
      if (m >= 0 && this.surfaceFree(m) && s.terrain[m] !== T_WATER && !this.rail.any(m)) this.road.set(e, d, 1);
    }
    this.afterGrowth(t, pop);
  }

  private afterGrowth(t: Town, before: number) {
    this.markDirty();
    this.ensure();
    const after = this.townPop[t.id];
    for (const m of [1000, 2500, 5000, 10000, 20000])
      if (before < m && after >= m) this.news(`${t.name} has grown to ${after.toLocaleString()} people!`, t.cx, t.cy);
  }

  private distTo(i: number, t: Town) {
    const { x, y } = this.xy(i);
    return Math.hypot(x - t.cx, y - t.cy);
  }

  // Found a new industry somewhere sensible; returns it.
  spawnIndustry(kind: IndustryKind): Industry | null {
    const s = this.s;
    for (let tries = 0; tries < 3000; tries++) {
      const x = 2 + Math.floor(this.rand() * (s.w - 5)), y = 2 + Math.floor(this.rand() * (s.h - 5));
      let ok = true;
      for (let yy = y - 1; yy < y + 3 && ok; yy++)
        for (let xx = x - 1; xx < x + 3 && ok; xx++) {
          const i = this.idx(xx, yy);
          if (s.terrain[i] === T_WATER || !this.surfaceFree(i) || this.road.any(i) || this.rail.any(i) || this.tileStation[i] >= 0) ok = false;
        }
      if (!ok) continue;
      if (s.towns.some((t) => Math.hypot(t.cx - x, t.cy - y) < 7)) continue;
      if (s.industries.some((o) => Math.hypot(o.x - x, o.y - y) < 6)) continue;
      const town = s.towns.reduce((b, t) => (Math.hypot(t.cx - x, t.cy - y) < Math.hypot(b.cx - x, b.cy - y) ? t : b), s.towns[0]);
      const ind = makeIndustry(Math.max(0, ...s.industries.map((i) => i.id)) + 1, kind, x, y, `New ${town.name}`);
      ind.name = ind.name.replace('New ', '');
      s.industries.push(ind);
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) s.terrain[this.idx(xx, yy)] = 0;
      this.markDirty();
      return ind;
    }
    return null;
  }

  // Build a suburb: a new small town near a parent town with a few houses and no roads.
  spawnSuburb(parent: Town): Town | null {
    const s = this.s;
    for (let tries = 0; tries < 400; tries++) {
      const a = this.rand() * Math.PI * 2, d = 8 + this.rand() * 3;
      const x = Math.round(parent.cx + Math.cos(a) * d), y = Math.round(parent.cy + Math.sin(a) * d);
      let ok = true;
      for (let yy = y - 2; yy <= y + 2 && ok; yy++)
        for (let xx = x - 2; xx <= x + 2 && ok; xx++) {
          if (!this.inBounds(xx, yy)) { ok = false; break; }
          const i = this.idx(xx, yy);
          if (s.terrain[i] === T_WATER || !this.surfaceFree(i) || this.road.any(i) || this.rail.any(i) || this.tileStation[i] >= 0) ok = false;
        }
      if (!ok) continue;
      const t: Town = { id: s.towns.length, name: `${parent.name} Heights`, cx: x, cy: y, growth: 0, served: 0, parent: parent.id };
      s.towns.push(t);
      for (let yy = y - 2; yy <= y + 2; yy++)
        for (let xx = x - 2; xx <= x + 2; xx++) {
          if ((xx - x) % 2 === 0 && (yy - y) % 2 === 0 && this.rand() < 0.2) continue;
          const i = this.idx(xx, yy);
          if (xx === x || yy === y) continue; // leave a cross for the player's roads
          s.bld[i] = this.rand() < 0.15 ? 2 : 1;
          s.bldTown[i] = t.id;
          if (s.terrain[i] === T_FOREST) s.terrain[i] = 0;
        }
      this.markDirty();
      return t;
    }
    return null;
  }

  catchUp(seconds: number) {
    const money0 = this.s.money, del0 = { ...this.s.delivered };
    this.quiet = true;
    for (let t = 0; t < seconds; t += 1) this.tick(Math.min(1, seconds - t));
    this.quiet = false;
    const pax = (this.s.delivered.pax ?? 0) - (del0.pax ?? 0);
    return { money: this.s.money - money0, pax };
  }
}

