import { describe, expect, it } from 'vitest';
import { BRIDGE_IDS } from './catalogue';
import { findFights } from './coplanar';
import { bridgeScene, galleryCrossing } from './scene';

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
