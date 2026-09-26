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
  /** runs before the game module loads, e.g. `() => import('./region')`; a failure is shown on the menu */
  load?: () => Promise<unknown>;
  /** the first-visit guide runs over this map (in its start town) */
  guide?: boolean;
  /** Play opens a setup screen first (the region's seed, style, rivers and towns: region/options.ts) */
  setup?: boolean;
  /** offered inside New game > Region (a real place from OS maps), not as a card of its own */
  inRegion?: boolean;
}

export const MAPS: MapInfo[] = [
  { id: 'region', name: 'Region', blurb: 'Fifty kilometres of towns, villages, hills and coast, joined by country lanes: the rest is yours to build.', icon: 'map', ready: true, setup: true, guide: true },
  { id: 'exe', name: 'Exeter', blurb: 'The real city and its river, railway and hills, from Ordnance Survey maps. The Exe estuary around it is 50 km of real Devon.', icon: 'building', ready: true, inRegion: true },
  { id: 'teme', name: 'Ludlow', blurb: 'A real market town on the Teme under its castle, from Ordnance Survey maps, in 50 km of the Shropshire Hills and the Welsh Marches.', icon: 'building', ready: true, inRegion: true },
];

/** The map a game opens with: `?map=<id>`, the region by default. There is one map: the 50 km region. */
export const DEFAULT_MAP = 'region';
/** Maps the game once had (the one-map clean-up, docs/briefs/PLAN.md): links and saves on them are turned away politely. */
export const GONE: Record<string, string> = { town: 'The starter town', sandbox: 'The sandbox', place: 'Real Town Plans' };
export const mapById = (id: string | null | undefined) => MAPS.find((m) => m.id === id);
