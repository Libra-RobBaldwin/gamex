import { describe, expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { classify, lanesOf, onewayOf, parseMph, railTypeFor, roadTypeFor } from './tags';

describe('OSM tags to the catalogue', () => {
  it('reads speed limits in mph, km/h and UK national limits', () => {
    expect(parseMph('30 mph')).toBe(30);
    expect(Math.round(parseMph('48')!)).toBe(30);
    expect(parseMph('GB:nsl_single')).toBe(60);
    expect(parseMph('GB:nsl_dual')).toBe(70);
    expect(parseMph('GB:zone20')).toBe(20);
    expect(parseMph('signals')).toBeUndefined();
  });

  it('knows which ways are one-way, including the implied ones', () => {
    expect(onewayOf({ highway: 'primary', oneway: 'yes' })).toBe(1);
    expect(onewayOf({ highway: 'primary', oneway: '-1' })).toBe(-1);
    expect(onewayOf({ highway: 'tertiary', junction: 'roundabout' })).toBe(1);
    expect(onewayOf({ highway: 'motorway' })).toBe(1);
    expect(onewayOf({ highway: 'motorway', oneway: 'no' })).toBe(0);
    expect(onewayOf({ highway: 'residential' })).toBe(0);
  });

  it('counts lanes each way', () => {
    expect(lanesOf({ highway: 'primary', lanes: '4' }, 'twoway')).toBe(2);
    expect(lanesOf({ highway: 'primary', 'lanes:forward': '2', 'lanes:backward': '1', lanes: '3' }, 'twoway')).toBe(2);
    expect(lanesOf({ highway: 'primary', lanes: '3' }, 'carriageway')).toBe(3);
    expect(lanesOf({ highway: 'trunk' }, 'carriageway')).toBe(2);
    expect(lanesOf({ highway: 'residential', lanes: '1', oneway: 'yes' }, 'oneway')).toBe(1);
  });

  it('sorts ways into roads, railways, slip roads and the rest', () => {
    expect(classify({ highway: 'residential' }).kind).toBe('road');
    expect(classify({ highway: 'service', service: 'parking_aisle' }).kind).toBe('skip');
    expect(classify({ highway: 'primary_link' }).kind).toBe('link');
    expect(classify({ highway: 'footway' }).kind).toBe('skip');
    expect(classify({ highway: 'pedestrian' })).toEqual({ kind: 'skip', why: 'pedestrian street' });
    expect(classify({ railway: 'rail' }).kind).toBe('rail');
    expect(classify({ railway: 'rail', service: 'siding' }).kind).toBe('skip');
    expect(classify({ railway: 'platform' }).kind).toBe('skip');
  });

  // the mapping table: tags on the left, the cross-section the game builds on the right
  const table: [string, Record<string, string>, boolean, string][] = [
    ['plain residential street', { highway: 'residential' }, false, 'street'],
    ['20 mph street', { highway: 'residential', maxspeed: '20 mph' }, false, 'street-20-2.4-0-0'],
    ['service road', { highway: 'service' }, false, 'street-20-2.4-0-0'],
    ['living street', { highway: 'living_street' }, false, 'street-20-2.4-0-0'],
    ['street with parking both sides', { highway: 'residential', 'parking:lane:both': 'parallel' }, false, 'street-30-2.4-2.2-0'],
    ['street with parking (new scheme)', { highway: 'residential', 'parking:both': 'lane' }, false, 'street-30-2.4-2.2-0'],
    ['street with cycle lanes', { highway: 'tertiary', 'cycleway:both': 'lane' }, false, 'street-30-2.4-0-1.5'],
    ['street with wide pavements', { highway: 'tertiary', 'sidewalk:both:width': '4' }, false, 'street-30-4-0-0'],
    ['no cycle lanes when marked no', { highway: 'residential', 'cycleway:both': 'no' }, false, 'street'],
    ['town primary road', { highway: 'primary', maxspeed: '30 mph' }, false, 'arterial-1-30-0-0-0'],
    ['40 mph secondary with cycle lanes', { highway: 'secondary', maxspeed: '40 mph', cycleway: 'lane' }, false, 'arterial-1-40-0-1.8-0'],
    ['primary with bus lane', { highway: 'primary', 'busway:left': 'lane' }, false, 'arterial-1-30-3.2-0-0'],
    ['bus lane beats parking', { highway: 'primary', 'busway:left': 'lane', 'parking:both': 'lane' }, false, 'arterial-1-30-3.2-0-0'],
    ['four-lane single carriageway', { highway: 'primary', lanes: '4' }, false, 'arterial-2-30-0-0-0'],
    ['national-limit A road', { highway: 'primary', maxspeed: 'GB:nsl_single' }, false, 'rural-60'],
    ['50 mph country lane', { highway: 'unclassified', maxspeed: '50 mph' }, false, 'rural-50'],
    ['one-way street standing alone', { highway: 'residential', oneway: 'yes' }, false, 'street'],
    ['dual carriageway, 2 lanes, 50', { highway: 'trunk', maxspeed: '50 mph' }, true, 'dual'],
    ['dual carriageway, 3 lanes, 70', { highway: 'trunk', lanes: '3' }, true, 'dual-3-70-0'],
    ['urban dual with a bus lane', { highway: 'primary', maxspeed: '40 mph', 'busway:left': 'lane' }, true, 'dual-2-40-3.2'],
    ['30 mph dual rounds up to 40', { highway: 'primary', maxspeed: '30 mph', lanes: '2' }, true, 'dual-2-40-0'],
    ['one-lane dual: hatched centre', { highway: 'secondary', lanes: '1' }, true, 'arterial-1-40-0-0-0'],
    ['motorway, 3 lanes', { highway: 'motorway', lanes: '3' }, true, 'motorway'],
    ['motorway, 2 lanes', { highway: 'motorway', lanes: '2' }, true, 'motorway-2'],
    ['motorway, 5 lanes', { highway: 'motorway', lanes: '5' }, true, 'motorway-4'],
  ];
  for (const [name, tags, dual, id] of table) it(`${name} → ${id}`, () => {
    const m = roadTypeFor(tags, dual);
    expect(m.id).toBe(id);
    expect(ROADS[m.id]).toBeDefined();
  });

  it('says when it had to round', () => {
    expect(roadTypeFor({ highway: 'primary', maxspeed: '30 mph' }, true).approx.join()).toMatch(/nearest is 40/);
    expect(roadTypeFor({ highway: 'residential' }, false).approx).toEqual([]);
  });

  it('maps railways by use and speed', () => {
    expect(railTypeFor({ railway: 'rail', usage: 'main' }, true).id).toBe('rail-main');
    expect(railTypeFor({ railway: 'rail', usage: 'main' }, false).id).toBe('rail-branch');
    expect(railTypeFor({ railway: 'rail', usage: 'branch' }, false).id).toBe('rail-branch');
    expect(railTypeFor({ railway: 'rail', highspeed: 'yes' }, true).id).toBe('rail-hs');
    expect(railTypeFor({ railway: 'light_rail' }, true).id).toBe('rail-light');
    expect(railTypeFor({ railway: 'tram' }, false).id).toBe('rail-light');
    expect(railTypeFor({ railway: 'rail', rack: 'yes' }, false).id).toBe('rail-rack');
  });
});
