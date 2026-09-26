// Real buildings for the 50 km map's scenery up close (docs/vernacular.md, "Scenery up close").
// Places beyond the live play area, and those in it not yet live, are drawn by the tiles as plain
// boxes (worldmap/tilegen.ts): fine from afar, but zoomed in they'd stay boxes. When the view comes
// down close over them, this builds the same buildings with buildgen (the live town's own
// generator: walls in the place's tradition, windows, doors, roofs, chimneys, gardens and their
// trees), a few milliseconds a frame, merges them a tile at a time (one mesh per material), and
// only then hides the tile's plain ones, in the same frame, so nothing is drawn twice.
//
// Runs of terraced houses become one row and runs of shops a parade, as the live town's are.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Lot, LotKind } from '../roads';
import { settlementScene, type SceneBuilding, type SceneStreet } from '../worldmap/towns';
import { LIVE_HALF, type WorldPlan } from '../worldmap/plan';

export const DRESS_H = 700; // (view heights below which the scenery round the camera is dressed)
const KEEP = 2500; // (dressed tiles further than this from the view are let go)

type Make = (l: Lot) => { group: THREE.Group };
interface Host {
  scene: THREE.Scene;
  plan: WorldPlan;
  make: Make; // buildgen's makeBuilding
  view: { nearShown(): { key: string; box: Box; place?: number }[]; setDressed(key: string, on: boolean): void };
  trees?: { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry; crownMat: THREE.Material; trunkMat: THREE.Material }; // (street trees: the live town's own)
}
interface Box { x0: number; z0: number; x1: number; z1: number }
interface Dressing { key: string; box: Box; todo: Lot[]; trees: number[]; parts: Map<THREE.Material, THREE.BufferGeometry[]>; group: THREE.Group | null }

const KIND: Partial<Record<SceneBuilding['kind'], LotKind>> = { house: 'house', farm: 'house', terrace: 'terrace', shop: 'shop', flats: 'flats', office: 'office', tower: 'tower', church: 'civic', shed: 'industry' };
const FRONT: Record<LotKind, number> = { house: 5, terrace: 2.5, shop: 1, flats: 3, office: 3, tower: 4, industry: 9, civic: 6 };
const BACK: Record<LotKind, number> = { house: 11, terrace: 7, shop: 5, flats: 9, office: 6, tower: 6, industry: 8, civic: 8 };
const hash = (x: number, z: number) => { let h = Math.imul(Math.round(x * 10), 374761393) ^ Math.imul(Math.round(z * 10), 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const distToBox = (x: number, z: number, b: Box) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));

// A scenery building as a plot for buildgen (its front faces -v in the scenery's frame, +z in buildgen's).
function lotOf(b: SceneBuilding, w = b.w, x = b.x, z = b.z, units = 1): Lot | null {
  const kind = KIND[b.kind];
  if (!kind || (b.kind === 'church' && b.w < 8)) return null; // (a church's separate tower: buildgen's church has its own)
  const s = hash(x, z);
  const l: Lot & { units?: number } = { id: -1, x, z, rot: b.rot + Math.PI, w, d: b.d, h: b.h, kind, seg: -1, seed: s, row: Math.floor(s * 1e6), front: FRONT[kind], back: BACK[kind], px: 0, pw: w };
  if (b.kind === 'church') l.arch = 'church';
  if (kind === 'shop' && units > 1) { l.arch = 'parade'; l.units = units; }
  return l;
}

// Neighbouring terraced houses (or shops) along a street side, as one row: in the order the
// scenery lays them, square to each other, end to end.
function lotsOf(list: SceneBuilding[]): Lot[] {
  const out: Lot[] = [];
  let run: SceneBuilding[] = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length === 1) { const l = lotOf(run[0]); if (l) out.push(l); run = []; return; }
    // (the row's middle: halfway between its outer ends, along the first house's line)
    const a = run[0], co = Math.cos(a.rot), si = Math.sin(a.rot);
    let lo = Infinity, hi = -Infinity;
    for (const b of run) { const t = (b.x - a.x) * co + (b.z - a.z) * si; lo = Math.min(lo, t - b.w / 2); hi = Math.max(hi, t + b.w / 2); }
    const m = (lo + hi) / 2, l = lotOf(a, hi - lo, a.x + co * m, a.z + si * m, run.length);
    if (l) out.push(l);
    run = [];
  };
  for (const b of list) {
    const p = run[run.length - 1];
    const joins = p && (b.kind === 'terrace' || b.kind === 'shop') && b.kind === p.kind && run.length < 8 && Math.abs(Math.atan2(Math.sin(b.rot - p.rot), Math.cos(b.rot - p.rot))) < 0.05 && (() => {
      const co = Math.cos(p.rot), si = Math.sin(p.rot), dx = b.x - p.x, dz = b.z - p.z;
      const along = dx * co + dz * si, out = -dx * si + dz * co;
      return Math.abs(Math.abs(along) - (p.w + b.w) / 2) < 0.8 && Math.abs(out) < 1.2 && Math.abs(b.d - p.d) < 2.5;
    })();
    if (!joins) flush();
    run.push(b);
  }
  flush();
  return out;
}

// Trees along the verges of a place's residential and main streets (x, z, scale), a seeded
// 13-21 m apart with gaps, clear of junctions, the streets' ends and the buildings' fronts.
function streetTrees(streets: SceneStreet[], buildings: SceneBuilding[], junctions: { x: number; z: number; r: number }[], keep: (p: { x: number; z: number }) => boolean): number[] {
  const out: number[] = [];
  const clearOf = (x: number, z: number) => {
    for (const j of junctions) if (Math.hypot(x - j.x, z - j.z) < j.r + 9) return false;
    for (const b of buildings) {
      if (Math.abs(b.x - x) > 30 || Math.abs(b.z - z) > 30) continue;
      const co = Math.cos(b.rot), si = Math.sin(b.rot), dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx * co + dz * si) < b.w / 2 + 2 && Math.abs(-dx * si + dz * co) < b.d / 2 + 2) return false;
    }
    return true;
  };
  for (const st of streets) {
    if (st.role !== 'street' && st.role !== 'main') continue;
    const P = st.path, off = st.half - 0.7;
    if (P.length < 2 || off < st.kerb + 0.5) continue;
    const m = P[Math.floor(P.length / 2)];
    if (!keep(m)) continue;
    let run = 0, s = 0, next = 10 + hash(m.x, m.z) * 8;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      while (next < run + L) {
        const t = next - run, x = a.x + ux * t, z = a.z + uz * t;
        for (const side of [1, -1]) {
          const tx = x - uz * off * side, tz = z + ux * off * side, r = hash(tx, tz);
          if (r < 0.3 || !clearOf(tx, tz)) continue; // (gaps, as a real street has)
          out.push(tx, tz, 0.5 + r * 0.25);
        }
        s++;
        next += 13 + hash(x + s, z) * 8;
      }
      run += L;
    }
  }
  return out;
}

export class Dresser {
  private on = new Map<string, Dressing>();
  stats = { tiles: 0, buildings: 0, ms: 0 };
  constructor(private host: Host) {}

  // The buildings a near tile (or a not-yet-live place) has in the scenery.
  private lotsFor(t: { box: Box; place?: number }): { lots: Lot[]; trees: number[] } {
    const P = this.host.plan;
    if (t.place !== undefined) { const sc = settlementScene(P, P.settlements[t.place]); return { lots: lotsOf(sc.buildings), trees: streetTrees(sc.streets, sc.buildings, sc.junctions, () => true) }; }
    const b = t.box, inTile = (p: { x: number; z: number }) => p.x >= b.x0 && p.x < b.x1 && p.z >= b.z0 && p.z < b.z1 && Math.max(Math.abs(p.x), Math.abs(p.z)) >= LIVE_HALF;
    const lots: Lot[] = [], trees: number[] = [];
    for (const s of P.grid.inBox(b)) {
      if (Math.max(Math.abs(s.x), Math.abs(s.z)) < LIVE_HALF) continue; // (the live play area's are the game's)
      // (a row is kept whole in the tile its first house is in, as the tile keeps a building by its centre)
      const sc = settlementScene(P, s);
      lots.push(...lotsOf(sc.buildings.filter(inTile)));
      trees.push(...streetTrees(sc.streets, sc.buildings, sc.junctions, inTile)); // (a street's trees in the tile its middle is in, as its tarmac)
    }
    return { lots, trees };
  }

  update(v: { x: number; z: number; h: number }, budgetMs = 5) {
    const t0 = performance.now();
    const shown = this.host.view.nearShown(), shownKeys = new Set(shown.map((t) => t.key));
    // start on the tiles close under the view
    if (v.h < DRESS_H) {
      const reach = v.h * 1.1 + 200;
      for (const t of shown) if (!this.on.has(t.key) && distToBox(v.x, v.z, t.box) < reach) { const f = this.lotsFor(t); this.on.set(t.key, { key: t.key, box: t.box, todo: f.lots, trees: f.trees, parts: new Map(), group: null }); }
    }
    // build, nearest tile first
    const busy = [...this.on.values()].filter((d) => !d.group).sort((a, b) => distToBox(v.x, v.z, a.box) - distToBox(v.x, v.z, b.box));
    for (const d of busy) {
      while (d.todo.length && performance.now() - t0 < budgetMs) {
        const l = d.todo.pop()!;
        try { this.bake(d, this.host.make(l).group); this.stats.buildings++; } catch (e) { console.warn('dress', e); }
      }
      if (d.todo.length) break;
      this.finish(d);
    }
    // show a dressed tile while its near tile is shown; let go of the ones far off (or gone live)
    for (const d of [...this.on.values()]) {
      const far = distToBox(v.x, v.z, d.box) > KEEP || (d.key.startsWith('place:') && !shownKeys.has(d.key));
      if (far) { this.drop(d); continue; }
      if (d.group) d.group.visible = shownKeys.has(d.key);
    }
    this.stats.tiles = [...this.on.values()].filter((d) => d.group).length;
    this.stats.ms = performance.now() - t0;
  }

  // a building's meshes into its tile's pile, in world space
  private bake(d: Dressing, g: THREE.Group) {
    g.updateMatrixWorld(true);
    for (const o of g.children) {
      const m = o as THREE.Mesh;
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      m.geometry.dispose();
      let l = d.parts.get(m.material as THREE.Material);
      if (!l) d.parts.set(m.material as THREE.Material, (l = []));
      l.push(geo);
    }
  }
  private finish(d: Dressing) {
    const group = new THREE.Group();
    group.name = `dressed ${d.key}`;
    for (const [mat, list] of d.parts) {
      const g = mergeGeometries(list);
      for (const x of list) x.dispose();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !(mat as THREE.MeshLambertMaterial).transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    d.parts.clear();
    // street trees: the live town's crown and trunk, instanced (two draw calls a tile)
    const T = this.host.trees, n = d.trees.length / 3;
    if (T && n) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
      for (const [geo, mat, y, sy] of [[T.trunk, T.trunkMat, 2.45, 1.4], [T.crown, T.crownMat, 6.9, 1]] as const) { // (a taller trunk than the woods': the crown clears a pavement)
        const im = new THREE.InstancedMesh(geo, mat, n);
        for (let k = 0; k < n; k++) { const s = d.trees[k * 3 + 2]; im.setMatrixAt(k, m4.compose(v.set(d.trees[k * 3], y * s, d.trees[k * 3 + 1]), q, sc.set(s, s * sy, s))); }
        im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); im.userData.cull = true; im.userData.shared = true;
        group.add(im);
      }
    }
    d.group = group;
    this.host.scene.add(group);
    this.host.view.setDressed(d.key, true); // (the plain ones go in the same frame the real ones come)
  }
  private drop(d: Dressing) {
    if (d.group) { this.host.scene.remove(d.group); for (const m of d.group.children) { if (m.userData.shared) (m as THREE.InstancedMesh).dispose(); else (m as THREE.Mesh).geometry.dispose(); } }
    for (const list of d.parts.values()) for (const g of list) g.dispose();
    this.host.view.setDressed(d.key, false);
    this.on.delete(d.key);
  }
}
