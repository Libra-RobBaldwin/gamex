import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BRIDGE_IDS, type BridgeId } from './catalogue';
import { chooseBridge } from './choose';
import { deckAt } from './crossing';
import { GALLERY } from './gallery';
import { bridgeObject, buildBridge } from './geometry';
import { scenario } from './scenario';

function built(id: BridgeId, bend = 0) {
  const o = chooseBridge(scenario({ ...GALLERY[id], bend }).crossing).options.find((x) => x.def.id === id)!;
  return { c: o.crossing!, lay: o.layout!, bg: buildBridge(o.crossing!, o.layout!) };
}
function box(parts: Record<string, THREE.BufferGeometry | undefined>) {
  const b = new THREE.Box3();
  for (const g of Object.values(parts)) if (g) { g.computeBoundingBox(); b.union(g.boundingBox!); }
  return b;
}

describe('bridge geometry', () => {
  it('builds every type as a handful of meshes, with no broken vertices', () => {
    for (const id of BRIDGE_IDS) {
      const { c, lay, bg } = built(id);
      const parts = Object.entries(bg.parts);
      expect(parts.length, id).toBeGreaterThan(2);
      expect(parts.length, id).toBeLessThanOrEqual(12); // one draw call per material
      let verts = 0;
      for (const [, g] of parts) {
        const a = g!.getAttribute('position').array;
        verts += a.length / 3;
        for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`${id}: bad vertex`);
      }
      expect(verts, id).toBeLessThan(400000);
      // it covers the deck from end to end
      const b = box(bg.parts), p0 = c.path, x0 = lay.s0 + p0[0].x, x1 = lay.s1 + p0[0].x;
      expect(b.min.x).toBeLessThanOrEqual(x0 + 1);
      expect(b.max.x).toBeGreaterThanOrEqual(x1 - 1);
    }
  });

  it('shows each type\'s structure where it can be seen: above the deck for trusses, arches, pylons and towers', () => {
    for (const [id, above] of [['truss-through', 5], ['arch-tied', 12], ['cable-stayed', 60], ['suspension', 60]] as const) {
      const { c, lay, bg } = built(id);
      const main = lay.spans.find((sp) => sp.role === 'main') ?? lay.spans.find((sp) => sp.len === Math.max(...lay.spans.map((q) => q.len)))!;
      const deck = deckAt(c, (main.s0 + main.s1) / 2);
      expect(box(bg.parts).max.y, id).toBeGreaterThan(deck + above);
    }
    // masonry: the dark voussoir bands and stone piers
    expect(built('masonry').bg.parts.stoneDark).toBeDefined();
    expect(built('trestle').bg.parts.timber).toBeDefined();
    expect(built('suspension').bg.parts.cable).toBeDefined();
  });

  it('puts piers and footings out beside the deck so they read from above', () => {
    const { lay, bg } = built('masonry');
    const b = box(bg.parts);
    // pilasters and cutwaters stand out past the parapets
    expect(b.max.z - b.min.z).toBeGreaterThan(lay.width + 2);
  });

  it('follows a curved deck', () => {
    const { bg } = built('beam', 40);
    const b = box(bg.parts);
    expect(b.max.z).toBeGreaterThan(20);
  });

  it('lifts the bascule leaves', () => {
    const { bg } = built('bascule');
    expect(bg.leaves).toHaveLength(2);
    const bo = bridgeObject(bg);
    const top = () => { bo.object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(bo.object).max.y; };
    const shut = top();
    bo.setOpen(1);
    expect(top()).toBeGreaterThan(shut + 10);
  });
});
