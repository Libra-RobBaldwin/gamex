import { describe, expect, it } from 'vitest';
import { FnHeight, ProceduralTerrain, TERRAIN_PRESETS } from '../terrain';
import { Land, pointInPoly, type Owner } from '../land';
import { claimWater, contours, waterClaims } from './claims';
import { WaterSystem } from './water';

const WATER = 'island' as Owner; // stands in for a 'water' owner until land.ts has one

describe('contours', () => {
  it('traces an outline with a hole, outer and hole oriented oppositely', () => {
    // a ring of "inside" around a dry middle on a 9×9 grid
    const n = 9, f = new Float32Array(n * n).fill(-1);
    for (let j = 1; j < 8; j++) for (let i = 1; i < 8; i++) f[j * n + i] = Math.max(Math.abs(i - 4), Math.abs(j - 4)) >= 2 ? 1 : -1;
    const rings = contours(f, n, n);
    expect(rings.length).toBe(2);
    const area = (r: number[][]) => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
    const [a, b] = rings.map(area).sort((x, y) => x - y);
    expect(a).toBeLessThan(0); // the outer outline
    expect(b).toBeGreaterThan(0); // the hole
    expect(Math.abs(a)).toBeGreaterThan(Math.abs(b));
  });
});

describe('water claims', () => {
  it('cover the water and nothing else, and keep plots off it through the land registry', () => {
    const w = new WaterSystem(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }));
    const t = w.tile(2, 4), g = t.g;
    const cs = waterClaims(t);
    expect(cs.length).toBeGreaterThan(0);
    const polys = cs.flatMap((c) => c.polys);
    let wet = 0, dry = 0, wrong = 0;
    for (let j = t.margin; j < g.nz - t.margin; j += 3) for (let i = t.margin; i < g.nx - t.margin; i += 3) {
      const k = j * g.nx + i, p = { x: g.x0 + i * g.step, z: g.z0 + j * g.step };
      if (Math.abs(t.shore[k]) < 3) continue; // right at the waterline either answer is fair
      const inWater = t.kind[k] > 0, claimed = polys.some((q) => pointInPoly(p, q));
      if (inWater) wet++; else dry++;
      if (inWater !== claimed) wrong++;
    }
    expect(wet).toBeGreaterThan(200);
    expect(wrong / (wet + dry)).toBeLessThan(0.002);
    // through the registry: a plot in the lake is refused, one on dry land is fine
    const land = new Land();
    claimWater(land, t, WATER);
    const inTile = (i: number) => i % g.nx > t.margin + 3 && i % g.nx < g.nx - t.margin - 3 && i > (t.margin + 3) * g.nx && i < (g.nz - t.margin - 3) * g.nx;
    const wetK = t.kind.findIndex((k, i) => k === 2 && t.shore[i] > 20 && inTile(i)), dryK = t.shore.findIndex((s, i) => s < -30 && inTile(i));
    expect(wetK).toBeGreaterThan(0); expect(dryK).toBeGreaterThan(0);
    const plot = (k: number) => { const x = g.x0 + (k % g.nx) * g.step, z = g.z0 + Math.floor(k / g.nx) * g.step; return [{ x: x - 5, z: z - 5 }, { x: x + 5, z: z - 5 }, { x: x + 5, z: z + 5 }, { x: x - 5, z: z + 5 }]; };
    expect(land.free(plot(wetK))).toBe(false);
    expect(land.free(plot(dryK))).toBe(true);
    // claims are small: every block's polygons fit in their 200 m block
    for (const c of cs) for (const q of c.polys) {
      const xs = q.map((p) => p.x), zs = q.map((p) => p.z);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(200 + 1e-6);
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(200 + 1e-6);
    }
  });
  it('can claim a margin beyond the waterline, and make islands holes', () => {
    // a lake with an island in the middle
    const src = new FnHeight((x, z) => { const r = Math.hypot(x - 500, z - 500); return r < 40 ? 12 : r < 250 ? 5 : 12; }, (x, z) => (Math.hypot(x - 500, z - 500) < 250 ? 8 : null));
    const w = new WaterSystem(src, { region: 2000, margin: 400, cell: 16 }), t = w.tile(0, 0);
    const polys = waterClaims(t).flatMap((c) => c.polys), wide = waterClaims(t, { buffer: 10 }).flatMap((c) => c.polys);
    const at = (x: number, z: number, ps = polys) => ps.some((q) => pointInPoly({ x, z }, q));
    expect(at(500, 650)).toBe(true); // the lake
    expect(at(500, 500)).toBe(false); // the island
    expect(at(500, 790)).toBe(false); // beyond the shore
    expect(at(500, 755, wide)).toBe(true); // …but inside the 10 m margin
    expect(at(500, 535, wide)).toBe(true); // the margin eats into the island too
  });
});
