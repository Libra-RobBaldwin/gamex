// The game's side of the ground: turns the road network, plots, trees and lake into a GroundInput,
// and keeps the ground up to date as the town changes. main.ts only calls these few functions.
import { ROADS } from '../catalog';
import { circlePoly } from '../land';
import type { Lot, Network } from '../roads';
import { Ground, type GroundInput, type XZ } from './index';
import { CROP_NAMES, PALETTE, type CropName } from './covers';
import type { FieldSource } from './plan';
import { CanopyMeshes } from './canopymesh';
import type { CanopyLook } from './canopy';

export interface GameWorld {
  net: Network;
  queue: () => Lot[]; // plots waiting to be built
  trees: () => XZ[];
  lake: { x: number; z: number; r: number };
  water?: () => XZ[][]; // the water's outlines, if the game has them (else the lake's circle)
  industrial: (p: XZ) => boolean;
  parks?: () => { cells: XZ[]; size: number }[]; // leftover land the game landscaped (parks, verges): cell centres
  // what else stands on the ground (a 50 km map's places not live yet: worldmap/, drawn as scenery)
  extra?: () => { plots: { poly: XZ[]; kind: 'garden' | 'yard' | 'track' }[]; blocked: XZ[][] }; // (and the live area's farm yards and tracks: game/country.ts)
}

// how many plots at the front of the queue show as building sites (bare earth, cleared)
const SITES = 4;

export class GameGround {
  readonly ground: Ground;
  private sites = new Set<Lot>();
  private full = true;
  private reach: number; // how far out industrial land is looked for
  // (`texel`: metres per cover texel, coarser on a big map so its covers stay a sensible size; `hedges`: plant hedgerows;
  // `edge`: half the ground's width, if the covers should be painted right out to it)
  // (`seed`: the field layout's; `fields`: where they come from, a 50 km map's own farm blocks: worldmap/country.ts countryFor)
  constructor(private w: GameWorld, bound: number, texel?: number, hedges = true, edge?: number, private seed = 11, fields?: FieldSource) {
    const size = Math.ceil(((edge ? edge * 2 : bound * 2 + 160)) / 10) * 10;
    this.ground = new Ground({ region: { x0: -size / 2, z0: -size / 2, size }, seed, texel, hedges, fields });
    this.reach = Math.max(600, Math.ceil((bound * 1.15) / 40) * 40);
  }
  // A map's style: its palette and crops over the British ones (region/styles.ts). Nothing given, nothing changes.
  setStyle(s: { palette: Partial<Record<keyof typeof PALETTE, string>>; crops: Partial<Record<CropName, { a: string; b: string }>> }) {
    const u = this.ground.uniforms, keys = Object.keys(PALETTE) as (keyof typeof PALETTE)[];
    for (const [k, hex] of Object.entries(s.palette)) { const i = keys.indexOf(k as keyof typeof PALETTE); if (i >= 0 && hex) u.uPal.value[i].set(hex); }
    for (const [k, c] of Object.entries(s.crops)) { const i = CROP_NAMES.indexOf(k as CropName); if (i >= 0 && c) { u.uCropA.value[i].set(c.a); u.uCropB.value[i].set(c.b); } }
  }
  // what only changes with the roads or the landscaping (kept between plots going up)
  private fixed: Pick<GroundInput, 'blocked' | 'lanes' | 'parks' | 'industrial' | 'water'> | null = null;
  // A lot's plot and a site's town point, the same objects from one input to the next while the
  // lot's parcel stays where it was: the ground marks only what changed between two inputs, and
  // tells a plot by identity (layout.ts `setInput`).
  private plotOf = new Map<Lot, { poly: XZ[]; kind: 'garden' | 'site' | 'yard' }>();
  private pointOf = new Map<Lot, XZ>();
  private plot(l: Lot, kind: 'garden' | 'site' | 'yard') {
    const poly = this.w.net.parcelRect(l), was = this.plotOf.get(l);
    if (was && was.kind === kind && was.poly.every((p, i) => p.x === poly[i].x && p.z === poly[i].z)) return was;
    const p = { poly, kind };
    this.plotOf.set(l, p);
    return p;
  }
  input(): GroundInput {
    const { net } = this.w, q = this.w.queue();
    const fixed = (this.fixed ??= this.fixedInput());
    const plots: GroundInput['plots'] = [];
    for (const l of net.lots) plots.push(this.plot(l, l.kind === 'industry' ? 'yard' : 'garden'));
    // (the first few free plots in the queue: looking no further than that)
    this.sites = new Set();
    for (const l of q) { if (this.sites.size >= SITES) break; if (net.lotFree(l)) this.sites.add(l); }
    for (const l of this.sites) plots.push(this.plot(l, 'site'));
    if (this.w.extra) plots.push(...this.w.extra().plots);
    // (the town's ground is its plots' and its parks': a plot still in the queue takes its field
    // when it's built, not before, so the fields run up to the town's edge, as they do at a real one)
    const town: XZ[] = [];
    for (const l of this.sites) { let p = this.pointOf.get(l); if (!p || p.x !== l.x || p.z !== l.z) this.pointOf.set(l, (p = { x: l.x, z: l.z })); town.push(p); }
    return { seed: this.seed, ...fixed, plots, trees: this.w.trees(), town };
  }
  private fixedInput() {
    const { net } = this.w;
    const blocked: XZ[][] = [];
    for (const c of net.land.all()) if (c.owner !== 'water') blocked.push(...c.polys); // (water isn't a road: no verge round it)
    if (this.w.extra) blocked.push(...this.w.extra().blocked);
    const lanes: GroundInput['lanes'] = [];
    for (const s of net.segs.values()) {
      const d = ROADS[s.type] && net.def(s);
      if (!d || (d.family !== 'Rural' && d.cls !== 'rail')) continue;
      const path = net.path(s);
      if (path.some((p) => (p.y ?? 0) < -2)) continue; // (not in tunnels)
      lanes.push({ path, half: net.half(s) });
    }
    const parks: GroundInput['parks'] = [];
    for (const r of this.w.parks?.() ?? []) for (const c of r.cells) { const h = r.size / 2; parks.push({ poly: [{ x: c.x - h, z: c.z - h }, { x: c.x + h, z: c.z - h }, { x: c.x + h, z: c.z + h }, { x: c.x - h, z: c.z + h }] }); }
    const industrial: XZ[] = [];
    const R = this.reach;
    for (let x = -R; x <= R; x += 40) for (let z = -R; z <= R; z += 40) if (this.w.industrial({ x, z })) industrial.push({ x, z });
    const L = this.w.lake;
    return { blocked, lanes, parks, industrial, water: this.w.water?.() ?? [circlePoly(L, L.r + 9, 48)] /* (the beach reaches r + 7) */ };
  }
  // The roads or the landscaping changed: repaint everything (next time `sync` runs).
  invalidate() { this.full = true; this.fixed = null; }
  // The roads changed only within these boxes (an edit on a big map): repaint round them rather
  // than everything. (Before the first paint there's nothing to repaint.)
  changed(boxes: { x0: number; z0: number; x1: number; z1: number }[]) {
    if (this.full) return;
    this.fixed = null;
    if (boxes.length) this.ground.change(this.input(), boxes.map((b) => ({ x0: b.x0 - 10, z0: b.z0 - 10, x1: b.x1 + 10, z1: b.z1 + 10 })));
  }
  // A plot was built: repaint round it (and round the building sites that moved up the queue).
  built(l: Lot) {
    if (this.full) return;
    const before = this.sites, inp = this.input();
    const boxes = [l, ...[...before].filter((x) => !this.sites.has(x)), ...[...this.sites].filter((x) => !before.has(x))].map((x) => boxOf(this.w.net.parcelRect(x)));
    this.ground.change(inp, boxes);
  }
  // A first paint of only part of the map (a 50 km map's live play area: round the start town),
  // the rest painted later a box at a time (`paintBox`).
  startIn(box: { x0: number; z0: number; x1: number; z1: number }) {
    const a = this.ground.cover?.a; // (unpainted is plain pasture)
    if (a) for (let k = 0; k < a.length; k += 4) { a[k] = 128; a[k + 1] = 0; a[k + 2] = 128; a[k + 3] = 128; }
    this.ground.layout.setInput(this.input());
    this.full = false;
    this.ground.change(this.input(), [box]);
  }
  paintBox(box: { x0: number; z0: number; x1: number; z1: number }) { this.ground.change(this.input(), [box]); }
  // The woods drawn as a canopy (ground/canopy.ts): add `canopy.group` to the scene. Kept up with
  // the paint, a kilometre box at a time (a box is made when it's first painted, and again when a
  // change repaints it).
  canopy: CanopyMeshes | null = null;
  woods(look: CanopyLook) {
    this.canopy ??= new CanopyMeshes(this.ground, look);
    this.ground.onChanged = (boxes) => this.canopy!.changed(boxes);
    return this.canopy;
  }
  private canopyAll() {
    const R = this.ground.cover?.region;
    if (!this.canopy || !R) return;
    for (let i = Math.floor(R.x0 / 1000); i * 1000 < R.x0 + R.size; i++) for (let j = Math.floor(R.z0 / 1000); j * 1000 < R.z0 + R.size; j++) this.canopy.add({ x0: i * 1000, z0: j * 1000, x1: (i + 1) * 1000, z1: (j + 1) * 1000 });
  }
  // First paint: settle the scattered trees into woods first (see Ground.settleTrees).
  start(trees: XZ[]) {
    this.ground.layout.setInput(this.input());
    this.ground.settleTrees(trees);
    this.full = true;
    this.sync();
  }
  sync() {
    if (!this.full) return false;
    this.full = false;
    this.ground.paint(this.input());
    this.canopyAll();
    return true;
  }
}
function boxOf(poly: XZ[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
}
