// The game's side of the ground: turns the road network, plots, trees and lake into a GroundInput,
// and keeps the ground up to date as the town changes. main.ts only calls these few functions.
import { ROADS } from '../catalog';
import { circlePoly } from '../land';
import type { Lot, Network } from '../roads';
import { Ground, type GroundInput, type XZ } from './index';

export interface GameWorld {
  net: Network;
  queue: () => Lot[]; // plots waiting to be built
  trees: () => XZ[];
  lake: { x: number; z: number; r: number };
  industrial: (p: XZ) => boolean;
  parks?: () => { cells: XZ[]; size: number }[]; // leftover land the game landscaped (parks, verges): cell centres
}

// how many plots at the front of the queue show as building sites (bare earth, cleared)
const SITES = 4;

export class GameGround {
  readonly ground: Ground;
  private sites = new Set<Lot>();
  private full = true;
  constructor(private w: GameWorld, bound: number) {
    const size = Math.ceil((bound * 2 + 160) / 10) * 10;
    this.ground = new Ground({ region: { x0: -size / 2, z0: -size / 2, size }, seed: 11 });
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
    for (const c of net.land.all()) blocked.push(...c.polys);
    const lanes: GroundInput['lanes'] = [];
    for (const s of net.segs.values()) {
      const d = ROADS[s.type];
      if (!d || (d.family !== 'Rural' && d.cls !== 'rail')) continue;
      const path = net.path(s);
      if (path.some((p) => (p.y ?? 0) < -2)) continue; // (not in tunnels)
      lanes.push({ path, half: net.half(s) });
    }
    const parks: GroundInput['parks'] = [];
    for (const r of this.w.parks?.() ?? []) for (const c of r.cells) { const h = r.size / 2; parks.push({ poly: [{ x: c.x - h, z: c.z - h }, { x: c.x + h, z: c.z - h }, { x: c.x + h, z: c.z + h }, { x: c.x - h, z: c.z + h }] }); }
    const industrial: XZ[] = [];
    for (let x = -600; x <= 600; x += 40) for (let z = -600; z <= 600; z += 40) if (this.w.industrial({ x, z })) industrial.push({ x, z });
    const L = this.w.lake;
    return { blocked, lanes, parks, industrial, water: [circlePoly(L, L.r + 6, 48)] };
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
