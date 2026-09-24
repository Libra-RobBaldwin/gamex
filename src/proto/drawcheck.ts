// Checking what drawRoads actually drew, seen from above: the triangles of each surface are
// rasterised round every junction and join, and anything that doesn't line up is counted. Used by
// joins.test.ts over test roads, the starter town and a real town imported from OpenStreetMap.
//
//   hole     a sliver of bare ground inside the road: between two surfaces that should meet
//   notch    a step into the carriageway's edge (its kerb jogs), where the footway pokes in
//   spur     a thin tongue of carriageway poking out over the footway (the other way a kerb jogs)
//   stray    a road marking off the carriageway: on a footway, verge, island or reservation
//   fight    footway and verge drawn over each other at the same height (they flicker)
import * as THREE from 'three';
import type { Network, P } from './roads';

export type Mat = 'asph' | 'pave' | 'verge' | 'lines' | 'island' | 'median' | 'paint';
export const BIT: Record<Mat, number> = { asph: 1, pave: 2, verge: 4, lines: 8, island: 16, median: 32, paint: 64 };
export type Tris = Record<Mat, Float32Array[]>;

// the drawn triangles of each surface, from drawRoads's group (by material, which the caller maps)
export function trisOf(group: THREE.Group, mats: Map<THREE.Material, Mat>): Tris {
  const out = { asph: [], pave: [], verge: [], lines: [], island: [], median: [], paint: [] } as Tris;
  for (const c of group.children) {
    const m = c as THREE.Mesh;
    const k = mats.get(m.material as THREE.Material);
    if (!k || !m.geometry) continue;
    out[k].push(m.geometry.getAttribute('position').array as Float32Array);
  }
  return out;
}

// a spatial index of triangles by 16 m cells, so a window only looks at the triangles near it
export class TriIndex {
  cells = new Map<string, { m: Mat; a: Float32Array; i: number }[]>();
  constructor(t: Tris, readonly C = 16) {
    for (const m of Object.keys(t) as Mat[]) for (const a of t[m]) for (let i = 0; i < a.length; i += 9) {
      const x0 = Math.min(a[i], a[i + 3], a[i + 6]), x1 = Math.max(a[i], a[i + 3], a[i + 6]);
      const z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]), z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]);
      if (x1 - x0 > 2000 || z1 - z0 > 2000) continue;
      for (let cx = Math.floor(x0 / C); cx <= Math.floor(x1 / C); cx++) for (let cz = Math.floor(z0 / C); cz <= Math.floor(z1 / C); cz++) {
        const k = `${cx},${cz}`;
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push({ m, a, i });
      }
    }
  }
  near(x0: number, z0: number, x1: number, z1: number) {
    const seen = new Set<string>(), out: { m: Mat; a: Float32Array; i: number }[] = [];
    for (let cx = Math.floor(x0 / this.C); cx <= Math.floor(x1 / this.C); cx++) for (let cz = Math.floor(z0 / this.C); cz <= Math.floor(z1 / this.C); cz++) {
      for (const t of this.cells.get(`${cx},${cz}`) ?? []) { const k = `${t.m}:${t.i}:${t.a.length}:${t.a[t.i]}`; if (!seen.has(k)) { seen.add(k); out.push(t); } }
    }
    return out;
  }
}

// A square window of the map, `res` metres a cell, holding which surfaces cover each cell's centre.
export class Raster {
  w: number; h: number; bits: Uint8Array;
  // the heights footway and verge were drawn at in each cell (the highest), so only those drawn at the
  // same height count as fighting: one a centimetre over the other is drawn cleanly on top
  py: Float32Array; vy: Float32Array;
  constructor(readonly x0: number, readonly z0: number, x1: number, z1: number, readonly res = 0.1) {
    this.w = Math.ceil((x1 - x0) / res); this.h = Math.ceil((z1 - z0) / res);
    this.bits = new Uint8Array(this.w * this.h);
    this.py = new Float32Array(this.w * this.h).fill(-1e9); this.vy = new Float32Array(this.w * this.h).fill(-1e9);
  }
  // fill a triangle (only its part at about height y, so a bridge overhead doesn't count)
  tri(m: Mat, a: Float32Array, i: number, yLo: number, yHi: number) {
    const ay = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
    if (ay < yLo || ay > yHi) return;
    const [ax, az, bx, bz, cx, cz] = [a[i], a[i + 2], a[i + 3], a[i + 5], a[i + 6], a[i + 8]];
    const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(area) < 1e-9) return;
    const r = this.res;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - this.x0) / r)), i1 = Math.min(this.w - 1, Math.ceil((Math.max(ax, bx, cx) - this.x0) / r));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - this.z0) / r)), j1 = Math.min(this.h - 1, Math.ceil((Math.max(az, bz, cz) - this.z0) / r));
    // (grass on a reservation sits above the verges: it's a reservation, not a verge)
    const bit = m === 'verge' && ay > yLo + 0.3 + 0.21 ? BIT.median : BIT[m], s = Math.sign(area);
    for (let j = j0; j <= j1; j++) {
      const pz = this.z0 + (j + 0.5) * r;
      for (let k = i0; k <= i1; k++) {
        const px = this.x0 + (k + 0.5) * r;
        const d1 = ((bx - ax) * (pz - az) - (bz - az) * (px - ax)) * s, d2 = ((cx - bx) * (pz - bz) - (cz - bz) * (px - bx)) * s, d3 = ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) * s;
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) {
          const c = j * this.w + k;
          this.bits[c] |= bit;
          if (bit === BIT.pave) this.py[c] = Math.max(this.py[c], ay); else if (bit === BIT.verge) this.vy[c] = Math.max(this.vy[c], ay);
        }
      }
    }
  }
  mask(any: number) { const o = new Uint8Array(this.bits.length); for (let i = 0; i < o.length; i++) o[i] = this.bits[i] & any ? 1 : 0; return o; }
  // morphology with a disc of radius r cells (dilate, erode)
  private morph(m: Uint8Array, r: number, grow: boolean) {
    const o = new Uint8Array(m.length), { w, h } = this, off: [number, number][] = [];
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (di * di + dj * dj <= r * r + 0.5) off.push([di, dj]);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let v = grow ? 0 : 1;
      for (const [di, dj] of off) {
        const x = i + di, y = j + dj;
        const b = x < 0 || y < 0 || x >= w || y >= h ? (grow ? 0 : 1) : m[y * w + x];
        if (grow && b) { v = 1; break; }
        if (!grow && !b) { v = 0; break; }
      }
      o[j * w + i] = v;
    }
    return o;
  }
  close(m: Uint8Array, r: number) { return this.morph(this.morph(m, r, true), r, false); }
  open(m: Uint8Array, r: number) { return this.morph(this.morph(m, r, false), r, true); }
  // connected pieces of a mask, with their size (m²) and middle
  blobs(m: Uint8Array) {
    const { w, h } = this, seen = new Uint8Array(m.length), out: { area: number; at: P; cells: number[] }[] = [];
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || seen[s]) continue;
      const st = [s], cells: number[] = [];
      seen[s] = 1;
      while (st.length) {
        const c = st.pop()!;
        cells.push(c);
        const i = c % w, j = (c - i) / w;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + di, y = j + dj;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const k = y * w + x;
          if (m[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      let sx = 0, sz = 0;
      for (const c of cells) { sx += c % w; sz += Math.floor(c / w); }
      out.push({ area: cells.length * this.res * this.res, at: { x: this.x0 + (sx / cells.length + 0.5) * this.res, z: this.z0 + (sz / cells.length + 0.5) * this.res }, cells });
    }
    return out;
  }
  // the widest a blob is, across its thinnest way (roughly: twice the furthest any cell is from its edge)
  thickness(cells: number[]) {
    const set = new Set(cells), { w } = this;
    let best = 0;
    for (const c of cells) {
      let r = 0;
      while (r < 40) {
        const i = c % w, j = (c - i) / w, n = r + 1;
        if (![[n, 0], [-n, 0], [0, n], [0, -n]].every(([di, dj]) => set.has((j + dj) * w + i + di))) break;
        r++;
      }
      best = Math.max(best, r);
    }
    return (2 * best + 1) * this.res;
  }
}

export interface Defect { kind: 'hole' | 'notch' | 'spur' | 'stray' | 'fight' | 'clash'; node: number; at: P; area: number; note?: string }
const SURF = BIT.asph | BIT.pave | BIT.verge | BIT.island | BIT.median | BIT.paint;
const CARR = BIT.asph | BIT.paint;

// Check the window round one place (a junction or a join) at height y. `keep` says which cells to look
// at (the places' own surroundings, not a neighbour's); `r` is the tolerance, in cells.
export function checkWindow(idx: TriIndex, node: number, c: P, rad: number, y: number, res = 0.1, r = 2, minArea = 0.03): Defect[] {
  const R = new Raster(c.x - rad, c.z - rad, c.x + rad, c.z + rad, res);
  for (const t of idx.near(R.x0, R.z0, c.x + rad, c.z + rad)) R.tri(t.m, t.a, t.i, y - 0.3, y + 1.2);
  const out: Defect[] = [];
  const inside = (p: P) => Math.hypot(p.x - c.x, p.z - c.z) < rad - 1;
  const add = (kind: Defect['kind'], m: Uint8Array, min = minArea, test?: (cells: number[]) => boolean) => {
    for (const b of R.blobs(m)) if (b.area >= min && inside(b.at) && (!test || test(b.cells))) out.push({ kind, node, at: b.at, area: b.area });
  };
  const surf = R.mask(SURF), carr = R.mask(CARR), lines = R.mask(BIT.lines), foot = R.mask(BIT.pave | BIT.verge);
  // holes: bare ground that closing the road's surfaces fills in
  const cs = R.close(surf, r);
  add('hole', cs.map((v, i) => (v && !surf[i] ? 1 : 0)));
  // notches: footway where closing the carriageway fills it in (the kerb steps in)
  const cc = R.close(carr, r);
  add('notch', cc.map((v, i) => (v && !carr[i] && foot[i] ? 1 : 0)));
  // spurs: carriageway that opening it removes, lying over footway (a thin tongue beyond the kerb)
  const oc = R.open(carr, r);
  add('spur', carr.map((v, i) => (v && !oc[i] && R.bits[i] & (BIT.pave | BIT.verge) ? 1 : 0)));
  // stray markings: paint not on the carriageway, or on a kerbed island or reservation
  add('stray', lines.map((v, i) => (v && (!(R.bits[i] & CARR) || R.bits[i] & (BIT.island | BIT.median)) ? 1 : 0)), 0.02);
  // footway and verge at the same height
  add('fight', R.bits.map((v, i) => (v & BIT.pave && v & BIT.verge && Math.abs(R.py[i] - R.vy[i]) < 0.004 ? 1 : 0)), 0.05);
  return out;
}

// distance from a point to a polyline
export function toPath(p: P, path: P[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / L2));
    best = Math.min(best, Math.hypot(p.x - a.x - (b.x - a.x) * t, p.z - a.z - (b.z - a.z) * t));
  }
  return best;
}

// Every junction and join in a network, checked. Nodes with one road (a turning head, an end) are too.
export function checkNetwork(net: Network, idx: TriIndex, opts: { res?: number; r?: number; nodes?: number[]; rad?: (n: number) => number } = {}) {
  const out: Defect[] = [];
  for (const n of net.nodes.values()) {
    if (opts.nodes && !opts.nodes.includes(n.id)) continue;
    const segs = net.segsAt(n.id);
    if (!segs.length || net.def(segs[0]).cls !== 'road') continue;
    if (Math.abs(n.x) > net.bound || Math.abs(n.z) > net.bound) continue;
    const rad = opts.rad?.(n.id) ?? Math.min(45, net.nodeHalf(n.id) * 2.5 + 14);
    // only what this place's own roads make: a defect where some other road runs alongside or
    // across (two roads drawn too close together, say) isn't this junction's
    const own = new Set(segs.map((s) => s.id));
    const others = [...net.segs.values()].filter((o) => !own.has(o.id) && net.def(o).cls === 'road' && net.path(o).some((p) => Math.hypot(p.x - n.x, p.z - n.z) < rad + 200));
    for (const d of checkWindow(idx, n.id, n, rad, n.y ?? 0, opts.res, opts.r)) {
      const foreign = others.find((o) => toPath(d.at, net.path(o)) < net.half(o) + 0.4 && Math.abs(((net.path(o)[0].y ?? 0) + (net.path(o).at(-1)!.y ?? 0)) / 2 - (n.y ?? 0)) < 3);
      if (foreign) { out.push({ ...d, kind: 'clash' as Defect['kind'], note: `road ${foreign.id}` }); continue; }
      out.push(d);
    }
  }
  return out;
}

// A picture of a window (for looking at what the checks found): RGB bytes, `w`×`h`, north up.
export function picture(idx: TriIndex, c: P, rad: number, y: number, defects: Defect[] = [], res = 0.1) {
  const R = new Raster(c.x - rad, c.z - rad, c.x + rad, c.z + rad, res);
  for (const t of idx.near(R.x0, R.z0, c.x + rad, c.z + rad)) R.tri(t.m, t.a, t.i, y - 0.3, y + 1.2);
  const rgb = new Uint8Array(R.w * R.h * 3);
  const col = (b: number): [number, number, number] =>
    b & BIT.lines ? [245, 245, 245] : b & BIT.island ? [120, 170, 80] : b & BIT.median ? [157, 154, 146] : b & BIT.paint ? [156, 66, 56] : b & BIT.asph ? [72, 76, 82] : b & BIT.pave && b & BIT.verge ? [255, 0, 255] : b & BIT.pave ? [189, 184, 173] : b & BIT.verge ? [111, 154, 74] : [40, 90, 30];
  for (let i = 0; i < R.bits.length; i++) rgb.set(col(R.bits[i]), i * 3);
  const mark: Record<string, [number, number, number]> = { clash: [90, 90, 255], hole: [255, 0, 0], notch: [255, 140, 0], spur: [0, 200, 255], stray: [255, 0, 200], fight: [255, 255, 0] };
  for (const d of defects) {
    const i = Math.round((d.at.x - R.x0) / res), j = Math.round((d.at.z - R.z0) / res), rr = Math.round(0.6 / res);
    for (let a = -rr; a <= rr; a++) for (const [x, z] of [[i + a, j - rr], [i + a, j + rr], [i - rr, j + a], [i + rr, j + a]]) if (x >= 0 && z >= 0 && x < R.w && z < R.h) rgb.set(mark[d.kind], (z * R.w + x) * 3);
  }
  return { w: R.w, h: R.h, rgb };
}
