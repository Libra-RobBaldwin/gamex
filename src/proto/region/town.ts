// The invented town (the starter map) as a MapSpec: the hand-drawn roads that used to be
// seedTown() in main.ts, the lake, and the industrial estate south of the centre.
import type { MapSpec, MapStreet } from './mapspec';
import { TOWN_WATER, type XZ } from './water';

const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
// (the Network's quadratic Bézier, point for point: roads.ts bezier())
function bezier(a: XZ, c: XZ, b: XZ): XZ[] {
  const n = Math.max(4, Math.min(48, Math.ceil((dist(a, c) + dist(c, b)) / 6)));
  const out: XZ[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z }); }
  return out;
}

// You can build out to BOUND either side of the centre; the roads out of town end OUT from the
// centre, near enough the edge to run on off the map.
const BOUND = 1030, OUT = BOUND - 10;

function townStreets(): MapStreet[] {
  const road = (a: XZ, b: XZ, c?: XZ, type = 'street', o: Partial<MapStreet> = {}): MapStreet => ({ a, b, c, type, ...o });
  // the high street is a tree-lined avenue, from under the flyover to a roundabout on the bypass
  // (it ends exactly where the bypass's curve will cross it, so the two meet there)
  // (net.makePath(a, b, ctrl) is bezier(a, ctrl, b))
  const bypass = bezier({ x: 110, z: 110 }, { x: 230, z: 40 }, { x: 170, z: -98 });
  const cross = bypass.findIndex((p) => p.z < 0), [p0, p1] = [bypass[cross - 1], bypass[cross]];
  const over = { cross: 'bridge' as const };
  return [
    road({ x: -230, z: 0 }, { x: p0.x + ((p1.x - p0.x) * p0.z) / (p0.z - p1.z), z: 0 }, undefined, 'avenue'),
    road({ x: 0, z: -200 }, { x: 0, z: 200 }),
    road({ x: 0, z: 0 }, { x: 170, z: -98 }), // a 30° diagonal
    road({ x: -185, z: -96 }, { x: 0, z: -96 }), // (a cul-de-sac, its turning head clear of the flyover's ramp)
    road({ x: -110, z: -96 }, { x: -170, z: 0 }), // a slanting link
    road({ x: 0, z: 70 }, { x: -80, z: 150 }, { x: -80, z: 70 }), // a crescent
    road({ x: 60, z: 0 }, { x: 60, z: 110 }),
    road({ x: 0, z: 110 }, { x: 110, z: 110 }),
    road({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 }, 'dual'), // a sweeping dual-carriageway bypass
    road({ x: -215, z: -150 }, { x: -215, z: 150 }, undefined, 'street', over), // a flyover across the main road
    road({ x: 0, z: -150 }, { x: OUT, z: -150 - (50 * OUT) / 510 }, undefined, 'street', over), // a bridge over the lake, and on out of town to the east
    // the industrial estate
    road({ x: 0, z: -200 }, { x: 0, z: -380 }),
    road({ x: -190, z: -290 }, { x: 150, z: -290 }),
    road({ x: 0, z: -380 }, { x: -170, z: -370 }, { x: -110, z: -420 }),
    // a motorway along the south edge, reached from the estate by a dual carriageway
    // the motorway ends at a roundabout, where it carries on east as a fast dual carriageway
    road({ x: -OUT, z: -470 }, { x: 0, z: -470 }, undefined, 'motorway'),
    road({ x: 0, z: -470 }, { x: OUT, z: -470 }, undefined, 'dual-2-70-0'),
    road({ x: 0, z: -380 }, { x: 0, z: -470 }, undefined, 'dual'),
    // a main line railway along the north, lifted over the high road, and a road tunnel under the lake
    road({ x: -OUT, z: 185 }, { x: OUT, z: 185 }, undefined, 'rail-main', { cross: 'bridge', grade: 0.025, snap: false }),
    road({ x: 250, z: -470 }, { x: 250, z: 90 }, undefined, 'street', { cross: 'tunnel', grade: 0.08 }), // from the dual carriageway
    // roads out of town: west from the end of the high street, north under the railway (both run off the map)
    road({ x: -230, z: 0 }, { x: -OUT, z: 0 }, undefined, 'rural-60'),
    road({ x: 0, z: 200 }, { x: 0, z: OUT }, undefined, 'rural-60'),
  ];
}

export const TOWN_MAP: MapSpec = {
  id: 'town',
  name: 'Starter town',
  seed: 99,
  bound: BOUND,
  water: TOWN_WATER,
  // an industrial estate south of the centre
  zones: [{ kind: 'industrial', box: { x0: -280, z0: -Infinity, x1: 280, z1: -215 } }],
  settlements: [{ id: 0, name: 'Town', kind: 'town', x: 0, z: 0, r: 250 }],
  streets: townStreets(),
  generated: false,
  style: 'temperate',
  relief: 'flat',
  links: [],
  view: { x: 0, z: 20, h: 300 },
  // the high street either side of the centre, the road north, and the industrial estate
  stops: [{ x: -85, z: 0 }, { x: 120, z: 0 }, { x: 0, z: 150 }, { x: -95, z: -290 }, { x: 75, z: -290 }],
  // the starter line: the high street's west end, its east end, and up the road north
  line: [{ x: -85, z: 0 }, { x: 120, z: 0 }, { x: 0, z: 150 }],
  industries: true,
  trees: { count: Math.round(1400 * (BOUND / 520) ** 2), clear: 140 }, // (woods as thick as they always were, over the bigger map)
};
