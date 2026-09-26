// The lie of the land for a 50 km map, at its coarse scale (docs/terrain.md, "The 50 km land"):
// what shape the country is (a landform preset), where the sea and islands are, how the rivers have
// carved it, and what rock it's made of. Made once per map, on a grid of COARSE.cell metres over the
// whole map, in about a third of a second (off the main thread: landform.worker.ts), and read
// everywhere through worldmap/terrain.ts (the height at any point) and worldmap/water.ts (the sea,
// rivers and lakes it leaves).
//
//   const land = coarseLand({ seed: 7, landform: 'uplands', ... }, half);
//   land.h           // heights on the grid (m above the sea), eroded, pits filled but for lakes
//   land.sea         // signed distance to the coast (m; + inland, − out at sea)
//   land.rivers      // the drainage: centre lines from source to mouth, with areas drained
//   land.lakes       // standing water: each lake's cells and level
//   land.rock        // the rock under each cell (geologyAt)
//
// How it's made:
//   1. the land's outline: the sea along one or two sides with a fractal coast, or islands;
//   2. its bones: broad swells, ridged hill ranges, chalk scarps, plateaux and granite massifs,
//      as much of each as the landform has (LANDFORM_PARAMS);
//   3. rain: priority-flood to route every cell's water to the sea or off the map, flow
//      accumulation, and stream-power incision, a few rounds, so valleys are cut by the rivers that
//      run in them, and hillslopes creep between (diffusion);
//   4. in mountains, glaciers: the big valleys widened into U-shapes, with overdeepened basins (the
//      ribbon lakes to be);
//   5. the sea rises a few metres, drowning the lowest valleys (estuaries and rias), and what's left
//      below the rim of a hollow is a lake.
//
// Every tunable number is in PARAMS (and each landform's in LANDFORM_PARAMS), so OS's measurements
// of real Britain (region/priors.ts) can set them: setLandParams / setLandformParams.
//
// Pure: no three.js, no DOM. The same options always make the same land, to the bit, on the main
// thread and in every worker.
import { mix, rng, range } from '../region/random';
import type { Islands, Landform, RegionOptions } from '../region/options';

export type { Islands, Landform };
export type Rock = 'limestone' | 'gritstone' | 'slate' | 'granite' | 'chalk' | 'clay' | 'sandstone' | 'alluvium';
export const ROCKS: readonly Rock[] = ['limestone', 'gritstone', 'slate', 'granite', 'chalk', 'clay', 'sandstone', 'alluvium'];

// ---------------- the tunables ----------------
export const PARAMS = {
  cell: 200, // m: the coarse grid
  margin: 1600, // m past the map's edge it reaches (rivers rise off the map; the sea runs on)
  // the coast
  coastIn: [0.22, 0.34] as [number, number], // how far in from its edge the coast lies, as a share of the map's width
  coastRough: 0.14, // its bays and headlands, as a share of the map's width (then smaller ones on those, fractally)
  coastFractal: 1.15, // box-counting dimension of the coast (region/priors.ts: the Exe's)
  keepSeaOff: 7000, // m: the sea stays at least this far from the start town (the live play area and its margin)
  // erosion (stream power: dh = −K · A^m · S^n · dt, with n = 1, solved implicitly; creep: diffusion)
  rounds: 10,
  K: 0.2, // per round, with A in m²: how hard running water cuts (then the land is scaled back to its height)
  m: 0.45,
  creep: 0.18, // hillslope diffusion per round (share of the difference with the neighbours' mean)
  // floodplains: rivers draining `from` m² or more have a floor a · √(km²) m wide (at most `max`),
  // rising `rise` (m per m) from the river to its edge
  floodplain: { from: 30e6, a: 38, max: 1800, rise: 0.004 },
  // the rivers drawn (m² drained): a stream from `stream`, a river from `river`
  stream: 5e6,
  river: 40e6,
  // a river's width at the waterline (m) from the area it drains (km²): w = a · A^b, and at least `min`
  width: { a: 1.25, b: 0.5, min: 4, max: 120 },
  estuaryWiden: 3, // how many times wider a river gets over its last `estuaryLength` m to the sea
  estuaryLength: 3000,
  // the sea rising over the land (m): the lowest valleys drown into estuaries and rias
  drown: 3,
  // lakes: hollows left after the flood this deep (m) and this big (cells), at least
  lakeDepth: 2.5,
  lakeCells: 3,
  lakeShare: 0.025, // and at most this share of the land (the deepest kept, the rest filled in)
  // fine detail on top (worldmap/terrain.ts): the hills too small for the coarse grid (a few hundred
  // metres to a couple of kilometres across), this high (m) in country `relief` m rugged, and the
  // biggest's size
  detail: { amp: 26, relief: 80, wavelength: 1500 },
};
// Each landform's shape: how high it gets, and how much of each kind of bone it has.
export interface LandformParams {
  height: number; // m: its highest ground, about
  swell: number; // broad rises and vales (0–1)
  hills: number; // rolling hills a few kilometres across (0–1)
  ranges: number; // ridged hill ranges (0–1)
  scarps: number; // chalk or limestone scarps: steep fronts, gentle backs (0–1)
  plateau: number; // flat-topped moorland (0–1)
  massif: number; // granite domes (0–1)
  glacial: number; // U-shaped valleys and ribbon lakes (0–1)
  sea: number; // how much of it the sea takes (0 inland; the share of the map's width, about)
  drown: number; // m: how far the sea has risen into its valleys
  rocks: Rock[]; // its rocks, low ground to high
}
export const LANDFORM_PARAMS: Record<Landform, LandformParams> = {
  vale: { hills: 0.55, height: 130, swell: 0.8, ranges: 0.15, scarps: 0.35, plateau: 0, massif: 0, glacial: 0, sea: 0, drown: 0, rocks: ['clay', 'clay', 'sandstone', 'limestone'] },
  downs: { hills: 0.3, height: 240, swell: 0.5, ranges: 0.1, scarps: 1, plateau: 0.2, massif: 0, glacial: 0, sea: 0.22, drown: 3, rocks: ['clay', 'chalk', 'chalk', 'chalk'] },
  estuary: { hills: 0.4, height: 170, swell: 0.7, ranges: 0.25, scarps: 0.2, plateau: 0, massif: 0.1, glacial: 0, sea: 0.28, drown: 14, rocks: ['clay', 'sandstone', 'sandstone', 'granite'] },
  uplands: { hills: 0.3, height: 520, swell: 0.6, ranges: 0.4, scarps: 0.5, plateau: 0.5, massif: 0.2, glacial: 0, sea: 0, drown: 0, rocks: ['sandstone', 'limestone', 'limestone', 'gritstone'] },
  mountains: { hills: 0.25, height: 950, swell: 0.4, ranges: 1, scarps: 0.1, plateau: 0.15, massif: 0.5, glacial: 1, sea: 0, drown: 0, rocks: ['sandstone', 'slate', 'slate', 'granite'] },
  coast: { hills: 0.45, height: 260, swell: 0.7, ranges: 0.35, scarps: 0.3, plateau: 0.2, massif: 0.25, glacial: 0, sea: 0.3, drown: 5, rocks: ['clay', 'sandstone', 'slate', 'granite'] },
  islands: { hills: 0.35, height: 300, swell: 0.6, ranges: 0.45, scarps: 0.1, plateau: 0.2, massif: 0.45, glacial: 0.2, sea: 1, drown: 6, rocks: ['sandstone', 'slate', 'granite', 'granite'] },
};
// For OS's priors (region/priors.ts) or a test: change any of the tunables. The land is made again
// only for maps made after this (coarseLand keeps no cache across a change).
export function setLandParams(p: Partial<typeof PARAMS>) { Object.assign(PARAMS, p); cache.clear(); }
export function setLandformParams(f: Landform, p: Partial<LandformParams>) { Object.assign(LANDFORM_PARAMS[f], p); cache.clear(); }

// ---------------- the result ----------------
export interface CoarseRiver {
  path: { x: number; z: number }[]; // cell centres from its source down to its mouth (or where it joins another)
  area: number[]; // m² drained at each point
  level: number[]; // its water's height at each point (m): never rising downstream
  into: number; // the river it joins (index), or −1: the sea, a lake or off the map
}
export interface CoarseLake { level: number; cells: number[]; x: number; z: number } // (x, z: its middle)
export interface CoarseLand {
  x0: number; z0: number; cell: number; n: number; // the grid: n × n points from (x0, z0)
  h: Float32Array; // ground height at each point (m); the sea bed is below 0; a lake's bed below its level
  sea: Float32Array; // signed distance to the coast at each point (m): + inland, − at sea
  lake: Int16Array; // the lake at each point (index into lakes), or −1
  rock: Uint8Array; // index into ROCKS
  relief: Float32Array; // how rugged the country is round each point (m: local range): the fine detail's scale
  rivers: CoarseRiver[];
  lakes: CoarseLake[];
  landform: Landform;
  side: 'n' | 'e' | 's' | 'w' | null; // where the main sea lies (null: inland, or all round, for islands)
  max: number; // the highest point
  ms: number; // how long it took
}

// What the land needs from the options (region/options.ts).
export type LandOptions = Pick<RegionOptions, 'seed' | 'landform' | 'islands' | 'hills' | 'water' | 'sea' | 'rivers'>;

const cache = new Map<string, CoarseLand>();
// The land for a map's options (made once and kept: the plan asks for it, and so does each worker).
export function coarseLand(o: LandOptions, half: number): CoarseLand {
  const k = `${o.seed}|${o.landform}|${o.islands}|${o.hills}|${o.water}|${o.sea}|${o.rivers}|${half}`;
  let c = cache.get(k);
  if (!c) { c = makeLand(o, half); if (cache.size > 3) cache.clear(); cache.set(k, c); }
  return c;
}
// (a land made elsewhere, in the land worker, handed in so it isn't made again here)
export function primeLand(o: LandOptions, half: number, land: CoarseLand) {
  cache.set(`${o.seed}|${o.landform}|${o.islands}|${o.hills}|${o.water}|${o.sea}|${o.rivers}|${half}`, land);
}

// ---------------- noise ----------------
function noise2(seed: number) {
  const r = rng(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gz = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  // (no closures made per call: this is asked millions of times)
  return (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const a0 = perm[xi & 255], a1 = perm[(xi + 1) & 255];
    const k00 = perm[(a0 + zi) & 255], k10 = perm[(a1 + zi) & 255], k01 = perm[(a0 + zi + 1) & 255], k11 = perm[(a1 + zi + 1) & 255];
    const g00 = gx[k00] * xf + gz[k00] * zf, g10 = gx[k10] * (xf - 1) + gz[k10] * zf;
    const g01 = gx[k01] * xf + gz[k01] * (zf - 1), g11 = gx[k11] * (xf - 1) + gz[k11] * (zf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const a = g00 + u * (g10 - g00), b = g01 + u * (g11 - g01);
    return (a + v * (b - a)) * 1.4;
  };
}
export type Noise = ReturnType<typeof noise2>;
export { noise2 };
// fractal noise: `oct` octaves, each twice as fine and `gain` as strong
const fbm = (n: Noise, x: number, z: number, oct: number, gain = 0.5) => { let s = 0, a = 1, f = 1, t = 0; for (let o = 0; o < oct; o++) { s += a * n(x * f + o * 17.3, z * f - o * 9.1); t += a; a *= gain; f *= 2.03; } return s / t; };
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- making it ----------------
function makeLand(o: LandOptions, half: number): CoarseLand {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const P = PARAMS, F = LANDFORM_PARAMS[o.landform] ?? LANDFORM_PARAMS.coast, C = P.cell;
  const r = rng(mix(o.seed, 301));
  const N = [311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321].map((k) => noise2(mix(o.seed, k)));
  const ext = half + P.margin, x0 = -Math.ceil(ext / C) * C, z0 = x0, n = Math.round((-2 * x0) / C) + 1, NN = n * n;
  const X = (i: number) => x0 + i * C, Z = (j: number) => z0 + j * C;
  const hills = o.hills === -1 ? 1 : Math.max(0, o.hills) / 50; // (50: the landform as it is)
  const wetness = o.water === -1 ? 1 : Math.max(0.05, o.water / 50);

  // ---- 1. the outline: land potential, + land, − sea ----
  const seaShare = o.sea === false && o.landform !== 'islands' ? 0 : F.sea;
  const islandsMode: Islands = o.landform === 'islands' ? (o.islands === 'none' ? 'archipelago' : o.islands) : o.islands;
  const sides = ['n', 'e', 's', 'w'] as const;
  let side: CoarseLand['side'] = null;
  const pot = new Float32Array(NN);
  const W = 2 * half;
  if (islandsMode === 'one' || islandsMode === 'archipelago' || o.landform === 'islands') {
    // islands: blobs of fractal noise over a sea; the start town's island in the middle
    const k = islandsMode === 'one' ? 1 : islandsMode === 'archipelago' ? 2.6 : 1.6;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = X(i), z = Z(j), rr = Math.hypot(x, z) / half;
      const blob = fbm(N[0], (x * k) / 14000, (z * k) / 14000, 5, 0.55);
      const home = 0.55 * (1 - smooth(0.12, islandsMode === 'one' ? 0.75 : 0.32, rr)); // (the middle is land)
      const rim = islandsMode === 'one' ? -0.7 * smooth(0.55, 0.95, rr) : -0.25 * smooth(0.6, 1.05, rr);
      pot[j * n + i] = blob + home + rim - (islandsMode === 'archipelago' ? 0.12 : 0.02);
    }
  } else if (seaShare > 0) {
    // the sea along one side (or two, meeting at a corner, on a coast map), with a fractal coast
    side = sides[Math.floor(r() * 4)];
    const two = o.landform === 'coast' && r() < 0.35, side2 = sides[(sides.indexOf(side) + (r() < 0.5 ? 1 : 3)) % 4];
    const d0 = range(r, P.coastIn[0], P.coastIn[1]) * (0.6 + 0.8 * seaShare) * W;
    const rough = P.coastRough * W, H = 2 - P.coastFractal; // (Hurst exponent from the fractal dimension)
    const inFrom = (s: typeof side, x: number, z: number) => (s === 's' ? half - z : s === 'n' ? z + half : s === 'e' ? half - x : x + half);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = X(i), z = Z(j);
      // (a coast as rough as the real one: octaves whose strength falls as 2^−H per halving)
      let off = 0, a = rough, f = 1 / (0.45 * W);
      for (let oc = 0; oc < 8; oc++) { off += a * N[1](x * f + oc * 3.7, z * f - oc * 5.3); a *= 2 ** -H * 0.72; f *= 2.1; }
      let p = (inFrom(side, x, z) - d0 + off) / (0.12 * W);
      if (two) p = Math.min(p, (inFrom(side2, x, z) - d0 * 0.85 + off) / (0.12 * W));
      pot[j * n + i] = p;
    }
    if (islandsMode === 'few') {
      // a few islands offshore
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (pot[k] > 0) continue;
        const b = fbm(N[2], X(i) / 3500, Z(j) / 3500, 4) - 0.32;
        if (b > 0 && pot[k] > -1.6) pot[k] = Math.max(pot[k], b * 3);
      }
    }
  } else pot.fill(1);
  // (the start town's ground stays land, well away from the sea)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const d = Math.hypot(X(i), Z(j)); if (d < P.keepSeaOff) pot[j * n + i] = Math.max(pot[j * n + i], 0.35 * (1 - d / P.keepSeaOff) + 0.05); }

  // ---- 2. the bones ----
  const A = F.height * hills;
  const strike = r() * Math.PI, cs = Math.cos(strike), sn = Math.sin(strike);
  const scarpN = F.scarps > 0.5 ? 2 : F.scarps > 0 ? 1 : 0, scarpAt = Array.from({ length: scarpN }, () => range(r, -0.35, 0.35) * W), scarpDir = Array.from({ length: scarpN }, () => (r() < 0.5 ? 1 : -1));
  const massifs = Array.from({ length: Math.round(F.massif * 4) }, () => ({ x: range(r, -0.8, 0.8) * half, z: range(r, -0.8, 0.8) * half, R: range(r, 2500, 6000) }));
  const h = new Float32Array(NN);
  // (the inland tilt: rising away from a random direction the rivers leave by)
  const ta = r() * Math.PI * 2, tiltA = Math.cos(ta), tiltB = Math.sin(ta);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = X(i), z = Z(j), p = pot[k];
    if (p <= 0) { h[k] = Math.max(-40, p * 25) - 1; continue; } // (the sea bed, shelving away)
    const inland = smooth(0, 1.2, p); // (0 at the coast, 1 a few km in)
    // broad swells and vales, 10–15 km across
    const c01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
    let v = F.swell * c01(0.5 + 1.1 * fbm(N[3], x / 13000, z / 13000, 3));
    // rolling hills, 2–4 km across, everywhere (the rivers then cut their valleys between them)
    v += F.hills * c01(0.45 + 1.3 * fbm(N[10], x / 3200, z / 3200, 3, 0.5));
    // hill ranges: ridged noise drawn out along the strike, where a slow mask puts them
    if (F.ranges) {
      const a = (x * cs + z * sn) / 9000 + 0.4 * N[4](x / 20000, z / 20000), b = (-x * sn + z * cs) / 3800;
      const ridge = 1 - Math.abs(fbm(N[5], a, b, 3, 0.45)), mask = smooth(-0.3, 0.35, N[6](x / 16000 + 3.3, z / 16000 - 1.1));
      v += F.ranges * ridge * ridge * (0.35 + 0.65 * mask) * 1.1;
    }
    // scarps: a steep face along a wobbly line, the land behind it falling gently away
    for (let s = 0; s < scarpN; s++) {
      const d = scarpDir[s] * ((-x * sn + z * cs) - scarpAt[s] - 0.06 * W * N[7](x / 9000, z / 9000));
      v += F.scarps * 0.55 * smooth(-200, 450, d) * (1 - 0.75 * smooth(600, 7000, d));
    }
    // granite massifs: broad domes
    for (const m of massifs) { const d = Math.hypot(x - m.x, z - m.z) / m.R; if (d < 1.6) v += F.massif * 0.6 * (1 - smooth(0, 1.6, d)); }
    let e = A * v * (0.25 + 0.75 * inland);
    // (and the whole country rising away from the sea, so its rivers run down to it; inland, away
    // from the edge its rivers leave by, so they run across the map rather than pooling in its vales)
    if (seaShare > 0 && side) e += A * 0.5 * smooth(0, 4, p);
    else if (!islandsMode || islandsMode === 'none') e += A * 0.55 * (tiltA * x + tiltB * z + half * 1.2) / (2.4 * half);
    // plateaux: the tops cut flat (moorland), with a soft edge
    if (F.plateau) { const cap = A * (0.62 + 0.1 * N[8](x / 7000, z / 7000)); if (e > cap) e = cap + (e - cap) * (1 - 0.85 * F.plateau); }
    // (the land stands a little up from the sea: cliffs and bluffs, with the valleys cut down through them)
    h[k] = Math.max(0.5, e + 4 + (8 + 0.12 * A) * Math.min(1, p * 3));
  }

  // ---- 3. rain ----
  const outlet = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) if (h[k] < 0) outlet[k] = 1;
  for (let i = 0; i < n; i++) { outlet[i] = outlet[(n - 1) * n + i] = outlet[i * n] = outlet[i * n + n - 1] = 1; }
  const recv = new Int32Array(NN), order = new Int32Array(NN), area = new Float32Array(NN), filled = new Float32Array(NN);
  const cellA = C * C, K = P.K * (0.7 + 0.6 * wetness);
  const route = () => {
    // priority-flood from the outlets: every cell drains to a neighbour, pits filled (with a tiny
    // slope so the flow always finds its way out); `order` from the outlets upstream
    priorityFlood(h, n, outlet, filled, recv, order);
    area.fill(cellA);
    for (let q = NN - 1; q >= 0; q--) { const k = order[q], r0 = recv[k]; if (r0 >= 0) area[r0] += area[k]; }
  };
  // (no hollows to start with: every cell drains; lakes come from the glaciers and the sea's rise)
  route();
  for (let k = 0; k < NN; k++) if (!outlet[k]) h[k] = filled[k];
  let top0 = 0;
  for (let k = 0; k < NN; k++) if (h[k] > top0) top0 = h[k];
  for (let round = 0; round < P.rounds; round++) {
    route();
    // stream power, implicit (Braun & Willett 2013): downstream first, each cell against its receiver
    for (let q = 0; q < NN; q++) {
      const k = order[q], r0 = recv[k];
      if (r0 < 0 || outlet[k]) continue;
      const dx = (k % n !== r0 % n && Math.floor(k / n) !== Math.floor(r0 / n)) ? C * Math.SQRT2 : C;
      const f = (K * Math.pow(area[k], P.m)) / dx;
      const hr = h[r0], hk = h[k];
      if (hk > hr) h[k] = (hk + f * hr) / (1 + f);
    }
    // creep: each land cell eased a little towards its neighbours' mean
    if (P.creep) {
      const c = P.creep;
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        if (outlet[k]) continue;
        // (on the hillsides: the channels keep the floors the water cut)
        const m4 = (h[k - 1] + h[k + 1] + h[k - n] + h[k + n]) / 4, ck = c / (1 + area[k] / 1.5e6);
        filled[k] = h[k] + ck * (m4 - h[k]);
      }
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) { const k = j * n + i; if (!outlet[k]) h[k] = filled[k]; }
    }
  }

  // (erosion lowers everything a little: the land back to the height it had, keeping its shape)
  // (the high ground lifted most, the valley floors hardly at all, so the rivers keep their fall to the sea)
  { let top = 0; for (let k = 0; k < NN; k++) if (h[k] > top) top = h[k]; const g = top > 1 ? top0 / top : 1; for (let k = 0; k < NN; k++) if (h[k] > 0) h[k] = Math.max(0.5, h[k] * (1 + (g - 1) * (h[k] / top) ** 1.5)); }
  // ---- floodplains: the bigger rivers' floors spread wide and nearly flat (and so, where the sea
  // comes in, a wide estuary) ----
  route();
  {
    const fp = new Float32Array(h);
    for (let k = 0; k < NN; k++) {
      if (outlet[k] || area[k] < P.floodplain.from) continue;
      const half2 = Math.min(P.floodplain.max, P.floodplain.a * Math.sqrt(area[k] / 1e6)) / 2, R = Math.ceil(half2 / C), i = k % n, j = (k - i) / n, hk = h[k];
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const q = b * n + a, d = Math.hypot(di, dj) * C;
        if (d > half2 + C) continue;
        // (level across its floor, rising gently to the edge of it, then the valley side as it was)
        const u = hk + (d <= half2 ? P.floodplain.rise * d : P.floodplain.rise * half2 + (d - half2) * 0.08);
        if (u < fp[q]) fp[q] = u;
      }
    }
    // (its edges softened: the cut blurred twice, so the floor meets the valley side in a smooth
    // curve, not in steps along the grid)
    const cutBy = new Float32Array(NN), tmp = new Float32Array(NN);
    for (let k = 0; k < NN; k++) cutBy[k] = outlet[k] ? 0 : h[k] - fp[k];
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        tmp[k] = (4 * cutBy[k] + 2 * (cutBy[k - 1] + cutBy[k + 1] + cutBy[k - n] + cutBy[k + n]) + cutBy[k - n - 1] + cutBy[k - n + 1] + cutBy[k + n - 1] + cutBy[k + n + 1]) / 16;
      }
      for (let k = 0; k < NN; k++) cutBy[k] = outlet[k] ? 0 : tmp[k];
    }
    for (let k = 0; k < NN; k++) if (!outlet[k]) h[k] = Math.max(0.5, h[k] - cutBy[k]);
    // (and any hollow that left filled: the floors drain, they don't stand in beads of lakes)
    route();
    for (let k = 0; k < NN; k++) if (!outlet[k]) h[k] = filled[k];
  }
  // ---- 4. glaciers: the big high valleys widened into U-shapes, with basins in their floors ----
  route();
  if (F.glacial > 0) {
    const hi = A * 0.25;
    const floor = new Float32Array(h);
    for (let k = 0; k < NN; k++) {
      if (outlet[k] || area[k] < 20e6 || h[k] < hi * 0.4) continue;
      // (the floor of a glacier's valley: dug down where the ice was thickest, then level across)
      const dig = F.glacial * Math.min(45, 6 * Math.log10(area[k] / 20e6 + 1) * 10) * smooth(hi * 0.4, hi * 1.2, h[k]);
      floor[k] = h[k] - dig;
    }
    // widen: every cell near a dug floor is pulled down towards a U from it
    const R = 3;
    for (let j = R; j < n - R; j++) for (let i = R; i < n - R; i++) {
      const k = j * n + i;
      if (outlet[k]) continue;
      let best = h[k];
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const q = k + dj * n + di;
        if (floor[q] >= h[q]) continue;
        const d = Math.hypot(di, dj) * C, u = floor[q] + (d * d) / (2 * 1400) * (1 + 0.5 * (h[q] - floor[q]) / 40);
        if (u < best) best = u;
      }
      h[k] = Math.min(h[k], best);
    }
  }

  // ---- 5. the sea rises; lakes ----
  const drown = (F.drown || P.drown * (seaShare > 0 ? 1 : 0)) * (seaShare > 0 ? 1 : 0);
  if (drown > 0) {
    // (cells that were low valley floors joined to the sea go under: estuaries and rias)
    const seaNow = new Uint8Array(NN), stack: number[] = [];
    for (let k = 0; k < NN; k++) if (h[k] < 0) { seaNow[k] = 1; stack.push(k); }
    while (stack.length) {
      const k = stack.pop()!, i = k % n, j = (k - i) / n;
      for (const [di, dj] of D8) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const q = b * n + a;
        if (seaNow[q] || h[q] >= drown || Math.hypot(X(a), Z(b)) <= P.keepSeaOff) continue;
        seaNow[q] = 1; stack.push(q);
        // (a channel that runs on diagonally: the lower of the two cells beside the step goes under
        // too, so the water is joined along an edge, not at a corner)
        if (di && dj) { const u = j * n + a, v = b * n + i, w = h[u] < h[v] ? u : v; if (!seaNow[w]) { seaNow[w] = 1; stack.push(w); } }
      }
    }
    for (let k = 0; k < NN; k++) h[k] = seaNow[k] ? Math.min(h[k] - drown, -0.5) : h[k] - drown;
    for (let k = 0; k < NN; k++) if (!seaNow[k] && h[k] < 0.5) h[k] = 0.5; // (land stays land)
    for (let k = 0; k < NN; k++) outlet[k] = seaNow[k] || outlet[k] && h[k] < 0 ? 1 : 0;
    for (let i = 0; i < n; i++) { outlet[i] = outlet[(n - 1) * n + i] = outlet[i * n] = outlet[i * n + n - 1] = 1; }
  }
  route();
  // lakes: hollows the flood filled, deep and big enough (the rest filled to their rim)
  const lakeId = new Int16Array(NN).fill(-1), lakes: CoarseLake[] = [];
  {
    const seen = new Uint8Array(NN), found: { cells: number[]; lv: number; deep: number }[] = [];
    let land = 0;
    for (let k = 0; k < NN; k++) if (!outlet[k]) land++;
    for (let k0 = 0; k0 < NN; k0++) {
      if (seen[k0] || filled[k0] - h[k0] < 0.05 || outlet[k0]) continue;
      const cells: number[] = [], stack = [k0], lv = filled[k0];
      seen[k0] = 1;
      let deep = 0;
      while (stack.length) {
        const k = stack.pop()!, i = k % n, j = (k - i) / n;
        cells.push(k); deep = Math.max(deep, lv - h[k]);
        for (const [di, dj] of D8) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= n || b >= n) continue; const q = b * n + a; if (!seen[q] && filled[q] - h[q] >= 0.05 && Math.abs(filled[q] - lv) < 0.02 && !outlet[q]) { seen[q] = 1; stack.push(q); } }
      }
      found.push({ cells, lv, deep });
    }
    // (in the live play area's reach, no lakes: its water is the game's own; and not tiny or shallow
    // ones; and the deepest first, up to the lakes' share of the land)
    const minDeep = P.lakeDepth * (1.3 - 0.6 * Math.min(1, wetness)), cap = P.lakeShare * wetness * land;
    let used = 0;
    found.sort((a, b) => b.deep * Math.sqrt(b.cells.length) - a.deep * Math.sqrt(a.cells.length));
    for (const f of found) {
      const keep = f.deep >= minDeep && f.cells.length >= P.lakeCells && used + f.cells.length <= cap && !f.cells.some((k) => Math.max(Math.abs(X(k % n)), Math.abs(Z(Math.floor(k / n)))) < 5200);
      if (keep && lakes.length < 32000) {
        const id = lakes.length;
        let sx = 0, sz = 0;
        for (const k of f.cells) { lakeId[k] = id; sx += X(k % n); sz += Z(Math.floor(k / n)); }
        lakes.push({ level: f.lv, cells: f.cells, x: sx / f.cells.length, z: sz / f.cells.length });
        used += f.cells.length;
      } else for (const k of f.cells) h[k] = filled[k]; // (filled in)
    }
  }
  route();

  // ---- rivers: where enough water gathers, traced down to the sea, a lake or another river ----
  const stream = P.stream / wetness, cut = o.rivers === 0 ? Infinity : stream * (2 / Math.max(1, o.rivers)) ** 0.5;
  const rivers = traceRivers(h, filled, n, x0, z0, C, recv, area, outlet, lakeId, cut);

  // ---- the sea: signed distance to the coast (chamfer), + inland ----
  const sea = seaDistance(h, n, C);
  // how rugged each part is (for the fine detail): the range of heights within a cell or two
  const relief = new Float32Array(NN);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const a = Math.max(0, Math.min(n - 1, i + di)), b = Math.max(0, Math.min(n - 1, j + dj)), v = h[b * n + a]; if (v < lo) lo = v; if (v > hi) hi = v; }
    relief[j * n + i] = hi - lo;
  }
  // ---- rock: by height through the landform's rocks, with a scarp's chalk or limestone on its front and
  // back, alluvium on the valley floors, granite on the massifs ----
  const rock = new Uint8Array(NN), R = ROCKS;
  let max = 0;
  for (let k = 0; k < NN; k++) if (h[k] > max) max = h[k];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, x = X(i), z = Z(j);
    let rk: Rock;
    if (h[k] <= 0) rk = 'alluvium';
    else {
      const t = Math.max(0, Math.min(0.999, (h[k] / Math.max(1, A)) * 1.1 + 0.12 * N[9](x / 6000, z / 6000)));
      rk = F.rocks[Math.floor(t * F.rocks.length)];
      for (const m of massifs) if (Math.hypot(x - m.x, z - m.z) < m.R * 0.9 && h[k] > A * 0.3) rk = 'granite';
      if (area[k] > 15e6 && relief[k] < Math.max(20, A * 0.12)) rk = 'alluvium';
    }
    rock[k] = R.indexOf(rk);
  }
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { x0, z0, cell: C, n, h, sea, lake: lakeId, rock, relief, rivers, lakes, landform: o.landform, side, max, ms };
}

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

// Priority-flood (Barnes et al. 2014, with an epsilon): from the outlets inwards, lowest first; each
// cell drains to the neighbour it was reached from, and is filled to just above it if lower. Fills
// `filled`, `recv` (−1 for outlets) and `order` (outlets first, each cell after its receiver).
function priorityFlood(h: Float32Array, n: number, outlet: Uint8Array, filled: Float32Array, recv: Int32Array, order: Int32Array) {
  const NN = n * n, done = new Uint8Array(NN);
  const heap = new Int32Array(NN), pri = new Float32Array(NN);
  let size = 0, oi = 0;
  const push = (k: number, p: number) => { let i = size++; while (i > 0) { const q = (i - 1) >> 1; if (pri[q] <= p) break; heap[i] = heap[q]; pri[i] = pri[q]; i = q; } heap[i] = k; pri[i] = p; };
  const pop = () => {
    const top = heap[0], lk = heap[--size], lp = pri[size];
    let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= size) break; if (c + 1 < size && pri[c + 1] < pri[c]) c++; if (pri[c] >= lp) break; heap[i] = heap[c]; pri[i] = pri[c]; i = c; }
    heap[i] = lk; pri[i] = lp;
    return top;
  };
  for (let k = 0; k < NN; k++) if (outlet[k]) { done[k] = 1; filled[k] = h[k]; recv[k] = -1; push(k, h[k]); }
  while (size) {
    const k = pop();
    order[oi++] = k;
    const i = k % n, j = (k - i) / n, fk = filled[k];
    for (const [di, dj] of D8) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const q = b * n + a;
      if (done[q]) continue;
      done[q] = 1;
      const f = Math.max(h[q], fk + 1e-3);
      filled[q] = f; recv[q] = k;
      push(q, f);
    }
  }
}

// The rivers: every cell that drains `cut` or more is on one. Each river runs from a source (a cell
// just past the cut whose upstream cells are all below it) down its receivers until it reaches the
// sea, a lake, the map's edge or a cell already on a river (it joins it there).
function traceRivers(h: Float32Array, filled: Float32Array, n: number, x0: number, z0: number, C: number, recv: Int32Array, area: Float32Array, outlet: Uint8Array, lake: Int16Array, cut: number): CoarseRiver[] {
  const NN = n * n, on = new Int32Array(NN).fill(-1), out: CoarseRiver[] = [];
  if (!Number.isFinite(cut)) return out;
  // sources, biggest first: a river is traced before the streams that feed it
  const heads: number[] = [];
  const hasUp = new Uint8Array(NN);
  for (let k = 0; k < NN; k++) { const r0 = recv[k]; if (r0 >= 0 && area[k] >= cut) hasUp[r0] = 1; }
  for (let k = 0; k < NN; k++) if (area[k] >= cut && !hasUp[k] && !outlet[k] && lake[k] < 0) heads.push(k);
  // (trace from each head; its length decides the order: the longest first, so the main stem is one river)
  const pathOf = (k0: number) => { const p: number[] = []; for (let k = k0; k >= 0; k = recv[k]) { p.push(k); if (outlet[k] || lake[k] >= 0) break; } return p; };
  const all = heads.map((k) => pathOf(k)).sort((a, b) => b.length - a.length);
  for (const cells of all) {
    const keep: number[] = [];
    let into = -1;
    for (const k of cells) { keep.push(k); if (on[k] >= 0) { into = on[k]; break; } }
    if (keep.length < 3) continue;
    const id = out.length;
    for (const k of keep) if (on[k] < 0) on[k] = id;
    const path = keep.map((k) => ({ x: x0 + (k % n) * C, z: z0 + Math.floor(k / n) * C }));
    const ar = keep.map((k) => area[k]);
    // its level: the filled surface, never rising downstream, and 0 at the sea
    const level: number[] = [];
    let lv = Infinity;
    for (const k of keep) { lv = Math.min(lv, Math.max(outlet[k] && h[k] < 0 ? 0 : filled[k], 0)); level.push(lv); }
    out.push({ path, area: ar, level, into });
  }
  return out;
}

// Signed distance to the coast (m, + on land) on the grid: the coast is where h crosses 0 (between
// cells, by linear interpolation), spread out by a two-pass chamfer.
function seaDistance(h: Float32Array, n: number, C: number) {
  const NN = n * n, d = new Float32Array(NN).fill(1e7);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, a = h[k];
    for (const [di, dj] of [[1, 0], [0, 1]] as const) {
      const ii = i + di, jj = j + dj;
      if (ii >= n || jj >= n) continue;
      const q = jj * n + ii, b = h[q];
      if ((a > 0) === (b > 0)) continue;
      const t = a / (a - b); // (where it crosses 0, from k)
      d[k] = Math.min(d[k], t * C); d[q] = Math.min(d[q], (1 - t) * C);
    }
  }
  const D = C * Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + C);
      if (j > 0) { v = Math.min(v, d[k - n] + C); if (i > 0) v = Math.min(v, d[k - n - 1] + D); if (i < n - 1) v = Math.min(v, d[k - n + 1] + D); }
      d[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + C);
      if (j < n - 1) { v = Math.min(v, d[k + n] + C); if (i < n - 1) v = Math.min(v, d[k + n + 1] + D); if (i > 0) v = Math.min(v, d[k + n - 1] + D); }
      d[k] = v;
    }
  }
  for (let k = 0; k < NN; k++) { if (d[k] > 1e6) d[k] = 1e6; if (h[k] <= 0) d[k] = -d[k]; }
  return d;
}

// ---------------- reading it ----------------
// Bilinear read of a grid at a point.
export function sampleGrid(L: CoarseLand, a: ArrayLike<number>, x: number, z: number) {
  const n = L.n, gx = Math.max(0, Math.min(n - 1.0001, (x - L.x0) / L.cell)), gz = Math.max(0, Math.min(n - 1.0001, (z - L.z0) / L.cell));
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i;
  return (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fz) + (a[k + n] * (1 - fx) + a[k + n + 1] * fx) * fz;
}
// Smooth (Catmull–Rom) read of the heights, so the hills have no creases along the grid lines.
export function sampleSmooth(L: CoarseLand, a: ArrayLike<number>, x: number, z: number) {
  const n = L.n, gx = Math.max(1, Math.min(n - 2.0001, (x - L.x0) / L.cell)), gz = Math.max(1, Math.min(n - 2.0001, (z - L.z0) / L.cell));
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (jj: number) => { const k = jj * n + i; return cr(a[k - 1], a[k], a[k + 1], a[k + 2], fx); };
  return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz);
}
// The rock at a point (for vernacular's setGeology).
export function rockAt(L: CoarseLand, x: number, z: number): Rock {
  const n = L.n, i = Math.max(0, Math.min(n - 1, Math.round((x - L.x0) / L.cell))), j = Math.max(0, Math.min(n - 1, Math.round((z - L.z0) / L.cell)));
  return ROCKS[L.rock[j * n + i]];
}
