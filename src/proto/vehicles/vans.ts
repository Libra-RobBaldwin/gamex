// Vans, minibuses, ice-cream vans and ambulances: a one-box cab profile with a short bonnet,
// either carried through to the back (panel vans, minibuses) or followed by a box body on a
// chassis (Luton vans and ambulances, which get their box a little wider than the cab).
import { Kit, C, paint, fixed, clip, type P2, type Style } from './kit';
import type { Model } from './types';
import { num, flag, str, wheels, axleBlock, mirrors, beacon, lightBar, endLamps, plateR, type Hub, steerOf } from './parts';

export function buildVan(k: Kit, m: Model) {
  const g = m.design, d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, W = d.width, H = d.height, c = d.clearance, r = d.wheelR, hw = W / 2;
  const [xf, xr] = [d.axles[0], d.axles[d.axles.length - 1]];
  const body = paint(1), band = paint(2), roofSt = paint(3);
  const boxBody = style === 'van-luton' || style === 'ambulance';
  const small = style === 'van-small';
  const bon = num(g, 'bonnet', 0.8), rake = num(g, 'rake', 0.6);
  const bh = small ? 0.95 : 1.12; // bonnet height
  const Hc = boxBody ? Math.min(2.45, H - 0.4) : H; // cab roof
  const cabLen = num(g, 'cabLen', 2.1);
  const xWs = L / 2 - bon - 0.08;
  const xTop = xWs - rake * (Hc - bh) * 0.55;
  const xCabRear = boxBody ? xWs - cabLen + 0.35 : -L / 2;

  const P: P2[] = [], E: (Style | null)[] = [];
  const push = (p: P2, e: Style | null) => { P.push(p); E.push(e); return P.length - 1; };
  const notch = (x: number) => {
    push([x - 1.12 * r, c], C.arch); push([x - 1.0 * r, r * 1.35], C.arch); push([x - 0.55 * r, r * 1.95], C.arch);
    push([x + 0.55 * r, r * 1.95], C.arch); push([x + 1.0 * r, r * 1.35], C.arch); push([x + 1.12 * r, c], null);
  };
  push([xCabRear, c], null);
  if (lod === 0 && !boxBody) notch(xr);
  if (lod === 0) notch(xf);
  const iLow = push([L / 2 - 0.05, c], body);
  const iNose = push([L / 2, bh * 0.62], body);
  push([L / 2 - 0.1, bh], body);
  const iWs = push([xWs, bh + 0.04], C.glassPlain);
  push([xTop, Hc - 0.06], body);
  const iRoof = push([xTop - 0.2, Hc], roofSt);
  push([xCabRear + (boxBody ? 0 : 0.08), Hc], body);
  if (!boxBody) push([xCabRear, Hc - 0.1], body);
  k.prism(P, hw, body, (i) => E[i]);
  void iRoof;

  // glass: windscreen, cab doors and, on minibuses, the whole side
  k.edgeDecal(P, hw, iWs, 0.04, 0.96, -0.93, 0.93, C.glassPlain, 0.01);
  const beltY = bh + 0.12, winTop = Hc - 0.14;
  const xB = xWs - cabLen * 0.7;
  k.side([[xWs - 0.06, beltY], [xTop - 0.03, winTop], [xB, winTop], [xB, beltY]], hw, 0, C.glassPlain);
  if (flag(g, 'glazed') || small && str(g, 'kind', '') === 'combi') {
    const x0 = -L / 2 + 0.35, x1 = xB - 0.12, n = Math.max(2, Math.round((x1 - x0) / 1.1));
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n + 0.05, b = x0 + ((x1 - x0) * (i + 1)) / n - 0.05;
      k.sideRect(a, b, beltY, winTop, hw, C.glass);
    }
  }

  // box body, on a chassis behind the cab
  if (boxBody) {
    const bw = num(g, 'boxW', W) / 2, floor = r * 2 + 0.2;
    const peak = style === 'van-luton' ? xTop - 0.25 : xCabRear + 0.1;
    k.box(-L / 2 + 0.3, xCabRear + 0.05, r * 0.9, floor, -hw + 0.15, hw - 0.15, C.chassis, { px: null, nx: null });
    k.box(-L / 2, peak, floor, H, -bw, bw, body, { py: roofSt });
    // box livery: two rows of checks on ambulances, a band on removal vans
    if (lod === 0 && str(g, 'pattern', '') === 'battenberg') {
      const n = Math.max(4, Math.round((peak + L / 2) / 0.6));
      for (let row = 0; row < 2; row++) for (let i = 0; i < n; i++) {
        const x0 = -L / 2 + ((peak + L / 2) * i) / n, x1 = -L / 2 + ((peak + L / 2) * (i + 1)) / n;
        const y0 = floor + 0.25 + row * 0.42;
        k.sideRect(x0, x1, y0, y0 + 0.42, bw, paint((i + row) % 2 ? 4 : 2));
      }
      for (let i = 0; i < 4; i++) k.end(-L / 2, -1, -bw + (i * bw) / 2, -bw + ((i + 1) * bw) / 2, floor + 0.25, floor + 0.67, paint(i % 2 ? 4 : 2));
    } else if (lod === 0) k.sideRect(-L / 2 + 0.05, peak - 0.05, floor + 0.35, floor + 0.6, bw, band);
    // rear lamps at the bottom of the box
    endLamps(k, -L / 2, -1, bw, floor + 0.08, 0.14, 0.22);
    plateR(k, -L / 2, floor + 0.08);
    if (style === 'ambulance') {
      lightBar(k, xTop - 0.35, Hc, 0.3, W - 0.3, true);
      for (const s of [1, -1]) beacon(k, -L / 2 + 0.2, H, s * (bw - 0.2), false);
      for (const s of [1, -1]) beacon(k, -L / 2 + 0.2, H, s * (bw - 0.2) * 0.5, true);
    }
  } else {
    // rear doors and lamps on a panel van
    if (lod === 0) k.end(-L / 2, -1, -0.02, 0.02, c + 0.3, H - 0.15, C.trim);
    k.end(-L / 2, -1, -hw + 0.06, -hw + 0.16, c + 0.45, c + 1.0, C.tail);
    k.end(-L / 2, -1, hw - 0.16, hw - 0.06, c + 0.45, c + 1.0, C.tail);
    if (lod === 0) {
      k.end(-L / 2, -1, -hw + 0.06, -hw + 0.16, c + 1.02, c + 1.14, C.indL, 0.014);
      k.end(-L / 2, -1, hw - 0.16, hw - 0.06, c + 1.02, c + 1.14, C.indR, 0.014);
      k.end(-L / 2, -1, -0.12, 0.12, H - 0.12, H - 0.06, C.brake);
      plateR(k, -L / 2, c + 0.25);
      k.sideRect(-L / 2 + 0.05, xWs - 0.2, bh - 0.28, bh - 0.08, hw, band);
    }
  }

  // ice-cream van: a serving hatch on the nearside (−z, the kerb), an awning and a cone
  if (style === 'ice-cream') {
    const x0 = -L / 2 + 0.6, x1 = xB - 0.4;
    k.sideRect(x0, x1, bh + 0.05, H - 0.35, hw, C.glass, -1, 0.014);
    if (lod === 0) {
      k.box(x0 - 0.1, x1 + 0.1, H - 0.34, H - 0.26, -hw - 0.4, -hw, paint(2));
      k.box(x0, x1, bh - 0.04, bh + 0.04, -hw - 0.25, -hw, C.chrome);
    }
    const cx = (x0 + x1) / 2;
    k.cylY(cx, 0, H, H + 0.45, 0.03, 0.2, 6, fixed('#d9a860'), null);
    k.cylY(cx, 0, H + 0.45, H + 0.62, 0.21, 0.07, 6, paint(4), paint(4));
  }

  // front: lamps, grille, bumper, indicators, mirrors, plate
  for (const s of [1, -1]) {
    k.edgeDecal(P, hw, iNose, 0.35, 0.9, s * 0.62, s * 0.92, C.head);
    if (lod === 0) k.edgeDecal(P, hw, iNose, 0.35, 0.9, s * 0.93, s * 1.0, s < 0 ? C.indL : C.indR, 0.016);
  }
  if (lod === 1) {
    for (const x of d.axles) axleBlock(k, x, r, hw - 0.02, 2);
    if (!boxBody) { k.end(-L / 2, -1, -hw + 0.06, -hw + 0.3, c + 0.4, c + 0.8, C.tail); k.end(-L / 2, -1, hw - 0.3, hw - 0.06, c + 0.4, c + 0.8, C.tail); }
    return;
  }
  k.edgeDecal(P, hw, iNose, 0.3, 0.85, -0.55, 0.55, C.grille);
  k.box(L / 2 - 0.1, L / 2 + 0.06, c + 0.08, c + 0.3, -hw + 0.02, hw - 0.02, str(g, 'bumper', 'rubber') === 'chrome' ? C.chrome : C.rubber);
  k.end(L / 2 + 0.06, 1, -0.26, 0.26, c + 0.12, c + 0.25, C.plateF, 0.006);
  void iLow;
  mirrors(k, xWs - 0.05, beltY, hw, C.trim, !small);
  for (const x of d.axles) wheels(k, x, r, hw - 0.03, 0.21, str<Hub>(g, 'wheel', 'steel'), false, steerOf(d.axles, x));
  if (style === 'minibus' && lod === 0) k.side(clip(P, -L, L, winTop + 0.02, Hc - 0.02), hw, 0, roofSt, 0.01);
}
