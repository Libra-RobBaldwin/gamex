// Parked cars stand on the ground (the user saw them "floating in the sky"): every car the
// parking draws is placed at its height above the ground, which the drape (drape.ts) then lifts
// onto the hills with everything else. A car given the ground's own height too would stand twice
// as high as the hill under it.
import { describe, expect, it } from 'vitest';
import { Parking, PARK_Y } from './parking';
import type { Lot } from '../roads';
import type { Bay } from '../buildgen';

// a hill: the start town on the 50 km map sits about 245 m up
const ground = (x: number, z: number) => 245 + 0.02 * x - 0.01 * z;
// what the drape does to a vertex: its height above the ground plus the ground under it
const drawnAt = (x: number, z: number, y: number) => y + ground(x, z);

describe('parked cars', () => {
  it('stand on the ground under them (within 0.5 m), on a hill', () => {
    const drawn: { x: number; z: number; y: number }[] = [];
    const fleet = { drawCar: (_d: unknown, parts: { x: number; z: number }[], y: number) => { drawn.push({ x: parts[0].x, z: parts[0].z, y }); } };
    const lot = { id: 1, x: 300, z: -200, rot: 0, w: 20, d: 20, h: 6, kind: 'office', seg: 1, seed: 0.3, row: 1, front: 5, back: 10, px: 0, pw: 20 } as Lot;
    const bays: Bay[] = Array.from({ length: 12 }, (_, i) => ({ x: 290 + i * 2.6, z: -190, hx: 0, hz: -1, via: [{ x: 290 + i * 2.6, z: -180 }, { x: 290 + i * 2.6, z: -186 }], heavy: false }));
    const p = new Parking(fleet as never, () => 0.1, () => ({ dress: { chain: [{}] } }) as never);
    p.hour = 12;
    p.view = { x: 300, z: -200, r: 400 };
    p.set(lot, bays);
    p.draw(0.016);
    expect(drawn.length).toBeGreaterThan(0);
    for (const c of drawn) {
      expect(Math.abs(c.y - PARK_Y)).toBeLessThan(1e-9);
      expect(Math.abs(drawnAt(c.x, c.z, c.y) - ground(c.x, c.z))).toBeLessThan(0.5);
    }
  });
});

// Kerbside parking (the user: "parked cars still look like horrible boxes, not actual vehicles,
// and vehicles should actually use parking spaces, not just block them up"): a street with
// parking bays gets kerbside spaces (roaddraw.ts kerbsideBays), one every 6 m along each side's
// band, clear of the stretch a stop paints out and of a crossing's zig-zags, never in the running
// lane; the parking holds real cars in them, a trip ending on the street parks at the kerb, and a
// car parked there pulls out and joins the traffic for a trip starting nearby.
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, stopSpan, type RoadOpts } from '../roads';
import { endsOf, kerbsideBays } from '../roaddraw';
import { courseOf } from '../xsection';
import { pedCrossingsOn, PEDX } from '../pedx';
import { kerbOf } from '../catalog';
import { Traffic, type Places } from '../traffic';

function street() {
  const net = new Network(() => false, 1000);
  net.build({ x: -150, z: 0 }, { x: 150, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'street-30-2.4-2.2-0' } as RoadOpts);
  const seg = [...net.segs.values()][0];
  // a kerbside stop on the a-to-b side, painting out the spaces along its markings
  const plan = net.planStop(seg.id, 80, 1);
  expect(plan.plans.length, plan.reason).toBeGreaterThan(0);
  net.addStop(seg.id, 80, 1, plan.plans[0]);
  const stop = seg.stops[0];
  return { net, seg, stop, L: net.length(seg) };
}
const lot = (id: number, x: number, kind: Lot['kind'], seg: number): Lot => ({ id, x, z: -14, rot: 0, w: 10, d: 10, h: 6, kind, seg, seed: 0.3, row: 1, front: 4, back: 10, px: 0, pw: 10 });

describe('kerbside parking', () => {
  it('a street with parking bays gets spaces both sides, clear of the stop, the crossings and the lane', () => {
    const { net, seg, stop, L } = street();
    const d = net.def(seg), sides = kerbsideBays(net, seg, new Map());
    expect(sides.map((s) => s.side).sort()).toEqual([-1, 1]);
    const C = courseOf(net, seg), pxs = pedCrossingsOn(net, seg, C, endsOf(new Map(), seg, C));
    expect(pxs.length, 'the street has a pedestrian crossing to keep clear of').toBeGreaterThan(0);
    const [a, b] = stopSpan(stop);
    for (const { side, bays } of sides) {
      expect(bays.length).toBeGreaterThan(10);
      for (const k of bays) {
        // in the parking band: its middle at the band's middle, its side clear of the lane
        const off = Math.abs(k.z);
        expect(Math.abs(off - (kerbOf(d) - d.parking / 2))).toBeLessThan(0.05);
        expect(off - 0.95, 'a car 1.9 m wide stands clear of the lane').toBeGreaterThan(d.lane);
        // nose along the kerb, the way that side's traffic drives (left of a to b on side 1)
        expect(Math.sign(k.hx)).toBe(side);
        expect(Math.abs(k.hz)).toBeLessThan(0.01);
        expect(k.s).toBeGreaterThan(0); expect(k.s).toBeLessThan(L);
        // the whole space clear of the stop's markings on its side
        if (side === stop.side) expect(k.s + 3 <= a || k.s - 3 >= b, `space at ${k.s.toFixed(1)} m clear of the stop (${a.toFixed(1)}–${b.toFixed(1)} m)`).toBe(true);
        // and of every crossing with its zig-zags
        const r = C.rhoOf(k.s), pad = (x: { kind: string }) => PEDX.zigzags * PEDX.zig + (x.kind === 'zebra' ? 1.8 : 2.8);
        for (const x of pxs) expect(r + 3 <= x.r - x.w / 2 - pad(x) || r - 3 >= x.r + x.w / 2 + pad(x), `space at ${r.toFixed(1)} m clear of the crossing at ${x.r.toFixed(1)} m`).toBe(true);
      }
      // spaces 6 m apart
      const ss = bays.map((k) => k.s).sort((p, q) => p - q);
      for (let i = 1; i < ss.length; i++) expect(ss[i] - ss[i - 1]).toBeGreaterThanOrEqual(6 - 1e-6);
    }
  });

  function town() {
    const { net, seg, L } = street();
    const traffic = new Traffic(net, new THREE.Scene(), rng(4));
    const parking = new Parking(traffic.fleet, rng(11), (_lot, heavy, sg) => {
      if (!sg) return null;
      for (let i = 0; i < 10; i++) { const d = traffic.fleet.dress(sg, heavy), m = d.dress.chain[0]; if (d.dress.chain.length === 1 && m.category === 'car') return d; }
      return null;
    });
    parking.hour = 12;
    parking.view = { x: 0, z: 0, r: 400 };
    traffic.parking = parking;
    let now = 0;
    const dt = 1 / 30;
    const run = (seconds: number, each?: () => void) => { for (let i = 0; i < seconds / dt; i++) { now += dt * 1000; traffic.update(dt, now); (traffic as unknown as { draw(dt: number, now: number): void }).draw(dt, now); parking.draw(dt); each?.(); } };
    return { net, seg, L, traffic, parking, run, now: () => now };
  }

  it('a trip ending at a plot with no room of its own parks at the kerb, nose first, on its side of the street', () => {
    const w = town();
    w.run(2); // (the spots are made once a second, for the roads near the view)
    expect(w.parking.hasKerb(w.seg.id, 1)).toBe(true);
    expect(w.parking.hasKerb(w.seg.id, -1)).toBe(true);
    const before = w.parking.kerbParked;
    expect(before, 'the street half full at midday (homes along it)').toBeGreaterThan(5);
    // a plot without a drive at x = 40, its way in on the street; the trip from the west end
    const home = lot(7, 40, 'house', w.seg.id);
    const access = w.traffic.accessOf(home);
    expect(access?.seg.id).toBe(w.seg.id);
    const car = w.traffic.trip({ seg: w.seg, s: 15 }, access!, false);
    expect(car).toBeTruthy();
    const freeBefore = w.parking.kerbFree(w.seg.id, 1).length;
    w.run(60);
    expect(w.parking.stats.kerbIn, 'it took a kerbside space').toBe(1);
    expect(w.parking.moving, 'and is in it').toBe(0);
    expect(w.parking.kerbParked).toBe(before + 1);
    expect(w.parking.kerbFree(w.seg.id, 1).length, 'on the side it drove along').toBe(freeBefore - 1);
    expect(w.traffic.stats.gaveUp).toBe(0);
  }, 60_000);

  it('a trip starting at a plot with no car of its own begins with a kerbside car pulling out and joining the traffic', () => {
    const w = town();
    w.run(2);
    const home = lot(7, -60, 'house', w.seg.id), job = lot(8, 120, 'office', w.seg.id);
    const places: Places = { homes: [home], jobs: [job], shops: [], works: [], weight: () => 1 };
    const parkedBefore = w.parking.kerbParked;
    let joined = 0, frame = 0;
    w.run(120, () => {
      if (frame++ % 150 === 0) w.traffic.generate(places, 8.2, 400, w.now()); // (a trip every five seconds at most: the street isn't a car park emptying at once)
      for (const c of w.traffic.cars) if (c.kind === 'car' && c.held === false && c.gone === undefined) joined++;
    });
    expect(w.parking.stats.kerbOut, 'a kerbside car pulled out').toBeGreaterThan(0);
    expect(w.traffic.stats.pulledOut).toBeGreaterThan(0);
    expect(joined, 'and drove on in the traffic once the parked car reached its place').toBeGreaterThan(0);
    expect(w.traffic.stats.noRoom).toBe(0);
    expect(w.parking.kerbParked).toBeLessThan(parkedBefore + 5); // (nothing filled the street back up on screen)
  }, 60_000);

  it('a street rebuilt or split keeps its parked cars where they stood', () => {
    const w = town();
    w.run(2);
    const before = w.parking.kerbParked, was = w.parking.kerbs().flatMap((k) => w.parking.kerbCars(k.key));
    expect(before).toBeGreaterThan(5);
    // the street split in two at its middle (a side road built onto it): the halves take the cars back
    w.net.split(w.seg.id, { x: 10, z: 0 });
    w.traffic.invalidate();
    w.run(2);
    expect(w.net.segs.has(w.seg.id)).toBe(false);
    expect(w.parking.hasKerb(w.seg.id, 1)).toBe(false);
    // every car whose space is still there (within half a space, on either half) is still in it;
    // one whose space went (the new junction's ends, a crossing moved) is gone
    const halves = [...w.net.segs.values()], spaces = halves.flatMap((h) => kerbsideBays(w.net, h, w.traffic.junctions).flatMap((x) => x.bays));
    const kept = was.filter((c) => spaces.some((b) => Math.hypot(b.x - c.x, b.z - c.z) < 3.5)).length;
    expect(kept, `of ${before} cars, those with a space still there`).toBeGreaterThan(before * 0.6);
    expect(w.parking.kerbParked, `the cars kept (${kept} of ${before} had a space still there)`).toBe(kept);
    const now = w.parking.kerbs().flatMap((k) => w.parking.kerbCars(k.key));
    for (const c of was) { const n = now.find((x) => x.car === c.car); if (n) expect(Math.hypot(n.x - c.x, n.z - c.z), 'a kept car stands where it did, near enough').toBeLessThan(3.5); }
  }, 60_000);
});
