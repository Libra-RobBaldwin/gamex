// OpenStreetMap to the game, in one call: Overpass JSON in, a Network (roads, railways, building
// plots) plus the land use, water, stations and junction hints the rest of the pipeline needs.
// Nothing here edits the engine: the network is built through its public API (addNode, addSeg,
// lots), so the importer can be swapped for a tile streamer later without touching roads.ts.
//
// Imported data is © OpenStreetMap contributors (ODbL). A game world built from it is a derived
// database: see docs/osm.md for what that obliges us to do.

import { Network, type P } from '../roads';
import { buildingsOf, type ImportedBuilding } from './buildings';
import { buildGraph, collapseRoundabouts, dropDuplicates, dropSlivers, joinRuns, pairCarriageways, reportOneWays, typeOf, type FormHint, type GEdge, type Graph, type Unsupported } from './graph';
import { stationsOf, waterOf, zoneLookup, zonesOf, type Station, type WaterLine, type ZoneArea } from './landuse';
import { parseOverpass, type OsmData, type OverpassJson } from './overpass';
import { localProjection, type LatLon, type Projection } from './projection';

export const ATTRIBUTION = '© OpenStreetMap contributors';
export const LICENCE = 'Open Database Licence (ODbL) 1.0 — https://www.openstreetmap.org/copyright';

export interface ImportedRoad {
  seg: number; type: string; cls: 'road' | 'rail'; name?: string; ref?: string;
  ways: number[]; // OSM ways it came from, and any folded into the junctions at its ends
  approx: string[];
  paired: boolean; // built from two carriageways (or tracks)
  oneway: boolean; // one-way in OSM, two-way in the game
  bridge: boolean; tunnel: boolean; layer: number;
}
export interface ImportedHint extends FormHint { netNode: number }
export interface Located extends Unsupported { latLon: LatLon }

export interface OsmImport {
  projection: Projection;
  net: Network;
  roads: Map<number, ImportedRoad>; // by network segment id
  hints: ImportedHint[]; // junction forms OSM tells us about (roundabouts, minis)
  buildings: ImportedBuilding[];
  zones: ZoneArea[];
  zoneAt: (p: P) => ZoneArea | undefined;
  water: { polys: ZoneArea[]; lines: WaterLine[] };
  isWater: (p: P) => boolean;
  stations: (Station & { seg?: number })[];
  unsupported: Located[];
  dropped: Map<number, string>; // OSM ways left out, and why
  bounds: { x0: number; z0: number; x1: number; z1: number };
  stats: Record<string, number | Record<string, number>>;
  data: OsmData;
}

export interface ImportOpts { origin?: LatLon; seed?: number }

export function importOsm(json: OverpassJson, opts: ImportOpts = {}): OsmImport {
  const data = parseOverpass(json);
  // centre on the requested box if we have one, else on the data
  let origin = opts.origin;
  if (!origin && json.bbox?.length === 4) origin = { lat: (json.bbox[0] + json.bbox[2]) / 2, lon: (json.bbox[1] + json.bbox[3]) / 2 };
  if (!origin) {
    let la = 0, lo = 0, n = 0;
    for (const v of data.nodes.values()) { la += v.lat; lo += v.lon; n++; }
    origin = { lat: la / (n || 1), lon: lo / (n || 1) };
  }
  const projection = localProjection(origin);
  const local = (lat: number, lon: number) => projection.toLocal(lat, lon);
  const bounds = json.bbox?.length === 4
    ? (() => { const a = local(json.bbox![0], json.bbox![1]), b = local(json.bbox![2], json.bbox![3]); return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z) }; })()
    : { x0: -800, z0: -800, x1: 800, z1: 800 };

  // land first: the network wants to know where the water is
  const { zones, skipped: zonesSkipped } = zonesOf(data, local);
  const zoneAt = zoneLookup(zones);
  const water = waterOf(data, zones, local);

  // roads and railways
  const { g, unsupported, dropped } = buildGraph(data, local);
  const stationNodes = new Set(stationsOf(data, local).map((s) => s.id));
  const keep = (n: number) => g.node(n).osm.some((o) => stationNodes.has(o) || data.nodes.get(o)?.tags?.railway === 'level_crossing');
  const counts: Record<string, number> = { edgesFromWays: g.edges.size };
  counts.slivers = dropSlivers(g, 1.5);
  counts.roundabouts = collapseRoundabouts(g, data, local, unsupported);
  counts.pairs = pairCarriageways(g, unsupported);
  counts.slivers += dropSlivers(g, 3);
  counts.duplicates = dropDuplicates(g);
  reportOneWays(g, unsupported);
  counts.joined = joinRuns(g, keep);

  const half = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) / 2 + 400;
  const net = new Network(water.isWater, half, opts.seed ?? 7);
  // the network's industrial zones are where it grows factories rather than houses
  net.zoneAt = (p) => (zoneAt(p)?.kind === 'industrial' ? 'industrial' : 'town');
  const { roads, nodeOf } = emit(g, net);
  const hints: ImportedHint[] = [...g.hints.values()].filter((h) => nodeOf.has(h.node)).map((h) => ({ ...h, netNode: nodeOf.get(h.node)! }));

  const { buildings, skipped: buildingsSkipped } = buildingsOf(data, net, local, zoneAt);
  net.lots.push(...buildings.map((b) => b.lot));

  // stations sit on (or beside) the nearest railway
  const stations = stationsOf(data, local).map((s) => ({ ...s, seg: net.nearestSeg(s.at, 60, (q) => net.def(q).cls === 'rail')?.seg.id }));

  const kinds: Record<string, number> = {};
  for (const u of unsupported) kinds[u.kind] = (kinds[u.kind] ?? 0) + 1;
  const types: Record<string, number> = {};
  for (const r of roads.values()) types[r.type] = (types[r.type] ?? 0) + 1;
  const bkinds: Record<string, number> = {};
  for (const b of buildings) { const k = b.minor ? 'outbuilding' : b.arch ? `civic:${b.arch}` : b.kind; bkinds[k] = (bkinds[k] ?? 0) + 1; }
  const zk: Record<string, number> = {};
  for (const z of zones) zk[z.kind] = (zk[z.kind] ?? 0) + 1;
  return {
    projection, net, roads, hints, buildings, zones, zoneAt, water: { polys: water.polys, lines: water.lines }, isWater: water.isWater,
    stations, dropped, bounds, data,
    unsupported: unsupported.map((u) => ({ ...u, latLon: projection.toLatLon(u.at) })),
    stats: {
      ...counts, nodes: net.nodes.size, segs: net.segs.size, roadSegs: [...roads.values()].filter((r) => r.cls === 'road').length, railSegs: [...roads.values()].filter((r) => r.cls === 'rail').length,
      buildings: buildings.length, zones: zones.length, stations: stations.length, hints: hints.length,
      unsupported: kinds, types, buildingKinds: bkinds, zoneKinds: zk, zonesSkipped, buildingsSkipped,
    },
  };
}

// The graph into the game's network, one node per graph node that still has roads (real/lay.ts
// uses it to build a real region into the game's own network).
export function emit(g: Graph, net: Network) {
  const nodeOf = new Map<number, number>();
  const roads = new Map<number, ImportedRoad>();
  const nid = (n: number) => {
    let id = nodeOf.get(n);
    if (id === undefined) { const v = g.node(n); id = net.addNode(v.x, v.z); nodeOf.set(n, id); }
    return id;
  };
  for (const e of g.edges.values()) {
    const t = typeOf(e);
    const a = nid(e.a), b = nid(e.b);
    const mid = simplify(e.pts, 0.4).slice(1, -1).map((p) => ({ x: p.x, z: p.z }));
    const seg = net.addSeg(a, b, mid, t.id);
    if (seg < 0) continue;
    const had = roads.get(seg);
    if (had) { had.ways.push(...e.ways); continue; } // the network already had this straight piece
    roads.set(seg, info(e, seg, t.id, t.approx));
  }
  // ways folded into a junction belong to every road that meets there
  for (const [n, ways] of g.absorbed) {
    const id = nodeOf.get(n);
    if (id === undefined) continue;
    for (const s of net.segsAt(id)) { const r = roads.get(s.id); if (r) for (const w of ways) if (!r.ways.includes(w)) r.ways.push(w); }
  }
  return { roads, nodeOf };
}

function info(e: GEdge, seg: number, type: string, approx: string[]): ImportedRoad {
  const t = e.tags;
  return {
    seg, type, cls: e.cls, name: t.name, ref: t.ref, ways: [...e.ways], approx,
    paired: e.paired, oneway: e.dir === 1,
    bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no', layer: +(t.layer ?? 0) || 0,
  };
}

// Douglas–Peucker: drop points that sit within `tol` metres of the line through their neighbours.
export function simplify(pts: P[], tol: number): P[] {
  if (pts.length <= 2) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i], b = pts[j], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1e-9;
    let far = -1, fd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k].x - a.x) * dz - (pts[k].z - a.z) * dx) / L;
      if (d > fd) { fd = d; far = k; }
    }
    if (far >= 0) { keep[far] = true; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}
