// A headless benchmark of the streaming scaffold: a 50 × 50 km map (2,500 tiles) with a camera
// flying corner to corner. Loaders are synthetic but shaped like the real thing: generation is
// "in a worker" (it costs the main thread nothing and arrives after a latency), and handing a
// tile over costs the main thread a fixed time per level (standing in for mesh upload), which is
// what the per-frame budget meters. Time is simulated, so the run is deterministic and quick;
// the manager's own bookkeeping is measured with the real clock and added on top.
//
//   npx vitest run src/proto/world/bench.test.ts   (prints the table)

import { TileStore } from './authority';
import { rngFrom } from './bench-rng';
import { StreamManager, type LoadRequest, type Lod, type Ring } from './stream';
import { TILE } from './tiles';

export interface TileData { lod: Lod; key: string; boxes: Float32Array; heights: Float32Array }

// What each level holds: building boxes (x, z, w, d, h, rot) and a height grid.
const SHAPE: Record<Lod, { boxes: number; grid: number; latency: number; apply: number }> = {
  near: { boxes: 1500, grid: 65, latency: 60, apply: 1.2 },
  mid: { boxes: 300, grid: 17, latency: 30, apply: 0.3 },
  far: { boxes: 0, grid: 5, latency: 15, apply: 0.05 },
};

// Pure and seeded: the same request always gives the same tile.
export function generateTile(req: LoadRequest): TileData {
  const s = SHAPE[req.lod], r = rngFrom(req.seed);
  const boxes = new Float32Array(s.boxes * 6);
  for (let k = 0; k < boxes.length; k++) boxes[k] = r() * req.size;
  const heights = new Float32Array(s.grid * s.grid);
  for (let k = 0; k < heights.length; k++) heights[k] = r() * 40;
  return { lod: req.lod, key: req.key, boxes, heights };
}
export const bytesOf = (t: TileData) => t.boxes.byteLength + t.heights.byteLength + 64;
// What a loaded tile would really cost once drawn (geometry on the GPU plus its CPU copy). These
// are assumptions, not measurements: a near tile of full-kit buildings in 120 m chunks, a middle
// tile of massing boxes with baked facades, a far tile as a silhouette. Swap in measured numbers
// once the prototype's chunks are built per tile.
export const MODEL_BYTES: Record<Lod, number> = { near: 6 * 2 ** 20, mid: 400 * 2 ** 10, far: 16 * 2 ** 10 };

export interface BenchOptions {
  mapTiles?: number; // tiles per side
  speed?: number; // m/s
  fps?: number;
  budgetMs?: number;
  rings?: Ring[];
  maxInFlight?: number;
}
export interface BenchResult {
  seconds: number; frames: number; km: number;
  loads: number; unloads: number; cancels: number;
  loadsPerSec: number; unloadsPerSec: number;
  frameMs: { p50: number; p99: number; max: number }; // simulated main-thread time in update()
  bookkeepingMs: { mean: number; max: number }; // real time the manager itself took per frame
  overBudget: number; // frames that went over budget by more than one item's cost
  nearCoverage: number; // share of frames where every tile wanting near detail had it
  peak: { near: number; mid: number; far: number; bytes: number; modelBytes: number };
}

export async function runBenchmark(o: BenchOptions = {}): Promise<BenchResult> {
  const N = o.mapTiles ?? 50, speed = o.speed ?? 250, fps = o.fps ?? 60, budget = o.budgetMs ?? 4;
  const dt = 1000 / fps;
  let simNow = 0; // virtual wall clock (ms)
  let work = 0; // simulated main-thread time spent inside this frame's update
  let real = 0; // real time the manager spent on its own bookkeeping this frame
  const timers: { at: number; fire: () => void }[] = [];

  const loader = (req: LoadRequest, signal: AbortSignal) => new Promise<TileData>((resolve, reject) => {
    const data = generateTile(req);
    const t = { at: simNow + SHAPE[req.lod].latency, fire: () => resolve(data) };
    timers.push(t);
    signal.addEventListener('abort', () => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); reject(new Error('aborted')); }, { once: true });
  });
  // The manager's clock: simulated hand-over work plus its own real bookkeeping in this frame.
  let r0 = 0;
  const clock = () => work + (performance.now() - r0);

  const m = new StreamManager<TileData>({
    loader, clock, sizeOf: bytesOf, budget: { ms: budget },
    bounds: { i0: 0, j0: 0, i1: N - 1, j1: N - 1 }, maxInFlight: o.maxInFlight ?? 16,
    ...(o.rings ? { rings: o.rings } : {}),
  });
  let maxItem = 0;
  m.on('load', (e) => { work += SHAPE[e.lod].apply; maxItem = Math.max(maxItem, SHAPE[e.lod].apply); });
  m.on('unload', () => { work += 0.02; });

  const start = { x: 0.04 * N * TILE, z: 0.04 * N * TILE }, end = { x: 0.96 * N * TILE, z: 0.96 * N * TILE };
  const len = Math.hypot(end.x - start.x, end.z - start.z), dir = { x: (end.x - start.x) / len, z: (end.z - start.z) / len };
  const frames = Math.ceil((len / speed) * fps);
  const frameMs: number[] = [];
  let realSum = 0, realMax = 0, over = 0, covered = 0;
  const peak = { near: 0, mid: 0, far: 0, bytes: 0, modelBytes: 0 };

  for (let f = 0; f <= frames; f++) {
    const t = Math.min(1, f / frames);
    const cam = { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t, dir, span: 300 };
    // deliver loads whose latency has passed, then let their promises settle
    simNow += dt;
    for (let k = timers.length - 1; k >= 0; k--) if (timers[k].at <= simNow) { timers[k].fire(); timers.splice(k, 1); }
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    work = 0;
    r0 = performance.now();
    m.update(cam);
    real = performance.now() - r0;
    const ms = work + real;
    frameMs.push(ms);
    realSum += real; realMax = Math.max(realMax, real);
    if (ms > budget + maxItem) over++;
    const s = m.stats();
    peak.near = Math.max(peak.near, s.byLod.near); peak.mid = Math.max(peak.mid, s.byLod.mid); peak.far = Math.max(peak.far, s.byLod.far);
    peak.bytes = Math.max(peak.bytes, s.bytes);
    peak.modelBytes = Math.max(peak.modelBytes, s.byLod.near * MODEL_BYTES.near + s.byLod.mid * MODEL_BYTES.mid + s.byLod.far * MODEL_BYTES.far);
    covered += nearCovered(m, cam) ? 1 : 0;
  }
  const seconds = frames / fps;
  frameMs.sort((a, b) => a - b);
  const q = (p: number) => frameMs[Math.min(frameMs.length - 1, Math.floor(p * frameMs.length))];
  const res: BenchResult = {
    seconds, frames, km: len / 1000,
    loads: m.totals.loads, unloads: m.totals.unloads, cancels: m.totals.cancels,
    loadsPerSec: m.totals.loads / seconds, unloadsPerSec: m.totals.unloads / seconds,
    frameMs: { p50: q(0.5), p99: q(0.99), max: frameMs[frameMs.length - 1] },
    bookkeepingMs: { mean: realSum / (frames + 1), max: realMax },
    overBudget: over, nearCoverage: covered / (frames + 1), peak,
  };
  m.dispose();
  return res;
}

// Is the tile under the camera, and every tile touching it, at near detail?
function nearCovered(m: StreamManager<TileData>, cam: { x: number; z: number }) {
  const i = Math.floor(cam.x / TILE), j = Math.floor(cam.z / TILE);
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const k = `${i + a},${j + b}`;
    if (m.wanted(k) === 'near' && m.loaded(k)?.lod !== 'near') return false;
  }
  return true;
}

// How big a save of the whole map is: authorities only. A rural-to-suburban density of roads
// (40 nodes and 48 segments a tile, a few claims, zones and edits).
export function saveSizeEstimate(N = 50) {
  const st = new TileStore(1), r = rngFrom(99);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ids: string[] = [];
    for (let k = 0; k < 40; k++) { const id = `n${i}_${j}_${k}`; ids.push(id); st.put({ kind: 'node', id, x: (i + r()) * TILE, z: (j + r()) * TILE }); }
    for (let k = 0; k < 48; k++) st.put({ kind: 'seg', id: `s${i}_${j}_${k}`, a: ids[k % 40], b: ids[(k * 7 + 3) % 40], mid: k % 4 ? [] : [{ x: (i + r()) * TILE, z: (j + r()) * TILE }], type: 'street' });
    for (let k = 0; k < 3; k++) { const x = (i + r()) * TILE, z = (j + r()) * TILE; st.put({ kind: 'claim', id: `c${i}_${j}_${k}`, owner: 'park', polys: [[{ x, z }, { x: x + 60, z }, { x: x + 60, z: z + 40 }, { x, z: z + 40 }]] }); }
    st.put({ kind: 'zone', id: `z${i}_${j}`, zone: 'town', poly: [{ x: i * TILE, z: j * TILE }, { x: (i + 1) * TILE, z: j * TILE }, { x: (i + 1) * TILE, z: (j + 1) * TILE }] });
    st.put({ kind: 'edit', id: `e${i}_${j}`, target: `s${i}_${j}_0`, op: 'rename', data: 'High Street' });
  }
  const json = JSON.stringify(st.save());
  return { tiles: N * N, records: N * N * (40 + 48 + 3 + 1 + 1), bytes: json.length };
}
