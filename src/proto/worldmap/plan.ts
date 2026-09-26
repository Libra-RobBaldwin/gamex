// The world plan: the coarse level of a 50 km map (docs/streaming.md, "Two levels"). Made once at
// the start, in well under a second, from the region options (region/options.ts, with size 50):
//
//   const plan = planWorld({ seed: 7, size: 50 });
//   plan.settlements   // every place on the map: the start town at (0, 0), cities, towns, villages
//   plan.water         // the sea beyond the coast, rivers down to it, lakes (worldmap/water.ts)
//   plan.roads         // the trunk network: motorways, A roads, B roads (routes.ts)
//   plan.rails         // main lines and branches, with the places they call at
//   plan.terrain       // the hills, as a function of x, z (terrain.ts)
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
import type { LakeSpec, XZ } from '../region/water';
import { WorldWater, type Sea, type WorldRiver, type WorldWaterSpec } from './water';
import { planRoutes, type Rail, type Route } from './routes';
import { WorldTerrain } from './terrain';
import { realOf, realSource, type Box, type WorldHeights, type WorldSource } from './source';

export interface WorldSettlement extends Settlement {
  pop: number; // people living there at the start (the coarse economy's)
  reach: number; // how far its land reaches from its centre (built-up area and industrial edge)
}
export interface WorldPlan {
  source: WorldSource['kind']; // where it came from (worldmap/source.ts): nothing downstream should need it
  id: string; // the source's id: 'seed:<n>' or a real region's
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
  terrain: WorldHeights;
  woods?: (box: Box) => XZ[][]; // the woods, where the source knows them (a real region's)
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
  const plan = planFrom(seededSource(opts));
  if (t0) plan.ms = performance.now() - t0;
  return plan;
}

// The plan for a map's options, from whichever source they name: a real region's (loaded, from its
// bake) or a seeded one. The same options always make the same plan, on any thread.
export async function loadPlan(opts: Partial<RegionOptions> = {}): Promise<WorldPlan> {
  const o = regionOptions({ ...opts, size: opts.size ?? 50 }), id = realOf({ ...o, ...opts } as RegionOptions);
  if (!id) return planWorld(opts);
  const load = realSource();
  if (!load) throw new Error(`no real source is loaded for the region ${id} (import real/world.ts)`);
  return planFrom(await load(id, o));
}

// A map made up from the region options: its water, then its places, then its hills round them.
export function seededSource(opts: Partial<RegionOptions> = {}): WorldSource {
  const o = regionOptions({ ...opts, size: opts.size ?? 50 }), seed = o.seed;
  const half = (o.size * 1000) / 2;
  const water = new WorldWater(makeWater(rng(mix(seed, 202)), half, o));
  const settlements = placeSettlements(rng(mix(seed, 203)), seed, half, water, o);
  return { kind: 'seeded', id: `seed:${seed}`, seed, options: o, half, water, settlements, heights: (grid) => new WorldTerrain({ seed, relief: o.relief, half, water, grid }) };
}

// The world plan from either source (worldmap/source.ts): the places' streets (for where roads
// meet them), and the roads the map starts with, the source's or the plan's own lanes.
export function planFrom(src: WorldSource): WorldPlan {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const { seed, half, water, settlements } = src;
  const grid = new SettlementGrid(settlements);
  const terrain = src.heights(grid);
  // (exact gates for the places the roads meet: the ends of their high streets, from their own street layout)
  for (const s of settlements) if (!s.gates.length) layStreets(s, water, half);
  let routes = src.routes?.(grid, terrain);
  if (!routes) {
    const links = suggestLinks(settlements, water).filter((l) => !crossesSea(water, settlements[l.a], settlements[l.b]));
    routes = { links, ...planRoutes({ seed, half, settlements, links, water, grid, heightAt: terrain.heightAt }) };
  }
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { source: src.kind, id: src.id, seed, options: src.options, size: half * 2, half, water, settlements, start: 0, links: routes.links, roads: routes.roads, rails: routes.rails, terrain, woods: src.woods, grid, ms };
}

function crossesSea(w: WorldWater, a: XZ, b: XZ) {
  if (!w.world.sea) return false;
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  for (let t = 0; t <= L; t += 100) if (w.seaDistance(a.x + ((b.x - a.x) * t) / L, a.z + ((b.z - a.z) * t) / L, 200) < 50) return true;
  return false;
}

// ---------------- water ----------------
// The sea beyond a coast along one edge (7–13 km in, with bays and headlands); rivers from the far
// edge (or a side) down to the sea, widening as they go, or right across the map with no sea;
// lakes. None comes near the middle, where the start town stands.
const SIDES = ['n', 'e', 's', 'w'] as const;
function makeWater(r: Rand, H: number, o: RegionOptions): WorldWaterSpec {
  const small = H < 5000; // (a small map: no sea, no inland lakes' margins)
  let sea: Sea | null = null;
  const side = SIDES[Math.floor(r() * 4)];
  // a point on the map from (t along the coast's edge, c: distance in from that edge)
  const at = (s: Sea['side'], t: number, c: number): XZ => (s === 's' ? { x: t, z: H - c } : s === 'n' ? { x: t, z: -H + c } : s === 'e' ? { x: H - c, z: t } : { x: -H + c, z: t });
  if (o.sea && !small) {
    const d0 = range(r, 0.14, 0.26) * H * 2, a1 = range(r, 900, 1800), w1 = range(r, 9000, 16000), p1 = range(r, 0, 6.28);
    const a2 = range(r, 250, 600), w2 = range(r, 2500, 4500), p2 = range(r, 0, 6.28), a3 = range(r, 60, 160), w3 = range(r, 600, 1100), p3 = range(r, 0, 6.28);
    const coast: XZ[] = [];
    for (let t = -H * 1.1; t <= H * 1.1 + 1e-6; t += 50) {
      const c = d0 + a1 * Math.sin((t / w1) * 6.2832 + p1) + a2 * Math.sin((t / w2) * 6.2832 + p2) + a3 * Math.sin((t / w3) * 6.2832 + p3);
      coast.push(at(side, t, c));
    }
    sea = { coast, side };
  }
  const probe = new WorldWater({ sea, rivers: [], lakes: [] });
  // rivers: from the edge opposite the sea (or a side edge) to the coast, a little past it
  const rivers: WorldRiver[] = [];
  const n = small ? o.rivers : Math.max(0, o.rivers);
  const opposite = { n: 's', s: 'n', e: 'w', w: 'e' } as const;
  for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
    const from = sea ? opposite[sea.side] : side;
    // (each river in its own band across the map, so they don't cross)
    const band = (2 * H * 0.8) / n, base = -H * 0.8 + band * (k + 0.5) + range(r, -0.2, 0.2) * band;
    const a1 = range(r, 700, 1600), w1 = range(r, 7000, 12000), p1 = range(r, 0, 6.28), a2 = range(r, 150, 380), w2 = range(r, 1500, 2600), p2 = range(r, 0, 6.28);
    const drift = range(r, -0.15, 0.15);
    const path: XZ[] = [], widths: number[] = [];
    const end = sea ? 2 * H : 2.1 * H; // (to past the coast, or right across)
    for (let c = -0.05 * H; c <= end + 1e-6; c += 25) {
      const t = base + drift * c + a1 * Math.sin((c / w1) * 6.2832 + p1) + a2 * Math.sin((c / w2) * 6.2832 + p2);
      const p = at(from, t, c);
      path.push(p);
      if (sea && probe.seaDistance(p.x, p.z, 400) < -300) break;
    }
    // (it widens down the valley: a brook's width where it rises, a broad river at the mouth)
    const w0 = range(r, 14, 20), w9 = range(r, 38, 60);
    for (let i = 0; i < path.length; i++) widths.push(Math.round(w0 + (w9 - w0) * (i / (path.length - 1)) ** 0.8));
    // (keep well clear of the middle, where the start town is)
    if (path.some((p) => Math.hypot(p.x, p.z) < 1800 + widths[0])) continue;
    rivers.push({ path, widths });
    k++;
  }
  const withRivers = new WorldWater({ sea, rivers, lakes: [] });
  // Lakes: never circles. Each is a chain of overlapping bowls of different sizes along a wandering
  // line (the water is where any of them is), so its shore has lobes, bays and narrows, long one way
  // as a lake in a valley is. They keep out of the live play area (its water is one bowl a lake).
  const lakes: LakeSpec[] = [], clusters: { x: number; z: number; R: number }[] = [];
  const want = o.lakes === -1 ? (small ? 1 : AUTO.lakes[0] + Math.floor(r() * (AUTO.lakes[1] - AUTO.lakes[0] + 1))) : o.lakes;
  for (let tries = 0; tries < 3000 && clusters.length < want; tries++) {
    const x = range(r, -H + 1800, H - 1800), z = range(r, -H + 1800, H - 1800), size = range(r, 220, 700) * (r() < 0.25 ? 1.5 : 1);
    const n = 4 + Math.floor(r() * 5), parts: LakeSpec[] = [];
    let a = range(r, 0, 6.28), px = x, pz = z;
    for (let k = 0; k < n; k++) {
      const rr = Math.round(size * range(r, 0.22, k === 0 ? 0.6 : 0.5));
      parts.push({ x: px, z: pz, r: rr, waves: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)] });
      a += range(r, -1.1, 1.1);
      const step = rr * range(r, 0.7, 1.4);
      // (and now and then a bay off to one side)
      if (r() < 0.35) { const b = a + (r() < 0.5 ? 1.6 : -1.6), br = rr * range(r, 0.4, 0.7); parts.push({ x: px + Math.cos(b) * rr * 0.9, z: pz + Math.sin(b) * rr * 0.9, r: Math.round(br), waves: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)] }); }
      px += Math.cos(a) * step; pz += Math.sin(a) * step;
    }
    const cx = parts.reduce((t, p) => t + p.x, 0) / parts.length, cz = parts.reduce((t, p) => t + p.z, 0) / parts.length;
    const R = Math.max(...parts.map((p) => Math.hypot(p.x - cx, p.z - cz) + p.r * 1.35));
    if (Math.max(Math.abs(cx), Math.abs(cz)) < LIVE_HALF + R + 800) continue;
    if (Math.abs(cx) > H - R - 600 || Math.abs(cz) > H - R - 600) continue;
    if (parts.some((p) => withRivers.edgeDistance(p, 4000) < p.r * 1.35 + 450)) continue;
    if (clusters.some((q) => Math.hypot(q.x - cx, q.z - cz) < q.R + R + 2500)) continue;
    clusters.push({ x: cx, z: cz, R });
    lakes.push(...parts);
  }
  return { sea, rivers, lakes };
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
  // one place of a kind, somewhere `at` picks (null: nowhere left), clear of the others
  const place = (kind: Kind, n: number, at: (R: number) => XZ | null, maxTries = 2500, patchy = kind === 'village') => {
    const K = KINDS[kind];
    const radius = Math.round(kind === 'city' && n === 1 ? range(r, 380, 420) : range(r, K.r[0], K.r[1]));
    const R = reach(kind, radius);
    let slack = 1;
    for (let tries = 0; ; tries++) {
      if (tries > 0 && tries % 200 === 0) slack *= 0.9;
      if (tries > maxTries) return false; // (no room left: a crowded map gets fewer)
      const lim = H - R - edge;
      const p = at(R);
      if (!p) return false;
      const { x, z } = p;
      if (Math.abs(x) > lim || Math.abs(z) > lim) continue;
      // (villages thin out and thicken in patches a few kilometres across)
      if (patchy && r() > 0.35 + 0.65 * patch(x, z, seed)) continue;
      if (w.edgeDistance({ x, z }, R + 200) < R + 90) continue;
      // (a place is wholly in the live play area or wholly out of it)
      if (Math.max(Math.abs(x), Math.abs(z)) > LIVE_HALF - R - 150 && Math.max(Math.abs(x), Math.abs(z)) < LIVE_HALF + R + 150) continue;
      const clash = nearby(x, z, R + 12000).some((s) => Math.hypot(s.x - x, s.z - z) < (s.reach + R + gapFor(s.kind, kind)) * slack);
      if (clash) continue;
      add(make(kind, x, z, radius, n + 1));
      return true;
    }
  };
  kinds.forEach((kind, n) => {
    place(kind, n, (R) => {
      const lim = H - R - edge;
      if (kind === 'city') { const d = range(r, 7000, Math.min(18000, lim)), a = range(r, 0, 6.2832); return { x: d * Math.cos(a), z: d * Math.sin(a) }; }
      return { x: range(r, -lim, lim), z: range(r, -lim, lim) };
    });
  });
  fillSquares(r, H, w, out, (kind, n, at) => place(kind, n, at, 400, false), kinds.length);
  return out;
}
// The whole map is playable: every 10 km square gets places in proportion to its land (so none
// is left empty but the open sea), and a coast gets villages along it. After the main placement,
// from the same stream, so the places it made stay where they were.
export const SQUARE = 10000;
export function squareQuota(land: number, coast: boolean) { return land < 0.08 ? 0 : Math.max(coast ? 2 : 1, Math.round(land * 7)); }
function fillSquares(r: Rand, H: number, w: WorldWater, out: WorldSettlement[], place: (kind: Kind, n: number, at: (R: number) => XZ | null) => boolean, n0: number) {
  let n = n0 + 1;
  const m = Math.ceil((2 * H) / SQUARE), S = 20;
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const x0 = -H + i * SQUARE, z0 = -H + j * SQUARE, x1 = Math.min(H, x0 + SQUARE), z1 = Math.min(H, z0 + SQUARE);
    let land = 0, shore = 0;
    for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) {
      const x = x0 + ((a + 0.5) * (x1 - x0)) / S, z = z0 + ((b + 0.5) * (z1 - z0)) / S, d = w.seaDistance(x, z, 2500);
      if (d > 0 && !w.wet({ x, z }, 0)) land++;
      if (d > 300 && d < 2200) shore++;
    }
    const coast = shore > 0 && w.world.sea !== null, want = squareQuota(land / (S * S), coast);
    const inside = (s: WorldSettlement) => s.x >= x0 && s.x < x1 && s.z >= z0 && s.z < z1;
    let have = out.filter(inside).length, coastal = out.filter((s) => inside(s) && w.seaDistance(s.x, s.z, 2500) < 2200).length;
    for (let k = 0; k < 12 && (have < want || (coast && coastal < 1)); k++) {
      // (the coast first, if the square has one and nowhere on it yet)
      const nearSea = coast && coastal < 1;
      const at = (): XZ => {
        for (let t = 0; t < 40; t++) {
          const p = { x: range(r, x0, x1), z: range(r, z0, z1) };
          if (!nearSea) return p;
          const d = w.seaDistance(p.x, p.z, 2500);
          if (d > 300 && d < 2200) return p;
        }
        return { x: range(r, x0, x1), z: range(r, z0, z1) };
      };
      const kind: Kind = nearSea && r() < 0.3 ? 'town' : 'village';
      if (!place(kind, n++, at)) continue;
      have++;
      if (nearSea) coastal++;
    }
  }
}
// slow patchy noise (0–1) for where villages cluster
function patch(x: number, z: number, seed: number) {
  const s = mix(seed, 205) % 1000;
  return 0.5 + 0.25 * Math.sin(x / 3100 + s) * Math.cos(z / 2700 - s * 0.7) + 0.25 * Math.sin((x + z) / 5300 + s * 1.3);
}

// The world plan's settlements as the region's MapSpec takes them (region/mapspec.ts)
export const settlementInfo = (s: WorldSettlement) => ({ id: s.id, name: s.name, kind: s.kind, x: s.x, z: s.z, r: s.r, gates: s.gates });
