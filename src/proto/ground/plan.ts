// The fields a layout knows about (layout.ts), from its field source: convex polygons, what each
// is, and the lines between them, each once (hedged or not). Fields are added a farm block at a
// time as the ground asks for more of the world; this index answers "which field is this point
// in" and "how far is the nearest boundary". Plain numbers, no three.js.
import { CROP, type CropName } from './covers';
import type { ParcelKind, XZ } from './layout';

export interface PlanField { poly: XZ[]; kind: Exclude<ParcelKind, 'town'>; crop: CropName; dir: number; conifer?: boolean }
export interface PlanLine { a: XZ; b: XZ; hedge: boolean }
// Where fields come from: every farm block (whole) touching a box, each with an id of its own
// (region/fields.ts `Countryside` is one).
export interface FieldSource { blocksNear(box: Box): { id: number; fields: PlanField[]; lines: PlanLine[] }[] }

type Box = { x0: number; z0: number; x1: number; z1: number };
const C = 64; // metres per index cell
const PAD = 12; // lines are indexed this far past their ends (how far `edge` can see)
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

export class PlanIndex {
  readonly fields: PlanField[] = [];
  readonly lines: PlanLine[] = [];
  readonly boxes: Box[] = [];
  readonly crops: number[] = [];
  private fcells = new Map<number, number[]>();
  private lcells = new Map<number, number[]>();
  private put(m: Map<number, number[]>, b: Box, n: number) {
    for (let i = Math.floor(b.x0 / C); i <= Math.floor(b.x1 / C); i++) for (let j = Math.floor(b.z0 / C); j <= Math.floor(b.z1 / C); j++) { const k = key(i, j), l = m.get(k); if (l) l.push(n); else m.set(k, [n]); }
  }
  add(fields: PlanField[], lines: PlanLine[]) {
    for (const f of fields) {
      const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (const p of f.poly) { b.x0 = Math.min(b.x0, p.x); b.z0 = Math.min(b.z0, p.z); b.x1 = Math.max(b.x1, p.x); b.z1 = Math.max(b.z1, p.z); }
      const n = this.fields.length;
      this.fields.push(f); this.boxes.push(b); this.crops.push(CROP[f.crop] ?? CROP.grass);
      this.put(this.fcells, b, n);
    }
    for (const l of lines) {
      const n = this.lines.length;
      this.lines.push(l);
      this.put(this.lcells, { x0: Math.min(l.a.x, l.b.x) - PAD, z0: Math.min(l.a.z, l.b.z) - PAD, x1: Math.max(l.a.x, l.b.x) + PAD, z1: Math.max(l.a.z, l.b.z) + PAD }, n);
    }
  }
  // the field a point is in (-1 for none)
  fieldAt(x: number, z: number): number {
    for (const n of this.fcells.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) {
      const b = this.boxes[n];
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (inConvex(x, z, this.fields[n].poly)) return n;
    }
    return -1;
  }
  // distance to the nearest line that `use` says counts (capped at PAD)
  edge(x: number, z: number, use?: (line: number) => boolean): number {
    let d = PAD;
    for (const n of this.lcells.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) {
      if (use && !use(n)) continue;
      const { a, b } = this.lines[n];
      const e = segDist(x, z, a, b);
      if (e < d) d = e;
    }
    return d;
  }
  private gather(m: Map<number, number[]>, b: Box) {
    const out = new Set<number>();
    for (let i = Math.floor(b.x0 / C); i <= Math.floor(b.x1 / C); i++) for (let j = Math.floor(b.z0 / C); j <= Math.floor(b.z1 / C); j++) for (const n of m.get(key(i, j)) ?? []) out.add(n);
    return [...out].sort((p, q) => p - q);
  }
  fieldsNear(b: Box) { return this.gather(this.fcells, b).filter((n) => { const f = this.boxes[n]; return f.x1 >= b.x0 && f.x0 <= b.x1 && f.z1 >= b.z0 && f.z0 <= b.z1; }); }
  linesNear(b: Box) {
    return this.gather(this.lcells, { x0: b.x0 - PAD, z0: b.z0 - PAD, x1: b.x1 + PAD, z1: b.z1 + PAD }).filter((n) => {
      const { a, b: e } = this.lines[n];
      return Math.max(a.x, e.x) >= b.x0 && Math.min(a.x, e.x) <= b.x1 && Math.max(a.z, e.z) >= b.z0 && Math.min(a.z, e.z) <= b.z1;
    });
  }
}

export function inConvex(x: number, z: number, q: XZ[]) {
  let sign = 0;
  for (let k = 0, n = q.length; k < n; k++) {
    const a = q[k], b = q[(k + 1) % n], c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}
export function segDist(x: number, z: number, a: XZ, b: XZ) {
  const ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L)) : 0;
  return Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
}
