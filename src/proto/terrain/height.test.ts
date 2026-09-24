import { describe, expect, it } from 'vitest';
import { CachedHeight, FlatHeight, FnHeight, tileGrid, tileOf } from './height';
import { ProceduralTerrain, TERRAIN_PRESETS } from './procedural';
import { GridHeight, LocalFrame, Mosaic, TerrariumHeight, decodeTerrarium, encodeTerrarium, mercatorPixel, parseAsciiGrid, tileFor } from './raster';

const range = (a: Float32Array) => { let lo = Infinity, hi = -Infinity; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; };

describe('height sources', () => {
  it('slopes and normals from any height function', () => {
    const ramp = new FnHeight((x) => 0.1 * x);
    expect(ramp.heightAt(50, 7)).toBeCloseTo(5);
    expect(ramp.slopeAt(3, 4)).toBeCloseTo(0.1);
    const [nx, ny, nz] = ramp.normalAt(0, 0);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1);
    expect(nx).toBeLessThan(0); // rising eastwards, so the normal leans west
    expect(nz).toBeCloseTo(0);
    const flat = new FlatHeight(3, (x) => x > 10);
    expect(flat.isWater(20, 0)).toBe(true);
    expect(flat.isWater(0, 0)).toBe(false);
    expect(flat.sample(tileGrid(0, 0, 4, 100)).every((v) => v === 3)).toBe(true);
  });

  it('the cache reads back what the source says, a tile at a time', () => {
    const src = new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 5 });
    const c = new CachedHeight(src, 250, 2);
    let worst = 0;
    for (let k = 0; k < 400; k++) {
      const x = (k * 37.3) % 700 - 200, z = (k * 91.7) % 700 - 300;
      worst = Math.max(worst, Math.abs(c.heightAt(x, z) - src.heightAt(x, z)));
    }
    expect(worst).toBeLessThan(0.25); // bilinear over 2 m cells, on hills tens of metres high
    expect(c.misses).toBeLessThanOrEqual(16); // a 700 m square touches at most 4 × 4 tiles
    const before = c.hits + c.misses;
    for (let k = 0; k < 50; k++) c.heightAt(10 + k, 10); // consecutive reads in one tile don't even touch the map
    expect(c.hits + c.misses).toBe(before + 1);
    expect(tileOf(-1, 1001)).toEqual([-1, 1]);
  });
});

describe('procedural terrain', () => {
  it('is deterministic: same seed, same ground, whatever order it is asked in', () => {
    const a = new ProceduralTerrain({ seed: 42 }), b = new ProceduralTerrain({ seed: 42 }), c = new ProceduralTerrain({ seed: 43 });
    b.sample(tileGrid(3, -2, 50)); // warm b's caches somewhere else first
    const ga = a.sample(tileGrid(0, 0, 64)), gb = b.sample(tileGrid(0, 0, 64)), gc = c.sample(tileGrid(0, 0, 64));
    expect(ga).toEqual(gb);
    expect(ga).not.toEqual(gc);
  });

  it('whole-grid sampling agrees with point queries, and tiles meet exactly at their edges', () => {
    const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.upland, seed: 9 });
    // fine grids interpolate the lattice separably; coarse ones on lattice points evaluate it
    // directly; coarse ones off the lattice are within millimetres
    for (const [n, tol] of [[400, 3], [64, 3], [50, 1]]) {
      const g = tileGrid(1, 1, n), d = t.sample(g);
      for (const [i, j] of [[0, 0], [7, 31], [n, n], [23, 4]]) expect(d[j * g.nx + i]).toBeCloseTo(t.heightAt(g.x0 + i * g.step, g.z0 + j * g.step), tol);
      const west = t.sample(tileGrid(0, 1, n)), south = t.sample(tileGrid(1, 2, n)), m = n + 1;
      for (let j = 0; j <= n; j++) expect(west[j * m + n]).toBe(d[j * m]);
      for (let i = 0; i <= n; i++) expect(south[i]).toBe(d[n * m + i]);
    }
  });

  it('the presets run from nearly flat to mountainous', () => {
    const relief = (k: keyof typeof TERRAIN_PRESETS) => {
      const t = new ProceduralTerrain({ ...TERRAIN_PRESETS[k], seed: 2 });
      return range(t.sample({ x0: -8000, z0: -8000, step: 100, nx: 161, nz: 161 }));
    };
    const flat = relief('flat'), low = relief('lowland'), roll = relief('rolling'), up = relief('upland'), mtn = relief('mountain');
    expect(flat).toBeLessThan(0.01);
    expect(low).toBeLessThan(roll);
    expect(roll).toBeLessThan(up);
    expect(up).toBeLessThan(mtn);
    expect(low).toBeLessThan(40);
    expect(mtn).toBeGreaterThan(300);
  });

  it('has rivers in valleys and lakes with level surfaces', () => {
    const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 4, lakes: 0.6 });
    const g = { x0: -6000, z0: -6000, step: 20, nx: 601, nz: 601 };
    const w = t.sampleWater(g), h = t.sample(g);
    let wet = 0;
    const levels = new Map<number, number>();
    for (let k = 0; k < w.length; k++) if (w[k] === w[k]) { wet++; expect(w[k]).toBeGreaterThan(h[k]); const q = Math.round(w[k]); levels.set(q, (levels.get(q) ?? 0) + 1); }
    expect(wet / w.length).toBeGreaterThan(0.005);
    expect(wet / w.length).toBeLessThan(0.3);
    // lakes are flat: a handful of surface levels hold most of the lake area
    const top = [...levels.values()].sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0);
    expect(top / wet).toBeGreaterThan(0.4);
    // and water sits low: wet points are well below the average ground
    let mean = 0, wetMean = 0;
    for (let k = 0; k < h.length; k++) { mean += h[k]; if (w[k] === w[k]) wetMean += h[k]; }
    expect(wetMean / wet).toBeLessThan(mean / h.length);
    const k = w.findIndex((v) => v === v), x = g.x0 + (k % g.nx) * g.step, z = g.z0 + Math.floor(k / g.nx) * g.step;
    expect(t.isWater(x, z)).toBe(true);
    expect(t.waterLevel(x, z)).toBeCloseTo(w[k], 3);
  });

  it('can have a sea', () => {
    const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.lowland, seed: 8, sea: 10, rivers: 0, lakes: 0 });
    const g = { x0: -5000, z0: -5000, step: 50, nx: 201, nz: 201 }, h = t.sample(g), w = t.sampleWater(g);
    for (let k = 0; k < h.length; k++) expect(w[k] === w[k]).toBe(h[k] < 10);
  });
});

describe('real elevation data', () => {
  it('decodes Terrarium colours to metres', () => {
    // 0 m is (128, 0, 0); 1000.5 m is (131, 232, 128); −10 m is (127, 246, 0)
    expect([...decodeTerrarium([128, 0, 0, 255, 131, 232, 128, 255, 127, 246, 0, 255], 3, 1)]).toEqual([0, 1000.5, -10]);
    const hs = [12.25, -3.5, 978.75, 0.00390625, 4000];
    expect([...decodeTerrarium(encodeTerrarium(hs), 5, 1)]).toEqual(hs);
  });

  it('parses an ESRI ASCII grid with no-data cells', () => {
    const g = parseAsciiGrid('ncols 3\nnrows 2\nxllcorner 1000\nyllcorner 2000\ncellsize 50\nNODATA_value -9999\n1 2 3\n4 -9999 6\n');
    expect(g.ncols).toBe(3);
    expect(g.cell).toBe(50);
    expect(g.data[0]).toBe(1);
    expect(Number.isNaN(g.data[4])).toBe(true);
    expect(() => parseAsciiGrid('ncols 3\nnrows 2\nxllcorner 0\nyllcorner 0\ncellsize 5\n1 2')).toThrow(/short/);
  });

  // two 3×3 OS-style grids side by side on a 50 m lattice, heights = easting/10 + northing/100
  const asc = (xll: number, yll: number) => {
    const rows: string[] = [];
    for (let r = 0; r < 3; r++) { const N = yll + 25 + (2 - r) * 50; rows.push([0, 1, 2].map((c) => (xll + 25 + c * 50) / 10 + N / 100).join(' ')); }
    return `ncols 3\nnrows 3\nxllcorner ${xll}\nyllcorner ${yll}\ncellsize 50\n${rows.join('\n')}\n`;
  };

  it('OS Terrain 50 grids: exact at the posts, bilinear between, seamless across tiles', () => {
    const src = new GridHeight(400000, 300150); // world origin at E 400000, N 300150
    src.addAscii(asc(400000, 300000));
    src.addAscii(asc(400150, 300000)); // the tile to the east
    const f = (E: number, N: number) => E / 10 + N / 100;
    const at = (E: number, N: number) => src.heightAt(E - 400000, 300150 - N);
    expect(at(400025, 300025)).toBeCloseTo(f(400025, 300025), 4);
    expect(at(400060, 300090)).toBeCloseTo(f(400060, 300090), 4); // between posts: the plane is exact
    // across the seam: between the last post of the west tile (E 400125) and the first of the east (400175)
    for (const E of [400126, 400150, 400170]) expect(at(E, 300075)).toBeCloseTo(f(E, 300075), 4);
    expect(src.slopeAt(400150 - 400000, 300150 - 300075)).toBeCloseTo(Math.hypot(0.1, 0.01), 3);
    // off the data: the fallback, and known() says so
    expect(src.known(5000, 5000)).toBe(false);
    expect(src.heightAt(5000, 5000)).toBe(0);
  });

  it('a missing neighbour or no-data cell is skipped, not averaged in as zero', () => {
    const m = new Mosaic();
    m.add({ i0: 0, j0: 0, w: 2, h: 2, data: new Float32Array([10, 10, 10, NaN]) });
    expect(m.sample(0.5, 0.5)).toBeCloseTo(10);
    expect(m.sample(1.5, 0)).toBeCloseTo(10); // half the weight is off the edge
    expect(Number.isNaN(m.sample(5, 5))).toBe(true);
  });

  it('Terrarium tiles in Web Mercator, placed in the local frame, with seams bridged', () => {
    const lat0 = 51.5, lon0 = -0.12, zoom = 12, frame = new LocalFrame(lat0, lon0);
    // the local frame round-trips
    const [la, lo] = frame.toLatLon(1234, -5678), [x, z] = frame.fromLatLon(la, lo);
    expect(x).toBeCloseTo(1234, 6);
    expect(z).toBeCloseTo(-5678, 6);
    expect(la).toBeGreaterThan(lat0); // negative z is north
    // fixture: height = global pixel x (so a smooth eastward ramp across tile boundaries)
    const [tx, ty] = tileFor(lat0, lon0, zoom);
    const src = new TerrariumHeight(frame, zoom);
    for (const [a, b] of [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]]) {
      const hs = new Float32Array(256 * 256);
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) hs[j * 256 + i] = (a * 256 + i) / 64;
      src.addTile(a, b, encodeTerrarium(hs));
    }
    // find the seam between tx and tx+1 in world x, then sample either side of it
    const [px] = mercatorPixel(lat0, lon0, zoom);
    const mPerPx = (40075016.7 * Math.cos((lat0 * Math.PI) / 180)) / (256 * 2 ** zoom);
    const seamX = ((tx + 1) * 256 - px) * mPerPx;
    const zs = 0;
    const hAt = (x: number) => src.heightAt(x, zs);
    const expected = (x: number) => (px + x / mPerPx - 0.5) / 64;
    for (const dx of [-30, -5, 0, 4, 25]) expect(hAt(seamX + dx)).toBeCloseTo(expected(seamX + dx), 1);
    expect(src.known(seamX, 0)).toBe(true);
    expect(src.tilesFor(-100, -100, 100, 100).length).toBeGreaterThanOrEqual(1);
  });

  it('sea: at or below sea level counts as water', () => {
    const src = new GridHeight(0, 150);
    src.addAscii('ncols 3\nnrows 3\nxllcorner 0\nyllcorner 0\ncellsize 50\n0 0 5\n0 0 5\n0 0 5\n');
    expect(src.isWater(25, 75)).toBe(true);
    expect(src.isWater(125, 75)).toBe(false);
  });
});
