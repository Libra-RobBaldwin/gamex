// The invented seed town: a high street, a crescent, a bypass, a lake with a bridge over it, an
// industrial estate, a motorway along the south edge and a main line along the north. It used to
// live in main.ts; the roads and the trees are exactly as they were there.

import { circlePoly } from '../land';
import { DEFAULT_OPTS, Network, type P, type RoadType } from '../roads';
import type { Tree, World, ZoneKind } from './world';

const LAKE = { x: 250, z: -190, r: 90 };
const BOUND = 520;

/** `rand` is the game's own random stream: the trees are drawn from it first, as they always were. */
export function inventedWorld(rand: () => number): World {
  const isWater = (p: P) => Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 4;
  const net = new Network(isWater, BOUND, 11);
  // an industrial estate south of the centre
  const industrial = (p: P) => p.z < -215 && Math.abs(p.x) < 280;
  net.zoneAt = (p) => (industrial(p) ? 'industrial' : 'town');

  // woods on the outskirts, a few in town
  const trees: Tree[] = [];
  for (let i = 0; i < 1400; i++) {
    const p = { x: (rand() * 2 - 1) * BOUND, z: (rand() * 2 - 1) * BOUND };
    const dc = Math.hypot(p.x, p.z);
    if (dc < 140 && rand() < 0.85) continue;
    if (isWater(p) || Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 10) continue;
    trees.push({ ...p, s: 0.8 + rand() * 0.7, kind: rand() < 0.3 ? 1 : 0 });
  }

  layRoads(net);

  const estate = [{ x: -280, z: -BOUND }, { x: 280, z: -BOUND }, { x: 280, z: -215 }, { x: -280, z: -215 }];
  return {
    id: 'invented', name: 'Invented town', real: false, attribution: null, attributionUrl: null,
    net, bound: BOUND, centre: { x: 0, z: 0 }, view: { x: 0, z: 20, h: 300 },
    water: { polys: [circlePoly(LAKE, LAKE.r, 72)], isWater, shores: [circlePoly(LAKE, LAKE.r + 7, 72)] },
    zones: [{ kind: 'industrial', outer: [estate], inner: [] }, { kind: 'water', outer: [circlePoly(LAKE, LAKE.r, 72)], inner: [], name: 'The lake' }],
    zoneAt: (p): ZoneKind | undefined => (isWater(p) ? 'water' : industrial(p) ? 'industrial' : undefined),
    industrial, stations: [], names: new Map(), hints: new Map(), standing: [],
    growAlong: () => [...net.segs.keys()], growNow: 0.8, canGrow: () => true, invent: true,
    trees, notes: [],
  };
}

function layRoads(net: Network) {
  const road = (a: P, b: P, c?: P, o = DEFAULT_OPTS) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), c, o);
  const as = (type: RoadType, o = DEFAULT_OPTS) => ({ ...o, type });
  // the high street is a tree-lined avenue, from under the flyover to a roundabout on the bypass
  // (it ends exactly where the bypass's curve will cross it, so the two meet there)
  const bypass = net.makePath({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 });
  const cross = bypass.findIndex((p) => p.z < 0), [p0, p1] = [bypass[cross - 1], bypass[cross]];
  road({ x: -230, z: 0 }, { x: p0.x + ((p1.x - p0.x) * p0.z) / (p0.z - p1.z), z: 0 }, undefined, as('avenue'));
  road({ x: 0, z: -200 }, { x: 0, z: 200 });
  road({ x: 0, z: 0 }, { x: 170, z: -98 }); // a 30° diagonal
  road({ x: -185, z: -96 }, { x: 0, z: -96 }); // (a cul-de-sac, its turning head clear of the flyover's ramp)
  road({ x: -110, z: -96 }, { x: -170, z: 0 }); // a slanting link
  road({ x: 0, z: 70 }, { x: -80, z: 150 }, { x: -80, z: 70 }); // a crescent
  road({ x: 60, z: 0 }, { x: 60, z: 110 });
  road({ x: 0, z: 110 }, { x: 110, z: 110 });
  road({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 }, as('dual')); // a sweeping dual-carriageway bypass
  const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
  road({ x: -215, z: -150 }, { x: -215, z: 150 }, undefined, over); // a flyover across the main road
  road({ x: 0, z: -150 }, { x: 510, z: -200 }, undefined, over); // a bridge over the lake, and on out of town to the east
  // the industrial estate
  road({ x: 0, z: -200 }, { x: 0, z: -380 });
  road({ x: -190, z: -290 }, { x: 150, z: -290 });
  road({ x: 0, z: -380 }, { x: -170, z: -370 }, { x: -110, z: -420 });
  // a motorway along the south edge, reached from the estate by a dual carriageway
  // the motorway ends at a roundabout, where it carries on east as a fast dual carriageway
  road({ x: -510, z: -470 }, { x: 0, z: -470 }, undefined, as('motorway'));
  road({ x: 0, z: -470 }, { x: 510, z: -470 }, undefined, as('dual-2-70-0'));
  road({ x: 0, z: -380 }, { x: 0, z: -470 }, undefined, as('dual'));
  // a main line railway along the north, lifted over the high road, and a road tunnel under the lake
  net.build({ x: -500, z: 185 }, { x: 500, z: 185 }, undefined, { ...DEFAULT_OPTS, type: 'rail-main', cross: 'bridge', grade: 0.025 });
  road({ x: 250, z: -470 }, { x: 250, z: 90 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'tunnel', grade: 0.08 }); // from the dual carriageway
  // roads out of town: west from the end of the high street, north under the railway (both run off the map)
  road({ x: -230, z: 0 }, { x: -510, z: 0 }, undefined, as('rural-60'));
  road({ x: 0, z: 200 }, { x: 0, z: 510 }, undefined, as('rural-60'));
}
