import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUDGETS, PeopleStore } from './store';
import { Crowds, footwaysOf, stopSite, windowRamp, type Flow } from './flows';
import { Mode } from './track';

// the game's camera: orthographic, looking down at 0.6 rad from the south-east
function camera(x: number, z: number, h: number, aspect = 412 / 860) {
  const c = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, 1, 4000);
  const az = Math.PI / 4, el = 0.6, d = 1200;
  c.position.set(x + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, z + Math.cos(az) * Math.cos(el) * d);
  c.lookAt(x, 0, z);
  c.updateMatrixWorld();
  return c;
}
function town() {
  const store = new PeopleStore(), crowds = new Crowds(store);
  return { store, crowds };
}
// run the placement and the store for a while, as the game's frame loop would
function run(t: ReturnType<typeof town>, flows: () => Flow[], clock: number, secs: number, cam = camera(0, 0, 40)) {
  for (let s = 0; s < secs; s += 0.05) { t.crowds.set(flows(), clock); t.store.update(cam, 860, 0.05); }
}
const visible = (t: ReturnType<typeof town>, group: string, cat: Parameters<PeopleStore['figures']>[0] = 'people') => t.store.figures(cat).filter((f) => f.group === group && f.alpha > 0.5);
const street = [{ x: -60, z: 0 }, { x: 60, z: 0 }];
const [north, south] = footwaysOf(street, 3.25, 6.25);
const stop = stopSite('stop', { x: 10, z: 0 }, 0, 1, 3.25, 6.25, { shelter: true });

describe('queues at stops', () => {
  it('shows exactly as many as are waiting, on the pavement by the flag, facing the road', () => {
    const t = town();
    let waiting = 12;
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting }], 480, 2);
    const q = visible(t, 'stop');
    expect(q).toHaveLength(12);
    for (const f of q) {
      expect(f.z).toBeLessThan(-3.25); // the north pavement: left of a bus going +x
      expect(f.z).toBeGreaterThan(-6.25);
      expect(Math.abs(f.x - 10)).toBeLessThan(14);
    }
    // one more arrives: the twelve already there don't move or change
    const before = new Map(q.map((f) => [f.k, [f.x, f.z, ...f.rec.slice(16)]]));
    waiting = 13;
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting }], 481, 2);
    const after = visible(t, 'stop');
    expect(after).toHaveLength(13);
    for (const f of after) if (before.has(f.k)) expect([f.x, f.z, ...f.rec.slice(16)]).toEqual(before.get(f.k));
  });

  it('grows past what it was built for without reshuffling anyone', () => {
    const t = town();
    let waiting = 4;
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting }], 480, 1);
    const first = visible(t, 'stop').map((f) => [f.k, f.x, f.z]);
    waiting = 30;
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting }], 480, 3);
    expect(visible(t, 'stop')).toHaveLength(30);
    const now = new Map(visible(t, 'stop').map((f) => [f.k, [f.k, f.x, f.z]]));
    for (const f of first) expect(now.get(f[0] as number)).toEqual(f);
  });

  it('boards from the front: they walk to the door and are gone, the rest shuffle up', () => {
    const t = town();
    let waiting = 10;
    const flows = (): Flow[] => [{ kind: 'queue', id: 'stop', site: stop, waiting }];
    run(t, flows, 480, 2);
    const door = { x: 10.2, z: -2.9 };
    const lookOf = (f: { rec: Float32Array }) => [...f.rec.slice(16, 32)].join();
    // (records are views into the store's buffers, so keep copies)
    const queue0 = visible(t, 'stop').sort((a, b) => a.k - b.k).map((f) => ({ ...f, rec: f.rec.slice() }));
    const res = t.crowds.board('stop', [door], 4);
    waiting -= res.n;
    expect(res.n).toBe(4);
    run(t, flows, 480, 0.3);
    // the front four are now walking to the door, looking as they did
    const boarders = t.store.figures().filter((f) => f.group.startsWith('stop#board') && f.alpha > 0.5);
    expect(boarders.map(lookOf).sort()).toEqual(queue0.slice(0, 4).map(lookOf).sort());
    // the rest keep their looks; the new front of the queue is who was fifth
    const rest = visible(t, 'stop').sort((a, b) => a.k - b.k);
    expect(rest).toHaveLength(6);
    // (someone moving up into a freed shelter seat sits down, so leave out the idle pose)
    const lookNoIdle = (f: { rec: Float32Array }) => [...f.rec.slice(16, 18), ...f.rec.slice(19, 32)].join();
    expect(rest.map(lookNoIdle)).toEqual(queue0.slice(4).map(lookNoIdle));
    run(t, flows, 480, res.until - t.store.time + 1.5);
    expect(t.store.figures().filter((f) => f.group.startsWith('stop#board') && f.alpha > 0.01)).toHaveLength(0);
    // shuffled up: everyone ends nearer the flag than they started
    const settled = visible(t, 'stop');
    const d = (f: { x: number }) => Math.abs(f.x - stop.at.x);
    expect(settled.reduce((a, f) => a + d(f), 0)).toBeLessThan(queue0.slice(4).reduce((a, f) => a + d(f), 0));
  });

  it('people getting off step onto the pavement and walk away', () => {
    const t = town();
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting: 0 }], 480, 0.5);
    t.crowds.alight('stop', [{ x: 9.4, z: -2.9 }], 5);
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting: 0 }], 480, 6);
    const off = t.store.figures().filter((f) => f.group.startsWith('stop#alight') && f.alpha > 0.5);
    expect(off.length).toBe(5);
    for (const f of off) { expect(f.z).toBeLessThan(-3.25); expect(f.moving).toBe(true); }
  });
});

describe('walking along footways', () => {
  it('stays on the pavement, both ways, loosely keeping left, and fills to the count', () => {
    const t = town();
    run(t, () => [{ kind: 'walk', id: 'n', footway: north, count: 30 }, { kind: 'walk', id: 's', footway: south, count: 20 }], 600, 2, camera(0, 0, 200));
    for (const [id, fw, n] of [['n', north, 30], ['s', south, 20]] as const) {
      const all = t.store.figures().filter((f) => f.group.startsWith(`${id}:`));
      const shown = all.filter((f) => f.alpha > 0.5);
      // a few are always fading in or out at the ends of the footway
      expect(shown.length).toBeGreaterThanOrEqual(n - 4);
      expect(shown.length).toBeLessThanOrEqual(n);
      const zc = fw.line[0].z;
      for (const f of all) expect(Math.abs(f.z - zc)).toBeLessThan(fw.width / 2);
      const east = shown.filter((f) => Math.cos(f.a) > 0.5), west = shown.filter((f) => Math.cos(f.a) < -0.5);
      expect(east.length).toBeGreaterThan(n * 0.2);
      expect(west.length).toBeGreaterThan(n * 0.2);
      // left of travel: −z going east, +z going west
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      expect(mean(east.map((f) => f.z - zc))).toBeLessThan(0);
      expect(mean(west.map((f) => f.z - zc))).toBeGreaterThan(0);
    }
  });

  it('is the same crowd for the same seeds, whoever builds it', () => {
    const a = town(), b = town();
    const flows = (): Flow[] => [{ kind: 'walk', id: 'n', footway: north, count: 25 }, { kind: 'park', id: 'p', area: [{ x: -20, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 40 }, { x: -20, z: 40 }], walkers: 5, dogWalkers: 4, looseDogs: 2 }];
    run(a, flows, 600, 1, camera(0, 10, 200)); run(b, flows, 600, 1, camera(0, 10, 200));
    const key = (t: ReturnType<typeof town>) => t.store.figures().map((f) => [f.group, f.k, ...f.rec]).sort().join('|');
    expect(key(a)).toBe(key(b));
  });

  it('dog walkers have their dog on a lead, just ahead of them', () => {
    const t = town();
    run(t, () => [{ kind: 'park', id: 'p', area: [{ x: -20, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 40 }, { x: -20, z: 40 }], walkers: 0, dogWalkers: 6 }], 600, 1, camera(0, 25, 80));
    const dogs = t.store.figures('pets').filter((f) => f.group === 'p:walk');
    expect(dogs.length).toBeGreaterThanOrEqual(6);
    for (const d of dogs) expect(d.rec[30]).toBeGreaterThan(1); // lead lag
  });
});

describe('streams, schools and the clock', () => {
  it('a shift change stream is there only while its window is open', () => {
    const path = [{ x: 0, z: -5 }, { x: 60, z: -5 }, { x: 60, z: 20 }];
    const flows = (): Flow[] => [{ kind: 'commute', id: 'shift', path, total: 80, window: [340, 370] }];
    const at = (clock: number) => { const t = town(); run(t, flows, clock, 3, camera(30, 5, 150)); return visible(t, 'shift').length; };
    expect(at(300)).toBe(0);
    expect(at(355)).toBeGreaterThan(20);
    expect(at(460)).toBe(0);
    expect(windowRamp(341, 340, 30)).toBeGreaterThan(0);
    expect(windowRamp(341, 340, 30)).toBeLessThan(1);
    expect(windowRamp(1439, 340, 30)).toBe(0);
  });

  it('the school yard fills before the bell and empties after it', () => {
    const school: Flow = {
      kind: 'school', id: 'sch', gate: { x: 0, z: 8 }, yard: [{ x: -20, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 30 }, { x: -20, z: 30 }],
      approaches: [[{ x: -60, z: 5 }, { x: 0, z: 5 }, { x: 0, z: 10 }]], pupils: 60, arrive: [510, 530], leave: [915, 935],
    };
    const yard = (clock: number) => { const t = town(); run(t, () => [school], clock, 3, camera(0, 15, 90)); return visible(t, 'sch:yard').length; };
    expect(yard(500)).toBe(0);
    expect(yard(528)).toBeGreaterThan(20);
    expect(yard(570)).toBe(0);
  });
});

describe('detail, budgets and time', () => {
  const flows = (): Flow[] => [{ kind: 'walk', id: 'n', footway: north, count: 40 }];
  it('draws full figures close up, cards far out, nothing from very far', () => {
    for (const [h, lod] of [[30, 0], [120, 1], [400, 2]] as const) {
      const t = town();
      run(t, flows, 600, 1, camera(0, 0, h));
      const s = t.store.stats.byLod;
      expect(s[lod]).toBeGreaterThan(0);
      expect(s.filter((_, i) => i !== lod).every((x) => x === 0)).toBe(true);
    }
    const t = town();
    run(t, flows, 600, 1, camera(0, 0, 3000));
    expect(t.store.stats.byLod).toEqual([0, 0, 0]);
  });

  it('keeps to its budget, nearest the middle of the view first', () => {
    const t = town();
    t.store.setBudget({ ...BUDGETS[0], near: 30 });
    const lots: Flow[] = Array.from({ length: 6 }, (_, i) => ({ kind: 'walk', id: `w${i}`, footway: { line: [{ x: -40, z: i * 8 - 20 }, { x: 40, z: i * 8 - 20 }], width: 3 }, count: 12 }));
    run(t, () => lots, 600, 1, camera(0, 0, 30));
    expect(t.store.stats.byLod[0]).toBeLessThanOrEqual(30);
    expect(t.store.stats.byLod[1] + t.store.stats.byLod[2]).toBeGreaterThan(0);
  });

  it('eases a count change in rather than popping', () => {
    const t = town();
    let n = 10;
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting: n }], 480, 1);
    n = 11;
    run(t, () => [{ kind: 'queue', id: 'stop', site: stop, waiting: n }], 480, 0.2);
    const newcomer = t.store.figures().find((f) => f.group === 'stop' && f.k === 10)!;
    expect(newcomer.alpha).toBeGreaterThan(0.05);
    expect(newcomer.alpha).toBeLessThan(0.95);
  });

  it('winds its clock back on long sessions without moving anyone', () => {
    const t = town();
    run(t, flows, 600, 0.5, camera(0, 0, 60));
    t.store.time = 8190;
    t.store.update(camera(0, 0, 60), 860, 0.001);
    const before = t.store.figures().map((f) => [f.x, f.z, f.alpha]);
    t.store.update(camera(0, 0, 60), 860, 5);
    const after = t.store.figures(undefined, t.store.time - 5).map((f) => [f.x, f.z, f.alpha]);
    expect(t.store.time).toBeLessThan(5000);
    after.forEach((a, i) => { expect(a[0]).toBeCloseTo(before[i][0], 1); expect(a[1]).toBeCloseTo(before[i][1], 1); });
  });

  it('still figures never move, loops always do', () => {
    const t = town();
    run(t, () => [{ kind: 'loiter', id: 'pub', at: { x: 0, z: -6.25 }, facing: -Math.PI / 2, width: 10, count: 8, venue: 'pub' }, { kind: 'walk', id: 'n', footway: north, count: 10 }], 1200, 1, camera(0, 0, 60));
    for (const f of t.store.figures()) {
      if (f.group === 'pub') { expect(f.rec[11]).toBe(Mode.Still); expect(f.moving).toBe(false); }
      else expect(f.moving).toBe(true);
    }
  });
});
