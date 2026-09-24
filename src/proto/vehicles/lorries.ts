// Lorries: a cab (bonneted, flat-fronted day cab, sleeper, or high-roof long-haul) on a ladder
// chassis, and a body kit on top: box, curtain-sider, tipper, flatbed with loads and an optional
// loader crane, tanker, bin lorry, gritter, mixer and recovery truck. Tractor units carry a fifth
// wheel; trailers hang off their kingpin and carry every load the haulage trade knows.
import { Kit, C, paint, fixed, type P2, type Style } from './kit';
import type { Model } from './types';
import { num, str, flag, wheels, axleBlock, mirrors, beacon, endLamps, plateR } from './parts';
import { rng, pick } from './util';

type CabKind = 'bonneted' | 'flat' | 'sleeper' | 'high';

// The cab, from x0 (its back) to the front of the vehicle at L/2. Returns the cab roof height.
function cab(k: Kit, m: Model, x0: number) {
  const d = m.dims, g = m.design, lod = k.lod;
  const L = d.length, W = d.width, hw = W / 2, c = 0.45, r = d.wheelR;
  const kind = str<CabKind>(g, 'cab', 'flat');
  const Hc = kind === 'high' ? 3.85 : kind === 'sleeper' ? 3.5 : kind === 'flat' ? 2.95 : 2.65;
  const body = paint(1), roofSt = paint(3);
  const x1 = L / 2, xf = d.axles[0];
  const P: P2[] = [], E: (Style | null)[] = [];
  const push = (p: P2, e: Style | null) => { P.push(p); E.push(e); return P.length - 1; };
  push([x0, c], null);
  if (lod === 0) { push([xf - 1.1 * r, c], C.arch); push([xf - 0.9 * r, r * 1.6], C.arch); push([xf + 0.9 * r, r * 1.6], C.arch); push([xf + 1.1 * r, c], null); }
  let iFace: number, iWs: number;
  if (kind === 'bonneted') {
    push([x1 - 0.05, c], body);
    iFace = push([x1, 1.05], body);
    push([x1 - 0.12, 1.55], body);
    iWs = push([x1 - 1.55, 1.62], C.glassPlain);
    push([x1 - 1.68, Hc - 0.05], roofSt);
    push([x0 + 0.05, Hc], body);
  } else {
    const rake = kind === 'flat' ? 0.1 : 0.2;
    push([x1 - 0.04, c], body);
    iFace = push([x1, 1.5], body);
    iWs = push([x1 - 0.06, 1.6], C.glassPlain);
    push([x1 - 0.06 - rake, kind === 'flat' ? Hc - 0.12 : 2.75], kind === 'flat' ? roofSt : body);
    if (kind !== 'flat') push([x1 - 0.35, Hc - 0.05], roofSt);
    push([x1 - (kind === 'flat' ? 0.35 : 0.55), Hc], roofSt);
    push([x0 + 0.05, Hc], body);
  }
  push([x0, Hc - 0.1], body);
  k.prism(P, hw, body, (i) => E[i]);
  // glass: windscreen and door windows
  k.edgeDecal(P, hw, iWs, 0.06, 0.94, -0.92, 0.92, C.glassPlain, 0.01);
  const wx = kind === 'bonneted' ? x1 - 1.62 : x1 - 0.12;
  const wy0 = kind === 'bonneted' ? 1.7 : 1.7, wy1 = kind === 'flat' ? Hc - 0.2 : kind === 'bonneted' ? Hc - 0.2 : 2.65;
  k.side([[wx, wy0], [wx - (kind === 'bonneted' ? 0.1 : 0.1), wy1], [wx - 1.0, wy1], [wx - 1.0, wy0]], hw, 0, C.glassPlain);
  // grille and lamps on the front face
  const faceT = kind === 'bonneted' ? [0.1, 0.95] : [0.25, 0.95];
  k.edgeDecal(P, hw, iFace, faceT[0], faceT[1], -0.62, 0.62, C.grille);
  if (lod === 0 && str(g, 'grille', 'bar') !== 'slot') for (const t of [0.4, 0.6, 0.8]) k.edgeDecal(P, hw, iFace, t, t + 0.06, -0.62, 0.62, C.chrome, 0.016);
  // bumper with lamps, indicators and plate
  k.box(x1 - 0.1, x1 + 0.1, c, c + 0.45, -hw, hw, C.rubber);
  for (const s of [1, -1]) {
    k.end(x1 + 0.1, 1, s > 0 ? hw - 0.45 : -hw + 0.1, s > 0 ? hw - 0.1 : -hw + 0.45, c + 0.2, c + 0.38, C.head);
    if (lod === 0) k.end(x1 + 0.1, 1, s > 0 ? hw - 0.1 : -hw + 0.02, s > 0 ? hw - 0.02 : -hw + 0.1, c + 0.2, c + 0.38, s < 0 ? C.indL : C.indR);
  }
  if (lod === 0) {
    k.end(x1 + 0.1, 1, -0.26, 0.26, c + 0.05, c + 0.17, C.plateF);
    mirrors(k, x1 - 0.3, 1.9, hw, C.trim, true);
    // steps under the doors
    for (const s of [1, -1]) k.box(xf - 0.9, xf - 0.4 - 0.5 * r, 0.45, 0.9, s > 0 ? hw - 0.25 : -hw, s > 0 ? hw : -hw + 0.25, C.trim);
    // high-roof cabs: a lamp bar and a sun visor
    if (kind === 'high' || kind === 'sleeper') k.box(x1 - 0.45, x1 - 0.25, Hc, Hc + 0.12, -hw + 0.3, hw - 0.3, str(g, 'brand', '') === 'stalberg' ? C.chrome : C.trim);
  }
  return Hc;
}

// chassis rails, mudguards and a fuel tank from x0 to x1
function chassis(k: Kit, x0: number, x1: number, hw: number, lod: number) {
  k.box(x0, x1, 0.55, 1.0, -0.45, 0.45, C.chassis, { px: null });
  if (lod === 0) k.cylX(x1 - 1.9, x1 - 0.6, 0.78, -hw + 0.3, 0.28, 0.28, 6, fixed('#8a8f94'), fixed('#8a8f94'), fixed('#8a8f94'));
}

// a car as a load: two boxes, enough on a transporter or a recovery bed
function loadCar(k: Kit, x: number, y: number, seed: number, flip = false) {
  const r = rng(seed);
  const col = fixed(pick(r, ['#b9bdc0', '#f2f2f0', '#141414', '#2a4f8a', '#b3261e', '#6a6e72', '#1f3d34']));
  const L = 4.2, W = 1.75, dz = 0;
  const f = flip ? -1 : 1;
  k.box(x - L / 2, x + L / 2, y + 0.18, y + 0.8, dz - W / 2, dz + W / 2, col);
  k.box(x - L * 0.25 * f - 0.8, x - L * 0.25 * f + 0.9, y + 0.8, y + 1.38, dz - W / 2 + 0.1, dz + W / 2 - 0.1, C.glassPlain, { py: col });
  if (k.lod === 0) for (const ax of [x - 1.3, x + 1.3]) k.box(ax - 0.3, ax + 0.3, y, y + 0.55, -W / 2 - 0.005, W / 2 + 0.005, C.tyre, { px: null, nx: null });
}

// The bodies that go on a rigid lorry or a trailer, between x0 and x1 at floor height y0.
function bodyKit(k: Kit, m: Model, kind: string, x0: number, x1: number, y0: number, H: number, hw: number) {
  const g = m.design, lod = k.lod;
  const body = paint(1), band = paint(2), roofSt = paint(3);
  const len = x1 - x0;
  switch (kind) {
    case 'box': case 'curtain': case 'livestock': {
      k.box(x0, x1, y0, H, -hw, hw, body, { py: roofSt });
      if (lod === 0) {
        if (kind === 'curtain') for (let x = x0 + 0.5; x < x1 - 0.2; x += 0.62) k.sideRect(x - 0.025, x + 0.025, y0 + 0.05, y0 + 0.5, hw, C.trim);
        else if (kind === 'livestock') for (let i = 0; i < 3; i++) k.sideRect(x0 + 0.2, x1 - 0.2, H - 0.35 - i * 0.55, H - 0.2 - i * 0.55, hw, C.grille);
        else k.sideRect(x0 + 0.05, x1 - 0.05, y0 + 0.2, y0 + 0.5, hw, band);
        if (kind !== 'livestock') k.sideRect(x0 + 0.05, x1 - 0.05, H - 0.22, H - 0.08, hw, band);
        k.end(x0, -1, -0.02, 0.02, y0 + 0.1, H - 0.1, C.trim);
      }
      break;
    }
    case 'tipper': {
      const top = Math.min(H, y0 + 1.5);
      k.box(x0, x1, y0, top, -hw, hw, body, { py: C.aggregate });
      if (lod === 0) {
        k.box(x1 - 0.12, x1, top, top + 0.5, -hw + 0.05, hw - 0.05, body); // headboard over the cab
        k.sideRect(x0 + 0.05, x1 - 0.05, top - 0.25, top - 0.1, hw, band);
      }
      break;
    }
    case 'flatbed': {
      k.box(x0, x1, y0, y0 + 0.2, -hw, hw, band, { py: C.deck });
      const load = str(g, 'load', 'pallets');
      const r = rng(m.seed);
      if (load === 'pallets' || load === 'bricks') {
        const n = Math.max(2, Math.floor(len / 1.3));
        for (let i = 0; i < n; i++) {
          const a = x0 + 0.2 + i * ((len - 0.4) / n), b = a + (len - 0.4) / n - 0.15, h = load === 'bricks' ? 0.9 : 0.6 + r() * 0.9;
          k.box(a, b, y0 + 0.2, y0 + 0.2 + h, -hw + 0.12, hw - 0.12, fixed(load === 'bricks' ? '#9a4b35' : pick(r, ['#c9b48a', '#8a6a45', '#b9bdc0', '#2b4a73'])));
        }
      } else if (load === 'steel') {
        const n = Math.max(2, Math.floor(len / 2.4));
        for (let i = 0; i < n; i++) {
          const x = x0 + 0.9 + i * ((len - 1.8) / Math.max(1, n - 1));
          k.cylX(x - 0.7, x + 0.7, y0 + 0.2 + 0.75, 0, 0.75, 0.75, lod === 0 ? 8 : 6, fixed('#8a8f94'), fixed('#6d7176'), fixed('#6d7176'));
        }
      } else {
        k.box(x0 + 0.3, x1 - 0.3, y0 + 0.2, y0 + 1.3, -hw + 0.15, hw - 0.15, C.wood, { nx: C.logEnd, px: C.logEnd });
      }
      if (flag(g, 'crane') && lod === 0) {
        k.box(x1 - 0.1, x1 + 0.5, y0, y0 + 1.9, -0.35, 0.35, fixed('#e0b42a'));
        k.box(x0 + len * 0.4, x1 + 0.3, y0 + 1.9, y0 + 2.2, -0.2, 0.2, fixed('#e0b42a'));
      }
      break;
    }
    case 'tanker': {
      const ry = (H - y0) / 2, cy = y0 + ry;
      k.cylX(x0, x1, cy, 0, ry, hw - 0.02, lod === 0 ? 10 : 6, body, body, body);
      if (lod === 0) {
        k.box(x0 + 0.5, x1 - 0.5, H, H + 0.08, -0.3, 0.3, C.trim);
        k.cylX(x0 + len * 0.3, x1 - len * 0.3, cy, 0, ry * 0.3, hw + 0.01, 8, band, null, null);
      }
      break;
    }
    case 'refuse': {
      const cs: P2[] = [[-1, 0], [1, 0], [1, 0.8], [0.8, 1], [-0.8, 1], [-1, 0.8]];
      k.loftX(cs, [{ x: x0 + 1.2, sy: H - y0, sz: hw, dy: y0 }, { x: x1, sy: H - y0 - 0.1, sz: hw, dy: y0 }], (j) => (j === 0 ? null : j === 3 ? roofSt : body), null, body);
      k.box(x0, x0 + 1.25, y0 - 0.25, H + 0.05, -hw + 0.02, hw - 0.02, band);
      if (lod === 0) k.end(x0, -1, -hw + 0.3, hw - 0.3, y0 + 0.2, y0 + 1.2, C.grille);
      break;
    }
    case 'gritter': {
      const poly: P2[] = [[-hw + 0.4, y0], [hw - 0.4, y0], [hw, H], [-hw, H]];
      // a V-shaped hopper: a profile across the width, swept along x
      k.loftX(poly.map(([z, y]) => [z, y]), [{ x: x0 + 0.5, sy: 1, sz: 1, dy: 0 }, { x: x1, sy: 1, sz: 1, dy: 0 }], (j) => (j === 0 ? null : j === 2 ? C.aggregate : body), body, body);
      if (lod === 0) k.cylY(x0 + 0.2, 0, y0 - 0.3, y0 - 0.2, 0.4, 0.4, 6, C.trim, C.trim);
      break;
    }
    case 'mixer': {
      const circle: P2[] = Array.from({ length: lod === 0 ? 10 : 6 }, (_, i) => { const a = (i / (lod === 0 ? 10 : 6)) * Math.PI * 2; return [Math.cos(a), Math.sin(a)] as P2; });
      const R = Math.min(hw, (H - y0) / 2);
      const sects = [
        { x: x0 + 0.2, sy: R * 0.45, sz: R * 0.45, dy: y0 + R * 1.5 },
        { x: x0 + len * 0.35, sy: R, sz: R, dy: y0 + R * 1.02 },
        { x: x0 + len * 0.7, sy: R * 0.95, sz: R * 0.95, dy: y0 + R * 0.95 },
        { x: x1 - 0.1, sy: R * 0.55, sz: R * 0.55, dy: y0 + R * 0.7 },
      ];
      k.loftX(circle, sects, (j, s) => ((j + s) % 3 === 0 ? band : body), fixed('#6d7176'), body);
      if (lod === 0) k.box(x0 - 0.3, x0 + 0.5, y0, y0 + 1.6, -0.3, 0.3, C.chassis);
      break;
    }
    case 'recovery': {
      k.box(x0, x1, y0, y0 + 0.25, -hw, hw, body, { py: C.deck });
      loadCar(k, (x0 + x1) / 2 + 0.3, y0 + 0.25, m.seed);
      if (lod === 0) {
        k.box(x0, x0 + 0.5, y0, y0 + 0.9, -0.4, 0.4, band);
        k.box(x1 - 0.2, x1, y0 + 0.25, y0 + 1.1, -hw + 0.1, hw - 0.1, band);
      }
      break;
    }
    case 'car': {
      // a two-deck car transporter: lower deck at the floor, upper deck on posts
      const up = H - 1.55;
      k.box(x0, x1, y0 - 0.15, y0, -hw, hw, body, { py: C.deck });
      k.box(x0, x1 - 0.8, up - 0.12, up, -hw, hw, body, { py: C.deck });
      const n = Math.max(2, Math.floor((x1 - x0) / 4.5));
      for (let i = 0; i < n; i++) {
        const cx = x0 + 2.3 + i * ((x1 - x0 - 4.6) / Math.max(1, n - 1));
        loadCar(k, cx, y0, m.seed + i);
        if (cx < x1 - 3) loadCar(k, cx, up, m.seed + 17 + i, true);
      }
      if (lod === 0) for (let x = x0 + 0.2; x < x1 - 0.5; x += 3.2) for (const s of [1, -1]) k.box(x, x + 0.12, y0, up, s * hw - 0.06, s * hw + 0.06, body);
      break;
    }
    case 'container': {
      // a skeletal chassis with one 40 ft box or two 20 ft boxes
      k.box(x0, x1, y0 - 0.2, y0, -0.6, 0.6, C.chassis, { px: null });
      const two = (m.seed % 3) === 0;
      const boxes = two ? [[x0 + 0.1, x0 + 6.15], [x0 + 6.25, x0 + 12.3]] : [[x0 + 0.2, x0 + 12.39]];
      for (const [a, b] of boxes) {
        k.box(a, b, y0, y0 + 2.6, -1.22, 1.22, body, { py: roofSt });
        if (lod === 0) for (let x = a + 0.3; x < b - 0.2; x += 0.55) k.sideRect(x - 0.03, x + 0.03, y0 + 0.08, y0 + 2.52, 1.22, band, 0, 0.008);
        if (lod === 0) k.end(a, -1, -0.02, 0.02, y0 + 0.1, y0 + 2.5, C.trim);
      }
      break;
    }
    case 'logging': {
      k.box(x0, x1, y0 - 0.2, y0, -hw + 0.3, hw - 0.3, C.chassis);
      const bolsters = [x0 + 0.5, x0 + len / 2, x1 - 0.5];
      if (lod === 0) for (const bx of bolsters) for (const s of [1, -1]) k.box(bx - 0.08, bx + 0.08, y0, y0 + 2.0, s * (hw - 0.05) - 0.06, s * (hw - 0.05) + 0.06, band);
      const rows = lod === 0 ? [[-0.75, 0.45], [0, 0.45], [0.75, 0.45], [-0.38, 1.25], [0.38, 1.25]] : [[0, 0.8]];
      for (const [z, y] of rows) {
        const rr = lod === 0 ? 0.36 : hw - 0.1;
        k.cylX(x0 + 0.2, x1 - 0.1, y0 + y, z, lod === 0 ? rr : 0.8, lod === 0 ? rr : hw - 0.1, lod === 0 ? 6 : 4, C.logs, C.logEnd, C.logEnd);
      }
      break;
    }
  }
}

export function buildLorry(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, W = d.width, hw = W / 2, H = d.height, r = d.wheelR;
  if (m.category === 'trailer') return trailer(k, m);
  const cabLen = str<CabKind>(m.design, 'cab', 'flat') === 'bonneted' ? 3.1 : str(m.design, 'cab', 'flat') === 'flat' ? 1.9 : 2.3;
  const x0 = L / 2 - cabLen;
  cab(k, m, x0);
  chassis(k, -L / 2 + 0.2, x0, hw, lod);
  const rear = d.axles.slice(1);
  for (const [i, x] of d.axles.entries()) {
    if (lod === 0) wheels(k, x, r, hw - 0.02, 0.3, 'truck', i > 0 && (i === d.axles.length - 1 || style !== 'mixer'));
    else axleBlock(k, x, r, hw - 0.02, 2);
  }
  if (lod === 0) for (const x of rear) for (const s of [1, -1]) k.box(x - r - 0.15, x + r + 0.15, r * 2 + 0.05, r * 2 + 0.12, s > 0 ? hw - 0.6 : -hw, s > 0 ? hw : -hw + 0.6, C.trim);
  if (style === 'tractor') {
    const fifth = num(m.design, 'fifth', d.axles[d.axles.length - 1] + 0.5);
    k.box(fifth - 0.6, fifth + 0.6, 1.0, 1.15, -0.9, 0.9, C.chassis);
    k.box(-L / 2, -L / 2 + 0.25, 0.5, 1.0, -hw + 0.1, hw - 0.1, C.chassis);
    endLamps(k, -L / 2, -1, hw - 0.1, 0.7, 0.14, 0.24);
    if (lod === 0 && str(m.design, 'cab', '') !== 'bonneted') k.box(x0 - 0.35, x0 - 0.05, 1.0, 2.6, -hw + 0.25, hw - 0.25, C.trim, { px: null });
  } else {
    const kind = style.replace('rigid-', '');
    const y0 = 1.25;
    bodyKit(k, m, kind, -L / 2, x0 - 0.1, y0, num(m.design, 'bodyH', H), hw);
    endLamps(k, -L / 2, -1, hw, 0.75, 0.14, 0.24);
    k.box(-L / 2 + 0.05, -L / 2 + 0.2, 0.45, 0.6, -hw + 0.1, hw - 0.1, C.trim);
    plateR(k, -L / 2 + 0.05, 0.62);
    if (style === 'refuse' || style === 'gritter' || style === 'recovery') for (const s of [1, -1]) beacon(k, L / 2 - 0.6, str(m.design, 'cab', 'flat') === 'high' ? 3.85 : 2.95, s * (hw - 0.3), false);
  }
}

function trailer(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, W = d.width, hw = W / 2, H = d.height, r = d.wheelR;
  const kind = style.replace('trailer-', '');
  const y0 = kind === 'car' ? 0.95 : kind === 'container' ? 1.35 : kind === 'tanker' ? 1.05 : 1.3;
  // main frame, landing legs behind the kingpin, and the running gear
  if (kind !== 'container' && kind !== 'logging' && kind !== 'car') k.box(-L / 2, L / 2, y0 - 0.3, y0, -0.5, 0.5, C.chassis, { px: null, nx: null });
  if (lod === 0) for (const s of [1, -1]) k.box(L / 2 - 3.2, L / 2 - 3.0, 0.1, y0 - 0.2, s * 0.9 - 0.08, s * 0.9 + 0.08, C.chassis);
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.03, 0.3, 'truck', true) : axleBlock(k, x, r, hw - 0.03, 2);
  if (lod === 0 && kind !== 'car') k.box(d.axles[d.axles.length - 1] - r - 0.2, d.axles[0] + r + 0.2, r * 2 + 0.05, y0 - 0.25, -hw + 0.02, hw - 0.02, C.trim, { py: null });
  bodyKit(k, m, kind, -L / 2, L / 2, y0, H, hw);
  // rear lamps on an underrun bar
  k.box(-L / 2 + 0.05, -L / 2 + 0.2, 0.45, 0.62, -hw + 0.1, hw - 0.1, C.trim);
  endLamps(k, -L / 2 + 0.05, -1, hw - 0.1, 0.46, 0.12, 0.24);
  plateR(k, -L / 2 + 0.05, 0.64);
  if (lod === 0 && kind !== 'car') for (const s of [1, -1]) k.box(-L / 2 + 5, d.axles[0] - r - 0.3, 0.5, y0 - 0.3, s > 0 ? hw - 0.04 : -hw, s > 0 ? hw : -hw + 0.04, paint(2));
}
