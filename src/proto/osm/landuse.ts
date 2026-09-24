// Land use, water and stations. Land use becomes zones for the land registry and the demand model;
// water becomes an isWater(p) test the network already takes; stations are points to put the
// game's stations at.

import { pointInPoly } from '../land';
import { closestOnPath, type P } from '../roads';
import { areas, type OsmData, type Tags } from './overpass';

export type ZoneKind = 'residential' | 'commercial' | 'industrial' | 'park' | 'farmland' | 'water';
export interface ZoneArea { id: string; kind: ZoneKind; outer: P[][]; inner: P[][]; tags: Tags; area: number }

export function zoneKindOf(t: Tags): ZoneKind | undefined {
  const lu = t.landuse, le = t.leisure, na = t.natural;
  if (na === 'water' || t.waterway === 'riverbank' || lu === 'reservoir' || lu === 'basin') return 'water';
  if (lu === 'residential') return 'residential';
  if (lu === 'retail' || lu === 'commercial') return 'commercial';
  if (lu === 'industrial' || lu === 'garages' || lu === 'port' || lu === 'depot') return 'industrial';
  if (['park', 'garden', 'recreation_ground', 'pitch', 'playground', 'common', 'nature_reserve'].includes(le ?? '')) return 'park';
  if (['recreation_ground', 'grass', 'village_green', 'cemetery', 'allotments', 'flowerbed', 'forest'].includes(lu ?? '')) return 'park';
  if (['wood', 'scrub', 'grassland', 'wetland'].includes(na ?? '')) return 'park';
  if (['farmland', 'farmyard', 'meadow', 'orchard', 'vineyard'].includes(lu ?? '')) return 'farmland';
  return undefined;
}

export function ringArea(r: P[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].z - r[i].z);
  return Math.abs(a / 2);
}

export function zonesOf(d: OsmData, local: (lat: number, lon: number) => P): { zones: ZoneArea[]; skipped: Record<string, number> } {
  const ring = (ids: number[]) => ids.map((id) => d.nodes.get(id)).filter((n) => !!n).map((n) => local(n!.lat, n!.lon));
  const zones: ZoneArea[] = [], skipped: Record<string, number> = {};
  for (const a of areas(d, (t) => !!(t.landuse || t.leisure || t.natural || t.waterway === 'riverbank'))) {
    if (a.tags.building) continue;
    const kind = zoneKindOf(a.tags);
    if (!kind) { const k = a.tags.landuse ?? a.tags.leisure ?? a.tags.natural ?? '?'; skipped[k] = (skipped[k] ?? 0) + 1; continue; }
    const outer = a.outer.map(ring), inner = a.inner.map(ring);
    zones.push({ id: a.id, kind, outer, inner, tags: a.tags, area: outer.reduce((s, r) => s + ringArea(r), 0) - inner.reduce((s, r) => s + ringArea(r), 0) });
  }
  // smaller areas sit on top of the bigger ones they're drawn inside (a park inside a residential area)
  zones.sort((x, y) => y.area - x.area);
  return { zones, skipped };
}

// A coarse grid over polygons and lines so point tests only look at what's nearby.
class Grid<T> {
  private cells = new Map<string, T[]>();
  constructor(private size: number) {}
  add(box: [number, number, number, number], v: T) {
    for (let i = Math.floor(box[0] / this.size); i <= Math.floor(box[2] / this.size); i++)
      for (let j = Math.floor(box[1] / this.size); j <= Math.floor(box[3] / this.size); j++) {
        const k = `${i},${j}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k)!.push(v);
      }
  }
  at(p: P) { return this.cells.get(`${Math.floor(p.x / this.size)},${Math.floor(p.z / this.size)}`) ?? []; }
}
const boxOf = (pts: P[], pad = 0): [number, number, number, number] => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
};

export const inArea = (p: P, z: { outer: P[][]; inner: P[][] }) => z.outer.some((r) => pointInPoly(p, r)) && !z.inner.some((r) => pointInPoly(p, r));

// Which zone a point is in (the smallest one drawn there), if any.
export function zoneLookup(zones: ZoneArea[]) {
  const grid = new Grid<ZoneArea>(50);
  for (const z of zones) grid.add(boxOf(z.outer.flat()), z);
  return (p: P): ZoneArea | undefined => {
    let best: ZoneArea | undefined;
    for (const z of grid.at(p)) if ((!best || z.area < best.area) && inArea(p, z)) best = z;
    return best;
  };
}

// Water: the areas (lakes, the canal's own polygon, riverbanks) and rivers and streams drawn only
// as a line, given a width by their kind.
export const WATERWAY_W: Record<string, number> = { river: 14, canal: 9, stream: 2, drain: 1.5, ditch: 1 };
export interface WaterLine { id: number; kind: string; path: P[]; width: number }
export function waterOf(d: OsmData, zones: ZoneArea[], local: (lat: number, lon: number) => P) {
  const lines: WaterLine[] = [];
  for (const w of d.ways.values()) {
    const k = w.tags?.waterway;
    if (!k || !WATERWAY_W[k] || w.tags?.tunnel === 'culvert' || w.tags?.tunnel === 'yes') continue;
    const path = w.nodes.map((id) => d.nodes.get(id)).filter((n) => !!n).map((n) => local(n!.lat, n!.lon));
    const width = +(w.tags?.width ?? '') || WATERWAY_W[k];
    if (path.length >= 2) lines.push({ id: w.id, kind: k, path, width });
  }
  const polys = zones.filter((z) => z.kind === 'water');
  const grid = new Grid<{ poly?: ZoneArea; line?: WaterLine }>(40);
  for (const z of polys) grid.add(boxOf(z.outer.flat()), { poly: z });
  for (const l of lines) grid.add(boxOf(l.path, l.width), { line: l });
  const isWater = (p: P) => grid.at(p).some((c) => (c.poly ? inArea(p, c.poly) : closestOnPath(p, c.line!.path).d <= c.line!.width / 2));
  return { lines, polys, isWater };
}

export interface Station { id: number; name?: string; at: P; kind: 'station' | 'halt'; tags: Tags }
export function stationsOf(d: OsmData, local: (lat: number, lon: number) => P): Station[] {
  const out: Station[] = [];
  for (const n of d.nodes.values()) {
    const t = n.tags;
    if (!t || !(t.railway === 'station' || t.railway === 'halt' || (t.public_transport === 'station' && t.train === 'yes'))) continue;
    if (t.station === 'subway') continue; // the game has no underground yet
    out.push({ id: n.id, name: t.name, at: local(n.lat, n.lon), kind: t.railway === 'halt' ? 'halt' : 'station', tags: t });
  }
  return out;
}
