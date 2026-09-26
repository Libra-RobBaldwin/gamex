import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Network, pathLength, rng } from '../roads';
import { Traffic } from '../traffic';
import { layRegionRoads, type RegionIn } from '../interchange/region';
import { isRealPlace } from '../region/names';
import { OUTSIDE_ID, PortalTraffic, findPortals } from './portals';

// The made-up region of interchange/region.test.ts, with ground past the map's edge (as the game has it)
const EDGE = 4500;
const REGION: RegionIn = {
  bound: 3000, edge: EDGE,
  settlements: [
    { id: 0, name: 'Castleford Magna', kind: 'city', x: -200, z: 300, r: 450 },
    { id: 1, name: 'Ashby Wold', kind: 'town', x: 1700, z: 900, r: 300 },
    { id: 2, name: 'Mellow Cross', kind: 'town', x: -1900, z: -300, r: 300 },
    { id: 3, name: 'Thornleigh', kind: 'town', x: 900, z: -1700, r: 280 },
    { id: 4, name: 'Upper Hale', kind: 'village', x: -1200, z: 1900, r: 120 },
    { id: 5, name: 'Brockham', kind: 'village', x: 2300, z: -900, r: 110 },
    { id: 6, name: 'Little Sneed', kind: 'village', x: -2400, z: -2200, r: 100 },
    { id: 7, name: 'Fenwick', kind: 'village', x: 400, z: 2500, r: 110 },
    { id: 8, name: 'Oxley Green', kind: 'village', x: -600, z: -2400, r: 100 },
    { id: 9, name: 'Harrow End', kind: 'village', x: 2500, z: 2300, r: 100 },
  ],
  links: [
    { a: 0, b: 1, road: 'A' }, { a: 0, b: 2, road: 'A' }, { a: 0, b: 3, road: 'A' }, { a: 1, b: 3, road: 'A' },
    { a: 4, b: 0, road: 'B' }, { a: 5, b: 3, road: 'B' }, { a: 6, b: 2, road: 'B' }, { a: 7, b: 0, road: 'B' }, { a: 8, b: 3, road: 'B' }, { a: 9, b: 1, road: 'B' },
  ],
};
function region() {
  const net = new Network(() => false, REGION.bound);
  net.edge = EDGE;
  for (const s of REGION.settlements) net.build({ x: s.x - s.r * 0.6, z: s.z }, { x: s.x + s.r * 0.6, z: s.z }, undefined);
  const roads = layRegionRoads(net, REGION);
  return { net, roads };
}

describe('ways off the map', () => {
  const { net, roads } = region();
  const portals = findPortals(net, EDGE, { seed: 7, names: REGION.settlements.map((s) => s.name ?? '') });

  it('the motorway runs out to the ground’s edge at both ends, and A roads leave by the other sides', () => {
    expect(roads.failed).toEqual([]);
    for (const p of roads.motorway) expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(EDGE - 5);
    expect(roads.out.length).toBeGreaterThan(0);
    // (nothing's built past the map's own bound but the roads out)
    for (const s of net.segs.values()) for (const p of net.path(s)) if (Math.max(Math.abs(p.x), Math.abs(p.z)) > REGION.bound) {
      const d = net.def(s);
      expect(d.family === 'Motorway' || d.family === 'Rural').toBe(true);
    }
    // (the carriageways run on the same way: at every plain join of one-way roads, one comes in and one goes on)
    for (const n of net.nodes.values()) {
      const at = net.segsAt(n.id);
      if (at.length === 2 && at.every((x) => x.oneway)) expect(at.filter((x) => x.b === n.id).length, `node ${n.id}`).toBe(1);
    }
    // (and none so long it'd be drawn from one cell kilometres off)
    for (const s of net.segs.values()) if (!s.aux && !roads.interchanges.some((ix) => ix.segs.includes(s.id))) expect(pathLength(net.path(s))).toBeLessThan(470);
  }, 120_000);

  it('each is one way off, to a named place of its own, with its own road number', () => {
    const mw = portals.filter((p) => p.kind === 'motorway');
    expect(mw.length).toBe(2);
    for (const p of mw) expect(p.segs.length).toBe(2); // (both carriageways)
    expect(portals.filter((p) => p.kind === 'A' || p.kind === 'B').length).toBeGreaterThanOrEqual(1);
    // (one name for each place off the map; ways off close together lead to the same one)
    const towns = new Map(portals.map((p) => [p.town, p.place]));
    expect(new Set(towns.values()).size).toBe(towns.size);
    for (const p of portals) for (const q of portals) if (p.town !== q.town) expect(Math.hypot(p.at.x - q.at.x, p.at.z - q.at.z)).toBeGreaterThan(3000);
    for (const p of portals) {
      expect(REGION.settlements.some((s) => s.name === p.place)).toBe(false);
      expect(isRealPlace(p.place)).toBe(false);
      expect(p.town).toBeGreaterThan(OUTSIDE_ID);
      expect(Math.max(Math.abs(p.at.x), Math.abs(p.at.z))).toBeCloseTo(EDGE, 5);
      expect(p.offMin).toBeGreaterThan(3);
    }
    expect(new Set(portals.map((p) => p.route)).size).toBe(portals.length);
    // the same map, the same ways off
    expect(findPortals(net, EDGE, { seed: 7, names: REGION.settlements.map((s) => s.name ?? '') })).toEqual(portals);
  });

  it('traffic comes in and goes out through them near the camera, busiest in the rush hour and on the motorway', () => {
    const count = (hour: number, kind: string) => {
      const tr = new Traffic(net, new THREE.Scene(), rng(3));
      const flows = new PortalTraffic(net, tr, portals, rng(9));
      const p = portals.find((x) => x.kind === kind)!;
      for (let t = 0; t < 240; t++) { flows.step(1 / 4, hour, 1, p.look, 1000, { homes: [], jobs: [], shops: [] }); tr.update(1 / 4, t * 250); }
      return { flows, tr, n: flows.stats.in + flows.stats.out, p };
    };
    const peak = count(8.2, 'motorway'), night = count(3, 'motorway'), a = count(8.2, portals.find((x) => x.kind === 'A') ? 'A' : 'B');
    expect(peak.n).toBeGreaterThan(20);
    expect(peak.n).toBeGreaterThan(night.n * 4);
    expect(peak.n).toBeGreaterThan(a.n * 2);
    // those going out are heading off the map; those coming in start at the edge
    const cars = peak.tr.cars.filter((c) => c.gone === undefined);
    expect(cars.some((c) => c.away)).toBe(true);
    // far off, nothing
    const far = new PortalTraffic(net, new Traffic(net, new THREE.Scene(), rng(3)), portals, rng(9));
    for (let t = 0; t < 60; t++) far.step(1, 8.2, 1, { x: 0, z: 0 }, 1000, { homes: [], jobs: [], shops: [] });
    expect(far.stats.in + far.stats.out).toBe(0);
  }, 60_000);
});

describe('ways off a 50 km map', () => {
  // (a plan's roads as worldmap/routes.ts gives them: lanes off the edges have no place at their far end)
  const H = 25000, lane = (from: { x: number; z: number }, to: { x: number; z: number }) => { const path = []; for (let t = 0; t <= 1.0001; t += 0.01) path.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t }); return path; };
  const plan = {
    half: H, seed: 3, settlements: [{ name: 'Oakby' }, { name: 'Fenmere' }],
    roads: [
      { kind: 'B' as const, path: lane({ x: 20000, z: 1000 }, { x: H + 30, z: 1500 }), b: null },
      { kind: 'B' as const, path: lane({ x: -3000, z: -20000 }, { x: -3200, z: -H - 30 }), b: null },
      { kind: 'B' as const, path: lane({ x: 0, z: 0 }, { x: 4000, z: 0 }), b: 1 },
    ],
  };
  it('one for each road that runs off the rim, on the rim, as lanes on a seeded start, with names of their own', async () => {
    const { worldPortals, portalCrossings, offMapPoint } = await import('./portals');
    const ps = worldPortals(plan);
    expect(ps.length).toBe(2);
    expect(ps.map((p) => p.side).sort()).toEqual([0, 3]);
    for (const p of ps) {
      expect(p.kind).toBe('lane');
      expect(Math.max(Math.abs(p.at.x), Math.abs(p.at.z))).toBeCloseTo(H, 5);
      expect(['Oakby', 'Fenmere']).not.toContain(p.place);
      expect(Math.max(Math.abs(p.sign.x), Math.abs(p.sign.z))).toBeLessThan(H); // (its sign on the map)
      const o = offMapPoint(p);
      expect(Math.max(Math.abs(o.x), Math.abs(o.z))).toBeGreaterThan(H); // (the place it leads to, beyond)
    }
    expect(ps[0].at.z).toBeCloseTo(1000 + 500 * ((H - 20000) / (H + 30 - 20000)), 0);
    const xs = portalCrossings(ps);
    expect(xs.length).toBe(2);
    expect(xs.every((x) => !x.rail && x.half > x.kerb)).toBe(true);
    // (a real map's names, where it gives them)
    expect(worldPortals(plan, { names: () => 'Taunton' })[0].place).toBe('Taunton');
  });
});
