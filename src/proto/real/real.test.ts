import { describe, expect, it } from 'vitest';
import { decodeTile, encodeTile, type Tile } from './format';
import { clipLine, splitFootprint, ringArea } from './osm';
import { realMap } from './map';
import { readRegion } from './node';
import { layReal } from './lay';
import { Network } from '../roads';
import { MapWater } from '../region/water';

describe('the tile format', () => {
  it('round-trips heights and features to the quantum', () => {
    const t: Tile = { i: 2, j: 3, x0: -15000, z0: -10000, size: 5000, heights: { x0: -15000, z0: -10000, step: 50, n: 3, h: Float32Array.from([0, 1.5, -2.3, 400, 12.1, 3, 4, 5, 6]) }, layers: {
      roads: [{ c: 3, name: 'B3212 Dunsford Road', parts: [Float64Array.of(-14000.26, -9000.1, -13000, -9500.74)] }],
      buildings: [{ c: 0, parts: [Float64Array.of(-14500, -9000, -14490, -9000, -14490, -8990, -14500, -8990, -14500, -9000), Float64Array.of(-14498, -8998, -14496, -8998, -14496, -8996)], holes: [false, true] }],
    } };
    const back = decodeTile(encodeTile(t));
    expect(back.heights!.h[3]).toBeCloseTo(400, 1);
    expect(back.heights!.h[2]).toBeCloseTo(-2.3, 1);
    expect(back.layers.roads![0].name).toBe('B3212 Dunsford Road');
    expect(back.layers.roads![0].parts[0][0]).toBeCloseTo(-14000.26, 0);
    expect(Math.abs(back.layers.roads![0].parts[0][3] - -9500.74)).toBeLessThanOrEqual(0.25);
    expect(back.layers.buildings![0].parts[0].length).toBe(8); // (the ring's closing point dropped)
    expect(back.layers.buildings![0].holes).toEqual([false, true]);
  });
  it('clips a line to a box and cuts a terrace into houses', () => {
    const runs = clipLine([{ x: -20, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 30 }, { x: 30, z: 30 }], { x0: -10, z0: -10, x1: 10, z1: 10 });
    expect(runs).toEqual([[{ x: -10, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 10 }]]);
    const terrace = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 8 }, { x: 0, z: 8 }];
    const houses = splitFootprint(terrace);
    expect(houses.length).toBeGreaterThanOrEqual(7);
    expect(houses.reduce((s, h) => s + Math.abs(ringArea(h)), 0)).toBeCloseTo(480, 0);
    expect(splitFootprint([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 9 }, { x: 0, z: 9 }]).length).toBe(1);
  });
});

describe('the Exe estuary, round Exeter', () => {
  const R = readRegion('exe');
  const map = realMap(R);
  it('finds Exeter, its river, its railway stations and its roads', () => {
    expect(map.settlements.find((s) => s.name === 'Exeter')?.kind).toBe('city');
    expect(map.water.rivers.some((r) => r.width >= 15)).toBe(true);
    expect(map.real.overpass.counts.station).toBeGreaterThanOrEqual(5); // (St David's, Central, St Thomas, St James' Park, Polsloe Bridge…)
    expect(map.real.overpass.counts['road:a']).toBeGreaterThan(50);
    expect(map.ground!.max).toBeGreaterThan(60); // (Exeter stands on hills over the Exe)
    expect(map.trees.spots!.length).toBeGreaterThan(1000);
  });
  it('builds into a network: connected roads, a railway, and buildings on lots', () => {
    const w = new MapWater(map.water);
    const net = new Network((p) => w.edgeDistance(p, 20) < 9, map.bound, 1);
    const laid = layReal(net, map.real.overpass);
    console.log('laid', laid.stats, Math.round(laid.ms), 'ms', laid.stations.map((s) => s.name).join(', '));
    const roads = [...net.segs.values()].filter((s) => net.def(s).cls === 'road'), rails = [...net.segs.values()].filter((s) => net.def(s).cls === 'rail');
    expect(roads.length).toBeGreaterThan(1500);
    expect(rails.length).toBeGreaterThan(10);
    expect(laid.stations.filter((s) => s.seg !== undefined).length).toBeGreaterThanOrEqual(4);
    expect(laid.lots.length).toBeGreaterThan(5000);
    // most of the road network is one piece
    const adj = new Map<number, number[]>();
    for (const s of roads) { (adj.get(s.a) ?? adj.set(s.a, []).get(s.a)!).push(s.b); (adj.get(s.b) ?? adj.set(s.b, []).get(s.b)!).push(s.a); }
    const start = roads[0].a, seen = new Set([start]), q = [start];
    while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    let best = seen.size;
    for (const n of adj.keys()) if (!seen.has(n)) { const s2 = new Set([n]), q2 = [n]; while (q2.length) for (const m of adj.get(q2.pop()!) ?? []) if (!s2.has(m)) { s2.add(m); q2.push(m); } best = Math.max(best, s2.size); for (const m of s2) seen.add(m); }
    expect(best / adj.size).toBeGreaterThan(0.8);
  });
});
