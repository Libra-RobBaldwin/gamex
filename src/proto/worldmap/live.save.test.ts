// A place half built when the game saves (the phone locks mid-activation) must not be saved as
// finished: the save lists live places, and a place is busy, not live, until it stands (main.ts
// bringToLife). When it is brought to life again after the load, its streets built so far are in the
// saved network, and laying the place's streets over them adds nothing twice.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network } from '../roads';
import { buildStreets } from '../region/apply';
import { LiveTowns } from './live';
import { worldMapSpec } from './spec';

describe('a place half built at a save', () => {
  it('is not listed as live while it is busy', () => {
    const map = worldMapSpec({ seed: 42 });
    const towns = new LiveTowns(map.world, [map.world.start]);
    const next = towns.places.find((p) => !p.live)!;
    next.busy = true;
    expect(towns.liveIds).toEqual([map.world.start]);
    expect(towns.next({ x: next.x, z: next.z, h: 500 }, 5000)?.id).not.toBe(next.id); // (not picked twice)
    next.live = true; next.busy = false;
    expect(towns.liveIds).toContain(next.id);
  });
  it('laying its streets again over the ones already built adds no road twice', () => {
    const map = worldMapSpec({ seed: 42 });
    const net = new Network(() => false, map.bound);
    const streets = map.streets.filter((s) => s.settlement === map.world.start);
    const first = buildStreets(net, streets.slice(0, Math.floor(streets.length / 2)), DEFAULT_OPTS, true); // (half of it, then the save)
    const n1 = net.segs.size, len1 = [...net.segs.values()].reduce((a, s) => a + net.length(s), 0);
    expect(first.made.length).toBeGreaterThan(5);
    const again = buildStreets(net, streets, DEFAULT_OPTS, true); // (the load brings the place to life from the start)
    const len2 = [...net.segs.values()].reduce((a, s) => a + net.length(s), 0);
    expect(net.segs.size).toBeGreaterThan(n1);
    // the streets built the first time are refused or joined, not doubled: the network's road length grows
    // by no more than the streets not built yet
    const all = new Network(() => false, map.bound);
    buildStreets(all, streets, DEFAULT_OPTS, true);
    const lenAll = [...all.segs.values()].reduce((a, s) => a + all.length(s), 0);
    expect(len2, `${Math.round(len1)} m after half, ${Math.round(len2)} m after laying all again, ${Math.round(lenAll)} m laid in one go (${again.skipped.length} skipped)`).toBeLessThan(lenAll * 1.05);
  }, 60_000);
});
