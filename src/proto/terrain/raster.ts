// Real elevation data behind the same HeightSource interface as the procedural terrain.
//
// Two formats, both of which arrive as tiles:
//   - Terrarium (Mapzen / AWS Terrain Tiles, global, ~30 m at zoom 12): PNG tiles in Web Mercator,
//     each pixel's height packed into its colour. The caller decodes the PNG (a canvas in the
//     browser, any PNG library in node) and hands us the RGBA bytes; we turn them into metres.
//   - OS Terrain 50 (Great Britain, 50 m): ESRI ASCII grids on the British National Grid, 10 km a
//     tile. We parse the text.
// Samples from every tile go into one mosaic on a single integer lattice, so bilinear sampling
// near a tile edge simply reads the next tile's pixels: there are no seams to stitch. A missing
// tile (not loaded yet) or a no-data cell is skipped and the remaining corners reweighted, and
// where nothing is known at all the source returns its fallback height.

import { BaseHeight } from './height';

// ---------- decoding ----------
// Terrarium: height = R·256 + G + B/256 − 32768 metres.
export function decodeTerrarium(rgba: ArrayLike<number>, w: number, h: number, out = new Float32Array(w * h)) {
  for (let k = 0, o = 0; k < w * h; k++, o += 4) out[k] = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768;
  return out;
}
// The inverse, for making fixtures and caches (to the format's 1/256 m resolution).
export function encodeTerrarium(heights: ArrayLike<number>, out = new Uint8ClampedArray(heights.length * 4)) {
  for (let k = 0; k < heights.length; k++) {
    const q = Math.max(0, Math.min(0xffffff, Math.round((heights[k] + 32768) * 256)));
    out[k * 4] = q >> 16; out[k * 4 + 1] = (q >> 8) & 255; out[k * 4 + 2] = q & 255; out[k * 4 + 3] = 255;
  }
  return out;
}
// Mapbox Terrain-RGB, for completeness: height = −10000 + (R·65536 + G·256 + B) × 0.1.
export function decodeTerrainRgb(rgba: ArrayLike<number>, w: number, h: number, out = new Float32Array(w * h)) {
  for (let k = 0, o = 0; k < w * h; k++, o += 4) out[k] = -10000 + (rgba[o] * 65536 + rgba[o + 1] * 256 + rgba[o + 2]) * 0.1;
  return out;
}

// An ESRI ASCII grid (OS Terrain 50's ASCII format). Rows run north to south in the file.
export interface AsciiGrid { ncols: number; nrows: number; xll: number; yll: number; cell: number; nodata: number | null; center: boolean; data: Float32Array }
export function parseAsciiGrid(text: string): AsciiGrid {
  const head: Record<string, number> = {};
  let pos = 0;
  // header lines are "key value"; the first line starting with a number begins the data
  for (;;) {
    const end = text.indexOf('\n', pos), line = text.slice(pos, end < 0 ? undefined : end).trim();
    const m = /^([a-z_]+)\s+(-?[\d.eE+-]+)$/i.exec(line);
    if (!m) break;
    head[m[1].toLowerCase()] = parseFloat(m[2]);
    pos = end < 0 ? text.length : end + 1;
  }
  const ncols = head.ncols, nrows = head.nrows, cell = head.cellsize;
  if (!(ncols > 0 && nrows > 0 && cell > 0)) throw new Error('Not an ASCII grid: ncols, nrows and cellsize are needed');
  const center = head.xllcenter !== undefined;
  const xll = center ? head.xllcenter : head.xllcorner, yll = center ? head.yllcenter : head.yllcorner;
  if (xll === undefined || yll === undefined) throw new Error('ASCII grid has no xllcorner/yllcorner');
  const nodata = head.nodata_value ?? null;
  const data = new Float32Array(ncols * nrows);
  const nums = text.slice(pos).split(/\s+/);
  let k = 0;
  for (const s of nums) { if (!s) continue; if (k >= data.length) break; const v = parseFloat(s); data[k++] = nodata !== null && v === nodata ? NaN : v; }
  if (k < data.length) throw new Error(`ASCII grid is short: ${k} of ${data.length} values`);
  return { ncols, nrows, xll, yll, cell, nodata, center, data };
}

// ---------- the mosaic ----------
// Rectangles of samples on one global integer lattice: data[j·w + i] is lattice point (i0 + i, j0 + j).
// NaN means no data.
export interface RasterTile { i0: number; j0: number; w: number; h: number; data: Float32Array }
const BUCKET = 256;
export class Mosaic {
  private buckets = new Map<string, RasterTile[]>();
  private last: RasterTile | null = null;
  tiles: RasterTile[] = [];
  add(t: RasterTile) {
    this.remove(t.i0, t.j0);
    this.tiles.push(t);
    for (let a = Math.floor(t.i0 / BUCKET); a <= Math.floor((t.i0 + t.w - 1) / BUCKET); a++)
      for (let b = Math.floor(t.j0 / BUCKET); b <= Math.floor((t.j0 + t.h - 1) / BUCKET); b++) {
        const k = `${a},${b}`;
        let l = this.buckets.get(k);
        if (!l) this.buckets.set(k, (l = []));
        l.push(t);
      }
  }
  // Drop the tile whose corner is (i0, j0), e.g. when it scrolls out of range.
  remove(i0: number, j0: number) {
    const t = this.tiles.find((x) => x.i0 === i0 && x.j0 === j0);
    if (!t) return;
    this.tiles = this.tiles.filter((x) => x !== t);
    for (const l of this.buckets.values()) { const i = l.indexOf(t); if (i >= 0) l.splice(i, 1); }
    if (this.last === t) this.last = null;
  }
  value(i: number, j: number) {
    let t = this.last;
    if (!t || i < t.i0 || j < t.j0 || i >= t.i0 + t.w || j >= t.j0 + t.h) {
      t = null;
      for (const c of this.buckets.get(`${Math.floor(i / BUCKET)},${Math.floor(j / BUCKET)}`) ?? []) if (i >= c.i0 && j >= c.j0 && i < c.i0 + c.w && j < c.j0 + c.h) { t = c; break; }
      if (!t) return NaN;
      this.last = t;
    }
    return t.data[(j - t.j0) * t.w + (i - t.i0)];
  }
  // Bilinear at fractional lattice coordinates, ignoring missing corners.
  sample(fi: number, fj: number) {
    const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j;
    const v00 = this.value(i, j), v10 = this.value(i + 1, j), v01 = this.value(i, j + 1), v11 = this.value(i + 1, j + 1);
    if (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11) {
      const a = v00 + (v10 - v00) * ti, b = v01 + (v11 - v01) * ti;
      return a + (b - a) * tj;
    }
    let s = 0, w = 0;
    const acc = (v: number, k: number) => { if (v === v && k > 0) { s += v * k; w += k; } };
    acc(v00, (1 - ti) * (1 - tj)); acc(v10, ti * (1 - tj)); acc(v01, (1 - ti) * tj); acc(v11, ti * tj);
    return w > 1e-9 ? s / w : NaN;
  }
}

// ---------- projections ----------
// The game's local frame (x east, z south, metres) around an origin in latitude and longitude:
// an equirectangular tangent plane, accurate to well under a metre over a few tens of km.
const R_EARTH = 6378137;
export class LocalFrame {
  private kx: number;
  constructor(readonly lat0: number, readonly lon0: number) { this.kx = R_EARTH * Math.cos((lat0 * Math.PI) / 180); }
  toLatLon(x: number, z: number): [number, number] { return [this.lat0 - ((z / R_EARTH) * 180) / Math.PI, this.lon0 + ((x / this.kx) * 180) / Math.PI]; }
  fromLatLon(lat: number, lon: number): [number, number] { return [(((lon - this.lon0) * Math.PI) / 180) * this.kx, (-((lat - this.lat0) * Math.PI) / 180) * R_EARTH]; }
}
// Web Mercator: global pixel coordinates at a zoom level (256-pixel tiles).
export function mercatorPixel(lat: number, lon: number, zoom: number): [number, number] {
  const n = 256 * 2 ** zoom, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
}
// The slippy-map tile holding a point, for deciding which tiles to fetch.
export function tileFor(lat: number, lon: number, zoom: number): [number, number] {
  const [px, py] = mercatorPixel(lat, lon, zoom);
  return [Math.floor(px / 256), Math.floor(py / 256)];
}

// ---------- height sources ----------
export interface RasterOpts {
  fallback?: number; // height where nothing is loaded
  sea?: number | null; // at or below this is sea (null: no sea)
  water?: (x: number, z: number) => number | null; // extra water (rivers, lakes from map data)
}

// Any mosaic plus a mapping from world (x, z) to fractional lattice coordinates.
export class RasterHeight extends BaseHeight {
  readonly mosaic = new Mosaic();
  protected fallback: number;
  protected sea: number | null;
  protected extra?: (x: number, z: number) => number | null;
  constructor(protected toLattice: (x: number, z: number) => [number, number], cellMetres: number, o: RasterOpts = {}) {
    super();
    this.eps = cellMetres / 2;
    this.fallback = o.fallback ?? 0;
    this.sea = o.sea === undefined ? 0 : o.sea;
    this.extra = o.water;
  }
  heightAt(x: number, z: number) {
    const [fi, fj] = this.toLattice(x, z), v = this.mosaic.sample(fi, fj);
    return v === v ? v : this.fallback;
  }
  // true when data covers this point (false while its tile hasn't arrived)
  known(x: number, z: number) { const [fi, fj] = this.toLattice(x, z); return this.mosaic.sample(fi, fj) === this.mosaic.sample(fi, fj); }
  waterLevel(x: number, z: number) {
    const w = this.extra?.(x, z) ?? null;
    // OS Terrain 50 flattens the sea to exactly 0, so "at sea level" counts as sea
    if (this.sea !== null && this.heightAt(x, z) <= this.sea + 0.05) return Math.max(w ?? -Infinity, this.sea + 0.05);
    return w;
  }
}

// Terrarium tiles at one zoom level, placed in the game's local frame.
export class TerrariumHeight extends RasterHeight {
  constructor(readonly frame: LocalFrame, readonly zoom: number, o: RasterOpts = {}) {
    // pixel centres sit half a pixel in from the tile's corner
    super((x, z) => { const [lat, lon] = frame.toLatLon(x, z), [px, py] = mercatorPixel(lat, lon, zoom); return [px - 0.5, py - 0.5]; },
      (40075016.7 * Math.cos((frame.lat0 * Math.PI) / 180)) / (256 * 2 ** zoom), o);
  }
  addTile(tx: number, ty: number, rgba: ArrayLike<number>, size = 256) {
    this.mosaic.add({ i0: tx * size, j0: ty * size, w: size, h: size, data: decodeTerrarium(rgba, size, size) });
  }
  // the tiles covering a box in the local frame (what to fetch before building there)
  tilesFor(x0: number, z0: number, x1: number, z1: number): [number, number][] {
    const [la0, lo0] = this.frame.toLatLon(x0, z1), [la1, lo1] = this.frame.toLatLon(x1, z0);
    const [a0, b0] = tileFor(la1, lo0, this.zoom), [a1, b1] = tileFor(la0, lo1, this.zoom);
    const out: [number, number][] = [];
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) out.push([a, b]);
    return out;
  }
}

// British National Grid data (OS Terrain 50, or any ESRI ASCII grid in eastings and northings),
// placed with (e0, n0) at the world origin: x = E − e0, z = n0 − N.
export class GridHeight extends RasterHeight {
  private cell = 0;
  private offE = 0;
  private offN = 0;
  constructor(readonly e0: number, readonly n0: number, cell = 50, o: RasterOpts = {}) {
    super((x, z) => [(x + this.e0 - this.offE) / this.cell, (this.n0 - z - this.offN) / this.cell], cell, o);
    this.cell = cell;
  }
  // lattice j counts northwards, so the file's rows (north first) are flipped on the way in
  addGrid(g: AsciiGrid) {
    const cx = g.center ? g.xll : g.xll + g.cell / 2, cy = g.center ? g.yll : g.yll + g.cell / 2;
    if (!this.mosaic.tiles.length) { this.cell = g.cell; this.eps = g.cell / 2; this.offE = ((cx % g.cell) + g.cell) % g.cell; this.offN = ((cy % g.cell) + g.cell) % g.cell; }
    if (Math.abs(g.cell - this.cell) > 1e-9) throw new Error(`Grid cell ${g.cell} m doesn't match the mosaic's ${this.cell} m`);
    const i0 = Math.round((cx - this.offE) / this.cell), j0 = Math.round((cy - this.offN) / this.cell);
    const data = new Float32Array(g.ncols * g.nrows);
    for (let r = 0; r < g.nrows; r++) data.set(g.data.subarray(r * g.ncols, (r + 1) * g.ncols), (g.nrows - 1 - r) * g.ncols);
    this.mosaic.add({ i0, j0, w: g.ncols, h: g.nrows, data });
  }
  addAscii(text: string) { this.addGrid(parseAsciiGrid(text)); }
}
