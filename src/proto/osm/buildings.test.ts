import { describe, expect, it } from 'vitest';
import { heightOf, kindOf, orientedRect } from './buildings';
import { importOsm } from './import';
import type { OsmElement, Tags } from './overpass';
import type { ZoneArea } from './landuse';
import { localProjection } from './projection';

const zone = (kind: ZoneArea['kind']): ZoneArea => ({ id: 'z', kind, outer: [], inner: [], tags: {}, area: 1e5 });

describe('footprints to rectangles', () => {
  it('fits the smallest rectangle round a turned footprint', () => {
    const a = 0.5, c = Math.cos(a), s = Math.sin(a);
    const corner = (u: number, v: number) => ({ x: 40 + u * c - v * s, z: -20 + u * s + v * c });
    // an L-shaped house, 12 × 8 overall, turned by half a radian
    const poly = [corner(-6, -4), corner(6, -4), corner(6, 0), corner(0, 0), corner(0, 4), corner(-6, 4)];
    const r = orientedRect(poly);
    expect(r.w * r.d).toBeCloseTo(96, 5);
    expect([r.w, r.d].map((v) => Math.round(v)).sort()).toEqual([12, 8].sort());
    expect(r.x).toBeCloseTo(40, 5);
    expect(r.z).toBeCloseTo(-20, 5);
    expect(Math.abs(Math.sin(2 * (r.rot - a)))).toBeLessThan(1e-9);
  });
});

describe('what a building is', () => {
  const table: [string, Tags, Tags[], ZoneArea | undefined, number, number, string][] = [
    ['tagged house', { building: 'house' }, [], undefined, 90, 0, 'house'],
    ['semi', { building: 'semidetached_house' }, [], undefined, 80, 1, 'house'],
    ['tagged terrace', { building: 'terrace' }, [], undefined, 400, 0, 'terrace'],
    ['house with two party walls', { building: 'house' }, [], undefined, 60, 2, 'terrace'],
    ['block of flats', { building: 'apartments' }, [], undefined, 600, 0, 'flats'],
    ['tall flats', { building: 'apartments', 'building:levels': '12' }, [], undefined, 600, 0, 'tower'],
    ['retail', { building: 'retail' }, [], undefined, 300, 0, 'shop'],
    ['office', { building: 'office' }, [], undefined, 300, 0, 'office'],
    ['warehouse', { building: 'warehouse' }, [], undefined, 3000, 0, 'industry'],
    ['church', { building: 'church' }, [], undefined, 300, 0, 'civic:church'],
    ['school', { building: 'yes', amenity: 'school' }, [], undefined, 900, 0, 'civic:school'],
    ['pub by its point', { building: 'yes' }, [{ amenity: 'pub', name: 'The Swan' }], undefined, 200, 0, 'civic:pub'],
    ['shop by its point', { building: 'yes' }, [{ shop: 'bakery' }], undefined, 120, 2, 'shop'],
    ['garage', { building: 'garage' }, [], undefined, 16, 0, 'minor'],
    ['plain building on an industrial estate', { building: 'yes' }, [], zone('industrial'), 800, 0, 'industry'],
    ['plain building on a retail park', { building: 'yes' }, [], zone('commercial'), 300, 0, 'shop'],
    ['plain house in a residential area', { building: 'yes' }, [], zone('residential'), 90, 0, 'house'],
    ['plain terraced house', { building: 'yes' }, [], zone('residential'), 60, 2, 'terrace'],
    ['big plain building, no clues', { building: 'yes' }, [], undefined, 4000, 0, 'industry'],
  ];
  for (const [name, t, pois, z, area, attached, want] of table) it(`${name} → ${want}`, () => {
    const k = kindOf(t, pois, z, area, attached);
    expect(k.minor ? 'minor' : k.arch && k.kind === 'civic' ? `civic:${k.arch}` : k.kind).toBe(want);
  });

  it('takes height from height, then storeys, then a default for the kind', () => {
    const house = kindOf({ building: 'house' }, [], undefined, 90, 0);
    expect(heightOf({ building: 'house', height: '12.5 m' }, house).h).toBe(12.5);
    expect(heightOf({ building: 'house', height: '30 ft' }, house).h).toBeCloseTo(9.144, 3);
    expect(heightOf({ building: 'house', 'building:levels': '3' }, house)).toEqual({ h: 11, levels: 3, why: 'levels' });
    expect(heightOf({ building: 'house', 'building:levels': '2', 'roof:levels': '1' }, house).h).toBe(8.5);
    expect(heightOf({ building: 'house' }, house)).toEqual({ h: 7.5, why: 'default' });
    const shed = kindOf({ building: 'shed' }, [], undefined, 8, 0);
    expect(heightOf({ building: 'shed' }, shed).h).toBeLessThan(3);
  });
});

describe('buildings face their road', () => {
  it('turns the plot to look at the street and measures its front garden', () => {
    const origin = { lat: 52.06, lon: -1.33 }, proj = localProjection(origin);
    const els: OsmElement[] = [];
    let id = 1;
    const node = (x: number, z: number) => { const q = proj.toLatLon({ x, z }); els.push({ type: 'node', id, lat: q.lat, lon: q.lon }); return id++; };
    // a street running east, and a 10 × 8 house 6 m behind the back of its pavement, to the north
    els.push({ type: 'way', id: 900, nodes: [node(-100, 0), node(100, 0)], tags: { highway: 'residential' } });
    const zb = -(3.25 + 2.4 + 6 + 4); // centreline to kerb, pavement, garden, half the house
    const h = [node(-5, zb - 4), node(5, zb - 4), node(5, zb + 4), node(-5, zb + 4)];
    els.push({ type: 'way', id: 901, nodes: [...h, h[0]], tags: { building: 'house' } });
    const r = importOsm({ elements: els }, { origin });
    const b = r.buildings[0], l = b.lot;
    expect(l.seg).toBe([...r.net.segs.keys()][0]);
    // local +z (the front) is (−sin rot, cos rot): it should point south (+z), at the road
    expect(Math.cos(l.rot)).toBeCloseTo(1, 5);
    expect(l.w).toBeCloseTo(10, 3);
    expect(l.d).toBeCloseTo(8, 3);
    expect(l.front).toBeCloseTo(6, 1);
    expect(b.kind).toBe('house');
    expect(r.net.lots).toContain(l);
    expect(b.poly.length).toBe(4);
  });
});
