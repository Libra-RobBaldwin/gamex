// Deterministic seeds. Everything procedural in a tile (plots, buildings, parks, trees) is seeded
// from the world seed, the tile's key and the thing's own stable id, so reloading a tile, or
// loading it in a worker, or on another device, grows exactly the same town. Only Math.imul and
// 32-bit integer maths are used, so every JavaScript engine agrees.

import type { TileKey } from './tiles';

// FNV-1a over UTF-16 code units, then a murmur3-style finaliser so nearby keys ("3,4", "3,5")
// land far apart.
export function hashStr(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return mix(h);
}
export function mix(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
// Hash several parts; a separator keeps ("1","23") apart from ("12","3").
export function hashParts(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) h = hashStr(String(p) + '\u0001', h);
  return h;
}

export const tileSeed = (world: number, key: TileKey) => hashParts(world, 't', key);
export const entitySeed = (world: number, key: TileKey, id: string) => hashParts(world, 'e', key, id);
// The existing generators take seeds in [0, 1) (buildgen multiplies by 2³² − 1).
export const unitSeed = (h: number) => (h >>> 0) / 4294967296;
