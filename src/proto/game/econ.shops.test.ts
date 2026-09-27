// The town's shops keep up with its people (play round 3, docs/briefs/play.md): the game's town
// finds all its own goods until freight exists (GAME_TUNE local.goods = 1), and that used to mean
// its shops could never grow past the ones it started with, since the goods it found were a share
// of what it started with. Offices grew on the visitors the buses brought, the people followed the
// jobs, and by day 16 "shops within 20 min can serve only 29% of residents" with no tool to answer
// it. Now a supply the town finds all of caps nothing, and shops follow their customers.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { rng, type Lot } from '../roads';
import { Traffic } from '../traffic';
import { SCENARIOS, town } from '../trafficsim';
import { starterStops } from './crowdsites';
import { Lines } from './lines';
import { Purse } from './money';
import { TownEconomy } from './econ';

const SC = SCENARIOS.find((s) => s.name === 'the starter town')!;

// the game's world as main.ts wires it (as review.play.test.ts builds it): roads, the starter stops,
// traffic, a two-stop line with two buses, the town
function world() {
  const made = town({ ...SC, buses: 0 });
  const net = made.net;
  let queue: Lot[] = [];
  starterStops(net);
  net.lots = [];
  const plots = [...net.segs.keys()].flatMap((id) => net.plotsFor(id, { x: 0, z: 0 })).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  for (const [i, l] of plots.entries()) if (i % 5 === 4) queue.push(l); else if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  const traffic = new Traffic(net, new THREE.Scene(), rng(5));
  traffic.junctions = made.junctions;
  const lines = new Lines(traffic);
  const purse = new Purse();
  let clock = 7 * 60;
  const stops = [...net.segs.values()].flatMap((s) => s.stops.map((st) => st.id));
  const places = [...new Set(stops.map((id) => Math.min(...traffic.place(id)!.stops.map((s) => s.id))))];
  lines.add([places[0], places[1]], false, 2);
  const t = new TownEconomy({
    net, traffic, lines, purse, industrial: () => false, clock: () => clock,
    standing: () => net.lots.filter((l) => l.id >= 0),
    free: () => queue,
    build: (l) => { queue = queue.filter((x) => x !== l); if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); } },
    rebuild: (l, kind) => { l.kind = kind; },
    clear: (l) => { net.lots = net.lots.filter((x) => x !== l); queue.push(l); },
  }, 1);
  const run = (minutes: number) => { let m = 0, sync = 0; while (m < minutes) { const d = Math.min(10, minutes - m); clock += d; t.advance(d); m += d; sync += d; if (sync >= 30) { sync = 0; t.sync(); } } };
  return { net, town: t, run };
}

describe('the shops keep up with the town', () => {
  it('a town that finds all its own goods builds shops as its people come, and its shop reach holds', () => {
    const p = world();
    p.run(60);
    const shops = () => p.net.lots.filter((l) => l.kind === 'shop').length;
    const shops0 = shops(), res0 = p.town.report?.residents ?? 0;
    let worst = 1;
    for (let d = 1; d <= 20; d++) {
      p.run(1440);
      worst = Math.min(worst, p.town.report!.reach.shop);
    }
    const r = p.town.report!;
    // the town grew on the line's visitors, and its shops with it
    expect(r.residents).toBeGreaterThan(res0 * 1.1);
    expect(shops()).toBeGreaterThan(shops0);
    // nobody was ever far from a shop (it read 0.61 by day 21 before, and 0.29 on the radial town)
    expect(worst).toBeGreaterThan(0.9);
    expect(r.reach.shop).toBeGreaterThan(0.9);
    // and no use the town never had is asked for (works: the town has no industry, and finds no materials for none)
    expect(r.reasons.map((x) => x.text).join(' ')).not.toMatch(/nowhere left to build works|only .* supplied with goods/);
  }, 120_000);
});
