// The maps you can start a game on: one registry, read by the start menu (src/app) and by the
// game, which is opened as `/?map=<id>`. Pure data, with no three.js, so the menu can list the
// maps without loading the game.
//
// To make a map playable, set `ready: true` (and give it a `load` if it needs one). That's all
// the menu needs: its card becomes a Play button and `?map=<id>` deep links start it.

import type { Icon } from './ui/icons';

export interface MapInfo {
  id: string;
  name: string;
  /** one line for its card */
  blurb: string;
  /** the Tabler icon on its card */
  icon: Icon;
  /** playable in the game now */
  ready: boolean;
  /** what the card says while it isn't ready */
  soon?: string;
  /** a card that opens another page instead (Real Town Plans) */
  link?: { href: string; label: string };
  /** runs before the game module loads, e.g. `() => import('./region')`; a failure is shown on the menu */
  load?: () => Promise<unknown>;
  /** the first-visit guide runs over this map (it needs the starter town's roads and stops) */
  guide?: boolean;
  /** Play opens a setup screen first (the region's seed, style, rivers and towns: region/options.ts) */
  setup?: boolean;
}

export const MAPS: MapInfo[] = [
  { id: 'town', name: 'Starter town', blurb: 'A small market town by a lake, with a railway, an estate and room to grow.', icon: 'home', ready: true, guide: true },
  { id: 'region', name: 'Region', blurb: 'Fifty kilometres of towns, villages, hills and coast, joined by country lanes: the rest is yours to build.', icon: 'map', ready: true, setup: true },
  { id: 'place', name: 'Real town', blurb: 'A real UK town from OpenStreetMap, anywhere you pick.', icon: 'pin', ready: false, soon: 'Plans only for now', link: { href: './places.html', label: 'Open Real Town Plans' } },
  { id: 'sandbox', name: 'Sandbox', blurb: 'Empty land by the lake. Build a town from nothing.', icon: 'hammer', ready: true },
];

/** The map a game opens with: `?map=<id>`, the starter town by default. */
export const DEFAULT_MAP = 'town';
export const mapById = (id: string | null | undefined) => MAPS.find((m) => m.id === id);
