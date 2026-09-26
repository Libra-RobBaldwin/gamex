import { describe, expect, it } from 'vitest';
import { PRIORS, fractalCoast, placesFor, radiusFor, woodArea, woodShareAt, woodSpots } from './priors';
import { rng } from './random';
import { regionMap } from './index';

describe('priors from real Britain', () => {
  it('woods keep to the steep ground', () => {
    expect(woodShareAt(0)).toBeLessThan(0.1);
    expect(woodShareAt(0.4)).toBeGreaterThan(0.5);
    const r = rng(3), a = Array.from({ length: 4000 }, () => woodArea(r)).sort((x, y) => x - y);
    expect(a[2000] / 1e4).toBeGreaterThan(0.35); // (median about half a hectare)
    expect(a[2000] / 1e4).toBeLessThan(0.8);
  });
  it('sites woods on a slope rather than the flat, in real-sized patches', () => {
    // a valley: flat floor for x < 0, a 30% side beyond
    const h = (x: number) => (x < 0 ? 0 : 0.3 * x);
    const spots = woodSpots(rng(5), { x0: -2000, z0: -2000, x1: 2000, z1: 2000 }, (x) => h(x), () => true, { perTree: 600 });
    const steep = spots.filter((p) => p.x > 100).length, flat = spots.filter((p) => p.x < -100).length;
    expect(steep).toBeGreaterThan(flat * 3);
    expect(spots.length).toBeGreaterThan(500);
  });
  it('makes a coast as rough as the real one', () => {
    const c = fractalCoast(rng(9), { x: 0, z: 0 }, { x: 20000, z: 0 }, 25);
    // box counting over 100 m – 1.6 km
    const count = (s: number) => new Set(c.map((p) => `${Math.floor(p.x / s)},${Math.floor(p.z / s)}`)).size;
    const D = Math.log(count(100) / count(1600)) / Math.log(16);
    expect(D).toBeGreaterThan(1.05);
    expect(D).toBeLessThan(1.35);
  });
  it('gives real place counts and sizes', () => {
    const p = placesFor(2500);
    expect(p.villages).toBeGreaterThan(150);
    expect(p.towns).toBeGreaterThan(10);
    expect(radiusFor(130000)).toBeGreaterThan(2000);
    expect(radiusFor(500)).toBeLessThan(500); // (Open Names extents are generous: fields and gardens round a village count)
    expect(PRIORS.roads.junctions.tee).toBeGreaterThan(PRIORS.roads.junctions.cross * 5);
  });
  it('the generated region has its woods where the priors put them, and the same seed the same woods', () => {
    const a = regionMap(7), b = regionMap(7);
    expect(a.trees.spots!.length).toBeGreaterThan(1000);
    expect(a.trees.spots).toEqual(b.trees.spots);
    for (const s of a.settlements) expect(a.trees.spots!.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < s.r)).toBe(false);
  });
});
