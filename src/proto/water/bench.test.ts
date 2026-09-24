// Timings for the report (docs/reports/water.md). The assertions are loose so a slow CI box
// doesn't fail the build; the printed numbers are what matter.
import { expect, it } from 'vitest';
import { ProceduralTerrain, TERRAIN_PRESETS, tileGrid, tileMesh, type HeightSource } from '../terrain';
import { waterClaims } from './claims';
import { Coastal } from './coast';
import { reedSpots, shoreColours, waterSurface } from './surface';
import { WaterSystem } from './water';

// median of several runs (garbage collection makes single runs noisy)
const time = (f: () => void, reps = 7) => {
  const t: number[] = [];
  for (let r = 0; r < reps; r++) { const a = performance.now(); f(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  return t[Math.floor(reps / 2)];
};
const ms = (v: number) => `${v.toFixed(1)} ms`;

it('performance', () => {
  const out: string[] = [];
  const places: [string, () => HeightSource, [number, number]][] = [
    ['rolling', () => new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }), [4, 3]],
    ['upland', () => new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 7 }), [6, 3]],
    ['coast', () => new Coastal(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 11, lakes: 0 }), { dir: [1, 0.3], at: 0, width: 3000, fall: 45, deep: 60 }), [1, 5]],
  ];
  new WaterSystem(places[0][1]()).tile(0, 0); // JIT warm-up
  let worstWarm = 0;
  for (const [name, make, [ti, tj]] of places) {
    const region = time(() => new WaterSystem(make()).region(0, 0), 3);
    // a tile of ground nobody has asked about before (so the terrain's own lattice is built too),
    // its region already worked out
    const colds: number[] = [];
    for (let r = 0; r < 3; r++) { const w2 = new WaterSystem(make()); w2.region(0, 0); const a = performance.now(); w2.tile(ti, tj); colds.push(performance.now() - a); }
    const coldTile = colds.sort((a, b) => a - b)[1];
    const w = new WaterSystem(make());
    w.tile(ti, tj);
    const warm = time(() => { w.forget(); w.tile(ti, tj); });
    worstWarm = Math.max(worstWarm, warm);
    const t = w.tile(ti, tj);
    const surface = time(() => waterSurface(t)), reeds = time(() => reedSpots(t)), claims = time(() => waterClaims(t));
    const m = tileMesh(w.terrain, ti, tj, { cells: 256 });
    const colours = time(() => shoreColours(t, m));
    const ground = time(() => w.sampleGround(tileGrid(ti, tj, 256))), base = time(() => make().sample(tileGrid(ti, tj, 256)), 3);
    const ws = waterSurface(t);
    out.push(`${name}: region (8 km, 12 km with margins) ${ms(region)}; tile water raster cold ${ms(coldTile)}, warm ${ms(warm)}; ` +
      `water mesh ${ms(surface)} (${ws?.vertexCount ?? 0} vertices, ${ws?.triangleCount ?? 0} triangles), reeds ${ms(reeds)} (${reedSpots(t).length / 5} tufts), ` +
      `claims ${ms(claims)}, shore colours for a 257² ground mesh ${ms(colours)}; ground with channels cut, 257² ${ms(ground)} (the terrain alone, cold ${ms(base)})`);
  }
  // point queries
  const w = new WaterSystem(places[0][1]());
  w.tile(4, 3);
  const N = 20000, pts = Array.from({ length: N }, (_, i) => [4000 + ((i * 7919) % 1000), 3000 + ((i * 104729) % 1000)]);
  const probe = time(() => { for (const [x, z] of pts) w.probe(x, z); }, 3) / N, ground = time(() => { for (const [x, z] of pts) w.groundAt(x, z); }, 3) / N;
  const shore = time(() => { for (const [x, z] of pts) w.distanceToShore(x, z); }, 3) / N;
  out.push(`point queries: probe (isWater, depthAt, waterLevelAt, flowAt) ${(probe * 1e6).toFixed(0)} ns; groundAt ${(ground * 1e6).toFixed(0)} ns; distanceToShore ${(shore * 1e6).toFixed(0)} ns`);
  console.log(out.join('\n'));
  expect(worstWarm).toBeLessThan(200);
}, 120000);
