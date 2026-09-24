// What a player chooses before a generated map is made, like Transport Fever 2's new-game screen:
// a seed and a few settings. The same options always make the same map, in well under a second,
// so a map is shared as its options (the URL carries them all).
//
//   ?map=region&seed=7&rivers=2&lakes=1&towns=3&villages=7&style=desert&relief=rolling
//
// Pure: no three.js, no DOM.

export type Style = 'temperate' | 'desert' | 'arctic';
// How hilly the ground is (the terrain library's presets). Recorded in the map now; the game's
// ground turns hilly once the terrain integration lands (docs/regiongen.md, "Hills").
export type Relief = 'flat' | 'lowland' | 'rolling' | 'upland' | 'mountain';
export interface RegionOptions {
  seed: number;
  rivers: number; // 0–3, each right across the map
  lakes: number; // 0–4
  city: boolean; // one city in the middle
  towns: number; // market towns, 0–6
  villages: number; // 0–12
  style: Style;
  relief: Relief;
}

export const STYLES: readonly Style[] = ['temperate', 'desert', 'arctic'];
export const RELIEFS: readonly Relief[] = ['flat', 'lowland', 'rolling', 'upland', 'mountain'];
export const LIMITS = { rivers: [0, 3], lakes: [0, 4], towns: [0, 6], villages: [0, 12] } as const;

// The defaults: the region as it was first made (one river, one or two lakes, a city, three towns, six to eight villages).
export const DEFAULT_OPTIONS: RegionOptions = { seed: 7, rivers: 1, lakes: -1, city: true, towns: 3, villages: -1, style: 'temperate', relief: 'flat' };
// (−1: let the seed decide: one or two lakes, six to eight villages)

const clampInt = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, Math.round(v)));

// Fill in and tidy what was asked for (anything missing or out of range falls back or is clamped).
export function regionOptions(o: Partial<RegionOptions> = {}): RegionOptions {
  const d = { ...DEFAULT_OPTIONS, ...o };
  const out: RegionOptions = {
    seed: Number.isFinite(d.seed) ? Math.abs(Math.floor(d.seed)) % 2 ** 31 : DEFAULT_OPTIONS.seed,
    rivers: clampInt(Number.isFinite(d.rivers) ? d.rivers : 1, LIMITS.rivers),
    lakes: d.lakes === -1 ? -1 : clampInt(Number.isFinite(d.lakes) ? d.lakes : 1, LIMITS.lakes),
    city: d.city !== false,
    towns: clampInt(Number.isFinite(d.towns) ? d.towns : 3, LIMITS.towns),
    villages: d.villages === -1 ? -1 : clampInt(Number.isFinite(d.villages) ? d.villages : 7, LIMITS.villages),
    style: STYLES.includes(d.style) ? d.style : 'temperate',
    relief: RELIEFS.includes(d.relief) ? d.relief : 'flat',
  };
  // (a map needs somewhere to start: with nothing asked for, one village)
  if (!out.city && out.towns === 0 && out.villages === 0) out.villages = 1;
  return out;
}

// From a URL's query (?seed=…&rivers=…): only what's there overrides the defaults.
export function optionsFromQuery(q: URLSearchParams): RegionOptions {
  const num = (k: string) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : undefined);
  const o: Partial<RegionOptions> = {};
  for (const k of ['seed', 'rivers', 'lakes', 'towns', 'villages'] as const) { const v = num(k); if (v !== undefined) o[k] = v; }
  if (q.has('city')) o.city = q.get('city') !== '0' && q.get('city') !== 'false';
  if (q.has('style')) o.style = q.get('style') as Style;
  if (q.has('relief')) o.relief = q.get('relief') as Relief;
  return regionOptions(o);
}

// And back: the query that makes this map again (only what differs from the defaults).
export function optionsQuery(o: RegionOptions): string {
  const q = new URLSearchParams({ map: 'region' });
  for (const k of Object.keys(DEFAULT_OPTIONS) as (keyof RegionOptions)[]) {
    if (k === 'seed' || o[k] !== DEFAULT_OPTIONS[k]) q.set(k, k === 'city' ? (o.city ? '1' : '0') : String(o[k]));
  }
  return q.toString();
}
