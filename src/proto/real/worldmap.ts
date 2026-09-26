// A real region's 50 km map, as the game opens it (docs/real.md, "On the 50 km map"): the plan from
// the bake (real/world.ts, a WorldSource) through the same WORLD pipeline as a seeded map.
//
//   ?map=region&real=exe    (or the short forms ?map=exe, ?map=teme)
import type { MapSpec } from '../region/mapspec';
import { optionsFromQuery } from '../region/options';
import { loadPlan, type WorldPlan } from '../worldmap/plan';
import { worldMapSpec } from '../worldmap/spec';
import { REAL_REGION_LIST } from './list';
import { packUrl, type LivePack } from './live';
import './world'; // (registers the real source: worldmap/source.ts)

export const REAL_REGIONS = REAL_REGION_LIST.map((r) => r.id);
// which real region a query asks for, if any (?real=<id>, or ?map=<id> for short)
export function realOf(q: URLSearchParams): string | null {
  const id = q.get('real') ?? q.get('map');
  return id && REAL_REGIONS.includes(id) ? id : null;
}
export const isRealQuery = (q: URLSearchParams) => realOf(q) !== null;
// the query a real region's game is saved with (the short ?map=exe opens it too)
export const realQuery = (q: URLSearchParams) => { const out = new URLSearchParams(q); out.set('map', 'region'); out.set('real', realOf(q)!); return out; };
// A save from before real regions were 50 km maps (?map=exe, saved as that: real/load.ts's 6 km
// window, no world in it) can't be opened on the new map: its roads and buildings stood on the old one.
export const isOldRealSave = (query: string) => { const q = new URLSearchParams(query); return REAL_REGIONS.includes(q.get('map') ?? '') && !q.has('real'); };

// The live play area comes packed from the bake (real/live.ts, tools/os/pack.mjs): its real roads,
// railway, buildings and parks, in place of the streets a seeded map lays out for its places.
export async function realWorldMap(q: URLSearchParams, base = `${import.meta.env.BASE_URL}regions/`): Promise<MapSpec & { world: WorldPlan; livePack: LivePack }> {
  const id = realOf(q)!, info = REAL_REGION_LIST.find((r) => r.id === id)!;
  const [plan, livePack] = await Promise.all([
    loadPlan({ ...optionsFromQuery(q), size: 50, real: id }),
    fetch(packUrl(base, id, info.home)).then((r) => { if (!r.ok) throw new Error(`${id}'s live area: ${r.status}`); return r.json() as Promise<LivePack>; }),
  ]);
  const m = worldMapSpec(plan.options, plan);
  return {
    ...m,
    id,
    livePack,
    streets: [], zones: [], // (the real ones are in the pack)
    name: plan.settlements[plan.start].name,
    credit: { text: info.credit, href: 'https://www.ordnancesurvey.co.uk/products/os-opendata' },
    placeBy: 'edge', // (a city's suburbs are the city's, not the next village's: game/econ.ts)
  };
}
