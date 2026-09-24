// What the ground can be, and the colours it comes in. A British countryside and market-town edge
// seen from above: muted olives, sages and straws rather than lime, so that roads, vehicles and
// buildings stay the most readable things on screen. Colours are sRGB hex (as a painter would
// pick them); the material converts them to linear once. Nothing here bakes in lighting: the
// scene's Lambert lights, shadows and dusk do that.

// The cover map holds these per texel (two RGBA textures, see paint.ts):
//   A.r lawn     mown grass: gardens, verges, parks, playing fields
//   A.g field    a crop or grass field (which one and its row direction are in B)
//   A.b wood     woodland floor: leaf litter and moss under trees
//   A.a bare     worn or bare earth: gateways, building sites, yards
//   B.r crop     which crop (CROP below), as (index + ½) / 8
//   B.g dir      the field's row (or mowing-stripe) direction, 0..1 for 0..π
//   B.b rough    rough, tussocky grass: field margins, verges out of town, waste ground
//   B.a wet      lush damp grass near water
// Whatever isn't lawn, field, wood or bare is pasture, the default everywhere. Rock, scree and
// heather aren't painted: the shader finds them from the slope and the height.

export const CROP = { grass: 0, ley: 1, wheat: 2, barley: 3, plough: 4, rape: 5, stubble: 6, stripes: 7 } as const;
export type CropName = keyof typeof CROP;
export const CROP_NAMES = Object.keys(CROP) as CropName[];

// How each crop looks: two colours the macro noise moves between (a field is never one flat
// colour), and its rows: spacing in metres (0 for none), strength, and whether a sprayer's
// tramlines run through it every 24 m.
export interface CropLook { a: string; b: string; rows: number; row: number; tram: boolean }
export const CROPS: Record<CropName, CropLook> = {
  grass: { a: '#6b8a47', b: '#7a914e', rows: 0, row: 0, tram: false }, // a grass field grazed or cut for hay
  ley: { a: '#628d45', b: '#6f9a4c', rows: 1.2, row: 0.05, tram: false }, // sown grass, lusher, faint drill rows
  wheat: { a: '#b99f5c', b: '#c8ad69', rows: 0.9, row: 0.07, tram: true },
  barley: { a: '#c4b57f', b: '#cdbf8e', rows: 0.9, row: 0.06, tram: true },
  plough: { a: '#7c6249', b: '#8a6f52', rows: 1.1, row: 0.16, tram: false }, // furrows
  rape: { a: '#c9b84a', b: '#b7ae4c', rows: 0, row: 0, tram: true }, // oilseed rape in flower, toned down
  stubble: { a: '#b3a275', b: '#a79a70', rows: 0.9, row: 0.08, tram: true },
  stripes: { a: '#6e9449', b: '#76994e', rows: 7, row: 0.045, tram: false }, // mown lawn: stripes, not a crop
};

// The rest of the palette.
export const PALETTE = {
  pasture: '#6a8846', // the default: grazed grass
  pastureDry: '#7e9150', // yellower patches (drier, thinner soil)
  pastureCool: '#5c7f4a', // bluer patches (damper, shaded)
  rough: '#83845a', // tussocks with straw in them
  lawn: '#6c9248',
  wood: '#4f5634', // moss and ivy
  litter: '#6a563a', // last year's leaves
  bare: '#86705a',
  bareDark: '#6d5a45',
  wet: '#547c45',
  rock: '#83827a',
  scree: '#9b978b',
  heather: '#6d5961',
  moor: '#747449', // bleached moor grass between the heather
  daisy: '#e9e6d6',
  buttercup: '#d7c04a',
};

// The ground's quality levels. `high` is the look; `low` is for the game's Fast and Fastest tiers
// (fewer texture reads, no second detail layer, cheaper macro variation).
export type GroundQuality = 'high' | 'medium' | 'low';
// Texture reads per ground fragment at each level (checked against the compiled shader in tests).
export const SAMPLES: Record<GroundQuality, number> = { high: 5, medium: 4, low: 3 };
