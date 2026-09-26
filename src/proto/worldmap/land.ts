// The 50 km land as a terrain-library height source (terrain/height.ts), for the terrain and water
// libraries' own tests, benchmarks and demo: they run on the game's one land (landform.ts,
// terrain.ts), not on a generator of their own.
//
//   const { source, terrain } = landSource({ landform: 'uplands', seed: 7 });
//   new WaterSystem(source, { sea: 0 });
//
// Its ground is the one the game draws, the beds of the sea and the lakes included (heightAt plus
// bed), and it has the land's sea and lakes as its own water, which a water system keeps as they
// are. The water system finds the streams and small hollows itself.

import { FnHeight } from '../terrain/height';
import { LANDFORMS, type Landform, type RegionOptions } from '../region/options';
import { SettlementGrid, seededSource } from './plan';
import { LEVEL, WATER_LEVEL } from './water';

const cache = new Map<string, ReturnType<typeof make>>();

function make(o: Partial<RegionOptions>) {
  const src = seededSource(o), terrain = src.heights(new SettlementGrid(src.settlements)), water = src.water;
  // (the ground the game draws: the surface, and under standing water its bed; and that water, at
  // the level the game fills it to)
  const h = (x: number, z: number) => terrain.heightAt(x, z) + terrain.bed(x, z);
  const wl = (x: number, z: number) => (terrain.bed(x, z) < LEVEL ? terrain.heightAt(x, z) + WATER_LEVEL : null);
  return { source: new FnHeight(h, wl), terrain, water, settlements: src.settlements };
}

// The land for a landform preset (region/options.ts), with any other options over it; kept, so
// asking twice costs nothing.
export function landSource(o: Partial<RegionOptions> & { landform?: Landform } = {}) {
  const preset = LANDFORMS.find((l) => l.id === (o.landform ?? 'coast'))?.options ?? {};
  const opts = { ...preset, ...o }, key = JSON.stringify(opts);
  let v = cache.get(key);
  if (!v) cache.set(key, (v = make(opts)));
  return v;
}
