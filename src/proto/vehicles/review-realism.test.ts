// Adversarial review: realism and visual correctness of doors and moving parts. Every test here
// states what the real thing does and checks the built geometry (and the shader's motion, via
// moveVertex) against it.
import { describe, expect, test } from 'vitest';
import { MODELS } from './models';
import { buildKit } from './build';
import { Kit } from './kit';
import { busLayout, doorsOf, drawDoors, railLayout } from './doors';
import { MOTION, moveVertex, type Tag } from './motion';
import type { Model } from './types';

type V3 = [number, number, number];
const DOOR_KINDS = new Set<number>([MOTION.plug, MOTION.pocket, MOTION.hinge, MOTION.foldA, MOTION.foldB]);

function verts(k: Kit) {
  const out: { p: V3; tag: Tag; col: string }[] = [];
  for (let i = 0; i < k.pos.length / 3; i++) {
    out.push({
      p: [k.pos[i * 3], k.pos[i * 3 + 1], k.pos[i * 3 + 2]],
      tag: [k.mot[i * 4], k.mot[i * 4 + 1], k.mot[i * 4 + 2], k.mot[i * 4 + 3]] as const,
      col: `${k.col[i * 3].toFixed(4)},${k.col[i * 3 + 1].toFixed(4)},${k.col[i * 3 + 2].toFixed(4)}|${k.key[i * 4]}|${k.key[i * 4 + 1]}`,
    });
  }
  return out;
}
const open = (p: V3, tag: Tag, l = 1, r = 1) => moveVertex(p, tag, { doorL: l, doorR: r, odo: 0, curve: 0 });

// The front of a bus or coach seen from the side (the outline buses.ts extrudes): the x of the
// front face at height y.
function busFrontX(m: Model, y: number) {
  const b = busLayout(m), c = m.dims.clearance, H = m.dims.height;
  const pts: [number, number][] = [[b.xN - 0.05, c], [b.xN, 1.0], [b.xN - b.rake * 0.2, b.coach ? 1.5 : 1.05], [b.xN - b.rake, H - 0.25], [b.xN - b.rake - 0.25, H]];
  if (y <= pts[0][1]) return pts[0][0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (y >= y0 && y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0 || 1);
  }
  return pts[pts.length - 1][0];
}
const buses = MODELS.filter((m) => m.category === 'bus' && m.style !== 'bus-bendy-rear' && m.style !== 'bus-halfcab' && m.style !== 'bus-heritage');

describe('review: bus and coach doors', () => {
  test('open plug-door leaves stay alongside the body: never out past the windscreen or off the front of the bus', () => {
    // (widened after the fix: every kind of moving leaf, since bus doors are now gliders)
    const bad: string[] = [];
    for (const m of buses) {
      if (!doorsOf(m).some((d) => d.kind !== 'open')) continue;
      const b = busLayout(m);
      let worst = -Infinity, off = -Infinity;
      for (const v of verts(buildKit(m, 0))) {
        if (!DOOR_KINDS.has(v.tag[0])) continue;
        const q = open(v.p, v.tag);
        worst = Math.max(worst, q[0] - busFrontX(m, q[1]));
        off = Math.max(off, q[0] - b.xN);
      }
      if (worst > 0) bad.push(`${m.style} ${m.design.year}: leaf ${worst.toFixed(2)} m past the front outline${off > 0 ? `, ${off.toFixed(2)} m clear off the front of the vehicle` : ''}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test('shut doors and their frames sit inside the side outline (a raked coach front must not cut through the door frame)', () => {
    const bad: string[] = [];
    for (const m of buses) {
      const k = new Kit(0);
      drawDoors(k, m, m.dims.width / 2);
      let worst = -Infinity;
      for (const v of verts(k)) worst = Math.max(worst, v.p[0] - busFrontX(m, v.p[1]));
      if (worst > 0.005) bad.push(`${m.style} ${m.design.year}: door geometry ${worst.toFixed(2)} m beyond the front outline`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test('open folding (jack-knife) doors are still seen: they fold into a solid body and vanish', () => {
    // the panels fold inward, but the body side is solid across the doorway (only a dark decal marks
    // the opening), so everything behind the body side is hidden. Sample each panel and ask how much
    // of it is still in front of the body side at full open.
    const bad: string[] = [];
    for (const m of MODELS.filter((x) => doorsOf(x).some((d) => d.kind === 'fold'))) {
      const k = buildKit(m, 0), vs = verts(k), hw = m.dims.width / 2;
      let seen = 0, all = 0;
      for (let t = 0; t < vs.length; t += 3) {
        if (vs[t].tag[0] !== MOTION.foldA && vs[t].tag[0] !== MOTION.foldB) continue;
        const q = [0, 1, 2].map((j) => open(vs[t + j].p, vs[t + j].tag));
        for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4 - a; b++) {
          const w = [a / 4, b / 4, 1 - a / 4 - b / 4];
          const z = w[0] * q[0][2] + w[1] * q[1][2] + w[2] * q[2][2];
          all++; if (Math.abs(z) > hw + 0.001) seen++;
        }
      }
      if (seen / all < 0.5) bad.push(`${m.style} ${m.design.year}: ${(100 * seen / all).toFixed(0)}% of the folded panels in front of the body side`);
    }
    expect(bad.slice(0, 8), bad.join('\n')).toEqual([]);
  });
});

describe('review: rail doors', () => {
  test('open door leaves never slide over the cab side window', () => {
    const bad: string[] = [];
    for (const m of MODELS.filter((x) => x.category === 'rail' && doorsOf(x).length && railLayout(x).cab)) {
      const r = railLayout(m), hw = m.dims.width / 2;
      const vs = verts(buildKit(m, 0));
      // the cab side windows: glass 12 mm off the side, ahead of the straight side (bx1)
      const glass = vs.filter((v) => v.tag[0] === 0 && Math.abs(Math.abs(v.p[2]) - (hw + 0.012)) < 1e-4 && v.p[0] > r.bx1 - 0.05);
      if (!glass.length) continue;
      const g0 = Math.min(...glass.map((v) => v.p[0])), gy0 = Math.min(...glass.map((v) => v.p[1])), gy1 = Math.max(...glass.map((v) => v.p[1]));
      let reach = -Infinity;
      for (const v of vs) if (DOOR_KINDS.has(v.tag[0])) { const q = open(v.p, v.tag); if (q[1] > gy0 && q[1] < gy1 + 0.5) reach = Math.max(reach, q[0]); }
      if (reach > g0) bad.push(`${m.style} ${m.design.year} cab: open leaf reaches x=${reach.toFixed(2)}, over the cab window from x=${g0.toFixed(2)}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test('hauled coaches of the 1970s–80s keep hinged slam doors, like the high-speed coaches of the same years', () => {
    // doors.ts gives high-speed coaches before 1990 slam doors ("the plug doors came with the next
    // generation"); the hauled coaches built alongside them were the same design of body and doors.
    const bad: string[] = [];
    for (const m of MODELS.filter((x) => x.style === 'coach-stock' && (x.design.year as number) >= 1975 && (x.design.year as number) < 1990)) {
      const kinds = [...new Set(doorsOf(m).map((d) => d.kind))];
      if (kinds.join() !== 'slam') bad.push(`coach-stock ${m.design.year}: ${kinds.join()} doors`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });
});

// Coplanar faces of different colours that overlap z-fight: the user plays on a phone and sees
// every flicker. Scan every passenger model's near geometry, doors shut and fully open.
function coplanar(m: Model, o: number) {
  const k = buildKit(m, 0), vs = verts(k);
  type T = { v: V3[]; n: V3; d: number; col: string; ax: number };
  const tris: T[] = [];
  for (let t = 0; t < vs.length; t += 3) {
    const v = [0, 1, 2].map((j) => (o ? open(vs[t + j].p, vs[t + j].tag, o, o) : vs[t + j].p));
    const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const c: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...c); if (l < 1e-9) continue;
    const n: V3 = [c[0] / l, c[1] / l, c[2] / l];
    const a = n.map(Math.abs);
    const ax = a[0] > a[1] ? (a[0] > a[2] ? 0 : 2) : a[1] > a[2] ? 1 : 2;
    tris.push({ v, n, d: n[0] * v[0][0] + n[1] * v[0][1] + n[2] * v[0][2], col: vs[t].col, ax });
  }
  const P = (p: V3, ax: number): [number, number] => (ax === 0 ? [p[1], p[2]] : ax === 1 ? [p[0], p[2]] : [p[0], p[1]]);
  const area = (p: [number, number][]) => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; s += q[0] * r[1] - r[0] * q[1]; } return s / 2; };
  const ccw = (p: [number, number][]) => (area(p) < 0 ? p.slice().reverse() : p);
  const clip = (sub: [number, number][], cl: [number, number][]) => {
    let out = sub;
    for (let i = 0; i < cl.length && out.length; i++) {
      const a = cl[i], b = cl[(i + 1) % cl.length];
      const side = (p: [number, number]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const src = out; out = [];
      for (let j = 0; j < src.length; j++) {
        const p = src[j], q = src[(j + 1) % src.length], sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
    }
    return out;
  };
  const hits: string[] = [];
  for (let i = 0; i < tris.length; i++) for (let j = i + 1; j < tris.length; j++) {
    const A = tris[i], B = tris[j];
    if (A.col === B.col || Math.abs(A.d - B.d) > 0.001) continue;
    if (A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] < 0.9999) continue;
    const ov = Math.abs(area(clip(ccw(A.v.map((p) => P(p, A.ax))), ccw(B.v.map((p) => P(p, A.ax))))));
    if (ov > 1e-4) hits.push(`${ov.toFixed(3)} m² at ${A.v[0].map((x) => x.toFixed(2)).join(',')} (normal ${A.n.map((x) => x.toFixed(0)).join(',')})`);
  }
  return hits;
}

describe('review: z-fighting', () => {
  test('no overlapping coplanar faces of different colours on passenger stock, doors shut or open', () => {
    const seen = new Set<string>(), bad: string[] = [];
    for (const m of MODELS) {
      const ds = doorsOf(m); if (!ds.length) continue;
      const key = `${m.style}|${m.design.cab}|${m.design.slam}|${m.design.panelled}|${ds.map((d) => d.kind).join()}`;
      if (seen.has(key)) continue; seen.add(key);
      for (const o of [0, 1]) { const h = coplanar(m, o); if (h.length) bad.push(`${m.style} ${m.design.year} doors ${o ? 'open' : 'shut'}: ${h.length} overlaps, e.g. ${h[0]}`); }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  }, 120000);
});
