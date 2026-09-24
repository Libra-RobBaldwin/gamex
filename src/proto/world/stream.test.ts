import { describe, expect, it } from 'vitest';
import { StreamManager, type LoadRequest, type Lod, type StreamOptions } from './stream';

// Loads that resolve only when the test says so, and a clock that only moves when told.
function fakes() {
  const pending = new Map<string, { req: LoadRequest; signal: AbortSignal; resolve: (v: string) => void; reject: (e: unknown) => void }>();
  const started: string[] = [];
  let now = 0;
  const loader = (req: LoadRequest, signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    const id = `${req.key}@${req.lod}`;
    started.push(id);
    pending.set(id, { req, signal, resolve, reject });
  });
  const finish = (id: string) => { const p = pending.get(id)!; pending.delete(id); p.resolve(`data:${id}`); };
  const finishAll = () => { for (const id of [...pending.keys()]) finish(id); };
  return { pending, started, loader, finish, finishAll, clock: () => now, advance: (ms: number) => { now += ms; } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

// small rings so the numbers are easy: 1 km tiles, near ≤ 400 m, mid ≤ 1400 m, far ≤ 2400 m
function make(extra: Partial<StreamOptions<string>> = {}) {
  const f = fakes();
  const m = new StreamManager<string>({
    loader: f.loader, clock: f.clock, rings: [{ lod: 'near', radius: 400 }, { lod: 'mid', radius: 1400 }, { lod: 'far', radius: 2400 }],
    margin: 200, budget: { items: 1000 }, maxInFlight: 1000, ...extra,
  });
  const log: string[] = [];
  m.on('load', (e) => log.push(`load ${e.key} ${e.lod}${e.replaced ? ` (was ${e.replaced})` : ''}`));
  m.on('unload', (e) => log.push(`unload ${e.key} ${e.lod} ${e.reason}`));
  m.on('cancel', (e) => log.push(`cancel ${e.key} ${e.lod}`));
  return { m, f, log };
}
async function settle(m: StreamManager<string>, f: ReturnType<typeof fakes>, cam: { x: number; z: number }, rounds = 5) {
  for (let k = 0; k < rounds; k++) { m.update(cam); f.finishAll(); await flush(); }
  m.update(cam);
}

describe('streaming: selection', () => {
  it('picks near, mid and far rings by distance to each tile', () => {
    const { m } = make();
    m.update({ x: 500, z: 500 }); // middle of tile 0,0
    expect(m.wanted('0,0')).toBe('near');
    expect(m.wanted('1,0')).toBe('mid'); // 500 m away
    expect(m.wanted('1,1')).toBe('mid'); // 707 m
    expect(m.wanted('2,0')).toBe('far'); // 1500 m
    expect(m.wanted('3,0')).toBe(null); // 2500 m
    expect(m.wanted('-2,-2')).toBe('far'); // its nearest corner (−1000, −1000) is 2121 m away
    expect(m.wanted('-3,-3')).toBe(null); // 2828 m
  });
  it('respects the map bounds', () => {
    const { m } = make({ bounds: { i0: 0, j0: 0, i1: 1, j1: 1 } });
    m.update({ x: 100, z: 100 });
    expect(m.wanted('-1,0')).toBe(null);
    expect(m.stats().wanted).toBe(4);
  });
  it('widens the rings when zoomed out', () => {
    const { m } = make({ zoomRef: 300, maxZoom: 2 });
    m.update({ x: 500, z: 500, span: 300 });
    expect(m.wanted('1,0')).toBe('mid');
    m.update({ x: 500, z: 500, span: 900 }); // scale clamps to 2: near reaches 800 m
    expect(m.wanted('1,0')).toBe('near');
  });
});

describe('streaming: loading and hysteresis', () => {
  it('loads everything wanted, and swaps levels with no gap as the camera moves', async () => {
    const { m, f, log } = make();
    await settle(m, f, { x: 500, z: 500 });
    expect(m.settled()).toBe(true);
    expect(m.loaded('0,0')?.lod).toBe('near');
    log.length = 0;
    await settle(m, f, { x: 1500, z: 500 }); // one tile east
    expect(m.loaded('1,0')?.lod).toBe('near');
    // the new level arrives before the old one leaves
    const a = log.indexOf('load 1,0 near (was mid)'), b = log.indexOf('unload 1,0 mid lod');
    expect(a).toBeGreaterThanOrEqual(0); expect(b).toBe(a + 1);
  });
  it('does not thrash when the camera wobbles across a ring edge', async () => {
    const { m, f, log } = make();
    await settle(m, f, { x: 500, z: 500 });
    // tile 1,0 is mid; its near edge is at x=1000, so the near ring reaches it at x > 600
    await settle(m, f, { x: 650, z: 500 });
    expect(m.loaded('1,0')?.lod).toBe('near');
    log.length = 0;
    for (const x of [560, 640, 450, 620, 420, 610]) await settle(m, f, { x, z: 500 }, 1); // within margin of the edge
    expect(log.filter((l) => l.includes('1,0'))).toEqual([]);
    await settle(m, f, { x: 300, z: 500 }); // clearly past the margin: 700 m > 400 + 200
    expect(m.loaded('1,0')?.lod).toBe('mid');
  });
  it('unloads tiles that fall out of range, only past the margin', async () => {
    const { m, f } = make();
    await settle(m, f, { x: 500, z: 500 });
    expect(m.loaded('2,0')?.lod).toBe('far'); // 1500 m
    await settle(m, f, { x: -400, z: 500 }); // 2400 m: on the edge, kept
    expect(m.loaded('2,0')?.lod).toBe('far');
    await settle(m, f, { x: -500, z: 500 }); // 2500 m: inside the margin, kept
    expect(m.loaded('2,0')?.lod).toBe('far');
    await settle(m, f, { x: -700, z: 500 }); // 2700 m: gone
    expect(m.loaded('2,0')).toBeUndefined();
  });
});

describe('streaming: budgets', () => {
  it('hands over at most `items` results a frame, nearest first', async () => {
    const { m, f, log } = make({ budget: { items: 3 } });
    m.update({ x: 500, z: 500 });
    f.finishAll(); await flush();
    const counts: number[] = [];
    for (let k = 0; k < 20 && !m.settled(); k++) counts.push(m.update({ x: 500, z: 500 }).applied);
    expect(Math.max(...counts)).toBe(3);
    expect(m.settled()).toBe(true);
    expect(log[0]).toBe('load 0,0 near');
  });
  it('stops when the frame\'s milliseconds are spent, but always makes progress', async () => {
    const { m, f } = make({ budget: { ms: 8 } });
    m.on('load', () => f.advance(3)); // each hand-over costs 3 ms of main-thread work
    m.update({ x: 500, z: 500 });
    f.finishAll(); await flush();
    expect(m.update({ x: 500, z: 500 }).applied).toBe(3); // 0, 3, 6 → 9 ms ≥ 8: stop
    // a single very slow item still gets through
    const g = make({ budget: { ms: 8 } });
    g.m.on('load', () => g.f.advance(50));
    g.m.update({ x: 500, z: 500 }); g.f.finishAll(); await flush();
    expect(g.m.update({ x: 500, z: 500 }).applied).toBe(1);
  });
  it('limits loads in flight, starting the nearest and most in view first', async () => {
    const { m, f } = make({ maxInFlight: 2, ahead: 1 });
    m.update({ x: 500, z: 500, dir: { x: 1, z: 0 } }); // looking east
    expect(f.started).toEqual(['0,0@near', '1,0@mid']); // 1,0 (ahead) beats −1,0 (behind), same distance
    expect(m.pending().length).toBe(2);
    f.finishAll(); await flush();
    m.update({ x: 500, z: 500, dir: { x: 1, z: 0 } });
    expect(f.started.slice(2)).toEqual(['1,-1@mid', '1,1@mid']); // ahead-diagonals before sides and behind
  });
});

describe('streaming: cancellation and errors', () => {
  it('aborts loads that are no longer wanted, and ignores their late results', async () => {
    const { m, f, log } = make();
    m.update({ x: 500, z: 500 });
    const sig = f.pending.get('2,0@far')!.signal;
    m.update({ x: -3000, z: 500 }); // 2,0 is now 5 km away
    expect(sig.aborted).toBe(true);
    expect(log).toContain('cancel 2,0 far');
    f.finish('2,0@far'); await flush();
    m.update({ x: -3000, z: 500 });
    expect(log.some((l) => l.startsWith('load 2,0'))).toBe(false);
    expect(m.loaded('2,0')).toBeUndefined();
  });
  it('cancels an in-flight level change when the camera turns back', async () => {
    const { m, f, log } = make();
    await settle(m, f, { x: 500, z: 500 });
    m.update({ x: 1500, z: 500 }); // 1,0 starts loading near
    expect(f.pending.has('1,0@near')).toBe(true);
    m.update({ x: 300, z: 500 }); // back again, before it arrived
    expect(log).toContain('cancel 1,0 near');
    await settle(m, f, { x: 300, z: 500 });
    expect(m.loaded('1,0')?.lod).toBe<Lod>('mid');
  });
  it('reports a failed load and retries it later', async () => {
    const f = fakes();
    let fails = 1;
    const m = new StreamManager<string>({
      clock: f.clock, rings: [{ lod: 'near', radius: 10 }], margin: 0, retryMs: 1000,
      loader: async (req) => { if (fails-- > 0) throw new Error('offline'); return req.key; },
    });
    const errors: string[] = [];
    m.on('error', (e) => errors.push(`${e.key} ${(e.error as Error).message}`));
    m.update({ x: 500, z: 500 }); await flush();
    m.update({ x: 500, z: 500 }); await flush();
    expect(errors).toEqual(['0,0 offline']);
    m.update({ x: 500, z: 500 });
    expect(m.pending().length).toBe(0); // waiting out the retry delay
    f.advance(1001);
    m.update({ x: 500, z: 500 }); await flush();
    m.update({ x: 500, z: 500 });
    expect(m.loaded('0,0')?.data).toBe('0,0');
  });
  it('dispose cancels and unloads everything', async () => {
    const { m, f, log } = make();
    await settle(m, f, { x: 500, z: 500 });
    m.update({ x: 5000, z: 500 });
    log.length = 0;
    m.dispose();
    expect(m.stats().slots).toBe(0);
    expect(log.some((l) => l.startsWith('cancel'))).toBe(true);
    expect(log.some((l) => l.startsWith('unload'))).toBe(true);
  });
});
