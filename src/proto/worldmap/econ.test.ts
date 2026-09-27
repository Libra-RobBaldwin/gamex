import { describe, expect, it } from 'vitest';
import { planWorld } from './plan';
import { CoarseEconomy } from './econ';

describe('the coarse economy (worldmap/econ.ts)', () => {
  const plan = planWorld({ seed: 42 }), econ = new CoarseEconomy(plan);
  it('every place grows a little, and never past half again its planned size', () => {
    for (const s of plan.settlements) {
      const p0 = econ.pop(s.id, 0), p30 = econ.pop(s.id, 30), p1y = econ.pop(s.id, 365), p20y = econ.pop(s.id, 20 * 365), p50y = econ.pop(s.id, 50 * 365);
      expect(p0).toBe(s.pop);
      expect(p30).toBeGreaterThanOrEqual(p0);
      expect(p1y).toBeGreaterThan(p0);
      expect(p20y).toBeGreaterThanOrEqual(p1y);
      expect(p50y).toBeLessThanOrEqual(Math.round(s.pop * 1.5));
      expect(p50y - p20y).toBeLessThan(p20y - p1y); // (easing off, not linear)
    }
  });
  it('before day 0, a place is its planned size', () => {
    expect(econ.pop(plan.start, -5)).toBe(plan.settlements[plan.start].pop);
  });
});
