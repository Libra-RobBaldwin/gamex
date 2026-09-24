// What we ask Overpass for, and how its answer is trimmed into a fixture: one copy, shared by
// fetch-fixture.mjs (Node, through Vite's module runner) and the Real Town Plans page (the browser).
// Overpass is a shared, volunteer-run service: one query per area, rarely, and back off when busy
// (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
// Data © OpenStreetMap contributors, available under the ODbL.

import type { OsmElement, OverpassJson } from './overpass';

/** south, west, north, east */
export type Bbox = [number, number, number, number];

export const ATTRIBUTION_NOTE = 'Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright. Tags trimmed to those the importer reads.';

export function overpassQuery(bbox: readonly number[], timeout = 90) {
  return `[out:json][timeout:${timeout}][bbox:${bbox.join(',')}];
(
  way[highway][highway!~"^(footway|path|steps|bridleway|corridor|track|proposed|construction|elevator|platform)$"][service!~"^(driveway|parking_aisle|drive-through)$"];
  way[railway][railway!~"^(abandoned|razed|dismantled|proposed)$"];
  node[railway~"^(station|halt)$"];
  node[public_transport=station];
  way[building]; relation[building];
  way[landuse]; relation[landuse];
  way[natural~"^(water|wood|scrub|grassland|wetland)$"]; relation[natural=water];
  way[waterway]; way[leisure~"^(park|pitch|recreation_ground|garden|playground)$"];
  way[amenity]; node[amenity]; node[shop]; node[office];
);
out body; >; out skel qt;`;
}

// only the tags the importer (or a later pass) reads; the rest is address books and websites
export const KEEP = /^(highway|name|ref|lanes(:forward|:backward)?|maxspeed|oneway|junction|dual_carriageway|sidewalk(:.*)?|cycleway(:.*)?|parking:(lane|both|left|right)(:.*)?|busway(:.*)?|bus|psv|bridge|tunnel|layer|service|access|railway|usage|electrified|gauge|tracks|building|building:levels|height|roof:levels|min_height|amenity|shop|office|craft|industrial|landuse|natural|water|waterway|leisure|public_transport|station|type|area|tourism|healthcare|religion|man_made)$/;

const round = (v: number) => Math.round(v * 1e7) / 1e7;

/** One element with only what the importer reads: rounded positions, node lists, members, kept tags. */
export function trimElement(e: OsmElement): OsmElement {
  const o: Record<string, unknown> = { type: e.type, id: e.id };
  if ('lat' in e && e.lat !== undefined) { o.lat = round(e.lat); o.lon = round(e.lon); }
  if ('nodes' in e && e.nodes) o.nodes = e.nodes;
  if ('members' in e && e.members) o.members = e.members.map((m) => ({ type: m.type, ref: m.ref, role: m.role }));
  if (e.tags) {
    const t = Object.fromEntries(Object.entries(e.tags).filter(([k]) => KEEP.test(k)));
    if (Object.keys(t).length) o.tags = t;
  }
  return o as unknown as OsmElement;
}

/** What Overpass sends back, beyond the elements: kept in the fixture's header. */
export interface OverpassRaw extends OverpassJson { osm3s?: { timestamp_osm_base?: string; copyright?: string }; remark?: string }

/** A whole answer trimmed into the fixture format, with its box and the ODbL credit. */
export function trimJson(data: OverpassRaw, bbox: readonly number[]): OverpassRaw {
  return {
    version: data.version,
    generator: data.generator,
    osm3s: { timestamp_osm_base: data.osm3s?.timestamp_osm_base, copyright: data.osm3s?.copyright },
    attribution: ATTRIBUTION_NOTE,
    bbox: [...bbox],
    elements: data.elements.map(trimElement),
  };
}

/**
 * Tiles fetched separately into one answer. Whole ways come back from every tile they cross, and
 * `out body; >; out skel` repeats nodes without their tags, so each element is kept once, in the
 * order first seen, preferring a copy that carries tags. The header is the first tile's, with the
 * oldest data timestamp of all of them.
 */
export function mergeTiles(parts: OverpassRaw[]): OverpassRaw {
  const byKey = new Map<string, OsmElement>();
  for (const p of parts) for (const e of p.elements) {
    const k = `${e.type[0]}${e.id}`;
    const had = byKey.get(k);
    if (!had || (!had.tags && e.tags)) byKey.set(k, e);
  }
  const stamps = parts.map((p) => p.osm3s?.timestamp_osm_base).filter((s): s is string => !!s).sort();
  const first = parts[0] ?? { elements: [] };
  return { ...first, osm3s: { ...first.osm3s, timestamp_osm_base: stamps[0] }, remark: undefined, elements: [...byKey.values()] };
}

/** One element per line: small diffs if a fixture is ever refreshed, and still readable. */
export function fixtureText(out: OverpassRaw) {
  const head = Object.entries(out).filter(([k, v]) => k !== 'elements' && v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n');
  return `{${head},\n"elements":[\n${out.elements.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`;
}
