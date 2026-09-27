// The shared ground: one material and one set of hedgerows, used by the game and every demo.
//
//   const ground = new Ground({ region: { x0: -600, z0: -600, size: 1200 } });
//   mesh.material = ground.material;          // any flat plane or terrain tile
//   scene.add(ground.hedges);
//   ground.paint(input);                      // start-up: covers, fields, hedges (see GroundInput)
//   ground.change(input, [box]);              // after a building goes up: repaints just that area
//   setGroundQuality('low');                  // from the game's quality tiers
//
// Without a region it's plain pasture (with its macro variation, detail, and rock and heather on
// slopes) and needs no painting: `new Ground().material` is a drop-in for a flat green material.
// See docs/ground.md.
import * as THREE from 'three';
import { CoverMap, type Region, type Spot } from './paint';
import { Layout, type GroundInput, type XZ } from './layout';
import type { FieldSource } from './plan';
import { Occupancy, planHedges, type HedgeGroup } from './hedgerows';
import { Hedges } from './hedges';
import { packCover } from './covers';
import { coverTexture, forgetGround, groundUniforms, patchGround, setOrigin, sharedTextures, type GroundUniforms } from './material';

export { setGroundQuality, getGroundQuality, patchGround, sharedTextures } from './material';
export type { GroundInput, XZ } from './layout';
export type { GroundQuality } from './covers';
export { SAMPLES } from './covers';

export interface GroundOptions {
  region?: { x0: number; z0: number; size: number }; // the square of world to paint covers over
  texel?: number; // metres per cover texel (2.5)
  seed?: number;
  base?: THREE.MeshLambertMaterial; // patch this material instead of making one (keeps its settings)
  hedges?: boolean; // plant hedgerows (true)
  terrain?: boolean; // for meshes that aren't flat: rock and scree on steep slopes, heather high up (false)
  fields?: FieldSource; // where the fields come from (a map's own farm blocks: region/fields.ts); else farm blocks from the seed alone
}
type Box = { x0: number; z0: number; x1: number; z1: number };
// covers at a point, for paintWith (weights 0..1; crop from CROP; dir in radians)
export interface Covers { lawn?: number; field?: number; wood?: number; bare?: number; rough?: number; wet?: number; crop?: number; dir?: number }
// Boxes that overlap or nearly touch become one (one repaint's margin costs more than a gap).
function merge(boxes: Box[]) {
  const out = boxes.map((b) => ({ ...b }));
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < out.length && !again; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (a.x0 > b.x1 + 30 || b.x0 > a.x1 + 30 || a.z0 > b.z1 + 30 || b.z0 > a.z1 + 30) continue;
      out[i] = { x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) };
      out.splice(j, 1);
      again = true;
      break;
    }
  }
  return out;
}
// (hedge pieces, trees and gates are flat records of numbers)
const same = <T extends object>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => Object.entries(x).every(([k, v]) => (b[i] as Record<string, unknown>)[k] === v));

export class Ground {
  readonly material: THREE.MeshLambertMaterial;
  readonly hedges: THREE.Group;
  readonly uniforms: GroundUniforms;
  readonly cover: CoverMap | null;
  readonly layout: Layout;
  private tex: THREE.DataTexture;
  private plants: Hedges | null;
  private groups = new Map<string, HedgeGroup>();
  private origin = { x: 0, z: 0 };
  // timings of the last paint and change, in ms
  stats = { paint: 0, change: 0, hedges: 0, pieces: 0, trees: 0 };
  // told the boxes a change repainted (the canopy over a plan's woods follows it: canopy.ts)
  onChanged: ((boxes: Box[]) => void) | null = null;

  constructor(o: GroundOptions = {}) {
    const t = o.texel ?? 2.5;
    let region: Region | null = null;
    if (o.region) { const n = Math.ceil(o.region.size / t); region = { x0: o.region.x0, z0: o.region.z0, size: n * t, n }; }
    this.cover = region ? new CoverMap(region) : null;
    this.tex = this.cover ? coverTexture(this.cover.a, region!.n) : coverTexture(new Uint8Array([128, 0, 128, 128]), 1);
    this.uniforms = groundUniforms(this.tex);
    this.material = patchGround(o.base ?? new THREE.MeshLambertMaterial(), this.uniforms, o.terrain);
    this.layout = new Layout({ seed: o.seed ?? 1 }, o.fields);
    this.plants = o.hedges === false || !region ? null : new Hedges(); // (nothing to plant without a map)
    this.hedges = this.plants?.group ?? new THREE.Group();
    this.setOrigin(0, 0);
  }

  // Where the scene's origin is in the world (for floating-origin worlds; 0,0 otherwise).
  setOrigin(x: number, z: number) {
    this.origin = { x, z };
    setOrigin(this.uniforms, x, z, this.cover?.region);
    if (this.plants && this.stats.pieces + this.stats.trees) this.plantAll();
  }

  // Paint everything from scratch.
  paint(input: GroundInput) {
    const t0 = performance.now();
    this.layout.setInput(input);
    if (this.cover) {
      const R = this.cover.region, box = { x0: R.x0, z0: R.z0, x1: R.x0 + R.size, z1: R.z0 + R.size };
      if (this.plants) { this.groups.clear(); this.replan(box); }
      this.cover.paint(this.layout, undefined, this.gates());
      this.tex.updateRanges.length = 0;
      this.tex.needsUpdate = true;
    }
    this.stats.paint = performance.now() - t0;
  }

  // Repaint round what changed (world boxes, e.g. a new plot's). Fields a change turns into town
  // are repainted whole, and their hedges replanned.
  change(input: GroundInput, boxes: Box[]) {
    const t0 = performance.now();
    if (!this.cover) { this.layout.setInput(input); return; }
    // (a plot at the fields' edge marks the town's band round it: that ground, and its hedges,
    // change with it, `band`; in the town itself nothing round the plot changes)
    const { changed, band, added } = this.layout.setInput(input, boxes);
    const dirty: Box[] = [...boxes, ...band, ...changed];
    if (this.plants && dirty.length) {
      // hedges within reach of the change (a hedge keeps 2 m off a plot), in a field that became
      // something else, and in the town's band round a plot at the fields' edge (they go; a band
      // that only grew and has no hedge in it needs no planning), and wherever a gateway (painted
      // as worn earth) came or went
      const plan = [...boxes.map((b) => ({ x0: b.x0 - 8, z0: b.z0 - 8, x1: b.x1 + 8, z1: b.z1 + 8 })), ...changed];
      for (const b of band) if (!added || this.hedgeIn(b)) plan.push(b);
      const occ = this.occupancy(input);
      const gateBoxes: Box[] = [];
      let moved = false;
      for (const b of merge(plan)) { // (a plot's box and its band lie together: planned once)
        for (const g of planHedges(this.layout, b, occ, true, this.clip())) {
          const was = this.groups.get(g.key);
          this.groups.set(g.key, g);
          if (was && same(was.pieces, g.pieces) && same(was.trees, g.trees) && same(was.gates, g.gates)) continue;
          moved = true;
          // (a gateway that came or went is repainted; one that stayed where it was isn't)
          const gate = (s: Spot, l: Spot[]) => l.some((o) => o.x === s.x && o.z === s.z && o.r === s.r && o.v === s.v);
          for (const s of was?.gates ?? []) if (!gate(s, g.gates)) gateBoxes.push({ x0: s.x - s.r, z0: s.z - s.r, x1: s.x + s.r, z1: s.z + s.r });
          for (const s of g.gates) if (!was || !gate(s, was.gates)) gateBoxes.push({ x0: s.x - s.r, z0: s.z - s.r, x1: s.x + s.r, z1: s.z + s.r });
        }
      }
      dirty.push(...gateBoxes);
      if (moved) this.plantAll();
    }
    const gates = this.gates();
    for (const b of merge(dirty)) {
      const r = this.cover.rectFor(b.x0 - 4, b.z0 - 4, b.x1 + 4, b.z1 + 4);
      if (!r) continue;
      this.cover.paint(this.layout, r, gates);
      const n = this.cover.region.n;
      for (let j = r.j0; j < r.j1; j++) this.tex.addUpdateRange((j * n + r.i0) * 4, (r.i1 - r.i0) * 4);
      this.tex.needsUpdate = true;
    }
    this.onChanged?.(dirty);
    this.stats.change = performance.now() - t0;
  }

  // is any hedge piece or gateway within a box (and a piece's reach, 5 m, round it)?
  private hedgeIn(b: Box) {
    const m = 5, x0 = b.x0 - m, z0 = b.z0 - m, x1 = b.x1 + m, z1 = b.z1 + m;
    for (const g of this.groups.values()) {
      for (const p of g.pieces) if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) return true;
      for (const s of g.gates) if (s.x >= x0 && s.x <= x1 && s.z >= z0 && s.z <= z1) return true;
    }
    return false;
  }
  // the painted map, less a few metres: hedges stay on it
  private clip() { const R = this.cover!.region, m = 5; return { x0: R.x0 + m, z0: R.z0 + m, x1: R.x0 + R.size - m, z1: R.z0 + R.size - m }; }
  // the hedges' occupancy (roads, plots, parks, water): kept while the roads, parks and water stay
  // the same and the plots only grow (a repaint after one building adds that plot to it, rather
  // than bucketing every plot in the town again)
  private occ: { occ: Occupancy; blocked: unknown; parks: unknown; water: unknown; plots: Set<object> } | null = null;
  private occupancy(input: GroundInput) {
    const plots = input.plots ?? [], o = this.occ;
    if (o && o.blocked === input.blocked && o.parks === input.parks && o.water === input.water) {
      let kept = 0;
      for (const p of plots) if (o.plots.has(p)) kept++;
      if (kept === o.plots.size) {
        const fresh = plots.filter((p) => !o.plots.has(p));
        o.occ.extend(fresh.map((p) => p.poly));
        for (const p of fresh) o.plots.add(p);
        return o.occ;
      }
    }
    this.occ = { occ: new Occupancy(input), blocked: input.blocked, parks: input.parks, water: input.water, plots: new Set(plots) };
    return this.occ.occ;
  }
  private replan(box: Box, occ = this.occupancy(this.layout.input), plant = true) {
    const t0 = performance.now();
    for (const g of planHedges(this.layout, box, occ, true, this.clip())) this.groups.set(g.key, g);
    if (plant) this.plantAll();
    this.stats.hedges = performance.now() - t0;
  }
  private plantAll() {
    if (!this.plants) return;
    const pieces = [], trees = [];
    for (const g of this.groups.values()) { pieces.push(...g.pieces); trees.push(...g.trees); }
    this.plants.set(pieces, trees, this.origin.x, this.origin.z);
    this.stats.pieces = pieces.length; this.stats.trees = trees.length;
  }
  private gates() { const s = []; for (const g of this.groups.values()) s.push(...g.gates); return s; }
  // Paint the cover map from a function of the texel's centre, which returns the covers there
  // (as packCover takes them). For swatches and tests that want exact covers.
  paintWith(f: (x: number, z: number) => Covers | null) {
    if (!this.cover) return;
    const { region: R, texel: t, a } = this.cover;
    for (let j = 0; j < R.n; j++) for (let i = 0; i < R.n; i++) {
      const c = f(R.x0 + (i + 0.5) * t, R.z0 + (j + 0.5) * t) ?? {};
      packCover(c.lawn ?? 0, c.field ?? 0, c.wood ?? 0, c.bare ?? 0, c.rough ?? 0, c.wet ?? 0, c.crop ?? 0, c.dir ?? 0, a, (j * R.n + i) * 4);
    }
    this.tex.updateRanges.length = 0;
    this.tex.needsUpdate = true;
  }
  // every hedge piece and hedgerow tree (for tests and for anything placing things near hedges)
  hedgeList() { const p = [], t = []; for (const g of this.groups.values()) { p.push(...g.pieces); t.push(...g.trees); } return { pieces: p, trees: t }; }

  // Move trees standing out in the fields to the woods' edges, 2 to 6 m in, keeping how many there
  // are: the game uses it at start-up, because its trees were scattered at random.
  settleTrees<T extends XZ>(trees: T[]) {
    if (!this.cover) return trees;
    const L = this.layout, P = L.plan, R = this.cover.region, box = { x0: R.x0, z0: R.z0, x1: R.x0 + R.size, z1: R.z0 + R.size }, spots: XZ[] = [];
    L.ensure(box);
    for (const n of P.fieldsNear(box)) {
      if (L.about(n).kind !== 'wood') continue;
      const b = P.boxes[n];
      for (let x = Math.ceil(b.x0 / 7) * 7; x < b.x1; x += 7) for (let z = Math.ceil(b.z0 / 7) * 7; z < b.z1; z += 7) {
        if (P.fieldAt(x, z) !== n) continue;
        const e = L.woodEdge(x, z);
        if (e > 2 && e < 6) spots.push({ x, z });
      }
    }
    let k = 0;
    for (const t of trees) {
      const f = P.fieldAt(t.x, t.z), kind = f < 0 ? 'grass' : L.about(f).kind;
      if ((kind !== 'arable' && kind !== 'grass' && kind !== 'wood') || !spots.length) continue;
      if (kind === 'wood' && L.woodEdge(t.x, t.z) < 6) continue;
      const s = spots[Math.floor(((k++ * 0.618034) % 1) * spots.length)];
      t.x = s.x + ((k * 0.37) % 1 - 0.5) * 3; t.z = s.z + ((k * 0.71) % 1 - 0.5) * 3;
    }
    return trees;
  }

  textureBytes() {
    const s = sharedTextures(), mip = (t: THREE.DataTexture) => t.image.width * t.image.height * 4 * (4 / 3);
    const n = this.cover ? this.cover.region.n : 1;
    return { shared: mip(s.detail) + mip(s.macro), cover: n * n * 4 };
  }

  dispose() {
    forgetGround(this.material);
    this.material.dispose(); this.tex.dispose();
    this.plants?.dispose();
  }
}

// A terrain tile (terrain library's MeshData) as a mesh on the ground, placed at its offset
// relative to the floating origin. `color` is an optional RGBA attribute (the water system's shore).
export function groundTile(m: { positions: Float32Array; normals: Float32Array; uvs?: Float32Array; indices: Uint16Array | Uint32Array; offset: [number, number] }, material: THREE.Material, origin: { x: number; z: number } = { x: 0, z: 0 }, color?: Float32Array) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color, 4));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.position.set(m.offset[0] - origin.x, 0, m.offset[1] - origin.z);
  mesh.receiveShadow = true;
  return mesh;
}
