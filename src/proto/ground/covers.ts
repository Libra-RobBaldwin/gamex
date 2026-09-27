// What the ground can be, and the colours it comes in. A British countryside and market-town edge
// seen from above: muted olives, sages and straws rather than lime, so that roads, vehicles and
// buildings stay the most readable things on screen. Colours are sRGB hex (as a painter would
// pick them); the material converts them to linear once. Nothing here bakes in lighting: the
// scene's Lambert lights, shadows and dusk do that.

// The cover map is one RGBA texture (one texture read per pixel), each channel something that
// blends sensibly when the texture is filtered. Covers that never meet share a channel, one on
// each side of ½ (½ is plain pasture):
//   R  lawn ← ½ → field    mown grass (gardens, verges, parks) below ½, a crop or grass field above
//   G  crop and row        which crop (CROP below, top 3 bits) and its row direction (32 steps
//                          over half a turn, low 5 bits); read only where there's a field or lawn,
//                          which never reaches a boundary where two codes meet
//   B  bare ← ½ → wood     worn or bare earth below, woodland floor above
//   A  wet ← ½ → rough     lush damp grass by water below, rough tussocky grass above
// Rock, scree and heather aren't painted: the shader finds them from the slope and the height.
export const DIRS = 32;
export function packCover(lawn: number, field: number, wood: number, bare: number, rough: number, wet: number, crop: number, dir: number, out: Uint8Array, o: number) {
  const q = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v) * 127.5;
  out[o] = 127.5 + q(field) - q(lawn) + 0.5;
  out[o + 1] = crop * DIRS + (Math.round((dir / Math.PI) * DIRS) % DIRS);
  out[o + 2] = 127.5 + q(wood) - q(bare) + 0.5;
  out[o + 3] = 127.5 + q(rough) - q(wet) + 0.5;
}
export function unpackCover(d: Uint8Array, o: number) {
  const s = (v: number) => (v - 127.5) / 127.5;
  const r = s(d[o]), b = s(d[o + 2]), a = s(d[o + 3]);
  return { field: Math.max(0, r), lawn: Math.max(0, -r), wood: Math.max(0, b), bare: Math.max(0, -b), rough: Math.max(0, a), wet: Math.max(0, -a), crop: d[o + 1] >> 5, dir: ((d[o + 1] & 31) / DIRS) * Math.PI };
}

export const CROP = { grass: 0, ley: 1, wheat: 2, barley: 3, plough: 4, rape: 5, stubble: 6, stripes: 7 } as const;
export type CropName = keyof typeof CROP;
export const CROP_NAMES = Object.keys(CROP) as CropName[];

// How each crop looks: two colours the macro noise moves between (a field is never one flat
// colour), and its rows: spacing in metres (0 for none), strength, and whether a sprayer's
// tramlines run through it every 24 m.
export interface CropLook { a: string; b: string; rows: number; row: number; tram: boolean; tex: number } // tex: how strongly the grass/soil detail shows
export const CROPS: Record<CropName, CropLook> = {
  grass: { a: '#6b8a47', b: '#7a914e', rows: 0, row: 0, tram: false, tex: 1.0 }, // a grass field grazed or cut for hay
  ley: { a: '#628d45', b: '#6f9a4c', rows: 1.2, row: 0.05, tram: false, tex: 0.85 }, // sown grass, lusher, faint drill rows
  wheat: { a: '#b69d5d', b: '#c4aa68', rows: 0.6, row: 0.05, tram: true, tex: 0.6 },
  barley: { a: '#bfb17f', b: '#c9bb8b', rows: 0.6, row: 0.045, tram: true, tex: 0.55 },
  plough: { a: '#7a6650', b: '#86715a', rows: 1.1, row: 0.14, tram: false, tex: 0.45 }, // furrows
  rape: { a: '#c3b54e', b: '#b1a94e', rows: 0, row: 0, tram: true, tex: 0.6 }, // oilseed rape in flower, toned down
  stubble: { a: '#b0a077', b: '#a49871', rows: 0.6, row: 0.06, tram: true, tex: 0.6 },
  stripes: { a: '#6e9449', b: '#76994e', rows: 7, row: 0.045, tram: false, tex: 0.5 }, // mown lawn: stripes, not a crop
};

// ---- the farming year ----
// How each crop looks through the year: keyframes at a month (0 is 1 January, 12 the next; the
// year wraps), each with the two field colours and the rows as `CropLook` has them (the row
// spacing, its strength, and whether tramlines run through it; the detail strength stays the
// crop's). Between keyframes the look is blended, so a field never jumps. The looks in CROPS are
// the mid-July ones, which the game starts on. What the keys follow, for the lowland English
// year: winter wheat drilled in October, green and low over the winter, thick by May, turning in
// June, gold in July, cut in August, its stubble ploughed in September; spring barley ploughed
// over the winter, drilled in April, pale gold by July, cut in August; oilseed rape drilled in
// September, low green over the winter, in yellow flower April to May, green then brown pods to
// July, cut in early August; a ley cut for silage in May and July, fresh again after each cut;
// the field left in stubble is winter barley's, cut early in July and left over the winter, then
// ploughed and drilled in the spring; pasture yellows in a dry August and dulls in the winter.
export interface CropKey { m: number; a: string; b: string; rows?: number; row?: number; tram?: boolean } // (rows, row, tram: the crop's if left out)
export const CROP_YEAR: Record<CropName, CropKey[]> = {
  grass: [{ m: 0.5, a: '#6e874d', b: '#798c52' }, { m: 3.5, a: '#638a45', b: '#70914c' }, { m: 6.5, a: '#6b8a47', b: '#7a914e' }, { m: 8, a: '#7c8e4d', b: '#899351' }, { m: 10, a: '#6a8848', b: '#77904e' }],
  ley: [{ m: 0.5, a: '#5f8447', b: '#6b8d4c' }, { m: 3.5, a: '#5a8d40', b: '#679947' }, { m: 5.2, a: '#77934d', b: '#829a52', row: 0.12 }, { m: 6.5, a: '#628d45', b: '#6f9a4c' }, { m: 7.6, a: '#7a944e', b: '#849b53', row: 0.12 }, { m: 9.5, a: '#5f8c44', b: '#6c974b' }],
  wheat: [
    { m: 0.5, a: '#6f8654', b: '#7a8f58', row: 0.1 }, { m: 3.5, a: '#5b8a3d', b: '#679447', row: 0.06 }, { m: 5.5, a: '#8d9a56', b: '#9ba35d' }, { m: 6.5, a: '#b69d5d', b: '#c4aa68' },
    { m: 7.5, a: '#b0a077', b: '#a49871', row: 0.06 }, { m: 8.5, a: '#7a6650', b: '#86715a', rows: 1.1, row: 0.14, tram: false }, { m: 9.8, a: '#7c7354', b: '#87795a', row: 0.12 }, { m: 11.5, a: '#6f8654', b: '#7a8f58', row: 0.1 },
  ],
  barley: [
    { m: 0.5, a: '#7a6650', b: '#86715a', rows: 1.1, row: 0.14, tram: false }, { m: 3.5, a: '#807b52', b: '#8b8558', row: 0.1 }, { m: 4.8, a: '#699045', b: '#759a4c' }, { m: 6.5, a: '#bfb17f', b: '#c9bb8b' },
    { m: 7.5, a: '#b3a87b', b: '#bcb186' }, { m: 8.5, a: '#b0a077', b: '#a49871', row: 0.06 }, { m: 10.5, a: '#7a6650', b: '#86715a', rows: 1.1, row: 0.14, tram: false },
  ],
  plough: [{ m: 0.5, a: '#6f5c48', b: '#7a6651' }, { m: 6.5, a: '#7a6650', b: '#86715a' }, { m: 9.5, a: '#7a6650', b: '#86715a' }],
  rape: [
    { m: 0.5, a: '#5f7f44', b: '#6a8a4b', row: 0.05 }, { m: 3.2, a: '#7f9448', b: '#8a9a4c' }, { m: 4, a: '#c9c052', b: '#b8b04f' }, { m: 5, a: '#c3b54e', b: '#b1a94e' }, { m: 6.5, a: '#a3a05d', b: '#979658' },
    { m: 7.5, a: '#b0a077', b: '#a49871', row: 0.06 }, { m: 8.5, a: '#7a6650', b: '#86715a', rows: 1.1, row: 0.14, tram: false }, { m: 10, a: '#6f8a4c', b: '#7a9152', row: 0.05 },
  ],
  stubble: [{ m: 0.5, a: '#a89a74', b: '#9c916e' }, { m: 2.8, a: '#7a6650', b: '#86715a', rows: 1.1, row: 0.14, tram: false }, { m: 4.3, a: '#7f8a56', b: '#89935b', row: 0.1 }, { m: 5.8, a: '#9a9a5e', b: '#a5a264' }, { m: 6.5, a: '#b0a077', b: '#a49871' }, { m: 9.5, a: '#ada07a', b: '#a19672' }],
  stripes: [{ m: 0.5, a: '#6b8f4a', b: '#73944f' }, { m: 4, a: '#679449', b: '#6f994e' }, { m: 6.5, a: '#6e9449', b: '#76994e' }, { m: 8.5, a: '#76944c', b: '#7d9850' }],
};
// A crop's look at a point in the year (0 to 1: January to December, wrapping), blended between
// its keyframes. Colours come back as sRGB 0..1 triples.
export interface CropLookAt { a: [number, number, number]; b: [number, number, number]; rows: number; row: number; tram: number }
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export function cropLookAt(crop: CropName, t: number): CropLookAt {
  const L = CROPS[crop], keys = CROP_YEAR[crop], m = (((t % 1) + 1) % 1) * 12, n = keys.length;
  // the keyframes either side of the month (the year wraps: the last key before the first)
  let k = n - 1;
  for (let i = 0; i < n; i++) if (keys[i].m <= m) k = i;
  const p = keys[k], q = keys[(k + 1) % n];
  const span = ((q.m - p.m) + 12) % 12 || 12, u = (((m - p.m) + 12) % 12) / span;
  const mix = (a: number, b: number) => a + (b - a) * u;
  const A = hex(p.a), B = hex(q.a), C = hex(p.b), D = hex(q.b);
  return {
    a: [mix(A[0], B[0]), mix(A[1], B[1]), mix(A[2], B[2])], b: [mix(C[0], D[0]), mix(C[1], D[1]), mix(C[2], D[2])],
    rows: mix(p.rows ?? L.rows, q.rows ?? L.rows), row: mix(p.row ?? L.row, q.row ?? L.row), tram: mix((p.tram ?? L.tram) ? 1 : 0, (q.tram ?? L.tram) ? 1 : 0),
  };
}
// Where in the year the game's clock is (minutes; a game day is a month in the town's life, and
// the game starts in mid-July, when the fields look as CROPS has them).
export const START_MONTH = 6.5;
export const seasonOf = (clock: number) => (((clock / 1440 + START_MONTH) / 12) % 1 + 1) % 1;

// The rest of the palette.
export const PALETTE = {
  pasture: '#6a8846', // the default: grazed grass
  pastureDry: '#7e9150', // yellower patches (drier, thinner soil)
  pastureCool: '#5c7f4a', // bluer patches (damper, shaded)
  rough: '#83845a', // tussocks with straw in them
  lawn: '#6a8b4a', // a touch fresher and finer than pasture (not lime: it covers every garden and verge in town)
  wood: '#44502f', // moss, ivy and bramble under the canopy
  litter: '#5d4f35', // last year's leaves
  bare: '#86705a',
  bareDark: '#6d5a45',
  wet: '#547c45',
  rock: '#77766f',
  scree: '#8b877d',
  heather: '#695a5c',
  moor: '#747449', // bleached moor grass between the heather
  daisy: '#e9e6d6',
  buttercup: '#d7c04a',
};

// The ground's quality levels. `high` is the look; `low` is for the game's Fast and Fastest tiers
// (fewer texture reads, no second detail layer, cheaper macro variation).
export type GroundQuality = 'high' | 'medium' | 'low';
// Texture reads per ground fragment at each level (checked against the compiled shader in tests).
export const SAMPLES: Record<GroundQuality, number> = { high: 4, medium: 3, low: 3 };
