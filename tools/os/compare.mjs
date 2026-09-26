#!/usr/bin/env node
// Seeded against real (docs/real.md, "Priors"): the 50 km plans a seeded map makes, measured on the
// same yardsticks as the real regions' plans (real/world.ts), which the priors came from.
//
//   node --experimental-transform-types --no-warnings --import ./tools/os/ts-register.mjs tools/os/compare.mjs [seeds...]
//
// Writes docs/reports/os/seeded-vs-real.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planWorld, loadPlan } from '../../src/proto/worldmap/plan.ts';
import { setRegionReader } from '../../src/proto/real/world.ts';
import { readRegion } from '../../src/proto/real/node.ts';
import { PRIORS } from '../../src/proto/region/priors.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
setRegionReader(async (id) => readRegion(id, { half: 40000 }));
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const SEEDS = seeds.length ? seeds : [42, 7, 1234];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
function measure(p) {
  const H = p.half, S = p.settlements, water = p.water;
  // land: a 500 m grid of the square, less the sea
  let land = 0, n = 0;
  for (let x = -H + 250; x < H; x += 500) for (let z = -H + 250; z < H; z += 500) { n++; if (water.seaDistance(x, z, 1000) > 0) land++; }
  const landKm2 = (land / n) * (2 * H / 1000) ** 2;
  const by = (k) => S.filter((s) => s.kind === k);
  const towns = [...by('city'), ...by('town')], villages = by('village');
  const nn = (a, b) => a.map((s) => Math.min(...b.filter((t) => t !== s).map((t) => Math.hypot(t.x - s.x, t.z - s.z)))).filter(Number.isFinite);
  const km = (k) => p.roads.filter((r) => r.kind === k).reduce((t, r) => { let L = 0; for (let i = 1; i < r.path.length; i++) L += Math.hypot(r.path[i].x - r.path[i - 1].x, r.path[i].z - r.path[i - 1].z); return t + L; }, 0) / 1000;
  // a kind of road's grade, every 100 m (the heights the game draws)
  const gradesOf = (k) => {
    const g = [];
    for (const r of p.roads.filter((q) => q.kind === k)) for (let i = 4; i < r.path.length; i += 4) {
      const a = r.path[i - 4], b = r.path[i], d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d > 50) g.push(Math.abs(p.terrain.heightAt(b.x, b.z) - p.terrain.heightAt(a.x, a.z)) / d);
    }
    return g;
  };
  const gr = (g) => (g.length ? `${(median(g) * 100).toFixed(1)} / ${(pct(g, 0.9) * 100).toFixed(1)}` : 'n/a');
  const grades = gradesOf('A'), bGrades = gradesOf('B');
  const heights = [];
  for (let x = -H + 500; x < H; x += 1000) for (let z = -H + 500; z < H; z += 1000) if (water.seaDistance(x, z, 1000) > 0) heights.push(p.terrain.heightAt(x, z));
  return {
    'land (km²)': Math.round(landKm2),
    'towns and cities per 1,000 km²': +(towns.length / landKm2 * 1000).toFixed(1),
    'villages per 1,000 km²': +(villages.length / landKm2 * 1000).toFixed(1),
    'town to nearest town (km, median)': +(median(nn(towns, towns)) / 1000).toFixed(1),
    'village to nearest place (km, median)': +(median(nn(villages, S)) / 1000).toFixed(1),
    'largest places (people)': S.map((s) => s.pop).sort((a, b) => b - a).slice(0, 3).map((v) => Math.round(v / 100) * 100).join(', '),
    'A road km': Math.round(km('A')),
    'B and minor road km': Math.round(km('B')),
    'A road grade, median / 90th (%)': gr(grades),
    'B road and lane grade, median / 90th (%)': gr(bGrades),
    'land height, median / 90th (m)': `${Math.round(median(heights))} / ${Math.round(pct(heights, 0.9))}`,
    'railway km': Math.round(p.rails.reduce((t, r) => { let L = 0; for (let i = 1; i < r.path.length; i++) L += Math.hypot(r.path[i].x - r.path[i - 1].x, r.path[i].z - r.path[i - 1].z); return t + L; }, 0) / 1000),
  };
}

const cols = [];
for (const id of ['exe', 'teme']) { const t0 = performance.now(); const p = await loadPlan({ real: id, size: 50 }); cols.push({ name: `real: ${id}`, m: measure(p), ms: performance.now() - t0 }); }
for (const s of SEEDS) { const t0 = performance.now(); const p = planWorld({ seed: s, size: 50 }); cols.push({ name: `seeded: ${s}`, m: measure(p), ms: performance.now() - t0 }); }
const rows = Object.keys(cols[0].m);
const F = PRIORS.follow;
let md = `# Seeded against real: the 50 km plans on the same yardsticks

Made by \`tools/os/compare.mjs\` (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC). The real columns are the
bakes through \`real/world.ts\`; the seeded ones are \`planWorld\` for those seeds, at its defaults.
Seeded maps start with lanes only (PLAN.md decision 3), so their A road rows are empty; the trunk
planner's A roads are the priors' concern. \`PRIORS.follow\` measured every 50 m of the real roads
over Terrain 50: A roads ${F.a.gradeMedian.map((v) => (v * 100).toFixed(1)).join('–')}% median and ${F.a.gradeP90.map((v) => (v * 100).toFixed(1)).join('–')}% at the 90th;
minor roads ${F.minor.gradeMedian.map((v) => (v * 100).toFixed(1)).join('–')}% and ${F.minor.gradeP90.map((v) => (v * 100).toFixed(1)).join('–')}%. (The rows here sample every 100 m of the plan's
routes over the plan's heights, so they read a little lower.)

| | ${cols.map((c) => c.name).join(' | ')} |
|---|${cols.map(() => '---').join('|')}|
${rows.map((r) => `| ${r} | ${cols.map((c) => c.m[r]).join(' | ')} |`).join('\n')}
| plan made in (ms) | ${cols.map((c) => Math.round(c.ms)).join(' | ')} |
`;
mkdirSync(join(ROOT, 'docs/reports/os'), { recursive: true });
writeFileSync(join(ROOT, 'docs/reports/os/seeded-vs-real.md'), md);
console.log(md);
