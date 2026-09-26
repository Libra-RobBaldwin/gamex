// The industries of a 50 km map (docs/streaming.md, "Industries"): where the world plan puts the
// sites of the industries library (src/proto/industries), and how the scenery draws them.
//
//   - on the land that suits each: quarries on high ground, forests on the hillsides, farms and oil
//     wells in the vales, the docks on the coast by a town;
//   - the works that process things at the edges of the towns and cities: steelworks, a power
//     station, factories, food plants, breweries, sawmills, distribution centres, and a refinery
//     by the docks;
//   - each clear of the places, the water, the roads and one another, and linked to the nearest
//     road by a lane (routes.ts spurs).
//
// Sites in the live play area are left to the game (game/industry.ts), which places them on its own
// land. Pure: no three.js.
import { INDUSTRY_TYPES, type IndustryId } from '../industries/catalogue';
import { buildable } from '../industries/chains';
import { mix, range, rng, type Rand } from '../region/random';
import type { XZ } from '../region/water';
import { LIVE_HALF, type SettlementGrid, type WorldSettlement } from './plan';
import type { Route } from './routes';
import type { SceneBuilding } from './towns';
import type { WorldWater } from './water';

export interface WorldIndustry {
  id: number;
  type: IndustryId;
  x: number; z: number; rot: number; // its site's middle, and which way its frontage faces (like a lot's)
  w: number; d: number; // the site's size (m): w along its frontage
  settlement: number; // the place it's by, or nearest
  seed: number;
}
interface Ctx { seed: number; half: number; settlements: WorldSettlement[]; water: WorldWater; grid: SettlementGrid; heightAt: (x: number, z: number) => number; roads: Route[]; year?: number }

// How many of each on a 50 km map (scaled by the map's area for other sizes)
const RURAL: { type: IndustryId; n: [number, number]; gap: number }[] = [
  { type: 'farm', n: [26, 34], gap: 2400 },
  { type: 'quarry', n: [3, 5], gap: 6000 },
  { type: 'forest', n: [4, 6], gap: 5000 },
  { type: 'oil_well', n: [0, 1], gap: 8000 },
  { type: 'coal_mine', n: [1, 2], gap: 8000 },
];
const TOWN_WORKS: IndustryId[] = ['sawmill', 'brewery', 'food_plant', 'goods_factory', 'warehouse'];
const CITY_WORKS: IndustryId[] = ['goods_factory', 'food_plant', 'steelworks', 'power_station'];

export function placeIndustries(c: Ctx): WorldIndustry[] {
  const r = rng(mix(c.seed, 401)), H = c.half, year = c.year ?? 2025, out: WorldIndustry[] = [];
  const area = (2 * H) ** 2 / 2.5e9;
  // the land's heights, for "high ground" and "the vales": sampled on a 1 km lattice
  const hs: number[] = [];
  for (let x = -H + 500; x < H; x += 1000) for (let z = -H + 500; z < H; z += 1000) if (!c.water.wet({ x, z }, 50) && c.water.seaDistance(x, z, 300) > 200) hs.push(c.heightAt(x, z));
  hs.sort((a, b) => a - b);
  const q = (t: number) => hs[Math.min(hs.length - 1, Math.floor(t * hs.length))] ?? 0;
  const slope = (x: number, z: number) => Math.hypot(c.heightAt(x + 60, z) - c.heightAt(x - 60, z), c.heightAt(x, z + 60) - c.heightAt(x, z - 60)) / 120;
  // road points by 250 m cell, to keep sites off the roads and find the nearest for a spur
  const roadCells = new Map<string, XZ[]>();
  for (const rd of c.roads) for (const p of rd.path) { const k = `${Math.floor(p.x / 250)},${Math.floor(p.z / 250)}`; const l = roadCells.get(k); if (l) l.push(p); else roadCells.set(k, [p]); }
  const nearRoad = (x: number, z: number, m: number) => {
    for (let i = Math.floor((x - m) / 250); i <= Math.floor((x + m) / 250); i++) for (let j = Math.floor((z - m) / 250); j <= Math.floor((z + m) / 250); j++)
      for (const p of roadCells.get(`${i},${j}`) ?? []) if (Math.hypot(p.x - x, p.z - z) < m) return true;
    return false;
  };
  const nearest = (x: number, z: number) => c.grid.nearest(x, z);
  // is a site of this size clear here?
  const clear = (type: IndustryId, x: number, z: number, w: number, d: number, gap: number, own?: number) => {
    const R = Math.hypot(w, d) / 2;
    if (Math.abs(x) > H - R - 300 || Math.abs(z) > H - R - 300) return false;
    if (Math.max(Math.abs(x), Math.abs(z)) < LIVE_HALF + R + 1500) return false;
    const coast = type === 'port';
    if (c.water.edgeDistance({ x, z }, R + 100) < (coast ? 10 : R + 40)) return false;
    if (!coast && c.water.seaDistance(x, z, R + 300) < R + 150) return false;
    for (const s of c.grid.near(x, z)) if (Math.hypot(s.x - x, s.z - z) < s.reach + R + (s.id === own ? 20 : 250)) return false;
    for (const o of out) if (Math.hypot(o.x - x, o.z - z) < (o.type === type ? gap : 400) + R) return false;
    return !nearRoad(x, z, R + 25);
  };
  const add = (type: IndustryId, x: number, z: number, rot: number, settlement: number) => {
    const T = INDUSTRY_TYPES[type];
    out.push({ id: out.length, type, x: Math.round(x), z: Math.round(z), rot, w: T.size.w, d: T.size.d, settlement, seed: mix(c.seed, 402, out.length) });
  };
  // (a site faces the nearest road, roughly: the lane in runs to its front)
  const facing = (x: number, z: number) => { const s = nearest(x, z); return Math.atan2(-(s.x - x), s.z - z); };

  // the docks: on the coast by the town nearest the sea (and a refinery behind them)
  let port: WorldIndustry | null = null;
  if (c.water.world.sea && buildable('port', year)) {
    const towns = c.settlements.filter((s) => s.kind !== 'village' && s.id !== 0).map((s) => ({ s, d: c.water.seaDistance(s.x, s.z, 6000) })).filter((t) => t.d < 5000).sort((a, b) => a.d - b.d);
    const T = INDUSTRY_TYPES.port;
    for (const { s } of towns) {
      for (let k = 0; k < 400 && !port; k++) {
        const a = range(r, 0, 6.2832), dd = range(r, s.reach + 150, s.reach + 2500), x = s.x + Math.cos(a) * dd, z = s.z + Math.sin(a) * dd;
        const sd = c.water.seaDistance(x, z, 400);
        if (sd < 30 || sd > 140 || !clear('port', x, z, T.size.w, T.size.d, 0, s.id)) continue;
        // (its frontage, the quay, faces the sea: down the sea distance's slope)
        const gx = c.water.seaDistance(x + 20, z, 400) - c.water.seaDistance(x - 20, z, 400), gz = c.water.seaDistance(x, z + 20, 400) - c.water.seaDistance(x, z - 20, 400);
        add('port', x, z, Math.atan2(gx, -gz), s.id);
        port = out[out.length - 1];
      }
      if (port) break;
    }
  }
  // the works at the edges of the towns and cities
  const works: [WorldSettlement, IndustryId][] = [];
  let t = Math.floor(r() * TOWN_WORKS.length), once = new Set<IndustryId>();
  for (const s of c.settlements) {
    if (s.id === 0 || s.kind === 'village') continue;
    if (s.kind === 'city') for (const k of CITY_WORKS) { if ((k === 'steelworks' || k === 'power_station') && once.has(k)) continue; once.add(k); works.push([s, k]); }
    else works.push([s, TOWN_WORKS[t++ % TOWN_WORKS.length]]);
  }
  if (port && buildable('refinery', year)) works.push([c.settlements[port.settlement], 'refinery']);
  for (const [s, type] of works) {
    if (!buildable(type, year)) continue;
    const T = INDUSTRY_TYPES[type];
    for (let k = 0; k < 300; k++) {
      const a = range(r, 0, 6.2832), dd = range(r, s.reach + 80, s.reach + 900), x = s.x + Math.cos(a) * dd, z = s.z + Math.sin(a) * dd;
      if (!clear(type, x, z, T.size.w, T.size.d, 600, s.id)) continue;
      add(type, x, z, Math.atan2(-(s.x - x), s.z - z), s.id);
      break;
    }
  }
  // out in the country, on the land that suits each
  const suits: Partial<Record<IndustryId, (x: number, z: number) => boolean>> = {
    farm: (x, z) => c.heightAt(x, z) < q(0.6) && slope(x, z) < 0.05,
    quarry: (x, z) => c.heightAt(x, z) > q(0.8),
    forest: (x, z) => c.heightAt(x, z) > q(0.45) && slope(x, z) > 0.02,
    oil_well: (x, z) => c.heightAt(x, z) < q(0.4) && slope(x, z) < 0.03,
    coal_mine: (x, z) => c.heightAt(x, z) > q(0.5) && c.heightAt(x, z) < q(0.9),
  };
  for (const { type, n, gap } of RURAL) {
    if (!buildable(type, year)) continue;
    const T = INDUSTRY_TYPES[type], want = Math.round(range(r, n[0], n[1] + 0.999) * area - 0.49);
    let made = 0;
    for (let k = 0; k < want * 120 && made < want; k++) {
      const x = range(r, -H, H), z = range(r, -H, H);
      if (!suits[type]!(x, z) || !clear(type, x, z, T.size.w, T.size.d, gap)) continue;
      add(type, x, z, facing(x, z), nearest(x, z).id);
      made++;
    }
  }
  return out;
}

// ---------------- how the scenery draws them ----------------
// A site as the scenery's buildings (sheds, a chimney or a headframe, silos or tanks: the shape that
// says what it is from far off), and its yard.
export function industryScene(ind: WorldIndustry): { buildings: SceneBuilding[]; yard: XZ[] } {
  const r: Rand = rng(ind.seed), co = Math.cos(ind.rot), si = Math.sin(ind.rot);
  const at = (u: number, v: number) => ({ x: ind.x + u * co - v * si, z: ind.z + u * si + v * co });
  const out: SceneBuilding[] = [];
  const put = (u: number, v: number, w: number, d: number, h: number, kind: SceneBuilding['kind'], wall: number, roof: number, ridge = 0) => {
    const p = at(u, v);
    out.push({ x: p.x, z: p.z, w, d, rot: ind.rot, h, ridge, wall, roof, kind, settlement: ind.settlement });
  };
  const W = ind.w, D = ind.d;
  switch (ind.type) {
    case 'farm': put(-W * 0.2, D * 0.1, 11, 8, 5.5, 'farm', 4 + Math.floor(r() * 2), 2, 3); put(W * 0.2, D * 0.15, 24, 12, 6, 'barn', 13, 6, 2.5); put(W * 0.2, -D * 0.2, 5, 5, 11, 'shed', 12, 7); break;
    case 'quarry': put(-W * 0.3, -D * 0.35, 18, 10, 7, 'shed', 12, 6); put(W * 0.25, -D * 0.35, 6, 6, 14, 'shed', 9, 7); break;
    case 'forest': put(-W * 0.3, -D * 0.35, 14, 8, 5, 'shed', 1, 4, 2); break;
    case 'oil_well': put(0, -D * 0.3, 7, 7, 6, 'shed', 12, 7); put(-W * 0.25, D * 0.1, 6, 6, 8, 'shed', 9, 7); put(W * 0.25, D * 0.1, 6, 6, 8, 'shed', 9, 7); break;
    case 'coal_mine': put(-W * 0.2, 0, 30, 18, 9, 'shed', 1, 0, 3); put(W * 0.25, -D * 0.1, 6, 6, 26, 'shed', 1, 7); break;
    case 'port': put(0, D * 0.2, W * 0.6, 22, 11, 'shed', 12, 5); put(-W * 0.35, -D * 0.25, 6, 6, 30, 'shed', 11, 7); put(W * 0.3, D * 0.25, 16, 16, 9, 'shed', 9, 6); break;
    case 'power_station': put(0, 0, W * 0.45, D * 0.4, 28, 'shed', 2, 7); put(W * 0.35, D * 0.2, 9, 9, 70, 'shed', 12, 7); break;
    case 'steelworks': put(-W * 0.2, 0, W * 0.45, D * 0.5, 22, 'shed', 11, 5); put(W * 0.3, -D * 0.1, 8, 8, 45, 'shed', 12, 7); put(W * 0.3, D * 0.25, 12, 12, 18, 'shed', 9, 7); break;
    case 'refinery': put(-W * 0.25, 0, 20, 14, 8, 'shed', 12, 7); put(W * 0.1, D * 0.15, 5, 5, 38, 'shed', 9, 7); for (let k = 0; k < 3; k++) put(W * 0.3, -D * 0.3 + k * 18, 12, 12, 10, 'shed', 6, 7); break;
    case 'brewery': put(0, D * 0.05, W * 0.55, D * 0.45, 12, 'shed', 1, 0, 3); put(W * 0.3, -D * 0.2, 4, 4, 24, 'shed', 2, 7); break;
    default: put(0, D * 0.05, W * 0.6, D * 0.5, 9 + r() * 3, 'shed', 12 + Math.floor(r() * 2), 5 + Math.floor(r() * 2)); break;
  }
  // (a farm's yard is round its buildings, not the whole holding)
  const yw = ind.type === 'farm' ? 62 : W, yd = ind.type === 'farm' ? 46 : D;
  const yard = [at(-yw / 2, -yd / 2), at(yw / 2, -yd / 2), at(yw / 2, yd / 2), at(-yw / 2, yd / 2)];
  return { buildings: out, yard };
}
