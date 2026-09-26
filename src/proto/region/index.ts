// The map (docs/region.md): the 50 km region, and maps as data.
//
//   import { mapFromQuery } from './region';
//   const map = mapFromQuery(new URLSearchParams(location.search));   // the 50 km region
//
// `map.settlements` (centre, size, kind, name) and `map.links` (which places to join, A or B road,
// and whether it crosses water) are the live area's; the whole plan rides along as `map.world`.
import type { MapSpec } from './mapspec';
import { optionsFromQuery } from './options';
import { worldMapSpec } from '../worldmap/spec';

export * from './generate';
export * from './mapspec';
export { buildStreets, type StreetNet } from './apply';
export { MapWater, TOWN_WATER, type WaterSpec, type LakeSpec, type RiverSpec } from '../worldmap/water';
export { isRealPlace, placeName, REAL_PLACES } from './names';
export * from './options';
export { STYLE_LOOKS, type StyleLook } from './styles';

// The map a URL asks for: there is one map, the 50 km region, with its options (?seed=7&rivers=2&style=desert…:
// options.ts). An old address (?map=town, a 6 km ?size=6) opens the region all the same.
export function mapFromQuery(q: URLSearchParams): MapSpec {
  return worldMapSpec({ ...optionsFromQuery(q), size: 50 }); // (streamed: docs/streaming.md)
}
