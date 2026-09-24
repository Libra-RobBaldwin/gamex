// Timings for the report (docs/reports/terrain.md). The assertions are loose so a slow CI box
// doesn't fail the build; the printed numbers are what matter.
import { expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { alignRoute, alignSpec } from './align';
import { CachedHeight, tileGrid } from './height';
import { tileMesh } from './mesh';
import { ProceduralTerrain, TERRAIN_PRESETS } from './procedural';
import { GridHeight } from './raster';

// median of several runs (garbage collection makes single runs noisy)
const time = (f: () => void, reps = 9) => {
  const t: number[] = [];
  for (let r = 0; r < reps; r++) { const a = performance.now(); f(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  return t[Math.floor(reps / 2)];
};
const ms = (v: number) => `${v.toFixed(1)} ms`;

it('performance', () => {
  const out: string[] = [];
  const warm = new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 1 });
  warm.sample(tileGrid(9, 9, 128)); // JIT warm-up
  let k = 0;
  // a tile nobody has asked about before: lattice blocks built from scratch
  const cold512 = time(() => { const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 1 }); tileMesh(t, k++, 0, { cells: 512 }); });
  const cold256 = time(() => { const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 1 }); tileMesh(t, k++, 0, { cells: 256 }); });
  const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 1 });
  tileMesh(t, 0, 5, { cells: 512 });
  const warm512 = time(() => tileMesh(t, 0, 5, { cells: 512 })), warm256 = time(() => tileMesh(t, 0, 5, { cells: 256 }));
  tileMesh(t, 3, 3, { cells: 256 });
  const lods = [1, 2, 3, 4].map((lod) => time(() => tileMesh(t, 3, 3, { cells: 256, lod })));
  const sampleOnly = time(() => t.sample(tileGrid(0, 5, 512)));
  out.push(`1 km tile, 513² vertices (1.95 m), new ground: ${ms(cold512)}; ground already cached: ${ms(warm512)} (height sampling alone ${ms(sampleOnly)})`);
  out.push(`1 km tile, 257² vertices (3.9 m), new ground: ${ms(cold256)}; cached: ${ms(warm256)}`);
  out.push(`coarser levels (129², 65², 33², 17²): ${lods.map(ms).join(', ')}`);
  expect(cold512).toBeLessThan(250);

  // point queries
  const c = new CachedHeight(t);
  const N = 200000, pts = Array.from({ length: N }, (_, i) => [(i * 7.31) % 900, (i * 3.77) % 900]);
  for (const [x, z] of pts) c.heightAt(x, z);
  const cachedNs = (time(() => { for (const [x, z] of pts) c.heightAt(x, z); }) / N) * 1e6;
  const directNs = (time(() => { for (const [x, z] of pts) t.heightAt(x, z); }) / N) * 1e6;
  const os = new GridHeight(0, 10000);
  const cells = Array.from({ length: 200 * 200 }, (_, i) => (i % 200) + Math.floor(i / 200) * 0.5);
  os.mosaic.add({ i0: 0, j0: 0, w: 200, h: 200, data: Float32Array.from(cells) });
  const rasterNs = (time(() => { for (const [x, z] of pts) os.heightAt(x * 5, z * 5); }) / N) * 1e6;
  out.push(`heightAt: CachedHeight ${cachedNs.toFixed(0)} ns, procedural direct (warm lattice) ${directNs.toFixed(0)} ns, OS Terrain 50 mosaic ${rasterNs.toFixed(0)} ns`);

  // alignment
  const src = new CachedHeight(new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 3 }));
  for (const [id, L] of [['street', 1000], ['street', 3000], ['rail-main', 1000], ['rail-main', 3000], ['rail-rack', 3000], ['motorway', 3000]] as const) {
    const sp = alignSpec(ROADS[id]), path = [{ x: -L / 2, z: 200 }, { x: L / 2, z: -300 }];
    alignRoute(path, src, sp);
    const tm = time(() => alignRoute(path, src, sp), 3), a = alignRoute(path, src, sp);
    out.push(`align ${id} ${L / 1000} km: ${ms(tm)} — ${a.spans.filter((s) => s.kind !== 'grade').length} structure/earthwork spans, cost ${Math.round(a.cost.total).toLocaleString('en-GB')}`);
  }
  console.log(out.join('\n'));
});
