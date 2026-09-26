// The world plan's trunk network (docs/streaming.md): the routes a 50 km map's traffic and trains
// run on between places, planned once, coarsely, for the whole map. Each is a centre line (points
// 25 m apart); what lies along it (verges, hedges, bridges, the buildings keeping clear) is worked
// out a tile at a time (tilegen.ts), and in the live play area the routes are built on the game's
// Network like any road (worldmap/live.ts).
//
//   - motorways: one along the lie of the map, running past (not through) the cities and towns,
//     from one edge to the other; a second across it when the map has two cities far apart;
//   - A roads: between the cities and the market towns (the Gabriel graph of their centres), from
//     the ends of their high streets; and a few off the map's edges (to the places beyond it:
//     where the edge session's portals go);
//   - B roads: each village to its nearest neighbours (region/generate.ts suggestLinks);
//   - railways: a main line from edge to edge through the start town, the cities and the towns
//     nearest its line, and a branch or two off it to other towns.
//
// Routes bend a little (no straight lines across country), go round lakes and the sea, and keep out
// of the places they don't serve. Pure: no three.js.
import { mix, range, rng, type Rand } from '../region/random';
import { worldNoise } from '../ground/noise';
import { lakeRadiusOf, type XZ } from '../region/water';
import type { Link } from '../region/generate';
import type { WorldWater } from './water';
import { LIVE_HALF, type SettlementGrid, type WorldSettlement } from './plan';

export type RouteKind = 'motorway' | 'A' | 'B';
export interface Route {
  id: number;
  kind: RouteKind;
  path: XZ[]; // the centre line, points STEP metres apart
  a: number | null; b: number | null; // the settlements at its ends (null: off the map's edge)
}
export interface Station { settlement: number; x: number; z: number; ux: number; uz: number } // where it stands, and the line's direction there
export interface Rail { id: number; kind: 'main' | 'branch'; path: XZ[]; stations: Station[] }

export const STEP = 25;
// half-widths of the ground each takes (carriageways and verges; the track bed), for keeping clear
export const ROUTE_HALF: Record<RouteKind | 'rail', number> = { motorway: 17, A: 6, B: 4.5, rail: 5 };

interface Ctx { seed: number; half: number; settlements: WorldSettlement[]; links: Link[]; water: WorldWater; grid: SettlementGrid; heightAt: (x: number, z: number) => number }
const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

// A map starts with only the minor roads between places (the player builds everything bigger: the
// A roads, motorways and railways): each place joined to its neighbours, and a few lanes off the
// map's edges. Each road is found over the land (terrain-following: `lane`), round hills and water.
// (`full`: the old trunk network as well, motorways, A roads and railways: kept for later maps.)
export function planRoutes(c: Ctx, full = false): { roads: Route[]; rails: Rail[] } {
  const roads: Route[] = [], r = rng(mix(c.seed, 301));
  const add = (kind: RouteKind, path: XZ[] | null, a: number | null, b: number | null) => { if (path && path.length > 1) roads.push({ id: roads.length, kind, path, a, b }); };
  if (full) for (const line of motorwayLines(c, r)) add('motorway', settle(c, line, r, 'motorway', []), null, null);
  const L = new LaneFinder(c);
  for (const l of [...c.links].sort((p, q) => p.length - q.length)) {
    const A = c.settlements[l.a], B = c.settlements[l.b];
    add(full ? l.road : 'B', L.find(endOf(A, B), endOf(B, A), [A.id, B.id]), A.id, B.id);
  }
  for (const e of edgeExits(c, r)) {
    // (found to just inside the edge, then straight on off it)
    const H = c.half - 60, inner = { x: Math.max(-H, Math.min(H, e.to.x)), z: Math.max(-H, Math.min(H, e.to.z)) };
    const p = L.find(endOf(e.from, e.to), inner, [e.from.id]);
    add(full ? 'A' : 'B', p ? resample([...p, e.to], STEP) : null, e.from.id, null);
  }
  forks(roads);
  return { roads, rails: full ? planRails(c, r) : [] };
}

// Two lanes into a place by the same street end would meet it side by side, all but parallel (a
// junction no one would build, and the Network can't shape). The later one instead forks off the
// earlier where they've come together: it runs as far as it's still 35 m clear of it, then turns in
// to join it square, a T or a Y junction, as lanes do.
function forks(roads: Route[]) {
  const ends = new Map<string, Route>();
  const nearestOn = (P: XZ[], q: XZ) => { let best = P[0], bd = Infinity, bi = 0; P.forEach((p, i) => { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d < bd) { bd = d; best = p; bi = i; } }); return { p: best, d: bd, i: bi }; };
  for (const r of roads) for (const first of [true, false]) {
    const e = first ? r.path[0] : r.path[r.path.length - 1], k = `${Math.round(e.x / 4)},${Math.round(e.z / 4)}`;
    const q = ends.get(k);
    if (!q) { ends.set(k, r); continue; }
    const P = first ? r.path : [...r.path].reverse();
    let cut = -1;
    for (let i = 4; i < P.length - 6; i++) if (nearestOn(q.path, P[i]).d > 35) { cut = i; break; }
    if (cut < 0) continue;
    const on = nearestOn(q.path, P[cut]);
    // (joined at a point of the other lane at least 60 m from the place, square to it)
    const joined = resample([{ ...on.p }, ...P.slice(cut)], STEP);
    r.path = first ? joined : joined.reverse();
  }
}

// ---------------- lanes over the land ----------------
// A road across country goes the way that's easiest to build and drive, not straight: it keeps to
// gentle gradients, goes round hills rather than over them, round lakes and the sea, bridges a river
// only where it must, and keeps out of the places it doesn't serve. So: the cheapest path over a
// 100 m grid (steep ground dear, a river crossing dearer, water and other places out of bounds, and
// a little slow noise so it wanders as old lanes do), then smoothed into flowing bends.
class LaneFinder {
  static C = 125;
  private h: Float32Array; private n: number; private x0: number;
  private wet: Int8Array; // (per cell, worked out once for every road: 1 dry, 2 by a river, -1 standing water)
  constructor(private c: Ctx) {
    const C = LaneFinder.C; this.x0 = -Math.ceil((c.half + C) / C) * C; this.n = Math.round((-2 * this.x0) / C) + 1;
    this.h = new Float32Array(this.n * this.n).fill(NaN);
    this.wet = new Int8Array(this.n * this.n);
  }
  // (slow noise, so a lane wanders as old ones do: per cell, once)
  private wv: Float32Array | null = null;
  private wander(i: number, j: number) {
    const k = j * this.n + i, W = (this.wv ??= new Float32Array(this.n * this.n));
    if (!W[k]) { const x = this.x0 + i * LaneFinder.C, z = this.x0 + j * LaneFinder.C; W[k] = 0.7 + 0.6 * worldNoise(x, z, 700, this.c.seed + 311) + 0.2 * worldNoise(x, z, 230, this.c.seed + 312); }
    return W[k];
  }
  private water(i: number, j: number) {
    const k = j * this.n + i;
    let v = this.wet[k];
    if (!v) {
      const x = this.x0 + i * LaneFinder.C, z = this.x0 + j * LaneFinder.C;
      v = standing(this.c.water, { x, z }) < 70 ? -1 : this.c.water.rivers.some((r) => r.index.near(x, z, r.half + 50) !== Infinity) ? 2 : 1;
      this.wet[k] = v;
    }
    return v;
  }
  private height(i: number, j: number) {
    const k = j * this.n + i; let v = this.h[k];
    if (Number.isNaN(v)) v = this.h[k] = this.c.heightAt(this.x0 + i * LaneFinder.C, this.x0 + j * LaneFinder.C);
    return v;
  }
  find(a: XZ, b: XZ, serves: number[]): XZ[] | null {
    const C = LaneFinder.C, n = this.n, x0 = this.x0, c = this.c;
    const gi = (x: number) => Math.max(0, Math.min(n - 1, Math.round((x - x0) / C)));
    const si = gi(a.x), sj = gi(a.z), ti = gi(b.x), tj = gi(b.z);
    const L = Math.hypot(b.x - a.x, b.z - a.z), m = Math.max(8, Math.ceil((0.3 * L + 900) / C));
    const i0 = Math.max(0, Math.min(si, ti) - m), i1 = Math.min(n - 1, Math.max(si, ti) + m), j0 = Math.max(0, Math.min(sj, tj) - m), j1 = Math.min(n - 1, Math.max(sj, tj) + m);
    const W = i1 - i0 + 1, Hh = j1 - j0 + 1, N = W * Hh;
    const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N), bad = new Int8Array(N); // (bad: 0 unknown, 1 open, -1 blocked)
    const blocked = (i: number, j: number) => {
      const k = (j - j0) * W + (i - i0);
      if (bad[k]) return bad[k] < 0;
      const x = x0 + i * C, z = x0 + j * C;
      let no = Math.abs(x) > c.half - 20 && !(i === ti && j === tj) || this.water(i, j) < 0;
      if (!no) for (const s of c.grid.near(x, z)) if (!serves.includes(s.id) && Math.hypot(x - s.x, z - s.z) < s.reach + 60) { no = true; break; }
      if (!no && Math.abs(z) > c.half - 20 && !(i === ti && j === tj)) no = true;
      bad[k] = no ? -1 : 1;
      return no;
    };
    // a binary heap of (cost + estimate, cell)
    const heap: number[] = [], hk: number[] = [];
    const push = (f: number, k: number) => { heap.push(f); hk.push(k); let q = heap.length - 1; while (q > 0) { const p = (q - 1) >> 1; if (heap[p] <= heap[q]) break; [heap[p], heap[q]] = [heap[q], heap[p]]; [hk[p], hk[q]] = [hk[q], hk[p]]; q = p; } };
    const pop = () => { const k = hk[0], lf = heap.pop()!, lk = hk.pop()!; if (heap.length) { heap[0] = lf; hk[0] = lk; let q = 0; for (;;) { const l = 2 * q + 1, rr = l + 1; let mn = q; if (l < heap.length && heap[l] < heap[mn]) mn = l; if (rr < heap.length && heap[rr] < heap[mn]) mn = rr; if (mn === q) break; [heap[mn], heap[q]] = [heap[q], heap[mn]]; [hk[mn], hk[q]] = [hk[q], hk[mn]]; q = mn; } } return k; };
    const est = (i: number, j: number) => Math.hypot(i - ti, j - tj) * C * 0.7;
    const s0 = (sj - j0) * W + (si - i0), t0 = (tj - j0) * W + (ti - i0);
    g[s0] = 0; push(est(si, sj), s0);
    // (sixteen ways out of a cell, knight's moves too, so no heading is forced onto the grid's)
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    while (heap.length) {
      const k = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (k === t0) break;
      const i = (k % W) + i0, j = Math.floor(k / W) + j0, h0 = this.height(i, j);
      for (const [di, dj] of D) {
        const ni = i + di, nj = j + dj;
        if (ni < i0 || nj < j0 || ni > i1 || nj > j1) continue;
        const nk = (nj - j0) * W + (ni - i0);
        if (done[nk] || (blocked(ni, nj) && nk !== t0 && nk !== s0)) continue;
        const len = C * Math.hypot(di, dj);
        // (a knight's move jumps a cell: it mustn't jump a lake or a place)
        if (Math.abs(di) + Math.abs(dj) === 3 && blocked(i + Math.sign(di) * (Math.abs(di) > 1 ? 1 : 0), j + Math.sign(dj) * (Math.abs(dj) > 1 ? 1 : 0)) && nk !== t0) continue;
        const slope = Math.abs(this.height(ni, nj) - h0) / len;
        let w = len * (1 + 2 * (slope / 0.05) ** 2) * this.wander(ni, nj);
        if (this.water(ni, nj) === 2 && this.water(i, j) !== 2) w += 900; // (a bridge: only where it must)
        const gg = g[k] + w;
        if (gg < g[nk]) { g[nk] = gg; from[nk] = k; push(gg + est(ni, nj), nk); }
      }
    }
    if (from[t0] < 0) return settle(c, [a, b], rng(mix(c.seed, si, sj, ti, tj)), 'B', serves); // (boxed in: the old way)
    const cells: XZ[] = [];
    for (let k = t0; k >= 0; k = from[k]) cells.push({ x: x0 + ((k % W) + i0) * C, z: x0 + (Math.floor(k / W) + j0) * C });
    cells.reverse();
    cells[0] = { ...a }; cells[cells.length - 1] = { ...b };
    // (smoothed into flowing bends: evenly spaced, averaged over about 350 m so the grid's kinks go
    // but the lane's own wandering stays, then corner-cut; its ends stay where they are)
    let p = resample(cells, STEP);
    for (let pass = 0; pass < 2; pass++) {
      const K = 7, q = p.map((pt, i) => {
        if (i < 2 || i > p.length - 3) return pt;
        const k = Math.min(K, i, p.length - 1 - i);
        let x = 0, z = 0;
        for (let d = -k; d <= k; d++) { x += p[i + d].x; z += p[i + d].z; }
        return { x: x / (2 * k + 1), z: z / (2 * k + 1) };
      });
      p = q;
    }
    return resample(chaikin(chaikin(p)), STEP);
  }
}

// where a road from place A towards B leaves A: the end of its high street nearer B (towns and
// cities), or its middle (villages: the road runs in until it meets the village's streets)
function endOf(A: WorldSettlement, toward: XZ): XZ {
  if (!A.gates.length) return { x: A.x, z: A.z };
  return A.gates.reduce((g, q) => (dist(q, toward) < dist(g, toward) ? q : g));
}

// ---------------- laying a route over the country ----------------
// A line through the given points, bent gently, pushed round lakes, the sea and the places it
// doesn't serve, smoothed, and resampled every STEP metres.
function settle(c: Ctx, pts: XZ[], r: Rand, kind: RouteKind | 'rail', serves: number[]): XZ[] | null {
  // (straight pieces between the points, finely sampled, bent by two slow waves that die away at the ends)
  let path: XZ[] = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = dist(a, b);
    if (L < 1) continue;
    const n = Math.max(2, Math.ceil(L / 50)), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
    const bend = kind === 'motorway' ? 0.025 : kind === 'rail' ? 0.02 : kind === 'A' ? 0.045 : 0.07;
    const A1 = range(r, -1, 1) * bend * L, A2 = range(r, -1, 1) * bend * 0.4 * L, ph = range(r, 0, 6.28);
    for (let i = k === 1 ? 0 : 1; i <= n; i++) {
      const t = i / n, env = Math.sin(Math.PI * t);
      const off = env * (A1 * Math.sin(Math.PI * t) + A2 * Math.sin(3 * Math.PI * t + ph) * env);
      path.push({ x: a.x + (b.x - a.x) * t + nx * off, z: a.z + (b.z - a.z) * t + nz * off });
    }
  }
  if (path.length < 2) return null;
  const keep = kind === 'motorway' ? 350 : kind === 'rail' ? 120 : 40; // (how far it keeps from places it passes)
  for (let pass = 0; pass < 4; pass++) {
    const push = path.map((p, i) => (i === 0 || i === path.length - 1 ? 0 : pushFor(c, p, dir(path, i), keep, serves)));
    if (push.every((v) => v === 0)) break;
    // (spread each push along the route, so it swings round rather than kinking)
    const spread = new Float64Array(path.length), W = kind === 'motorway' ? 40 : 18;
    for (let i = 0; i < path.length; i++) if (push[i]) for (let k = -W; k <= W; k++) {
      const j = i + k; if (j <= 0 || j >= path.length - 1) continue;
      const v = push[i] * (1 - Math.abs(k) / (W + 1)) ** 0.6;
      if (Math.abs(v) > Math.abs(spread[j])) spread[j] = v;
    }
    path = path.map((p, i) => { const d = dir(path, i); return { x: p.x - d.z * spread[i], z: p.z + d.x * spread[i] }; });
  }
  // (clipped to the map, bar the few metres a road runs on off it)
  const H = c.half + 20;
  path = path.filter((p) => Math.abs(p.x) <= H && Math.abs(p.z) <= H);
  if (path.length < 2) return null;
  return resample(chaikin(chaikin(path)), STEP);
}
const dir = (p: XZ[], i: number) => { const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)], L = dist(a, b) || 1; return { x: (b.x - a.x) / L, z: (b.z - a.z) / L }; };
// How far (and which way, across the route) a point must move to be clear of standing water and of
// places it doesn't serve; 0 if it's clear.
function pushFor(c: Ctx, p: XZ, d: XZ, keep: number, serves: number[]): number {
  const nx = -d.z, nz = d.x;
  // the sea and the lakes (rivers are bridged)
  const wet = (q: XZ) => standing(c.water, q) < 60;
  // the places it passes: their land and a margin
  const inPlace = (q: XZ) => c.grid.near(q.x, q.z).some((s) => !serves.includes(s.id) && Math.hypot(q.x - s.x, q.z - s.z) < s.reach + keep);
  // (motorways keep out of the live play area round the start town: its roads are the player's to join them to)
  const live = (q: XZ) => keep >= 350 && Math.max(Math.abs(q.x), Math.abs(q.z)) < LIVE_HALF + 500;
  const blocked = (q: XZ) => wet(q) || inPlace(q) || live(q);
  if (!blocked(p)) return 0;
  for (let m = 40; m <= 3200; m += 40) {
    if (!blocked({ x: p.x + nx * m, z: p.z + nz * m })) return m;
    if (!blocked({ x: p.x - nx * m, z: p.z - nz * m })) return -m;
  }
  return 0;
}
// distance to the nearest standing water (the sea or a lake), negative in it
export function standing(w: WorldWater, p: XZ) {
  let best = w.seaDistance(p.x, p.z, 400);
  for (const L of w.spec.lakes) {
    const dx = p.x - L.x, dz = p.z - L.z, d = Math.hypot(dx, dz);
    if (d > L.r * 1.4 + 400) continue;
    best = Math.min(best, d - lakeRadiusOf(L, Math.atan2(dz, dx)));
  }
  return best;
}
function chaikin(p: XZ[]): XZ[] {
  const out: XZ[] = [p[0]];
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i], b = p[i + 1];
    out.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z }, { x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
  }
  out.push(p[p.length - 1]);
  return out;
}
export function resample(p: XZ[], step: number): XZ[] {
  const out: XZ[] = [{ ...p[0] }];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], L = dist(a, b);
    let s = step - carry;
    while (s <= L) { out.push({ x: a.x + ((b.x - a.x) * s) / L, z: a.z + ((b.z - a.z) * s) / L }); s += step; }
    carry = L - (s - step);
  }
  const last = p[p.length - 1];
  if (dist(out[out.length - 1], last) > step * 0.3) out.push({ ...last }); else out[out.length - 1] = { ...last };
  return out;
}

// ---------------- motorways ----------------
// Along the principal axis of the big places (parallel to the coast when there's a sea), across the
// whole map, beside the biggest of them; a second across it when the two cities lie far apart.
function motorwayLines(c: Ctx, r: Rand): XZ[][] {
  const big = c.settlements.filter((s) => s.kind !== 'village' && s.id !== 0);
  if (big.length < 2) return [];
  const H = c.half, sea = c.water.world.sea;
  const w = (s: WorldSettlement) => (s.kind === 'city' ? 3 : 1) * s.r;
  const W = big.reduce((t, s) => t + w(s), 0);
  const m = { x: big.reduce((t, s) => t + s.x * w(s), 0) / W, z: big.reduce((t, s) => t + s.z * w(s), 0) / W };
  let ang: number;
  if (sea) ang = sea.side === 'n' || sea.side === 's' ? 0 : Math.PI / 2;
  else {
    let sxx = 0, szz = 0, sxz = 0;
    for (const s of big) { const dx = s.x - m.x, dz = s.z - m.z; sxx += w(s) * dx * dx; szz += w(s) * dz * dz; sxz += w(s) * dx * dz; }
    ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  }
  const lines: XZ[][] = [];
  const along = (a: number, off: number) => {
    const u = { x: Math.cos(a), z: Math.sin(a) }, n = { x: -u.z, z: u.x };
    // (its line: through the weighted middle of the places, held 5 km or more off the start town)
    let d = (m.x - 0) * n.x + (m.z - 0) * n.z + off;
    if (Math.abs(d) < 5000) d = d < 0 ? -5000 - range(r, 0, 2500) : 5000 + range(r, 0, 2500);
    // (and kept on dry land, on the landward side of the coast)
    for (let tries = 0; tries < 12 && sea && c.water.seaDistance(n.x * d, n.z * d, 3000) < 2500; tries++) d += (c.water.seaDistance(n.x * (d + 500), n.z * (d + 500), 3000) > c.water.seaDistance(n.x * (d - 500), n.z * (d - 500), 3000) ? 1 : -1) * 900;
    // waypoints: the two edges, and beside each big place within 6 km of the line (at 1.4 km off its middle)
    const pts: { t: number; p: XZ }[] = [{ t: -H * 1.2, p: { x: n.x * d - u.x * H * 1.2, z: n.z * d - u.z * H * 1.2 } }, { t: H * 1.2, p: { x: n.x * d + u.x * H * 1.2, z: n.z * d + u.z * H * 1.2 } }];
    for (const s of big) {
      const t = s.x * u.x + s.z * u.z, q = s.x * n.x + s.z * n.z - d;
      if (Math.abs(q) > 6000 || Math.abs(t) > H - 3000) continue;
      const side = q > 0 ? 1 : -1, k = q - side * (s.reach + 1100);
      pts.push({ t, p: { x: n.x * (d + k * 0.85) + u.x * t, z: n.z * (d + k * 0.85) + u.z * t } });
    }
    pts.sort((a, b) => a.t - b.t);
    // (waypoints too close along the line merge into one)
    const kept: XZ[] = [];
    let lastT = -Infinity;
    for (const q of pts) { if (q.t - lastT < 5000 && kept.length > 1) continue; kept.push(q.p); lastT = q.t; }
    return kept;
  };
  lines.push(along(ang, 0));
  const cities = big.filter((s) => s.kind === 'city');
  if (cities.length === 2) {
    const n = { x: -Math.sin(ang), z: Math.cos(ang) }, gap = Math.abs((cities[0].x - cities[1].x) * n.x + (cities[0].z - cities[1].z) * n.z);
    if (gap > 12000 && !sea) lines.push(along(ang + Math.PI / 2, range(r, -3000, 3000)));
  }
  return lines;
}

// ---------------- off the map ----------------
// Up to three A roads leave by each dry edge: from the town nearest the edge (not the start town),
// straight out, to the places beyond the map (the edge session's portals).
function edgeExits(c: Ctx, r: Rand) {
  const H = c.half, out: { from: WorldSettlement; to: XZ }[] = [];
  const towns = c.settlements.filter((s) => s.kind !== 'village' && s.id !== 0);
  const sea = c.water.world.sea?.side;
  for (const side of ['n', 'e', 's', 'w'] as const) {
    if (side === sea) continue;
    const toEdge = (s: WorldSettlement) => (side === 'n' ? s.z + H : side === 's' ? H - s.z : side === 'e' ? H - s.x : s.x + H);
    const near = towns.filter((s) => toEdge(s) < H * 0.55).sort((a, b) => toEdge(a) - toEdge(b)).slice(0, 1 + Math.floor(r() * 2));
    for (const s of near) {
      const j = range(r, -0.15, 0.15) * H;
      const to = side === 'n' ? { x: s.x + j * 0.3, z: -H - 30 } : side === 's' ? { x: s.x + j * 0.3, z: H + 30 } : side === 'e' ? { x: H + 30, z: s.z + j * 0.3 } : { x: -H - 30, z: s.z + j * 0.3 };
      if (Math.abs(to.x) > H + 40 || Math.abs(to.z) > H + 40) continue;
      out.push({ from: s, to: { x: Math.max(-H - 30, Math.min(H + 30, to.x)), z: Math.max(-H - 30, Math.min(H + 30, to.z)) } });
    }
  }
  return out;
}

// ---------------- railways ----------------
function planRails(c: Ctx, r: Rand): Rail[] {
  const start = c.settlements[0], big = c.settlements.filter((s) => s.kind !== 'village');
  if (big.length < 2) return [];
  const H = c.half, sea = c.water.world.sea;
  // the main line's direction: through the start town towards the biggest place, on through the far side
  const far = big.filter((s) => s.id !== 0).sort((a, b) => (b.kind === 'city' ? 2 : 1) * b.r / Math.hypot(b.x, b.z) - (a.kind === 'city' ? 2 : 1) * a.r / Math.hypot(a.x, a.z))[0];
  const ang = Math.atan2(far.z - start.z, far.x - start.x), u = { x: Math.cos(ang), z: Math.sin(ang) }, n = { x: -u.z, z: u.x };
  // calling at the start town, and at every city and town within 3.5 km of that line (their stations
  // a little off their middles, so the line runs along the edge of the centre)
  const calls = big.filter((s) => Math.abs(s.x * n.x + s.z * n.z) < (s.id === 0 ? 1 : 3500) + (s.kind === 'city' ? 2500 : 0)).sort((a, b) => (a.x * u.x + a.z * u.z) - (b.x * u.x + b.z * u.z));
  const stationAt = (s: WorldSettlement): XZ => { const k = s.id === 0 ? 0.55 : 0.35; return { x: s.x + n.x * s.r * k, z: s.z + n.z * s.r * k }; };
  const ends = (sgn: number) => { const last = sgn > 0 ? calls[calls.length - 1] : calls[0], t = H * 1.15; return { x: last.x + u.x * sgn * t, z: last.z + u.z * sgn * t }; };
  const pts = [ends(-1), ...calls.map(stationAt), ends(1)];
  // (a line that would run into the sea stops at its last station short of it)
  const dry = (p: XZ) => !sea || c.water.seaDistance(p.x, p.z, 500) > 300;
  if (!dry(pts[0])) pts.shift();
  if (!dry(pts[pts.length - 1])) pts.pop();
  const rails: Rail[] = [];
  const main = settle(c, pts, r, 'rail', calls.map((s) => s.id));
  if (main) rails.push({ id: 0, kind: 'main', path: main, stations: stationsOn(main, calls) });
  // a branch or two: from a main-line town to the nearest towns off it, 5 km or more away
  const on = new Set(calls.map((s) => s.id));
  const off = big.filter((s) => !on.has(s.id));
  for (let k = 0; k < 2 && off.length && main; k++) {
    const t = off.splice(Math.floor(r() * Math.min(3, off.length)), 1)[0];
    const from = calls.filter((s) => s.id !== 0).sort((a, b) => dist(a, t) - dist(b, t))[0];
    if (!from || dist(from, t) < 5000 || dist(from, t) > 22000) continue;
    const path = settle(c, [stationAt(from), stationAt(t)], r, 'rail', [from.id, t.id]);
    if (path) rails.push({ id: rails.length, kind: 'branch', path, stations: stationsOn(path, [from, t]) });
  }
  return rails;
}
function stationsOn(path: XZ[], places: WorldSettlement[]): Station[] {
  const out: Station[] = [];
  for (const s of places) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < path.length; i++) { const d = Math.hypot(path[i].x - s.x, path[i].z - s.z); if (d < bd) { bd = d; best = i; } }
    if (bd > s.r * 1.2 + 200) continue;
    const d = dir(path, best);
    out.push({ settlement: s.id, x: path[best].x, z: path[best].z, ux: d.x, uz: d.z });
  }
  return out;
}
