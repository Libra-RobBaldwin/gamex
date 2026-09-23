// Procedural world generation: terrain + pre-placed resources, industries and towns.
import type { BuildingKind, CargoId } from './data';

export const T_GRASS = 0;
export const T_WATER = 1;
export const T_SAND = 2;
export const T_MOUNTAIN = 3;
export const T_FOREST = 4; // decorative grass variant, buildable

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  stock: Partial<Record<CargoId, number>>;
  input: Partial<Record<CargoId, number>>;
  progress: number[];
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

function valueNoise(w: number, h: number, cell: number, rand: () => number): Float32Array {
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

const TOWN_NAMES = ['Lumbrook', 'Varrowmere', 'Fally Cross', 'Draymoor', 'Rimwick', 'Catherby Vale', 'Ardenholt', 'Seers Hollow'];

export interface GeneratedWorld {
  w: number;
  h: number;
  terrain: Uint8Array;
  buildings: Building[];
  start: { x: number; y: number };
}

export function generateWorld(seed: number, w = 64, h = 64): GeneratedWorld {
  const rand = rng(seed);
  const n1 = valueNoise(w, h, 16, rand);
  const n2 = valueNoise(w, h, 7, rand);
  const n3 = valueNoise(w, h, 3, rand);
  const moist = valueNoise(w, h, 10, rand);
  const terrain = new Uint8Array(w * h);
  const cx = w / 2, cy = h / 2;
  const elev = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Keep the centre as land, drop towards the edges into sea.
      const dx = (x - cx) / cx, dy = (y - cy) / cy;
      const edge = Math.max(0, Math.sqrt(dx * dx + dy * dy) - 0.55) * 1.4;
      const e = n1[i] * 0.55 + n2[i] * 0.3 + n3[i] * 0.15 - edge;
      elev[i] = e;
      let t = T_GRASS;
      if (e < 0.3) t = T_WATER;
      else if (e < 0.34) t = T_SAND;
      else if (e > 0.72) t = T_MOUNTAIN;
      else if (moist[i] > 0.62) t = T_FOREST;
      terrain[i] = t;
    }

  const buildings: Building[] = [];
  const used = new Uint8Array(w * h);
  let nextId = 1;
  const idx = (x: number, y: number) => y * w + x;
  const inB = (x: number, y: number) => x >= 1 && y >= 1 && x < w - 1 && y < h - 1;
  const land = (x: number, y: number) => {
    const t = terrain[idx(x, y)];
    return t === T_GRASS || t === T_FOREST;
  };
  const free = (x: number, y: number, bw = 1, bh = 1, pad = 1) => {
    for (let yy = y - pad; yy < y + bh + pad; yy++)
      for (let xx = x - pad; xx < x + bw + pad; xx++) {
        if (!inB(xx, yy)) return false;
        if (used[idx(xx, yy)]) return false;
      }
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) if (!land(xx, yy)) return false;
    return true;
  };
  const add = (kind: BuildingKind, x: number, y: number, bw = 1, bh = 1, name?: string) => {
    for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) used[idx(xx, yy)] = 1;
    const b: Building = { id: nextId++, kind, x, y, w: bw, h: bh, name: name ?? '', stock: {}, input: {}, progress: [] };
    buildings.push(b);
    return b;
  };
  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

  // Find a spot near (x,y) at distance [dmin,dmax] satisfying predicate.
  const near = (
    x: number, y: number, dmin: number, dmax: number,
    ok: (x: number, y: number) => boolean, tries = 400,
  ): { x: number; y: number } | null => {
    for (let i = 0; i < tries; i++) {
      const a = rand() * Math.PI * 2;
      const d = dmin + rand() * (dmax - dmin);
      const px = Math.round(x + Math.cos(a) * d), py = Math.round(y + Math.sin(a) * d);
      if (inB(px, py) && ok(px, py)) return { x: px, y: py };
    }
    return null;
  };
  const cluster = (kind: BuildingKind, x: number, y: number, count: number, spread = 3) => {
    let placed = 0;
    for (let i = 0; i < count * 8 && placed < count; i++) {
      const p = near(x, y, 0, spread, (px, py) => free(px, py, 1, 1, 0), 30);
      if (p) { add(kind, p.x, p.y); placed++; }
    }
  };
  const nearTerrain = (x: number, y: number, t: number, r: number) => {
    for (let yy = y - r; yy <= y + r; yy++)
      for (let xx = x - r; xx <= x + r; xx++)
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && terrain[idx(xx, yy)] === t) return true;
    return false;
  };

  // Towns: start town near the middle, others spread out.
  const towns: { x: number; y: number }[] = [];
  const startTown = near(cx, cy, 0, 10, (x, y) => free(x, y, 2, 2, 2), 2000) ?? { x: Math.floor(cx), y: Math.floor(cy) };
  towns.push(startTown);
  for (let i = 0; i < 2000 && towns.length < 5; i++) {
    const x = 4 + Math.floor(rand() * (w - 8)), y = 4 + Math.floor(rand() * (h - 8));
    if (!free(x, y, 2, 2, 2)) continue;
    if (towns.some((t) => dist(t.x, t.y, x, y) < 17)) continue;
    towns.push({ x, y });
  }
  towns.forEach((t, i) => add('town', t.x, t.y, 2, 2, TOWN_NAMES[i % TOWN_NAMES.length]));

  // Starter chain: trees -> sawmill -> start town.
  const sx = startTown.x, sy = startTown.y;
  const saw = near(sx, sy, 7, 10, (x, y) => free(x, y, 1, 1, 2), 2000);
  if (saw) {
    add('sawmill', saw.x, saw.y, 1, 1, 'Sawmill');
    const grove = near(saw.x, saw.y, 6, 9, (x, y) => free(x, y, 1, 1, 1) && dist(x, y, sx, sy) > 6, 2000);
    if (grove) cluster('tree', grove.x, grove.y, 5, 2.5);
  }

  // Fishing near a shore + cooking range.
  const shoreOk = (x: number, y: number) =>
    terrain[idx(x, y)] === T_WATER && !used[idx(x, y)] &&
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inB(x + dx, y + dy) && terrain[idx(x + dx, y + dy)] !== T_WATER);
  const fish = near(sx, sy, 6, 24, shoreOk, 4000);
  if (fish) {
    add('fishing_spot', fish.x, fish.y);
    const f2 = near(fish.x, fish.y, 1, 4, shoreOk, 200);
    if (f2) add('fishing_spot', f2.x, f2.y);
    const rng2 = near(fish.x, fish.y, 5, 9, (x, y) => free(x, y, 1, 1, 1), 1000);
    if (rng2) add('range', rng2.x, rng2.y, 1, 1, 'Cooking range');
  }

  // Mine: copper + tin near mountains, with a furnace.
  const mineOk = (x: number, y: number) => free(x, y, 1, 1, 1) && nearTerrain(x, y, T_MOUNTAIN, 2);
  const mine = near(sx, sy, 10, 22, mineOk, 4000) ?? near(sx, sy, 10, 22, (x, y) => free(x, y, 1, 1, 1), 2000);
  if (mine) {
    cluster('copper_rock', mine.x, mine.y, 3, 2);
    const tin = near(mine.x, mine.y, 3, 5, (x, y) => free(x, y, 1, 1, 0), 400);
    if (tin) cluster('tin_rock', tin.x, tin.y, 3, 2);
    const fur = near(mine.x, mine.y, 7, 11, (x, y) => free(x, y, 1, 1, 2), 2000);
    if (fur) add('furnace', fur.x, fur.y, 1, 1, 'Furnace');
  }

  // Higher tier resources further out.
  const farFrom = (x: number, y: number, dmin: number) => dist(x, y, sx, sy) >= dmin;
  const pick = (ok: (x: number, y: number) => boolean) => {
    for (let i = 0; i < 4000; i++) {
      const x = 2 + Math.floor(rand() * (w - 4)), y = 2 + Math.floor(rand() * (h - 4));
      if (ok(x, y)) return { x, y };
    }
    return null;
  };
  for (let k = 0; k < 2; k++) {
    const o = pick((x, y) => free(x, y, 1, 1, 1) && farFrom(x, y, 12) && terrain[idx(x, y)] === T_FOREST);
    if (o) cluster('oak', o.x, o.y, 4, 2.5);
  }
  for (let k = 0; k < 2; k++) {
    const o = pick((x, y) => free(x, y, 1, 1, 1) && farFrom(x, y, 16) && nearTerrain(x, y, T_WATER, 2));
    if (o) cluster('willow', o.x, o.y, 3, 2);
  }
  for (let k = 0; k < 2; k++) {
    const o = pick((x, y) => free(x, y, 1, 1, 1) && farFrom(x, y, 16) && nearTerrain(x, y, T_MOUNTAIN, 2));
    if (o) cluster('iron_rock', o.x, o.y, 3, 2);
  }
  for (let k = 0; k < 2; k++) {
    const o = pick((x, y) => free(x, y, 1, 1, 1) && farFrom(x, y, 20) && nearTerrain(x, y, T_MOUNTAIN, 3));
    if (o) cluster('coal_rock', o.x, o.y, 3, 2);
  }
  for (let k = 0; k < 2; k++) {
    const o = pick((x, y) => shoreOk(x, y) && farFrom(x, y, 18));
    if (o) add('trout_spot', o.x, o.y);
  }
  // A few extra plain trees everywhere and extra industries near other towns.
  for (let k = 0; k < 4; k++) {
    const o = pick((x, y) => free(x, y, 1, 1, 1) && farFrom(x, y, 10));
    if (o) cluster('tree', o.x, o.y, 3, 2);
  }
  towns.slice(1).forEach((t, i) => {
    const kind: BuildingKind = i % 2 === 0 ? 'furnace' : 'sawmill';
    const p = near(t.x, t.y, 6, 10, (x, y) => free(x, y, 1, 1, 2), 1000);
    if (p) add(kind, p.x, p.y, 1, 1, kind === 'furnace' ? 'Furnace' : 'Sawmill');
  });

  return { w, h, terrain, buildings, start: { x: sx + 1, y: sy + 1 } };
}
