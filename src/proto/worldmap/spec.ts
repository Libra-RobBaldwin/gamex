// A 50 km map as the game's MapSpec (region/mapspec.ts): the live play area round the start town
// is the map the game's own code runs (the Network's bound, its water, its places, their streets
// and industrial edges), and the plan rides along as `world` for everything beyond it (the
// streamed scenery: view.ts; the coarse economy: econ.ts). Pure: no three.js.
import { KINDS, layStreets, type ZoneRule } from '../region/generate';
import type { MapSpec, MapStreet } from '../region/mapspec';
import type { RegionOptions } from '../region/options';
import { STYLE_LOOKS } from '../region/styles';
import { LIVE_HALF, planWorld, settlementInfo, type WorldPlan, type WorldSettlement } from './plan';
import { waterInBox } from './water';

export const inLiveArea = (p: { x: number; z: number }, pad = 0) => Math.abs(p.x) < LIVE_HALF - pad && Math.abs(p.z) < LIVE_HALF - pad;
// the places in the live play area, the start town first, then nearest first
export const livePlaces = (plan: WorldPlan): WorldSettlement[] => plan.settlements.filter((s) => inLiveArea(s)).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));

export function worldMapSpec(opts: Partial<RegionOptions> = {}, plan = planWorld(opts)): MapSpec & { world: WorldPlan } {
  const live = livePlaces(plan);
  const streets: MapStreet[] = [], zones: ZoneRule[] = [];
  for (const s of live) {
    const out = layStreets({ ...s, gates: [] }, plan.water, plan.half); // (as the scenery lays them out: towns.ts)
    streets.push(...out.streets);
    if (out.zone) zones.push(out.zone);
  }
  const start = plan.settlements[plan.start];
  const S = KINDS[start.kind].spacing, at = (u: number, v: number) => ({ x: start.x + u * Math.cos(start.axis) - v * Math.sin(start.axis), z: start.z + u * Math.sin(start.axis) + v * Math.cos(start.axis) });
  const line = [at(-1.5 * S, 0), at(1.5 * S, 0), at(0, -1.5 * S)];
  const o = plan.options;
  return {
    id: 'region',
    name: 'Region',
    seed: plan.seed,
    bound: LIVE_HALF,
    water: waterInBox(plan.water.world, { x0: -LIVE_HALF, z0: -LIVE_HALF, x1: LIVE_HALF, z1: LIVE_HALF }),
    zones,
    settlements: live.map(settlementInfo),
    streets,
    generated: true,
    links: plan.links.filter((l) => inLiveArea(plan.settlements[l.a]) && inLiveArea(plan.settlements[l.b])),
    view: { x: start.x, z: start.z + 20, h: 300 },
    stops: [...line, at(0, 1.5 * S)],
    line,
    industries: false,
    // (the woods' trees are planted a tile at a time from the ground's own woods: worldmap/live.ts)
    trees: { count: 0 },
    style: o.style,
    relief: o.relief,
    options: o,
    world: plan,
  };
}
export const lookOf = (plan: WorldPlan) => STYLE_LOOKS[plan.options.style];
