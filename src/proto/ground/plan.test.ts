// A field plan (plan.ts) in the ground: the painter fills its fields, hedges its hedged lines
// (not against woods), and the canopy covers its woods and nothing else.
import { describe, expect, it } from 'vitest';
import { Ground } from './index';
import { unpackCover } from './covers';
import { Occupancy, planHedges } from './hedgerows';
import { canopy } from './canopy';
import type { FieldSource, PlanField, PlanLine } from './plan';

// three fields side by side along x: wheat, grass, a wood; a hedge between each
const plan: { fields: PlanField[]; lines: PlanLine[] } = {
  fields: [
    { poly: [{ x: -300, z: -100 }, { x: -100, z: -100 }, { x: -100, z: 100 }, { x: -300, z: 100 }], kind: 'arable', crop: 'wheat', dir: 0 },
    { poly: [{ x: -100, z: -100 }, { x: 100, z: -100 }, { x: 100, z: 100 }, { x: -100, z: 100 }], kind: 'grass', crop: 'grass', dir: 0 },
    { poly: [{ x: 100, z: -100 }, { x: 300, z: -100 }, { x: 300, z: 100 }, { x: 100, z: 100 }], kind: 'wood', crop: 'grass', dir: 0 },
  ],
  lines: [{ a: { x: -100, z: -100 }, b: { x: -100, z: 100 }, hedge: true }, { a: { x: 100, z: -100 }, b: { x: 100, z: 100 }, hedge: true }],
};
function ground() {
  const source: FieldSource = { blocksNear: () => [{ id: 1, ...plan }] };
  const g = new Ground({ region: { x0: -320, z0: -120, size: 640 }, texel: 4, hedges: false, fields: source });
  g.paint({ seed: 3 });
  return g;
}
const at = (g: Ground, x: number, z: number) => { const C = g.cover!, R = C.region, i = Math.floor((x - R.x0) / C.texel), j = Math.floor((z - R.z0) / C.texel); return unpackCover(C.a, (j * R.n + i) * 4); };

describe('a field plan', () => {
  const g = ground();
  it('paints its fields: the crop, the grass, the wood', () => {
    const w = at(g, -200, 0), p = at(g, 0, 0), d = at(g, 200, 0);
    expect(w.field).toBeGreaterThan(0.9); expect(w.crop).toBe(2); // (wheat)
    expect(p.field).toBeGreaterThan(0.9); expect(p.crop).toBe(0);
    expect(d.wood).toBeGreaterThan(0.9); expect(d.field).toBeLessThan(0.01);
    // the hedge's foot, dark from far off, along the hedged line between two fields
    expect(Math.max(at(g, -101, 0).wood, at(g, -99, 0).wood)).toBeGreaterThan(0.25);
  });
  it("hedges the line between fields, but not a wood's edge", () => {
    const groups = planHedges(g.layout, { x0: -320, z0: -120, x1: 320, z1: 120 }, new Occupancy(g.layout.input));
    const pieces = groups.flatMap((q) => q.pieces);
    expect(pieces.length).toBeGreaterThan(15);
    expect(pieces.every((p) => Math.abs(p.x + 100) < 1)).toBe(true);
  });
  it('covers its woods with a canopy, and only them', () => {
    const C = g.cover!, cover = { a: C.a, x0: C.region.x0, z0: C.region.z0, size: C.region.size, n: C.region.n };
    const m = canopy(g.layout, cover, { x0: -320, z0: -120, x1: 320, z1: 120 }, 5, { broadleaf: '#4f8a36', conifer: '#2f6b35' })!;
    expect(m.idx.length).toBeGreaterThan(0);
    let top = 0;
    for (let k = 0; k < m.pos.length; k += 3) { if (m.pos[k + 1] > 0) expect(m.pos[k]).toBeGreaterThan(98); top = Math.max(top, m.pos[k + 1]); }
    expect(top).toBeGreaterThan(8);
  });
});
