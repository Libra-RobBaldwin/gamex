// Building platforms: levelling a plot on sloping ground.
//
// A building needs a level floor. On a slope the builder digs into the high side and builds up the
// low side to make a flat pad, grassing the edges where the step is small and putting in a
// retaining wall where it isn't. How steep a plot can be depends on what goes on it: a house can
// step into a hillside, a warehouse needs flat ground. This works out the pad level that moves the
// least earth, the cut and fill, the walls, and whether the kind of building can go there at all.

import { pointInPoly } from '../land';
import type { LotKind } from '../roads';
import type { HeightSource } from './height';

export interface XZ { x: number; z: number }
export interface PadRule { maxSlope: number; maxRetain: number }
// steepest ground (rise over run across the footprint) and tallest retaining wall per kind
export const PAD_RULES: Record<LotKind, PadRule> = {
  house: { maxSlope: 0.25, maxRetain: 2.5 },
  terrace: { maxSlope: 0.3, maxRetain: 2.5 }, // terraces step down a hill a house at a time
  shop: { maxSlope: 0.12, maxRetain: 2 },
  flats: { maxSlope: 0.18, maxRetain: 3 },
  office: { maxSlope: 0.12, maxRetain: 3 },
  tower: { maxSlope: 0.12, maxRetain: 4 },
  industry: { maxSlope: 0.06, maxRetain: 3 }, // big sheds and yards want flat ground
  civic: { maxSlope: 0.15, maxRetain: 2.5 },
};

export interface PadCosts { cut: number; fill: number; wall: number } // per m³, per m³, per m² of wall face
export const PAD_COSTS: PadCosts = { cut: 10, fill: 12, wall: 90 };

export interface Wall { a: XZ; b: XZ; height: number; side: 'cut' | 'fill' }
export interface Pad {
  ok: boolean; reason?: string;
  y: number; // the level of the pad (the building's ground floor)
  slope: number; // the ground's gradient across the footprint (best-fit plane)
  cut: number; fill: number; // m³
  maxCut: number; maxFill: number; // m, deepest dig and highest build-up
  walls: Wall[];
  cost: number;
}

export interface PadOpts {
  res?: number; // sample spacing, m (default 1; coarser for big footprints)
  batter?: number; // steps up to this height are graded slopes, taller ones need a wall (m)
  freeboard?: number; // how far a floor must be above nearby water (m)
  costs?: PadCosts;
}

// A lot's footprint as a polygon, turned the same way as roads.ts's rectCorners.
export function rectPoly(x: number, z: number, rot: number, w: number, d: number): XZ[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: x + c * (w / 2) * i - s * (d / 2) * j, z: z + s * (w / 2) * i + c * (d / 2) * j }));
}

export function levelPad(src: HeightSource, poly: XZ[], rule: PadRule | LotKind, o: PadOpts = {}): Pad {
  const R = typeof rule === 'string' ? PAD_RULES[rule] : rule, costs = o.costs ?? PAD_COSTS, batter = o.batter ?? 0.8;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  // about 1 m samples, but never more than ~2500 of them
  const res = Math.max(o.res ?? 1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 2500));
  const pts: { x: number; z: number; g: number }[] = [];
  let wet = false, water = -Infinity;
  for (let z = z0 + res / 2; z < z1; z += res) for (let x = x0 + res / 2; x < x1; x += res) {
    if (!pointInPoly({ x, z }, poly)) continue;
    pts.push({ x, z, g: src.heightAt(x, z) });
  }
  // tiny footprints: at least the corners and the middle
  if (pts.length < 5) for (const p of [...poly, { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }]) pts.push({ x: p.x, z: p.z, g: src.heightAt(p.x, p.z) });
  for (const p of [...poly, ...pts]) { const w = src.waterLevel(p.x, p.z); if (w !== null) { water = Math.max(water, w); if (w > src.heightAt(p.x, p.z)) wet = true; } }

  // the ground's best-fit plane g = a + bx·x + bz·z (about the centroid), for its slope
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length, mz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  let sxx = 0, sxz = 0, szz = 0, sxg = 0, szg = 0;
  for (const p of pts) { const dx = p.x - mx, dz = p.z - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; sxg += dx * p.g; szg += dz * p.g; }
  const det = sxx * szz - sxz * sxz, bx = det > 1e-9 ? (sxg * szz - szg * sxz) / det : 0, bz = det > 1e-9 ? (szg * sxx - sxg * sxz) / det : 0;
  const slope = Math.hypot(bx, bz);

  // the level with least cost: where the share of ground below it is cut/(cut + fill)
  const gs = pts.map((p) => p.g).sort((a, b) => a - b);
  const q = costs.cut / (costs.cut + costs.fill);
  let y = gs[Math.min(gs.length - 1, Math.max(0, Math.round(q * (gs.length - 1))))];
  if (water > -Infinity) y = Math.max(y, water + (o.freeboard ?? 0.3)); // floors stay out of the water

  const area = res * res;
  let cut = 0, fill = 0, maxCut = 0, maxFill = 0;
  for (const p of pts) { const d = p.g - y; if (d > 0) { cut += d * area; maxCut = Math.max(maxCut, d); } else { fill -= d * area; maxFill = Math.max(maxFill, -d); } }

  // walls: along each edge, the runs where the step to the natural ground is too tall to grade
  const walls: Wall[] = [];
  let wallArea = 0, tallest = 0;
  for (let e = 0; e < poly.length; e++) {
    const a = poly[e], b = poly[(e + 1) % poly.length], L = Math.hypot(b.x - a.x, b.z - a.z), m = Math.max(1, Math.ceil(L));
    let run: Wall | null = null;
    for (let k = 0; k <= m; k++) {
      const t = k / m, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, d = src.heightAt(p.x, p.z) - y;
      if (Math.abs(d) > batter) {
        const side = d > 0 ? 'cut' : 'fill';
        if (run && run.side === side) { run.b = p; run.height = Math.max(run.height, Math.abs(d)); }
        else { if (run) walls.push(run); run = { a: p, b: p, height: Math.abs(d), side }; }
        wallArea += (Math.abs(d) * L) / m; tallest = Math.max(tallest, Math.abs(d));
      } else if (run) { walls.push(run); run = null; }
    }
    if (run) walls.push(run);
  }
  const cost = cut * costs.cut + fill * costs.fill + wallArea * costs.wall;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const reason = wet ? 'In the water'
    : slope > R.maxSlope ? `Too steep: ${pct(slope)} across the plot, ${pct(R.maxSlope)} at most for this building`
      : tallest > R.maxRetain ? `Needs a ${tallest.toFixed(1)} m retaining wall, ${R.maxRetain} m at most for this building` : undefined;
  return { ok: !reason, reason, y, slope, cut, fill, maxCut, maxFill, walls, cost };
}
