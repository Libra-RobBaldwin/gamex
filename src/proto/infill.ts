// Leftover land. Plots are rectangles along roads, so corners, the insides of curves and the odd
// gaps between blocks are left over. Real towns fill those: a church or a pub on the corner, a
// petrol station on the way out, allotments behind houses, a playground, a pocket park, a car
// park, a planted verge. This finds the gaps on a 5 m grid and decides what each becomes.
import { CIVIC } from './buildgen';
import type { RegionKind } from './buildgen';
import { closestOnSeg, pathLength, pointAt, rng, type Lot, type Network, type P } from './roads';

export const CELL = 5;
export interface Region { id: string; cells: P[]; kind: RegionKind; seed: number; roadEdges: [number, number, number, number][]; centre: P }

const FREE = 0, LOT = 1, ROAD = 2, WATER = 3;

// a cell is taken if any part of it (not just its centre) is on claimed land
const landNear = (net: Network, p: P) => { const h = CELL * 0.45; return !net.land.free([{ x: p.x - h, z: p.z - h }, { x: p.x + h, z: p.z - h }, { x: p.x + h, z: p.z + h }, { x: p.x - h, z: p.z + h }]); };

// `civics: false` leaves out invented community buildings (a real town has its own).
export function findRegions(net: Network, pending: Lot[], opts: { civics?: boolean } = {}) {
  const all = [...net.lots, ...pending];
  if (!all.length) return { regions: [] as Region[], civics: [] as Lot[] };
  // grid over the built-up area, aligned to world multiples of CELL
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const l of all) { const c = net.parcelCentre(l), r = net.parcelR(l); x0 = Math.min(x0, c.x - r); z0 = Math.min(z0, c.z - r); x1 = Math.max(x1, c.x + r); z1 = Math.max(z1, c.z + r); }
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
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const p = { x: cx(i), z: cz(j) };
    if (net.isWater(p)) occ[i + j * nx] = WATER;
    // anything the land registry says is taken (junctions, slip roads, islands, road corridors)
    else if (occ[i + j * nx] === FREE && landNear(net, p)) occ[i + j * nx] = ROAD;
  }

  // each road's path and box, worked out once (every gap looks for the roads along its edge)
  const roads = [...net.segs.values()].filter((s) => net.def(s).cls === 'road').map((s) => {
    const p = net.path(s);
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const q of p) { bx0 = Math.min(bx0, q.x); bz0 = Math.min(bz0, q.z); bx1 = Math.max(bx1, q.x); bz1 = Math.max(bz1, q.z); }
    const L = pathLength(p), back = net.half(s) + 0.3;
    // the road's centreline every 1.5 m (sampled on first use)
    let at: ReturnType<typeof pointAt>[] | null = null;
    const samples = () => { if (!at) { at = []; for (let t = 0; t <= L; t += 1.5) at.push(pointAt(p, t)); } return at; };
    return { s, box: [bx0, bz0, bx1, bz1], back, samples };
  });
  // gaps: connected free cells that are near both a road and buildings
  const seen = new Uint8Array(nx * nz);
  const regions: Region[] = [], civics: Lot[] = [];
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && occ[i + j * nx] === FREE && nearRoad[i + j * nx] && nearLot[i + j * nx];
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
    let cells = comp;
    // railings along the back of the road's footway where it borders this gap, following the road
    // itself (not the 5 m grid), and stopping where a junction's corner takes over
    const roadEdges = (list: [number, number][]) => {
      const out: [number, number, number, number][] = [];
      const set = new Set(list.map(([a, b]) => a + b * nx));
      const inside = (x: number, z: number) => { const a = Math.floor((x - x0) / CELL), b = Math.floor((z - z0) / CELL); return a >= 0 && b >= 0 && a < nx && b < nz && set.has(a + b * nx); };
      const bx = list.map(([a]) => cx(a)), bz = list.map(([, b]) => cz(b));
      const lo = { x: Math.min(...bx) - 30, z: Math.min(...bz) - 30 }, hi = { x: Math.max(...bx) + 30, z: Math.max(...bz) + 30 };
      for (const { box, back, samples } of roads) {
        if (box[2] < lo.x || box[0] > hi.x || box[3] < lo.z || box[1] > hi.z) continue;
        for (const side of [1, -1]) {
          let prev: P | null = null;
          for (const q of samples()) {
            const nxv = q.uz * side, nzv = -q.ux * side;
            const at = { x: q.x + nxv * back, z: q.z + nzv * back };
            const ok = Math.abs(q.y) < 1 && inside(q.x + nxv * (back + 2.5), q.z + nzv * (back + 2.5)) && !net.land.at({ x: q.x + nxv * (back + 0.3), z: q.z + nzv * (back + 0.3) });
            if (ok && prev) out.push([prev.x, prev.z, at.x, at.z]);
            prev = ok ? at : null;
          }
        }
      }
      return out;
    };
    const touching = cells.filter(([a, b]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([da, db]) => occ[a + da + (b + db) * nx] === ROAD));
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
    if (opts.civics !== false && !industrial && touching.length && n >= 6) {
      const options = n > 40 ? ['church', 'school', 'pub', 'petrol', 'surgery'] : n > 16 ? ['pub', 'surgery', 'hall', 'petrol', 'cornershop'] : (r < 0.15 ? ['substation'] : ['cornershop', 'hall']);
      const want = options.filter((o) => o !== 'petrol' || fromCentre > 110).sort(() => rand() - 0.5);
      const set = new Set(cells.map(([a, b]) => a + b * nx));
      const inside = (x: number, z: number) => { const a = Math.floor((x - x0) / CELL), b = Math.floor((z - z0) / CELL); return set.has(a + b * nx); };
      if (r < (n > 40 ? 0.75 : 0.55))
        for (const arch of want) {
          const spec = CIVIC[arch];
          for (const [a, b] of touching.slice().sort(() => rand() - 0.5).slice(0, 10)) {
            const p = { x: cx(a), z: cz(b) };
            const q = net.nearestSeg(p, 30, (s) => net.def(s).frontage);
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
            let fits = net.lotFree(lot);
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
  return { regions, civics };
}
