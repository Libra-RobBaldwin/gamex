#!/usr/bin/env node
// Pack a real region's live area ahead of time (docs/real.md, "Speed"): everything the game would
// otherwise work out while the player waits.
//
//   node --import ./tools/os/ts-register.mjs tools/os/pack.mjs exe [--home Exeter] [--half 4000]
//
// Runs the game's own code (the OSM importer's stages, the junction designer, the lot placer, the
// green space and the dead ends' paths) over the baked tiles, and writes
// public/regions/<id>/live/<home>.json: the map (relief, water, trees, places), the network (nodes
// and segments), each junction's chosen form, every building's lot (by 1 km tile, so they can go up
// as tiles come near), the parks and the dead ends' paths, as rounded columns (it compresses well).
// The game lays out nothing itself: the land claims come back from the roads and junctions.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readRegion } from '../../src/proto/real/node.ts';
import { realMap } from '../../src/proto/real/map.ts';
import { layReal, placeLots, greenRegions, clearOf } from '../../src/proto/real/lay.ts';
import { Network, rng } from '../../src/proto/roads.ts';
import { centrality, centreDistance, plotCentre } from '../../src/proto/region/index.ts';
import { MapWater } from '../../src/proto/region/water.ts';
import { design, landFits, legsAt } from '../../src/proto/junction.ts';
import { deadEndPaths } from '../../src/proto/game/paths.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const id = args.find((a) => !a.startsWith('--') && !/^\d/.test(a) && args[args.indexOf(a) - 1]?.startsWith('--') !== true) ?? 'exe';
// (6 km while the real map plays on the region path; 8 km once it rides the 50 km world's live area)
const half = Number(opt('--half', 3000));
const t0 = performance.now(), times = {};
const lap = (k) => { times[k] = Math.round(performance.now() - (lap.t ?? t0)); lap.t = performance.now(); };

const R = readRegion(id, { home: opt('--home'), half });
const map = realMap(R, { home: opt('--home'), half });
lap('map');
const water = new MapWater(map.water);
const net = new Network((p) => water.edgeDistance(p, 20) < 9, map.bound, 11);
net.edge = map.bound * 1.5;
const laid = layReal(net, map.real.overpass, map.settlements);
lap('roads');
const junctions = [];
for (const n of net.nodes.values()) {
  if (legsAt(net, n.id).length < 3) continue;
  const j = design(net, n.id, { fits: (polys) => landFits(net, n.id, polys) });
  if (!j) continue;
  junctions.push(j);
  net.land.claim(`junction:${n.id}`, 'junction', j.shape?.claims ?? []);
}
lap('junctions');
// the plots the town grows on, as the game would queue them once the roads are down (main.ts
// queuePlots): along every road and round each roundabout, then kept clear of the real buildings
const rand = rng(map.seed), centreFor = (a, b = { x: a.x + 1, z: a.z }) => plotCentre(map, a, b);
let queue = [];
for (const s of net.segs.values()) for (const p of net.plotsFor(s.id, centreFor(net.node(s.a), net.node(s.b)))) if (centrality(map, p) < 200 || rand() < 0.75) queue.push(p);
for (const j of junctions) {
  if (j.form !== 'roundabout' || !j.shape) continue;
  const legs = legsAt(net, j.node).map((l) => ({ seg: l.seg.id, ang: l.ang, half: net.half(l.seg) }));
  queue.push(...net.plotsAround(j.node, j.R + 3, legs, centreFor(net.node(j.node))));
}
lap('plots');
const lots = placeLots(net, laid.lots);
net.lots.push(...lots);
queue = queue.filter(clearOf(lots)).sort((a, b) => centreDistance(map, a) - centreDistance(map, b));
lap('buildings');
const parks = greenRegions(net, lots, map.real.green);
const paths = deadEndPaths(net, net.lots);
lap('parks and paths');
// (the relief as whole decimetres: it's the ground everything stands on)
const g = map.ground, dm = new Int16Array(g.h.length);
for (let k = 0; k < dm.length; k++) dm[k] = Math.round(g.h[k] * 10);
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const TILE = 1000, tileOf = (x, z) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
// lots as columns, each with the 1 km tile it stands in (the game puts a tile's up as it comes near)
const kinds = [...new Set([...net.lots, ...queue].map((l) => l.kind))], archs = [...new Set([...net.lots, ...queue].map((l) => l.arch ?? ''))], tiles = [...new Set(net.lots.map((l) => tileOf(l.x, l.z)))];
const cols = (ls, tile) => {
  const col = (f) => ls.map(f);
  return {
    ...(tile ? { tile: col((l) => tiles.indexOf(tileOf(l.x, l.z))) } : {}), id: col((l) => l.id), x: col((l) => r2(l.x)), z: col((l) => r2(l.z)), rot: col((l) => r3(l.rot)),
  w: col((l) => r2(l.w)), d: col((l) => r2(l.d)), h: col((l) => r2(l.h)), front: col((l) => r2(l.front)), back: col((l) => r2(l.back)), px: col((l) => r2(l.px)), pw: col((l) => r2(l.pw)),
  kind: col((l) => kinds.indexOf(l.kind)), arch: col((l) => archs.indexOf(l.arch ?? '')), seg: col((l) => l.seg), seed: col((l) => r3(l.seed)), row: col((l) => l.row),
  };
};
const lotCols = cols(net.lots, true);
const types = [...new Set([...net.segs.values()].map((s) => s.type))];
const out = {
  format: 2, region: id, centre: map.real.centre, name: map.name, half, tile: TILE,
  map: { ...map, real: undefined, ground: { x0: g.x0, z0: g.z0, step: g.step, n: g.n, max: g.max, dm: Buffer.from(dm.buffer).toString('base64') }, trees: { count: map.trees.count, spots: map.trees.spots.map((p) => [Math.round(p.x), Math.round(p.z)]) } },
  nextId: net.nextId, rand: net.randState,
  nodes: [...net.nodes.values()].map((n) => [n.id, r2(n.x), r2(n.z), r2(n.y ?? 0)]),
  types, segs: [...net.segs.values()].map((s) => [s.id, s.a, s.b, types.indexOf(s.type), s.mid.flatMap((p) => [r2(p.x), r2(p.z)]), s.oneway ? 1 : 0]),
  // (each junction's chosen form: the game designs it in that form, without trying the others)
  forms: junctions.map((j) => [j.node, j.form, j.slip ? 1 : 0]),
  kinds, archs, tiles, lots: lotCols,
  // (the plots the town grows on, nearest a centre first)
  queue: cols(queue, false),
  parks: parks.map((r) => ({ id: r.id, kind: r.kind, seed: r.seed, cells: r.cells.flatMap((c) => [Math.round(c.x / 5), Math.round(c.z / 5)]) })),
  stations: map.real.stations,
  paths: paths.map((p) => [p.node, r2(p.a.x), r2(p.a.z), r2(p.b.x), r2(p.b.z), p.through ? 1 : 0]),
  stats: { segs: net.segs.size, junctions: junctions.length, lots: net.lots.length, queue: queue.length, parks: parks.length, paths: paths.length, tiles: tiles.length },
};
const home = (opt('--home') ?? map.name.split(' · ')[0]).toLowerCase().replace(/[^a-z]+/g, '-');
const dir = join(ROOT, 'public/regions', id, 'live');
mkdirSync(dir, { recursive: true });
const json = JSON.stringify(out);
writeFileSync(join(dir, `${home}.json`), json);
lap('write');
console.log(JSON.stringify({ file: `public/regions/${id}/live/${home}.json`, mb: +(json.length / 1e6).toFixed(2), gzipMb: +(gzipSync(json).length / 1e6).toFixed(2), times, stats: out.stats }));
