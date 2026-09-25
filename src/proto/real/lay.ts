// A real map's roads, railways, stations and buildings into the game's own network, through the
// OSM importer's stages (src/proto/osm): the road graph, dropping slivers and duplicates, pairing
// carriageways and tracks, joining runs, then building each footprint's lot. The network's own
// junction designer, plots and building generator take it from there, as for any other map.
//
// Contains OS data © Crown copyright and database right (the Open Government Licence).
import { polysOverlap, rectCorners, type Lot, type Network, type P } from '../roads';
import { buildGraph, dropDuplicates, dropSlivers, joinRuns, pairCarriageways, reportOneWays, type Unsupported } from '../osm/graph';
import { emit } from '../osm/import';
import { buildingsOf } from '../osm/buildings';
import { stationsOf, type ZoneArea } from '../osm/landuse';
import { parseOverpass, type OverpassJson } from '../osm/overpass';
import { local, type XZ } from './osm';
import { CELL, type Region } from '../infill';
import type { RegionKind } from '../buildgen';
import { GREEN_CLASSES } from './format';

export interface Laid { lots: Lot[]; stations: { name?: string; x: number; z: number; seg?: number }[]; stats: Record<string, number>; ms: number }

// OS OpenMap Local has no land use, so a building's zone comes from where it stands: the core of a
// city or town (its inner quarter; a village's inner fifth) is commercial, the rest of a place's
// built-up area residential. Outside them the importer goes by size (big sheds are industry).
export interface Place { x: number; z: number; r: number; kind: 'city' | 'town' | 'village' }
export const CORE: Record<Place['kind'], number> = { city: 0.25, town: 0.25, village: 0.2 };
export function zoneFor(places: Place[]) {
  return (p: P): ZoneArea | undefined => {
    let kind: ZoneArea['kind'] | undefined;
    for (const s of places) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < s.r * CORE[s.kind]) return { kind: 'commercial' } as ZoneArea;
      if (d < s.r) kind = 'residential';
    }
    return kind ? ({ kind } as ZoneArea) : undefined;
  };
}

export function layReal(net: Network, json: OverpassJson, places: Place[] = []): Laid {
  const t0 = performance.now();
  const data = parseOverpass(json);
  const { g, unsupported, dropped } = buildGraph(data, local);
  const stationNodes = new Set(stationsOf(data, local).map((s) => s.id));
  const keep = (n: number) => g.node(n).osm.some((o) => stationNodes.has(o));
  const stats: Record<string, number> = { ways: data.ways.size, edges: g.edges.size, dropped: dropped.size };
  const un: Unsupported[] = unsupported;
  stats.slivers = dropSlivers(g, 1.5);
  stats.pairs = pairCarriageways(g, un);
  stats.slivers += dropSlivers(g, 3);
  stats.duplicates = dropDuplicates(g);
  reportOneWays(g, un);
  stats.joined = joinRuns(g, keep);
  const segs0 = net.segs.size;
  emit(g, net);
  stats.segs = net.segs.size - segs0;
  const residential = zoneFor(places);
  // (a big shed in a town's residential streets is still a shed: an estate's, a depot's)
  const { buildings } = buildingsOf(data, net, local, (p) => residential(p));
  for (const b of buildings) if (b.why.startsWith('zone') && b.kind === 'flats' && b.area > 2500) { b.kind = 'industry'; b.lot.kind = 'industry'; }
  const lots = buildings.filter((b) => !b.minor || b.area >= 20).map((b) => b.lot);
  stats.buildings = lots.length;
  const stations = stationsOf(data, local).map((s) => ({ name: s.name, x: s.at.x, z: s.at.z, seg: net.nearestSeg(s.at, 60, (q) => net.def(q).cls === 'rail')?.seg.id }));
  return { lots, stations, stats, ms: performance.now() - t0 };
}

// The real buildings onto the land: each where it stands, unless the water, the map's edge or a
// road's land (a catalogue road is often wider than the real street) is in the way; then moved
// back from its road up to 4 m, and made up to 30% smaller. Buildings that would overlap one already placed
// are left out (landmarks are placed first). A grid keeps it quick (a city has tens of thousands).
export function placeLots(net: Network, lots: Lot[], why: Record<string, number> = {}): Lot[] {
  const C = 40, grid = new Map<string, P[][]>(), out: Lot[] = [];
  const key = (x: number, z: number) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
  const clear = (l: Lot) => {
    const poly = rectCorners(l.x, l.z, l.rot, l.w + 0.6, l.d + 0.6);
    if (poly.some((p) => net.isWater(p) || Math.abs(p.x) > net.bound || Math.abs(p.z) > net.bound)) { why.water = (why.water ?? 0) + 1; return null; }
    if (!net.land.free(poly)) { why.land = (why.land ?? 0) + 1; return null; }
    const foot = rectCorners(l.x, l.z, l.rot, l.w - 1.2, l.d - 1.2); // (a real footprint's rectangle overshoots it a little)
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const o of grid.get(`${Math.floor(l.x / C) + di},${Math.floor(l.z / C) + dj}`) ?? []) if (polysOverlap(foot, o)) { why.overlap = (why.overlap ?? 0) + 1; return null; }
    return foot;
  };
  // (landmarks first: a church, a school, a hospital takes its land before the houses round it)
  const order = [...lots.filter((l) => l.kind === 'civic'), ...lots.filter((l) => l.kind !== 'civic')];
  for (const l of order) {
    // (local +z looks at the road: back away from it, and failing that, shrink a little)
    const bx = Math.sin(l.rot), bz = -Math.cos(l.rot), x = l.x, z = l.z, w = l.w, d = l.d;
    let foot: P[] | null = null;
    for (const k of [1, 0.9, 0.8, 0.7]) for (let m = 0; m <= 4 && !foot; m += 2) {
      if (foot) break;
      l.w = w * (k < 1 && w > 12 ? k : 1); l.d = d * k;
      l.x = x + bx * (m + (d - l.d) / 2); l.z = z + bz * (m + (d - l.d) / 2);
      foot = clear(l);
      if (foot) l.front += m + (d - l.d) / 2;
    }
    if (!foot) { l.x = x; l.z = z; l.w = w; l.d = d; }
    if (!foot) continue;
    l.back = 0; // (the real map's gardens are between its real buildings)
    (grid.get(key(l.x, l.z)) ?? grid.set(key(l.x, l.z), []).get(key(l.x, l.z))!).push(foot);
    out.push(l);
  }
  return out;
}
// Is a (generated) plot well clear of the real buildings? The town grows into open land, not
// into the real gardens.
export function clearOf(lots: Lot[], gap = 14) {
  const C = 50, grid = new Map<string, Lot[]>();
  for (const l of lots) { const k = `${Math.floor(l.x / C)},${Math.floor(l.z / C)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(l); }
  return (p: Lot) => {
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const o of grid.get(`${Math.floor(p.x / C) + di},${Math.floor(p.z / C) + dj}`) ?? []) {
      if (Math.hypot(o.x - p.x, o.z - p.z) < gap + (Math.max(o.w, o.d) + Math.max(p.w, p.d)) / 2) return false;
    }
    return true;
  };
}

// OS Open Greenspace as the town's parks: each site's 5 m cells that are clear of roads, water and
// the buildings (the same cells the leftover-land finder uses, infill.ts). Golf courses and other
// sites over 40 ha are left to the ground painter.
export interface Green { c: number; rings: XZ[][]; holes: boolean[] }
const GREEN_KIND: Record<(typeof GREEN_CLASSES)[number], RegionKind> = { park: 'park', playing: 'park', golf: 'park', allotment: 'allotments', cemetery: 'grounds', religious: 'grounds', play: 'playground', sport: 'park', bowls: 'park', tennis: 'park', other: 'park' };
export function greenRegions(net: Network, lots: Lot[], greens: Green[]): Region[] {
  const taken = new Set<string>(), key = (x: number, z: number) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  for (const l of lots) {
    const c = Math.cos(l.rot), s = Math.sin(l.rot), hw = l.w / 2 + CELL / 2, hd = l.d / 2 + l.front + CELL / 2;
    for (let u = -hw; u <= hw; u += CELL) for (let v = -hd; v <= l.d / 2 + CELL / 2; v += CELL) taken.add(key(l.x + u * c - v * s, l.z + u * s + v * c));
  }
  const out: Region[] = [];
  greens.forEach((g, k) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of g.rings[0]) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if ((x1 - x0) * (z1 - z0) > 400000) return;
    const cells: P[] = [];
    for (let x = Math.ceil(x0 / CELL) * CELL; x <= x1; x += CELL) for (let z = Math.ceil(z0 / CELL) * CELL; z <= z1; z += CELL) {
      if (Math.abs(x) > net.bound - CELL || Math.abs(z) > net.bound - CELL) continue;
      let inside = false;
      g.rings.forEach((r, i) => { if (inRing(x, z, r)) inside = !g.holes[i]; });
      if (!inside || taken.has(key(x, z)) || net.isWater({ x, z })) continue;
      const h = CELL * 0.45;
      if (!net.land.free([{ x: x - h, z: z - h }, { x: x + h, z: z - h }, { x: x + h, z: z + h }, { x: x - h, z: z + h }])) continue;
      cells.push({ x, z });
    }
    if (cells.length < 6) return;
    const cx = cells.reduce((s, p) => s + p.x, 0) / cells.length, cz = cells.reduce((s, p) => s + p.z, 0) / cells.length;
    out.push({ id: `os:${k}`, cells, kind: GREEN_KIND[GREEN_CLASSES[g.c]] ?? 'park', seed: (k * 2654435761) >>> 0, roadEdges: [], centre: { x: cx, z: cz } });
  });
  return out;
}
function inRing(x: number, z: number, r: XZ[]) {
  let s = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i].z > z) !== (r[j].z > z) && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) s = !s;
  return s;
}
