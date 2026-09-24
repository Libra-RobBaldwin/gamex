import { describe, expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { pointAt } from '../roads';
import { EMBANK_MAX, demand, extents, pointOn } from './crossing';
import { scenario } from './scenario';

describe('crossings', () => {
  it('finds points along a path exactly as roads.ts does, only faster', () => {
    const path = Array.from({ length: 50 }, (_, i) => ({ x: i * 3 + Math.sin(i) * 2, z: Math.cos(i / 3) * 10, y: i % 7 }));
    for (let s = -5; s < 200; s += 0.7) {
      const a = pointAt(path, s), b = pointOn(path, s);
      for (const k of ['x', 'y', 'z', 'ux', 'uz'] as const) expect(b[k]).toBeCloseTo(a[k], 6);
    }
  });

  it('bridges every obstacle and anywhere too high for an embankment, and nothing else', () => {
    const sc = scenario({ length: 600, road: ROADS.dual, year: 2000, river: { s0: 250, s1: 330 }, under: [{ s: 360, kind: 'road', half: 6 }] });
    const ex = extents(sc.crossing);
    expect(ex).toHaveLength(1);
    const [a, b] = ex[0];
    expect(a).toBeLessThan(250);
    expect(b).toBeGreaterThan(366);
    // beyond the ends the deck is low enough for an embankment
    expect(pointOn(sc.crossing.path, a - 4).y).toBeLessThanOrEqual(EMBANK_MAX + 0.5);
    expect(pointOn(sc.crossing.path, b + 4).y).toBeLessThanOrEqual(EMBANK_MAX + 0.5);
  });

  it('asks more of a bridge for heavier traffic', () => {
    const c = scenario({ length: 300, road: ROADS['rail-main'], year: 2000 }).crossing;
    expect(demand(c).rail).toBe(22.5);
    expect(demand({ ...c, heavy: true }).rail).toBe(25.5);
    expect(demand({ ...c, road: ROADS.street }).road).toBe(44);
  });
});
