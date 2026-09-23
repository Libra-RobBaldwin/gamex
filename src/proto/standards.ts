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
  // how far back from the edge of a junction's land a building's plot must stay
  junctionSetback: 0.5,
};

export const fastest = (...ds: RoadDef[]) => Math.max(...ds.map((d) => d.mph));
