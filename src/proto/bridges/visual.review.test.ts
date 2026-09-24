// Adversarial visual review: problems found in the bridges demo, as checks that fail until fixed.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bridgeScene, galleryCrossing } from './scene';
import { groundAt } from './crossing';
import { ballastTexture, DETAIL_MPP, TRACK_CENTRES, RAIL_CENTRE } from './track';
import type { BridgeId } from './catalogue';

const down = new THREE.Vector3(0, -1, 0);
function heightOn(objs: THREE.Object3D[]) {
  const ray = new THREE.Raycaster();
  return (x: number, z: number) => { ray.set(new THREE.Vector3(x, 1e4, z), down); const h = ray.intersectObjects(objs, false); return h.length ? h[0].point.y : NaN; };
}
function trees(group: THREE.Group) {
  const crowns = group.getObjectByName('tree-crowns') as THREE.InstancedMesh, out: { x: number; z: number; base: number; R: number }[] = [];
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < crowns.count; i++) { crowns.getMatrixAt(i, m); m.decompose(p, q, s); out.push({ x: p.x, z: p.z, base: p.y - 7 * s.x, R: 3.2 * s.x }); }
  return out;
}
// station of a plan point: its nearest point on the route
function stationOf(path: { x: number; z: number }[], x: number, z: number) {
  let best = Infinity, sb = 0, acc = 0;
  for (let j = 1; j < path.length; j++) {
    const a = path[j - 1], b = path[j], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (L * L))), d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best) { best = d; sb = acc + t * L; }
    acc += L;
  }
  return sb;
}

describe('visual review: trees', () => {
  // Trees are scattered from x0..x1 and |z| < W with no margin for the crown (up to 4.2 m across
  // its radius), so crowns hang out over the map's cut edges, some trunks right on the edge.
  it('keeps every crown inside the map (trestle gallery)', () => {
    const { sc, c, lay } = galleryCrossing('trestle');
    const s = bridgeScene(sc, c, lay);
    s.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s.group.getObjectByName('earth')!);
    const over = trees(s.group).filter((t) => t.x - t.R < box.min.x || t.x + t.R > box.max.x || t.z - t.R < box.min.z || t.z + t.R > box.max.z);
    expect(over.map((t) => `(${t.x.toFixed(1)}, ${t.z.toFixed(1)})`)).toEqual([]);
  }, 120000);

  // On a curved route the trees' clearance from the roads underneath is tested by station
  // (sOf(x)), but the road runs square to the route near it, so a crown lands over the road.
  it('keeps crowns off the road underneath on a curved crossing (trestle, bend 40)', () => {
    const { sc, c, lay } = galleryCrossing('trestle', 40);
    const s = bridgeScene(sc, c, lay);
    s.group.updateMatrixWorld(true);
    const route: THREE.Object3D[] = [];
    s.group.traverse((o) => { if (o instanceof THREE.Mesh && o.name.startsWith('route-')) route.push(o); });
    const h = heightOn(route), bad: string[] = [];
    for (const t of trees(s.group)) for (let k = 0; k < 16; k++) for (const f of [0.5, 1]) {
      const a = (k / 16) * Math.PI * 2, y = h(t.x + Math.cos(a) * t.R * f, t.z + Math.sin(a) * t.R * f);
      if (Number.isFinite(y) && y > t.base - 1) { bad.push(`tree at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`); k = 99; break; }
    }
    expect([...new Set(bad)]).toEqual([]);
  }, 120000);
});

describe('visual review: supports meet the ground', () => {
  // A pier's footing is flat at the ground height at its centre; on the bench slopes beside the
  // roads underneath and on river banks its downhill corners stand clear of the earth mesh, so
  // there is daylight under the footing (masonry pier at s ≈ 326 hangs 0.74 m over the slope).
  for (const id of ['masonry', 'girder', 'box'] as BridgeId[]) it(`no footing floats over the earth: ${id}`, () => {
    const { sc, c, lay } = galleryCrossing(id);
    const s = bridgeScene(sc, c, lay);
    s.group.updateMatrixWorld(true);
    const earth = heightOn([s.group.getObjectByName('earth')!]), bad: string[] = [];
    s.bridge!.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !/stone|concrete|footing/.test(o.name)) return;
      const p = o.geometry.getAttribute('position'), v = new THREE.Vector3(), low = new Map<string, number>();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const k = `${v.x.toFixed(2)},${v.z.toFixed(2)}`; low.set(k, Math.min(low.get(k) ?? Infinity, v.y)); }
      for (const [k, y] of low) {
        const [x, z] = k.split(',').map(Number), e = earth(x, z);
        if (!Number.isFinite(e) || Math.abs(y - groundAt(c, stationOf(c.path, x, z))) > 1) continue; // not meant to meet the ground
        if (y - e > 0.05) bad.push(`${o.name} corner (${x}, ${y.toFixed(2)}, ${z}) ${(y - e).toFixed(2)} m above the earth`);
      }
    });
    expect(bad.slice(0, 6), bad.slice(0, 6).join("\n")).toEqual([]);
  }, 300000);
});

describe('visual review: near and far track match at the switch', () => {
  // Just above DETAIL_MPP the painted bed is sampled around mip level 3 (4 m over 32 texels).
  // There the rail heads are painted at least 0.6 texel either side (15 cm wide, in #c3c7cb) where
  // the real ones are 7 cm (in #8d9196): the far look shows broad pale stripes that turn into thin
  // grey rails at the switch (thousands of pixels change at the same camera in the demo).
  it('paints no more rail than there is, in the mip level used at the switch', () => {
    const t = ballastTexture('timber'), texelsPerM = 256 / TRACK_CENTRES;
    const level = Math.max(0, Math.floor(Math.log2(DETAIL_MPP * texelsPerM)));
    const mip = t.mipmaps![level] as { data: Uint8Array; width: number; height: number };
    // light the rail heads add across one track, relative to the ballast right beside them, in
    // metres of "full rail". (Fixer's note: the first version of this check took the median
    // column as the ballast, but most columns lie in the darker band of the sleepers, so plain
    // ballast outside the sleeper ends counted as rail; the baseline is now the ballast and
    // sleepers 0.2-0.45 m either side of each rail, and the rail is what lies within 0.2 m.)
    const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const row: number[] = [];
    for (let i = 0; i < mip.width; i++) { let a = 0; for (let j = 0; j < mip.height; j++) { const k = (j * mip.width + i) * 4; a += lum(mip.data[k], mip.data[k + 1], mip.data[k + 2]); } row.push(a / mip.height); }
    const nOf = (i: number) => { const u = (i + 0.5) / mip.width; return (u <= 0.5 ? u : u - 1) * TRACK_CENTRES; };
    const off = (i: number) => Math.abs(Math.abs(nOf(i)) - RAIL_CENTRE);
    const side = row.filter((_, i) => off(i) > 0.2 && off(i) < 0.45), ballast = side.reduce((a, b) => a + b, 0) / side.length;
    const railLum = lum(0xc3, 0xc7, 0xcb), texel = TRACK_CENTRES / mip.width;
    const painted = row.reduce((s, l, i) => s + (off(i) <= 0.2 ? Math.max(0, l - ballast) / (railLum - ballast) * texel : 0), 0) / 2; // per rail (one repeat holds one track: two rails)
    const real = 0.07 * (lum(0x8d, 0x91, 0x96) - ballast) / (railLum - ballast);
    expect(RAIL_CENTRE).toBeGreaterThan(0);
    expect(painted, `mip ${level}: painted ${painted.toFixed(3)} m of full rail vs real ${real.toFixed(3)} m`).toBeLessThan(real * 1.5);
  });
});
