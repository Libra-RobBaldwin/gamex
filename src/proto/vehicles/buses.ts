// Buses and coaches: a side profile (flat, raked or curved front) with window bands, doors on the
// nearside, and the four livery zones laid where bus companies put them — body, a band between
// the decks (or a waistband), the roof, and a front accent. Plus the two-part bendy bus, the
// half-cab decker with its open rear platform, and the bonneted vintage saloon.
import { Kit, C, paint, fixed, type P2, type Style } from './kit';
import type { Model } from './types';
import { str, flag, wheels, axleBlock, mirrors, endLamps, plateF, plateR } from './parts';

export function buildBus(k: Kit, m: Model) {
  if (m.style === 'bus-halfcab') return halfCab(k, m);
  if (m.style === 'bus-heritage') return heritage(k, m);
  const g = m.design, d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, W = d.width, H = d.height, c = d.clearance, r = d.wheelR, hw = W / 2;
  const body = paint(1), band = paint(2), roofSt = paint(3), accent = paint(4);
  const coach = style === 'coach', decker = style === 'bus-double';
  const front = str(g, 'front', 'flat');
  const rearHalf = style === 'bus-bendy-rear', frontHalf = style === 'bus-bendy';
  const pane = coach ? C.glassDark : C.glass;
  const rake = front === 'flat' ? 0.08 : front === 'raked' ? (coach ? 0.9 : 0.35) : 0.5;
  const xN = L / 2;

  // ---- body profile ----
  const P: P2[] = [], E: (Style | null)[] = [];
  const push = (p: P2, e: Style | null) => { P.push(p); E.push(e); return P.length - 1; };
  const notch = (x: number) => {
    push([x - 1.05 * r, c], C.arch); push([x - 0.95 * r, r * 1.5], C.arch); push([x - 0.5 * r, r * 2.08], C.arch);
    push([x + 0.5 * r, r * 2.08], C.arch); push([x + 0.95 * r, r * 1.5], C.arch); push([x + 1.05 * r, c], null);
  };
  push([-L / 2, c], null);
  if (lod === 0) for (const x of d.axles.slice().reverse()) notch(x);
  let iFace = -1, iRearFace = -1;
  if (rearHalf) {
    push([xN, c], body);
    push([xN, H], roofSt);
  } else {
    push([xN - 0.05, c], body);
    iFace = push([xN, 1.0], body);
    const iWs = push([xN - rake * 0.2, (coach ? 1.5 : 1.05)], pane);
    push([xN - rake, H - 0.25], body);
    push([xN - rake - 0.25, H], roofSt);
    void iWs;
  }
  if (frontHalf) {
    push([-L / 2, H], null);
  } else {
    push([-L / 2 + 0.25 + (coach ? 0.3 : 0), H], body);
    iRearFace = push([-L / 2, H - 0.3 - (coach ? 0.3 : 0)], body);
  }
  k.prism(P, hw, body, (i) => E[i]);
  const iWs = iFace + 1;

  // ---- glass ----
  const sill = coach ? 1.55 : style === 'bus-single' || frontHalf || rearHalf ? (flag(g, 'lowFloor') ? 1.05 : 1.2) : 1.05;
  const bands: [number, number][] = decker ? [[sill, 2.05], [2.5, H - 0.4]] : [[sill, H - 0.35]];
  const x0 = -L / 2 + (rearHalf ? 0.1 : 0.4), x1 = rearHalf ? xN - 0.1 : xN - rake - 0.35;
  const doorFront = [xN - rake - 1.35, xN - rake - 0.2];
  const doorMid = style === 'bus-single' && L > 11 || rearHalf ? [(x0 + x1) / 2 - 0.6, (x0 + x1) / 2 + 0.6] : null;
  for (const [bi, [y0, y1]] of bands.entries()) {
    if (lod === 1) { k.sideRect(x0, x1, y0, y1, hw, pane); continue; }
    const n = Math.max(3, Math.round((x1 - x0) / (coach ? 1.9 : 1.3)));
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n + 0.06, b = x0 + ((x1 - x0) * (i + 1)) / n - 0.06;
      k.sideRect(a, b, y0, y1, hw, pane, 1);
      // the nearside (kerb) windows stop at the doors, which are glazed to the floor
      if (bi === 0 && !coach && (b > doorFront[0] - 0.1 || (doorMid && a < doorMid[1] && b > doorMid[0]))) continue;
      k.sideRect(a, b, y0, y1, hw, pane, -1);
    }
  }
  if (lod === 0 && !coach) {
    if (!rearHalf) k.sideRect(doorFront[0], doorFront[1], 0.3, H - (decker ? 2.3 : 0.35), hw, pane, -1, 0.014);
    if (doorMid) k.sideRect(doorMid[0], doorMid[1], 0.3, sill + (H - 0.35 - sill), hw, pane, -1, 0.014);
  }
  if (coach && lod === 0) {
    // luggage-bay doors and a sweeping stripe
    for (let x = -L / 2 + 1.5; x < xN - 3; x += 2.2) for (const s of [1, -1] as const) k.sideRect(x, x + 0.04, 0.5, 1.4, hw, C.trim, s, 0.01);
    k.side([[-L / 2 + 0.3, 1.05], [xN - 2.5, 1.2], [xN - 2.5, 1.42], [-L / 2 + 0.3, 1.45]], hw, 0, band);
    k.side([[-L / 2 + 0.4, 1.5], [-L / 2 + 3.2, 1.5], [-L / 2 + 0.6, H - 0.35], [-L / 2 + 0.3, H - 0.35]], hw, 0, accent, 0.014);
  }
  // livery: band between decks or a waistband, and the roof edge
  if (decker) k.sideRect(-L / 2 + 0.02, xN - rake * 0.6, 2.05, 2.5, hw, band, 0, 0.01);
  else if (!coach) k.sideRect(-L / 2 + 0.02, xN - 0.1, sill - 0.25, sill - 0.05, hw, band, 0, 0.01);
  if (lod === 0) k.sideRect(-L / 2 + 0.2, xN - rake - 0.3, H - 0.22, H - 0.02, hw, roofSt, 0, 0.008);

  // ---- front ----
  if (!rearHalf) {
    k.edgeDecal(P, hw, iWs, 0.02, 0.9, -0.94, 0.94, pane, 0.012);
    if (decker) {
      // the upper-deck screen sits above the lower one on flat and raked fronts
      k.edgeDecal(P, hw, iWs, 0.35, 0.39, -0.95, 0.95, band, 0.016);
    }
    k.edgeDecal(P, hw, iWs, 0.9, 0.97, -0.7, 0.7, C.sign, 0.016); // destination display
    k.edgeDecal(P, hw, iFace, 0.05, 0.4, -0.3, 0.3, accent, 0.012);
    for (const s of [1, -1]) {
      k.edgeDecal(P, hw, iFace, 0.35, 0.75, s * 0.68, s * 0.94, C.head, 0.014);
      if (lod === 0) k.edgeDecal(P, hw, iFace, 0.35, 0.75, s * 0.94, s * 1.0, s < 0 ? C.indL : C.indR, 0.016);
    }
    plateF(k, xN, 0.3);
    mirrors(k, xN - rake - 0.2, H - (decker ? 2.35 : 0.9), hw, C.trim, true);
  }
  // ---- rear ----
  if (!frontHalf) {
    const xb = -L / 2;
    endLamps(k, xb, -1, hw, 0.8, 0.3, 0.2);
    if (lod === 0) {
      k.end(xb, -1, -hw + 0.3, hw - 0.3, 0.4, 0.75, C.grille);
      plateR(k, xb, 0.95);
      if (!coach) k.end(xb, -1, -hw + 0.25, hw - 0.25, H - (decker ? 1.7 : 1.1), H - 0.45, pane, 0.012);
    }
  } else if (lod === 0) {
    // half of the bellows at the joint
    k.box(-L / 2 - 0.3, -L / 2, 0.35, H - 0.1, -hw + 0.12, hw - 0.12, C.rubber, { nx: null });
  }
  if (rearHalf && lod === 0) k.box(xN, xN + 0.3, 0.35, H - 0.1, -hw + 0.12, hw - 0.12, C.rubber, { px: null });
  void iRearFace;

  // ---- wheels ----
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.04, 0.3, 'truck', x < 0 && !coach) : axleBlock(k, x, r, hw - 0.03, 2.1);
}

// The front-engined half-cab double-decker: the driver in a cab on the offside, the bonnet and
// radiator beside him, the upper deck over both, and an open platform at the back on the nearside.
function halfCab(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod;
  const L = d.length, W = d.width, H = d.height, r = d.wheelR, hw = W / 2;
  const body = paint(1), band = paint(2), roofSt = paint(3);
  const xCab = L / 2 - 1.5; // front of the saloon, behind the cab and bonnet
  const c = 0.35;
  // main body: both decks, with the upper deck carried forward over the cab
  const P: P2[] = [[-L / 2, c], [xCab, c], [xCab, 2.35], [L / 2 - 0.3, 2.4], [L / 2 - 0.35, H - 0.25], [L / 2 - 0.6, H], [-L / 2 + 0.5, H], [-L / 2, H - 0.4]];
  k.prism(P, hw, body, (i) => (i === 0 ? null : i === 5 ? roofSt : body));
  // cab (offside, +z) and bonnet with radiator (centre and nearside)
  k.box(L / 2 - 1.5, L / 2 - 0.45, 0.5, 2.35, 0.1, hw, body, { nx: null });
  k.end(L / 2 - 0.45, 1, 0.2, hw - 0.1, 1.45, 2.2, C.glass);
  k.sideRect(L / 2 - 1.3, L / 2 - 0.6, 1.45, 2.2, hw, C.glass, 1);
  k.box(L / 2 - 1.5, L / 2 - 0.05, 0.55, 1.45, -hw * 0.55, 0.1, body);
  k.end(L / 2 - 0.05, 1, -hw * 0.5, 0.05, 0.62, 1.4, C.chrome);
  k.end(L / 2 - 0.05, 1, -hw * 0.44, -0.01, 0.7, 1.32, C.grille, 0.02);
  // nearside front wing over the wheel
  k.box(d.axles[0] - r - 0.1, L / 2 - 0.1, r * 2 + 0.05, r * 2 + 0.2, -hw, -hw * 0.55, body);
  for (const s of [1, -1]) k.end(L / 2 - 0.05, 1, s * hw * 0.8 - 0.12, s * hw * 0.8 + 0.12, 1.15, 1.35, C.head);
  // windows: lower saloon, upper deck, and the two-pane upper front
  const wins = (y0: number, y1: number, xa: number, xb: number, n: number) => {
    if (lod === 1) { k.sideRect(xa, xb, y0, y1, hw, C.glass); return; }
    for (let i = 0; i < n; i++) {
      const a = xa + ((xb - xa) * i) / n + 0.06, b = xa + ((xb - xa) * (i + 1)) / n - 0.06;
      k.sideRect(a, b, y0, y1, hw, C.glass);
    }
  };
  wins(1.25, 2.0, -L / 2 + 1.2, xCab - 0.1, 5);
  wins(2.7, H - 0.45, -L / 2 + 0.4, L / 2 - 0.5, 6);
  k.edgeDecal(P, hw, 3, 0.1, 0.8, -0.9, -0.05, C.glass);
  k.edgeDecal(P, hw, 3, 0.1, 0.8, 0.05, 0.9, C.glass);
  // livery: cream bands under each deck's windows
  k.sideRect(-L / 2 + 0.02, L / 2 - 0.3, 2.05, 2.55, hw, band, 0, 0.01);
  if (lod === 0) k.sideRect(-L / 2 + 0.02, xCab, 1.0, 1.18, hw, band, 0, 0.01);
  // the open platform: a dark opening on the nearside rear corner with a pole
  k.sideRect(-L / 2 + 0.05, -L / 2 + 1.1, 0.4, 2.2, hw, C.interior, -1, 0.014);
  if (lod === 0) k.box(-L / 2 + 0.05, -L / 2 + 0.1, 0.4, 2.2, -hw - 0.02, -hw + 0.03, C.chrome);
  k.end(-L / 2, -1, -hw + 0.2, hw - 0.2, 2.75, H - 0.5, C.glass);
  endLamps(k, -L / 2, -1, hw, 0.6, 0.15, 0.15);
  k.end(-L / 2, -1, -0.5, 0.5, H - 0.4, H - 0.25, C.sign);
  k.end(L / 2 - 0.3, 1, -0.6, 0.6, 2.42, 2.6, C.sign);
  plateF(k, L / 2 - 0.05, 0.4);
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.04, 0.26, 'truck', x < 0) : axleBlock(k, x, r, hw - 0.03, 2.1);
}

// The vintage bonneted saloon bus of the twenties and thirties.
function heritage(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod;
  const L = d.length, W = d.width, H = d.height, r = d.wheelR, hw = W / 2;
  const body = paint(1), band = paint(2), roofSt = paint(3);
  const bon = 1.6, xS = L / 2 - bon;
  const c = 0.45;
  k.prism([[-L / 2, c], [xS, c], [xS, H - 0.1], [xS - 0.15, H], [-L / 2 + 0.2, H], [-L / 2, H - 0.2]], hw, body, (i) => (i === 0 ? null : i === 3 ? roofSt : body));
  k.box(xS, L / 2 - 0.15, 0.6, 1.5, -0.55, 0.55, body);
  k.box(L / 2 - 0.15, L / 2, 0.6, 1.6, -0.5, 0.5, C.chrome);
  k.end(L / 2, 1, -0.4, 0.4, 0.7, 1.5, C.grille);
  for (const s of [1, -1]) {
    k.box(xS - 0.2, L / 2 - 0.2, r * 2 + 0.05, r * 2 + 0.15, s > 0 ? 0.55 : -hw + 0.05, s > 0 ? hw - 0.05 : -0.55, fixed('#1a1a1a'));
    if (lod === 0) k.cylX(L / 2 - 0.25, L / 2 - 0.05, 1.35, s * 0.8, 0.12, 0.12, 6, C.chrome, null, C.head);
    else k.end(L / 2 - 0.05, 1, s * 0.8 - 0.12, s * 0.8 + 0.12, 1.25, 1.45, C.head);
  }
  k.end(xS, 1, -hw + 0.1, hw - 0.1, 1.5, H - 0.25, C.glass);
  const n = lod === 0 ? 7 : 1;
  for (let i = 0; i < n; i++) {
    const a = -L / 2 + 0.3 + ((xS - 0.2 + L / 2 - 0.3) * i) / n + 0.05, b = -L / 2 + 0.3 + ((xS - 0.2 + L / 2 - 0.3) * (i + 1)) / n - 0.05;
    k.sideRect(a, b, 1.35, H - 0.4, hw, C.glass);
  }
  k.sideRect(-L / 2 + 0.02, xS - 0.02, 1.0, 1.25, hw, band, 0, 0.01);
  if (lod === 0) for (const s of [1, -1]) k.box(-L / 2 + 0.6, xS - 0.4, H, H + 0.12, s * (hw - 0.15) - 0.04, s * (hw - 0.15) + 0.04, C.chrome);
  endLamps(k, -L / 2, -1, hw, 0.8, 0.14, 0.14);
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.06, 0.2, 'plain', x < 0) : axleBlock(k, x, r, hw - 0.05, 2.1);
}
