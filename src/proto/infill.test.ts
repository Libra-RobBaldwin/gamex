// Leftover land (infill.ts): the gaps between a town's plots become parks and the rest; land a
// player's road encloses out in the fields stays fields.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS } from './roads';
import { SCENARIOS, town } from './trafficsim';
import { findRegions } from './infill';
import { lotSites } from './game/crowdsites';
import { parkEntrances } from './parkplan';

const SC = SCENARIOS.find((s) => s.name === 'the starter town')!;
function world() {
  const { net } = town({ ...SC, buses: 0 });
  // the town's plots, most of them standing (as main.ts spawns them at the start), the rest waiting
  net.lots = [];
  const queue = [];
  const plots = [...net.segs.keys()].flatMap((id) => net.plotsFor(id, { x: 0, z: 0 }));
  for (const [i, l] of plots.entries()) if (i % 5 === 4) queue.push(l); else if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  return { net, queue };
}
const street = { ...DEFAULT_OPTS, type: 'street' as const };

describe('leftover land', () => {
  it('a road built across open country encloses no park, playground, allotments or pond', () => {
    const w = world();
    let edge = 0;
    for (const l of w.net.lots) edge = Math.max(edge, Math.hypot(l.x, l.z));
    const R = Math.ceil(edge) + 60, box = { x0: R - 40, z0: -190, x1: R + 300, z1: 170 };
    const inBox = (p: { x: number; z: number }) => p.x > box.x0 && p.x < box.x1 && p.z > box.z0 && p.z < box.z1;
    // four streets round a field just beyond the town, as the road tool builds them
    const corners = [{ x: R, z: -150 }, { x: R + 260, z: -150 }, { x: R + 260, z: 130 }, { x: R, z: 130 }];
    const made: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = w.net.snapStart(corners[i], 4), b = w.net.snapStart(corners[(i + 1) % 4], 4);
      const c = w.net.check(a, b, undefined, street);
      expect(c.ok, c.reason).toBe(true);
      made.push(...w.net.build(a, b, undefined, street));
    }
    // (the road tool plans plots along a new road at once; none stand yet)
    for (const id of made) w.queue.push(...w.net.plotsFor(id, { x: 0, z: 0 }));
    expect(w.queue.some((l) => inBox(l))).toBe(true);
    const { regions } = findRegions(w.net, w.queue);
    const enclosed = regions.filter((r) => inBox(r.centre));
    expect(enclosed.map((r) => `${r.kind} ${r.cells.length}`)).toEqual([]);
    const sites = lotSites(w.net, regions, [], []);
    expect(sites.parks.filter((p) => inBox(p.centre)).length).toBe(0);
    expect(sites.parks.some((p) => p.pond)).toBe(false);
  });
  it('the town’s own gaps still become parks, with a path from each gate and no pond', () => {
    const w = world();
    const { regions } = findRegions(w.net, w.queue);
    const parks = regions.filter((r) => r.kind === 'park' || r.kind === 'pocket');
    expect(parks.length).toBeGreaterThan(0);
    const sites = lotSites(w.net, regions, [], []);
    for (const p of sites.parks) {
      expect(p.pond).toBeUndefined();
      // every path starts at a gate: a step inside the park's edge, a few metres from a road's edge piece
      const r = regions.find((x) => `park:${x.id}` === p.id)!;
      if (!parkEntrances(r.roadEdges, r.centre).length) continue; // (a park with no gate keeps a straight path through its middle)
      for (const path of p.paths) {
        const a = path[0];
        const d = Math.min(...r.roadEdges.map(([x0, z0]) => Math.hypot(a.x - x0, a.z - z0)));
        expect(d, `${p.id}: a path starts ${Math.round(d)} m from the nearest edge`).toBeLessThan(4);
      }
    }
  });
});
