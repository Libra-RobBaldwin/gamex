// The game's side of the ground: turns the road network, plots, trees and lake into a GroundInput,
// and keeps the ground up to date as the town changes. main.ts only calls these few functions.
import { ROADS } from '../catalog';
import { circlePoly } from '../land';
import type { Lot, Network } from '../roads';
import { Ground, type GroundInput, type XZ } from './index';
import { CROP_NAMES, PALETTE, type CropName } from './covers';

export interface GameWorld {
  net: Network;
  queue: () => Lot[]; // plots waiting to be built
  trees: () => XZ[];
  lake: { x: number; z: number; r: number };
  water?: () => XZ[][]; // the water's outlines, if the game has them (else the lake's circle)
  industrial: (p: XZ) => boolean;
  parks?: () => { cells: XZ[]; size: number }[]; // leftover land the game landscaped (parks, verges): cell centres
}

// how many plots at the front of the queue show as building sites (bare earth, cleared)
const SITES = 4;

export class GameGround {
  readonly ground: Ground;
  private sites = new Set<Lot>();
  private full = true;
  private reach: number; // how far out industrial land is looked for
  // (`texel`: metres per cover texel, coarser on a big map so its covers stay a sensible size; `hedges`: plant hedgerows)
  constructor(private w: GameWorld, bound: number, texel?: number, hedges = true) {
    const size = Math.ceil((bound * 2 + 160) / 10) * 10;
    this.ground = new Ground({ region: { x0: -size / 2, z0: -size / 2, size }, seed: 11, texel, hedges });
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
  input(): GroundInput {
    const { net } = this.w, q = this.w.queue();
    const fixed = (this.fixed ??= this.fixedInput());
    const plots: GroundInput['plots'] = [];
    for (const l of net.lots) plots.push({ poly: net.parcelRect(l), kind: l.kind === 'industry' ? 'yard' : 'garden' });
    this.sites = new Set(q.filter((l) => net.lotFree(l)).slice(0, SITES));
    for (const l of this.sites) plots.push({ poly: net.parcelRect(l), kind: 'site' });
    return { seed: 11, ...fixed, plots, trees: this.w.trees(), town: q.map((l) => ({ x: l.x, z: l.z })) };
  }
  private fixedInput() {
    const { net } = this.w;
    const blocked: XZ[][] = [];
    for (const c of net.land.all()) if (c.owner !== 'water') blocked.push(...c.polys); // (water isn't a road: no verge round it)
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
  // A plot was built: repaint round it (and round the building sites that moved up the queue).
  built(l: Lot) {
    if (this.full) return;
    const before = this.sites, inp = this.input();
    const boxes = [l, ...[...before].filter((x) => !this.sites.has(x)), ...[...this.sites].filter((x) => !before.has(x))].map((x) => boxOf(this.w.net.parcelRect(x)));
    this.ground.change(inp, boxes);
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
    return true;
  }
}
function boxOf(poly: XZ[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
}
