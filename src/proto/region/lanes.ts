// Country roads that wind as English lanes do: round the hills along the contours, beside the
// streams, skirting the woods and the villages they don't serve, crossing water square on, and
// wandering a little where nothing makes them (old field boundaries, a long-gone obstacle).
//
//   laneRoute(a, b, ctx, { minR: 80 })  // a smooth polyline from a to b, every 8 m
//
// How: a cheapest path over a 40 m grid in a corridor round the straight line, each step costing
// its length times how unwelcome the ground is (steep, wet, wooded, built up, alongside a big
// road, and a slow noise so it wanders); then smoothed until no bend is tighter than the road
// allows. Deterministic from the seed and the two ends, and it looks only at the corridor, so a
// route can be made on its own, in any order, a tile at a time (no whole-map pass). Flat ground
// with nothing on it still gives a gently winding lane.
// Pure: no three.js, no DOM.
import { mix } from './random';
import { woodiness } from './woods';
import { COUNTRYSIDE } from './countryside';

export interface XZ { x: number; z: number }
export interface LaneContext {
  seed: number;
  heightAt?: (x: number, z: number) => number;
  waterDist?: (x: number, z: number) => number; // metres to the water's edge (negative in it)
  settlements?: { x: number; z: number; reach: number }[]; // built-up land to go round (not the ends' own)
  roads?: XZ[][]; // big roads (motorways, A roads) not to run alongside
}

function noise(seed: number) {
  const h = (i: number, j: number) => (mix(seed, i, j) & 0xffff) / 0xffff;
  return (x: number, z: number, scale: number) => {
    const gx = x / scale, gz = z / scale, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}
const segDist = (x: number, z: number, a: XZ, b: XZ) => {
  const ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez, t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L)) : 0;
  return Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
};
// the tightest bend of a polyline (the circle through each three points in a row), as roads.ts measures it
export function tightest(p: XZ[]) {
  let r = Infinity;
  for (let i = 1; i + 1 < p.length; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1], A = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (A < 1e-9) continue;
    r = Math.min(r, (Math.hypot(b.x - a.x, b.z - a.z) * Math.hypot(c.x - b.x, c.z - b.z) * Math.hypot(c.x - a.x, c.z - a.z)) / (2 * A));
  }
  return r;
}
function resample(p: XZ[], step: number): XZ[] {
  const out: XZ[] = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    while (t < L) { out.push({ x: a.x + (b.x - a.x) * t / L, z: a.z + (b.z - a.z) * t / L }); t += step; }
    carry = L - (t - step);
  }
  const last = p[p.length - 1], e = out[out.length - 1];
  if (Math.hypot(last.x - e.x, last.z - e.z) < step * 0.5) out[out.length - 1] = last; else out.push(last);
  return out;
}

// The winding route from a to b (a and b themselves included), or the straight line if that's all there is room for.
export function laneRoute(a: XZ, b: XZ, ctx: LaneContext, o: { minR: number; step?: number }): XZ[] {
  const P = COUNTRYSIDE.lanes, D = Math.hypot(b.x - a.x, b.z - a.z), G = P.grid;
  if (D < G * 3) return [a, b];
  // the corridor: a grid in the frame of the straight line, reaching out either side
  const ux = (b.x - a.x) / D, uz = (b.z - a.z) / D, vx = -uz, vz = ux;
  const wide = Math.max(P.corridor.least, D * P.corridor.share);
  const nu = Math.ceil(D / G) + 1, nv = 2 * Math.ceil(wide / G) + 1, mid = (nv - 1) / 2;
  const at = (i: number, j: number): XZ => ({ x: a.x + ux * i * (D / (nu - 1)) + vx * (j - mid) * G, z: a.z + uz * i * (D / (nu - 1)) + vz * (j - mid) * G });
  const nz = noise(mix(ctx.seed, 91, Math.round(a.x + b.x), Math.round(a.z + b.z))), wood = woodiness(ctx.seed), H = ctx.heightAt, W = ctx.waterDist;
  const towns = (ctx.settlements ?? []).filter((s) => Math.hypot(s.x - a.x, s.z - a.z) > s.reach + 60 && Math.hypot(s.x - b.x, s.z - b.z) > s.reach + 60 && segDist(s.x, s.z, a, b) < s.reach + wide);
  const big: [XZ, XZ][] = [];
  for (const r of ctx.roads ?? []) for (let k = 1; k < r.length; k++) if (Math.min(segDist(r[k].x, r[k].z, a, b), segDist(r[k - 1].x, r[k - 1].z, a, b)) < wide + 200) big.push([r[k - 1], r[k]]);
  // how unwelcome each grid point is (1 = open, level farmland)
  const N = nu * nv, cost = new Float32Array(N), hgt = new Float32Array(N);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const p = at(i, j), k = i * nv + j;
    hgt[k] = H ? H(p.x, p.z) : 0;
    let c = 1 + P.wander * (nz(p.x, p.z, P.wanderScale) - 0.5) * 2;
    if (W) { const w = W(p.x, p.z); if (w < 8) c += P.water; else if (w > 30 && w < 130) c -= P.stream; }
    if (wood(p.x, p.z) > COUNTRYSIDE.woods.clump.above) c += P.wood;
    for (const s of towns) if (Math.hypot(p.x - s.x, p.z - s.z) < s.reach) { c += P.town; break; }
    const nearEnd = Math.min(Math.hypot(p.x - a.x, p.z - a.z), Math.hypot(p.x - b.x, p.z - b.z)) < 120;
    if (!nearEnd) for (const [q, r] of big) if (segDist(p.x, p.z, q, r) < 30) { c += P.bigRoad; break; }
    cost[k] = Math.max(0.3, c);
  }
  // cheapest path (Dijkstra with a straight-line guess: A*), eight ways from each point
  const best = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const start = mid | 0, goal = (nu - 1) * nv + (mid | 0), heap: number[] = [], key: number[] = [];
  const push = (k: number, f: number) => { heap.push(k); key.push(f); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (key[p] <= key[c]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; [key[p], key[c]] = [key[c], key[p]]; c = p; } };
  const pop = () => { const top = heap[0], lk = key.pop()!, lh = heap.pop()!; if (heap.length) { heap[0] = lh; key[0] = lk; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && key[l] < key[m]) m = l; if (r < heap.length && key[r] < key[m]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; [key[m], key[c]] = [key[c], key[m]]; c = m; } } return top; };
  const du = D / (nu - 1), guess = (k: number) => (nu - 1 - Math.floor(k / nv)) * du * 0.55;
  best[start] = 0; push(start, guess(start));
  while (heap.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const i = Math.floor(k / nv), j = k % nv;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nu || jj >= nv) continue;
      const q = ii * nv + jj, len = Math.hypot(di * du, dj * G), grade = Math.abs(hgt[q] - hgt[k]) / len;
      const step = len * (cost[k] + cost[q]) / 2 * (1 + P.climb * grade * grade * 100);
      if (best[k] + step < best[q]) { best[q] = best[k] + step; from[q] = k; push(q, best[q] + guess(q)); }
    }
  }
  if (from[goal] < 0) return [a, b];
  const cells: XZ[] = [];
  for (let k = goal; k >= 0; k = from[k]) cells.push(at(Math.floor(k / nv), k % nv));
  cells.reverse();
  cells[0] = a; cells[cells.length - 1] = b;
  // smoothed: corners cut, then relaxed till no bend is tighter than the road allows
  let p = cells;
  for (let it = 0; it < 3; it++) {
    const q: XZ[] = [p[0]];
    for (let k = 0; k + 1 < p.length; k++) { const s = p[k], t = p[k + 1]; q.push({ x: s.x * 0.75 + t.x * 0.25, z: s.z * 0.75 + t.z * 0.25 }, { x: s.x * 0.25 + t.x * 0.75, z: s.z * 0.25 + t.z * 0.75 }); }
    q.push(p[p.length - 1]);
    p = q;
  }
  const step = o.step ?? 8;
  p = resample(p, step);
  const R = o.minR * 1.15;
  for (let it = 0; it < 600 && tightest(p) < R; it++) {
    const q = p.map((x) => ({ ...x }));
    for (let k = 1; k + 1 < p.length; k++) { q[k].x = p[k].x * 0.5 + (p[k - 1].x + p[k + 1].x) * 0.25; q[k].z = p[k].z * 0.5 + (p[k - 1].z + p[k + 1].z) * 0.25; }
    p = q;
    if (it % 40 === 39) p = resample(p, step);
  }
  p = resample(p, step);
  return tightest(p) >= o.minR ? p : [a, b];
}

// The lanes a map has besides its A and B roads: each village to the nearest place it has no road
// to yet (and not too far), so the country between the main roads has its lanes too.
export function minorLinks(settlements: { id: number; x: number; z: number; kind: string }[], links: { a: number; b: number }[]): { a: number; b: number; road: 'lane' }[] {
  const M = COUNTRYSIDE.lanes.minor, has = new Set(links.map((l) => `${Math.min(l.a, l.b)}|${Math.max(l.a, l.b)}`)), out: { a: number; b: number; road: 'lane' }[] = [];
  for (const v of settlements) {
    if (v.kind !== 'village') continue;
    const others = settlements.filter((o) => o.id !== v.id && !has.has(`${Math.min(o.id, v.id)}|${Math.max(o.id, v.id)}`)).map((o) => ({ o, d: Math.hypot(o.x - v.x, o.z - v.z) })).filter((x) => x.d < M.reach).sort((p, q) => p.d - q.d);
    for (const { o } of others.slice(0, M.perVillage)) {
      has.add(`${Math.min(o.id, v.id)}|${Math.max(o.id, v.id)}`);
      out.push({ a: v.id, b: o.id, road: 'lane' });
    }
  }
  return out;
}
