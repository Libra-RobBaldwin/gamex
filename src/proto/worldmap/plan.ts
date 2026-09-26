// The world plan: the coarse level of a 50 km map (docs/streaming.md, "Two levels"). Made once at
// the start, in well under a second, from the region options (region/options.ts, with size 50):
//
//   const plan = planWorld({ seed: 7, size: 50 });
//   plan.settlements   // every place on the map: the start town at (0, 0), cities, towns, villages
//   plan.water         // the sea and its coast, rivers down to it, lakes (worldmap/water.ts, from landform.ts)
//   plan.roads         // the trunk network: motorways, A roads, B roads (routes.ts)
//   plan.rails         // main lines and branches, with the places they call at
//   plan.terrain       // the hills, as a function of x, z (terrain.ts, from landform.ts)
//
// Everything finer (streets, plots, buildings, fields, hedges, woods, trees, farms) is made a tile
// at a time as the camera nears it, from the plan and the tile alone (tilegen.ts), in a worker.
// The same options always make the same plan, on the main thread and in the worker alike.
//
// The map is centred on the start town: it's at (0, 0), where the game's live play area is (the
// Network, the traffic, the economy's zones), and floats stay fine there. Pure: no three.js.
import { KINDS, layStreets, reach, suggestLinks, type Kind, type Link, type Settlement } from '../region/generate';
import { placeName } from '../region/names';
import { mix, range, rng, type Rand } from '../region/random';
import { regionOptions, type RegionOptions } from '../region/options';
import type { XZ } from '../region/water';
import { WorldWater, waterFromLand } from './water';
import { coarseLand } from './landform';
import { planRoutes, type Rail, type Route } from './routes';
import { WorldTerrain } from './terrain';

export interface WorldSettlement extends Settlement {
  pop: number; // people living there at the start (the coarse economy's)
  reach: number; // how far its land reaches from its centre (built-up area and industrial edge)
}
export interface WorldPlan {
  seed: number;
  options: RegionOptions;
  size: number; // metres across
  half: number; // half of it: the map runs from −half to half each way
  water: WorldWater;
  settlements: WorldSettlement[];
  start: number; // the start town's id (at 0, 0)
  links: Link[]; // which places the A and B roads join
  roads: Route[];
  rails: Rail[];
  terrain: WorldTerrain;
  grid: SettlementGrid; // settlements by 2 km cell, for "what's near here"
  ms: number; // how long it took to make
}

// what's where, in 2 km cells: each cell lists the settlements whose land reaches into it
export class SettlementGrid {
  static C = 2000;
  private cells = new Map<number, WorldSettlement[]>();
  constructor(readonly all: WorldSettlement[], pad = 600) {
    const C = SettlementGrid.C;
    for (const s of all) {
      const R = s.reach + pad;
      for (let i = Math.floor((s.x - R) / C); i <= Math.floor((s.x + R) / C); i++) for (let j = Math.floor((s.z - R) / C); j <= Math.floor((s.z + R) / C); j++) {
        const k = key(i, j), l = this.cells.get(k);
        if (l) l.push(s); else this.cells.set(k, [s]);
      }
    }
  }
  // settlements whose land (plus the grid's pad) might reach this point
  near(x: number, z: number): readonly WorldSettlement[] { return this.cells.get(key(Math.floor(x / SettlementGrid.C), Math.floor(z / SettlementGrid.C))) ?? NONE; }
  // every settlement whose land (plus the pad) might reach a box
  inBox(b: { x0: number; z0: number; x1: number; z1: number }) {
    const C = SettlementGrid.C, out = new Set<WorldSettlement>();
    for (let i = Math.floor(b.x0 / C); i <= Math.floor(b.x1 / C); i++) for (let j = Math.floor(b.z0 / C); j <= Math.floor(b.z1 / C); j++) for (const s of this.cells.get(key(i, j)) ?? NONE) out.add(s);
    return [...out].sort((a, c) => a.id - c.id);
  }
  // the nearest settlement's centre (its own land first: any place whose reach covers the point)
  nearest(x: number, z: number): WorldSettlement {
    let best: WorldSettlement | null = null, bd = Infinity;
    for (const s of this.near(x, z)) { const d = Math.hypot(x - s.x, z - s.z); if (d < bd) { bd = d; best = s; } }
    if (best) return best;
    for (const s of this.all) { const d = Math.hypot(x - s.x, z - s.z); if (d < bd) { bd = d; best = s; } }
    return best!;
  }
}
const NONE: WorldSettlement[] = [];
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

// how many of each at 50 km when the seed decides (−1): about as many as a real 50 km square of
// lowland England, a place every few kilometres
const AUTO = { towns: [11, 15], villages: [130, 170], lakes: [4, 7] } as const;
// people at the start, by kind and size (the coarse economy grows them from here)
const popOf = (kind: Kind, r: number) => Math.round(kind === 'city' ? 60 * r : kind === 'town' ? 30 * r : 5 * r);
// the start town: a market town, the size the game's own town is
const START_R = 250;
// The live play area: the square round the start town where the game's Network, traffic and
// economy run (worldmap/live.ts). Places inside it are made live, the rest of the map is scenery;
// nothing straddles its edge. (A multiple of the far tiles' 4 km, so they tile round it.)
export const LIVE_HALF = 4000;

export function planWorld(opts: Partial<RegionOptions> = {}): WorldPlan {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const o = regionOptions({ ...opts, size: opts.size ?? 50 }), seed = o.seed;
  const half = (o.size * 1000) / 2;
  // the lie of the land (landform.ts: made in its own worker when it can be, and kept), and the water it leaves
  const land = coarseLand(o, half);
  const water = new WorldWater(waterFromLand(land, seed, o), land);
  const settlements = placeSettlements(rng(mix(seed, 203)), seed, half, water, o);
  const grid = new SettlementGrid(settlements);
  const terrain = new WorldTerrain({ seed, relief: o.relief, half, water, grid, land });
  // (exact gates for the places the roads meet: the ends of their high streets, from their own street layout)
  for (const s of settlements) layStreets(s, water, half);
  const links = suggestLinks(settlements, water).filter((l) => !crossesSea(water, settlements[l.a], settlements[l.b]));
  const { roads, rails } = planRoutes({ seed, half, settlements, links, water, grid, heightAt: terrain.heightAt });
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { seed, options: o, size: half * 2, half, water, settlements, start: 0, links, roads, rails, terrain, grid, ms };
}

function crossesSea(w: WorldWater, a: XZ, b: XZ) {
  if (!w.world.sea) return false;
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  for (let t = 0; t <= L; t += 100) if (w.seaDistance(a.x + ((b.x - a.x) * t) / L, a.z + ((b.z - a.z) * t) / L, 200) < 50) return true;
  return false;
}

// ---------------- settlements ----------------
// The start town at the middle; then the cities (7–18 km out), the market towns and the villages,
// each by Poisson-disc dart throwing: kept apart from the rest by both their reaches and a gap, off
// the water, and off the map's outer ring (where the edge and its portals are). Villages come in
// looser and thicker patches, as they do in real country.
function placeSettlements(r: Rand, seed: number, H: number, w: WorldWater, o: RegionOptions): WorldSettlement[] {
  const nTowns = o.towns === -1 ? AUTO.towns[0] + Math.floor(r() * (AUTO.towns[1] - AUTO.towns[0] + 1)) : o.towns;
  const nVillages = o.villages === -1 ? AUTO.villages[0] + Math.floor(r() * (AUTO.villages[1] - AUTO.villages[0] + 1)) : o.villages;
  const kinds: Kind[] = [...(o.city ? ['city' as const, 'city' as const] : []), ...Array<Kind>(nTowns).fill('town'), ...Array<Kind>(nVillages).fill('village')];
  const out: WorldSettlement[] = [];
  const names = rng(mix(seed, 204)); // (a stream of their own: renaming never moves a place)
  const everyName = new Set<string>();
  const firsts = new Map<string, string>(); // (each place's first element, as placeName picked it)
  const nameFor = (x: number, z: number, village: boolean) => {
    // (no two places within 9 km share their first element; nowhere shares a whole name)
    const taken = new Set<string>(everyName);
    for (const s of out) if (Math.hypot(s.x - x, s.z - z) < 9000) taken.add(firsts.get(s.name)!);
    const before = new Set(taken), nm = placeName(names, village, taken);
    for (const k of taken) if (!before.has(k) && k.startsWith('first:')) firsts.set(nm, k);
    everyName.add(nm.toLowerCase().replace(/[^a-z]/g, ''));
    return nm;
  };
  const cell = 3000, index = new Map<number, WorldSettlement[]>();
  const nearby = (x: number, z: number, R: number) => {
    const found: WorldSettlement[] = [];
    for (let i = Math.floor((x - R) / cell); i <= Math.floor((x + R) / cell); i++) for (let j = Math.floor((z - R) / cell); j <= Math.floor((z + R) / cell); j++) found.push(...(index.get(key(i, j)) ?? []));
    return found;
  };
  const add = (s: WorldSettlement) => { out.push(s); const k = key(Math.floor(s.x / cell), Math.floor(s.z / cell)); const l = index.get(k); if (l) l.push(s); else index.set(k, [s]); };
  const gapFor = (a: Kind, b: Kind) => (a === 'village' || b === 'village' ? (a === b ? 1100 : 1500) : a === 'city' && b === 'city' ? 9000 : a === 'city' || b === 'city' ? 4200 : 3400);
  const make = (kind: Kind, x: number, z: number, radius: number, n: number): WorldSettlement => {
    const K = KINDS[kind], axis = range(r, 0, Math.PI), plan = r() < K.grid ? 'grid' : 'organic';
    return { id: out.length, name: nameFor(x, z, kind === 'village'), kind, x: Math.round(x), z: Math.round(z), r: radius, axis, plan, seed: mix(seed, 1000 + n), gates: [], pop: popOf(kind, radius), reach: reach(kind, radius) };
  };
  // the start town, right in the middle
  add(make('town', 0, 0, START_R, 0));
  const edge = Math.min(1600, H * 0.12);
  kinds.forEach((kind, n) => {
    const K = KINDS[kind];
    const radius = Math.round(kind === 'city' && n === 1 ? range(r, 380, 420) : range(r, K.r[0], K.r[1]));
    const R = reach(kind, radius);
    let slack = 1;
    for (let tries = 0; ; tries++) {
      if (tries > 0 && tries % 200 === 0) slack *= 0.9;
      if (tries > 2500) return; // (no room left: a crowded map gets fewer)
      const lim = H - R - edge;
      let x: number, z: number;
      if (kind === 'city') { const d = range(r, 7000, Math.min(18000, lim)), a = range(r, 0, 6.2832); x = d * Math.cos(a); z = d * Math.sin(a); }
      else { x = range(r, -lim, lim); z = range(r, -lim, lim); }
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      // (villages thin out and thicken in patches a few kilometres across)
      if (kind === 'village' && r() > 0.35 + 0.65 * patch(x, z, seed)) continue;
      if (w.edgeDistance({ x, z }, R + 200) < R + 90) continue;
      // (a place is wholly in the live play area or wholly out of it)
      if (Math.max(Math.abs(x), Math.abs(z)) > LIVE_HALF - R - 150 && Math.max(Math.abs(x), Math.abs(z)) < LIVE_HALF + R + 150) continue;
      const clash = nearby(x, z, R + 12000).some((s) => Math.hypot(s.x - x, s.z - z) < (s.reach + R + gapFor(s.kind, kind)) * slack);
      if (clash) continue;
      add(make(kind, x, z, radius, n + 1));
      return;
    }
  });
  return out;
}
// slow patchy noise (0–1) for where villages cluster
function patch(x: number, z: number, seed: number) {
  const s = mix(seed, 205) % 1000;
  return 0.5 + 0.25 * Math.sin(x / 3100 + s) * Math.cos(z / 2700 - s * 0.7) + 0.25 * Math.sin((x + z) / 5300 + s * 1.3);
}

// The world plan's settlements as the region's MapSpec takes them (region/mapspec.ts)
export const settlementInfo = (s: WorldSettlement) => ({ id: s.id, name: s.name, kind: s.kind, x: s.x, z: s.z, r: s.r, gates: s.gates });
