import { describe, expect, it } from 'vitest';
import { GameWater, LAKE, LEVEL, lakeGround, lakeRadius } from './water';
import { Land } from '../land';

describe('game water', () => {
  const t0 = performance.now();
  const gw = new GameWater(676);
  const ms = performance.now() - t0;
  it('builds quickly, with one tile of water', () => {
    expect(ms).toBeLessThan(1500); // (about 100 ms on a quiet machine; generous for a busy one)
    expect(gw.tiles.length).toBe(1);
    expect(gw.group.children.length).toBeLessThanOrEqual(3);
  });
  it('the lake is where the bowl is, at its level', () => {
    expect(gw.water.isWater(LAKE.x, LAKE.z)).toBe(true);
    expect(gw.water.waterLevelAt(LAKE.x, LAKE.z)).toBeCloseTo(LEVEL, 3);
    expect(gw.water.kindAt(LAKE.x, LAKE.z)).toBe('lake');
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      const r = lakeRadius(a);
      expect(gw.water.isWater(LAKE.x + Math.cos(a) * r * 0.95, LAKE.z + Math.sin(a) * r * 0.95)).toBe(true);
      expect(gw.water.isWater(LAKE.x + Math.cos(a) * r * 1.05, LAKE.z + Math.sin(a) * r * 1.05)).toBe(false);
    }
    // nothing else on the map is wet (no streams across the flat)
    let wet = 0;
    for (let x = -670; x <= 670; x += 10) for (let z = -670; z <= 670; z += 10) if (Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r * 1.3 && gw.water.isWater(x, z)) wet++;
    expect(wet).toBe(0);
    expect(lakeGround(0, 0)).toBe(0);
  });
  it('isWater keeps roads 4 m off the waterline', () => {
    const a = 1, r = lakeRadius(a);
    expect(gw.isWater({ x: LAKE.x + Math.cos(a) * (r + 1), z: LAKE.z + Math.sin(a) * (r + 1) })).toBe(true);
    expect(gw.isWater({ x: LAKE.x + Math.cos(a) * (r + 6), z: LAKE.z + Math.sin(a) * (r + 6) })).toBe(false);
  });
  it('knows the shore smoothly, not in the 4 m raster\'s stair-steps (the waterline, foam line and beach)', () => {
    let worst = 0, jump = 0;
    const last = new Map<number, number>();
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      // the waterline along this ray: where the bed is the water system's 8 cm film under the level
      let lo = 0, hi = LAKE.r * 1.2;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (lakeGround(LAKE.x + Math.cos(a) * m, LAKE.z + Math.sin(a) * m) < LEVEL - 0.08) lo = m; else hi = m; }
      for (const off of [-3, -1, 1, 3, 6]) {
        const r = lo + off, d = gw.water.distanceToShore(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r);
        worst = Math.max(worst, Math.abs(d + off));
        // (neighbouring rays are about 4.5 m apart along the shore)
        if (last.has(off)) jump = Math.max(jump, Math.abs(d - last.get(off)!));
        last.set(off, d);
      }
    }
    expect(worst).toBeLessThan(1.5);
    expect(jump).toBeLessThan(0.6);
  });
  it('claims the lake in the land registry as water', () => {
    const land = new Land();
    gw.claim(land);
    expect(land.at({ x: LAKE.x, z: LAKE.z })?.owner).toBe('water');
    expect(land.at({ x: 0, z: 0 })).toBeUndefined();
  });
  it('gives crossings, nav limits and pier bans for a bridge over the lake', () => {
    const cs = gw.crossings([{ x: 0, z: -150 }, { x: 510, z: -200 }]);
    expect(cs.length).toBe(1);
    expect(cs[0].kind).toBe('lake');
    expect(gw.navLimits(cs).length).toBeGreaterThan(0);
    expect(gw.pierBans(cs).length).toBe(1);
  });
  it('the ground mesh dips into the bowl, with beach colours only by the lake', () => {
    const g = gw.groundGeometry(1352), pos = g.getAttribute('position'), col = g.getAttribute('color');
    expect(pos.count).toBeLessThan(40000);
    expect(col.itemSize).toBe(4);
    let lo = 0, far = 0;
    for (let v = 0; v < pos.count; v++) {
      // (in the plane's frame: x, −z, height)
      lo = Math.min(lo, pos.getZ(v));
      if (Math.hypot(pos.getX(v) - LAKE.x, -pos.getY(v) - LAKE.z) > LAKE.r * 1.5) far = Math.max(far, Math.abs(pos.getZ(v)) + col.getW(v));
    }
    expect(lo).toBeLessThan(-3.5);
    expect(far).toBe(0);
  });
});
