// OSM tags to the road and rail catalogue (catalog.ts). The catalogue is built from a few rules
// (lanes each way, speed, what's at the kerb), so the mapping reads the same things from the tags
// and snaps them to the nearest cross-section that exists. Where it has to round (a 30 mph dual
// carriageway becomes the 40 mph one, the slowest there is) it says so in `approx`, so the
// report can show how far the game's version is from the real road.

import { ROADS } from '../catalog';
import type { Tags } from './overpass';

export type RoadKind = 'road' | 'rail' | 'link' | 'skip';
// what the importer does with a way, before any geometry is looked at
export function classify(t: Tags): { kind: RoadKind; why?: string } {
  const h = t.highway, r = t.railway;
  if (r) {
    if (['rail', 'light_rail', 'tram', 'narrow_gauge', 'subway', 'funicular'].includes(r)) {
      if (['siding', 'yard', 'crossover'].includes(t.service ?? '')) return { kind: 'skip', why: `railway ${t.service}` };
      return { kind: 'rail' };
    }
    return { kind: 'skip' };
  }
  if (!h) return { kind: 'skip' };
  if (t.area === 'yes') return { kind: 'skip', why: 'road area' };
  if (/_link$/.test(h)) return { kind: 'link' };
  if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'road'].includes(h)) return { kind: 'road' };
  if (h === 'service') return ['parking_aisle', 'driveway', 'drive-through', 'emergency_access'].includes(t.service ?? '') ? { kind: 'skip' } : { kind: 'road' };
  if (h === 'pedestrian') return { kind: 'skip', why: 'pedestrian street' };
  if (h === 'busway' || h === 'bus_guideway') return { kind: 'skip', why: 'busway' };
  return { kind: 'skip' };
}

// "30 mph", "48" (km/h), "GB:nsl_single" and friends, in mph (undefined when missing or unreadable)
export function parseMph(v?: string): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (s === 'gb:nsl_single' || s === 'national' || s === 'gb:nsl_restricted') return 60;
  if (s === 'gb:nsl_dual' || s === 'gb:motorway' || s === 'uk:motorway') return 70;
  const zone = /zone:?(\d+)/.exec(s);
  if (zone) return +zone[1];
  const m = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/.exec(s);
  if (!m) return undefined;
  return m[2] === 'mph' ? +m[1] : +m[1] / 1.609;
}

// OSM's `oneway`: +1 along the way, −1 against it, 0 both ways
export function onewayOf(t: Tags): 1 | -1 | 0 {
  const o = t.oneway;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no' || o === 'alternating' || o === 'reversible') return 0;
  // implied one-way
  if (t.junction === 'roundabout' || t.junction === 'circular' || t.highway === 'motorway') return 1;
  return 0;
}

const yes = (v?: string) => !!v && !['no', 'none', 'separate', 'shared_lane', 'no_parking', 'no_stopping', 'fire_lane', 'share_busway', 'separate'].includes(v);
// Is there a feature at the kerb on either side? (`key` is "cycleway", "busway", "parking" and so on)
function sideTag(t: Tags, keys: string[]) {
  return keys.some((k) => yes(t[k]) || yes(t[`${k}:both`]) || yes(t[`${k}:left`]) || yes(t[`${k}:right`]));
}
export const hasCycle = (t: Tags) => sideTag(t, ['cycleway']);
export const hasBus = (t: Tags) => sideTag(t, ['busway']) || /designated/.test(t['bus:lanes'] ?? '') || /designated/.test(t['psv:lanes'] ?? '') || +(t['lanes:bus'] ?? 0) > 0;
export const hasParking = (t: Tags) => sideTag(t, ['parking:lane', 'parking']) && !['no', 'no_stopping', 'no_parking'].includes(t['parking:both'] ?? t['parking:lane:both'] ?? '');

// The speed a road is signed at, or the usual UK limit for its class when it isn't tagged.
export function mphOf(t: Tags, dual = false): number {
  const m = parseMph(t.maxspeed);
  if (m) return m;
  const h = (t.highway ?? '').replace(/_link$/, '');
  if (h === 'motorway') return 70;
  if (h === 'trunk') return dual ? 70 : 60;
  if (h === 'living_street' || h === 'service') return 20;
  return 30; // an urban road with no limit posted: street lighting means 30
}

// General traffic lanes each way. For one carriageway of a dual that's all its lanes. A one-way
// street standing alone becomes a two-way road of about the same width, so its lanes are shared
// out between the two directions.
export function lanesOf(t: Tags, mode: 'carriageway' | 'twoway' | 'oneway'): number {
  const bus = Math.max(0, Math.round(+(t['lanes:bus'] ?? 0) || 0));
  const n = Math.round(+(t.lanes ?? NaN));
  const h = (t.highway ?? '').replace(/_link$/, '');
  if (mode === 'carriageway') {
    if (n > 0) return Math.max(1, n - bus);
    return ['motorway', 'trunk', 'primary', 'secondary'].includes(h) ? 2 : 1;
  }
  if (mode === 'oneway') return n > 0 ? Math.max(1, Math.ceil((n - bus) / 2)) : 1;
  const f = Math.round(+(t['lanes:forward'] ?? NaN)), b = Math.round(+(t['lanes:backward'] ?? NaN));
  if (f > 0 || b > 0) return Math.max(1, f || 0, b || 0);
  if (n > 0) return Math.max(1, Math.floor((n - bus) / 2));
  return h === 'motorway' ? 3 : 1;
}

const nearest = (v: number, opts: number[]) => opts.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

export interface RoadMatch { id: string; approx: string[] }

// The catalogue id for a road. `dual` says the way is one of a pair of carriageways that the
// importer will join into one road (lanes then means lanes per carriageway).
export function roadTypeFor(t: Tags, dual = false): RoadMatch {
  const approx: string[] = [];
  const h = (t.highway ?? 'road').replace(/_link$/, '');
  const lanes = lanesOf(t, dual ? 'carriageway' : onewayOf(t) !== 0 ? 'oneway' : 'twoway');
  const rawMph = Math.round(mphOf(t, dual));
  const bus = hasBus(t), cycle = hasCycle(t), parking = hasParking(t);
  const fit = (mph: number, allowed: number[]) => {
    const m = nearest(mph, allowed);
    if (m !== mph) approx.push(`${mph} mph signed, nearest is ${m} mph`);
    return m;
  };
  // a bus lane and parking don't share a kerb in the catalogue: the bus lane wins
  const arterial = (n: number, mph: number) => {
    if (bus && parking) approx.push('bus lane and parking on one kerb: kept the bus lane');
    return `arterial-${n}-${mph}-${bus ? 3.2 : 0}-${cycle ? 1.8 : 0}-${!bus && parking ? 2.2 : 0}`;
  };
  const done = (id: string): RoadMatch => {
    if (!ROADS[id]) throw new Error(`no catalogue entry ${id} for ${JSON.stringify(t)}`);
    return { id, approx };
  };

  if (dual) {
    if (h === 'motorway') {
      const L = lanes <= 2 ? 2 : lanes === 3 ? 3 : 4;
      if (L !== lanes) approx.push(`${lanes} lanes each way, nearest motorway has ${L}`);
      return done(L === 3 ? 'motorway' : `motorway-${L}`);
    }
    if (lanes === 1) {
      // there's no one-lane dual carriageway: the closest is a single carriageway with a hatched centre
      approx.push('dual carriageway with one lane each way: single carriageway with a hatched centre');
      fit(rawMph, [40]);
      return done(`arterial-1-40-0-${cycle ? 1.8 : 0}-0`);
    }
    const L = lanes >= 3 ? 3 : 2;
    if (L !== lanes) approx.push(`${lanes} lanes each way, nearest dual has ${L}`);
    const mph = fit(rawMph, [40, 50, 60, 70]);
    const b = bus && mph === 40 ? 3.2 : 0;
    if (bus && !b) approx.push('bus lane dropped: only 40 mph duals have them');
    if (cycle) approx.push('cycle lane dropped: duals have none');
    if (L === 2 && mph === 50 && !b) return done('dual');
    return done(`dual-${L}-${mph}-${b}`);
  }

  if (h === 'motorway' || (h === 'trunk' && rawMph >= 60 && lanes >= 2)) {
    // a motorway that isn't a pair of carriageways (clipped at the edge, or a single-carriageway stub)
    approx.push('single carriageway of a motorway class road');
    return done(lanes >= 3 ? 'motorway' : 'motorway-2');
  }

  // single carriageway, two or more lanes each way
  if (lanes >= 2) {
    if (lanes > 2) approx.push(`${lanes} lanes each way, nearest single carriageway has 2`);
    return done(arterial(2, fit(rawMph, [30, 40])));
  }

  // one lane each way
  const sidewalk = t.sidewalk ?? t['sidewalk:both'];
  const rural = sidewalk === 'no' || sidewalk === 'none';
  if (['trunk', 'primary', 'secondary'].includes(h) || (rawMph >= 40 && ['tertiary', 'unclassified', 'road'].includes(h))) {
    if (rawMph >= 45 || (rural && rawMph >= 40)) return done(`rural-${fit(rawMph, [40, 50, 60])}`);
    return done(arterial(1, fit(rawMph, [30, 40])));
  }
  // streets: residential, tertiary, unclassified, living streets, service roads
  const mph = fit(rawMph, [20, 30]);
  if (bus) approx.push('bus lane dropped: streets have none');
  const wide = Math.max(+(t['sidewalk:both:width'] ?? 0), +(t['sidewalk:left:width'] ?? 0), +(t['sidewalk:right:width'] ?? 0)) >= 3.5;
  const pave = wide ? 4 : 2.4;
  if (rural) approx.push('no footway in OSM, but streets always have one');
  const id = mph === 30 && pave === 2.4 && !parking && !cycle ? 'street' : `street-${mph}-${pave}-${parking ? 2.2 : 0}-${cycle ? 1.5 : 0}`;
  return done(id);
}

// The catalogue id for a railway. `paired` says two single-track ways run side by side and are
// being joined into one double-track line.
export function railTypeFor(t: Tags, paired = false): RoadMatch {
  const approx: string[] = [];
  const r = t.railway, mph = parseMph(t.maxspeed) ?? 0;
  if (r === 'light_rail' || r === 'tram' || r === 'subway') {
    if (!paired) approx.push('single-track light rail drawn as double track');
    return { id: 'rail-light', approx };
  }
  if (t.rack === 'yes' || r === 'funicular' || (t['rack'] && t['rack'] !== 'no')) return { id: 'rail-rack', approx };
  if (t.highspeed === 'yes' || mph >= 140) return { id: 'rail-hs', approx };
  if (paired) return { id: 'rail-main', approx };
  // a single track: the branch line is the only single-track adhesion railway
  if (t.usage === 'main') approx.push('one track of a main line, drawn as single track');
  return { id: 'rail-branch', approx };
}
