// The logic review of 26 Sep 2026 (docs/reports/review-2026-09-26.md on claude/review-2026-09-26), the
// rows owned by the play session: stops, a line, buses, fares and the goal card on the game's real modules
// without the drawing (the harness save.test.ts uses). Each test captured something seen wrong.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, rng, subPath, type Lot } from '../roads';
import { Traffic } from '../traffic';
import { SCENARIOS, town } from '../trafficsim';
import { starterStops } from './crowdsites';
import { Lines } from './lines';
import { Purse } from './money';
import { STOP_WALK_M, TownEconomy } from './econ';
const log = (..._a: unknown[]) => {}; // (measurements went to a scratch file while reviewing; the assertions carry the numbers now)

const SC = SCENARIOS.find((s) => s.name === 'the starter town')!;

// the game's world as main.ts wires it: roads, the starter stops, traffic, lines, purse, town
function world(opts: { lines?: 'none' | 'two' | 'pair'; buses?: number } = {}) {
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
  if (opts.lines === 'two') {
    lines.add(places.slice(0, 3), false, opts.buses ?? 2);
    lines.add([places[places.length - 1], places[1], places[places.length - 2]], false, 1);
  } else if (opts.lines === 'pair') lines.add([places[0], places[1]], false, opts.buses ?? 2);
  const t = new TownEconomy({
    net, traffic, lines, purse, industrial: () => false, clock: () => clock,
    standing: () => net.lots.filter((l) => l.id >= 0),
    free: () => queue,
    build: (l) => { queue = queue.filter((x) => x !== l); if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); } },
    rebuild: (l, kind) => { l.kind = kind; },
    clear: (l) => { net.lots = net.lots.filter((x) => x !== l); queue.push(l); },
  }, 1);
  return {
    net, traffic, lines, purse, town: t, places, get queue() { return queue; }, get clock() { return clock; },
    // game minutes, in chunks a frame would hand over (`chunk` minutes each), with a sync every so often
    run(minutes: number, chunk = 10) {
      let m = 0, sync = 0;
      while (m < minutes) { const d = Math.min(chunk, minutes - m); clock += d; t.advance(d); m += d; sync += d; if (sync >= 30) { sync = 0; t.sync(); } }
    },
    days(n: number, chunk?: number) { const out: string[] = []; for (let d = 0; d < n; d++) { this.run(1440, chunk); out.push(t.report!.status); } return out; },
  };
}


describe('riders a day', () => {
  it('as the line sheet and the milestones count them, is not more than twice the town', () => {
    const p = world({ lines: 'pair' });
    p.run(60);
    p.days(3);
    const r = p.town.report!;
    // (main.ts ridersADay: a line's carried count is a town-day's riders, the purse's month fiction is its own)
    const ridersADay = p.lines.list.reduce((a, l) => { const st = p.town.line(l.id); return a + (st ? (st.carriedLastMonth || st.carried) : 0); }, 0);
    log('riders a day (x30)', ridersADay, 'carried', p.town.line(p.lines.list[0].id)?.carriedLastMonth, 'residents', r.residents, 'load', p.town.line(p.lines.list[0].id)?.loadFactor);
    expect(ridersADay, `one two-stop line, ${Math.round(r.residents)} residents, buses ${Math.round((p.town.line(p.lines.list[0].id)?.loadFactor ?? 0) * 100)}% full`).toBeLessThanOrEqual(r.residents * 2);
    // (and the 12,000-riders milestone, the last on the ladder, isn't reached by the first line)
    expect(ridersADay / 12000).toBeLessThan(1);
  }, 60_000);
});

// ---------- money ----------

describe('stops as the economy sees them', () => {
  it.fails('stand within a few metres of where they are on the road', () => {
    const w = world({ lines: 'none' });
    let worst = 0, at = '';
    for (const seg of w.net.segs.values()) for (const st of seg.stops) {
      const p = w.net.path(seg), L = Math.max(1, w.net.length(seg));
      const q = p[Math.min(p.length - 1, Math.max(0, Math.round((st.s / L) * (p.length - 1))))];
      const t = subPath(p, Math.max(0, st.s - 0.5), st.s + 0.5)[0];
      const d = Math.hypot(q.x - t.x, q.z - t.z);
      if (d > worst) { worst = d; at = `stop ${st.id} on seg ${seg.id} (${p.length} points, ${Math.round(L)} m)`; }
    }
    log('stop position error', worst, at);
    expect(worst, at).toBeLessThan(10);
  });
});

// ---------- the goal card ----------
// updateGoal() (main.ts) counts every stop on every road: "Step 1 of 3 · n of 2 stops", and at 2
// says "Draw a bus line through your stops". Two stops facing each other are one place to the line
// tool (Lines.same), so a player who builds a pair at one spot is sent to draw a line that can't
// be drawn.
describe('the goal card', () => {
  it.fails('asks for a line only when there are two places a line could join', () => {
    const made = town({ ...SC, buses: 0 });
    const net = made.net;
    starterStops(net, [{ x: -85, z: 0 }]); // (one point: a stop on each side of the road, as the stop tool builds them one tap each)
    const traffic = new Traffic(net, new THREE.Scene(), rng(1));
    const lines = new Lines(traffic);
    let stops = 0;
    for (const sg of net.segs.values()) stops += sg.stops.length;
    const ids = [...net.segs.values()].flatMap((s) => s.stops.map((st) => st.id));
    const places = new Set(ids.map((id) => Math.min(...traffic.place(id)!.stops.map((s) => s.id))));
    log('goal stops', stops, 'places', places.size, 'same', lines.same(ids[0], ids[1]));
    const goalSaysDrawALine = stops >= 2;
    const aLineCanBeDrawn = places.size >= 2 && !lines.same(ids[0], ids[1]);
    expect(goalSaysDrawALine).toBe(aLineCanBeDrawn);
  });
});

// The same misplacement, as the economy's catchments and the coverage overlay see it: the overlay
// (main.ts drawCoverage) rings the stop where it is (markers.places(), by subPath); the economy
// counts homes within STOP_WALK_M of the index-approximated point.
describe('stop catchments', () => {
  it.fails('count the same homes the coverage overlay rings', () => {
    const w = world({ lines: 'none' });
    const homes = w.net.lots.filter((l) => l.kind === 'house' || l.kind === 'terrace' || l.kind === 'flats' || l.kind === 'tower');
    let differ = 0, worstStop = '';
    for (const seg of w.net.segs.values()) for (const st of seg.stops) {
      const p = w.net.path(seg), L = Math.max(1, w.net.length(seg));
      const q = p[Math.min(p.length - 1, Math.max(0, Math.round((st.s / L) * (p.length - 1))))];
      const t = subPath(p, Math.max(0, st.s - 0.5), st.s + 0.5)[0];
      const inQ = homes.filter((l) => Math.hypot(l.x - q.x, l.z - q.z) <= STOP_WALK_M).length;
      const inT = homes.filter((l) => Math.hypot(l.x - t.x, l.z - t.z) <= STOP_WALK_M).length;
      if (inQ !== inT) { differ++; worstStop = `stop ${st.id}: ${inT} homes ringed by the overlay, ${inQ} counted by the economy`; }
    }
    log('catchment mismatch at', differ, 'stops;', worstStop);
    expect(differ, worstStop).toBe(0);
  });
});

// ---------- a road joined at a stop ----------
// The bulldozer won't take a stop a line calls at (main.ts bulldozeTap), but Network.check has no
// such guard: a road joined onto a stop's road where the stop stands splits the road (roads.ts:392)
// and drops every stop straddling the join, both poles of a pair, with no warning (the road tool
// only warns about lots). onRoadsChanged() -> lines.prune() then takes the call off the line; a
// two-stop line goes altogether, and lines.ts remove() takes its buses off the road with no refund
// (main.ts refunds only on Withdraw).
describe('a road joined where a stop stands', () => {
  function join(w: ReturnType<typeof world>) {
    const l = w.lines.list[0], tapped = l.stops[0], pl = w.traffic.place(tapped)!;
    const path = w.net.path(pl.seg), at = subPath(path, Math.max(0, pl.stops[0].s - 0.5), pl.stops[0].s + 0.5)[0];
    const dx = path[path.length - 1].x - path[0].x, dz = path[path.length - 1].z - path[0].z, n = Math.hypot(dx, dz) || 1;
    const a = w.net.snapStart({ x: at.x, z: at.z }, 6), b = { x: at.x - (dz / n) * 120, z: at.z + (dx / n) * 120 }; // (a street off it, at right angles)
    const c = w.net.check(a, b, undefined, { ...DEFAULT_OPTS, type: 'street' });
    const before = w.lines.buses(l).length, balance = w.purse.balance, stops = [...w.net.segs.values()].reduce((k, s) => k + s.stops.length, 0);
    if (c.ok) w.net.build(a, b, undefined, { ...DEFAULT_OPTS, type: 'street' });
    w.traffic.invalidate();
    w.lines.prune();
    const stopsAfter = [...w.net.segs.values()].reduce((k, s) => k + s.stops.length, 0);
    return { l, check: c, before, balance, stops, stopsAfter };
  }
  it('warns, or keeps the stop and the line', () => {
    const w = world({ lines: 'pair' });
    const r = join(w);
    expect(r.check.ok, `Network.check: ${r.check.reason}`).toBe(true); // (nothing stops the road being built there)
    expect(r.stopsAfter, `${r.stops} stops before the road, ${r.stopsAfter} after`).toBe(r.stops);
    expect(w.lines.list).toContain(r.l);
  });
  it('or at least refunds the buses the line loses', () => {
    const w = world({ lines: 'pair' });
    const r = join(w);
    const after = w.lines.list.includes(r.l) ? w.lines.buses(r.l).length : 0;
    expect(r.before).toBe(2);
    expect(after === r.before || w.purse.balance > r.balance || w.purse.today.sold > 0, `${r.before} buses before, ${after} after, balance ${r.balance} -> ${w.purse.balance}, sold ${w.purse.today.sold}`).toBe(true);
  });
});

// ---------- the map's people vs the panel's ----------
// On a map of many places the labels and the Places list count a live place's people as the pop
// of its home lots (main.ts peopleIn: USE[kind].pop per lot); the town panel shows the economy's
// residents (occupancy). Measured on the starter town.
