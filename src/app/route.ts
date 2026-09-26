// Where an address takes you: the start menu (and which of its screens), or straight into a game.
// `/?map=<id>` is a deep link that skips the menu (with `&save=<id>`, a saved town on that map); `#saves`, `#new`, `#how`, `#library`, `#settings` and `#about` are the menu's own screens, so the phone's back button steps back through them.

import { GONE, mapById, type MapInfo } from '../proto/maps';

export const SCREENS = ['home', 'saves', 'new', 'region', 'how', 'library', 'settings', 'about'] as const;
export type Screen = (typeof SCREENS)[number];

export type Route =
  | { kind: 'menu'; screen: Screen; notice?: string }
  | { kind: 'game'; map: MapInfo; guide: boolean };

export function screenOf(hash: string): Screen {
  const s = hash.replace(/^#/, '');
  if (s === 'new') return 'region'; // (New game is the region's setup: there's one map)
  return (SCREENS as readonly string[]).includes(s) ? (s as Screen) : 'home';
}
const goneNote = (what: string) => `${what} is gone: the game is one 50 km region now. Set one up here.`;

export function route(search: string, hash: string): Route {
  const q = new URLSearchParams(search);
  const id = q.get('map');
  // (an old link to a map the game no longer has, or to a Real Town Plans place: the region's setup, saying so)
  if (id === null && q.has('place')) return { kind: 'menu', screen: 'region', notice: goneNote(GONE.place) };
  if (id === null) return { kind: 'menu', screen: screenOf(hash) };
  if (GONE[id]) return { kind: 'menu', screen: 'region', notice: goneNote(GONE[id]) };
  const map = mapById(id);
  if (!map || !map.ready) return { kind: 'menu', screen: 'region', notice: `There’s no map called “${id}”. The game is one 50 km region: set one up here.` };
  return { kind: 'game', map, guide: q.get('guide') === '1' };
}

/** The address a game is played at: `?map=<id>`, or a query that already names the map and its options. */
export const gameSearch = (map: MapInfo, query?: string) => (query ? `?${query}` : `?map=${encodeURIComponent(map.id)}`);
