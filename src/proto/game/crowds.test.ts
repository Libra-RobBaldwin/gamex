// The town's people: where they can be (every footway on a pavement, clear of the carriageway and
// of junction corners; queues by the shelter; kerbs at junction arms; parks, pubs, works gates),
// and the crowds on the buses: the queue walks to the door and the bus waits for them.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, closestOnPath, kerbOf, rng, type Lot } from '../roads';
import { design, landFits, legsAt, type Junction } from '../junction';
import { Traffic } from '../traffic';
import { findRegions } from '../infill';
import { roadSites, lotSites, frontage, starterStops, PAVE_Y } from './crowdsites';
import { TownCrowds, TownNumbers } from './crowds';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
// a crossroads of avenues with a street off one arm, plots along everything
function town(stops = true) {
  const net = new Network(() => false, 900);
  net.zoneAt = (p) => (p.z < -150 ? 'industrial' : 'town');
  net.build({ x: -300, z: 0 }, { x: 300, z: 0 }, undefined, as('avenue'));
  net.build({ x: 0, z: -300 }, { x: 0, z: 300 }, undefined, as('avenue'));
  net.build(net.snapStart({ x: 0, z: -200 }, 3), { x: 200, z: -200 }, undefined, as('street'));
  const junctions = new Map<number, Junction>();
  for (const nd of net.nodes.values()) {
    if (legsAt(net, nd.id).length < 3) continue;
    const j = design(net, nd.id, { fits: (p) => landFits(net, nd.id, p) });
    if (j) { junctions.set(nd.id, j); net.land.claim(`junction:${nd.id}`, 'junction', j.shape?.claims ?? []); }
  }
  for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 0, z: 0 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  if (stops) starterStops(net, [{ x: -150, z: 0 }, { x: 100, z: -200 }]);
  return { net, junctions };
}
const offsetFrom = (net: Network, seg: number, p: { x: number; z: number }) => closestOnPath(p, net.path(net.segs.get(seg)!)).d;

describe('where the crowds can be', () => {
  const { net, junctions } = town();
  const sites = roadSites(net, junctions);

  it('walks every road with a pavement, both sides, on the pavement and not the road', () => {
    const withPave = [...net.segs.values()].filter((s) => net.def(s).pave > 0);
    for (const s of withPave) for (const side of [1, -1]) expect(sites.footways.some((f) => f.seg === s.id && f.side === side)).toBe(true);
    for (const f of sites.footways) {
      const d = net.def(net.segs.get(f.seg)!), K = kerbOf(d);
      expect(f.y).toBeCloseTo(PAVE_Y);
      for (const p of f.line) {
        const o = offsetFrom(net, f.seg, p);
        // (a lay-by moves the kerb out by up to its depth)
        expect(o - f.width / 2).toBeGreaterThanOrEqual(K - 0.01);
        expect(o + f.width / 2).toBeLessThanOrEqual(K + d.pave + 0.01);
      }
    }
  });

  it('stops each footway short of the corners, never out into the other roads at a junction', () => {
    let near = 0;
    for (const j of junctions.values()) {
      const n = net.node(j.node);
      for (const f of sites.footways) for (const p of [f.line[0], f.line[f.line.length - 1]]) {
        if (Math.hypot(p.x - n.x, p.z - n.z) > 40) continue;
        near++;
        // clear of every other road's carriageway there, by more than a person's width
        for (const s of net.segsAt(j.node)) if (s.id !== f.seg) expect(offsetFrom(net, s.id, p)).toBeGreaterThan(kerbOf(net.def(s)) + 0.5);
      }
    }
    expect(near).toBeGreaterThan(8);
  });

  it('queues on the pavement by each stop, with the doors at the kerb', () => {
    expect(sites.stops.length).toBe(4);
    for (const s of sites.stops) {
      const seg = net.segs.get(s.seg)!, d = net.def(seg), st = seg.stops.find((x) => x.id === s.stop)!;
      const K = kerbOf(d) + (st.kind === 'layby' ? st.take.pave + st.take.land : 0);
      const at = offsetFrom(net, s.seg, s.site.at), door = offsetFrom(net, s.seg, s.door);
      expect(at).toBeGreaterThan(K);
      expect(at).toBeLessThan(kerbOf(d) + d.pave);
      expect(door).toBeLessThan(K);
      expect(door).toBeGreaterThan(K - 1);
      // on the stop's own side of the road
      expect(net.sideOf(seg, s.site.at)).toBe(st.side);
      expect(net.sideOf(seg, s.door)).toBe(st.side);
    }
  });

  it('puts both kerbs of each junction arm across the road from each other', () => {
    // the crossroads' four arms and the T's three
    expect(sites.crossings.length).toBe(7);
    for (const c of sites.crossings) {
      const [a, b] = c.kerbs, w = Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z);
      const K = kerbOf(net.def(net.segs.get(c.seg)!));
      expect(w).toBeCloseTo(2 * (K + 0.55), 1);
      expect(net.sideOf(net.segs.get(c.seg)!, a.at)).not.toBe(net.sideOf(net.segs.get(c.seg)!, b.at));
    }
  });

  it('finds the parks, pubs and works gates the town has', () => {
    const { regions, civics } = findRegions(net, []);
    const pub: Lot = { ...civics[0], arch: 'pub', kind: 'civic' };
    if (civics.length) net.lots.push(pub);
    frontage(net, sites);
    const l = lotSites(net, regions, sites.footways, sites.stops);
    expect(l.parks.length).toBeGreaterThan(0);
    for (const p of l.parks) for (const path of p.paths) expect(path.length).toBe(2);
    const works = net.lots.filter((x) => x.kind === 'industry');
    expect(works.length).toBeGreaterThan(0);
    expect(l.works.length).toBe(works.length);
    // every gate has a walk up to it; 40 m or more where the footway allows, even one right by a stop
    const lens = l.works.map((w) => { let L = 0; for (let i = 1; i < w.path.length; i++) L += Math.hypot(w.path[i].x - w.path[i - 1].x, w.path[i].z - w.path[i - 1].z); return L; }).sort((a, b) => a - b);
    for (const L of lens) expect(L).toBeGreaterThan(12);
    expect(lens[Math.floor(lens.length / 2)]).toBeGreaterThan(38);
    if (civics.length) expect(l.venues.some((v) => v.venue === 'pub')).toBe(true);
  });
});

describe('the crowds on the buses', () => {
  it('takes the queue aboard and holds the bus until the last is on', () => {
    const { net, junctions } = town();
    const scene = new THREE.Scene(), traffic = new Traffic(net, scene, rng(4));
    traffic.junctions = junctions;
    const crowds = new TownCrowds({ scene, net, junctions, traffic, regions: () => [] }, 4);
    const cam = new THREE.OrthographicCamera(-50, 50, 100, -100, 1, 4000);
    cam.position.set(-150 + 500, 600, 500); cam.lookAt(-150, 0, 0); cam.updateMatrixWorld();
    // the morning peak, long enough for queues to form
    for (let i = 0; i < 40; i++) crowds.update(cam, 915, 0.25, 0.25, 8 * 60 + i);
    const seg = [...net.segs.values()].find((s) => s.stops.length && net.def(s).family === 'Avenue')!, st = seg.stops[0];
    const before = crowds.stopUse(seg, st).waiting;
    expect(before).toBeGreaterThan(3);
    const dwell = traffic.onBusStop!(seg, st, 1);
    const after = crowds.stopUse(seg, st);
    expect(after.boarded).toBeGreaterThan(0);
    expect(after.waiting).toBe(before - after.boarded);
    // a second or so a person, boarding one after another, then a moment to pull away
    expect(dwell).toBeGreaterThan(Math.min(7, after.boarded * 1.1));
    expect(dwell).toBeLessThanOrEqual(30);
    // once the queue is gone, a bus is kept no longer than it always was
    for (let bus = 2; crowds.stopUse(seg, st).waiting > 0 && bus < 10; bus++) traffic.onBusStop!(seg, st, bus);
    expect(crowds.stopUse(seg, st).waiting).toBe(0);
    expect(traffic.onBusStop!(seg, st, 20)).toBe(7);
  });

  it('follows the time of day: busy at the rush hour, quiet at night', () => {
    const n = new TownNumbers();
    const f = { id: 'f', seg: 1, side: 1 as const, line: [], width: 3, y: 0, length: 100, residents: 40, jobs: 60, shops: 0 };
    expect(n.footfall(f, 8.2 * 60)).toBeGreaterThan(3 * n.footfall(f, 3 * 60));
    expect(n.footfall(f, 13 * 60)).toBeGreaterThan(n.footfall(f, 3 * 60));
  });
});
