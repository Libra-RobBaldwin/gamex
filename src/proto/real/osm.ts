// A real region's tiles as OpenStreetMap-shaped data, so the OSM importer's stages (src/proto/osm:
// the road graph, pairing, joining runs, buildings to lots, stations) build the game's network
// from Ordnance Survey data exactly as they would from OSM. Pure: no three.js, no DOM.
//
// Positions go straight through: a node's `lat` is its z and its `lon` its x (in the map's own
// metres), and the importer is handed `local = (lat, lon) => ({ x: lon, z: lat })`. Ways share a
// node wherever OS data puts two vertices on the same spot (to Q, the bake's quantum): that's how
// OpenMap Local joins its roads at junctions. A road drawn over another (a bridge) has no vertex
// in common with it, so they don't join.
//
// Contains OS data © Crown copyright and database right (the Open Government Licence).
import type { OsmElement, OverpassJson, Tags } from '../osm/overpass';
import { BUILDING_CLASSES, DUAL, Q, RAISED, RAIL_CLASSES, ROAD_CLASSES, type Feature, type Tile } from './format';

export interface Box { x0: number; z0: number; x1: number; z1: number }
export interface XZ { x: number; z: number }
// who's in a built-up area: roads there are 30 mph (40 on a primary route), else the national limit
export type InTown = (p: XZ) => boolean;

export const local = (lat: number, lon: number) => ({ x: lon, z: lat });

// OS road classes as OSM highways (Minor Roads are the unnumbered classified roads: tertiary)
const HIGHWAY: Partial<Record<(typeof ROAD_CLASSES)[number], string>> = { motorway: 'motorway', primary: 'trunk', a: 'primary', b: 'secondary', minor: 'tertiary', local: 'residential', access: 'service' };
// which roads the game builds: private and restricted roads (drives, estates' private roads,
// car parks) are left out, as the OSM importer leaves out driveways (the game's plots have their
// own access)
export const BUILT_ROADS = new Set(['motorway', 'primary', 'a', 'b', 'minor', 'local']);
const BUILDING_TAGS: Record<string, Tags> = {
  education: { building: 'school', amenity: 'school' }, religious: { building: 'church', amenity: 'place_of_worship' }, medical: { building: 'hospital', amenity: 'hospital' },
  sport: { building: 'sports_centre', leisure: 'sports_centre' }, retail: { building: 'retail', shop: 'yes' }, culture: { building: 'civic', amenity: 'arts_centre' },
  transport: { building: 'transportation' }, emergency: { building: 'civic', amenity: 'fire_station' }, leisure: { building: 'yes', tourism: 'attraction' }, glasshouse: { building: 'greenhouse' },
};

export interface Options {
  box: Box; // the window, in map metres (roads and railways are cut at its edge)
  shift: XZ; // added to every tile position: the window's centre becomes 0, 0
  inTown: InTown;
  roads?: Set<string>; // road classes to build (BUILT_ROADS)
  splitBuildings?: boolean; // cut terraces and L-shaped blocks into house-sized pieces (true)
}

// The window's roads, railways, stations and buildings as Overpass JSON.
export function toOverpass(tiles: Tile[], o: Options): OverpassJson & { counts: Record<string, number> } {
  const elements: OsmElement[] = [], nodeAt = new Map<string, number>(), counts: Record<string, number> = {};
  let nextNode = 1, nextWay = 1;
  const roads = o.roads ?? BUILT_ROADS, B = o.box;
  const node = (x: number, z: number, tags?: Tags) => {
    const k = `${Math.round(x / Q)},${Math.round(z / Q)}`;
    let id = nodeAt.get(k);
    if (id === undefined || tags) {
      id = nextNode++;
      if (!tags) nodeAt.set(k, id);
      elements.push({ type: 'node', id, lat: z, lon: x, ...(tags ? { tags } : {}) });
    }
    return id;
  };
  const way = (pts: XZ[], tags: Tags, closed = false) => {
    const ids = pts.map((p) => node(p.x, p.z));
    const out: number[] = [];
    for (const id of ids) if (out[out.length - 1] !== id) out.push(id);
    if (closed && out.length && out[0] !== out[out.length - 1]) out.push(out[0]);
    if (out.length < (closed ? 4 : 2)) return;
    elements.push({ type: 'way', id: nextWay++, nodes: out, tags });
  };
  const pts = (a: Float64Array): XZ[] => { const r: XZ[] = []; for (let k = 0; k < a.length; k += 2) r.push({ x: a[k] + o.shift.x, z: a[k + 1] + o.shift.z }); return r; };
  const inBox = (p: XZ, m = 0) => p.x >= B.x0 + m && p.x <= B.x1 - m && p.z >= B.z0 + m && p.z <= B.z1 - m;
  const count = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

  for (const t of tiles) {
    // roads, cut where they leave the window
    for (const f of t.layers.roads ?? []) {
      const cls = ROAD_CLASSES[f.c & 15];
      if (!roads.has(cls)) continue;
      for (const run of clipLine(pts(f.parts[0]), B)) {
        const mid = run[Math.floor(run.length / 2)], town = o.inTown(mid), dual = !!(f.c & DUAL);
        const tags: Tags = { highway: HIGHWAY[cls]! };
        if (f.name) { const m = f.name.match(/^([ABM]\d+(?:\(M\))?)\s*(.*)$/); if (m) { tags.ref = m[1]; if (m[2]) tags.name = m[2]; } else tags.name = f.name; }
        if (dual) tags.lanes = cls === 'motorway' ? '6' : '4';
        tags.maxspeed = cls === 'motorway' ? '70 mph' : !town ? (cls === 'local' ? '30 mph' : dual ? '70 mph' : '60 mph') : cls === 'primary' ? '40 mph' : '30 mph';
        if (f.c & RAISED) { tags.bridge = 'yes'; tags.layer = '1'; }
        way(run, tags);
        count(`road:${cls}`);
      }
    }
    // railways (narrow gauge is a heritage line: left out)
    for (const f of t.layers.rail ?? []) {
      const cls = RAIL_CLASSES[f.c];
      if (cls === 'narrow') continue;
      for (const run of clipLine(pts(f.parts[0]), B)) {
        const tags: Tags = { railway: 'rail', usage: 'main', tracks: cls.startsWith('multi') ? '2' : '1' };
        if (cls.endsWith('tunnel')) tags.tunnel = 'yes';
        way(run, tags);
        count('rail');
      }
    }
    for (const f of t.layers.points ?? []) {
      if (f.c !== 0) continue;
      const p = pts(f.parts[0])[0];
      if (inBox(p)) { node(p.x, p.z, { railway: 'station', name: f.name ?? 'Station' }); count('station'); }
    }
    // buildings wholly inside the window
    for (const f of t.layers.buildings ?? []) {
      const ring = pts(f.parts[0]);
      if (!ring.every((p) => inBox(p, 2))) continue;
      const cls = BUILDING_CLASSES[f.c], tags: Tags = { ...(BUILDING_TAGS[cls] ?? { building: 'yes' }) };
      if (f.name) tags.name = f.name;
      for (const piece of o.splitBuildings === false ? [ring] : splitFootprint(ring)) { way(piece, tags, true); count('building'); }
    }
  }
  return { elements, bbox: [B.z0, B.x0, B.z1, B.x1], attribution: 'Contains OS data © Crown copyright and database right', counts };
}

// A polyline cut to a box: the runs inside it, each starting and ending on the box's edge where it crosses.
export function clipLine(p: XZ[], B: Box): XZ[][] {
  const inside = (q: XZ) => q.x >= B.x0 && q.x <= B.x1 && q.z >= B.z0 && q.z <= B.z1;
  const out: XZ[][] = [];
  let run: XZ[] = [];
  for (let i = 0; i < p.length; i++) {
    const q = p[i], inQ = inside(q);
    if (i > 0) {
      const a = p[i - 1], inA = inside(a);
      if (inA !== inQ) {
        const c = cross(a, q, B);
        if (c) { if (inA) { run.push(c); out.push(run); run = []; } else run = [c]; }
      } else if (!inA && !inQ) {
        // (a piece passing right through, entering and leaving between two vertices)
        const c1 = cross(a, q, B), c2 = c1 && cross(q, a, B);
        if (c1 && c2) out.push([c1, c2]);
      }
    }
    if (inQ) run.push(q);
  }
  if (run.length) out.push(run);
  return out.filter((r) => r.length >= 2 && Math.hypot(r[r.length - 1].x - r[0].x, r[r.length - 1].z - r[0].z) > 1);
}
// where the segment from a to b first meets the box's edge, going from a
function cross(a: XZ, b: XZ, B: Box): XZ | null {
  let best = Infinity;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [v, d, lo, hi, x] of [[B.x0, dx, B.z0, B.z1, true], [B.x1, dx, B.z0, B.z1, true], [B.z0, dz, B.x0, B.x1, false], [B.z1, dz, B.x0, B.x1, false]] as const) {
    if (Math.abs(d) < 1e-12) continue;
    const t = (v - (x ? a.x : a.z)) / d;
    if (t < 0 || t > 1) continue;
    const o = x ? a.z + dz * t : a.x + dx * t;
    if (o >= lo - 1e-9 && o <= hi + 1e-9 && t < best) best = t;
  }
  return best === Infinity ? null : { x: a.x + dx * best, z: a.z + dz * best };
}

// ---------------- footprints ----------------
// OS OpenMap Local draws a terrace (and many a city block) as one footprint. The game's lots are
// one building each, so a long footprint is cut across its length into pieces about as wide as
// it is deep (6–20 m), and a footprint that fills little of its rectangle (an L, a U, a block
// round a yard) into pieces its own depth wide. Pieces under 12 m² are dropped.
export function splitFootprint(ring: XZ[]): XZ[][] {
  const r = minRect(ring);
  if (!r) return [ring];
  const area = Math.abs(ringArea(ring)), fill = area / (r.w * r.d || 1);
  const depth = Math.min(r.w, r.d), length = Math.max(r.w, r.d);
  let width = 0;
  if (fill < 0.7 && length > 14) width = Math.max(6, Math.min(20, depth * fill * 1.3));
  else if (length > 1.8 * depth && length > 16) width = Math.max(6, Math.min(20, depth * 0.9));
  if (!width) return [ring];
  const n = Math.max(2, Math.round(length / width));
  // the long axis
  const ux = r.w >= r.d ? Math.cos(r.rot) : -Math.sin(r.rot), uz = r.w >= r.d ? Math.sin(r.rot) : Math.cos(r.rot);
  const out: XZ[][] = [];
  for (let k = 0; k < n; k++) {
    const s0 = -length / 2 + (length * k) / n, s1 = -length / 2 + (length * (k + 1)) / n;
    let piece: XZ[] = ring;
    piece = clipHalf(piece, (p) => (p.x - r.x) * ux + (p.z - r.z) * uz - s0);
    piece = clipHalf(piece, (p) => s1 - ((p.x - r.x) * ux + (p.z - r.z) * uz));
    if (piece.length >= 3 && Math.abs(ringArea(piece)) >= 12) out.push(piece);
  }
  return out.length ? out : [ring];
}
// keep the part of a ring where f ≥ 0 (Sutherland–Hodgman, one edge)
function clipHalf(ring: XZ[], f: (p: XZ) => number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }); }
  }
  return out;
}
export const ringArea = (r: XZ[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.x * b.z - b.x * a.z; } return s / 2; };
// the smallest rectangle round a ring (rot: the direction of its w side)
export function minRect(ring: XZ[]) {
  const h = hull(ring);
  if (h.length < 3) return null;
  let best: { x: number; z: number; rot: number; w: number; d: number } | null = null, ba = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], rot = Math.atan2(b.z - a.z, b.x - a.x), c = Math.cos(rot), s = Math.sin(rot);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) { const u = q.x * c + q.z * s, v = -q.x * s + q.z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (A < ba - 1e-9) { ba = A; const um = (u0 + u1) / 2, vm = (v0 + v1) / 2; best = { x: um * c - vm * s, z: um * s + vm * c, rot, w: u1 - u0, d: v1 - v0 }; }
  }
  return best;
}
function hull(pts: XZ[]): XZ[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cr = (o: XZ, a: XZ, b: XZ) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: XZ[] = [], hi: XZ[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

export type { Feature };
