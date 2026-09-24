// Where hedgerows go: along the edges between field parcels (and the town's edge), and along both
// sides of country roads and railways, never on a road, a plot, a park or in water, with a gap
// for a gateway in most of them and the odd hedgerow tree (oak, ash) standing out of the line.
// Plain numbers, no three.js (hedges.ts turns this into instanced meshes).
import { hash2 } from './noise';
import { Layout, toGrid, type Cell, type GroundInput, type XZ } from './layout';
import type { Spot } from './paint';

export interface Piece { x: number; z: number; a: number; len: number; h: number; w: number } // centre, angle, size
export interface HedgeTree { x: number; z: number; s: number; kind: number }
export interface HedgeGroup { key: string; pieces: Piece[]; trees: HedgeTree[]; gates: Spot[] }

const STEP = 4; // metres per hedge piece
const CLEAR = 2.2; // how far a hedge keeps from roads, plots, parks and water

// Is a point clear of everything a hedge mustn't touch? Polygons are bucketed on a 40 m grid.
export class Occupancy {
  private grid = new Map<number, XZ[][]>();
  private static C = 40;
  private key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  // (with `near`, only polygons within reach of those boxes are kept: enough for replanning there)
  constructor(input: GroundInput, near?: { x0: number; z0: number; x1: number; z1: number }[]) {
    const all = [...(input.blocked ?? []), ...(input.plots ?? []).map((p) => p.poly), ...(input.parks ?? []).map((p) => p.poly), ...(input.water ?? [])];
    for (const p of all) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; }
      if (near && !near.some((b) => x1 > b.x0 && x0 < b.x1 && z1 > b.z0 && z0 < b.z1)) continue;
      const C = Occupancy.C, r = CLEAR + 1;
      for (let i = Math.floor((x0 - r) / C); i <= Math.floor((x1 + r) / C); i++) for (let j = Math.floor((z0 - r) / C); j <= Math.floor((z1 + r) / C); j++) {
        const k = this.key(i, j);
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(p);
      }
    }
  }
  // clear by at least r metres?
  free(x: number, z: number, r = CLEAR) {
    const l = this.grid.get(this.key(Math.floor(x / Occupancy.C), Math.floor(z / Occupancy.C)));
    if (!l) return true;
    const r2 = r * r;
    for (const poly of l) {
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const p = poly[a], q = poly[b];
        if ((p.z > z) !== (q.z > z) && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) inside = !inside;
        const ex = q.x - p.x, ez = q.z - p.z, L = ex * ex + ez * ez;
        const s = L > 0 ? Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / L)) : 0;
        const dx = p.x + ex * s - x, dz = p.z + ez * s - z;
        if (dx * dx + dz * dz < r2) return false;
      }
      if (inside) return false;
    }
    return true;
  }
}

// Walk a line laying hedge pieces wherever `want` says and the ground is free; a gateway gap
// somewhere along it if it's long enough; a hedgerow tree now and then.
function walk(g: HedgeGroup, a: XZ, b: XZ, seed: number, occ: Occupancy, want: (x: number, z: number) => boolean, gate: boolean) {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < STEP) return;
  const n = Math.floor(L / STEP), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, ang = Math.atan2(uz, ux);
  const step = L / n;
  // one gap of two pieces (8 m, a field gate and its splay), not too near either end
  const gap = gate && n >= 10 && hash2(n, seed, 71) < 0.8 ? 2 + Math.floor(hash2(seed, n, 72) * (n - 5)) : -9;
  for (let k = 0; k < n; k++) {
    const x = a.x + ux * step * (k + 0.5), z = a.z + uz * step * (k + 0.5);
    if (k === gap || k === gap + 1) {
      if (k === gap) {
        const gx = x + ux * step * 0.5, gz = z + uz * step * 0.5;
        // worn earth where the stock and the tractors go through, on both sides
        g.gates.push({ x: gx - uz * 3, z: gz + ux * 3, r: 5, v: 0.75 }, { x: gx + uz * 3, z: gz - ux * 3, r: 5, v: 0.75 });
      }
      continue;
    }
    if (!want(x, z) || !occ.free(x, z)) continue;
    const r1 = hash2(k, seed, 73), r2 = hash2(k, seed, 74);
    // each piece a little longer than its step, so the line reads as continuous
    g.pieces.push({ x, z, a: ang + (r1 - 0.5) * 0.06, len: step + 0.9, h: 1.5 + r2 * 0.6, w: 1.4 + r1 * 0.5 });
    if (hash2(k, seed, 75) < 0.055 && occ.free(x, z, CLEAR + 2)) g.trees.push({ x: x + (r2 - 0.5) * 1.2, z: z + (r1 - 0.5) * 1.2, s: 0.95 + r2 * 0.5, kind: r1 < 0.15 ? 1 : 0 });
  }
}

// Every hedge group touching the box: one per pair of neighbouring parcels (keyed by the two
// cells), one per split line, one per side of each country lane.
export function planHedges(layout: Layout, box: { x0: number; z0: number; x1: number; z1: number }, occ: Occupancy, lanes = true): HedgeGroup[] {
  const out: HedgeGroup[] = [], P = layout.parcels;
  const corners = [toGrid(box.x0, box.z0), toGrid(box.x1, box.z0), toGrid(box.x0, box.z1), toGrid(box.x1, box.z1)];
  const i0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 1, i1 = Math.floor(Math.max(...corners.map((c) => c[0]))) + 1;
  const j0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 1, j1 = Math.floor(Math.max(...corners.map((c) => c[1]))) + 1;
  const hit = { id: 0, cell: P.cell(0, 0), edge: 0 };
  const kindAt = (x: number, z: number) => { P.hit(x, z, hit); return { id: hit.id, kind: layout.about(hit).kind }; };
  // The parcel of cell c at a point (which side of its split, if it has one), and what it is.
  const parcelOf = (c: Cell, x: number, z: number) => {
    let side = 0;
    if (c.split) { const [u, v] = toGrid(x, z); side = c.split.nu * u + c.split.nv * v - c.split.c > 0 ? 1 : 0; }
    hit.id = P.owner(c, side);
    return hit.id;
  };
  const kindOf = (id: number) => { hit.id = id; return layout.about(hit).kind; };
  // is there a boundary worth a hedge between cells c and o here (o on the −n side)?
  const boundary = (c: Cell, o: Cell, x: number, z: number, nx: number, nz: number) => {
    const a = parcelOf(c, x + nx * 1.5, z + nz * 1.5), b = parcelOf(o, x - nx * 1.5, z - nz * 1.5);
    if (a === b) return false;
    return !(kindOf(a) === 'town' && kindOf(b) === 'town');
  };
  const touches = (a: XZ, b: XZ) => Math.max(a.x, b.x) >= box.x0 && Math.min(a.x, b.x) <= box.x1 && Math.max(a.z, b.z) >= box.z0 && Math.min(a.z, b.z) <= box.z1;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const c = P.cell(i, j), { pts, across } = P.polygon(c);
    for (let e = 0; e < pts.length; e++) {
      const o = across[e];
      if (!o || o.i * 1e5 + o.j < c.i * 1e5 + c.j) continue; // each shared edge once
      const a = pts[e], b = pts[(e + 1) % pts.length];
      if (!touches(a, b)) continue;
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const g: HedgeGroup = { key: `e${c.i},${c.j}|${o.i},${o.j}`, pieces: [], trees: [], gates: [] };
      walk(g, a, b, (c.i * 7919 + c.j * 104729 + o.i * 31 + o.j + layout.seed * 613) | 0, occ, (x, z) => boundary(c, o, x, z, nx, nz), true);
      out.push(g);
    }
    if (c.split) {
      const sl = P.splitLine(c);
      if (!sl) continue;
      const [a, b] = sl;
      if (!touches(a, b)) continue;
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const g: HedgeGroup = { key: `s${c.i},${c.j}`, pieces: [], trees: [], gates: [] };
      walk(g, a, b, (c.i * 5 + c.j * 1009 + 17 + layout.seed * 613) | 0, occ, (x, z) => boundary(c, c, x, z, nx, nz), true);
      out.push(g);
    }
  }
  // country lanes: a hedge each side, just outside the verge, where the land beside isn't town
  if (lanes) (layout.input.lanes ?? []).forEach((ln, li) => {
    if (ln.hedge === false) return;
    for (const side of [1, -1]) {
      const g: HedgeGroup = { key: `l${li}:${side}`, pieces: [], trees: [], gates: [] };
      // (a lane is laid whole or not at all, so its group is the same however it's reached)
      if (!ln.path.some((p, s) => s > 0 && touches(ln.path[s - 1], p))) continue;
      for (let s = 1; s < ln.path.length; s++) {
        const p = ln.path[s - 1], q = ln.path[s], L = Math.hypot(q.x - p.x, q.z - p.z) || 1, nx = (-(q.z - p.z) / L) * side, nz = ((q.x - p.x) / L) * side;
        const off = ln.half + CLEAR + 0.3;
        const a = { x: p.x + nx * off, z: p.z + nz * off }, b = { x: q.x + nx * off, z: q.z + nz * off };
        walk(g, a, b, (li * 131 + s * 7 + side) | 0, occ, (x, z) => kindAt(x + nx * 2, z + nz * 2).kind !== 'town', false);
      }
      out.push(g);
    }
  });
  return out;
}
