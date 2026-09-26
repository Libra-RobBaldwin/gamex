import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, ROADS, halfOf, kerbOf, pointAt, type P } from './roads';
import { TAPER, courseOf, normals, sectionAt, taperOf, type Course } from './xsection';
import { joinShape } from './jshape';
import { GROUND, STD } from './standards';
import { asphaltMat, drawRoads, lineMat, paveMat, vergeMat } from './roaddraw';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
// a point on the line `o` to the left (Flat.strip's + side) of a course, at distance r along it, as drawn
function offsetAt(c: Course, r: number, o: number) {
  const { path, rho } = c, nl = normals(path, c.dirs);
  let i = 1;
  while (i < path.length - 1 && rho[i] < r) i++;
  const f = Math.max(0, Math.min(1, (r - rho[i - 1]) / (rho[i] - rho[i - 1] || 1)));
  const p = { x: path[i - 1].x + nl[i - 1].x * o, z: path[i - 1].z + nl[i - 1].z * o }, q = { x: path[i].x + nl[i].x * o, z: path[i].z + nl[i].z * o };
  return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f };
}
// two roads meeting at (0,0), the second turning off by `deg` degrees
function bend(deg: number, t1 = 'street', t2 = 'street') {
  const n = new Network();
  const [s1] = n.build({ x: -120, z: 0 }, { x: 0, z: 0 }, undefined, as(t1));
  const a = (deg * Math.PI) / 180;
  const [s2] = n.build(n.snapStart({ x: 0, z: 0 }, 2), { x: Math.cos(a) * 120, z: Math.sin(a) * 120 }, undefined, as(t2));
  return { n, s1: n.segs.get(s1)!, s2: n.segs.get(s2)! };
}
// Draw the network for real and collect the triangles of each surface, seen from above.
function drawn(n: Network) {
  const g = new THREE.Group(), m = new THREE.MeshLambertMaterial();
  drawRoads(n, g, new Map(), m, m);
  const tris = (mat: THREE.Material) => g.children.filter((c) => (c as THREE.Mesh).material === mat).flatMap((c) => [...((c as THREE.Mesh).geometry.getAttribute('position').array as Float32Array)]);
  const within = (pos: number[], p: P) => {
    for (let i = 0; i < pos.length; i += 9) {
      const [ax, az, bx, bz, cx, cz] = [pos[i], pos[i + 2], pos[i + 3], pos[i + 5], pos[i + 6], pos[i + 8]];
      if (Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) < 1e-9) continue; // (a strip pinched to a point covers nothing)
      const d1 = (p.x - bx) * (az - bz) - (ax - bx) * (p.z - bz), d2 = (p.x - cx) * (bz - cz) - (bx - cx) * (p.z - cz), d3 = (p.x - ax) * (cz - az) - (cx - ax) * (p.z - az);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  };
  const surf = { asph: tris(asphaltMat), pave: tris(paveMat), verge: tris(vergeMat), lines: tris(lineMat) };
  return { ...surf, at: (k: keyof typeof surf, p: P) => within(surf[k], p) };
}
// distance from a point to a polyline
function toPath(p: P, path: P[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / L2));
    best = Math.min(best, Math.hypot(p.x - a.x - (b.x - a.x) * t, p.z - a.z - (b.z - a.z) * t));
  }
  return best;
}

describe('two roads meeting end to end (no junction)', () => {
  it('a bend is a curve about the point where the inside kerbs meet', () => {
    const K = kerbOf(ROADS.street), B = halfOf(ROADS.street);
    const J = joinShape({ x: 0, z: 0 }, { path: [{ x: 0, z: 0 }, { x: -50, z: 0 }], kerb: K, back: B }, { path: [{ x: 0, z: 0 }, { x: 0, z: 50 }], kerb: K, back: B });
    // a right-angled bend: the inside kerbs meet K from each road's centreline, K back from the node
    expect(J.cut[0]).toBeCloseTo(K, 5);
    expect(J.cut[1]).toBeCloseTo(K, 5);
    expect(dist(J.X!, { x: -K, z: K })).toBeLessThan(1e-6);
    // the centreline runs round it at radius K, so the carriageway keeps its width
    for (const p of [...J.arc[0], ...J.arc[1]]) expect(dist(p, J.X!)).toBeCloseTo(K, 5);
    expect(dist(J.arc[0][0], J.arc[1][0])).toBeLessThan(1e-9);
  });
  it('straight on needs no curve, and the two roads meet square with no seam', () => {
    for (const deg of [0, 0.03]) {
      const { n, s1, s2 } = bend(deg);
      const c1 = courseOf(n, s1), c2 = courseOf(n, s2);
      expect(c1.kinds[1]).toBe('join');
      expect(c1.cut[1]).toBe(0);
      expect(c2.cut[0]).toBe(0);
      expect(dist(c1.path[c1.path.length - 1], c2.path[0])).toBeLessThan(1e-9);
      // both are drawn square to the same direction where they meet
      const a = normals(c1.path, c1.dirs), b = normals(c2.path, c2.dirs);
      expect(dist(a[a.length - 1], b[0])).toBeLessThan(1e-9);
    }
  });
  for (const deg of [15, 30, 60, 90]) it(`kerbs and footways meet with no gap or step round a ${deg}° bend`, () => {
    const { n, s1, s2 } = bend(deg);
    const c1 = courseOf(n, s1), c2 = courseOf(n, s2);
    // both roads' courses meet at the middle of the bend
    expect(dist(c1.path[c1.path.length - 1], c2.path[0])).toBeLessThan(1e-6);
    // every line of the road (both kerbs, the backs of both footways, the centre line) is continuous
    // where one road's course hands over to the other's
    const K = kerbOf(ROADS.street), B = halfOf(ROADS.street);
    for (const o of [K, -K, B, -B, 0]) expect(dist(offsetAt(c1, c1.len, o), offsetAt(c2, 0, o))).toBeLessThan(1e-6);
    // the outside kerb and footway follow arcs about the bend's centre; the centre line runs K from it
    const X = c1.joins[1]!.X!, inside = c1.limit((c1.own[1] + c1.len) / 2)!.side;
    for (let r = c1.own[1]; r <= c1.len; r += 0.2) {
      expect(dist(offsetAt(c1, r, -inside * K), X)).toBeCloseTo(2 * K, 1);
      expect(dist(offsetAt(c1, r, -inside * B), X)).toBeCloseTo(K + B, 1);
      expect(dist(offsetAt(c1, r, 0), X)).toBeCloseTo(K, 1);
    }
    // the inside kerbs meet at X, which is where both roads' own inside kerbs end
    expect(dist(offsetAt(c1, c1.own[1], inside * K), X)).toBeLessThan(0.02);
    expect(dist(offsetAt(c2, c2.own[0], inside * K), X)).toBeLessThan(0.02);
    // and the inside corner of the footway is filled
    expect(c1.fills[1]?.length).toBe(4);
    expect(c2.fills[0]?.length).toBe(4);
  });
  for (const deg of [20, 45, 90]) it(`as drawn, a ${deg}° bend is carriageway and footway all the way round, with nothing spilling outside`, () => {
    const { n, s1, s2 } = bend(deg);
    const D = drawn(n), c1 = courseOf(n, s1), c2 = courseOf(n, s2), X = c1.joins[1]!.X!;
    const K = kerbOf(ROADS.street), B = halfOf(ROADS.street), e = 0.15;
    let checked = 0;
    for (let x = -14; x <= 14; x += 0.37) for (let z = -14; z <= 14; z += 0.37) {
      const p = { x, z }, d = Math.min(toPath(p, c1.path), toPath(p, c2.path));
      if (d < K - e) { expect(D.at('asph', p), `carriageway at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true); checked++; }
      else if (d > K + e && d < B - e) { expect(D.at('pave', p), `footway at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(true); expect(D.at('asph', p)).toBe(false); checked++; }
      // outside the bend, nothing beyond the back of the footway
      else if (d > B + 0.3 && (p.x * X.x + p.z * X.z) < 0) { expect(D.at('pave', p) || D.at('asph', p), `spill at ${x.toFixed(2)},${z.toFixed(2)}`).toBe(false); checked++; }
    }
    expect(checked).toBeGreaterThan(3000);
  });
  it('a dual carriageway round a bend keeps its reservation, with no nose', () => {
    const { n, s1 } = bend(30, 'dual', 'dual');
    const D = drawn(n), c = courseOf(n, s1);
    expect(c.onward[1]?.def.id).toBe('dual');
    // the reservation runs right through the middle of the bend: no carriageway there
    expect(D.at('asph', c.path[c.path.length - 1])).toBe(false);
    expect(D.at('asph', offsetAt(c, c.len, ROADS.dual.median / 2 + 1))).toBe(true);
  });
});

describe('where a dual carriageway becomes a single road', () => {
  const n = new Network();
  const [st] = n.build({ x: -200, z: 0 }, { x: 0, z: 0 });
  const [du] = n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 300, z: 0 }, undefined, as('dual'));
  const dual = n.segs.get(du)!, street = n.segs.get(st)!;
  const T = taperOf(n, dual).A!, D = drawn(n), path = n.path(dual);
  const across = (t: number, o: number) => { const q = pointAt(path, t); return { x: q.x + q.uz * o, z: q.z - q.ux * o }; };
  it('the course follows sectionAt all along the taper', () => {
    const c = courseOf(n, dual);
    for (let t = 0; t <= T.len + 10; t += 3.7) {
      const a = c.sec(c.rhoOf(t)), b = sectionAt(n, dual, t);
      expect(a.kerb).toBeCloseTo(b.kerb, 6);
      expect(a.back).toBeCloseTo(b.back, 6);
      expect(a.median).toBeCloseTo(b.median, 6);
    }
    // and the street's course hands over to the dual's at exactly the street's cross-section
    const cs = courseOf(n, street);
    expect(cs.sec(cs.len).kerb).toBeCloseTo(kerbOf(ROADS.street), 6);
    expect(c.sec(0).kerb).toBeCloseTo(kerbOf(ROADS.street), 6);
  });
  it('as drawn, the kerbs and the backs of the footways are where sectionAt puts them', () => {
    for (let t = 1; t <= T.len + 15; t += 2.3) {
      const x = sectionAt(n, dual, t);
      for (const k of [1, -1]) {
        expect(D.at('asph', across(t, k * (x.kerb - 0.08))), `kerb inside at ${t}`).toBe(true);
        expect(D.at('asph', across(t, k * (x.kerb + 0.08))), `kerb outside at ${t}`).toBe(false);
        expect(D.at('pave', across(t, k * (x.kerb + 0.08))), `footway at ${t}`).toBe(true);
        expect(D.at('pave', across(t, k * (x.back - 0.08))), `back inside at ${t}`).toBe(true);
        expect(D.at('pave', across(t, k * (x.back + 0.08))), `back outside at ${t}`).toBe(false);
      }
    }
  });
  it('the reservation opens as a painted ghost island, then the kerbed reservation starts with its nose', () => {
    const r = ROADS.dual.median / 2, hatch: number[] = [];
    for (let t = T.len * TAPER.hold + 1; t < T.len * TAPER.median - 1; t += 0.5) {
      // painted over the carriageway, not kerbed...
      expect(D.at('asph', across(t, 0)), `ghost island at ${t}`).toBe(true);
      if (D.at('lines', across(t, 0))) hatch.push(t);
    }
    // ...with diagonal stripes across it
    expect(hatch.length).toBeGreaterThan(3);
    // past the nose, the reservation is kerbed: no carriageway in the middle
    for (let t = T.len * TAPER.median + r + 0.5; t < T.len + 20; t += 3) expect(D.at('asph', across(t, 0)), `reservation at ${t}`).toBe(false);
  });
  it('"lane ends" arrows are in the offside lane heading for the street, not the other way', () => {
    const { length } = STD.deflectionArrow(ROADS.dual.mph), x = sectionAt(n, dual, T.len);
    const c = x.median + x.lane / 2; // the middle of the offside lane
    let towards = 0, away = 0;
    // (the arrow's straight shaft is its back half, furthest from the street)
    for (let t = T.len * 0.9 + length * 0.55; t < T.len * 0.9 + length * 0.95; t += 0.25) {
      // traffic heading for the street (at the a end) drives on the road's right: -offset
      if (D.at('lines', across(t, -c))) towards++;
      if (D.at('lines', across(t, c))) away++;
    }
    expect(towards).toBeGreaterThan(5);
    expect(away).toBe(0);
  });
  it('the land it takes narrows with the taper', () => {
    for (let t = 2; t < T.len + 20; t += 3) {
      const b = sectionAt(n, dual, t).back;
      for (const k of [1, -1]) {
        expect(n.land.at(across(t, k * (b - 0.2)))?.key, `claimed at ${t}`).toBe(`road:${du}`);
        expect(n.land.at(across(t, k * (b + 0.3))), `free at ${t}`).toBeUndefined();
      }
    }
    expect(sectionAt(n, dual, 5).back).toBeLessThan(halfOf(ROADS.dual) - 2);
  });
});

describe('where roads end', () => {
  it('a dead end just stops: no turning circle', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 100, z: 0 });
    expect(courseOf(n, n.segs.get(id)!).kinds[1]).toBe('end');
    expect(n.land.at({ x: 108, z: -6 })).toBeUndefined();
    expect(drawn(n).at('asph', { x: 100, z: STD.turningHead.R - 0.3 })).toBe(false);
  });
  it('with turning heads asked for, a cul-de-sac gets one, whose land is freed when the road is carried on', () => {
    const n = new Network();
    n.turningHeads = true;
    const [id] = n.build({ x: 0, z: 0 }, { x: 100, z: 0 });
    const c = courseOf(n, n.segs.get(id)!);
    expect(c.kinds[1]).toBe('head');
    const R = STD.turningHead.R + ROADS.street.pave;
    expect(n.land.at({ x: 100 + R - 0.5, z: 0 })?.key).toBe(`road:${id}`);
    expect(n.land.at({ x: 108, z: -6 })?.key).toBe(`road:${id}`);
    // drawn: a turning circle of the right size
    const D = drawn(n);
    expect(D.at('asph', { x: 100 + STD.turningHead.R - 0.3, z: 0 })).toBe(true);
    expect(D.at('asph', { x: 100, z: STD.turningHead.R - 0.3 })).toBe(true);
    expect(D.at('pave', { x: 100 + R - 0.3, z: 0 })).toBe(true);
    n.build(n.snapStart({ x: 100, z: 0 }, 2), { x: 100, z: 100 });
    expect(courseOf(n, n.segs.get(id)!).kinds[1]).toBe('join');
    expect(n.land.at({ x: 108, z: -6 })).toBeUndefined();
  });
  it('a road running off the map carries on to the edge of the ground, with no turning head', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: n.bound - 10, z: 0 }, undefined, as('dual'));
    const c = courseOf(n, n.segs.get(id)!);
    expect(c.kinds).toEqual(['end', 'edge']);
    expect(c.path[c.path.length - 1].x).toBeCloseTo(n.bound * GROUND, 6);
    const D = drawn(n);
    expect(D.at('asph', { x: n.bound + 50, z: kerbOf(ROADS.dual) - 1 })).toBe(true);
    // (the far end, in the middle of a field, just stops)
    expect(D.at('asph', { x: -2, z: kerbOf(ROADS.dual) - 1 })).toBe(false);
  });
});
