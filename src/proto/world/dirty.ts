// Dirty tracking: commitRoads() (main.ts) generalised from "the whole town" to "these tiles".
//
// commitRoads runs roads → junctions → land claims → evictions → plots → meshes over everything.
// Here each step is a stage, and each stage keeps its own set of dirty tiles. A change marks its
// tiles dirty for a stage; when a stage has run on some tiles, the tiles it actually changed (and
// their neighbours out to the next stage's radius) become dirty for the next stage. Stages always
// run in order: a later stage runs only once every earlier stage is clean, so plots are never laid
// out against junctions that are about to change. A change arriving half-way simply makes an
// earlier stage dirty again, and that runs first.
//
// Work is metered by a budget per call (milliseconds and/or tiles), so a big edit spreads over a
// few frames instead of stalling one. Stage functions should be pure functions of the tile's
// authorities and the previous stages' output, so they can later move into a worker.

import { keysAround, type TileKey } from './tiles';

export interface Stage {
  name: string;
  // how far a change spreads on reaching this stage, in tiles (0: only the tile itself)
  radius?: number;
  // tiles per call; a stage that designs junctions may want several at once
  batch?: number;
  // Re-derive these tiles. Return the tiles whose output changed (so later stages only redo
  // those), or nothing to mean all of them.
  run(keys: TileKey[]): TileKey[] | void;
}
export interface DirtyOptions {
  clock?: () => number;
  // only tiles that are loaded are worth deriving; others derive from scratch when they load
  live?: (key: TileKey) => boolean;
  // lower runs first (e.g. distance from the camera)
  priority?: (key: TileKey) => number;
}
export interface StepStats { ms: number; tiles: number; calls: { stage: string; keys: TileKey[] }[]; idle: boolean }

export class DirtyPipeline {
  private dirty: Set<TileKey>[];
  private idx = new Map<string, number>();
  private clock: () => number;
  constructor(readonly stages: Stage[], private opts: DirtyOptions = {}) {
    this.dirty = stages.map(() => new Set());
    stages.forEach((s, k) => this.idx.set(s.name, k));
    this.clock = opts.clock ?? (() => performance.now());
  }

  // Mark tiles dirty from a stage on (the first by default): every stage after it will follow.
  mark(keys: TileKey | TileKey[], from: string | number = 0) {
    const k = typeof from === 'string' ? this.idx.get(from) : from;
    if (k === undefined || k < 0 || k >= this.stages.length) throw new Error(`no stage ${from}`);
    const r = this.stages[k].radius ?? 0, live = this.opts.live;
    for (const key of Array.isArray(keys) ? keys : [keys]) for (const n of keysAround(key, r)) if (!live || live(n)) this.dirty[k].add(n);
  }
  // A tile unloaded: forget its pending work.
  drop(key: TileKey) { for (const d of this.dirty) d.delete(key); }

  pending() { return Object.fromEntries(this.stages.map((s, k) => [s.name, this.dirty[k].size])); }
  idle() { return this.dirty.every((d) => d.size === 0); }

  step(budget: { ms?: number; items?: number } = {}): StepStats {
    const t0 = this.clock(), { ms = Infinity, items = Infinity } = budget;
    const out: StepStats = { ms: 0, tiles: 0, calls: [], idle: false };
    while (out.tiles < items && (out.calls.length === 0 || this.clock() - t0 < ms)) {
      const k = this.dirty.findIndex((d) => d.size > 0);
      if (k < 0) break;
      const st = this.stages[k], d = this.dirty[k];
      let keys = [...d];
      const pr = this.opts.priority;
      if (pr) keys.sort((a, b) => pr(a) - pr(b)); else keys.sort();
      keys = keys.slice(0, Math.max(1, Math.min(st.batch ?? 1, items - out.tiles)));
      for (const key of keys) d.delete(key);
      const changed = st.run(keys) ?? keys;
      out.calls.push({ stage: st.name, keys });
      out.tiles += keys.length;
      if (k + 1 < this.stages.length && changed.length) this.mark(changed, k + 1);
    }
    out.ms = this.clock() - t0;
    out.idle = this.idle();
    return out;
  }
  // Run to completion (loading a save, tests). Guarded, in case stages keep re-dirtying each other.
  flush(maxSteps = 10000) {
    let n = 0;
    while (!this.idle()) { if (n++ > maxSteps) throw new Error('dirty pipeline never settles'); this.step({ items: 1000 }); }
  }
}

// The prototype's pipeline, as stages. Radii are what a change can reach: a road touching a tile
// can reshape a junction just over its edge, a bigger junction claims land that spills into the
// next tile, and evicted buildings leave gaps that neighbouring plot rows may fill; meshes only
// rebuild where plots changed. Handlers are what main.ts does now, restricted to the given tiles.
export interface RoadHandlers {
  junctions(keys: TileKey[]): TileKey[] | void; // redesignJunctions()
  claims(keys: TileKey[]): TileKey[] | void; // claimJunctions()
  evict(keys: TileKey[]): TileKey[] | void; // evictFromWorks()
  plots(keys: TileKey[]): TileKey[] | void; // queuePlots()
  meshes(keys: TileKey[]): TileKey[] | void; // drawRoads() + building chunks
}
export function roadPipeline(h: RoadHandlers, opts?: DirtyOptions) {
  return new DirtyPipeline([
    { name: 'junctions', radius: 1, batch: 4, run: h.junctions },
    { name: 'claims', radius: 0, batch: 8, run: h.claims },
    { name: 'evict', radius: 1, batch: 8, run: h.evict },
    { name: 'plots', radius: 0, batch: 2, run: h.plots },
    { name: 'meshes', radius: 0, batch: 1, run: h.meshes },
  ], opts);
}
