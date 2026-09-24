// Small deterministic noise for the ground: an integer hash, a seeded generator, value noise that
// wraps (so generated textures tile without a seam) and world-anchored value noise (so every
// cover map, wherever it is, agrees about the big patches). Plain typed arrays, no DOM, so the
// same code runs in the browser and in the Node tests.

// A 32-bit integer hash of two integers and a seed, as a float in [0, 1).
export function hash2(x: number, y: number, seed: number) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// mulberry32: a tiny seeded generator, good enough for placing blades of grass
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

const smooth = (f: number) => f * f * (3 - 2 * f);

// Adds one octave of value noise to an n x n image that wraps at its edges: `cells` lattice cells
// across (must divide into whole cells so the lattice itself wraps), amplitude `amp` about zero.
// Lerp weights are worked out once per column and row, so the inner loop is a few multiplies.
export function addWrappedNoise(out: Float32Array, n: number, cells: number, amp: number, seed: number) {
  const lat = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) lat[i + j * cells] = (hash2(i, j, seed) - 0.5) * 2 * amp;
  const c = n / cells;
  const i0 = new Int32Array(n), i1 = new Int32Array(n), fx = new Float32Array(n);
  for (let x = 0; x < n; x++) {
    const g = x / c, i = Math.floor(g);
    i0[x] = i % cells; i1[x] = (i + 1) % cells; fx[x] = smooth(g - i);
  }
  // per row, blend the two lattice rows first; then each texel is one lerp along the row
  const mix = new Float32Array(cells);
  for (let y = 0; y < n; y++) {
    const g = y / c, j = Math.floor(g), fy = smooth(g - j);
    const r0 = (j % cells) * cells, r1 = ((j + 1) % cells) * cells, row = y * n;
    for (let i = 0; i < cells; i++) mix[i] = lat[r0 + i] + (lat[r1 + i] - lat[r0 + i]) * fy;
    for (let x = 0; x < n; x++) { const a = mix[i0[x]]; out[row + x] += a + (mix[i1[x]] - a) * fx[x]; }
  }
}

// Value noise anchored to the world: lattice spacing `cell` metres, sampled over a grid of texels
// (`nx` by `nz`, texel (i, j) centred at x0 + (i + ½)·step, z0 + (j + ½)·step), added into `out`
// at stride 1. The same point in the world always gets the same value, whichever map samples it.
export function addWorldNoise(out: Float32Array, nx: number, nz: number, x0: number, z0: number, step: number, cell: number, amp: number, seed: number, i0 = 0, j0 = 0, i1 = nx, j1 = nz) {
  const w = i1 - i0;
  const li0 = new Int32Array(w), fx = new Float32Array(w);
  for (let i = i0; i < i1; i++) {
    const g = (x0 + (i + 0.5) * step) / cell, k = Math.floor(g);
    li0[i - i0] = k; fx[i - i0] = smooth(g - k);
  }
  for (let j = j0; j < j1; j++) {
    const g = (z0 + (j + 0.5) * step) / cell, k = Math.floor(g), fy = smooth(g - k);
    let lastK = -Infinity, a = 0, b = 0, d = 0, e = 0;
    const row = j * nx;
    for (let i = i0; i < i1; i++) {
      const kk = li0[i - i0];
      if (kk !== lastK) {
        lastK = kk;
        a = hash2(kk, k, seed); b = hash2(kk + 1, k, seed); d = hash2(kk, k + 1, seed); e = hash2(kk + 1, k + 1, seed);
      }
      const f = fx[i - i0], top = a + (b - a) * f, bot = d + (e - d) * f;
      out[row + i] += (top + (bot - top) * fy - 0.5) * 2 * amp;
    }
  }
}

// Point value of the same world noise, for code that needs one sample (planning, placing trees).
export function worldNoise(x: number, z: number, cell: number, seed: number) {
  const gx = x / cell, gz = z / cell, i = Math.floor(gx), j = Math.floor(gz), fx = smooth(gx - i), fz = smooth(gz - j);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), d = hash2(i, j + 1, seed), e = hash2(i + 1, j + 1, seed);
  const top = a + (b - a) * fx, bot = d + (e - d) * fx;
  return top + (bot - top) * fz;
}
