import { describe, expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { alignRoute, alignSpec } from './align';
import { earthworkPolys, sections } from './earthworks';
import { FlatHeight, FnHeight } from './height';
import { levelPad, rectPoly } from './platform';
import { Land } from '../land';

describe('building platforms', () => {
  it('flat ground: the pad is the ground, nothing to move', () => {
    const p = levelPad(new FlatHeight(12), rectPoly(0, 0, 0, 10, 8), 'house');
    expect(p.ok).toBe(true);
    expect(p.y).toBeCloseTo(12);
    expect(p.cut + p.fill).toBeCloseTo(0);
    expect(p.walls).toEqual([]);
  });

  it('a gentle slope: cut into the high side, fill the low side, roughly in balance', () => {
    const slope = new FnHeight((x) => 0.1 * x); // 10%, rising east
    const p = levelPad(slope, rectPoly(0, 0, 0, 10, 8), 'house');
    expect(p.ok).toBe(true);
    expect(p.slope).toBeCloseTo(0.1, 3);
    expect(p.y).toBeGreaterThan(-0.5);
    expect(p.y).toBeLessThan(0.5);
    expect(p.maxCut).toBeCloseTo(0.5 - p.y, 0);
    expect(p.cut).toBeGreaterThan(0);
    expect(p.fill).toBeGreaterThan(0);
    // fill costs more than cut, so it leans a little towards digging
    expect(p.cut).toBeGreaterThan(p.fill * 0.9);
    expect(p.walls).toEqual([]); // 0.5 m steps are graded, not walled
  });

  it('a steeper slope: retaining walls on the uphill and downhill edges; some buildings refuse', () => {
    const slope = new FnHeight((x) => 0.2 * x); // 20%
    const house = levelPad(slope, rectPoly(0, 0, 0, 12, 8), 'house');
    expect(house.ok).toBe(true);
    const sides = new Set(house.walls.map((w) => w.side));
    expect(sides).toEqual(new Set(['cut', 'fill']));
    const cutWall = house.walls.find((w) => w.side === 'cut')!;
    expect(Math.min(cutWall.a.x, cutWall.b.x)).toBeGreaterThan(0); // on the high (east) side
    expect(cutWall.height).toBeGreaterThan(0.8);
    const shed = levelPad(slope, rectPoly(0, 0, 0, 30, 20), 'industry');
    expect(shed.ok).toBe(false);
    expect(shed.reason).toMatch(/Too steep/);
    // gentle but big: fine by slope, but the wall would be too tall
    const long = levelPad(new FnHeight((x) => 0.05 * x), rectPoly(0, 0, 0, 160, 20), 'industry');
    expect(long.ok).toBe(false);
    expect(long.reason).toMatch(/retaining wall/);
  });

  it('rotated footprints measure the slope the same way', () => {
    const slope = new FnHeight((x, z) => 0.06 * x + 0.08 * z);
    for (const rot of [0, 0.7, 2]) expect(levelPad(slope, rectPoly(5, -3, rot, 14, 9), 'flats').slope).toBeCloseTo(0.1, 3);
  });

  it('keeps floors out of the water', () => {
    const shore = new FnHeight((x) => x * 0.05, (x) => (x < 0 ? 0 : null)); // water to the west at 0 m
    const p = levelPad(shore, rectPoly(10, 0, 0, 10, 10), 'house');
    expect(p.ok).toBe(true);
    const wet = levelPad(shore, rectPoly(-2, 0, 0, 10, 10), 'house');
    expect(wet.ok).toBe(false);
    expect(wet.reason).toMatch(/water/);
  });
});

describe('earthwork footprints', () => {
  it('embankment toes and cutting tops sit where the side slopes meet the ground', () => {
    const sp = alignSpec(ROADS.street);
    const hill = new FnHeight((x) => 30 * Math.exp(-(((x - 600) / 110) ** 2)));
    const route = alignRoute([{ x: 0, z: 0 }, { x: 1200, z: 0 }], hill, sp);
    const secs = sections(route, hill, sp);
    const half = sp.width / 2;
    const deepest = secs.reduce((a, b) => (route.depth[b.i] < route.depth[a.i] ? b : a));
    expect(deepest.kind).toBe('cutting');
    // 1.5:1 slopes up from the road's edge on flat-across ground: out by depth × 1.5
    expect(deepest.left).toBeCloseTo(half - route.depth[deepest.i] * sp.cutSlope, 0);
    expect(deepest.l.y).toBeCloseTo(hill.heightAt(deepest.l.x, deepest.l.z));
    for (const s of secs) if (s.kind === 'grade') expect(s.left).toBe(half);
    const bank = secs.find((s) => s.kind === 'embankment' && route.depth[s.i] > 2)!;
    expect(bank.right).toBeCloseTo(half + route.depth[bank.i] * sp.fillSlope, 0);
    // the claims go into the land registry and cover the slopes
    const land = new Land();
    earthworkPolys(route, secs).forEach((e, k) => land.claim(`earth:${k}`, 'road', e.polys));
    expect(land.at({ x: deepest.l.x - 0.5, z: -(deepest.left - 1) })).toBeDefined();
    expect(land.at({ x: 100, z: 20 })).toBeUndefined();
  });
});
