import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { P } from '../roads';
import { findFights } from './coplanar';
import { DETAIL_MPP, deckForm, GAUGE, RAIL_HEIGHT, SEAT, SLEEPER_PITCH, SLEEPER_PROUD, sleeperKind, sleeperStations, TrackBuilder, type TrackForm } from './track';

const straight = (len: number): P[] => [{ x: 0, z: 0, y: 0 }, { x: len, z: 0, y: 0 }];
function build(len: number, o: { tracks?: number; form?: TrackForm; year?: number; path?: P[] } = {}) {
  return new TrackBuilder().add({ path: o.path ?? straight(len), s0: 0, s1: len, level: () => 10, tracks: o.tracks ?? 1, form: o.form ?? 'ballast', year: o.year ?? 1900 }).build();
}
const sleepers = (t: ReturnType<typeof build>) => t.near.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);
function sleeperCentres(t: ReturnType<typeof build>) {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), out: THREE.Vector3[] = [];
  for (const im of sleepers(t)) for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, m); out.push(p.setFromMatrixPosition(m).clone()); }
  return out;
}

describe('track', () => {
  it('lays sleepers about 0.65 m apart, square to the track, their tops just proud of the ballast', () => {
    const c = sleeperCentres(build(100)).sort((a, b) => a.x - b.x);
    for (let i = 1; i < c.length; i++) expect(c[i].x - c[i - 1].x).toBeCloseTo(SLEEPER_PITCH, 4);
    expect(SLEEPER_PITCH).toBeGreaterThan(0.6);
    expect(SLEEPER_PITCH).toBeLessThan(0.7);
    for (const p of c) { expect(p.y).toBeCloseTo(10 + SLEEPER_PROUD, 4); expect(p.z).toBeCloseTo(0, 4); }
  });

  it('sets the rails to standard gauge: 1.435 m between the running edges of the heads', () => {
    const t = build(20);
    const rails = t.near.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name.startsWith('rails'));
    expect(rails.length).toBeGreaterThan(0);
    // the heads' tops: the highest vertices of the rails
    const top = 10 + SLEEPER_PROUD + SEAT + RAIL_HEIGHT, zs = new Set<number>();
    for (const r of rails) {
      const a = r.geometry.getAttribute('position');
      for (let i = 0; i < a.count; i++) if (Math.abs(a.getY(i) - top) < 1e-4) zs.add(+a.getZ(i).toFixed(4));
    }
    const sorted = [...zs].sort((a, b) => a - b); // outer and inner edge of each head
    expect(sorted.length).toBe(4);
    expect(sorted[2] - sorted[1]).toBeCloseTo(GAUGE, 3);
    expect(GAUGE).toBe(1.435);
  });

  it('uses timber sleepers before 1960 and concrete after, and bare timbers on steel and timber decks', () => {
    expect(sleeperKind(1880)).toBe('timber');
    expect(sleeperKind(1959)).toBe('timber');
    expect(sleeperKind(1960)).toBe('concrete');
    expect(sleepers(build(30, { year: 1905 }))[0].name).toMatch(/timber/);
    expect(sleepers(build(30, { year: 1990 }))[0].name).toMatch(/concrete/);
    for (const id of ['trestle', 'girder', 'truss-through', 'truss-deck']) expect(deckForm(id), id).toBe('open');
    for (const id of ['masonry', 'beam', 'box', 'arch-concrete']) expect(deckForm(id), id).toBe('ballast');
    // an open deck carries timbers even on a modern line, and no ballast
    const open = build(30, { form: 'open', year: 1990 });
    expect(sleepers(open)[0].name).toMatch(/timber/);
    expect(open.group.getObjectByName('ballast-concrete')).toBeUndefined();
    expect(open.group.getObjectByName('open-deck')).toBeDefined();
  });

  it('builds sleepers in proportion to the length and the number of tracks', () => {
    const a = build(100).sleepers, b = build(200).sleepers, d = build(200, { tracks: 2 }).sleepers;
    expect(a).toBeGreaterThanOrEqual(Math.floor(100 / SLEEPER_PITCH) - 1);
    expect(a).toBeLessThanOrEqual(Math.ceil(100 / SLEEPER_PITCH));
    expect(Math.abs(b - 2 * a)).toBeLessThanOrEqual(1);
    expect(d).toBe(2 * b);
    // runs laid end to end stay in step: no doubled or missing sleeper at the join
    const joined = new TrackBuilder().add({ path: straight(200), s0: 0, s1: 77.7, level: () => 0, tracks: 1, form: 'ballast', year: 1900 })
      .add({ path: straight(200), s0: 77.7, s1: 200, level: () => 0, tracks: 1, form: 'open', year: 1900 }).build();
    expect(joined.sleepers).toBe(b);
    expect(sleeperStations(0, 77.7).length + sleeperStations(77.7, 200).length).toBe(sleeperStations(0, 200).length);
  });

  it('shows real sleepers and rails only close in, and the painted bed from afar', () => {
    const t = build(100);
    expect(t.setDetail(DETAIL_MPP * 1.2)).toBe(false);
    expect(t.near.visible).toBe(false);
    expect(t.far.visible).toBe(true);
    expect(t.setDetail(DETAIL_MPP * 0.8)).toBe(true);
    expect(t.near.visible).toBe(true);
    expect(t.far.visible).toBe(false);
    // the far look is one ballast mesh (plus the open-deck strip where there is one)
    expect(t.far.children.length).toBe(1);
    // a sleeper pitch at the switch covers about five pixels
    expect(SLEEPER_PITCH / DETAIL_MPP).toBeGreaterThan(4);
    expect(SLEEPER_PITCH / DETAIL_MPP).toBeLessThan(6);
  });

  it('keeps near-look draw calls to a few per chunk, so zoomed in only what is on screen is drawn', () => {
    const t = build(1000, { tracks: 2 });
    const chunks = Math.ceil(1000 / 120);
    // per chunk: one rail mesh and one sleeper mesh; plus the bed
    expect(t.near.children.length).toBeLessThanOrEqual(2 * chunks + 1);
    for (const im of sleepers(t)) expect(im.boundingSphere!.radius).toBeLessThan(120);
  });

  it('mitres the bed and rails at sharp corners: nothing overlaps on the inside of a bend', () => {
    const path: P[] = [{ x: 0, z: 0, y: 0 }, { x: 40, z: 0, y: 0 }, { x: 70, z: 12, y: 0 }, { x: 100, z: 12, y: 0 }];
    const len = 40 + Math.hypot(30, 12) + 30;
    const t = build(len, { tracks: 2, path });
    for (const mpp of [1, 0.01]) { t.setDetail(mpp); const f = findFights(t.group); expect(f, JSON.stringify(f)).toEqual([]); }
  });
});
