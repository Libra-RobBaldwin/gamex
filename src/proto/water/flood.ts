// Grid hydrology: where water collects and which way it drains, on a regular grid of heights.
//
// Priority-flood (Barnes, Lehman and Mulla 2014) floods the grid inwards from its outlets (the
// grid's edge and the sea), always from the lowest cell reached so far. Each cell's filled level
// is the lowest height water there could drain away at, so every closed hollow comes out filled
// to its spill level, which is how lakes are found. The cell each one was reached from is where
// it drains to, so the same pass gives a drainage tree with no pits and no loops (flats drain
// towards their outlet), and walking the flood order backwards accumulates the catchment.
// Pure functions of their inputs; nothing here knows about terrain or tiles.

// A binary min-heap of cell indices keyed by height, ties broken by arrival so the result never
// depends on the heap's internals.
class Heap {
  private k: Float64Array;
  private s: Float64Array;
  private v: Int32Array;
  n = 0;
  private seq = 0;
  constructor(cap: number) { this.k = new Float64Array(cap); this.s = new Float64Array(cap); this.v = new Int32Array(cap); }
  private less(a: number, b: number) { return this.k[a] < this.k[b] || (this.k[a] === this.k[b] && this.s[a] < this.s[b]); }
  private swap(a: number, b: number) {
    const k = this.k[a], s = this.s[a], v = this.v[a];
    this.k[a] = this.k[b]; this.s[a] = this.s[b]; this.v[a] = this.v[b];
    this.k[b] = k; this.s[b] = s; this.v[b] = v;
  }
  push(key: number, val: number) {
    let i = this.n++;
    this.k[i] = key; this.s[i] = this.seq++; this.v[i] = val;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; }
  }
  pop() {
    const top = this.v[0];
    this.n--;
    if (this.n > 0) {
      this.k[0] = this.k[this.n]; this.s[0] = this.s[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}

export interface Flood {
  filled: Float32Array; // the level water stands at in each cell (≥ the ground; > it in a hollow)
  parent: Int32Array; // the cell each drains to (−1 for an outlet)
  order: Int32Array; // cells in the order they were flooded (outlets first, sources last)
}

// 8-neighbour offsets (diagonals too, so drainage isn't forced into a Manhattan staircase)
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];

// h: heights, nx × nz, row by row. outlet[k] = 1 where water leaves the grid (its edge, the sea).
export function priorityFlood(h: ArrayLike<number>, nx: number, nz: number, outlet: Uint8Array): Flood {
  const N = nx * nz, filled = new Float32Array(N), parent = new Int32Array(N).fill(-1), order = new Int32Array(N);
  const seen = new Uint8Array(N), heap = new Heap(N);
  // a plain queue for cells inside hollows and flats: they share their spill level, so they need no
  // sorting (Barnes's improvement), and first-in first-out makes flats drain the short way
  const pit = new Int32Array(N);
  let ph = 0, pt = 0, o = 0;
  for (let k = 0; k < N; k++) if (outlet[k]) { seen[k] = 1; filled[k] = h[k]; heap.push(h[k], k); }
  while (heap.n > 0 || ph < pt) {
    const c = ph < pt ? pit[ph++] : heap.pop();
    order[o++] = c;
    const ci = c % nx, cj = (c - ci) / nx, fc = filled[c];
    for (let d = 0; d < 8; d++) {
      const i = ci + DI[d], j = cj + DJ[d];
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const n = j * nx + i;
      if (seen[n]) continue;
      seen[n] = 1; parent[n] = c;
      if (h[n] <= fc) { filled[n] = fc; pit[pt++] = n; }
      else { filled[n] = h[n]; heap.push(h[n], n); }
    }
  }
  // cells never reached (a grid with no outlets at all) drain nowhere
  if (o < N) for (let k = 0; k < N; k++) if (!seen[k]) { filled[k] = h[k]; order[o++] = k; }
  return { filled, parent, order };
}

// Upstream catchment of every cell: its own weight plus everything that drains through it.
export function accumulate(f: Flood, weight: number | ArrayLike<number> = 1): Float32Array {
  const N = f.order.length, acc = new Float32Array(N);
  for (let k = 0; k < N; k++) acc[k] = typeof weight === 'number' ? weight : weight[k];
  for (let q = N - 1; q >= 0; q--) { const c = f.order[q], p = f.parent[c]; if (p >= 0) acc[p] += acc[c]; }
  return acc;
}

// Connected groups of cells that pass `inside` (4-neighbour), labelled 0, 1, 2… (−1 outside).
// `same(a, b)` can split groups further (lakes at different levels that happen to touch).
export function label(nx: number, nz: number, inside: (k: number) => boolean, same: (a: number, b: number) => boolean = () => true) {
  const N = nx * nz, lab = new Int32Array(N).fill(-1), stack = new Int32Array(N), sizes: number[] = [];
  for (let s = 0; s < N; s++) {
    if (lab[s] >= 0 || !inside(s)) continue;
    const id = sizes.length;
    let sp = 0, size = 0;
    stack[sp++] = s; lab[s] = id;
    while (sp > 0) {
      const c = stack[--sp];
      size++;
      const ci = c % nx, cj = (c - ci) / nx;
      for (let d = 0; d < 4; d++) {
        const i = ci + DI[d], j = cj + DJ[d];
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const n = j * nx + i;
        if (lab[n] < 0 && inside(n) && same(c, n)) { lab[n] = id; stack[sp++] = n; }
      }
    }
    sizes.push(size);
  }
  return { lab, sizes };
}

// Exact Euclidean distance transform (Felzenszwalb and Huttenlocher): for every cell, the
// distance in cells to the nearest cell where mask[k] === target. Two passes of the 1D lower
// envelope of parabolas; linear in the number of cells.
export const FAR = 1e20;
export function edt(mask: Uint8Array, target: number, nx: number, nz: number): Float32Array {
  const N = nx * nz, sq = new Float64Array(N), n = Math.max(nx, nz);
  for (let k = 0; k < N; k++) sq[k] = mask[k] === target ? 0 : FAR;
  const v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n);
  const pass = (len: number, o: number, stride: number) => {
    for (let q = 0; q < len; q++) g[q] = sq[o + q * stride];
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      const fq = g[q] + q * q;
      let p = v[k], s = (fq - (g[p] + p * p)) / (2 * (q - p));
      while (s <= z[k]) { k--; p = v[k]; s = (fq - (g[p] + p * p)) / (2 * (q - p)); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const r = q - v[k]; sq[o + q * stride] = r * r + g[v[k]]; }
  };
  for (let i = 0; i < nx; i++) pass(nz, i, nx);
  for (let j = 0; j < nz; j++) pass(nx, j * nx, 1);
  const out = new Float32Array(N);
  for (let k = 0; k < N; k++) out[k] = Math.sqrt(sq[k]);
  return out;
}
