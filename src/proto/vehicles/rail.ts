// Rail vehicles. Most bodies are a cross-section (the UK loading gauge: straight sides, a curved
// roof) swept along the length, with extra tapering sections for a nose: flat ends for old
// units, a short raked cab, a curved modern cab, a long wedge for a 1970s-style high-speed power
// car, a longer needle for a 2010s one. Underneath go bogies or four-wheel running gear,
// buffers or couplers, and on top pantographs, fans or a steam engine's boiler fittings.
//
// Lamps: white lamps (head, code 1) glow with FLAGS.lights; red lamps use the brake code (3) so
// the traffic layer lights them on the last vehicle with FLAGS.brake.
import { Kit, C, paint, fixed, asWheel, type P2, type Style, type LoftSect } from './kit';
import type { Model } from './types';
import { num, flag, wheels, axleBlock, bellowsHalf } from './parts';
import { railLayout, drawDoors, doorsOf, type Door } from './doors';
import { MOTION } from './motion';
import { rng, pick } from './util';
import { BOX_COLOURS } from './operators';

const body = paint(1), band = paint(2), roofSt = paint(3), ends = paint(4);

// The cross-section, measured up from the floor (so a section scaled down keeps its floor).
function section(hw: number, h: number, lod: number): P2[] {
  const cant = h * 0.78;
  return lod === 0
    ? [[-hw, 0], [hw, 0], [hw, cant], [hw * 0.82, h * 0.93], [hw * 0.4, h], [-hw * 0.4, h], [-hw * 0.82, h * 0.93], [-hw, cant]]
    : [[-hw, 0], [hw, 0], [hw, cant], [hw * 0.5, h], [-hw * 0.5, h], [-hw, cant]];
}
// which edges of the section are roof
const isRoof = (j: number, n: number) => (n === 8 ? j >= 3 && j <= 5 : j === 3);

type Nose = 'flat' | 'raked' | 'curved' | 'short' | 'angled' | 'wedge' | 'needle' | 'none';
// Sections from the body end to the nose tip at x = tip (dir 1 at the front, −1 at the back).
function noseSects(nose: Nose, tip: number, dir: 1 | -1, floor: number, noseLen: number): LoftSect[] {
  const s = (dx: number, sy: number, sz: number, dyUp = 0): LoftSect => ({ x: tip - dir * dx, sy, sz, dy: floor + dyUp });
  switch (nose) {
    case 'raked': return [s(0.9, 1, 1), s(0, 0.9, 0.94)];
    case 'curved': return [s(1.8, 1, 1), s(0.6, 0.93, 0.95), s(0, 0.72, 0.8)];
    case 'short': return [s(1.9, 1, 1), s(1.85, 0.7, 0.96), s(0, 0.66, 0.9)];
    case 'angled': return [s(0.7, 1, 1), s(0, 0.9, 0.92)];
    case 'wedge': return [s(noseLen, 1, 1), s(noseLen * 0.55, 0.8, 0.98), s(noseLen * 0.2, 0.48, 0.86), s(0, 0.3, 0.62, -0.25)];
    case 'needle': return [s(noseLen, 1, 1), s(noseLen * 0.7, 0.9, 0.98), s(noseLen * 0.4, 0.66, 0.9), s(noseLen * 0.15, 0.4, 0.72), s(0, 0.2, 0.42, -0.2)];
    default: return [s(0, 1, 1)];
  }
}

// A rail body from x0 to x1, with a nose at either end. Returns the loft for decals.
function railBody(k: Kit, hw: number, floor: number, top: number, x0: number, x1: number, front: Nose, back: Nose, noseLen = 4) {
  const cs = section(hw, top - floor, k.lod);
  const n = cs.length;
  const fr = noseSects(front, x1, 1, floor, noseLen);
  const bk = noseSects(back, x0, -1, floor, noseLen).reverse();
  const sects = [...bk, ...fr];
  const nb = bk.length - 1, nf = fr.length - 1;
  const segs = sects.length - 1;
  const edge = (j: number, sIdx: number): Style | null => {
    if (j === 0) return null;
    const inNose = (sIdx < nb && back !== 'flat' && back !== 'none') || (sIdx >= segs - nf && front !== 'flat' && front !== 'none');
    const tipSeg = (sIdx === 0 && nb > 0) || (sIdx === segs - 1 && nf > 0);
    if (tipSeg && (front === 'wedge' || front === 'needle' || front === 'curved' || back === 'curved')) return ends;
    if (isRoof(j, n)) return roofSt;
    return inNose ? body : body;
  };
  const loft = k.loftX(cs, sects, edge, back === 'none' ? C.rubber : ends, front === 'none' ? C.rubber : ends);
  return { loft, segs, nb, nf, n, sects };
}

// Cab glass: a windscreen across the nose and a side window each side.
function cabGlass(k: Kit, b: ReturnType<typeof railBody>, atFront: boolean, nose: Nose, hw: number, floor: number, top: number, x: number) {
  const dir = atFront ? 1 : -1;
  const h = top - floor;
  if (nose === 'flat' || nose === 'none') {
    // two panes on the flat end, and yellow-panel lamps under them
    k.end(x, dir, -hw + 0.25, -0.08, floor + h * 0.55, floor + h * 0.8, C.glass);
    k.end(x, dir, 0.08, hw - 0.25, floor + h * 0.55, floor + h * 0.8, C.glass);
  } else {
    const seg = atFront ? b.segs - 1 : 0;
    const [u0, u1] = atFront ? [0.12, 0.92] : [0.08, 0.88];
    const roofEdges = b.n === 8 ? [2, 3, 4, 5, 6] : [2, 3, 4];
    for (const j of roofEdges) b.loft.patch(seg, u0, u1, j, j === roofEdges[0] ? 0.4 : 0, j === roofEdges[roofEdges.length - 1] ? 0.6 : 1, C.glass);
  }
  // side cab windows
  const xa = atFront ? x - (nose === 'wedge' || nose === 'needle' ? 3.2 : 1.5) : x + 0.4;
  const xb = atFront ? x - 0.4 : x + (nose === 'wedge' || nose === 'needle' ? 3.2 : 1.5);
  if (k.lod === 0) k.sideRect(Math.min(xa, xb), Math.max(xa, xb) - 0.6, floor + h * 0.5, floor + h * 0.72, hw, C.glass);
}

function lamps(k: Kit, x: number, dir: 1 | -1, hw: number, y: number) {
  for (const s of [1, -1]) {
    k.end(x, dir, s > 0 ? hw - 0.5 : -hw + 0.25, s > 0 ? hw - 0.25 : -hw + 0.5, y, y + 0.18, C.head, 0.02);
    if (k.lod === 0) k.end(x, dir, s > 0 ? hw - 0.2 : -hw + 0.05, s > 0 ? hw - 0.05 : -hw + 0.2, y, y + 0.18, C.brake, 0.02);
  }
}

// A bogie: at the near level, outside side frames with axleboxes and springs, a transom, and the
// wheels inside; further off, a block with the wheels suggested. It swivels about its pivot on
// curves (the shader turns it by the curvature the vehicle is given).
function bogie(k: Kit, x: number, hw: number, r: number, axles = 2, spacing = 2.6) {
  const lod = k.lod;
  const half = ((axles - 1) * spacing) / 2;
  k.moving([MOTION.bogie, x, 0, 0], () => {
    if (lod !== 0) {
      k.box(x - half - 0.7, x + half + 0.7, r * 0.6, r * 2 + 0.25, -hw + 0.25, hw - 0.25, C.bogie, { py: null });
      for (let i = 0; i < axles; i++) axleBlock(k, x - half + i * spacing, r, hw - 0.3, 1.8);
      return;
    }
    const zo = hw - 0.18, zi = hw - 0.27; // side frames, outside the wheels
    for (const s of [1, -1] as const) {
      k.box(x - half - 0.75, x + half + 0.75, r * 0.62, r * 1.62, s > 0 ? zi : -zo, s > 0 ? zo : -zi, C.bogie, { nx: null, px: null, [s > 0 ? 'nz' : 'pz']: null });
      // axleboxes over the wheel centres and the springs above them, on the frame's face
      for (let i = 0; i < axles; i++) {
        const ax = x - half + i * spacing;
        k.sideRect(ax - 0.2, ax + 0.2, r * 0.72, r * 1.3, zo, fixed('#45484c'), s, 0.012);
        k.sideRect(ax - 0.13, ax + 0.13, r * 1.3, r * 1.62, zo, fixed('#5c6064'), s, 0.012);
      }
      // the wheels between the frames: only their bottoms show, so six sides do
      for (let i = 0; i < axles; i++) {
        const ax = x - half + i * spacing, st = asWheel(C.tyre, ax, r);
        k.cylZ(ax, r, r, s * (hw - 0.29), s * (hw - 0.42), 6, st, st, null);
      }
    }
    // the transom across the middle, carrying the body on its pivot
    k.box(x - 0.35, x + 0.35, r * 1.05, r * 1.7, -zi, zi, C.bogie, { nz: null, pz: null });
  });
}
function buffers(k: Kit, x: number, dir: 1 | -1, hw: number, y: number, beam: Style = C.trim) {
  k.box(dir > 0 ? x - 0.2 : x, dir > 0 ? x : x + 0.2, y - 0.3, y + 0.25, -hw + 0.05, hw - 0.05, beam);
  if (k.lod === 0) for (const s of [1, -1]) k.cylX(x, x + dir * 0.45, y, s * 0.87, 0.17, 0.17, 6, C.buffer, null, C.buffer);
}
function coupler(k: Kit, x: number, dir: 1 | -1, y: number) {
  k.box(dir > 0 ? x : x - 0.5, dir > 0 ? x + 0.5 : x, y - 0.15, y + 0.15, -0.2, 0.2, C.buffer);
}
// A single-arm pantograph on a frame standing on insulators. The arms and the head fold down
// with FLAGS.pantoDown; the frame and insulators stay put.
function pantograph(k: Kit, x: number, y: number, lod: number) {
  if (lod !== 0) {
    k.box(x - 0.6, x + 0.6, y, y + 0.2, -0.55, 0.55, C.pantograph, { py: null });
    k.moving([MOTION.panto, y + 0.2, 0, 0], () => { k.box(x - 0.1, x + 0.1, y + 0.2, y + 0.9, -0.03, 0.03, C.pantograph); k.box(x - 0.15, x + 0.15, y + 0.9, y + 0.95, -0.8, 0.8, C.pantograph); });
    return;
  }
  const ins = fixed('#8c4a2e'); // brown glazed insulators
  for (const ix of [x - 0.55, x + 0.55]) for (const iz of [-0.45, 0.45]) k.box(ix - 0.06, ix + 0.06, y, y + 0.18, iz - 0.06, iz + 0.06, ins, { py: null });
  const b = y + 0.18;
  k.box(x - 0.95, x + 0.7, b, b + 0.08, -0.52, 0.52, C.pantograph);
  k.moving([MOTION.panto, b + 0.1, 0, 0], () => {
    // lower arm leaning forward from the hinge, upper arm back to the head, and the rod that works it
    k.prism([[x - 0.9, b + 0.08], [x - 0.78, b + 0.08], [x + 0.25, b + 0.66], [x + 0.14, b + 0.72]], 0.05, C.pantograph, () => C.pantograph);
    k.prism([[x + 0.14, b + 0.66], [x + 0.26, b + 0.68], [x - 0.5, b + 1.22], [x - 0.6, b + 1.22]], 0.035, C.pantograph, () => C.pantograph);
    k.prism([[x - 0.82, b + 0.1], [x - 0.76, b + 0.1], [x + 0.18, b + 0.62], [x + 0.13, b + 0.65]], 0.015, null, () => C.pantograph, 0.12);
    // the head: a carbon strip on its frame, with horns turned down at each end
    k.box(x - 0.64, x - 0.46, b + 1.22, b + 1.32, -0.62, 0.62, fixed('#1c1c1e'), { py: fixed('#1c1c1e'), px: C.pantograph, nx: C.pantograph });
    for (const s of [1, -1]) k.box(x - 0.62, x - 0.48, b + 1.1, b + 1.3, s > 0 ? 0.62 : -0.78, s > 0 ? 0.78 : -0.62, C.pantograph, { [s > 0 ? 'nz' : 'pz']: null });
  });
}
function windows(k: Kit, x0: number, x1: number, y0: number, y1: number, hw: number, n: number, gap = 0.12, st: Style = C.glass) {
  if (k.lod !== 0) { k.sideRect(x0, x1, y0, y1, hw, st); return; }
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n + gap / 2, b = x0 + ((x1 - x0) * (i + 1)) / n - gap / 2;
    k.sideRect(a, b, y0, y1, hw, st);
  }
}
// Windows along a side, stopping at the doors: each stretch of side between two doors gets
// windows about `pitch` apart. The middle level draws one strip per stretch.
function windowsAround(k: Kit, x0: number, x1: number, y0: number, y1: number, hw: number, pitch: number, doors: Door[], gap = 0.14) {
  const spans = doors.map((d) => [d.x - d.width / 2 - 0.14, d.x + d.width / 2 + 0.14] as const).sort((a, b) => a[0] - b[0]);
  let a = x0;
  const run = (lo: number, hi: number) => {
    if (hi - lo < 0.45) return;
    windows(k, lo, hi, y0, y1, hw, Math.max(1, Math.round((hi - lo) / pitch)), gap);
  };
  for (const [s0, s1] of spans) { if (s1 <= a) continue; run(a, Math.min(s0, x1)); a = Math.max(a, s1); }
  run(a, x1);
}

export function buildRail(k: Kit, m: Model) {
  switch (m.style) {
    case 'steam-tank': case 'steam-tender': return steam(k, m);
    case 'tender': return tender(k, m);
    case 'shunter': return shunter(k, m);
    case 'tram-heritage': return heritageTram(k, m);
    case 'wagon-hopper': case 'wagon-box': case 'wagon-tank': case 'wagon-flat': case 'wagon-car': case 'wagon-timber': case 'brake-van': return wagon(k, m);
    default: return carriage(k, m);
  }
}

// Locomotives, multiple-unit cars, high-speed power cars and coaches, trams and rack railcars.
function carriage(k: Kit, m: Model) {
  const g = m.design, d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, hw = d.width / 2, H = d.height, r = d.wheelR;
  const lay = railLayout(m);
  const { tram, loco, floor, cab, front, back, x0, x1, bx0, bx1, h, wy0, wy1 } = lay;
  const b = railBody(k, hw, floor, H, x0, x1, front, back, num(g, 'noseLen', 4));
  // livery: window band, cab ends and a skirt
  k.sideRect(bx0, bx1, wy0 - 0.12, wy1 + 0.12, hw, band, 0, 0.008);
  if (cab) {
    if (front === 'flat' || front === 'raked' || front === 'angled' || front === 'short') k.end(front === 'raked' || front === 'angled' ? x1 : x1, 1, -hw * 0.9, hw * 0.9, floor, floor + h * (front === 'short' ? 0.6 : 0.5), ends, 0.006);
    cabGlass(k, b, true, front, hw * (front === 'raked' ? 0.94 : 1), floor, H, x1);
    lamps(k, x1 + (front === 'wedge' || front === 'needle' ? 0 : 0.01), 1, hw * 0.9, floor + 0.15);
    if (loco || style === 'rack-car') { cabGlass(k, b, false, back, hw, floor, H, x0); lamps(k, x0, -1, hw * 0.9, floor + 0.15); }
  }
  // side windows (passenger stock) or grilles (locomotives)
  if (loco) {
    if (lod === 0) for (const s of [1, -1] as const) for (let i = 0; i < 3; i++) {
      const xa = -L * 0.3 + i * L * 0.22;
      k.sideRect(xa, xa + L * 0.14, floor + h * 0.35, floor + h * 0.7, hw, C.grille, s, 0.012);
    }
    k.sideRect(bx0, bx1, floor + h * 0.12, floor + h * 0.2, hw, ends, 0, 0.01);
  } else if (style !== 'hs-power' || num(g, 'year', 2000) >= 2008) {
    // the middle level draws no slam doors, so its window strip runs straight past them
    const cut = doorsOf(m).filter((dr) => lod === 0 || dr.kind !== 'slam');
    windowsAround(k, bx0 + 0.2, bx1 - 0.2, wy0, wy1, hw, tram ? 1.7 : 1.5, cut);
  }
  // doors: leaves set in frames, which the shader opens (see doors.ts)
  if (!loco) drawDoors(k, m, hw);
  // running gear and underframe
  if (tram) {
    k.sideRect(x0 + 0.2, x1 - 0.2, 0.08, floor + 0.05, hw, body, 0, 0.006);
    k.box(x0 + 0.5, x1 - 0.5, 0.08, floor, -hw + 0.1, hw - 0.1, C.bogie, { py: null });
  } else {
    for (const x of d.axles) bogie(k, x, hw, r, loco && L > 18 ? 3 : 2, loco ? 2.0 : 2.6);
    if (lod === 0) k.box(d.axles[1] + 2.2, d.axles[0] - 2.2, 0.5, floor, -hw + 0.4, hw - 0.4, C.bogie, { py: null });
  }
  // ends: buffers on locomotives and hauled stock, couplers on units, gangways between cars
  const hauled = style === 'coach-stock' || style === 'hs-coach' || loco;
  if (hauled && !(style === 'hs-coach')) { buffers(k, x1, 1, hw, 1.05); buffers(k, x0, -1, hw, 1.05); }
  else if (!tram) { if (cab) coupler(k, x1, 1, 1.0); coupler(k, x0, -1, 1.0); }
  // gangways between coaches and unit cars, and the bellows between tram sections
  if (!loco && style !== 'hs-power' && style !== 'rack-car' && (lod === 0 || tram)) {
    const [len, hwB, y0, y1] = tram ? [0.45, hw - 0.14, floor + 0.02, H - 0.12] : [0.45, 0.52, floor + 0.05, H - 0.35];
    if (!cab || back === 'flat') bellowsHalf(k, x0, -1, len, hwB, y0, y1);
    if (!cab) bellowsHalf(k, x1, 1, len, hwB, y0, y1);
  }
  // roof: pantographs, fans, exhausts
  if (flag(g, 'panto') || style === 'electric-loco' || (style === 'hs-power' && flag(g, 'panto'))) pantograph(k, loco ? L * 0.3 : 0, H, lod);
  if (lod === 0 && (style === 'diesel-loco' || style === 'dmu-car' || (style === 'hs-power' && !flag(g, 'panto')))) {
    for (let i = 0; i < (loco ? 3 : 1); i++) k.disc([-L * 0.15 + i * 2.2, H + 0.01, 0], 'y', 1, 0.5, 6, C.grille);
  }
  if (style === 'rack-car') k.box(-1.2, 1.2, 0.25, floor, -0.25, 0.25, C.buffer);
}

// Coupling rods on coupled wheels: a crank pin and a balance weight on every wheel (which turn
// with it), and a rod each side joining the pins, carried round by them. The two sides are set
// a quarter turn apart, as on the real thing.
function couplingRods(k: Kit, axles: readonly number[], r: number, zOut: number, st: Style) {
  const cr = r * 0.42;
  const xs = axles.slice().sort((a, b) => a - b);
  for (const s of [1, -1] as const) {
    const ph = s > 0 ? Math.PI / 2 : 0;
    const px = Math.cos(ph) * cr, py = r + Math.sin(ph) * cr;
    const z = s * (zOut + 0.02);
    for (const x of xs) {
      k.disc([x + px, py, z], 'z', s, 0.07, 6, asWheel(C.chrome, x, r));
      // the balance weight, opposite the pin
      k.disc([x - px * 1.1, r - (py - r) * 1.1, s * (zOut + 0.01)], 'z', s, r * 0.32, 5, asWheel(fixed('#222224'), x, r));
    }
    k.moving([MOTION.rod, cr, ph, r], () => {
      k.box(xs[0] + px - 0.1, xs[xs.length - 1] + px + 0.1, py - 0.05, py + 0.05, s > 0 ? z : z - 0.05, s > 0 ? z + 0.05 : z, st);
    });
  }
}

// Steam: frames, coupled wheels, a boiler with smokebox, chimney and dome, a cab, and side tanks
// and a bunker (tank engines) or a tender behind (tender engines).
function steam(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod, tank = m.style === 'steam-tank';
  const L = d.length, hw = d.width / 2, H = d.height, r = d.wheelR;
  const fl = 1.15, br = tank ? 0.72 : 0.82, by = H - 0.95 - br * 0.2;
  const xCab = tank ? -L / 2 + 2.9 : -L / 2 + 2.6, xFront = L / 2 - 0.5;
  // frames and footplate
  k.box(-L / 2 + 0.3, L / 2 - 0.3, 0.55, fl - 0.1, -0.55, 0.55, C.chassis, { px: null, nx: null });
  k.box(-L / 2 + 0.2, L / 2 - 0.2, fl - 0.12, fl, -hw + 0.05, hw - 0.05, fixed('#1a1a1a'));
  // coupled wheels with a rod, and a leading bogie on tender engines
  const drivers = tank ? [1.6, 0, -1.6] : [2.2, 0.3, -1.6];
  for (const x of drivers) lod === 0 ? wheels(k, x, r, hw - 0.3, 0.14, 'rail') : axleBlock(k, x, r, hw - 0.3, 1.8);
  if (!tank) for (const x of [L / 2 - 1.4, L / 2 - 2.9 + 0.8]) lod === 0 ? wheels(k, x, 0.46, hw - 0.35, 0.12, 'rail') : axleBlock(k, x, 0.46, hw - 0.35, 1.6);
  if (lod === 0) couplingRods(k, drivers, r, hw - 0.3, C.chrome);
  // cylinders
  if (lod === 0) for (const s of [1, -1]) k.cylX(L / 2 - 2.3, L / 2 - 1.1, fl - 0.35, s * (hw - 0.35), 0.32, 0.32, 6, C.chassis, null, C.chassis);
  // boiler, smokebox, chimney, dome, safety valves
  k.cylX(xCab, xFront - 1.2, by, 0, br, br, lod === 0 ? 10 : 6, body, null, null);
  k.cylX(xFront - 1.2, xFront, by, 0, br + 0.05, br + 0.05, lod === 0 ? 10 : 6, fixed('#1a1a1a'), null, fixed('#222222'));
  k.cylY(xFront - 0.55, 0, by + br - 0.05, H, 0.22, 0.25, 6, fixed('#1a1a1a'), C.coal);
  k.cylY((xCab + xFront) / 2, 0, by + br - 0.05, by + br + 0.45, 0.35, 0.28, 6, lod === 0 ? band : body, lod === 0 ? band : body);
  if (lod === 0) k.cylY(xCab + 0.6, 0, by + br - 0.05, by + br + 0.3, 0.14, 0.12, 6, fixed('#c9a33a'), fixed('#c9a33a'));
  // side tanks and bunker (tank engines)
  if (tank) {
    k.box(xCab + 0.1, xFront - 1.6, fl, by + br * 0.5, -hw + 0.05, -br + 0.05, body);
    k.box(xCab + 0.1, xFront - 1.6, fl, by + br * 0.5, br - 0.05, hw - 0.05, body);
    k.box(-L / 2 + 0.3, xCab - 1.9, fl, H - 0.9, -hw + 0.1, hw - 0.1, body, { py: C.coal });
    if (lod === 0) k.sideRect(xCab + 0.3, xFront - 1.8, fl + 0.25, by + br * 0.5 - 0.2, hw - 0.05, ends, 0, 0.01);
  }
  // cab
  const cx0 = tank ? xCab - 1.9 : -L / 2 + 0.2;
  k.box(cx0, xCab + 0.05, fl, H - 0.3, -hw + 0.05, hw - 0.05, body, { py: null });
  k.box(cx0 - 0.1, xCab + 0.2, H - 0.3, H - 0.18, -hw, hw, roofSt);
  k.sideRect(cx0 + 0.3, xCab - 0.3, H - 1.3, H - 0.55, hw - 0.05, C.glassDark);
  if (lod === 0) for (const s of [1, -1]) k.end(xCab + 0.05, 1, s > 0 ? br + 0.05 : -hw + 0.3, s > 0 ? hw - 0.3 : -br - 0.05, H - 1.0, H - 0.6, C.glass);
  // buffer beams (red), buffers and lamps
  buffers(k, L / 2 - 0.2, 1, hw, 1.0, fixed('#a02a1e'));
  buffers(k, -L / 2 + 0.2, -1, hw, 1.0, fixed('#a02a1e'));
  lamps(k, L / 2 - 0.2, 1, hw * 0.7, 1.35);
}

function tender(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod;
  const L = d.length, hw = d.width / 2, H = d.height, r = d.wheelR;
  k.box(-L / 2 + 0.2, L / 2 - 0.2, 0.5, 1.1, -0.6, 0.6, C.chassis, { px: null, nx: null });
  k.box(-L / 2 + 0.2, L / 2 - 0.3, 1.1, H, -hw + 0.05, hw - 0.05, body, { py: C.coal });
  if (lod === 0) k.sideRect(-L / 2 + 0.4, L / 2 - 0.5, 1.4, H - 0.4, hw - 0.05, ends, 0, 0.01);
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.3, 0.14, 'rail') : axleBlock(k, x, r, hw - 0.3, 1.8);
  buffers(k, -L / 2 + 0.2, -1, hw, 1.0, fixed('#a02a1e'));
  lamps(k, -L / 2 + 0.2, -1, hw * 0.7, 1.35);
}

// A 1950s–70s diesel shunter: a long bonnet with a cab at one end, six coupled wheels and a rod.
function shunter(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod;
  const L = d.length, hw = d.width / 2, H = d.height, r = d.wheelR;
  const fl = 1.15, xCab = -L / 2 + 2.6;
  k.box(-L / 2 + 0.2, L / 2 - 0.2, 0.5, fl, -hw + 0.05, hw - 0.05, fixed('#1a1a1a'));
  k.box(xCab, L / 2 - 0.4, fl, H - 0.8, -hw * 0.62, hw * 0.62, body, { py: roofSt });
  if (lod === 0) for (const s of [1, -1] as const) for (let i = 0; i < 3; i++) k.sideRect(xCab + 0.6 + i * 1.6, xCab + 1.8 + i * 1.6, fl + 0.4, H - 1.2, hw * 0.62, C.grille, s);
  k.end(L / 2 - 0.4, 1, -0.5, 0.5, fl + 0.3, H - 1.1, C.grille);
  k.box(-L / 2 + 0.3, xCab, fl, H - 0.1, -hw + 0.1, hw - 0.1, body, { py: roofSt });
  k.sideRect(-L / 2 + 0.6, xCab - 0.4, H - 1.3, H - 0.5, hw - 0.1, C.glass);
  k.end(xCab, 1, -hw + 0.3, -hw * 0.62 - 0.05, H - 1.3, H - 0.5, C.glass);
  k.end(xCab, 1, hw * 0.62 + 0.05, hw - 0.3, H - 1.3, H - 0.5, C.glass);
  k.end(-L / 2 + 0.3, -1, -hw + 0.4, hw - 0.4, H - 1.3, H - 0.5, C.glass);
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.25, 0.14, 'rail') : axleBlock(k, x, r, hw - 0.25, 1.8);
  if (lod === 0) couplingRods(k, d.axles, r, hw - 0.25, fixed('#8a8f94'));
  buffers(k, L / 2 - 0.2, 1, hw, 1.0, ends);
  buffers(k, -L / 2 + 0.2, -1, hw, 1.0, ends);
  lamps(k, L / 2 - 0.2, 1, hw * 0.8, 1.2);
  lamps(k, -L / 2 + 0.2, -1, hw * 0.8, 1.2);
  if (lod === 0) k.cylY(xCab + 0.8, 0, H - 0.8, H - 0.45, 0.1, 0.1, 6, C.coal, C.coal);
}

// An open-balcony double-deck tramcar on a four-wheel truck, with a trolley pole.
function heritageTram(k: Kit, m: Model) {
  const d = m.dims, lod = k.lod;
  const L = d.length, hw = d.width / 2, H = d.height, r = d.wheelR;
  const fl = 0.75, deck = 3.05;
  const sal = L / 2 - 1.6;
  k.box(-L / 2 + 0.3, L / 2 - 0.3, fl - 0.15, fl, -hw + 0.1, hw - 0.1, fixed('#2b2c2e'));
  // lower saloon
  k.box(-sal, sal, fl, deck - 0.1, -hw, hw, body, { py: null });
  windows(k, -sal + 0.2, sal - 0.2, fl + 1.0, deck - 0.45, hw, 5, 0.15);
  k.sideRect(-sal, sal, fl + 0.15, fl + 0.85, hw, band, 0, 0.01);
  // platforms and dashes at each end
  for (const s of [1, -1] as const) {
    const xe = s * (L / 2 - 0.1);
    k.box(Math.min(xe, s * sal), Math.max(xe, s * sal), fl, fl + 1.1, -hw + 0.05, hw - 0.05, body, { py: fixed('#3a3530') });
    k.end(xe, s, -0.3, 0.3, fl + 0.6, fl + 0.8, s > 0 ? C.head : C.brake);
  }
  // upper deck floor, the enclosed top and open balconies with railings
  k.box(-L / 2 + 0.1, L / 2 - 0.1, deck - 0.1, deck + 0.05, -hw, hw, band);
  k.box(-sal + 0.3, sal - 0.3, deck + 0.05, H - 0.1, -hw + 0.05, hw - 0.05, body, { py: roofSt });
  windows(k, -sal + 0.5, sal - 0.5, deck + 0.7, H - 0.4, hw - 0.05, 5, 0.15);
  if (lod === 0) for (const s of [1, -1] as const) {
    const xa = s > 0 ? sal - 0.3 : -L / 2 + 0.15, xb = s > 0 ? L / 2 - 0.15 : -sal + 0.3;
    k.box(xa, xb, deck + 0.05, deck + 1.0, -hw + 0.02, -hw + 0.06, C.chrome);
    k.box(xa, xb, deck + 0.05, deck + 1.0, hw - 0.06, hw - 0.02, C.chrome);
    k.box(s > 0 ? xb - 0.04 : xa, s > 0 ? xb : xa + 0.04, deck + 0.05, deck + 1.0, -hw, hw, C.chrome);
  }
  // trolley pole, trailing back from a mast on the roof
  k.box(-0.2, 0.2, H - 0.1, H + 0.15, -0.2, 0.2, C.trim);
  if (lod === 0) k.prism([[0, H + 0.1], [0.08, H + 0.1], [-3.8, H + 1.9], [-3.9, H + 1.88]], 0.03, C.trim, () => C.trim);
  // truck and lifeguards
  k.box(-1.9, 1.9, 0.12, fl - 0.15, -hw + 0.2, hw - 0.2, C.bogie, { py: null });
  for (const x of d.axles) lod === 0 ? wheels(k, x, r, hw - 0.25, 0.1, 'plain') : axleBlock(k, x, r, hw - 0.25, 1.8);
}

// Wagons: hoppers, vans, tanks, container flats, car carriers, timber flats and brake vans.
function wagon(k: Kit, m: Model) {
  const g = m.design, d = m.dims, lod = k.lod, style = m.style;
  const L = d.length, hw = d.width / 2, H = d.height, r = d.wheelR;
  const four = flag(g, 'four') || style === 'brake-van';
  const fl = four ? 1.0 : 1.2;
  // underframe and running gear
  k.box(-L / 2 + 0.1, L / 2 - 0.1, fl - 0.3, fl, -hw + 0.1, hw - 0.1, C.chassis, style === 'wagon-flat' || style === 'wagon-timber' ? {} : { py: null });
  if (four) {
    for (const x of d.axles) {
      lod === 0 ? wheels(k, x, r, hw - 0.3, 0.14, 'plain') : axleBlock(k, x, r, hw - 0.3, 1.8);
      if (lod === 0) for (const s of [1, -1]) k.box(x - 0.45, x + 0.45, r, fl - 0.3, s * (hw - 0.35) - 0.04, s * (hw - 0.35) + 0.04, C.chassis);
    }
    buffers(k, L / 2 - 0.1, 1, hw, 1.0);
    buffers(k, -L / 2 + 0.1, -1, hw, 1.0);
  } else {
    for (const x of d.axles) bogie(k, x, hw, r, 2, 1.9);
    coupler(k, L / 2 - 0.1, 1, 0.95); coupler(k, -L / 2 + 0.1, -1, 0.95);
    if (style === 'wagon-tank' || style === 'wagon-box') { buffers(k, L / 2 - 0.1, 1, hw, 1.0); buffers(k, -L / 2 + 0.1, -1, hw, 1.0); }
  }
  const x0 = -L / 2 + 0.2, x1 = L / 2 - 0.2;
  switch (style) {
    case 'wagon-hopper': {
      if (four) k.box(x0, x1, fl, H, -hw + 0.05, hw - 0.05, body, { py: C.coal });
      else {
        // sloping-ended bogie hopper, loaded
        const P: P2[] = [[x0 + 2.2, fl], [x1 - 2.2, fl], [x1, H - 1.2], [x1, H], [x0, H], [x0, H - 1.2]];
        k.prism(P, hw - 0.05, body, (i) => (i === 3 ? C.coal : body));
        if (lod === 0) for (let x = x0 + 1.8; x < x1 - 1.5; x += 2.1) k.sideRect(x, x + 0.1, H - 1.3, H - 0.05, hw - 0.05, band, 0, 0.012);
      }
      break;
    }
    case 'wagon-box': case 'brake-van': {
      const cs: P2[] = lod === 0 ? [[-hw + 0.05, 0], [hw - 0.05, 0], [hw - 0.05, H - fl - 0.35], [hw * 0.5, H - fl], [-hw * 0.5, H - fl], [-hw + 0.05, H - fl - 0.35]] : [[-hw + 0.05, 0], [hw - 0.05, 0], [hw - 0.05, H - fl], [-hw + 0.05, H - fl]];
      const van = style === 'brake-van';
      const bx0 = van ? x0 + 1.1 : x0, bx1 = van ? x1 - 1.1 : x1;
      k.loftX(cs, [{ x: bx0, sy: 1, sz: 1, dy: fl }, { x: bx1, sy: 1, sz: 1, dy: fl }], (j) => (j === 0 ? null : (lod === 0 ? j >= 3 && j <= 4 : j === 2) ? C.roofGrey : body), body, body);
      if (van) {
        k.box(x0, x1, fl, fl + 1.0, -hw + 0.02, -hw + 0.08, body);
        k.box(x0, x1, fl, fl + 1.0, hw - 0.08, hw - 0.02, body);
        if (lod === 0) k.cylY(0, 0, H, H + 0.4, 0.07, 0.07, 6, C.coal, C.coal);
        k.end(bx1, 1, -0.3, 0.3, H - 1.4, H - 0.9, C.glass);
        k.end(bx0, -1, hw - 0.5, hw - 0.3, fl + 0.4, fl + 0.6, C.brake);
      } else if (lod === 0) k.sideRect(-0.9, 0.9, fl + 0.1, H - 0.5, hw - 0.05, band, 0, 0.012);
      break;
    }
    case 'wagon-tank': {
      const ry = (H - fl - 0.2) / 2;
      k.cylX(x0 + 0.3, x1 - 0.3, fl + 0.1 + ry, 0, ry, hw - 0.1, lod === 0 ? 10 : 6, body, body, body);
      if (lod === 0) { k.box(-0.5, 0.5, H - 0.1, H + 0.1, -0.5, 0.5, C.trim); k.cylX(x0 + 0.4, x1 - 0.4, fl + 0.1 + ry, 0, ry * 0.28, hw - 0.08, 8, band, null, null); }
      break;
    }
    case 'wagon-flat': {
      const boxes = num(g, 'boxes', 2);
      const len = (x1 - x0 - 0.3) / boxes;
      const r0 = rng(m.seed);
      for (let i = 0; i < boxes; i++) {
        const a = x0 + 0.15 + i * len + 0.05, b = a + len - 0.1;
        const col = i === 0 ? body : fixed(pick(r0, BOX_COLOURS));
        k.box(a, b, fl, fl + 2.6, -1.22, 1.22, col, { py: i === 0 ? roofSt : col });
        if (lod === 0) for (let x = a + 0.3; x < b - 0.2; x += 0.6) k.sideRect(x - 0.03, x + 0.03, fl + 0.08, fl + 2.52, 1.22, C.trim, 0, 0.008);
      }
      break;
    }
    case 'wagon-car': {
      const cs = section(hw, H - fl, lod);
      k.loftX(cs, [{ x: x0, sy: 1, sz: 1, dy: fl }, { x: x1, sy: 1, sz: 1, dy: fl }], (j) => (j === 0 ? null : isRoof(j, cs.length) ? roofSt : body), band, band);
      if (lod === 0) for (let i = 0; i < 2; i++) k.sideRect(x0 + 0.5, x1 - 0.5, fl + 0.5 + i * 1.3, fl + 0.75 + i * 1.3, hw, C.grille, 0, 0.012);
      break;
    }
    case 'wagon-timber': {
      if (lod === 0) for (let x = x0 + 0.3; x <= x1 - 0.2; x += (x1 - x0 - 0.5) / 4) for (const s of [1, -1]) k.box(x, x + 0.14, fl, fl + 2.1, s * (hw - 0.1) - 0.06, s * (hw - 0.1) + 0.06, band);
      const rows = lod === 0 ? [[-0.8, 0.4], [0, 0.4], [0.8, 0.4], [-0.4, 1.15], [0.4, 1.15], [0, 1.85]] : [[0, 0.9]];
      for (const [z, y] of rows) lod === 0 ? k.cylX(x0 + 0.1, x1 - 0.1, fl + y, z, 0.38, 0.38, 6, C.logs, C.logEnd, C.logEnd) : k.cylX(x0 + 0.1, x1 - 0.1, fl + y, 0, 0.9, hw - 0.15, 4, C.logs, C.logEnd, C.logEnd);
      break;
    }
  }
}
