// Drawing data for a tile's water, as plain arrays (no three.js, so a Web Worker can build them):
//   - waterSurface: one mesh over every wet cell and a cell beyond, at the water level, with the
//     depth, distance to the shore, flow and kind at each vertex for the water shader;
//   - shoreColours: colours for the ground mesh by the water (sand and shingle beaches, wet sand
//     at the waterline, muddy river banks, the lake and river bed under the water);
//   - reedSpots: where reed tufts stand along river and lake edges (for one instanced mesh).
// Together with the ground mesh that's two draw calls per tile for all its water.

import type { MeshData } from '../terrain/mesh';
import { hash32 } from '../terrain/noise';
import { KIND_CODE } from './types';
import type { WaterTile } from './water';

export interface WaterMesh {
  positions: Float32Array; // relative to offset; y is the water level
  water: Float32Array; // per vertex: depth (m, − where the vertex is over dry ground), shore distance (m), flow x, flow z (m/s)
  kind: Float32Array; // KIND_CODE per vertex
  indices: Uint16Array | Uint32Array;
  vertexCount: number; triangleCount: number;
  offset: [number, number];
  min: number; max: number;
}

// The water surface over the tile (null if the tile is dry). Every cell with a wet corner is drawn;
// its dry corners take the level of the nearest water, so the surface runs flat a little under
// the shore and the ground mesh, drawn first, cuts the exact waterline.
export function waterSurface(t: WaterTile, stride = 1): WaterMesh | null {
  const { g, margin: mg } = t, n = g.nx, cells = Math.round(t.size / g.step / stride), M = cells + 1;
  const at = (a: number, b: number) => (mg + b * stride) * n + mg + a * stride;
  const vid = new Int32Array(M * M).fill(-1);
  const quads: number[] = [];
  for (let b = 0; b < cells; b++) for (let a = 0; a < cells; a++) {
    // a cell is drawn if water reaches any raster point in it
    let hit = false;
    for (let y = 0; y <= stride && !hit; y++) for (let x = 0; x <= stride && !hit; x++) if (t.cover[(mg + b * stride + y) * n + mg + a * stride + x]) hit = true;
    if (!hit) continue;
    quads.push(b * M + a);
    for (const v of [b * M + a, b * M + a + 1, (b + 1) * M + a, (b + 1) * M + a + 1]) vid[v] = 0;
  }
  if (!quads.length) return null;
  let V = 0;
  for (let v = 0; v < vid.length; v++) if (vid[v] === 0) vid[v] = V++;
  const pos = new Float32Array(V * 3), wat = new Float32Array(V * 4), kind = new Float32Array(V);
  const step = g.step * stride;
  let min = Infinity, max = -Infinity;
  for (let b = 0; b < M; b++) for (let a = 0; a < M; a++) {
    const v = vid[b * M + a];
    if (v < 0) continue;
    const k = at(a, b), y = t.nearLevel[k];
    pos[v * 3] = a * step; pos[v * 3 + 1] = y; pos[v * 3 + 2] = b * step;
    wat[v * 4] = y - t.ground[k]; wat[v * 4 + 1] = t.shore[k]; wat[v * 4 + 2] = t.flowX[k]; wat[v * 4 + 3] = t.flowZ[k];
    kind[v] = t.nearKind[k];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const idx = V > 65535 ? new Uint32Array(quads.length * 6) : new Uint16Array(quads.length * 6);
  quads.forEach((c, q) => {
    const a = c % M, b = (c - a) / M, v00 = vid[c], v10 = vid[c + 1], v01 = vid[c + M], v11 = vid[c + M + 1];
    // faces up (x east, z south), diagonal alternating like the ground mesh
    if ((a + b) & 1) idx.set([v00, v01, v11, v00, v11, v10], q * 6);
    else idx.set([v00, v01, v10, v10, v01, v11], q * 6);
  });
  return { positions: pos, water: wat, kind, indices: idx, vertexCount: V, triangleCount: quads.length * 2, offset: [t.ti * t.size, t.tj * t.size], min, max };
}

// ---------- the ground by the water ----------
const lin = (hex: string) => [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
export const SHORE_COLOURS = {
  sand: lin('#e2d3a4'), wetSand: lin('#b9a577'), shingle: lin('#a7a194'), wetShingle: lin('#7f7a70'),
  mud: lin('#7a6547'), wetMud: lin('#58482f'), marsh: lin('#8d8a55'),
  bedSand: lin('#d5c393'), bedSilt: lin('#7d7556'), bedGravel: lin('#9a8b6a'), bedDeep: lin('#4f5a4a'),
};
const mix3 = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// RGBA per vertex of a ground mesh (linear colour, and how much of it to lay over the grass):
// use with patchGroundMaterial (material.ts).
export function shoreColours(t: WaterTile, m: MeshData): Float32Array {
  const V = m.vertexCount, out = new Float32Array(V * 4), P = m.positions, Nm = m.normals, [ox, oz] = m.offset, g = t.g, C = SHORE_COLOURS;
  for (let v = 0; v < V; v++) {
    const x = ox + P[v * 3], y = P[v * 3 + 1], z = oz + P[v * 3 + 2];
    const fi = Math.round((x - g.x0) / g.step), fj = Math.round((z - g.z0) / g.step);
    if (fi < 0 || fj < 0 || fi >= g.nx || fj >= g.nz) continue;
    const k = fj * g.nx + fi, kind = t.nearKind[k];
    // nothing by the water is coloured further than 25 m from it
    if (!kind || t.shore[k] < -25) continue;
    const level = t.nearLevel[k], above = y - level, slope = 1 - Nm[v * 3 + 1];
    // distance from the waterline along the ground, from height where it's steep, from the raster where it's flat
    const dist = Math.max(0, -t.shore[k]);
    let c: number[], w = 0;
    if (above < 0) {
      // the bed, seen through the water: sand in lakes and the sea, gravel and silt in rivers, darker deeper
      const d = -above;
      c = kind === KIND_CODE.river || kind === KIND_CODE.canal ? mix3(C.bedGravel, C.bedSilt, sstep(0.3, 2, d)) : mix3(C.bedSand, C.bedSilt, sstep(1, 5, d));
      c = mix3(c, C.bedDeep, sstep(3, 12, d));
      w = 1;
    } else if (kind === KIND_CODE.sea) {
      // beaches: sand on gentle shores, shingle where it's steep; a broad strip, fading out inland
      const width = 6 + 18 * (1 - sstep(0.02, 0.12, slope)), shingle = sstep(0.05, 0.14, slope);
      const dry = mix3(C.sand, C.shingle, shingle), wet = mix3(C.wetSand, C.wetShingle, shingle);
      c = mix3(wet, dry, sstep(0.15, 0.6, above));
      w = 1 - sstep(width * 0.7, width, dist) * sstep(1.5, 3, above);
    } else if (kind === KIND_CODE.estuary) {
      // mudflats at the edge, salt marsh behind
      c = mix3(mix3(C.wetMud, C.mud, sstep(0.1, 0.5, above)), C.marsh, sstep(3, 9, dist));
      w = 1 - sstep(10, 16, dist);
    } else if (kind === KIND_CODE.lake) {
      // a narrow strand: sand where flat, shingle where steeper, darker at the waterline
      const shingle = sstep(0.04, 0.15, slope), dry = mix3(C.sand, C.shingle, shingle), wet = mix3(C.wetSand, C.wetShingle, shingle);
      c = mix3(wet, dry, sstep(0.08, 0.35, above));
      w = 1 - sstep(3, 6, dist) * sstep(0.4, 1.2, above);
    } else {
      // rivers and canals: muddy banks where the ground slopes into the water
      c = mix3(C.wetMud, C.mud, sstep(0.1, 0.45, above));
      w = (1 - sstep(1.5, 3.5, dist)) * (1 - sstep(1, 2.2, above));
    }
    out[v * 4] = c[0]; out[v * 4 + 1] = c[1]; out[v * 4 + 2] = c[2]; out[v * 4 + 3] = Math.max(0, Math.min(1, w));
  }
  return out;
}

// ---------- reeds ----------
// Reed tufts along still and slow water (lakes, river and canal edges, the top of estuaries), in
// the band from just on the bank to shallow water, never on steep banks. Deterministic per tile.
// Returns [x, y, z, rotation, scale] per tuft in world coordinates.
export function reedSpots(t: WaterTile, o: { density?: number; seed?: number } = {}): Float32Array {
  const { g, margin: mg } = t, n = g.nx, dens = o.density ?? 1, out: number[] = [];
  const cells = Math.round(t.size / g.step);
  for (let b = 0; b < cells; b++) for (let a = 0; a < cells; a++) {
    const k = (mg + b) * n + mg + a, kind = t.nearKind[k];
    if (!kind || kind === KIND_CODE.sea) continue;
    const s = t.shore[k], above = t.ground[k] - t.nearLevel[k];
    if (s > 1.5 || s < -3.5 || above > 0.9 || above < -0.5) continue;
    // not on steep ground (a river cut through a sill, a lake under a crag)
    const dx = t.ground[k + 1] - t.ground[k - 1], dz = t.ground[k + n] - t.ground[k - n];
    if (Math.hypot(dx, dz) / (2 * g.step) > 0.3) continue;
    const h = hash32(o.seed ?? 0, t.ti * 4096 + a, t.tj * 4096 + b, 0x2eed);
    // patchy: a slow noise-free way to get clumps is to thin by a coarse hash as well
    const clump = hash32(o.seed ?? 0, (t.ti * 4096 + a) >> 3, (t.tj * 4096 + b) >> 3, 0xc1a3) / 4294967296;
    const p = (kind === KIND_CODE.lake ? 0.5 : kind === KIND_CODE.estuary ? 0.35 : 0.6) * dens * (clump < 0.45 ? 0.15 : 1);
    if ((h & 0xffff) / 65536 >= p) continue;
    const jx = (((h >>> 16) & 0xff) / 255 - 0.5) * g.step, jz = (((h >>> 24) & 0xff) / 255 - 0.5) * g.step;
    out.push(g.x0 + (mg + a) * g.step + jx, t.ground[k], g.z0 + (mg + b) * g.step + jz, ((h >>> 5) & 0x3ff) / 1024 * Math.PI * 2, 0.7 + (((h >>> 11) & 0xff) / 255) * 0.6);
  }
  return Float32Array.from(out);
}
