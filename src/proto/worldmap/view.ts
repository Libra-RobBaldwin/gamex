// The 50 km world drawn round the camera (docs/streaming.md, "The view"). The map is a quadtree
// of tiles (tilegen.ts): 16 km tiles cover it all at once, each splits into 4 km tiles, and each
// of those into 1 km tiles with near and mid detail. Every frame the view picks, for each part of
// the map, the finest detail the zoom wants there (what's on screen at the zoom's own level, a
// level coarser just off it, coarser again further out) and shows the finest it has ready,
// swapping a tile for its children only once all of them are ready, and back only once it is: so
// the map is always covered exactly once (nothing drawn twice, no holes, nothing fighting), and
// changes only where what it adds or takes away is about a pixel across.
//
// Tiles are made in workers (tile.worker.ts) and turned into meshes here a few milliseconds a
// frame; they're kept while there's room and dropped furthest first. Nothing is made for the live
// play area round the start town: that's the game's own (its Network, drawn by game/regionview.ts).
import * as THREE from 'three';
import { workerLoader } from '../world/worker';
import type { LoadRequest } from '../world/stream';
import { groundUniforms, patchGround, setOrigin, coverTexture, forgetGround, type GroundUniforms } from '../ground/material';
import { CROP_NAMES, PALETTE, type CropName } from '../ground/covers';
import { Hedges } from '../ground/hedges';
import type { HedgeTree, Piece } from '../ground/hedgerows';
import type { StyleLook } from '../region/styles';
import type { RegionOptions } from '../region/options';
import { LEVEL_OF, LEVEL_SIZE, LIVE, inLive, tileBox, tileKey, type Detail, type TileData } from './tilegen';
import type { Box } from './country';
import type { FieldData, WorkerRequest } from './tile.worker';
import { slopeLook } from '../region/terrain';

export interface ViewState { x: number; z: number; h: number; el: number; az: number }
export interface WorldViewHost {
  scene: THREE.Scene;
  options: RegionOptions; // the map's (the workers make its plan from them)
  half: number; // half the map's width
  look: StyleLook;
  trees: { crown: THREE.BufferGeometry; pine: THREE.BufferGeometry; trunk: THREE.BufferGeometry; crownMat: THREE.Material; pineMat: THREE.Material; trunkMat: THREE.Material };
  workers?: number;
}

// the zoom (view height, m) where each detail takes over, with some slack either way
export const WORLD_ZOOM = { near: 1000, mid: 5000, far: 17000, slack: 0.12 };
const ORDER: Detail[] = ['near', 'mid', 'far', 'vast'];
const coarser = (d: Detail, n = 1): Detail => ORDER[Math.min(3, ORDER.indexOf(d) + n)];
const finer = (a: Detail, b: Detail) => ORDER.indexOf(a) < ORDER.indexOf(b);

interface Built { group: THREE.Group; bytes: number; tris: number; dispose(): void }
interface Node { key: string; level: number; i: number; j: number; box: Box; built: Partial<Record<Detail, Built>>; pending: Set<Detail>; used: number }

const distToBox = (x: number, z: number, b: Box) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
const kids = (n: { level: number; i: number; j: number }) => { const out: [number, number, number][] = []; for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) out.push([n.level - 1, n.i * 4 + a, n.j * 4 + b]); return out; };

export class WorldView {
  readonly root = new THREE.Group();
  private nodes = new Map<string, Node>();
  private loaders: { load: (req: WorkerRequest, signal: AbortSignal) => Promise<TileData | FieldData>; busy: number }[] = [];
  private queue: { node: Node; detail: Detail; score: number }[] = [];
  private arrived: { node: Node; detail: Detail; data: TileData }[] = []; // (still pending until built: asked for again meanwhile, a tile's data would pile up here)
  private shown = new Map<string, { node: Node; detail: Detail }>();
  private detailAt: Detail = 'vast';
  private solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private waterMat = new THREE.MeshPhongMaterial({ color: '#3d6f8e', specular: '#5f7f91', shininess: 40 });
  private shared: GroundUniforms;
  private sharedFar: GroundUniforms; // (far and vast tiles: woods seen from above as their canopy, since no trees stand on them)
  private roots: [number, number, number][] = [];
  private low: { crown: THREE.BufferGeometry; pine: THREE.BufferGeometry; trunk: THREE.BufferGeometry } | null = null;
  private tick = 0;
  ready = false; // the height field has arrived: tiles can be shown
  stats = { tiles: 0, built: 0, bytes: 0, tris: 0, requested: 0, arrived: 0, buildMs: 0, shown: 0 };
  budgetMs = 4;
  maxBytes = 64e6; // (typed arrays held for tiles, before they reach the GPU and after: a phone has room for more, but there's no need)

  constructor(private host: WorldViewHost) {
    this.root.name = 'world-tiles';
    host.scene.add(this.root);
    this.shared = groundUniforms(coverTexture(new Uint8Array([128, 0, 128, 128]), 1));
    this.sharedFar = groundUniforms(this.shared.uCoverMap.value);
    for (const u of [this.shared, this.sharedFar]) u.uSlope.value.set(...slopeLook()); // (rock on the steep, moor on the tops: region/terrain.ts)
    this.setStyle(host.look);
    const n = Math.max(1, Math.min(3, host.workers ?? Math.min(2, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 2))));
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' });
      const load = workerLoader<TileData | FieldData>(w);
      this.loaders.push({ load: (req, signal) => load(req as unknown as LoadRequest, signal), busy: 0 });
    }
    // the 16 km tiles covering the map
    const S = LEVEL_SIZE[2], m = Math.ceil(host.half / S);
    for (let j = -m; j < m; j++) for (let i = -m; i < m; i++) this.roots.push([2, i, j]);
  }

  // The map's palette over the ground's (as GameGround.setStyle does for the live ground).
  setStyle(s: StyleLook) {
    const keys = Object.keys(PALETTE) as (keyof typeof PALETTE)[];
    for (const u of [this.shared, this.sharedFar]) {
      for (const [k, hex] of Object.entries(s.palette)) { const i = keys.indexOf(k as keyof typeof PALETTE); if (i >= 0 && hex) u.uPal.value[i].set(hex); }
      for (const [k, c] of Object.entries(s.crops)) { const i = CROP_NAMES.indexOf(k as CropName); if (i >= 0 && c) { u.uCropA.value[i].set(c.a); u.uCropB.value[i].set(c.b); } }
    }
    // the canopy: the woods' own greens, the broadleaves' and the conifers' (the shader mixes the two)
    const P = this.sharedFar.uPal.value, crown = new THREE.Color(s.trees.crown), pine = new THREE.Color(s.trees.pine);
    P[keys.indexOf('wood')].copy(crown).lerp(pine, s.trees.pines * 0.6).multiplyScalar(0.62);
    P[keys.indexOf('litter')].copy(pine).lerp(crown, 0.3).multiplyScalar(0.55);
    // (and from far off the crops are toned towards the grass, so the patchwork reads without speckling)
    const grass = new THREE.Color(PALETTE.pasture);
    this.sharedFar.uCropA.value.forEach((c, i) => c.copy(this.shared.uCropA.value[i]).lerp(grass, 0.35));
    this.sharedFar.uCropB.value.forEach((c, i) => c.copy(this.shared.uCropB.value[i]).lerp(grass, 0.35));
  }

  // The height field for the drape shader, from a worker (the main thread makes only the live
  // play area's, so the town loads without waiting for the whole map's).
  field(step: number): Promise<FieldData> {
    const L = this.loaders[this.loaders.length - 1];
    L.busy++;
    return L.load({ level: -1, i: 0, j: 0, detail: 'vast', options: this.host.options, field: step }, new AbortController().signal).finally(() => L.busy--) as Promise<FieldData>;
  }

  private node(level: number, i: number, j: number): Node {
    const k = tileKey(level, i, j);
    let n = this.nodes.get(k);
    if (!n) { n = { key: k, level, i, j, box: tileBox(level, i, j), built: {}, pending: new Set(), used: 0 }; this.nodes.set(k, n); }
    return n;
  }
  private onMap(b: Box) { const H = this.host.half; return b.x1 > -H && b.x0 < H && b.z1 > -H && b.z0 < H; }
  private has(n: Node) { return ORDER.find((d) => n.built[d]); }

  // Where the camera is: pick what's shown, ask for what's missing, build what's arrived.
  update(v: ViewState, aspect: number) {
    const t0 = performance.now();
    this.tick++;
    // the zoom's own detail, with slack so a zoom resting on a threshold doesn't flip
    const Z = WORLD_ZOOM, sl = 1 + Z.slack, cur = this.detailAt;
    const pick = (lim: number, d: Detail) => v.h < lim * (finer(cur, d) || cur === d ? sl : 1 / sl);
    this.detailAt = pick(Z.near, 'near') ? 'near' : pick(Z.mid, 'mid') ? 'mid' : pick(Z.far, 'far') ? 'far' : 'vast';
    // the ground in view: round what the camera looks at, as far as the view reaches
    const R = Math.hypot((v.h * aspect) / 2, v.h / Math.max(0.2, Math.sin(v.el)) / 2) + 150;
    const want = (b: Box): Detail => {
      const d = distToBox(v.x, v.z, b);
      return d <= R ? this.detailAt : d <= R + 2500 ? coarser(this.detailAt) : coarser(this.detailAt, 2);
    };
    // build what's arrived (a few milliseconds a frame)
    while (this.arrived.length && performance.now() - t0 < this.budgetMs) {
      const a = this.arrived.shift()!;
      const b0 = performance.now();
      const built = this.build(a.data);
      this.stats.buildMs += performance.now() - b0;
      if (built) { a.node.built[a.data.detail]?.dispose(); a.node.built[a.data.detail] = built; this.stats.built++; }
      a.node.pending.delete(a.detail);
    }
    // pick what to show
    const next = new Map<string, { node: Node; detail: Detail }>();
    const need: { node: Node; detail: Detail; score: number }[] = [];
    const ask = (n: Node, d: Detail, score: number) => { n.used = this.tick; if (!n.built[d] && !n.pending.has(d)) need.push({ node: n, detail: d, score }); };
    // can a node show something (itself, or all of its children)?
    const canShow = (n: Node, depth = 0): boolean => {
      if (inLive(n.box) || !this.onMap(n.box)) return true;
      if (this.has(n)) return true;
      if (n.level === 0 || depth > 1) return false;
      return kids(n).every(([l, i, j]) => canShow(this.node(l, i, j), depth + 1));
    };
    const visit = (n: Node) => {
      if (inLive(n.box) || !this.onMap(n.box)) return;
      n.used = this.tick;
      const wd = want(n.box), wl = LEVEL_OF[wd], d = distToBox(v.x, v.z, n.box);
      if (n.level > wl) {
        const ch = kids(n).map(([l, i, j]) => this.node(l, i, j));
        if (ch.every((c) => canShow(c))) { for (const c of ch) visit(c); return; }
        // (not all ready yet: show this one meanwhile, and ask for them)
        for (const c of ch) if (!inLive(c.box) && this.onMap(c.box)) ask(c, c.level === 0 ? (LEVEL_OF[want(c.box)] === 0 ? want(c.box) : 'mid') : n.level - 1 === 1 ? 'far' : 'vast', distToBox(v.x, v.z, c.box));
        const got = this.has(n);
        if (got) { next.set(n.key, { node: n, detail: got }); return; }
        ask(n, n.level === 2 ? 'vast' : 'far', d);
        for (const c of ch) visit(c); // (show whatever of them is ready)
        return;
      }
      // this level: its wanted detail if ready, else whatever it has
      const own: Detail = n.level === 0 ? (wd === 'near' ? 'near' : 'mid') : n.level === 1 ? 'far' : 'vast';
      ask(n, own, d);
      const got = n.built[own] ? own : this.has(n);
      if (got) next.set(n.key, { node: n, detail: got });
      else if (n.level > 0) for (const [l, i, j] of kids(n)) { const c = this.nodes.get(tileKey(l, i, j)); if (c && this.has(c)) visit(c); }
    };
    if (this.ready) for (const [l, i, j] of this.roots) visit(this.node(l, i, j));
    // swap: what's newly shown goes in and what's gone comes out, in the same frame
    for (const [k, s] of this.shown) { const nx = next.get(k); if (!nx || nx.detail !== s.detail) { const b = s.node.built[s.detail]; if (b) b.group.visible = false; } }
    for (const [k, s] of next) { const b = s.node.built[s.detail]!; if (!b.group.parent) this.root.add(b.group); b.group.visible = true; void k; }
    this.shown = next;
    this.stats.shown = next.size;
    // ask for what's missing, nearest first, a couple at a time per worker
    if (this.ready) {
      need.sort((a, b) => a.score - b.score || (a.node.key < b.node.key ? -1 : 1));
      this.queue = need;
      this.pump();
    }
    this.evict();
  }

  private pump() {
    while (this.queue.length) {
      const L = this.loaders.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (L.busy >= 2) return;
      const q = this.queue.shift()!;
      if (q.node.pending.has(q.detail) || q.node.built[q.detail]) continue;
      q.node.pending.add(q.detail);
      L.busy++;
      this.stats.requested++;
      L.load({ level: q.node.level, i: q.node.i, j: q.node.j, detail: q.detail, options: this.host.options }, new AbortController().signal)
        .then((d) => { this.stats.arrived++; this.arrived.push({ node: q.node, detail: q.detail, data: d as TileData }); })
        .catch((e) => { console.warn('world tile', q.node.key, q.detail, e); q.node.pending.delete(q.detail); })
        .finally(() => { L.busy--; this.pump(); });
    }
  }

  // Drop the tiles not shown or wanted lately, furthest from use first, once over the budget.
  private evict() {
    let bytes = 0, tris = 0, tiles = 0;
    for (const n of this.nodes.values()) for (const b of Object.values(n.built)) if (b) { bytes += b.bytes; tris += b.tris; tiles++; }
    this.stats.bytes = bytes; this.stats.tiles = tiles; this.stats.tris = tris;
    if (bytes < this.maxBytes) return;
    const old = [...this.nodes.values()].filter((n) => n.level < 2 && !this.shown.has(n.key) && this.has(n) && n.used < this.tick - 90).sort((a, b) => a.used - b.used);
    for (const n of old) {
      if (bytes < this.maxBytes * 0.85) break;
      for (const d of ORDER) { const b = n.built[d]; if (!b) continue; bytes -= b.bytes; b.dispose(); delete n.built[d]; }
    }
  }

  // ---------------- meshes ----------------
  private build(t: TileData): Built | null {
    const group = new THREE.Group();
    group.name = `world ${t.key} ${t.detail}`;
    group.visible = false;
    let bytes = 0, tris = 0;
    const toDispose: { dispose(): void }[] = [];
    const geo = (pos: Float32Array, idx: Uint32Array, nor?: Float32Array, col?: Float32Array) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (nor) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      for (const a of Object.values(g.attributes)) (a as THREE.BufferAttribute).onUpload(function (this: THREE.BufferAttribute) { (this as unknown as { array: ArrayLike<number> | null }).array = null; });
      g.index!.onUpload(function (this: THREE.BufferAttribute) { (this as unknown as { array: ArrayLike<number> | null }).array = null; });
      bytes += pos.byteLength + idx.byteLength + (nor?.byteLength ?? 0) + (col?.byteLength ?? 0);
      tris += idx.length / 3;
      toDispose.push(g);
      return g;
    };
    if (t.ground) {
      const tex = coverTexture(t.ground.cover, t.ground.n);
      const u: GroundUniforms = { ...(t.detail === 'far' || t.detail === 'vast' ? this.sharedFar : this.shared), uCoverMap: { value: tex }, uCover: { value: new THREE.Vector4() }, uOriginMod: { value: new THREE.Vector2() } };
      setOrigin(u, 0, 0, { x0: t.box.x0, z0: t.box.z0, size: t.box.x1 - t.box.x0, n: t.ground.n });
      const mat = patchGround(new THREE.MeshLambertMaterial(), u);
      const m = new THREE.Mesh(geo(t.ground.pos, t.ground.idx, t.ground.nor), mat);
      m.receiveShadow = true; m.renderOrder = -9; m.name = 'ground';
      group.add(m);
      bytes += t.ground.cover.byteLength;
      toDispose.push(tex, { dispose: () => { forgetGround(mat); mat.dispose(); } });
    }
    const lift = t.detail === 'far' ? 1.5 : t.detail === 'vast' ? 5 : 0;
    if (t.water) { const m = new THREE.Mesh(geo(t.water.pos, t.water.idx), this.waterMat); m.name = 'water'; m.position.y = lift * 0.3; m.renderOrder = 1; m.geometry.computeVertexNormals(); group.add(m); }
    // (a far or vast tile's ground is a coarser grid than the hills everything else follows: what
    // stands on it is lifted clear of where the coarse ground can bulge above the fine, invisible from
    // that far out)
    if (t.solid) { const m = new THREE.Mesh(geo(t.solid.pos, t.solid.idx, t.solid.nor, t.solid.col), this.solidMat); m.castShadow = t.detail === 'near'; m.receiveShadow = true; m.name = 'solid'; m.position.y = lift; group.add(m); }
    // (the places' buildings up close, hidden once real ones stand in for them: game/dress.ts)
    if (t.bld) { const m = new THREE.Mesh(geo(t.bld.pos, t.bld.idx, t.bld.nor, t.bld.col), this.solidMat); m.castShadow = true; m.receiveShadow = true; m.name = 'bld'; m.visible = !this.dressed.has(t.key); group.add(m); }
    if (t.trees.length) {
      const T = this.host.trees, n = t.trees.length / 4;
      const oaks: number[] = [], pines: number[] = [];
      for (let k = 0; k < n; k++) (t.trees[k * 4 + 3] ? pines : oaks).push(k);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
      const plant = (list: number[], g: THREE.BufferGeometry, mat: THREE.Material, y: number, sy: number) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((k, idx) => { const sc = t.trees[k * 4 + 2]; im.setMatrixAt(idx, m4.compose(v.set(t.trees[k * 4], y * sc, t.trees[k * 4 + 1]), q, s.set(sc, sc * sy, sc))); });
        im.castShadow = t.detail === 'near'; im.receiveShadow = true;
        im.computeBoundingSphere(); im.userData.cull = true; // (drape.ts: keep it culled)
        group.add(im);
        tris += list.length * (g.index ? g.index.count / 3 : g.getAttribute('position').count / 3);
        toDispose.push({ dispose: () => im.dispose() });
      };
      // (woods are many trees: their low-poly shapes, a crown on a short trunk, as the live woods' far level has)
      const L = (this.low ??= { crown: new THREE.IcosahedronGeometry(3.4, 0), pine: new THREE.ConeGeometry(3, 9, 5), trunk: new THREE.CylinderGeometry(0.35, 0.5, 3.5, 4) });
      plant(oaks, L.crown, T.crownMat, 5.6, 1.1);
      plant(pines, L.pine, T.pineMat, 7, 1);
      if (t.detail === 'near') plant([...oaks, ...pines], L.trunk, T.trunkMat, 1.75, 1);
      bytes += t.trees.byteLength;
    }
    if (t.hedges && (t.hedges.pieces.length || t.hedges.trees.length)) {
      const h = new Hedges(), P = t.hedges.pieces, Tr = t.hedges.trees;
      const pieces: Piece[] = [], trees: HedgeTree[] = [];
      for (let k = 0; k < P.length; k += 6) pieces.push({ x: P[k], z: P[k + 1], a: P[k + 2], len: P[k + 3], h: P[k + 4], w: P[k + 5] });
      for (let k = 0; k < Tr.length; k += 4) trees.push({ x: Tr[k], z: Tr[k + 1], s: Tr[k + 2], kind: Tr[k + 3] });
      h.set(pieces, trees);
      for (const x of [h.hedges, h.trees]) { x.frustumCulled = true; x.computeBoundingSphere(); x.userData.cull = true; }
      group.add(h.group);
      tris += pieces.length * 14 + trees.length * 90;
      toDispose.push(h);
    }
    if (!group.children.length) { for (const d of toDispose) d.dispose(); return { group, bytes: 0, tris: 0, dispose: () => {} }; }
    return {
      group, bytes, tris,
      dispose: () => { group.parent?.remove(group); for (const d of toDispose) d.dispose(); },
    };
  }

  // Up close, real buildings stand in for a tile's (or a not-yet-live place's) scenery buildings
  // (game/dress.ts): the near tiles and places on show, and hiding their plain ones.
  private dressed = new Set<string>();
  nearShown(): { key: string; box: Box; place?: number }[] {
    const out: { key: string; box: Box; place?: number }[] = [];
    for (const s of this.shown.values()) if (s.detail === 'near') out.push({ key: s.node.key, box: s.node.box });
    for (const [id, p] of this.places) if (p.built) out.push({ key: `place:${id}`, box: p.box!, place: id });
    return out;
  }
  setDressed(key: string, on: boolean) {
    if (on) this.dressed.add(key); else this.dressed.delete(key);
    const pl = key.startsWith('place:') ? this.places.get(+key.slice(6))?.built : this.nodes.get(key)?.built.near;
    const m = pl?.group.getObjectByName('bld');
    if (m) m.visible = !on;
  }

  // The places in the live play area that aren't live yet, drawn as scenery on their own (their
  // ground is the live area's own: main.ts gives it their gardens and streets).
  private places = new Map<number, { built: Built | null; pending: boolean; box?: Box }>();
  setPlaces(ids: number[]) {
    for (const [id, p] of this.places) if (!ids.includes(id)) { p.built?.dispose(); this.places.delete(id); }
    for (const id of ids) {
      if (this.places.has(id)) continue;
      const p: { built: Built | null; pending: boolean; box?: Box } = { built: null, pending: true };
      this.places.set(id, p);
      const L = this.loaders.reduce((a, b) => (b.busy < a.busy ? b : a));
      L.busy++;
      L.load({ level: 0, i: 0, j: 0, detail: 'near', settlement: id, options: this.host.options }, new AbortController().signal)
        .then((d) => { if (this.places.get(id) !== p) return; p.built = this.build(d as TileData); (p as { box?: Box }).box = (d as TileData).box; if (p.built) { this.root.add(p.built.group); p.built.group.visible = true; } })
        .catch((e) => console.warn('world place', id, e))
        .finally(() => { L.busy--; p.pending = false; this.pump(); });
    }
  }
  placesReady() { return [...this.places.values()].every((p) => !p.pending); }

  // The canopy colours for a ground (the live area's, zoomed out past its trees), or back.
  canopy(u: GroundUniforms, on: boolean, keep: { wood: THREE.Color; litter: THREE.Color } | null) {
    const keys = Object.keys(PALETTE) as (keyof typeof PALETTE)[], w = keys.indexOf('wood'), l = keys.indexOf('litter');
    const src = on ? this.sharedFar.uPal.value : null;
    if (src) { u.uPal.value[w].copy(src[w]); u.uPal.value[l].copy(src[l]); }
    else if (keep) { u.uPal.value[w].copy(keep.wood); u.uPal.value[l].copy(keep.litter); }
  }

  // Are all the tiles the view wants shown at the detail it wants? (for tests and the loading screen)
  settled() { return this.ready && this.queue.length === 0 && this.arrived.length === 0 && this.loaders.every((l) => l.busy === 0); }
  // How many metres of the map a tile covers at each detail (for the docs and tests)
  static sizes = LEVEL_SIZE;
  static live = LIVE;
}
