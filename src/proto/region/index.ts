// The region map (docs/region.md): a seeded 6 × 6 km map of a dozen settlements, and maps as data.
//
//   import { regionMap, TOWN_MAP, mapById } from './region';
//   const map = mapById(new URLSearchParams(location.search).get('map'));   // TOWN_MAP by default
//
// For the road and rail sessions: `map.settlements` (centre, size, kind, name), `map.links` (a
// trimmed Gabriel graph: which places to join, A or B road, and whether it crosses water) and
// `generateRegion(seed).settlements[i].gates` (where the high streets leave each place).
import { generateRegion, KINDS, REGION_BOUND, reach, type Region } from './generate';
import type { MapSpec } from './mapspec';
import { TOWN_MAP } from './town';
import { optionsFromQuery, type RegionOptions } from './options';
import { STYLE_LOOKS } from './styles';
import { worldMapSpec } from '../worldmap/spec';
import { makeRelief } from '../worldmap/terrain';
import { MapWater } from '../worldmap/water';
import { woodSpots } from './priors';
import { mix, rng } from './random';

export * from './generate';
export * from './mapspec';
export { buildStreets, type StreetNet } from './apply';
export { MapWater, TOWN_WATER, type WaterSpec, type LakeSpec, type RiverSpec } from '../worldmap/water';
export { isRealPlace, placeName, REAL_PLACES } from './names';
export { TOWN_MAP };
export * from './options';
export { STYLE_LOOKS, type StyleLook } from './styles';

export const REGION_SEED = 7;

// A generated region as a map. The camera starts over the city, whose high street gets the first
// bus stops and the starter line.
export function regionMap(opts: number | Partial<RegionOptions> = REGION_SEED): MapSpec {
  return mapOfRegion(generateRegion(opts, REGION_BOUND));
}
export function mapOfRegion(g: Region): MapSpec {
  const city = g.settlements.find((s) => s.kind === 'city') ?? g.settlements[0];
  const at = (u: number, v: number) => ({ x: city.x + u * Math.cos(city.axis) - v * Math.sin(city.axis), z: city.z + u * Math.sin(city.axis) + v * Math.cos(city.axis) });
  // (mid-block, clear of the junctions: the lattice's streets cross every `spacing` metres)
  const S = KINDS[city.kind].spacing, line = [at(-1.5 * S, 0), at(1.5 * S, 0), at(0, -1.5 * S)];
  // the hills (made here once, and handed to the game as the map's ground), and woods sited on them
  // as real woods are: real patch sizes, on the steeper ground, along the contours (priors.ts)
  const relief = makeRelief({ relief: g.options.relief, seed: g.seed, water: g.water, settlements: g.settlements }, g.bound * 1.5);
  const mw = new MapWater(g.water), B = g.bound - 30;
  const keep = (p: { x: number; z: number }) => Math.abs(p.x) < B && Math.abs(p.z) < B && !g.settlements.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < reach(s.kind, s.r) + 20) && !mw.mayBeNear(p, 18);
  const spots = woodSpots(rng(mix(g.seed, 21)), { x0: -g.bound, z0: -g.bound, x1: g.bound, z1: g.bound }, relief?.heightAt ?? null, keep, { cover: STYLE_LOOKS[g.options.style].trees.density, perTree: 900, max: 6000 });
  return {
    id: 'region',
    name: 'Region',
    seed: g.seed,
    bound: g.bound,
    water: g.water,
    zones: g.zones,
    settlements: g.settlements.map(({ id, name, kind, x, z, r, gates }) => ({ id, name, kind, x, z, r, gates })),
    streets: g.streets,
    generated: true,
    links: g.links,
    view: { x: city.x, z: city.z + 20, h: 300 },
    stops: [...line, at(0, 1.5 * S)],
    line,
    industries: false,
    // woods as real ones are (priors.ts woodSpots), fewer in a desert
    trees: { count: spots.length, spots },
    style: g.options.style,
    relief: g.options.relief,
    ...(relief ? { ground: { x0: relief.x0, z0: relief.z0, step: relief.step, n: relief.n, h: relief.h, max: relief.max } } : {}),
    options: g.options,
  };
}

// The map a URL asks for: ?map=region with its options (?seed=7&rivers=2&style=desert…: options.ts),
// or the town when there's no map or it isn't known.
export function mapFromQuery(q: URLSearchParams): MapSpec {
  if (q.get('map') === 'region') { const o = optionsFromQuery(q); return o.size > 6 ? worldMapSpec(o) : regionMap(o); } // (50 km: streamed, docs/streaming.md)
  return mapById(q.get('map'));
}
// the maps the game can open, by ?map= id (the town when there's none, or it isn't known)
export function mapById(id: string | null | undefined): MapSpec {
  if (id === 'region') return regionMap();
  const seed = id?.match(/^region-(\d+)$/)?.[1];
  if (seed) return regionMap(Number(seed));
  return TOWN_MAP;
}
