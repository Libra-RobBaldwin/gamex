import { describe, expect, test } from 'vitest';
import { layStreets, suggestLinks, type Settlement } from './generate';
import { buildStreets } from './apply';
import { MapWater, type WaterSpec } from '../worldmap/water';
import { isRealPlace, placeName, REAL_PLACES } from './names';
import { centrality, mapFromQuery, optionsFromQuery, optionsQuery, plotCentre, regionOptions, STYLE_LOOKS, STYLES } from './index';
import { rng, mix } from './random';
import { CROP_NAMES, PALETTE } from '../ground/covers';
import { Network, DEFAULT_OPTS, ROADS, halfOf, bezier } from '../roads';
import { planWorld, type WorldPlan } from '../worldmap/plan';
import { worldMapSpec } from '../worldmap/spec';

// The one map is the 50 km plan (worldmap/plan.ts); what's tested here is the part of it this
// folder makes: each settlement's streets (layStreets), which places to join (suggestLinks), the
// names, and the map as data (mapspec.ts, options.ts).
const SEEDS = [7, 42, 3];
const plans = new Map<number, WorldPlan>();
const plan = (seed: number) => { let p = plans.get(seed); if (!p) plans.set(seed, (p = planWorld({ seed }))); return p; };
const streetsOf = (s: Settlement, p: WorldPlan) => layStreets({ ...s, gates: [] }, p.water, p.half);

describe('a settlement’s streets', () => {
  test('no street in water (nor on the beach), none off the map, every one a catalogue road type', () => {
    for (const seed of SEEDS) {
      const p = plan(seed), mw = p.water;
      for (const s of p.settlements) for (const st of streetsOf(s, p).streets) {
        expect(ROADS[st.type]?.cls).toBe('road');
        const half = halfOf(ROADS[st.type]), pts = st.c ? bezier(st.a, st.c, st.b) : [st.a, st.b];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
          for (let t = 0; t <= L; t += 8) for (const side of [-1, 0, 1]) {
            const x = a.x + ux * t - uz * half * side, z = a.z + uz * t + ux * half * side;
            expect(mw.edgeDistance({ x, z }, 30)).toBeGreaterThan(0);
            expect(Math.abs(x)).toBeLessThan(p.half);
            expect(Math.abs(z)).toBeLessThan(p.half);
          }
        }
      }
    }
  }, 60000);

  test('each kind has its own layout: a high street, residential streets, an industrial edge for the city and towns', () => {
    for (const seed of SEEDS) {
      const p = plan(seed), count: Record<string, number[]> = { city: [], town: [], village: [] };
      for (const s of p.settlements) {
        const { streets, zone } = streetsOf(s, p);
        expect(streets.filter((t) => t.role === 'high').length).toBeGreaterThanOrEqual(2);
        expect(streets.filter((t) => t.role === 'street').length).toBeGreaterThanOrEqual(s.kind === 'village' ? 1 : 10);
        if (s.kind === 'village') expect(zone).toBeNull();
        else {
          expect(zone).not.toBeNull();
          expect(streets.filter((t) => t.role === 'industrial').length).toBeGreaterThanOrEqual(3);
        }
        count[s.kind].push(streets.length);
      }
      // a city has the most streets, a village the fewest
      const mean = (a: number[]) => a.reduce((t, v) => t + v, 0) / Math.max(1, a.length);
      if (count.city.length) expect(mean(count.city)).toBeGreaterThan(mean(count.town));
      expect(mean(count.town)).toBeGreaterThan(mean(count.village));
    }
  });

  test('every settlement’s streets form one connected piece on the Network, and none is refused', () => {
    // (the live area's places, as the game builds them: worldmap/spec.ts)
    const m = worldMapSpec({ seed: 7 }), p = m.world, mw = new MapWater(m.water);
    const net = new Network((q) => mw.mayBeNear(q, 12) && mw.edgeDistance(q, 20) < 9.5, m.bound, 11);
    for (const s of m.settlements) {
      const r = buildStreets(net, streetsOf(p.settlements[s.id], p).streets, DEFAULT_OPTS, true);
      expect(r.skipped).toEqual([]);
    }
    // the Network may split earlier streets where later ones cross them: find each piece's settlement by where it is
    const nearest = (x: number, z: number) => m.settlements.reduce((b, s) => (Math.hypot(s.x - x, s.z - z) < Math.hypot(b.x - x, b.z - z) ? s : b));
    for (const s of m.settlements) {
      const segs = [...net.segs.values()].filter((sg) => { const a = net.node(sg.a); return nearest(a.x, a.z) === s; });
      expect(segs.length).toBeGreaterThan(0);
      const adj = new Map<number, number[]>();
      for (const sg of segs) for (const [x, y] of [[sg.a, sg.b], [sg.b, sg.a]]) { let l = adj.get(x); if (!l) adj.set(x, (l = [])); l.push(y); }
      const start = segs[0].a, seen = new Set([start]), todo = [start];
      while (todo.length) for (const y of adj.get(todo.pop()!) ?? []) if (!seen.has(y)) { seen.add(y); todo.push(y); }
      expect(seen.size).toBe(adj.size);
    }
  }, 60000);
});

describe('suggested links', () => {
  test('A roads between the cities and towns, B roads to every village, all reachable', () => {
    for (const seed of SEEDS) {
      const p = plan(seed), ss = p.settlements, links = suggestLinks(ss, p.water);
      const parent = ss.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      for (const l of links) parent[find(l.a)] = find(l.b);
      expect(new Set(ss.map((s) => find(s.id))).size).toBe(1);
      const major = ss.filter((s) => s.kind !== 'village');
      for (const l of links) {
        const a = ss[l.a], b = ss[l.b], m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        expect(l.road).toBe(a.kind === 'village' || b.kind === 'village' ? 'B' : 'A');
        // Gabriel: nobody of its tier inside the circle on the link
        const tier = l.road === 'A' ? major : ss;
        for (const c of tier) if (c !== a && c !== b) expect(Math.hypot(c.x - m.x, c.z - m.z)).toBeGreaterThanOrEqual(l.length / 2 - 1);
        expect(links.filter((k) => (k.a === l.a && k.b === l.b) || (k.a === l.b && k.b === l.a))).toHaveLength(1);
      }
      // every city and town has an A road; every village a B road, and at most a few
      for (const s of major) expect(links.some((l) => l.road === 'A' && (l.a === s.id || l.b === s.id))).toBe(true);
      for (const s of ss.filter((x) => x.kind === 'village')) {
        const n = links.filter((l) => l.a === s.id || l.b === s.id).length;
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(6);
      }
    }
  }, 30000);
});

describe('names', () => {
  test('invented, plausibly English, all different, and none a real UK place', () => {
    const all = new Set<string>();
    for (const seed of [...SEEDS, ...Array.from({ length: 30 }, (_, i) => 100 + i)]) {
      const r = rng(mix(seed, 4)), taken = new Set<string>();
      const names = Array.from({ length: 12 }, (_, i) => placeName(r, i > 3, taken));
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) {
        expect(n).toMatch(/^([A-Z][a-z]+ )?[A-Z][a-z]{3,}( [A-Z][a-z]+)*$/);
        expect(isRealPlace(n)).toBe(false);
        all.add(n);
      }
    }
    expect(all.size).toBeGreaterThan(300);
    // and the plan's places are named that way, each its own
    for (const seed of SEEDS) {
      const names = plan(seed).settlements.map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
      for (const n of names) expect(isRealPlace(n)).toBe(false);
    }
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
  test('every address opens the one map, the 50 km region (an old ?map=town or ?size=6 too)', () => {
    for (const q of ['', 'map=town', 'map=region&size=6&seed=5']) {
      const m = mapFromQuery(new URLSearchParams(q));
      expect(m.id).toBe('region');
      expect(m.world?.size).toBe(50000);
    }
    expect(mapFromQuery(new URLSearchParams('map=region&size=6&seed=5')).seed).toBe(5);
  });
  test('one seed always gives the same map', () => {
    const made = () => { const m = worldMapSpec({ seed: 3 }); return JSON.stringify({ ...m, world: { ...m.world, ms: 0 } }); }; // (but for how long it took)
    expect(made()).toBe(made());
  });
  test('the live area: plots are as central as their settlement’s size says, and the camera starts over the start town', () => {
    const m = worldMapSpec({ seed: 7 }, plan(7));
    const town = m.settlements[0], village = m.settlements.find((s) => s.kind === 'village');
    expect(town.kind).toBe('town');
    expect(centrality(m, { x: town.x + 100, z: town.z })).toBeCloseTo(100, 6); // a market town's metres are its own
    if (village) expect(centrality(m, village)).toBeGreaterThanOrEqual(60); // no towers in a village
    // a town's streets take its own centre; the stand-in centre for a village's street is square to it, as far as its size says
    expect(plotCentre(m, { x: town.x + 90, z: town.z }, { x: town.x + 110, z: town.z })).toEqual({ x: town.x, z: town.z });
    if (village) {
      const a = { x: village.x + 90, z: village.z }, b = { x: village.x + 110, z: village.z }, c = plotCentre(m, a, b);
      expect(c.x).toBeCloseTo(village.x + 100, 6);
      expect(Math.abs(c.z - village.z)).toBeGreaterThan(1);
    }
    expect(Math.hypot(m.view.x - town.x, m.view.z - town.z)).toBeLessThan(50);
    expect(m.line.length).toBeGreaterThanOrEqual(2);
  });
  test('the water is a height source the water library can fill: flat, dipping into each bed', () => {
    const spec: WaterSpec = { lakes: [{ x: 800, z: -600, r: 120, waves: [0.7, 2.1, 0.4] }], rivers: [{ path: Array.from({ length: 200 }, (_, i) => ({ x: -2000 + i * 20, z: 40 * Math.sin(i / 9) })), width: 18 }] };
    const mw = new MapWater(spec), L = spec.lakes[0], R = spec.rivers[0], m = R.path[100];
    expect(mw.ground(L.x, L.z)).toBeLessThan(-3);
    expect(mw.ground(m.x, m.z)).toBeLessThan(-2);
    for (const [x, z] of [[-1500, -1500], [1500, 1200], [0, -300]]) expect(mw.ground(x, z)).toBe(0);
  });
});

describe('options: a seed and a few settings make the map, repeatably', () => {
  const opts = [
    { seed: 3, rivers: 0, lakes: 4, style: 'desert' as const },
    { seed: 3, rivers: 3, lakes: 2, towns: 5, villages: 10, style: 'arctic' as const },
    { seed: 11, rivers: 2, lakes: 0, city: false, towns: 2, villages: 4 },
  ];
  test('options travel in the URL and come back the same', () => {
    for (const o of opts) {
      const full = regionOptions(o), q = new URLSearchParams(optionsQuery(full));
      expect(q.get('map')).toBe('region');
      expect(optionsFromQuery(q)).toEqual(full);
    }
    // (50 km is the one map, whatever size an old address asked for, with its own limits: docs/streaming.md)
    expect(optionsFromQuery(new URLSearchParams('map=region&size=6&rivers=9&style=lava&towns=-2'))).toMatchObject({ rivers: 4, style: 'temperate', towns: 0, size: 50 });
    expect(optionsFromQuery(new URLSearchParams('map=region&rivers=9&style=lava&towns=-2'))).toMatchObject({ rivers: 4, style: 'temperate', towns: 0, size: 50 });
    expect(optionsFromQuery(new URLSearchParams('map=region&size=13'))).toMatchObject({ size: 50 });
    expect(regionOptions({ city: false, towns: 0, villages: 0 }).villages).toBe(1); // (never an empty map)
    expect(regionOptions()).toMatchObject({ rivers: 2, towns: -1, lakes: -1, villages: -1 }); // (the seed decides the counts)
  });
  test('every style names real palette entries and crops, and temperate changes nothing', () => {
    for (const s of STYLES) {
      const L = STYLE_LOOKS[s];
      for (const k of Object.keys(L.palette)) expect(Object.keys(PALETTE)).toContain(k);
      for (const k of Object.keys(L.crops)) expect(CROP_NAMES).toContain(k);
      for (const hex of [...Object.values(L.palette), L.sky, L.trees.crown, L.trees.pine]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(STYLE_LOOKS.temperate.palette).toEqual({});
    expect(STYLE_LOOKS.temperate.trees).toMatchObject({ density: 1, pines: 0.3, crown: '#4f8a36', pine: '#2f6b35' });
    expect(STYLE_LOOKS.temperate.sky).toBe('#a9cbe3');
  });
});
