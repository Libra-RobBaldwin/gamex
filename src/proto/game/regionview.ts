// A big map drawn in tiles, streamed round the camera (docs/region.md R4, ENGINE.md "The world
// streams"). The world is cut into 1 km tiles (world/tiles.ts) and world/StreamManager picks each
// tile's level of detail:
//
//  - near: everything, as the town draws it: every marking, kerb and lamp (roaddraw.ts drawRoads,
//    one tile at a time), the textured building chunks, full trees and hedgerows;
//  - mid:  roads as plain ribbons (asphalt, footway, ballast, the junctions' surfaces) and the
//    same buildings merged into one flat-coloured mesh a tile;
//  - far:  ribbons, each building as a coloured box, and low-poly trees.
//
// The camera is orthographic, so everything in view is drawn at the same scale: detail is picked
// by the zoom (how many metres a pixel covers), and a tile only drops below it once it's out of
// view. So every tile on screen is at the same level, and a level changes where what it adds or
// takes away is a pixel or less across. Each level is built once and kept (hidden when not
// wanted), and a tile swaps whole, new level in and old out in the same frame, so nothing
// flickers, pops through or fights for the same pixels.
//
// Work is metered: building a tile's level happens a slice at a time (one 250 m cell's roads per
// slice), within a few milliseconds a frame. An edit marks only the cells whose roads or junctions
// changed (their signatures differ); those are redrawn and their tiles swapped.
//
// Precision: a 6 km map is at most 4.5 km from its origin, where a float32 steps in half a
// millimetre, so it needs no floating origin (world/origin.ts is for the 30 km map).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { StreamManager, type Lod, type Ring } from '../world/stream';
import { TILE, keyOf, parseKey, type TileKey } from '../world/tiles';
import { SURFACES, drawRoads, structures, Flat, Solid, type Lamp } from '../roaddraw';
import { kerbOf, type Lot, type Network, type P, type RSeg } from '../roads';
import type { Junction } from '../junction';

export const CELL = 250; // a road cell: a tile is 4 × 4 of them (and the building chunks are cells)
const PER = TILE / CELL;

// the zoom (the view's height in metres) where the levels change, with some slack either way so a
// zoom resting on a threshold doesn't flip back and forth
export const ZOOM = { near: 1000, far: 2600, slack: 0.12 };

interface BuiltLike { lot: Lot; height: number; parts: { m: THREE.Material; g: THREE.BufferGeometry }[]; region?: unknown; dying?: number }
export interface ChunkLike { members: Set<BuiltLike>; group: THREE.Group; dirty: boolean }
export interface RegionHost {
  scene: THREE.Scene;
  net: Network;
  junctions: Map<number, Junction>;
  editing: () => number | null;
  treeMats: { trunk: THREE.Material; crown: THREE.Material }; // (drawRoads' street trees)
  chunks: Map<string, ChunkLike>; // building chunks, CELL metres square
  bound: number;
  ground: Set<THREE.Material>; // grass drawn in the ground's own look (lawns, verges): the ground under a merged tile shows it
}
export interface Tree { x: number; z: number; s: number; kind: number }
export interface View { x: number; z: number; h: number; el: number; az: number }

interface Cell { key: string; sig: string; group: THREE.Group | null; lamps: Lamp[]; drawn: string }
interface Tile {
  key: TileKey; i: number; j: number;
  shown: Lod | null;
  cells: Map<string, Cell>;
  near: { group: THREE.Group; lamps: Lamp[]; sig: string } | null; // the cells' roads, merged
  ribbon: { mesh: THREE.Mesh | null; sig: string } | null;
  bld: { mid: THREE.Mesh | null; far: THREE.Mesh | null; stale: boolean };
  trees: { full: THREE.InstancedMesh[]; low: THREE.InstancedMesh[] };
  busy: boolean; again: boolean; // a refresh under way, and another wanted after it
  bldDue: number; // when changed buildings are next merged again
}

const cellKey = (ci: number, cj: number) => `${ci},${cj}`;
const tileOfCell = (ci: number, cj: number) => keyOf(Math.floor(ci / PER), Math.floor(cj / PER));
export const chunkTile = (chunk: string) => { const [a, b] = chunk.split(',').map(Number); return tileOfCell(a, b); };

// one flat colour for a material: its colour, times its texture's average if it has one
const matCol = new WeakMap<THREE.Material, THREE.Color>();
function colourOf(m: THREE.Material): THREE.Color {
  let c = matCol.get(m);
  if (c) return c;
  const mm = m as THREE.MeshLambertMaterial;
  c = (mm.userData?.tint as THREE.Color | undefined)?.clone() ?? mm.color?.clone() ?? new THREE.Color('#999999');
  const img = mm.map?.image as CanvasImageSource & { width?: number } | undefined;
  if (img && (img as { width?: number }).width) {
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 4;
      const x = cv.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(img, 0, 0, 4, 4);
      const d = x.getImageData(0, 0, 4, 4).data;
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < 64; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; }
      c.multiply(new THREE.Color().setRGB(r / 16 / 255, g / 16 / 255, b / 16 / 255, THREE.SRGBColorSpace));
    } catch { /* (a texture that can't be read keeps its colour) */ }
  }
  matCol.set(m, c);
  return c;
}

// Geometry pieces with a flat colour each, merged into one vertex-coloured, non-indexed mesh.
class Painter {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  add(g: THREE.BufferGeometry, c: THREE.Color) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), vc = g.getAttribute('color'), idx = g.index;
    if (!p) return;
    const count = idx ? idx.count : p.count;
    for (let k = 0; k < count; k++) {
      const v = idx ? idx.getX(k) : k;
      this.pos.push(p.getX(v), p.getY(v), p.getZ(v));
      if (n) this.nor.push(n.getX(v), n.getY(v), n.getZ(v)); else this.nor.push(0, 1, 0);
      if (vc) this.col.push(vc.getX(v) * c.r, vc.getY(v) * c.g, vc.getZ(v) * c.b); else this.col.push(c.r, c.g, c.b);
    }
  }
  flat(pos: number[], c: THREE.Color, normals = false) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (normals) g.computeVertexNormals();
    else g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    this.add(g, c);
    g.dispose();
  }
  mesh(mat: THREE.Material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}

export class RegionView {
  readonly root = new THREE.Group();
  readonly stream: StreamManager<Tile>;
  private tiles = new Map<TileKey, Tile>();
  private band: Lod = 'near';
  private waiting: (() => void)[] = [];
  private frameStart = 0;
  private budget = 5;
  private lampsCache: Lamp[] | null = null;
  // (the flat-coloured materials: roads' ribbons, merged buildings)
  private flatMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private treeGeo: { full: THREE.BufferGeometry[]; low: THREE.BufferGeometry[]; mats: THREE.Material[] } | null = null;
  private cellSigs = new Map<string, string>();
  private segCells = new Map<number, string>(); // (each road's cell, and each junction's: from roadsChanged)
  private nodeCells = new Map<number, string>();
  private chunkTiles = new Map<string, TileKey>();
  stats = { cellsDrawn: 0, ribbons: 0, merges: 0, buildings: 0, lastEditMs: 0 };

  constructor(private host: RegionHost) {
    this.root.name = 'region-tiles';
    host.scene.add(this.root);
    const n = Math.ceil(host.bound / TILE);
    this.stream = new StreamManager<Tile>({
      loader: (req, signal) => this.load(req.key, req.lod, signal),
      rings: this.ringsFor('near', 1000),
      margin: 150,
      bounds: { i0: -n, j0: -n, i1: n - 1, j1: n - 1 },
      maxInFlight: 2,
      budget: { ms: 3 },
      zoomRef: 1e9, // (the rings are set from the zoom here, not grown by the stream)
      reselect: 60,
    });
    this.stream.on('load', (e) => this.show(e.data, e.lod));
    this.stream.on('error', (e) => console.warn('tile', e.key, e.lod, e.error));
  }

  // The trees the woods are made of (main.ts keeps the list; this draws it, a tile at a time).
  setTrees(trees: Tree[], geo: { crown: THREE.BufferGeometry; pine: THREE.BufferGeometry; trunk: THREE.BufferGeometry }, mats: THREE.Material[]) {
    if (!this.treeGeo) {
      const low = [new THREE.IcosahedronGeometry(3.4, 0), new THREE.ConeGeometry(3, 9, 4), new THREE.CylinderGeometry(0.35, 0.5, 3.5, 3)];
      this.treeGeo = { full: [geo.crown, geo.pine, geo.trunk], low, mats };
    }
    const by = new Map<TileKey, Tree[]>();
    for (const t of trees) { const k = keyOf(Math.floor(t.x / TILE), Math.floor(t.z / TILE)); const a = by.get(k); if (a) a.push(t); else by.set(k, [t]); }
    const keys = new Set([...by.keys(), ...[...this.tiles.values()].filter((t) => t.trees.full.length).map((t) => t.key)]);
    for (const k of keys) this.plantTrees(this.tile(k), by.get(k) ?? []);
  }
  private plantTrees(t: Tile, list: Tree[]) {
    const G = this.treeGeo!;
    for (const m of [...t.trees.full, ...t.trees.low]) { this.root.remove(m); m.dispose(); }
    t.trees = { full: [], low: [] };
    if (!list.length) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const oaks = list.filter((x) => x.kind === 0), pines = list.filter((x) => x.kind !== 0);
    for (const level of ['full', 'low'] as const) {
      const geos = G[level];
      const make = (g: THREE.BufferGeometry, mat: THREE.Material, arr: Tree[], place: (x: Tree) => void) => {
        if (!arr.length) return;
        const im = new THREE.InstancedMesh(g, mat, arr.length);
        arr.forEach((x, i) => { place(x); im.setMatrixAt(i, m4.compose(v, q, sc)); });
        im.castShadow = true; im.receiveShadow = true;
        im.computeBoundingSphere();
        im.visible = false;
        this.root.add(im);
        t.trees[level].push(im);
      };
      // (placed as main.ts always placed them)
      make(geos[0], G.mats[0], oaks, (x) => { v.set(x.x, 5.6 * x.s, x.z); sc.set(x.s, x.s * 1.1, x.s); });
      make(geos[1], G.mats[1], pines, (x) => { v.set(x.x, 7 * x.s, x.z); sc.set(x.s, x.s, x.s); });
      make(geos[2], G.mats[2], list, (x) => { v.set(x.x, 1.75 * x.s, x.z); sc.set(x.s, x.s, x.s); });
    }
    this.showTrees(t);
  }
  private showTrees(t: Tile) {
    const low = t.shown === 'far';
    for (const m of t.trees.full) m.visible = t.shown !== null && !low;
    for (const m of t.trees.low) m.visible = t.shown !== null && low;
  }

  private tile(key: TileKey): Tile {
    let t = this.tiles.get(key);
    if (!t) {
      const { i, j } = parseKey(key);
      t = { key, i, j, shown: null, cells: new Map(), near: null, ribbon: null, bld: { mid: null, far: null, stale: true }, trees: { full: [], low: [] }, busy: false, again: false, bldDue: 0 };
      this.tiles.set(key, t);
    }
    return t;
  }

  // ---------- the rings: what the zoom and the view ask for ----------
  // how far from the look-at point the view reaches on the ground (to its furthest corner)
  private reach(v: View, aspect: number) {
    const deep = v.h / Math.max(0.2, Math.sin(v.el)), wide = v.h * aspect;
    return Math.hypot(deep / 2, wide / 2);
  }
  private ringsFor(band: Lod, reach: number): Ring[] {
    const R = reach + 350, all = 1e6;
    if (band === 'near') return [{ lod: 'near', radius: R }, { lod: 'mid', radius: R + TILE }, { lod: 'far', radius: all }];
    if (band === 'mid') return [{ lod: 'mid', radius: R }, { lod: 'far', radius: all }];
    return [{ lod: 'far', radius: all }];
  }
  private bandFor(h: number): Lod {
    const s = ZOOM.slack, b = this.band;
    if (b === 'near') return h > ZOOM.near * (1 + s) ? (h > ZOOM.far * (1 + s) ? 'far' : 'mid') : 'near';
    if (b === 'mid') return h < ZOOM.near * (1 - s) ? 'near' : h > ZOOM.far * (1 + s) ? 'far' : 'mid';
    return h < ZOOM.far * (1 - s) ? (h < ZOOM.near * (1 - s) ? 'near' : 'mid') : 'far';
  }

  // Once a frame, before drawing.
  update(v: View, aspect: number, budgetMs = 5) {
    this.frameStart = performance.now();
    this.budget = budgetMs;
    this.band = this.bandFor(v.h);
    const rings = this.ringsFor(this.band, this.reach(v, aspect));
    (this.stream.rings as Ring[]).splice(0, this.stream.rings.length, ...rings);
    // (the look-at point, the zoom as its span so a zoom re-picks the levels, and which way it looks)
    this.stream.update({ x: v.x, z: v.z, span: v.h, dir: { x: -Math.sin(v.az), z: -Math.cos(v.az) } });
    this.pump();
    // the building chunks: textured only where the tile is near
    for (const [k, c] of this.host.chunks) { const t = this.tiles.get(this.tileOfChunk(k)); c.group.visible = !t || t.shown === 'near' || t.shown === null; }
    // buildings that changed are merged again at most every few seconds a tile (the town grows all the time)
    const now = performance.now();
    for (const t of this.tiles.values()) if (t.bld.stale && t.bldDue && now > t.bldDue && (t.shown === 'mid' || t.shown === 'far')) { t.bldDue = 0; this.stale(t); }
  }
  // let waiting slices run while there's time left this frame (always one)
  private pump() {
    let n = 0;
    while (this.waiting.length && (n === 0 || performance.now() - this.frameStart < this.budget)) { this.waiting.shift()!(); n++; }
  }
  private slice(signal?: AbortSignal) {
    return new Promise<void>((res, rej) => this.waiting.push(() => (signal?.aborted ? rej(new DOMException('aborted', 'AbortError')) : res())));
  }

  // Everything wanted now, built now (the loading screen, and tests): runs slices flat out.
  async settle(v: View, aspect: number, tick?: (f: number) => Promise<void>) {
    for (let guard = 0; guard < 100000; guard++) {
      this.update(v, aspect, 40);
      if (this.stream.settled() && !this.waiting.length && ![...this.tiles.values()].some((t) => t.busy)) break;
      await new Promise((r) => setTimeout(r, 0));
      if (tick && guard % 4 === 0) { const s = this.stream.stats(); await tick((s.byLod.near + s.byLod.mid + s.byLod.far) / Math.max(1, s.wanted)); }
    }
  }

  // ---------- loading a tile's level ----------
  private async load(key: TileKey, lod: Lod, signal: AbortSignal) {
    const t = this.tile(key);
    await this.build(t, lod, signal);
    return t;
  }
  private async build(t: Tile, lod: Lod, signal?: AbortSignal) {
    if (lod === 'near') {
      // roads, a cell at a time, then merged into one mesh a material
      let changed = !t.near;
      for (const c of this.cellsOf(t)) {
        if (c.group && c.drawn === c.sig) continue;
        await this.slice(signal);
        this.drawCell(c);
        changed = true;
      }
      for (const [k, c] of t.cells) if (!this.cellSigs.has(k)) { this.dropCell(c); t.cells.delete(k); changed = true; }
      if (changed || t.near?.sig !== this.tileSig(t)) { await this.slice(signal); this.mergeNear(t); }
    } else {
      if (!t.ribbon || t.ribbon.sig !== this.tileSig(t)) { await this.slice(signal); this.buildRibbon(t); }
      if (t.bld.stale || !(lod === 'mid' ? t.bld.mid : t.bld.far)) { await this.slice(signal); this.buildBuildings(t, lod); }
    }
  }
  // Put a tile's level on show (and the others away), all in one go.
  private show(t: Tile, lod: Lod) {
    t.shown = lod;
    if (t.near) t.near.group.visible = lod === 'near';
    if (t.ribbon?.mesh) t.ribbon.mesh.visible = lod !== 'near';
    if (t.bld.mid) t.bld.mid.visible = lod === 'mid';
    if (t.bld.far) t.bld.far.visible = lod === 'far';
    for (const [k, c] of this.host.chunks) if (this.tileOfChunk(k) === t.key) c.group.visible = lod === 'near';
    this.showTrees(t);
    this.lampsCache = null;
  }

  // ---------- roads ----------
  // The signature of everything a cell's drawing depends on: its roads (their ends, type, shape,
  // stops, bridges and the roads they join), its junctions (their design), the junctions at its
  // roads' ends, and the one being edited. A cell is redrawn only when this changes.
  private jids = new WeakMap<Junction, number>();
  private jn = 0;
  private jsig(node: number) { const j = this.host.junctions.get(node); if (!j) return 0; let n = this.jids.get(j); if (!n) this.jids.set(j, (n = ++this.jn)); return n; }
  private cellOf(p: P) { return cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)); }
  private findCell(s: RSeg) {
    const { net } = this.host, path = net.path(s);
    let L = 0;
    for (let k = 1; k < path.length; k++) L += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
    let t = L / 2;
    for (let k = 1; k < path.length; k++) {
      const d = Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
      if (t <= d || k === path.length - 1) { const f = d ? Math.min(1, t / d) : 0; return this.cellOf({ x: path[k - 1].x + (path[k].x - path[k - 1].x) * f, z: path[k - 1].z + (path[k].z - path[k - 1].z) * f }); }
      t -= d;
    }
    return this.cellOf(path[0]);
  }
  // Work out every cell's signature; returns the cells that changed. Cheap: a pass over the roads.
  roadsChanged(): string[] {
    const { net } = this.host, edit = this.host.editing();
    const at = new Map<number, number[]>();
    for (const s of net.segs.values()) for (const n of [s.a, s.b]) { const a = at.get(n); if (a) a.push(s.id); else at.set(n, [s.id]); }
    const parts = new Map<string, string[]>();
    const put = (k: string, v: string) => { const a = parts.get(k); if (a) a.push(v); else parts.set(k, [v]); };
    this.segCells.clear(); this.nodeCells.clear();
    for (const s of net.segs.values()) {
      const path = net.path(s), e = path[path.length - 1], cell = this.findCell(s);
      this.segCells.set(s.id, cell);
      put(cell, `s${s.id}:${s.type}:${s.oneway ? 1 : 0}:${s.aux ?? 0}:${s.a}:${s.b}:${path.length}:${path[0].x.toFixed(2)},${path[0].z.toFixed(2)},${(path[0].y ?? 0).toFixed(2)}:${e.x.toFixed(2)},${e.z.toFixed(2)},${(e.y ?? 0).toFixed(2)}:${s.mid.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)},${(p.y ?? 0).toFixed(1)}`).join(';')}:${s.stops.map((st) => `${st.id},${st.s.toFixed(1)},${st.side},${st.kind}`).join(';')}:${JSON.stringify(s.bridges ?? 0)}:${this.jsig(s.a)},${this.jsig(s.b)}:${at.get(s.a)!.join(',')}|${at.get(s.b)!.join(',')}`);
    }
    for (const n of net.nodes.values()) this.nodeCells.set(n.id, this.cellOf(n));
    for (const n of net.nodes.values()) put(this.nodeCells.get(n.id)!, `n${n.id}:${n.x.toFixed(2)},${n.z.toFixed(2)},${(n.y ?? 0).toFixed(2)}:${this.jsig(n.id)}:${(at.get(n.id) ?? []).join(',')}${edit === n.id ? ':E' : ''}`);
    const changed: string[] = [];
    const next = new Map<string, string>();
    for (const [k, v] of parts) { const sig = v.join('\n'); next.set(k, sig); if (this.cellSigs.get(k) !== sig) changed.push(k); }
    for (const k of this.cellSigs.keys()) if (!next.has(k)) changed.push(k);
    this.cellSigs = next;
    for (const k of changed) { const [ci, cj] = k.split(',').map(Number); this.stale(this.tile(tileOfCell(ci, cj))); }
    return changed;
  }
  private tileSig(t: Tile) {
    const out: string[] = [];
    for (let a = 0; a < PER; a++) for (let b = 0; b < PER; b++) { const k = cellKey(t.i * PER + a, t.j * PER + b); out.push(`${k}#${this.cellSigs.get(k) ?? ''}`); }
    return out.join('\n');
  }
  private cellsOf(t: Tile): Cell[] {
    const out: Cell[] = [];
    for (let a = 0; a < PER; a++) for (let b = 0; b < PER; b++) {
      const k = cellKey(t.i * PER + a, t.j * PER + b), sig = this.cellSigs.get(k);
      if (sig === undefined) continue;
      let c = t.cells.get(k);
      if (!c) t.cells.set(k, (c = { key: k, sig, group: null, lamps: [], drawn: '' }));
      c.sig = sig;
      out.push(c);
    }
    return out;
  }
  private drawCell(c: Cell) {
    const { net, junctions, treeMats } = this.host, k = c.key;
    const g = new THREE.Group();
    const lamps = drawRoads(net, g, junctions, treeMats.trunk, treeMats.crown, this.host.editing(), { seg: (s) => this.segCells.get(s.id) === k, node: (id) => this.nodeCells.get(id) === k });
    this.dropCell(c);
    c.group = g; c.lamps = lamps; c.drawn = c.sig;
    this.stats.cellsDrawn++;
  }
  private dropCell(c: Cell) {
    if (!c.group) return;
    for (const o of c.group.children) { const m = o as THREE.Mesh; if (!c.lamps.some((l) => l.mesh === m)) m.geometry.dispose(); }
    c.group = null; c.lamps = [];
  }
  // A tile's cells, merged into a mesh for each material (lamps stay as they are: their material is
  // switched every frame).
  private mergeNear(t: Tile) {
    const g = new THREE.Group(), lamps: Lamp[] = [];
    const by = new Map<string, { list: THREE.Mesh[] }>();
    for (const c of t.cells.values()) {
      if (!c.group) continue;
      const lampSet = new Set(c.lamps.map((l) => l.mesh));
      lamps.push(...c.lamps);
      for (const o of c.group.children) {
        const m = o as THREE.Mesh;
        if (lampSet.has(m)) continue;
        const geo = m.geometry, attrs = Object.keys(geo.attributes).sort().join(',');
        const key = `${(m.material as THREE.Material).uuid}|${m.renderOrder}|${m.castShadow}|${m.receiveShadow}|${geo.index ? 1 : 0}|${attrs}`;
        let e = by.get(key);
        if (!e) by.set(key, (e = { list: [] }));
        e.list.push(m);
      }
    }
    for (const { list } of by.values()) {
      const first = list[0];
      const geo = list.length === 1 ? first.geometry.clone() : mergeGeometries(list.map((m) => m.geometry), false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, first.material);
      mesh.renderOrder = first.renderOrder; mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      g.add(mesh);
    }
    for (const l of lamps) g.add(l.mesh);
    g.visible = t.shown === 'near';
    const old = t.near;
    this.root.add(g);
    t.near = { group: g, lamps, sig: this.tileSig(t) };
    if (old) { this.root.remove(old.group); for (const o of old.group.children) { const m = o as THREE.Mesh; if (!old.lamps.some((l) => l.mesh === m)) m.geometry.dispose(); } }
    this.lampsCache = null;
    this.stats.merges++;
  }
  // Every road and junction in the tile as plain surfaces in one flat-coloured mesh: carriageways,
  // footways, ballast, the junctions' aprons and footways, and the walls under raised roads. They
  // sit a few centimetres under where the full drawing puts them, so where a near tile's roads meet
  // a middle one's (only ever off the screen's edge, or for the frame they swap) the full drawing
  // is always the one on top.
  private buildRibbon(t: Tile) {
    const { net, junctions } = this.host, P = new Painter();
    const asph = new Flat(), pave = new Flat(), ballast = new Flat(), body = new Solid();
    const inTile = (p: P) => Math.floor(p.x / TILE) === t.i && Math.floor(p.z / TILE) === t.j;
    for (const s of net.segs.values()) {
      const cell = this.segCells.get(s.id);
      if (!cell) continue;
      const [ci, cj] = cell.split(',').map(Number);
      if (tileOfCell(ci, cj) !== t.key) continue;
      const d = net.def(s), path = net.path(s).map((p) => ({ x: p.x, z: p.z, y: Math.max(0, p.y ?? 0) }));
      if (net.path(s).every((p) => (p.y ?? 0) < -9)) continue; // (a bored tunnel: nothing on the surface)
      const half = net.half(s), kerb = kerbOf(d);
      if (d.cls === 'rail') { ballast.ribbon(path, kerb, 0.17); continue; }
      asph.ribbon(path, kerb, 0.22);
      if (d.pave > 0) pave.ribbon(path, Math.min(half, kerb + d.pave), 0.12);
      if (path.some((p) => p.y > 0.05)) structures(path, body, null, half, s.bridges ? s.bridges.map((b) => [b.s0, b.s1] as [number, number]) : path.every((p) => p.y <= 6) ? [] : undefined);
    }
    for (const n of net.nodes.values()) {
      if (!inTile(n)) continue;
      const j = junctions.get(n.id), sh = j?.shape;
      if (!sh || net.segsAt(n.id).length < 3) continue;
      const y = Math.max(0, n.y ?? 0);
      for (const q of sh.paves) pave.poly(q, y + 0.12);
      for (const q of sh.aprons) asph.poly(q, y + 0.22);
    }
    P.flat(pave.pos, SURFACES.pave[0].color);
    P.flat(asph.pos, SURFACES.asph[0].color);
    P.flat(ballast.pos, new THREE.Color('#8f887c'));
    P.flat(body.pos, new THREE.Color('#b9b5ac'), true);
    const mesh = P.mesh(this.flatMat);
    if (mesh) { mesh.receiveShadow = true; mesh.visible = t.shown !== null && t.shown !== 'near'; this.root.add(mesh); }
    if (t.ribbon?.mesh) { this.root.remove(t.ribbon.mesh); t.ribbon.mesh.geometry.dispose(); }
    t.ribbon = { mesh, sig: this.tileSig(t) };
    this.stats.ribbons++;
  }

  // ---------- buildings ----------
  // A chunk's buildings changed: the tile's merged and boxed buildings are built again when next shown.
  chunkChanged(chunk: string) {
    const t = this.tile(this.tileOfChunk(chunk));
    if (!t.bld.stale) { t.bld.stale = true; t.bldDue = performance.now() + 3000; }
  }
  private buildBuildings(t: Tile, lod: Lod) {
    const members: BuiltLike[] = [];
    for (const [k, c] of this.host.chunks) if (this.tileOfChunk(k) === t.key) for (const b of c.members) if (!b.dying) members.push(b);
    const P = new Painter();
    if (lod === 'mid') {
      for (const b of members) for (const p of b.parts) if (this.solid(p.m)) P.add(p.g, colourOf(p.m));
    } else {
      // each building a box of its footprint and height, walls and roof in its own colours; the
      // parks, grounds and industrial sites as they are
      for (const b of members) {
        if (b.region || b.lot.id < 0 || !b.lot.w) { for (const p of b.parts) if (this.solid(p.m)) P.add(p.g, colourOf(p.m)); continue; }
        this.box(P, b);
      }
    }
    const mesh = P.mesh(this.flatMat);
    if (mesh) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = t.shown === lod; this.root.add(mesh); }
    const old = lod === 'mid' ? t.bld.mid : t.bld.far;
    if (old) { this.root.remove(old); old.geometry.dispose(); }
    if (lod === 'mid') t.bld.mid = mesh; else t.bld.far = mesh;
    // (the other one is out of date now too, if the buildings changed)
    if (t.bld.stale) { const other = lod === 'mid' ? t.bld.far : t.bld.mid; if (other) { this.root.remove(other); other.geometry.dispose(); } if (lod === 'mid') t.bld.far = null; else t.bld.mid = null; }
    t.bld.stale = false;
    this.stats.buildings++;
  }
  // (glass and fences are left out of a merged tile, and so is grass: the ground paints its own)
  private solid(m: THREE.Material) { return !(m as THREE.MeshLambertMaterial).transparent && !this.host.ground.has(m); }
  private tileOfChunk(k: string) { let t = this.chunkTiles.get(k); if (!t) this.chunkTiles.set(k, (t = chunkTile(k))); return t; }
  private boxCols = new WeakMap<BuiltLike, { wall: THREE.Color; roof: THREE.Color }>();
  private box(P: Painter, b: BuiltLike) {
    let cols = this.boxCols.get(b);
    if (!cols) {
      // the colours seen from above (the roof) and from the side (the walls), weighted by area
      const roof = new THREE.Vector3(), wall = new THREE.Vector3();
      let ra = 0, wa = 0;
      const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      for (const p of b.parts) {
        if (!this.solid(p.m)) continue;
        const col = colourOf(p.m), pos = p.g.getAttribute('position'), idx = p.g.index, cnt = idx ? idx.count : pos.count;
        for (let k = 0; k + 2 < cnt; k += 3) {
          const i0 = idx ? idx.getX(k) : k, i1 = idx ? idx.getX(k + 1) : k + 1, i2 = idx ? idx.getX(k + 2) : k + 2;
          a.fromBufferAttribute(pos, i0); bb.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
          n.crossVectors(bb.sub(a), c.sub(a));
          const area = n.length() / 2;
          if (!area) continue;
          if (Math.abs(n.y) / (2 * area) > 0.5) { roof.x += col.r * area; roof.y += col.g * area; roof.z += col.b * area; ra += area; }
          else { wall.x += col.r * area; wall.y += col.g * area; wall.z += col.b * area; wa += area; }
        }
      }
      cols = { roof: ra ? new THREE.Color(roof.x / ra, roof.y / ra, roof.z / ra) : new THREE.Color('#8a6a5a'), wall: wa ? new THREE.Color(wall.x / wa, wall.y / wa, wall.z / wa) : new THREE.Color('#c8bca8') };
      this.boxCols.set(b, cols);
    }
    const l = b.lot, co = Math.cos(l.rot), si = Math.sin(l.rot), hw = l.w / 2, hd = l.d / 2, h = Math.max(3, b.height);
    const corner = (u: number, v: number) => [l.x + u * co - v * si, l.z + u * si + v * co];
    const c4 = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
    const walls: number[] = [], top: number[] = [];
    for (let k = 0; k < 4; k++) {
      const p = c4[k], q = c4[(k + 1) % 4];
      walls.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], 0, p[1], q[0], h, q[1], p[0], h, p[1]);
    }
    top.push(c4[0][0], h, c4[0][1], c4[2][0], h, c4[2][1], c4[1][0], h, c4[1][1], c4[0][0], h, c4[0][1], c4[3][0], h, c4[3][1], c4[2][0], h, c4[2][1]);
    // (wound either way round depending on the lot's rotation: normals from the geometry, both sides lit alike)
    P.flat(walls, cols.wall, true);
    P.flat(top, cols.roof);
  }

  // Something in a tile changed: rebuild what it shows now, in the background, and swap it in.
  private stale(t: Tile, buildings = false) {
    if (buildings) t.bld.stale = true;
    if (!t.shown) return;
    if (t.busy) { t.again = true; return; }
    t.busy = true;
    const run = async () => {
      do {
        t.again = false;
        const lod = t.shown!;
        try { await this.build(t, lod); } catch (e) { console.warn('tile refresh', t.key, e); }
        if (t.shown === lod) this.show(t, lod);
      } while (t.again);
      t.busy = false;
    };
    void run();
  }

  // The signal lamps on show (near tiles), whose colours main.ts sets each frame.
  lamps(): Lamp[] {
    if (!this.lampsCache) { this.lampsCache = []; for (const t of this.tiles.values()) if (t.near && t.shown === 'near') this.lampsCache.push(...t.near.lamps); }
    return this.lampsCache;
  }
  // (for tests and the performance readout)
  levels() { const out: Record<string, Lod | null> = {}; for (const t of this.tiles.values()) out[t.key] = t.shown; return out; }
  get zoomBand() { return this.band; }
}

// A mesh spread over the whole map, cut into one mesh a tile (by where each triangle's middle is),
// so the ones out of view aren't drawn: a river's bed, the map's cut edge. Same material, same look.
export function splitByTile(mesh: THREE.Mesh, size = TILE): THREE.Group {
  const out = new THREE.Group();
  out.name = mesh.name;
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry, pos = geo.getAttribute('position'), idx = geo.index, n = idx ? idx.count : pos.count;
  const names = Object.keys(geo.attributes), by = new Map<string, number[]>(), v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let k = 0; k + 2 < n; k += 3) {
    c.set(0, 0, 0);
    for (let q = 0; q < 3; q++) c.add(v.fromBufferAttribute(pos, idx ? idx.getX(k + q) : k + q));
    c.divideScalar(3).applyMatrix4(mesh.matrixWorld);
    const key = keyOf(Math.floor(c.x / size), Math.floor(c.z / size));
    const a = by.get(key);
    if (a) a.push(k); else by.set(key, [k]);
  }
  for (const tris of by.values()) {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const src = geo.getAttribute(name) as THREE.BufferAttribute, w = src.itemSize;
      const arr = new (src.array.constructor as Float32ArrayConstructor)(tris.length * 3 * w);
      let o = 0;
      for (const k of tris) for (let q = 0; q < 3; q++) { const vi = idx ? idx.getX(k + q) : k + q; for (let e = 0; e < w; e++) arr[o++] = src.array[vi * w + e]; }
      g.setAttribute(name, new THREE.BufferAttribute(arr, w, src.normalized));
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.position.copy(mesh.position); m.rotation.copy(mesh.rotation); m.scale.copy(mesh.scale);
    m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow; m.renderOrder = mesh.renderOrder; m.name = mesh.name;
    out.add(m);
  }
  geo.dispose();
  return out;
}
