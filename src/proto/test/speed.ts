// How slow this machine is against the one the tests' timing budgets were set on: 1 there, 2 on a
// machine that takes twice as long, 0.5 on one twice as fast. A timing test multiplies its budget
// by it, so a budget means the same on a busy CI runner as on a quiet laptop, and a real 2×
// slowdown still fails everywhere. Never loosen a budget to get a test through: scale it.
//
// Machines differ by kind of work, not just overall: a CI runner can be quicker than the
// reference at plain arithmetic and slower at hashing strings or collecting garbage, which is
// where the builders and painters spend their time. So it times one fixed workload of each kind
// the budgets cover (typed-array geometry, Maps keyed by numbers, Maps keyed by strings), takes the
// best of several runs of each, and counts the slowest kind against its reference. The factor is
// clamped to 0.5–4. (Garbage collection is left out: its time swings threefold between runs.)

// Each workload's best time on the reference machine, in ms of process CPU time. Calibrated on
// 24 Sep 2026 against the ground painter, whose budgets were set where a full paint took 26–30 ms
// (a cloud container that painted in about 37 ms ran the first workload in 7.4 ms at best, so its
// reference is 7.4 × 28 / 37 = 5.6). The Map workloads were added on the same kind of container,
// quiet, where the first ran in 6.15 ms at best: their best times there (2.0 and 8.1 ms) scaled
// by the same 5.6 / 6.15. To recalibrate, compare parts() with a budget's own
// measure on a machine where the budget was set.
const REFERENCE = { geometry: 5.6, numberMap: 1.82, stringMap: 7.4 };

const proc = (globalThis as unknown as { process?: { cpuUsage(p?: { user: number; system: number }): { user: number; system: number } } }).process;
// CPU time spent by this process (wall-clock where there's no process), in ms
export function cpuMs(f: () => void) {
  if (!proc) { const t = performance.now(); f(); return performance.now() - t; }
  const a = proc.cpuUsage(); f(); const d = proc.cpuUsage(a);
  return (d.user + d.system) / 1000;
}

let sink = 0;
const WORKLOADS: Record<keyof typeof REFERENCE, () => void> = {
  // typed-array geometry: fill and transform a vertex buffer, as the painters and mesh builders
  // do, then Map inserts and small objects (the original single workload, kept as it was so its
  // reference stays the same)
  geometry() {
    const n = 60000, pos = new Float32Array(n * 3), out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = i * 0.001; pos[i * 3] = Math.cos(a) * i; pos[i * 3 + 1] = Math.sin(a * 3); pos[i * 3 + 2] = Math.sin(a) * i; }
    for (let r = 0; r < 4; r++) for (let i = 0; i < n * 3; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2], c = Math.cos(r), s = Math.sin(r);
      out[i] = x * c - z * s; out[i + 1] = y + 0.5; out[i + 2] = x * s + z * c;
    }
    const m = new Map<number, number>();
    for (let i = 0; i < 40000; i++) m.set(((i * 2654435761) >>> 0) % 100003, i);
    let hit = 0;
    for (let i = 0; i < 40000; i++) hit += m.get(i) ?? 0;
    const objs: { x: number; z: number; k: number[] }[] = [];
    for (let i = 0; i < 20000; i++) objs.push({ x: i, z: -i, k: [i, i + 1] });
    sink += out[7] + hit + objs[objs.length - 1].k[1];
  },
  // a spatial grid keyed by numbers, bucketing items into cells, as the land registry and indexes are
  numberMap() {
    const grid = new Map<number, number[]>();
    for (let i = 0; i < 60000; i++) {
      const x = (i * 7919) % 2000, z = (i * 104729) % 2000, k = Math.floor(x / 8) * 4096 + Math.floor(z / 8);
      const b = grid.get(k); if (b) b.push(i); else grid.set(k, [i]);
    }
    let n = 0;
    for (let i = 0; i < 60000; i++) n += grid.get(((i * 31) % 250) * 4096 + ((i * 17) % 250))?.length ?? 0;
    sink += n;
  },
  // the same with string keys ("i,j"), as the bridge scene's height cells and the plots' buckets are
  stringMap() {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < 60000; i++) {
      const k = `${Math.floor(((i * 7919) % 2000) / 8)},${Math.floor(((i * 104729) % 2000) / 8)}`;
      const b = grid.get(k); if (b) b.push(i); else grid.set(k, [i]);
    }
    let n = 0;
    for (let i = 0; i < 60000; i++) n += grid.get(`${(i * 31) % 250},${(i * 17) % 250}`)?.length ?? 0;
    sink += n;
  },
};

// Each workload's best time here, in ms (after warming up the JIT).
export function parts() {
  const out = {} as Record<keyof typeof REFERENCE, number>;
  for (const [k, f] of Object.entries(WORKLOADS) as [keyof typeof REFERENCE, () => void][]) {
    f(); f();
    let best = Infinity;
    for (let i = 0; i < 7; i++) best = Math.min(best, cpuMs(f));
    out[k] = best;
  }
  return sink === sink ? out : out; // (sink keeps the work from being optimised away)
}
// the first workload's best time, as the helper measured it before it had several
export const bestMs = () => parts().geometry;
// how slow this machine is at each kind of work, against the reference
export function ratios() {
  const p = parts();
  return Object.fromEntries((Object.keys(REFERENCE) as (keyof typeof REFERENCE)[]).map((k) => [k, p[k] / REFERENCE[k]])) as Record<keyof typeof REFERENCE, number>;
}
let cached: number | null = null;
// The machine's slowness factor: its slowest kind of work against the reference, measured once
// per test file.
export function slowness() { return (cached ??= factorOf(ratios())); }
// (the slowest ratio, clamped)
export const factorOf = (r: Record<string, number>) => Math.min(4, Math.max(0.5, Math.max(...Object.values(r))));
// A budget in ms on the reference machine, as it applies on this one.
export const budget = (ms: number) => ms * slowness();
