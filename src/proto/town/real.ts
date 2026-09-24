// A real town from an OpenStreetMap snapshot (src/proto/osm). The importer does the hard part;
// this turns its output into a World the game can start from, and deals with what the game can't
// represent yet:
//   - roads run on past the snapshot's box (Overpass returns whole ways): cut at the map's edge;
//   - a road that stops a metre or two short of another (two OSM ways that don't share a node)
//     is joined to it;
//   - unnamed service roads (car-park and yard access, alleys) are left out: the game's plots
//     have their own access, and at full street width they'd run through half the buildings;
//   - one-way streets are built two-way and one-way slips are left out (the importer lists both);
//   - catalogue roads are often wider than the real street, so a building that stands on the
//     road's land is moved back (or made slightly smaller) until it's clear, and only dropped if
//     nothing within a few metres works. See settleStanding.
//
// Map data © OpenStreetMap contributors, under the Open Database Licence (docs/osm.md).

import { rectCorners, rng, type Lot, type Network, type P } from '../roads';
import { bandPolys } from '../land';
import { ATTRIBUTION, importOsm, type OsmImport } from '../osm/import';
import { inArea } from '../osm/landuse';
import type { OsmElement, OsmNode, OsmWay, OverpassJson } from '../osm/overpass';
import banbury from '../osm/fixtures/banbury.json';
import horley from '../osm/fixtures/horley.json';
import type { IndustryId } from '../industries';
import type { SiteWish } from '../game/industry';
import type { Tree, World, WorldHint, WorldZone } from './world';

export interface RealTown { name: string; data: OverpassJson; standIn?: string }
/**
 * The real town the game starts in: Horley town centre (fixtures/horley.json, fetched with
 * `node src/proto/osm/fetch-fixture.mjs horley`). Banbury's snapshot is the importer's own test
 * fixture and still makes a good second town.
 */
export const REAL_TOWN: RealTown = { name: 'Horley', data: horley };
export const BANBURY: RealTown = { name: 'Banbury', data: banbury };

const MARGIN = 30; // roads run this far past the edge of the map before they stop

export function realWorld(town: RealTown = REAL_TOWN): World {
  const json = prepare(town.data);
  const imp = importOsm(json, { seed: 11 });
  const b = imp.bounds;
  const bound = Math.floor(Math.min(-b.x0, b.x1, -b.z0, b.z1));
  const net = imp.net;
  net.bound = bound;

  // outbuildings (garages, sheds) aren't drawn: the game's plots have their own
  const standing = imp.buildings.filter((x) => !x.minor).map((x) => x.lot);
  const sheds = new Set(imp.buildings.filter((x) => x.minor).map((x) => x.lot));
  net.lots = net.lots.filter((l) => !sheds.has(l));

  const zones: WorldZone[] = imp.zones.map((z) => ({ kind: z.kind, outer: z.outer, inner: z.inner, ...(z.tags.name ? { name: z.tags.name } : {}) }));
  const water: P[][] = [...imp.water.polys.flatMap((z) => z.outer), ...imp.water.lines.flatMap((l) => bandPolys(l.path, l.width / 2, l.width / 2))];
  const hints = new Map<number, WorldHint>(imp.hints.map((h) => [h.netNode, { form: h.form, r: h.radius }]));
  const industrial = (p: P) => imp.zoneAt(p)?.kind === 'industrial';

  // the town centre is where the shops are (the box is only roughly centred on it)
  const shops = standing.filter((l) => l.kind === 'shop');
  const median = (v: number[]) => v.sort((x, y) => x - y)[Math.floor(v.length / 2)];
  const centre = shops.length >= 10 ? { x: median(shops.map((l) => l.x)), z: median(shops.map((l) => l.z)) } : { x: 0, z: 0 };

  const kinds: Record<string, number> = {};
  for (const u of imp.unsupported) kinds[u.kind] = (kinds[u.kind] ?? 0) + 1;
  const notes = Object.entries(kinds).map(([k, n]) => `${n} × ${k}${k === 'one-way street' ? ' (built two-way)' : k === 'slip road' ? ' (left out; junctions add their own)' : ''}`);

  return {
    id: 'real', name: town.name, real: true, attribution: ATTRIBUTION, attributionUrl: 'https://www.openstreetmap.org/copyright',
    net, bound, centre, view: { x: centre.x, z: centre.z + 20, h: 300 },
    water: { polys: water, isWater: imp.isWater, shores: [] },
    zones, zoneAt: (p) => imp.zoneAt(p)?.kind, industrial, industry: wishesOf(imp, centre, bound),
    stations: imp.stations.map((s) => ({ name: s.name, at: s.at, seg: s.seg })),
    stops: stopsOf(imp, centre),
    names: new Map([...imp.roads.values()].filter((r) => r.name || r.ref).map((r) => [r.seg, r.name ?? r.ref!])),
    hints, standing,
    growAlong: () => sparse(net, standing),
    // streets the map has no buildings on are mostly ones nobody has drawn yet, not empty ones:
    // the game builds its own houses along them at the start, leaving the farthest to grow
    growNow: 0.85,
    canGrow: (p) => { const k = imp.zoneAt(p)?.kind; return k !== 'park' && k !== 'water' && !imp.isWater(p); },
    invent: false,
    trees: treesOf(imp, bound),
    notes,
  };
}

// The town grows where its roads have room: along roads with less than one building every 40 m.
function sparse(net: Network, standing: Lot[]) {
  const n = new Map<number, number>();
  for (const l of standing) n.set(l.seg, (n.get(l.seg) ?? 0) + 1);
  return [...net.segs.values()].filter((s) => { const d = net.def(s); return d.cls === 'road' && d.frontage && (n.get(s.id) ?? 0) * 40 < net.length(s); }).map((s) => s.id);
}

// ---- the snapshot, trimmed to what the game plays ----

const minorService = (t?: Record<string, string>) => !!t && t.highway === 'service' && (!t.name || t.service === 'alley');
const cut = (t?: Record<string, string>) => !!t && !!(t.highway || t.railway || t.waterway);

/** Leave out minor service roads, and cut roads, railways and waterways at the box (plus MARGIN). */
export function prepare(src: OverpassJson): OverpassJson {
  const bbox = src.bbox;
  let els = src.elements.filter((e) => !(e.type === 'way' && minorService(e.tags)));
  if (bbox?.length !== 4) return { ...src, elements: els };
  const [s, w, n, e] = bbox;
  const mLat = 111_320, mLon = 111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180);
  const pad = { lat: MARGIN / mLat, lon: MARGIN / mLon };
  const box = { s: s - pad.lat, w: w - pad.lon, n: n + pad.lat, e: e + pad.lon };
  const nodes = new Map<number, OsmNode>();
  for (const el of els) if (el.type === 'node') nodes.set(el.id, el);
  const inside = (q: OsmNode) => q.lat >= box.s && q.lat <= box.n && q.lon >= box.w && q.lon <= box.e;
  let nextNode = -1, nextWay = -1;
  const added: OsmElement[] = [];
  // where the line from a (inside) to b (outside) leaves the box
  const exit = (a: OsmNode, b: OsmNode): OsmNode => {
    let t = 1;
    const lim = (v0: number, v1: number, lo: number, hi: number) => { if (v1 > hi) t = Math.min(t, (hi - v0) / (v1 - v0)); if (v1 < lo) t = Math.min(t, (lo - v0) / (v1 - v0)); };
    lim(a.lat, b.lat, box.s, box.n); lim(a.lon, b.lon, box.w, box.e);
    const q: OsmNode = { type: 'node', id: nextNode--, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    added.push(q); nodes.set(q.id, q);
    return q;
  };
  els = els.flatMap((el): OsmElement[] => {
    if (el.type !== 'way' || !cut(el.tags)) return [el];
    const pts = el.nodes.map((id) => nodes.get(id));
    if (pts.some((p) => !p)) return [el];
    if (pts.every((p) => inside(p!))) return [el];
    const runs: number[][] = [];
    let run: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!, inP = inside(p);
      const prev = i > 0 ? pts[i - 1]! : null;
      if (inP) {
        if (prev && !inside(prev)) run.push(exit(p, prev).id); // coming back in
        run.push(p.id);
      } else if (prev && inside(prev)) { run.push(exit(prev, p).id); runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    return runs.filter((r) => r.length >= 2).map((r, k): OsmWay => ({ ...el, id: k ? nextWay-- : el.id, nodes: r }));
  });
  els = [...els, ...added];
  stitch(els);
  return { ...src, elements: els };
}

/**
 * Mapping gaps: a way that ends within STITCH metres of another road (or railway) without sharing a
 * node with it. Its end snaps to the other's nearest vertex, or is added to the other's line
 * there. Changes the ways in place.
 */
const STITCH = 2;
export function stitch(els: OsmElement[]) {
  const nodes = new Map<number, OsmNode>();
  for (const el of els) if (el.type === 'node') nodes.set(el.id, el);
  const kind = (w: OsmWay) => (w.tags?.highway ? 'road' : w.tags?.railway ? 'rail' : null);
  const ways = els.filter((el): el is OsmWay => el.type === 'way' && !!kind(el));
  if (!ways.length) return 0;
  const lat0 = nodes.get(ways[0].nodes[0])?.lat ?? 0, mLat = 111_320, mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const xy = (id: number) => { const q = nodes.get(id)!; return { x: q.lon * mLon, z: -q.lat * mLat }; };
  const uses = new Map<number, number>();
  for (const w of ways) for (const id of w.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
  // every piece of every way, on a 20 m grid
  const C = 20, grid = new Map<string, { w: OsmWay; i: number }[]>();
  for (const w of ways) for (let i = 1; i < w.nodes.length; i++) {
    if (!nodes.has(w.nodes[i - 1]) || !nodes.has(w.nodes[i])) continue;
    const a = xy(w.nodes[i - 1]), b = xy(w.nodes[i]);
    for (let gx = Math.floor((Math.min(a.x, b.x) - STITCH) / C); gx <= Math.floor((Math.max(a.x, b.x) + STITCH) / C); gx++)
      for (let gz = Math.floor((Math.min(a.z, b.z) - STITCH) / C); gz <= Math.floor((Math.max(a.z, b.z) + STITCH) / C); gz++) {
        const k = `${gx},${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push({ w, i });
      }
  }
  let joined = 0;
  const inserts: { o: OsmWay; i: number; id: number }[] = [];
  for (const w of ways) for (const end of [0, w.nodes.length - 1]) {
    const id = w.nodes[end];
    if (!nodes.has(id) || (uses.get(id) ?? 0) > 1 || (w.nodes.length > 2 && w.nodes[0] === w.nodes[w.nodes.length - 1])) continue;
    const p = xy(id);
    let best: { w: OsmWay; i: number; t: number; d: number } | null = null;
    for (const c of grid.get(`${Math.floor(p.x / C)},${Math.floor(p.z / C)}`) ?? []) {
      if (c.w === w || kind(c.w) !== kind(w) || c.w.nodes.includes(id)) continue;
      const a = xy(c.w.nodes[c.i - 1]), b = xy(c.w.nodes[c.i]), dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
      const d = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
      if (d <= STITCH && (!best || d < best.d)) best = { ...c, t, d };
    }
    if (!best) continue;
    const { w: o, i } = best, a = o.nodes[i - 1], b = o.nodes[i];
    const da = Math.hypot(xy(a).x - p.x, xy(a).z - p.z), db = Math.hypot(xy(b).x - p.x, xy(b).z - p.z);
    if (Math.min(da, db) <= STITCH) w.nodes[end] = da <= db ? a : b; // snap onto its nearest vertex
    else inserts.push({ o, i, id }); // or join its line there
    uses.set(id, 2);
    joined++;
  }
  // (from the back of each way, so earlier positions still hold)
  for (const { o, i, id } of inserts.sort((x, y) => y.i - x.i)) o.nodes.splice(i, 0, id);
  return joined;
}

// ---- industry: the library's sites on the town's own industrial estates, and farms, woods and a
// quarry out on its fields ----

function wishesOf(imp: OsmImport, centre: P, bound: number): SiteWish[] {
  const mid = (z: { outer: P[][] }) => { const r = z.outer[0]; return { x: r.reduce((t, q) => t + q.x, 0) / r.length, z: r.reduce((t, q) => t + q.z, 0) / r.length }; };
  const within = (p: P) => Math.abs(p.x) < bound - 60 && Math.abs(p.z) < bound - 60;
  const estates = imp.zones.filter((z) => z.kind === 'industrial' && within(mid(z))).sort((a, b) => b.area - a.area);
  // out of town: open land (farmland, or nothing mapped), well away from the centre
  const open = (p: P) => { const k = imp.zoneAt(p)?.kind; return (!k || k === 'farmland') && !imp.isWater(p) && Math.hypot(p.x - centre.x, p.z - centre.z) > 400; };
  // a real estate is usually full already: its sites may spill onto open land beside it
  const industrial = (p: P) => imp.zoneAt(p)?.kind === 'industrial' || open(p);
  const out: SiteWish[] = [];
  const onEstates: [IndustryId, string?][] = [['warehouse', 'distribution'], ['goods_factory'], ['sawmill'], ['brewery'], ['food_plant'], ['warehouse', 'cold_store'], ['goods_factory', 'works']];
  if (estates.length) onEstates.forEach(([type, variant], i) => {
    const z = estates[i % estates.length];
    out.push({ type, variant, near: mid(z), radius: Math.max(350, Math.sqrt(z.area)), ok: industrial });
  });
  const fields = imp.zones.filter((z) => z.kind === 'farmland' && within(mid(z))).sort((a, b) => b.area - a.area);
  const woods = imp.zones.filter((z) => (z.tags.natural === 'wood' || z.tags.landuse === 'forest') && within(mid(z))).sort((a, b) => b.area - a.area);
  // the corner of the map farthest from the centre, for whatever has nowhere better
  const corner = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => ({ x: sx * (bound - 200), z: sz * (bound - 200) })).sort((a, b) => Math.hypot(b.x - centre.x, b.z - centre.z) - Math.hypot(a.x - centre.x, a.z - centre.z))[0];
  out.push({ type: 'farm', near: fields[0] ? mid(fields[0]) : corner, radius: 700, ok: open, fast: true });
  out.push({ type: 'forest', near: woods[0] ? mid(woods[0]) : corner, radius: 700, ok: (p) => open(p) || imp.zoneAt(p)?.kind === 'park', fast: true });
  out.push({ type: 'quarry', near: corner, radius: 700, ok: open, fast: true });
  return out;
}

// ---- the first bus stops: the centre, the station, and along the main roads near the centre ----

function stopsOf(imp: OsmImport, centre: P): P[] {
  const out: P[] = [centre, ...imp.stations.filter((s) => Math.hypot(s.at.x - centre.x, s.at.z - centre.z) < 900).map((s) => s.at)];
  const main = [...imp.roads.values()].filter((r) => r.cls === 'road' && r.name && /^(arterial|rural|dual)/.test(r.type))
    .map((r) => { const p = imp.net.path(imp.net.segs.get(r.seg)!); return { r, at: p[Math.floor(p.length / 2)], L: imp.net.length(imp.net.segs.get(r.seg)!) }; })
    .filter((m) => m.L > 120 && Math.hypot(m.at.x - centre.x, m.at.z - centre.z) < 700)
    .sort((a, b) => b.L - a.L);
  for (const m of main) if (out.length < 6 && out.every((q) => Math.hypot(q.x - m.at.x, q.z - m.at.z) > 250)) out.push({ x: m.at.x, z: m.at.z });
  return out;
}

// ---- trees: woods and parks from the map, a few in gardens ----

function treesOf(imp: OsmImport, bound: number): Tree[] {
  const r = rng(99), out: Tree[] = [];
  for (const z of imp.zones) {
    const t = z.tags;
    const wood = t.natural === 'wood' || t.landuse === 'forest', scrub = t.natural === 'scrub';
    // pitches and playing fields stay open; parks and churchyards get a scattering
    const every = wood ? 11 : scrub ? 22 : z.kind === 'park' && !['pitch', 'playground'].includes(t.leisure ?? '') && !['allotments', 'flowerbed'].includes(t.landuse ?? '') ? 38 : z.kind === 'residential' ? 55 : 0;
    if (!every) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const q of z.outer.flat()) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
    x0 = Math.max(x0, -bound); z0 = Math.max(z0, -bound); x1 = Math.min(x1, bound); z1 = Math.min(z1, bound);
    if (x1 <= x0 || z1 <= z0) continue;
    const n = Math.min(600, Math.round(((x1 - x0) * (z1 - z0)) / (every * every)));
    for (let i = 0; i < n; i++) {
      const p = { x: x0 + r() * (x1 - x0), z: z0 + r() * (z1 - z0) };
      if (!inArea(p, z) || imp.isWater(p)) continue;
      out.push({ ...p, s: 0.8 + r() * 0.7, kind: r() < (wood ? 0.3 : 0.12) ? 1 : 0 });
    }
  }
  // the instanced tree meshes hold 1,600; keep an even sample
  const MAX = 1500;
  if (out.length <= MAX) return out;
  const step = out.length / MAX;
  return Array.from({ length: MAX }, (_, i) => out[Math.floor(i * step)]);
}

// ---- buildings that were already standing ----

/**
 * Real buildings go up once the junctions have claimed their land. The catalogue's roads are
 * often wider than the real street, so a building standing on a road's or junction's land is moved
 * straight back from its road (and a little sideways, or made up to 30% smaller) to the nearest
 * spot that's clear. Buildings nothing within 5 m clears are left out. Returns the ones to build;
 * they're taken out of `net.lots` (the game adds each back as it builds it).
 */
export function settleStanding(net: Network, lots: Lot[]) {
  const mine = new Set(lots);
  net.lots = net.lots.filter((l) => !mine.has(l));
  const placed: Lot[] = [];
  let moved = 0, dropped = 0;
  const clear = (x: number, z: number, l: Lot, f: number) => {
    const poly = rectCorners(x, z, l.rot, l.w * f, l.d * f);
    return net.land.free(poly) && !poly.some((p) => net.isWater(p) || Math.abs(p.x) > net.bound || Math.abs(p.z) > net.bound);
  };
  for (const l of lots) {
    if (clear(l.x, l.z, l, 1)) { placed.push(l); continue; }
    const c = Math.cos(l.rot), s = Math.sin(l.rot);
    // local +z faces the road (world (-sin, cos)); local +x runs along it (world (cos, sin))
    const ok = NUDGES.find((k) => clear(l.x + k.s * c + k.b * s, l.z + k.s * s - k.b * c, l, k.f));
    if (!ok) { dropped++; continue; }
    l.x += ok.s * c + ok.b * s; l.z += ok.s * s - ok.b * c;
    l.w *= ok.f; l.d *= ok.f; l.pw = l.w; l.front += ok.b;
    moved++;
    placed.push(l);
  }
  return { placed, moved, dropped };
}
const NUDGES = (() => {
  const out: { b: number; s: number; f: number; cost: number }[] = [];
  for (const b of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]) for (const s of [0, -1, 1, -2, 2, -3, 3]) for (const f of [1, 0.9, 0.8, 0.7]) out.push({ b, s, f, cost: b + Math.abs(s) * 1.2 + (1 - f) * 12 });
  return out.sort((x, y) => x.cost - y.cost);
})();
