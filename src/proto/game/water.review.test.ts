// Adversarial review of the water integration (claude/work-int-water). Every test here states
// something the game should hold and that the integration breaks; each fails today.
import { describe, expect, it } from 'vitest';
import { GameWater, LAKE, LEVEL, lakeGround } from './water';
import { Land } from '../land';
import { Network } from '../roads';
import { ROADS, halfOf, kerbOf } from '../catalog';
import { WATER_LIGHT } from '../water/material';
import { reedSpots } from '../water';

interface XZ { x: number; z: number }
const gw = new GameWater(676);
const at = (a: number, r: number) => ({ x: LAKE.x + Math.cos(a) * r, z: LAKE.z + Math.sin(a) * r });
// the waterline the player sees: where the ground mesh (lakeGround) dips under the water's level
function visibleShore(a: number) { let r = 40; while (lakeGround(at(a, r).x, at(a, r).z) < LEVEL) r += 0.02; return r; }
// where gw.isWater stops (the nearest a road's centre line may come)
function roadLimit(a: number) { let r = 40; while (gw.isWater(at(a, r))) r += 0.02; return r; }
const inPoly = (p: XZ, poly: XZ[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
const ANGLES = Array.from({ length: 180 }, (_, i) => (i / 180) * Math.PI * 2);

// Streets laid tangent to the shore just outside isWater, as a player drawing a lakeside road would;
// only the ones the road check accepts (what the build tool would allow).
function lakesideStreets() {
  const net = new Network((p) => gw.isWater(p), 700, 11);
  const out: { a: number; path: XZ[] }[] = [];
  for (let a = 0; a < Math.PI * 2; a += 0.2) {
    const c = at(a, roadLimit(a) + 0.3), t = { x: -Math.sin(a), z: Math.cos(a) };
    const A = net.snapStart({ x: c.x - t.x * 30, z: c.z - t.z * 30 }, 1), B = net.snapStart({ x: c.x + t.x * 30, z: c.z + t.z * 30 }, 1);
    const ch = net.check(A, B);
    if (ch.ok && ch.profile && ch.profile.maxY < 0.01) out.push({ a, path: ch.path });
  }
  return out;
}
function along(path: XZ[], step = 1) {
  const pts: { p: XZ; n: XZ }[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
    for (let s = 0; s <= L; s += step) pts.push({ p: { x: a.x + ux * s, z: a.z + uz * s }, n: { x: -uz, z: ux } });
  }
  return pts;
}

describe('water integration review', () => {
  it('isWater keeps road centre lines ~4 m off the visible waterline all round the lake (not just at one angle)', () => {
    // water.ts promises "roads keep 4 m off the waterline"; the old circle lake did exactly that.
    // distanceToShore comes from the 4 m water raster, whose waterline sits up to ~3.4 m inside the
    // one drawn, so in places the limit is under half a metre from the water.
    let worst = Infinity, worstA = 0;
    for (const a of ANGLES) { const g = roadLimit(a) - visibleShore(a); if (g < worst) { worst = g; worstA = a; } }
    expect(worst, `at angle ${worstA.toFixed(2)} rad the road limit is ${worst.toFixed(2)} m from the visible waterline`).toBeGreaterThan(3.5);
  });

  it('a lakeside street the road check accepts keeps its carriageway out of the water', () => {
    const kerb = kerbOf(ROADS.street), wet: string[] = [];
    for (const { a, path } of lakesideStreets()) {
      for (const { p, n } of along(path)) for (const k of [1, -1]) {
        const q = { x: p.x + n.x * kerb * k, z: p.z + n.z * kerb * k };
        if (lakeGround(q.x, q.z) < LEVEL) { wet.push(`a=${a.toFixed(1)} (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`); break; }
      }
    }
    expect(wet, 'kerb edges over visible water').toEqual([]);
  });

  it('no reeds stand in the band of a lakeside street the road check accepts (they poke through the road)', () => {
    const spots = reedSpots(gw.tiles[0]), half = halfOf(ROADS.street), hits: string[] = [];
    const roads = lakesideStreets();
    for (let i = 0; i < spots.length; i += 5) {
      const s = { x: spots[i], z: spots[i + 2] };
      for (const { a, path } of roads) {
        if (along(path, 0.5).some(({ p }) => Math.hypot(p.x - s.x, p.z - s.z) < half)) { hits.push(`reed (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) under the street at a=${a.toFixed(1)}`); break; }
      }
    }
    expect(hits).toEqual([]);
  });

  it('every reed tuft stands where isWater keeps roads off', () => {
    const spots = reedSpots(gw.tiles[0]), dry: string[] = [];
    for (let i = 0; i < spots.length; i += 5) if (!gw.isWater({ x: spots[i], z: spots[i + 2] })) dry.push(`(${spots[i].toFixed(1)}, ${spots[i + 2].toFixed(1)})`);
    expect(dry).toEqual([]);
  });

  it('where roads, plots and trees may go the ground is flat (they are placed at height 0)', () => {
    // The bowl's rim starts dropping 13% of the radius (12-13 m) out, but roads may come within
    // ~0.5-4 m of the waterline; everything placed at y = 0 there floats up to 0.3 m over the bank.
    let deepest = 0, where = '';
    for (const a of ANGLES) {
      const p = at(a, roadLimit(a) + 0.05), g = lakeGround(p.x, p.z);
      if (g < deepest) { deepest = g; where = `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`; }
    }
    expect(deepest, `ground at ${where}`).toBeGreaterThan(-0.05);
  });

  it("the outline the ground keeps hedges off covers all of the lake's visible water", () => {
    const polys = gw.outline(), outside: string[] = [];
    for (const a of ANGLES) {
      const p = at(a, visibleShore(a) - 0.3);
      if (!polys.some((poly) => inPoly(p, poly))) outside.push(`(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    expect(outside.length, `visible water outside the outline, e.g. ${outside.slice(0, 3).join(' ')}`).toBe(0);
  });

  it('hedges cannot stand on the sunken beach (the outline keeps them off the bank, as the old circle + 6 m did)', () => {
    // GameGround gets gw.outline() (buffer 0, the raster waterline) where it used to get the lake's
    // circle + 6 m; hedgerows.ts keeps hedges CLEAR = 2.2 m off it, so they run down the beach to
    // the water (seen in the game at (223, -280) on ground 0.19 m down, floating at y = 0).
    const CLEAR = 2.2, polys = gw.outline(), bad: string[] = [];
    const segDist = (p: XZ, a: XZ, b: XZ) => { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t); };
    const distTo = (p: XZ) => { let d = Infinity; for (const poly of polys) { if (inPoly(p, poly)) return 0; for (let i = 0; i < poly.length; i++) d = Math.min(d, segDist(p, poly[i], poly[(i + 1) % poly.length])); } return d; };
    for (const a of ANGLES) {
      for (let r = visibleShore(a); r < visibleShore(a) + 14; r += 0.5) {
        const p = at(a, r);
        if (lakeGround(p.x, p.z) < -0.1 && distTo(p) >= CLEAR) { bad.push(`(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ground ${lakeGround(p.x, p.z).toFixed(2)}`); break; }
      }
    }
    expect(bad.length, `a hedge may stand on the bank at e.g. ${bad.slice(0, 3).join(' ')}`).toBe(0);
  });

  it('the ground mesh spends its fine 2 m grid on the bank, not on flat land and the flat lake bed (perf)', () => {
    // The whole 234 m bowl box is a 2 m grid: 35k triangles, two thirds of them flat. In software
    // rendering the lake view costs ~40% more than before, ~200 ms of it this mesh alone.
    const g = gw.groundGeometry(1352), pos = g.getAttribute('position'), idx = g.index!;
    let flat = 0, fine = 0;
    for (let k = 0; k < idx.count; k += 3) {
      const v = [idx.getX(k), idx.getX(k + 1), idx.getX(k + 2)], xs = v.map((i) => pos.getX(i)), hs = v.map((i) => pos.getZ(i));
      if (Math.max(...xs) - Math.min(...xs) > 2.01) continue;
      fine++;
      if (Math.max(...hs) - Math.min(...hs) < 1e-4) flat++;
    }
    expect(flat / fine, `${flat} of ${fine} fine triangles are flat`).toBeLessThan(0.25);
  });

  it('no cell under the lake level is left without water (the waterline steps on the 4 m raster)', () => {
    // waterSurface draws a 4 m cell only if the raster covers one of its corners; the ground mesh
    // (2 m, exact) dips below the level in 26 cells nobody draws water over, which shows as square
    // notches in the waterline and foam (screenshot notch-n2.png).
    const t = gw.tiles[0], g = t.g, mg = t.margin, n = g.nx, cells = Math.round(t.size / g.step);
    const k = (a: number, b: number) => (mg + b) * n + mg + a;
    const bare: string[] = [];
    for (let b = 0; b < cells; b++) for (let a = 0; a < cells; a++) {
      const x0 = t.ti * t.size + a * g.step, z0 = t.tj * t.size + b * g.step;
      if (x0 < LAKE.x - 130 || x0 > LAKE.x + 130 || z0 < LAKE.z - 130 || z0 > LAKE.z + 130) continue;
      if (t.cover[k(a, b)] || t.cover[k(a + 1, b)] || t.cover[k(a, b + 1)] || t.cover[k(a + 1, b + 1)]) continue;
      let lo = 0;
      for (let u = 0; u <= 4; u += 2) for (let v = 0; v <= 4; v += 2) lo = Math.min(lo, lakeGround(x0 + u, z0 + v));
      if (lo < LEVEL - 0.02) bare.push(`(${x0}, ${z0})`);
    }
    expect(bare, 'cells with the ground under the water level but no water drawn').toEqual([]);
  });

  it("the lake's land claims reach 3 m past the visible waterline (so plots and parks keep off the bank)", () => {
    const land = new Land();
    gw.claim(land);
    const miss: string[] = [];
    for (const a of ANGLES) {
      const p = at(a, visibleShore(a) + 2.5);
      if (land.at(p)?.owner !== 'water') miss.push(`(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
    expect(miss.length, `unclaimed bank 2.5 m from the water, e.g. ${miss.slice(0, 3).join(' ')}`).toBe(0);
  });

  it('the water keeps day light while the game has no dusk (main.ts never changes the sun, sky or hemisphere light)', () => {
    // main.ts calls gw.update(t, hour) every frame; from 17:00 to 08:00 the lake turns to dusk
    // colours (orange sun from a different direction) while the rest of the scene stays at noon.
    // A game day is six real minutes, so the lake alone changes colour every few minutes.
    // (Fixed by giving the game its evening light: gw.light(scene, sun) turns the scene's sun, sky
    // and background with the water's. So: without that the water stays in day light; with it, the
    // water's sun is the scene's, from the same direction, at every hour.)
    const w = new GameWater(676);
    w.update(0, 21);
    const u = w.material.uniforms;
    expect((u.uSunDir.value as THREE.Vector3).angleTo(WATER_LIGHT.day.sunDir)).toBeLessThan(0.01);
    expect((u.uSun.value as THREE.Color).getHexString()).toBe(WATER_LIGHT.day.sun.getHexString());
    const scene = new T.Scene(), sun = new T.DirectionalLight('#fff3dc', 2.3), hemi = new T.HemisphereLight('#e8f3ff', '#5d7040', 1.25);
    scene.background = new T.Color('#a9cbe3');
    sun.position.copy(WATER_LIGHT.day.sunDir).multiplyScalar(320);
    scene.add(hemi, sun, sun.target);
    w.light(scene, sun);
    for (const hour of [7, 12, 18, 21, 3]) {
      w.update(0, hour);
      expect((u.uSunDir.value as THREE.Vector3).angleTo(WATER_LIGHT.day.sunDir), `sun direction at ${hour}:00`).toBeLessThan(0.01);
      expect((u.uSun.value as THREE.Color).getHexString(), `sun colour at ${hour}:00`).toBe(sun.color.getHexString());
    }
    // at noon the scene is as it was; in the evening the scene and the water both turn
    w.update(0, 12);
    expect(sun.color.getHexString()).toBe('fff3dc');
    w.update(0, 21);
    expect(sun.color.getHexString()).not.toBe('fff3dc');
    expect((scene.background as THREE.Color).getHexString()).not.toBe('a9cbe3');
  });
});
import type * as THREE from 'three';
import * as T from 'three';
