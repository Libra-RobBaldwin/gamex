// Shopping complexes (docs/shopping.md): a run of shop plots side by side along one side of a street
// becomes one plot and one building (buildgen.ts's complex recipes), holding as many shops as the
// plots it replaces, so the economy's counts don't change. Pure: plots in, plots out.
import type { Lot } from './roads';

// a complex's plot: how many shops it holds rides along with it (and in saves)
export type ComplexLot = Lot & { units?: number };

// A plot's frame: along the road (local +x) and out from it (local +z, to the road)
const axes = (l: Lot) => ({ ax: Math.cos(l.rot), az: Math.sin(l.rot), nx: -Math.sin(l.rot), nz: Math.cos(l.rot) });

// Merge runs of neighbouring shop plots (same street and side, lined up, nothing between them) in a
// street's new plots. Runs of `min` or more become a parade or, long enough, an arcade.
export function groupShops(lots: Lot[], opts: { min?: number; arcadeFrom?: number } = {}): ComplexLot[] {
  const min = opts.min ?? 2, arcadeFrom = opts.arcadeFrom ?? 60;
  const out: ComplexLot[] = [];
  let run: Lot[] = [];
  const flush = () => {
    if (run.length >= min) out.push(merge(run, arcadeFrom));
    else out.push(...run);
    run = [];
  };
  for (const l of lots) {
    const prev = run[run.length - 1];
    if (l.kind !== 'shop' || l.arch) { flush(); out.push(l); continue; }
    if (prev && !follows(prev, l)) flush();
    run.push(l);
  }
  flush();
  return out;
}

// is b the next plot along from a (same street and side, square to it, touching)?
function follows(a: Lot, b: Lot) {
  if (a.seg !== b.seg || a.row !== b.row) return false;
  const da = Math.atan2(Math.sin(b.rot - a.rot), Math.cos(b.rot - a.rot));
  if (Math.abs(da) > 0.08) return false;
  const { ax, az, nx, nz } = axes(a), dx = b.x - a.x, dz = b.z - a.z;
  const along = dx * ax + dz * az, out = dx * nx + dz * nz;
  // (the fronts in line, whatever the depths; the plots end to end, their gaps included)
  const fa = a.d / 2 + a.front, fb = b.d / 2 + b.front;
  if (Math.abs(out + fb - fa) > 1.5) return false;
  const reach = (a.pw + b.pw) / 2 + 1.5;
  return Math.abs(along) <= reach && Math.abs(along) > 1;
}

function merge(run: Lot[], arcadeFrom: number): ComplexLot {
  const a = run[0], { ax, az, nx, nz } = axes(a);
  // the run's extent along the street (plots with their gaps), and the line of its fronts
  let lo = Infinity, hi = -Infinity, front = Infinity, depth = 0, h = 0;
  const fa = a.d / 2 + a.front;
  for (const l of run) {
    const along = (l.x - a.x) * ax + (l.z - a.z) * az;
    lo = Math.min(lo, along + l.px - l.pw / 2); hi = Math.max(hi, along + l.px + l.pw / 2);
    front = Math.min(front, l.front); depth = Math.max(depth, l.d); h = Math.max(h, l.h);
  }
  // (each plot's gap is on the same side of it: the run's is at its end on that side)
  const last = run[run.length - 1], g = Math.abs(last.pw - last.w), sg = last.px >= 0 ? 1 : -1, pw = hi - lo, w = pw - g;
  // (the building's middle: along the run, set back so its front keeps the street's line)
  const mid = sg > 0 ? lo + w / 2 : lo + g + w / 2, off = fa - (depth / 2 + front);
  const cx = a.x + ax * mid + nx * off, cz = a.z + az * mid + nz * off;
  return {
    ...a, x: cx, z: cz, w, d: depth, h, front, back: Math.max(...run.map((l) => l.back)), px: (sg * g) / 2, pw,
    arch: w >= arcadeFrom ? 'arcade' : 'parade', units: run.length,
  };
}
