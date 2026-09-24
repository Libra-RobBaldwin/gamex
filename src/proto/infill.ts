// Leftover land. Plots are rectangles along roads, so corners, the insides of curves and the odd
// gaps between blocks are left over. Real towns fill those: a church or a pub on the corner, a
// petrol station on the way out, allotments behind houses, a playground, a pocket park, a car
// park, a planted verge. This finds the gaps on a 5 m grid and decides what each becomes.
import { CIVIC } from './buildgen';
import type { RegionKind } from './buildgen';
import { closestOnPath, closestOnSeg, pathLength, rng, type Lot, type Network, type P, type RSeg } from './roads';

export const CELL = 5;
export interface Region { id: string; cells: P[]; kind: RegionKind; seed: number; roadEdges: [number, number, number, number][]; centre: P }

const FREE = 0, LOT = 1, ROAD = 2, WATER = 3;

// a cell is taken if any part of it (not just its centre) is on claimed land
const landNear = (net: Network, p: P) => { const h = CELL * 0.45; return !net.land.free([{ x: p.x - h, z: p.z - h }, { x: p.x + h, z: p.z - h }, { x: p.x + h, z: p.z + h }, { x: p.x - h, z: p.z + h }]); };

// pointAt for arc lengths that only go up (carrying on from where it got to), and which piece it's on
function walker(path: P[]) {
  let i = 1, before = 0;
  return (s: number) => {
    for (;;) {
      const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (s - before <= L || i === path.length - 1) {
        const t = L ? Math.max(0, Math.min(1, (s - before) / L)) : 0;
        return { i, q: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t, ux: (b.x - a.x) / (L || 1), uz: (b.z - a.z) / (L || 1) } };
      }
      before += L; i++;
    }
  };
}

// `within`: look only at this box (a big map, after an edit there). Gaps that run off its edge are
// left out (their boxes are in `cut`, so the caller can look again over a bigger box); every gap
// found is exactly what looking at the whole map would find.
export interface Box { x0: number; z0: number; x1: number; z1: number }
export function findRegions(net: Network, pending: Lot[], within?: Box) {
  const all = [...net.lots, ...pending];
  const cut: Box[] = [];
  if (!all.length) return { regions: [] as Region[], civics: [] as Lot[], cut };
  // grid over the built-up area, aligned to world multiples of CELL
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  if (within) ({ x0, z0, x1, z1 } = { x0: within.x0 + 30, z0: within.z0 + 30, x1: within.x1 - 30, z1: within.z1 - 30 });
  else for (const l of all) { const c = net.parcelCentre(l), r = net.parcelR(l); x0 = Math.min(x0, c.x - r); z0 = Math.min(z0, c.z - r); x1 = Math.max(x1, c.x + r); z1 = Math.max(z1, c.z + r); }
  x0 = Math.floor((x0 - 30) / CELL) * CELL; z0 = Math.floor((z0 - 30) / CELL) * CELL;
  const nx = Math.ceil((x1 + 30 - x0) / CELL), nz = Math.ceil((z1 + 30 - z0) / CELL);
  const occ = new Uint8Array(nx * nz), nearRoad = new Uint8Array(nx * nz), nearLot = new Uint8Array(nx * nz);
  const cx = (i: number) => x0 + (i + 0.5) * CELL, cz = (j: number) => z0 + (j + 0.5) * CELL;
  const range = (a: number, b: number, o: number, n: number) => [Math.max(0, Math.floor((a - o) / CELL)), Math.min(n - 1, Math.floor((b - o) / CELL))];

  // plots (and a band around them: land near buildings is urban land)
  const inPlot = (l: Lot, x: number, z: number, pad: number) => {
    const c = net.parcelCentre(l), co = Math.cos(l.rot), si = Math.sin(l.rot), dx = x - c.x, dz = z - c.z;
    return Math.abs(dx * co + dz * si) < l.pw / 2 + pad && Math.abs(-dx * si + dz * co) < (l.d + l.front + l.back) / 2 + pad;
  };
  for (const l of all) {
    const c = net.parcelCentre(l), r = net.parcelR(l) + 20;
    const [i0, i1] = range(c.x - r, c.x + r, x0, nx), [j0, j1] = range(c.z - r, c.z + r, z0, nz);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const x = cx(i), z = cz(j);
      if (inPlot(l, x, z, 0.5)) occ[i + j * nx] = LOT;
      if (inPlot(l, x, z, 18)) nearLot[i + j * nx] = 1;
    }
  }
  // roads, and whether land is close enough to one to be part of town
  for (const s of net.segs.values()) {
    const p = net.path(s), half = net.half(s);
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1], b = p[k], m = 40;
      const [i0, i1] = range(Math.min(a.x, b.x) - m, Math.max(a.x, b.x) + m, x0, nx), [j0, j1] = range(Math.min(a.z, b.z) - m, Math.max(a.z, b.z) + m, z0, nz);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const d = closestOnSeg({ x: cx(i), z: cz(j) }, a, b).d;
        if (d < 40) nearRoad[i + j * nx] = 1;
        if (d < half + CELL * 0.35 && ((a.y ?? 0) < 3 || (b.y ?? 0) < 3)) occ[i + j * nx] = ROAD;
      }
    }
  }
  // Water, and anything the land registry says is taken (junctions, slip roads, islands, road
  // corridors). Only cells a gap could use, or that border one, are ever asked about, so each is
  // worked out the first time it's needed: on a big map most of the grid is open country, and
  // asking the registry about every cell of it cost seconds.
  const known = new Uint8Array(nx * nz);
  const at = (k: number) => {
    if (!known[k]) {
      known[k] = 1;
      const p = { x: cx(k % nx), z: cz(Math.floor(k / nx)) };
      if (net.isWater(p)) occ[k] = WATER;
      else if (occ[k] === FREE && landNear(net, p)) occ[k] = ROAD;
    }
    return occ[k];
  };

  // For placing community buildings: the frontage roads and the plots near a point, from grids made
  // the first time they're needed (asking every road and plot on a big map, for each spot tried, cost
  // seconds). They answer as Network.nearestSeg and lotFree do: the same roads, in the same order.
  const G = 60, gk = (i: number, j: number) => `${i},${j}`;
  let segGrid: Map<string, RSeg[]> | null = null, lotGrid: Map<string, Lot[]> | null = null;
  const nearestFrontage = (p: P, max: number) => {
    if (!segGrid) {
      segGrid = new Map();
      for (const s of net.segs.values()) {
        if (!net.def(s).frontage) continue;
        const path = net.path(s);
        const bx0 = Math.min(...path.map((q) => q.x)) - max, bx1 = Math.max(...path.map((q) => q.x)) + max, bz0 = Math.min(...path.map((q) => q.z)) - max, bz1 = Math.max(...path.map((q) => q.z)) + max;
        for (let i = Math.floor(bx0 / G); i <= Math.floor(bx1 / G); i++) for (let j = Math.floor(bz0 / G); j <= Math.floor(bz1 / G); j++) { const k = gk(i, j), a = segGrid.get(k); if (a) a.push(s); else segGrid.set(k, [s]); }
      }
    }
    let best: { seg: RSeg; x: number; z: number; s: number; ux: number; uz: number } | null = null, bd = max;
    for (const s of segGrid.get(gk(Math.floor(p.x / G), Math.floor(p.z / G))) ?? []) {
      const c = closestOnPath(p, net.path(s));
      if (c.d < bd) { bd = c.d; best = { seg: s, x: c.x, z: c.z, s: c.s, ux: c.ux, uz: c.uz }; }
    }
    return best;
  };
  const lotFree = (l: Lot) => {
    if (!lotGrid) {
      lotGrid = new Map();
      for (const o of net.lots) {
        const c = net.parcelCentre(o), r = net.parcelR(o);
        for (let i = Math.floor((c.x - r) / G); i <= Math.floor((c.x + r) / G); i++) for (let j = Math.floor((c.z - r) / G); j <= Math.floor((c.z + r) / G); j++) { const k = gk(i, j), a = lotGrid.get(k); if (a) a.push(o); else lotGrid.set(k, [o]); }
      }
    }
    const r = Math.hypot(l.w + 1, l.d + 1) / 2, near = new Set<Lot>();
    for (let i = Math.floor((l.x - r) / G); i <= Math.floor((l.x + r) / G); i++) for (let j = Math.floor((l.z - r) / G); j <= Math.floor((l.z + r) / G); j++) for (const o of lotGrid.get(gk(i, j)) ?? []) near.add(o);
    return net.lotFree(l, [], near);
  };

  // gaps: connected free cells that are near both a road and buildings
  const seen = new Uint8Array(nx * nz);
  const regions: Region[] = [], civics: Lot[] = [];
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && nearRoad[i + j * nx] && nearLot[i + j * nx] && at(i + j * nx) === FREE;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (seen[i + j * nx] || !ok(i, j)) continue;
    const comp: [number, number][] = [], stack: [number, number][] = [[i, j]];
    seen[i + j * nx] = 1;
    while (stack.length) {
      const [a, b] = stack.pop()!;
      comp.push([a, b]);
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = a + da, v = b + db;
        if (ok(u, v) && !seen[u + v * nx]) { seen[u + v * nx] = 1; stack.push([u, v]); }
      }
    }
    if (within && comp.some(([a, b]) => a === 0 || b === 0 || a === nx - 1 || b === nz - 1)) {
      cut.push({ x0: x0 + Math.min(...comp.map((c) => c[0])) * CELL, z0: z0 + Math.min(...comp.map((c) => c[1])) * CELL, x1: x0 + (Math.max(...comp.map((c) => c[0])) + 1) * CELL, z1: z0 + (Math.max(...comp.map((c) => c[1])) + 1) * CELL });
      continue;
    }
    let cells = comp;
    // railings along the back of the road's footway where it borders this gap, following the road
    // itself (not the 5 m grid), and stopping where a junction's corner takes over
    const roadEdges = (list: [number, number][]) => {
      const out: [number, number, number, number][] = [];
      const set = new Set(list.map(([a, b]) => a + b * nx));
      const inside = (x: number, z: number) => { const a = Math.floor((x - x0) / CELL), b = Math.floor((z - z0) / CELL); return a >= 0 && b >= 0 && a < nx && b < nz && set.has(a + b * nx); };
      const bx = list.map(([a]) => cx(a)), bz = list.map(([, b]) => cz(b));
      const lo = { x: Math.min(...bx) - 30, z: Math.min(...bz) - 30 }, hi = { x: Math.max(...bx) + 30, z: Math.max(...bz) + 30 };
      for (const s of net.segs.values()) {
        const p = net.path(s);
        if (p.every((q) => q.x < lo.x) || p.every((q) => q.x > hi.x) || p.every((q) => q.z < lo.z) || p.every((q) => q.z > hi.z)) continue;
        if (net.def(s).cls !== 'road') continue;
        const L = pathLength(p), back = net.half(s) + 0.3;
        // (only the road's pieces near the gap can border it: a long road across the map is walked
        // piece by piece, and the ones far off skipped)
        const near = p.map((q, k) => k > 0 && Math.max(q.x, p[k - 1].x) >= lo.x && Math.min(q.x, p[k - 1].x) <= hi.x && Math.max(q.z, p[k - 1].z) >= lo.z && Math.min(q.z, p[k - 1].z) <= hi.z);
        if (!near.some(Boolean)) continue;
        for (const side of [1, -1]) {
          let prev: P | null = null;
          const walk = walker(p);
          for (let t = 0; t <= L; t += 1.5) {
            const w = walk(t);
            if (!near[w.i]) { prev = null; continue; }
            const q = w.q, nxv = q.uz * side, nzv = -q.ux * side;
            const at = { x: q.x + nxv * back, z: q.z + nzv * back };
            const ok = Math.abs(q.y) < 1 && inside(q.x + nxv * (back + 2.5), q.z + nzv * (back + 2.5)) && !net.land.at({ x: q.x + nxv * (back + 0.3), z: q.z + nzv * (back + 0.3) });
            if (ok && prev) out.push([prev.x, prev.z, at.x, at.z]);
            prev = ok ? at : null;
          }
        }
      }
      return out;
    };
    const touching = cells.filter(([a, b]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([da, db]) => occ[a + da + (b + db) * nx] !== undefined && at(a + da + (b + db) * nx) === ROAD));
    const mid = { x: cells.reduce((t, c) => t + cx(c[0]), 0) / cells.length, z: cells.reduce((t, c) => t + cz(c[1]), 0) / cells.length };
    const industrial = net.zoneAt(mid) === 'industrial';
    const fromCentre = Math.hypot(mid.x, mid.z);
    const n = cells.length;
    // decisions are seeded by where the gap is, so a park stays a park when the town is re-checked
    const id = `${comp[0][0] + Math.round(x0 / CELL)},${comp[0][1] + Math.round(z0 / CELL)}`;
    let h = 2166136261;
    for (let q = 0; q < id.length; q++) h = Math.imul(h ^ id.charCodeAt(q), 16777619);
    const rand = rng(h >>> 0);
    const r = rand();

    // try a community building that fits, facing the road
    let civic: Lot | null = null;
    if (!industrial && touching.length && n >= 6) {
      const options = n > 40 ? ['church', 'school', 'pub', 'petrol', 'surgery'] : n > 16 ? ['pub', 'surgery', 'hall', 'petrol', 'cornershop'] : (r < 0.15 ? ['substation'] : ['cornershop', 'hall']);
      const want = options.filter((o) => o !== 'petrol' || fromCentre > 110).sort(() => rand() - 0.5);
      const set = new Set(cells.map(([a, b]) => a + b * nx));
      const inside = (x: number, z: number) => { const a = Math.floor((x - x0) / CELL), b = Math.floor((z - z0) / CELL); return set.has(a + b * nx); };
      if (r < (n > 40 ? 0.75 : 0.55))
        for (const arch of want) {
          const spec = CIVIC[arch];
          for (const [a, b] of touching.slice().sort(() => rand() - 0.5).slice(0, 10)) {
            const p = { x: cx(a), z: cz(b) };
            const q = nearestFrontage(p, 30);
            if (!q) continue;
            const half = net.half(q.seg);
            const side = (p.x - q.x) * -q.uz + (p.z - q.z) * q.ux > 0 ? 1 : -1;
            const off = half + spec.front + spec.d / 2;
            const lot: Lot = {
              id: net.nextId++, x: q.x - q.uz * off * side, z: q.z + q.ux * off * side, rot: Math.atan2(q.uz, q.ux) + (side === 1 ? Math.PI : 0),
              w: spec.w, d: spec.d, h: 8, kind: 'civic', seg: q.seg.id, seed: rand(), row: 0, front: spec.front, back: spec.back, px: 0, pw: spec.w + 2, arch,
            };
            // the whole plot has to sit on the gap (a little slack at the road edge)
            const c = net.parcelCentre(lot), co = Math.cos(lot.rot), si = Math.sin(lot.rot), D = lot.d + lot.front + lot.back;
            let fits = lotFree(lot);
            for (let u = -lot.pw / 2 + 1; fits && u <= lot.pw / 2 - 1; u += 2)
              for (let v = -D / 2 + 1; fits && v <= D / 2 - 2; v += 2) if (!inside(c.x + u * co - v * si, c.z + u * si + v * co)) fits = false;
            if (fits) { civic = lot; break; }
          }
          if (civic) break;
        }
    }
    if (civic) {
      civics.push(civic);
      cells = cells.filter(([a, b]) => !inPlot(civic!, cx(a), cz(b), 0.5));
      if (!cells.length) continue;
    }
    const kind: RegionKind = civic ? 'grounds'
      : industrial ? 'scrub'
      : n <= 3 ? 'verge'
      : n <= 10 ? (touching.length && n >= 6 && fromCentre < 160 && r < 0.35 ? 'carpark' : r < 0.6 ? 'pocket' : touching.length ? 'verge' : 'allotments')
      : n <= 40 ? (r < 0.35 ? 'playground' : r < 0.6 && !touching.length ? 'allotments' : r < 0.75 && touching.length && fromCentre < 140 ? 'carpark' : 'pocket')
      : r < 0.2 ? 'allotments' : 'park';
    regions.push({
      id,
      cells: cells.map(([a, b]) => ({ x: cx(a), z: cz(b) })), kind, seed: rand(), roadEdges: roadEdges(cells), centre: mid,
    });
  }
  return { regions, civics, cut };
}
