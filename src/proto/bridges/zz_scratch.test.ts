import { it } from 'vitest';
import { ROADS, kerbOf, halfOf } from '../catalog';
import { deckWidth } from './crossing';
it('x', () => {
  for (const id of ['rail-branch', 'rail-main', 'rural-60', 'dual', 'motorway', 'street', 'arterial-2-40-0-0-0']) {
    const d = ROADS[id]; if (!d) { console.log(id, 'missing'); continue; }
    console.log(id, JSON.stringify({ kerb: kerbOf(d), pave: d.pave, verge: d.verge, median: d.median, lanes: d.lanes, lane: d.lane, shoulder: d.shoulder, half: halfOf(d), hw: deckWidth(d) / 2, tracks: d.tracks, mk: d.medianKind }));
  }
});
