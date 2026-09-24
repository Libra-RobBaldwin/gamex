// One-off: fetch the Banbury test area from Overpass and trim it into a fixture.
//   node src/proto/osm/fetch-fixture.mjs            (fetch, then trim)
//   node src/proto/osm/fetch-fixture.mjs raw.json   (trim a file fetched earlier)
// Uses curl so it goes through the same proxy as everything else. Run it rarely: Overpass is a
// shared, volunteer-run service (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
// Data © OpenStreetMap contributors, available under the ODbL.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// about 1.5 × 1.5 km of Banbury: the high street and market place, Banbury Cross, the Concord
// Avenue dual carriageway, the station and the Chiltern main line, the canal and river, and the
// industrial land east of the railway
export const BBOX = [52.0548, -1.343, 52.0682, -1.321]; // south, west, north, east
const MIRROR = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

const query = `[out:json][timeout:90][bbox:${BBOX.join(',')}];
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

// only the tags the importer (or a later pass) reads; the rest is address books and websites
const KEEP = /^(highway|name|ref|lanes(:forward|:backward)?|maxspeed|oneway|junction|dual_carriageway|sidewalk(:.*)?|cycleway(:.*)?|parking:(lane|both|left|right)(:.*)?|busway(:.*)?|bus|psv|bridge|tunnel|layer|service|access|railway|usage|electrified|gauge|tracks|building|building:levels|height|roof:levels|min_height|amenity|shop|office|craft|industrial|landuse|natural|water|waterway|leisure|public_transport|station|type|area|tourism|healthcare|religion|man_made)$/;

const here = dirname(fileURLToPath(import.meta.url));
const raw = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : execFileSync('curl', ['-sS', '-m', '180', '-A', 'gamex-osm-prototype/0.1 (one-off test fixture)', '--data-urlencode', `data=${query}`, MIRROR], { encoding: 'utf8', maxBuffer: 64 << 20 });
const data = JSON.parse(raw);
const round = (v) => Math.round(v * 1e7) / 1e7;
const elements = data.elements.map((e) => {
  const o = { type: e.type, id: e.id };
  if (e.lat !== undefined) { o.lat = round(e.lat); o.lon = round(e.lon); }
  if (e.nodes) o.nodes = e.nodes;
  if (e.members) o.members = e.members.map((m) => ({ type: m.type, ref: m.ref, role: m.role }));
  if (e.tags) {
    const t = Object.fromEntries(Object.entries(e.tags).filter(([k]) => KEEP.test(k)));
    if (Object.keys(t).length) o.tags = t;
  }
  return o;
});
const out = {
  version: data.version,
  generator: data.generator,
  osm3s: { timestamp_osm_base: data.osm3s?.timestamp_osm_base, copyright: data.osm3s?.copyright },
  attribution: 'Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0: https://www.openstreetmap.org/copyright. Tags trimmed to those the importer reads.',
  bbox: BBOX,
  elements,
};
// one element per line: small diffs if it's ever refreshed, and still readable
const text = `{${Object.entries(out).filter(([k]) => k !== 'elements').map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')},\n"elements":[\n${elements.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`;
const file = join(here, 'fixtures', 'banbury.json');
writeFileSync(file, text);
console.log(`${elements.length} elements, ${(text.length / 1024).toFixed(0)} KB -> ${file}`);
