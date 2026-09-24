// Review (look and realism): failing tests for what a player would notice on the ground.
import { describe, expect, it } from 'vitest';
import { bandPolys, circlePoly } from '../land';
import { Ground, type GroundInput, type XZ } from './index';
import { Layout, fromGrid, toGrid } from './layout';

// Every field parcel's outline in a square of countryside, as the player sees it: a merged pair
// is one field, a split cell is two. Corners where the outline turns by less than 12 degrees are
// not corners.
function parcelOutlines(seed: number, half: number) {
  const L = new Layout({ seed });
  const P = L.parcels, out: XZ[][] = [];
  const [i0, j0] = toGrid(-half, -half).map(Math.floor), n = Math.ceil((half * 2) / 165);
  for (let i = i0 - n; i <= i0 + 2 * n; i++) for (let j = j0 - n; j <= j0 + 2 * n; j++) {
    const c = P.cell(i, j), m = fromGrid(c.u, c.v);
    if (Math.abs(m.x) > half || Math.abs(m.z) > half) continue;
    if (c.merge || P.cell(i - 1, j).merge) continue; // (merged pairs: leave out, they're the minority)
    const { pts } = P.polygon(c);
    if (!c.split) { out.push(pts); continue; }
    // the two halves of a split cell
    const s = c.split, side = (p: XZ) => { const [u, v] = toGrid(p.x, p.z); return s.nu * u + s.nv * v - s.c; };
    for (const sgn of [1, -1]) {
      const poly: XZ[] = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length], fa = side(a) * sgn, fb = side(b) * sgn;
        if (fa >= 0) poly.push(a);
        if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); poly.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); }
      }
      if (poly.length >= 3) out.push(poly);
    }
  }
  return out;
}
function corners(poly: XZ[]) {
  const angles: number[] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[(k + poly.length - 1) % poly.length], q = poly[k], r = poly[(k + 1) % poly.length];
    const a1 = Math.atan2(q.z - p.z, q.x - p.x), a2 = Math.atan2(r.z - q.z, r.x - q.x);
    let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn * 180 / Math.PI < 12) continue;
    angles.push(180 - (turn * 180) / Math.PI); // interior angle
  }
  return angles;
}

describe('review: fields read as a patchwork, not a honeycomb', () => {
  // British field boundaries meet mostly near right angles (four-sided enclosure fields). A
  // jittered-grid Voronoi gives six-sided cells with ~120 degree corners, which from the Far zoom
  // reads as a honeycomb (see review-look-new-country-900.png, review-look-d-town-900.png).
  it('most fields are not hexagons and most corners are near square', () => {
    const polys = parcelOutlines(11, 1500);
    let six = 0, sq = 0, all = 0;
    for (const p of polys) {
      const a = corners(p);
      if (a.length >= 6) six++;
      for (const x of a) { all++; if (x >= 70 && x <= 110) sq++; }
    }
    const hexShare = six / polys.length, squareShare = sq / all;
    console.log(`fields ${polys.length}, six-or-more corners ${(hexShare * 100).toFixed(0)}%, corners 70-110deg ${(squareShare * 100).toFixed(0)}%`);
    expect(hexShare).toBeLessThan(0.3);
    expect(squareShare).toBeGreaterThan(0.45);
  });

  // Every field on one rotated grid: rows (along each field's longest edge) cluster on a couple of
  // directions across the whole map instead of each field having its own.
  it('arable rows point in many directions across the map', () => {
    const L = new Layout({ seed: 11 });
    const h = { id: 0, cell: L.parcels.cell(0, 0), edge: 0 }, seen = new Set<number>(), bins = new Array(6).fill(0);
    let n = 0;
    for (let x = -1500; x <= 1500; x += 40) for (let z = -1500; z <= 1500; z += 40) {
      L.parcels.hit(x, z, h);
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      const inf = L.about(h);
      if (inf.kind !== 'arable') continue;
      bins[Math.floor((inf.dir / Math.PI) * 6) % 6]++; n++;
    }
    const top = Math.max(...bins) / n;
    console.log(`arable fields ${n}, row directions in 30deg bins ${bins.join(' ')}, largest bin ${(top * 100).toFixed(0)}%`);
    expect(top).toBeLessThan(0.35);
  });
});

// A town, lanes out to the edge of the painted map, a lake (as in ground.test.ts, smaller).
function input(): GroundInput {
  const blocked: XZ[][] = [], lanes: NonNullable<GroundInput['lanes']> = [];
  const road = (a: XZ, b: XZ, half: number) => {
    const path: XZ[] = [];
    for (let t = 0; t <= 1.0001; t += 0.05) path.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    blocked.push(...bandPolys(path, half, half));
    lanes.push({ path, half });
  };
  road({ x: -100, z: 30 }, { x: -600, z: 90 }, 6);
  road({ x: 30, z: 100 }, { x: 60, z: 600 }, 6);
  const plots: NonNullable<GroundInput['plots']> = [];
  for (let x = -90; x < 90; x += 18) plots.push({ poly: [{ x, z: -15 }, { x: x + 15, z: -15 }, { x: x + 15, z: 15 }, { x, z: 15 }], kind: 'garden' });
  return { seed: 11, blocked, lanes, plots, water: [circlePoly({ x: 250, z: -190 }, 96, 48)] };
}

describe('review: hedgerows stay on the painted ground', () => {
  // The game's cover map is ±600 m but hedges are planned for every parcel edge touching it, so
  // they run on past it (to x = -711 in the game, where the ground plane ends at ±676: hedges
  // hang in the sky at the Far zoom, review-look-new-country-900.png bottom right and top right).
  it('no hedge piece or hedgerow tree lies outside the painted region', () => {
    const g = new Ground({ region: { x0: -600, z0: -600, size: 1200 }, seed: 11 });
    g.paint(input());
    const { pieces, trees } = g.hedgeList();
    const out = (p: { x: number; z: number; len?: number }) => Math.max(Math.abs(p.x), Math.abs(p.z)) + (p.len ?? 0) / 2 > 600;
    const po = pieces.filter(out).length, to = trees.filter(out).length;
    console.log(`hedge pieces ${pieces.length}, outside ${po}; trees ${trees.length}, outside ${to}`);
    expect(po).toBe(0);
    expect(to).toBe(0);
    g.dispose();
  });
});

describe('review: hedges read as one living hedge, not a row of boxes', () => {
  // Each 8 m piece gets its own height (1.5-2.1 m) and width (1.4-1.9 m) at random, so neighbours
  // step up and down by tens of centimetres: from the Close zoom a hedge is a row of green blocks
  // with visible steps (review-look-h-lane-35.png at 290,560 and 500,1120).
  it('neighbouring hedge pieces differ in height and width by only a little', () => {
    const g = new Ground({ region: { x0: -600, z0: -600, size: 1200 }, seed: 11 });
    g.paint(input());
    const { pieces } = g.hedgeList();
    const dh: number[] = [], dw: number[] = [];
    for (let i = 1; i < pieces.length; i++) {
      const a = pieces[i - 1], b = pieces[i];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 9.5) continue; // (next hedge)
      dh.push(Math.abs(a.h - b.h)); dw.push(Math.abs(a.w - b.w));
    }
    dh.sort((x, y) => x - y); dw.sort((x, y) => x - y);
    const p75h = dh[Math.floor(dh.length * 0.75)], p75w = dw[Math.floor(dw.length * 0.75)];
    console.log(`neighbouring pieces ${dh.length}: height step 75th pct ${p75h.toFixed(2)} m, width step ${p75w.toFixed(2)} m`);
    expect(p75h).toBeLessThan(0.12);
    expect(p75w).toBeLessThan(0.12);
    g.dispose();
  });
});
