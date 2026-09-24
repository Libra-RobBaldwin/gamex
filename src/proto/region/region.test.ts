import { describe, expect, test } from 'vitest';
import { generateRegion, KINDS, REGION_BOUND, type Region } from './generate';
import { buildStreets } from './apply';
import { MapWater, TOWN_LAKE, lakeGroundOf, lakeRadiusOf } from './water';
import { isRealPlace, REAL_PLACES } from './names';
import { centrality, mapById, mapOfRegion, plotCentre, regionMap, TOWN_MAP, zoneOf } from './index';
import { Network, DEFAULT_OPTS, ROADS, halfOf, bezier } from '../roads';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const regions = new Map<number, Region>();
const region = (seed: number) => { let g = regions.get(seed); if (!g) regions.set(seed, (g = generateRegion(seed))); return g; };

describe('the region generator', () => {
  test('one seed always gives the same region', () => {
    expect(JSON.stringify(generateRegion(7))).toBe(JSON.stringify(generateRegion(7)));
    expect(JSON.stringify(regionMap(3))).toBe(JSON.stringify(regionMap(3)));
  });

  test('two seeds give different regions', () => {
    for (const [a, b] of [[1, 2], [7, 8], [3, 30]]) {
      const A = region(a), B = generateRegion(b);
      expect(A.settlements.map((s) => [s.x, s.z])).not.toEqual(B.settlements.map((s) => [s.x, s.z]));
      expect(A.settlements.map((s) => s.name)).not.toEqual(B.settlements.map((s) => s.name));
      expect(A.water.rivers[0].path).not.toEqual(B.water.rivers[0].path);
    }
  });

  test('10–12 settlements: a city, three market towns and six to eight villages', () => {
    for (const seed of SEEDS) {
      const ss = region(seed).settlements;
      expect(ss.length).toBeGreaterThanOrEqual(10);
      expect(ss.length).toBeLessThanOrEqual(12);
      expect(ss.filter((s) => s.kind === 'city')).toHaveLength(1);
      expect(ss.filter((s) => s.kind === 'town')).toHaveLength(3);
      const v = ss.filter((s) => s.kind === 'village').length;
      expect(v).toBeGreaterThanOrEqual(6);
      expect(v).toBeLessThanOrEqual(8);
      // the city is about twice a town, a town about today's (250 m to its edge), a village smaller
      for (const s of ss) expect(s.r).toBeGreaterThanOrEqual(KINDS[s.kind].r[0]);
    }
  });

  test('settlements are spread out, on the map and off the water', () => {
    for (const seed of SEEDS) {
      const g = region(seed), mw = new MapWater(g.water);
      for (const s of g.settlements) {
        expect(Math.abs(s.x) + s.r).toBeLessThan(REGION_BOUND);
        expect(Math.abs(s.z) + s.r).toBeLessThan(REGION_BOUND);
        expect(mw.edgeDistance(s)).toBeGreaterThan(s.r);
        for (const o of g.settlements) if (o !== s) expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThan(s.r + o.r + 300);
      }
    }
  });

  test('one or two lakes and a river right across the map', () => {
    for (const seed of SEEDS) {
      const w = region(seed).water;
      expect(w.lakes.length).toBeGreaterThanOrEqual(1);
      expect(w.lakes.length).toBeLessThanOrEqual(2);
      expect(w.rivers).toHaveLength(1);
      const p = w.rivers[0].path, a = p[0], b = p[p.length - 1];
      // (off both edges of the ground, which reaches 1.5 times the bound)
      expect(Math.max(Math.abs(a.x), Math.abs(a.z))).toBeGreaterThan(1.5 * REGION_BOUND);
      expect(Math.max(Math.abs(b.x), Math.abs(b.z))).toBeGreaterThan(1.5 * REGION_BOUND);
    }
  });

  test('the water is a height source the water library can fill: flat, dipping into each bed', () => {
    const g = region(7), mw = new MapWater(g.water), L = g.water.lakes[0], R = g.water.rivers[0];
    expect(mw.ground(L.x, L.z)).toBeLessThan(-3);
    const m = R.path[Math.floor(R.path.length / 2)];
    expect(mw.ground(m.x, m.z)).toBeLessThan(-2);
    for (const s of g.settlements) expect(mw.ground(s.x, s.z)).toBe(0);
    // the town's lake is the same bowl as before
    for (const [x, z] of [[250, -190], [300, -150], [180, -250], [340, -190]]) expect(lakeGroundOf(TOWN_LAKE, x, z)).toBe(lakeGroundOf({ x: 250, z: -190, r: 90, waves: [0.7, 2.1, 0.4] }, x, z));
    expect(lakeRadiusOf(TOWN_LAKE, 1)).toBeCloseTo(90 * (1 + 0.075 * Math.sin(2.7) + 0.05 * Math.sin(5.1) + 0.03 * Math.sin(5.4)), 9);
  });

  test('no street in water (nor on the beach), and none off the map', () => {
    for (const seed of SEEDS) {
      const g = region(seed), mw = new MapWater(g.water);
      for (const st of g.streets) {
        const half = halfOf(ROADS[st.type]), A = st.a, B = st.b;
        const pts = st.c ? bezier(A, st.c, B) : [A, B];
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i], L = Math.hypot(q.x - p.x, q.z - p.z), ux = (q.x - p.x) / L, uz = (q.z - p.z) / L;
          for (let t = 0; t <= L; t += 4) for (const side of [-1, 0, 1]) {
            const x = p.x + ux * t - uz * half * side, z = p.z + uz * t + ux * half * side;
            expect(mw.ground(x, z)).toBe(0);
            expect(Math.abs(x)).toBeLessThan(REGION_BOUND);
            expect(Math.abs(z)).toBeLessThan(REGION_BOUND);
          }
        }
      }
    }
  });

  test('every street is a catalogue road type', () => {
    for (const seed of SEEDS) for (const st of region(seed).streets) expect(ROADS[st.type]?.cls).toBe('road');
  });

  test('each kind has its own layout: a high street, residential streets, an industrial edge for the city and towns', () => {
    for (const seed of SEEDS) {
      const g = region(seed);
      for (const s of g.settlements) {
        const mine = g.streets.filter((t) => t.settlement === s.id);
        expect(mine.filter((t) => t.role === 'high').length).toBeGreaterThanOrEqual(2);
        expect(mine.filter((t) => t.role === 'street').length).toBeGreaterThanOrEqual(s.kind === 'village' ? 1 : 10);
        const zone = g.zones.find((z) => z.settlement === s.id);
        if (s.kind === 'village') expect(zone).toBeUndefined();
        else {
          expect(zone).toBeDefined();
          expect(mine.filter((t) => t.role === 'industrial').length).toBeGreaterThanOrEqual(3);
        }
      }
      // the city has the most streets, a village the fewest
      const count = (k: string) => g.streets.filter((t) => g.settlements[t.settlement].kind === k).length;
      expect(count('city')).toBeGreaterThan(count('town') / 3 * 1.5);
    }
  });

  test('every settlement\'s streets form one connected piece on the Network, and none is refused', () => {
    for (const seed of [1, 7, 12]) {
      const g = region(seed), mw = new MapWater(g.water);
      const net = new Network((p) => mw.mayBeNear(p, 12) && mw.edgeDistance(p, 20) < 9.5, g.bound, 11);
      const seg2set = new Map<number, number>();
      for (const s of g.settlements) {
        const mine = g.streets.filter((t) => t.settlement === s.id);
        const r = buildStreets(net, mine, DEFAULT_OPTS, true);
        expect(r.skipped).toEqual([]);
        for (const id of r.made) seg2set.set(id, s.id);
      }
      // the Network may split earlier streets where later ones cross them: find each piece's settlement by where it is
      const nearest = (x: number, z: number) => g.settlements.reduce((m, s) => (Math.hypot(s.x - x, s.z - z) < Math.hypot(m.x - x, m.z - z) ? s : m));
      for (const s of g.settlements) {
        const segs = [...net.segs.values()].filter((sg) => { const a = net.node(sg.a); return nearest(a.x, a.z) === s; });
        expect(segs.length).toBeGreaterThan(0);
        const adj = new Map<number, number[]>();
        for (const sg of segs) for (const [x, y] of [[sg.a, sg.b], [sg.b, sg.a]]) { let l = adj.get(x); if (!l) adj.set(x, (l = [])); l.push(y); }
        const start = segs[0].a, seen = new Set([start]), todo = [start];
        while (todo.length) for (const y of adj.get(todo.pop()!) ?? []) if (!seen.has(y)) { seen.add(y); todo.push(y); }
        expect(seen.size).toBe(adj.size);
      }
    }
  }, 60000);

  test('suggested links: A roads between the city and towns, B roads to every village, all reachable', () => {
    for (const seed of SEEDS) {
      const g = region(seed), ss = g.settlements;
      const parent = ss.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (const l of g.links) parent[find(l.a)] = find(l.b);
      expect(new Set(ss.map((s) => find(s.id))).size).toBe(1);
      const major = ss.filter((s) => s.kind !== 'village');
      for (const l of g.links) {
        const a = ss[l.a], b = ss[l.b], m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        expect(l.road).toBe(a.kind === 'village' || b.kind === 'village' ? 'B' : 'A');
        // Gabriel: nobody of its tier inside the circle on the link
        const tier = l.road === 'A' ? major : ss;
        for (const c of tier) if (c !== a && c !== b) expect(Math.hypot(c.x - m.x, c.z - m.z)).toBeGreaterThanOrEqual(l.length / 2 - 1);
        expect(g.links.filter((k) => (k.a === l.a && k.b === l.b) || (k.a === l.b && k.b === l.a))).toHaveLength(1);
      }
      // the city and every town has an A road; every village a B road, and at most a few
      for (const s of major) expect(g.links.some((l) => l.road === 'A' && (l.a === s.id || l.b === s.id))).toBe(true);
      for (const s of ss.filter((x) => x.kind === 'village')) {
        const n = g.links.filter((l) => l.a === s.id || l.b === s.id).length;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('names', () => {
  test('invented, plausibly English, all different, and none a real UK place', () => {
    const all = new Set<string>();
    for (const seed of [...SEEDS, ...Array.from({ length: 30 }, (_, i) => 100 + i)]) {
      const names = generateRegion(seed).settlements.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) {
        expect(n).toMatch(/^([A-Z][a-z]+ )?[A-Z][a-z]{3,}( [A-Z][a-z]+)*$/);
        expect(isRealPlace(n)).toBe(false);
        all.add(n);
      }
    }
    expect(all.size).toBeGreaterThan(300);
  });
  test('the check catches real places, near misses and dressed-up ones', () => {
    for (const n of ['Horley', 'Ashford', 'Thornbury', 'Stanton', 'ashford', 'Ottery St Mary', 'Little Marlow']) expect(isRealPlace(n)).toBe(true);
    expect(isRealPlace('Thornbary')).toBe(true); // one letter off
    expect(isRealPlace('Great Oakham')).toBe(true); // Oakham with a "Great"
    expect(isRealPlace('Otterton Green')).toBe(true);
    expect(isRealPlace('Hollywell')).toBe(true); // Holywell, one letter off
    expect(isRealPlace('Fellbridge')).toBe(true); // Felbridge
    for (const n of ['Heronwick', 'Teaselford', 'Linnetstow']) expect(isRealPlace(n)).toBe(false);
    expect(REAL_PLACES.length).toBeGreaterThan(300);
  });
});

describe('maps as data', () => {
  test('?map= picks the map; the town is the default', () => {
    expect(mapById(null)).toBe(TOWN_MAP);
    expect(mapById('nonsense')).toBe(TOWN_MAP);
    expect(mapById('region').id).toBe('region');
    expect(mapById('region').bound).toBe(REGION_BOUND);
    expect(mapById('region-5').seed).toBe(5);
  });
  test('the town map is the town as it was', () => {
    const INDUSTRIAL = (p: { x: number; z: number }) => p.z < -215 && Math.abs(p.x) < 280;
    for (let x = -600; x <= 600; x += 40) for (let z = -600; z <= 600; z += 40) expect(zoneOf(TOWN_MAP, { x, z }) === 'industrial').toBe(INDUSTRIAL({ x, z }));
    for (const p of [{ x: -280, z: -300 }, { x: 280, z: -300 }, { x: 0, z: -215 }, { x: 0, z: -215.01 }]) expect(zoneOf(TOWN_MAP, p) === 'industrial').toBe(INDUSTRIAL(p));
    expect(plotCentre(TOWN_MAP, { x: 100, z: 10 }, { x: 180, z: 10 })).toEqual({ x: 0, z: 0 });
    expect(centrality(TOWN_MAP, { x: 30, z: 40 })).toBe(50);
    expect(TOWN_MAP.bound).toBe(520);
    // the high street ends where the bypass's curve crosses z = 0, as seedTown() worked it out
    const bypass = bezier({ x: 110, z: 110 }, { x: 230, z: 40 }, { x: 170, z: -98 });
    const i = bypass.findIndex((p) => p.z < 0), [p0, p1] = [bypass[i - 1], bypass[i]];
    expect(TOWN_MAP.streets[0].b).toEqual({ x: p0.x + ((p1.x - p0.x) * p0.z) / (p0.z - p1.z), z: 0 });
    expect(TOWN_MAP.streets).toHaveLength(21);
  });
  test('the region map: plots are as central as their settlement\'s size says', () => {
    const m = mapOfRegion(region(7));
    const city = m.settlements.find((s) => s.kind === 'city')!, village = m.settlements.find((s) => s.kind === 'village')!;
    expect(centrality(m, { x: city.x + 200, z: city.z })).toBeCloseTo(100, 6); // twice the town: its bands twice as wide
    expect(centrality(m, village)).toBeGreaterThanOrEqual(60); // no towers in a village
    // the stand-in centre for a street is that far from its middle, square to it
    const a = { x: city.x + 190, z: city.z }, b = { x: city.x + 210, z: city.z }, c = plotCentre(m, a, b);
    expect(Math.hypot(c.x - (city.x + 200), c.z - city.z)).toBeCloseTo(100, 6);
    expect(c.x).toBeCloseTo(city.x + 200, 6);
    // the camera starts over the city, and the starter line is on its high street
    expect(Math.hypot(m.view.x - city.x, m.view.z - city.z)).toBeLessThan(50);
    expect(m.line.length).toBeGreaterThanOrEqual(2);
  });
});
