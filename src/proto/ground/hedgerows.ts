// Where hedgerows go: along the edges between field parcels (and the town's edge), and along both
// sides of country roads and railways, never on a road, a plot, a park or in water, with a gap
// for a gateway in most of them and the odd hedgerow tree (oak, ash) standing out of the line.
// Plain numbers, no three.js (hedges.ts turns this into instanced meshes).
import { hash2, worldNoise } from './noise';
import { bbox, Layout, type GroundInput, type XZ } from './layout';
import type { Spot } from './paint';

export interface Piece { x: number; z: number; a: number; len: number; h: number; w: number } // centre, angle, size
export interface HedgeTree { x: number; z: number; s: number; kind: number }
export interface HedgeGroup { key: string; pieces: Piece[]; trees: HedgeTree[]; gates: Spot[] }

const STEP = 8; // metres per hedge piece
const CLEAR = 2.2; // how far a hedge keeps from roads, plots, parks and water

// Is a point clear of everything a hedge mustn't touch? Polygons are bucketed on a 40 m grid.
// The roads, parks and water part is kept while those arrays stay the same (plots change often).
const fixedOcc = new WeakMap<object, { parks: unknown; water: unknown; occ: Occupancy }>();
export class Occupancy {
  private grid = new Map<number, XZ[][]>();
  private static C = 40;
  private key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  private under: Occupancy | null = null;
  constructor(input: GroundInput | null) {
    if (!input) return; // (a bare one, for the fixed part)
    const blocked = input.blocked ?? [];
    let f = fixedOcc.get(blocked);
    if (!f || f.parks !== input.parks || f.water !== input.water) {
      f = { parks: input.parks, water: input.water, occ: new Occupancy(null) };
      f.occ.add([...blocked, ...(input.parks ?? []).map((p) => p.poly), ...(input.water ?? [])]);
      fixedOcc.set(blocked, f);
    }
    this.under = f.occ;
    this.add((input.plots ?? []).map((p) => p.poly));
  }
  private add(all: XZ[][]) {
    for (const p of all) {
      const { x0, z0, x1, z1 } = bbox(p);
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
  free(x: number, z: number, r = CLEAR): boolean {
    if (this.under && !this.under.free(x, z, r)) return false;
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
type Box = { x0: number; z0: number; x1: number; z1: number };
function walk(g: HedgeGroup, a: XZ, b: XZ, seed: number, occ: Occupancy, want: (x: number, z: number) => boolean, gate: boolean, clip: Box | null, hs: number, treeRate = 0.11) {
  const inClip = (x: number, z: number) => !clip || (x >= clip.x0 && x <= clip.x1 && z >= clip.z0 && z <= clip.z1);
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  if (L < STEP) return;
  const n = Math.floor(L / STEP), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, ang = Math.atan2(uz, ux);
  const step = L / n;
  // one gap of a piece (8 m, a field gate and its splay), not too near either end
  const gap = gate && n >= 5 && hash2(n, seed, 71) < 0.8 ? 1 + Math.floor(hash2(seed, n, 72) * (n - 2)) : -9;
  for (let k = 0; k < n; k++) {
    const x = a.x + ux * step * (k + 0.5), z = a.z + uz * step * (k + 0.5);
    // (a piece's ends reach half a step either way, so they must be clear too)
    const h = (step + 0.8) / 2, ex = ux * h, ez = uz * h;
    const ok = inClip(x - ex, z - ez) && inClip(x + ex, z + ez) && want(x, z) && occ.free(x, z) && occ.free(x - ex, z - ez, 1) && occ.free(x + ex, z + ez, 1);
    if (k === gap) {
      // worn earth where the stock and the tractors go through, on both sides
      if (ok) g.gates.push({ x: x - uz * 3, z: z + ux * 3, r: 5, v: 0.75 }, { x: x + uz * 3, z: z - ux * 3, r: 5, v: 0.75 });
      continue;
    }
    if (!ok) continue;
    const r1 = hash2(k, seed, 73), r2 = hash2(k, seed, 74);
    // each piece a little longer than its step, so the line reads as continuous; its height and
    // width wander slowly along the hedge (as a trimmed hedge does), not piece by piece
    g.pieces.push({ x, z, a: ang + (r1 - 0.5) * 0.03, len: step + 0.8, h: 1.45 + worldNoise(x, z, 60, hs) * 0.65, w: 1.35 + worldNoise(x, z, 70, hs + 1) * 0.55 });
    if (hash2(k, seed, 75) < treeRate && occ.free(x, z, CLEAR + 2) && inClip(x - 4, z - 4) && inClip(x + 4, z + 4)) g.trees.push({ x: x + (r2 - 0.5) * 1.2, z: z + (r1 - 0.5) * 1.2, s: 0.95 + r2 * 0.5, kind: r1 < 0.15 ? 1 : 0 });
  }
}

// Every hedge group touching the box: one per pair of neighbouring parcels (keyed by the two
// cells), one per split line, one per side of each country lane.
// Nothing is planted outside `clip` (the painted map: past it there may be no ground at all).
export function planHedges(layout: Layout, box: Box, occ: Occupancy, lanes = true, clip: Box | null = null): HedgeGroup[] {
  const hs = layout.seed + 931;
  const out: HedgeGroup[] = [];
  const kindAt = (x: number, z: number) => { const f = layout.fieldAt(x, z); return { id: f, kind: f < 0 ? 'grass' : layout.about(f).kind }; };
  const touches = (a: XZ, b: XZ) => Math.max(a.x, b.x) >= box.x0 && Math.min(a.x, b.x) <= box.x1 && Math.max(a.z, b.z) >= box.z0 && Math.min(a.z, b.z) <= box.z1;
  // the fields' hedged lines, each once: a hedge wherever the fields either side are farmland (not
  // in or against a wood, not in the town, not across open rough grazing). Each line's gateway and
  // trees are its own (seeded from where it is), so tiles that share it agree.
  layout.ensure(box);
  const PL = layout.plan, kindAt2 = (x: number, z: number) => { const f = layout.fieldAt(x, z); return f < 0 ? null : layout.about(f).kind; };
  for (const n of PL.linesNear(box)) {
    const l = PL.lines[n];
    if (!l.hedge) continue;
    const [p, q] = layout.sides(n);
    if (p === 'wood' || q === 'wood' || (p === 'town' && q === 'town')) continue;
    const L = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z) || 1, nx = -(l.b.z - l.a.z) / L * 2, nz = (l.b.x - l.a.x) / L * 2;
    const ls = (Math.round(l.a.x) * 7919 + Math.round(l.a.z) * 104729 + Math.round(l.b.x) * 31 + Math.round(l.b.z) + layout.seed * 613) | 0;
    const g: HedgeGroup = { key: `p${ls}`, pieces: [], trees: [], gates: [] };
    walk(g, l.a, l.b, ls, occ, (x, z) => {
      const u = kindAt2(x + nx, z + nz), v = kindAt2(x - nx, z - nz);
      return u !== 'wood' && v !== 'wood' && !(u === 'town' && v === 'town') && !(u === 'rough' && v === 'rough');
    }, true, clip, hs, 0.15);
    out.push(g);
  }
  // country lanes: a hedge each side, just outside the verge, where the land beside isn't town
  if (lanes) (layout.input.lanes ?? []).forEach((ln, li) => {
    if (ln.hedge === false) return;
    for (const side of [1, -1]) {
      const g: HedgeGroup = { key: `l${li}:${side}`, pieces: [], trees: [], gates: [] };
      // (a lane is laid whole or not at all, so its group is the same however it's reached)
      if (!ln.path.some((p, s) => s > 0 && touches(ln.path[s - 1], p))) continue;
      // (a plan's roads wind, drawn every few metres: taken in runs of 20 m or more, as a hedge
      // piece is 8 m and a shorter run would get none)
      const path = runs(ln.path, 20);
      for (let s = 1; s < path.length; s++) {
        const p = path[s - 1], q = path[s], L = Math.hypot(q.x - p.x, q.z - p.z) || 1, nx = (-(q.z - p.z) / L) * side, nz = ((q.x - p.x) / L) * side;
        const off = ln.half + CLEAR + 0.3;
        const a = { x: p.x + nx * off, z: p.z + nz * off }, b = { x: q.x + nx * off, z: q.z + nz * off };
        walk(g, a, b, (li * 131 + s * 7 + side) | 0, occ, (x, z) => kindAt(x + nx * 2, z + nz * 2).kind !== 'town', false, clip, hs);
      }
      out.push(g);
    }
  });
  return out;
}
// a polyline with points dropped so every stretch is at least `min` metres (the ends kept)
function runs(path: XZ[], min: number): XZ[] {
  const out = [path[0]];
  for (let k = 1; k < path.length - 1; k++) { const l = out[out.length - 1]; if (Math.hypot(path[k].x - l.x, path[k].z - l.z) >= min) out.push(path[k]); }
  out.push(path[path.length - 1]);
  return out;
}
