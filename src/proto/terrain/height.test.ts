import { describe, expect, it } from 'vitest';
import { CachedHeight, FlatHeight, FnHeight, tileGrid, tileOf } from './height';
import { landSource } from '../worldmap/land';
import { GridHeight, LocalFrame, Mosaic, TerrariumHeight, decodeTerrarium, encodeTerrarium, mercatorPixel, parseAsciiGrid, tileFor } from './raster';


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
    const src = landSource({ landform: 'uplands', seed: 7 }).source;
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
