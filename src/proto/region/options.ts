// What a player chooses before a generated map is made, like Transport Fever 2's new-game screen:
// a seed and a few settings. The same options always make the same map, in well under a second,
// so a map is shared as its options (the URL carries them all).
//
//   ?map=region&seed=7&rivers=2&lakes=1&towns=3&villages=7&style=desert&relief=rolling
//
// Pure: no three.js, no DOM.

export type Style = 'temperate' | 'desert' | 'arctic';
// How hilly the ground is (worldmap/terrain.ts): flat to mountain. Rolling by default.
export type Relief = 'flat' | 'lowland' | 'rolling' | 'upland' | 'mountain';
// What kind of country a 50 km map is (worldmap/landform.ts), and its islands. Each LANDFORMS entry
// below is one of the region setup's choices.
export type Landform = 'vale' | 'downs' | 'estuary' | 'uplands' | 'mountains' | 'coast' | 'islands';
export type Islands = 'none' | 'few' | 'archipelago' | 'one';
export interface RegionOptions {
  seed: number;
  rivers: number; // 0–3, each right across the map
  lakes: number; // 0–4
  city: boolean; // one city in the middle
  towns: number; // market towns, 0–6
  villages: number; // 0–12
  style: Style;
  relief: Relief;
  size: number; // km across: 50, the one map (worldmap/, streamed); an old 6 km address opens it too
  sea: boolean; // a coast along one edge, with the sea beyond (50 km maps)
  // (50 km maps: the land, worldmap/landform.ts)
  landform: Landform;
  islands: Islands; // none, a few offshore, an archipelago, or the map as one big island
  hills: number; // how hilly, 0–100 (50: the landform as it is; −1 the same)
  water: number; // how wet: rivers and lakes, 0–100 (50 as it is; −1 the same)
  woods: number; // how wooded, 0–100 (50 as it is; −1 the same: the countryside's to read)
  real?: string; // a real region's id (public/regions/<id>, real/world.ts): the map is that region, not made up
}

export const STYLES: readonly Style[] = ['temperate', 'desert', 'arctic'];
export const LANDFORM_IDS: readonly Landform[] = ['vale', 'downs', 'estuary', 'uplands', 'mountains', 'coast', 'islands'];
export const ISLANDS: readonly Islands[] = ['none', 'few', 'archipelago', 'one'];
// The region setup's kinds of place (the coordinator's wizard shows these): each a real kind of
// British country, and the options it sets.
export interface LandformPreset { id: Landform; name: string; note: string; options: Partial<RegionOptions> }
export const LANDFORMS: readonly LandformPreset[] = [
  { id: 'vale', name: 'Lowland vale', note: 'Broad clay farmland, slow rivers winding through it, low ridges either side', options: { landform: 'vale', relief: 'lowland', sea: false, islands: 'none' } },
  { id: 'downs', name: 'Chalk downs', note: 'Rolling chalk hills with steep scarps, dry valleys and white cliffs to the sea', options: { landform: 'downs', relief: 'rolling', sea: true, islands: 'none' } },
  { id: 'estuary', name: 'River estuary', note: 'A wide river mouth reaching far inland, creeks and marsh, hills behind', options: { landform: 'estuary', relief: 'rolling', sea: true, islands: 'none' } },
  { id: 'uplands', name: 'Uplands and dales', note: 'High moorland cut by deep green dales, limestone and gritstone', options: { landform: 'uplands', relief: 'upland', sea: false, islands: 'none' } },
  { id: 'mountains', name: 'Mountains and lakes', note: 'Peaks, U-shaped valleys and long lakes in them, as in the Lake District', options: { landform: 'mountains', relief: 'mountain', sea: false, islands: 'none' } },
  { id: 'coast', name: 'Coast', note: 'Farmland and hills meeting the sea: headlands and cliffs, bays and beaches', options: { landform: 'coast', relief: 'rolling', sea: true, islands: 'none' } },
  { id: 'islands', name: 'Islands', note: 'An archipelago: islands big and small in a sheltered sea', options: { landform: 'islands', relief: 'rolling', sea: true, islands: 'archipelago' } },
];
export const RELIEFS: readonly Relief[] = ['flat', 'lowland', 'rolling', 'upland', 'mountain'];
// A 50 km map holds about as many places as a real 50 km square of England (docs/streaming.md).
export const SIZES = [50] as const;
export const WORLD_LIMITS = { rivers: [0, 4], lakes: [0, 12], towns: [0, 30], villages: [0, 250] } as const;
export const limitsFor = (_size: number) => WORLD_LIMITS;

// The defaults: two rivers, and the seed decides the lakes, towns and villages (−1).
export const DEFAULT_OPTIONS: RegionOptions = { seed: 7, rivers: 2, lakes: -1, city: true, towns: -1, villages: -1, style: 'temperate', relief: 'rolling', size: 50, sea: true, landform: 'coast', islands: 'none', hills: -1, water: -1, woods: -1 };

const clampInt = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, Math.round(v)));

// Fill in and tidy what was asked for (anything missing or out of range falls back or is clamped).
export function regionOptions(o: Partial<RegionOptions> = {}): RegionOptions {
  const size = (SIZES as readonly number[]).includes(Number(o.size)) ? Number(o.size) : DEFAULT_OPTIONS.size;
  const L = limitsFor(size);
  const d = { ...DEFAULT_OPTIONS, ...o };
  const out: RegionOptions = {
    seed: Number.isFinite(d.seed) ? Math.abs(Math.floor(d.seed)) % 2 ** 31 : DEFAULT_OPTIONS.seed,
    rivers: clampInt(Number.isFinite(d.rivers) ? d.rivers : 1, L.rivers),
    lakes: d.lakes === -1 ? -1 : clampInt(Number.isFinite(d.lakes) ? d.lakes : 1, L.lakes),
    city: d.city !== false,
    towns: d.towns === -1 ? -1 : clampInt(Number.isFinite(d.towns) ? d.towns : 3, L.towns),
    villages: d.villages === -1 ? -1 : clampInt(Number.isFinite(d.villages) ? d.villages : 7, L.villages),
    style: STYLES.includes(d.style) ? d.style : 'temperate',
    relief: RELIEFS.includes(d.relief) ? d.relief : 'rolling',
    size,
    sea: d.sea !== false,
    landform: LANDFORM_IDS.includes(d.landform) ? d.landform : DEFAULT_OPTIONS.landform,
    islands: ISLANDS.includes(d.islands) ? d.islands : 'none',
    hills: d.hills === -1 ? -1 : clampInt(Number.isFinite(d.hills) ? d.hills : 50, [0, 100]),
    water: d.water === -1 ? -1 : clampInt(Number.isFinite(d.water) ? d.water : 50, [0, 100]),
    woods: d.woods === -1 ? -1 : clampInt(Number.isFinite(d.woods) ? d.woods : 50, [0, 100]),
  };
  if (typeof d.real === 'string' && /^[a-z0-9-]+$/.test(d.real)) out.real = d.real;
  // (a map needs somewhere to start: with nothing asked for, one village)
  if (!out.city && out.towns === 0 && out.villages === 0) out.villages = 1;
  return out;
}

// From a URL's query (?seed=…&rivers=…): only what's there overrides the defaults.
export function optionsFromQuery(q: URLSearchParams): RegionOptions {
  const num = (k: string) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : undefined);
  const o: Partial<RegionOptions> = {};
  for (const k of ['seed', 'rivers', 'lakes', 'towns', 'villages', 'size', 'hills', 'water', 'woods'] as const) { const v = num(k); if (v !== undefined) o[k] = v; }
  if (q.has('landform')) o.landform = q.get('landform') as Landform;
  if (q.has('islands')) o.islands = q.get('islands') as Islands;
  if (q.has('city')) o.city = q.get('city') !== '0' && q.get('city') !== 'false';
  if (q.has('sea')) o.sea = q.get('sea') !== '0' && q.get('sea') !== 'false';
  if (q.has('style')) o.style = q.get('style') as Style;
  if (q.has('relief')) o.relief = q.get('relief') as Relief;
  if (q.has('real')) o.real = q.get('real')!;
  return regionOptions(o);
}

// And back: the query that makes this map again (only what differs from the defaults).
export function optionsQuery(o: RegionOptions): string {
  const q = new URLSearchParams({ map: 'region' });
  // (every option is spelt out: the address is shared and saved, and should make the same map
  // whatever the defaults become)
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof RegionOptions)[]) q.set(k, k === 'city' || k === 'sea' ? (o[k] ? '1' : '0') : String(o[k]));
  return q.toString();
}
