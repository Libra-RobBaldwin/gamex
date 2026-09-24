import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { MODELS, MODEL } from './models';
import { buildKit, BUDGET } from './build';
import { doorsOf, DoorStates, dwellDoors, doorSeconds, doorPositions, platformSide, railLayout, type Door } from './doors';
import { MOTION, DOOR_SECONDS, packDoors, unpackDoors, ease, plugStep, plugSlide, wheelAngle, bogieYaw, steerAngle, moveVertex, MAX_BOGIE, type Tag } from './motion';
import { VehicleRenderer, vehicleMaterial } from './render';
import { follow, articulationAngle, ahead, type Pose } from './articulation';
import type { Model } from './types';

const byStyle = (style: string, year: number, f: (m: Model) => boolean = () => true) => {
  const m = MODELS.find((x) => x.style === style && x.from <= year && x.to >= year && f(x));
  if (!m) throw new Error(`no ${style} in ${year}`);
  return m;
};
const cab = (m: Model) => m.design.cab === true;
const mid = (m: Model) => m.design.cab === false;
const perSide = (m: Model, side: 'left' | 'right') => doorsOf(m).filter((d) => d.sides.includes(side));
const DOOR_KINDS = new Set<number>([MOTION.plug, MOTION.pocket, MOTION.hinge, MOTION.foldA, MOTION.foldB]);

describe('door layouts', () => {
  test('modern electric units: two pairs of plug doors a side, a third of the way along', () => {
    for (const m of [byStyle('emu-car', 2022, cab), byStyle('emu-car', 2022, mid)]) {
      const ds = perSide(m, 'left');
      expect(ds.length, m.id).toBe(2);
      for (const d of ds) { expect(d.kind).toBe('plug'); expect(d.leaves).toBe(2); expect(d.sides).toEqual(['left', 'right']); }
      const r = railLayout(m), span = r.bx1 - r.bx0;
      const xs = ds.map((d) => d.x).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(r.bx0 + span / 3, 5);
      expect(xs[1]).toBeCloseTo(r.bx0 + (2 * span) / 3, 5);
    }
  });
  test('1990s electric units have pocket doors', () => {
    const m = byStyle('emu-car', 1995, mid);
    expect(doorsOf(m).every((d) => d.kind === 'pocket' && d.leaves === 2)).toBe(true);
  });
  test('slam-door compartment stock: a door to every compartment, evenly spaced', () => {
    for (const m of [byStyle('coach-stock', 1940, (x) => x.design.panelled === true), byStyle('emu-car', 1960, mid)]) {
      const ds = perSide(m, 'right');
      expect(ds.length, m.id).toBeGreaterThanOrEqual(7);
      expect(ds.every((d) => d.kind === 'slam' && d.leaves === 1)).toBe(true);
      const xs = ds.map((d) => d.x).sort((a, b) => a - b);
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      for (const g of gaps) { expect(g).toBeGreaterThan(1.8); expect(g).toBeCloseTo(gaps[0], 5); }
    }
  });
  test('1950s–60s corridor coaches and slam-door railcars: four slam doors a side', () => {
    for (const m of [byStyle('coach-stock', 1960, (x) => x.design.slam === true && x.design.panelled === false), byStyle('dmu-car', 1960, cab)]) {
      const ds = perSide(m, 'left');
      expect(ds.length, m.id).toBe(4);
      expect(ds.every((d) => d.kind === 'slam')).toBe(true);
    }
  });
  test('high-speed coaches: slam doors at the ends on the 1970s–80s sets, plug doors after', () => {
    const old = byStyle('hs-coach', 1980), neu = byStyle('hs-coach', 2010);
    expect(doorsOf(byStyle('hs-coach', 1995)).every((d) => d.kind === 'plug')).toBe(true);
    expect(perSide(old, 'left').map((d) => d.kind)).toEqual(['slam', 'slam']);
    expect(perSide(neu, 'left').map((d) => d.kind)).toEqual(['plug', 'plug']);
  });
  test('metro cars: three pairs of wide pocket doors a side, evenly spaced', () => {
    const m = byStyle('metro-car', 2010, mid);
    const ds = perSide(m, 'left');
    expect(ds.length).toBe(3);
    for (const d of ds) { expect(d.kind).toBe('pocket'); expect(d.leaves).toBe(2); expect(d.width).toBeGreaterThanOrEqual(1.5); }
    const xs = ds.map((d) => d.x).sort((a, b) => a - b);
    expect(xs[2] - xs[1]).toBeCloseTo(xs[1] - xs[0], 5);
  });
  test('tram sections: two pairs of plug doors a side; balcony trams: open platforms', () => {
    for (const m of MODELS.filter((x) => x.style === 'tram')) {
      expect(perSide(m, 'left').length, m.id).toBe(2);
      expect(doorsOf(m).every((d) => d.kind === 'plug' && d.leaves === 2)).toBe(true);
    }
    const h = byStyle('tram-heritage', 1930);
    expect(doorsOf(h).every((d) => d.kind === 'open')).toBe(true);
  });
  test('buses: doors on the kerb side only, the front door ahead of the front axle, folding before 1990, gliders after', () => {
    for (const m of MODELS.filter((x) => x.category === 'bus')) {
      const ds = doorsOf(m);
      if (m.style === 'bus-halfcab') { expect(ds.map((d) => d.kind)).toEqual(['open']); continue; }
      expect(ds.length, m.id).toBeGreaterThan(0);
      for (const d of ds) expect(d.sides, m.id).toEqual(['left']);
      if (m.style !== 'bus-bendy-rear' && m.style !== 'bus-heritage') {
        const front = ds[0], ax = m.dims.axles[0];
        expect(front.x - front.width / 2, m.id).toBeGreaterThan(ax + m.dims.wheelR);
      }
      const year = m.design.year as number;
      const moving = ds.filter((d) => d.kind !== 'open');
      if (m.style === 'coach') expect(moving.map((d) => d.kind), m.id).toEqual([year < 1980 ? 'fold' : 'glider']);
      else if (m.style !== 'bus-heritage') for (const d of moving) expect(d.kind, m.id).toBe(year < 1990 ? 'fold' : 'glider');
    }
    expect(doorsOf(byStyle('bus-bendy', 2015)).length).toBe(2);
    expect(doorsOf(byStyle('bus-bendy-rear', 2015)).length).toBe(1);
    expect(doorsOf(byStyle('coach', 2015)).map((d) => d.leaves)).toEqual([1]);
    expect(doorsOf(byStyle('bus-single', 2015, (m) => m.dims.length > 11)).length).toBe(2);
  });
  test('vehicles without passenger doors have none', () => {
    for (const s of ['diesel-loco', 'electric-loco', 'steam-tank', 'shunter', 'wagon-box', 'wagon-tank', 'brake-van', 'tender']) for (const m of MODELS.filter((x) => x.style === s)) expect(doorsOf(m), m.id).toEqual([]);
    for (const m of MODELS.filter((x) => x.category === 'car' || x.category === 'lorry' || x.category === 'boat')) expect(doorsOf(m)).toEqual([]);
    expect(doorsOf(byStyle('hs-power', 1990))).toEqual([]);
  });
  test('every door fits the body: inside its length, clear of the others and of the wheels, a sensible size', () => {
    for (const m of MODELS) {
      const ds = doorsOf(m);
      const xs = ds.map((d) => [d.x - d.width / 2, d.x + d.width / 2] as const).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < xs.length; i++) expect(xs[i][0] - xs[i - 1][1], `${m.id} doors ${i - 1}/${i}`).toBeGreaterThan(0.25);
      for (const d of ds) {
        expect(Math.abs(d.x) + d.width / 2, m.id).toBeLessThan(m.dims.length / 2);
        expect(d.y1 - d.y0, m.id).toBeGreaterThan(1.7);
        expect(d.y0, m.id).toBeGreaterThanOrEqual(0.25);
        expect(d.y1, m.id).toBeLessThan(m.dims.height);
        expect(d.width, m.id).toBeGreaterThanOrEqual(0.6);
        // road vehicles: never over a wheel
        if (m.category === 'bus') for (const a of m.dims.axles) expect(Math.abs(d.x - a), `${m.id} door over axle ${a}`).toBeGreaterThan(d.width / 2 + m.dims.wheelR);
      }
    }
  });
});

// ---------------- the geometry and the shader's motion ----------------

// every vertex of a kit, with its motion tag and wheel centre
function verts(m: Model, lod: 0 | 1 | 2) {
  const k = buildKit(m, lod);
  const out: { p: [number, number, number]; tag: Tag; wheel?: [number, number] }[] = [];
  for (let i = 0; i < k.pos.length / 3; i++) {
    const tag = [k.mot[i * 4], k.mot[i * 4 + 1], k.mot[i * 4 + 2], k.mot[i * 4 + 3]] as const;
    out.push({ p: [k.pos[i * 3], k.pos[i * 3 + 1], k.pos[i * 3 + 2]], tag, wheel: k.key[i * 4 + 3] > 0 ? [k.key[i * 4 + 2], k.key[i * 4 + 3]] : undefined });
  }
  return { k, out };
}
// the vertices that move with one door's leaves on one side
const leafVerts = (vs: ReturnType<typeof verts>['out'], d: Door, side: 1 | -1) => vs.filter((v) => DOOR_KINDS.has(v.tag[0]) && Math.sign(v.p[2]) === side && v.p[0] > d.x - d.width / 2 - 0.02 && v.p[0] < d.x + d.width / 2 + 0.02 && v.p[1] >= d.y0 - 0.01 && v.p[1] <= d.y1 + 0.01);
const moved = (vs: ReturnType<typeof verts>['out'], l: number, r: number) => vs.map((v) => moveVertex(v.p, v.tag, { doorL: l, doorR: r, odo: 0, curve: 0 }, v.wheel));

const PASSENGER = [
  byStyle('emu-car', 2022, cab), byStyle('emu-car', 1995, mid), byStyle('metro-car', 2010, cab), byStyle('coach-stock', 1940, (x) => x.design.panelled === true),
  byStyle('coach-stock', 1960, (x) => x.design.slam === true && x.design.panelled === false), byStyle('tram', 2020, mid), byStyle('dmu-car', 2015, cab), byStyle('hs-coach', 1980),
  byStyle('bus-double', 1980), byStyle('bus-double', 2015), byStyle('bus-bendy', 2015), byStyle('bus-bendy-rear', 2015), byStyle('coach', 1975), byStyle('coach', 2015), byStyle('bus-heritage', 1930),
];

describe('door geometry and motion', () => {
  test('every moving door has leaves at the near level, and nothing moves at the middle or far level', () => {
    for (const m of MODELS.filter((x) => doorsOf(x).some((d) => d.kind !== 'open'))) {
      const near = verts(m, 0).out;
      for (const d of doorsOf(m)) for (const side of d.sides) if (d.kind !== 'open') expect(leafVerts(near, d, side === 'right' ? 1 : -1).length, `${m.id} door at ${d.x.toFixed(1)} ${side}`).toBeGreaterThan(0);
      for (const lod of [1, 2] as const) expect(verts(m, lod).out.some((v) => DOOR_KINDS.has(v.tag[0])), `${m.id} lod ${lod}`).toBe(false);
    }
  });
  test('shut doors sit exactly where they were built', () => {
    for (const m of PASSENGER) {
      const { out } = verts(m, 0);
      const p = moved(out.map((v) => ({ ...v, wheel: undefined })), 0, 0);
      out.forEach((v, i) => { if (DOOR_KINDS.has(v.tag[0])) expect(p[i], m.id).toEqual(v.p); });
    }
  });
  test('open doors clear the doorway, on the side that was opened and no other', () => {
    for (const m of PASSENGER) {
      const { out } = verts(m, 0);
      for (const d of doorsOf(m)) for (const side of d.sides) {
        if (d.kind === 'open') continue;
        const s = side === 'right' ? 1 : -1;
        const idx = out.map((v, i) => [v, i] as const).filter(([v]) => leafVerts([v], d, s).length).map(([, i]) => i);
        const open = moved(out, s < 0 ? 1 : 0, s > 0 ? 1 : 0);
        const other = moved(out, s < 0 ? 0 : 1, s > 0 ? 0 : 1);
        const xa = d.x - d.width / 2 + 0.08, xb = d.x + d.width / 2 - 0.08;
        const hw = m.dims.width / 2;
        for (const i of idx) {
          const [x, , z] = open[i];
          // nothing of the leaf is left across the opening at the body side (a swung or folded
          // leaf may stand out from it or fold behind it, but not across it)
          const across = x > xa && x < xb && Math.abs(Math.abs(z) - hw) < 0.06;
          if (d.kind !== 'slam' && d.kind !== 'fold') expect(across, `${m.id} ${d.kind} leaf vertex still across the doorway: ${x.toFixed(2)}`).toBe(false);
          // opening the other side leaves this one alone
          expect(other[i], `${m.id} other side moved`).toEqual(out[i].p);
        }
        if (d.kind === 'slam' || d.kind === 'glider') {
          // the free edge swings out from the side, well clear of the body
          const zs = idx.map((i) => open[i][2] * s);
          expect(Math.max(...zs) - hw, m.id).toBeGreaterThan((d.width / d.leaves) * 0.8);
          expect(Math.min(...zs), m.id).toBeGreaterThan(hw - 0.05);
        }
        if (d.kind === 'fold') {
          // folded outward against the jambs (the body is solid behind the doorway, so inward they'd vanish)
          const zs = idx.map((i) => open[i][2] * s);
          expect(Math.max(...zs), m.id).toBeGreaterThan(hw + d.width / 8);
          expect(Math.min(...zs), m.id).toBeGreaterThan(hw - 0.05);
          for (const i of idx) { const x = open[i][0]; expect(Math.min(Math.abs(x - (d.x - d.width / 2)), Math.abs(x - (d.x + d.width / 2))), m.id).toBeLessThan(d.width / 4 + 0.1); }
        }
        if (d.kind === 'plug') {
          // stood out from the body side, over it
          for (const i of idx) expect(open[i][2] * s - out[i].p[2] * s, m.id).toBeCloseTo(0.09, 5);
        }
      }
    }
  });
  test('plug doors step out before they slide, and slide back before they step in', () => {
    expect(plugStep(0.25)).toBe(1);
    expect(plugSlide(0.2)).toBe(0);
    expect(plugSlide(0.25)).toBeLessThan(0.02);
    expect(plugStep(0.1)).toBeGreaterThan(plugSlide(0.1));
    for (let t = 0; t <= 1; t += 0.05) { expect(plugStep(t)).toBeGreaterThanOrEqual(plugSlide(t) - 1e-12); }
    const m = byStyle('emu-car', 2022, cab);
    const { out } = verts(m, 0);
    const d = doorsOf(m)[0];
    const idx = out.map((v, i) => [v, i] as const).filter(([v]) => leafVerts([v], d, -1).length && v.tag[0] === MOTION.plug).map(([, i]) => i);
    const at = (t: number) => moved(out, t, 0);
    const early = at(0.22);
    for (const i of idx) {
      expect(Math.abs(early[i][2]) - Math.abs(out[i].p[2])).toBeGreaterThan(0.085); // fully out
      expect(Math.abs(early[i][0] - out[i].p[0])).toBeLessThan(0.01); // not slid yet
    }
  });
  test('pocket doors vanish into the body at the jamb rather than sliding over it', () => {
    const m = byStyle('metro-car', 2010, mid);
    const { out } = verts(m, 0);
    for (const d of doorsOf(m)) {
      const idx = out.map((v, i) => [v, i] as const).filter(([v]) => leafVerts([v], d, 1).length).map(([, i]) => i);
      const open = moved(out, 0, 1);
      for (const i of idx) expect(open[i][0], m.id).toBeGreaterThanOrEqual(d.x - d.width / 2 - 1e-9);
      for (const i of idx) expect(open[i][0], m.id).toBeLessThanOrEqual(d.x + d.width / 2 + 1e-9);
      // and no leaf area is left: every leaf vertex is on one of the two jambs
      for (const i of idx) expect(Math.min(Math.abs(open[i][0] - (d.x - d.width / 2)), Math.abs(open[i][0] - (d.x + d.width / 2)))).toBeLessThan(1e-9);
    }
  });
  test('packing the doors keeps both sides', () => {
    for (const [l, r] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.25, 0.75], [0.5, 0.001]]) {
      const [a, b] = unpackDoors(packDoors(l, r));
      expect(a).toBeCloseTo(l, 3); expect(b).toBeCloseTo(r, 3);
    }
    expect(packDoors(0, 0)).toBe(0);
    expect(Number.isInteger(packDoors(0.3, 0.9))).toBe(true);
    expect(packDoors(1, 1)).toBeLessThan(2 ** 24); // exact in a float32
  });
  test('easing is smooth and bounded', () => {
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(-1)).toBe(0); expect(ease(2)).toBe(1);
    for (let t = 0; t < 1; t += 0.01) expect(ease(t + 0.01)).toBeGreaterThanOrEqual(ease(t));
  });
});

describe('wheels, bogies, steering, rods and pantographs', () => {
  test('wheels turn once for every circumference travelled', () => {
    for (const r of [0.33, 0.46, 0.95]) {
      expect(wheelAngle(2 * Math.PI * r, r)).toBeCloseTo(-2 * Math.PI, 9);
      expect(wheelAngle(1, r)).toBeCloseTo(-1 / r, 9);
    }
    // a wheel vertex moves round its centre by that angle, and rolls forward (turns clockwise seen from +z)
    const m = byStyle('bus-single', 2015);
    const { out } = verts(m, 0);
    const w = out.find((v) => v.wheel && v.p[1] > v.wheel[1] + 0.2)!;
    const r = w.wheel![1];
    const p = moveVertex(w.p, w.tag, { doorL: 0, doorR: 0, odo: (Math.PI / 2) * r, curve: 0 }, w.wheel);
    const a0 = Math.atan2(w.p[1] - r, w.p[0] - w.wheel![0]), a1 = Math.atan2(p[1] - r, p[0] - w.wheel![0]);
    expect(turn(a1 - a0)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.hypot(p[0] - w.wheel![0], p[1] - r)).toBeCloseTo(Math.hypot(w.p[0] - w.wheel![0], w.p[1] - r), 9);
  });
  test('bogies swivel into the curve: the front one one way, the back one the other, by the chord geometry', () => {
    const R = 200, k = 1 / R;
    expect(bogieYaw(8, k)).toBeCloseTo(Math.asin(8 / R), 9);
    expect(bogieYaw(-8, k)).toBeCloseTo(-Math.asin(8 / R), 9);
    expect(bogieYaw(8, -k)).toBeLessThan(0);
    expect(Math.abs(bogieYaw(8, 10))).toBeCloseTo(Math.asin(MAX_BOGIE), 9);
    // on a real car: the bogie's wheels follow the rail tangent under the pivot
    const m = byStyle('emu-car', 2022, mid);
    const { out } = verts(m, 0);
    const piv = m.dims.axles[0];
    const tagged = out.filter((v) => v.tag[0] === MOTION.bogie && Math.abs(v.tag[1] - piv) < 1e-9);
    expect(tagged.length).toBeGreaterThan(20);
    const s = { doorL: 0, doorR: 0, odo: 0, curve: k };
    // a point 1 m ahead of the pivot on the bogie's centre line ends up turned by asin(piv / R)
    const q = moveVertex([piv + 1, 0.5, 0], [MOTION.bogie, piv, 0, 0], s);
    expect(Math.atan2(q[2], q[0] - piv)).toBeCloseTo(Math.asin(piv / R), 9);
    // body vertices don't move
    const body = out.find((v) => v.tag[0] === 0)!;
    expect(moveVertex(body.p, body.tag, s)).toEqual(body.p);
    // every rail bogie at the near and middle level is tagged
    for (const lod of [0, 1] as const) expect(verts(m, lod).out.filter((v) => v.tag[0] === MOTION.bogie).length, `lod ${lod}`).toBeGreaterThan(0);
  });
  test('front wheels steer by the bicycle model, rear wheels do not', () => {
    expect(steerAngle(3, 1 / 20)).toBeCloseTo(Math.atan(3 / 20), 9);
    expect(steerAngle(3, -1 / 20)).toBeLessThan(0);
    const m = byStyle('bus-single', 2015);
    const { out } = verts(m, 0);
    const steered = out.filter((v) => v.tag[0] === MOTION.steer);
    expect(steered.length).toBeGreaterThan(0);
    for (const v of steered) expect(v.tag[1]).toBe(m.dims.axles[0]);
    expect(steered.every((v) => v.tag[3] > 3)).toBe(true);
    for (const c of MODELS.filter((x) => x.category === 'car').slice(0, 20)) expect(verts(c, 0).out.some((v) => v.tag[0] === MOTION.steer), c.id).toBe(true);
  });
  test('coupling rods go round with the crank pins without turning', () => {
    const m = byStyle('steam-tank', 1930);
    const { out } = verts(m, 0);
    const rods = out.filter((v) => v.tag[0] === MOTION.rod);
    expect(rods.length).toBeGreaterThan(0);
    const r = m.dims.wheelR;
    for (const odo of [0.3, 1.1, 2.9]) {
      const d0 = rods.map((v) => moveVertex(v.p, v.tag, { doorL: 0, doorR: 0, odo, curve: 0 }));
      // every vertex of a rod shifts by the same amount: it translates, it doesn't rotate
      const byRod = new Map<number, [number, number][]>();
      rods.forEach((v, i) => { const key = v.tag[2]; const a = byRod.get(key) ?? []; a.push([d0[i][0] - v.p[0], d0[i][1] - v.p[1]]); byRod.set(key, a); });
      for (const shifts of byRod.values()) for (const [dx, dy] of shifts) { expect(dx).toBeCloseTo(shifts[0][0], 9); expect(dy).toBeCloseTo(shifts[0][1], 9); }
      // and the shift is the crank pin's own movement round the wheel
      const [cr, ph] = [rods[0].tag[1], rods[0].tag[2]];
      const a = wheelAngle(odo, r);
      const [dx, dy] = [d0[0][0] - rods[0].p[0], d0[0][1] - rods[0].p[1]];
      expect(dx).toBeCloseTo(cr * (Math.cos(ph + a) - Math.cos(ph)), 9);
      expect(dy).toBeCloseTo(cr * (Math.sin(ph + a) - Math.sin(ph)), 9);
    }
  });
  test('pantographs are up on electric stock and fold down with the flag', () => {
    const e = byStyle('electric-loco', 1990);
    const { out } = verts(e, 0);
    const p = out.filter((v) => v.tag[0] === MOTION.panto);
    expect(p.length).toBeGreaterThan(0);
    const top = Math.max(...p.map((v) => v.p[1]));
    expect(top).toBeGreaterThan(e.dims.height + 1.2);
    const down = Math.max(...p.map((v) => moveVertex(v.p, v.tag, { doorL: 0, doorR: 0, odo: 0, curve: 0, pantoDown: true })[1]));
    expect(down).toBeLessThan(e.dims.height + 0.6);
    // stock without a pantograph has none: diesel units, metro cars (third rail), tram end sections
    for (const m of [byStyle('dmu-car', 2015, cab), byStyle('metro-car', 2010, mid), byStyle('tram', 2020, cab)]) expect(verts(m, 0).out.some((v) => v.tag[0] === MOTION.panto), m.id).toBe(false);
  });
});

describe('driving the doors', () => {
  test('DoorStates opens and shuts at the door kind\'s own speed, per side', () => {
    const ds = new DoorStates();
    const m = byStyle('metro-car', 2010, mid);
    ds.setDoors('a', 1, 'right', { model: m });
    expect(ds.get('a')).toEqual([0, 0]);
    const T = doorSeconds(m);
    expect(T).toBe(DOOR_SECONDS.pocket);
    ds.update(T / 2);
    expect(ds.get('a')[0]).toBe(0);
    expect(ds.get('a')[1]).toBeCloseTo(0.5, 9);
    ds.update(T);
    expect(ds.get('a')).toEqual([0, 1]);
    ds.setDoors('a', 0, 'both');
    ds.update(T * 2);
    expect(ds.get('a')).toEqual([0, 0]);
    expect(ds.size).toBe(0); // shut doors are forgotten
    expect(new DoorStates().get('nobody')).toEqual([0, 0]);
  });
  test('DoorStates staggers cars with a delay', () => {
    const ds = new DoorStates();
    ds.setDoors(0, 1, 'left', { delay: 0 });
    ds.setDoors(1, 1, 'left', { delay: 0.5 });
    ds.update(0.4); ds.update(0.4);
    expect(ds.get(0)[0]).toBeGreaterThan(ds.get(1)[0]);
  });
  test('dwellDoors: shut on arrival, open while standing, shut again before leaving, each car a little later', () => {
    const m = byStyle('emu-car', 2022, mid);
    const dwell = 20;
    expect(dwellDoors(0, dwell, m)).toBe(0);
    expect(dwellDoors(0.5, dwell, m)).toBe(0);
    expect(dwellDoors(10, dwell, m)).toBe(1);
    expect(dwellDoors(dwell - 0.5, dwell, m)).toBe(0);
    expect(dwellDoors(dwell + 3, dwell, m)).toBe(0);
    expect(dwellDoors(2, dwell, m, 0)).toBeGreaterThan(dwellDoors(2, dwell, m, 3));
    // a short stop still shuts in time
    for (let t = 0; t < 4; t += 0.1) expect(dwellDoors(t, 4, m)).toBeLessThanOrEqual(1);
    expect(dwellDoors(3.3, 4, m)).toBe(0);
  });
  test('doorPositions: each door in the world, outside the body, on the named side', () => {
    const m = byStyle('emu-car', 2022, mid);
    const pose = { x: 1000, z: -40000, heading: 0.7, y: 0.28 };
    const all = doorPositions(m, pose);
    expect(all.length).toBe(doorsOf(m).length * 2);
    for (const d of all) {
      expect(platformSide(pose, d)).toBe(d.side);
      const local = doorsOf(m)[d.index];
      // along the car: its x; across: just outside the body
      const dx = d.x - pose.x, dz = d.z - pose.z;
      expect(dx * Math.cos(pose.heading) + dz * Math.sin(pose.heading)).toBeCloseTo(local.x, 6);
      expect(Math.abs(-dx * Math.sin(pose.heading) + dz * Math.cos(pose.heading))).toBeCloseTo(m.dims.width / 2 + 0.12, 6);
      expect(d.y).toBeCloseTo(0.28 + local.y0, 9);
      // the normal points away from the car
      expect(d.nx * dx + d.nz * dz).toBeGreaterThan(0);
    }
    // narrowed to the side a platform is on
    const platform = { x: pose.x - Math.sin(pose.heading) * 5, z: pose.z + Math.cos(pose.heading) * 5 };
    expect(platformSide(pose, platform)).toBe('right');
    const right = doorPositions(m, pose, platform);
    expect(right.length).toBe(doorsOf(m).length);
    expect(right.every((d) => d.side === 'right')).toBe(true);
    // buses only have kerb-side doors
    expect(doorPositions(byStyle('bus-double', 2015), pose, 'right')).toEqual([]);
  });
  test('the layouts drive the geometry: no window glass across a doorway', () => {
    for (const m of [byStyle('bus-single', 2015, (x) => x.dims.length > 11), byStyle('bus-double', 1980), byStyle('coach', 2015), byStyle('emu-car', 2022, mid), byStyle('coach-stock', 1940, (x) => x.design.panelled === true)]) {
      const { out } = verts(m, 0);
      const hw = m.dims.width / 2;
      for (const d of doorsOf(m)) for (const side of d.sides) {
        const s = side === 'right' ? 1 : -1;
        // windows are drawn 12 mm off the body side; nothing static at that depth may cross the door
        const win = out.filter((v) => v.tag[0] === 0 && Math.abs(v.p[2] * s - (hw + 0.012)) < 0.0004 && v.p[0] > d.x - d.width / 2 + 0.02 && v.p[0] < d.x + d.width / 2 - 0.02 && v.p[1] > d.y0 && v.p[1] < d.y1);
        expect(win.length, `${m.id} window across door at ${d.x.toFixed(2)}`).toBe(0);
      }
    }
  });
});

describe('cost', () => {
  test('triangles per level of detail stay in budget, and the doors are near-level detail', () => {
    for (const m of PASSENGER) {
      const [a, b, c] = ([0, 1, 2] as const).map((l) => buildKit(m, l).tris);
      const B = BUDGET[m.category];
      expect(a, m.id).toBeLessThanOrEqual(B[0]);
      expect(b, m.id).toBeLessThanOrEqual(B[1]);
      expect(c, m.id).toBeLessThanOrEqual(B[2]);
      // the far level is still the box
      expect(c, m.id).toBeLessThanOrEqual(12);
    }
    // the middle level of a slam-door coach pays nothing for its doors
    const slam = byStyle('coach-stock', 1940, (x) => x.design.panelled === true);
    expect(buildKit(slam, 1).tris).toBeLessThanOrEqual(90);
  });
  test('doors, wheels and bogies cost no draw calls: one per model and level, whatever each vehicle is doing', () => {
    const vr = new VehicleRenderer({ shadows: false });
    const models = [byStyle('emu-car', 2022, cab), byStyle('emu-car', 2022, mid), byStyle('bus-double', 2015)];
    const m4 = new THREE.Matrix4(), cols = [new THREE.Color('#ff0000')];
    vr.begin();
    for (let i = 0; i < 90; i++) vr.add(models[i % 3], 0, m4, cols, 0, i, i % 2, (i % 5) / 4, (i % 7) / 100);
    vr.end(0);
    expect(vr.stats.calls).toBe(3);
    expect(vr.stats.instances).toBe(90);
    // the door state and curvature went into the instance data
    const bucket = vr.group.children[0] as THREE.InstancedMesh;
    const data = bucket.geometry.getAttribute('iData') as THREE.InstancedBufferAttribute;
    expect(data.itemSize).toBe(4);
    // the second instance in the first model's bucket is vehicle 3
    expect(unpackDoors(data.getZ(1))[0]).toBeCloseTo(1, 3);
    expect(unpackDoors(data.getZ(1))[1]).toBeCloseTo(0.75, 3);
    expect(data.getW(1)).toBeCloseTo(3 / 100, 6);
    vr.dispose();
  });
  test('the shader patch finds every place it hooks into three\'s Lambert shader', () => {
    const { material } = vehicleMaterial();
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    const v0 = sh.vertexShader;
    material.onBeforeCompile(sh, undefined as unknown as THREE.WebGLRenderer);
    for (const needle of ['attribute vec4 vd;', 'attribute vec4 iData;', 'mvKind', 'mvPhi', 'transformed.x += vd.y', 'li == 10', 'mvYaw(objectNormal.xz']) expect(sh.vertexShader, needle).toContain(needle);
    expect(sh.vertexShader.length).toBeGreaterThan(v0.length + 1000);
    expect(sh.fragmentShader).toContain('totalEmissiveRadiance += vEmit;');
    // the motion comes after the wheel spin and before projection
    const vs = sh.vertexShader;
    expect(vs.indexOf('transformed.xy = spin')).toBeLessThan(vs.indexOf('mvKind == 1'));
    expect(vs.indexOf('mvKind == 1')).toBeLessThan(vs.indexOf('#include <project_vertex>'));
  });
});

describe('trailers', () => {
  // drive a tractor round a circle in steps of `step` metres and return the settled trailer angle
  function settle(step: number) {
    const t = MODEL[MODELS.find((m) => m.style === 'tractor')!.id], tr = MODELS.find((m) => m.style === 'trailer-box')!;
    const R = 25;
    let prev: Pose | undefined;
    let tractor: Pose = { x: R, z: 0, heading: Math.PI / 2 };
    for (let s = 0; s < 400; s += step) {
      const a = s / R;
      tractor = { x: R * Math.cos(a), z: R * Math.sin(a), heading: a + Math.PI / 2 };
      prev = follow(tractor, t, tr, prev);
    }
    return articulationAngle(tractor, prev!);
  }
  test('the trailer settles to the same angle on a curve whatever the frame step', () => {
    const fine = settle(0.05), coarse = settle(3), huge = settle(8);
    expect(Math.abs(fine)).toBeGreaterThan(0.2);
    // within half a degree at 3 m a frame (50 km/h at 5 fps), two degrees at 8 m
    expect(Math.abs(coarse - fine)).toBeLessThan(0.009);
    expect(Math.abs(huge - fine)).toBeLessThan(0.035);
  });
  test('the trailer stays hitched and never folds past its limit', () => {
    const t = MODELS.find((m) => m.style === 'tractor')!, tr = MODELS.find((m) => m.style === 'trailer-box')!;
    let prev: Pose | undefined = undefined;
    // a U-turn on the spot: the tractor spins round
    for (let i = 0; i <= 40; i++) {
      const tractor = { x: 0, z: 0, heading: (i / 40) * Math.PI * 1.5 };
      prev = follow(tractor, t, tr, prev);
      expect(Math.abs(articulationAngle(tractor, prev))).toBeLessThanOrEqual(1.3 + 1e-9);
      const h1 = ahead(tractor, t.hitch!.rear!), h2 = ahead(prev, tr.hitch!.front!);
      expect(Math.hypot(h1.x - h2.x, h1.z - h2.z)).toBeLessThan(1e-9);
    }
  });
});

const turn = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
