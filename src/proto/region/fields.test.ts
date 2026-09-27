// The map's farmland (fields.ts, woods.ts), laid out on a 50 km map as the game does
// (worldmap/country.ts): fields of believable sizes, four-sided and square cornered, in blocks
// that follow the roads; about an eighth woodland, most on the slopes and by the water; farms
// beside the roads; the same whatever order its tiles are asked for in.
import { describe, expect, it } from 'vitest';
import { area, centroidOf, Countryside, type Field, type Farm, type Line } from './fields';
import { budget, cpuMs } from '../test/speed';
import { planWorld, type WorldPlan } from '../worldmap/plan';
import { countryInputOf } from '../worldmap/country';

type Box = { x0: number; z0: number; x1: number; z1: number };
const box: Box = { x0: -3000, z0: -3000, x1: 3000, z1: 3000 };
const make = (plan: WorldPlan) => new Countryside(countryInputOf(plan));
// every block touching a box, whole (as the ground asks for them), and the farms in them
function lay(c: Countryside, b: Box) {
  const fields: Field[] = [], lines: Line[] = [];
  for (const k of c.blocksNear(b)) { fields.push(...k.fields); lines.push(...k.lines); }
  return { fields, lines, farms: c.farmsNear(b) as Farm[] };
}
const inside = (f: Field, b: Box) => { const c = centroidOf(f.poly); return c.x > b.x0 && c.x < b.x1 && c.z > b.z0 && c.z < b.z1; };
const inConvex = (x: number, z: number, q: { x: number; z: number }[]) => {
  let sign = 0;
  for (let k = 0; k < q.length; k++) { const a = q[k], b = q[(k + 1) % q.length], c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x); if (!c) continue; const s = c > 0 ? 1 : -1; if (!sign) sign = s; else if (s !== sign) return false; }
  return true;
};
const angle = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) => {
  const ux = a.x - b.x, uz = a.z - b.z, vx = c.x - b.x, vz = c.z - b.z;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz)))));
};
const slopeOf = (H: (x: number, z: number) => number) => (x: number, z: number) => Math.hypot(H(x + 20, z) - H(x - 20, z), H(x, z + 20) - H(x, z - 20)) / 40;

describe('the map lays out its farmland', () => {
  const world = planWorld({ seed: 7 }), inp = countryInputOf(world), all = lay(make(world), box);
  const fields = all.fields.filter((f) => inside(f, box)), farmland = fields.filter((f) => f.kind !== 'wood' && !f.belt);

  it('is the same every time', () => {
    const again = lay(make(world), box).fields.filter((f) => inside(f, box));
    expect(again.length).toBe(fields.length);
    expect(JSON.stringify(again.slice(0, 50))).toBe(JSON.stringify(fields.slice(0, 50)));
  });

  it('covers the land once: convex fields with no gaps or overlaps', () => {
    for (const f of all.fields) expect(area(f.poly)).toBeGreaterThan(0);
    let once = 0, n = 0;
    for (let x = box.x0 + 25; x < box.x1; x += 97) for (let z = box.z0 + 25; z < box.z1; z += 97) {
      n++;
      if (all.fields.filter((f) => inConvex(x, z, f.poly)).length === 1) once++;
    }
    expect(once / n).toBeGreaterThan(0.995); // (a point exactly on a boundary may count twice)
  });

  it('grows wheat and rape on the low ground, barley and leys on the high', () => {
    // (the whole 50 km map's farmland, so the hills are in it: this box alone is a river valley)
    const wide = { x0: -12000, z0: -12000, x1: 12000, z1: 12000 }, far = lay(make(world), wide).fields.filter((f) => inside(f, wide) && f.kind === 'arable');
    const rank = (f: Field) => { const c = centroidOf(f.poly); return inp.heightRank!(inp.heightAt!(c.x, c.z)); };
    const low = far.filter((f) => rank(f) < 0.35), high = far.filter((f) => rank(f) > 0.75);
    const share = (l: Field[], k: string[]) => l.filter((f) => k.includes(f.crop)).length / l.length;
    console.log(`arable fields low ${low.length} high ${high.length}; wheat+rape low ${(share(low, ['wheat', 'rape']) * 100).toFixed(0)}% high ${(share(high, ['wheat', 'rape']) * 100).toFixed(0)}%; barley+ley low ${(share(low, ['barley', 'ley']) * 100).toFixed(0)}% high ${(share(high, ['barley', 'ley']) * 100).toFixed(0)}%`);
    expect(high.length).toBeGreaterThan(30);
    expect(share(low, ['wheat', 'rape'])).toBeGreaterThan(share(high, ['wheat', 'rape']) + 0.1);
    expect(share(high, ['barley', 'ley'])).toBeGreaterThan(share(low, ['barley', 'ley']) + 0.1);
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
    const tot = fields.reduce((a, f) => a + area(f.poly), 0), share = (p: (f: Field) => boolean) => fields.filter(p).reduce((a, f) => a + area(f.poly), 0) / tot;
    // (woodland over the whole map, from kilometre tiles all over it: round the start town it's
    // more, as its valley sides are steep and hung with woods)
    const c = make(world);
    let wood = 0, land = 0;
    for (let k = 0; k < 30; k++) {
      const x = ((k * 7919) % 44) * 1000 - 22000, z = ((k * 104729) % 44) * 1000 - 22000, t = { x0: x, z0: z, x1: x + 1000, z1: z + 1000 };
      for (const f of lay(c, t).fields) if (inside(f, t)) { const a = area(f.poly); land += a; if (f.kind === 'wood') wood += a; }
    }
    expect(wood / land).toBeGreaterThan(0.08);
    expect(wood / land).toBeLessThan(0.18);
    expect(share((f) => f.kind === 'grass')).toBeGreaterThan(0.3);
    expect(share((f) => f.kind === 'arable')).toBeGreaterThan(0.2);
    // rape in flower is the odd bright field, not a fifth of the land
    expect(share((f) => f.crop === 'rape')).toBeLessThan(0.06);
    // neighbouring fields often grow the same (each farm has two or three crops at a time)
    const arable = fields.filter((f) => f.kind === 'arable');
    let same = 0, pairs = 0;
    for (let i = 0; i < arable.length; i++) for (let j = i + 1; j < arable.length; j++) if (arable[i].block === arable[j].block) { pairs++; if (arable[i].crop === arable[j].crop) same++; }
    expect(same / pairs).toBeGreaterThan(0.3);
  });

  it('puts woods on the slopes and by the water rather than anywhere', () => {
    const woodsBy = (l: Field[], p: (x: number, z: number) => boolean) => { const m = l.filter((f) => { const c = centroidOf(f.poly); return p(c.x, c.z); }); return m.filter((f) => f.kind === 'wood').length / Math.max(1, m.length); };
    const W = inp.waterDist!, slope = slopeOf(inp.heightAt!);
    // (by the water: the whole 50 km, so there's water enough to judge by)
    const wide = { x0: -12000, z0: -12000, x1: 12000, z1: 12000 }, more = lay(make(world), wide).fields;
    expect(woodsBy(more, (x, z) => W(x, z) < 50 && W(x, z) > 0)).toBeGreaterThan(woodsBy(more, (x, z) => W(x, z) > 300 && slope(x, z) < 0.03) * 0.8);
    const steep = planWorld({ seed: 7, relief: 'upland' }), sslope = slopeOf(steep.terrain.heightAt);
    const onSteep = lay(make(steep), wide).fields.filter((f) => { const c = centroidOf(f.poly); return sslope(c.x, c.z) > 0.12; });
    if (onSteep.length > 5) expect(onSteep.filter((f) => f.kind === 'wood' || f.kind === 'rough').length / onSteep.length).toBeGreaterThan(0.4);
  }, 60000);

  it('lines each block up with the road beside it', () => {
    // (a field's rows run with its block: along the road or square to it)
    const off: number[] = [];
    for (const f of farmland) {
      const c = centroidOf(f.poly);
      let best = 150, a = 0;
      for (const r of inp.lanes) for (let k = 1; k < r.length; k++) {
        const p = r[k - 1], q = r[k], ex = q.x - p.x, ez = q.z - p.z, L = Math.hypot(ex, ez);
        if (L < 1) continue;
        const t = ((c.x - p.x) * ex + (c.z - p.z) * ez) / (L * L);
        if (t < 0 || t > 1) continue;
        const d = Math.abs(((c.x - p.x) * ez - (c.z - p.z) * ex) / L);
        if (d < best) { best = d; a = Math.atan2(ez, ex); }
      }
      if (best >= 150) continue;
      const d = Math.abs(((f.dir - a) % (Math.PI / 2) + Math.PI / 2) % (Math.PI / 2));
      off.push(Math.min(d, Math.PI / 2 - d));
    }
    expect(off.length).toBeGreaterThan(3);
    expect(off.filter((d) => d < 0.15).length / off.length).toBeGreaterThan(0.6);
  });

  it('has boundaries once each, and farms beside the roads, clear of the villages', () => {
    const key = (l: Line) => [l.a, l.b].map((p) => `${Math.round(p.x)},${Math.round(p.z)}`).sort().join('|');
    const keys = all.lines.map(key);
    expect(new Set(keys).size / keys.length).toBeGreaterThan(0.98);
    expect(all.farms.length).toBeGreaterThan(5);
    for (const f of all.farms) for (const s of inp.settlements) expect(Math.hypot(f.x - s.x, f.z - s.z)).toBeGreaterThan(s.reach + 150);
  });
});

describe('the countryside laid out lazily, a tile at a time', () => {
  const world = planWorld({ seed: 7 });
  const tile = (i: number, j: number) => ({ x0: i * 1000, z0: j * 1000, x1: (i + 1) * 1000, z1: (j + 1) * 1000 });
  const sig = (l: Field[]) => JSON.stringify(l.map((f) => [f.block, f.kind, f.crop, f.poly.map((q) => [Math.round(q.x * 100), Math.round(q.z * 100)])]));

  it('gives a tile the same fields whatever was laid out before it, so tiles meet seamlessly', () => {
    const a = make(world), b = make(world);
    for (let i = -3; i < 3; i++) for (let j = -3; j < 3; j++) lay(a, tile(i, j));
    expect(sig(lay(b, tile(1, 0)).fields)).toBe(sig(lay(a, tile(1, 0)).fields));
    // (neighbouring tiles share the fields that cross their border, whole)
    const l = new Set(lay(a, tile(0, 0)).fields), across = lay(a, tile(1, 0)).fields.filter((f) => f.poly.some((q) => q.x < 999) && f.poly.some((q) => q.x > 1001) && f.poly.some((q) => q.z > 0 && q.z < 1000));
    expect(across.length).toBeGreaterThan(0);
    for (const f of across) expect(l.has(f)).toBe(true);
  });

  it('lays a kilometre tile out in a few milliseconds', () => {
    const times: number[] = [];
    for (let k = 0; k < 5; k++) { const c = make(world); times.push(cpuMs(() => c.blocksNear(tile(k * 3 - 7, 4)))); }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(budget(25));
  });
});
