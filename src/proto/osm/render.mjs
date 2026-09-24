// Draw the Banbury fixture, imported and raw, into docs/reports for checking by eye:
//   node src/proto/osm/render.mjs
// Vite's module runner loads the TypeScript directly, so there's no build step.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const { module: imp } = await runnerImport(join(here, 'import.ts'));
const { module: svg } = await runnerImport(join(here, 'svg.ts'));
const json = JSON.parse(readFileSync(join(here, 'fixtures/banbury.json'), 'utf8'));
const t0 = performance.now();
const r = imp.importOsm(json);
const ms = performance.now() - t0;
writeFileSync(join(root, 'docs/reports/osm-import.svg'), svg.importSvg(r));
writeFileSync(join(root, 'docs/reports/osm-raw.svg'), svg.rawSvg(r.data, (la, lo) => r.projection.toLocal(la, lo), r.bounds));
console.log(`imported in ${ms.toFixed(0)} ms`);
console.log(JSON.stringify(r.stats, null, 1));
