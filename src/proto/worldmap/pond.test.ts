import { describe, expect, it } from 'vitest';
import { planWorld } from './plan';
import { LEVEL, lakeRadiusOf } from './water';

// A park's pond (docs/briefs/play.md 12, the user's rule): a level surface in a hollow with an
// irregular outline, never a circle, through the water system's own shapes.
describe('a park pond (worldmap/water.ts addPond, terrain.ts)', () => {
  const p = planWorld({ seed: 42 }), w = p.water, T = p.terrain, h = T.heightAt;
  // a dry spot on sloping ground away from the start town's flat
  const at = (() => {
    for (let x = 1200; x < 4000; x += 137) for (let z = 900; z < 4000; z += 151) {
      const q = { x, z };
      if (w.edgeDistance(q, 300) < 250) continue;
      const g = Math.hypot(h(x + 50, z) - h(x - 50, z), h(x, z + 50) - h(x, z - 50)) / 100;
      if (g > 0.02 && g < 0.08) return q;
    }
    throw new Error('no sloping dry spot');
  })();
  const ring = (R: number, n = 16) => Array.from({ length: n }, (_, k) => { const a = (2 * Math.PI * k) / n; return { x: at.x + R * Math.cos(a), z: at.z + R * Math.sin(a) }; });
  const before = ring(200).map((q) => h(q.x, q.z)), centreBefore = h(at.x, at.z);
  const L = w.addPond({ x: at.x, z: at.z, r: 18, seed: 5 }, h);

  it('is small, at the ground\'s height where it is put, and its outline wanders: never a circle', () => {
    expect(L.r).toBe(18);
    expect(w.addPond({ x: at.x + 5000, z: at.z, r: 200, seed: 1 }, h).r).toBe(30); // (clamped: a pond, not a lake)
    expect(L.level).toBeCloseTo(centreBefore, 1);
    const radii = Array.from({ length: 24 }, (_, k) => lakeRadiusOf(L, (2 * Math.PI * k) / 24));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.06 * L.r);
  });
  it('is a level surface: the ground is at its level across it and just past its shore', () => {
    const inside = [{ x: at.x, z: at.z }, ...ring(L.r * 0.5, 8), ...ring(L.r * 0.9, 8)].map((q) => h(q.x, q.z));
    expect(Math.max(...inside) - Math.min(...inside)).toBeLessThan(0.02);
    expect(inside[0]).toBeCloseTo(L.level!, 2);
    for (const q of ring(L.r * 1.1 + 4, 12)) expect(h(q.x, q.z)).toBeCloseTo(L.level!, 1); // (the beach, still level)
  });
  it('sits in a hollow: its bed dips below the water, its rim rises to the land, and the land beyond is untouched', () => {
    expect(T.bed(at.x, at.z)).toBeLessThan(LEVEL);
    expect(w.lakesGround(at.x, at.z)).toBeLessThan(LEVEL);
    for (const q of ring(L.r * 2.2, 12)) expect(h(q.x, q.z)).toBeGreaterThanOrEqual(L.level! - 1e-6);
    ring(200).forEach((q, k) => expect(h(q.x, q.z)).toBeCloseTo(before[k], 6));
  });
  it('is water to everything that asks the map: its kind, its edge, its level', () => {
    expect(w.kindAt(at.x, at.z)).toBe('lake');
    expect(w.kindAt(at.x + L.r * 2.5, at.z)).toBeNull();
    expect(w.edgeDistance({ x: at.x, z: at.z }, 100)).toBeLessThan(0);
    expect(w.edgeDistance({ x: at.x + L.r * 3, z: at.z }, 100)).toBeGreaterThan(L.r);
    expect(w.wet({ x: at.x, z: at.z })).toBe(true);
    expect(w.mayBeNear({ x: at.x + L.r + 10, z: at.z }, 20)).toBe(true);
    expect(w.lakeAt(at.x, at.z)).toBeNull(); // (not one of the land's lakes: the terrain asks pondAt)
    expect(w.pondAt(at.x, at.z)?.pond).toBe(L);
  });
});
