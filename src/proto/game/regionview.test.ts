import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, type Lot } from '../roads';
import { design, landFits, legsAt, type Junction } from '../junction';
import { drawRoads } from '../roaddraw';
import { findRegions } from '../infill';
import { RegionView, splitByTile, type ChunkLike } from './regionview';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
// A grid of streets across tile and cell boundaries (tiles are 1 km, cells 250 m), with its
// junctions designed and their land claimed as the game does.
function town() {
  const net = new Network(undefined, 3000, 11);
  for (const z of [-420, -140, 140, 420]) net.build(net.snapStart({ x: -620, z }, 3), net.snapStart({ x: 620, z }, 3), undefined, as('street'));
  for (const x of [-480, -160, 160, 480]) net.build(net.snapStart({ x, z: -560 }, 3), net.snapStart({ x, z: 560 }, 3), undefined, as('street'));
  const junctions = new Map<number, Junction>();
  for (const n of net.nodes.values()) {
    if (legsAt(net, n.id).length < 3) continue;
    const j = design(net, n.id, { fits: (polys) => landFits(net, n.id, polys) });
    if (j) { junctions.set(n.id, j); net.land.claim(`junction:${n.id}`, 'junction', j.shape?.claims ?? []); }
  }
  return { net, junctions };
}
const mat = new THREE.MeshLambertMaterial();
function view(net: Network, junctions: Map<number, Junction>) {
  const scene = new THREE.Scene();
  const rv = new RegionView({ scene, net, junctions, editing: () => null, treeMats: { trunk: mat, crown: mat }, chunks: new Map<string, ChunkLike>(), bound: 3000, ground: new Set() });
  return { scene, rv };
}
// every triangle of every mesh in a group, by material, as sorted strings (lamps by where they are)
function triangles(g: THREE.Object3D, lampGeo?: THREE.BufferGeometry) {
  const by = new Map<string, string[]>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const key = (m.material as THREE.Material).uuid, list = by.get(key) ?? [];
    by.set(key, list);
    if (lampGeo && m.geometry === lampGeo) { list.push(`lamp ${m.position.x.toFixed(3)},${m.position.y.toFixed(3)},${m.position.z.toFixed(3)}`); return; }
    const p = m.geometry.getAttribute('position'), idx = m.geometry.index, n = idx ? idx.count : p.count;
    for (let k = 0; k + 2 < n; k += 3) {
      const v = [0, 1, 2].map((q) => { const i = idx ? idx.getX(k + q) : k + q; return `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; });
      list.push(v.join(' '));
    }
  });
  for (const l of by.values()) l.sort();
  return by;
}

describe('the region drawn in tiles (game/regionview.ts)', () => {
  it('draws every road and junction a tile at a time exactly as drawing them all at once does', async () => {
    const { net, junctions } = town();
    const whole = new THREE.Group();
    drawRoads(net, whole, junctions, mat, mat);
    const lampGeo = (whole.children.find((c) => ((c as THREE.Mesh).geometry as THREE.BoxGeometry).parameters?.depth === 0.06) as THREE.Mesh | undefined)?.geometry;
    const { rv } = view(net, junctions);
    rv.roadsChanged();
    await rv.settle({ x: 0, z: 0, h: 400, el: 0.6, az: Math.PI / 4 }, 0.45, undefined, true);
    const levels = rv.levels();
    for (const k of ['-1,-1', '-1,0', '0,-1', '0,0']) expect(levels[k]).toBe('near');
    const tiles = new THREE.Group();
    for (const o of rv.root.children) if (o instanceof THREE.Group && o.visible) tiles.add(o.clone(true));
    const a = triangles(whole, lampGeo), b = triangles(tiles, lampGeo);
    expect([...a.values()].reduce((t, l) => t + l.length, 0)).toBeGreaterThan(5000);
    expect(junctions.size).toBeGreaterThan(10);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [k, list] of a) expect(b.get(k)).toEqual(list);
  }, 60000);

  it('picks the level from the zoom, with slack either side so it does not flip back and forth', async () => {
    const { net, junctions } = town();
    const { rv } = view(net, junctions);
    rv.roadsChanged();
    const at = (h: number) => { rv.update({ x: 0, z: 0, h, el: 0.6, az: Math.PI / 4 }, 0.45); return rv.zoomBand; };
    expect(at(300)).toBe('near');
    expect(at(1080)).toBe('near'); // (just past the line: holds)
    expect(at(1200)).toBe('mid');
    expect(at(950)).toBe('mid'); // (just back under it: holds)
    expect(at(850)).toBe('near');
    expect(at(3200)).toBe('far');
    expect(at(2400)).toBe('far');
    expect(at(2100)).toBe('mid');
  });

  it('only the tiles in view get near detail; the rest of the map is middle or far', async () => {
    const { net, junctions } = town();
    // a second town 2.5 km off
    for (const z of [2400, 2600]) net.build(net.snapStart({ x: 2300, z }, 3), net.snapStart({ x: 2700, z }, 3), undefined, as('street'));
    const { rv } = view(net, junctions);
    rv.roadsChanged();
    await rv.settle({ x: 0, z: 0, h: 300, el: 0.6, az: Math.PI / 4 }, 0.45, undefined, true);
    const levels = rv.levels();
    expect(levels['0,0']).toBe('near');
    expect(levels['2,2']).toBe('far');
    // zoomed right out, everything is far
    await rv.settle({ x: 0, z: 0, h: 5000, el: 0.6, az: Math.PI / 4 }, 0.45, undefined, true);
    expect(Object.values(rv.levels()).every((l) => l === 'far' || l === null)).toBe(true);
  }, 60000);

  it('after an edit, only the cells whose roads or junctions changed are redrawn', async () => {
    const { net, junctions } = town();
    const { rv } = view(net, junctions);
    const all = rv.roadsChanged();
    expect(all.length).toBeGreaterThan(20);
    expect(rv.roadsChanged()).toEqual([]); // (nothing changed)
    // a cul-de-sac off one street, in one corner
    net.build(net.snapStart({ x: 300, z: 420 }, 3), { x: 300, z: 540 }, undefined, as('street'));
    const changed = rv.roadsChanged();
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(6);
    for (const k of changed) { const [ci, cj] = k.split(',').map(Number); expect(Math.abs(ci * 250 + 125 - 300)).toBeLessThan(700); expect(cj * 250 + 125).toBeGreaterThan(0); }
  });

  it('cuts a mesh into tiles without losing or adding a triangle', () => {
    const g = new THREE.PlaneGeometry(4000, 4000, 40, 40);
    const m = new THREE.Mesh(g, mat);
    m.rotation.x = -Math.PI / 2;
    const tris = g.index!.count / 3;
    const out = splitByTile(m);
    expect(out.children.length).toBe(16);
    let n = 0;
    for (const c of out.children) { const cg = (c as THREE.Mesh).geometry; n += cg.getAttribute('position').count / 3; expect((c as THREE.Mesh).rotation.x).toBeCloseTo(-Math.PI / 2); }
    expect(n).toBe(tris);
  });
});

describe('leftover land looked at in a box (infill.ts findRegions `within`)', () => {
  it('finds exactly the gaps looking at the whole map finds, for every gap wholly inside the box', () => {
    const { net } = town();
    const queue: Lot[] = [];
    for (const s of net.segs.values()) for (const l of net.plotsFor(s.id)) if (net.lotFree(l, queue)) queue.push(l);
    // build every other plot, so there are gaps between them
    queue.forEach((l, i) => { if (i % 3) { net.fitParcel(l); net.lots.push(l); } });
    const pending = queue.filter((_, i) => i % 3 === 0);
    const full = findRegions(net, pending);
    const box = { x0: -300, z0: -300, x1: 300, z1: 300 };
    const part = findRegions(net, pending, box);
    const sig = (r: { id: string; kind: string; cells: { x: number; z: number }[] }) => `${r.id}|${r.kind}|${r.cells.map((c) => `${c.x},${c.z}`).join(';')}`;
    const fullSigs = new Set(full.regions.map(sig));
    expect(part.regions.length).toBeGreaterThan(0);
    for (const r of part.regions) expect(fullSigs.has(sig(r))).toBe(true);
    // and none wholly inside is missed
    const inside = full.regions.filter((r) => r.cells.every((c) => c.x > box.x0 + 10 && c.x < box.x1 - 10 && c.z > box.z0 + 10 && c.z < box.z1 - 10));
    const partSigs = new Set(part.regions.map(sig));
    for (const r of inside) expect(partSigs.has(sig(r)) || part.cut.some((c) => r.cells.some((q) => q.x >= c.x0 && q.x <= c.x1 && q.z >= c.z0 && q.z <= c.z1))).toBe(true);
  }, 60000);
});
