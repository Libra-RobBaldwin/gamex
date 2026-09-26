// The land registry: the single authority for who owns each piece of ground. Roads, junctions,
// slip roads and their islands claim the land they need; everything that comes later (plots,
// parks, street trees) asks the registry whether ground is free instead of carrying its own idea
// of where roads are. When a junction grows (a crossroads becomes a roundabout), its new claim is
// registered and anything standing on it is told to move. Claims live in a coarse spatial hash,
// so asking about a spot only looks at the few claims near it — the same cost on a village or a
// county.

export interface XZ { x: number; z: number }
export type Owner = 'road' | 'junction' | 'slip' | 'island' | 'industry' | 'water' | 'station'; // industry: a site's plot (game/industry.ts); water: lakes and rivers (game/water.ts); station: platforms and buildings (rail/station.ts)
export interface Claim { key: string; owner: Owner; polys: XZ[][]; box: [number, number, number, number] }

const CELL = 40;

function boxOf(polys: XZ[][]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of polys) for (const q of p) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
  return [x0, z0, x1, z1];
}

// (a big polygon, a river's bank, is thousands of edges: its edges are bucketed by the band of z
// they span, so a point only looks at those that can cross its ray; the same answer, quicker)
const BAND = 16, bands = new WeakMap<XZ[], { z0: number; edges: number[][] }>();
function bandsOf(poly: XZ[]) {
  let b = bands.get(poly);
  if (b) return b;
  let z0 = Infinity, z1 = -Infinity;
  for (const q of poly) { if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; }
  const edges: number[][] = Array.from({ length: Math.floor((z1 - z0) / BAND) + 1 }, () => []);
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const lo = Math.min(poly[i].z, poly[j].z), hi = Math.max(poly[i].z, poly[j].z);
    for (let k = Math.floor((lo - z0) / BAND); k <= Math.floor((hi - z0) / BAND); k++) edges[k].push(i);
  }
  b = { z0, edges };
  bands.set(poly, b);
  return b;
}
export function pointInPoly(p: XZ, poly: XZ[]) {
  if (poly.length > 96) {
    const B = bandsOf(poly), k = Math.floor((p.z - B.z0) / BAND);
    if (k < 0 || k >= B.edges.length) return false;
    let inside = false;
    for (const i of B.edges[k]) {
      const a = poly[i], b = poly[i === 0 ? poly.length - 1 : i - 1];
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function segsCross(a: XZ, b: XZ, c: XZ, d: XZ) {
  const o = (p: XZ, q: XZ, r: XZ) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
// Do two simple polygons (convex or not) overlap?
// (a big one, a river's bank, is thousands of edges: only those whose box meets the other's are tried)
export function polysTouch(A: XZ[], B: XZ[]) {
  if (A.length > B.length) [A, B] = [B, A];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of A) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; }
  const tryEdge = (j: number) => {
    const c = B[j], d = B[(j + 1) % B.length];
    if ((c.x < x0 && d.x < x0) || (c.x > x1 && d.x > x1) || (c.z < z0 && d.z < z0) || (c.z > z1 && d.z > z1)) return false;
    for (let i = 0; i < A.length; i++) if (segsCross(A[i], A[(i + 1) % A.length], c, d)) return true;
    return false;
  };
  if (B.length > 96) {
    const G = gridOf(B), seen = new Set<number>();
    for (let i = Math.floor(x0 / EDGE_CELL); i <= Math.floor(x1 / EDGE_CELL); i++) for (let j = Math.floor(z0 / EDGE_CELL); j <= Math.floor(z1 / EDGE_CELL); j++) {
      for (const e of G.get((i + 32768) * 65536 + (j + 32768)) ?? []) { if (seen.has(e)) continue; seen.add(e); if (tryEdge(e)) return true; }
    }
  } else for (let j = 0; j < B.length; j++) if (tryEdge(j)) return true;
  return pointInPoly(A[0], B) || pointInPoly(B[0], A);
}
// (a big polygon's edges, bucketed by the cells their boxes cover)
const EDGE_CELL = 24, grids = new WeakMap<XZ[], Map<number, number[]>>();
function gridOf(B: XZ[]) {
  let G = grids.get(B);
  if (G) return G;
  G = new Map();
  for (let j = 0; j < B.length; j++) {
    const c = B[j], d = B[(j + 1) % B.length];
    for (let i = Math.floor(Math.min(c.x, d.x) / EDGE_CELL); i <= Math.floor(Math.max(c.x, d.x) / EDGE_CELL); i++) for (let k = Math.floor(Math.min(c.z, d.z) / EDGE_CELL); k <= Math.floor(Math.max(c.z, d.z) / EDGE_CELL); k++) {
      const key = (i + 32768) * 65536 + (k + 32768), l = G.get(key);
      if (l) l.push(j); else G.set(key, [j]);
    }
  }
  grids.set(B, G);
  return G;
}
export function circlePoly(c: XZ, r: number, n = 24): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r }); }
  return out;
}
// A band either side of a path (from `l` on the left to `r` on the right, left being +normal).
export function bandPolys(path: XZ[], l: number, r: number): XZ[][] {
  const out: XZ[][] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, nx = -uz, nz = ux, e = 0.3;
    const A = { x: a.x - ux * e, z: a.z - uz * e }, B = { x: b.x + ux * e, z: b.z + uz * e };
    out.push([{ x: A.x + nx * l, z: A.z + nz * l }, { x: B.x + nx * l, z: B.z + nz * l }, { x: B.x - nx * r, z: B.z - nz * r }, { x: A.x - nx * r, z: A.z - nz * r }]);
  }
  return out;
}

// A claim's pieces are filed separately, each under the cells its own box covers: a long road's
// claim is hundreds of pieces along a line, and filing it under its whole box would put all of
// them in front of every question asked anywhere in that box (a motorway across a 6 km map).
interface Piece { claim: Claim; poly: XZ[]; box: [number, number, number, number] }

export class Land {
  private claims = new Map<string, Claim>();
  private grid = new Map<string, Set<Piece>>();
  private pieces = new Map<Claim, Piece[]>();
  version = 0;

  private cells(b: [number, number, number, number], f: (k: string) => void) {
    for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) f(`${i},${j}`);
  }
  claim(key: string, owner: Owner, polys: XZ[][]) {
    this.release(key);
    if (!polys.length) return;
    const c: Claim = { key, owner, polys, box: boxOf(polys) };
    this.claims.set(key, c);
    const ps = polys.map((poly) => ({ claim: c, poly, box: boxOf([poly]) }));
    this.pieces.set(c, ps);
    for (const pc of ps) this.cells(pc.box, (k) => { let s = this.grid.get(k); if (!s) this.grid.set(k, (s = new Set())); s.add(pc); });
    this.version++;
  }
  release(key: string) {
    const c = this.claims.get(key);
    if (!c) return;
    for (const pc of this.pieces.get(c) ?? []) this.cells(pc.box, (k) => this.grid.get(k)?.delete(pc));
    this.pieces.delete(c);
    this.claims.delete(key);
    this.version++;
  }
  releaseWhere(test: (key: string) => boolean) { for (const k of [...this.claims.keys()]) if (test(k)) this.release(k); }
  get(key: string) { return this.claims.get(key); }
  all() { return this.claims.values(); }

  // the pieces whose boxes overlap a box, cell by cell, each claim's in the order it was made
  private near(b: [number, number, number, number], f: (pc: Piece) => boolean | void) {
    const seen = new Set<Piece>();
    let stop = false;
    this.cells(b, (k) => {
      if (stop) return;
      for (const pc of this.grid.get(k) ?? []) {
        if (seen.has(pc)) continue;
        seen.add(pc);
        if (pc.box[0] <= b[2] && pc.box[2] >= b[0] && pc.box[1] <= b[3] && pc.box[3] >= b[1] && f(pc) === true) { stop = true; return; }
      }
    });
  }
  // Claims overlapping a polygon (optionally ignoring some).
  hits(poly: XZ[], skip?: (c: Claim) => boolean): Claim[] {
    const out: Claim[] = [], done = new Set<Claim>();
    this.near(boxOf([poly]), (pc) => {
      if (done.has(pc.claim) || skip?.(pc.claim)) return;
      if (polysTouch(pc.poly, poly)) { done.add(pc.claim); out.push(pc.claim); }
    });
    return out;
  }
  free(poly: XZ[], skip?: (c: Claim) => boolean) { return this.hits(poly, skip).length === 0; }
  // Who owns this spot (if anyone)?
  at(p: XZ): Claim | undefined {
    let hit: Claim | undefined;
    this.near([p.x, p.z, p.x, p.z], (pc) => { if (pointInPoly(p, pc.poly)) { hit = pc.claim; return true; } });
    return hit;
  }
}
