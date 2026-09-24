// Hooks for what comes later: data and interfaces the transport game will build on, each with a
// working first version so the shapes of the data are tested.
//   - canals: pounds at fixed levels joined by locks (planCanal), added to the water system as a
//     made watercourse (canalReach + WaterSystem.addReaches), so its channel is cut and it shows;
//   - ports and quays: stretches of shore with deep water close in and flat land behind (findQuays);
//   - ferry and ship routes: a grid of water deep and wide enough for a boat (navGrid) and the
//     shortest way across it (shipRoute);
//   - bridges: from the crossings the water system reports, the height windows for the road and
//     rail height solver (navLimits, in grade.ts's Limit form) and where piers mustn't go (pierBans).

import type { Limit } from '../grade';
import type { GridSpec, HeightSource } from '../terrain/height';
import { BANK_HEIGHT, CLASS_CODE, SPILL, type Reach } from './rivers';
import { NAV, type WaterKind } from './types';
import type { Crossing, WaterSystem } from './water';

export interface XZ { x: number; z: number }

// ---------- canals ----------
export interface Pound { s0: number; s1: number; level: number } // a level stretch, s in metres along the canal
export interface Lock { s: number; x: number; z: number; dir: [number, number]; upper: number; lower: number; rise: number; length: number; width: number }
export interface Canal {
  id: string; ok: boolean; reason?: string;
  path: XZ[]; s: number[]; ground: number[]; // the centre line, sampled
  width: number; depth: number;
  pounds: Pound[]; locks: Lock[];
  level: number[]; // water level at each sample
}
export interface CanalOpts {
  width?: number; depth?: number; // m (a broad canal: 14 m and 1.8 m)
  maxRise?: number; // m per lock (English broad locks rise 2–4 m)
  freeboard?: number; // m the ground must stand above the water (no embankments: canals keep to the contours)
  maxCut?: number; // m of cutting before it takes a lock up instead
  lockLength?: number; lockWidth?: number;
  step?: number; // m between samples
}

// Levels and locks for a canal along a path: each pound stays level while the ground stays between
// `freeboard` and `maxCut` above it; where the ground falls away or climbs, a lock (or a flight of
// them, each at most maxRise) steps it to the level the ground ahead wants.
export function planCanal(ground: HeightSource, path: XZ[], o: CanalOpts = {}): Canal {
  const width = o.width ?? 14, depth = o.depth ?? 1.8, maxRise = o.maxRise ?? 3.5, fb = o.freeboard ?? 0.4, maxCut = o.maxCut ?? 6;
  const lockLength = o.lockLength ?? 40, lockWidth = o.lockWidth ?? 5, step = o.step ?? 10;
  // resample
  const pts: XZ[] = [], S: number[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) { pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n }); S.push(acc + (L * k) / n); }
    acc += L;
  }
  pts.push(path[path.length - 1]); S.push(acc);
  const G = pts.map((p) => ground.heightAt(p.x, p.z)), N = pts.length;
  const level = new Array<number>(N).fill(0), locks: Lock[] = [], pounds: Pound[] = [];
  const dirAt = (i: number): [number, number] => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return [(b.x - a.x) / l, (b.z - a.z) / l]; };
  let L = G[0] - fb - 0.1, s0 = 0;
  const gap = lockLength + 10;
  for (let i = 1; i < N; i++) {
    const need = G[i] - fb; // the highest the water may be here
    if (need >= L && G[i] - L <= maxCut) continue;
    // the level the ground ahead wants: low enough for the next 150 m, and never so low it's a deep cutting
    let want = need;
    for (let k = i; k < N && S[k] - S[i] < 150; k++) want = Math.min(want, G[k] - fb);
    want = Math.max(want, G[i] - maxCut + 0.5);
    if (Math.abs(want - L) < 1e-6) continue;
    // a flight: as many locks as it takes, `gap` apart; going down it ends at the last good sample
    // (so the canal is never above the ground), going up it starts here
    const n = Math.ceil(Math.abs(want - L) / maxRise - 1e-9), rise = (want - L) / n, down = want < L;
    const first = down ? Math.max(s0 + 1, S[i - 1] - (n - 1) * gap) : S[i];
    pounds.push({ s0, s1: first, level: L });
    for (let q = 0; q < n; q++) {
      const sq = Math.min(acc, first + q * gap), k = Math.max(0, Math.min(N - 1, Math.round(indexAt(S, sq)))), a = L + rise * q, b2 = L + rise * (q + 1);
      locks.push({ s: sq, x: pts[k].x, z: pts[k].z, dir: dirAt(k), upper: Math.max(a, b2), lower: Math.min(a, b2), rise: Math.abs(rise), length: lockLength, width: lockWidth });
      if (q < n - 1) pounds.push({ s0: sq, s1: Math.min(acc, sq + gap), level: b2 });
    }
    s0 = locks[locks.length - 1].s; L = want;
    // skip past a flight going up (its pounds are already set)
    while (i + 1 < N && S[i + 1] <= s0) i++;
  }
  pounds.push({ s0, s1: acc, level: L });
  // levels between the locks of a flight, and a check that the water is never above the ground
  // (at a lock the sample takes the lower pound: the chamber's floor side)
  for (let i = 0; i < N; i++) { let lv = Infinity; for (const p of pounds) if (S[i] >= p.s0 - 1e-6 && S[i] <= p.s1 + 1e-6) lv = Math.min(lv, p.level); level[i] = lv; }
  const high = level.findIndex((l, i) => l > G[i] - fb + 1e-6);
  const ok = high < 0;
  return { id: `canal:${Math.round(path[0].x)},${Math.round(path[0].z)}`, ok, reason: ok ? undefined : `The canal would stand above the ground ${Math.round(S[high])} m along`, path: pts, s: S, ground: G, width, depth, pounds, locks, level };
}
function indexAt(S: number[], s: number) {
  let i = 0;
  while (i < S.length - 2 && S[i + 1] < s) i++;
  return i + (s - S[i]) / (S[i + 1] - S[i] || 1);
}

// The canal as a watercourse the water system can cut and draw: still water (no flow), steep
// masonry-ish banks, class 'canal' (so navigation rules and bridge clearance are the canal's).
export function canalReach(c: Canal, ground: HeightSource): Reach {
  const n = c.path.length, x = new Float64Array(n), z = new Float64Array(n), s = new Float64Array(n), f = (v: number) => new Float32Array(n).fill(v);
  c.path.forEach((p, i) => { x[i] = p.x; z[i] = p.z; s[i] = c.s[i]; });
  const r: Reach = {
    id: 0, key: c.id, n, x, z, s, area: f(0), hw: f(c.width / 2), depth: f(c.depth), surf: Float32Array.from(c.level), speed: f(0),
    cls: new Uint8Array(n).fill(CLASS_CODE.canal), sub: new Uint8Array(n), bank: 1.5, reach: f(0), up: [], down: -1, mouth: 'edge',
  };
  for (let i = 0; i < n; i++) {
    let need = 0;
    for (const o of [c.width / 2 + 2, c.width / 2 + 6]) for (const sd of [-1, 1]) {
      const a = c.path[Math.max(0, i - 1)], b = c.path[Math.min(n - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      need = Math.max(need, ground.heightAt(x[i] - ((b.z - a.z) / l) * o * sd, z[i] + ((b.x - a.x) / l) * o * sd) - c.level[i]);
    }
    r.reach[i] = c.width / 2 + SPILL + Math.min(BANK_HEIGHT, need + 1) / r.bank;
  }
  return r;
}

// ---------- ports and quays ----------
export interface Quay {
  id: string; a: XZ; b: XZ; length: number;
  depth: number; // the shallowest depth alongside, `reach` metres out
  facing: [number, number]; // unit vector from the land out over the water
  land: number; // metres of level land behind it
  kind: WaterKind; body: string;
}
// A port is quays on one body of water, plus what the game adds later (cranes, stores, a berth plan).
export interface Port { id: string; body: string; kind: WaterKind; quays: Quay[]; berths: { at: XZ; length: number; depth: number }[] }
export interface QuayOpts { minDepth?: number; reach?: number; minLength?: number; maxSlope?: number; landDepth?: number; step?: number }

// Where a quay could go in a box: dry points at the waterline with at least minDepth of water
// `reach` metres out and land no steeper than maxSlope for landDepth metres behind, chained along
// the shore into runs at least minLength long.
export function findQuays(w: WaterSystem, box: [number, number, number, number], o: QuayOpts = {}): Quay[] {
  const minDepth = o.minDepth ?? 4, reach = o.reach ?? 20, minLength = o.minLength ?? 60, maxSlope = o.maxSlope ?? 0.06, landDepth = o.landDepth ?? 50, step = o.step ?? 8;
  const g = w.terrain;
  type C = { x: number; z: number; nx: number; nz: number; depth: number; kind: WaterKind; body: string };
  const cand: C[] = [];
  for (let z = box[1]; z <= box[3]; z += step) for (let x = box[0]; x <= box[2]; x += step) {
    const d = w.distanceToShore(x, z);
    if (d > 0 || d < -step) continue;
    // the way to the water: up the signed distance
    const e = 3, gx = w.distanceToShore(x + e, z) - w.distanceToShore(x - e, z), gz = w.distanceToShore(x, z + e) - w.distanceToShore(x, z - e), gl = Math.hypot(gx, gz);
    if (gl < 1e-6) continue;
    const nx = gx / gl, nz = gz / gl, out = w.probe(x + nx * (reach - d), z + nz * (reach - d));
    if (out.level === null || out.level - out.ground < minDepth || !out.kind) continue;
    if (out.kind === 'river' || out.kind === 'canal') { const wc = w.watercourseAt(out.hit ? x + nx * (reach - d) : x, z + nz * (reach - d)); if (!wc || wc.draught === 0) continue; }
    // level land behind
    const h0 = g.heightAt(x, z), h1 = g.heightAt(x - nx * landDepth, z - nz * landDepth), h2 = g.heightAt(x - nx * landDepth * 0.5, z - nz * landDepth * 0.5);
    if (Math.max(Math.abs(h1 - h0), Math.abs(h2 - h0) * 2) / landDepth > maxSlope) continue;
    if (w.isWater(x - nx * landDepth, z - nz * landDepth)) continue;
    cand.push({ x, z, nx, nz, depth: out.level - out.ground, kind: out.kind, body: out.body ?? '' });
  }
  // chain neighbours facing the same way into runs
  const used = new Uint8Array(cand.length), quays: Quay[] = [];
  for (let i = 0; i < cand.length; i++) {
    if (used[i]) continue;
    const run = [i];
    used[i] = 1;
    for (let q = 0; q < run.length; q++) {
      const a = cand[run[q]];
      for (let j = 0; j < cand.length; j++) if (!used[j]) {
        const b = cand[j];
        if (b.body === a.body && Math.hypot(b.x - a.x, b.z - a.z) <= step * 1.5 && a.nx * b.nx + a.nz * b.nz > 0.8) { used[j] = 1; run.push(j); }
      }
    }
    if (run.length < 2) continue;
    // its ends: the two members farthest apart along the shore (across the mean facing)
    const fx = run.reduce((s, k) => s + cand[k].nx, 0), fz = run.reduce((s, k) => s + cand[k].nz, 0), fl = Math.hypot(fx, fz) || 1, tx = -fz / fl, tz = fx / fl;
    let lo = run[0], hi = run[0];
    for (const k of run) { const p = cand[k].x * tx + cand[k].z * tz; if (p < cand[lo].x * tx + cand[lo].z * tz) lo = k; if (p > cand[hi].x * tx + cand[hi].z * tz) hi = k; }
    const A = cand[lo], B = cand[hi], length = Math.hypot(B.x - A.x, B.z - A.z);
    if (length < minLength) continue;
    quays.push({ id: `quay:${Math.round(A.x)},${Math.round(A.z)}`, a: { x: A.x, z: A.z }, b: { x: B.x, z: B.z }, length, depth: Math.min(...run.map((k) => cand[k].depth)), facing: [fx / fl, fz / fl], land: landDepth, kind: A.kind, body: A.body });
  }
  return quays.sort((p, q) => q.length * q.depth - p.length * p.depth);
}

// ---------- ferry and ship routes ----------
export interface NavGrid { g: GridSpec; ok: Uint8Array; depth: Float32Array; draught: number }
export interface Route { ok: boolean; path: XZ[]; length: number; reason?: string }
export interface FerryRoute { id: string; from: XZ; to: XZ; route: Route; draught: number }

// Water a boat of this draught can use: deep enough (with a margin under the keel), and not
// within `clear` metres of the shore.
export function navGrid(w: WaterSystem, box: [number, number, number, number], o: { cell?: number; draught?: number; keel?: number; clear?: number } = {}): NavGrid {
  const cell = o.cell ?? 10, draught = o.draught ?? NAV.navigable.draught, keel = o.keel ?? 0.5, clear = o.clear ?? cell;
  const nx = Math.floor((box[2] - box[0]) / cell) + 1, nz = Math.floor((box[3] - box[1]) / cell) + 1, g: GridSpec = { x0: box[0], z0: box[1], step: cell, nx, nz };
  const ok = new Uint8Array(nx * nz), depth = new Float32Array(nx * nz);
  for (let j = 0, k = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
    const x = box[0] + i * cell, z = box[1] + j * cell, p = w.probe(x, z);
    depth[k] = p.level === null ? 0 : p.level - p.ground;
    ok[k] = depth[k] >= draught + keel && w.distanceToShore(x, z) >= clear ? 1 : 0;
  }
  return { g, ok, depth, draught };
}
// Shortest way between two points over navigable water (A* on the grid, 8 neighbours), then pulled
// straight wherever the water between allows.
export function shipRoute(nav: NavGrid, a: XZ, b: XZ): Route {
  const { g, ok } = nav, N = g.nx * g.nz;
  const idx = (p: XZ) => { const i = Math.round((p.x - g.x0) / g.step), j = Math.round((p.z - g.z0) / g.step); return i < 0 || j < 0 || i >= g.nx || j >= g.nz ? -1 : j * g.nx + i; };
  const s = idx(a), t = idx(b);
  if (s < 0 || t < 0 || !ok[s] || !ok[t]) return { ok: false, path: [], length: 0, reason: 'An end is not on navigable water' };
  const cost = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const ti = t % g.nx, tj = (t - ti) / g.nx, hx = (k: number) => { const i = k % g.nx, j = (k - i) / g.nx; return Math.hypot(i - ti, j - tj); };
  // a small binary heap on (cost + heuristic)
  const hk: number[] = [], hv: number[] = [];
  const push = (key: number, v: number) => { hk.push(key); hv.push(v); let i = hk.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= hk[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const v = hv[0], lk = hk.pop()!, lv = hv.pop()!; if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hk.length && hk[l] < hk[m]) m = l; if (r < hk.length && hk[r] < hk[m]) m = r; if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return v; };
  cost[s] = 0; push(hx(s), s);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (hk.length) {
    const c = pop();
    if (done[c]) continue;
    done[c] = 1;
    if (c === t) break;
    const ci = c % g.nx, cj = (c - ci) / g.nx;
    for (const [di, dj, dc] of D) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) continue;
      const n = j * g.nx + i;
      // no cutting corners across land
      if (!ok[n] || (di && dj && (!ok[cj * g.nx + i] || !ok[j * g.nx + ci]))) continue;
      const nc = cost[c] + dc;
      if (nc < cost[n]) { cost[n] = nc; from[n] = c; push(nc + hx(n), n); }
    }
  }
  if (!done[t]) return { ok: false, path: [], length: 0, reason: 'No way through on water deep enough' };
  const cells: number[] = [];
  for (let c = t; c >= 0; c = from[c]) cells.push(c);
  cells.reverse();
  const at = (k: number): XZ => ({ x: g.x0 + (k % g.nx) * g.step, z: g.z0 + Math.floor(k / g.nx) * g.step });
  // pull straight: skip ahead to the farthest cell in clear sight over navigable water
  const clearLine = (p: XZ, q: XZ) => { const L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.ceil(L / (g.step * 0.5)); for (let k = 1; k < n; k++) { const m = idx({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n }); if (m < 0 || !ok[m]) return false; } return true; };
  const path: XZ[] = [a];
  let cur = a, q = 0;
  while (q < cells.length - 1) {
    let best = q + 1;
    for (let k = cells.length - 1; k > q + 1; k--) if (clearLine(cur, at(cells[k]))) { best = k; break; }
    cur = best === cells.length - 1 ? b : at(cells[best]);
    path.push(cur); q = best;
  }
  if (path[path.length - 1] !== b) path.push(b);
  let length = 0;
  for (let k = 1; k < path.length; k++) length += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
  return { ok: true, path, length };
}

// ---------- bridges ----------
// Height windows for a road or railway crossing water, for the height solver (grade.ts's Limit,
// absolute heights; s along the same line the crossings were measured on). Over the navigation
// channel the deck must clear the class's headroom above the design level; over the rest of the
// water it must at least clear the design level (floods) by `freeboard`. `deck` is the depth of
// the structure from the running surface down to its soffit.
export function navLimits(cs: Crossing[], deck = 1.5, freeboard = 0.6): Limit[] {
  const out: Limit[] = [];
  for (const c of cs) {
    const what = c.cls ? NAV[c.cls].label : c.kind;
    out.push({ s0: c.s0, s1: c.s1, lo: c.design + freeboard + deck, why: `the ${what}'s flood level` });
    if (c.channel) out.push({ s0: c.channel[0], s1: c.channel[1], lo: c.soffit + deck, why: `${c.clearance} m headroom over the ${what}'s navigation channel` });
  }
  return out;
}
// Stretches along the line where a bridge may not put a pier (the navigation channels).
export const pierBans = (cs: Crossing[]): [number, number][] => cs.filter((c) => c.channel).map((c) => c.channel!);
