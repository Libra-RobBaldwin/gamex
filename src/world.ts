// Seeded world generation: island terrain, towns with street grids, industries.
import type { CargoId, IndustryKind } from './defs';
import { EdgeGrid } from './geo';

export const T_GRASS = 0;
export const T_WATER = 1;
export const T_SAND = 2;
export const T_FOREST = 3;

export interface Town {
  id: number;
  name: string;
  cx: number;
  cy: number;
  growth: number; // points towards the next building
  served: number; // passengers + goods handled, lifetime
  parent?: number; // suburbs belong to a parent town
}

export interface Industry {
  id: number;
  kind: IndustryKind;
  x: number;
  y: number;
  name: string;
  stock: Partial<Record<CargoId, number>>;
  input: Partial<Record<CargoId, number>>;
  rate: number; // production multiplier
  produced: number; // this period
  moved: number; // this period
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function valueNoise(w: number, h: number, cell: number, rand: () => number): Float32Array {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh).map(() => rand());
  const out = new Float32Array(w * h);
  const s = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = x / cell, fy = y / cell;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = s(fx - ix), ty = s(fy - iy);
      const a = grid[iy * gw + ix], b = grid[iy * gw + ix + 1];
      const c = grid[(iy + 1) * gw + ix], d = grid[(iy + 1) * gw + ix + 1];
      out[y * w + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  return out;
}

export const TOWN_NAMES = [
  'Kingsbridge', 'Ashford Vale', 'Marlow Heath', 'Redcliffe', 'Brampton', 'Easthaven',
  'Thornbury', 'Wexcombe', 'Hollins Cross', 'Saltmere', 'Darrowby', 'Fenwick',
];

export interface World {
  seed: number;
  w: number;
  h: number;
  terrain: Uint8Array;
  bld: Uint8Array; // building level per tile (0 = none)
  bldTown: Int16Array; // owning town id, -1 none
  road: EdgeGrid;
  towns: Town[];
  industries: Industry[];
  start: { x: number; y: number };
}

export function generateWorld(seed: number, w = 56, h = 56): World {
  const rand = rng(seed);
  const n1 = valueNoise(w, h, 18, rand);
  const n2 = valueNoise(w, h, 7, rand);
  const moist = valueNoise(w, h, 8, rand);
  const terrain = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (x - cx) / cx, dy = (y - cy) / cy;
      const edge = Math.max(0, Math.hypot(dx, dy) - 0.62) * 1.8;
      const e = n1[i] * 0.65 + n2[i] * 0.35 - edge;
      terrain[i] = e < 0.28 ? T_WATER : e < 0.31 ? T_SAND : moist[i] > 0.63 ? T_FOREST : T_GRASS;
    }

  const bld = new Uint8Array(w * h);
  const bldTown = new Int16Array(w * h).fill(-1);
  const road = new EdgeGrid(w, h);
  const blocked = new Uint8Array(w * h); // towns + industries footprint
  const idx = (x: number, y: number) => y * w + x;
  const inB = (x: number, y: number) => x >= 1 && y >= 1 && x < w - 1 && y < h - 1;
  const land = (x: number, y: number) => inB(x, y) && terrain[idx(x, y)] !== T_WATER;

  const landArea = (x: number, y: number, r: number) => {
    let n = 0, t = 0;
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) { t++; if (land(xx, yy)) n++; }
    return n / t;
  };

  // --- towns ---
  const towns: Town[] = [];
  const wanted = 6;
  for (let tries = 0; tries < 4000 && towns.length < wanted; tries++) {
    const x = 5 + Math.floor(rand() * (w - 10)), y = 5 + Math.floor(rand() * (h - 10));
    if (landArea(x, y, 4) < 0.92) continue;
    if (towns.some((t) => Math.hypot(t.cx - x, t.cy - y) < 15)) continue;
    towns.push({ id: towns.length, name: TOWN_NAMES[towns.length], cx: x, cy: y, growth: 0, served: 0 });
  }
  // Biggest town nearest the middle.
  towns.sort((a, b) => Math.hypot(a.cx - cx, a.cy - cy) - Math.hypot(b.cx - cx, b.cy - cy));
  towns.forEach((t, i) => { t.id = i; t.name = TOWN_NAMES[i]; });

  towns.forEach((t, i) => {
    const R = i === 0 ? 5 : i < 3 ? 4 : 3;
    layTown(t, R, i === 0 ? 2.4 : 1.3);
  });

  function layTown(t: Town, R: number, density: number) {
    const street = (x: number, y: number) =>
      Math.abs(x - t.cx) <= R && Math.abs(y - t.cy) <= R && land(x, y) &&
      ((y - t.cy) % 3 === 0 || (x - t.cx) % 3 === 0);
    for (let y = t.cy - R; y <= t.cy + R; y++)
      for (let x = t.cx - R; x <= t.cx + R; x++) {
        if (!street(x, y)) continue;
        if (street(x + 1, y) && (y - t.cy) % 3 === 0) road.set(idx(x, y), 0, 1);
        if (street(x, y + 1) && (x - t.cx) % 3 === 0) road.set(idx(x, y), 2, 1);
      }
    for (let y = t.cy - R - 1; y <= t.cy + R + 1; y++)
      for (let x = t.cx - R - 1; x <= t.cx + R + 1; x++) {
        if (!land(x, y)) continue;
        const i = idx(x, y);
        if (road.any(i)) { blocked[i] = 1; continue; }
        const d = Math.hypot(x - t.cx, y - t.cy);
        const p = Math.max(0, 1 - d / (R + 1.5)) * density;
        if (rand() > p) continue;
        let level = 1;
        if (d < R * 0.35 && rand() < density * 0.35) level = 3;
        else if (d < R * 0.7 && rand() < density * 0.4) level = 2;
        bld[i] = level;
        bldTown[i] = t.id;
        blocked[i] = 1;
        if (terrain[i] === T_FOREST) terrain[i] = T_GRASS;
      }
  }

  // --- industries (2x2 footprints) ---
  const industries: Industry[] = [];
  const freeRect = (x: number, y: number, pad: number) => {
    for (let yy = y - pad; yy < y + 2 + pad; yy++)
      for (let xx = x - pad; xx < x + 2 + pad; xx++) {
        if (!inB(xx, yy)) return false;
        if (blocked[idx(xx, yy)]) return false;
      }
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (!land(xx, yy)) return false;
    return true;
  };
  const nearestTown = (x: number, y: number) =>
    towns.reduce((best, t) => (Math.hypot(t.cx - x, t.cy - y) < Math.hypot(best.cx - x, best.cy - y) ? t : best), towns[0]);
  const placeIndustry = (kind: IndustryKind): Industry | null => {
    for (let tries = 0; tries < 3000; tries++) {
      const x = 2 + Math.floor(rand() * (w - 5)), y = 2 + Math.floor(rand() * (h - 5));
      if (!freeRect(x, y, 2)) continue;
      if (towns.some((t) => Math.hypot(t.cx - x, t.cy - y) < 8)) continue;
      if (industries.some((o) => Math.hypot(o.x - x, o.y - y) < 7)) continue;
      const ind = makeIndustry(industries.length, kind, x, y, nearestTown(x, y).name);
      industries.push(ind);
      for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) {
        blocked[idx(xx, yy)] = 1;
        terrain[idx(xx, yy)] = T_GRASS;
      }
      return ind;
    }
    return null;
  };
  const plan: IndustryKind[] = ['coal_mine', 'power_station', 'forest', 'sawmill', 'farm', 'food_plant', 'coal_mine', 'forest', 'farm', 'power_station'];
  for (const k of plan) placeIndustry(k);

  const start = towns[0] ? { x: towns[0].cx, y: towns[0].cy } : { x: cx, y: cy };
  return { seed, w, h, terrain, bld, bldTown, road, towns, industries, start };
}

export function makeIndustry(id: number, kind: IndustryKind, x: number, y: number, townName: string): Industry {
  const label: Record<IndustryKind, string> = {
    coal_mine: 'Colliery', power_station: 'Power Station', forest: 'Forest', sawmill: 'Sawmill', farm: 'Farm', food_plant: 'Food Plant',
  };
  return { id, kind, x, y, name: `${townName} ${label[kind]}`, stock: {}, input: {}, rate: 1, produced: 0, moved: 0 };
}
