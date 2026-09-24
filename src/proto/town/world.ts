// The world a game starts from. The game doesn't know or care whether its town was invented or
// imported from OpenStreetMap: it reads the network, water, zones, stations and bounds from here.
// Two implementations: `inventedWorld()` (invented.ts, the hand-laid seed town) and `realWorld()`
// (real.ts, an OSM snapshot). See docs/world-start.md for the hooks other systems should use.

import type { Lot, Network, P } from '../roads';

export type TownId = 'real' | 'invented';

/** What a piece of land is for. The invented town only has town and industrial land. */
export type ZoneKind = 'residential' | 'commercial' | 'industrial' | 'park' | 'farmland' | 'water';
/** A land-use area: outer rings minus holes, in game metres (x east, z south). */
export interface WorldZone { kind: ZoneKind; outer: P[][]; inner: P[][]; name?: string }
export interface WorldStation { name?: string; at: P; seg?: number }
/** A junction form the map states outright (a real roundabout); the designer starts from it. */
export interface WorldHint { form: 'roundabout' | 'mini'; r?: number }
export interface Tree { x: number; z: number; s: number; kind: number } // kind 0 broadleaf, 1 pine

export interface World {
  id: TownId;
  name: string; // "Banbury", "Horley", "Invented town"
  real: boolean;
  /** Credit line to show whenever the map is on screen (null for the invented town). */
  attribution: string | null;
  attributionUrl: string | null;
  /**
   * Roads and railways laid, junctions NOT designed yet (the game designs them at start-up, so
   * they take their land before any plot). `net.isWater` and `net.zoneAt` are set.
   */
  net: Network;
  /** The map runs from -bound to +bound on both axes: camera clamp, ground, plots. */
  bound: number;
  /** The town centre: plots grow outwards from here. */
  centre: P;
  /** Where the camera starts: centre and height of the view in metres. */
  view: { x: number; z: number; h: number };
  water: {
    polys: P[][]; // every water surface as a polygon (lakes, rivers and canals as ribbons)
    isWater: (p: P) => boolean;
    shores: P[][]; // beaches to draw under the water (the invented lake has one)
  };
  zones: WorldZone[];
  zoneAt: (p: P) => ZoneKind | undefined;
  /** Industrial land: where factories go rather than houses (the network's zoneAt says the same). */
  industrial: (p: P) => boolean;
  stations: WorldStation[];
  /** Real road names and numbers ("High Street", "A361") by network segment, where the map has them. */
  names: Map<number, string>;
  /** Junction forms keyed by network node. */
  hints: Map<number, WorldHint>;
  /** Buildings already standing at the start (real ones). Placed after junctions claim land. */
  standing: Lot[];
  /** Plots the town grows along: road segments whose frontage fills in over time. */
  growAlong: () => number[];
  /** Share of the growth queue built before the first frame (the invented town is mostly built). */
  growNow: number;
  /** Whether a new plot may go here (a real town's parks, water and railway land stay as they are). */
  canGrow: (p: P) => boolean;
  /**
   * Whether leftover land gets invented parks, car parks, allotments and community buildings. A real
   * town keeps its own: its gaps stay grass and its parks come from the map.
   */
  invent: boolean;
  /** Woods and scattered trees; the game clears the ones that end up on roads or plots. */
  trees: Tree[];
  /** What didn't import cleanly, for the player and for the next pass (see real.ts). */
  notes: string[];
}

// ---- which town to start ----
const KEY = 'untitled.town';
export function chosenTown(): TownId {
  try {
    const q = new URLSearchParams(location.search).get('town');
    if (q === 'real' || q === 'invented') return q;
  } catch { /* no location (tests) */ }
  try { const v = localStorage.getItem(KEY); if (v === 'real' || v === 'invented') return v; } catch { /* storage blocked */ }
  return 'real';
}
export function chooseTown(id: TownId) {
  try { localStorage.setItem(KEY, id); } catch { /* storage blocked: the URL still works */ }
}
