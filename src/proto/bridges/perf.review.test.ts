// Adversarial performance and robustness review of the track, earthworks and scene work.
// Every test here failed on the commit reviewed (c808761); each names the problem it shows.
import { describe, expect, it } from 'vitest';
import { budget, cpuMs } from '../test/speed';
import * as THREE from 'three';
import { ROADS } from '../catalog';
import type { P } from '../roads';
import { findFights } from './coplanar';
import { chooseBridge } from './choose';
import { buildBridge } from './geometry';
import { GALLERY } from './gallery';
import * as library from './index';
import { scenario, type ScenarioOpts } from './scenario';
import { bridgeScene, galleryCrossing } from './scene';
import { CHUNK, TrackBuilder, type TrackRun } from './track';

const visible = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
const meshes = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse((o) => { if (o instanceof THREE.Mesh && visible(o)) out.push(o); }); return out; };
const run = (path: P[], s0: number, s1: number, o: Partial<TrackRun> = {}): TrackRun => ({ path, s0, s1, level: () => 10, tracks: 2, form: 'ballast', year: 1900, ...o });
// a curve of radius R drawn as straight pieces `step` long, as a game railway would hand it over
function arc(R: number, step: number, len: number): P[] {
  const out: P[] = [];
  let x = 0, z = 0, a = 0;
  for (let i = 0; i * step < len; i++) { out.push({ x, z, y: 0 }); x += step * Math.cos(a); z += step * Math.sin(a); a += step / R; }
  return out;
}
// an option the chooser offers on a crossing (built as the demo's chooser would)
function option(opts: ScenarioOpts, id: string) {
  const sc = scenario(opts), o = chooseBridge(sc.crossing).options.find((x) => x.def.id === id)!;
  expect(o.ok, `${id} should be buildable here`).toBe(true);
  const c = o.crossing ?? sc.crossing;
  return bridgeScene({ ...sc, crossing: c }, c, o.layout!);
}

describe('review: draw calls', () => {
  // The channel buoys are one Mesh each (two per 45 m of river, casting shadows). On the phone
  // at 412x915 @2x they are 104 of the suspension scene's 123 draw calls and 52 of the
  // cable-stayed scene's 72 (measured in Chromium with renderer.info, buoys hidden: 19 and 20).
  for (const id of ['suspension', 'cable-stayed'] as const) it(`draws the ${id} scene in a few dozen meshes, buoys instanced`, () => {
    const { sc, c, lay } = galleryCrossing(id);
    const s = bridgeScene(sc, c, lay);
    s.setDetail(1);
    const all = meshes(s.group);
    const buoys = all.filter((m) => !(m instanceof THREE.InstancedMesh) && m.geometry.type === 'CylinderGeometry');
    expect(buoys.length, 'separate buoy meshes').toBeLessThanOrEqual(2);
    expect(all.length).toBeLessThanOrEqual(40);
  });

  // Chunks are keyed by path, so every short run on its own path gets its own rail mesh and its
  // own sleeper InstancedMesh however little track it holds: 100 runs of 50 m laid end to end
  // along one 5 km line make 201 near-look objects, where 120 m chunks would need about 85.
  it('keeps near-look objects to a few per 120 m of track when the track comes in many short runs', () => {
    const tb = new TrackBuilder();
    for (let i = 0; i < 100; i++) tb.add(run([{ x: i * 50, z: 0, y: 0 }, { x: i * 50 + 50, z: 0, y: 0 }], 0, 50, { tracks: 1 }));
    const t = tb.build();
    expect(t.near.children.length).toBeLessThanOrEqual(2 * Math.ceil(5000 / CHUNK) + 1);
  });
});

describe('review: build cost', () => {
  // heightOn() (scene.ts) files every up-facing ground triangle into every 8 m cell of its
  // bounding box with a string key: on the suspension scene that is 681,712 insertions into
  // 158,008 cells for 8,004 triangles, to answer at most 900 tree lookups. It is the largest
  // self-time in a profile of bridgeScene (ahead of every geometry builder), and the scene takes
  // 220-270 ms on a desktop core, so most of a second on a phone.
  // Best of five, not the median of three: seven builds in one process measured 95–251 ms on the
  // same code (garbage collection and JIT swing each build), so a median of three sat within 1% of
  // the scaled budget on one CI run in three. test/speed.ts measures its own workloads best-of-N for
  // the same reason, so the budget is compared like for like. The budget itself is unchanged.
  it('builds the suspension gallery scene in under 150 ms (best of five)', () => {
    const { sc, c, lay } = galleryCrossing('suspension');
    bridgeScene(sc, c, lay); // warm up
    let best = Infinity;
    for (let i = 0; i < 5; i++) best = Math.min(best, cpuMs(() => bridgeScene(sc, c, lay)));
    expect(best).toBeLessThan(budget(150)); // (on the reference machine, scaled to this one's speed: test/speed.ts)
  }, 60000);
});

describe('review: memory', () => {
  // Track.dispose() and the demo's show() dispose geometries only. InstancedMesh.dispose() is what
  // frees an instance matrix buffer on the GPU, and nothing calls it: cycling the demo's #next 48
  // times, live WebGL buffers (createBuffer minus deleteBuffer) rose 38, 62, 86, 110, 134, two per
  // switch (the tree crowns and trunks), and zoomed in the sleeper chunks' buffers go the same way.
  it('Track.dispose() frees the sleeper instance buffers', () => {
    const t = new TrackBuilder().add(run([{ x: 0, z: 0, y: 0 }, { x: 300, z: 0, y: 0 }], 0, 300)).build();
    const inst = t.near.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);
    expect(inst.length).toBeGreaterThan(0);
    let disposed = 0;
    for (const m of inst) m.addEventListener('dispose', () => disposed++);
    t.dispose();
    expect(disposed).toBe(inst.length);
  });
  it('a bridge scene can be disposed of whole (trees and sleepers included)', () => {
    const { sc, c, lay } = galleryCrossing('trestle');
    const s = bridgeScene(sc, c, lay) as unknown as { dispose?: () => void; group: THREE.Group };
    expect(typeof s.dispose).toBe('function');
  });
});

describe('review: API compatibility', () => {
  // Before this change buildBridge() on a railway drew the ballast top and bar rails into
  // bg.parts (materials 'ballast' and 'rail'). Now detailed track is on by default: the parts lose
  // both and the slab top drops 0.3 m, and the track comes back only as bg.track (TrackRun[]),
  // which needs TrackBuilder, which index.ts doesn't export. A caller that makes its own meshes
  // from bg.parts silently loses the track.
  it('still draws a railway deck\'s ballast and rails into bg.parts unless detailed track is asked for', () => {
    const { c, lay } = galleryCrossing('masonry');
    const bg = buildBridge(c, lay);
    expect(Object.keys(bg.parts)).toContain('ballast');
    expect(Object.keys(bg.parts)).toContain('rail');
  });
  it('exports what a caller needs to build bg.track and to share a TrackBuilder with bridgeObject', () => {
    const lib = library as Record<string, unknown>;
    expect(lib.TrackBuilder).toBeDefined();
    expect(lib.bridgeScene).toBeDefined();
  });
});

describe('review: track on awkward paths', () => {
  // A path whose first two points coincide (as joins and snapped ends often give) has a
  // zero-length first segment; frame() takes its direction from it, (0, 0), so the bed and rails
  // pinch to a point at the start: the bed there is 0 m wide instead of 8.2 m.
  it('keeps the bed its full width when a path starts with a repeated point', () => {
    const t = new TrackBuilder().add(run([{ x: 0, z: 0, y: 0 }, { x: 0, z: 0, y: 0 }, { x: 100, z: 0, y: 0 }], 0, 100)).build();
    const a = (t.group.getObjectByName('ballast-timber') as THREE.Mesh).geometry.getAttribute('position');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i)) < 1e-6) { lo = Math.min(lo, a.getZ(i)); hi = Math.max(hi, a.getZ(i)); }
    expect(hi - lo).toBeGreaterThan(8);
  });
  // Curves within the catalogue's own limits (branch line minR 150 m; light rail, double track,
  // minR 40 m) fold the ballast bed over itself where a sample falls just short of a path corner.
  for (const [R, step, tracks] of [[150, 5, 2], [60, 3, 2], [60, 3, 1]] as const) it(`lays track on a ${R} m curve (${step} m pieces, ${tracks} track) with nothing coplanar`, () => {
    // (fixer's note: 400 m is more than a whole turn at R = 60 m (377 m), so the track came back
    // over itself; at most three quarters of a turn is laid now)
    const pts = arc(R, step, Math.min(400, 1.5 * Math.PI * R)), len = (pts.length - 1) * step;
    const t = new TrackBuilder().add(run(pts, 0, len, { tracks })).build();
    for (const mpp of [1, 0.01]) { t.setDetail(mpp); const f = findFights(t.group); expect(f, JSON.stringify(f.slice(0, 3))).toEqual([]); }
  });
});

describe('review: coplanar surfaces off the gallery', () => {
  // A sweep of 364 buildable railway options (gallery crossings for masonry, girder, beam, box,
  // truss-deck, arch-concrete, trestle and truss-through, carrying rail-main, rail-branch, rail-hs
  // or rail-light, years 1880-2010, bends 0-80 m) found fights in 121 of them. A few of them:
  const cases: [string, ScenarioOpts, string][] = [
    // the masonry crossing exactly as the gallery has it; the player picks the girder instead
    ['girder on the masonry gallery crossing', GALLERY.masonry, 'girder'],
    // the truss-deck crossing carrying a main line instead of a road
    ['truss-deck carrying rail-main over its gallery crossing', { ...GALLERY['truss-deck'], road: ROADS['rail-main'] }, 'truss-deck'],
    // the truss-through crossing on a branch line on a 20 m bend
    ['truss-through carrying rail-branch on a 20 m bend', { ...GALLERY['truss-through'], road: ROADS['rail-branch'], year: 1905, bend: 20 }, 'truss-through'],
    // a concrete arch carrying a main line in 1975
    ['arch-concrete carrying rail-main in 1975', { ...GALLERY.girder, year: 1975 }, 'arch-concrete'],
    // a bascule carrying a main line
    ['bascule carrying rail-main in 1975', { ...GALLERY.masonry, year: 1975 }, 'bascule'],
  ];
  for (const [name, opts, id] of cases) it(`has no coplanar surfaces: ${name}`, () => {
    const s = option(opts, id);
    for (const mpp of [1, 0.01]) { s.setDetail(mpp); const f = findFights(s.group); expect(f, `${mpp} m/px: ${JSON.stringify(f.slice(0, 3).map((x) => [x.a, x.b, x.at, x.gap]))}`).toEqual([]); }
  }, 120000);
  // the trestle's own crossing on an 80 m bend: the ground folds over itself
  it('has no coplanar surfaces: trestle gallery crossing on an 80 m bend', () => {
    const { sc, c, lay } = galleryCrossing('trestle', 80);
    const s = bridgeScene(sc, c, lay);
    for (const mpp of [1, 0.01]) { s.setDetail(mpp); const f = findFights(s.group); expect(f, `${mpp} m/px: ${JSON.stringify(f.slice(0, 3).map((x) => [x.a, x.b, x.at, x.gap]))}`).toEqual([]); }
  }, 120000);
});
