import { describe, expect, test } from 'vitest';
import { MODELS, MODEL, CATEGORY, buildCatalogue } from './models';
import { BRANDS, BRAND } from './brands';
import { OPERATORS, liveryFor } from './operators';
import { buildKit, BUDGET } from './build';
import { lookFor } from './appearance';
import { carColour, plate, CAR_PALETTES } from './era';
import { pickVehicle, mixSummary } from './spawn';
import { follow, ahead, consistOffsets, articulationAngle } from './articulation';
import { purchaseList } from './economy';
import { REAL_NAMES } from './realnames';
import { editDistance, norm, rng } from './util';
import type { Lod, Model } from './types';
import { LIGHT } from './types';

const LODS: Lod[] = [0, 1, 2];

describe('catalogue', () => {
  test('is large and covers every category', () => {
    expect(MODELS.length).toBeGreaterThan(600);
    for (const c of ['car', 'van', 'lorry', 'trailer', 'bus', 'rail', 'boat', 'air']) expect(MODELS.some((m) => m.category === c)).toBe(true);
  });
  test('is deterministic', () => {
    const again = buildCatalogue();
    expect(again.length).toBe(MODELS.length);
    for (let i = 0; i < again.length; i++) expect(again[i]).toEqual(MODELS[i]);
  });
  test('ids and names are unique', () => {
    const ids = new Set(MODELS.map((m) => m.id));
    expect(ids.size).toBe(MODELS.length);
    const names = MODELS.map((m) => m.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
    const brands = BRANDS.map((b) => b.name), ops = OPERATORS.map((o) => o.name);
    expect(new Set(brands).size).toBe(brands.length);
    expect(new Set(ops).size).toBe(ops.length);
    expect(new Set(BRANDS.map((b) => b.id)).size).toBe(BRANDS.length);
    expect(new Set(OPERATORS.map((o) => o.id)).size).toBe(OPERATORS.length);
  });
  test('models point at real brands, styles and sets', () => {
    for (const m of MODELS) {
      const b = BRAND[m.brand];
      expect(b, m.id).toBeDefined();
      expect(CATEGORY[m.style], m.id).toBe(m.category);
      if (m.style !== 'police') expect(b.makes.includes(m.category) || (m.category === 'trailer' && b.makes.includes('trailer')), `${m.id} ${b.makes}`).toBe(true);
      for (const id of m.consist ?? []) expect(MODEL[id], `${m.id} → ${id}`).toBeDefined();
      expect(m.to).toBeGreaterThanOrEqual(m.from);
      expect(m.from).toBeGreaterThanOrEqual(1900);
      expect(m.to).toBeLessThanOrEqual(2030);
    }
  });
  test('articulated vehicles carry their hitches', () => {
    for (const m of MODELS) {
      if (m.style === 'tractor' || m.style === 'bus-bendy') expect(m.hitch?.rear, m.id).toBeTypeOf('number');
      if (m.category === 'trailer' || m.style === 'bus-bendy-rear') expect(m.hitch?.front, m.id).toBeTypeOf('number');
    }
  });
  test('operators have well-formed liveries within their years, and run known styles', () => {
    const hexes = /^#[0-9a-f]{6}$/i;
    for (const o of OPERATORS) {
      expect(o.liveries.length, o.id).toBeGreaterThan(0);
      for (const l of o.liveries) {
        expect(l.colours.length).toBe(4);
        for (const c of l.colours) expect(c, `${o.id} ${l.name}`).toMatch(hexes);
        expect(l.from, `${o.id} ${l.name}`).toBeGreaterThanOrEqual(o.from);
        expect(l.to, `${o.id} ${l.name}`).toBeLessThanOrEqual(o.to);
      }
      for (const s of o.fleet) expect(CATEGORY[s], `${o.id} ${s}`).toBeDefined();
      // every style in the fleet gets some livery in every year the operator runs
      for (let y = o.from; y <= o.to; y += 5) for (const s of o.fleet) expect(liveryFor(o, s, y), `${o.id} ${s} ${y}`).toBeDefined();
    }
  });
  test('brands are in the brand bible with colours and lines', () => {
    for (const b of BRANDS) {
      expect(b.blurb.length).toBeGreaterThan(30);
      expect(b.colours.length).toBeGreaterThan(0);
      expect(b.lines.length).toBeGreaterThan(0);
    }
  });
});

describe('dimensions', () => {
  // plausible UK sizes: [min length, max length, max width, max height]
  const LIMITS: Record<string, [number, number, number, number]> = {
    car: [2.3, 6.5, 2.12, 2.1], van: [3.6, 7.5, 2.55, 3.5], lorry: [5.5, 12, 2.55, 4.2], trailer: [10, 15.5, 2.6, 4.9],
    bus: [6, 15, 2.55, 4.45], rail: [6, 26.5, 2.95, 5], boat: [15, 270, 40, 40], air: [6, 70, 70, 20],
  };
  test('are within real-world limits', () => {
    for (const m of MODELS) {
      const [l0, l1, w, h] = LIMITS[m.category];
      const d = m.dims;
      expect(d.length, m.id).toBeGreaterThanOrEqual(l0);
      expect(d.length, m.id).toBeLessThanOrEqual(l1);
      expect(d.width, m.id).toBeLessThanOrEqual(w);
      expect(d.height, m.id).toBeLessThanOrEqual(h);
    }
  });
  test('road cars are the size of cars of their class and era', () => {
    const avg = (f: (m: Model) => boolean) => { const ms = MODELS.filter(f); return ms.reduce((s, m) => s + m.dims.length, 0) / ms.length; };
    expect(avg((m) => m.style === 'hatchback' && m.from >= 2000)).toBeGreaterThan(3.6);
    expect(avg((m) => m.style === 'hatchback' && m.from >= 2000)).toBeLessThan(4.5);
    expect(avg((m) => m.style === 'suv' && m.from >= 2000)).toBeGreaterThan(4.4);
    expect(avg((m) => m.style === 'bus-double')).toBeGreaterThan(9);
  });
  test('axles sit inside the body, front first, and the wheelbase matches', () => {
    for (const m of MODELS) {
      const d = m.dims;
      if (!d.axles.length) continue;
      for (let i = 1; i < d.axles.length; i++) expect(d.axles[i], m.id).toBeLessThan(d.axles[i - 1]);
      expect(d.axles[0] + d.wheelR, m.id).toBeLessThanOrEqual(d.length / 2 + 0.01);
      expect(d.axles[d.axles.length - 1] - d.wheelR, m.id).toBeGreaterThanOrEqual(-d.length / 2 - 0.01);
      expect(Math.abs(d.wheelbase - (d.axles[0] - d.axles[d.axles.length - 1])), m.id).toBeLessThan(0.02);
    }
  });
  test('geometry fits the stated dimensions (give or take mirrors, buffers and pantographs)', () => {
    for (const m of MODELS) {
      const bb = buildKit(m, 0).geometry().boundingBox!;
      const d = m.dims;
      expect(bb.max.x - bb.min.x, m.id).toBeLessThanOrEqual(d.length + 1.5);
      expect(bb.max.x - bb.min.x, m.id).toBeGreaterThanOrEqual(d.length * 0.9);
      expect(bb.max.z - bb.min.z, m.id).toBeLessThanOrEqual(d.width + 1.0);
      expect(bb.max.y, m.id).toBeLessThanOrEqual(d.height + (m.category === 'rail' || m.category === 'boat' ? 2.2 : 1.0));
    }
  });
});

describe('geometry', () => {
  test('every model and level of detail is within its triangle budget', () => {
    const over: string[] = [];
    for (const m of MODELS) for (const lod of LODS) {
      const t = buildKit(m, lod).tris, b = BUDGET[m.category][lod];
      if (t > b || t === 0) over.push(`${m.id} lod ${lod}: ${t} (budget ${b})`);
    }
    expect(over).toEqual([]);
  });
  test('levels of detail get cheaper', () => {
    for (const m of MODELS) {
      const [a, b, c] = LODS.map((l) => buildKit(m, l).tris);
      expect(b, m.id).toBeLessThan(a);
      expect(c, m.id).toBeLessThan(b);
    }
  });
  test('is deterministic and well formed', () => {
    const bad: string[] = [];
    for (const m of MODELS.filter((_, i) => i % 5 === 0)) {
      const a = buildKit(m, 0), b = buildKit(m, 0);
      if (a.pos.length !== b.pos.length || a.pos.some((v, i) => v !== b.pos[i]) || a.col.some((v, i) => v !== b.col[i])) bad.push(`${m.id} differs`);
      if (a.pos.some((v) => !Number.isFinite(v))) bad.push(`${m.id} NaN`);
      for (let i = 0; i < a.key.length; i += 4) if (a.key[i] < 0 || a.key[i] > 4 || a.key[i + 1] < 0 || a.key[i + 1] > Math.max(...Object.values(LIGHT))) { bad.push(`${m.id} key`); break; }
    }
    expect(bad).toEqual([]);
  });
  test('road vehicles have head and tail lamps, and emergency vehicles beacons', () => {
    for (const m of MODELS.filter((x) => x.category === 'car' || x.category === 'van' || x.category === 'bus' || x.style === 'tractor')) {
      if (m.style === 'bus-bendy-rear' || m.style === 'bus-bendy') continue; // the halves carry one end each
      const lights = new Set<number>();
      const k = buildKit(m, 0);
      for (let i = 1; i < k.key.length; i += 4) lights.add(k.key[i]);
      expect(lights.has(1), `${m.id} head`).toBe(true);
      expect(lights.has(2) || lights.has(3), `${m.id} tail`).toBe(true);
      if (m.style === 'ambulance' || (m.style === 'police' && m.design.lightbar)) expect(lights.has(7), `${m.id} beacon`).toBe(true);
    }
  });
  test('faces point outwards on a closed box', () => {
    // the far level of a car is a box: every normal should point away from its middle
    const g = buildKit(MODELS[0], 2).geometry();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const cy = (g.boundingBox!.max.y + g.boundingBox!.min.y) / 2;
    for (let i = 0; i < p.count; i += 3) {
      const mx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, my = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, mz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      expect(mx * n.getX(i) + (my - cy) * n.getY(i) + mz * n.getZ(i)).toBeGreaterThan(0);
    }
  });
});

describe('names', () => {
  // Plain English words used descriptively (trade terms, colours, places in general) are allowed
  // to match: only the full names and the invented words in them must keep their distance.
  const GENERIC = new Set(`railway railways trains train buses coaches coach motors transport express company city council class works rail freight travel tours
    ferries airways tramways tram metro corporation omnibus service ambulance constabulary police carriages hackney high speed mountain haulage logistics
    tankers timber livestock aggregates lines box carrying hire boats heavy industries aircraft traction yard car sons vehicle ices standard panelled goods
    mineral brake bogie hopper tank wagon container flat carrier balcony narrowboat lighter coaster tanker tipper curtainside skeletal transporter bolster
    stockfloat the and north south high hills harbour estuary crossways section end centre driving intermediate power rear tender estate saloon coupe
    convertible hatchback pickup black white grey gray red green blue yellow orange brown maroon claret cream gold silver plum lime teal mint moss teak
    rust stripe stripes swoops leaf lined sunrise sunburst tangerine strawberry heather checks wrap with farm forest quarry chalk arrow over holiday violet
    advertising municipal swoosh bauxite triple sector suburban locomotive coaching goods sector corporation carrying beacon fells mountain dockside
    ferrous iron works heavy wagons`.split(/\s+/).filter(Boolean));
  const words = (s: string) => s.split(/[\s&.,()-]+/).map(norm).filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w) && !/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(w));
  const real = REAL_NAMES.map((n) => ({ n, full: norm(n), words: n.split(/[\s&.,()-]+/).map(norm).filter((w) => w.length >= 3 && !GENERIC.has(w)) }));
  const close = (a: string, b: string) => (b.length <= 3 ? a === b : editDistance(a, b) <= 2);
  function flags(name: string) {
    const out: string[] = [];
    const full = norm(name);
    const ws = words(name);
    for (const r of real) {
      if (ws.length && close(full, r.full)) out.push(`${name} ≈ ${r.n}`);
      for (const w of ws) for (const rw of [r.full, ...r.words]) if (rw.length >= 4 ? close(w, rw) : w === rw) out.push(`${name} (${w}) ≈ ${r.n}`);
    }
    return out;
  }
  test('invented brands, operators and model families are not within two edits of real ones', () => {
    const ours = new Set<string>();
    for (const b of BRANDS) ours.add(b.name);
    for (const o of OPERATORS) { ours.add(o.name); for (const l of o.liveries) ours.add(l.name); }
    for (const b of BRANDS) for (const l of b.lines) ours.add(l.family);
    const bad = [...ours].flatMap(flags);
    expect(bad).toEqual([]);
  });
  test('the checker does catch near misses', () => {
    expect(flags('Vauxhal').length).toBeGreaterThan(0);
    expect(flags('Pennine Express').length).toBeGreaterThan(0);
    expect(flags('Cortena').length).toBeGreaterThan(0);
  });
});

describe('looks, colours and plates', () => {
  test('liveries and plates are deterministic per seed', () => {
    const m = MODELS.find((x) => x.style === 'bus-double')!;
    expect(lookFor(m, 1990, 42)).toEqual(lookFor(m, 1990, 42));
    expect(plate(1995, 7)).toBe(plate(1995, 7));
  });
  test('plates follow the UK format of their year', () => {
    expect(plate(1955, 1)).toMatch(/^[A-Z]{3} \d{1,3}$/);
    expect(plate(1970, 1)).toMatch(/^[A-Z]{3} \d{3}H$/);
    expect(plate(1990, 1)).toMatch(/^H\d{3} [A-Z]{3}$/);
    expect(plate(2015, 1)).toMatch(/^[A-Z]{2}(15|65) [A-Z]{3}$/);
  });
  test('colour fashion follows the decade', () => {
    const share = (year: number, set: string[]) => { const r = rng(3); let n = 0; for (let i = 0; i < 4000; i++) if (set.includes(carColour(year, r))) n++; return n / 4000; };
    const seventies = CAR_PALETTES.find(([y]) => y === 1970)![1].filter(([, w]) => w >= 10).map(([c]) => c);
    expect(share(1975, ['#6b4a2b', '#d0631d', '#c89a2a', '#6f7a32'])).toBeGreaterThan(0.25);
    expect(share(2015, ['#f2f2f0', '#6a6e72', '#141414', '#b9bdc0', '#80858a'])).toBeGreaterThan(0.55);
    expect(seventies.length).toBeGreaterThan(2);
  });
  test('police, ambulances and cabs wear their service liveries', () => {
    for (const s of ['police', 'ambulance', 'taxi'] as const) {
      const m = MODELS.find((x) => x.style === s && x.from >= 1995)!;
      expect(lookFor(m, 2000, 5).operator, s).toBeDefined();
    }
  });
});

describe('traffic helpers', () => {
  test('the mix suits the area', () => {
    const centre = mixSummary('centre', 2000), ind = mixSummary('industrial', 2000), sub = mixSummary('suburb', 2000);
    expect((ind.lorry ?? 0) + (ind.artic ?? 0)).toBeGreaterThan(((centre.lorry ?? 0) + (centre.artic ?? 0)) * 3);
    expect(centre.taxi ?? 0).toBeGreaterThan((sub.taxi ?? 0) * 3);
    expect(centre.bus ?? 0).toBeGreaterThan(sub.bus ?? 0);
  });
  test('only vehicles of the period are picked', () => {
    const r = rng(9);
    for (let i = 0; i < 300; i++) {
      const s = pickVehicle(r, 'suburb', 1965)!;
      expect(s.lead.from, s.lead.id).toBeLessThanOrEqual(1965);
      // preserved heritage buses are the one exception to "no more than fifteen years old"
      if (s.lead.category !== 'bus') expect(s.lead.to, s.lead.id).toBeGreaterThanOrEqual(1950);
    }
  });
  test('artics come as tractor and trailer, joined at the hitch', () => {
    const r = rng(4);
    let seen = 0;
    for (let i = 0; i < 400 && seen < 10; i++) {
      const s = pickVehicle(r, 'motorway', 2005)!;
      if (s.lead.style !== 'tractor') continue;
      seen++;
      expect(s.chain.length).toBe(2);
      const [t, tr] = s.chain;
      const pose = { x: 10, z: 5, heading: 0.7 };
      const p = follow(pose, t, tr);
      const h1 = ahead(pose, t.hitch!.rear!), h2 = ahead(p, tr.hitch!.front!);
      expect(Math.hypot(h1.x - h2.x, h1.z - h2.z)).toBeLessThan(1e-9);
      expect(p.heading).toBeCloseTo(0.7);
      // round a 15 m radius bend the trailer follows, lagging behind the tractor but never folding up
      let tp = p, trp = p;
      for (let k = 0; k < 300; k++) {
        const a = k * 0.2 / 15;
        tp = { x: 15 * Math.sin(a), z: 15 - 15 * Math.cos(a), heading: a };
        trp = follow(tp, t, tr, trp);
        const hh = ahead(tp, t.hitch!.rear!), ht = ahead(trp, tr.hitch!.front!);
        expect(Math.hypot(hh.x - ht.x, hh.z - ht.z)).toBeLessThan(1e-6);
      }
      const bend = articulationAngle(tp, trp);
      expect(bend).toBeGreaterThan(0.1);
      expect(bend).toBeLessThan(1.2);
    }
    expect(seen).toBeGreaterThan(0);
  });
  test('train offsets add up to the train length', () => {
    const hs = MODELS.find((m) => m.style === 'hs-power')!;
    const set = hs.consist!.map((id) => MODEL[id]);
    const { offsets, length } = consistOffsets(set);
    expect(offsets.length).toBe(set.length);
    expect(length).toBeCloseTo(set.reduce((s, m) => s + m.dims.length, 0) + 0.9 * (set.length - 1));
  });
  test('there is something to buy in every era', () => {
    for (const y of [1910, 1935, 1960, 1985, 2010, 2030]) {
      const list = purchaseList(y);
      expect(list.length, String(y)).toBeGreaterThan(y < 1920 ? 5 : 15);
      for (const o of list) { expect(o.cost, o.id).toBeGreaterThan(0); expect(o.speedKmh, o.id).toBeGreaterThan(0); }
    }
    expect(purchaseList(1985, ['train']).length).toBeGreaterThan(3);
    expect(purchaseList(1960, ['bus']).length).toBeGreaterThanOrEqual(2);
  });
});
