// How slow this machine is against the one the tests' timing budgets were set on: 1 there, 2 on a
// machine that takes twice as long, 0.5 on one twice as fast. A timing test multiplies its budget
// by it, so a budget means the same on a busy CI runner as on a quiet laptop, and a real 2×
// slowdown still fails everywhere. Never loosen a budget to get a test through: scale it.
//
// It times a fixed workload of the kinds the budgets cover (typed-array geometry, Map inserts,
// allocation), takes the best of a few runs, and clamps the result to 0.5–4.

// The workload's best time on the reference machine, in ms of process CPU time. Calibrated on
// 24 Sep 2026 against the ground painter, whose budgets were set where a full paint took 26–30 ms:
// a cloud container that painted in about 37 ms ran this workload in 7.4 ms at best, so the
// reference is 7.4 × 28 / 37. To recalibrate, compare bestMs() with a budget's own measure on a
// machine where the budget was set.
const REFERENCE_MS = 5.6;

const proc = (globalThis as unknown as { process?: { cpuUsage(p?: { user: number; system: number }): { user: number; system: number } } }).process;
// CPU time spent by this process (wall-clock where there's no process), in ms
export function cpuMs(f: () => void) {
  if (!proc) { const t = performance.now(); f(); return performance.now() - t; }
  const a = proc.cpuUsage(); f(); const d = proc.cpuUsage(a);
  return (d.user + d.system) / 1000;
}

let sink = 0;
function workload() {
  // typed-array geometry: fill and transform a vertex buffer, as the painters and mesh builders do
  const n = 60000, pos = new Float32Array(n * 3), out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = i * 0.001; pos[i * 3] = Math.cos(a) * i; pos[i * 3 + 1] = Math.sin(a * 3); pos[i * 3 + 2] = Math.sin(a) * i; }
  for (let r = 0; r < 4; r++) for (let i = 0; i < n * 3; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2], c = Math.cos(r), s = Math.sin(r);
    out[i] = x * c - z * s; out[i + 1] = y + 0.5; out[i + 2] = x * s + z * c;
  }
  // Map inserts and lookups keyed by numbers, as the grids and indexes are
  const m = new Map<number, number>();
  for (let i = 0; i < 40000; i++) m.set(((i * 2654435761) >>> 0) % 100003, i);
  let hit = 0;
  for (let i = 0; i < 40000; i++) hit += m.get(i) ?? 0;
  // allocation: many small objects and arrays, as the planners make
  const objs: { x: number; z: number; k: number[] }[] = [];
  for (let i = 0; i < 20000; i++) objs.push({ x: i, z: -i, k: [i, i + 1] });
  sink += out[7] + hit + objs[objs.length - 1].k[1];
}

// The workload's best time here, in ms (after warming up the JIT).
export function bestMs() {
  workload(); workload();
  let best = Infinity;
  for (let i = 0; i < 7; i++) best = Math.min(best, cpuMs(workload));
  return sink === sink ? best : best; // (sink keeps the work from being optimised away)
}
let cached: number | null = null;
// The machine's slowness factor, measured once per test file.
export function slowness() { return (cached ??= Math.min(4, Math.max(0.5, bestMs() / REFERENCE_MS))); }
// A budget in ms on the reference machine, as it applies on this one.
export const budget = (ms: number) => ms * slowness();
