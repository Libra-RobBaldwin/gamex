// Adversarial review of game/fleet.ts, called directly.
import { afterAll, describe, expect, it } from 'vitest';
import { Network } from '../roads';
import { Fleet, slotOf } from './fleet';
import type { Model } from '../vehicles';
import { gameYear, setGameYear } from './era';
import { TRAINS } from '../catalog';

const startYear = gameYear();
afterAll(() => setGameYear(startYear));

// fleet.ts's own test for "a goods vehicle" (dress(): the `goods` predicate)
const isGoods = (m: Model) => slotOf(m) !== 'special' && (m.category === 'lorry' || (m.category === 'van' && m.style !== 'minibus' && m.style !== 'ice-cream'));
const fleetIn = (area: string) => {
  const f = new Fleet(new Network(() => false, 900), 3);
  (f as unknown as { areaOf: () => string }).areaOf = () => area;
  return f;
};

describe('a trip from a works (heavy) is a goods vehicle of the area\'s sort', () => {
  for (const year of [1995, 2025]) for (const area of ['centre', 'suburb', 'industrial', 'rural', 'motorway']) {
    it(`${year} ${area}`, () => {
      setGameYear(year);
      const f = fleetIn(area), not: string[] = [];
      for (let i = 0; i < 300; i++) { const lead = f.dress({} as never, true).dress.chain[0]; if (!isGoods(lead)) not.push(lead.id); }
      expect(not.length / 300, `not goods: ${[...new Set(not)].slice(0, 5).join(', ')}`).toBeLessThan(0.05);
    });
  }
  it('snapping to the year\'s palette never turns a goods van into a minibus (industrial, 1995)', () => {
    setGameYear(1995);
    const f = fleetIn('industrial');
    const minibuses = Array.from({ length: 300 }, () => f.dress({} as never, true).dress.chain[0]).filter((m) => m.style === 'minibus').map((m) => m.id);
    expect(minibuses).toEqual([]);
  });
});

describe('trains are period sets that match what the def lets them do', () => {
  // main.ts adds an 'intercity' and a 'dmu' by kind when the game starts
  for (const kind of ['intercity', 'dmu']) it(`the starting ${kind} in 1935 has no rolling stock from after 1935`, () => {
    setGameYear(1935);
    const d = new Fleet(new Network(() => false, 900), 3).dressTrain(TRAINS[kind]);
    expect(d.chain.filter((m) => m.from > 1935).map((m) => `${m.id} (from ${m.from})`)).toEqual([]);
  });
  it('the starting intercity (needsWires: false) is not drawn as an electric set in 2025', () => {
    setGameYear(2025);
    expect(TRAINS.intercity.needsWires).toBe(false);
    const d = new Fleet(new Network(() => false, 900), 3).dressTrain(TRAINS.intercity);
    expect(d.chain.filter((m) => m.stats.power === 'electric').map((m) => m.id)).toEqual([]);
  });
});
