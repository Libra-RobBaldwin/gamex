// Small shared helpers: seeded randomness, colour packing and 2D geometry. The library keeps
// its own copies rather than importing roads.ts so it stays a leaf that anything can use.

export interface XZ { x: number; z: number }

// FNV-1a over a string, so a crowd's id always gives it the same people.
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
// Mixes integers into one well-spread 32-bit value (for "person k of crowd h").
export function mix(a: number, b: number) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
// mulberry32, as roads.ts uses
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
export const pick = <T>(r: Rand, list: readonly T[]) => list[Math.floor(r() * list.length) % list.length];
export function pickW<T>(r: Rand, list: readonly (readonly [T, number])[]): T {
  let tot = 0;
  for (const [, w] of list) tot += w;
  let x = r() * tot;
  for (const [v, w] of list) { x -= w; if (x <= 0) return v; }
  return list[list.length - 1][0];
}
export const range = (r: Rand, a: number, b: number) => a + (b - a) * r();

// Van der Corput: any first n of the sequence is spread evenly over [0, 1). Used so that
// showing only the first n people of a stream still spreads them along its whole length.
export function vdc(k: number) {
  let v = 0, d = 0.5;
  for (let n = k + 1; n; n >>>= 1, d /= 2) if (n & 1) v += d;
  return v;
}

// Colours travel to the GPU as one float: 0xRRGGBB fits exactly in a float's 24-bit mantissa.
export const hex = (s: string) => parseInt(s.replace('#', ''), 16);
export function shade(c: number, f: number) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

export function polyLength(p: XZ[]) {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]);
  return L;
}
export function inPoly(p: XZ, poly: XZ[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export function polyCentre(poly: XZ[]): XZ {
  let x = 0, z = 0;
  for (const p of poly) { x += p.x; z += p.z; }
  return { x: x / poly.length, z: z / poly.length };
}
export function polyBounds(poly: XZ[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
}
// A random point inside a polygon, pulled in from its edge by `margin` metres where it can be.
export function pointIn(r: Rand, poly: XZ[], margin = 0): XZ {
  const b = polyBounds(poly), c = polyCentre(poly);
  for (let i = 0; i < 40; i++) {
    const p = { x: range(r, b.x0, b.x1), z: range(r, b.z0, b.z1) };
    if (inPoly(p, poly) && edgeDist(p, poly) >= margin) return p;
  }
  return c;
}
export function edgeDist(p: XZ, poly: XZ[]) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / L2, 0, 1);
    d = Math.min(d, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return d;
}

// A polyline moved sideways: +off is to the left of the direction of travel (looking down on
// the map, the same sense the tracks use). Corners are mitred, capped so hairpins don't spike.
export function offsetLine(p: XZ[], off: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[Math.min(p.length - 1, i + 1)];
    let d1x = b.x - a.x, d1z = b.z - a.z, d2x = c.x - b.x, d2z = c.z - b.z;
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    if (l1 > 1e-9) { d1x /= l1; d1z /= l1; }
    if (l2 > 1e-9) { d2x /= l2; d2z /= l2; }
    // at the ends there's only one direction to go by
    if (l1 <= 1e-9) { d1x = d2x; d1z = d2z; }
    if (l2 <= 1e-9) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const cosHalf = Math.max(0.35, tx * d1x + tz * d1z);
    out.push({ x: b.x + (tz * off) / cosHalf, z: b.z - (tx * off) / cosHalf });
  }
  return out;
}
