// Tile keys: a fixed grid of TILE-metre squares in a region's projected metres. Tile (i, j)
// covers x in [i·TILE, (i+1)·TILE) and z in [j·TILE, (j+1)·TILE) (x east, z south). Keys are
// plain strings so they can be map keys, save-file keys and worker messages without conversion.

export const TILE = 1000;
export type TileKey = string; // "i,j"
export interface TileIJ { i: number; j: number }

export const keyOf = (i: number, j: number): TileKey => `${i},${j}`;
export function parseKey(k: TileKey): TileIJ {
  const c = k.indexOf(',');
  return { i: Number(k.slice(0, c)), j: Number(k.slice(c + 1)) };
}
export const tileAt = (x: number, z: number, size = TILE): TileIJ => ({ i: Math.floor(x / size), j: Math.floor(z / size) });
export const keyAt = (x: number, z: number, size = TILE) => { const t = tileAt(x, z, size); return keyOf(t.i, t.j); };
export function tileBounds(i: number, j: number, size = TILE) { return { x0: i * size, z0: j * size, x1: (i + 1) * size, z1: (j + 1) * size }; }

// Distance from a point to the nearest part of a tile (0 inside it), so the tile under the camera
// is always nearest, whatever its size.
export function distToTile(x: number, z: number, i: number, j: number, size = TILE) {
  const dx = Math.max(i * size - x, 0, x - (i + 1) * size);
  const dz = Math.max(j * size - z, 0, z - (j + 1) * size);
  return Math.hypot(dx, dz);
}

// Every tile a box touches.
export function keysInBox(x0: number, z0: number, x1: number, z1: number, size = TILE): TileKey[] {
  const out: TileKey[] = [];
  for (let j = Math.floor(z0 / size); j <= Math.floor(z1 / size); j++) for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++) out.push(keyOf(i, j));
  return out;
}
// A tile and its neighbours out to `r` tiles (a (2r+1)² square).
export function keysAround(k: TileKey, r: number): TileKey[] {
  if (r <= 0) return [k];
  const { i, j } = parseKey(k), out: TileKey[] = [];
  for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) out.push(keyOf(i + a, j + b));
  return out;
}
// Tiles a polyline passes over (each piece's box: conservative, never misses one).
export function keysAlong(path: { x: number; z: number }[], pad = 0, size = TILE): TileKey[] {
  const s = new Set<TileKey>();
  if (path.length === 1) for (const k of keysInBox(path[0].x - pad, path[0].z - pad, path[0].x + pad, path[0].z + pad, size)) s.add(k);
  for (let n = 1; n < path.length; n++) {
    const a = path[n - 1], b = path[n];
    for (const k of keysInBox(Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad, size)) s.add(k);
  }
  return [...s];
}
