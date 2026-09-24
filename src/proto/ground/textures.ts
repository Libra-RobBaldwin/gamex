// The ground's detail texture, generated at start-up from a seed (nothing is downloaded). It holds
// four greyscale patterns, one per channel, that the ground shader turns into colour per cover:
//   R  tufts: short soft strokes, the grain of grass seen from a few tens of metres up
//   G  clumps: blotches from a hand's width to a metre or so (clover, tussocks, leaf litter)
//   B  grain: clods and small stones (bare soil, ploughland, scree)
//   A  specks: sparse dots, where the shader can put a daisy or a buttercup
// Every pattern wraps at the edges, so the texture repeats without a seam, and each is levelled to
// the same mean (½) so that as mipmaps average it away with distance the colour doesn't drift.
import { addWrappedNoise, rng } from './noise';

export interface DetailTexture { size: number; data: Uint8Array; ms: number }

// Remaps a channel to mean 0.5 and the given spread, clamped to 0..1.
function level(a: Float32Array, sd: number) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - m; v += d * d; }
  const k = sd / Math.max(1e-6, Math.sqrt(v / a.length));
  for (let i = 0; i < a.length; i++) a[i] = Math.min(1, Math.max(0, 0.5 + (a[i] - m) * k));
}

// A soft round dab of radius r (texels) at (x, y), wrapping around the edges (n is a power of
// two, so wrapping is a mask). Positions arrive in [0, n); adding n keeps indices positive.
function dab(a: Float32Array, n: number, x: number, y: number, r: number, v: number) {
  const R = Math.ceil(r + 1), inv = 1 / r, m = n - 1;
  const cx = x | 0, cy = y | 0;
  for (let dy = -R; dy <= R; dy++) {
    const row = ((cy + dy + n) & m) * n, ry = (cy + dy + 0.5 - y) * inv, ry2 = ry * ry;
    if (ry2 >= 1) continue;
    for (let dx = -R; dx <= R; dx++) {
      const rx = (cx + dx + 0.5 - x) * inv, d2 = rx * rx + ry2;
      if (d2 >= 1) continue;
      const w = 1 - d2;
      a[row + ((cx + dx + n) & m)] += v * w * w;
    }
  }
}

// A short stroke from (x, y) at angle t, length L: bilinear splats along it (cheaper than discs
// for thin lines), fading towards the tip.
function stroke(a: Float32Array, n: number, x: number, y: number, t: number, L: number, v: number) {
  const ux = Math.cos(t), uy = Math.sin(t), steps = Math.max(2, Math.ceil(L)), m = n - 1;
  for (let s = 0; s <= steps; s++) {
    const f = s / steps;
    const px = x + ux * L * f + n, py = y + uy * L * f + n, val = v * (1 - 0.6 * f);
    const ix = px | 0, iy = py | 0, fx = px - ix, fy = py - iy;
    const x0 = ix & m, x1 = (ix + 1) & m, y0 = (iy & m) * n, y1 = ((iy + 1) & m) * n;
    a[y0 + x0] += val * (1 - fx) * (1 - fy);
    a[y0 + x1] += val * fx * (1 - fy);
    a[y1 + x0] += val * (1 - fx) * fy;
    a[y1 + x1] += val * fx * fy;
  }
}

export function makeDetail(seed = 1, n = 512): DetailTexture {
  const t0 = performance.now();
  if (n & (n - 1)) throw new Error('detail texture size must be a power of two');
  const N = n * n, r = rng(seed * 7919 + 13);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), A = new Float32Array(N);
  const k = n / 512; // counts scale with area, sizes stay in texels

  // tufts: a faint fine mottle, then many short strokes, mostly lighter (blades catching the
  // light) with darker ones between (the shade down in the sward)
  addWrappedNoise(R, n, Math.round(n / 5), 0.35, seed + 1);
  for (let i = 0, m = Math.round(26000 * k * k); i < m; i++) {
    const light = r() < 0.62;
    stroke(R, n, r() * n, r() * n, r() * Math.PI * 2, 4 + r() * 9, (light ? 1.5 : -1.9) * (0.5 + r() * 0.5));
  }
  level(R, 0.16);

  // clumps: a few octaves of blotch, plus tight clusters (clover, rosettes, tussock crowns)
  addWrappedNoise(G, n, 6, 0.5, seed + 2);
  addWrappedNoise(G, n, 14, 0.32, seed + 3);
  addWrappedNoise(G, n, 36, 0.2, seed + 4);
  for (let i = 0, m = Math.round(420 * k * k); i < m; i++) {
    const cx = r() * n, cy = r() * n, rad = 4 + r() * 10, v = (r() < 0.7 ? 1 : -1) * (0.12 + r() * 0.12);
    for (let j = 0, q = 4 + Math.floor(r() * 7); j < q; j++) dab(G, n, cx + (r() - 0.5) * rad * 2, cy + (r() - 0.5) * rad * 2, 2 + r() * 3.5, v);
  }
  level(G, 0.17);

  // grain: crumbly soil, then stones and clods
  addWrappedNoise(B, n, Math.round(n / 4), 0.3, seed + 5);
  addWrappedNoise(B, n, 40, 0.18, seed + 6);
  for (let i = 0, m = Math.round(5200 * k * k); i < m; i++) dab(B, n, r() * n, r() * n, 0.9 + r() * r() * 3, (r() < 0.5 ? 1 : -1) * (0.25 + r() * 0.35));
  level(B, 0.15);

  // specks: soft dots on nothing (not levelled: the shader thresholds them)
  for (let i = 0, m = Math.round(520 * k * k); i < m; i++) dab(A, n, r() * n, r() * n, 1.6 + r() * 1.1, 1.4);

  const data = new Uint8Array(N * 4);
  for (let i = 0, o = 0; i < N; i++, o += 4) {
    data[o] = (R[i] * 255 + 0.5) | 0;
    data[o + 1] = (G[i] * 255 + 0.5) | 0;
    data[o + 2] = (B[i] * 255 + 0.5) | 0;
    data[o + 3] = (Math.min(1, A[i]) * 255 + 0.5) | 0;
  }
  return { size: n, data, ms: performance.now() - t0 };
}

// Mean absolute difference across the wrap (last column/row against the first) and between
// neighbouring columns/rows inside, per channel: equal-ish numbers mean no seam. (Used by tests.)
export function seamStats(t: DetailTexture, ch: number) {
  const n = t.size, d = t.data;
  let wrap = 0, inner = 0;
  for (let y = 0; y < n; y++) {
    wrap += Math.abs(d[(y * n + n - 1) * 4 + ch] - d[(y * n) * 4 + ch]);
    inner += Math.abs(d[(y * n + n / 2 - 1) * 4 + ch] - d[(y * n + n / 2) * 4 + ch]);
  }
  for (let x = 0; x < n; x++) {
    wrap += Math.abs(d[((n - 1) * n + x) * 4 + ch] - d[x * 4 + ch]);
    inner += Math.abs(d[((n / 2 - 1) * n + x) * 4 + ch] - d[((n / 2) * n + x) * 4 + ch]);
  }
  return { wrap: wrap / (2 * n), inner: inner / (2 * n) };
}
