import { describe, expect, test } from 'vitest';
import { setRegionReader } from './world';
import { readRegion } from './node';
import { loadPlan } from '../worldmap/plan';
import { generateTile } from '../worldmap/tilegen';

// A real region through the one 50 km pipeline (docs/real.md, "On the 50 km map"): the bake as a
// WorldSource, planned and tiled by the same code as a seeded map.
setRegionReader(async (id) => readRegion(id, { half: 40000 }));

describe('a real region as a 50 km map', () => {
  test('Exe: Exeter in the middle, the sea, the rivers, the roads, and tiles', async () => {
    const t0 = performance.now();
    const p = await loadPlan({ real: 'exe', size: 50 });
    const ms = performance.now() - t0;
    expect(p.source).toBe('real');
    expect(p.options.real).toBe('exe');
    expect(p.half).toBeGreaterThanOrEqual(24000);
    const home = p.settlements[0];
    expect(home.name).toBe('Exeter');
    expect(Math.hypot(home.x, home.z)).toBeLessThan(1);
    expect(p.settlements.length).toBeGreaterThan(60);
    for (const want of ['Exmouth', 'Tiverton', 'Crediton', 'Sidmouth']) expect(p.settlements.map((s) => s.name)).toContain(want);
    // (the sea off Exmouth and Dawlish, and the estuary's mouth)
    const ex = p.settlements.find((s) => s.name === 'Exmouth')!;
    expect(p.water.world.sea).not.toBeNull();
    expect(p.water.seaDistance(ex.x, ex.z + 3000)).toBeLessThan(0);
    expect(p.water.seaDistance(home.x, home.z)).toBeGreaterThan(2000); // (the Exe is tidal up to Countess Wear, 3 km down from the centre)
    expect(p.water.world.rivers.length).toBeGreaterThan(5);
    expect(p.roads.filter((r) => r.kind === 'motorway').length).toBeGreaterThan(0); // (the M5)
    expect(p.roads.length).toBeGreaterThan(50);
    expect(p.rails.length).toBeGreaterThan(0);
    // (the hills: Haldon and Dartmoor's edge well above the city, and nothing below the sea)
    const hs = [];
    for (let x = -20000; x <= 20000; x += 2000) for (let z = -20000; z <= 20000; z += 2000) hs.push(p.terrain.heightAt(x, z));
    expect(Math.max(...hs)).toBeGreaterThan(200);
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(0);
    console.log('exe plan', Math.round(ms), 'ms', { places: p.settlements.length, roads: p.roads.length, rails: p.rails.length, rivers: p.water.world.rivers.length, side: p.water.world.sea?.side, top: Math.round(Math.max(...hs)) });
    const s = p.settlements.find((q) => q.name === 'Crediton')!;
    const t = generateTile(p, { level: 0, i: Math.floor(s.x / 1000), j: Math.floor(s.z / 1000), detail: 'near' });
    expect(t.ground).not.toBeNull();
    expect(t.stats.buildings).toBeGreaterThan(0);
    expect(generateTile(p, { level: 2, i: 0, j: 0, detail: 'vast' }).ground).not.toBeNull();
  }, 120000);
});
