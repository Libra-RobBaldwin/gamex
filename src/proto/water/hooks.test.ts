import { describe, expect, it } from 'vitest';
import { FnHeight } from '../terrain';
import { canalReach, findQuays, navGrid, navLimits, pierBans, planCanal, shipRoute } from './hooks';
import { NAV, type WaterParams } from './types';
import { WaterSystem } from './water';

const SMALL: Partial<WaterParams> = { region: 2000, margin: 400, cell: 16 };

describe('canals', () => {
  // ground rising 1 in 100 to the east, with a hump in the middle
  const src = new FnHeight((x, z) => 0.01 * x + 4 * Math.exp(-(((x - 1000) / 120) ** 2)) + 0.002 * z);
  const path = [{ x: 100, z: 500 }, { x: 1000, z: 520 }, { x: 1900, z: 500 }];
  const c = planCanal(src, path, { maxRise: 3.5 });
  it('steps up the hill in pounds joined by locks, never standing above the ground', () => {
    expect(c.ok).toBe(true);
    expect(c.locks.length).toBeGreaterThanOrEqual(Math.ceil((c.ground[c.ground.length - 1] - c.ground[0]) / 3.5));
    for (const l of c.locks) { expect(l.rise).toBeLessThanOrEqual(3.5 + 1e-6); expect(l.upper - l.lower).toBeCloseTo(l.rise, 6); }
    c.level.forEach((lv, i) => expect(lv).toBeLessThanOrEqual(c.ground[i] - 0.4 + 1e-6));
    // pounds are level and tile the canal end to end
    expect(c.pounds[0].s0).toBe(0);
    expect(c.pounds[c.pounds.length - 1].s1).toBeCloseTo(c.s[c.s.length - 1], 6);
    for (let k = 1; k < c.pounds.length; k++) expect(c.pounds[k].s0).toBeCloseTo(c.pounds[k - 1].s1, 6);
  });
  it('joins the water system as still water with canal navigation rules', () => {
    const w = new WaterSystem(src, SMALL);
    w.addReaches([canalReach(c, src)]);
    const k = Math.floor(c.path.length * 0.3), p = c.path[k];
    expect(w.kindAt(p.x, p.z)).toBe('canal');
    expect(w.waterLevelAt(p.x, p.z)).toBeCloseTo(c.level[k], 1);
    expect(w.depthAt(p.x, p.z)).toBeGreaterThan(1.5);
    expect(w.flowAt(p.x, p.z).speed).toBe(0);
    const wc = w.watercourseAt(p.x, p.z)!;
    expect(wc.cls).toBe('canal');
    expect(wc.clearance).toBe(NAV.canal.clearance);
    expect(wc.draught).toBe(NAV.canal.draught);
    expect(w.isWater(p.x, p.z + 30)).toBe(false);
  });
});

describe('quays and routes', () => {
  // the sea to the west: a deep harbour wall along x = 800 north of z = 1100, a gently shelving beach south of it
  const coast = new FnHeight((x, z) => (z < 1100 ? (x < 800 ? -8 : 1 + 0.01 * (x - 800)) : (x - 800) / 60));
  const w = new WaterSystem(coast, { ...SMALL, sea: 0 });
  it('finds quays where deep water meets level land, not on a beach', () => {
    const qs = findQuays(w, [700, 400, 900, 1600]);
    expect(qs.length).toBeGreaterThan(0);
    const q = qs[0];
    expect(q.depth).toBeGreaterThanOrEqual(4);
    expect(q.length).toBeGreaterThan(200);
    expect(q.facing[0]).toBeLessThan(-0.9); // it faces west, out to sea
    for (const p of [q.a, q.b]) expect(p.z).toBeLessThan(1110);
    expect(qs.every((r) => r.a.z < 1110 && r.b.z < 1110)).toBe(true);
  });
  it('routes a ship around an island over water deep enough', () => {
    const sea = new FnHeight((x, z) => (Math.hypot(x - 1000, z - 1000) < 150 ? 5 : -10));
    const ws = new WaterSystem(sea, { ...SMALL, sea: 0 });
    const nav = navGrid(ws, [500, 500, 1500, 1500], { cell: 10, draught: 4 });
    const r = shipRoute(nav, { x: 600, z: 1000 }, { x: 1400, z: 1000 });
    expect(r.ok).toBe(true);
    expect(r.length).toBeGreaterThan(800);
    expect(r.length).toBeLessThan(800 * 1.35);
    for (let k = 1; k < r.path.length; k++) {
      const a = r.path[k - 1], b = r.path[k];
      for (let t = 0; t <= 1; t += 0.05) expect(ws.depthAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)).toBeGreaterThanOrEqual(4);
    }
    // onto land it refuses
    expect(shipRoute(nav, { x: 600, z: 1000 }, { x: 1000, z: 1000 }).ok).toBe(false);
  });
});

describe('bridges', () => {
  it('turns crossings into height windows for the solver and keeps piers out of the channel', () => {
    // a navigable river: a wide deep channel cut into a plain, as a source's own water
    const src = new FnHeight((x) => (Math.abs(x - 1000) < 30 ? 2 : 10), (x) => (Math.abs(x - 1000) < 30 ? 7 : null));
    const w = new WaterSystem(src, SMALL);
    const cs = w.crossings({ x: 900, z: 1000 }, { x: 1100, z: 1000 });
    expect(cs.length).toBe(1);
    const c = cs[0];
    expect(c.s0).toBeCloseTo(71, -1); expect(c.s1).toBeCloseTo(129, -1);
    expect(c.kind).toBe('lake');
    const lim = navLimits(cs, 1.5);
    expect(lim[0].lo).toBeCloseTo(c.design + 0.6 + 1.5, 6);
    // a lake crossing deep enough gets a channel in the middle
    expect(c.channel).not.toBeNull();
    const ban = pierBans(cs)[0];
    expect(ban[0]).toBeGreaterThanOrEqual(c.s0); expect(ban[1]).toBeLessThanOrEqual(c.s1);
    expect(lim[1].lo).toBeCloseTo(c.soffit + 1.5, 6);
    expect(lim[1].lo!).toBeGreaterThan(lim[0].lo!);
  });
});
