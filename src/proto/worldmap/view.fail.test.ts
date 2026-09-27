// A tile request that fails (a worker that throws on one tile, or a worker that has died) must not
// be asked for again frame after frame for ever (the logic review's bug 11): three tries, each wait
// twice the last, then the tile is left alone.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { planWorld } from './plan';

class FailingWorker {
  private fns: ((e: MessageEvent) => void)[] = [];
  static loads = 0;
  constructor(_url: URL, _o?: unknown) {}
  addEventListener(_t: 'message', fn: (e: MessageEvent) => void) { this.fns.push(fn); }
  postMessage(msg: { t: string; id: number }) {
    if (msg.t !== 'load') return;
    FailingWorker.loads++;
    setTimeout(() => { for (const f of this.fns) f({ data: { t: 'fail', id: msg.id, error: 'boom' } } as MessageEvent); }, 0);
  }
}

describe('the streamed view (worldmap/view.ts)', () => {
  it('stops asking for a tile whose request failed', async () => {
    vi.stubGlobal('Worker', FailingWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { WorldView } = await import('./view');
    const plan = planWorld({ seed: 42 });
    const geo = new THREE.BufferGeometry(), mat = new THREE.MeshBasicMaterial();
    const view = new WorldView({ scene: new THREE.Scene(), options: plan.options, half: plan.half, look: (await import('../region/styles')).STYLE_LOOKS.temperate, trees: { crown: geo, pine: geo, trunk: geo, crownMat: mat, pineMat: mat, trunkMat: mat }, workers: 1 });
    view.ready = true;
    const v = { x: 0, z: 0, h: 20000, el: 0.6, az: 0 }; // (zoomed right out: the 16 vast tiles)
    const tick = async () => { view.update(v, 0.45); await new Promise((r) => setTimeout(r, 2)); };
    for (let i = 0; i < 10; i++) await tick();
    const after10 = view.stats.requested;
    expect(after10).toBeGreaterThan(0);
    // the same tiles are wanted every frame; each has failed once and waits before its second try
    for (let i = 0; i < 40; i++) await tick();
    expect(view.stats.requested).toBe(after10);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(after10);
    // and after three tries in all, a tile is left alone for good
    for (let i = 0; i < 1000; i++) await tick();
    const after = view.stats.requested;
    expect(after).toBeLessThanOrEqual(after10 * 3);
    for (let i = 0; i < 300; i++) await tick();
    expect(view.stats.requested).toBe(after);
    vi.unstubAllGlobals();
    warn.mockRestore();
  }, 120_000);
});
