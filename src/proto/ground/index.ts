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
import { CoverMap, type Region } from './paint';
import { Layout, type GroundInput, type XZ } from './layout';
import { Occupancy, planHedges, type HedgeGroup } from './hedgerows';
import { Hedges } from './hedges';
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
}
type Box = { x0: number; z0: number; x1: number; z1: number };
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
  private texA: THREE.DataTexture;
  private texB: THREE.DataTexture;
  private plants: Hedges | null;
  private groups = new Map<string, HedgeGroup>();
  private origin = { x: 0, z: 0 };
  // timings of the last paint and change, in ms
  stats = { paint: 0, change: 0, hedges: 0, pieces: 0, trees: 0 };

  constructor(o: GroundOptions = {}) {
    const t = o.texel ?? 2.5;
    let region: Region | null = null;
    if (o.region) { const n = Math.ceil(o.region.size / t); region = { x0: o.region.x0, z0: o.region.z0, size: n * t, n }; }
    this.cover = region ? new CoverMap(region) : null;
    this.texA = this.cover ? coverTexture(this.cover.a, region!.n) : coverTexture(new Uint8Array([0, 0, 0, 0]), 1);
    this.texB = this.cover ? coverTexture(this.cover.b, region!.n) : coverTexture(new Uint8Array([16, 0, 0, 0]), 1);
    this.uniforms = groundUniforms(this.texA, this.texB);
    this.material = patchGround(o.base ?? new THREE.MeshLambertMaterial(), this.uniforms);
    this.layout = new Layout({ seed: o.seed ?? 1 });
    this.plants = o.hedges === false ? null : new Hedges();
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
      this.texA.updateRanges.length = this.texB.updateRanges.length = 0;
      this.texA.needsUpdate = this.texB.needsUpdate = true;
    }
    this.stats.paint = performance.now() - t0;
  }

  // Repaint round what changed (world boxes, e.g. a new plot's). Fields a change turns into town
  // are repainted whole, and their hedges replanned.
  change(input: GroundInput, boxes: Box[]) {
    const t0 = performance.now();
    if (!this.cover) { this.layout.setInput(input); return; }
    const dirty: Box[] = [...boxes, ...this.layout.setInput(input, boxes)];
    if (this.plants && dirty.length) {
      // hedges within reach of the change (a hedge keeps 2 m off a plot), and wherever a gateway
      // (painted as worn earth) came or went
      const plan = dirty.map((b) => ({ x0: b.x0 - 8, z0: b.z0 - 8, x1: b.x1 + 8, z1: b.z1 + 8 }));
      const occ = new Occupancy(input);
      const gateBoxes: Box[] = [];
      let moved = false;
      for (const b of plan) {
        for (const g of planHedges(this.layout, b, occ)) {
          const was = this.groups.get(g.key);
          this.groups.set(g.key, g);
          if (was && same(was.pieces, g.pieces) && same(was.trees, g.trees) && same(was.gates, g.gates)) continue;
          moved = true;
          for (const s of [...(was?.gates ?? []), ...g.gates]) gateBoxes.push({ x0: s.x - s.r, z0: s.z - s.r, x1: s.x + s.r, z1: s.z + s.r });
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
      for (let j = r.j0; j < r.j1; j++) { this.texA.addUpdateRange((j * n + r.i0) * 4, (r.i1 - r.i0) * 4); this.texB.addUpdateRange((j * n + r.i0) * 4, (r.i1 - r.i0) * 4); }
      this.texA.needsUpdate = this.texB.needsUpdate = true;
    }
    this.stats.change = performance.now() - t0;
  }

  private replan(box: Box, occ = new Occupancy(this.layout.input), plant = true) {
    const t0 = performance.now();
    for (const g of planHedges(this.layout, box, occ)) this.groups.set(g.key, g);
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
  // every hedge piece and hedgerow tree (for tests and for anything placing things near hedges)
  hedgeList() { const p = [], t = []; for (const g of this.groups.values()) { p.push(...g.pieces); t.push(...g.trees); } return { pieces: p, trees: t }; }

  // Move trees standing in the middle of arable or grass fields into the woods (keeping how
  // many there are, so nothing costs more), for scenes that scattered trees at random.
  settleTrees<T extends XZ>(trees: T[]) {
    if (!this.cover) return trees;
    const R = this.cover.region, spots: XZ[] = [], h = { id: 0, cell: this.layout.parcels.cell(0, 0), edge: 0 };
    for (let x = R.x0 + 6; x < R.x0 + R.size; x += 9) for (let z = R.z0 + 6; z < R.z0 + R.size; z += 9) {
      this.layout.parcels.hit(x, z, h);
      if (h.edge > 5 && this.layout.about(h).kind === 'wood') spots.push({ x, z });
    }
    let k = 0;
    for (const t of trees) {
      this.layout.parcels.hit(t.x, t.z, h);
      const kind = this.layout.about(h).kind;
      if ((kind !== 'arable' && kind !== 'grass') || h.edge < 3 || !spots.length) continue;
      const s = spots[Math.floor(((k++ * 0.618034) % 1) * spots.length)];
      t.x = s.x + ((k * 0.37) % 1 - 0.5) * 8; t.z = s.z + ((k * 0.71) % 1 - 0.5) * 8;
    }
    return trees;
  }

  textureBytes() {
    const s = sharedTextures(), mip = (t: THREE.DataTexture) => t.image.width * t.image.height * 4 * (4 / 3);
    const n = this.cover ? this.cover.region.n : 1;
    return { shared: mip(s.detail) + mip(s.macro), cover: n * n * 8 };
  }

  dispose() {
    forgetGround(this.material);
    this.material.dispose(); this.texA.dispose(); this.texB.dispose();
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
