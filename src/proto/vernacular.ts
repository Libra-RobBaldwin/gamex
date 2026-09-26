// Where a building stands decides what it's built of: the rock under it, the climate it's in,
// and how old its part of town is. This picks a "place" for any point on a map (docs/vernacular.md);
// buildgen.ts builds from it. Pure: no three.js, no DOM, deterministic from the map's seed, so a
// worker building a tile gets the same answer as the page.
//
// Britain (the temperate style): the building stone follows the geology, as it does in the real
// country — honey limestone in the Cotswolds, dark gritstone in the Pennines, grey slate and
// whitewash in the Lakes and Wales, granite in Cornwall and Scotland (harled, crow-stepped in
// Scotland), flint on the chalk, red brick and clay tile on the Midland clays, timber frame and
// tile hanging in the Weald, black-and-white in the Welsh Marches. The other styles have one
// climate each: Nordic timber under snow (arctic), whitewash and terracotta or earth-rendered
// flat roofs (desert), and stilted, verandahed houses under tin (tropical).
import { rng } from './roads';

export type Rock = 'limestone' | 'gritstone' | 'granite' | 'slate' | 'chalk' | 'clay' | 'sandstone';
export type Vern =
  | 'cotswold' | 'pennine' | 'lakeland' | 'cornish' | 'scots' | 'flint' | 'clayvale' | 'weald' | 'marches'
  | 'nordic' | 'med' | 'desert' | 'tropical';
export type Era = 'medieval' | 'georgian' | 'victorian' | 'interwar' | 'postwar' | 'modern';
export type Province = 'southeast' | 'midlands' | 'north' | 'west' | 'scotland';
export interface Place { vern: Vern; era: Era; kind: 'village' | 'town' | 'city' }

export const VERNS: readonly Vern[] = ['cotswold', 'pennine', 'lakeland', 'cornish', 'scots', 'flint', 'clayvale', 'weald', 'marches', 'nordic', 'med', 'desert', 'tropical'];
export const VERN_NAME: Record<Vern, string> = {
  cotswold: 'Cotswold stone', pennine: 'Pennine gritstone', lakeland: 'Lakeland slate', cornish: 'Cornish granite', scots: 'Scottish harling',
  flint: 'Downland flint', clayvale: 'Midland brick', weald: 'Wealden', marches: 'Marches timber frame',
  nordic: 'Nordic timber', med: 'Mediterranean', desert: 'Desert earth', tropical: 'Tropical',
};

// ---------------- geology ----------------
// The terrain can tell us the rock at a point (the terrain session's geology query); until it
// does, a smooth seeded field stands in, drawing from the rocks the map's province has.
export type GeologyAt = (x: number, z: number) => Rock | null | undefined;
let provided: GeologyAt | null = null;
export function setGeology(f: GeologyAt | null) { provided = f; }

const ROCKS: Record<Province, [Rock, number][]> = {
  southeast: [['chalk', 3], ['clay', 3], ['sandstone', 1]], // (the Weald's sands and clays: tile hanging and timber)
  midlands: [['limestone', 3], ['clay', 3], ['sandstone', 1]],
  north: [['gritstone', 3], ['slate', 2], ['limestone', 1], ['clay', 1]],
  west: [['granite', 3], ['slate', 3], ['sandstone', 1]],
  scotland: [['granite', 3], ['sandstone', 2], ['slate', 1]],
};
// a map's province: lowland maps lie in the south and east, mountain maps in the north and west
export function provinceOf(seed: number, relief: string): Province {
  const r = rng((seed ^ 0x5eed7e) >>> 0)();
  const w: Record<string, Province[]> = {
    flat: ['southeast', 'southeast', 'midlands', 'midlands', 'north'],
    lowland: ['southeast', 'midlands', 'midlands', 'north', 'west'],
    rolling: ['southeast', 'midlands', 'north', 'west', 'scotland'],
    upland: ['north', 'north', 'west', 'scotland', 'midlands'],
    mountain: ['north', 'west', 'scotland', 'scotland', 'north'],
  };
  const list = w[relief] ?? w.rolling;
  return list[Math.floor(r * list.length) % list.length];
}

// smooth value noise, ~2.5 km across: neighbouring villages often share a stone, distant ones don't
const hash2 = (i: number, j: number, s: number) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function noise(x: number, z: number, s: number) {
  const L = 2500, u = x / L, v = z / L, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const a = hash2(i, j, s), b = hash2(i + 1, j, s), c = hash2(i, j + 1, s), d = hash2(i + 1, j + 1, s);
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
export function fallbackRock(prov: Province, seed: number, x: number, z: number): Rock {
  const list = ROCKS[prov], total = list.reduce((a, [, w]) => a + w, 0);
  // (two octaves, stretched so every rock turns up across a map)
  let t = (noise(x, z, seed) * 0.7 + noise(x * 2.3 + 900, z * 2.3 - 400, seed + 1) * 0.3 - 0.5) * 1.8 + 0.5;
  t = Math.max(0, Math.min(0.9999, t)) * total;
  for (const [rock, w] of list) { if (t < w) return rock; t -= w; }
  return list[0][0];
}

// the local stone's building tradition, in this province
export function vernOf(rock: Rock, prov: Province): Vern {
  switch (rock) {
    case 'limestone': return 'cotswold'; // (the Dales' limestone reads close enough to the Cotswolds' at this scale)
    case 'gritstone': return 'pennine';
    case 'slate': return 'lakeland';
    case 'granite': return prov === 'scotland' ? 'scots' : prov === 'north' ? 'pennine' : 'cornish';
    case 'chalk': return 'flint';
    case 'sandstone': return prov === 'scotland' ? 'scots' : prov === 'southeast' ? 'weald' : prov === 'north' ? 'pennine' : 'marches';
    case 'clay': return prov === 'southeast' ? 'weald' : prov === 'scotland' ? 'scots' : 'clayvale';
  }
}

// ---------------- era ----------------
// How old a spot's buildings are, by how far it is from its settlement's centre: a medieval core,
// Georgian and Victorian rings, then interwar semis, post-war estates and modern edges.
// (distances in a market town's metres; a city's rings are twice as wide, a village's core is its
// whole old street)
const ERAS: [number, Era][] = [[45, 'medieval'], [85, 'georgian'], [160, 'victorian'], [215, 'interwar'], [270, 'postwar'], [Infinity, 'modern']];
export function eraAt(d: number, kind: Place['kind'], jitter: number): Era {
  const s = kind === 'city' ? d / 2 : kind === 'village' ? (d < 75 ? d * 0.55 : 150 + (d - 75) * 1.1) : d;
  const e = s + (jitter - 0.5) * 50;
  for (const [lim, era] of ERAS) if (e < lim) return era;
  return 'modern';
}

// ---------------- places ----------------
export interface PlaceMap {
  seed: number;
  style: string; // temperate, desert, arctic, tropical
  relief: string;
  settlements: { x: number; z: number; kind: string }[];
}
const climateVern: Record<string, Vern | undefined> = { arctic: 'nordic', desert: 'desert', tropical: 'tropical' };

// A resolver for a map: (x, z) -> the place there. `force` fixes the tradition (?vern=… for testing
// and screenshots) while eras still follow the plan.
export function placeResolver(m: PlaceMap, force?: Vern) {
  const prov = provinceOf(m.seed, m.relief);
  const cache = new Map<number, Vern>();
  const vernAt = (si: number): Vern => {
    let v = cache.get(si);
    if (v) return v;
    const s = m.settlements[si];
    const climate = climateVern[m.style];
    if (force) v = force;
    else if (climate === 'desert') v = hash2(Math.round(s.x), Math.round(s.z), m.seed) < (s.kind === 'village' ? 0.7 : 0.35) ? 'desert' : 'med'; // (villages of earth, towns whitewashed)
    else if (climate) v = climate;
    else v = vernOf(provided?.(s.x, s.z) ?? fallbackRock(prov, m.seed, s.x, s.z), prov);
    cache.set(si, v);
    return v;
  };
  return (x: number, z: number): Place => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < m.settlements.length; i++) { const s = m.settlements[i], d = Math.hypot(x - s.x, z - s.z); if (d < bd) { bd = d; bi = i; } }
    const s = m.settlements[bi];
    const kind = (s?.kind === 'city' || s?.kind === 'village' ? s.kind : 'town') as Place['kind'];
    const jitter = hash2(Math.floor(x / 23), Math.floor(z / 23), m.seed + 7); // (patches of a street share an era)
    return { vern: s ? vernAt(bi) : force ?? 'clayvale', era: eraAt(bd, kind, jitter), kind };
  };
}
