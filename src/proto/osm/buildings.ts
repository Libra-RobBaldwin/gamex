// Building footprints to the game's plots. The game's Lot is a rectangle facing its road with a
// front and back garden; a real footprint is any polygon. Each footprint gets the smallest
// rectangle that holds it, turned to face the nearest road it could front, and keeps the real
// polygon alongside so a later building generator can follow it exactly. What the building is
// (house, terrace, shop...) and how tall comes from its tags, what's inside it (a shop's point),
// the land use around it, and failing all that its size and whether it's joined to neighbours.

import { pointInPoly } from '../land';
import { closestOnPath, type Lot, type LotKind, type Network, type P } from '../roads';
import { areas, type OsmData, type Tags } from './overpass';
import { ringArea, type ZoneArea } from './landuse';

export interface ImportedBuilding {
  id: string; // OSM element, e.g. "w123"
  lot: Lot;
  poly: P[]; // the real footprint, outer ring
  holes: P[][];
  kind: LotKind; arch?: string;
  minor: boolean; // a garage, shed or other outbuilding
  h: number; levels?: number;
  why: string; // how the kind was decided (tag, poi, zone, size)
  tags: Tags;
  area: number; fill: number; // footprint area, and how much of its rectangle it fills
}

// ---------- the rectangle ----------

export function convexHull(pts: P[]): P[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: P[] = [], hi: P[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

// The minimum-area rectangle round a polygon: one of its sides lies along a hull edge, so try each.
// `rot` is the direction of the `w` side.
export function orientedRect(pts: P[]) {
  const h = convexHull(pts);
  let best = { x: 0, z: 0, rot: 0, w: 0, d: 0, area: Infinity };
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const rot = Math.atan2(b.z - a.z, b.x - a.x), c = Math.cos(rot), s = Math.sin(rot);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of h) { const u = q.x * c + q.z * s, v = -q.x * s + q.z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area - 1e-9) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { x: um * c - vm * s, z: um * s + vm * c, rot, w: u1 - u0, d: v1 - v0, area };
    }
  }
  return best;
}

// ---------- what it is, and how tall ----------

const HOUSE = ['house', 'detached', 'semidetached_house', 'bungalow', 'farm', 'cabin', 'static_caravan', 'houseboat'];
const FLATS = ['apartments', 'flats', 'dormitory', 'residential'];
const SHOP = ['retail', 'supermarket', 'kiosk', 'shop'];
const OFFICE = ['office', 'commercial', 'bank'];
const INDUSTRY = ['industrial', 'manufacture', 'warehouse', 'factory', 'storage_tank', 'hangar', 'depot', 'works', 'service', 'transformer_tower'];
const MINOR = ['garage', 'garages', 'shed', 'hut', 'carport', 'greenhouse', 'barn', 'stable', 'cowshed', 'outbuilding', 'toilets', 'kiosk_booth'];
// civic buildings and the archetype the building kit draws for them (buildgen.ts CIVIC)
const CIVIC: Record<string, string> = {
  church: 'church', chapel: 'church', cathedral: 'church', mosque: 'church', temple: 'church', synagogue: 'church', religious: 'church',
  school: 'school', college: 'school', university: 'school', kindergarten: 'school',
  hospital: 'surgery', clinic: 'surgery', doctors: 'surgery', dentist: 'surgery',
  civic: 'hall', government: 'hall', public: 'hall', community_centre: 'hall', library: 'hall', townhall: 'hall', fire_station: 'hall', police: 'hall',
  train_station: 'hall', transportation: 'hall', sports_centre: 'hall', sports_hall: 'hall', theatre: 'hall', cinema: 'hall', museum: 'hall', hotel: 'hall',
  pub: 'pub', bar: 'pub', fuel: 'petrol', substation: 'substation',
};
const AMENITY_SHOP = ['restaurant', 'cafe', 'fast_food', 'pharmacy', 'bank', 'post_office', 'ice_cream', 'bureau_de_change', 'marketplace'];

export interface Kind { kind: LotKind; arch?: string; minor: boolean; why: string }

export function kindOf(t: Tags, pois: Tags[], zone: ZoneArea | undefined, area: number, attached: number): Kind {
  const b = t.building ?? 'yes';
  const tall = (k: LotKind): LotKind => ((k === 'flats' || k === 'office') && levelsOf(t) >= 8 ? 'tower' : k);
  const from = (tt: Tags, why: string): Kind | undefined => {
    const a = tt.amenity, s = tt.shop, o = tt.office;
    if (a && CIVIC[a]) return { kind: 'civic', arch: CIVIC[a], minor: false, why };
    if (tt.healthcare && CIVIC[tt.healthcare]) return { kind: 'civic', arch: CIVIC[tt.healthcare], minor: false, why };
    if (tt.power === 'substation') return { kind: 'civic', arch: 'substation', minor: false, why };
    if (s || (a && AMENITY_SHOP.includes(a))) return { kind: 'shop', arch: area < 110 && zone?.kind === 'residential' ? 'cornershop' : undefined, minor: false, why };
    if (o) return { kind: tall('office'), minor: false, why };
    if (tt.craft || tt.industrial || tt.man_made === 'works') return { kind: 'industry', minor: false, why };
    return undefined;
  };
  // what the building itself says it is
  const own = from(t, 'tag');
  if (own) return own;
  if (MINOR.includes(b)) return { kind: 'house', minor: true, why: 'tag' };
  if (CIVIC[b]) return { kind: 'civic', arch: CIVIC[b], minor: false, why: 'tag' };
  if (b === 'terrace') return { kind: 'terrace', minor: false, why: 'tag' };
  if (HOUSE.includes(b)) return { kind: attached >= 2 && b === 'house' ? 'terrace' : 'house', minor: false, why: 'tag' };
  if (FLATS.includes(b) && !(b === 'residential' && area < 150)) return { kind: tall('flats'), minor: false, why: 'tag' };
  if (b === 'residential') return { kind: attached >= 2 ? 'terrace' : 'house', minor: false, why: 'tag' };
  if (SHOP.includes(b)) return { kind: 'shop', minor: false, why: 'tag' };
  if (OFFICE.includes(b)) return { kind: tall('office'), minor: false, why: 'tag' };
  if (INDUSTRY.includes(b)) return { kind: 'industry', minor: false, why: 'tag' };
  // a shop or pub mapped as a point inside it
  for (const p of pois) { const k = from(p, 'poi'); if (k) return k; }
  // the land around it
  if (area < 18) return { kind: 'house', minor: true, why: 'size' };
  if (zone?.kind === 'industrial') return { kind: area < 40 ? 'house' : 'industry', minor: area < 40, why: 'zone' };
  if (zone?.kind === 'commercial') return { kind: area > 2500 ? 'industry' : area > 600 ? 'office' : 'shop', minor: false, why: 'zone' };
  if (zone?.kind === 'residential') {
    if (area > 450) return { kind: tall('flats'), minor: false, why: 'zone' };
    return { kind: attached >= 2 ? 'terrace' : 'house', minor: area < 30, why: 'zone' };
  }
  // no clue but its size and neighbours
  if (area > 1500) return { kind: 'industry', minor: false, why: 'size' };
  if (area > 450) return { kind: 'flats', minor: false, why: 'size' };
  if (area < 30) return { kind: 'house', minor: true, why: 'size' };
  return { kind: attached >= 2 ? 'terrace' : 'house', minor: false, why: 'size' };
}

export function levelsOf(t: Tags) { return Math.round(+(t['building:levels'] ?? 0) || 0); }
function metres(v?: string) {
  if (!v) return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*(m|ft|')?$/.exec(v.trim());
  if (!m) return undefined;
  return m[2] === 'ft' || m[2] === "'" ? +m[1] * 0.3048 : +m[1];
}
// typical heights to the ridge, for buildings OSM doesn't give a height or storeys for
export const DEFAULT_H: Record<LotKind, number> = { house: 7.5, terrace: 8.5, shop: 9, flats: 12, office: 13, tower: 30, industry: 8, civic: 10 };
export function heightOf(t: Tags, k: Kind): { h: number; levels?: number; why: string } {
  const h = metres(t.height);
  if (h) return { h, why: 'height' };
  const lv = levelsOf(t);
  if (lv > 0) {
    const roof = +(t['roof:levels'] ?? 0) || 0;
    // 3 m a storey, plus a pitched roof (a storey's worth for each roof level, or 2 m)
    return { h: lv * 3 + (roof ? roof * 2.5 : 2), levels: lv, why: 'levels' };
  }
  if (k.minor) return { h: 2.8, why: 'default' };
  if (k.arch === 'church') return { h: 14, why: 'default' };
  return { h: DEFAULT_H[k.kind], why: 'default' };
}

// ---------- which road it fronts ----------

const BACK: Record<LotKind, number> = { house: 14, terrace: 8, shop: 7, flats: 14, office: 13, tower: 10, industry: 16, civic: 10 };
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

// Nearest road a building could front (streets, not motorways or railways), from a grid of pieces.
function roadFinder(net: Network, cell = 60) {
  const grid = new Map<string, { seg: number; path: P[] }[]>();
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (d.cls !== 'road' || !d.frontage) continue;
    const path = net.path(s);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      for (let x = Math.floor(Math.min(a.x, b.x) / cell); x <= Math.floor(Math.max(a.x, b.x) / cell); x++)
        for (let z = Math.floor(Math.min(a.z, b.z) / cell); z <= Math.floor(Math.max(a.z, b.z) / cell); z++) {
          const k = `${x},${z}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push({ seg: s.id, path: [a, b] });
        }
    }
  }
  return (p: P, max: number) => {
    let best: { seg: number; x: number; z: number; d: number } | undefined;
    const r = Math.ceil(max / cell);
    const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) for (const piece of grid.get(`${i},${j}`) ?? []) {
      const c = closestOnPath(p, piece.path);
      if (c.d <= max && (!best || c.d < best.d)) best = { seg: piece.seg, x: c.x, z: c.z, d: c.d };
    }
    return best;
  };
}

export function buildingsOf(d: OsmData, net: Network, local: (lat: number, lon: number) => P, zoneAt: (p: P) => ZoneArea | undefined) {
  const out: ImportedBuilding[] = [], skipped: Record<string, number> = {};
  const pos = (id: number) => { const n = d.nodes.get(id); return n && local(n.lat, n.lon); };
  const ring = (ids: number[]) => ids.slice(0, -1).map(pos).filter((q): q is P => !!q);
  // points (shops, pubs) that say what a building is used for
  const pois = [...d.nodes.values()].filter((n) => n.tags && (n.tags.shop || n.tags.amenity || n.tags.office || n.tags.craft)).map((n) => ({ p: local(n.lat, n.lon), t: n.tags! }));
  const poiGrid = new Map<string, typeof pois>();
  for (const q of pois) { const k = `${Math.floor(q.p.x / 50)},${Math.floor(q.p.z / 50)}`; if (!poiGrid.has(k)) poiGrid.set(k, []); poiGrid.get(k)!.push(q); }
  // how many other buildings each node is shared with: terraces share their party walls
  const nodeUse = new Map<number, number>();
  const found = areas(d, (t) => !!t.building);
  for (const a of found) for (const id of new Set(a.outer[0].slice(0, -1))) nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);
  const nearRoad = roadFinder(net);

  for (const a of found) {
    const t = a.tags;
    if (['roof', 'bridge', 'construction', 'ruins', 'no', 'canopy', 'demolished', 'collapsed'].includes(t.building)) { skipped[t.building] = (skipped[t.building] ?? 0) + 1; continue; }
    // the biggest outer ring stands for the building (a multipolygon's extra wings are rare)
    const rings = a.outer.map(ring).sort((x, y) => ringArea(y) - ringArea(x));
    const poly = rings[0];
    if (!poly || poly.length < 3) continue;
    const area = ringArea(poly);
    const rect = orientedRect(poly);
    const neighbours = new Set<number>();
    const ids = a.outer[0];
    for (const id of ids) if ((nodeUse.get(id) ?? 0) > 1) neighbours.add(id);
    // two shared nodes make one party wall; a terrace house has two
    const attached = Math.floor(neighbours.size / 2);
    const inside = (poiGrid.get(`${Math.floor(rect.x / 50)},${Math.floor(rect.z / 50)}`) ?? []).filter((q) => pointInPoly(q.p, poly)).map((q) => q.t);
    const zone = zoneAt({ x: rect.x, z: rect.z });
    const k = kindOf(t, inside, zone, area, attached);
    const ht = heightOf(t, k);

    // turn the rectangle so its front faces the road: the game's lots look down local +z
    let rot = rect.rot + Math.PI / 2, w = rect.w, dd = rect.d, seg = -1, front = 0;
    const road = nearRoad({ x: rect.x, z: rect.z }, 60);
    if (road) {
      const to = Math.atan2(road.z - rect.z, road.x - rect.x);
      // choose the side of the rectangle that looks most directly at the road
      let bestDot = -Infinity;
      for (let q = 0; q < 4; q++) {
        const r = rect.rot + (q * Math.PI) / 2;
        const fx = -Math.sin(r), fz = Math.cos(r); // local +z in world terms
        const dot = fx * Math.cos(to) + fz * Math.sin(to);
        if (dot > bestDot) { bestDot = dot; rot = r; [w, dd] = q % 2 ? [rect.d, rect.w] : [rect.w, rect.d]; }
      }
      seg = road.seg;
      const half = net.half(net.segs.get(seg)!);
      front = Math.max(0, road.d - dd / 2 - half);
    }
    const s = net.segs.get(seg);
    const side = s ? net.sideOf(s, { x: rect.x, z: rect.z }) : 1;
    const lot: Lot = {
      id: net.nextId++, x: rect.x, z: rect.z, rot, w, d: dd, h: ht.h, kind: k.kind, seg, seed: hash(a.id), row: seg < 0 ? 0 : (seg * 7919 + (side > 0 ? 1 : 0) * 104729) % 1000003,
      front, back: BACK[k.kind], px: 0, pw: w, ...(k.arch ? { arch: k.arch } : {}),
    };
    out.push({ id: a.id, lot, poly, holes: a.inner.map(ring), kind: k.kind, arch: k.arch, minor: k.minor, h: ht.h, levels: ht.levels, why: `${k.why}/${ht.why}`, tags: t, area, fill: area / (rect.w * rect.d || 1) });
  }
  return { buildings: out, skipped };
}
