import { describe, expect, it } from 'vitest';
import { Carry, Hat, Idle, MIXES, Prop, dress, roleOf, type Role } from './wardrobe';
import { hex, rng } from './util';

const many = (role: Role, year: number, n = 300) => Array.from({ length: n }, (_, i) => dress(role, year, rng(i * 7919 + 1)));
const share = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length / xs.length;

describe('who people are and what they wear', () => {
  it('is the same person every time for the same seed', () => {
    expect(dress('shopper', 1975, rng(42))).toEqual(dress('shopper', 1975, rng(42)));
    expect(dress('shopper', 1975, rng(42))).not.toEqual(dress('shopper', 1975, rng(43)));
  });

  it('children are smaller than adults, with the elderly slower', () => {
    const kids = many('pupil', 2025), adults = many('office', 2025), old = many('elderly', 2025);
    expect(Math.max(...kids.map((l) => l.height))).toBeLessThan(1.56);
    expect(Math.min(...adults.map((l) => l.height))).toBeGreaterThan(1.4);
    expect(kids.every((l) => l.child)).toBe(true);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(old.map((l) => l.speed))).toBeLessThan(mean(adults.map((l) => l.speed)) - 0.3);
    expect(old.every((l) => l.carry & Carry.Elderly)).toBe(true);
  });

  it('dresses industry by era: flat caps, then hard hats, then high-visibility', () => {
    const e1905 = many('worker', 1905), e1975 = many('worker', 1975), e2025 = many('worker', 2025);
    expect(e1905.some((l) => l.hat === Hat.HardHat || l.carry & Carry.HiVis)).toBe(false);
    expect(e1905.every((l) => l.hat === Hat.FlatCap)).toBe(true);
    expect(e1975.every((l) => l.hat === Hat.HardHat)).toBe(true);
    expect(e1975.some((l) => l.carry & Carry.HiVis)).toBe(false);
    expect(e2025.every((l) => l.hat === Hat.HardHat && l.carry & Carry.HiVis)).toBe(true);
  });

  it('long skirts and hats in 1905, few hats and phones in 2025', () => {
    const a = many('public', 1905), b = many('public', 2025);
    expect(share(a, (l) => l.hat !== Hat.None)).toBeGreaterThan(0.7);
    expect(share(b, (l) => l.hat !== Hat.None)).toBeLessThan(0.2);
    expect(share(a, (l) => (l.carry & Carry.SkirtLong) !== 0)).toBeGreaterThan(0.3);
    expect(a.some((l) => l.idle === Idle.Phone)).toBe(false);
    expect(b.some((l) => l.idle === Idle.Phone)).toBe(true);
  });

  it('uniforms: the made-up constabulary, bus crews, nurses, school colours', () => {
    const police = many('police', 1965, 50);
    expect(police.every((l) => l.top === hex('#1b2233') && l.trim === hex('#1fa3a0'))).toBe(true);
    expect(many('driver', 1960, 20).every((l) => l.hat === Hat.Peaked)).toBe(true);
    expect(many('nurse', 1950, 20).every((l) => l.hat === Hat.NurseCap)).toBe(true);
    const s0 = many('pupil', 2000, 20).map((l) => l.top), s1 = Array.from({ length: 20 }, (_, i) => dress('pupil', 2000, rng(i), { school: 1 }).top);
    expect(new Set(s0).size).toBe(1);
    expect(s0[0]).not.toBe(s1[0]);
  });

  it('riders get their bike, pushchair or wheelchair', () => {
    expect(many('cyclist', 2025, 20).every((l) => l.prop === Prop.Bike && l.speed >= 4)).toBe(true);
    expect(many('parent', 2025, 20).every((l) => l.prop === Prop.Pushchair)).toBe(true);
    expect(many('wheelchair', 2025, 20).every((l) => l.prop === Prop.Wheelchair && l.idle === Idle.Sit)).toBe(true);
  });

  it('no joggers before the jogging boom', () => {
    const r = rng(1);
    for (let i = 0; i < 400; i++) expect(roleOf(r, MIXES.park, 1950)).not.toBe('jogger');
  });
});
