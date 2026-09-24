// What the game needs of the library beyond the demo: fades that finish while the game is paused,
// boarders who take over from the queue without a flicker, and whole walkers on each piece of a
// long footway.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PeopleStore } from './store';
import { Crowds, footwaysOf, stopSite, type Flow } from './flows';

function camera(x: number, z: number, h: number, aspect = 412 / 915) {
  const c = new THREE.OrthographicCamera((-h * aspect) / 2, (h * aspect) / 2, h / 2, -h / 2, 1, 4000);
  const az = Math.PI / 4, el = 0.6, d = 1200;
  c.position.set(x + Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, z + Math.cos(az) * Math.cos(el) * d);
  c.lookAt(x, 0, z);
  c.updateMatrixWorld();
  return c;
}
interface EntryView { g: { spec: { id: string } }; shown: number; hidden: number }
const entries = (s: PeopleStore, kind: string) => ((s as unknown as { batches: Map<string, { entries: EntryView[] }> }).batches.get(kind)?.entries ?? []);
// how far a batch entry has faded in (1: fully), as the shader works it out
const faded = (s: PeopleStore, e: EntryView) => Math.min(1, Math.max(0, (s.fade - e.shown) / 0.6)) * (e.hidden > 0 ? 1 - Math.min(1, (s.fade - e.hidden) / 0.6) : 1);

const street = [{ x: -60, z: 0 }, { x: 60, z: 0 }];
const [north] = footwaysOf(street, 3.25, 6.25);

describe('the people library in the game', () => {
  it('finishes fading between levels of detail while the game is paused', () => {
    const store = new PeopleStore(), crowds = new Crowds(store);
    const flows: Flow[] = [{ kind: 'walk', id: 'n', footway: north, count: 10 }];
    for (let i = 0; i < 40; i++) { crowds.set(flows, 600); store.update(camera(0, 0, 150), 915, 0.05); }
    expect(entries(store, 'personMid').length + entries(store, 'card').length).toBeGreaterThan(0);
    // paused: the game passes no time, but the player zooms right in
    const t = store.time;
    for (let i = 0; i < 30; i++) store.update(camera(0, 0, 30), 915, 0, 1 / 30);
    expect(store.time).toBe(t);
    const near = entries(store, 'person');
    expect(near.length).toBeGreaterThan(0);
    for (const e of near) expect(faded(store, e)).toBeGreaterThan(0.99);
    // and the middle-distance figures have gone rather than staying drawn under the new ones
    expect(entries(store, 'personMid')).toHaveLength(0);
  });

  it('lets the front of a queue walk to the bus without a flicker', () => {
    const store = new PeopleStore(), crowds = new Crowds(store);
    const site = stopSite('stop', { x: 0, z: 0 }, 0, 1, 3.25, 6.25, { shelter: true });
    const flows: Flow[] = [{ kind: 'queue', id: 'stop', site, waiting: 8 }];
    for (let i = 0; i < 40; i++) { crowds.set(flows, 480); store.update(camera(0, 0, 30), 915, 0.05); }
    const { n } = crowds.board('stop', [{ x: 4, z: -3 }], 4);
    expect(n).toBe(4);
    store.update(camera(0, 0, 30), 915, 0.02);
    const boarders = entries(store, 'person').filter((e) => e.g.spec.id.startsWith('stop#board'));
    expect(boarders.length).toBeGreaterThan(0);
    // already at full strength the frame they appear: the people they replace have just gone
    for (const e of boarders) expect(faded(store, e)).toBeGreaterThan(0.99);
  });

  it('shows whole walkers on each piece of a long footway, adding up to about the whole', () => {
    const store = new PeopleStore(), crowds = new Crowds(store);
    const long = footwaysOf([{ x: -200, z: 0 }, { x: 200, z: 0 }], 3.25, 6.25)[0];
    for (const count of [0.4, 1, 3.4, 7.7, 12.2]) {
      crowds.set([{ kind: 'walk', id: 'w', footway: long, count }], 600);
      const pieces = store.ids().filter((id) => id.startsWith('w:')).map((id) => store.spec(id)!.count);
      expect(pieces.length).toBeGreaterThan(3);
      for (const c of pieces) expect(Number.isInteger(c)).toBe(true);
      expect(Math.abs(pieces.reduce((a, b) => a + b, 0) - count)).toBeLessThanOrEqual(pieces.length / 2 + 0.5);
    }
  });
});
