// The logic review of 26 Sep 2026, the player's-path rows owned by the play session: the guide and the
// menu's saved towns, on the real modules.
import { describe, expect, it } from 'vitest';
import { planWorld } from './worldmap/plan';
import { LiveTowns } from './worldmap/live';
import { migrate } from './game/save';
import { isOldRealSave } from './real/worldmap';
import { GONE } from './maps';
// (src/app/menu.ts can't load in node: its fonts touch `document`. goneSave copied from menu.ts:44 verbatim)
const savedMap = (e: { map: { id: string; query: string } }) => new URLSearchParams(e.map.query).get('map') ?? e.map.id;
const goneSave = (e: { map: { id: string; query: string }; [k: string]: unknown }) => !!GONE[savedMap(e)] || !!GONE[e.map.id] || (savedMap(e) === 'region' && (new URLSearchParams(e.map.query).get('size') ?? '6') === '6');
describe('the live area (worldmap/live.ts) and the guide', () => {
  it.fails('a pinch-out over the start town (the guide\'s first step) does not bring a village to life on its own', () => {
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
  it.fails('does not offer a town the game will refuse to open: one saved on a real region before it was 50 km', () => {
    // a save made on ?map=exe when Exeter was its own 6 km map (real/load.ts): main.ts turns it away
    // (isOldRealSave) and opens a new town instead
    const raw = { v: 1, id: 'old-exe', name: 'Exeter', savedAt: 1, map: { id: 'exe', query: 'map=exe' }, summary: { residents: 1, balance: 1, lines: 0, day: 1, time: '07:00' } };
    const s = migrate(raw);
    expect(isOldRealSave(s.map.query)).toBe(true);
    expect(goneSave({ id: s.id, name: s.name, map: s.map, savedAt: s.savedAt, summary: s.summary, v: s.v })).toBe(true);
  });
});

