// Where earthworks meet the ground. An embankment's side slopes run down from the edge of the
// road until they reach the ground (the toe); a cutting's run up until they break out at the top.
// That line is the edge of the land the road takes, so it is what the land registry should be
// told about, and where the drawing code should end its grassed slopes.

import type { HeightSource } from './height';
import type { AlignSpec, Kind, RouteAlignment, XZ } from './align';

export interface Section {
  i: number; kind: Kind;
  // offsets from the centreline (left positive, along +normal) of the slope's edge on each side;
  // equal to the half-width where there's no slope (at grade, on a bridge, in a tunnel)
  left: number; right: number;
  // the ground points where the slopes end, for drawing
  l: { x: number; z: number; y: number }; r: { x: number; z: number; y: number };
}

// Walk outwards from the road edge until the side slope crosses the ground.
function daylight(src: HeightSource, c: XZ, nx: number, nz: number, y: number, half: number, slope: number, up: boolean, reach: number) {
  // height of the slope face at offset o from the centreline
  const face = (o: number) => (up ? y + (o - half) / slope : y - (o - half) / slope);
  const gap = (o: number) => (up ? src.heightAt(c.x + nx * o, c.z + nz * o) - face(o) : face(o) - src.heightAt(c.x + nx * o, c.z + nz * o));
  let a = half;
  if (gap(a) <= 0) return a;
  for (let o = half + 1; o <= half + reach; o += 1) {
    if (gap(o) <= 0) {
      // bisect between the last point above and the first below
      let lo = a, hi = o;
      for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (gap(m) > 0) lo = m; else hi = m; }
      return hi;
    }
    a = o;
  }
  return half + reach; // the ground runs away from the slope (a ridge top): stop at the reach
}

// The cross-section edges at every sample of an aligned route.
export function sections(route: RouteAlignment, src: HeightSource, sp: AlignSpec, half = sp.width / 2): Section[] {
  const n = route.pts.length, out: Section[] = [];
  for (let i = 0; i < n; i++) {
    const a = route.pts[Math.max(0, i - 1)], b = route.pts[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L, c = route.pts[i], y = route.y[i], k = route.kind[i];
    let left = half, right = half;
    if (k === 'embankment' || k === 'cutting') {
      const up = k === 'cutting', slope = up ? sp.cutSlope : sp.fillSlope, reach = (up ? sp.maxCut : sp.maxFill) * slope * 2 + 5;
      left = daylight(src, c, nx, nz, y, half, slope, up, reach);
      right = daylight(src, c, -nx, -nz, y, half, slope, up, reach);
    }
    const at = (o: number) => { const x = c.x + nx * o, z = c.z + nz * o; return { x, z, y: src.heightAt(x, z) }; };
    out.push({ i, kind: k, left, right, l: at(left), r: at(-right) });
  }
  return out;
}

// Polygons of the land the earthworks take (beyond the road's own band), one run of quads per
// embankment or cutting, ready for Land.claim(key, 'road', polys). `every` merges samples so a
// long cutting is a handful of polygons rather than one per sample.
export function earthworkPolys(route: RouteAlignment, secs: Section[], every = 4): { kind: Kind; polys: XZ[][] }[] {
  const out: { kind: Kind; polys: XZ[][] }[] = [];
  const pt = (i: number, o: number) => {
    const n = route.pts.length, a = route.pts[Math.max(0, i - 1)], b = route.pts[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: route.pts[i].x - ((b.z - a.z) / L) * o, z: route.pts[i].z + ((b.x - a.x) / L) * o };
  };
  for (const sp of route.spans) {
    if (sp.kind !== 'embankment' && sp.kind !== 'cutting') continue;
    const polys: XZ[][] = [];
    // one sample either side, so neighbouring spans' footprints overlap rather than leave a gap
    const i0 = Math.max(0, sp.i0 - 1), i1 = Math.min(route.pts.length - 1, sp.i1 + 1);
    for (let i = i0; i < i1; i += every) {
      const j = Math.min(i1, i + every);
      // widest edge over the stretch, so the polygon covers every sample in it
      let l = 0, r = 0;
      for (let k = i; k <= j; k++) { l = Math.max(l, secs[k].left); r = Math.max(r, secs[k].right); }
      polys.push([pt(i, l), pt(j, l), pt(j, -r), pt(i, -r)]);
    }
    out.push({ kind: sp.kind, polys });
  }
  return out;
}
