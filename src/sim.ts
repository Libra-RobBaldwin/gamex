// Core simulation: production, station catchment, vehicles, economy, player actions.
import {
  BUILDINGS, CARGO, INFRA, MODE_BIT, SKILLS, STATIONS, STATION_CARGO_CAP, START_COINS, VEHICLES,
  BRIDGE_MULT, accepts, levelForXp,
  type CargoId, type Mode, type SkillId, type VehicleId,
} from './data';
import { T_MOUNTAIN, T_WATER, generateWorld, type Building } from './world';

export interface Station {
  id: number;
  x: number;
  y: number;
  mode: Mode;
  name: string;
  cargo: Partial<Record<CargoId, number>>;
}

export interface Vehicle {
  id: number;
  type: VehicleId;
  stops: [number, number];
  target: 0 | 1; // index into stops we're heading to / sitting at
  state: 'load' | 'move' | 'lost';
  timer: number;
  path: number[]; // tile indices
  dist: number; // distance travelled along path
  cargo: Partial<Record<CargoId, number>>;
  profit: number;
  trips: number;
}

export type GameEvent =
  | { t: 'chat'; text: string; color?: string }
  | { t: 'xp'; skill: SkillId; amount: number }
  | { t: 'level'; skill: SkillId; level: number }
  | { t: 'coins'; x: number; y: number; amount: number };

export interface Stats {
  earned: number;
  produced: Partial<Record<CargoId, number>>;
  delivered: Partial<Record<CargoId, number>>;
  tasksDone: number;
}

export interface GameState {
  v: 1;
  seed: number;
  w: number;
  h: number;
  terrain: Uint8Array;
  infra: Uint8Array;
  buildings: Building[];
  stations: Station[];
  vehicles: Vehicle[];
  coins: number;
  xp: Record<SkillId, number>;
  time: number;
  nextId: number;
  stats: Stats;
  start: { x: number; y: number };
}

const LOAD_TIME = 1.5;
// Idle gathering trains skills at a fraction of the hands-on (tap to gather) rate.
const PASSIVE_XP = 0.25;
const STATION_NAMES = ['Junction', 'Halt', 'Crossing', 'Yard', 'Wharf', 'Depot', 'Siding', 'Landing'];

export function newGame(seed = (Math.random() * 2 ** 31) | 0): GameState {
  const g = generateWorld(seed);
  const xp = {} as Record<SkillId, number>;
  for (const s of SKILLS) xp[s.id] = 0;
  return {
    v: 1, seed, w: g.w, h: g.h, terrain: g.terrain, infra: new Uint8Array(g.w * g.h),
    buildings: g.buildings, stations: [], vehicles: [], coins: START_COINS, xp, time: 0,
    nextId: 10000, stats: { earned: 0, produced: {}, delivered: {}, tasksDone: 0 }, start: g.start,
  };
}

export class Game {
  s: GameState;
  events: GameEvent[] = [];
  quiet = false; // suppress chatty events during offline catch-up
  netVersion = 0;
  private catchment = new Map<number, Building[]>(); // station -> buildings
  private buildingStations = new Map<number, Station[]>(); // building -> stations
  private tileBuilding: Int32Array;
  private tileStation: Int32Array;
  private dirty = true;

  constructor(s: GameState) {
    this.s = s;
    this.tileBuilding = new Int32Array(s.w * s.h).fill(-1);
    this.tileStation = new Int32Array(s.w * s.h).fill(-1);
    this.rebuild();
  }

  // ---------- helpers ----------
  idx(x: number, y: number) { return y * this.s.w + x; }
  inBounds(x: number, y: number) { return x >= 0 && y >= 0 && x < this.s.w && y < this.s.h; }
  level(skill: SkillId) { return levelForXp(this.s.xp[skill]); }
  buildingAt(x: number, y: number): Building | undefined {
    if (!this.inBounds(x, y)) return;
    this.ensure();
    const id = this.tileBuilding[this.idx(x, y)];
    return id >= 0 ? this.s.buildings.find((b) => b.id === id) : undefined;
  }
  stationAt(x: number, y: number): Station | undefined {
    if (!this.inBounds(x, y)) return;
    this.ensure();
    const id = this.tileStation[this.idx(x, y)];
    return id >= 0 ? this.station(id) : undefined;
  }
  station(id: number) { return this.s.stations.find((st) => st.id === id); }
  catchmentOf(st: Station) { this.ensure(); return this.catchment.get(st.id) ?? []; }
  stationsOf(b: Building) { this.ensure(); return this.buildingStations.get(b.id) ?? []; }
  vehiclesAt(st: Station) { return this.s.vehicles.filter((v) => v.stops.includes(st.id)); }
  emit(e: GameEvent) { if (!this.quiet || e.t === 'level') this.events.push(e); }
  chat(text: string, color?: string) { this.emit({ t: 'chat', text, color }); }

  private ensure() { if (this.dirty) this.rebuild(); }

  rebuild() {
    const s = this.s;
    this.tileBuilding.fill(-1);
    this.tileStation.fill(-1);
    for (const b of s.buildings)
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) this.tileBuilding[this.idx(x, y)] = b.id;
    for (const st of s.stations) this.tileStation[this.idx(st.x, st.y)] = st.id;
    this.catchment.clear();
    this.buildingStations.clear();
    for (const st of s.stations) {
      const r = STATIONS[st.mode].radius;
      const list = s.buildings.filter((b) => chebyshevToRect(st.x, st.y, b) <= r);
      this.catchment.set(st.id, list);
      for (const b of list) {
        const arr = this.buildingStations.get(b.id) ?? [];
        arr.push(st);
        this.buildingStations.set(b.id, arr);
      }
    }
    this.dirty = false;
  }

  addXp(skill: SkillId, amount: number) {
    const before = this.level(skill);
    this.s.xp[skill] = Math.min(200_000_000, this.s.xp[skill] + amount);
    const after = this.level(skill);
    this.emit({ t: 'xp', skill, amount });
    if (after > before) {
      // UI prints the congratulations + unlocks, so it also works for offline catch-up.
      for (let l = before + 1; l <= after; l++) this.emit({ t: 'level', skill, level: l });
    }
  }

  // ---------- simulation ----------
  tick(dt: number) {
    this.ensure();
    const s = this.s;
    s.time += dt;

    for (const b of s.buildings) {
      const def = BUILDINGS[b.kind];
      if (def.type === 'node') {
        if (this.level(def.skill) < def.level) continue;
        const cur = b.stock[def.produces] ?? 0;
        if (cur >= def.cap) continue;
        const add = Math.min(def.cap - cur, def.rate * dt);
        b.stock[def.produces] = cur + add;
        s.stats.produced[def.produces] = (s.stats.produced[def.produces] ?? 0) + add;
        // Only a worked node (one served by a station) trains the skill.
        if (this.stationsOf(b).length) this.addXp(def.skill, add * def.xp * PASSIVE_XP);
      } else if (def.type === 'industry') {
        def.recipes.forEach((r, i) => {
          if (this.level(r.skill) < r.level) return;
          const ok = Object.entries(r.inputs).every(([c, n]) => (b.input[c as CargoId] ?? 0) >= n!);
          if (!ok) { b.progress[i] = 0; return; }
          const full = Object.keys(r.outputs).some((c) => (b.stock[c as CargoId] ?? 0) >= def.cap);
          if (full) return;
          b.progress[i] = (b.progress[i] ?? 0) + dt;
          while (b.progress[i] >= r.time && Object.entries(r.inputs).every(([c, n]) => (b.input[c as CargoId] ?? 0) >= n!)) {
            b.progress[i] -= r.time;
            for (const [c, n] of Object.entries(r.inputs)) b.input[c as CargoId]! -= n!;
            for (const [c, n] of Object.entries(r.outputs)) {
              b.stock[c as CargoId] = (b.stock[c as CargoId] ?? 0) + n!;
              s.stats.produced[c as CargoId] = (s.stats.produced[c as CargoId] ?? 0) + n!;
            }
            this.addXp(r.skill, r.xp);
          }
        });
      }
      // Hand stock to stations serving this building.
      const sts = this.stationsOf(b);
      if (sts.length)
        for (const [c, amt] of Object.entries(b.stock) as [CargoId, number][]) {
          if (amt <= 0) continue;
          const share = amt / sts.length;
          let moved = 0;
          for (const st of sts) {
            const room = STATION_CARGO_CAP - (st.cargo[c] ?? 0);
            const m = Math.max(0, Math.min(room, share));
            st.cargo[c] = (st.cargo[c] ?? 0) + m;
            moved += m;
          }
          b.stock[c] = amt - moved;
        }
    }

    for (const v of s.vehicles) this.tickVehicle(v, dt);
    for (const v of s.vehicles) s.coins -= (VEHICLES[v.type].upkeep / 60) * dt;
  }

  private tickVehicle(v: Vehicle, dt: number) {
    const def = VEHICLES[v.type];
    if (v.state === 'load') {
      v.timer -= dt;
      if (v.timer <= 0) this.depart(v);
    } else if (v.state === 'lost') {
      v.timer -= dt;
      if (v.timer <= 0) {
        const from = this.vehicleTile(v);
        this.routeTo(v, from);
      }
    } else {
      v.dist += def.speed * dt;
      const len = pathLength(this.s.w, v.path, def.mode);
      if (v.dist >= len) this.arrive(v);
    }
  }

  vehicleTile(v: Vehicle): number {
    if (v.state === 'move' && v.path.length) {
      if (VEHICLES[v.type].mode === 'air') return v.path[v.dist < pathLength(this.s.w, v.path, 'air') / 2 ? 0 : 1];
      return v.path[Math.min(v.path.length - 1, Math.floor(v.dist))];
    }
    if (v.path.length && v.state === 'lost') return v.path[Math.min(v.path.length - 1, Math.floor(v.dist))];
    const st = this.station(v.stops[v.target])!;
    return this.idx(st.x, st.y);
  }

  private depart(v: Vehicle) {
    v.target = v.target === 0 ? 1 : 0;
    const from = this.station(v.stops[v.target === 0 ? 1 : 0])!;
    this.routeTo(v, this.idx(from.x, from.y));
  }

  private routeTo(v: Vehicle, fromTile: number) {
    const def = VEHICLES[v.type];
    const to = this.station(v.stops[v.target])!;
    const toTile = this.idx(to.x, to.y);
    const path = def.mode === 'air' ? [fromTile, toTile] : this.findPath(fromTile, toTile, def.mode);
    if (!path) {
      v.state = 'lost';
      v.timer = 2;
      v.path = [fromTile];
      v.dist = 0;
      return;
    }
    v.path = path;
    v.dist = 0;
    v.state = 'move';
  }

  private arrive(v: Vehicle) {
    const st = this.station(v.stops[v.target])!;
    const other = this.station(v.stops[v.target === 0 ? 1 : 0])!;
    v.state = 'load';
    v.timer = LOAD_TIME;
    v.path = [this.idx(st.x, st.y)];
    v.dist = 0;
    v.trips++;
    this.unload(v, st, other);
    this.load(v, st, other);
  }

  legDistance(a: Station, b: Station) {
    return a.mode === 'air' ? Math.hypot(a.x - b.x, a.y - b.y) : Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private unload(v: Vehicle, st: Station, from: Station) {
    const d = this.legDistance(st, from);
    const factor = 0.6 + d / 15;
    let pay = 0;
    let moved = 0;
    for (const [c, amt] of Object.entries(v.cargo) as [CargoId, number][]) {
      if (!amt) continue;
      const consumer = this.consumerFor(st, c);
      if (consumer) {
        if (BUILDINGS[consumer.kind].type === 'town') {
          pay += amt * CARGO[c].value * factor;
          this.s.stats.delivered[c] = (this.s.stats.delivered[c] ?? 0) + amt;
        } else {
          consumer.input[c] = (consumer.input[c] ?? 0) + amt;
          pay += amt * CARGO[c].value * factor * 0.5;
        }
      } else {
        // Transfer: leave it at the station for another route to pick up.
        st.cargo[c] = Math.min(STATION_CARGO_CAP, (st.cargo[c] ?? 0) + amt);
        pay += amt * CARGO[c].value * factor * 0.3;
      }
      moved += amt;
      delete v.cargo[c];
    }
    if (moved > 0) {
      pay = Math.round(pay);
      this.s.coins += pay;
      this.s.stats.earned += pay;
      v.profit += pay;
      this.emit({ t: 'coins', x: st.x, y: st.y, amount: pay });
      this.addXp('transport', moved * d * 0.6);
    }
  }

  private consumerFor(st: Station, c: CargoId): Building | undefined {
    const list = this.catchmentOf(st).filter((b) => accepts(b.kind, c));
    if (!list.length) return;
    // Prefer towns, then the industry with the least stock waiting.
    return list.find((b) => BUILDINGS[b.kind].type === 'town') ?? list.sort((a, b) => (a.input[c] ?? 0) - (b.input[c] ?? 0))[0];
  }

  // Does station `st` want cargo `c`, directly or via a connecting route (excluding `from`)?
  wants(st: Station, c: CargoId, from: Station, depth = 2, seen = new Set<number>()): boolean {
    if (this.catchmentOf(st).some((b) => accepts(b.kind, c))) return true;
    if (depth <= 0) return false;
    seen.add(st.id);
    seen.add(from.id);
    for (const v of this.s.vehicles) {
      if (!v.stops.includes(st.id)) continue;
      const otherId = v.stops[0] === st.id ? v.stops[1] : v.stops[0];
      if (seen.has(otherId)) continue;
      const other = this.station(otherId);
      if (other && this.wants(other, c, st, depth - 1, new Set(seen))) return true;
    }
    return false;
  }

  private load(v: Vehicle, st: Station, next: Station) {
    const cap = VEHICLES[v.type].capacity;
    let space = cap - Object.values(v.cargo).reduce((a, b) => a + (b ?? 0), 0);
    const avail = (Object.entries(st.cargo) as [CargoId, number][])
      .filter(([c, n]) => n >= 1 && this.wants(next, c, st))
      .sort((a, b) => b[1] - a[1]);
    for (const [c, n] of avail) {
      if (space <= 0) break;
      const take = Math.min(space, Math.floor(n));
      st.cargo[c] = n - take;
      v.cargo[c] = (v.cargo[c] ?? 0) + take;
      space -= take;
    }
  }

  // BFS over tiles carrying the given mode's infrastructure.
  findPath(from: number, to: number, mode: Mode): number[] | null {
    const s = this.s;
    const bit = MODE_BIT[mode];
    const prev = new Int32Array(s.w * s.h).fill(-2);
    const q = [from];
    prev[from] = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      if (cur === to) break;
      const x = cur % s.w, y = (cur / s.w) | 0;
      const nbs = [x > 0 ? cur - 1 : -1, x < s.w - 1 ? cur + 1 : -1, y > 0 ? cur - s.w : -1, y < s.h - 1 ? cur + s.w : -1];
      for (const n of nbs) {
        if (n < 0 || prev[n] !== -2) continue;
        if (!(s.infra[n] & bit)) continue;
        prev[n] = cur;
        q.push(n);
      }
    }
    if (prev[to] === -2) return null;
    const path: number[] = [];
    for (let c = to; c !== -1; c = prev[c]) path.push(c);
    return path.reverse();
  }

  // ---------- player actions ----------
  canAfford(n: number) { return this.s.coins >= n; }

  infraCost(tiles: number[], mode: 'road' | 'rail'): number {
    const bit = MODE_BIT[mode];
    let cost = 0;
    for (const t of new Set(tiles)) {
      if (this.s.infra[t] & bit) continue;
      cost += INFRA[mode].cost * (this.s.terrain[t] === T_WATER ? BRIDGE_MULT : 1);
    }
    return cost;
  }

  canBuildInfra(t: number): boolean {
    this.ensure();
    return this.s.terrain[t] !== T_MOUNTAIN && this.tileBuilding[t] < 0;
  }

  buildInfra(tiles: number[], mode: 'road' | 'rail'): string | null {
    this.ensure();
    if (this.level('transport') < INFRA[mode].level) return `You need Transport level ${INFRA[mode].level} to build ${INFRA[mode].name.toLowerCase()}.`;
    const ok = [...new Set(tiles)].filter((t) => this.canBuildInfra(t));
    if (!ok.length) return 'You can\'t build there.';
    const cost = this.infraCost(ok, mode);
    if (!this.canAfford(cost)) return `You need ${cost} coins for that.`;
    for (const t of ok) this.s.infra[t] |= MODE_BIT[mode];
    this.s.coins -= cost;
    this.netVersion++;
    this.relostVehicles();
    return null;
  }

  placeStation(x: number, y: number, mode: Mode): string | null {
    this.ensure();
    const def = STATIONS[mode];
    if (this.level('transport') < def.level) return `You need Transport level ${def.level} to build a ${def.name.toLowerCase()}.`;
    if (!this.inBounds(x, y)) return 'You can\'t build there.';
    const t = this.idx(x, y);
    if (this.tileStation[t] >= 0) return 'There is already a station here.';
    if (!this.canBuildInfra(t) || this.s.terrain[t] === T_WATER) return 'You can\'t build a station there.';
    const bit = MODE_BIT[mode];
    const needsTrack = mode !== 'air' && !(this.s.infra[t] & bit);
    const cost = def.cost + (needsTrack ? INFRA[mode as 'road' | 'rail'].cost : 0);
    if (!this.canAfford(cost)) return `You need ${cost} coins for that.`;
    this.s.coins -= cost;
    if (mode !== 'air') this.s.infra[t] |= bit;
    const near = this.s.buildings
      .map((b) => ({ b, d: chebyshevToRect(x, y, b) }))
      .sort((a, b) => a.d - b.d)[0];
    const base = near && near.d <= 6 ? (near.b.name || BUILDINGS[near.b.kind].name) : 'Wilderness';
    const suffix = STATION_NAMES[this.s.stations.length % STATION_NAMES.length];
    const st: Station = { id: this.s.nextId++, x, y, mode, name: `${base} ${mode === 'air' ? 'Glider Pad' : suffix}`, cargo: {} };
    this.s.stations.push(st);
    this.dirty = true;
    this.netVersion++;
    return null;
  }

  buyVehicle(type: VehicleId, a: Station, b: Station): string | null {
    const def = VEHICLES[type];
    if (this.level('transport') < def.level) return `You need Transport level ${def.level} for a ${def.name}.`;
    if (a.id === b.id) return 'Pick two different stations.';
    if (a.mode !== def.mode || b.mode !== def.mode) return `A ${def.name} needs two ${STATIONS[def.mode].name.toLowerCase()}s.`;
    if (def.mode !== 'air' && !this.findPath(this.idx(a.x, a.y), this.idx(b.x, b.y), def.mode))
      return `Those stations aren't connected by ${def.mode}.`;
    if (!this.canAfford(def.cost)) return `You need ${def.cost} coins for a ${def.name}.`;
    this.s.coins -= def.cost;
    const v: Vehicle = {
      id: this.s.nextId++, type, stops: [a.id, b.id], target: 0, state: 'load', timer: 0.2,
      path: [this.idx(a.x, a.y)], dist: 0, cargo: {}, profit: -def.cost, trips: 0,
    };
    this.s.vehicles.push(v);
    // Start loading at the first stop.
    this.load(v, a, b);
    return null;
  }

  sellVehicle(v: Vehicle) {
    const refund = Math.floor(VEHICLES[v.type].cost * 0.5);
    this.s.coins += refund;
    this.s.vehicles = this.s.vehicles.filter((x) => x !== v);
    return refund;
  }

  bulldoze(x: number, y: number): string | null {
    this.ensure();
    if (!this.inBounds(x, y)) return null;
    const t = this.idx(x, y);
    const st = this.stationAt(x, y);
    if (st) {
      for (const v of this.vehiclesAt(st)) this.sellVehicle(v);
      this.s.stations = this.s.stations.filter((s) => s !== st);
      this.s.coins += Math.floor(STATIONS[st.mode].cost * 0.5);
      this.dirty = true;
      this.netVersion++;
      return null;
    }
    if (this.s.infra[t]) {
      if (this.s.infra[t] & 1) this.s.coins += Math.floor(INFRA.road.cost * 0.25);
      if (this.s.infra[t] & 2) this.s.coins += Math.floor(INFRA.rail.cost * 0.25);
      this.s.infra[t] = 0;
      this.netVersion++;
      this.relostVehicles();
      return null;
    }
    return 'Nothing to clear here.';
  }

  // After network edits, re-route moving vehicles whose path is broken or who were lost.
  private relostVehicles() {
    for (const v of this.s.vehicles) {
      const mode = VEHICLES[v.type].mode;
      if (mode === 'air') continue;
      const bit = MODE_BIT[mode];
      if (v.state === 'lost') { v.timer = 0; continue; }
      if (v.state === 'move' && v.path.some((t) => !(this.s.infra[t] & bit))) {
        this.routeTo(v, this.vehicleTile(v));
      }
    }
  }

  gather(b: Building): string | null {
    const def = BUILDINGS[b.kind];
    if (def.type !== 'node') return null;
    const lvl = this.level(def.skill);
    const name = SKILLS.find((k) => k.id === def.skill)!.name;
    if (lvl < def.level) return `You need a ${name} level of ${def.level} to do that.`;
    const cur = b.stock[def.produces] ?? 0;
    b.stock[def.produces] = Math.min(def.cap, cur + 1);
    this.addXp(def.skill, def.xp);
    return null;
  }

  // Catch up on time away. Returns a summary.
  catchUp(seconds: number) {
    const coins0 = this.s.coins;
    const xp0 = { ...this.s.xp };
    this.quiet = true;
    const step = 1;
    for (let t = 0; t < seconds; t += step) this.tick(Math.min(step, seconds - t));
    this.quiet = false;
    const xpGain: Partial<Record<SkillId, number>> = {};
    for (const k of SKILLS) {
      const d = this.s.xp[k.id] - xp0[k.id];
      if (d > 0.5) xpGain[k.id] = d;
    }
    // Drop the per-tick xp/coin events; keep level-ups.
    this.events = this.events.filter((e) => e.t === 'level' || e.t === 'chat');
    return { coins: this.s.coins - coins0, xp: xpGain };
  }
}

export function chebyshevToRect(x: number, y: number, b: { x: number; y: number; w: number; h: number }) {
  const dx = x < b.x ? b.x - x : x >= b.x + b.w ? x - (b.x + b.w - 1) : 0;
  const dy = y < b.y ? b.y - y : y >= b.y + b.h ? y - (b.y + b.h - 1) : 0;
  return Math.max(dx, dy);
}

export function pathLength(w: number, path: number[], mode: Mode) {
  if (path.length < 2) return 0;
  if (mode !== 'air') return path.length - 1;
  const [a, b] = path;
  return Math.hypot((a % w) - (b % w), ((a / w) | 0) - ((b / w) | 0));
}

// Position of a vehicle in tile units (centre of tile = +0.5), plus heading in radians.
export function vehiclePos(w: number, v: Vehicle, mode: Mode, back = 0): { x: number; y: number; a: number } {
  const p = v.path;
  const tx = (t: number) => (t % w) + 0.5, ty = (t: number) => ((t / w) | 0) + 0.5;
  if (p.length < 2) return { x: tx(p[0]), y: ty(p[0]), a: 0 };
  if (mode === 'air') {
    const len = pathLength(w, p, mode) || 1;
    const f = Math.max(0, Math.min(1, v.dist / len));
    const x0 = tx(p[0]), y0 = ty(p[0]), x1 = tx(p[1]), y1 = ty(p[1]);
    return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: Math.atan2(y1 - y0, x1 - x0) };
  }
  const d = Math.max(0, Math.min(p.length - 1, v.dist - back));
  const i = Math.min(p.length - 2, Math.floor(d));
  const f = d - i;
  const x0 = tx(p[i]), y0 = ty(p[i]), x1 = tx(p[i + 1]), y1 = ty(p[i + 1]);
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a: Math.atan2(y1 - y0, x1 - x0) };
}
