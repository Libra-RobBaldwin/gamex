// Seeded 2D gradient noise and the few ways of stacking it that terrain needs. Everything is a
// pure function of (seed, x, z), so any tile can be generated on its own and still meet its
// neighbours exactly: there is no state carried from one tile to the next.

// A 32-bit integer hash (a finite mix of multiplies and shifts), used for seeds and tile keys.
export function hash32(...xs: number[]) {
  let h = 0x811c9dc5 >>> 0;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

// Small seeded random generator (same family as roads.ts's rng), for building the tables.
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Perlin-style gradient noise with 256 random unit gradients (random angles rather than the
// classic 8 directions, so there is no visible diagonal grain). Returns roughly -1..1.
export class Noise2 {
  private perm = new Uint8Array(512);
  private gx = new Float64Array(256);
  private gz = new Float64Array(256);
  constructor(seed: number) {
    const r = mulberry(hash32(seed, 0x7e44a1));
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; this.gx[i] = Math.cos(a); this.gz[i] = Math.sin(a); }
  }
  at(x: number, z: number) {
    const fx = Math.floor(x), fz = Math.floor(z);
    const xi = fx & 255, zi = fz & 255;
    const tx = x - fx, tz = z - fz;
    const P = this.perm, GX = this.gx, GZ = this.gz;
    const a = P[xi] + zi, b = P[xi + 1] + zi;
    const h00 = P[a], h01 = P[a + 1], h10 = P[b], h11 = P[b + 1];
    const n00 = GX[h00] * tx + GZ[h00] * tz;
    const n10 = GX[h10] * (tx - 1) + GZ[h10] * tz;
    const n01 = GX[h01] * tx + GZ[h01] * (tz - 1);
    const n11 = GX[h11] * (tx - 1) + GZ[h11] * (tz - 1);
    // quintic fade: smooth second derivative, so lighting shows no creases along cell edges
    const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10), v = tz * tz * tz * (tz * (tz * 6 - 15) + 10);
    const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.41;
  }
  // Fractal sum of `oct` octaves, each twice the frequency and half the amplitude; -1..1-ish.
  fbm(x: number, z: number, oct: number, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += this.at(x, z) * amp; norm += amp;
      // rotate each octave a little so the lattices of successive octaves don't line up
      const nx = x * 1.6 - z * 1.2, nz = x * 1.2 + z * 1.6;
      x = nx + 17.3; z = nz - 9.1; amp *= gain;
    }
    return sum / norm;
  }
  // Ridged fractal: sharp crests where the noise crosses zero, 0..1. Each octave is weighted by
  // the one before, so fine detail gathers on the ridges and the valleys stay smooth.
  ridged(x: number, z: number, oct: number, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, w = 1;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(this.at(x, z));
      n *= n;
      sum += n * amp * w; norm += amp;
      w = Math.min(1, n * 1.8);
      const nx = x * 1.6 - z * 1.2, nz = x * 1.2 + z * 1.6;
      x = nx + 31.7; z = nz + 4.3; amp *= gain;
    }
    return sum / norm;
  }
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
