// A real region's live play area, packed ahead of time from the bake (tools/os/pack.mjs) and
// restored in the game (docs/real.md, "On the 50 km map"): the 8 km square round its home place that
// the game's own network, buildings, traffic and economy run, as the rest of the 50 km streams as
// the plan's scenery (real/world.ts). The pack holds the network, each junction's chosen form,
// every building's lot by 1 km tile, the plots the town grows on, the parks and the dead ends'
// paths. So the game lays out nothing: it restores the network (its land claims come back from the
// roads), designs each junction in its packed form (without trying the others), puts every lot on
// the land at once (the economy, the paths and the land registry see the whole town from the
// start) and draws the buildings a tile at a time, nearest the camera first (LotStream).
import type { Lot, LotKind, Network, RNode, RSeg } from '../roads';
import type { Region } from '../infill';
import type { RegionKind } from '../buildgen';
import type { Form } from '../junction';
import type { FootPath } from '../game/paths';
import type { ComplexLot } from '../complexes';

export interface LivePack {
  format: 2; region: string; name: string; half: number; tile: number;
  centre: { x: number; z: number };
  nextId: number; rand: number;
  nodes: [number, number, number, number][];
  types: string[]; segs: [number, number, number, number, number[], number][];
  forms: [number, Form, number][];
  kinds: LotKind[]; archs: string[]; tiles: string[];
  lots: LotCols & { tile: number[] };
  queue: LotCols; // (the plots the town grows on, nearest a centre first)
  parks: { id: string; kind: RegionKind; seed: number; cells: number[] }[];
  paths: [number, number, number, number, number, number][];
  stations: { name: string; x: number; z: number }[];
  stats: Record<string, number>;
}
type LotCols = Record<'id' | 'x' | 'z' | 'rot' | 'w' | 'd' | 'h' | 'front' | 'back' | 'px' | 'pw' | 'kind' | 'arch' | 'seg' | 'seed' | 'row', number[]> & { units?: number[] }; // (units: a shopping complex's shops, complexes.ts)
export const packUrl = (base: string, region: string, home: string) => `${base}${region}/live/${home.toLowerCase().replace(/[^a-z]+/g, '-')}.json`;

export interface Restored { forms: Map<number, { form: Form; slip: boolean }>; lots: Lot[]; queue: Lot[]; byTile: Lot[][]; tiles: { x: number; z: number }[]; parks: Region[]; paths: FootPath[] }
// Put the pack's network into a fresh network (made for its map, so its water is claimed), and
// read its lots. The caller puts the lots on the land once the junctions have claimed theirs.
export function restorePack(net: Network, p: LivePack): Restored {
  net.nodes = new Map(p.nodes.map(([id, x, z, y]) => [id, { id, x, z, y } as RNode]));
  net.segs = new Map(p.segs.map(([id, a, b, t, mid, oneway]) => {
    const s: RSeg = { id, a, b, mid: [], type: p.types[t], stops: [] };
    for (let k = 0; k < mid.length; k += 2) s.mid.push({ x: mid[k], z: mid[k + 1] });
    if (oneway) s.oneway = true;
    return [id, s];
  }));
  net.nextId = p.nextId;
  net.randState = p.rand;
  for (const s of net.segs.values()) net.claimSeg(s);
  const lots = lotsOf(p, p.lots), byTile: Lot[][] = p.tiles.map(() => []);
  for (const [k, l] of lots.entries()) byTile[p.lots.tile[k]].push(l);
  const tiles = p.tiles.map((t) => { const [i, j] = t.split(',').map(Number); return { x: (i + 0.5) * p.tile, z: (j + 0.5) * p.tile }; });
  const parks: Region[] = p.parks.map((r) => {
    const cells = [];
    for (let k = 0; k < r.cells.length; k += 2) cells.push({ x: r.cells[k] * 5, z: r.cells[k + 1] * 5 });
    const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length, cz = cells.reduce((s, c) => s + c.z, 0) / cells.length;
    return { id: r.id, cells, kind: r.kind, seed: r.seed, roadEdges: [], centre: { x: cx, z: cz } };
  });
  const paths: FootPath[] = p.paths.map(([node, ax, az, bx, bz, through]) => ({ node, a: { x: ax, z: az }, b: { x: bx, z: bz }, through: !!through }));
  return { forms: new Map(p.forms.map(([n, form, slip]) => [n, { form, slip: !!slip }])), lots, queue: lotsOf(p, p.queue), byTile, tiles, parks, paths };
}

function lotsOf(p: LivePack, L: LotCols) {
  const lots: Lot[] = [];
  for (let k = 0; k < L.id.length; k++) {
    const l: Lot = { id: L.id[k], x: L.x[k], z: L.z[k], rot: L.rot[k], w: L.w[k], d: L.d[k], h: L.h[k], kind: p.kinds[L.kind[k]], seg: L.seg[k], seed: L.seed[k], row: L.row[k], front: L.front[k], back: L.back[k], px: L.px[k], pw: L.pw[k] };
    const a = p.archs[L.arch[k]];
    if (a) l.arch = a;
    if (L.units?.[k]) (l as ComplexLot).units = L.units[k];
    lots.push(l);
  }
  return lots;
}

// The buildings drawn a tile at a time: nearest the camera first, a few milliseconds a frame.
// `spawn` draws one (and says false if its land has gone meanwhile, to a road built over it).
export class LotStream {
  private left: { x: number; z: number; lots: Lot[] }[];
  done = 0;
  readonly total: number;
  constructor(r: Restored, private spawn: (l: Lot) => void) {
    this.left = r.byTile.map((lots, k) => ({ ...r.tiles[k], lots: [...lots] })).filter((t) => t.lots.length);
    this.total = r.lots.length;
  }
  get pending() { return this.total - this.done; }
  // Draw the tiles within `r` metres of (x, z), all of them (before the first frame).
  near(x: number, z: number, r: number) {
    for (const t of this.left) if (Math.hypot(t.x - x, t.z - z) < r) { for (const l of t.lots) this.spawn(l); this.done += t.lots.length; t.lots = []; }
    this.left = this.left.filter((t) => t.lots.length);
  }
  // Draw for up to `ms` milliseconds, nearest tile first. True while there's more to do.
  tick(x: number, z: number, ms: number) {
    if (!this.left.length) return false;
    const t0 = performance.now();
    this.left.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    while (this.left.length && performance.now() - t0 < ms) {
      const t = this.left[0], l = t.lots.pop()!;
      this.spawn(l);
      this.done++;
      if (!t.lots.length) this.left.shift();
    }
    return this.left.length > 0;
  }
}
