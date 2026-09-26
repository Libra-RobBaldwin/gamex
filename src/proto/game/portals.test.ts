import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, pathLength, pointAt, rng } from '../roads';
import { Traffic } from '../traffic';
import { buildPair } from '../interchange/build';
import { isRealPlace } from '../region/names';
import { OUTSIDE_ID, PortalTraffic, findPortals } from './portals';

// The rim of a 50 km map, with roads the player might build out through it (the seeded start's own
// roads off the map are lanes, and the live area doesn't reach the rim: worldPortals below). Here the
// Network reaches the rim, with a motorway across the map (a pair of carriageways, in through the
// west rim and out through the east), an A road out through the south and a B road out through the
// north, each far from the others, as ways off that lead to places of their own. (The Network builds
// nothing past its bound, so here the roads end on the rim itself.)
const H = 25000, NAMES = ['Oakby', 'Fenmere', 'Castleford Magna'];
function rim() {
  const net = new Network(() => false, H);
  net.edge = H;
  const mw = buildPair(net, [{ x: -H, z: 2000 }, { x: H, z: 2000 }], 'motorway');
  expect(mw.ok, 'reason' in mw ? mw.reason : '').toBe(true);
  net.build({ x: 3000, z: -H + 3000 }, { x: 3000, z: -H }, undefined, { ...DEFAULT_OPTS, type: 'rural-60' });
  net.build({ x: -8000, z: H - 3000 }, { x: -8000, z: H }, undefined, { ...DEFAULT_OPTS, type: 'rural-50' });
  // (in pieces, as the game keeps its roads: none longer than 450 m)
  for (const s of [...net.segs.values()]) {
    const L = pathLength(net.path(s)), n = Math.floor(L / 450);
    let id = s.id;
    for (let k = n; k >= 1; k--) { const node = net.split(id, pointAt(net.path(net.segs.get(id)!), (L * k) / (n + 1))); id = net.segsAt(node).find((x) => x.b === node)?.id ?? id; }
  }
  return net;
}

describe('ways off the map', () => {
  const net = rim();
  const portals = findPortals(net, H, { seed: 7, names: NAMES });

  it('each is one way off, to a named place of its own, with its own road number', () => {
    const mw = portals.filter((p) => p.kind === 'motorway');
    expect(mw.length).toBe(2);
    for (const p of mw) expect(p.segs.length).toBe(2); // (both carriageways)
    expect(portals.filter((p) => p.kind === 'A').length).toBe(1);
    expect(portals.filter((p) => p.kind === 'B').length).toBe(1);
    // (one name for each place off the map; ways off close together lead to the same one)
    const towns = new Map(portals.map((p) => [p.town, p.place]));
    expect(new Set(towns.values()).size).toBe(towns.size);
    for (const p of portals) for (const q of portals) if (p.town !== q.town) expect(Math.hypot(p.at.x - q.at.x, p.at.z - q.at.z)).toBeGreaterThan(3000);
    for (const p of portals) {
      expect(NAMES).not.toContain(p.place);
      expect(isRealPlace(p.place)).toBe(false);
      expect(p.town).toBeGreaterThan(OUTSIDE_ID);
      expect(Math.max(Math.abs(p.at.x), Math.abs(p.at.z))).toBeCloseTo(H, 5);
      expect(p.offMin).toBeGreaterThan(3);
      expect(Math.max(Math.abs(p.sign.x), Math.abs(p.sign.z))).toBeLessThan(H); // (its sign on the map)
    }
    expect(new Set(portals.map((p) => p.route)).size).toBe(portals.length);
    // the same map, the same ways off
    expect(findPortals(net, H, { seed: 7, names: NAMES })).toEqual(portals);
  });

  it('traffic comes in and goes out through them near the camera, busiest in the rush hour and on the motorway', () => {
    const count = (hour: number, kind: string) => {
      const tr = new Traffic(net, new THREE.Scene(), rng(3));
      const flows = new PortalTraffic(net, tr, portals, rng(9));
      const p = portals.find((x) => x.kind === kind)!;
      for (let t = 0; t < 240; t++) { flows.step(1 / 4, hour, 1, p.look, 1000, { homes: [], jobs: [], shops: [] }); tr.update(1 / 4, t * 250); }
      return { flows, tr, n: flows.stats.in + flows.stats.out, p };
    };
    const peak = count(8.2, 'motorway'), night = count(3, 'motorway'), a = count(8.2, 'A');
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
