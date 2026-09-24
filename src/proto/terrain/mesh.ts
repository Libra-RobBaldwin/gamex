// Terrain meshing: plain arrays (positions, normals, uvs, indices) for a tile of ground at a level
// of detail, ready for a THREE.BufferGeometry — or a Web Worker, since nothing here touches three.
//
// Tiles at different levels of detail meet without cracks two ways, and both are on by default:
//   - stitching: along an edge facing a coarser neighbour, the in-between vertices are moved onto
//     the straight line between the neighbour's vertices, so both edges are the same polyline;
//   - skirts: a short curtain hanging down from every edge, which hides any gap left by rounding
//     or by a neighbour that hasn't been rebuilt yet.
// Normals come from a grid one cell bigger than the tile all round, so the normals along an edge
// are the same in both tiles and the lighting doesn't show the seam either.

import { TILE, type HeightSource } from './height';

export interface MeshData {
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array | Uint32Array;
  vertexCount: number; triangleCount: number;
  // positions are relative to this corner (keeps float32 precise far from the origin: place the
  // mesh at offset, or at offset − the floating origin)
  offset: [number, number];
  min: number; max: number; // height range, for bounding boxes
}

// Which neighbours are coarser, by how many levels (north is −z, the tile's j = 0 edge).
export interface Stitch { n?: number; e?: number; s?: number; w?: number }
export interface TileOpts {
  size?: number; // tile edge, metres
  cells?: number; // cells along an edge at level 0
  lod?: number; // each level halves the cells
  skirt?: number; // skirt depth in metres (0 for none)
  stitch?: Stitch;
  uvScale?: number; // metres per texture repeat (uvs are in world space, so textures run on across tiles)
}

const indexArray = (n: number, verts: number) => (verts > 65535 ? new Uint32Array(n) : new Uint16Array(n));

export function tileMesh(src: HeightSource, ti: number, tj: number, o: TileOpts = {}): MeshData {
  const size = o.size ?? TILE, N = Math.max(1, (o.cells ?? 256) >> (o.lod ?? 0)), step = size / N, skirt = o.skirt ?? 10, uvs = o.uvScale ?? 16;
  const x0 = ti * size, z0 = tj * size, M = N + 1, B = N + 3;
  // heights with a one-cell border for the normals
  const H = src.sample({ x0: x0 - step, z0: z0 - step, step, nx: B, nz: B });
  const Y = new Float32Array(M * M);
  for (let j = 0; j < M; j++) Y.set(H.subarray((j + 1) * B + 1, (j + 1) * B + 1 + M), j * M);
  // stitch: along an edge facing a coarser neighbour, in-between vertices go onto its straight edges
  const st = o.stitch ?? {};
  const snap = (levels: number | undefined, at: (k: number) => number) => {
    if (!levels || levels <= 0) return;
    const r = 1 << levels;
    if (r > N) return;
    for (let k = 0; k < M; k++) {
      const a = Math.floor(k / r) * r;
      if (a === k) continue;
      const t = (k - a) / r;
      Y[at(k)] = Y[at(a)] * (1 - t) + Y[at(a + r)] * t;
    }
  };
  snap(st.n, (k) => k); // j = 0
  snap(st.s, (k) => N * M + k); // j = N
  snap(st.w, (k) => k * M); // i = 0
  snap(st.e, (k) => k * M + N); // i = N

  const edge = skirt > 0 ? 4 * M : 0, V = M * M + edge;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2);
  let min = Infinity, max = -Infinity;
  const k2 = 1 / (2 * step);
  for (let j = 0, v = 0; j < M; j++) {
    const r = (j + 1) * B + 1, u = (z0 + j * step) / uvs;
    for (let i = 0; i < M; i++, v++) {
      const y = Y[v], p = v * 3, c = r + i;
      pos[p] = i * step; pos[p + 1] = y; pos[p + 2] = j * step;
      const gx = (H[c + 1] - H[c - 1]) * k2, gz = (H[c + B] - H[c - B]) * k2, l = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      nor[p] = -gx * l; nor[p + 1] = l; nor[p + 2] = -gz * l;
      uv[v * 2] = (x0 + i * step) / uvs; uv[v * 2 + 1] = u;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  const T = 2 * N * N + (skirt > 0 ? 8 * N : 0);
  const idx = indexArray(T * 3, V);
  let t = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * M + i, b = a + M, c = a + 1, d = b + 1;
    // alternate the diagonal so long slopes don't all shade with the same grain
    if ((i + j) & 1) { idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = c; }
    else { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = c; idx[t++] = b; idx[t++] = d; }
  }
  if (skirt > 0) {
    // each edge walked so that "outwards" is up × direction of travel, which makes (p, p1, q)
    // and (p1, q1, q) face out
    const edges: number[][] = [
      Array.from({ length: M }, (_, k) => k), // north, west to east
      Array.from({ length: M }, (_, k) => k * M + N), // east, north to south
      Array.from({ length: M }, (_, k) => N * M + N - k), // south, east to west
      Array.from({ length: M }, (_, k) => (N - k) * M), // west, south to north
    ];
    let v = M * M;
    for (const e of edges) {
      const first = v;
      for (const top of e) {
        pos[v * 3] = pos[top * 3]; pos[v * 3 + 1] = pos[top * 3 + 1] - skirt; pos[v * 3 + 2] = pos[top * 3 + 2];
        nor.copyWithin(v * 3, top * 3, top * 3 + 3); uv.copyWithin(v * 2, top * 2, top * 2 + 2);
        v++;
      }
      for (let k = 0; k < N; k++) {
        const p = e[k], p1 = e[k + 1], q = first + k, q1 = first + k + 1;
        idx[t++] = p; idx[t++] = p1; idx[t++] = q; idx[t++] = p1; idx[t++] = q1; idx[t++] = q;
      }
    }
    min -= skirt;
  }
  return { positions: pos, normals: nor, uvs: uv, indices: idx, vertexCount: V, triangleCount: T, offset: [x0, z0], min, max };
}

// The water surface over a tile: flat quads at the water level wherever a cell has water, running
// a cell under the shore so the terrain hides the edge (draw it after the ground, depth-tested).
export function waterMesh(src: HeightSource, ti: number, tj: number, o: { size?: number; cells?: number } = {}): MeshData | null {
  const size = o.size ?? TILE, N = o.cells ?? 64, step = size / N, M = N + 1, x0 = ti * size, z0 = tj * size;
  const W = new Float32Array(M * M);
  for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
    const x = x0 + i * step, z = z0 + j * step, w = src.waterLevel(x, z);
    W[j * M + i] = w !== null && w > src.heightAt(x, z) ? w : NaN;
  }
  const cells: number[] = [];
  const lev = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = [W[j * M + i], W[j * M + i + 1], W[(j + 1) * M + i], W[(j + 1) * M + i + 1]].filter((v) => v === v);
    if (!c.length) continue;
    cells.push(j * N + i); lev[j * N + i] = Math.max(...c);
  }
  if (!cells.length) return null;
  const V = cells.length * 4, pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2), idx = indexArray(cells.length * 6, V);
  let min = Infinity, max = -Infinity;
  cells.forEach((c, q) => {
    const i = c % N, j = Math.floor(c / N), y = lev[c];
    [[i, j], [i, j + 1], [i + 1, j], [i + 1, j + 1]].forEach(([a, b], k) => {
      const v = q * 4 + k;
      pos[v * 3] = a * step; pos[v * 3 + 1] = y; pos[v * 3 + 2] = b * step;
      nor[v * 3 + 1] = 1;
      uv[v * 2] = (x0 + a * step) / 16; uv[v * 2 + 1] = (z0 + b * step) / 16;
    });
    const v = q * 4;
    idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    min = Math.min(min, y); max = Math.max(max, y);
  });
  return { positions: pos, normals: nor, uvs: uv, indices: idx, vertexCount: V, triangleCount: cells.length * 2, offset: [x0, z0], min, max };
}

// ---------- openings for cuttings and tunnel mouths ----------
// The prototype hides the ground over a cutting with the stencil: a strip drawn first with
// roaddraw.ts's holeMat marks the pixels, and the ground skips them. On flat ground that strip
// lies at y = 0.02; on terrain it has to follow the ground, or it marks the wrong pixels. This
// builds the strip draped over the terrain, from per-sample left/right offsets (the cutting's top
// edges from earthworks.sections()), subdivided across so it bends with the ground.
export interface XZ { x: number; z: number }
export function drapeStrip(src: HeightSource, pts: XZ[], edge: (i: number) => [number, number], lift = 0.05, across = 4): MeshData {
  const n = pts.length, A = across + 1, V = n * A;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), uv = new Float32Array(V * 2), idx = indexArray((n - 1) * across * 6, V);
  const [ox, oz] = [pts[0].x, pts[0].z];
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L, [l, r] = edge(i);
    for (let k = 0; k < A; k++) {
      const o = l + ((-r - l) * k) / across, x = pts[i].x + nx * o, z = pts[i].z + nz * o, y = src.heightAt(x, z) + lift, v = i * A + k;
      pos[v * 3] = x - ox; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z - oz;
      nor[v * 3 + 1] = 1; uv[v * 2] = k / across; uv[v * 2 + 1] = i;
      min = Math.min(min, y); max = Math.max(max, y);
    }
  }
  let t = 0;
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < across; k++) {
    const a = i * A + k, b = a + A, c = a + 1, d = b + 1;
    // faces up (left is +normal, so this holds whichever way the path runs)
    idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = c; idx[t++] = b; idx[t++] = d;
  }
  return { positions: pos, normals: nor, uvs: uv, indices: idx, vertexCount: V, triangleCount: (n - 1) * across * 2, offset: [ox, oz], min, max };
}

// Without the stencil (exports, physics, picking): the same mesh with the triangles whose centre
// falls inside any of the polygons left out. Polygons are in world coordinates.
export function cutHoles(m: MeshData, polys: XZ[][], inside: (p: XZ, poly: XZ[]) => boolean): Uint16Array | Uint32Array {
  const keep: number[] = [], [ox, oz] = m.offset, P = m.positions, I = m.indices;
  const boxes = polys.map((p) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.z)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.z))]);
  for (let t = 0; t < I.length; t += 3) {
    const cx = ox + (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3, cz = oz + (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3;
    let hole = false;
    for (let k = 0; k < polys.length && !hole; k++) { const b = boxes[k]; if (cx >= b[0] && cx <= b[2] && cz >= b[1] && cz <= b[3] && inside({ x: cx, z: cz }, polys[k])) hole = true; }
    if (!hole) keep.push(I[t], I[t + 1], I[t + 2]);
  }
  return m.vertexCount > 65535 ? Uint32Array.from(keep) : Uint16Array.from(keep);
}

// ---------- picking ----------
// Where a ray (from the camera through a pixel) first meets the ground: march in steps, then
// bisect. Replaces intersecting the flat y = 0 plane in main.ts's groundAt.
export function raycast(src: HeightSource, o: [number, number, number], d: [number, number, number], maxDist = 20000, step = 4): { x: number; y: number; z: number; t: number } | null {
  const l = Math.hypot(d[0], d[1], d[2]), dx = d[0] / l, dy = d[1] / l, dz = d[2] / l;
  const above = (t: number) => o[1] + dy * t - src.heightAt(o[0] + dx * t, o[2] + dz * t);
  if (above(0) < 0) return null; // starting underground
  let a = 0;
  for (let t = step; t <= maxDist; t += step) {
    if (above(t) <= 0) {
      let lo = a, hi = t;
      for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (above(m) > 0) lo = m; else hi = m; }
      return { x: o[0] + dx * hi, y: o[1] + dy * hi, z: o[2] + dz * hi, t: hi };
    }
    a = t;
    if (dy >= 0 && above(t) > 2000) return null; // climbing away into the sky
  }
  return null;
}
