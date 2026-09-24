// Seeded randomness for the region generator: the same seed always gives the same region.
export type Rand = () => number;

// mulberry32: small, fast, and good enough for laying out a map
export function rng(seed: number): Rand {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// a seed derived from a seed and a few numbers (so each settlement's streets have their own stream,
// and adding one settlement doesn't reshuffle the others)
export function mix(seed: number, ...xs: number[]) {
  let h = (seed ^ 0x85ebca6b) >>> 0;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0xcc9e2d51) >>> 0;
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
export const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
export const pick = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
