// Every number that shapes the countryside, in one place (fields.ts, woods.ts and the far-tile
// look read them). Tune from real data here: the OS import (OS Open Zoomstack woodland, OpenMap
// Local) will feed shape statistics back into these. Pure data.
export const COUNTRYSIDE = {
  // ---- farm blocks and fields (fields.ts) ----
  block: 650, // m between farm-block seeds (each block's fields run one way)
  alignReach: 380, // m: a block lines its fields up with a road or river this close to its middle
  fieldHa: { base: 4, arable: 7.5 }, // target field size: base + arable × the block's ploughed share (ha)
  nearTown: { reach: 700, least: 0.6 }, // fields shrink towards a settlement, to `least` of the size at its edge
  slopeShrink: 6, // target ÷ (1 + slope × this)
  keepWhole: [0.7, 1.3], // a piece is left whole once smaller than this range × target (picked per piece)
  minPiece: 0.3, // no cut that leaves a piece under this × target
  laneSplitMin: 8000, // m²: a road splits a field only if both sides are at least this
  belt: { chance: 0.1, width: [16, 24], minBlock: 5 }, // shelter belts: chance per cut on a block over minBlock × target
  arable: { base: 0.3, noise: 0.9, noiseScale: 1700, flatSlope: 0.13, townFade: 500, water: 0.5 }, // a block's ploughed share
  // ---- what fields are ----
  crops: { wheat: 0.34, barley: 0.22, ley: 0.14, stubble: 0.11, plough: 0.12, rape: 0.07 }, // arable shares (sum 1)
  farmCrops: [0.45, 0.25], // share of a farm's arable in its first and second crops (the rest at random)
  ley: { silageFarm: 0.35, onSilage: 0.45, otherwise: 0.12 }, // grass fields cut for silage
  rough: { high: 0.62, highChance: 0.6, water: 25, waterChance: 0.35, steep: 0.12, steepChance: 0.45 },
  // ---- woods (woods.ts) ----
  woods: {
    clump: { scale: 1300, fine: 450, above: 0.64, gain: 3 }, // old woods: where the noise is high
    hanging: { slope: 0.12, gain: 5, base: 0.25, most: 0.6 }, // on the steepest slopes
    wet: { water: 50, maxArea: 3e4, chance: 0.4 }, // wet woodland on small fields by the water
    copse: { maxArea: 1.6e4, town: 250, chance: 0.16 },
    high: { above: 0.7, chance: 0.22 },
    belt: 0.92,
    nearTown: 250, // fewer woods within this of a settlement
    conifer: { high: 0.6, onHigh: 0.55, elsewhere: 0.12 }, // plantations (a farm block at a time)
  },
  // ---- farmsteads ----
  farms: { none: 0.35, two: 0.45, reach: 700, beside: 260, off: 30, apart: 380, town: 160 },
  // ---- the far look: one colour a cover class (sRGB), for a far tile's texture (fields.ts tileCover) ----
  far: {
    grass: '#6b8a47', ley: '#6f9a4c', wheat: '#b69d5d', barley: '#bfb17f', plough: '#7a6650', rape: '#c3b54e', stubble: '#b0a077',
    wood: '#3d6130', conifer: '#2d4f33', rough: '#83845a', hedge: '#3b4d2a', none: '#6a8846',
  },
};
