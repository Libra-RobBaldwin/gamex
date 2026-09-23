// Challenge system: a board of scenarios to choose from, one active at a time, on a shared map.
import { CHAINS, INDUSTRIES, STATIONS, VEHICLES, type CargoId, type Mode, type Tech, type VehicleGroup } from './defs';
import { layerOf } from './sim';
import type { Delivery, Game, ScenarioState, Station } from './sim';
import type { Town } from './world';

export interface Objective { label: string; value: number; target: number }

type P = Record<string, number>;

export interface ScenarioDef {
  id: string;
  kind: 'story' | 'dynamic' | 'disaster';
  icon: string;
  repeatable?: boolean;
  unlocks: Tech[];
  timed?: number;
  pick(g: Game): P | null;
  title(g: Game, p: P): string;
  brief(g: Game, p: P): string;
  grant(g: Game, p: P): number;
  reward(g: Game, p: P): number;
  onAccept?(g: Game, p: P): string | void;
  objectives(g: Game, st: ScenarioState): Objective[];
  onDeliver?(g: Game, st: ScenarioState, d: Delivery): void;
  onTick?(g: Game, st: ScenarioState, dt: number): void;
}

// ---------- helpers ----------
const realTowns = (g: Game) => g.s.towns.filter((t) => t.parent === undefined);
const town = (g: Game, id: number) => g.s.towns[id];
const tdist = (a: Town, b: Town) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
const covers = (g: Game, st: Station, t: number) => g.catchment(st).towns.has(t);
const coversInd = (g: Game, st: Station, id: number) => g.catchment(st).industries.some((i) => i.id === id);
const ind = (g: Game, id: number) => g.s.industries.find((i) => i.id === id);
const done = (g: Game, id: string) => g.s.completed.includes(id);
const bump = (st: ScenarioState, k: string, n: number) => { st.counters[k] = (st.counters[k] ?? 0) + n; };

function between(g: Game, d: Delivery, a: number, b: number) {
  return (covers(g, d.from, a) && covers(g, d.to, b)) || (covers(g, d.from, b) && covers(g, d.to, a));
}

function hasLine(g: Game, modes: Mode[], a: (s: Station) => boolean, b: (s: Station) => boolean, groups?: VehicleGroup[]) {
  return g.s.vehicles.some((v) => {
    const def = VEHICLES[v.type];
    if (!modes.includes(def.mode) || (groups && !groups.includes(def.group))) return false;
    const sts = v.stops.map((id) => g.station(id)).filter((x): x is Station => !!x);
    return sts.some((x, i) => a(x) && sts.some((y, j) => j !== i && b(y)));
  });
}

function pairBy(g: Game, minD: number, score: (a: Town, b: Town) => number, exclude?: (a: Town, b: Town) => boolean) {
  const ts = realTowns(g);
  let best: [Town, Town] | null = null, bs = -Infinity;
  for (let i = 0; i < ts.length; i++)
    for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j];
      if (tdist(a, b) < minD || exclude?.(a, b)) continue;
      const s = score(a, b);
      if (s > bs) { bs = s; best = [a, b]; }
    }
  return best;
}

function chainPair(g: Game, minD: number, maxD: number, prefer?: string) {
  let best: { src: number; dst: number } | null = null, bs = Infinity;
  for (const [pk, ck] of CHAINS) {
    for (const p of g.s.industries.filter((i) => i.kind === pk))
      for (const c of g.s.industries.filter((i) => i.kind === ck)) {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < minD || d > maxD) continue;
        const s = d + (prefer && pk !== prefer ? 100 : 0);
        if (s < bs) { bs = s; best = { src: p.id, dst: c.id }; }
      }
  }
  return best;
}

const deliverObj = (st: ScenarioState, key: string, label: string, target: number): Objective =>
  ({ label, value: Math.min(target, Math.floor(st.counters[key] ?? 0)), target });
const flag = (label: string, ok: boolean): Objective => ({ label, value: ok ? 1 : 0, target: 1 });

function motorwayShare(g: Game, a: Town, b: Town): number {
  const nearRoad = (t: Town) => {
    for (let r = 0; r <= 3; r++)
      for (let y = t.cy - r; y <= t.cy + r; y++)
        for (let x = t.cx - r; x <= t.cx + r; x++)
          if (g.inBounds(x, y) && g.road.any(g.idx(x, y))) return g.idx(x, y);
    return -1;
  };
  const na = nearRoad(a), nb = nearRoad(b);
  if (na < 0 || nb < 0) return 0;
  const path = g.findPath('road', na, nb);
  if (!path || path.length < 2) return 0;
  let mw = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    for (let d = 0; d < 8; d++) if (g.road.neighbour(path[i], d) === path[i + 1] && g.road.get(path[i], d) === 2) { mw++; break; }
  }
  return mw / (path.length - 1);
}

const cargoOf = (g: Game, indId: number): CargoId => INDUSTRIES[ind(g, indId)!.kind].produces ?? 'goods';

// ---------- catalogue ----------
export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'twin_towns', kind: 'story', icon: '🚌', unlocks: [],
    pick: (g) => { const p = pairBy(g, 0, (a, b) => -tdist(a, b)); return p && { a: p[0].id, b: p[1].id }; },
    title: (g, p) => `Twin Towns: ${town(g, p.a).name} ⇄ ${town(g, p.b).name}`,
    brief: (g, p) => `The councils of ${town(g, p.a).name} and ${town(g, p.b).name} want a bus link. Build a road between them, place a road station in each town and run buses.`,
    grant: () => 20000, reward: () => 35000,
    objectives: (g, st) => [
      flag('Bus line between the towns', hasLine(g, ['road'], (s) => covers(g, s, st.params.a), (s) => covers(g, s, st.params.b), ['bus', 'coach'])),
      deliverObj(st, 'pax', 'Passengers carried between them', 150),
    ],
    onDeliver: (g, st, d) => { if (d.cargo === 'pax' && between(g, d, st.params.a, st.params.b)) bump(st, 'pax', d.amount); },
  },
  {
    id: 'coal_run', kind: 'story', icon: '⛏️', unlocks: [],
    pick: (g) => chainPair(g, 4, 30, 'coal_mine'),
    title: (g, p) => `Freight Run: ${ind(g, p.src)!.name}`,
    brief: (g, p) => `${ind(g, p.src)!.name} has output piling up. Link it by road to ${ind(g, p.dst)!.name} and run lorries.`,
    grant: () => 25000, reward: () => 40000,
    objectives: (g, st) => [deliverObj(st, 'c', `${CARGOname(g, st.params.src)} delivered to ${ind(g, st.params.dst)!.name}`, 200)],
    onDeliver: (g, st, d) => { if (coversInd(g, d.from, st.params.src) && coversInd(g, d.to, st.params.dst) && d.cargo === cargoOf(g, st.params.src)) bump(st, 'c', d.amount); },
  },
  {
    id: 'supply_chain', kind: 'story', icon: '🏭', unlocks: [],
    pick: (g) => {
      if (g.s.completed.length < 1) return null;
      const used = new Set(Object.values(g.s.scenario?.params ?? {}));
      let best: P | null = null, bd = Infinity;
      for (const [pk, ck] of CHAINS.slice(1)) {
        for (const p of g.s.industries.filter((i) => i.kind === pk))
          for (const c of g.s.industries.filter((i) => i.kind === ck)) {
            const d = Math.hypot(p.x - c.x, p.y - c.y);
            if (d < bd && !used.has(p.id)) { bd = d; best = { src: p.id, dst: c.id }; }
          }
      }
      return best;
    },
    title: (g, p) => `Supply Chain: ${ind(g, p.dst)!.name}`,
    brief: (g, p) => `Feed ${ind(g, p.dst)!.name} with ${CARGOname(g, p.src).toLowerCase()} from ${ind(g, p.src)!.name}, then take the goods it makes to a town.`,
    grant: () => 30000, reward: () => 60000,
    objectives: (g, st) => [
      deliverObj(st, 'raw', `${CARGOname(g, st.params.src)} to the processor`, 150),
      deliverObj(st, 'goods', 'Goods delivered to a town', 100),
    ],
    onDeliver: (g, st, d) => {
      if (coversInd(g, d.to, st.params.dst) && d.cargo === cargoOf(g, st.params.src)) bump(st, 'raw', d.amount);
      if (d.cargo === 'goods' && coversInd(g, d.from, st.params.dst) && !d.transfer) bump(st, 'goods', d.amount);
    },
  },
  {
    id: 'iron_road', kind: 'story', icon: '🚆', unlocks: ['rail', 'train'],
    pick: (g) => {
      if (!done(g, 'twin_towns')) return null;
      const p = pairBy(g, 13, (a, b) => g.pop(a) * g.pop(b) - tdist(a, b) * 1000);
      return p && { a: p[0].id, b: p[1].id };
    },
    title: (g, p) => `The Iron Road: ${town(g, p.a).name} – ${town(g, p.b).name}`,
    brief: (g, p) => `Time for rail. Lay track between ${town(g, p.a).name} and ${town(g, p.b).name} (it can only turn 45° per tile, so plan your curves), add stations and run a commuter train.`,
    grant: () => 120000, reward: () => 150000,
    objectives: (g, st) => [
      flag('Train line between the towns', hasLine(g, ['rail'], (s) => covers(g, s, st.params.a), (s) => covers(g, s, st.params.b))),
      deliverObj(st, 'pax', 'Rail passengers between them', 400),
    ],
    onDeliver: (g, st, d) => { if (d.cargo === 'pax' && VEHICLES[d.vehicle.type].mode === 'rail' && between(g, d, st.params.a, st.params.b)) bump(st, 'pax', d.amount); },
  },
  {
    id: 'heavy_haul', kind: 'story', icon: '🚂', unlocks: ['freight'],
    pick: (g) => (g.has('rail') ? chainPair(g, 10, 60) : null),
    title: (g, p) => `Heavy Haul: ${ind(g, p.src)!.name}`,
    brief: (g, p) => `Lorries can't keep up. Build a freight railway from ${ind(g, p.src)!.name} to ${ind(g, p.dst)!.name}.`,
    grant: () => 110000, reward: () => 140000,
    objectives: (g, st) => [deliverObj(st, 'c', `${CARGOname(g, st.params.src)} by freight train`, 600)],
    onDeliver: (g, st, d) => {
      if (d.vehicle.type === 'freight' && coversInd(g, d.from, st.params.src) && coversInd(g, d.to, st.params.dst)) bump(st, 'c', d.amount);
    },
  },
  {
    id: 'suburb', kind: 'story', icon: '🏘️', repeatable: true, unlocks: [],
    pick: (g) => {
      if (!done(g, 'twin_towns')) return null;
      const c = realTowns(g).filter((t) => g.pop(t) >= 700 && !g.s.towns.some((s) => s.parent === t.id));
      if (!c.length) return null;
      const t = c.sort((a, b) => g.pop(b) - g.pop(a))[0];
      return { parent: t.id };
    },
    title: (g, p) => `New Suburb: ${town(g, p.parent).name} Heights`,
    brief: (g, p) => `Developers are building a new estate outside ${town(g, p.parent).name}, with no roads yet. Give it streets and junctions, and run a bus into town.`,
    grant: () => 40000, reward: () => 60000,
    onAccept: (g, p) => {
      const sub = g.spawnSuburb(town(g, p.parent));
      if (!sub) return 'No room for a suburb right now.';
      p.sub = sub.id;
    },
    objectives: (g, st) => [
      flag('Bus line from the suburb into town', hasLine(g, ['road'], (s) => covers(g, s, st.params.sub), (s) => covers(g, s, st.params.parent))),
      deliverObj(st, 'pax', 'Commuters carried', 250),
    ],
    onDeliver: (g, st, d) => { if (d.cargo === 'pax' && between(g, d, st.params.sub, st.params.parent)) bump(st, 'pax', d.amount); },
  },
  {
    id: 'motorway', kind: 'story', icon: '🛣️', unlocks: ['motorway', 'coach'],
    pick: (g) => {
      if (!done(g, 'iron_road')) return null;
      const p = pairBy(g, 12, (a, b) => g.pop(a) + g.pop(b));
      return p && { a: p[0].id, b: p[1].id };
    },
    title: (g, p) => `Motorway Age: ${town(g, p.a).name} – ${town(g, p.b).name}`,
    brief: (g, p) => `Build a motorway (at least 60% of the road route) between ${town(g, p.a).name} and ${town(g, p.b).name}, then run coaches or HGVs down it.`,
    grant: () => 250000, reward: () => 250000,
    objectives: (g, st) => {
      const share = motorwayShare(g, town(g, st.params.a), town(g, st.params.b));
      return [
        { label: 'Route on motorway', value: Math.min(60, Math.round(share * 100)), target: 60 },
        deliverObj(st, 'x', 'Road passengers or goods between them', 300),
      ];
    },
    onDeliver: (g, st, d) => { if (VEHICLES[d.vehicle.type].mode === 'road' && between(g, d, st.params.a, st.params.b)) bump(st, 'x', d.amount); },
  },
  {
    id: 'metro', kind: 'story', icon: 'Ⓜ️', unlocks: ['metro'],
    pick: (g) => {
      const t = realTowns(g).sort((a, b) => g.pop(b) - g.pop(a))[0];
      if (!t || (g.pop(t) < 1400 && g.s.completed.length < 3)) return null;
      return { t: t.id };
    },
    title: (g, p) => `Going Underground: ${town(g, p.t).name} Metro`,
    brief: (g, p) => `${town(g, p.t).name}'s streets are gridlocked. Dig metro tunnels (they go under buildings), open three metro stations and run a metro train.`,
    grant: () => 350000, reward: () => 300000,
    objectives: (g, st) => [
      { label: 'Metro stations in town', value: Math.min(3, g.s.stations.filter((s) => s.kind === 'metro' && covers(g, s, st.params.t)).length), target: 3 },
      deliverObj(st, 'pax', 'Metro passengers', 600),
    ],
    onDeliver: (g, st, d) => { if (d.cargo === 'pax' && d.vehicle.type === 'metro' && (covers(g, d.from, st.params.t) || covers(g, d.to, st.params.t))) bump(st, 'pax', d.amount); },
  },
  {
    id: 'airport', kind: 'story', icon: '✈️', unlocks: ['airport', 'plane'],
    pick: (g) => {
      if (g.s.completed.length < 4) return null;
      const p = pairBy(g, 18, (a, b) => g.pop(a) + g.pop(b));
      return p && { a: p[0].id, b: p[1].id };
    },
    title: (g, p) => `Wings: ${town(g, p.a).name} International`,
    brief: (g, p) => `Open an airport for ${town(g, p.a).name} and one for ${town(g, p.b).name} (each needs a clear 3×3 site within 10 tiles of town), then start flights.`,
    grant: () => 700000, reward: () => 500000,
    objectives: (g, st) => {
      const near = (t: Town) => g.s.stations.some((s) => s.kind === 'airport' && Math.hypot(s.x - t.cx, s.y - t.cy) <= 10);
      const a = town(g, st.params.a), b = town(g, st.params.b);
      return [flag(`Airport near ${a.name}`, near(a)), flag(`Airport near ${b.name}`, near(b)), deliverObj(st, 'pax', 'Air passengers', 500)];
    },
    onDeliver: (_g, st, d) => { if (d.cargo === 'pax' && d.vehicle.type === 'plane') bump(st, 'pax', d.amount); },
  },
  {
    id: 'airport_link', kind: 'story', icon: '🛫', unlocks: [],
    pick: (g) => {
      const ap = g.s.stations.find((s) => s.kind === 'airport');
      if (!ap || !g.has('rail')) return null;
      const t = realTowns(g).reduce((b, t) => (Math.hypot(t.cx - ap.x, t.cy - ap.y) < Math.hypot(b.cx - ap.x, b.cy - ap.y) ? t : b));
      return { ap: ap.id, t: t.id };
    },
    title: (g, p) => `Airport Express: ${g.station(p.ap)?.name ?? 'Airport'}`,
    brief: (g, p) => `Travellers want a fast link into ${town(g, p.t).name}. Put a rail or metro station within 5 tiles of the airport and run trains to the town. Passengers will change onto the flights.`,
    grant: () => 150000, reward: () => 200000,
    objectives: (g, st) => {
      const ap = g.station(st.params.ap);
      const nearAp = (s: Station) => !!ap && Math.hypot(s.x - ap.x, s.y - ap.y) <= 5;
      return [
        flag('Rail/metro line airport ⇄ town', hasLine(g, ['rail', 'metro'], nearAp, (s) => covers(g, s, st.params.t))),
        deliverObj(st, 'pax', 'Passengers on the airport link', 400),
      ];
    },
    onDeliver: (g, st, d) => {
      const ap = g.station(st.params.ap);
      if (!ap || d.cargo !== 'pax' || !['rail', 'metro'].includes(VEHICLES[d.vehicle.type].mode)) return;
      const near = (s: Station) => Math.hypot(s.x - ap.x, s.y - ap.y) <= 5;
      if (near(d.from) || near(d.to)) bump(st, 'pax', d.amount);
    },
  },
  {
    id: 'intercity', kind: 'story', icon: '🚄', unlocks: ['intercity'],
    pick: (g) => {
      if (!g.has('rail') || !(done(g, 'motorway') || done(g, 'metro'))) return null;
      const p = pairBy(g, 22, (a, b) => tdist(a, b) + (g.pop(a) + g.pop(b)) / 500);
      return p && { a: p[0].id, b: p[1].id };
    },
    title: (g, p) => `Intercity: ${town(g, p.a).name} – ${town(g, p.b).name}`,
    brief: (g, p) => `Link the far ends of the map with a fast intercity service between ${town(g, p.a).name} and ${town(g, p.b).name}.`,
    grant: () => 400000, reward: () => 400000,
    objectives: (_g, st) => [deliverObj(st, 'pax', 'Intercity passengers', 800)],
    onDeliver: (g, st, d) => { if (d.cargo === 'pax' && d.vehicle.type === 'intercity' && between(g, d, st.params.a, st.params.b)) bump(st, 'pax', d.amount); },
  },
  // ---------- dynamic ----------
  {
    id: 'overcrowded', kind: 'dynamic', icon: '😤', repeatable: true, unlocks: [],
    pick: (g) => {
      const st = g.s.stations.find((s) => (s.waiting.pax ?? 0) >= STATIONS[s.kind].cap * 0.85);
      return st ? { st: st.id } : null;
    },
    title: (g, p) => `Overcrowding at ${g.station(p.st)?.name}`,
    brief: (g, p) => `Crowds are spilling out of ${g.station(p.st)?.name}. Add vehicles or new lines to bring waiting passengers below 25% of capacity for one minute.`,
    grant: () => 0, reward: () => 45000,
    objectives: (_g, st) => [{ label: 'Seconds under control', value: Math.min(60, Math.floor(st.counters.ok ?? 0)), target: 60 }],
    onTick: (g, st, dt) => {
      const s = g.station(st.params.st);
      if (!s) { st.counters.ok = 60; return; }
      if ((s.waiting.pax ?? 0) < STATIONS[s.kind].cap * 0.25) bump(st, 'ok', dt); else st.counters.ok = 0;
    },
  },
  {
    id: 'boom', kind: 'dynamic', icon: '📈', repeatable: true, unlocks: [],
    pick: (g) => {
      if (g.s.completed.length < 2) return null;
      const chain = CHAINS[Math.floor(((g.s.time / 60) | 0) % CHAINS.length)];
      return { chain: CHAINS.indexOf(chain) };
    },
    title: (_g, p) => `Industrial Boom: new ${INDUSTRIES[CHAINS[p.chain][0]].name}`,
    brief: (_g, p) => `Investors are opening a new ${INDUSTRIES[CHAINS[p.chain][0]].name.toLowerCase()}. Be first to serve it and get its output to a ${INDUSTRIES[CHAINS[p.chain][1]].name.toLowerCase()}.`,
    grant: () => 20000, reward: () => 70000,
    onAccept: (g, p) => {
      const i = g.spawnIndustry(CHAINS[p.chain][0]);
      if (!i) return 'No room for a new industry.';
      p.src = i.id;
      g.news(`${i.name} opens for business!`, i.x, i.y);
    },
    objectives: (g, st) => [deliverObj(st, 'c', `${CARGOname(g, st.params.src)} delivered`, 300)],
    onDeliver: (g, st, d) => { if (coversInd(g, d.from, st.params.src) && !d.transfer) bump(st, 'c', d.amount); },
  },
  {
    id: 'disaster', kind: 'disaster', icon: '⛈️', repeatable: true, unlocks: [], timed: 300,
    pick: (g) => {
      if (g.s.completed.length < 2) return null;
      const cands = g.s.vehicles.filter((v) => ['road', 'rail'].includes(VEHICLES[v.type].mode) && v.trips >= 2);
      if (!cands.length) return null;
      const v = cands.sort((a, b) => b.trips * VEHICLES[b.type].capacity - a.trips * VEHICLES[a.type].capacity)[0];
      return { v: v.id, kind: Math.floor(g.s.time) % 3 };
    },
    title: (_g, p) => `${['Storm Damage', 'Flash Flood', 'Landslip'][p.kind]}!`,
    brief: (g, p) => {
      const v = g.s.vehicles.find((x) => x.id === p.v);
      const a = v && g.station(v.stops[0]), b = v && g.station(v.stops[1]);
      return `The Met Office warns of severe weather over the ${a?.name ?? ''} – ${b?.name ?? ''} line. If you accept, part of the route will be wrecked. Restore it within 5 minutes.`;
    },
    grant: () => 30000, reward: () => 90000,
    onAccept: (g, p) => {
      const v = g.s.vehicles.find((x) => x.id === p.v);
      if (!v) return 'That line no longer exists.';
      const a = g.station(v.stops[0])!, b = g.station(v.stops[1])!;
      const layer = layerOf(VEHICLES[v.type].mode)!;
      const path = g.findPath(layer, g.idx(a.x, a.y), g.idx(b.x, b.y));
      if (!path || path.length < 6) return 'That line is too short to wreck.';
      const mid = Math.floor(path.length / 2);
      const n = Math.min(4, path.length - 4);
      g.wreck(path.slice(mid - Math.floor(n / 2), mid - Math.floor(n / 2) + n));
      p.trips0 = v.trips;
    },
    objectives: (g, st) => {
      const v = g.s.vehicles.find((x) => x.id === st.params.v);
      const trips = v ? v.trips - st.params.trips0 : 0;
      return [
        flag('Line reconnected', !!v && v.state !== 'lost' && trips > 0),
        { label: 'Trips completed since the damage', value: Math.min(4, Math.max(0, trips)), target: 4 },
      ];
    },
  },
];

function CARGOname(g: Game, indId: number) {
  const i = ind(g, indId);
  if (!i) return 'Cargo';
  const c = INDUSTRIES[i.kind].produces;
  return c ? { coal: 'Coal', wood: 'Timber', grain: 'Grain', goods: 'Goods', pax: 'Passengers' }[c] : 'Cargo';
}

export const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;

export interface Offer { def: ScenarioDef; params: P }

export class Scenarios {
  g: Game;
  offers: Offer[] = [];
  private acc = 0;
  onComplete: ((def: ScenarioDef, reward: number) => void) | null = null;
  onFail: ((def: ScenarioDef) => void) | null = null;

  constructor(g: Game) {
    this.g = g;
    g.onDeliver = (d) => {
      const st = g.s.scenario;
      if (st) byId(st.id).onDeliver?.(g, st, d);
    };
    this.refreshBoard();
  }

  get active() { return this.g.s.scenario ? byId(this.g.s.scenario.id) : null; }

  objectives(): Objective[] {
    const st = this.g.s.scenario;
    return st ? byId(st.id).objectives(this.g, st) : [];
  }

  refreshBoard() {
    const g = this.g;
    const story: Offer[] = [], dyn: Offer[] = [];
    for (const def of SCENARIOS) {
      if (!def.repeatable && g.s.completed.includes(def.id)) continue;
      const p = def.pick(g);
      if (!p) continue;
      (def.kind === 'story' ? story : dyn).push({ def, params: p });
    }
    this.offers = [...story.slice(0, 2), ...dyn.slice(0, 1)];
    if (!this.offers.length && story.length) this.offers = story.slice(0, 3);
  }

  accept(o: Offer): string | null {
    const g = this.g;
    const params = { ...o.params };
    for (const t of o.def.unlocks) if (!g.s.tech.includes(t)) g.s.tech.push(t);
    const err = o.def.onAccept?.(g, params);
    if (err) return err;
    g.s.money += o.def.grant(g, params);
    g.s.scenario = {
      id: o.def.id, params, started: g.s.time, counters: {},
      deadline: o.def.timed ? g.s.time + o.def.timed : undefined,
    };
    return null;
  }

  abandon() {
    this.g.s.scenario = null;
    this.refreshBoard();
  }

  update(dt: number) {
    const g = this.g, st = g.s.scenario;
    if (!st) return;
    const def = byId(st.id);
    def.onTick?.(g, st, dt);
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    const objs = def.objectives(g, st);
    if (objs.every((o) => o.value >= o.target)) {
      const reward = def.reward(g, st.params);
      g.s.money += reward;
      if (!g.s.completed.includes(def.id) || def.repeatable) g.s.completed.push(def.id);
      g.s.scenario = null;
      this.refreshBoard();
      this.onComplete?.(def, reward);
    } else if (st.deadline !== undefined && g.s.time > st.deadline) {
      g.s.scenario = null;
      this.refreshBoard();
      this.onFail?.(def);
    }
  }
}
