// The start menu's logic without a browser: where addresses lead, the map registry's contract,
// and settings surviving blocked storage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP, GONE, MAPS, mapById } from '../proto/maps';
import { gameSearch, route, screenOf } from './route';

describe('maps.ts, the registry the menu lists', () => {
  it('has one map, the region (the default, with its setup and the guide), and real places inside it', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['region', 'exe', 'teme']);
    expect(DEFAULT_MAP).toBe('region');
    expect(mapById('region')).toMatchObject({ ready: true, setup: true, guide: true });
    expect(MAPS.filter((m) => m.id !== 'region').every((m) => m.inRegion)).toBe(true);
    expect(Object.keys(GONE)).toEqual(['town', 'sandbox', 'place']);
  });
  it('gives every map a name, a line of description and an icon', () => {
    for (const m of MAPS) expect(m.name && m.blurb && m.icon).toBeTruthy();
    expect(new Set(MAPS.map((m) => m.id)).size).toBe(MAPS.length);
  });
});

describe('route: the menu or straight into a game', () => {
  it('opens the menu with no map, on the screen the hash names', () => {
    expect(route('', '')).toEqual({ kind: 'menu', screen: 'home' });
    expect(route('', '#about')).toEqual({ kind: 'menu', screen: 'about' });
    expect(screenOf('#nonsense')).toBe('home');
  });
  it('turns old links to the starter town, the sandbox and Real Town Plans to the region setup, saying so', () => {
    expect(route('?map=town', '')).toMatchObject({ kind: 'menu', screen: 'region', notice: expect.stringMatching(/starter town is gone/) });
    expect(route('?map=sandbox&guide=1', '')).toMatchObject({ kind: 'menu', screen: 'region', notice: expect.stringMatching(/sandbox is gone/) });
    expect(route('?place=horley', '')).toMatchObject({ kind: 'menu', screen: 'region', notice: expect.stringMatching(/Real Town Plans is gone/) });
    expect(screenOf('#new')).toBe('region');
  });
  it('goes straight into a real place, and into the region with the guide', () => {
    expect(route('?map=exe', '')).toMatchObject({ kind: 'game', map: { id: 'exe' }, guide: false });
    expect(route('?map=region&guide=1', '')).toMatchObject({ kind: 'game', map: { id: 'region' }, guide: true });
  });
  it('goes straight into a region, with its options', () => {
    expect(route('?map=region&seed=42&style=desert', '')).toMatchObject({ kind: 'game', map: { id: 'region' } });
    expect(gameSearch(mapById('region')!, 'map=region&seed=42')).toBe('?map=region&seed=42');
  });
  it('opens the region setup, saying so, for a map that is not there', () => {
    expect(route('?map=nowhere', '')).toMatchObject({ kind: 'menu', screen: 'region', notice: expect.stringMatching(/nowhere/) });
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
