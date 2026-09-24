import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, type P } from '../roads';
import { Industries, convexOverlap, nightAt, standInFeed, townWishes, type ServePoint } from './industry';
import { INDUSTRY_TYPES } from '../industries';

// a small estate: a spine road with a cross street, zoned like the game's
const ESTATE = (p: P) => p.z < -215 && Math.abs(p.x) < 280;
function estate() {
  const net = new Network(() => false, 520, 11);
  const road = (a: P, b: P) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), undefined, DEFAULT_OPTS);
  road({ x: 0, z: -200 }, { x: 0, z: -470 });
  road({ x: -250, z: -330 }, { x: 250, z: -330 });
  road({ x: -500, z: 0 }, { x: 500, z: 0 });
  const I = new Industries(net, new THREE.Group(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  I.placeAll(townWishes(ESTATE, (p) => !ESTATE(p) && Math.hypot(p.x, p.z) > 300));
  return { net, I, road };
}

describe('industrial sites in the game', () => {
  it('fits several sites on the estate, clear of the roads and of each other', () => {
    const { net, I } = estate();
    expect(I.sites.length).toBeGreaterThanOrEqual(5);
    for (const s of I.sites) {
      expect(net.land.get(s.key)?.owner).toBe('industry');
      expect(net.land.hits(s.poly, (c) => c.key === s.key)).toEqual([]);
      const t = INDUSTRY_TYPES[s.type];
      expect(s.model.frame.w).toBeGreaterThanOrEqual(t.minSize.w - 1);
      for (const o of I.sites) if (o !== s) expect(convexOverlap(s.poly, o.poly)).toBe(false);
    }
  });

  it('bakes each site as geometry that merges with buildgen\'s (position, normal, colour, uv)', () => {
    const { I } = estate();
    for (const s of I.sites) for (const p of s.parts) expect(Object.keys(p.g.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
  });

  it('gives up a site that a new road runs through, with its land, moving parts and chunk', () => {
    const { net, I, road } = estate();
    const s = I.sites.find((x) => ESTATE(x.lot))!;
    const removed: string[] = [];
    I.onRemove = (x) => removed.push(x.key);
    const before = I.fx.stats().sites;
    const c = { x: s.model.frame.cx, z: s.model.frame.cz };
    road({ x: c.x - 150, z: c.z + 1 }, { x: c.x + 150, z: c.z - 1 });
    I.evict();
    expect(removed).toContain(s.key);
    expect(I.sites).not.toContain(s);
    expect(net.land.get(s.key)).toBeUndefined();
    expect(I.fx.stats().sites).toBeLessThan(before);
  });

  it('stand-in feed: stops in the catchment raise production, up to 4', () => {
    const { I } = estate();
    const s = I.sites[0], f = s.model.frame;
    const at = (n: number): ServePoint[] => Array.from({ length: n }, (_, i) => ({ x: f.cx + i, z: f.cz, kind: 'lorry', radius: 30, label: `stop ${i}` }));
    for (const [n, want] of [[0, 1], [1, 2], [2, 3], [5, 4]] as const) {
      I.stops = () => at(n);
      I.refresh();
      expect(s.servedBy.length).toBe(n);
      expect(s.state.production).toBe(want);
      expect(s.state.recentlyDelivered).toBe(n > 0);
    }
    // a stop far away serves nothing
    I.stops = () => [{ x: f.cx + 2000, z: f.cz, kind: 'lorry', radius: 30, label: 'far' }];
    I.refresh();
    expect(s.servedBy).toEqual([]);
    expect(standInFeed.visual(s, { year: 2025, hour: 12, stops: [] }).production).toBe(1);
  });

  it('knows day from night', () => {
    expect(nightAt(12)).toBe(0);
    expect(nightAt(23)).toBe(1);
    expect(nightAt(3)).toBe(1);
    expect(nightAt(19.25)).toBeCloseTo(0.5);
    expect(nightAt(6.25)).toBeCloseTo(0.5);
  });

  it('finds the site under a point', () => {
    const { I } = estate();
    const s = I.sites[0];
    expect(I.at({ x: s.model.frame.cx, z: s.model.frame.cz })).toBe(s);
    expect(I.at({ x: 0, z: 0 })).toBeNull();
  });

  it('treats polygons sharing an edge line as touching', () => {
    const sq = (x: number) => [{ x, z: 0 }, { x: x + 10, z: 0 }, { x: x + 10, z: 10 }, { x, z: 10 }];
    expect(convexOverlap(sq(0), sq(10))).toBe(true);
    expect(convexOverlap(sq(0), sq(10.5))).toBe(false);
  });
});
