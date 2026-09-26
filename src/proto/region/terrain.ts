// A map's hills: a height field that everything drawn follows (drape.ts), and the ground mesh is
// built on. Hills rise between the places: the ground is level in and round every settlement and
// along every river and lake (so towns, their streets and plots, and the water, stand on the flat
// as before), and swells up into rolling country between them, where the motorways and railways run.
//
// The heights are on a square grid (STEP metres), and between grid points they're planar over the
// two triangles of each cell, split along the (i+1, j)–(i, j+1) diagonal: exactly how the ground
// mesh is triangulated. So anything placed at `heightAt(x, z)`, on the CPU or in a shader, lies on
// the ground mesh itself: no gaps, no fighting.
//
// Pure: no three.js, no DOM. The same map (options) always gives the same hills.
import { reach, type Kind } from './generate';
import { rng, mix } from './random';
import { MapWater, lakeBox, type WaterSpec } from './water';
import type { Relief } from './options';

export const STEP = 25; // m between grid points
// the hills' height (m) above the valley floors for each relief
export const RELIEF_HEIGHT: Record<Relief, number> = { flat: 0, lowland: 10, rolling: 32, upland: 60, mountain: 110 };

export interface ReliefField {
  x0: number; z0: number; step: number; n: number; // grid: n × n points from (x0, z0)
  h: Float32Array; // heights, row by row (z outer): h[j * n + i] is at (x0 + i·step, z0 + j·step)
  max: number; // the highest point
  heightAt(x: number, z: number): number; // planar over the ground mesh's triangles (see above)
}

// the parts of a map the hills need
export interface ReliefInput {
  relief: Relief;
  seed: number;
  water: WaterSpec;
  settlements: { x: number; z: number; r: number; kind: Kind }[];
  ground?: { x0: number; z0: number; step: number; n: number; h: Float32Array; max: number }; // a real map's own relief (real/map.ts)
}

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Seeded gradient noise (2D Perlin-style) and a few octaves of it.
function noise2(seed: number) {
  const r = rng(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gz = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const g = (i: number, j: number, dx: number, dz: number) => { const k = perm[(perm[(xi + i) & 255] + zi + j) & 255]; return gx[k] * dx + gz[k] * dz; };
    const u = fade(xf), v = fade(zf);
    const a = g(0, 0, xf, zf) + u * (g(1, 0, xf - 1, zf) - g(0, 0, xf, zf));
    const b = g(0, 1, xf, zf - 1) + u * (g(1, 1, xf - 1, zf - 1) - g(0, 1, xf, zf - 1));
    return (a + v * (b - a)) * 1.4; // (about −1 to 1)
  };
}

// The hills for a map, over a square `half` metres each way from the centre (the ground's
// extent), or null for a flat map.
export function makeRelief(m: ReliefInput, half: number): ReliefField | null {
  if (m.ground) return field(m.ground.x0, m.ground.z0, m.ground.step, m.ground.n, m.ground.h, m.ground.max);
  const A = RELIEF_HEIGHT[m.relief];
  if (!A) return null;
  const n1 = noise2(mix(m.seed, 11)), n2 = noise2(mix(m.seed, 12)), n3 = noise2(mix(m.seed, 13));
  const ridged = m.relief === 'upland' || m.relief === 'mountain';
  const mw = new MapWater(m.water);
  const x0 = -Math.ceil(half / STEP) * STEP, z0 = x0, n = Math.round((-2 * x0) / STEP) + 1;
  const h = new Float32Array(n * n);
  // the level ground round lakes: their whole box (as the ground mesh cuts it, snapped out to the grid), and a margin
  const boxes = m.water.lakes.map(lakeBox).map((B) => ({ x0: Math.floor(B.x0 / STEP) * STEP - STEP, z0: Math.floor(B.z0 / STEP) * STEP - STEP, x1: Math.ceil(B.x1 / STEP) * STEP + STEP, z1: Math.ceil(B.z1 / STEP) * STEP + STEP }));
  const places = m.settlements.map((s) => ({ ...s, R: reach(s.kind, s.r) + 60 }));
  // distance to the nearest river, on a coarse grid (the valley's sides are hundreds of metres wide)
  const C = 100, cn = Math.ceil((2 * -x0) / C) + 2, rd = new Float32Array(cn * cn);
  if (mw.rivers.length) for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) rd[j * cn + i] = mw.edgeDistance({ x: x0 + i * C, z: z0 + j * C }, 900);
  const riverD = (x: number, z: number) => {
    const gx = Math.min(cn - 1.001, (x - x0) / C), gz = Math.min(cn - 1.001, (z - z0) / C), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * cn + i;
    return (rd[k] * (1 - fx) + rd[k + 1] * fx) * (1 - fz) + (rd[k + cn] * (1 - fx) + rd[k + cn + 1] * fx) * fz;
  };
  let max = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * STEP, z = z0 + j * STEP;
    // how far into the hills: 0 on the flat round places and water, 1 well away from them
    let k = 1;
    for (const s of places) { const d = Math.hypot(x - s.x, z - s.z) - s.R; if (d < 500) k = Math.min(k, smooth(0, 500, d)); }
    for (const B of boxes) { const d = Math.max(B.x0 - x, x - B.x1, B.z0 - z, z - B.z1); if (d < 450) k = Math.min(k, smooth(0, 450, d)); }
    if (k > 0 && mw.rivers.length) k = Math.min(k, smooth(110, 650, riverD(x, z)));
    if (k <= 0) continue;
    // broad swells, then smaller hills on them (and ridges on upland and mountain maps)
    const p = { x: x / 1400, z: z / 1400 };
    let f = 0.62 * n1(p.x, p.z) + 0.28 * n2(p.x * 2.1 + 5.3, p.z * 2.1 - 1.7) + 0.1 * n3(p.x * 4.3 - 2.2, p.z * 4.3 + 7.1);
    if (ridged) f = 0.55 * f + 0.45 * (1 - 2 * Math.abs(n3(p.x * 1.7 + 11, p.z * 1.7 - 3)));
    const v = A * k * Math.max(0, Math.min(1, 0.45 + 0.75 * f));
    h[j * n + i] = v;
    if (v > max) max = v;
  }
  return field(x0, z0, STEP, n, h, max);
}

export function field(x0: number, z0: number, step: number, n: number, h: Float32Array, max: number): ReliefField {
  const top = n - 1 - 1e-4;
  return {
    x0, z0, step, n, h, max,
    // (the shader in drape.ts does exactly this, in the same order)
    heightAt(x: number, z: number) {
      const gx = Math.max(0, Math.min(top, (x - x0) / step)), gz = Math.max(0, Math.min(top, (z - z0) / step));
      const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i;
      const h10 = h[k + 1], h01 = h[k + n];
      if (fx + fz <= 1) { const h00 = h[k]; return h00 + (h10 - h00) * fx + (h01 - h00) * fz; }
      const h11 = h[k + n + 1];
      return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    },
  };
}

// (for tests: the steepest slope between neighbouring grid points)
export function steepest(f: ReliefField) {
  let s = 0;
  for (let j = 0; j + 1 < f.n; j++) for (let i = 0; i + 1 < f.n; i++) {
    const k = j * f.n + i;
    s = Math.max(s, Math.abs(f.h[k + 1] - f.h[k]) / f.step, Math.abs(f.h[k + f.n] - f.h[k]) / f.step);
  }
  return s;
}
