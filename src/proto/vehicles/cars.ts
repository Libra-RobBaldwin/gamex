// Cars: one parametric body for every style from the 1935 saloon to the 2030 electric SUV, and a
// separate builder for veteran and vintage cars with separate wings and running boards.
// The body is a side profile extruded across the width, with the wheel arches cut into it,
// a greenhouse that leans in towards the roof, and lamps, grilles and bumpers as decals and
// small boxes. Proportions come from the design record (see models.ts), so thousands of
// cars share this one builder.
import { Kit, C, paint, fixed, clip, type P2, type Style } from './kit';
import type { Model } from './types';
import { num, str, flag, wheels, axleBlock, mirrors, lightBar, beacon, type Hub } from './parts';
import type { Grille } from './brands';
import type { LampShape, BumperKind } from './era';

const clampT = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function buildCar(k: Kit, m: Model) {
  if (m.style === 'classic') return classic(k, m);
  const g = m.design, d = m.dims, lod = k.lod;
  const L = d.length, W = d.width, H = d.height, c = d.clearance, r = d.wheelR, hw = W / 2;
  const X = (f: number) => L / 2 - f * L;
  const ws = num(g, 'ws', 0.3), roofF = num(g, 'roofF', 0.45), roofR = num(g, 'roofR', 0.8), cB = num(g, 'cBase', 0.9);
  const noseH = num(g, 'noseH', 0.6), bonF = num(g, 'bonnetFH', 0.72), bonH = num(g, 'bonnetH', 0.86), belt = num(g, 'beltH', 0.92);
  const tailH = num(g, 'tailH', belt), tailLow = num(g, 'tailLow', 0.55);
  const nr = num(g, 'noseR', 0.1), tr = num(g, 'tailR', 0.08), tumble = num(g, 'tumble', 0.1);
  const body = paint(1), roofSt = paint(3);
  const base = str(g, 'base', m.style) as string, style = m.style === 'police' ? base : m.style;
  const lamps = str<LampShape>(g, 'lamps', 'rect'), bumper = str<BumperKind>(g, 'bumper', 'body'), grille = str<Grille>(g, 'grille', 'bar');
  const hub = str<Hub>(g, 'wheel', 'hubcap');
  const open = (style === 'convertible' || base === 'convertible') && str(g, 'top', 'down') === 'down';

  // ---- lower body: side profile, counter-clockwise, arches cut in when close up ----
  const P: P2[] = [], E: (Style | null)[] = [];
  const push = (p: P2, e: Style | null) => { P.push(p); E.push(e); return P.length - 1; };
  const notch = (x: number) => {
    push([x - 1.12 * r, c], C.arch); push([x - 1.0 * r, r * 1.35], C.arch); push([x - 0.55 * r, r * 1.95], C.arch);
    push([x + 0.55 * r, r * 1.95], C.arch); push([x + 1.0 * r, r * 1.35], C.arch); push([x + 1.12 * r, c], null);
  };
  const [xf, xr] = [d.axles[0], d.axles[d.axles.length - 1]];
  push([-L / 2 + tr * 0.6, c], null);
  if (lod === 0) { notch(xr); notch(xf); }
  const iLow = push([L / 2 - 0.06, c], body);
  const iNose = push([L / 2, noseH], body);
  push([L / 2 - nr - 0.04, bonF], body);
  push([X(ws), bonH], body);
  push([X(cB), belt], body);
  const iTail = push([-L / 2 + tr, tailH], body);
  push([-L / 2, tailLow], body);
  k.prism(P, hw, body, (i) => E[i]);

  // ---- greenhouse ----
  const hg = (y: number) => hw - 0.05 - tumble * clampT((y - belt) / Math.max(0.1, H - belt), 0, 1);
  const pane = style === 'taxi' ? C.glass : C.glassPlain;
  const G: P2[] = [[X(cB), belt], [X(ws), bonH], [X(roofF), H], [X(roofR), H]];
  const blackPillars = flag(g, 'blackPillars');
  const pillar = blackPillars ? C.trim : body;
  if (!open) {
    const soft = style === 'convertible' || base === 'convertible';
    const top = soft ? C.hood : roofSt;
    k.prism(G, hg, pane, (i) => [null, pane, top, pane][i]);
    if (lod === 0) {
      // pillars and the roof edge, as strips on the glass
      const pw = style === 'estate' || style === 'suv' || style === 'mpv' || style === 'taxi' ? 0.1 : style === 'hatchback' ? 0.26 : 0.2;
      k.side([[X(ws), bonH], [X(roofF), H], [X(roofF) - 0.09, H], [X(ws) - 0.13, bonH]], hg, 0, pillar, 0.01);
      k.side([[X(roofR), H], [X(cB), belt], [X(cB) + pw * 1.25, belt], [X(roofR) + pw, H]], hg, 0, soft ? C.hood : pillar, 0.01);
      k.side([[X(roofF), H - 0.07], [X(roofR), H - 0.07], [X(roofR), H], [X(roofF), H]], hg, 0, soft ? C.hood : roofSt, 0.012);
      const doors = num(g, 'doors', 4);
      const bx = X(ws + (cB - ws) * (doors >= 4 ? 0.47 : 0.62));
      if (bx < X(roofF) - 0.1 && bx > X(roofR) + 0.1) k.side([[bx - 0.05, belt], [bx + 0.05, belt], [bx + 0.05, H], [bx - 0.05, H]], hg, 0, blackPillars ? C.trim : pillar, 0.011);
      if ((style === 'estate' || style === 'suv' || style === 'mpv' || base === 'estate') && doors >= 4) {
        const dx = X(ws + (cB - ws) * 0.76);
        if (dx > X(roofR) + 0.1) k.side([[dx - 0.05, belt], [dx + 0.05, belt], [dx + 0.05, H], [dx - 0.05, H]], hg, 0, pillar, 0.011);
      }
    }
  } else {
    // roof down: a screen, the cockpit, two seats and the folded hood
    const xt = X(ws) - (X(ws) - X(roofF)) * 0.55, yt = bonH + (H - bonH) * 0.75;
    k.prism([[X(ws), bonH], [X(ws) - 0.05, bonH], [xt - 0.05, yt], [xt, yt]], hw - 0.1, C.chrome, () => C.glassPlain);
    k.top(X(cB) + 0.05, X(ws) - 0.05, -hw + 0.1, hw - 0.1, Math.min(belt, bonH), C.interior);
    const sx = X(ws) - (X(ws) - X(cB)) * 0.55;
    if (lod === 0) for (const s of [1, -1]) k.box(sx - 0.12, sx, belt, belt + 0.38, s > 0 ? 0.08 : -hw + 0.18, s > 0 ? hw - 0.18 : -0.08, C.seat);
    k.box(X(cB) - 0.05, X(cB) + 0.3, belt, belt + 0.14, -hw + 0.12, hw - 0.12, C.hood);
  }

  // ---- wheels ----
  const tw = num(g, 'tyreW', 0.2);
  for (const x of d.axles) {
    if (lod === 0) wheels(k, x, r, hw - 0.025, tw, hub);
    else if (lod === 1) axleBlock(k, x, r, hw - 0.02, 2);
  }
  if (lod === 1) {
    // two lamps each end, so traffic still twinkles at night from the middle distance
    for (const s of [1, -1]) {
      k.edgeDecal(P, hw, iNose, 0.3, 0.8, s * 0.6, s * 0.9, C.head);
      k.edgeDecal(P, hw, iTail, 0.1, 0.5, s * 0.55, s * 0.92, C.tail);
    }
    extras(k, m, X, hw, H, belt, bonH, ws, cB);
    return;
  }

  // ---- livery bands on the sides ----
  const archTop = r * 1.95 + 0.03;
  const pattern = str(g, 'pattern', 'none');
  if (flag(g, 'cladding')) k.side(clip(P, -L, L, c, c + 0.2), hw, 0, C.trim, 0.008);
  if (pattern === 'flash') k.side(clip(P, -L, L, archTop, belt - 0.05), hw, 0, paint(2), 0.01);
  else if (pattern === 'stripe') k.side(clip(P, -L, L, belt - 0.24, belt - 0.12), hw, 0, paint(2), 0.01);
  else if (pattern === 'battenberg') {
    // one row of alternating blocks from nose to tail, as UK emergency services use
    const y0 = Math.max(c + 0.12, archTop - 0.2), y1 = belt - 0.04;
    const n = Math.max(4, Math.round(L / 0.55));
    for (let i = 0; i < n; i++) {
      const x0 = -L / 2 + (i / n) * L, x1 = -L / 2 + ((i + 1) / n) * L;
      const piece = clip(P, x0, x1, y0, y1);
      if (piece.length >= 3) k.side(piece, hw, 0, paint(i % 2 ? 4 : 2), 0.01);
    }
  } else if (pattern === 'wrap') k.side(clip(P, X(ws + 0.02), X(cB - 0.02), archTop, belt - 0.06), hw, 0, paint(2), 0.01);

  // ---- front: lamps, indicators, grille, bumper, plate ----
  const disc = (t: number, f: number, rr: number, st: Style) => k.edgeDisc(P, hw, iNose, t, f, rr, rr, 8, st);
  for (const s of [1, -1]) {
    switch (lamps) {
      case 'round': disc(0.55, s * 0.72, 0.1, C.head); break;
      case 'twin-round': disc(0.55, s * 0.84, 0.07, C.head); disc(0.55, s * 0.63, 0.07, C.head); break;
      case 'rect': k.edgeDecal(P, hw, iNose, 0.3, 0.85, s * 0.58, s * 0.9, C.head); break;
      case 'wrap':
        k.edgeDecal(P, hw, iNose, 0.35, 0.92, s * 0.6, s * 0.99, C.head);
        k.side([[L / 2 - 0.02, noseH + 0.02], [L / 2 - nr - 0.03, bonF - 0.02], [L / 2 - nr - 0.22, bonF - 0.03], [L / 2 - 0.2, noseH + 0.03]], hw, s as 1 | -1, C.head, 0.01);
        break;
      case 'slim': k.edgeDecal(P, hw, iNose, 0.62, 0.93, s * 0.55, s * 0.97, C.head); break;
      case 'strip': k.edgeDecal(P, hw, iNose, 0.68, 0.9, s * 0.6, s * 0.98, C.head); break;
      case 'popup': k.edgeDecal(P, hw, iNose, 0.08, 0.3, s * 0.62, s * 0.92, C.head); break;
    }
    k.edgeDecal(P, hw, iNose, 0.3, 0.6, s * 0.92, s * 1.0, s < 0 ? C.indL : C.indR, 0.016);
  }
  if (lamps === 'strip') k.edgeDecal(P, hw, iNose, 0.8, 0.88, -0.6, 0.6, C.head, 0.015);
  frontGrille(k, P, hw, iNose, iLow, grille, m.from);
  if (bumper === 'chrome' || bumper === 'rubber') {
    const st = bumper === 'chrome' ? C.chrome : C.rubber;
    k.box(L / 2 - 0.1, L / 2 + 0.06, c + 0.1, c + 0.28, -hw + 0.02, hw - 0.02, st);
    k.box(-L / 2 - 0.06, -L / 2 + 0.1, c + 0.1, c + 0.28, -hw + 0.02, hw - 0.02, st);
    k.end(L / 2 + 0.06, 1, -0.26, 0.26, c + 0.14, c + 0.26, C.plateF, 0.006);
    k.end(-L / 2 - 0.06, -1, -0.26, 0.26, c + 0.14, c + 0.26, C.plateR, 0.006);
  } else {
    k.edgeDecal(P, hw, iLow, 0.3, 0.75, -0.3, 0.3, C.plateF, 0.016);
  }

  // ---- rear: tail lamps, indicators, plate, high brake lamp ----
  for (const s of [1, -1]) {
    const x0 = lamps === 'strip' ? 0.2 : 0.1;
    k.edgeDecal(P, hw, iTail, x0, 0.5, s * 0.58, s * 0.96, C.tail);
    k.edgeDecal(P, hw, iTail, x0, 0.5, s * 0.44, s * 0.56, s < 0 ? C.indL : C.indR, 0.016);
  }
  if (lamps === 'strip') k.edgeDecal(P, hw, iTail, 0.05, 0.14, -0.58, 0.58, C.tail, 0.016);
  if (bumper === 'body') k.edgeDecal(P, hw, iTail, 0.55, 0.9, -0.28, 0.28, C.plateR, 0.016);
  if (m.from >= 1986 && !open) k.edgeDecal(G, hg, 3, 0.03, 0.1, -0.2, 0.2, C.brake, 0.014);

  mirrors(k, X(ws) - 0.02, belt + 0.02, hw, flag(g, 'trimMirrors') ? C.trim : body);
  extras(k, m, X, hw, H, belt, bonH, ws, cB);
}

// Grilles and intakes on the nose, in the brand's language.
function frontGrille(k: Kit, P: P2[], hw: number, iNose: number, iLow: number, grille: Grille, year: number) {
  const dark = C.grille;
  if (year < 1950 && grille !== 'oval' && grille !== 'crate') grille = 'tall';
  switch (grille) {
    case 'oval': k.edgeDisc(P, hw, iNose, 0.45, 0, 0.3, 0.12, 8, dark); break;
    case 'bar':
      k.edgeDecal(P, hw, iNose, 0.35, 0.75, -0.5, 0.5, dark);
      k.edgeDecal(P, hw, iNose, 0.5, 0.58, -0.5, 0.5, C.chrome, 0.016);
      break;
    case 'tall':
      k.edgeDecal(P, hw, iNose, 0.05, 0.98, -0.24, 0.24, C.chrome);
      k.edgeDecal(P, hw, iNose, 0.12, 0.92, -0.18, 0.18, dark, 0.016);
      break;
    case 'bars3':
      k.edgeDecal(P, hw, iNose, 0.3, 0.85, -0.45, 0.45, dark);
      for (const t of [0.42, 0.57, 0.72]) k.edgeDecal(P, hw, iNose, t, t + 0.05, -0.45, 0.45, C.chrome, 0.016);
      break;
    case 'slot':
      k.edgeDecal(P, hw, iNose, 0.62, 0.82, -0.5, 0.5, dark);
      k.edgeDecal(P, hw, iLow, 0.35, 0.8, -0.55, 0.55, dark);
      break;
    case 'mouth': k.edgeDisc(P, hw, iLow, 0.6, 0, 0.62, 0.1, 8, dark); break;
    case 'crate':
      k.edgeDecal(P, hw, iNose, 0.2, 0.9, -0.56, 0.56, C.chrome);
      k.edgeDecal(P, hw, iNose, 0.28, 0.82, -0.5, 0.5, dark, 0.016);
      k.edgeDecal(P, hw, iNose, 0.28, 0.82, -0.03, 0.03, C.chrome, 0.02);
      break;
    case 'mesh': k.edgeDecal(P, hw, iNose, 0.25, 0.85, -0.55, 0.55, dark); break;
    case 'wide': k.edgeDecal(P, hw, iNose, 0.3, 0.9, -0.58, 0.58, dark); break;
    case 'closed': k.edgeDecal(P, hw, iLow, 0.45, 0.75, -0.45, 0.45, dark); break;
  }
}

// Roof racks, rails, spoilers, scoops, light bars and cab signs.
function extras(k: Kit, m: Model, X: (f: number) => number, hw: number, H: number, belt: number, bonH: number, ws: number, cB: number) {
  const g = m.design, lod = k.lod;
  const rf = X(num(g, 'roofF', 0.45)), rr = X(num(g, 'roofR', 0.8));
  const mid = (rf + rr) / 2, len = rf - rr;
  const tumble = num(g, 'tumble', 0.1), top = hw - 0.05 - tumble;
  if (flag(g, 'rails') && lod === 0) for (const s of [1, -1]) k.box(rr + 0.05, rf - 0.05, H, H + 0.06, s > 0 ? top - 0.1 : -top + 0.04, s > 0 ? top - 0.04 : -top + 0.1, C.trim);
  if (flag(g, 'rack')) {
    k.box(mid - len * 0.35, mid + len * 0.35, H, H + 0.05, -top + 0.05, top - 0.05, C.trim, { py: null });
    k.box(mid - len * 0.28, mid + len * 0.25, H + 0.05, H + 0.3, -top + 0.12, top - 0.12, fixed(str(g, 'load', '#6b5a48')));
  }
  if (flag(g, 'lightbar')) lightBar(k, mid + len * 0.1, H, 0.3, (top - 0.05) * 2, true);
  if (flag(g, 'sign')) k.box(rf - 0.35, rf - 0.1, H, H + 0.17, -0.3, 0.3, C.sign);
  if (flag(g, 'amber')) beacon(k, mid, H, 0, false);
  if (lod !== 0) return;
  if (flag(g, 'spoiler')) {
    const x = -m.dims.length / 2 + 0.05, y = num(g, 'tailH', belt);
    if (m.style === 'hatchback') k.box(rr - 0.18, rr + 0.02, H - 0.04, H + 0.02, -top + 0.05, top - 0.05, paint(1));
    else { k.box(x, x + 0.25, y + 0.2, y + 0.26, -hw + 0.1, hw - 0.1, paint(1)); for (const s of [1, -1]) k.box(x + 0.08, x + 0.16, y, y + 0.2, s * (hw - 0.3) - 0.03, s * (hw - 0.3) + 0.03, C.trim); }
  }
  if (flag(g, 'scoop')) { const x = X(ws) + (X(0) - X(ws)) * 0.45; k.box(x - 0.35, x + 0.25, bonH - 0.02, bonH + 0.1, -0.25, 0.25, C.trim, { px: C.grille }); }
  if (flag(g, 'sunroof')) k.top(mid - len * 0.15, mid + len * 0.25, -top + 0.25, top - 0.25, H, C.glassDark);
  if (m.style === 'pickup') {
    // an open load bed behind the cab, with a load sometimes
    const x0 = -m.dims.length / 2 + 0.12, x1 = X(cB) - 0.08;
    k.top(x0, x1, -hw + 0.07, hw - 0.07, belt, C.trim);
    if (flag(g, 'bedLoad')) k.box(x0 + 0.2, x0 + (x1 - x0) * 0.6, belt, belt + 0.35, -hw + 0.2, hw - 0.3, fixed('#8a6a45'));
  }
}

// ---------------- veteran and vintage ----------------
// Separate wings over big spoked wheels, running boards, a tall radiator, headlamp drums, and
// either a closed saloon or an open tourer with its hood folded.
function classic(k: Kit, m: Model) {
  const g = m.design, d = m.dims, lod = k.lod;
  const L = d.length, W = d.width, H = d.height, c = d.clearance, r = d.wheelR;
  const hwB = W * 0.36, hwW = W / 2;
  const [xf, xr] = [d.axles[0], d.axles[d.axles.length - 1]];
  const body = paint(1), wing = paint(2), roofSt = paint(3);
  const bonH = num(g, 'bonnetH', 1.05), belt = num(g, 'beltH', 1.1);
  const xR = L / 2 - 0.3, xS = xf - num(g, 'bonnetLen', 1.2);
  const open = str(g, 'top', 'closed') !== 'closed';
  const y0 = r * 0.95;
  k.box(-L / 2 + 0.25, xR, c + 0.1, y0, -hwB * 0.9, hwB * 0.9, C.chassis, { px: null });
  // radiator and bonnet
  k.box(xR - 0.1, xR, y0, bonH + 0.06, -0.27, 0.27, C.chrome);
  k.end(xR, 1, -0.2, 0.2, y0 + 0.06, bonH, C.grille, 0.012);
  k.box(xS, xR - 0.1, y0, bonH, -0.3, 0.3, body, { px: null });
  // tub and cabin
  const xB = -L / 2 + 0.3;
  k.box(xB, xS, y0, belt, -hwB, hwB, body);
  if (!open) {
    const G: P2[] = [[xB + 0.15, belt], [xS - 0.05, belt], [xS - 0.12, H], [xB + 0.25, H]];
    k.prism(G, hwB - 0.04, C.glassPlain, (i) => [null, C.glassPlain, roofSt, body][i]);
    if (lod === 0) {
      const bx = (xS + xB) / 2;
      k.sideRect(bx - 0.06, bx + 0.06, belt, H, hwB - 0.04, body, 0, 0.01);
      k.sideRect(xB + 0.15, xB + 0.5, belt, H, hwB - 0.04, body, 0, 0.012);
      k.sideRect(xB + 0.2, xS - 0.1, H - 0.08, H, hwB - 0.04, roofSt, 0, 0.012);
    }
  } else {
    k.prism([[xS, belt], [xS - 0.04, belt], [xS - 0.12, belt + 0.42], [xS - 0.08, belt + 0.42]], hwB - 0.06, C.chrome, () => C.glassPlain);
    k.top(xB + 0.1, xS - 0.06, -hwB + 0.06, hwB - 0.06, belt, C.interior);
    k.box(xB + 0.05, xB + 0.4, belt, belt + 0.18, -hwB + 0.02, hwB - 0.02, C.hood);
  }
  // wings and running boards
  const zc = (hwB + hwW) / 2, wh = (hwW - hwB) / 2 + 0.01;
  const wingAt = (x: number, front: boolean) => {
    const R1 = r + 0.12, R0 = r + 0.05;
    const angs = lod === 0 ? (front ? [165, 95, 20] : [160, 90, 15]) : [160, 20];
    const outer = angs.map((a) => [x + Math.cos((a * Math.PI) / 180) * R1, r + Math.sin((a * Math.PI) / 180) * R1] as P2);
    const inner = angs.slice().reverse().map((a) => [x + Math.cos((a * Math.PI) / 180) * R0, r + Math.sin((a * Math.PI) / 180) * R0] as P2);
    const poly = [...inner, ...outer];
    for (const s of [1, -1]) k.prism(poly, wh, wing, () => wing, s * zc);
  };
  if (lod === 0) { wingAt(xf, true); wingAt(xr, false); }
  else for (const x of [xf, xr]) for (const s of [1, -1]) k.box(x - r - 0.1, x + r + 0.1, r * 1.6, r * 2.2, s > 0 ? hwB : -hwW, s > 0 ? hwW : -hwB, wing, { nx: null });
  const bx0 = xr + (r + 0.1) * Math.cos((15 * Math.PI) / 180), bx1 = xf - (r + 0.1);
  for (const s of [1, -1]) k.box(bx0, bx1, r - 0.02, r + 0.05, s > 0 ? hwB : -hwW + 0.02, s > 0 ? hwW - 0.02 : -hwB, wing);
  // wheels: tall and thin
  for (const x of d.axles) {
    if (lod === 0) wheels(k, x, r, zc + 0.06, 0.12, 'spoke');
    else if (lod === 1) axleBlock(k, x, r, zc + 0.05, 1.6);
  }
  // headlamp drums, tail lamp, spare wheel, bumpers
  for (const s of [1, -1]) {
    if (lod === 0) k.cylX(xR - 0.05, xR + 0.12, bonH - 0.05, s * 0.48, 0.1, 0.1, 6, C.chrome, null, C.head);
    else k.end(xR + 0.1, 1, s * 0.48 - 0.1, s * 0.48 + 0.1, bonH - 0.15, bonH + 0.05, C.head);
  }
  k.end(-L / 2 + 0.3, -1, hwB - 0.2, hwB - 0.08, y0 + 0.1, y0 + 0.22, C.tail);
  k.end(-L / 2 + 0.3, -1, -hwB + 0.08, -hwB + 0.2, y0 + 0.1, y0 + 0.22, C.brake);
  if (lod === 0) {
    k.cylX(-L / 2 + 0.3, -L / 2 + 0.18, y0 + 0.35, 0, r * 0.9, r * 0.9, 8, C.tyre, null, fixed('#c9c2a8'));
    k.box(L / 2 - 0.05, L / 2 + 0.02, c + 0.25, c + 0.33, -hwW + 0.1, hwW - 0.1, C.chrome);
    k.end(L / 2 + 0.02, 1, -0.22, 0.22, c + 0.36, c + 0.46, C.plateF);
    k.end(-L / 2 + 0.3, -1, -0.22, 0.22, y0 + 0.02, y0 + 0.1, C.plateR, 0.02);
  }
}
