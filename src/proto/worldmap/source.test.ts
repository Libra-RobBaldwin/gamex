import { describe, expect, test } from 'vitest';
import { loadPlan, planFrom, planWorld, seededSource, type WorldSettlement } from './plan';
import { setRealSource, type WorldSource } from './source';
import { generateTile } from './tilegen';
import { WorldWater } from './water';
import { resample } from './routes';
import { regionOptions } from '../region/options';

// One plan type, two sources (docs/streaming.md, "Sources"): a real source (here a small made-up
// one standing in for real/world.ts) goes through the same plan and the same tiles as a seeded map.
describe('world sources', () => {
  test('the seeded source is the plan it always was', () => {
    const a = planWorld({ seed: 3 }), b = planFrom(seededSource({ seed: 3 }));
    expect(b.source).toBe('seeded');
    expect(b.id).toBe('seed:3');
    expect(b.settlements.map((s) => [s.x, s.z, s.name])).toEqual(a.settlements.map((s) => [s.x, s.z, s.name]));
    expect(b.roads.map((r) => r.path.length)).toEqual(a.roads.map((r) => r.path.length));
  });

  // a 50 km square with a river, two towns and a village, gentle hills, and its own roads
  const o = regionOptions({ seed: 11, size: 50 }), half = 25000;
  const river = resample([{ x: -26000, z: 9000 }, { x: 0, z: 8000 }, { x: 26000, z: 10000 }], 50);
  const water = new WorldWater({ sea: null, rivers: [{ path: river, widths: river.map((_, i) => 12 + (18 * i) / river.length) }], lakes: [] });
  const place = (id: number, name: string, kind: WorldSettlement['kind'], x: number, z: number, r: number): WorldSettlement => ({ id, name, kind, x, z, r, axis: 0.3, plan: 'organic', seed: 100 + id, gates: [], pop: 30 * r, reach: r * 1.6 });
  const h = (x: number, z: number) => 40 + 25 * Math.sin(x / 3000) * Math.cos(z / 4000);
  const real: WorldSource = {
    kind: 'real', id: 'test-shire', seed: 11, options: o, half, water,
    settlements: [place(0, 'Homeford', 'town', 0, 0, 250), place(1, 'Lowbury', 'town', 12000, -3000, 220), place(2, 'Ashby Parva', 'village', -9000, -12000, 110)],
    heights: () => ({ heightAt: h, bed: (x, z) => h(x, z) - 3, field: () => null, partField: () => null }),
    industries: [], // (a real region gives its own works)
    routes: () => ({ roads: [{ id: 0, kind: 'B', path: resample([{ x: 250, z: 0 }, { x: 6000, z: -2500 }, { x: 11800, z: -3000 }], 25), a: 0, b: 1 }], rails: [], links: [] }),
  };
  test('a real source makes a plan and tiles through the same code', async () => {
    setRealSource(async (id) => { expect(id).toBe('test-shire'); return real; });
    const p = await loadPlan({ ...o, real: 'test-shire' } as never);
    expect(p.source).toBe('real');
    expect(p.settlements[1].gates.length).toBeGreaterThan(0); // (the plan laid its streets)
    expect(p.roads).toHaveLength(1);
    const s = p.settlements[1], t = generateTile(p, { level: 0, i: Math.floor(s.x / 1000), j: Math.floor(s.z / 1000), detail: 'near' });
    expect(t.ground).not.toBeNull();
    expect(t.stats.buildings).toBeGreaterThan(0);
    expect(generateTile(p, { level: 2, i: 0, j: -1, detail: 'vast' }).ground).not.toBeNull();
  });
});
