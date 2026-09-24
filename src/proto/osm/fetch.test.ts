import fixture from './fixtures/banbury.json?raw';
import { describe, expect, it } from 'vitest';
import { parseOverpass } from './overpass';
import { KEEP, fixtureText, mergeTiles, overpassQuery, trimElement, trimJson, type OverpassRaw } from './fetch';


describe('the shared Overpass query and trim', () => {
  it('asks for the box, with a server-side time limit', () => {
    const q = overpassQuery([52, -1.4, 52.01, -1.39]);
    expect(q.startsWith('[out:json][timeout:90][bbox:52,-1.4,52.01,-1.39];')).toBe(true);
    expect(q).toContain('out body; >; out skel qt;');
  });

  it('keeps only the tags the importer reads, and rounds positions to 7 places', () => {
    const e = trimElement({ type: 'node', id: 1, lat: 52.123456789, lon: -1.987654321, tags: { amenity: 'pub', name: 'The Bell', website: 'x', 'addr:street': 'High St', phone: '1' } });
    expect(e).toEqual({ type: 'node', id: 1, lat: 52.1234568, lon: -1.9876543, tags: { amenity: 'pub', name: 'The Bell' } });
    expect(trimElement({ type: 'way', id: 2, nodes: [1, 2], tags: { note: 'x' } })).toEqual({ type: 'way', id: 2, nodes: [1, 2] });
    expect(KEEP.test('cycleway:left')).toBe(true);
    expect(KEEP.test('addr:postcode')).toBe(false);
  });

  it('drops extra member fields and credits the ODbL', () => {
    const out = trimJson({ version: 0.6, generator: 'g', osm3s: { timestamp_osm_base: 't', copyright: 'c' }, elements: [{ type: 'relation', id: 3, members: [{ type: 'way', ref: 1, role: 'outer', geometry: [] } as never], tags: { type: 'multipolygon', landuse: 'retail' } }] }, [1, 2, 3, 4]);
    expect(out.elements[0]).toEqual({ type: 'relation', id: 3, members: [{ type: 'way', ref: 1, role: 'outer' }], tags: { type: 'multipolygon', landuse: 'retail' } });
    expect(out.attribution).toMatch(/OpenStreetMap contributors.*ODbL/);
    expect(out.bbox).toEqual([1, 2, 3, 4]);
  });

  it('reproduces the Banbury fixture byte for byte (fetch-fixture.mjs writes it with this code)', () => {
    const json = JSON.parse(fixture) as OverpassRaw;
    expect(fixtureText(trimJson(json, json.bbox!))).toBe(fixture);
  });
});

describe('merging tiles', () => {
  const a: OverpassRaw = { version: 0.6, osm3s: { timestamp_osm_base: '2026-09-24T08:00:00Z' }, elements: [
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'node', id: 1, lat: 1, lon: 1 },
    { type: 'node', id: 2, lat: 2, lon: 2 },
  ] };
  const b: OverpassRaw = { version: 0.6, osm3s: { timestamp_osm_base: '2026-09-24T07:00:00Z' }, elements: [
    { type: 'node', id: 2, lat: 2, lon: 2, tags: { highway: 'crossing' } },
    { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
    { type: 'relation', id: 10, members: [], tags: { type: 'multipolygon' } },
    { type: 'node', id: 3, lat: 3, lon: 3 },
  ] };

  it('keeps each element once, in first-seen order, preferring the tagged copy', () => {
    const m = mergeTiles([a, b]);
    expect(m.elements.map((e) => `${e.type}${e.id}`)).toEqual(['way10', 'node1', 'node2', 'relation10', 'node3']);
    expect(m.elements[2].tags).toEqual({ highway: 'crossing' });
  });

  it('takes the oldest data timestamp, so the file never claims to be newer than its oldest tile', () => {
    expect(mergeTiles([a, b]).osm3s?.timestamp_osm_base).toBe('2026-09-24T07:00:00Z');
  });

  it('merges the fixture with itself into the same data', () => {
    const json = JSON.parse(fixture) as OverpassRaw;
    const once = mergeTiles([json]), twice = mergeTiles([json, json]);
    expect(twice.elements).toEqual(once.elements);
    // the fixture repeats nodes (tagged, then bare from `out skel`): each is kept once, with its tags
    const p1 = parseOverpass(json), p2 = parseOverpass(twice);
    expect([p2.nodes.size, p2.ways.size, p2.relations.size]).toEqual([p1.nodes.size, p1.ways.size, p1.relations.size]);
    expect(twice.elements.length).toBe(p1.nodes.size + p1.ways.size + p1.relations.size);
    expect([...p2.nodes.values()].filter((n) => n.tags).length).toBe([...p1.nodes.values()].filter((n) => n.tags).length);
  });
});
