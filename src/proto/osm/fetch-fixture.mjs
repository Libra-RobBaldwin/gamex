// One-off: fetch a town from Overpass and trim it into a fixture (fixtures/<place>.json).
//   node src/proto/osm/fetch-fixture.mjs [place]              (fetch, then trim; banbury by default)
//   node src/proto/osm/fetch-fixture.mjs [place] raw.json     (trim a file fetched earlier)
//   POSTCODE='...' node src/proto/osm/fetch-fixture.mjs horley --check
//       (says whether a postcode sits comfortably inside the place's box, and nothing else: the
//        postcode is read from the environment, never printed or written anywhere)
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
// Horley town centre: the station and High Street on the Brighton Main Line, and the A23 (about
// 2.4 × 2.5 km)
export const PLACES = {
  banbury: [52.0548, -1.343, 52.0682, -1.321], // south, west, north, east
  horley: [51.1676, -0.1908, 51.1896, -0.1568],
};
const MIRRORS = (process.env.OVERPASS ? [process.env.OVERPASS] : []).concat(['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']);
const args = process.argv.slice(2);
const place = args.find((a) => PLACES[a]) ?? 'banbury';
const BBOX = PLACES[place];
const post = (q) => {
  for (const url of MIRRORS) {
    try {
      const out = execFileSync('curl', ['-s', '-f', '-m', '180', '-A', 'gamex-osm-prototype/0.1 (occasional test fixture)', '--data-urlencode', `data=${q}`, url], { encoding: 'utf8', maxBuffer: 64 << 20 });
      if (out.trim().startsWith('{')) return out;
      console.error(`${url}: not JSON, trying the next mirror`);
    } catch (e) { console.error(`${url}: failed (curl exit ${e.status ?? '?'})`); } // (not the query: it may hold a postcode)
  }
  throw new Error('every Overpass mirror failed');
};

if (args.includes('--check')) {
  const code = process.env.POSTCODE;
  if (!code) throw new Error('set POSTCODE in the environment');
  const [s, w, n, e] = BBOX, pad = 0.03; // look a little outside the box too
  const q = `[out:json][timeout:60][bbox:${s - pad},${w - pad},${n + pad},${e + pad}];(node["addr:postcode"="${code}"];way["addr:postcode"="${code}"];);out center;`;
  const pts = JSON.parse(post(q)).elements.map((el) => el.center ?? el).filter((p) => p.lat !== undefined);
  if (!pts.length) { console.log('postcode not found near the box'); process.exit(1); }
  const mLat = 111320, mLon = 111320 * Math.cos(((s + n) / 2) * Math.PI / 180);
  // the least room any address with it has to the box's nearest edge, in metres (negative: outside)
  const room = Math.min(...pts.map((p) => Math.min((p.lat - s) * mLat, (n - p.lat) * mLat, (p.lon - w) * mLon, (e - p.lon) * mLon)));
  console.log(room > 200 ? `inside, with at least ${Math.floor(room / 100) * 100} m to spare` : room > 0 ? 'inside, but close to an edge' : 'outside the box');
  // --fit lat,lon: a 1.6 km box on that centre, moved only as far as it must be for the postcode
  // to sit at least 300 m inside. Prints the box and nothing about where the postcode is.
  const fit = args[args.indexOf('--fit') + 1];
  if (args.includes('--fit') && fit) {
    const [clat, clon] = fit.split(',').map(Number), hl = 800 / mLat, ho = 800 / mLon, m = 300;
    // the shift that keeps every address at least m inside, as small as possible
    const shift = (vals, c, h, k) => {
      const lo = Math.max(...vals.map((v) => v + k - (c + h))), hi = Math.min(...vals.map((v) => v - k - (c - h)));
      return Math.max(lo, Math.min(hi, 0));
    };
    const dLat = shift(pts.map((p) => p.lat), clat, hl, m / mLat), dLon = shift(pts.map((p) => p.lon), clon, ho, m / mLon);
    const r = (v) => Math.round(v * 1e4) / 1e4;
    console.log(`box: [${r(clat - hl + dLat)}, ${r(clon - ho + dLon)}, ${r(clat + hl + dLat)}, ${r(clon + ho + dLon)}] (moved ${Math.round(Math.hypot(dLat * mLat, dLon * mLon))} m off the centre)`);
  }
  // --span lat,lon: the smallest box holding that centre (400 m round it) and the postcode (300 m)
  const span = args[args.indexOf('--span') + 1];
  if (args.includes('--span') && span) {
    const [clat, clon] = span.split(',').map(Number);
    const lats = [clat - 400 / mLat, clat + 400 / mLat, ...pts.flatMap((p) => [p.lat - 300 / mLat, p.lat + 300 / mLat])];
    const lons = [clon - 400 / mLon, clon + 400 / mLon, ...pts.flatMap((p) => [p.lon - 300 / mLon, p.lon + 300 / mLon])];
    const r = (v) => Math.round(v * 1e4) / 1e4, b = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];
    console.log(`span: [${b.map(r).join(', ')}], ${((b[3] - b[1]) * mLon / 1000).toFixed(1)} km east-west by ${((b[2] - b[0]) * mLat / 1000).toFixed(1)} km north-south`);
  }
  process.exit(0);
}

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
const file0 = args.find((a) => a.endsWith('.json'));
const raw = file0 ? readFileSync(file0, 'utf8') : post(query);
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
const file = join(here, 'fixtures', `${place}.json`);
writeFileSync(file, text);
console.log(`${elements.length} elements, ${(text.length / 1024).toFixed(0)} KB -> ${file}`);
