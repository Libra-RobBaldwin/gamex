// Adversarial review of the store's per-frame update: popping (groups appearing or vanishing at
// full strength instead of fading), and the garbage-free rewrite (slots, reused `vis`).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUDGETS, PeopleStore, emitPerson, type GroupSpec } from './store';
import { straightRoute, Mode } from './track';
import { dress } from './wardrobe';
import { hashStr, mix, rng } from './util';
const personRand = (id: string, k: number) => rng(mix(hashStr(id), k));

function camera(x: number, z: number, h: number, aspect = 412 / 915) {
  const c = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, 1, 4000);
  const az = Math.PI / 4, el = 0.6, d = 1200;
  c.position.set(x + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, z + Math.cos(az) * Math.cos(el) * d);
  c.lookAt(x, 0, z);
  c.updateMatrixWorld();
  return c;
}
interface EntryView { g: { spec: { id: string } }; shown: number; hidden: number }
type Internals = { batches: Map<string, { entries: EntryView[]; geo: THREE.InstancedBufferGeometry }> };
const batches = (s: PeopleStore) => (s as unknown as Internals).batches;
const entriesOf = (s: PeopleStore, id: string) => [...batches(s).values()].flatMap((b) => b.entries.filter((e) => e.g.spec.id === id));
// the strongest any of a group's entries is drawn now, as the shader works it out (1: fully)
const strength = (s: PeopleStore, id: string) => Math.max(0, ...entriesOf(s, id).map((e) =>
  Math.min(1, Math.max(0, (s.fade - e.shown) / 0.6)) * (e.hidden > 0 ? 1 - Math.min(1, (s.fade - e.hidden) / 0.6) : 1)));

// a still group of n standing people at (x, z)
function standers(id: string, x: number, z: number, n: number): GroupSpec {
  return {
    id, centre: { x, z }, radius: 4, count: n,
    build: (b) => {
      for (let k = 0; k < n; k++) {
        const r = personRand(id, k), look = dress('shopper', 2025, r);
        emitPerson(b, k, straightRoute([{ x: x + k * 0.7, z }, { x: x + k * 0.7 + 1, z }]), { mode: Mode.Still, v: 0, s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y: 0 }, look, r());
      }
    },
  };
}
// how many figures a batch draws now, counting part-faded ones by how far they've got (the shader's iShow)
function drawn(s: PeopleStore, kind: string) {
  const b = batches(s).get(kind)! as unknown as { geo: THREE.InstancedBufferGeometry; dyn: THREE.InstancedBufferAttribute };
  const d = b.dyn.array as Float32Array, clamp = (x: number) => Math.min(1, Math.max(0, x));
  let n = 0;
  for (let i = 0; i < b.geo.instanceCount; i++) {
    const [c, k, shown, hidden] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]];
    n += clamp(c - k) * clamp((s.fade - shown) / 0.6) * (hidden > 0 ? 1 - clamp((s.fade - hidden) / 0.6) : 1);
  }
  return n;
}
const settle = (s: PeopleStore, cam: THREE.Camera, frames = 60) => { for (let i = 0; i < frames; i++) s.update(cam, 915, 1 / 30); };

describe('store review: fades, not pops', () => {
  it('fades a group out when its count goes to zero, rather than dropping it that frame', () => {
    const s = new PeopleStore();
    s.add(standers('pub', 0, 0, 6));
    const cam = camera(0, 0, 40);
    settle(s, cam);
    expect(strength(s, 'pub')).toBeGreaterThan(0.99);
    // closing time: the last drinkers go home
    s.setCount('pub', 0);
    s.update(cam, 915, 1 / 30);
    // one frame later they should still be (mostly) there, easing away
    expect(strength(s, 'pub')).toBeGreaterThan(0.5);
  });

  it('fades far figures out as the view zooms out past the smallest size, rather than dropping them', () => {
    const s = new PeopleStore();
    s.add(standers('far', 0, 0, 6));
    // a person here is about 3 px tall: drawn as cards
    let h = 480;
    settle(s, camera(0, 0, h));
    expect(s.stats.byLod[2]).toBeGreaterThan(0);
    expect(strength(s, 'far')).toBeGreaterThan(0.99);
    // zoom out slowly, a frame at a time, until they're too small to draw
    let prev = 1;
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      h *= 1.01;
      s.update(camera(0, 0, h), 915, 1 / 30);
      const now = strength(s, 'far');
      worst = Math.max(worst, prev - now);
      prev = now;
    }
    expect(prev).toBe(0); // (they have gone)
    // no single frame took them from drawn to gone
    expect(worst).toBeLessThan(0.5);
  });

  it('fades far figures in as the view zooms in to where they can be drawn', () => {
    const s = new PeopleStore();
    s.add(standers('far', 0, 0, 6));
    s.buildAll();
    let h = 900; // too small to draw
    settle(s, camera(0, 0, h));
    expect(strength(s, 'far')).toBe(0);
    let prev = 0, worst = 0;
    for (let i = 0; i < 120; i++) {
      h /= 1.01;
      s.update(camera(0, 0, h), 915, 1 / 30);
      const now = strength(s, 'far');
      worst = Math.max(worst, now - prev);
      prev = now;
    }
    expect(prev).toBeGreaterThan(0.99);
    expect(worst).toBeLessThan(0.5);
  });

  it('fades far figures out when the quality tier drops and they fall under its smallest size', () => {
    const s = new PeopleStore();
    s.add(standers('far', 0, 0, 6));
    // about 2.9 px tall: cards on High (2.2 px and up), nothing on Fastest (3.5 px and up)
    const cam = camera(0, 0, 480);
    settle(s, cam);
    expect(s.stats.byLod[2]).toBeGreaterThan(0);
    expect(strength(s, 'far')).toBeGreaterThan(0.99);
    // the game's automatic quality drops a tier or four (main.ts judgeFrames -> people.setTier)
    s.setBudget(BUDGETS[4]);
    s.update(cam, 915, 1 / 30);
    expect(strength(s, 'far')).toBeGreaterThan(0.5);
  });

  it('eases figures away when the far budget runs out, rather than cutting them that frame', () => {
    const s = new PeopleStore();
    s.add(standers('far', 0, 0, 6));
    const cam = camera(0, 0, 300);
    settle(s, cam);
    expect(s.stats.byLod[2]).toBe(6);
    expect(drawn(s, 'card')).toBeCloseTo(6, 3);
    // the budget tightens (a lower tier, or busier groups nearer the middle of the view take it)
    s.setBudget({ ...BUDGETS[0], far: 3 });
    s.update(cam, 915, 1 / 30);
    // counts ease at two or more figures a second, so one frame on nearly all six are still drawn
    expect(drawn(s, 'card')).toBeGreaterThan(5);
  });

  it('fades a removed group out (a footway rebuilt when a road is built next to it)', () => {
    const s = new PeopleStore();
    s.add(standers('walk', 0, 0, 6));
    const cam = camera(0, 0, 40);
    settle(s, cam);
    s.remove('walk');
    s.update(cam, 915, 1 / 30);
    const drawn = [...batches(s).values()].reduce((n, b) => n + b.geo.instanceCount, 0);
    expect(drawn).toBeGreaterThan(0);
  });
});
