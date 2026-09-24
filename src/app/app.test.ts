// The start menu's logic without a browser: where addresses lead, the map registry's contract,
// and settings surviving blocked storage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP, MAPS, mapById } from '../proto/maps';
import { gameSearch, route, screenOf } from './route';

describe('maps.ts, the registry the menu lists', () => {
  it('has the starter town (ready and the default), the region, real places and the sandbox', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['town', 'region', 'place', 'sandbox']);
    expect(mapById(DEFAULT_MAP)?.ready).toBe(true);
    expect(mapById('region')?.ready).toBe(false);
  });
  it('gives every map a name, a line of description and an icon, and says why one is not ready', () => {
    for (const m of MAPS) {
      expect(m.name && m.blurb && m.icon).toBeTruthy();
      if (!m.ready) expect(m.soon).toBeTruthy();
    }
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length);
  });
});

describe('route: the menu or straight into a game', () => {
  it('opens the menu with no map, on the screen the hash names', () => {
    expect(route('', '')).toEqual({ kind: 'menu', screen: 'home' });
    expect(route('', '#about')).toEqual({ kind: 'menu', screen: 'about' });
    expect(screenOf('#nonsense')).toBe('home');
  });
  it('goes straight into a ready map, and into the default for a real place', () => {
    expect(route('?map=town', '')).toMatchObject({ kind: 'game', map: { id: 'town' }, guide: false });
    expect(route('?map=sandbox&guide=1', '')).toMatchObject({ kind: 'game', map: { id: 'sandbox' }, guide: true });
    expect(route('?place=horley', '')).toMatchObject({ kind: 'game', map: { id: DEFAULT_MAP } });
  });
  it('lists the maps, saying why, for a map that is not ready or not there', () => {
    expect(route('?map=region', '')).toMatchObject({ kind: 'menu', screen: 'new', notice: expect.stringMatching(/Region/) });
    expect(route('?map=nowhere', '')).toMatchObject({ kind: 'menu', screen: 'new', notice: expect.stringMatching(/nowhere/) });
  });
  it('turns a flipped ready flag into a playable deep link', () => {
    const region = mapById('region')!;
    region.ready = true;
    try { expect(route('?map=region', '')).toMatchObject({ kind: 'game', map: { id: 'region' } }); } finally { region.ready = false; }
    expect(gameSearch(region)).toBe('?map=region');
  });
});

describe('store: settings when storage is blocked', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it('remembers for the page when localStorage throws', async () => {
    const no = () => { throw new Error('SecurityError'); };
    vi.stubGlobal('localStorage', { getItem: no, setItem: no, removeItem: no });
    const s = await import('./store');
    expect(s.quality()).toBe('auto');
    expect(s.guideSeen()).toBe(false);
    s.setQuality(2);
    s.setGuideSeen(true);
    expect(s.quality()).toBe(2);
    expect(s.guideSeen()).toBe(true);
  });
  it('reads back what it stored, and ignores a tier that is out of range', async () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
    const s = await import('./store');
    s.setQuality(4);
    expect(m.get(s.KEYS.quality)).toBe('4');
    m.set(s.KEYS.quality, '9');
    expect(s.quality()).toBe('auto');
    s.setGuideSeen(true); s.setGuideSeen(false);
    expect(m.has(s.KEYS.guide)).toBe(false);
  });
});
