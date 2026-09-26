// The region's farmland (fields.ts, woods.ts): fields of believable sizes, four-sided and square
// cornered, in blocks that follow the lanes; about an eighth woodland, most on the slopes and by
// the water; farms beside the roads.
import { describe, expect, it } from 'vitest';
import { area, centroidOf, Countryside, layFields, type FieldsInput } from './fields';
import { budget, cpuMs } from '../test/speed';
import { makeRelief } from './terrain';
import { generateRegion, reach } from './generate';
import { MapWater } from './water';

const box = { x0: -3000, z0: -3000, x1: 3000, z1: 3000 };
function input(seed = 7, relief: 'flat' | 'rolling' | 'upland' = 'rolling'): FieldsInput {
  const g = generateRegion({ seed, relief });
  const mw = new MapWater(g.water), rel = makeRelief({ relief, seed, water: g.water, settlements: g.settlements }, 3000);
  // (the lanes: the straight links between places, as a stand-in for the roads the game builds)
  const lanes = g.links.map((l) => { const a = g.settlements[l.a], b = g.settlements[l.b]; return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }]; });
  return {
    seed, box, lanes, farmLanes: lanes,
    settlements: g.settlements.map((s) => ({ x: s.x, z: s.z, r: s.r, kind: s.kind, reach: reach(s.kind, s.r) })),
    rivers: g.water.rivers.map((r) => r.path),
    waterDist: (x, z) => mw.edgeDistance({ x, z }, 400),
    heightAt: rel?.heightAt,
  };
}
const angle = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) => {
  const ux = a.x - b.x, uz = a.z - b.z, vx = c.x - b.x, vz = c.z - b.z;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz)))));
};

describe('the region lays out its farmland', () => {
  const inp = input(), plan = layFields(inp);
  const farmland = plan.fields.filter((f) => f.kind !== 'wood' && !f.belt);

  it('is the same every time', () => {
    const again = layFields(input());
    expect(again.fields.length).toBe(plan.fields.length);
    expect(JSON.stringify(again.fields.slice(0, 50))).toBe(JSON.stringify(plan.fields.slice(0, 50)));
  });

  it('covers the land once: convex fields that add up to the box', () => {
    let sum = 0;
    for (const f of plan.fields) { const a = area(f.poly); expect(a).toBeGreaterThan(0); sum += a; }
    expect(sum / ((box.x1 - box.x0) * (box.z1 - box.z0))).toBeCloseTo(1, 2);
  });

  it('has fields of believable size: mostly 2 to 10 ha, bigger where they are ploughed', () => {
    const ha = farmland.map((f) => area(f.poly) / 1e4).sort((a, b) => a - b), q = (p: number) => ha[Math.floor(ha.length * p)];
    expect(q(0.5)).toBeGreaterThan(2);
    expect(q(0.1)).toBeGreaterThan(0.7);
    expect(q(0.5)).toBeLessThan(8);
    expect(q(0.9)).toBeLessThan(14);
    const mean = (k: string) => { const l = farmland.filter((f) => f.kind === k).map((f) => area(f.poly)); return l.reduce((a, b) => a + b, 0) / l.length; };
    expect(mean('arable')).toBeGreaterThan(mean('grass'));
  });

  it('makes them four-sided with near-square corners, as enclosure fields are', () => {
    // (the corners inside a block are square; a block's own edge meets them at whatever angle it takes)
    let square = 0, corners = 0, four = 0;
    for (const f of farmland) {
      const n = f.poly.length;
      if (n === 4) four++;
      for (let k = 0; k < n; k++) { corners++; if (Math.abs(angle(f.poly[(k + n - 1) % n], f.poly[k], f.poly[(k + 1) % n]) - Math.PI / 2) < 0.12) square++; }
    }
    expect(four / farmland.length).toBeGreaterThan(0.55);
    expect(square / corners).toBeGreaterThan(0.6);
  });

  it('is about an eighth woodland, and pasture and arable in plausible shares (not a harlequin)', () => {
    const tot = plan.fields.reduce((a, f) => a + area(f.poly), 0), share = (p: (f: (typeof plan.fields)[number]) => boolean) => plan.fields.filter(p).reduce((a, f) => a + area(f.poly), 0) / tot;
    expect(share((f) => f.kind === 'wood')).toBeGreaterThan(0.07);
    expect(share((f) => f.kind === 'wood')).toBeLessThan(0.2);
    expect(share((f) => f.kind === 'grass')).toBeGreaterThan(0.3);
    expect(share((f) => f.kind === 'arable')).toBeGreaterThan(0.2);
    // rape in flower is the odd bright field, not a fifth of the land
    expect(share((f) => f.crop === 'rape')).toBeLessThan(0.06);
    // neighbouring fields often grow the same (each farm has two or three crops at a time)
    const arable = plan.fields.filter((f) => f.kind === 'arable');
    let same = 0, pairs = 0;
    for (let i = 0; i < arable.length; i++) for (let j = i + 1; j < arable.length; j++) if (arable[i].block === arable[j].block) { pairs++; if (arable[i].crop === arable[j].crop) same++; }
    expect(same / pairs).toBeGreaterThan(0.3);
  });

  it('puts woods on the slopes and by the water rather than anywhere', () => {
    const woodsBy = (p: (x: number, z: number) => boolean) => { const l = plan.fields.filter((f) => { const c = centroidOf(f.poly); return p(c.x, c.z); }); return l.filter((f) => f.kind === 'wood').length / Math.max(1, l.length); };
    const H = inp.heightAt!, slope = (x: number, z: number) => Math.hypot(H(x + 20, z) - H(x - 20, z), H(x, z + 20) - H(x, z - 20)) / 40;
    const steep = input(7, 'upland'), sp = layFields(steep), SH = steep.heightAt!, sslope = (x: number, z: number) => Math.hypot(SH(x + 20, z) - SH(x - 20, z), SH(x, z + 20) - SH(x, z - 20)) / 40;
    const onSteep = sp.fields.filter((f) => { const c = centroidOf(f.poly); return sslope(c.x, c.z) > 0.12; });
    if (onSteep.length > 5) expect(onSteep.filter((f) => f.kind === 'wood' || f.kind === 'rough').length / onSteep.length).toBeGreaterThan(0.4);
    expect(woodsBy((x, z) => inp.waterDist!(x, z) < 50 && inp.waterDist!(x, z) > 0)).toBeGreaterThan(woodsBy((x, z) => inp.waterDist!(x, z) > 300 && slope(x, z) < 0.03) * 0.8);
  });

  it('lines each block up with the lane beside it', () => {
    const lane = inp.lanes[0], a = Math.atan2(lane[1].z - lane[0].z, lane[1].x - lane[0].x);
    const near = plan.fields.filter((f) => {
      const c = centroidOf(f.poly), ex = lane[1].x - lane[0].x, ez = lane[1].z - lane[0].z, L = Math.hypot(ex, ez), t = ((c.x - lane[0].x) * ex + (c.z - lane[0].z) * ez) / (L * L);
      return t > 0.2 && t < 0.8 && Math.abs(((c.x - lane[0].x) * ez - (c.z - lane[0].z) * ex) / L) < 150;
    });
    // (a field's rows run with its block: along the lane or square to it)
    const off = near.map((f) => { const d = Math.abs(((f.dir - a) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2)); return Math.min(d, Math.PI / 2 - d); });
    expect(near.length).toBeGreaterThan(3);
    expect(off.filter((d) => d < 0.15).length / off.length).toBeGreaterThan(0.6);
  });

  it('has boundaries once each, and farms beside the roads, clear of the villages', () => {
    const key = (l: { a: { x: number; z: number }; b: { x: number; z: number } }) => [l.a, l.b].map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).sort().join('|');
    const keys = plan.lines.map(key);
    expect(new Set(keys).size / keys.length).toBeGreaterThan(0.98);
    expect(plan.farms.length).toBeGreaterThan(5);
    for (const f of plan.farms) for (const s of inp.settlements) expect(Math.hypot(f.x - s.x, f.z - s.z)).toBeGreaterThan(s.reach + 150);
  });

  it('is quick', () => {
    const t0 = performance.now();
    layFields(inp);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

describe('the countryside laid out lazily, a tile at a time (for maps of any size)', () => {
  const inp = input(), bounds = { x0: -3000, z0: -3000, x1: 3000, z1: 3000 };
  const make = () => new Countryside({ ...inp, bounds, hMax: 32 });
  const tile = (i: number, j: number) => ({ x0: i * 1000, z0: j * 1000, x1: (i + 1) * 1000, z1: (j + 1) * 1000 });
  const sig = (p: ReturnType<Countryside['near']>) => JSON.stringify(p.fields.map((f) => [f.block, f.kind, f.crop, f.poly.map((q) => [Math.round(q.x * 100), Math.round(q.z * 100)])]));

  it('gives a tile the same fields whatever was laid out before it, so tiles meet seamlessly', () => {
    const a = make(), b = make();
    for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) a.near(tile(i, j));
    expect(sig(b.near(tile(1, 0)))).toBe(sig(a.near(tile(1, 0))));
    // (neighbouring tiles share the fields that cross their border, whole)
    const l = new Set(a.near(tile(0, 0)).fields), across = a.near(tile(1, 0)).fields.filter((f) => f.poly.some((q) => q.x < 999) && f.poly.some((q) => q.x > 1001) && f.poly.some((q) => q.z > 0 && q.z < 1000));
    expect(across.length).toBeGreaterThan(0);
    for (const f of across) expect(l.has(f)).toBe(true);
  });

  it('lays a kilometre tile out in a few milliseconds', () => {
    const times: number[] = [];
    for (let k = 0; k < 5; k++) { const c = make(); times.push(cpuMs(() => c.near(tile(k - 3, 1)))); }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(budget(25));
  });

  it('gives a far tile a cheap look that still shows the patchwork and its woods', () => {
    const c = make(), n = 128, px = c.tileCover(tile(1, 0), n), cols = new Set<string>();
    let dark = 0;
    for (let k = 0; k < n * n; k++) { cols.add(`${px[k * 4]},${px[k * 4 + 1]},${px[k * 4 + 2]}`); if (px[k * 4 + 1] < 100) dark++; }
    expect(cols.size).toBeGreaterThan(5);
    expect(dark).toBeGreaterThan(0); // (woods and hedges)
  });
});
