// The region map (docs/region.md): a seeded 6 × 6 km map of a dozen settlements, and maps as data.
//
//   import { regionMap, TOWN_MAP, mapById } from './region';
//   const map = mapById(new URLSearchParams(location.search).get('map'));   // TOWN_MAP by default
//
// For the road and rail sessions: `map.settlements` (centre, size, kind, name), `map.links` (a
// trimmed Gabriel graph: which places to join, A or B road, and whether it crosses water) and
// `generateRegion(seed).settlements[i].gates` (where the high streets leave each place).
import { generateRegion, REGION_BOUND, type Region } from './generate';
import type { MapSpec } from './mapspec';
import { TOWN_MAP } from './town';

export * from './generate';
export * from './mapspec';
export { buildStreets, type StreetNet } from './apply';
export { MapWater, TOWN_WATER, type WaterSpec, type LakeSpec, type RiverSpec } from './water';
export { isRealPlace, placeName, REAL_PLACES } from './names';
export { TOWN_MAP };

export const REGION_SEED = 7;

// A generated region as a map. The camera starts over the city, whose high street gets the first
// bus stops and the starter line.
export function regionMap(seed = REGION_SEED): MapSpec {
  return mapOfRegion(generateRegion(seed, REGION_BOUND));
}
export function mapOfRegion(g: Region): MapSpec {
  const city = g.settlements.find((s) => s.kind === 'city') ?? g.settlements[0];
  const at = (u: number, v: number) => ({ x: city.x + u * Math.cos(city.axis) - v * Math.sin(city.axis), z: city.z + u * Math.sin(city.axis) + v * Math.cos(city.axis) });
  const line = [at(-95, 0), at(130, 0), at(0, -160)];
  return {
    id: 'region',
    name: 'Region',
    seed: g.seed,
    bound: g.bound,
    water: g.water,
    zones: g.zones,
    settlements: g.settlements.map(({ id, name, kind, x, z, r }) => ({ id, name, kind, x, z, r })),
    streets: g.streets,
    generated: true,
    links: g.links,
    view: { x: city.x, z: city.z + 20, h: 300 },
    stops: [...line, at(0, 160)],
    line,
    industries: false,
    // woods over the whole map (a fifth of the town's density: it's 33 times the area, and the ground paints woods too)
    trees: { count: Math.round(1400 * (g.bound / 520) ** 2 * 0.07) },
  };
}

// the maps the game can open, by ?map= id (the town when there's none, or it isn't known)
export function mapById(id: string | null | undefined): MapSpec {
  if (id === 'region') return regionMap();
  const seed = id?.match(/^region-(\d+)$/)?.[1];
  if (seed) return regionMap(Number(seed));
  return TOWN_MAP;
}
