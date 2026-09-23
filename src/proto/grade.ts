// Vertical alignment: gradients, clearances and the height profile of a new road or railway.
//
// Every obstacle becomes a height window along the route: over a road it crosses (a bridge),
// under it (an underpass or tunnel), or through it at its height (a junction); over water with
// room for boats, or deep under it. The solver finds the profile that stays as close to the
// ground as it can while keeping to every window and never exceeding the gradient limit. When it
// can't — there isn't room to climb or dive in time — it says exactly why.

// Clearance is surface to surface: 5.3 m headroom (UK standard) + ~1.2 m deck for roads;
// railways need more for overhead wires.
export const GRADES = {
  road: { max: 0.08, clear: 6.5, water: 6, under: 12, label: 'road' },
  rail: { max: 0.035, clear: 7.8, water: 7, under: 14, label: 'railway' },
};
export type Spec = (typeof GRADES)['road'];
export type HeightMode = 'auto' | 'level' | 'up';
export type CrossMode = 'junction' | 'bridge' | 'tunnel';
export const GRADE_STEPS = [0.02, 0.04, 0.06, 0.08];
export const FLOOR = -60; // deepest a tunnel may go

// A height window over part of the route (by distance along it). lo/hi may be equal (a junction).
export interface Limit { s0: number; s1: number; lo?: number; hi?: number; why: string }

export interface Profile { ok: boolean; reason?: string; s: number[]; y: number[]; maxY: number; minY: number; maxGrade: number; limits: Limit[] }

const pct = (g: number) => `${(g * 100).toFixed(g < 0.1 ? 1 : 0).replace(/\.0$/, '')}%`;
const m1 = (v: number) => `${v.toFixed(1)} m`;

// `floor` is the lowest the route may go (0 unless tunnels are allowed).
export function solveProfile(L: number, y0: number, yL: number | undefined, G: number, limits: Limit[], mode: HeightMode, floor = 0, step = 2): Profile {
  const N = Math.max(2, Math.ceil(L / step) + 1);
  const s = Array.from({ length: N }, (_, i) => (L * i) / (N - 1));
  const lo = new Array<number>(N).fill(floor), hi = new Array<number>(N).fill(80);
  const loWhy = new Array<string>(N).fill(''), hiWhy = new Array<string>(N).fill('');
  const setLo = (i: number, v: number, why: string) => { if (v > lo[i]) { lo[i] = v; loWhy[i] = why; } };
  const setHi = (i: number, v: number, why: string) => { if (v < hi[i]) { hi[i] = v; hiWhy[i] = why; } };
  for (const l of limits) {
    let any = false;
    for (let i = 0; i < N; i++) {
      if (s[i] < l.s0 - 1e-6 || s[i] > l.s1 + 1e-6) continue;
      any = true;
      if (l.lo !== undefined) setLo(i, l.lo, l.why);
      if (l.hi !== undefined) setHi(i, l.hi, l.why);
    }
    // point limits (junctions) snap to the nearest sample
    if (!any) {
      const i = Math.max(0, Math.min(N - 1, Math.round(((l.s0 + l.s1) / 2 / L) * (N - 1))));
      if (l.lo !== undefined) setLo(i, l.lo, l.why);
      if (l.hi !== undefined) setHi(i, l.hi, l.why);
    }
  }
  setLo(0, y0, 'start'); setHi(0, y0, 'start');
  if (yL !== undefined) { setLo(N - 1, yL, 'end'); setHi(N - 1, yL, 'end'); }

  // the lowest the route can be (above every lower bound) and the highest (below every upper
  // bound), each a function that never changes faster than the gradient allows: two sweeps each
  const low = [...lo], lsrc = s.map((_, i) => i), high = [...hi], hsrc = s.map((_, i) => i);
  for (let i = 1; i < N; i++) {
    const d = G * (s[i] - s[i - 1]);
    if (low[i - 1] - d > low[i]) { low[i] = low[i - 1] - d; lsrc[i] = lsrc[i - 1]; }
    if (high[i - 1] + d < high[i]) { high[i] = high[i - 1] + d; hsrc[i] = hsrc[i - 1]; }
  }
  for (let i = N - 2; i >= 0; i--) {
    const d = G * (s[i + 1] - s[i]);
    if (low[i + 1] - d > low[i]) { low[i] = low[i + 1] - d; lsrc[i] = lsrc[i + 1]; }
    if (high[i + 1] + d < high[i]) { high[i] = high[i + 1] + d; hsrc[i] = hsrc[i + 1]; }
  }
  // stay as near the ground (or the chosen height) as the windows allow
  const target = (i: number) => (mode === 'level' ? y0 : mode === 'up' ? y0 + G * s[i] : 0);
  const y = s.map((_, i) => Math.max(low[i], Math.min(target(i), high[i])));

  const out = (reason?: string): Profile => {
    let maxY = -Infinity, minY = Infinity, maxGrade = 0;
    for (let i = 0; i < N; i++) { maxY = Math.max(maxY, y[i]); minY = Math.min(minY, y[i]); if (i) maxGrade = Math.max(maxGrade, Math.abs(y[i] - y[i - 1]) / (s[i] - s[i - 1] || 1)); }
    return { ok: !reason, reason, s, y, maxY: Math.max(0, maxY), minY: Math.min(0, minY), maxGrade, limits };
  };
  for (let i = 0; i < N; i++) {
    if (low[i] <= high[i] + 0.05) continue;
    const j = lsrc[i], k = hsrc[i];
    const up = lo[j], down = hi[k], dist = Math.round(Math.abs(s[j] - s[k]));
    const need = (h: number) => Math.round(h / G);
    const climb = up - down;
    if (hiWhy[k] === 'start' && loWhy[j] === 'end') return out(`The far end is ${m1(climb)} higher: needs ${need(climb)} m of route at ${pct(G)}`);
    if (loWhy[j] === 'start' && hiWhy[k] === 'end') return out(`The far end is ${m1(climb)} lower: needs ${need(climb)} m of route at ${pct(G)}`);
    if (hiWhy[k] === 'start') return out(`Can't climb ${m1(climb)} to clear ${loWhy[j]} in ${dist} m at ${pct(G)} (needs ${need(climb)} m) — start further back or steepen`);
    if (loWhy[j] === 'start') return out(`Can't dive ${m1(climb)} to get under ${hiWhy[k]} in ${dist} m at ${pct(G)} (needs ${need(climb)} m) — start further back or steepen`);
    if (hiWhy[k] === 'end') return out(`Can't come back down ${m1(climb)} to meet the end after ${loWhy[j]} (needs ${need(climb)} m at ${pct(G)})`);
    if (loWhy[j] === 'end') return out(`Can't come back up ${m1(climb)} to meet the end after ${hiWhy[k]} (needs ${need(climb)} m at ${pct(G)})`);
    if (hiWhy[k] === 'the junction') return out(`Too high to join the crossing road here (${m1(up)} vs ${m1(down)}) — try going over it`);
    if (loWhy[j] === 'the junction') return out(`Too low to join the crossing road here (${m1(down)} vs ${m1(up)}) — try going under it`);
    return out(`Can't clear ${loWhy[j]} and still get under ${hiWhy[k]} ${dist} m away at ${pct(G)} (needs ${need(climb)} m)`);
  }
  return out();
}

// Height at distance t along a solved profile.
export function heightAt(p: Pick<Profile, 's' | 'y'>, t: number) {
  const { s, y } = p;
  if (t <= 0) return y[0];
  const L = s[s.length - 1];
  if (t >= L) return y[y.length - 1];
  const k = (t / L) * (s.length - 1), i = Math.floor(k);
  return y[i] + (y[i + 1] - y[i]) * (k - i);
}
