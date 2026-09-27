// Saved games (docs/production.md §4). A save is the whole town as the player left it: the map it
// was made from (the map is data, so its id and options rebuild the land, water and trees), the
// roads with their junction designs, bridges, one-way carriageways and motorway junctions, the
// land they claim, the buildings standing and the plots still free, industrial sites, bus stops,
// railway stations and track, the player's lines, the economy, the purse, the clock and the
// game speed. Loaded, the town carries on exactly as it would have (game/save.test.ts): the
// economy decides the same things on the same days, and the purse comes out the same.
//
// What isn't saved is what the game remakes as it runs: the traffic (cars start again, and each
// line's buses and trains start spread along it, as a new line's do), the people on the footways,
// the ground's paint, and the junctions that design themselves (they redesign on load).
//
// Every save carries its format's version. A save from an older version is brought up to date
// by MIGRATIONS, one version at a time; one from a newer version of the game is refused rather
// than half-read. Saves live in IndexedDB (game/savedb.ts).
import type { Lot, Network, RNode, RSeg } from '../roads';
import type { Junction } from '../junction';
import type { Interchange } from '../interchange/build';
import type { Owner, XZ } from '../land';
import type { RailwaySave } from '../rail/railway';
import type { IndustriesSave } from './industry';
import type { LinesSave } from './lines';
import type { TownSave } from './econ';
import type { PurseSave } from './money';

export const SAVE_VERSION = 2;

// the network as data: its nodes, roads (with their stops, bridges and one-way carriageways),
// the plots with buildings on, the land claimed (bar the water's, which the map makes again, and
// industrial sites', which make their own), and where its id counter and random stream have got to
export interface NetSave {
  nextId: number; rand: number; bound: number;
  nodes: RNode[]; segs: RSeg[]; lots: Lot[];
  land: { key: string; owner: Owner; polys: XZ[][] }[];
}

export interface SaveSummary { residents: number; balance: number; lines: number; day: number; time: string }

export interface GameSave {
  v: number;
  id: string; name: string; savedAt: number; // (ms since 1970)
  map: { id: string; query: string }; // the map's id, and the whole query that makes it (its options)
  summary: SaveSummary; // for the list of saves
  clock: number; speed: number; rate: number; // game minutes since the start; paused (0) or the rate
  rand: number; // the game's own random stream (which plots a new road gets)
  net: NetSave;
  queue: Lot[]; // plots laid out and free to build on, in the order the town takes them
  junctions: Junction[]; // the ones the player designed (the rest design themselves)
  interchanges: Interchange[];
  industries: IndustriesSave;
  railway: RailwaySave; // stations, track signalling and rail lines (rail/)
  stations?: unknown[]; // (the loop's interim stations, in saves from before they went: not restored)
  lines: LinesSave;
  town: TownSave;
  purse: PurseSave;
  paid?: number[]; // the roads the player paid for (by segment id), which the bulldozer refunds; the map's own refund nothing
  goal?: { done: boolean; firstLineAt: number | null }; // the goal card's progress, so a load doesn't show step 3 again
  // A 50 km map (worldmap/): the save is what differs from what the seed makes. The map itself,
  // its scenery and the places not yet live are made again from the query; this says which places
  // of the live play area had come to life, and the network above holds everything built there.
  world?: { live: number[] };
}

export function saveNetwork(net: Network): NetSave {
  const land: NetSave['land'] = [];
  for (const c of net.land.all()) if (c.owner !== 'water' && c.owner !== 'industry') land.push({ key: c.key, owner: c.owner, polys: c.polys });
  return { nextId: net.nextId, rand: net.randState, bound: net.bound, nodes: [...net.nodes.values()], segs: [...net.segs.values()], lots: net.lots, land };
}

// Put a saved network back into a fresh one (made for the same map, so its water is claimed).
export function restoreNetwork(net: Network, s: NetSave) {
  net.nodes = new Map(s.nodes.map((n) => [n.id, n]));
  net.segs = new Map(s.segs.map((sg) => [sg.id, sg]));
  net.lots = s.lots;
  net.nextId = s.nextId;
  net.randState = s.rand;
  net.bound = s.bound;
  net.land.releaseWhere((k) => net.land.get(k)?.owner !== 'water');
  for (const c of s.land) net.land.claim(c.key, c.owner, c.polys);
}

// ---------- versions ----------
// MIGRATIONS[v] takes a save of version v to version v + 1. Add one whenever the format changes,
// and bump SAVE_VERSION: old saves then load through every step since.
export type Migration = (s: Record<string, unknown>) => Record<string, unknown>;
export const MIGRATIONS: Record<number, Migration> = {
  // 1 → 2: a region with no size in its query was the 6 km one (50 km is the standard map now)
  1: (s) => {
    const m = s.map as { id: string; query: string } | undefined;
    if (m?.id === 'region') { const q = new URLSearchParams(m.query); if (!q.has('size')) { q.set('size', '6'); s.map = { ...m, query: q.toString() }; } }
    return s;
  },
};

export class SaveError extends Error {}
// A save as read back, brought up to this version of the game (a copy: the stored one is left alone).
export function migrate(raw: unknown, steps: Record<number, Migration> = MIGRATIONS, to = SAVE_VERSION): GameSave {
  if (!raw || typeof raw !== 'object' || typeof (raw as { v?: unknown }).v !== 'number') throw new SaveError('This isn’t a saved town');
  let s = structuredClone(raw) as Record<string, unknown>;
  let v = s.v as number;
  if (v > to) throw new SaveError('This town was saved by a newer version of the game');
  while (v < to) {
    const step = steps[v];
    if (!step) throw new SaveError(`This town was saved by an old version of the game that can’t be read (${v})`);
    s = step(s);
    s.v = ++v;
  }
  return s as unknown as GameSave;
}

// the line in the list of saves: "Day 3 · 14:20 · 1,204 people · £412,300"
export function describe(s: SaveSummary) {
  const m = s.balance < 0 ? '−' : '';
  return `Day ${s.day} · ${s.time} · ${s.residents.toLocaleString('en-GB')} people · ${m}£${Math.round(Math.abs(s.balance)).toLocaleString('en-GB')}`;
}
export function when(t: number, now = Date.now()) {
  const d = new Date(t), mins = Math.round((now - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const same = new Date(now).toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return same ? `today ${hm}` : `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${hm}`;
}
