import { describe, expect, it } from 'vitest';
import { Network, closestOnPath, type P } from '../roads';
import { design, landFits, legsAt } from '../junction';
import { layRegionRoads, motorwayLine, type RegionIn } from './region';

// A made-up region in the shape the region generator gives (src/proto/region: settlements and links):
// a city, three towns and six villages on a 6 km map.
const REGION: RegionIn = {
  bound: 3000,
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
// each place's own streets: one through its middle, so the roads out have something to join
function region() {
  const net = new Network(() => false, REGION.bound);
  for (const s of REGION.settlements) net.build({ x: s.x - s.r * 0.6, z: s.z }, { x: s.x + s.r * 0.6, z: s.z }, undefined);
  return net;
}

describe('the region’s roads', () => {
  it('a motorway right across the map, clear of every place, with three or four junctions near the biggest', () => {
    const net = region();
    const r = layRegionRoads(net, REGION);
    expect(r.failed).toEqual([]);
    for (const s of REGION.settlements) expect(closestOnPath(s, r.motorway).d - s.r).toBeGreaterThan(250);
    expect(r.interchanges.length).toBeGreaterThanOrEqual(3);
    expect(r.interchanges.length).toBeLessThanOrEqual(4);
    // near the biggest places: the city's is among them
    const city = REGION.settlements[0];
    expect(r.interchanges.some((ix) => Math.hypot(ix.at.x - city.x, ix.at.z - city.z) < 1200)).toBe(true);
    // edge to edge
    for (const p of r.motorway) expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeGreaterThan(REGION.bound - 20);
  }, 120_000);

  it('from any place, the roads reach every other, one-way roads and all', () => {
    const net = region();
    const r = layRegionRoads(net, REGION);
    // directed: a one-way road only from a to b
    const out = new Map<number, number[]>();
    for (const s of net.segs.values()) for (const [a, b] of s.oneway ? [[s.a, s.b]] : [[s.a, s.b], [s.b, s.a]]) (out.get(a) ?? out.set(a, []).get(a)!).push(b);
    const hubOf = (p: P) => [...net.nodes.values()].sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0].id;
    const hubs = REGION.settlements.map(hubOf);
    const reach = (from: number) => { const seen = new Set([from]), q = [from]; while (q.length) for (const n of out.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); } return seen; };
    for (const h of hubs) { const seen = reach(h); for (const o of hubs) expect(seen.has(o), `${h} reaches ${o}`).toBe(true); }
    // and the motorway takes you between the junctions' towns: the junctions' nodes reach each other
    for (const a of r.interchanges) { const seen = reach(a.nodes[0]); for (const b of r.interchanges) expect(seen.has(b.nodes[1])).toBe(true); }
    // every junction there designs as it should
    const forms = new Set<string>();
    for (const ix of r.interchanges) for (const n of ix.nodes) if (legsAt(net, n).length >= 3) forms.add(design(net, n, { fits: (p) => landFits(net, n, p) }, undefined, ix.prefer[n] ? { form: ix.prefer[n] } : undefined)!.form);
    expect([...forms].sort()).toEqual(['diverge', 'merge', 'roundabout']);
  }, 120_000);

  it('lies along the big places', () => {
    const line = motorwayLine(REGION);
    expect(line.length).toBe(2);
  });
});
