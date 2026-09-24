// Where an address takes you: the start menu (and which of its screens), or straight into a game.
// `/?map=<id>` and `/?place=<id>` are deep links that skip the menu; `#new`, `#how`, `#library`,
// `#settings` and `#about` are the menu's own screens, so the phone's back button steps back through them.

import { DEFAULT_MAP, mapById, type MapInfo } from '../proto/maps';

export const SCREENS = ['home', 'new', 'region', 'how', 'library', 'settings', 'about'] as const;
export type Screen = (typeof SCREENS)[number];

export type Route =
  | { kind: 'menu'; screen: Screen; notice?: string }
  | { kind: 'game'; map: MapInfo; guide: boolean };

export function screenOf(hash: string): Screen {
  const s = hash.replace(/^#/, '');
  return (SCREENS as readonly string[]).includes(s) ? (s as Screen) : 'home';
}

export function route(search: string, hash: string): Route {
  const q = new URLSearchParams(search);
  const id = q.get('map');
  // a real place (Real Town Plans' "Play it in 3D"): the game reads ?place= itself
  if (id === null && q.has('place')) return { kind: 'game', map: mapById(DEFAULT_MAP)!, guide: false };
  if (id === null) return { kind: 'menu', screen: screenOf(hash) };
  const map = mapById(id);
  if (!map) return { kind: 'menu', screen: 'new', notice: `There’s no map called “${id}”. Pick one of these.` };
  if (!map.ready) return { kind: 'menu', screen: 'new', notice: `${map.name}: ${map.soon ?? 'coming soon'}.` };
  return { kind: 'game', map, guide: q.get('guide') === '1' };
}

/** The address a game is played at: `?map=<id>`, or a query that already names the map and its options. */
export const gameSearch = (map: MapInfo, query?: string) => (query ? `?${query}` : `?map=${encodeURIComponent(map.id)}`);
