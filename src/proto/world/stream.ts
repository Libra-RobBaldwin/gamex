// Streaming: which tiles should be loaded, at which level of detail, given where the camera is.
//
// Three rings around the camera (ENGINE.md): near tiles get full detail, middle ones massing and
// flows, far ones silhouettes and trunk routes. Every frame the manager
//  1. re-picks each tile's wanted level (only when the camera has moved enough to matter), with
//     hysteresis so a tile on a ring's edge doesn't flip back and forth;
//  2. cancels loads that are no longer wanted and starts new ones, nearest and most in view first,
//     a few at a time;
//  3. hands finished loads to the game (the `load` event) and drops tiles that fell out of range
//     (`unload`), within a per-frame budget so a burst of arrivals never costs a frame.
//
// Loaders are async and pure: they take a plain request (tile, level, seed) and return plain data,
// so the same loader can run here, in a Web Worker (see worker.ts) or in a test with a fake clock.
// Anything touching three.js or the scene belongs in the `load`/`unload` handlers, which is the
// part the budget protects.

import { Emitter } from './events';
import { tileSeed } from './seed';
import { TILE, distToTile, keyOf, type TileKey } from './tiles';

export type Lod = 'near' | 'mid' | 'far';
export const LODS: readonly Lod[] = ['near', 'mid', 'far'];
const RANK: Record<Lod, number> = { near: 0, mid: 1, far: 2 };
export const finer = (a: Lod, b: Lod) => RANK[a] < RANK[b];

export interface Ring { lod: Lod; radius: number } // metres from the camera to the tile's nearest edge
export const DEFAULT_RINGS: Ring[] = [{ lod: 'near', radius: 1500 }, { lod: 'mid', radius: 5000 }, { lod: 'far', radius: 12000 }];

// `dir` is the way the camera looks along the ground (unit or not); `span` is how much ground the
// view covers (the orthographic camera's view height, main.ts `view.h`).
export interface Camera { x: number; z: number; dir?: { x: number; z: number }; span?: number }
// main.ts places its orbit camera at +(sin az, cos az) from the look-at point, so it looks the other way
export const dirFromAz = (az: number) => ({ x: -Math.sin(az), z: -Math.cos(az) });

// Everything a loader needs, and nothing that can't cross to a worker.
export interface LoadRequest { key: TileKey; i: number; j: number; lod: Lod; seed: number; size: number }
export type Loader<T> = (req: LoadRequest, signal: AbortSignal) => Promise<T>;

export interface Budget { ms?: number; items?: number }
export interface StreamOptions<T> {
  loader: Loader<T>;
  rings?: Ring[]; // finest first
  margin?: number; // hysteresis: a tile keeps its level until it's this much past the ring's edge
  size?: number;
  worldSeed?: number;
  bounds?: { i0: number; j0: number; i1: number; j1: number }; // the map's tiles, inclusive
  budget?: Budget; // per update, for handing results over (always at least one item)
  maxInFlight?: number;
  clock?: () => number;
  // rings grow when zoomed out: radius × clamp(span / zoomRef, 1, maxZoom)
  zoomRef?: number; maxZoom?: number;
  ahead?: number; // 0 ignores the view direction; 1 makes a tile behind cost three times its distance
  reselect?: number; // metres the camera must move before wanted levels are recomputed
  retryMs?: number;
  sizeOf?: (data: T) => number; // bytes, for the memory estimate
}

export interface LoadEvent<T> { key: TileKey; lod: Lod; data: T; replaced?: Lod }
export interface UnloadEvent<T> { key: TileKey; lod: Lod; data: T; reason: 'lod' | 'range' }
type Events<T> = {
  load: LoadEvent<T>;
  unload: UnloadEvent<T>;
  cancel: { key: TileKey; lod: Lod };
  error: { key: TileKey; lod: Lod; error: unknown };
};

interface Job<T> { lod: Lod; ctrl: AbortController; done: boolean; ok?: boolean; data?: T; error?: unknown }
interface Slot<T> {
  key: TileKey; i: number; j: number;
  d: number; score: number; stamp: number;
  want: Lod | null; have: Lod | null; data?: T; bytes: number;
  job?: Job<T>; failedAt?: number;
}

export interface FrameStats { ms: number; applied: number; unloaded: number; started: number; cancelled: number; reselected: boolean }

// ties broken by key, so the order never depends on when a tile was first seen
const byScore = (a: { score: number; key: string }, b: { score: number; key: string }) => a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export class StreamManager<T> extends Emitter<Events<T>> {
  readonly rings: Ring[];
  private o: Required<Omit<StreamOptions<T>, 'bounds' | 'sizeOf'>> & Pick<StreamOptions<T>, 'bounds' | 'sizeOf'>;
  private slots = new Map<TileKey, Slot<T>>();
  private ready = new Set<Slot<T>>();
  private inFlight = 0;
  private stamp = 0;
  private last: { x: number; z: number; dx: number; dz: number; span: number } | null = null;
  // totals since creation, for benchmarks
  totals = { loads: 0, unloads: 0, cancels: 0, errors: 0, started: 0 };
  lastFrame: FrameStats = { ms: 0, applied: 0, unloaded: 0, started: 0, cancelled: 0, reselected: false };

  constructor(opts: StreamOptions<T>) {
    super();
    this.o = {
      rings: DEFAULT_RINGS, margin: 250, size: TILE, worldSeed: 1, budget: { ms: 4 }, maxInFlight: 8,
      clock: () => performance.now(), zoomRef: 900, maxZoom: 3, ahead: 0.6, reselect: 0, retryMs: 2000,
      ...opts,
    };
    this.rings = [...this.o.rings].sort((a, b) => a.radius - b.radius);
    if (!this.o.reselect) this.o.reselect = this.o.size / 8;
  }

  // The level a tile at distance d should have, given the level it's heading for now. Moving to
  // finer detail happens at the ring's edge; dropping to coarser only `margin` beyond it.
  wantFor(d: number, cur: Lod | null, scale = 1): Lod | null {
    for (const r of this.rings) {
      const keep = cur !== null && RANK[cur] <= RANK[r.lod];
      if (d <= r.radius * scale + (keep ? this.o.margin : 0)) return r.lod;
    }
    return null;
  }

  private zoomScale(cam: Camera) { return Math.min(this.o.maxZoom, Math.max(1, (cam.span ?? 0) / this.o.zoomRef)); }

  private needsReselect(cam: Camera) {
    const l = this.last;
    if (!l) return true;
    if (Math.hypot(cam.x - l.x, cam.z - l.z) > this.o.reselect) return true;
    if (Math.abs((cam.span ?? 0) - l.span) > 0.05 * Math.max(1, l.span)) return true;
    const d = cam.dir;
    if (d) { const L = Math.hypot(d.x, d.z) || 1; if ((d.x * l.dx + d.z * l.dz) / L < 0.985) return true; } // ~10°
    return false;
  }

  private select(cam: Camera) {
    const s = this.zoomScale(cam), size = this.o.size, outer = this.rings[this.rings.length - 1].radius * s + this.o.margin;
    const st = ++this.stamp, b = this.o.bounds;
    let dx = 0, dz = 0;
    if (cam.dir) { const L = Math.hypot(cam.dir.x, cam.dir.z) || 1; dx = cam.dir.x / L; dz = cam.dir.z / L; }
    let i0 = Math.floor((cam.x - outer) / size), i1 = Math.floor((cam.x + outer) / size);
    let j0 = Math.floor((cam.z - outer) / size), j1 = Math.floor((cam.z + outer) / size);
    if (b) { i0 = Math.max(i0, b.i0); i1 = Math.min(i1, b.i1); j0 = Math.max(j0, b.j0); j1 = Math.min(j1, b.j1); }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = distToTile(cam.x, cam.z, i, j, size);
      if (d > outer) continue;
      const key = keyOf(i, j);
      let slot = this.slots.get(key);
      const want = this.wantFor(d, slot?.want ?? null, s);
      if (!slot) { if (!want) continue; this.slots.set(key, (slot = { key, i, j, d, score: 0, stamp: st, want: null, have: null, bytes: 0 })); }
      slot.stamp = st; slot.d = d; slot.want = want;
      // prefer what's ahead: tiles off to the side or behind count as further away (bar the
      // camera's own tile, whose centre direction means nothing)
      const cx = (i + 0.5) * size - cam.x, cz = (j + 0.5) * size - cam.z, L = Math.hypot(cx, cz);
      const cos = L > 0.75 * size && (dx || dz) ? (cx * dx + cz * dz) / L : 1;
      slot.score = d * (1 + this.o.ahead * (1 - cos));
    }
    for (const slot of this.slots.values()) if (slot.stamp !== st) { slot.want = null; slot.d = Infinity; slot.score = Infinity; }
    this.last = { x: cam.x, z: cam.z, dx, dz, span: cam.span ?? 0 };
  }

  update(cam: Camera): FrameStats {
    const clock = this.o.clock, t0 = clock();
    const f: FrameStats = { ms: 0, applied: 0, unloaded: 0, started: 0, cancelled: 0, reselected: false };
    if (this.needsReselect(cam)) { this.select(cam); f.reselected = true; }

    // cancel loads nobody wants any more
    for (const s of this.slots.values()) if (s.job && s.job.lod !== s.want) { this.cancel(s); f.cancelled++; }

    // start the most urgent loads
    if (this.inFlight < this.o.maxInFlight) {
      const now = clock();
      const todo = [...this.slots.values()].filter((s) => s.want && s.want !== s.have && !s.job && !(s.failedAt !== undefined && now - s.failedAt < this.o.retryMs));
      todo.sort(byScore);
      for (const s of todo) { if (this.inFlight >= this.o.maxInFlight) break; this.start(s); f.started++; }
    }

    // hand over results and drop what's out of range, within budget: unloads first (they free
    // memory and are cheap), then arrivals nearest first
    const work: Slot<T>[] = [];
    for (const s of this.slots.values()) if (s.want === null && s.have !== null && !s.job) work.push(s);
    const arrivals = [...this.ready].sort(byScore);
    work.push(...arrivals);
    const { ms = Infinity, items = Infinity } = this.o.budget;
    let n = 0;
    for (const s of work) {
      if (n > 0 && (n >= items || clock() - t0 >= ms)) break;
      if (this.ready.has(s)) { if (this.apply(s)) f.applied++; }
      else { this.drop(s, 'range'); f.unloaded++; }
      n++;
    }
    // forget tiles with nothing loaded, wanted or pending
    for (const [k, s] of this.slots) if (!s.want && !s.have && !s.job) this.slots.delete(k);
    f.ms = clock() - t0;
    this.lastFrame = f;
    return f;
  }

  private start(s: Slot<T>) {
    const lod = s.want!, ctrl = new AbortController();
    const job: Job<T> = { lod, ctrl, done: false };
    s.job = job;
    this.inFlight++;
    this.totals.started++;
    const req: LoadRequest = { key: s.key, i: s.i, j: s.j, lod, seed: tileSeed(this.o.worldSeed, s.key), size: this.o.size };
    let p: Promise<T>;
    try { p = this.o.loader(req, ctrl.signal); } catch (e) { p = Promise.reject(e); }
    p.then(
      (data) => { job.ok = true; job.data = data; },
      (error) => { job.ok = false; job.error = error; },
    ).finally(() => {
      if (job.done) return;
      job.done = true;
      this.inFlight--;
      if (s.job === job && !ctrl.signal.aborted) this.ready.add(s);
    });
  }

  private cancel(s: Slot<T>) {
    const job = s.job!;
    job.ctrl.abort();
    if (!job.done) { job.done = true; this.inFlight--; }
    s.job = undefined;
    this.ready.delete(s);
    this.totals.cancels++;
    this.emit('cancel', { key: s.key, lod: job.lod });
  }

  // a finished load: swap it in (new level first, then the old one out, so there's never a hole)
  private apply(s: Slot<T>) {
    const job = s.job!;
    this.ready.delete(s);
    s.job = undefined;
    if (!job.ok) {
      s.failedAt = this.o.clock();
      this.totals.errors++;
      this.emit('error', { key: s.key, lod: job.lod, error: job.error });
      return false;
    }
    s.failedAt = undefined;
    const old = s.have, oldData = s.data;
    s.have = job.lod; s.data = job.data; s.bytes = this.o.sizeOf ? this.o.sizeOf(job.data!) : 0;
    this.totals.loads++;
    this.emit('load', { key: s.key, lod: job.lod, data: job.data!, replaced: old ?? undefined });
    if (old) { this.totals.unloads++; this.emit('unload', { key: s.key, lod: old, data: oldData!, reason: 'lod' }); }
    return true;
  }

  private drop(s: Slot<T>, reason: 'lod' | 'range') {
    const lod = s.have!, data = s.data!;
    s.have = null; s.data = undefined; s.bytes = 0;
    this.totals.unloads++;
    this.emit('unload', { key: s.key, lod, data, reason });
  }

  // Everything unloaded and every load cancelled (leaving a map, or tearing down a test).
  dispose() {
    for (const s of this.slots.values()) { if (s.job) this.cancel(s); if (s.have) this.drop(s, 'range'); }
    this.slots.clear(); this.ready.clear(); this.last = null;
  }

  // ---------- inspection ----------
  loaded(key: TileKey) { const s = this.slots.get(key); return s?.have ? { lod: s.have, data: s.data! } : undefined; }
  wanted(key: TileKey) { return this.slots.get(key)?.want ?? null; }
  pending() { return [...this.slots.values()].filter((s) => s.job).map((s) => ({ key: s.key, lod: s.job!.lod, done: s.job!.done })); }
  stats() {
    const byLod: Record<Lod, number> = { near: 0, mid: 0, far: 0 };
    let bytes = 0, wantedN = 0;
    for (const s of this.slots.values()) { if (s.have) byLod[s.have]++; if (s.want) wantedN++; bytes += s.bytes; }
    return { byLod, bytes, wanted: wantedN, inFlight: this.inFlight, ready: this.ready.size, slots: this.slots.size };
  }
  // are all wanted tiles loaded at their wanted level?
  settled() { for (const s of this.slots.values()) if (s.want !== s.have || s.job) return false; return true; }
}
