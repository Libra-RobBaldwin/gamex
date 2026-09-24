// Small shared helpers for the vehicle library: seeded randomness, hashing and colour maths.
// Kept local rather than imported from roads.ts so the library stands on its own.

export const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// mulberry32: small, fast and the same on every platform, so a seed always gives the same vehicle
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rand = () => number;

export const pick = <T,>(r: Rand, arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
export const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Weighted choice from [item, weight] pairs.
export function weighted<T>(r: Rand, items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of items) total += Math.max(0, w);
  let x = r() * total;
  for (const [it, w] of items) { x -= Math.max(0, w); if (x <= 0) return it; }
  return items[items.length - 1][0];
}

// Piecewise-linear lookup through (year, value) keys; clamps at the ends.
export function byYear(year: number, keys: readonly (readonly [number, number])[]) {
  if (year <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [y1, v1] = keys[i];
    if (year <= y1) { const [y0, v0] = keys[i - 1]; return lerp(v0, v1, (year - y0) / (y1 - y0)); }
  }
  return keys[keys.length - 1][1];
}

export const hex = (h: string) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255] as [number, number, number];

// Levenshtein distance, used by the name-safety check.
export function editDistance(a: string, b: string) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
