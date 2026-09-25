// The baked real-region format (docs/real.md): what tools/os/bake.mjs writes and the game reads.
// A region is a square (50 km as standard) cut into data tiles (5 km). Each tile is one small
// binary file holding every layer inside it: heights on a grid, and features (buildings, roads,
// railways, water, sea, woods, green space…) as polylines or polygons with a class and a name.
//
// Coordinates are game metres (x east, z south, the region's centre at 0, 0), stored as whole
// multiples of Q metres relative to the tile's corner, delta-encoded as zigzag varints. Heights are
// decimetres (Int16). Everything here is pure: no DOM, no three.js, no imports (node runs this
// file directly for the bake).

export const FORMAT = 1;
export const Q = 0.5; // m: the coordinate quantum (OS OpenMap Local is surveyed to about 1 m)

// the layers, in the order they're written
export const LAYERS = ['heights', 'buildings', 'roads', 'rail', 'water', 'streams', 'sea', 'foreshore', 'woods', 'green', 'sites', 'points'] as const;
export type LayerName = (typeof LAYERS)[number];
export type GeomLayer = Exclude<LayerName, 'heights'>;
// how each layer's geometry is read: rings (polygons), lines, or single points
export const GEOM: Record<GeomLayer, 'poly' | 'line' | 'point'> = {
  buildings: 'poly', roads: 'line', rail: 'line', water: 'poly', streams: 'line', sea: 'poly', foreshore: 'poly', woods: 'poly', green: 'poly', sites: 'poly', points: 'point',
};

// Classes, by layer. The number is what's stored; the name is what the game reads.
export const ROAD_CLASSES = ['motorway', 'primary', 'a', 'b', 'minor', 'local', 'access', 'restricted', 'shared'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];
export const RAIL_CLASSES = ['multi', 'single', 'narrow', 'multi-tunnel', 'single-tunnel'] as const;
export const BUILDING_CLASSES = ['building', 'education', 'religious', 'medical', 'sport', 'retail', 'culture', 'transport', 'emergency', 'leisure', 'glasshouse'] as const;
export const GREEN_CLASSES = ['park', 'playing', 'golf', 'allotment', 'cemetery', 'religious', 'play', 'sport', 'bowls', 'tennis', 'other'] as const;
export const SITE_CLASSES = ['school', 'college', 'university', 'hospital', 'care', 'transport', 'other'] as const;
export const POINT_CLASSES = ['station', 'roundabout', 'junction', 'place'] as const;
// a road's flags (stored in the class number's high bits)
export const DUAL = 16; // a collapsed dual carriageway
export const RAISED = 32; // drawn above what it crosses (DRAWLEVEL 1)

export interface Feature {
  c: number; // class (index into the layer's classes, with flags for roads)
  name?: string;
  parts: Float64Array[]; // x, z, x, z… in game metres
  holes?: boolean[]; // polygons: which parts are holes
}
export interface Heights { x0: number; z0: number; step: number; n: number; h: Float32Array } // n × n posts, row by row (z outer), metres
export interface Tile {
  i: number; j: number; // the tile's place in the region's grid (0 at the north-west)
  x0: number; z0: number; size: number; // its north-west corner and width in game metres
  heights?: Heights;
  layers: Partial<Record<GeomLayer, Feature[]>>;
}

// ---------------- writing ----------------
class Writer {
  private buf = new Uint8Array(1 << 16);
  len = 0;
  private need(n: number) {
    if (this.len + n <= this.buf.length) return;
    let m = this.buf.length * 2;
    while (m < this.len + n) m *= 2;
    const b = new Uint8Array(m); b.set(this.buf.subarray(0, this.len)); this.buf = b;
  }
  byte(v: number) { this.need(1); this.buf[this.len++] = v; }
  uv(v: number) { this.need(10); while (v >= 0x80) { this.buf[this.len++] = (v & 0x7f) | 0x80; v = Math.floor(v / 128); } this.buf[this.len++] = v; }
  sv(v: number) { this.uv(v < 0 ? -2 * v - 1 : 2 * v); }
  bytes(b: Uint8Array) { this.need(b.length); this.buf.set(b, this.len); this.len += b.length; }
  str(s: string) { const b = new TextEncoder().encode(s); this.uv(b.length); this.bytes(b); }
  done() { return this.buf.slice(0, this.len); }
}

// One tile as bytes. Coordinates are rounded to Q; a polygon ring's closing point (equal to its
// first) is dropped, and consecutive equal points after rounding are merged.
export function encodeTile(t: Tile): Uint8Array {
  const w = new Writer();
  w.byte(0x52); w.byte(0x54); w.byte(FORMAT); // "RT" and the version
  w.sv(t.i); w.sv(t.j); w.sv(Math.round(t.x0)); w.sv(Math.round(t.z0)); w.uv(Math.round(t.size));
  // names first, shared by every layer
  const names: string[] = [], index = new Map<string, number>();
  for (const L of Object.values(t.layers)) for (const f of L ?? []) if (f.name && !index.has(f.name)) { index.set(f.name, names.length + 1); names.push(f.name); }
  w.uv(names.length);
  for (const s of names) w.str(s);
  if (t.heights) {
    const H = t.heights;
    w.uv(0); w.uv(H.n); w.uv(Math.round(H.step * 10));
    // (row by row, each height a delta on the one before it: hills change slowly, so these are small)
    let prev = 0;
    for (let k = 0; k < H.h.length; k++) { const v = Math.round(H.h[k] * 10); w.sv(v - prev); prev = v; }
  }
  LAYERS.forEach((name, id) => {
    if (name === 'heights') return;
    const fs = t.layers[name];
    if (!fs?.length) return;
    const poly = GEOM[name] === 'poly';
    w.uv(id); w.uv(fs.length);
    let px = 0, pz = 0;
    for (const f of fs) {
      w.uv(f.c); w.uv(f.name ? index.get(f.name)! : 0);
      const parts = f.parts.map((p) => quantise(p, t.x0, t.z0, poly));
      const keep = parts.map((p, k) => ({ p, hole: !!f.holes?.[k] })).filter(({ p }) => p.length >= (poly ? 6 : GEOM[name] === 'point' ? 2 : 4));
      w.uv(keep.length);
      for (const { p, hole } of keep) {
        w.uv((p.length / 2) * 2 + (hole ? 1 : 0));
        for (let k = 0; k < p.length; k += 2) { w.sv(p[k] - px); w.sv(p[k + 1] - pz); px = p[k]; pz = p[k + 1]; }
      }
    }
  });
  return w.done();
}
function quantise(p: ArrayLike<number>, x0: number, z0: number, ring: boolean): number[] {
  const out: number[] = [];
  for (let k = 0; k < p.length; k += 2) {
    const x = Math.round((p[k] - x0) / Q), z = Math.round((p[k + 1] - z0) / Q);
    const n = out.length;
    if (n && out[n - 2] === x && out[n - 1] === z) continue;
    out.push(x, z);
  }
  if (ring && out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
  return out;
}

// ---------------- reading ----------------
export function decodeTile(bytes: Uint8Array): Tile {
  let o = 0;
  const uv = () => { let v = 0, m = 1, b; do { b = bytes[o++]; v += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return v; };
  const sv = () => { const v = uv(); return v % 2 ? -(v + 1) / 2 : v / 2; };
  if (bytes[0] !== 0x52 || bytes[1] !== 0x54) throw new Error('not a real-region tile');
  if (bytes[2] !== FORMAT) throw new Error(`real-region tile format ${bytes[2]}, expected ${FORMAT}`);
  o = 3;
  const i = sv(), j = sv(), x0 = sv(), z0 = sv(), size = uv();
  const names = [''], dec = new TextDecoder();
  for (let k = uv(); k > 0; k--) { const n = uv(); names.push(dec.decode(bytes.subarray(o, o + n))); o += n; }
  const t: Tile = { i, j, x0, z0, size, layers: {} };
  while (o < bytes.length) {
    const id = uv(), name = LAYERS[id];
    if (!name) throw new Error(`unknown layer ${id}`);
    if (name === 'heights') {
      const n = uv(), step = uv() / 10, h = new Float32Array(n * n);
      let prev = 0;
      for (let k = 0; k < h.length; k++) { prev += sv(); h[k] = prev / 10; }
      t.heights = { x0, z0, step, n, h };
      continue;
    }
    const count = uv(), fs: Feature[] = new Array(count);
    let px = 0, pz = 0;
    for (let f = 0; f < count; f++) {
      const c = uv(), ni = uv(), np = uv(), parts: Float64Array[] = [], holes: boolean[] = [];
      for (let p = 0; p < np; p++) {
        const head = uv(), n = Math.floor(head / 2), a = new Float64Array(n * 2);
        holes.push(head % 2 === 1);
        for (let k = 0; k < n; k++) { px += sv(); pz += sv(); a[2 * k] = x0 + px * Q; a[2 * k + 1] = z0 + pz * Q; }
        parts.push(a);
      }
      const feat: Feature = { c, parts };
      if (ni) feat.name = names[ni];
      if (holes.some(Boolean)) feat.holes = holes;
      fs[f] = feat;
    }
    t.layers[name as GeomLayer] = fs;
  }
  return t;
}

// ---------------- the region ----------------
export type PlaceKind = 'city' | 'town' | 'village' | 'hamlet' | 'suburb';
export interface Place { name: string; kind: PlaceKind; x: number; z: number; r: number; buildings: number; people: number }
export interface Station { name: string; x: number; z: number }
export interface RegionManifest {
  format: number;
  id: string;
  name: string;
  blurb: string;
  size: number; // m across (50 km as standard)
  tile: number; // m across a data tile
  n: number; // tiles across
  step: number; // m between height posts
  // where it is: British National Grid of the centre, and its latitude and longitude
  grid: { e: number; n: number };
  centre: { lat: number; lon: number };
  places: Place[];
  stations: Station[];
  home: string; // the place the game starts over
  attribution: string;
  licence: string;
  sources: string[];
  stats: Record<string, number>;
  tiles: string[]; // the tiles that exist ("i-j"): all of them, unless the square runs off the data
  bytes: number;
}
export const tileFile = (i: number, j: number) => `t/${i}-${j}.bin`;
