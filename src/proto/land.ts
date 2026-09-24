// The land registry: the single authority for who owns each piece of ground. Roads, junctions,
// slip roads and their islands claim the land they need; everything that comes later (plots,
// parks, street trees) asks the registry whether ground is free instead of carrying its own idea
// of where roads are. When a junction grows (a crossroads becomes a roundabout), its new claim is
// registered and anything standing on it is told to move. Claims live in a coarse spatial hash,
// so asking about a spot only looks at the few claims near it — the same cost on a village or a
// county.

export interface XZ { x: number; z: number }
export type Owner = 'road' | 'junction' | 'slip' | 'island' | 'industry'; // industry: a site's plot (game/industry.ts)
export interface Claim { key: string; owner: Owner; polys: XZ[][]; box: [number, number, number, number] }

const CELL = 40;

function boxOf(polys: XZ[][]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of polys) for (const q of p) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
  return [x0, z0, x1, z1];
}

export function pointInPoly(p: XZ, poly: XZ[]) {
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
export function polysTouch(A: XZ[], B: XZ[]) {
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  return pointInPoly(A[0], B) || pointInPoly(B[0], A);
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

export class Land {
  private claims = new Map<string, Claim>();
  private grid = new Map<string, Set<Claim>>();
  version = 0;

  private cells(b: [number, number, number, number], f: (k: string) => void) {
    for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) f(`${i},${j}`);
  }
  claim(key: string, owner: Owner, polys: XZ[][]) {
    this.release(key);
    if (!polys.length) return;
    const c: Claim = { key, owner, polys, box: boxOf(polys) };
    this.claims.set(key, c);
    this.cells(c.box, (k) => { let s = this.grid.get(k); if (!s) this.grid.set(k, (s = new Set())); s.add(c); });
    this.version++;
  }
  release(key: string) {
    const c = this.claims.get(key);
    if (!c) return;
    this.cells(c.box, (k) => this.grid.get(k)?.delete(c));
    this.claims.delete(key);
    this.version++;
  }
  releaseWhere(test: (key: string) => boolean) { for (const k of [...this.claims.keys()]) if (test(k)) this.release(k); }
  get(key: string) { return this.claims.get(key); }
  all() { return this.claims.values(); }

  private near(b: [number, number, number, number]) {
    const out = new Set<Claim>();
    this.cells(b, (k) => { for (const c of this.grid.get(k) ?? []) if (c.box[0] <= b[2] && c.box[2] >= b[0] && c.box[1] <= b[3] && c.box[3] >= b[1]) out.add(c); });
    return out;
  }
  // Claims overlapping a polygon (optionally ignoring some).
  hits(poly: XZ[], skip?: (c: Claim) => boolean): Claim[] {
    const out: Claim[] = [];
    for (const c of this.near(boxOf([poly]))) {
      if (skip?.(c)) continue;
      if (c.polys.some((p) => polysTouch(p, poly))) out.push(c);
    }
    return out;
  }
  free(poly: XZ[], skip?: (c: Claim) => boolean) { return this.hits(poly, skip).length === 0; }
  // Who owns this spot (if anyone)?
  at(p: XZ): Claim | undefined {
    for (const c of this.near([p.x, p.z, p.x, p.z])) if (c.polys.some((q) => pointInPoly(p, q))) return c;
    return undefined;
  }
}
