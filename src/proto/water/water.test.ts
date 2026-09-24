import { describe, expect, it } from 'vitest';
import { FnHeight, ProceduralTerrain, TERRAIN_PRESETS } from '../terrain';
import { CLASS_OF, type Reach } from './rivers';
import { NAV, type WaterParams } from './types';
import { WaterSystem } from './water';

// small regions keep the synthetic scenes quick
const SMALL: Partial<WaterParams> = { region: 2000, margin: 400, cell: 16 };

// A valley falling to the south along x = 1000, with a side valley joining it from the north-west:
// no river field, so rivers come from flow accumulation alone (as on real elevation data).
const valley = () => new FnHeight((x, z) => {
  const main = 60 - 0.015 * z + 0.08 * Math.abs(x - 1000);
  // side valley along the line from (300, 200) to (1000, 1300)
  const dx = 700, dz = 1100, L = Math.hypot(dx, dz), t = Math.max(0, Math.min(1, ((x - 300) * dx + (z - 200) * dz) / (L * L)));
  const d = Math.hypot(x - (300 + dx * t), z - (200 + dz * t));
  const side = 62 - 0.015 * (200 + dz * t) - 3 * t + 0.08 * d;
  return Math.min(main, side) + 0.3 * Math.sin(x / 37) * Math.cos(z / 53);
});

const along = (r: Reach, k: number) => { const a = Math.max(0, k - 1), b = Math.min(r.n - 1, k + 1); const l = Math.hypot(r.x[b] - r.x[a], r.z[b] - r.z[a]) || 1; return [(r.x[b] - r.x[a]) / l, (r.z[b] - r.z[a]) / l]; };

describe('rivers from flow accumulation', () => {
  const src = valley(), w = new WaterSystem(src, SMALL);
  const rs = w.reaches();
  it('finds a river down the valley that flows downhill and joins a network', () => {
    expect(rs.length).toBeGreaterThan(2);
    // the main river is near the valley's line at mid-region
    const mid = rs.flatMap((r) => [...r.z].map((z, k) => ({ r, k, z }))).filter((p) => Math.abs(p.z - 1600) < 6);
    const main = mid.reduce((a, b) => (b.r.area[b.k] > a.r.area[a.k] ? b : a));
    expect(Math.abs(main.r.x[main.k] - 1000)).toBeLessThan(40);
    // a confluence: some reach has two flowing into it
    expect(rs.some((r) => r.up.length >= 2)).toBe(true);
    for (const r of rs) {
      for (let k = 1; k < r.n; k++) {
        expect(r.surf[k]).toBeLessThanOrEqual(r.surf[k - 1] + 1e-4); // the water surface never climbs
        expect(r.area[k]).toBeGreaterThanOrEqual(r.area[k - 1]); // catchment grows downstream
        expect(r.hw[k] / r.hw[k - 1]).toBeGreaterThan(0.7); // (width wobbles, but doesn't jump)
      }
      // flow runs downhill over the ground along each reach of any length
      if (r.n < 25) continue;
      let down = 0;
      for (let k = 0; k < r.n; k += 5) { const [tx, tz] = along(r, k), g = (src.heightAt(r.x[k] + tx * 5, r.z[k] + tz * 5) - src.heightAt(r.x[k] - tx * 5, r.z[k] - tz * 5)) / 10; down += g < 0 ? 1 : 0; }
      expect(down / Math.ceil(r.n / 5)).toBeGreaterThan(0.6);
    }
    // width and depth increase downstream: the end of the trunk is wider than any source
    const trunk = rs.reduce((a, b) => (b.area[b.n - 1] > a.area[a.n - 1] ? b : a)), head = rs.find((r) => !r.up.length)!;
    expect(trunk.hw[trunk.n - 1]).toBeGreaterThan(head.hw[0] * 2);
    expect(trunk.depth[trunk.n - 1]).toBeGreaterThan(head.depth[0]);
  });
  it('answers queries in the channel', () => {
    const trunk = rs.reduce((a, b) => (b.area[b.n - 1] > a.area[a.n - 1] ? b : a)), k = Math.floor(trunk.n * 0.6), x = trunk.x[k], z = trunk.z[k];
    expect(w.isWater(x, z)).toBe(true);
    expect(w.kindAt(x, z)).toBe('river');
    expect(w.depthAt(x, z)).toBeGreaterThan(0.3);
    expect(w.waterLevelAt(x, z)).toBeCloseTo(trunk.surf[k], 1);
    expect(w.groundAt(x, z)).toBeLessThan(src.heightAt(x, z)); // the channel is cut into the ground
    const f = w.flowAt(x, z), [tx, tz] = along(trunk, k);
    expect(f.speed).toBeGreaterThan(0.1);
    expect(f.x * tx + f.z * tz).toBeGreaterThan(0.9);
    const wc = w.watercourseAt(x, z)!;
    expect(wc.width).toBeCloseTo(2 * trunk.hw[k], 0);
    expect(NAV[wc.cls].clearance).toBe(wc.clearance);
    expect(wc.design).toBeGreaterThan(wc.surface);
    // well away from the river it's dry, and the distance to the shore says how far
    const dry = [x + 150, z];
    expect(w.isWater(dry[0], dry[1])).toBe(false);
    expect(w.distanceToShore(dry[0], dry[1])).toBeLessThan(-40);
    expect(w.distanceToShore(x, z)).toBeGreaterThan(0);
  });
  it('reports crossings with the channel to keep clear and the soffit to clear', () => {
    const trunk = rs.reduce((a, b) => (b.area[b.n - 1] > a.area[a.n - 1] ? b : a)), k = Math.floor(trunk.n * 0.6);
    const [tx, tz] = along(trunk, k), x = trunk.x[k], z = trunk.z[k];
    const cs = w.crossings({ x: x + tz * 60, z: z - tx * 60 }, { x: x - tz * 60, z: z + tx * 60 });
    expect(cs.length).toBe(1);
    const c = cs[0], rule = NAV[c.cls!];
    expect(c.s0).toBeGreaterThan(40); expect(c.s1).toBeLessThan(80);
    expect(c.soffit).toBeCloseTo(c.surface + rule.freeboard + rule.clearance, 5);
    if (c.channel) { expect(c.channel[0]).toBeGreaterThanOrEqual(c.s0); expect(c.channel[1]).toBeLessThanOrEqual(c.s1); }
  });
});

describe('sea and lakes', () => {
  it('floods land below sea level connected to open water, but not an inland pit', () => {
    const src = new FnHeight((x, z) => (Math.hypot(x - 1700, z - 1000) < 250 ? -2 : (x - 800) / 40));
    const w = new WaterSystem(src, { ...SMALL, sea: 0, breach: 0 });
    expect(w.kindAt(400, 1000)).toBe('sea');
    expect(w.depthAt(400, 1000)).toBeCloseTo(10, 1);
    expect(w.isWater(820, 1000)).toBe(false);
    // the coastline is where the ground crosses sea level
    expect(w.isWater(795, 700)).toBe(true);
    expect(w.isWater(805, 700)).toBe(false);
    // the pit below sea level is a lake at its spill level, not the sea
    const p = w.probe(1700, 1000);
    expect(p.kind).toBe('lake');
    expect(p.level!).toBeCloseTo((1450 - 800) / 40 - 0.3, 0); // its west rim, less the drawdown
  });
  it('fills a closed hollow as a lake with a level surface', () => {
    // a bowl 8 m deep in a plateau that tilts gently west, so the bowl spills over its west rim
    const src = new FnHeight((x, z) => 36 - 8 * Math.max(0, 1 - ((x - 1000) ** 2 + ((z - 1000) * 1.6) ** 2) / 300 ** 2) + 0.004 * (x - 1000));
    const w = new WaterSystem(src, { ...SMALL, breach: 0 });
    const a = w.probe(1000, 1000), b = w.probe(1120, 1000);
    expect(a.kind).toBe('lake');
    expect(b.kind).toBe('lake');
    expect(a.level).toBeCloseTo(b.level!, 5);
    expect(a.body).toBe(b.body);
    expect(w.depthAt(1000, 1000)).toBeGreaterThan(4);
    expect(w.isWater(1000, 1600)).toBe(false);
  });
  it('gives a river reaching the sea a tidal estuary that widens to its mouth', () => {
    const src = new FnHeight((x, z) => 0.006 * (x - 600) + 0.06 * Math.abs(z - 1000));
    const w = new WaterSystem(src, { ...SMALL, sea: 0, estuaryArea: 2 });
    const mouths = w.reaches().filter((r) => r.mouth === 'sea').sort((a, b) => b.area[b.n - 1] - a.area[a.n - 1]);
    const r = mouths[0];
    expect(r.area[r.n - 1]).toBeGreaterThan(2);
    const est = [...r.cls].map((c, k) => (CLASS_OF[c] === 'estuary' ? k : -1)).filter((k) => k >= 0);
    expect(est.length).toBeGreaterThan(20);
    const k0 = est[0], k1 = est[est.length - 1];
    expect(r.hw[k1]).toBeGreaterThan(r.hw[k0] * 1.5);
    expect(r.surf[k1]).toBe(0);
    // water in the estuary is estuary water at sea level, and its clearance is the estuary's
    const k = est[Math.floor(est.length * 0.6)];
    if (!r.sub[k]) {
      const p = w.probe(r.x[k], r.z[k]);
      expect(p.level).toBeCloseTo(0, 5);
      expect(w.watercourseAt(r.x[k], r.z[k])!.clearance).toBe(NAV.estuary.clearance);
    }
  });
});

describe('the procedural terrain', () => {
  const t = new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 });
  const w = new WaterSystem(t);
  it('keeps rivers on the terrain’s river valleys', () => {
    let near = 0, all = 0;
    for (const r of w.reaches()) for (let k = 0; k < r.n; k += 4) {
      if (r.area[k] < 5) continue;
      const f = t.riverField(r.x[k], r.z[k])!;
      all++;
      if ((Math.abs(f.v) * f.lam) / 1.1 < 90) near++;
    }
    expect(all).toBeGreaterThan(100);
    expect(near / all).toBeGreaterThan(0.6);
  });
  it('is deterministic, whichever tile is asked for first, and agrees with point queries', () => {
    const a = new WaterSystem(t).tile(4, 3), w2 = new WaterSystem(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }));
    w2.tile(5, 3); w2.tile(2, 2);
    const b = w2.tile(4, 3);
    expect(b.level).toEqual(a.level);
    expect(b.ground).toEqual(a.ground);
    expect(b.kind).toEqual(a.kind);
    expect(a.wet).toBeGreaterThan(100);
    // raster points match point queries exactly
    const g = a.g;
    let checked = 0;
    for (let k = 0; k < a.level.length; k += 97) {
      const x = g.x0 + (k % g.nx) * g.step, z = g.z0 + Math.floor(k / g.nx) * g.step, p = w.probe(x, z);
      expect(p.ground).toBeCloseTo(a.ground[k], 3);
      if (a.kind[k]) { expect(p.level).toBeCloseTo(a.level[k], 3); checked++; } else expect(p.level).toBeNull();
    }
    expect(checked).toBeGreaterThan(5);
  });
  it('meets its neighbour at a tile edge', () => {
    const a = w.tile(4, 3), b = w.tile(5, 3), ga = a.g, gb = b.g;
    // the column at x = 5000 is in both rasters
    const ia = Math.round((5000 - ga.x0) / ga.step), ib = Math.round((5000 - gb.x0) / gb.step);
    for (let j = 0; j < ga.nz; j++) {
      expect(a.ground[j * ga.nx + ia]).toBe(b.ground[j * gb.nx + ib]);
      expect(a.kind[j * ga.nx + ia]).toBe(b.kind[j * gb.nx + ib]);
    }
  });
  it('has lakes shaped by the ground, not circles', () => {
    // every lake body in a few tiles: how far its shore strays from the best circle
    let lakes = 0;
    for (const [ti, tj] of [[2, 4], [1, 6], [2, 5], [6, 6], [0, 2], [6, 1]]) {
      const tl = w.tile(ti, tj), g = tl.g;
      const byBody = new Map<number, [number, number][]>();
      for (let k = 0; k < tl.kind.length; k++) if (tl.kind[k] === 2) { const b = tl.body[k]; if (!byBody.has(b)) byBody.set(b, []); byBody.get(b)!.push([g.x0 + (k % g.nx) * g.step, g.z0 + Math.floor(k / g.nx) * g.step]); }
      for (const pts of byBody.values()) {
        if (pts.length < 400) continue;
        lakes++;
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        // compare the area to the circle through its farthest point: a circle fills it, these don't
        const rmax = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz)));
        expect((pts.length * g.step * g.step) / (Math.PI * rmax * rmax)).toBeLessThan(0.8);
      }
    }
    expect(lakes).toBeGreaterThan(0);
  });
});
