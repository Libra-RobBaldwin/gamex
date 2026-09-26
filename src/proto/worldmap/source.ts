// Where a 50 km map comes from (docs/streaming.md, "Sources"). There are two sources:
//
//   - seeded: made up from the region options (`seededSource` in plan.ts);
//   - real: read from an OS bake of a real 50 km square (`real/world.ts`, the OS session's).
//
// Each gives the same coarse facts. `planFrom` (plan.ts) turns either one into the `WorldPlan`
// that everything downstream takes: the tiles, the scenery view, the live play area, activation,
// the coarse economy and saves. Nothing downstream asks which source a plan came from, so a real
// region is drawn and played through the same code as a seeded one.
//
// Coordinates are the map's own: metres, x east and z south, from -half to half each way, with the
// start (or home) place at 0, 0. A real source shifts its region so its home place is there. The
// live play area (plan.ts LIVE_HALF, 8 km across) is the same for both.
import type { RegionOptions } from '../region/options';
import type { ReliefField } from './terrain';
import type { Link } from '../region/generate';
import type { XZ } from './water';
import type { SettlementGrid, WorldSettlement } from './plan';
import type { Rail, Route } from './routes';
import type { WorldWater } from './water';
import type { WorldIndustry } from './industry';

export interface Box { x0: number; z0: number; x1: number; z1: number }

// The ground's height, as functions of x, z (m). The terrain session owns the seeded one
// (`worldmap/terrain.ts`); a real source gives the bake's heights through the same shape.
export interface WorldHeights {
  heightAt(x: number, z: number): number; // the land's height, levelled where places stand
  bed(x: number, z: number): number; // the bottom of the water (the sea, lakes, rivers) where there is water
  field(step?: number): ReliefField | null; // the whole map's heights on a grid (for the drape)
  partField(box: Box, step?: number): ReliefField | null; // part of it (the live area's, at the start)
  ease?(routes: { path: XZ[]; grade: number; half: number }[]): void; // the ground laid to the trunk routes once they're planned (their cuttings and embankments)
  geologyAt?(x: number, z: number): 'limestone' | 'gritstone' | 'slate' | 'granite' | 'chalk' | 'clay' | 'sandstone' | 'alluvium' | null; // the rock under a spot (for the buildings' stone: vernacular's setGeology)
}

export interface WorldSource {
  kind: 'seeded' | 'real';
  id: string; // what the map is: 'seed:<n>', or a real region's id (public/regions/<id>)
  seed: number; // for everything made up on top of it (fields, houses, names of the unnamed)
  options: RegionOptions; // the region options it was made from (a real source: its style, size 50)
  half: number; // half the map's width (m)
  water: WorldWater; // the sea, rivers and lakes
  // The places. Their ids are their index; settlements[0] is the start (or home) place, at 0, 0.
  // Their `gates` (where roads meet their streets) may be empty: the plan lays their streets to find them.
  settlements: WorldSettlement[];
  // The heights, once the places are known (a seeded map levels the ground under its places).
  heights(grid: SettlementGrid): WorldHeights;
  // The roads and railways at the start, if the source has them (a real region's). Without them
  // the plan lays its own: lanes between neighbouring places and off the map's edges (routes.ts).
  routes?(grid: SettlementGrid, heights: WorldHeights): { roads: Route[]; rails: Rail[]; links: Link[] };
  // The industries, if the source has them (a real region's works, quarries and docks). Without
  // them the plan places its own on the land that suits each (industry.ts).
  industries?: WorldIndustry[];
  // The woods in a box, if the source knows them (a real region's, from OS). Without them the
  // countryside paints its own.
  woods?(box: Box): XZ[][];
}

// A real source registers its loader here (real/world.ts calls `setRealSource` when it's imported,
// on the main thread and in the tile worker alike). The region options name a real region by
// their `real` field; without one, the map is seeded (plan.ts loadPlan).
export type RealLoader = (region: string, o: RegionOptions) => Promise<WorldSource>;
let realLoader: RealLoader | null = null;
export function setRealSource(load: RealLoader) { realLoader = load; }
export const realSource = () => realLoader;
export const realOf = (o: RegionOptions) => (o as RegionOptions & { real?: string }).real || null;
