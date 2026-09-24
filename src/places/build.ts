// The import itself, as a pure function the worker runs: trimmed OSM data in, the two plans and
// the numbers out. Kept apart from worker.ts so the tests can run it without a worker.

import type { OverpassJson } from '../proto/osm/overpass';
import { importOsm } from '../proto/osm/import';
import { importSvg, rawSvg } from '../proto/osm/svg';

export interface PlanStats {
  segments: number; roads: number; railways: number; junctions: number; plots: number;
  roundabouts: number; pairedDuals: number; stations: number; zones: number; importMs: number;
}
export interface Unsupported { kind: string; count: number; example: string }
export interface Built { gameSvg: string; rawSvg: string; stats: PlanStats; unsupported: Unsupported[]; elements: number }

// what each kind of gap means for the player, where the importer's own note isn't enough
const MEANS: Record<string, string> = {
  'one-way street': 'built two-way: the game has no one-way roads yet',
  'slip road': 'left out: the junction designer adds its own slips',
  interchange: 'a grade-separated junction the game can’t build yet',
  gyratory: 'a one-way loop, built as ordinary two-way roads',
  'large roundabout': 'too big for the roundabout designer; built as a ring of roads',
  'incomplete roundabout': 'only part of the ring is in the area',
  'level crossing': 'road and railway cross on the level',
  'pedestrian street': 'not a road in the game yet',
  busway: 'buses only: not a road in the game yet',
  'railway siding': 'sidings and yards are left out',
  'loop dropped': 'a short loop that would fold onto itself',
  'road area': 'a paved area, not a road',
};

export function buildPlans(json: OverpassJson, now: () => number = () => performance.now()): Built {
  const t0 = now();
  const imp = importOsm(json);
  const importMs = now() - t0;
  const degree = new Map<number, number>();
  for (const s of imp.net.segs.values()) for (const n of [s.a, s.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const st = imp.stats as Record<string, number>;
  const kinds = new Map<string, Unsupported>();
  for (const u of imp.unsupported) {
    const k = kinds.get(u.kind);
    if (k) k.count++; else kinds.set(u.kind, { kind: u.kind, count: 1, example: MEANS[u.kind] ?? u.note });
  }
  return {
    gameSvg: importSvg(imp),
    rawSvg: rawSvg(imp.data, (la, lo) => imp.projection.toLocal(la, lo), imp.bounds),
    stats: {
      segments: imp.net.segs.size, roads: st.roadSegs, railways: st.railSegs,
      junctions: [...degree.values()].filter((d) => d >= 3).length,
      plots: imp.buildings.length, roundabouts: st.roundabouts, pairedDuals: st.pairs,
      stations: imp.stations.length, zones: imp.zones.length, importMs: Math.round(importMs),
    },
    unsupported: [...kinds.values()].sort((a, b) => b.count - a.count),
    elements: json.elements.length,
  };
}
