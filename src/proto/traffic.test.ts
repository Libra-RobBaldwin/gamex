import { describe, expect, it } from 'vitest';
import { SCENARIOS, simulate } from './trafficsim';

// Heavy traffic through every kind of junction and join for a few simulated minutes: in no frame
// may two vehicles overlap (as drawn), and traffic has to keep flowing.
// TRAFFIC_REPORT=1 prints a line per scenario; TRAFFIC_SECONDS sets how long each runs
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const REPORT = !!env.TRAFFIC_REPORT;
describe('traffic never drives through itself', () => {
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      const r = simulate(sc, Number(env.TRAFFIC_SECONDS ?? 180));
      if (REPORT) console.log(`${sc.name.padEnd(52)} overlapFrames=${r.overlapFrames} pairs=${r.overlapPairs} worst=${r.worst} spawned=${r.spawned} arrived=${r.arrived} gaveUp=${r.gaveUp} live=${r.live} laneChanges=${r.laneChanges} outOfLane=${r.outOfLane} ms/update=${r.msPerUpdate.toFixed(2)} forms=${r.forms.join(',')}${r.sample ? `\n    first: ${r.sample}` : ''}`);
      if (sc.forms) expect(r.forms).toEqual(sc.forms);
      expect(r.overlapPairs).toBe(0);
      expect(r.outOfLane).toBe(0);
      expect(r.arrived).toBeGreaterThan(sc.minTrips);
      expect(r.gaveUp).toBeLessThan(Math.max(3, r.arrived * 0.05));
      expect(r.laneChanges).toBeGreaterThanOrEqual(sc.minChanges ?? 0);
    }, 120_000);
  }
  // a phone struggling at 10 frames a second takes steps three times as long: still nobody touches
  it('and not at ten frames a second either', () => {
    for (const sc of SCENARIOS) {
      const r = simulate(sc, 90, 0.1);
      if (REPORT) console.log(`${sc.name.padEnd(52)} dt=0.1 pairs=${r.overlapPairs} outOfLane=${r.outOfLane} arrived=${r.arrived} gaveUp=${r.gaveUp}`);
      expect(r.overlapPairs, sc.name).toBe(0);
      expect(r.outOfLane, sc.name).toBe(0);
    }
  }, 300_000);
});

