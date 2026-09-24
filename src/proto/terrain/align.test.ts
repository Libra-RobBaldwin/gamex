import { describe, expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { GRADES } from '../grade';
import { align, alignRoute, alignSpec, type Alignment } from './align';
import { FlatHeight, FnHeight } from './height';

const road = alignSpec(ROADS.street), main = alignSpec(ROADS['rail-main']), rack = alignSpec(ROADS['rail-rack']);
const profile = (L: number, n: number, f: (s: number) => number) => Array.from({ length: n }, (_, i) => f((L * i) / (n - 1)));
const kinds = (a: Alignment) => new Set(a.spans.map((s) => s.kind));
const gradeOk = (a: Alignment, G: number) => expect(a.maxGrade).toBeLessThanOrEqual(G + 1e-6);

describe('vertical alignment on terrain', () => {
  it('flat ground: at grade all the way, for nothing', () => {
    const a = alignRoute([{ x: 0, z: 0 }, { x: 600, z: 0 }], new FlatHeight(20), road);
    expect(a.ok).toBe(true);
    expect(a.spans.map((s) => s.kind)).toEqual(['grade']);
    expect(Math.max(...a.y.map((y) => Math.abs(y - 20)))).toBeLessThan(1e-6);
    expect(a.cost.total).toBeCloseTo(0);
    expect(a.path[a.path.length - 1]).toMatchObject({ x: 600, z: 0, y: 20 });
  });

  it('gentle ground within the gradient: the road simply follows it', () => {
    const a = align({ length: 800, ground: profile(800, 161, (s) => 10 + 8 * Math.sin(s / 120)) }, road);
    expect(a.ok).toBe(true);
    expect(Math.max(...a.depth.map(Math.abs))).toBeLessThan(0.3);
  });

  it('a hill steeper than the limit: a cutting through its brow, or a tunnel for a railway', () => {
    const hill = profile(1200, 241, (s) => 30 * Math.exp(-(((s - 600) / 110) ** 2))); // up to ~16% slopes
    const r = align({ length: 1200, ground: hill }, road);
    expect(r.ok).toBe(true);
    gradeOk(r, road.maxGrade);
    expect(kinds(r).has('cutting') || kinds(r).has('tunnel')).toBe(true);
    expect(r.y[0]).toBeCloseTo(0, 6);
    expect(r.y[r.y.length - 1]).toBeCloseTo(0, 6);
    const t = align({ length: 1200, ground: hill }, main);
    expect(t.ok).toBe(true);
    gradeOk(t, main.maxGrade);
    expect(kinds(t).has('tunnel')).toBe(true);
    const tun = t.spans.find((s) => s.kind === 'tunnel')!;
    expect(tun.s0).toBeLessThan(600);
    expect(tun.s1).toBeGreaterThan(600);
    for (let i = tun.i0; i <= tun.i1; i++) expect(t.depth[i]).toBeLessThanOrEqual(-main.cover + 1e-6);
    expect(t.cost.total).toBeGreaterThan(r.cost.total); // the gentler railway costs more to get through
  });

  it('a valley: an embankment where shallow, a viaduct where deep', () => {
    const shallow = align({ length: 1000, ground: profile(1000, 201, (s) => 20 - 6 * Math.exp(-(((s - 500) / 30) ** 2))) }, road);
    expect(shallow.ok).toBe(true);
    expect(kinds(shallow).has('embankment')).toBe(true);
    expect(kinds(shallow).has('bridge')).toBe(false);
    const deep = align({ length: 1000, ground: profile(1000, 201, (s) => 40 - 35 * Math.exp(-(((s - 500) / 80) ** 2))) }, road);
    expect(deep.ok).toBe(true);
    gradeOk(deep, road.maxGrade);
    expect(kinds(deep).has('bridge')).toBe(true);
    const b = deep.spans.find((s) => s.kind === 'bridge')!;
    expect(b.max).toBeGreaterThan(road.maxFill * 0.5);
    // bridges and banks never go below the ground, and no bank is taller than allowed
    for (let i = 0; i < deep.y.length; i++) if (deep.structure[i] === 'bridge') expect(deep.depth[i]).toBeGreaterThanOrEqual(-1e-6);
    for (let i = 0; i < deep.y.length; i++) if (deep.structure[i] === 'earth') expect(deep.depth[i]).toBeLessThanOrEqual(road.maxFill + 1e-6);
  });

  it('railways need far more earthworks than roads over the same hills; a rack railway follows them', () => {
    const hills = profile(2000, 401, (s) => 25 + 12 * Math.sin(s / 90) + 6 * Math.sin(s / 37)); // slopes to ~30%
    const r = align({ length: 2000, ground: hills }, road), m = align({ length: 2000, ground: hills }, main), k = align({ length: 2000, ground: hills }, rack);
    for (const [a, sp] of [[r, road], [m, main], [k, rack]] as const) { expect(a.ok).toBe(true); gradeOk(a, sp.maxGrade); }
    const worst = (a: Alignment) => Math.max(...a.depth.map(Math.abs));
    expect(worst(m)).toBeGreaterThan(worst(r));
    expect(worst(r)).toBeGreaterThan(worst(k));
    expect(m.cost.total).toBeGreaterThan(r.cost.total);
    expect(r.cost.total).toBeGreaterThan(k.cost.total);
    // gentle ground (up to ~13%): the rack railway stays within a metre of it throughout
    const gentle = profile(1500, 301, (s) => 30 + 10 * Math.sin(s / 80));
    const g = align({ length: 1500, ground: gentle }, rack);
    expect(worst(g)).toBeLessThan(1);
    expect(worst(align({ length: 1500, ground: gentle }, main))).toBeGreaterThan(5);
  });

  it('keeps the clearance windows grade.ts produces: over a road it crosses, under one above it', () => {
    const flat = profile(600, 121, () => 10);
    const over = align({ length: 600, ground: flat, limits: [{ s0: 290, s1: 310, lo: 10 + GRADES.road.clear, why: 'the road' }] }, road);
    expect(over.ok).toBe(true);
    for (let i = 0; i < over.s.length; i++) if (over.s[i] >= 290 && over.s[i] <= 310) expect(over.y[i]).toBeGreaterThanOrEqual(10 + GRADES.road.clear - 1e-6);
    gradeOk(over, road.maxGrade);
    const under = align({ length: 600, ground: flat, limits: [{ s0: 290, s1: 310, hi: 10 - GRADES.road.clear, why: 'the road' }] }, road);
    expect(under.ok).toBe(true);
    for (let i = 0; i < under.s.length; i++) if (under.s[i] >= 290 && under.s[i] <= 310) expect(under.y[i]).toBeLessThanOrEqual(10 - GRADES.road.clear + 1e-6);
    // a junction is met exactly
    const j = align({ length: 600, ground: profile(600, 121, (s) => s * 0.02), limits: [{ s0: 200, s1: 200, lo: 7, hi: 7, why: 'the junction' }] }, road);
    expect(j.ok).toBe(true);
    expect(j.y[40]).toBeCloseTo(7, 6);
    gradeOk(j, road.maxGrade);
    // and one that can't be reached says why
    const no = align({ length: 100, ground: profile(100, 21, () => 0), limits: [{ s0: 40, s1: 60, lo: 30, why: 'the flyover' }] }, road);
    expect(no.ok).toBe(false);
    expect(no.reason).toMatch(/the flyover/);
  });

  it('fixed end heights: starts up on a bridge deck and comes down to the ground', () => {
    const a = align({ length: 400, ground: profile(400, 81, () => 5), y0: 13 }, road);
    expect(a.ok).toBe(true);
    expect(a.y[0]).toBeCloseTo(13, 6);
    expect(a.y[a.y.length - 1]).toBeCloseTo(5, 6);
    gradeOk(a, road.maxGrade);
    // a free end just stays on the ground
    const free = align({ length: 400, ground: profile(400, 81, (s) => s * 0.15), yL: null }, road);
    expect(free.ok).toBe(true);
    expect(free.depth[free.depth.length - 1]).toBeLessThan(0); // it couldn't keep up with a 15% slope
  });

  it('water: bridged with room for boats, or tunnelled under when bridges are not wanted', () => {
    const L = 1000, n = 201, ground = profile(L, n, (s) => (s > 400 && s < 600 ? -4 : 3)), water = profile(L, n, (s) => (s > 400 && s < 600 ? 0 : NaN));
    const b = align({ length: L, ground, water }, road);
    expect(b.ok).toBe(true);
    for (let i = 0; i < n; i++) if (b.s[i] > 400 && b.s[i] < 600) { expect(b.structure[i]).toBe('bridge'); expect(b.y[i]).toBeGreaterThanOrEqual(road.water - 1e-6); }
    const t = align({ length: L, ground, water }, { ...road, bridges: false });
    expect(t.ok).toBe(true);
    for (let i = 0; i < n; i++) if (b.s[i] > 400 && b.s[i] < 600) { expect(t.structure[i]).toBe('tunnel'); expect(t.y[i]).toBeLessThanOrEqual(-road.under + 1e-6); }
    expect(align({ length: L, ground, water }, { ...road, bridges: false, tunnels: false }).ok).toBe(false);
    // ending in the lake is refused with a reason, unless a height is given (a pier's deck)
    const short = { length: 500, ground: ground.slice(0, 101), water: water.slice(0, 101) };
    expect(align(short, road).reason).toBe('The end is in the water');
    expect(align({ ...short, yL: 7 }, road).ok).toBe(true);
  });

  it('costs add up and spans tile the route', () => {
    const a = alignRoute([{ x: 0, z: 0 }, { x: 500, z: 300 }, { x: 900, z: 300 }], new FnHeight((x, z) => 15 * Math.sin(x / 70) + z * 0.05), road);
    expect(a.ok).toBe(true);
    expect(a.cost.total).toBeCloseTo(a.cost.earth + a.cost.bridge + a.cost.tunnel + a.cost.ends, 6);
    expect(a.spans[0].s0).toBe(0);
    expect(a.spans[a.spans.length - 1].s1).toBeCloseTo(a.s[a.s.length - 1], 6);
    for (let q = 1; q < a.spans.length; q++) expect(a.spans[q].s0).toBeCloseTo(a.spans[q - 1].s1, 9);
    expect(a.volume.cut + a.volume.fill).toBeGreaterThan(0);
  });
});
