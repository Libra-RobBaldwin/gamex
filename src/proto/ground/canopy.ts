// Woods drawn as woods: over each wood in a field plan (plan.ts), a canopy of crowns as one
// low-poly, flat-shaded surface, lumpy where the trees are broadleaved and spiky in a conifer
// plantation, rising from the ground at the wood's edge. It's the cheap way to draw a lot of
// trees: a kilometre tile's woods are one mesh (one draw call, one in the shadow pass), a few
// thousand triangles where instanced trees would be hundreds of thousands, and it reads as woodland
// from right out to close in (where the trees settled along the woods' edges stand out of it).
//
// The canopy's outline comes from the cover map's woodland weight (it falls from 1 to 0 over the
// last 6 m to the wood's edge, and to nothing across a road or where the town is), so it follows
// the painted wood exactly and repaints with it: `changed(boxes)` after the ground changes. Three
// levels of detail a tile: crowns on a 4 m grid close in, then an 8 m and a 16 m grid.
//
// Heights are above the ground: a map with hills drapes the mesh over them (drape.ts) like
// everything else. Where the canopy meets the ground it goes down steeply into it (the vertices
// just outside a wood are sunk a metre and more), so the two cross at an angle and never fight.
import * as THREE from 'three';
import type { Ground } from './index';
import { hash2 } from './noise';

type Box = { x0: number; z0: number; x1: number; z1: number };
// (each level's mesh: undefined till it's made, null if the tile has no wood)
interface Tile { i: number; j: number; m: (THREE.Mesh | null | undefined)[] }
// the grid (m) of each level, and the view heights (m) below which the first two are drawn
const LEVELS = [4, 8, 16], LEVEL_H = [1100, 2900];
export interface CanopyLook { broadleaf: string; conifer: string }

const SUNK = -1.4;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// value noise, 0..1, over `s` metres
function vnoise(x: number, z: number, s: number, seed: number) {
  const gx = x / s, gz = z / s, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, seed) + (hash2(i + 1, j, seed) - hash2(i, j, seed)) * u;
  const b = hash2(i, j + 1, seed) + (hash2(i + 1, j + 1, seed) - hash2(i, j + 1, seed)) * u;
  return a + (b - a) * v;
}

// The crown nearest a point: crowns stand on a jittered grid (9 m apart, 5.5 in a plantation);
// `dome` is 1 at a crown's middle and 0 past its rim.
const out = { dome: 0, size: 0, id: 0 };
function crownAt(x: number, z: number, conifer: boolean) {
  const S = conifer ? 5.5 : 9, ci = Math.floor(x / S), cj = Math.floor(z / S);
  out.dome = 0; out.size = 0; out.id = 0;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const i = ci + di, j = cj + dj, cx = (i + 0.2 + hash2(i, j, 61) * 0.6) * S, cz = (j + 0.2 + hash2(i, j, 62) * 0.6) * S;
    const sz = hash2(i, j, 63), r = S * (0.62 + 0.3 * sz), d = Math.hypot(x - cx, z - cz) / r;
    if (d >= 1) continue;
    const dome = conifer ? 1 - d : Math.sqrt(1 - d * d);
    if (dome > out.dome) { out.dome = dome; out.size = sz; out.id = (i * 7919 + j * 104729) >>> 0; }
  }
  return out;
}

export class Canopy {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  private tiles = new Map<string, Tile>();
  private level = 1; // which of LEVELS is wanted (from the zoom)
  private view = { x: 0, z: 0, r: 0 };
  private queue: Tile[] = [];
  private pumping = false;
  stats = { tris: 0, ms: 0, built: 0 };
  private cols: { broad: THREE.Color[]; conifer: THREE.Color[] };
  constructor(private ground: Ground, look: CanopyLook, readonly tile = 1000) {
    this.group.name = 'canopy';
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const shade = (hex: string, k: number, hue = 0) => { const c = new THREE.Color(hex); const h = { h: 0, s: 0, l: 0 }; c.getHSL(h); return new THREE.Color().setHSL(h.h + hue, Math.min(1, h.s * 1.05), h.l * k); };
    // (from above, a wood's crowns are darker than a single tree's lit side, and vary tree to tree)
    this.cols = { broad: [shade(look.broadleaf, 0.62, 0.01), shade(look.broadleaf, 0.74), shade(look.broadleaf, 0.86, -0.015)], conifer: [shade(look.conifer, 0.62), shade(look.conifer, 0.75, 0.01)] };
  }
  // Build every tile over the painted map: the middle and far levels everywhere (cheap), the
  // near level where the view is (and more as the camera goes near them: `setView`).
  build() {
    const R = this.ground.cover?.region;
    if (!R || !this.ground.layout.plan) return;
    const T = this.tile;
    for (const t of this.tiles.values()) this.drop(t);
    this.tiles.clear();
    for (let i = Math.floor(R.x0 / T); i * T < R.x0 + R.size; i++) for (let j = Math.floor(R.z0 / T); j * T < R.z0 + R.size; j++) {
      const t: Tile = { i, j, m: [undefined, undefined, undefined] };
      this.tiles.set(`${i},${j}`, t);
      this.make(t, 1); this.make(t, 2);
      if (this.level === 0 && this.near(t)) this.make(t, 0);
      this.show(t);
    }
  }
  // The ground changed in these boxes: their tiles again (the near level only if it's wanted now).
  changed(boxes: Box[]) {
    const T = this.tile, done = new Set<Tile>();
    for (const b of boxes) for (let i = Math.floor((b.x0 - 8) / T); i <= Math.floor((b.x1 + 8) / T); i++) for (let j = Math.floor((b.z0 - 8) / T); j <= Math.floor((b.z1 + 8) / T); j++) {
      const t = this.tiles.get(`${i},${j}`);
      if (!t || done.has(t)) continue;
      done.add(t);
      const had0 = t.m[0] !== undefined;
      this.drop(t);
      this.make(t, 1); this.make(t, 2);
      if (had0 && this.level === 0) this.make(t, 0);
      this.show(t);
    }
  }
  // Where the camera looks and how far out it is (the view's height, m): the level every tile
  // shows. The orthographic camera draws everything at one scale, so it's one level for all; a
  // tile whose near level isn't made yet shows its middle one till it is (a tile or two a frame).
  setView(v: { x: number; z: number; h: number }, reach = v.h * 1.4) {
    const L = this.level, h = v.h;
    const want = L === 0 ? (h > LEVEL_H[0] * 1.12 ? (h > LEVEL_H[1] * 1.12 ? 2 : 1) : 0) : L === 1 ? (h < LEVEL_H[0] * 0.88 ? 0 : h > LEVEL_H[1] * 1.12 ? 2 : 1) : (h < LEVEL_H[1] * 0.88 ? (h < LEVEL_H[0] * 0.88 ? 0 : 1) : 2);
    this.view = { x: v.x, z: v.z, r: reach + this.tile };
    this.level = want;
    if (want === 0) for (const t of this.tiles.values()) if (t.m[0] === undefined && this.near(t) && !this.queue.includes(t)) this.queue.push(t);
    for (const t of this.tiles.values()) this.show(t);
    this.pump();
  }
  private near(t: Tile) {
    const T = this.tile, v = this.view;
    return Math.hypot(Math.max(t.i * T - v.x, 0, v.x - (t.i + 1) * T), Math.max(t.j * T - v.z, 0, v.z - (t.j + 1) * T)) < v.r;
  }
  // (near levels made a tile a tick, nearest first, between frames)
  private pump() {
    if (this.pumping || !this.queue.length) return;
    this.pumping = true;
    setTimeout(() => {
      this.pumping = false;
      const v = this.view, T = this.tile, d = (t: Tile) => Math.hypot((t.i + 0.5) * T - v.x, (t.j + 0.5) * T - v.z);
      this.queue.sort((a, b) => d(a) - d(b));
      const t = this.queue.shift();
      if (t && t.m[0] === undefined && this.level === 0 && this.near(t)) { this.make(t, 0); this.show(t); }
      this.pump();
    }, 0);
  }
  private show(t: Tile) {
    let L = this.level;
    while (L < 2 && t.m[L] === undefined) L++;
    for (let k = 0; k < 3; k++) { const m = t.m[k]; if (m) m.visible = k === L; }
  }
  private make(t: Tile, level: number) {
    const t0 = performance.now(), T = this.tile;
    const m = this.mesh({ x0: t.i * T, z0: t.j * T, x1: (t.i + 1) * T, z1: (t.j + 1) * T }, LEVELS[level]);
    t.m[level] = m;
    if (m) { m.visible = false; this.group.add(m); this.stats.tris += (m.geometry.index?.count ?? 0) / 3; }
    this.stats.ms += performance.now() - t0; this.stats.built++;
  }
  private drop(t: Tile) {
    for (let k = 0; k < 3; k++) { const m = t.m[k]; if (m) { this.group.remove(m); m.geometry.dispose(); this.stats.tris -= (m.geometry.index?.count ?? 0) / 3; } t.m[k] = undefined; }
  }

  // Trees along the woods' edges, one every `spacing` metres or so, 3 m in: they stand out of the
  // canopy close up (the game plants them with its other trees). Where the painted wood reaches.
  fringe(spacing: number): { x: number; z: number; s: number; conifer: boolean }[] {
    const L = this.ground.layout, P = L.plan, out: { x: number; z: number; s: number; conifer: boolean }[] = [];
    if (!P || !this.ground.cover) return out;
    P.plan.lines.forEach((l, n) => {
      const [p, q] = L.sides(n);
      if ((p === 'wood') === (q === 'wood')) return;
      const len = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z), ux = (l.b.x - l.a.x) / len, uz = (l.b.z - l.a.z) / len;
      const side = p === 'wood' ? 1 : -1, nx = -uz * side, nz = ux * side; // (towards the wood)
      for (let d = spacing * hash2(n, 1, 71); d < len; d += spacing * (0.6 + 0.8 * hash2(n, Math.round(d), 72))) {
        const r = hash2(n, Math.round(d), 73), off = 2.6 + r * 2.4, x = l.a.x + ux * d + nx * off, z = l.a.z + uz * d + nz * off;
        const f = P.fieldAt(x, z);
        if (f < 0 || this.woodAt(x, z) < 0.45) continue;
        const inf = L.aboutId(f);
        if (inf.kind !== 'wood') continue;
        out.push({ x, z, s: 1 + r * 0.5, conifer: !!inf.conifer });
      }
    });
    return out;
  }

  // the cover map's woodland weight at a point (bilinear between texel centres)
  private woodAt(x: number, z: number) {
    const C = this.ground.cover!, R = C.region, t = C.texel, n = R.n, a = C.a;
    const gx = (x - R.x0) / t - 0.5, gz = (z - R.z0) / t - 0.5, i = Math.max(0, Math.min(n - 2, Math.floor(gx))), j = Math.max(0, Math.min(n - 2, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    const w = (ii: number, jj: number) => Math.max(0, (a[(jj * n + ii) * 4 + 2] - 127.5) / 127.5);
    return (w(i, j) * (1 - fx) + w(i + 1, j) * fx) * (1 - fz) + (w(i, j + 1) * (1 - fx) + w(i + 1, j + 1) * fx) * fz;
  }

  // The canopy over a box, on a grid of `g` metres, or null if there's no wood in it.
  private mesh(box: Box, g: number): THREE.Mesh | null {
    const L = this.ground.layout, P = L.plan!, R = this.ground.cover!.region;
    const n = Math.round((box.x1 - box.x0) / g) + 1;
    // which grid points are in a wood (0: no; 1: broadleaf; 2: conifer)
    const kind = new Uint8Array(n * n);
    let any = false;
    for (const f of P.fieldsNear(box)) {
      const inf = L.aboutId(f);
      if (inf.kind !== 'wood') continue;
      const b = P.boxes[f], v = inf.conifer ? 2 : 1;
      const ia = Math.max(0, Math.ceil((b.x0 - box.x0) / g)), ib = Math.min(n - 1, Math.floor((b.x1 - box.x0) / g));
      const ja = Math.max(0, Math.ceil((b.z0 - box.z0) / g)), jb = Math.min(n - 1, Math.floor((b.z1 - box.z0) / g));
      for (let jj = ja; jj <= jb; jj++) for (let ii = ia; ii <= ib; ii++) {
        const x = box.x0 + ii * g, z = box.z0 + jj * g;
        if (x < R.x0 || z < R.z0 || x > R.x0 + R.size || z > R.z0 + R.size) continue;
        if (P.fieldAt(x, z) === f) { kind[jj * n + ii] = v; any = true; }
      }
    }
    if (!any) return null;
    // heights: the crowns' lumpy top, brought down to the ground over the wood's last few metres
    const hgt = new Float32Array(n * n).fill(SUNK), shadeK = new Float32Array(n * n), crownOf = new Uint32Array(n * n), used = new Int32Array(n * n).fill(-1);
    for (let q = 0; q < n * n; q++) {
      const kd = kind[q];
      if (!kd) continue;
      const x = box.x0 + (q % n) * g, z = box.z0 + Math.floor(q / n) * g;
      const w = this.woodAt(x, z), e = smooth(0.2, 1, w) * (0.72 + 0.28 * vnoise(x, z, 17, 55)); // (the edge's trees stand at all heights)
      if (e <= 0) continue;
      let top: number, s: number;
      if (g <= 4) {
        // crowns: domes round jittered points (a spire each in a plantation), with dark gaps between
        const c = crownAt(x, z, kd === 2);
        s = c.dome;
        top = (kd === 2 ? 12 + c.size * 2 + c.dome * 4 : 9 + c.size * 2.4 + c.dome * 2.8) + vnoise(x, z, 70, 53) * 2;
        crownOf[q] = c.id;
      } else {
        s = vnoise(x, z, g * 2.5, 51);
        top = (kd === 2 ? 13.5 : 10) + vnoise(x, z, 70, 53) * 2.5 + s * (g < 12 ? 3.2 : 1.6);
        crownOf[q] = Math.floor(vnoise(x, z, 25, 54) * 97);
      }
      hgt[q] = SUNK + (top - SUNK) * e;
      shadeK[q] = s * e; // (the wood's edge, going down into the ground, in the shade under the crowns)
    }
    // the triangles: each grid square with a corner up in the canopy (its sunk corners take it into the ground)
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const c = new THREE.Color();
    const vert = (q: number) => {
      if (used[q] >= 0) return used[q];
      const ii = q % n, jj = Math.floor(q / n), x = box.x0 + ii * g, z = box.z0 + jj * g;
      used[q] = pos.length / 3;
      pos.push(x, hgt[q], z);
      const kd = kind[q] || 1, set = kd === 2 ? this.cols.conifer : this.cols.broad, s = shadeK[q];
      // each crown its own shade; darker down in the gaps between them
      c.copy(set[crownOf[q] % set.length]).multiplyScalar((kd === 2 ? 0.72 : 0.66) + 0.4 * s + 0.12 * ((crownOf[q] >>> 3) % 5) / 4);
      col.push(c.r, c.g, c.b);
      return used[q];
    };
    for (let jj = 0; jj + 1 < n; jj++) for (let ii = 0; ii + 1 < n; ii++) {
      const q00 = jj * n + ii, q10 = q00 + 1, q01 = q00 + n, q11 = q01 + 1;
      if (hgt[q00] <= 0 && hgt[q10] <= 0 && hgt[q01] <= 0 && hgt[q11] <= 0) continue;
      const a = vert(q00), b = vert(q10), d = vert(q01), e = vert(q11);
      // (anticlockwise seen from above, with y up and z towards the viewer)
      idx.push(a, d, b, b, d, e);
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, this.material);
    m.castShadow = true; m.receiveShadow = true;
    m.name = `canopy ${g}m`;
    return m;
  }

  dispose() {
    for (const t of this.tiles.values()) this.drop(t);
    this.tiles.clear();
    this.group.clear();
    this.material.dispose();
  }
}
