// One tile of the world, ready to draw (docs/streaming.md, "Tiles and levels"). The map is a
// quadtree of three tile sizes: 1 km tiles close up (at two levels of detail, near and mid), 4 km
// tiles further out (far) and 16 km tiles for the whole map at once (vast). A tile is made from the
// plan and its own key alone, the same every time, in a worker (tile.worker.ts), as plain typed
// arrays the view turns straight into meshes:
//
//   ground  the terrain grid (heights come from the drape shader; this is the water's beds and the
//           normals), with skirts down its edges, and its cover map (fields, woods, gardens, verges)
//   water   the sea and lakes (flat, at the water's level) and the rivers (ribbons on the valley floor)
//   solid   everything else, in one vertex-coloured mesh: buildings, streets and junctions, trunk
//           roads with their markings, railways and stations, farmsteads
//   trees   the woods' trees (near and mid)
//   hedges  hedgerow pieces and their trees (near)
//
// Everything belongs to exactly one tile (a building by its centre, a street by its middle, a stretch
// of trunk road by each piece's middle), so nothing is drawn twice and tiles meet without a seam.
// Pure: no three.js.
import { LEVEL } from '../region/water';
import { industryScene } from './industry';
import { settlementScene, WALLS, ROOFS, type SceneBuilding } from './towns';
import { canopyIn, clipPath, countryInput, farmsIn, hedges, paintCover, woodTrees, type Box } from './country';
import { LIVE_HALF, type WorldPlan } from './plan';
import type { XZ } from '../region/water';
import { Occupancy } from '../ground/hedgerows';

export type Detail = 'near' | 'mid' | 'far' | 'vast';
export const LEVEL_SIZE = [1000, 4000, 16000] as const; // metres across a tile at each level
export const LEVEL_OF: Record<Detail, number> = { near: 0, mid: 0, far: 1, vast: 2 };
const TEXEL: Record<Detail, number> = { near: 4, mid: 8, far: 16, vast: 64 }; // cover metres per texel
const CANOPY: Record<Detail, number> = { near: 5, mid: 10, far: 24, vast: 64 }; // the woods' canopy's grid (m)
const STEP: Record<Detail, number> = { near: 25, mid: 50, far: 100, vast: 200 }; // ground grid (the drape field's is 50 m)
// how much wider trunk roads, railways and rivers are drawn further out, so the network reads as a map
const WIDEN: Record<Detail, number> = { near: 1, mid: 1.15, far: 1.8, vast: 3.2 };

// (with `settlement`, just that place's buildings and streets, wherever it is: a place in the live
// play area that isn't live yet, drawn as scenery until it is)
export interface TileRequest { level: number; i: number; j: number; detail: Detail; settlement?: number }
export interface MeshArrays { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint32Array }
export interface TileData {
  key: string; level: number; i: number; j: number; detail: Detail;
  box: Box; // what the tile covers (clipped to the map)
  ground: { pos: Float32Array; nor: Float32Array; idx: Uint32Array; cover: Uint8Array; n: number } | null;
  water: { pos: Float32Array; idx: Uint32Array } | null;
  solid: MeshArrays | null;
  bld: MeshArrays | null; // (near: the places' buildings on their own, so the view can swap them for real ones up close: game/dress.ts)
  trees: Float32Array; // x, z, scale, kind
  hedges: { pieces: Float32Array; trees: Float32Array } | null; // x, z, a, len, h, w · x, z, s, kind
  stats: { ms: number; buildings: number; trees: number; tris: number };
}
export const tileKey = (level: number, i: number, j: number) => `${level}:${i},${j}`;
export function tileBox(level: number, i: number, j: number): Box { const S = LEVEL_SIZE[level]; return { x0: i * S, z0: j * S, x1: (i + 1) * S, z1: (j + 1) * S }; }
// The live play area (a square of far tiles round the middle): no scenery is made there.
export const LIVE: Box = { x0: -LIVE_HALF, z0: -LIVE_HALF, x1: LIVE_HALF, z1: LIVE_HALF };
export const inLive = (b: Box) => b.x0 >= LIVE.x0 && b.x1 <= LIVE.x1 && b.z0 >= LIVE.z0 && b.z1 <= LIVE.z1;
export const touchesLive = (b: Box) => b.x0 < LIVE.x1 && b.x1 > LIVE.x0 && b.z0 < LIVE.z1 && b.z1 > LIVE.z0;

// ---------------- colours ----------------
// sRGB hex to the linear floats vertex colours take
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const cache = new Map<string, [number, number, number]>();
export function rgb(hex: string): [number, number, number] {
  let c = cache.get(hex);
  if (!c) { const n = parseInt(hex.slice(1), 16); c = [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]; cache.set(hex, c); }
  return c;
}
const COL = {
  asphalt: '#55585d', trunk: '#4d5055', motorway: '#4a4d52', foot: '#a39e95', line: '#e8e6df', yellow: '#d9b93b', median: '#6f7f4c', barrier: '#9a9c9e',
  ballast: '#857b70', rail: '#4d4843', platform: '#b9b3a8', station: '#8c5b45', stationRoof: '#4a4f57', glass: '#46586a',
};

// ---------------- mesh building ----------------
class Out {
  pos: number[] = []; nor: number[] = []; col: number[] = []; idx: number[] = [];
  private v(x: number, y: number, z: number, n: [number, number, number], c: [number, number, number]) { this.pos.push(x, y, z); this.nor.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); return this.pos.length / 3 - 1; }
  quad(a: number[], b: number[], c: number[], d: number[], n: [number, number, number], ca: [number, number, number], cb = ca) {
    const i = this.v(a[0], a[1], a[2], n, ca), j = this.v(b[0], b[1], b[2], n, ca), k = this.v(c[0], c[1], c[2], n, cb), l = this.v(d[0], d[1], d[2], n, cb);
    this.idx.push(i, j, k, i, k, l);
  }
  tri(a: number[], b: number[], c: number[], n: [number, number, number], col: [number, number, number]) { const i = this.v(a[0], a[1], a[2], n, col), j = this.v(b[0], b[1], b[2], n, col), k = this.v(c[0], c[1], c[2], n, col); this.idx.push(i, j, k); }
  get tris() { return this.idx.length / 3; }
  arrays(): MeshArrays | null {
    if (!this.idx.length) return null;
    return { pos: new Float32Array(this.pos), nor: new Float32Array(this.nor), col: new Float32Array(this.col), idx: new Uint32Array(this.idx) };
  }
}
const UP: [number, number, number] = [0, 1, 0];
// A flat strip along a path, between offsets `a` and `b` (metres left of the centre line), at `y`.
// `norms` are the path's normals (from the whole path, so neighbouring tiles' pieces meet exactly).
function strip(o: Out, P: XZ[], N: XZ[], a: number, b: number, y: number, c: [number, number, number], from = 0, to = P.length - 1) {
  for (let i = from; i < to; i++) {
    const p = P[i], q = P[i + 1], n = N[i], m = N[i + 1];
    o.quad([p.x + n.x * a, y, p.z + n.z * a], [p.x + n.x * b, y, p.z + n.z * b], [q.x + m.x * b, y, q.z + m.z * b], [q.x + m.x * a, y, q.z + m.z * a], UP, c);
  }
}
// dashes along a path at offset `off`: `len` metres every `period`, `w` wide
function dashes(o: Out, P: XZ[], off: number, w: number, y: number, len: number, period: number, c: [number, number, number], from = 0, to = P.length - 1, s0 = 0) {
  let s = s0;
  for (let i = from; i < to; i++) {
    const p = P[i], q = P[i + 1], L = Math.hypot(q.x - p.x, q.z - p.z);
    if (L < 1e-6) continue;
    const ux = (q.x - p.x) / L, uz = (q.z - p.z) / L, nx = -uz, nz = ux;
    let t = (period - (s % period)) % period;
    for (; t < L; t += period) {
      const e = Math.min(L, t + len), cx = p.x + nx * off, cz = p.z + nz * off;
      o.quad([cx + ux * t + nx * w / 2, y, cz + uz * t + nz * w / 2], [cx + ux * t - nx * w / 2, y, cz + uz * t - nz * w / 2], [cx + ux * e - nx * w / 2, y, cz + uz * e - nz * w / 2], [cx + ux * e + nx * w / 2, y, cz + uz * e + nz * w / 2], UP, c);
    }
    s += L;
  }
}
// a path's normals (left of the direction of travel), averaged at each point
export function normals(P: XZ[]): XZ[] {
  return P.map((_, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: -(b.z - a.z) / L, z: (b.x - a.x) / L };
  });
}
const DOORS = ['#5a3a2a', '#2f4a3a', '#2d3e5a', '#6b2a2a', '#3a3a3a'];
const shade = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];

// A building: walls (darker at the foot), and a flat roof or a gable along its width. `far` draws a
// box with a flat top in the roof's colour; `vast` only the roof, as a map would.
function building(o: Out, b: SceneBuilding, detail: Detail) {
  const co = Math.cos(b.rot), si = Math.sin(b.rot), hw = b.w / 2, hd = b.d / 2;
  const at = (u: number, v: number, y: number) => [b.x + u * co - v * si, y, b.z + u * si + v * co];
  const wall = rgb(b.wc ?? WALLS[b.wall] ?? WALLS[0]), roof = rgb(b.rc ?? ROOFS[b.roof] ?? ROOFS[0]), foot = shade(wall, 0.72);
  const h = b.h, top = detail === 'near' || detail === 'mid' ? b.ridge : 0;
  if (detail === 'vast') { o.quad(at(-hw, -hd, h), at(-hw, hd, h), at(hw, hd, h), at(hw, -hd, h), UP, roof); return; }
  // walls: -v (front), +u, +v (back), -u
  const faces: [number, number, number, number, [number, number, number]][] = [[-hw, -hd, hw, -hd, [si, 0, -co]], [hw, -hd, hw, hd, [co, 0, si]], [hw, hd, -hw, hd, [-si, 0, co]], [-hw, hd, -hw, -hd, [-co, 0, -si]]];
  for (const [u0, v0, u1, v1, n] of faces) o.quad(at(u1, v1, 0), at(u0, v0, 0), at(u0, v0, h), at(u1, v1, h), n, foot, wall);
  // windows: a darker band every floor on offices, towers and flats (near only)
  if (detail === 'near' && (b.kind === 'office' || b.kind === 'tower' || b.kind === 'flats')) {
    const g = rgb(b.kind === 'flats' ? '#4b5560' : COL.glass), F = b.kind === 'flats' ? 2.9 : 3.6;
    for (let y = 1.2; y + 1.4 < h - 0.5; y += F) for (const [u0, v0, u1, v1, n] of faces) {
      const ex = 0.06, ox = n[0] * ex, oz = n[2] * ex, m = 0.9;
      const A = at(u0 * m + u1 * (1 - m), v0 * m + v1 * (1 - m), y), B = at(u1 * m + u0 * (1 - m), v1 * m + v0 * (1 - m), y);
      o.quad([B[0] + ox, y, B[2] + oz], [A[0] + ox, y, A[2] + oz], [A[0] + ox, y + 1.4, A[2] + oz], [B[0] + ox, y + 1.4, B[2] + oz], n, g);
    }
  }
  // houses, terraces, shops and farmhouses up close: windows on both long sides, a door at the front
  // (the street side), and a chimney on the ridge
  if (detail === 'near' && (b.kind === 'house' || b.kind === 'terrace' || b.kind === 'shop' || b.kind === 'farm')) {
    const g = rgb('#3a4450'), dr = rgb(DOORS[(b.wall + b.roof) % DOORS.length]), floors = Math.max(1, Math.round(h / 2.7)), slots = Math.max(1, Math.floor(b.w / 2.9));
    const put = (u: number, y: number, ww: number, hh: number, front: boolean, c: [number, number, number]) => {
      const v = front ? -hd - 0.04 : hd + 0.04, n: [number, number, number] = front ? [si, 0, -co] : [-si, 0, co];
      const a = at(u - ww / 2, v, y), e = at(u + ww / 2, v, y);
      if (front) o.quad([e[0], y, e[2]], [a[0], y, a[2]], [a[0], y + hh, a[2]], [e[0], y + hh, e[2]], n, c);
      else o.quad([a[0], y, a[2]], [e[0], y, e[2]], [e[0], y + hh, e[2]], [a[0], y + hh, a[2]], n, c);
    };
    for (let f = 0; f < floors; f++) for (let k = 0; k < slots; k++) {
      const u = -hw + (b.w / slots) * (k + 0.5), y = 0.9 + f * 2.7;
      if (y + 1.2 > h - 0.2) continue;
      const door = f === 0 && k === (slots > 2 ? 1 : 0) && b.kind !== 'shop';
      if (door) put(u, 0, 0.95, 2.1, true, dr);
      else if (f === 0 && b.kind === 'shop') put(u, 0.5, (b.w / slots) * 0.8, 2.2, true, g);
      else put(u, y, 1.1, 1.25, true, g);
      put(u, y, 1.1, 1.25, false, g);
    }
    if (top && b.kind !== 'shop') {
      const cu = hw - 0.9, ch = h + top + 0.9, cw = 0.35;
      const C = (du: number, dv: number, y: number) => at(cu + du, dv, y);
      const cc = rgb(b.wc ?? WALLS[b.wall] ?? WALLS[0]), cn: [number, number, number][] = [[si, 0, -co], [co, 0, si], [-si, 0, co], [-co, 0, -si]];
      const cs: [number, number, number, number][] = [[-cw, -cw, cw, -cw], [cw, -cw, cw, cw], [cw, cw, -cw, cw], [-cw, cw, -cw, -cw]];
      cs.forEach(([u0, v0, u1, v1], k) => o.quad(C(u1, v1, h + top - 0.6), C(u0, v0, h + top - 0.6), C(u0, v0, ch), C(u1, v1, ch), cn[k], shade(cc, 0.85)));
      o.quad(C(-cw, -cw, ch), C(-cw, cw, ch), C(cw, cw, ch), C(cw, -cw, ch), UP, shade(cc, 0.6));
    }
  }
  if (!top) { o.quad(at(-hw, -hd, h), at(-hw, hd, h), at(hw, hd, h), at(hw, -hd, h), UP, roof); return; }
  // a gable: the ridge along u at v = 0, the slopes down to the front and back eaves (a little overhang)
  const r = h + top, ov = 0.35, s = Math.hypot(hd + ov, top), ny = (hd + ov) / s, nh = top / s;
  const nf: [number, number, number] = [si * nh, ny, -co * nh], nb: [number, number, number] = [-si * nh, ny, co * nh];
  o.quad(at(hw + ov, -hd - ov, h - 0.12), at(-hw - ov, -hd - ov, h - 0.12), at(-hw - ov, 0, r), at(hw + ov, 0, r), nf, roof);
  o.quad(at(-hw - ov, hd + ov, h - 0.12), at(hw + ov, hd + ov, h - 0.12), at(hw + ov, 0, r), at(-hw - ov, 0, r), nb, roof);
  o.tri(at(hw, hd, h), at(hw, -hd, h), at(hw, 0, r), [co, 0, si], wall);
  o.tri(at(-hw, -hd, h), at(-hw, hd, h), at(-hw, 0, r), [-co, 0, -si], wall);
}

// ---------------- the tile ----------------
export function generateTile(plan: WorldPlan, req: TileRequest): TileData {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const { level, i, j, detail } = req, full = tileBox(level, i, j), H = plan.half;
  const box: Box = { x0: Math.max(full.x0, -H), z0: Math.max(full.z0, -H), x1: Math.min(full.x1, H), z1: Math.min(full.z1, H) };
  const key = tileKey(level, i, j);
  const empty = (): TileData => ({ key, level, i, j, detail, box, ground: null, water: null, solid: null, bld: null, trees: new Float32Array(0), hedges: null, stats: { ms: 0, buildings: 0, trees: 0, tris: 0 } });
  if (req.settlement !== undefined) return placeTile(plan, req.settlement, detail);
  if (box.x1 <= box.x0 || box.z1 <= box.z0 || inLive(box)) return empty();
  const fine = detail === 'near' || detail === 'mid';
  const inTile = (p: XZ) => p.x >= box.x0 && p.x < box.x1 && p.z >= box.z0 && p.z < box.z1 && !(p.x > LIVE.x0 && p.x < LIVE.x1 && p.z > LIVE.z0 && p.z < LIVE.z1);

  // the ground: its cover, and the grid (the beds of lakes and the sea; the heights are the drape's)
  const input = countryInput(plan, box, fine);
  // (the industries' yards are worn ground: no fields, hedges or woods on them)
  for (const ind of plan.industries) if (Math.abs(ind.x - (box.x0 + box.x1) / 2) < (box.x1 - box.x0) / 2 + 200 && Math.abs(ind.z - (box.z0 + box.z1) / 2) < (box.z1 - box.z0) / 2 + 200) (input.plots ??= []).push({ poly: industryScene(ind).yard, kind: 'yard' });
  const { layout, data: cover, n } = paintCover(plan, input, box, TEXEL[detail]);
  const coverData = { a: cover, x0: box.x0, z0: box.z0, size: box.x1 - box.x0, n };
  const ground = groundGrid(plan, box, STEP[detail], touchesLive(box) ? LIVE : null);
  const water = waterMesh(plan, box, STEP[detail], detail);

  // everything solid
  const o = new Out(), ob = detail === 'near' ? new Out() : o;
  let nb = 0;
  const places = plan.grid.inBox(box);
  for (const s of places) {
    if (Math.max(Math.abs(s.x), Math.abs(s.z)) < LIVE_HALF) continue; // (the live play area's are the game's)
    const sc = settlementScene(plan, s);
    if (detail === 'vast' && inTile(s)) patch(o, s.x, s.z, s.r * (s.kind === 'village' ? 0.9 : 1.05), s.seed);
    for (const b of sc.buildings) if (inTile(b)) { building(ob, b, detail); nb++; }
    if (detail === 'vast') continue;
    const widen = detail === 'far' ? 1.6 : 1;
    for (const st of sc.streets) {
      const m = st.path[Math.floor(st.path.length / 2)];
      if (!inTile(m)) continue;
      if (detail === 'far' && st.role === 'street') { strip(o, st.path, normals(st.path), -st.kerb * widen, st.kerb * widen, 0.06, rgb(COL.asphalt)); continue; }
      const N = normals(st.path);
      strip(o, st.path, N, -st.kerb * widen, st.kerb * widen, 0.06, rgb(COL.asphalt));
      if (detail !== 'far') { strip(o, st.path, N, st.kerb, st.half, 0.1, rgb(COL.foot)); strip(o, st.path, N, -st.half, -st.kerb, 0.1, rgb(COL.foot)); }
      if (detail === 'near' && st.kerb >= 3) {
        // (the centre line, stopping short of the junctions)
        const L = st.path.length;
        if (L > 6) dashes(o, st.path, 0, 0.12, 0.14, 3, 9, rgb(COL.line), 2, L - 3);
      }
    }
    if (detail !== 'far') for (const jn of sc.junctions) if (inTile(jn)) disc(o, jn.x, jn.z, jn.r + 0.2, 0.12, rgb(COL.asphalt));
  }
  // farmsteads
  for (const f of fine ? input.farms : farmsIn(plan, box)) if (inTile(f)) { building(o, f, detail); nb++; }
  // the industries: their yards and sheds, chimneys and headframes
  for (const ind of plan.industries) {
    if (!inTile(ind)) continue;
    const sc = industryScene(ind);
    for (const b of sc.buildings) { building(o, b, detail); nb++; }
  }
  // the trunk roads and the railways
  trunk(plan, o, box, detail, inTile);
  // the woods' canopy (countryside: ground/canopy.ts), in the solid mesh, so it costs no draw call
  const cano = canopyIn(plan, layout, coverData, box, CANOPY[detail], inTile);
  if (cano) { const base = o.pos.length / 3; for (const v of cano.pos) o.pos.push(v); for (const v of cano.nor) o.nor.push(v); for (const v of cano.col) o.col.push(v); for (const k of cano.idx) o.idx.push(k + base); }
  // trees along the woods' edges, standing out of the canopy; hedgerows
  let trees = new Float32Array(0), hedge: TileData['hedges'] = null;
  if (fine) {
    const all = woodTrees(layout, coverData, box, detail === 'near' ? 14 : 24);
    // (clear of the roads, railways and plots: they're painted as verge and garden, not wood)
    const occ = new OccFree(input);
    const kept: number[] = [];
    for (let k = 0; k < all.length; k += 4) if (inTile({ x: all[k], z: all[k + 1] }) && occ.free(all[k], all[k + 1])) kept.push(all[k], all[k + 1], all[k + 2] * (detail === 'mid' ? 1.6 : 1.45), all[k + 3]);
    trees = new Float32Array(kept);
    if (detail === 'near') {
      const hg = hedges(layout, input, box), keep = (p: XZ) => inTile(p);
      const ps = hg.pieces.filter(keep), ts = hg.trees.filter(keep);
      hedge = { pieces: new Float32Array(ps.flatMap((p) => [p.x, p.z, p.a, p.len, p.h, p.w])), trees: new Float32Array(ts.flatMap((t) => [t.x, t.z, t.s, t.kind])) };
    }
  }
  const solid = o.arrays(), bld = ob !== o ? ob.arrays() : null;
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { key, level, i, j, detail, box, ground: { ...ground, cover, n }, water, solid, bld, trees, hedges: hedge, stats: { ms, buildings: nb, trees: trees.length / 4, tris: o.tris + (ob !== o ? ob.tris : 0) + ground.idx.length / 3 } };
}

// One place's buildings, streets and junctions on their own (see TileRequest).
function placeTile(plan: WorldPlan, id: number, detail: Detail): TileData {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const s = plan.settlements[id], sc = settlementScene(plan, s), o = new Out(), ob = detail === 'near' ? new Out() : o, R = s.reach + 200;
  const box = { x0: s.x - R, z0: s.z - R, x1: s.x + R, z1: s.z + R };
  for (const b of sc.buildings) building(ob, b, detail);
  for (const st of sc.streets) {
    const N = normals(st.path);
    strip(o, st.path, N, -st.kerb, st.kerb, 0.06, rgb(COL.asphalt));
    strip(o, st.path, N, st.kerb, st.half, 0.1, rgb(COL.foot)); strip(o, st.path, N, -st.half, -st.kerb, 0.1, rgb(COL.foot));
    if (detail === 'near' && st.kerb >= 3 && st.path.length > 6) dashes(o, st.path, 0, 0.12, 0.14, 3, 9, rgb(COL.line), 2, st.path.length - 3);
  }
  for (const jn of sc.junctions) disc(o, jn.x, jn.z, jn.r + 0.2, 0.12, rgb(COL.asphalt));
  // its roads in the live area not built on the Network yet (they are once both ends are live: live.ts)
  const inArea = (p: XZ) => Math.max(Math.abs(p.x), Math.abs(p.z)) < LIVE_HALF;
  for (const r of plan.roads) {
    if (r.kind === 'motorway' || (r.a !== id && r.b !== id)) continue;
    const P = r.path, N = normalsOf(P), half = r.kind === 'A' ? 3.9 : 3.6, y = r.kind === 'A' ? 0.15 : 0.13;
    for (const [a, b] of runsIn(P, inArea)) {
      strip(o, P, N, -half, half, y, rgb(COL.trunk), a, b);
      if (detail === 'near') dashes(o, P, 0, 0.12, y + 0.02, r.kind === 'A' ? 4 : 3, r.kind === 'A' ? 13 : 9, rgb(COL.line), a, b);
    }
  }
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  return { key: `place:${id}`, level: 0, i: 0, j: 0, detail, box, ground: null, water: null, solid: o.arrays(), bld: ob !== o ? ob.arrays() : null, trees: new Float32Array(0), hedges: null, stats: { ms, buildings: sc.buildings.length, trees: 0, tris: o.tris + (ob !== o ? ob.tris : 0) } };
}

// is a point clear of the roads, railways, plots and water? (as the ground's hedge planner asks it)
class OccFree { private o: Occupancy; constructor(input: ConstructorParameters<typeof Occupancy>[0]) { this.o = new Occupancy(input); } free(x: number, z: number) { return this.o.free(x, z, 3); } }

// a place's built-up area from far off: a wobbly patch of streets and yards
function patch(o: Out, x: number, z: number, r: number, seed: number) {
  const n = 28, c = rgb('#8c847a'), w1 = (seed % 628) / 100, w2 = ((seed >> 10) % 628) / 100;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2;
    const ra = r * (1 + 0.14 * Math.sin(3 * a + w1) + 0.08 * Math.sin(5 * a + w2)), rb = r * (1 + 0.14 * Math.sin(3 * b + w1) + 0.08 * Math.sin(5 * b + w2));
    o.tri([x, 0.08, z], [x + Math.cos(b) * rb, 0.08, z + Math.sin(b) * rb], [x + Math.cos(a) * ra, 0.08, z + Math.sin(a) * ra], UP, c);
  }
}
function disc(o: Out, x: number, z: number, r: number, y: number, c: [number, number, number]) {
  const n = 14;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2;
    o.tri([x, y, z], [x + Math.cos(b) * r, y, z + Math.sin(b) * r], [x + Math.cos(a) * r, y, z + Math.sin(a) * r], UP, c);
  }
}

// The trunk roads and railways through a tile: the pieces whose middles are in it.
const routeNormals = new WeakMap<XZ[], XZ[]>();
const normalsOf = (P: XZ[]) => { let n = routeNormals.get(P); if (!n) routeNormals.set(P, (n = normals(P))); return n; };
function runsIn(P: XZ[], inTile: (p: XZ) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  for (let k = 0; k + 1 < P.length; k++) {
    const m = { x: (P[k].x + P[k + 1].x) / 2, z: (P[k].z + P[k + 1].z) / 2 }, ins = inTile(m);
    if (ins && a < 0) a = k;
    if (!ins && a >= 0) { out.push([a, k]); a = -1; }
  }
  if (a >= 0) out.push([a, P.length - 1]);
  return out;
}
function trunk(plan: WorldPlan, o: Out, box: Box, detail: Detail, inTile: (p: XZ) => boolean) {
  const k = WIDEN[detail], near = detail === 'near';
  const pad = 60, B = { x0: box.x0 - pad, z0: box.z0 - pad, x1: box.x1 + pad, z1: box.z1 + pad };
  const nearBox = (P: XZ[]) => clipPath(P, B).length > 0;
  for (const r of plan.roads) {
    if (detail === 'vast' && r.kind === 'B') continue;
    const P = r.path;
    if (!nearBox(P)) continue;
    const N = normalsOf(P), line = rgb(COL.line);
    for (const [a, b] of runsIn(P, inTile)) {
      if (r.kind === 'motorway') {
        const y = 0.17;
        strip(o, P, N, 1.5 * k, 15.8 * k, y, rgb(COL.motorway), a, b); strip(o, P, N, -15.8 * k, -1.5 * k, y, rgb(COL.motorway), a, b);
        strip(o, P, N, -1.5 * k, 1.5 * k, y - 0.01, rgb(detail === 'vast' ? COL.motorway : COL.median), a, b);
        if (near) {
          for (const s of [1, -1]) {
            strip(o, P, N, s * 1.8, s * 1.95, y + 0.02, line, a, b); strip(o, P, N, s * 12.35, s * 12.5, y + 0.02, line, a, b);
            dashes(o, P, s * 5.3, 0.12, y + 0.02, 2, 9, line, a, b); dashes(o, P, s * 8.95, 0.12, y + 0.02, 2, 9, line, a, b);
          }
        }
      } else {
        const half = (r.kind === 'A' ? 3.9 : 3.6) * k, y = r.kind === 'A' ? 0.15 : 0.13;
        strip(o, P, N, -half, half, y, rgb(COL.trunk), a, b);
        if (near) { dashes(o, P, 0, 0.12, y + 0.02, r.kind === 'A' ? 4 : 3, r.kind === 'A' ? 13 : 9, line, a, b); strip(o, P, N, half - 0.3, half - 0.18, y + 0.02, line, a, b); strip(o, P, N, -half + 0.18, -half + 0.3, y + 0.02, line, a, b); }
      }
    }
  }
  for (const r of plan.rails) {
    const P = r.path;
    if (!nearBox(P)) continue;
    const N = normalsOf(P), main = r.kind === 'main';
    for (const [a, b] of runsIn(P, inTile)) {
      const bh = (main ? 4.3 : 2.4) * (detail === 'near' || detail === 'mid' ? 1 : k * 0.8);
      strip(o, P, N, -bh, bh, 0.05, rgb(detail === 'vast' || detail === 'far' ? '#6d6259' : COL.ballast), a, b);
      if (detail === 'near' || detail === 'mid') for (const c of main ? [-2, 2] : [0]) for (const s of [-0.72, 0.72]) strip(o, P, N, c + s - 0.05, c + s + 0.05, 0.22, rgb(COL.rail), a, b);
    }
    // stations: platforms either side and a building (near and mid)
    if (detail === 'near' || detail === 'mid') for (const st of r.stations) {
      if (!inTile(st) || Math.max(Math.abs(st.x), Math.abs(st.z)) < LIVE_HALF) continue;
      const rot = Math.atan2(st.uz, st.ux), off = main ? 5.3 : 3.4, nx = -Math.sin(rot), nz = Math.cos(rot);
      for (const s of [1, -1]) building(o, { x: st.x + nx * off * s, z: st.z + nz * off * s, w: 140, d: 3.2, rot, h: 0.9, ridge: 0, wall: 12, roof: 6, kind: 'shed', settlement: -1 }, detail);
      building(o, { x: st.x + nx * (off + 9), z: st.z + nz * (off + 9), w: 22, d: 10, rot, h: 6, ridge: 3, wall: 1, roof: 0, kind: 'house', settlement: -1 }, detail);
    }
  }
  // rivers: ribbons of water on the valley floor (drawn with the water; see waterMesh)
}

// The terrain grid of a tile: its corners every `step` metres, clipped to the map, dipping into
// the beds of lakes and the sea, with normals from the hills (the heights themselves are added by
// the drape shader, from the same field everything else follows), and skirts down each edge so a
// coarser neighbour never shows a crack.
function groundGrid(plan: WorldPlan, b: Box, step: number, hole: Box | null = null) {
  const nx = Math.round((b.x1 - b.x0) / step) + 1, nz = Math.round((b.z1 - b.z0) / step) + 1;
  const T = plan.terrain, pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const e = Math.min(12, step / 2);
  const ht = (x: number, z: number) => T.heightAt(x, z) + T.bed(x, z);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = Math.min(b.x1, b.x0 + i * step), z = Math.min(b.z1, b.z0 + j * step);
    pos.push(x, T.bed(x, z), z);
    const dx = (ht(x + e, z) - ht(x - e, z)) / (2 * e), dz = (ht(x, z + e) - ht(x, z - e)) / (2 * e), l = Math.hypot(dx, 1, dz);
    nor.push(-dx / l, 1 / l, -dz / l);
  }
  // (split along the (i+1, j)–(i, j+1) diagonal, as the drape field's triangles are)
  // (a hole where the live play area is, if the tile reaches it: its ground is the game's own)
  const cut = (i: number, j: number) => !!hole && i >= 0 && j >= 0 && i < nx - 1 && j < nz - 1 && b.x0 + (i + 0.5) * step > hole.x0 && b.x0 + (i + 0.5) * step < hole.x1 && b.z0 + (j + 0.5) * step > hole.z0 && b.z0 + (j + 0.5) * step < hole.z1;
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) { if (cut(i, j)) continue; const a = j * nx + i, bb = a + 1, c = a + nx, d = c + 1; idx.push(a, c, bb, bb, c, d); }
  // skirts: each edge's vertices again, 40 m down, and a wall between
  const skirt = (ks: number[], flip: boolean) => {
    const base = pos.length / 3;
    for (const k of ks) { pos.push(pos[k * 3], pos[k * 3 + 1] - 40, pos[k * 3 + 2]); nor.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]); }
    for (let m = 0; m + 1 < ks.length; m++) { const a = ks[m], bb = ks[m + 1], c = base + m, d = base + m + 1; if (flip) idx.push(a, c, bb, bb, c, d); else idx.push(a, bb, c, bb, d, c); }
  };
  const row = (j: number) => Array.from({ length: nx }, (_, i) => j * nx + i), col = (i: number) => Array.from({ length: nz }, (_, j) => j * nx + i);
  skirt(row(0), false); skirt(row(nz - 1), true); skirt(col(0), true); skirt(col(nx - 1), false);
  // (and round the hole: each edge between a cell that's there and one that's cut)
  if (hole) for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    if (cut(i, j)) continue;
    const a = j * nx + i;
    if (cut(i, j - 1)) skirt([a, a + 1], true); if (cut(i, j + 1)) skirt([a + nx, a + nx + 1], false);
    if (cut(i - 1, j)) skirt([a, a + nx], false); if (cut(i + 1, j)) skirt([a + 1, a + nx + 1], true);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint32Array(idx) };
}

// The water in a tile: the grid's cells where the sea or a lake is (flat at the water's level), and
// the rivers as ribbons of their own width on the valley floor.
function waterMesh(plan: WorldPlan, b: Box, step: number, detail: Detail): TileData['water'] {
  const pos: number[] = [], idx: number[] = [];
  const T = plan.terrain, s = Math.min(step, 50);
  const nx = Math.round((b.x1 - b.x0) / s), nz = Math.round((b.z1 - b.z0) / s);
  const wet = new Uint8Array((nx + 1) * (nz + 1));
  let any = false;
  const w = plan.water;
  const mayBe = w.world.sea !== null || w.spec.lakes.some((L) => L.x + L.r * 1.4 > b.x0 && L.x - L.r * 1.4 < b.x1 && L.z + L.r * 1.4 > b.z0 && L.z - L.r * 1.4 < b.z1);
  if (mayBe) for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const v = T.bed(b.x0 + i * s, b.z0 + j * s) < LEVEL + 0.05 ? 1 : 0; wet[j * (nx + 1) + i] = v; if (v) any = true; }
  // (each row's runs of wet cells as one quad: the open sea is a few big ones)
  if (any) for (let j = 0; j < nz; j++) {
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      let w = false;
      if (i < nx) {
        const k = j * (nx + 1) + i, cx = b.x0 + (i + 0.5) * s, cz = b.z0 + (j + 0.5) * s;
        const live = cx > LIVE.x0 && cx < LIVE.x1 && cz > LIVE.z0 && cz < LIVE.z1; // (the live area's water is the game's own)
        w = !live && !!(wet[k] | wet[k + 1] | wet[k + nx + 1] | wet[k + nx + 2]);
      }
      if (w && run < 0) run = i;
      if (!w && run >= 0) {
        const x0 = b.x0 + run * s, x1 = b.x0 + i * s, z0 = b.z0 + j * s, v = pos.length / 3;
        pos.push(x0, LEVEL, z0, x1, LEVEL, z0, x1, LEVEL, z0 + s, x0, LEVEL, z0 + s);
        idx.push(v, v + 3, v + 1, v + 1, v + 3, v + 2);
        run = -1;
      }
    }
  }
  // rivers
  const k = WIDEN[detail];
  const inTile = (p: XZ) => p.x >= b.x0 && p.x < b.x1 && p.z >= b.z0 && p.z < b.z1;
  for (const rv of w.world.rivers) {
    const P = rv.path, N = normalsOf(P);
    for (const [a, e] of runsIn(P, inTile)) for (let m = a; m < e; m++) {
      const p = P[m], q = P[m + 1], n = N[m], nn = N[m + 1], hp = (rv.widths[m] / 2) * k, hq = (rv.widths[m + 1] / 2) * k, y = 0.03, v = pos.length / 3;
      pos.push(p.x + n.x * hp, y, p.z + n.z * hp, p.x - n.x * hp, y, p.z - n.z * hp, q.x - nn.x * hq, y, q.z - nn.z * hq, q.x + nn.x * hq, y, q.z + nn.z * hq);
      idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
    }
  }
  if (!idx.length) return null;
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
