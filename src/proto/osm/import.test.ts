import { describe, expect, it } from 'vitest';
import banbury from './fixtures/banbury.json';
import { classify } from './tags';
import { importOsm } from './import';
import { localProjection } from './projection';

describe('projection', () => {
  const proj = localProjection({ lat: 52.0615, lon: -1.332 });
  it('puts east on +x and north on −z, in metres', () => {
    const e = proj.toLocal(52.0615, -1.332 + 0.01), n = proj.toLocal(52.0615 + 0.01, -1.332);
    // a hundredth of a degree: about 685 m of longitude and 1113 m of latitude at Banbury
    expect(e.x).toBeGreaterThan(680); expect(e.x).toBeLessThan(690); expect(Math.abs(e.z)).toBeLessThan(1);
    expect(n.z).toBeLessThan(-1110); expect(n.z).toBeGreaterThan(-1116); expect(Math.abs(n.x)).toBeLessThan(0.01);
  });
  it('comes back to the same place', () => {
    for (const p of [{ x: 700, z: -650 }, { x: -1200, z: 900 }, { x: 0, z: 0 }]) {
      const q = proj.toLocal(proj.toLatLon(p).lat, proj.toLatLon(p).lon);
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(1e-3);
    }
  });
});

describe('importing Banbury', () => {
  const r = importOsm(banbury);
  const segsOf = new Map<number, number[]>();
  for (const road of r.roads.values()) for (const w of road.ways) { if (!segsOf.has(w)) segsOf.set(w, []); segsOf.get(w)!.push(road.seg); }

  it('carries the attribution', () => {
    expect(banbury.attribution).toMatch(/OpenStreetMap contributors/);
    expect(banbury.attribution).toMatch(/ODbL|Open Database Licence/);
  });

  it('builds a network of the expected size', () => {
    expect(r.net.segs.size).toBeGreaterThan(900);
    expect(r.net.segs.size).toBeLessThan(1200);
    expect(r.stats.railSegs).toBeGreaterThanOrEqual(4);
    expect(r.buildings.length).toBeGreaterThan(1550);
    expect(r.zones.filter((z) => z.kind === 'industrial').length).toBeGreaterThan(3);
    expect(r.net.lots.length).toBe(r.buildings.length);
  });

  it('finds the roundabouts, Banbury Cross and Castle Roundabout among them', () => {
    expect(r.hints.filter((h) => h.form === 'roundabout').length).toBeGreaterThanOrEqual(6);
    for (const name of ['Banbury Cross', 'Castle Roundabout']) {
      const h = r.hints.find((x) => x.name === name)!;
      expect(h.complete).toBe(true);
      expect(h.radius).toBeGreaterThan(6);
      expect(h.radius).toBeLessThan(25);
      expect(r.net.segsAt(h.netNode).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('pairs the dual carriageways and the double-track main line', () => {
    const paired = [...r.roads.values()].filter((x) => x.paired);
    expect(paired.some((x) => x.name === 'Concord Avenue' && x.type.startsWith('dual'))).toBe(true);
    expect(paired.some((x) => x.name === 'Cherwell Street')).toBe(true);
    expect(paired.filter((x) => x.type === 'rail-main').length).toBeGreaterThan(2);
  });

  it('puts Banbury station on the railway', () => {
    const st = r.stations.find((s) => s.name === 'Banbury')!;
    expect(st.seg).toBeDefined();
    expect(r.net.def(r.net.segs.get(st.seg!)!).cls).toBe('rail');
  });

  it('knows where the water is', () => {
    const canal = r.water.lines.find((l) => l.kind === 'canal') ?? r.water.lines[0];
    expect(r.isWater(canal.path[Math.floor(canal.path.length / 2)])).toBe(true);
    const cross = r.hints.find((x) => x.name === 'Banbury Cross')!;
    expect(r.isWater(cross.at)).toBe(false);
  });

  it('joins roads wherever OSM ways share a node', () => {
    const ringNodes = new Map<number, number>(); // OSM ring way → roundabout node
    for (const h of r.hints) for (const w of h.ways) ringNodes.set(w, h.netNode);
    const touches = (a: number[], b: number[]) => a.some((x) => b.some((y) => {
      if (x === y) return true;
      const s = r.net.segs.get(x)!, t = r.net.segs.get(y)!;
      return s.a === t.a || s.a === t.b || s.b === t.a || s.b === t.b;
    }));
    const byNode = new Map<number, number[]>();
    for (const w of r.data.ways.values()) {
      if (!w.tags || classify(w.tags).kind === 'skip' || r.dropped.has(w.id)) continue;
      for (const n of new Set(w.nodes)) { if (!byNode.has(n)) byNode.set(n, []); byNode.get(n)!.push(w.id); }
    }
    let pairs = 0;
    const broken: string[] = [];
    for (const [n, ways] of byNode) for (let i = 0; i < ways.length; i++) for (let j = i + 1; j < ways.length; j++) {
      const a = r.data.ways.get(ways[i])!, b = r.data.ways.get(ways[j])!;
      if (!!a.tags!.railway !== !!b.tags!.railway) continue; // level crossings stay apart
      pairs++;
      const ra = ringNodes.get(a.id), rb = ringNodes.get(b.id);
      if (ra !== undefined && rb !== undefined) continue; // two pieces of one ring
      if (ra !== undefined || rb !== undefined) {
        const node = (ra ?? rb)!, other = ra !== undefined ? b : a;
        if (!(segsOf.get(other.id) ?? []).some((s) => r.net.segs.get(s)!.a === node || r.net.segs.get(s)!.b === node)) broken.push(`${other.id} misses the roundabout at node ${n}`);
        continue;
      }
      const sa = segsOf.get(a.id) ?? [], sb = segsOf.get(b.id) ?? [];
      // a way that vanished entirely has to be listed as unsupported
      const listed = (id: number) => r.unsupported.some((u) => u.ways.includes(id));
      if (!sa.length || !sb.length) { if (!(sa.length || listed(a.id)) || !(sb.length || listed(b.id))) broken.push(`${a.id}/${b.id} lost`); continue; }
      if (!touches(sa, sb)) broken.push(`${a.id} and ${b.id} share node ${n} but their roads don't meet`);
    }
    expect(pairs).toBeGreaterThan(800);
    expect(broken).toEqual([]);
  });

  it('has no segment twice', () => {
    const seen = new Map<string, number[]>();
    for (const s of r.net.segs.values()) {
      const k = `${Math.min(s.a, s.b)}-${Math.max(s.a, s.b)}`;
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push(s.id);
    }
    for (const ids of seen.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = r.net.path(r.net.segs.get(ids[i])!), q = r.net.path(r.net.segs.get(ids[j])!);
      // two roads between the same junctions must at least take different routes
      const far = Math.max(...q.map((x) => Math.min(...p.map((y) => Math.hypot(x.x - y.x, x.z - y.z)))));
      expect(far).toBeGreaterThan(6);
    }
    expect([...r.net.segs.values()].every((s) => s.a !== s.b)).toBe(true);
  });

  it('lists what it could not represent, with a place for each', () => {
    const kinds = new Set(r.unsupported.map((u) => u.kind));
    for (const k of ['one-way street', 'slip road', 'pedestrian street', 'railway siding']) expect(kinds).toContain(k);
    for (const u of r.unsupported) {
      expect(Number.isFinite(u.at.x) && Number.isFinite(u.at.z)).toBe(true);
      expect(u.latLon.lat).toBeGreaterThan(52);
      expect(u.latLon.lat).toBeLessThan(52.1);
    }
  });

  it('gives every road a catalogue type and every building a height', () => {
    for (const s of r.net.segs.values()) expect(r.net.def(s)).toBeDefined();
    for (const b of r.buildings) { expect(b.h).toBeGreaterThan(2); expect(b.lot.w).toBeGreaterThan(0); }
    const tagged = r.buildings.filter((b) => b.tags['building:levels']);
    expect(tagged.length).toBeGreaterThan(100);
  });
});
