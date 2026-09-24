// The water system: one import for the rest of the game. See docs/water.md.
export * from './types';
export { WaterSystem, WaterTerrain, rasterAt, type Crossing, type WaterTile } from './water';
export { CLASS_CODE, CLASS_OF, type Reach } from './rivers';
export { buildRegion, isRiverTerrain, type Region, type RiverTerrain } from './region';
export { priorityFlood, accumulate, label, edt, type Flood } from './flood';
export { waterSurface, shoreColours, reedSpots, SHORE_COLOURS, type WaterMesh } from './surface';
export { Coastal, type CoastOpts } from './coast';
