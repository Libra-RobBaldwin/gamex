import { describe, expect, it } from 'vitest';
import { BRIDGE_IDS } from './catalogue';
import { findFights } from './coplanar';
import { bridgeScene, galleryCrossing } from './scene';
import { chooseBridge } from './choose';
import { RIVER_CROSSING } from './gallery';
import { scenario } from './scenario';

describe('bridge scenes', () => {
  // Nothing in the scene lies within a few centimetres of another surface over the same ground
  // (the grass under an embankment, ballast on its formation, a road on its bench), in the far
  // look and the near one, for every gallery type.
  for (const id of BRIDGE_IDS) it(`has no coplanar surfaces: ${id}`, () => {
    const { sc, c, lay } = galleryCrossing(id);
    const s = bridgeScene(sc, c, lay);
    for (const mpp of [1, 0.01]) {
      s.setDetail(mpp);
      const f = findFights(s.group);
      expect(f, `${id} at ${mpp} m/px: ${JSON.stringify(f.slice(0, 5))}`).toEqual([]);
    }
  }, 120000);
});

describe('bridge scenes off the gallery', () => {
  // the chooser's crossing: a dual carriageway on a bend, with the chooser's pick
  it('has no coplanar surfaces on the chooser crossing', () => {
    const sc = scenario(RIVER_CROSSING), pick = chooseBridge(sc.crossing);
    const o = pick.options.find((x) => x.def.id === pick.chosen)!;
    const s = bridgeScene(sc, o.crossing!, o.layout!);
    for (const mpp of [1, 0.01]) { s.setDetail(mpp); const f = findFights(s.group); expect(f, JSON.stringify(f.slice(0, 6))).toEqual([]); }
  }, 120000);
  // railways on a curve: the track's sleepers and rails follow it
  for (const id of ['trestle', 'masonry', 'girder'] as const) it(`has no coplanar surfaces on a curve: ${id}`, () => {
    const { sc, c, lay } = galleryCrossing(id, 40);
    const s = bridgeScene(sc, c, lay);
    for (const mpp of [1, 0.01]) { s.setDetail(mpp); const f = findFights(s.group); expect(f, JSON.stringify(f.slice(0, 6))).toEqual([]); }
  }, 120000);
});
