// One-off: fetch the Banbury test area from Overpass and trim it into a fixture.
//   node src/proto/osm/fetch-fixture.mjs            (fetch, then trim)
//   node src/proto/osm/fetch-fixture.mjs raw.json   (trim a file fetched earlier)
// Uses curl so it goes through the same proxy as everything else. Run it rarely: Overpass is a
// shared, volunteer-run service (https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
// The query and the trimming live in fetch.ts, shared with the Real Town Plans page.
// Data © OpenStreetMap contributors, available under the ODbL.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

// about 1.5 × 1.5 km of Banbury: the high street and market place, Banbury Cross, the Concord
// Avenue dual carriageway, the station and the Chiltern main line, the canal and river, and the
// industrial land east of the railway
export const BBOX = [52.0548, -1.343, 52.0682, -1.321]; // south, west, north, east
const MIRROR = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';

const here = dirname(fileURLToPath(import.meta.url));
const { module: fx } = await runnerImport(join(here, 'fetch.ts'));
const raw = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : execFileSync('curl', ['-sS', '-m', '180', '-A', 'gamex-osm-prototype/0.1 (one-off test fixture)', '--data-urlencode', `data=${fx.overpassQuery(BBOX)}`, MIRROR], { encoding: 'utf8', maxBuffer: 64 << 20 });
const out = fx.trimJson(JSON.parse(raw), BBOX);
const text = fx.fixtureText(out);
const file = join(here, 'fixtures', 'banbury.json');
writeFileSync(file, text);
console.log(`${out.elements.length} elements, ${(text.length / 1024).toFixed(0)} KB -> ${file}`);
