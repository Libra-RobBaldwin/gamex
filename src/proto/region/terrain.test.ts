import { describe, expect, test } from 'vitest';
import { regionMap, TOWN_MAP } from './index';
import { reach } from './generate';
import { lakeBox, MapWater } from './water';
import { makeRelief, RELIEF_HEIGHT, steepest, STEP } from './terrain';

const HALF = 4500;
describe('hills', () => {
  const m = regionMap({ seed: 7, relief: 'rolling' }), f = makeRelief(m, HALF)!;

  test('a flat map (the town, or relief=flat) has none', () => {
    expect(makeRelief(TOWN_MAP, 780)).toBeNull();
    expect(makeRelief(regionMap({ seed: 7, relief: 'flat' }), HALF)).toBeNull();
  });
  test('the same map always has the same hills; another seed, others', () => {
    expect(makeRelief(m, HALF)!.h).toEqual(f.h);
    expect(makeRelief(regionMap({ seed: 8, relief: 'rolling' }), HALF)!.h).not.toEqual(f.h);
  });
  test('the region is rolling by default, and as high as its relief says', () => {
    expect(regionMap(7).relief).toBe('rolling');
    expect(f.max).toBeGreaterThan(RELIEF_HEIGHT.rolling * 0.6);
    expect(f.max).toBeLessThanOrEqual(RELIEF_HEIGHT.rolling + 1e-6);
    expect(steepest(f)).toBeLessThan(0.12); // rolling: gentle enough to drape roads over
    const hills = Array.from(f.h).filter((v) => v > 5).length / f.h.length;
    expect(hills).toBeGreaterThan(0.2); // (and there really are hills)
  });
  test('level ground in and round every place, along every river and round every lake', () => {
    const mw = new MapWater(m.water);
    for (const s of m.settlements) {
      const R = reach(s.kind, s.r) + 20; // (the flat reaches 60 m past; within a cell's diagonal of its edge it starts to rise)
      for (let a = 0; a < Math.PI * 2; a += 0.2) for (const k of [0, 0.5, 1]) expect(f.heightAt(s.x + Math.cos(a) * R * k, s.z + Math.sin(a) * R * k)).toBe(0);
    }
    for (const r of m.water.rivers) for (const p of r.path.filter((_, i) => i % 5 === 0)) {
      if (Math.abs(p.x) > HALF || Math.abs(p.z) > HALF) continue;
      for (const o of [-40, 0, 40]) expect(f.heightAt(p.x + o, p.z)).toBe(0);
    }
    for (const L of m.water.lakes) { const B = lakeBox(L); for (const [x, z] of [[B.x0, B.z0], [B.x1, B.z1], [B.x0, B.z1], [L.x, L.z]]) expect(f.heightAt(x, z)).toBe(0); }
    expect(mw).toBeDefined();
  });
  test('between grid points the height is planar over the ground mesh\'s two triangles', () => {
    const at = (i: number, j: number) => f.h[j * f.n + i];
    for (let t = 0; t < 400; t++) {
      const i = 20 + ((t * 37) % (f.n - 40)), j = 20 + ((t * 53) % (f.n - 40)), x = f.x0 + i * STEP, z = f.z0 + j * STEP;
      expect(f.heightAt(x, z)).toBeCloseTo(at(i, j), 5);
      // on the diagonal from (i+1, j) to (i, j+1): the average of its ends
      expect(f.heightAt(x + STEP / 2, z + STEP / 2)).toBeCloseTo((at(i + 1, j) + at(i, j + 1)) / 2, 4);
      // inside the first triangle: linear in x along its bottom edge
      expect(f.heightAt(x + STEP / 4, z)).toBeCloseTo(at(i, j) * 0.75 + at(i + 1, j) * 0.25, 4);
    }
  });
  test('every relief works, and quickly enough to make at load', () => {
    for (const r of ['lowland', 'upland', 'mountain'] as const) {
      const t0 = performance.now(), g = makeRelief(regionMap({ seed: 3, relief: r }), HALF)!;
      expect(performance.now() - t0).toBeLessThan(3000);
      expect(g.max).toBeGreaterThan(RELIEF_HEIGHT[r] * 0.5);
    }
  });
});
