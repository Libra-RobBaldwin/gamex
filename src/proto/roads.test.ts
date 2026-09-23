import { describe, expect, it } from 'vitest';
import { MIN_RADIUS, Network, minRadius, pathLength, polysOverlap, rectCorners } from './roads';

describe('free-form roads', () => {
  it('snaps angles to 15° and lengths to 4 m', () => {
    const n = new Network();
    const e = n.snapEnd({ x: 0, z: 0 }, { x: 50, z: 13 }, 6);
    const ang = (Math.atan2(e.z, e.x) * 180) / Math.PI;
    expect(Math.round(ang) % 15).toBe(0);
    expect(Math.round(Math.hypot(e.x, e.z)) % 4).toBe(0);
  });

  it('joins onto existing nodes and splits roads to make junctions', () => {
    const n = new Network();
    n.build({ x: -50, z: 0 }, { x: 50, z: 0 });
    expect(n.segs.size).toBe(1);
    // a road starting on the middle of the first one creates a T junction
    const s = n.snapStart({ x: 1, z: 2 }, 6);
    expect(s.seg).toBeDefined();
    n.build(s, { x: 0, z: 60 });
    expect(n.segs.size).toBe(3);
    const junction = n.nearestNode({ x: 1, z: 0 }, 3)!;
    expect(n.segsAt(junction.id).length).toBe(3);
  });

  it('crossing roads become crossroads', () => {
    const n = new Network();
    n.build({ x: -50, z: 0 }, { x: 50, z: 0 });
    n.build({ x: 0, z: -50 }, { x: 0, z: 50 });
    expect(n.segs.size).toBe(4);
    const c = n.nearestNode({ x: 0, z: 0 }, 1)!;
    expect(n.segsAt(c.id).length).toBe(4);
  });

  it('lays plots along diagonal roads facing the street, without overlaps', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 140, z: 80 });
    const lots = n.plotsFor(id, { x: 999, z: 999 });
    expect(lots.length).toBeGreaterThan(6);
    const rot = Math.atan2(80, 140);
    for (const l of lots) expect(Math.abs(Math.sin(l.rot - rot))).toBeLessThan(1e-9);
    for (let i = 0; i < lots.length; i++)
      for (let j = i + 1; j < lots.length; j++)
        expect(polysOverlap(rectCorners(lots[i].x, lots[i].z, lots[i].rot, lots[i].w, lots[i].d), rectCorners(lots[j].x, lots[j].z, lots[j].rot, lots[j].w, lots[j].d))).toBe(false);
  });

  it('clears buildings in the way (at a cost) but refuses water', () => {
    const n = new Network((p) => p.x > 100 && p.x < 140);
    const [id] = n.build({ x: 0, z: 0 }, { x: 90, z: 0 });
    n.lots.push(...n.plotsFor(id, { x: 999, z: 999 }));
    const l = n.lots[0];
    const c = n.check({ x: l.x, z: l.z - 40 }, { x: l.x, z: l.z + 40 });
    expect(c.ok).toBe(true);
    expect(c.clears.map((x) => x.id)).toContain(l.id);
    const before = n.lots.length;
    n.build({ x: l.x, z: l.z - 40 }, { x: l.x, z: l.z + 40 });
    expect(n.lots.length).toBeLessThan(before);
    expect(n.check({ x: 90, z: 20 }, { x: 160, z: 20 }).reason).toMatch(/water/i);
  });

  it('builds curved roads through a control point', () => {
    const n = new Network();
    const c = n.check({ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 50, z: 60 });
    expect(c.ok).toBe(true);
    expect(c.length).toBeGreaterThan(100);
    const [id] = n.build({ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 50, z: 60 });
    const s = n.segs.get(id)!;
    expect(s.mid.length).toBeGreaterThan(3);
    // the curve bulges towards the control point, half way there at its middle
    const mid = s.mid[Math.floor(s.mid.length / 2)];
    expect(mid.z).toBeGreaterThan(25);
    expect(minRadius(n.path(s))).toBeGreaterThan(MIN_RADIUS);
  });

  it('refuses curves that are too tight', () => {
    const n = new Network();
    expect(n.check({ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 6, z: 40 }).reason).toMatch(/tight/);
  });

  it('a straight road across a curve splits it into a junction (twice if it crosses twice)', () => {
    const n = new Network();
    n.build({ x: 0, z: 0 }, { x: 120, z: 0 }, { x: 60, z: 100 });
    n.build({ x: -10, z: 30 }, { x: 130, z: 30 });
    // curve cut in 3, straight cut in 3
    expect(n.segs.size).toBe(6);
    const junctions = [...n.nodes.values()].filter((x) => n.segsAt(x.id).length === 4);
    expect(junctions.length).toBe(2);
    // the pieces still add up to the whole curve
    const curveLen = [...n.segs.values()].filter((s) => s.mid.length).reduce((t, s) => t + n.length(s), 0);
    expect(curveLen).toBeGreaterThan(150);
  });

  it('a smooth curve leaves along the road it continues', () => {
    const n = new Network();
    n.build({ x: -60, z: 0 }, { x: 0, z: 0 });
    const a = n.snapStart({ x: 0, z: 0 }, 3);
    const ctrl = n.smoothCtrl(a, { x: 60, z: 40 })!;
    // control point lies straight ahead of the existing road
    expect(Math.abs(ctrl.z)).toBeLessThan(1e-9);
    expect(ctrl.x).toBeGreaterThan(0);
    expect(n.check(a, { x: 60, z: 40 }, ctrl).ok).toBe(true);
  });

  it('lays plots along curves without overlaps, facing the road', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 100, z: 120 });
    const lots = n.plotsFor(id, { x: 999, z: 999 });
    expect(lots.length).toBeGreaterThan(8);
    const path = n.path(n.segs.get(id)!);
    expect(pathLength(path)).toBeGreaterThan(200);
    for (let i = 0; i < lots.length; i++)
      for (let j = i + 1; j < lots.length; j++)
        expect(polysOverlap(rectCorners(lots[i].x, lots[i].z, lots[i].rot, lots[i].w, lots[i].d), rectCorners(lots[j].x, lots[j].z, lots[j].rot, lots[j].w, lots[j].d))).toBe(false);
  });

  it('every building gets a plot: plots touch but never overlap, and stay off the roads', () => {
    const n = new Network();
    const ids = [...n.build({ x: -150, z: 0 }, { x: 150, z: 0 }), ...n.build({ x: 0, z: -150 }, { x: 0, z: 150 })];
    for (const id of ids) for (const l of n.plotsFor(id, { x: 999, z: 999 })) if (n.lotFree(l)) { n.fitParcel(l); n.lots.push(l); }
    expect(n.lots.length).toBeGreaterThan(20);
    const shrink = (l: (typeof n.lots)[0]) => n.parcelRect(l, -0.35);
    for (let i = 0; i < n.lots.length; i++) {
      const a = n.lots[i];
      expect(a.back).toBeGreaterThan(0);
      for (let j = i + 1; j < n.lots.length; j++) expect(polysOverlap(shrink(a), shrink(n.lots[j]))).toBe(false);
      // the plot behind the building never reaches a road
      const rear = n.parcelRect({ ...a, front: 0 }, -0.35);
      for (const s of n.segs.values()) {
        const p = n.path(s);
        expect(polysOverlap(rear, rectCorners((p[0].x + p[1].x) / 2, (p[0].z + p[1].z) / 2, Math.atan2(p[1].z - p[0].z, p[1].x - p[0].x), n.length(s), 12.4))).toBe(false);
      }
    }
  });

  it('industrial zones get works with yards; a road through a garden trims it', () => {
    const n = new Network();
    n.zoneAt = (p) => (p.z < -100 ? 'industrial' : 'town');
    const [id] = n.build({ x: -150, z: -200 }, { x: 150, z: -200 });
    const lots = n.plotsFor(id, { x: 999, z: 999 });
    expect(lots.length).toBeGreaterThan(2);
    expect(lots.every((l) => l.kind === 'industry' && l.w >= 26 && l.front >= 14)).toBe(true);
    const m = new Network();
    const [h] = m.build({ x: -100, z: 0 }, { x: 100, z: 0 });
    const l = m.plotsFor(h, { x: 999, z: 999 }).find((x) => m.lotFree(x))!;
    m.fitParcel(l); m.lots.push(l);
    const deep = l.back;
    // a new road running just behind the house
    const c = m.parcelCentre(l), back = { x: c.x - Math.sin(l.rot) * -(l.d / 2 + deep), z: c.z + Math.cos(l.rot) * -(l.d / 2 + deep) };
    m.build({ x: back.x - Math.cos(l.rot) * 60, z: back.z - Math.sin(l.rot) * 60 }, { x: back.x + Math.cos(l.rot) * 60, z: back.z + Math.sin(l.rot) * 60 });
    expect(m.touched).toContain(l);
    expect(l.back).toBeLessThan(deep);
  });
});
