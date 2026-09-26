// Winding country lanes (lanes.ts): from end to end, never tighter than the road allows, round
// hills and woods rather than over them, across water square on, and the same every time.
import { describe, expect, it } from 'vitest';
import { laneRoute, tightest } from './lanes';
import { budget, cpuMs } from '../test/speed';

const len = (p: { x: number; z: number }[]) => p.reduce((s, q, k) => (k ? s + Math.hypot(q.x - p[k - 1].x, q.z - p[k - 1].z) : 0), 0);
const a = { x: -1500, z: 0 }, b = { x: 1500, z: 0 };

describe('a winding lane', () => {
  it('runs from end to end, winding a little even on open flat ground, with no bend too tight', () => {
    const p = laneRoute(a, b, { seed: 7 }, { minR: 80 });
    expect(p[0]).toEqual(a); expect(p[p.length - 1]).toEqual(b);
    expect(p.length).toBeGreaterThan(50);
    expect(tightest(p)).toBeGreaterThanOrEqual(80);
    expect(len(p) / 3000).toBeGreaterThan(1.01);
    expect(len(p) / 3000).toBeLessThan(1.35);
    expect(JSON.stringify(laneRoute(a, b, { seed: 7 }, { minR: 80 }))).toBe(JSON.stringify(p));
  });

  it('goes round a hill rather than over it', () => {
    // a round hill 60 m high on the straight line
    const heightAt = (x: number, z: number) => 60 * Math.exp(-(x * x + z * z) / (2 * 350 * 350));
    const p = laneRoute(a, b, { seed: 7, heightAt }, { minR: 80 });
    const top = Math.max(...p.map((q) => heightAt(q.x, q.z)));
    expect(top).toBeLessThan(40);
  });

  it('crosses a river square on, not along it', () => {
    // a river along a line at 60 degrees to the lane
    const waterDist = (x: number, z: number) => Math.abs(x * Math.sin(1.05) - z * Math.cos(1.05)) - 10;
    const p = laneRoute(a, b, { seed: 3, waterDist }, { minR: 80 });
    const wet = p.filter((q) => waterDist(q.x, q.z) < 0).length * 8;
    expect(wet).toBeLessThan(40);
  });

  it('keeps out of the villages it passes', () => {
    const p = laneRoute(a, b, { seed: 5, settlements: [{ x: 0, z: 0, reach: 200 }] }, { minR: 40 });
    expect(Math.min(...p.map((q) => Math.hypot(q.x, q.z)))).toBeGreaterThan(150);
  });

  it('is quick', () => {
    expect(cpuMs(() => laneRoute(a, b, { seed: 9 }, { minR: 80 }))).toBeLessThan(budget(60));
  });
});
