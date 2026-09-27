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
import { layStreets } from '../../src/proto/region/generate.ts';

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
  // the land's own slope (rise over run over 100 m, every 400 m of land), and how directly the lanes
  // climb it: a lane's grade over the slope of the ground under it (real roads: about half, PRIORS.follow)
  const h = p.terrain.heightAt, slopeAt = (x, z) => Math.hypot((h(x + 50, z) - h(x - 50, z)) / 100, (h(x, z + 50) - h(x, z - 50)) / 100);
  const landSlopes = [];
  for (let x = -H + 500; x < H; x += 400) for (let z = -H + 500; z < H; z += 400) if (water.seaDistance(x, z, 1000) > 0) landSlopes.push(slopeAt(x, z));
  const overSlope = [];
  for (const r of p.roads.filter((q) => q.kind === 'B')) for (let i = 4; i < r.path.length; i += 4) {
    const a = r.path[i - 4], b = r.path[i], d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d < 50) continue;
    const s = slopeAt((a.x + b.x) / 2, (a.z + b.z) / 2);
    if (s > 0.01) overSlope.push(Math.abs(h(b.x, b.z) - h(a.x, a.z)) / d / s);
  }
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
    'land slope, median / 90th (%)': gr(landSlopes),
    'lane grade over the slope of its ground (median)': overSlope.length ? +median(overSlope).toFixed(2) : 'n/a',
    'land height, median / 90th (m)': `${Math.round(median(heights))} / ${Math.round(pct(heights, 0.9))}`,
    'railway km': Math.round(p.rails.reduce((t, r) => { let L = 0; for (let i = 1; i < r.path.length; i++) L += Math.hypot(r.path[i].x - r.path[i - 1].x, r.path[i].z - r.path[i - 1].z); return t + L; }, 0) / 1000),
  };
}

const cols = [];
for (const id of ['exe', 'teme']) { const t0 = performance.now(); const p = await loadPlan({ real: id, size: 50 }); cols.push({ name: `real: ${id}`, m: measure(p), ms: performance.now() - t0 }); }
for (const s of SEEDS) { const t0 = performance.now(); const p = planWorld({ seed: s, size: 50 }); cols.push({ name: `seeded: ${s}`, m: measure(p), ms: performance.now() - t0 }); }
const rows = Object.keys(cols[0].m);
const F = PRIORS.follow;
// a pair of measured values (the Exe's and the Teme's) as a range, low to high, or the one value
const span = (a) => { const lo = Math.min(...a), hi = Math.max(...a); return lo === hi ? `${lo}` : `${lo}–${hi}`; };
let md = `# Seeded against real: the 50 km plans on the same yardsticks

Made by \`tools/os/compare.mjs\` (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC). The real columns are the
bakes through \`real/world.ts\`; the seeded ones are \`planWorld\` for those seeds, at its defaults.
Seeded maps start with lanes only (PLAN.md decision 3), so their A road rows are empty; the trunk
planner's A roads are the priors' concern. \`PRIORS.follow\` measured every 50 m of the real roads
over Terrain 50: A roads ${F.a.gradeMedian.map((v) => (v * 100).toFixed(1)).join('–')}% median and ${F.a.gradeP90.map((v) => (v * 100).toFixed(1)).join('–')}% at the 90th;
minor roads ${F.minor.gradeMedian.map((v) => (v * 100).toFixed(1)).join('–')}% and ${F.minor.gradeP90.map((v) => (v * 100).toFixed(1)).join('–')}%. (The rows here sample every 100 m of the plan's
routes over the plan's heights, so they read a little lower.) A lane's grade is mostly its land's: the
real bakes' ground is two to three times steeper than a seeded lowland map's (the land slope row), so
the fair yardstick for the router is a lane's grade over the slope of the ground under it, which real
lanes take at about ${span(F.b.gradeOverSlope)} (B roads) to ${span(F.minor.gradeOverSlope)} (minor roads). The seeded lane km fall short of the
real minor road km because the plan has no hamlets: the real "villages" row counts every named place,
and a real 50 km square has ${span(PRIORS.settlements.perThousandKm2.hamlet)} hamlets per 1,000 km² on top of its ${span(PRIORS.settlements.perThousandKm2.village)} villages, each with its lanes.

| | ${cols.map((c) => c.name).join(' | ')} |
|---|${cols.map(() => '---').join('|')}|
${rows.map((r) => `| ${r} | ${cols.map((c) => c.m[r]).join(' | ')} |`).join('\n')}
| plan made in (ms) | ${cols.map((c) => Math.round(c.ms)).join(' | ')} |
`;

// ---------------- the places themselves: seeded street layouts against the real towns' ----------------
// (the real figures are PRIORS.towns and PRIORS.roads, measured by tools/os/towns.mjs and measure.mjs over
// the bakes' own streets; the seeded ones are layStreets over each seeded plan's places)
function places(p) {
  const out = { town: { radials: [], deadEnd: 0, tee: 0, cross: 0, pieces: [], bins: new Float64Array(36) }, village: { radials: [], deadEnd: 0, tee: 0, cross: 0, pieces: [], bins: new Float64Array(36) } };
  for (const s of p.settlements) {
    const T = s.kind === 'village' ? 'village' : 'town', o = out[T];
    const { streets } = layStreets({ ...s, gates: [] }, p.water, p.half);
    o.radials.push(s.spokes?.length ?? 0);
    const deg = new Map(), key = (q) => `${Math.round(q.x)},${Math.round(q.z)}`;
    for (const st of streets) { for (const q of [st.a, st.b]) deg.set(key(q), (deg.get(key(q)) ?? 0) + 1); const L = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z); o.pieces.push(L); const b = ((Math.atan2(st.b.z - st.a.z, st.b.x - st.a.x) * 180) / Math.PI + 360) % 180; o.bins[Math.floor(b / 10) % 18] += L; o.bins[(Math.floor(b / 10) % 18) + 18] += L; }
    // (a radial's end is where a lane leaves, not a dead end: the plan's lanes carry on from the spokes)
    const spokeKeys = new Set((s.spokes ?? []).map((k) => key(k)));
    for (const [k, d] of deg) { if (d === 1) { if (!spokeKeys.has(k)) o.deadEnd++; } else if (d === 3) o.tee++; else if (d >= 4) o.cross++; }
  }
  const order = (bins) => { const tot = bins.reduce((t, v) => t + v, 0); let Hh = 0; for (const v of bins) if (v > 0) Hh -= (v / tot) * Math.log(v / tot); const Hmax = Math.log(36), Hg = Math.log(4); return +(1 - ((Hh - Hg) / (Hmax - Hg)) ** 2).toFixed(2); };
  const row = (o) => { const n = o.deadEnd + o.tee + o.cross || 1; return { radials: median(o.radials), junctions: `${(o.deadEnd / n).toFixed(2)} / ${(o.tee / n).toFixed(2)} / ${(o.cross / n).toFixed(2)}`, piece: Math.round(median(o.pieces)), order: order(o.bins) }; };
  return { town: row(out.town), village: row(out.village) };
}
const PT = PRIORS.towns, PR = PRIORS.roads;
const realPlaces = { town: { radials: PT.radials.town[2], junctions: `${PR.junctions.deadEnd} / ${PR.junctions.tee} / ${PR.junctions.cross}`, piece: `${PR.streetPieceM[0][1]}–${PR.streetPieceM[1][1]}`, order: `${PR.orientationOrder.core[0]}–${PR.orientationOrder.core[1]} (core), ${PR.orientationOrder.suburb[0]}–${PR.orientationOrder.suburb[1]} (suburb)` }, village: { radials: PT.radials.village[2], junctions: '(as towns)', piece: '(as towns)', order: '(as towns)' } };
const seededPlaces = SEEDS.map((sd) => ({ seed: sd, m: places(planWorld({ seed: sd, size: 50 })) }));
md += `
## The places: the seeded street layouts on the real towns' yardsticks

The real column is what \`tools/os/towns.mjs\` and \`measure.mjs\` measured over the bakes' own streets
(\`PRIORS.towns\`, \`PRIORS.roads\`); the seeded columns are \`layStreets\` over every place on those plans.

| | real (measured) | ${SEEDS.map((sd) => `seeded: ${sd}`).join(' | ')} |
|---|---|${SEEDS.map(() => '---').join('|')}|
| radials per town (median) | ${realPlaces.town.radials} | ${seededPlaces.map((c) => c.m.town.radials).join(' | ')} |
| radials per village (median) | ${realPlaces.village.radials} | ${seededPlaces.map((c) => c.m.village.radials).join(' | ')} |
| junctions in towns: dead ends / T / crossroads | ${realPlaces.town.junctions} | ${seededPlaces.map((c) => c.m.town.junctions).join(' | ')} |
| junctions in villages: dead ends / T / crossroads | ${realPlaces.village.junctions} | ${seededPlaces.map((c) => c.m.village.junctions).join(' | ')} |
| street piece between junctions, towns (m, median) | ${realPlaces.town.piece} | ${seededPlaces.map((c) => c.m.town.piece).join(' | ')} |
| street piece, villages (m, median) | ${realPlaces.village.piece} | ${seededPlaces.map((c) => c.m.village.piece).join(' | ')} |
| orientation order, towns (1 a grid, 0 every bearing alike) | ${realPlaces.town.order} | ${seededPlaces.map((c) => c.m.town.order).join(' | ')} |
| orientation order, villages | ${realPlaces.village.order} | ${seededPlaces.map((c) => c.m.village.order).join(' | ')} |
`;
mkdirSync(join(ROOT, 'docs/reports/os'), { recursive: true });
writeFileSync(join(ROOT, 'docs/reports/os/seeded-vs-real.md'), md);
console.log(md);
