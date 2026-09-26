// Review 3: the player's path through the game and the 50 km world. Each test reproduces one
// suspected bug on the real modules; it stays only if it fails for the reason it claims.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LIVE_HALF, planWorld } from './worldmap/plan';
import { LiveTowns } from './worldmap/live';
import { migrate } from './game/save';
import { isOldRealSave } from './real/worldmap';
import { GONE } from './maps';
// (src/app/menu.ts can't load in node: its fonts touch `document`. goneSave copied from menu.ts:44 verbatim)
const savedMap = (e: { map: { id: string; query: string } }) => new URLSearchParams(e.map.query).get('map') ?? e.map.id;
const goneSave = (e: { map: { id: string; query: string } }) => !!GONE[savedMap(e)] || !!GONE[e.map.id] || (savedMap(e) === 'region' && (new URLSearchParams(e.map.query).get('size') ?? '6') === '6');

// ---------- the tile pipeline: a request that fails is asked for again for ever ----------
// A fake tile worker that fails every tile it is asked for (a worker that throws on one tile, or a
// worker that has died). The view must not go on asking for it frame after frame.
class FailingWorker {
  private fns: ((e: MessageEvent) => void)[] = [];
  static loads = 0;
  constructor(_url: URL, _o?: unknown) {}
  addEventListener(_t: 'message', fn: (e: MessageEvent) => void) { this.fns.push(fn); }
  postMessage(msg: { t: string; id: number; req?: { field?: number } }) {
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
    const { WorldView } = await import('./worldmap/view');
    const plan = planWorld({ seed: 42 });
    const geo = new THREE.BufferGeometry(), mat = new THREE.MeshBasicMaterial();
    const view = new WorldView({ scene: new THREE.Scene(), options: plan.options, half: plan.half, look: (await import('./region/styles')).STYLE_LOOKS.temperate, trees: { crown: geo, pine: geo, trunk: geo, crownMat: mat, pineMat: mat, trunkMat: mat }, workers: 1 });
    view.ready = true;
    const v = { x: 0, z: 0, h: 20000, el: 0.6, az: 0 }; // (zoomed right out: the 16 vast tiles)
    const tick = async () => { view.update(v, 0.45); await new Promise((r) => setTimeout(r, 2)); };
    for (let i = 0; i < 10; i++) await tick();
    const after10 = view.stats.requested;
    for (let i = 0; i < 40; i++) await tick();
    // the same tiles are wanted every frame; each has failed once already
    expect(view.stats.requested).toBe(after10);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(after10);
    vi.unstubAllGlobals();
  }, 60_000);
});

// ---------- the guided start: a place comes to life under the start view on its own ----------
describe('the live area (worldmap/live.ts) and the guide', () => {
  it('a pinch-out over the start town (the guide\'s first step) does not bring a village to life on its own', () => {
    // The guide's "Build a road" step ticks when net.segs grows (src/app/guide.ts:31). A place coming to
    // life builds its streets on the Network (main.ts bringToLife, 755-763). main.ts asks
    // WorldGame.frame for the next place within the view's reach + 1500 m, at any view up to 2600 m
    // tall (live.ts next). At a 2,000 m view over the start town (portrait 412/915, HOME el 0.6):
    const h = 2000, aspect = 412 / 915, el = 0.6;
    const reach = Math.hypot((h * aspect) / 2, h / Math.max(0.2, Math.sin(el)) / 2) + 1500;
    const auto: string[] = [];
    for (const seed of [7, 42, 1, 2, 3]) {
      const plan = planWorld({ seed });
      const next = new LiveTowns(plan, [plan.start]).next({ x: 0, z: 0, h }, reach);
      if (next) auto.push(`seed ${seed}: ${plan.settlements[next.id].name} (${plan.settlements[next.id].kind}) ${Math.round(Math.hypot(next.x, next.z) - next.reach)} m from the start town, activation radius ${Math.round(reach)} m`);
    }
    expect(auto).toEqual([]);
  }, 120_000);
});

// ---------- saves on the menu ----------
describe('Continue and the list of saved towns (src/app/menu.ts goneSave)', () => {
  it('does not offer a town the game will refuse to open: one saved on a real region before it was 50 km', () => {
    // a save made on ?map=exe when Exeter was its own 6 km map (real/load.ts): main.ts turns it away
    // (isOldRealSave) and opens a new town instead
    const raw = { v: 1, id: 'old-exe', name: 'Exeter', savedAt: 1, map: { id: 'exe', query: 'map=exe' }, summary: { residents: 1, balance: 1, lines: 0, day: 1, time: '07:00' } };
    const s = migrate(raw);
    expect(isOldRealSave(s.map.query)).toBe(true);
    expect(goneSave({ id: s.id, name: s.name, map: s.map, savedAt: s.savedAt, summary: s.summary, v: s.v })).toBe(true);
  });
});

// (LIVE_HALF is imported so the file says which square the tests reason about)
void LIVE_HALF;
