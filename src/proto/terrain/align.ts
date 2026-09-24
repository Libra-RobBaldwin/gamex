// Vertical alignment on real ground: the height profile of a road or railway that costs least to
// build, given the ground under it.
//
// grade.ts finds a profile over flat ground: stay at 0 unless a limit says otherwise. Over hills
// "stay on the ground" is no longer possible (the ground is often steeper than the road may be),
// so this is an optimisation instead. At each sample along the centreline the road is either
//   - on earthworks: at grade, on an embankment (fill) or in a cutting (cut), costed by volume;
//   - on a bridge: costed by deck area plus piers that grow with height;
//   - in a tunnel: costed per metre, once there's enough ground above it.
// Dynamic programming over (sample, height, structure) finds the cheapest profile that never
// exceeds the gradient limit, meets fixed end heights, keeps every clearance window ("limits",
// exactly as grade.ts takes them, but in absolute heights) and bridges or tunnels any water.
// Changing between structures costs an abutment or a portal, so the answer comes in sensible
// spans rather than flickering between a bridge and a bank.

import { GRADES, type Limit } from '../grade';
import { halfOf, type RoadDef } from '../catalog';
import type { HeightSource } from './height';

export type Structure = 'earth' | 'bridge' | 'tunnel';
export type Kind = 'grade' | 'embankment' | 'cutting' | 'bridge' | 'tunnel';

// Unit costs, in the same money as the catalogue (a street costs about 250 a metre to build).
export interface AlignCosts {
  fill: number; // per m³ of embankment
  cut: number; // per m³ of cutting (dig and cart away)
  deck: number; // per m² of bridge deck
  pier: number; // per m² of deck, per metre of height (piers and foundations)
  tunnel: number; // per m² of tunnel (width × length)
  abutment: number; // per metre of width, each end of a bridge
  portal: number; // per metre of width, each tunnel mouth
}
export const ALIGN_COSTS: AlignCosts = { fill: 12, cut: 10, deck: 150, pier: 5, tunnel: 320, abutment: 400, portal: 1500 };

export interface AlignSpec {
  maxGrade: number;
  width: number; // formation width, metres (carriageway or track bed with its verges)
  clear: number; // headroom a structure needs (tunnel cover starts from this)
  water: number; // clearance over water for boats
  under: number; // depth below the water surface a tunnel must be
  maxFill: number; // highest embankment before it has to be a bridge
  maxCut: number; // deepest open cutting before it has to be a tunnel
  cover: number; // least depth of deck below ground for a tunnel (bored or cut-and-cover)
  maxHeight: number; // highest a bridge deck may be above the ground
  maxDepth: number; // deepest a tunnel may be below the ground
  fillSlope: number; // embankment side slopes, horizontal per vertical
  cutSlope: number; // cutting side slopes
  costs: AlignCosts;
  bridges: boolean; // allowed at all
  tunnels: boolean;
}

// The spec for a catalogue road or railway (gradient from its type, clearances from GRADES).
export function alignSpec(def: Pick<RoadDef, 'cls' | 'maxGrade'> & Partial<RoadDef>, o: Partial<AlignSpec> = {}): AlignSpec {
  const g = def.cls === 'rail' ? GRADES.rail : GRADES.road;
  const width = o.width ?? (def.lanes !== undefined ? 2 * halfOf(def as RoadDef) : def.cls === 'rail' ? 12 : 11);
  return {
    maxGrade: def.maxGrade, width,
    clear: g.clear, water: g.water, under: g.under,
    maxFill: 15, maxCut: 20, cover: g.clear + 2, maxHeight: 80, maxDepth: 60, fillSlope: 2, cutSlope: 1.5,
    costs: ALIGN_COSTS, bridges: true, tunnels: true, ...o,
  };
}

export interface AlignInput {
  length: number; // metres along the centreline
  ground: ArrayLike<number>; // ground heights at evenly spaced samples from 0 to length (bed, under water)
  water?: ArrayLike<number | null>; // water surface at the same samples, null (or NaN) where dry
  y0?: number; // fixed start height (default: the ground)
  yL?: number | null; // fixed end height (default: the ground; null leaves it free)
  limits?: Limit[]; // absolute height windows (a crossing's height ± clearance, junctions)
}

export interface Span { kind: Kind; i0: number; i1: number; s0: number; s1: number; max: number }
export interface Alignment {
  ok: boolean; reason?: string;
  s: number[]; ground: number[]; y: number[]; // y absolute
  depth: number[]; // y − ground: + for fill or a bridge's height, − for cut or a tunnel's depth
  kind: Kind[]; structure: Structure[];
  spans: Span[];
  cost: { total: number; earth: number; bridge: number; tunnel: number; ends: number };
  volume: { cut: number; fill: number };
  maxGrade: number;
}

const ST: Structure[] = ['earth', 'bridge', 'tunnel'];

// Per-metre cost of structure t with the deck at height d above ground g (Infinity if not allowed).
function unitCost(sp: AlignSpec, t: number, y: number, g: number, w: number | null) {
  const W = sp.width, c = sp.costs, d = y - g;
  if (t === 0) {
    if (w !== null) return Infinity; // no banks across water (a causeway would block boats)
    if (d >= 0) return d > sp.maxFill ? Infinity : (W * d + sp.fillSlope * d * d) * c.fill;
    return -d > sp.maxCut ? Infinity : (-W * d + sp.cutSlope * d * d) * c.cut;
  }
  if (t === 1) {
    if (!sp.bridges || d < 0 || d > sp.maxHeight) return Infinity;
    if (w !== null && y < w + sp.water) return Infinity;
    return W * (c.deck + c.pier * d);
  }
  if (!sp.tunnels || -d < sp.cover || -d > sp.maxDepth) return Infinity;
  if (w !== null && y > w - sp.under) return Infinity;
  // a little extra with depth: deeper shafts, longer spoil haul, and it keeps tunnels shallow
  return W * (c.tunnel - c.tunnel * 0.002 * d);
}
function switchCost(sp: AlignSpec, a: number, b: number) {
  if (a === b) return 0;
  const W = sp.width, c = sp.costs;
  const end = (t: number) => (t === 1 ? c.abutment : t === 2 ? c.portal : 0);
  return W * (end(a) + end(b));
}

interface Band { lo: Int32Array; hi: Int32Array }

// The cheapest path through (sample, height index, structure). Heights are yRef + k·dy; from one
// sample to the next k may change by at most K. Returns height indices and structures, or null.
function dp(sp: AlignSpec, n: number, ds: number, dy: number, K: number, yRef: number, g: ArrayLike<number>, w: (number | null)[], band: Band) {
  const back: Int32Array[] = [];
  let prev = new Float64Array((band.hi[0] - band.lo[0] + 1) * 3);
  const eps = 1e-4 * sp.width * ds; // tie-break: prefer steady gradients where cost doesn't care
  for (let k = band.lo[0]; k <= band.hi[0]; k++) for (let t = 0; t < 3; t++) prev[(k - band.lo[0]) * 3 + t] = unitCost(sp, t, yRef + k * dy, g[0], w[0]) * ds * 0.5;
  back.push(new Int32Array(0));
  const m = new Float64Array(3), am = new Int32Array(3);
  for (let i = 1; i < n; i++) {
    const lo = band.lo[i], hi = band.hi[i], plo = band.lo[i - 1], phi = band.hi[i - 1];
    const cur = new Float64Array((hi - lo + 1) * 3).fill(Infinity), bk = new Int32Array((hi - lo + 1) * 3).fill(-1);
    const wt = i === n - 1 ? ds * 0.5 : ds;
    for (let k = lo; k <= hi; k++) {
      // best way into height k from each structure at the previous sample
      const a = Math.max(plo, k - K), b = Math.min(phi, k + K);
      m.fill(Infinity);
      for (let kp = a; kp <= b; kp++) {
        const o = (kp - plo) * 3, dk = k - kp, pen = eps * dk * dk;
        for (let t = 0; t < 3; t++) { const v = prev[o + t] + pen; if (v < m[t]) { m[t] = v; am[t] = o + t; } }
      }
      const y = yRef + k * dy;
      for (let t = 0; t < 3; t++) {
        const c = unitCost(sp, t, y, g[i], w[i]);
        if (c === Infinity) continue;
        let best = Infinity, arg = -1;
        for (let tp = 0; tp < 3; tp++) { const v = m[tp] + switchCost(sp, tp, t); if (v < best) { best = v; arg = am[tp]; } }
        const o = (k - lo) * 3 + t;
        cur[o] = best + c * wt; bk[o] = arg;
      }
    }
    back.push(bk);
    prev = cur;
  }
  let best = Infinity, arg = -1;
  for (let o = 0; o < prev.length; o++) if (prev[o] < best) { best = prev[o]; arg = o; }
  if (arg < 0 || best === Infinity) return null;
  const ks = new Int32Array(n), ts = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) {
    ks[i] = Math.floor(arg / 3) + band.lo[i]; ts[i] = arg % 3;
    if (i) arg = back[i][arg];
  }
  return { ks, ts, cost: best };
}

// Tighten a band so every height in it can be reached from both ends at the gradient limit.
// Returns the first sample where nothing is left (or −1), and which samples' bounds collided there.
function envelope(band: Band, K: number) {
  const n = band.lo.length, ls = Int32Array.from({ length: n }, (_, i) => i), hs = Int32Array.from({ length: n }, (_, i) => i);
  for (let i = 1; i < n; i++) {
    if (band.lo[i - 1] - K > band.lo[i]) { band.lo[i] = band.lo[i - 1] - K; ls[i] = ls[i - 1]; }
    if (band.hi[i - 1] + K < band.hi[i]) { band.hi[i] = band.hi[i - 1] + K; hs[i] = hs[i - 1]; }
  }
  for (let i = n - 2; i >= 0; i--) {
    if (band.lo[i + 1] - K > band.lo[i]) { band.lo[i] = band.lo[i + 1] - K; ls[i] = ls[i + 1]; }
    if (band.hi[i + 1] + K < band.hi[i]) { band.hi[i] = band.hi[i + 1] + K; hs[i] = hs[i + 1]; }
  }
  for (let i = 0; i < n; i++) if (band.lo[i] > band.hi[i]) return { at: i, lo: ls[i], hi: hs[i] };
  return null;
}

const pct = (g: number) => `${(g * 100).toFixed(g < 0.1 ? 1 : 0).replace(/\.0$/, '')}%`;

export function align(inp: AlignInput, sp: AlignSpec): Alignment {
  const n = inp.ground.length, L = inp.length, ds = L / (n - 1), G = sp.maxGrade;
  const g = Array.from(inp.ground);
  const w: (number | null)[] = g.map((h, i) => { const v = inp.water?.[i]; return v === null || v === undefined || v !== v || v <= h ? null : v; });
  const s = g.map((_, i) => i * ds);
  const y0 = inp.y0 ?? g[0], yL = inp.yL === undefined ? g[n - 1] : inp.yL;
  // heights on a lattice dy apart, K steps being just under the gradient limit over one sample
  // (the 2% in hand absorbs the final correction onto exact end and junction heights)
  const K = 4, dy = (G * ds * 0.98) / K, yRef = y0;
  // anchors: heights that must be met exactly (ends, junctions); corrected onto after the search
  const anchor = new Map<number, number>([[0, y0]]);
  if (yL !== null) anchor.set(n - 1, yL);
  const lo = g.map((h, i) => (w[i] !== null ? Math.min(h, w[i]!) : h) - sp.maxDepth), hi = g.map((h, i) => Math.max(h, w[i] ?? -Infinity) + sp.maxHeight);
  const loWhy = g.map(() => 'the deepest a tunnel can go'), hiWhy = g.map(() => 'the highest a bridge can go');
  for (const l of inp.limits ?? []) {
    let any = false;
    const apply = (i: number) => {
      if (l.lo !== undefined && l.hi !== undefined && l.hi - l.lo < 2 * dy) { anchor.set(i, (l.lo + l.hi) / 2); loWhy[i] = hiWhy[i] = l.why; return; }
      // range limits keep half a step in hand for the final correction
      if (l.lo !== undefined && l.lo + dy / 2 > lo[i]) { lo[i] = l.lo + dy / 2; loWhy[i] = l.why; }
      if (l.hi !== undefined && l.hi - dy / 2 < hi[i]) { hi[i] = l.hi - dy / 2; hiWhy[i] = l.why; }
    };
    for (let i = 0; i < n; i++) if (s[i] >= l.s0 - 1e-6 && s[i] <= l.s1 + 1e-6) { apply(i); any = true; }
    if (!any) apply(Math.max(0, Math.min(n - 1, Math.round(((l.s0 + l.s1) / 2 / L) * (n - 1)))));
  }
  const band: Band = { lo: new Int32Array(n), hi: new Int32Array(n) };
  for (let i = 0; i < n; i++) { band.lo[i] = Math.ceil((lo[i] - yRef) / dy - 1e-9); band.hi[i] = Math.floor((hi[i] - yRef) / dy + 1e-9); }
  for (const [i, v] of anchor) { const k = Math.round((v - yRef) / dy); band.lo[i] = Math.max(band.lo[i], k); band.hi[i] = Math.min(band.hi[i], k); if (i === 0 || i === n - 1) loWhy[i] = hiWhy[i] = i === 0 ? 'the start' : 'the end'; }

  const fail = (reason: string): Alignment => ({ ok: false, reason, s, ground: g, y: [], depth: [], kind: [], structure: [], spans: [], cost: { total: Infinity, earth: 0, bridge: 0, tunnel: 0, ends: 0 }, volume: { cut: 0, fill: 0 }, maxGrade: 0 });
  const lo0 = band.lo.slice(), hi0 = band.hi.slice();
  const bad = envelope(band, K);
  if (bad) {
    // name the two things that can't both be kept, as grade.ts does
    const j = bad.lo, k = bad.hi, climb = Math.max(0, (lo0[j] - hi0[k]) * dy);
    const dist = Math.round(Math.abs(s[j] - s[k])), need = Math.round(climb / G), m1 = `${climb.toFixed(1)} m`;
    const end = (why: string) => why === 'the start' || why === 'the end' || why === 'the junction';
    if (end(hiWhy[k]) && !end(loWhy[j])) return fail(`Can't climb ${m1} to clear ${loWhy[j]} within ${dist} m of ${hiWhy[k]} at ${pct(G)} (needs ${need} m)`);
    if (end(loWhy[j]) && !end(hiWhy[k])) return fail(`Can't dive ${m1} to get under ${hiWhy[k]} within ${dist} m of ${loWhy[j]} at ${pct(G)} (needs ${need} m)`);
    return fail(`Can't get from ${hiWhy[k]} to ${loWhy[j]}: ${m1} in ${dist} m at ${pct(G)} (needs ${need} m)`);
  }

  // coarse to fine: solve every 4th sample on a 4× coarser lattice first (16× less work), then
  // search only a few metres either side of that answer at full resolution
  let res: ReturnType<typeof dp> = null;
  const C = 4;
  if (n > 8 * C && (n - 1) % C === 0) {
    const nc = (n - 1) / C + 1, cb: Band = { lo: new Int32Array(nc), hi: new Int32Array(nc) }, gc: number[] = [], wc: (number | null)[] = [];
    for (let m = 0; m < nc; m++) {
      const i = m * C;
      gc.push(g[i]);
      // the coarse sample stands for its neighbours: over water if any is, and within reach of their bounds
      let wet: number | null = null, l = -Infinity, h = Infinity;
      for (let j = Math.max(0, i - C / 2); j <= Math.min(n - 1, i + C / 2); j++) {
        if (w[j] !== null) wet = Math.max(wet ?? -Infinity, w[j]!);
        l = Math.max(l, band.lo[j] - K * Math.abs(j - i)); h = Math.min(h, band.hi[j] + K * Math.abs(j - i));
      }
      wc.push(wet);
      // rounded outwards: the coarse pass is only a guide, the fine one keeps the exact bounds
      cb.lo[m] = Math.floor(l / C); cb.hi[m] = Math.ceil(h / C);
    }
    if (!envelope(cb, K)) {
      const coarse = dp(sp, nc, ds * C, dy * C, K, yRef, gc, wc, cb);
      if (coarse) {
        const margin = Math.max(Math.ceil(2 / dy), 2 * C * K);
        const fb: Band = { lo: new Int32Array(n), hi: new Int32Array(n) };
        for (let i = 0; i < n; i++) {
          const m = Math.min(nc - 2, Math.floor(i / C)), t = (i - m * C) / C;
          const k = Math.round((coarse.ks[m] * (1 - t) + coarse.ks[m + 1] * t) * C);
          fb.lo[i] = Math.max(band.lo[i], k - margin); fb.hi[i] = Math.min(band.hi[i], k + margin);
        }
        if (!envelope(fb, K)) res = dp(sp, n, ds, dy, K, yRef, g, w, fb);
      }
    }
  }
  res ??= dp(sp, n, ds, dy, K, yRef, g, w, band);
  if (!res) return fail(w.some((v) => v !== null) && !sp.bridges && !sp.tunnels ? 'Water in the way, and neither bridges nor tunnels are allowed' : 'No way through: the ground is too steep for this gradient without structures that are allowed here');

  // back to heights, then correct onto the anchors exactly (each correction under half a step,
  // spread linearly between anchors so the gradient barely moves)
  const y = Array.from(res.ks, (k) => yRef + k * dy);
  const ai = [...anchor.keys()].sort((a, b) => a - b);
  const corr = new Array<number>(n).fill(0);
  for (let q = 0; q < ai.length; q++) {
    const i = ai[q], e = anchor.get(i)! - y[i];
    corr[i] = e;
    if (q === 0) for (let j = 0; j < i; j++) corr[j] = e;
    if (q === ai.length - 1) for (let j = i + 1; j < n; j++) corr[j] = e;
    if (q > 0) { const p = ai[q - 1], ep = corr[p]; for (let j = p + 1; j < i; j++) corr[j] = ep + ((e - ep) * (j - p)) / (i - p); }
  }
  for (let i = 0; i < n; i++) y[i] += corr[i];
  // where two anchors are only a sample or two apart that can leave a step a hair over the limit:
  // relax it without moving the anchors
  for (let pass = 0; pass < 200; pass++) {
    let worst = 0;
    for (let i = 1; i < n; i++) {
      const over = Math.abs(y[i] - y[i - 1]) - G * ds;
      if (over <= 1e-9) continue;
      worst = Math.max(worst, over);
      const dir = Math.sign(y[i] - y[i - 1]), fa = anchor.has(i - 1), fb2 = anchor.has(i);
      if (fa && fb2) continue;
      if (fa) y[i] -= dir * over; else if (fb2) y[i - 1] += dir * over; else { y[i] -= (dir * over) / 2; y[i - 1] += (dir * over) / 2; }
    }
    if (worst <= 1e-9) break;
  }

  // describe it
  const structure = Array.from(res.ts, (t) => ST[t]);
  const depth = y.map((v, i) => v - g[i]);
  const kind: Kind[] = structure.map((t, i) => (t === 'bridge' ? 'bridge' : t === 'tunnel' ? 'tunnel' : depth[i] > 0.3 ? 'embankment' : depth[i] < -0.3 ? 'cutting' : 'grade'));
  const spans: Span[] = [];
  for (let i = 0; i < n; i++) {
    const last = spans[spans.length - 1];
    if (last && last.kind === kind[i]) { last.i1 = i; last.s1 = s[i]; last.max = Math.max(last.max, Math.abs(depth[i])); }
    else spans.push({ kind: kind[i], i0: i, i1: i, s0: s[i], s1: s[i], max: Math.abs(depth[i]) });
  }
  // spans meet halfway between samples, so they tile the route end to end
  for (let q = 1; q < spans.length; q++) { const mid = (spans[q - 1].s1 + spans[q].s0) / 2; spans[q - 1].s1 = mid; spans[q].s0 = mid; }
  const cost = { total: 0, earth: 0, bridge: 0, tunnel: 0, ends: 0 }, volume = { cut: 0, fill: 0 };
  let maxGrade = 0;
  for (let i = 0; i < n; i++) {
    const wt = i === 0 || i === n - 1 ? ds / 2 : ds, t = res.ts[i], c = unitCost(sp, t, y[i], g[i], w[i]) * wt;
    if (t === 0) {
      cost.earth += c;
      const d = depth[i], area = d >= 0 ? sp.width * d + sp.fillSlope * d * d : -sp.width * d + sp.cutSlope * d * d;
      if (d >= 0) volume.fill += area * wt; else volume.cut += area * wt;
    } else if (t === 1) cost.bridge += c; else cost.tunnel += c;
    if (i) { cost.ends += switchCost(sp, res.ts[i - 1], t); maxGrade = Math.max(maxGrade, Math.abs(y[i] - y[i - 1]) / ds); }
  }
  cost.total = cost.earth + cost.bridge + cost.tunnel + cost.ends;
  return { ok: true, s, ground: g, y, depth, kind, structure, spans, cost, volume, maxGrade };
}

// ---------- on a height source ----------
export interface XZ { x: number; z: number }

// Evenly spaced points along a polyline (n of them, both ends included).
export function resample(path: XZ[], n: number): { pts: XZ[]; length: number } {
  const acc = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  const L = acc[acc.length - 1], pts: XZ[] = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const t = (L * k) / (n - 1);
    while (seg < path.length - 1 && acc[seg] < t) seg++;
    const a = path[seg - 1], b = path[seg], l = acc[seg] - acc[seg - 1], f = l ? (t - acc[seg - 1]) / l : 0;
    pts.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  return { pts, length: L };
}

export interface RouteOpts { step?: number; y0?: number; yL?: number | null; limits?: Limit[] }
export interface RouteAlignment extends Alignment { pts: XZ[]; path: { x: number; z: number; y: number }[] }

// Align a centreline over a height source: samples the ground and water under it (every `step`
// metres, 5 by default, rounded so the count suits the coarse-to-fine search), then solves.
export function alignRoute(path: XZ[], src: HeightSource, sp: AlignSpec, o: RouteOpts = {}): RouteAlignment {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  const step = o.step ?? 5, n = Math.max(2, 4 * Math.ceil(L / step / 4) + 1);
  const { pts } = resample(path, n);
  const ground = pts.map((p) => src.heightAt(p.x, p.z)), water = pts.map((p) => src.waterLevel(p.x, p.z));
  const a = align({ length: L, ground, water, y0: o.y0, yL: o.yL, limits: o.limits }, sp);
  return { ...a, pts, path: a.ok ? pts.map((p, i) => ({ x: p.x, z: p.z, y: a.y[i] })) : [] };
}
