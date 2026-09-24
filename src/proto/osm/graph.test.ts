import { describe, expect, it } from 'vitest';
import type { P } from '../roads';
import { importOsm } from './import';
import type { OsmElement, Tags } from './overpass';
import { localProjection } from './projection';

// Small hand-made OSM datasets, laid out in local metres and turned into latitude and longitude.
const ORIGIN = { lat: 52.06, lon: -1.33 };
function osm() {
  const proj = localProjection(ORIGIN);
  const els: OsmElement[] = [];
  let id = 1;
  const node = (x: number, z: number, tags?: Tags) => { const { lat, lon } = proj.toLatLon({ x, z }); els.push({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) }); return id++; };
  const way = (nodes: number[], tags: Tags) => { els.push({ type: 'way', id, nodes, tags }); return id++; };
  const line = (from: P, to: P, n: number) => Array.from({ length: n + 1 }, (_, i) => node(from.x + ((to.x - from.x) * i) / n, from.z + ((to.z - from.z) * i) / n));
  return { node, way, line, run: () => importOsm({ elements: els }, { origin: ORIGIN }) };
}
const segsNear = (r: ReturnType<typeof importOsm>, p: P, d = 3) => {
  const n = r.net.nearestNode(p, d);
  return n ? r.net.segsAt(n.id) : [];
};

describe('dual carriageways', () => {
  const build = () => {
    const o = osm();
    const road: Tags = { highway: 'trunk', name: 'Test Road', oneway: 'yes', lanes: '2', maxspeed: '50 mph' };
    // eastbound on the north side, westbound on the south (we drive on the left), 20 m apart
    const east = o.line({ x: -300, z: -10 }, { x: 300, z: -10 }, 12);
    const west = o.line({ x: 300, z: 10 }, { x: -300, z: 10 }, 12);
    o.way(east, { ...road });
    o.way(west, { ...road });
    // a side road off the eastbound carriageway at x = 0
    const side = o.node(0, -150);
    o.way([side, east[6]], { highway: 'residential', name: 'Side Street' });
    // a road crossing both at x = 100, through the gap in the central reservation
    o.way([o.node(100, -150), east[8], west[4], o.node(100, 150)], { highway: 'secondary', name: 'Cross Road' });
    return o.run();
  };

  it('pairs the two carriageways into one centreline of a dual type', () => {
    const r = build();
    const duals = [...r.roads.values()].filter((x) => x.paired);
    expect(duals.length).toBeGreaterThan(0);
    for (const d of duals) {
      expect(d.type).toBe('dual');
      for (const p of r.net.path(r.net.segs.get(d.seg)!)) expect(Math.abs(p.z)).toBeLessThan(1);
    }
    expect(r.unsupported.filter((u) => u.kind === 'one-way street')).toEqual([]);
    // it runs the whole way, as one road with two junctions on it
    const len = duals.reduce((s, d) => s + r.net.length(r.net.segs.get(d.seg)!), 0);
    expect(len).toBeGreaterThan(590);
    expect(duals.length).toBe(3);
  });

  it('moves side roads onto the centreline', () => {
    const r = build();
    const t = segsNear(r, { x: 0, z: 0 });
    expect(t.map((s) => s.type).sort()).toEqual(['dual', 'dual', 'street']);
    // the crossing road meets the dual at one crossroads; its piece across the reservation is gone
    const x = segsNear(r, { x: 100, z: 0 });
    expect(x.length).toBe(4);
    expect(x.filter((s) => s.type === 'dual').length).toBe(2);
  });
});

describe('roundabouts', () => {
  const build = (drop = false) => {
    const o = osm();
    const R = 20, ring: number[] = [];
    for (let i = 0; i < 16; i++) { const a = (-i / 16) * Math.PI * 2; ring.push(o.node(Math.cos(a) * R, Math.sin(a) * R)); }
    const tags: Tags = { highway: 'primary', junction: 'roundabout', name: 'Test Circus' };
    for (let q = 0; q < 4; q++) {
      if (drop && q === 3) continue;
      o.way([...ring.slice(q * 4, q * 4 + 5), ...(q === 3 ? [ring[0]] : [])].slice(0, 5), tags);
    }
    // four approaches, one at each quarter
    for (let q = 0; q < 4; q++) {
      const a = (-q / 4) * Math.PI * 2;
      o.way([o.node(Math.cos(a) * 150, Math.sin(a) * 150), ring[q * 4]], { highway: 'primary', name: `Arm ${q}` });
    }
    return o.run();
  };

  it('collapses the ring into one node that remembers its radius', () => {
    const r = build();
    expect(r.hints.length).toBe(1);
    const h = r.hints[0];
    expect(h.form).toBe('roundabout');
    expect(h.complete).toBe(true);
    expect(h.name).toBe('Test Circus');
    expect(h.radius).toBeGreaterThan(19);
    expect(h.radius).toBeLessThan(21);
    expect(r.net.segsAt(h.netNode).length).toBe(4);
    expect(Math.hypot(r.net.node(h.netNode).x, r.net.node(h.netNode).z)).toBeLessThan(0.5);
    // the ring itself isn't a road
    expect(r.net.segs.size).toBe(4);
  });

  it('flags a ring that doesn\'t close', () => {
    const r = build(true);
    expect(r.hints[0].complete).toBe(false);
    expect(r.unsupported.map((u) => u.kind)).toContain('incomplete roundabout');
  });

  it('marks mini-roundabouts', () => {
    const o = osm();
    const c = o.node(0, 0, { highway: 'mini_roundabout' });
    o.way([o.node(-100, 0), c, o.node(100, 0)], { highway: 'residential' });
    o.way([o.node(0, -100), c], { highway: 'residential' });
    const r = o.run();
    expect(r.hints.map((h) => h.form)).toEqual(['mini']);
    expect(r.net.segsAt(r.hints[0].netNode).length).toBe(3);
  });
});

describe('what the game cannot do yet', () => {
  it('builds a lone one-way street two-way, and says so', () => {
    const o = osm();
    o.way(o.line({ x: 0, z: 0 }, { x: 200, z: 0 }, 4), { highway: 'residential', name: 'One Way', oneway: 'yes' });
    const r = o.run();
    expect([...r.roads.values()].map((x) => [x.type, x.oneway])).toEqual([['street', true]]);
    const u = r.unsupported.find((x) => x.kind === 'one-way street')!;
    expect(u.at.x).toBeCloseTo(100, 0);
    expect(u.latLon.lat).toBeCloseTo(ORIGIN.lat, 3);
  });

  it('leaves one-way slip roads out and lists them', () => {
    const o = osm();
    const main = o.line({ x: 0, z: 0 }, { x: 300, z: 0 }, 6);
    o.way(main, { highway: 'primary' });
    o.way([main[1], o.node(120, -20), o.node(200, -40)], { highway: 'primary_link', oneway: 'yes' });
    const r = o.run();
    expect([...r.roads.values()].every((x) => x.type !== undefined && !x.ways.includes(4))).toBe(true);
    expect(r.unsupported.map((u) => u.kind)).toContain('slip road');
    expect(r.dropped.size).toBe(1);
  });

  it('finds one-way loops', () => {
    const o = osm();
    const a = o.node(0, 0), b = o.node(120, 0), c = o.node(120, 80), d = o.node(0, 80);
    o.way([a, b, c, d, a], { highway: 'tertiary', oneway: 'yes', name: 'Loop Street' });
    const r = o.run();
    expect(r.unsupported.map((u) => u.kind)).toContain('gyratory');
  });
});

describe('railways', () => {
  it('joins two parallel tracks into one double-track line', () => {
    const o = osm();
    const tags: Tags = { railway: 'rail', usage: 'main', name: 'Test Main Line' };
    o.way(o.line({ x: -400, z: -2 }, { x: 400, z: -2 }, 10), tags);
    // the other track is drawn the other way round, as often happens
    o.way(o.line({ x: 400, z: 2 }, { x: -400, z: 2 }, 10), tags);
    const r = o.run();
    const rail = [...r.roads.values()].filter((x) => x.cls === 'rail');
    expect(rail.map((x) => x.type)).toEqual(['rail-main']);
    expect(r.net.length(r.net.segs.get(rail[0].seg)!)).toBeGreaterThan(790);
  });

  it('keeps a lone track as a single-track line', () => {
    const o = osm();
    o.way(o.line({ x: -400, z: 0 }, { x: 400, z: 0 }, 10), { railway: 'rail', usage: 'branch' });
    o.way(o.line({ x: -100, z: 5 }, { x: 100, z: 5 }, 4), { railway: 'rail', service: 'siding' });
    const r = o.run();
    expect([...r.roads.values()].map((x) => x.type)).toEqual(['rail-branch']);
    expect(r.unsupported.map((u) => u.kind)).toContain('railway siding');
  });
});
