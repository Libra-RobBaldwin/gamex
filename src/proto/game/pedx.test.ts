// Zebra and pelican crossings along the roads (pedx.ts): where they go (clear of junctions and bus
// stops, the right kind for the road), and the people using them: at a pelican only on the green
// man, after the traffic's had its amber, with traffic held at the stop line.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, stopSpan } from '../roads';
import { design, landFits, legsAt, type Junction } from '../junction';
import { Traffic } from '../traffic';
import { courseOf } from '../xsection';
import { endsOf } from '../roaddraw';
import { PEDX, pedCrossingsOn } from '../pedx';
import { roadSites, starterStops } from './crowdsites';
import { TownCrowds } from './crowds';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
// avenues crossing, a street off one of them, bus stops on both
function town() {
  const net = new Network(() => false, 900);
  net.build({ x: -300, z: 0 }, { x: 300, z: 0 }, undefined, as('avenue'));
  net.build({ x: 0, z: -300 }, { x: 0, z: 300 }, undefined, as('avenue'));
  net.build(net.snapStart({ x: 0, z: -200 }, 3), { x: 260, z: -200 }, undefined, as('street'));
  const junctions = new Map<number, Junction>();
  for (const nd of net.nodes.values()) {
    if (legsAt(net, nd.id).length < 3) continue;
    const j = design(net, nd.id, { fits: (p) => landFits(net, nd.id, p) });
    if (j) { junctions.set(nd.id, j); net.land.claim(`junction:${nd.id}`, 'junction', j.shape?.claims ?? []); }
  }
  for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 0, z: 0 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  starterStops(net, [{ x: -150, z: 0 }, { x: 130, z: -200 }]);
  return { net, junctions };
}

describe('pedestrian crossings', () => {
  const { net, junctions } = town();
  const all = [...net.segs.values()].flatMap((s) => { const C = courseOf(net, s); return pedCrossingsOn(net, s, C, endsOf(junctions, s, C)).map((x) => ({ x, s, C, ends: endsOf(junctions, s, C) })); });

  it('puts zebras on streets and pelicans on avenues, clear of junctions and stops', () => {
    expect(all.some(({ x }) => x.kind === 'zebra')).toBe(true);
    expect(all.some(({ x }) => x.kind === 'pelican')).toBe(true);
    for (const { x, s, C, ends } of all) {
      expect(x.kind).toBe(net.def(s).family === 'Avenue' ? 'pelican' : 'zebra');
      expect(x.r - ends.line[0]).toBeGreaterThanOrEqual(PEDX.clear - 1e-6);
      expect(C.len - ends.line[1] - x.r).toBeGreaterThanOrEqual(PEDX.clear - 1e-6);
      for (const st of s.stops) {
        const [a, b] = stopSpan(st).map((t) => C.rhoOf(t)).sort((p, q) => p - q);
        expect(x.r < a - PEDX.fromStop + 1e-6 || x.r > b + PEDX.fromStop - 1e-6).toBe(true);
      }
    }
    // and people wait at both kerbs of every one
    const sites = roadSites(net, junctions).crossings.filter((c) => c.kind);
    expect(sites.length).toBe(all.length);
  });

  it('gives people the green man at a pelican only after the traffic has had its amber, and holds traffic at the line', () => {
    const scene = new THREE.Scene(), traffic = new Traffic(net, scene, rng(4));
    traffic.junctions = junctions;
    const crowds = new TownCrowds({ scene, net, junctions, traffic, regions: () => [] }, 4);
    const cam = new THREE.OrthographicCamera(-50, 50, 100, -100, 1, 4000);
    cam.position.set(500, 600, 500); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const pel = all.find(({ x }) => x.kind === 'pelican')!.x;
    const seen: string[] = [];
    let held = false;
    // the morning peak, a quarter of a second at a time
    for (let i = 0; i < 1600; i++) {
      crowds.update(cam, 915, 0.25, 0.25, 8 * 60 + i / 60);
      const l = crowds.pelicanLight(pel.id) ?? 'off';
      if (seen[seen.length - 1] !== l) seen.push(l);
      const h = traffic.crossing.get(pel.seg);
      if (h?.some((p) => p.stand !== undefined)) { held = true; expect(h.find((p) => p.stand !== undefined)!.stand).toBeCloseTo(pel.w / 2 + 2.5); }
    }
    // green, amber, red (the green man), flashing amber, green again
    const cycle = seen.join(' ');
    expect(cycle).toMatch(/green amber red (amber|off)/);
    expect(held).toBe(true);
  });
});
