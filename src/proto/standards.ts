// Design standards: the reference every piece of geometry is built from. Rather than each part of
// the game carrying its own numbers (how round a kerb is, how wide a footway, how far a building
// sits back), they all read them from here, so a junction, the land it takes and the buildings
// around it always agree. Figures follow UK practice (Manual for Streets / DMRB) loosely.
import type { RoadDef } from './catalog';

export const STD = {
  // kerb radius at a junction corner, by the faster of the two roads
  cornerRadius(mph: number) { return mph <= 20 ? 4 : mph <= 30 ? 6 : mph <= 40 ? 10 : mph <= 50 ? 15 : 20; },
  // a left-turn slip lane: the radius of its centreline, its width, the footway on its outside
  slipRadius(mph: number) { return mph <= 30 ? 16 : mph <= 40 ? 22 : 30; },
  slipWidth: 4.5,
  slipFootway: 2,
  // clear space beyond the stop / give-way line before anything else starts (the crossing)
  crossing: 1.5,
  // roundabouts: outer radius of the circulating carriageway, by entry lanes; the island inside
  roundabout(entryLanes: number, fast: boolean) {
    const R = entryLanes > 1 ? 24 : fast ? 20 : 16;
    return { R, island: R - (entryLanes > 1 ? 9 : 6.5), entryRadius: fast ? 20 : 12, footway: 3 };
  },
  mini: { R: 7, footway: 2.5 },
  // splitter island at a single-lane roundabout entry
  splitter: { length: 12, width: 2.2 },
  // the give-way line (TSRGD diagram 1003): two broken lines of 0.6 m dashes with 0.3 m gaps, 0.3 m
  // apart (a mini-roundabout's, diagram 1003.3, is one), right across the entry from the kerb (or
  // splitter island) to the kerb
  giveWay: { dash: 0.6, gap: 0.3, width: 0.3, apart: 0.3 },
  // the "give way ahead" triangle (TSRGD diagram 1023) in each approach lane: an outline triangle
  // with its point towards the approaching driver (who sees it as the inverted give-way sign), its
  // base nearest the line and `back` metres short of it
  giveWayTriangle(mph: number) { return mph <= 40 ? { length: 3.75, width: 1.25, back: mph <= 30 ? 4 : 9 } : { length: 6, width: 2, back: 15 }; },
  // how far back from the edge of a junction's land a building's plot must stay
  junctionSetback: 0.5,
  // where a road changes to a narrower one (a dual carriageway ending, say), how long the
  // change takes: the reservation closes into hatching, then the offside lane tapers away
  taperLength(mph: number) { return mph <= 30 ? 45 : mph <= 40 ? 70 : mph <= 50 ? 100 : 130; },
  // where a lane is about to end, bent "lane ends" arrows (TSRGD diagram 1014) in it: their length
  // and spacing, and how many
  deflectionArrow(mph: number) { return mph <= 40 ? { length: 6, gap: 9, count: 3 } : { length: 9, gap: 15, count: 3 }; },
  // hatched areas (a ghost island): diagonal stripes, further apart on faster roads, inside a solid edge line
  hatch(mph: number) { return { spacing: mph <= 30 ? 1.5 : mph <= 40 ? 2 : 3, stripe: mph <= 40 ? 0.15 : 0.2 }; },
  // the turning head at the end of a cul-de-sac: a turning circle (kerb radius) big enough for a
  // refuse lorry to turn round in a three-point turn, flared in from the street
  turningHead: { R: 8, entry: 6, minRoad: 30 }, // (a shorter dead end has none: see xsection.endKind)
  // a road ending within this distance of the map's edge, heading out, runs on off the map
  mapEdge: 30,
};

// The ground runs this far past the buildable map on every side (main.ts sizes it BOUND × 2.6), so
// roads that run off the map are drawn out to where the ground ends.
export const GROUND = 1.3;

export const fastest =(...ds: RoadDef[]) => Math.max(...ds.map((d) => d.mph));
