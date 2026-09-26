import { describe, expect, it } from 'vitest';
import { eraAt, fallbackRock, placeResolver, provinceOf, setGeology, vernOf, VERNS } from './vernacular';
import { regionMap } from './region';

const spec = (seed: number, style = 'temperate', relief = 'rolling') => {
  const m = regionMap({ seed, style: style as 'temperate', relief: relief as 'rolling' });
  return { seed, style, relief, settlements: m.settlements };
};

describe('vernacular places', () => {
  it('are the same every time for a seed', () => {
    const a = placeResolver(spec(7)), b = placeResolver(spec(7));
    for (let i = 0; i < 50; i++) expect(a(i * 97 - 2500, i * 61 - 1500)).toEqual(b(i * 97 - 2500, i * 61 - 1500));
  });
  it('give a whole settlement one tradition, and different maps different ones', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const m = spec(seed), at = placeResolver(m);
      for (const s of m.settlements) {
        const v = at(s.x, s.z).vern;
        expect(at(s.x + 20, s.z - 15).vern).toBe(v);
        seen.add(v);
      }
    }
    // (every British tradition turns up somewhere across forty maps)
    for (const v of ['cotswold', 'pennine', 'lakeland', 'cornish', 'scots', 'flint', 'clayvale', 'weald', 'marches']) expect(seen).toContain(v);
  });
  it('follow the climate outside Britain', () => {
    const arctic = spec(3, 'arctic'), at = placeResolver(arctic);
    for (const s of arctic.settlements) expect(at(s.x, s.z).vern).toBe('nordic');
    const desert = spec(3, 'desert'), dt = placeResolver(desert);
    for (const s of desert.settlements) expect(['desert', 'med']).toContain(dt(s.x, s.z).vern);
  });
  it('age outwards from the centre', () => {
    expect(eraAt(10, 'town', 0.5)).toBe('medieval');
    expect(eraAt(120, 'town', 0.5)).toBe('victorian');
    expect(eraAt(400, 'town', 0.5)).toBe('modern');
    expect(eraAt(240, 'city', 0.5)).toBe('victorian'); // (a city's rings are twice as wide)
    expect(eraAt(40, 'village', 0.5)).toBe('medieval');
  });
  it('take the terrain’s rock when it gives one', () => {
    const m = spec(7);
    setGeology(() => 'chalk');
    try { const at = placeResolver(m); for (const s of m.settlements) expect(at(s.x, s.z).vern).toBe('flint'); }
    finally { setGeology(null); }
  });
  it('map every rock in every province to a tradition', () => {
    for (const p of ['southeast', 'midlands', 'north', 'west', 'scotland'] as const)
      for (const r of ['limestone', 'gritstone', 'granite', 'slate', 'chalk', 'clay', 'sandstone'] as const) expect(VERNS).toContain(vernOf(r, p));
    expect(['southeast', 'midlands', 'north', 'west', 'scotland']).toContain(provinceOf(9, 'mountain'));
    expect(typeof fallbackRock('north', 1, 0, 0)).toBe('string');
  });
});
