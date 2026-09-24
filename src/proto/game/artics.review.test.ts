// Adversarial review: the traffic's overlap guarantee with the new real bodies, when a road's trips
// start in an industrial estate or on a motorway (the areas game/fleet.ts sends artics from).
// The stock scenarios in trafficsim.ts have no industrial zone, so they almost never spawn an
// artic; here the fleet is told every road is industrial/motorway after the first step.
import { describe, expect, it } from 'vitest';
import { SCENARIOS, simulate } from '../trafficsim';

const areaRun = (name: string, area: 'industrial' | 'motorway', seconds = 120) => {
  const sc = SCENARIOS.find((s) => s.name === name)!;
  let patched = false;
  return simulate(sc, seconds, 1 / 30, (tr) => {
    if (!patched) { patched = true; (tr.fleet as unknown as { areaOf: () => string }).areaOf = () => area; }
  });
};

describe('artics and lorries from industrial and motorway roads never overlap anything', () => {
  for (const [name, area] of [
    ['mini-roundabout', 'industrial'],
    ['plain join at a bend', 'industrial'],
    ['the starter town', 'industrial'],
    ['the starter town', 'motorway'],
    ['plain join at a bend', 'motorway'],
  ] as const) {
    it(`${name} (${area})`, () => {
      const r = areaRun(name, area);
      expect(r.overlapPairs, r.sample).toBe(0);
    }, 300_000);
  }
});
