// Hydrology for one region: a square of ground (8 km by default) with a margin around it, on a
// grid (32 m). From the ground it finds
//   - the sea: land below sea level that is connected to open water (the region's edge, or a big
//     enough body), so an inland hollow below sea level isn't sea;
//   - lakes: closed hollows filled to their spill level (priority-flood), where they are deep and
//     big enough to count, plus any water the height source already has (the procedural terrain's
//     lakes, or OpenStreetMap water on real data);
//   - rivers: every cell drains to a neighbour (the flood gives a tree with no pits); where the
//     catchment passes `riverArea` a stream begins, and streams join into rivers downstream.
// On the procedural terrain the drainage is steered onto its river lines (a trench is scored
// along them before flooding), so the rivers run down the valleys the terrain carved for them.
// Everything is a pure function of the height source, the parameters and the region's indices,
// so a region comes out the same whichever tile asks for it first.

import type { GridSpec, HeightSource } from '../terrain/height';
import { Noise2, hash32, smoothstep } from '../terrain/noise';
import { accumulate, label, priorityFlood } from './flood';
import { BANK_HEIGHT, CLASS_CODE, SPILL, chaikin, resample, type Reach } from './rivers';
import { NAV, type WaterParams } from './types';

// What the water system asks of a procedural terrain (see ProceduralTerrain.sampleBase).
export interface RiverTerrain extends HeightSource {
  sampleBase(g: GridSpec, out?: Float32Array, water?: Float32Array, river?: Float32Array): Float32Array;
  baseAt(x: number, z: number): { h: number; water: number | null };
  riverField(x: number, z: number): { v: number; lam: number; floor: number; half: number; mask: number } | null;
  readonly p: { seed: number; sea: number | null; rivers: number };
}
export const isRiverTerrain = (s: HeightSource): s is RiverTerrain => typeof (s as Partial<RiverTerrain>).sampleBase === 'function';

export interface Region {
  rx: number; rz: number;
  box: [number, number, number, number]; // interior, world metres
  g: GridSpec; // cell centres, margin included
  ground: Float32Array; // the ground (without any procedural channel)
  srcWater: Float32Array; // water the source already has (NaN where none)
  filled: Float32Array; // spill levels
  acc: Float32Array; // catchment, km²
  parent: Int32Array;
  sea: Uint8Array; // 1 = sea
  basin: Int32Array; // lake index per cell (−1 = none)
  basinLevel: number[];
  basinArea: number[]; // km²
  // the same, spread one cell each way, for the fine shoreline (a point is sea or lake if its
  // ground is below the level and its nearest cell is within a cell of the water)
  seaNear: Uint8Array;
  lakeNear: Int32Array; // the highest lake within a cell (−1 = none)
  reaches: Reach[];
  ms: number; // time taken to build
}

const STEP = 8; // m between river points

export function buildRegion(src: HeightSource, P: WaterParams, rx: number, rz: number): Region {
  const t0 = performance.now();
  const C = P.cell, n = Math.round((P.region + 2 * P.margin) / C);
  const g: GridSpec = { x0: rx * P.region - P.margin + C / 2, z0: rz * P.region - P.margin + C / 2, step: C, nx: n, nz: n };
  const N = n * n, cellKm2 = (C * C) / 1e6;
  const ground = new Float32Array(N), srcWater = new Float32Array(N).fill(NaN);
  const route = new Float32Array(N);
  // a little noise on the routing surface only (not the ground), so drainage across flats wanders
  // as streams do instead of running in grid-straight lines to the outlet
  const wn = new Noise2(hash32(isRiverTerrain(src) ? src.p.seed : 0, 0x77a1)), wander = (x: number, z: number) => 0.6 * wn.fbm(x / 160, z / 160, 2);
  const rt = isRiverTerrain(src) ? src : null;
  if (rt) {
    const rv = new Float32Array(N);
    rt.sampleBase(g, ground, srcWater, rv);
    const f = rt.riverField(g.x0, g.z0), lam = f ? f.lam : 0, w = 1.5 * C;
    for (let k = 0; k < N; k++) {
      const s = srcWater[k] === srcWater[k] ? Math.max(ground[k], srcWater[k]) : ground[k];
      // score a trench along the terrain's river lines so drainage follows its valleys
      const d = f ? (Math.abs(rv[k]) * lam) / 1.1 : Infinity;
      route[k] = (d < w ? s - 4 * (1 - d / w) : s) + wander(g.x0 + (k % n) * C, g.z0 + Math.floor(k / n) * C);
    }
  } else {
    src.sample(g, ground);
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const w = src.waterLevel(g.x0 + i * C, g.z0 + j * C);
      if (w !== null && w > ground[k]) srcWater[k] = w;
      route[k] = (srcWater[k] === srcWater[k] ? srcWater[k] : ground[k]) + wander(g.x0 + i * C, g.z0 + j * C);
    }
  }
  const seaLevel = P.sea;
  // ---- the sea: below sea level and connected to open water ----
  const sea = new Uint8Array(N);
  if (seaLevel !== null) {
    const { lab, sizes } = label(n, n, (k) => ground[k] < seaLevel);
    const open = new Uint8Array(sizes.length);
    for (let s = 0; s < sizes.length; s++) if (sizes[s] * cellKm2 >= P.seaArea) open[s] = 1;
    for (let k = 0; k < n; k++) for (const e of [k, (n - 1) * n + k, k * n, k * n + n - 1]) if (lab[e] >= 0) open[lab[e]] = 1;
    for (let k = 0; k < N; k++) if (lab[k] >= 0 && open[lab[k]]) sea[k] = 1;
  }
  // ---- drainage ----
  const outlet = new Uint8Array(N);
  for (let k = 0; k < n; k++) { outlet[k] = outlet[(n - 1) * n + k] = outlet[k * n] = outlet[k * n + n - 1] = 1; }
  for (let k = 0; k < N; k++) if (sea[k]) outlet[k] = 1;
  const fl = priorityFlood(route, n, n, outlet);
  const acc = accumulate(fl, cellKm2);
  // ---- lakes in closed hollows ----
  const surfaceOf = (k: number) => (srcWater[k] === srcWater[k] ? Math.max(ground[k], srcWater[k]) : ground[k]);
  const wet = (k: number) => !sea[k] && fl.filled[k] > surfaceOf(k) + 1e-3;
  const { lab, sizes } = label(n, n, wet, (a, b) => Math.abs(fl.filled[a] - fl.filled[b]) < 1e-3);
  const deep = new Float32Array(sizes.length), inflow = new Float32Array(sizes.length);
  for (let k = 0; k < N; k++) if (lab[k] >= 0) { const s = lab[k]; deep[s] = Math.max(deep[s], fl.filled[k] - surfaceOf(k)); inflow[s] = Math.max(inflow[s], acc[k]); }
  const basin = new Int32Array(N).fill(-1), basinLevel: number[] = [], basinArea: number[] = [], remap = new Int32Array(sizes.length).fill(-1);
  for (let s = 0; s < sizes.length; s++) if (deep[s] >= P.basinDepth + P.breach * Math.sqrt(inflow[s]) && sizes[s] * cellKm2 >= P.basinArea) { remap[s] = basinLevel.length; basinLevel.push(NaN); basinArea.push(sizes[s] * cellKm2); }
  for (let k = 0; k < N; k++) if (lab[k] >= 0 && remap[lab[k]] >= 0) { basin[k] = remap[lab[k]]; basinLevel[basin[k]] = fl.filled[k] - P.drawdown; }

  const seaNear = new Uint8Array(N), lakeNear = new Int32Array(N).fill(-1);
  for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const c = b * n + a;
      if (sea[c]) seaNear[k] = 1;
      const l = basin[c];
      if (l >= 0 && (lakeNear[k] < 0 || basinLevel[l] > basinLevel[lakeNear[k]])) lakeNear[k] = l;
    }
  }
  const R: Region = {
    rx, rz, box: [rx * P.region, rz * P.region, (rx + 1) * P.region, (rz + 1) * P.region], g, ground, srcWater,
    filled: fl.filled, acc, parent: fl.parent, sea, basin, basinLevel, basinArea, seaNear, lakeNear, reaches: [], ms: 0,
  };
  R.reaches = extractRivers(R, rt, P);
  R.ms = performance.now() - t0;
  return R;
}

// ---- helpers on the region grid ----
// Bilinear read of a region field at a world point (clamped to the grid).
export function regionAt(R: Region, a: ArrayLike<number>, x: number, z: number) {
  const g = R.g;
  let fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  fx = Math.max(0, Math.min(g.nx - 1.001, fx)); fz = Math.max(0, Math.min(g.nz - 1.001, fz));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * g.nx + i;
  return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + g.nx] * (1 - tx) + a[k + g.nx + 1] * tx) * tz;
}
// The nearest cell's index, and whether a point is within one cell of a cell passing `test`.
export function cellOf(R: Region, x: number, z: number) {
  const g = R.g, i = Math.max(0, Math.min(g.nx - 1, Math.round((x - g.x0) / g.step))), j = Math.max(0, Math.min(g.nz - 1, Math.round((z - g.z0) / g.step)));
  return j * g.nx + i;
}
export function nearCell(R: Region, x: number, z: number, test: (k: number) => boolean) {
  const g = R.g, c = cellOf(R, x, z), ci = c % g.nx, cj = (c - ci) / g.nx;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    if (i >= 0 && j >= 0 && i < g.nx && j < g.nz && test(j * g.nx + i)) return j * g.nx + i;
  }
  return -1;
}
// The highest basin lake within a cell of a point, or null.
export function basinNear(R: Region, x: number, z: number): { id: number; level: number } | null {
  const id = R.lakeNear[cellOf(R, x, z)];
  return id < 0 ? null : { id, level: R.basinLevel[id] };
}
// How much of the neighbourhood of a point belongs to a body: the bilinear blend of "is this cell
// part of it" over the four cells around it (1 well inside, ½ midway to the first cell outside).
export function share(R: Region, x: number, z: number, test: (k: number) => boolean) {
  const g = R.g;
  let fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  fx = Math.max(0, Math.min(g.nx - 1.001, fx)); fz = Math.max(0, Math.min(g.nz - 1.001, fz));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * g.nx + i;
  const v = (c: number) => (test(c) ? 1 : 0);
  return (v(k) * (1 - tx) + v(k + 1) * tx) * (1 - tz) + (v(k + g.nx) * (1 - tx) + v(k + g.nx + 1) * tx) * tz;
}
// The depth water must have to count at a point this far from its body's cells: none within them,
// rising to MARGIN_DEPTH a cell beyond, so a shoreline over a flat curves round instead of
// stopping dead at the edge of the grid cells.
export const MARGIN_DEPTH = 0.6;
export const marginDepth = (sh: number) => Math.max(0, 0.5 - sh) * 2 * MARGIN_DEPTH;

// ---- rivers ----
function extractRivers(R: Region, rt: RiverTerrain | null, P: WaterParams): Reach[] {
  const g = R.g, n = g.nx, N = n * n, { acc, parent, sea } = R;
  const isRiver = (k: number) => acc[k] >= P.riverArea && !sea[k];
  const kids = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (isRiver(k) && parent[k] >= 0 && isRiver(parent[k])) kids[parent[k]]++;
  // walk every source downstream to the next confluence, the sea or the edge
  type Raw = { cells: number[]; mouth: Reach['mouth']; start: number; end: number };
  const raws: Raw[] = [], startAt = new Map<number, number>();
  const queue: number[] = [];
  for (let k = 0; k < N; k++) if (isRiver(k) && kids[k] === 0) queue.push(k);
  for (let q = 0; q < queue.length; q++) {
    const s = queue[q], cells = [s];
    let c = s, mouth: Reach['mouth'] = 'edge';
    for (;;) {
      const p = parent[c];
      if (p < 0) { mouth = 'edge'; break; }
      cells.push(p);
      if (sea[p]) { mouth = 'sea'; break; }
      if (kids[p] >= 2) { mouth = 'join'; if (!startAt.has(p)) { startAt.set(p, -1); queue.push(p); } break; }
      c = p;
    }
    if (cells.length >= 2) raws.push({ cells, mouth, start: s, end: cells[cells.length - 1] });
  }
  raws.forEach((r, i) => { if (startAt.has(r.start)) startAt.set(r.start, i); });
  const X = (k: number) => g.x0 + (k % n) * g.step, Z = (k: number) => g.z0 + Math.floor(k / n) * g.step;

  // snap a point onto the procedural terrain's river line, if it's near one (Newton on the field)
  const snap = (x: number, z: number): [number, number] | null => {
    if (!rt) return null;
    let px = x, pz = z;
    for (let it = 0; it < 3; it++) {
      const f = rt.riverField(px, pz);
      if (!f) return null;
      const e = 2, fx = rt.riverField(px + e, pz)!, fz = rt.riverField(px, pz + e)!;
      const gx = (fx.v - f.v) / e, gz = (fz.v - f.v) / e, g2 = gx * gx + gz * gz;
      if (g2 < 1e-14) return null;
      px -= (f.v * gx) / g2; pz -= (f.v * gz) / g2;
    }
    return Math.hypot(px - x, pz - z) < 1.5 * P.cell ? [px, pz] : null;
  };
  const noise = new Noise2(hash32(rt?.p.seed ?? 0, 0x3a7e));
  const reaches: Reach[] = raws.map((raw, id) => {
    // cell centres, snapped, with any backtracking step dropped, then smoothed and resampled
    let xs: number[] = [], zs: number[] = [], as: number[] = [];
    const pin: boolean[] = [];
    raw.cells.forEach((c, q) => {
      const sp = snap(X(c), Z(c)), [x, z] = sp ?? [X(c), Z(c)], m = xs.length;
      if (m >= 2 && q < raw.cells.length - 1) {
        const ux = xs[m - 1] - xs[m - 2], uz = zs[m - 1] - zs[m - 2], vx = x - xs[m - 1], vz = z - zs[m - 1];
        if (ux * vx + uz * vz <= 0 || Math.hypot(vx, vz) < 4) return;
      }
      xs.push(x); zs.push(z); pin.push(sp !== null);
      // the sea (or confluence) cell collects everything draining into it: carry the last value on
      as.push(q === raw.cells.length - 1 && raw.mouth !== 'join' && q > 0 ? acc[raw.cells[q - 1]] : acc[c]);
    });
    if (xs.length < 2) { xs = [X(raw.cells[0]), X(raw.end)]; zs = [Z(raw.cells[0]), Z(raw.end)]; as = [acc[raw.cells[0]], acc[raw.cells[0]]]; }
    // where the drainage leaves a river line (or there is none) it is a grid staircase: relax
    // those points towards their neighbours, holding the snapped ones and the ends
    pin[0] = pin[xs.length - 1] = true;
    for (let it = 0; it < 12; it++) for (let k = 1; k + 1 < xs.length; k++) if (!pin[k]) {
      xs[k] = 0.5 * xs[k] + 0.25 * (xs[k - 1] + xs[k + 1]); zs[k] = 0.5 * zs[k] + 0.25 * (zs[k - 1] + zs[k + 1]);
    }
    // ...and let those stretches meander a little, as rivers crossing open ground do: a lateral
    // offset from noise, its wavelength and amplitude scaled to the river's width, fading to
    // nothing at the held points so the river still meets its valley and its confluences
    for (let k0 = 0; k0 + 1 < xs.length;) {
      let k1 = k0 + 1;
      while (k1 < xs.length - 1 && !pin[k1]) k1++;
      const run = k1 - k0;
      if (run >= 4) {
        const w = P.widthK * Math.pow(as[Math.min(as.length - 1, k0 + (run >> 1))], P.widthExp), lam = 10 * w + 90, amp = Math.min(1.8 * w + 6, 0.12 * run * P.cell);
        let s = 0;
        const ox = xs.slice(), oz = zs.slice();
        for (let k = k0 + 1; k < k1; k++) {
          s += Math.hypot(ox[k] - ox[k - 1], oz[k] - oz[k - 1]);
          const tx = ox[k + 1] - ox[k - 1], tz = oz[k + 1] - oz[k - 1], tl = Math.hypot(tx, tz) || 1;
          const o = amp * Math.sin((Math.PI * (k - k0)) / run) * noise.fbm(ox[k0] / 97 + s / lam, oz[k0] / 97, 2) * 1.6;
          xs[k] = ox[k] - (tz / tl) * o; zs[k] = oz[k] + (tx / tl) * o;
        }
      }
      k0 = k1;
    }
    [xs, zs] = chaikin(xs, zs, 3);
    if (P.meander > 0) [xs, zs] = meander(R, P, xs, zs, as, noise);
    // values carried along by fraction of the way through the original points
    const rs = resample(xs, zs, STEP), m = rs.X.length, nA = as.length;
    const area = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const u = (rs.S[k] / (rs.L || 1)) * (nA - 1), a0 = Math.floor(u), a1 = Math.min(nA - 1, a0 + 1);
      area[k] = Math.max(k ? area[k - 1] : 0, as[a0] + (as[a1] - as[a0]) * (u - a0));
    }
    const hw = new Float32Array(m), depth = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const A = area[k], x = rs.X[k], z = rs.Z[k];
      // a slow wobble in width so banks aren't ruled lines; from world position, so it's continuous across confluences
      // (never narrower than MIN_WIDTH or shallower than MIN_DEPTH: a stream has to show on a
      // 4 m raster and a 2–4 m ground mesh)
      hw[k] = 0.5 * Math.max(MIN_WIDTH, Math.min(P.maxWidth, P.widthK * Math.pow(A, P.widthExp))) * (1 + 0.18 * noise.fbm(x / 110, z / 110, 2));
      depth[k] = Math.max(MIN_DEPTH, P.depthK * Math.pow(A, P.depthExp));
    }
    return {
      id, key: `r${R.rx},${R.rz}:${id}`, n: m, x: Float64Array.from(rs.X), z: Float64Array.from(rs.Z), s: Float64Array.from(rs.S),
      area, hw, depth, surf: new Float32Array(m), speed: new Float32Array(m), cls: new Uint8Array(m), sub: new Uint8Array(m),
      bank: new Float32Array(m).fill(P.bankSlope), reach: new Float32Array(m), up: [], down: -1, mouth: raw.mouth,
    };
  });
  raws.forEach((raw, i) => { if (raw.mouth === 'join') { const d = startAt.get(raw.end)!; reaches[i].down = d; if (d >= 0) reaches[d].up.push(i); } });
  profiles(R, rt, P, reaches);
  return reaches;
}

// Water levels, estuaries, classes and speeds, in downstream order.
function profiles(R: Region, rt: RiverTerrain | null, P: WaterParams, reaches: Reach[]) {
  const seaLevel = P.sea;
  // topological order: a reach after everything flowing into it
  const indeg = reaches.map((r) => r.up.length), order: number[] = [];
  reaches.forEach((_, i) => { if (!indeg[i]) order.push(i); });
  for (let q = 0; q < order.length; q++) { const d = reaches[order[q]].down; if (d >= 0 && --indeg[d] === 0) order.push(d); }
  // the ground a river's surface must stay under: the lowest of the corners of the grid cell
  // around each of three points across the channel (conservative, as the fine ground can dip
  // a little between grid points)
  const g = R.g, n = g.nx;
  const lowAt = (x: number, z: number) => {
    const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz))), k = j * n + i;
    return Math.min(R.ground[k], R.ground[k + 1], R.ground[k + n], R.ground[k + n + 1]);
  };
  const lakeAt = (x: number, z: number) => {
    const b = basinNear(R, x, z);
    let w = b ? b.level : -Infinity;
    const c = nearCell(R, x, z, (k) => R.srcWater[k] === R.srcWater[k] && (seaLevel === null || Math.abs(R.srcWater[k] - seaLevel) > 1e-4));
    if (c >= 0) w = Math.max(w, R.srcWater[c]);
    return w;
  };
  for (const id of order) {
    const r = reaches[id], m = r.n;
    const fb = (k: number) => 0.25 + 0.15 * r.depth[k];
    let prev = Infinity;
    const tgt = new Float32Array(m);
    if (r.up.length) prev = Math.min(...r.up.map((u) => reaches[u].surf[reaches[u].n - 1]));
    for (let k = 0; k < m; k++) {
      const x = r.x[k], z = r.z[k], k0 = Math.max(0, k - 1), k1 = Math.min(m - 1, k + 1);
      const tx = r.x[k1] - r.x[k0], tz = r.z[k1] - r.z[k0], tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl, o = r.hw[k] + SPILL_CHECK;
      let low = Math.min(lowAt(x, z), lowAt(x + nx * o, z + nz * o), lowAt(x - nx * o, z - nz * o));
      if (rt) { const f = rt.riverField(x, z); if (f && (Math.abs(f.v) * f.lam) / 1.1 < f.half) low = Math.min(low, f.floor); }
      const lake = lakeAt(x, z);
      let target = Math.max(low - fb(k), lake);
      if (seaLevel !== null) target = Math.max(target, seaLevel);
      const y = Math.min(prev, target);
      r.surf[k] = y; prev = y; tgt[k] = target;
      // (a river runs on through a lake or out into the sea: where the lake or sea is really there
      // its level is at least the river's and wins; where the grid says lake but the ground says
      // otherwise, the river still shows)
    }
    // The running minimum is a staircase (level, then a sudden drop where the ground falls away):
    // spread each drop over ±32 m, then hold the result under the ground and never uphill again.
    // The ends keep their levels, so reaches still meet.
    const raw = r.surf.slice();
    for (let k = 1; k + 1 < m; k++) {
      let a = 0, c = 0;
      for (let q = Math.max(0, k - 4); q <= Math.min(m - 1, k + 4); q++) { a += raw[q]; c++; }
      r.surf[k] = Math.min(a / c, tgt[k], r.surf[k - 1]);
    }
    if (m > 1) r.surf[m - 1] = Math.min(raw[m - 1], r.surf[m - 2]);
    // a source starts small: taper its first 40 m
    if (!r.up.length) for (let k = 0; k < m && r.s[k] < 40; k++) { const t = 0.35 + 0.65 * (r.s[k] / 40); r.hw[k] *= t; r.depth[k] *= t; }
    // tributaries meet the main river's level: lower their tails (at most 5% slope) onto it
    for (const u of r.up) {
      const t = reaches[u], J = r.surf[0];
      t.surf[t.n - 1] = J;
      for (let k = t.n - 2; k >= 0; k--) { const lim = t.surf[k + 1] + (t.s[k + 1] - t.s[k]) * 0.05; if (t.surf[k] <= lim) break; t.surf[k] = lim; }
    }
  }
  // estuaries: from each mouth at the sea, upstream along the main stem while the land stays low
  if (seaLevel !== null) for (const r0 of reaches) {
    // only rivers of some size get a tidal estuary; a brook just runs onto the beach
    if (r0.mouth !== 'sea' || r0.area[r0.n - 1] < P.estuaryArea) continue;
    // the main stem, upstream from the mouth (at a confluence, the bigger tributary)
    const path: [Reach, number][] = [];
    let r: Reach | null = r0;
    while (r && path.length < 5000) {
      for (let k = r.n - 1; k >= 0; k--) path.push([r, k]);
      r = r.up.length ? r.up.map((u) => reaches[u]).reduce((a, b) => (a.area[a.n - 1] >= b.area[b.n - 1] ? a : b)) : null;
    }
    // distance from the mouth along the path, and how far the tidal reach goes
    let s = 0, len = 0;
    const dist: number[] = [];
    for (let q = 0; q < path.length; q++) {
      if (q) { const [ra, ka] = path[q - 1], [rb, kb] = path[q]; s += Math.hypot(ra.x[ka] - rb.x[kb], ra.z[ka] - rb.z[kb]); }
      dist.push(s);
      const [rr, kk] = path[q];
      if (s > P.estuaryLength || lowAt(rr.x[kk], rr.z[kk]) - seaLevel > P.estuaryRise) break;
      len = s;
    }
    if (len < 200) continue;
    const [rm, km] = path[0], wMouth = Math.min(P.estuaryMouth, 7 * 2 * rm.hw[km] + 20);
    for (let q = 0; q < dist.length && dist[q] <= len; q++) {
      const [rr, kk] = path[q], u = 1 - dist[q] / len, e = u * u;
      // it widens over the low ground only: no wider than the land within 2 m of the sea either side
      const k0 = Math.max(0, kk - 1), k1 = Math.min(rr.n - 1, kk + 1), tx = rr.x[k1] - rr.x[k0], tz = rr.z[k1] - rr.z[k0], tl = Math.hypot(tx, tz) || 1;
      let low = wMouth / 2;
      for (const sd of [-1, 1]) for (let o = 8; o < wMouth / 2; o += 8) if (regionAt(R, R.ground, rr.x[kk] - (tz / tl) * o * sd, rr.z[kk] + (tx / tl) * o * sd) > seaLevel + 2) { low = Math.min(low, o); break; }
      const want = rr.hw[kk] + (wMouth / 2 - rr.hw[kk]) * e * (1 + 0.1 * Math.sin(dist[q] / 170));
      rr.hw[kk] = Math.max(rr.hw[kk], Math.min(want, low + 6));
      rr.depth[kk] = rr.depth[kk] + 4 * u;
      rr.surf[kk] = seaLevel;
      rr.cls[kk] = CLASS_CODE.estuary;
      // mudflat banks, easing back to a river's banks at the head of the tide
      rr.bank[kk] = P.bankSlope + (0.2 - P.bankSlope) * Math.min(1, u * 3);
    }
  }
  // speed (Manning, on the surface slope over ±50 m) and class
  for (const r of reaches) {
    const m = r.n;
    for (let k = 0; k < m; k++) {
      const a = Math.max(0, k - 6), b = Math.min(m - 1, k + 6), ds = r.s[b] - r.s[a];
      const S = Math.max(2e-4, ds > 0 ? (r.surf[a] - r.surf[b]) / ds : 0);
      if (r.cls[k] === CLASS_CODE.estuary) { r.speed[k] = 0.3; continue; }
      const D = r.depth[k], w = 2 * r.hw[k];
      r.speed[k] = Math.max(0.15, Math.min(2.5, (Math.pow(D, 2 / 3) * Math.sqrt(S)) / P.manning));
      r.cls[k] = w >= 25 && D >= NAV.navigable.draught - 0.3 ? CLASS_CODE.navigable : w >= 6 ? CLASS_CODE.river : CLASS_CODE.stream;
    }
    // how far the banks reach: walk out from the waterline until the bank has risen to the ground
    // on both sides (read from the grid, with 1.5 m in hand for the finer ground). A bank
    // that can't get there within MAX_RUN (a gentle mudflat bank against a steep valley side) is
    // steepened until it does, so the cut never ends in a scarp.
    for (let k = 0; k < m; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(m - 1, k + 1), tx = r.x[k1] - r.x[k0], tz = r.z[k1] - r.z[k0], tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl, nz = tx / tl, hw = r.hw[k], surf = r.surf[k];
      let meet = hw;
      for (const sd of [-1, 1]) {
        let o = hw + 2, g = 0;
        for (; o <= hw + MAX_RUN; o += 4) {
          g = regionAt(R, R.ground, r.x[k] + nx * o * sd, r.z[k] + nz * o * sd) + 1.5;
          if (surf + (o - hw) * r.bank[k] >= g) break;
        }
        if (o > hw + MAX_RUN) { o = hw + MAX_RUN; r.bank[k] = Math.max(r.bank[k], Math.min(BANK_HEIGHT, g - surf) / MAX_RUN); }
        meet = Math.max(meet, o);
      }
      r.reach[k] = meet + SPILL + 4;
    }
    // the widest over ±50 m, so the outline of the cut runs smoothly along the river instead of
    // scalloping from point to point
    const rc = r.reach.slice();
    for (let k = 0; k < m; k++) { let v = 0; for (let q = Math.max(0, k - 6); q <= Math.min(m - 1, k + 6); q++) v = Math.max(v, rc[q] - r.hw[q] + r.hw[k]); r.reach[k] = v; }
  }
}
const SPILL_CHECK = 3;
const MAX_RUN = 44; // m, the longest a bank runs out from the waterline
const MIN_WIDTH = 5, MIN_DEPTH = 0.5;

// Meanders. On a flat valley floor a river swings from side to side. The natural shape is the
// sine-generated curve (Langbein and Leopold): the direction off the valley's line swings as
// ω·sin(2πσ/M) along the river, M about eleven channel widths. It is walked here in the frame of
// the smoothed line (distance along it, offset across), so the river follows the valley's own
// bends too. ω is limited by the room on the floor (how far either side the ground stays within
// 1.5 m of the line's) and fades to nothing at both ends, so reaches still meet at confluences and
// mouths; a gentle pull back to the line stops it wandering off. Noise varies the bends.
function meander(R: Region, P: WaterParams, xs: number[], zs: number[], as: number[], noise: Noise2): [number[], number[]] {
  const n = xs.length;
  if (n < 8) return [xs, zs];
  const S = [0];
  for (let k = 1; k < n; k++) S.push(S[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
  const L = S[n - 1];
  // room on the valley floor, every 8th point, read from the region grid
  const room = new Float32Array(n), fall = new Float32Array(n), ground = (x: number, z: number) => regionAt(R, R.ground, x, z);
  for (let k = 0; k < n; k += 8) {
    const k0 = Math.max(0, k - 2), k1 = Math.min(n - 1, k + 2), tx = xs[k1] - xs[k0], tz = zs[k1] - zs[k0], tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl, g0 = ground(xs[k], zs[k]);
    let r = 160;
    for (const sd of [-1, 1]) for (let o = 8; o <= 160; o += 8) if (ground(xs[k] + nx * o * sd, zs[k] + nz * o * sd) > g0 + 1.5) { r = Math.min(r, o - 8); break; }
    room[k] = r;
    // and how steeply the valley falls here: rivers meander on gentle floors, not down hillsides
    const a = Math.max(0, k - 12), b = Math.min(n - 1, k + 12);
    fall[k] = Math.abs(ground(xs[a], zs[a]) - ground(xs[b], zs[b])) / Math.max(1, S[b] - S[a]);
  }
  for (let k = 0; k < n; k++) if (k % 8) {
    const a = k - (k % 8), b = Math.min(n - 1, a + 8), t = b === a ? 0 : (k - a) / (b - a);
    room[k] = room[a] + (room[b] - room[a]) * t; fall[k] = fall[a] + (fall[b] - fall[a]) * t;
  }
  // the smoothed line at distance u along it: position and normal
  let seg = 0;
  const along = (u: number): [number, number, number, number] => {
    while (seg < n - 2 && S[seg + 1] < u) seg++;
    while (seg > 0 && S[seg] > u) seg--;
    const t = Math.max(0, Math.min(1, (u - S[seg]) / (S[seg + 1] - S[seg] || 1))), dx = xs[seg + 1] - xs[seg], dz = zs[seg + 1] - zs[seg], l = Math.hypot(dx, dz) || 1;
    return [xs[seg] + dx * t, zs[seg] + dz * t, -dz / l, dx / l];
  };
  const U: number[] = [0], V: number[] = [0];
  let u = 0, v = 0, phase = noise.at(xs[0] / 311, zs[0] / 311) * 6;
  const ds = 3;
  for (let guard = 0; u < L && guard < 20 * n; guard++) {
    const f = Math.min(n - 1, Math.floor((u / L) * (n - 1))), A = as[Math.min(as.length - 1, Math.floor((f / (n - 1)) * (as.length - 1)))];
    const w = P.widthK * Math.pow(A, P.widthExp), M = (11 * w + 60) * (1 + 0.3 * noise.at(xs[f] / 420 - 5.3, zs[f] / 420)), avail = Math.max(0, room[f] - w / 2 - 4);
    const fade = Math.max(0, Math.min(1, u / (0.7 * M), (L - u) / (0.7 * M))) * (1 - smoothstep(0.004, 0.025, fall[f]));
    const om = Math.min(1.5 * P.meander * Math.max(0, 0.45 + 0.75 * noise.fbm(xs[f] / 900 + 3.1, zs[f] / 900, 2)), (2 * Math.PI * avail) / (1.3 * M)) * fade;
    const th = om * Math.sin(phase) - (0.5 * v) / Math.max(10, avail);
    u += Math.cos(th) * ds; v += Math.sin(th) * ds;
    phase += (2 * Math.PI * ds) / M;
    U.push(Math.min(u, L)); V.push(v);
  }
  // land exactly on the far end: take out any offset left over, spread along the whole reach
  const vEnd = V[V.length - 1];
  const X: number[] = [], Z: number[] = [];
  for (let q = 0; q < U.length; q++) {
    const [x, z, nx, nz] = along(U[q]), o = V[q] - (vEnd * U[q]) / (L || 1);
    X.push(x + nx * o); Z.push(z + nz * o);
  }
  X[0] = xs[0]; Z[0] = zs[0]; X[X.length - 1] = xs[n - 1]; Z[Z.length - 1] = zs[n - 1];
  return [X, Z];
}
