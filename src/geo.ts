// Grid geometry: 8 directions, edge storage, isometric projection, path curves.

// 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (in tile space, +y is "south").
export const DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const DY = [0, 1, 1, 1, 0, -1, -1, -1];
export const DLEN = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

export const HW = 32; // half tile width in iso pixels
export const HH = 16; // half tile height in iso pixels

export const iso = (x: number, y: number, z = 0) => ({ x: (x - y) * HW, y: (x + y) * HH - z });

export function isoInv(sx: number, sy: number) {
  const a = sx / HW, b = sy / HH;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export const opposite = (d: number) => (d + 4) & 7;

// Direction from tile a to tile b (must be 8-neighbours), or -1.
export function dirBetween(w: number, a: number, b: number): number {
  const dx = (b % w) - (a % w), dy = Math.floor(b / w) - Math.floor(a / w);
  for (let d = 0; d < 8; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return -1;
}

// Edges are stored once per unordered pair: at the node that owns dirs 0..3.
export class EdgeGrid {
  w: number;
  h: number;
  data: Uint8Array;
  constructor(w: number, h: number, data?: Uint8Array) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8Array(w * h * 4);
  }
  neighbour(n: number, d: number): number {
    const x = (n % this.w) + DX[d], y = Math.floor(n / this.w) + DY[d];
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }
  slot(n: number, d: number): number {
    if (d < 4) return this.neighbour(n, d) < 0 ? -1 : n * 4 + d;
    const m = this.neighbour(n, d);
    return m < 0 ? -1 : m * 4 + (d - 4);
  }
  get(n: number, d: number): number {
    const s = this.slot(n, d);
    return s < 0 ? 0 : this.data[s];
  }
  set(n: number, d: number, v: number) {
    const s = this.slot(n, d);
    if (s >= 0) this.data[s] = v;
  }
  degree(n: number): number {
    let c = 0;
    for (let d = 0; d < 8; d++) if (this.get(n, d)) c++;
    return c;
  }
  any(n: number): boolean {
    for (let d = 0; d < 8; d++) if (this.get(n, d)) return true;
    return false;
  }
}

// Does a diagonal from n in direction d cross the other diagonal of the same square?
export function crossingDiagonal(g: EdgeGrid, n: number, d: number): boolean {
  if (d % 2 === 0) return false;
  const x = n % g.w, y = Math.floor(n / g.w);
  // the square spanned by the diagonal
  const x2 = x + DX[d], y2 = y + DY[d];
  const a = y * g.w + x2; // corner (x2, y)
  const b = y2 * g.w + x; // corner (x, y2)
  const dab = dirBetween(g.w, a, b);
  return dab >= 0 && g.get(a, dab) !== 0;
}

// ---- smooth paths through tile-centre nodes ----
export interface Pt { x: number; y: number }

interface Piece { a: Pt; b: Pt; c?: Pt; len: number }

export class Curve {
  pieces: Piece[] = [];
  length = 0;
  constructor(pts: Pt[]) {
    if (pts.length < 2) {
      if (pts.length) this.pieces.push({ a: pts[0], b: pts[0], len: 0 });
      return;
    }
    const mid = (p: Pt, q: Pt) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
    if (pts.length === 2) {
      this.pieces.push({ a: pts[0], b: pts[1], len: dist(pts[0], pts[1]) });
    } else {
      let m = mid(pts[0], pts[1]);
      this.pieces.push({ a: pts[0], b: m, len: dist(pts[0], m) });
      for (let i = 1; i < pts.length - 1; i++) {
        const m2 = mid(pts[i], pts[i + 1]);
        const l = (dist(m, pts[i]) + dist(pts[i], m2) + dist(m, m2)) / 2;
        this.pieces.push({ a: m, b: m2, c: pts[i], len: l });
        m = m2;
      }
      const last = pts[pts.length - 1];
      this.pieces.push({ a: m, b: last, len: dist(m, last) });
    }
    this.length = this.pieces.reduce((s, p) => s + p.len, 0);
  }
  // Position + heading (radians, tile space) at distance d; also returns piece index.
  at(d: number): { x: number; y: number; a: number; i: number } {
    let rem = Math.max(0, Math.min(this.length, d));
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (rem <= p.len || i === this.pieces.length - 1) {
        const t = p.len > 0 ? Math.min(1, rem / p.len) : 0;
        if (!p.c) {
          return { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t, a: Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x), i };
        }
        const u = 1 - t;
        const x = u * u * p.a.x + 2 * u * t * p.c.x + t * t * p.b.x;
        const y = u * u * p.a.y + 2 * u * t * p.c.y + t * t * p.b.y;
        const dx = 2 * u * (p.c.x - p.a.x) + 2 * t * (p.b.x - p.c.x);
        const dy = 2 * u * (p.c.y - p.a.y) + 2 * t * (p.b.y - p.c.y);
        return { x, y, a: Math.atan2(dy, dx), i };
      }
      rem -= p.len;
    }
    return { x: 0, y: 0, a: 0, i: 0 };
  }
}

// Min-heap keyed by number.
export class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k, v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}
