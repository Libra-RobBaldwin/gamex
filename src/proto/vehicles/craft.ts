// Boats and aircraft, for later: hulls and fuselages are lofts like the rail bodies; wings,
// tailplanes and decks are flat plates. The waterline is y = 0, so a hull sits partly below it.
import { Kit, C, paint, fixed, type P2, type Style, type V3 } from './kit';
import type { Model } from './types';
import { num, flag } from './parts';
import { rng, pick } from './util';
import { BOX_COLOURS } from './operators';

const body = paint(1), hullSt = paint(2), roofSt = paint(3), accent = paint(4);

// A flat plate: a polygon in plan (x, z) with thickness from y0 to y1 (wings, tailplanes).
function plate(k: Kit, pts: [number, number][], y0: number, y1: number, top: Style, edge: Style) {
  const up = pts.map(([x, z]) => [x, y1, z] as V3), dn = pts.map(([x, z]) => [x, y0, z] as V3);
  k.face(up, [0, 1, 0], top);
  k.face(dn, [0, -1, 0], edge);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const out: V3 = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
    k.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], out, edge);
  }
}

// ---------------- boats ----------------
function hull(k: Kit, L: number, B: number, draught: number, free: number, bowLen: number, sternSz = 0.85, sheer = 0.3) {
  // the mid level drops the bilge chines: nobody sees below the waterline from there
  const cs: P2[] = k.lod === 0 ? [[-0.6, -draught], [0.6, -draught], [1, -draught * 0.35], [1, free], [-1, free], [-1, -draught * 0.35]] : [[-0.8, -draught], [0.8, -draught], [1, free], [-1, free]];
  const deck = k.lod === 0 ? 3 : 2, bilge = (j: number) => k.lod === 0 && (j === 1 || j === 5);
  const hw = B / 2;
  const sects = [
    { x: -L / 2, sy: 1, sz: hw * sternSz, dy: 0 },
    { x: -L / 2 + L * 0.08, sy: 1, sz: hw, dy: 0 },
    { x: L / 2 - bowLen, sy: 1, sz: hw, dy: 0 },
    { x: L / 2 - bowLen * 0.4, sy: 1.05, sz: hw * 0.7, dy: sheer * 0.4 },
    { x: L / 2, sy: 1.1, sz: hw * 0.06, dy: sheer },
  ];
  k.loftX(cs, sects, (j) => (j === 0 ? null : j === deck ? C.deck : bilge(j) ? C.antifoul : hullSt), hullSt, null);
}
function wheelhouse(k: Kit, x0: number, x1: number, y0: number, y1: number, hw: number) {
  k.box(x0, x1, y0, y1, -hw, hw, body, { py: roofSt });
  k.end(x1, 1, -hw + 0.2, hw - 0.2, y1 - (y1 - y0) * 0.45, y1 - 0.15, C.glass);
  k.sideRect(x0 + 0.2, x1 - 0.2, y1 - (y1 - y0) * 0.45, y1 - 0.15, hw, C.glass);
}

export function buildBoat(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, B = d.width, H = d.height, hw = B / 2;
  const r = rng(m.seed);
  switch (style) {
    case 'narrowboat': {
      const free = 0.55;
      hull(k, L, B, 0.6, free, 2.8, 0.75, 0.25);
      const working = num(m.design, 'year', 2000) < 1970;
      if (working) {
        // a short cabin at the stern and a long clothed-up hold
        wheelhouse(k, -L / 2 + 0.6, -L / 2 + 3.4, free, 1.75, hw - 0.1);
        k.box(-L / 2 + 3.5, L / 2 - 3.0, free, 1.3, -hw + 0.15, hw - 0.15, C.canvas);
        if (lod === 0) k.sideRect(-L / 2 + 0.8, -L / 2 + 3.2, free + 0.2, 1.1, hw - 0.1, hullSt, 0, 0.012);
      } else {
        k.box(-L / 2 + 1.2, L / 2 - 3.2, free, 1.72, -hw + 0.1, hw - 0.1, body, { py: roofSt });
        const n = lod === 0 ? Math.floor((L - 5) / 1.6) : 0;
        for (let i = 0; i < n; i++) k.sideRect(-L / 2 + 2 + i * 1.6, -L / 2 + 2.5 + i * 1.6, 1.1, 1.45, hw - 0.1, C.glass);
        k.sideRect(-L / 2 + 1.25, L / 2 - 3.25, free + 0.05, free + 0.2, hw - 0.1, accent, 0, 0.012);
      }
      if (lod === 0) k.box(-L / 2 - 0.4, -L / 2 + 0.2, 0.2, 0.9, -0.04, 0.04, C.wood);
      break;
    }
    case 'barge': {
      hull(k, L, B, 1.6, 1.4, 4, 0.9, 0.4);
      k.box(-L / 2 + 6, L / 2 - 4, 1.4, 2.1, -hw + 0.4, hw - 0.4, roofSt);
      wheelhouse(k, -L / 2 + 1, -L / 2 + 4.5, 1.4, 3.6, hw * 0.5);
      break;
    }
    case 'coaster': case 'ferry': case 'container-ship': {
      const ship = style === 'container-ship', ferry = style === 'ferry';
      const free = ship ? 9 : ferry ? 6 : 3.5, dr = ship ? 11 : ferry ? 5 : 4;
      hull(k, L, B, dr, free, L * 0.2, 0.92, ship ? 3 : 1.5);
      // superstructure: aft on coasters and container ships, most of the length on ferries
      const sx0 = ferry ? -L / 2 + L * 0.12 : -L / 2 + L * 0.04, sx1 = ferry ? L / 2 - L * 0.22 : -L / 2 + L * (ship ? 0.14 : 0.24);
      const decks = ferry ? 4 : ship ? 6 : 3;
      const dh = 2.7;
      for (let i = 0; i < decks; i++) {
        const inset = ferry ? i * 1.2 : i * 0.3;
        const x0 = sx0 + inset * (ferry ? 2 : 1), x1 = sx1 - inset * (ferry ? 3 : 1);
        const w = hw - (ferry ? 0.5 + i * 0.4 : 1.5 + i * 0.3);
        k.box(x0, x1, free + i * dh, free + (i + 1) * dh, -w, w, body, { py: i === decks - 1 ? roofSt : body });
        if (lod === 0 || i === decks - 1) k.sideRect(x0 + 1, x1 - 1, free + i * dh + 1.0, free + i * dh + 2.0, w, C.glass, 0, 0.05);
      }
      const top = free + decks * dh;
      // funnel(s)
      const funnels = ferry ? 2 : 1;
      for (let f = 0; f < funnels; f++) {
        const fx = ferry ? sx0 + (sx1 - sx0) * (0.35 + f * 0.25) : sx0 + (sx1 - sx0) * 0.3;
        k.cylY(fx, ferry ? (f ? 3 : -3) : 0, top, top + (ship ? 6 : 5), 2.2, 1.9, 6, accent, fixed('#1a1a1a'));
      }
      k.end(sx1, 1, -hw + 2, hw - 2, top - dh + 0.6, top - 0.5, C.glass, 0.05);
      if (ship) {
        // container stacks bay by bay, a different line's box in every row
        const bayLen = lod === 0 ? 13 : 26;
        const bays = Math.floor((L / 2 - L * 0.18 - sx1) / bayLen);
        const rows = lod === 0 ? 3 : 1;
        for (let b = 0; b < bays; b++) {
          const x0 = sx1 + 2 + b * bayLen, x1 = x0 + bayLen - 0.6;
          const tiers = 3 + Math.floor(r() * 4);
          for (let row = 0; row < rows; row++) {
            const z0 = -hw + 1 + ((B - 2) * row) / rows, z1 = -hw + 1 + ((B - 2) * (row + 1)) / rows - 0.3;
            const col = fixed(pick(r, BOX_COLOURS));
            k.box(x0, x1, free, free + tiers * 2.6, z0, z1, col);
          }
          if (lod === 0) k.sideRect(x0 + 0.2, x1 - 0.2, free + 2.5, free + 2.7, hw - 1, C.trim, 0, 0.3);
        }
      } else if (ferry) {
        // lifeboats and the bow visor
        if (lod === 0) for (let i = 0; i < 6; i++) for (const s of [1, -1]) k.box(sx0 + 8 + i * 9, sx0 + 14 + i * 9, free + dh + 0.3, free + dh + 1.8, s * (hw - 0.3) - 1, s * (hw - 0.3) + 0.2, fixed('#e0661f'));
        k.sideRect(-L / 2 + 5, L / 2 - L * 0.1, free - 1.2, free - 0.4, hw, accent, 0, 0.05);
      } else {
        // coaster: hatch covers and a mast
        k.box(sx1 + 3, L / 2 - L * 0.16, free, free + 1.2, -hw + 1.5, hw - 1.5, roofSt);
        if (lod === 0) k.cylY(L / 2 - L * 0.14, 0, free, free + 12, 0.25, 0.15, 6, fixed('#e0b42a'), null);
      }
      break;
    }
  }
  void H;
}

// ---------------- aircraft ----------------
export function buildAir(k: Kit, m: Model) {
  const d = m.dims, g = m.design, lod = k.lod, style = m.style;
  const L = d.length, span = num(g, 'span', d.width), dia = num(g, 'dia', 3.5), H = d.height;
  const R = dia / 2, gearH = style === 'light-aircraft' ? 0.9 : style === 'turboprop' ? 1.4 : style === 'airliner' ? 2.0 : 3.0;
  const cy = gearH + R;
  // fuselage: an octagon swept along x with a rounded nose and a raised tail cone
  const n = lod === 0 ? 8 : 6;
  const cs: P2[] = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n; return [Math.cos(a), Math.sin(a)] as P2; });
  const S = (x: number, s: number, dy: number) => ({ x, sy: R * s, sz: R * s, dy: cy + dy });
  const tailLen = L * 0.22;
  const sects = [
    S(-L / 2, 0.18, R * 0.7), S(-L / 2 + tailLen * 0.5, 0.6, R * 0.35), S(-L / 2 + tailLen, 1, 0),
    S(L / 2 - L * 0.12, 1, 0), S(L / 2 - L * 0.04, 0.78, -R * 0.08), S(L / 2, 0.25, -R * 0.2),
  ];
  const fus = k.loftX(cs, sects, (j) => (j === 0 || j === n - 1 ? hullSt : body), hullSt, fixed('#2a2c2f'));
  // passenger windows along both sides, and the cockpit glazing
  const side = n === 8 ? [1, 5] : [1, 4];
  if (style !== 'light-aircraft') for (const j of side) fus.patch(3 - 1, 0.04, 0.96, j, 0.62, 0.72, C.glassDark, 0.03);
  for (const j of n === 8 ? [2, 3, 4] : [2, 3]) fus.patch(4, 0.2, 0.9, j, 0, 1, C.glass, 0.03);
  // wings: straight on props, swept on jets
  const jet = style === 'airliner' || style === 'widebody';
  const wx = jet ? L * 0.05 : L * 0.08, chord = jet ? L * 0.16 : L * 0.12, sweep = jet ? span * 0.22 : 0;
  const wy = flag(g, 'highWing') ? cy + R * 0.85 : cy - R * 0.55;
  for (const s of [1, -1]) {
    const root = s * R * 0.6, tip = s * span / 2;
    plate(k, [[wx + chord / 2, root], [wx - chord / 2, root], [wx - chord * 0.2 - sweep, tip], [wx + chord * 0.15 - sweep, tip]], wy - 0.15, wy + 0.1, body, fixed('#b9bdc0'));
    // tailplane
    const tx = -L / 2 + tailLen * 0.35, tc = tailLen * 0.4, ts = span * 0.18;
    const ty = style === 'turboprop' ? cy + R * 0.6 + L * 0.16 - 0.1 : cy + R * 0.3;
    plate(k, [[tx + tc / 2, 0], [tx - tc / 2, 0], [tx - tc / 2 - ts * 0.3, s * ts], [tx - tc / 4 - ts * 0.3, s * ts]], ty - 0.08, ty + 0.05, body, fixed('#b9bdc0'));
  }
  // fin
  const fh = style === 'light-aircraft' ? 1.3 : style === 'turboprop' ? L * 0.16 : style === 'widebody' ? L * 0.14 : L * 0.19;
  k.prism([[-L / 2 + tailLen * 0.95, cy + R * 0.6], [-L / 2 + 0.2, cy + R * 0.7], [-L / 2 - 0.1, cy + R * 0.6 + fh], [-L / 2 + tailLen * 0.35, cy + R * 0.6 + fh]], 0.12 + R * 0.04, hullSt, () => hullSt);
  // engines
  const engines = num(g, 'engines', 2);
  if (style === 'light-aircraft') {
    k.disc([L / 2 + 0.05, cy - R * 0.1, 0], 'x', 1, 0.95, 6, fixed('#3a3d41'));
  } else {
    const er = jet ? (style === 'widebody' ? 1.5 : 1.05) : 0.55;
    const spots = engines === 4 ? [0.17, 0.3] : [jet ? 0.17 : 0.2];
    for (const f of spots) for (const s of [1, -1]) {
      const z = s * span * f;
      const ex = wx + chord * 0.6 - sweep * f * 2;
      const ey = jet ? wy - er * 0.9 : wy;
      k.cylX(ex - er * 3, ex + er * 0.2, ey, z, er, er, lod === 0 ? 8 : 6, accent, fixed('#2a2c2f'), fixed('#3a3d41'));
      if (!jet) k.disc([ex + er * 0.3, ey, z], 'x', 1, 1.8, 6, fixed('#3a3d41'));
    }
  }
  // undercarriage
  if (lod === 0) {
    k.box(L / 2 - L * 0.1 - 0.1, L / 2 - L * 0.1 + 0.1, 0, gearH, -0.1, 0.1, C.trim);
    for (const s of [1, -1]) k.box(wx - chord * 0.3 - 0.3, wx - chord * 0.3 + 0.3, 0, gearH + 0.2, s * R * 0.9 - 0.25, s * R * 0.9 + 0.25, C.tyre);
  }
  void H; void roofSt;
}
