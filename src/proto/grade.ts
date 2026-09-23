// Vertical alignment: gradients, clearances and the height profile of a new road.
//
// A new road gets the LOWEST profile that obeys the gradient limit and every clearance along
// it (over a road it crosses, under a flyover, over water). Lower means shorter ramps and
// cheaper structures. If the clearance can't be reached in time, the solver says why.

// Clearance is road surface to road surface: 5.3 m headroom (UK standard) + ~1.2 m deck.
export const GRADES = {
  road: { max: 0.08, clear: 6.5, water: 6, label: 'road' },
  rail: { max: 0.03, clear: 7.8, water: 7, label: 'railway' }, // ready for when rail arrives
};
export type Spec = (typeof GRADES)['road'];
export type HeightMode = 'auto' | 'level' | 'up';
export const GRADE_STEPS = [0.02, 0.04, 0.06, 0.08];

// A height window over part of the road (by distance along it). lo/hi may be equal (a junction).
export interface Limit { s0: number; s1: number; lo?: number; hi?: number; why: string }

export interface Profile { ok: boolean; reason?: string; s: number[]; y: number[]; maxY: number; maxGrade: number; limits: Limit[] }

const pct = (g: number) => `${Math.round(g * 100)}%`;
const m1 = (v: number) => `${v.toFixed(1)} m`;

export function solveProfile(L: number, y0: number, yL: number | undefined, G: number, limits: Limit[], mode: HeightMode, step = 2): Profile {
  const N = Math.max(2, Math.ceil(L / step) + 1);
  const s = Array.from({ length: N }, (_, i) => (L * i) / (N - 1));
  const lo = new Array<number>(N).fill(0), hi = new Array<number>(N).fill(Infinity);
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
  if (mode === 'level') for (let i = 0; i < N; i++) setLo(i, y0, 'level');
  if (mode === 'up' && yL === undefined) setLo(N - 1, y0 + G * L, 'climb');

  // lowest function above every lower bound whose slope never exceeds G (two sweeps)
  const f = [...lo], src = s.map((_, i) => i);
  for (let i = 1; i < N; i++) { const v = f[i - 1] - G * (s[i] - s[i - 1]); if (v > f[i]) { f[i] = v; src[i] = src[i - 1]; } }
  for (let i = N - 2; i >= 0; i--) { const v = f[i + 1] - G * (s[i + 1] - s[i]); if (v > f[i]) { f[i] = v; src[i] = src[i + 1]; } }

  const out = (reason?: string): Profile => {
    let maxY = 0, maxGrade = 0;
    for (let i = 0; i < N; i++) { maxY = Math.max(maxY, f[i]); if (i) maxGrade = Math.max(maxGrade, Math.abs(f[i] - f[i - 1]) / (s[i] - s[i - 1] || 1)); }
    return { ok: !reason, reason, s, y: f, maxY, maxGrade, limits };
  };
  for (let i = 0; i < N; i++) {
    if (f[i] <= hi[i] + 0.05) continue;
    const j = src[i], need = lo[j], why = loWhy[j], run = Math.abs(s[j] - s[i]);
    if (hiWhy[i] === 'start' && why === 'end') return out(`The far end is ${m1(need - y0)} higher: needs ${Math.round((need - y0) / G)} m of road at ${pct(G)}`);
    if (hiWhy[i] === 'start') return out(`Can't climb ${m1(need - y0)} to clear ${why} in ${Math.round(run)} m at ${pct(G)} (needs ${Math.round((need - y0) / G)} m) — start further back or steepen`);
    if (hiWhy[i] === 'end') return out(`Can't come back down ${m1(need - hi[i])} to meet the road at the end after ${why} (needs ${Math.round((need - hi[i]) / G)} m at ${pct(G)})`);
    if (hiWhy[i] === 'the junction') return out(`Too high to join ${why === 'level' ? 'the road' : 'the crossing road'} here (${m1(f[i])} vs ${m1(hi[i])}) — try Bridge`);
    return out(`Can't get low enough to pass under ${hiWhy[i]} (${m1(hi[i])} max) after clearing ${why}`);
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
