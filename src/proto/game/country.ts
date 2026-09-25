// The region's countryside: the game's side of region/fields.ts. It gathers what the field layout
// reacts to (the lanes and railways as built, the water, the hills, the settlements) and hands
// the ground a field plan (ground/plan.ts). Only a map that lays out its own fields calls this;
// the town keeps the ground's world-anchored grid.
import type { Network } from '../roads';
import type { MapSpec } from '../region/mapspec';
import { reach, type Kind } from '../region/generate';
import { MapWater } from '../region/water';
import { layFields } from '../region/fields';
import type { GroundPlan } from '../ground/plan';
import type { FarmSpot } from '../ground/farms';

export function countryPlan(o: {
  map: MapSpec; net: Network;
  heightAt?: (x: number, z: number) => number;
  woods: { density: number; pines: number };
  region: { x0: number; z0: number; size: number };
}): GroundPlan & { farms: FarmSpot[] } {
  const { map, net, region: R } = o;
  // every road and railway out in the open (not in tunnels): blocks line up with them, and they split fields
  const lanes = [], farmLanes = [];
  for (const s of net.segs.values()) {
    const path = net.path(s);
    if (path.length < 2 || path.some((p) => (p.y ?? 0) < -2)) continue;
    const flat = path.map((p) => ({ x: p.x, z: p.z }));
    lanes.push(flat);
    // (farms stand beside roads, or have a track to one: not motorways or railways, and at ground level)
    const d = net.def(s);
    if (d && d.family !== 'Motorway' && d.cls === 'road' && !path.some((p) => Math.abs(p.y ?? 0) > 1)) farmLanes.push(flat);
  }
  const mw = new MapWater(map.water);
  const plan = layFields({
    seed: map.seed,
    box: { x0: R.x0, z0: R.z0, x1: R.x0 + R.size, z1: R.z0 + R.size },
    settlements: map.settlements.map((s) => ({ x: s.x, z: s.z, r: s.r, kind: s.kind, reach: reach(s.kind as Kind, s.r) })),
    lanes,
    farmLanes,
    rivers: map.water.rivers.map((r) => r.path),
    waterDist: (x, z) => mw.edgeDistance({ x, z }, 400),
    heightAt: o.heightAt,
    woods: o.woods.density,
    pines: o.woods.pines,
  });
  return plan;
}
