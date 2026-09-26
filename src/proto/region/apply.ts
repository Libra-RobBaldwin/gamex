// Building a map's streets on the game's Network: each one is a net.build call with a catalogue
// road type, so junctions, plots, infill and buildings all come from the existing code.
// (Types only from roads.ts, which pulls in three.js through the bridges: this file stays pure.)
import type { Check, End, P, RoadOpts } from '../roads';
import type { MapStreet } from './mapspec';

// the parts of Network this uses
export interface StreetNet {
  snapStart(raw: P, tol: number): End;
  check(a: End, b: End, ctrl: P | undefined, opts: RoadOpts): Check;
  build(a: End, b: End, ctrl: P | undefined, opts: RoadOpts): number[];
}

export interface Built { made: number[]; skipped: { street: MapStreet; reason: string }[] }

// Build the streets in order. With `careful` (generated maps), each is checked first and left out
// if the Network refuses it, and a settlement's streets after its first must start on a road
// already built (so a refused street can't leave the ones hanging off it cut off). Without it
// (hand-drawn maps) each is built as drawn, as seedTown() always did.
// (`started`: the places begun so far, when a place's streets are built a few at a time)
export function buildStreets(net: StreetNet, streets: MapStreet[], base: RoadOpts, careful = false, started = new Set<number | undefined>()): Built {
  const made: number[] = [], skipped: Built['skipped'] = [];
  for (const st of streets) {
    const opts: RoadOpts = { ...base, type: st.type, ...(st.cross ? { cross: st.cross } : {}), ...(st.grade !== undefined ? { grade: st.grade } : {}) };
    const snap = st.snap !== false;
    const a: End = snap ? net.snapStart(st.a, 3) : { ...st.a };
    const b: End = snap ? net.snapStart(st.b, 3) : { ...st.b };
    if (careful) {
      if (started.has(st.settlement) && a.node === undefined && a.seg === undefined) { skipped.push({ street: st, reason: 'not joined to the streets built so far' }); continue; }
      const c = net.check(a, b, st.c, opts);
      if (!c.ok) { skipped.push({ street: st, reason: c.reason ?? 'refused' }); continue; }
      started.add(st.settlement);
    }
    made.push(...net.build(a, b, st.c, opts));
  }
  return { made, skipped };
}
