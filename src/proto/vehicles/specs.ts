// Specs: real dimensions, design knobs and economy stats for a body style in a given year.
// The numbers follow typical UK vehicles of each class and era (a 1960s small saloon is about
// 3.8 m long and 1.5 m wide; a 2010s family hatchback 4.3 m by 1.8 m; a double-decker 10.5 m
// by 2.55 m by 4.4 m), with a little seeded variation so no two models are quite the same.
import type { BodyStyle, Design, Dims, Hitch, Stats } from './types';
import type { Brand, SizeClass } from './brands';
import { eraStyle } from './era';
import { byYear, clamp, pick, range, type Rand } from './util';

export interface Spec { dims: Dims; design: Design; stats: Stats; hitch?: Hitch }

const r2 = (v: number) => Math.round(v * 100) / 100;
function dims(length: number, width: number, height: number, axles: number[], wheelR: number, clearance: number): Dims {
  const a = axles.map(r2);
  return { length: r2(length), width: r2(width), height: r2(height), axles: a, wheelbase: r2(a[0] - a[a.length - 1]), wheelR: r2(wheelR), clearance: r2(clearance) };
}
// axles for a two-axle road vehicle: front overhang takes `front` of the overhangs
const twoAxle = (L: number, wb: number, front = 0.55) => { const oh = L - wb; const xf = L / 2 - oh * front; return [xf, xf - wb]; };

// ---------------- cars ----------------
const SIZE_L: Record<SizeClass, number> = { tiny: 3.1, small: 3.95, medium: 4.45, large: 4.9, huge: 5.6 };
const SIZE_W: Record<SizeClass, number> = { tiny: -0.16, small: -0.06, medium: 0, large: 0.07, huge: 0.16 };
type CarKey = 'hatchback' | 'saloon' | 'estate' | 'coupe' | 'convertible' | 'suv' | 'pickup' | 'mpv' | 'sports' | 'supercar' | 'taxi' | 'classic';
// per style: length offset, width offset, height, wheelbase share, windscreen base, rake factor,
// roof rear, rear pillar base, nose/bonnet/belt heights as shares of height
const CAR: Record<CarKey, { dl: number; dw: number; h: number; wb: number; ws: number; rake: number; roofR: number; cB: number; nose: number; bonF: number; bon: number; belt: number; tail: number }> = {
  hatchback: { dl: -0.2, dw: 0, h: 1.45, wb: 0.64, ws: 0.3, rake: 1, roofR: 0.87, cB: 0.975, nose: 0.36, bonF: 0.5, bon: 0.58, belt: 0.62, tail: 0.62 },
  saloon: { dl: 0.15, dw: 0, h: 1.43, wb: 0.6, ws: 0.31, rake: 1, roofR: 0.7, cB: 0.82, nose: 0.36, bonF: 0.5, bon: 0.58, belt: 0.62, tail: 0.65 },
  estate: { dl: 0.2, dw: 0, h: 1.48, wb: 0.59, ws: 0.31, rake: 1, roofR: 0.95, cB: 0.985, nose: 0.36, bonF: 0.5, bon: 0.58, belt: 0.61, tail: 0.61 },
  coupe: { dl: 0.05, dw: 0.03, h: 1.33, wb: 0.6, ws: 0.36, rake: 1.25, roofR: 0.67, cB: 0.84, nose: 0.34, bonF: 0.48, bon: 0.56, belt: 0.62, tail: 0.64 },
  convertible: { dl: -0.05, dw: 0.02, h: 1.3, wb: 0.6, ws: 0.37, rake: 1.2, roofR: 0.7, cB: 0.8, nose: 0.34, bonF: 0.48, bon: 0.57, belt: 0.64, tail: 0.66 },
  suv: { dl: 0.05, dw: 0.08, h: 1.72, wb: 0.6, ws: 0.28, rake: 0.8, roofR: 0.93, cB: 0.985, nose: 0.42, bonF: 0.55, bon: 0.61, belt: 0.64, tail: 0.64 },
  pickup: { dl: 0.45, dw: 0.06, h: 1.8, wb: 0.6, ws: 0.27, rake: 0.7, roofR: 0.46, cB: 0.5, nose: 0.42, bonF: 0.56, bon: 0.6, belt: 0.62, tail: 0.62 },
  mpv: { dl: 0.1, dw: 0.04, h: 1.72, wb: 0.62, ws: 0.15, rake: 1.6, roofR: 0.95, cB: 0.99, nose: 0.36, bonF: 0.46, bon: 0.55, belt: 0.58, tail: 0.58 },
  sports: { dl: -0.3, dw: 0.02, h: 1.23, wb: 0.6, ws: 0.42, rake: 1.3, roofR: 0.72, cB: 0.86, nose: 0.34, bonF: 0.46, bon: 0.55, belt: 0.64, tail: 0.66 },
  supercar: { dl: 0, dw: 0.22, h: 1.14, wb: 0.58, ws: 0.27, rake: 1.5, roofR: 0.52, cB: 0.8, nose: 0.3, bonF: 0.36, bon: 0.44, belt: 0.56, tail: 0.6 },
  taxi: { dl: 0.1, dw: -0.02, h: 1.83, wb: 0.63, ws: 0.3, rake: 0.6, roofR: 0.8, cB: 0.85, nose: 0.34, bonF: 0.46, bon: 0.53, belt: 0.55, tail: 0.58 },
  classic: { dl: 0, dw: 0, h: 1.75, wb: 0.66, ws: 0, rake: 0, roofR: 0, cB: 0, nose: 0, bonF: 0, bon: 0.6, belt: 0.63, tail: 0 },
};

export function carSpec(style: BodyStyle, year: number, size: SizeClass, brand: Brand, r: Rand, base?: BodyStyle): Spec {
  const key = (style === 'police' ? base ?? 'saloon' : style) as CarKey;
  const s = CAR[key] ?? CAR.saloon;
  const e = eraStyle(year, r);
  const jit = () => range(r, 0.97, 1.03);
  const sz = key === 'taxi' ? 'medium' : size;
  // cars have grown: a medium car was ~4.1 m in 1960 and ~4.5 m by 2015
  const grow = byYear(year, [[1935, 0.9], [1960, 0.92], [1980, 0.96], [2000, 1], [2020, 1.03]]);
  let L = (SIZE_L[sz] * grow + s.dl) * jit();
  if (key === 'supercar') L = Math.max(L, 4.3);
  const W = (byYear(year, [[1935, 1.56], [1960, 1.6], [1980, 1.66], [2000, 1.75], [2020, 1.84]]) + SIZE_W[sz] + s.dw) * jit();
  let H = s.h * jit();
  const Wc = Math.min(W, 2.1); // the widest supercars stop short of 2.1 m
  if (key === 'hatchback' || key === 'saloon' || key === 'estate') H *= byYear(year, [[1950, 1.06], [1975, 0.96], [2000, 1], [2020, 1.02]]);
  if (key === 'suv' && year < 1985) H *= 1.1; // the tall utility of the early days
  if (key === 'classic') H = (size === 'large' ? 1.8 : 1.68) * jit();
  const wbShare = s.wb * (sz === 'tiny' ? 1.04 : 1);
  const wb = L * wbShare;
  const front = key === 'supercar' ? 0.42 : key === 'taxi' ? 0.5 : 0.56;
  const wr = key === 'classic' ? byYear(year, [[1905, 0.42], [1930, 0.36]]) : e.wheelR * (key === 'suv' ? 1.15 : key === 'pickup' ? 1.2 : key === 'supercar' ? 1.06 : sz === 'tiny' ? 0.82 : 1);
  const clearance = key === 'classic' ? 0.22 : key === 'suv' ? 0.22 : key === 'pickup' ? 0.24 : key === 'supercar' ? 0.1 : key === 'sports' ? 0.12 : 0.15;
  const d = dims(L, Wc, H, twoAxle(L, wb, front), wr, clearance);

  const rakeF = e.rake * s.rake * (key === 'taxi' ? 1 : 1);
  const hH = H;
  const design: Design = {
    ws: s.ws, roofF: s.ws + rakeF + (key === 'pickup' ? 0.02 : 0), roofR: s.roofR, cBase: s.cB,
    noseH: s.nose * hH, bonnetFH: s.bonF * hH, bonnetH: s.bon * hH, beltH: s.belt * hH, tailH: s.tail * hH, tailLow: 0.38 * hH,
    noseR: 0.04 + e.round * 0.16, tailR: 0.03 + e.round * 0.1, tumble: e.tumble + (key === 'supercar' ? 0.08 : 0),
    lamps: e.lamps, bumper: e.bumper, wheel: e.wheel, grille: brand.grille,
    tyreW: key === 'supercar' ? 0.3 : byYear(year, [[1950, 0.16], [1980, 0.19], [2010, 0.23], [2030, 0.25]]),
    doors: key === 'coupe' || key === 'convertible' || key === 'sports' || key === 'supercar' ? 2 : key === 'hatchback' ? (year < 1980 || r() < 0.3 ? 2 : 4) : 4,
    pattern: r() < e.twoTone ? 'flash' : 'none',
    base: style === 'police' ? key : undefined,
  };
  // older cars sit their glass higher on a slab-sided body
  if (year < 1960 && key !== 'classic') { design.beltH = (s.belt + 0.02) * hH; design.noseR = 0.12 + e.round * 0.12; }
  // brand language on top of the era
  const b = brand.id;
  if (b === 'chalcott' && year < 2000) design.lamps = year < 1975 ? 'round' : 'twin-round';
  if (b === 'hallbrook') design.lamps = year < 1976 ? 'round' : year < 1995 ? 'popup' : 'slim';
  if (b === 'vessanti' && year >= 1968 && year < 1993) design.lamps = 'popup';
  if (b === 'hardesty') { design.lamps = year < 1956 ? 'round' : year < 1977 ? 'twin-round' : year < 1996 ? 'rect' : design.lamps; if (year < 1986) design.bumper = 'chrome'; }
  if (b === 'fellgate' && year < 1990) design.lamps = 'round';
  if (b === 'ludgate') { design.lamps = year < 1997 ? 'round' : 'wrap'; design.sign = true; }
  if (b === 'novaform') { design.lamps = 'strip'; design.grille = 'closed'; design.wheel = 'aero'; design.blackPillars = true; }
  if (b === 'norrvik' && year >= 1972 && year < 1996) { design.lamps = 'rect'; design.bumper = 'rubber'; }
  if (year >= 2020 && r() < 0.25) { design.grille = 'closed'; design.lamps = 'strip'; }
  if (key === 'supercar' || key === 'sports') design.noseH = s.nose * hH, design.bumper = year < 1970 ? 'chrome' : 'body';
  // options
  if (year >= 2012 && r() < 0.4) design.blackPillars = true;
  if ((key === 'estate' || key === 'suv') && year >= 1985 && r() < 0.6) design.rails = true;
  if ((key === 'estate' || key === 'saloon') && year >= 1950 && year < 1990 && r() < 0.12) { design.rack = true; design.load = pick(r, ['#6b5a48', '#2b4a73', '#8a6a45', '#3a3a3a']); }
  if ((key === 'sports' || key === 'supercar') && year >= 1975 && r() < 0.5) design.spoiler = true;
  if (key === 'hatchback' && year >= 1982 && r() < 0.15) design.spoiler = true;
  if (b === 'hardesty' && key === 'coupe') design.scoop = true;
  if (year >= 1980 && r() < 0.15 && key !== 'convertible') design.sunroof = true;
  if (r() < e.cladding || (key === 'suv' && year >= 1990)) design.cladding = true;
  if (year >= 1970 && year < 1996) design.trimMirrors = true;
  if (key === 'convertible') design.top = r() < 0.6 ? 'down' : 'up';
  if (key === 'pickup' && r() < 0.4) design.bedLoad = true;
  if (key === 'classic') {
    design.bonnetH = 0.6 * H; design.beltH = 0.63 * H;
    design.bonnetLen = (size === 'large' ? 1.35 : 1.05) * jit();
    design.top = r() < 0.45 ? 'open' : 'closed';
  }
  if (style === 'police') {
    design.lightbar = year >= 1965;
    if (year < 1965) design.amber = false;
    design.pattern = year >= 1995 ? 'battenberg' : year >= 1965 ? 'stripe' : 'none';
  }
  if (key === 'taxi') design.pattern = 'none';

  const seats = key === 'mpv' ? 7 : key === 'sports' || key === 'supercar' || key === 'pickup' ? 2 : key === 'taxi' ? 5 : 5;
  const top = byYear(year, [[1905, 50], [1930, 100], [1960, 135], [1990, 185], [2020, 200]]) + (key === 'sports' ? 40 : key === 'supercar' ? 120 : key === 'coupe' ? 30 : 0);
  const price = (sz === 'tiny' ? 9000 : sz === 'small' ? 14000 : sz === 'medium' ? 20000 : sz === 'large' ? 32000 : 38000) * (b === 'chalcott' ? 3 : b === 'vessanti' ? 8 : b === 'varnholt' ? 1.6 : b === 'dravnik' ? 0.6 : 1) * (key === 'supercar' ? 3 : 1);
  const stats: Stats = { capacity: seats, unit: 'pax', speedKmh: Math.round(top), cost: Math.round(price / 100) * 100, running: Math.round(price * 0.08 / 10) * 10, power: b === 'novaform' || (year >= 2020 && design.grille === 'closed') ? 'electric' : 'petrol' };
  return { dims: d, design, stats };
}

// ---------------- vans ----------------
export function vanSpec(style: BodyStyle, year: number, r: Rand): Spec {
  const e = eraStyle(year, r);
  const jit = () => range(r, 0.97, 1.03);
  let L = 5.5, W = 2.0, H = 2.45, wb = 3.5, wr = 0.34;
  const design: Design = { lamps: e.lamps, bumper: e.bumper, wheel: year < 1990 ? 'steel' : 'hubcap', grille: 'bar' };
  // the cab: bonnet length and height, windscreen rake
  design.bonnet = byYear(year, [[1935, 1.4], [1960, 0.9], [1975, 0.5], [1990, 0.75], [2010, 0.9]]);
  design.rake = byYear(year, [[1935, 0.1], [1965, 0.25], [1990, 0.7], [2010, 0.95]]);
  if (style === 'van-small') { L = byYear(year, [[1955, 3.9], [1990, 4.1], [2015, 4.4]]); W = byYear(year, [[1955, 1.55], [2015, 1.82]]); H = 1.8; wb = L * 0.62; wr = 0.3; design.bonnet = 0.9; design.rake = 0.8; design.cabLen = 1.9; }
  if (style === 'van-panel') { L = byYear(year, [[1935, 4.6], [1965, 4.5], [1990, 5.2], [2015, 5.6]]); W = byYear(year, [[1935, 1.75], [1990, 1.95], [2015, 2.05]]); H = r() < 0.4 && year > 1985 ? 2.7 : byYear(year, [[1935, 2.1], [1990, 2.3], [2015, 2.45]]); wb = L * 0.62; design.cabLen = 2.2; }
  if (style === 'van-luton') { L = 6.8; W = 2.25; H = 3.3; wb = 3.95; design.cabLen = 2.2; design.boxW = 2.3; }
  if (style === 'minibus') { L = byYear(year, [[1960, 5.2], [1990, 6.2], [2015, 6.9]]); W = 2.02; H = 2.65; wb = L * 0.6; design.cabLen = 2.2; design.glazed = true; }
  if (style === 'ice-cream') { L = byYear(year, [[1955, 5.0], [2000, 6.0]]); W = 2.05; H = 2.85; wb = 3.4; design.cabLen = 2.1; design.hatch = true; }
  if (style === 'ambulance') { L = byYear(year, [[1975, 6.0], [2000, 6.8], [2015, 7.0]]); W = 2.28; H = 2.9; wb = 3.9; design.cabLen = 2.2; design.boxW = 2.3; design.pattern = year >= 2005 ? 'battenberg' : 'stripe'; }
  L *= jit(); W = Math.min(2.55, W * jit()); H *= jit();
  const d = dims(L, W, H, twoAxle(L, wb, 0.45), wr, 0.18);
  const seats = style === 'minibus' ? 16 : style === 'ambulance' ? 3 : 3;
  const stats: Stats = style === 'minibus'
    ? { capacity: seats, unit: 'pax', speedKmh: byYear(year, [[1960, 100], [2000, 130]]), cost: 42000, running: 6000, power: 'diesel' }
    : { capacity: style === 'van-small' ? 0.7 : style === 'van-luton' ? 1.2 : 1.1, unit: 't', speedKmh: byYear(year, [[1935, 70], [1960, 100], [2000, 140]]), cost: style === 'van-small' ? 16000 : style === 'van-luton' ? 32000 : 26000, running: 4000, power: 'diesel' };
  return { dims: d, design, stats };
}

// ---------------- lorries and trailers ----------------
export function cabStyle(year: number) { return year < 1955 ? 'bonneted' : year < 1985 ? 'flat' : year < 2005 ? 'sleeper' : 'high'; }

export function lorrySpec(style: BodyStyle, year: number, r: Rand, brandId = ''): Spec {
  const cab = cabStyle(year);
  const design: Design = { cab, grille: 'bar', lamps: year < 1970 ? 'round' : 'rect', brand: brandId };
  const H = cab === 'high' ? 3.9 : cab === 'sleeper' ? 3.6 : cab === 'flat' ? 3.0 : 2.7;
  if (style === 'tractor') {
    const L = cab === 'bonneted' ? 6.4 : 5.95 + range(r, 0, 0.3);
    const axles = r() < 0.3 && year > 1975 ? 3 : 2;
    const xf = L / 2 - 1.35, wb = axles === 3 ? 3.8 : 3.6;
    const ax = axles === 3 ? [xf, xf - wb + 1.36, xf - wb] : [xf, xf - wb];
    const d = dims(L, 2.5, H, ax, 0.52, 0.3);
    // the fifth wheel sits a little ahead of the rear axle
    const fifth = ax[ax.length - 1] + (axles === 3 ? 0.9 : 0.45);
    design.fifth = fifth;
    return { dims: d, design, hitch: { rear: r2(fifth) }, stats: { capacity: 0, unit: 't', speedKmh: byYear(year, [[1955, 70], [1985, 90], [2000, 90]]), cost: 95000, running: 22000, power: 'diesel' } };
  }
  if (style.startsWith('trailer-')) return trailerSpec(style, year, r);
  // rigid lorries: 7.5 t to 32 t, two to four axles
  const big = style === 'mixer' || style === 'rigid-tipper' || style === 'refuse' ? r() < 0.7 : r() < 0.35;
  const axles = style === 'mixer' || (style === 'rigid-tipper' && big) ? 4 : big ? 3 : 2;
  const L = axles === 4 ? 10.0 : axles === 3 ? 10.3 : range(r, 7.2, 8.6);
  const bodyH = style === 'rigid-box' ? (axles === 2 ? 3.4 : 3.9) : style === 'rigid-curtain' ? 3.9 : style === 'rigid-tanker' ? 3.3 : style === 'refuse' ? 3.4 : style === 'mixer' ? 3.8 : style === 'gritter' ? 3.3 : style === 'recovery' ? 3.1 : 3.1;
  const xf = L / 2 - 1.3;
  const ax = axles === 4 ? [xf, xf - 1.85, xf - 5.4, xf - 6.75] : axles === 3 ? [xf, xf - 4.95, xf - 6.3] : [xf, xf - (L > 8 ? 4.9 : 4.2)];
  const d = dims(L, 2.5, Math.max(H, bodyH), ax, 0.5, 0.28);
  design.bodyH = bodyH;
  design.crane = style === 'rigid-flatbed' && r() < 0.5;
  design.load = style === 'rigid-flatbed' ? pick(r, ['pallets', 'bricks', 'steel', 'timber']) : undefined;
  const cap = axles === 4 ? 20 : axles === 3 ? 15 : 5;
  return { dims: d, design, stats: { capacity: cap, unit: 't', speedKmh: byYear(year, [[1930, 50], [1960, 70], [1990, 90]]), cost: 60000 + axles * 15000, running: 12000 + axles * 3000, power: 'diesel' } };
}

function trailerSpec(style: BodyStyle, year: number, r: Rand): Spec {
  const len: Partial<Record<BodyStyle, number>> = {
    'trailer-box': year < 1980 ? 12.2 : 13.6, 'trailer-curtain': 13.6, 'trailer-tanker': 12.4, 'trailer-tipper': 10.8, 'trailer-flatbed': year < 1980 ? 12.2 : 13.6,
    'trailer-container': 13.6, 'trailer-car': 14.8, 'trailer-logging': 13.0, 'trailer-livestock': 13.6,
  };
  const L = len[style] ?? 13.6;
  const height: Partial<Record<BodyStyle, number>> = {
    'trailer-box': year < 1980 ? 3.9 : r() < 0.25 ? 4.8 : 4.0, 'trailer-curtain': 4.0, 'trailer-tanker': 3.7, 'trailer-tipper': 3.6, 'trailer-flatbed': 2.6,
    'trailer-container': 4.0, 'trailer-car': 4.3, 'trailer-logging': 3.6, 'trailer-livestock': 4.0,
  };
  const axles = year < 1975 ? 2 : 3;
  // tri-axle bogie near the back, 1.31 m between axles; kingpin 1.6 m behind the front
  const xLast = -L / 2 + (style === 'trailer-car' ? 1.2 : 1.35);
  const ax = Array.from({ length: axles }, (_, i) => xLast + i * 1.31).reverse();
  const kingpin = L / 2 - 1.6;
  const d = dims(L, 2.55, height[style] ?? 4, ax, 0.42, 0.9);
  const design: Design = { kingpin, load: style === 'trailer-flatbed' ? pick(r, ['pallets', 'steel', 'timber', 'bricks']) : undefined, deckH: 1.25 };
  const cap = style === 'trailer-car' ? 8 : style === 'trailer-tipper' ? 29 : 26;
  return { dims: d, design, hitch: { front: r2(kingpin) }, stats: { capacity: cap, unit: style === 'trailer-car' ? 'pax' : 't', speedKmh: 90, cost: 30000, running: 3000, power: 'none' } };
}

// ---------------- buses and coaches ----------------
export function busSpec(style: BodyStyle, year: number, r: Rand): Spec {
  const design: Design = { lamps: year < 1970 ? 'round' : 'rect', front: year < 1990 ? 'flat' : year < 2008 ? 'raked' : 'curved', lowFloor: year >= 1994 };
  const jit = () => range(r, 0.98, 1.02);
  if (style === 'bus-heritage') {
    const L = 8.2 * jit(), W = 2.3, H = 3.0;
    const d = dims(L, W, H, twoAxle(L, 4.9, 0.6), 0.5, 0.35);
    design.bonnet = 1.6; design.roofRail = true;
    return { dims: d, design, stats: { capacity: 32, unit: 'pax', speedKmh: 50, cost: 40000, running: 7000, power: 'diesel' } };
  }
  if (style === 'bus-halfcab') {
    const L = byYear(year, [[1945, 8.2], [1960, 8.4], [1966, 9.1]]) * jit(), W = byYear(year, [[1945, 2.3], [1960, 2.44]]), H = 4.38;
    const d = dims(L, W, H, twoAxle(L, byYear(year, [[1945, 4.9], [1960, 5.2]]), 0.3), 0.5, 0.3);
    return { dims: d, design, stats: { capacity: 64, unit: 'pax', speedKmh: 65, cost: 70000, running: 11000, power: 'diesel' } };
  }
  if (style === 'bus-double') {
    const L = (year < 1985 ? 9.5 : year < 2005 ? 10.2 : 10.8) * jit(), W = year < 1970 ? 2.44 : 2.55, H = year < 1990 ? 4.38 : 4.3;
    const ax = r() < 0.2 && year > 1995 ? 3 : 2;
    const xf = L / 2 - 2.3;
    const axes = ax === 3 ? [xf, xf - 5.5, xf - 6.8] : [xf, xf - byYear(year, [[1968, 5.0], [2000, 5.9]])];
    const d = dims(L, W, H, axes, 0.5, 0.25);
    return { dims: d, design, stats: { capacity: ax === 3 ? 100 : 85, unit: 'pax', speedKmh: 80, cost: 290000, running: 30000, power: year >= 2015 && r() < 0.5 ? 'hybrid' : 'diesel' } };
  }
  if (style === 'bus-single') {
    const L = (r() < 0.3 ? byYear(year, [[1965, 9.0], [2000, 8.9]]) : byYear(year, [[1965, 10.9], [1990, 11.3], [2010, 12.0]])) * jit(), W = 2.5, H = year >= 1994 ? 3.1 : 3.0;
    const xf = L / 2 - 2.5;
    const d = dims(L, W, H, [xf, xf - (L - 5.5)], 0.5, 0.22);
    return { dims: d, design, stats: { capacity: L > 11 ? 75 : 55, unit: 'pax', speedKmh: 80, cost: 210000, running: 24000, power: year >= 2018 && r() < 0.4 ? 'electric' : 'diesel' } };
  }
  if (style === 'bus-bendy' || style === 'bus-bendy-rear') {
    // an 18 m artic in two models: the front half and the trailer, joined at the turntable
    if (style === 'bus-bendy') {
      const L = 11.9, xf = L / 2 - 2.6;
      const d = dims(L, 2.55, 3.05, [xf, xf - 5.9], 0.5, 0.22);
      return { dims: d, design, hitch: { rear: r2(-L / 2 + 0.3) }, stats: { capacity: 140, unit: 'pax', speedKmh: 80, cost: 350000, running: 36000, power: 'diesel' } };
    }
    const L = 6.6;
    const d = dims(L, 2.55, 3.05, [-L / 2 + 1.7], 0.5, 0.22);
    return { dims: d, design, hitch: { front: r2(L / 2 + 0.3) }, stats: { capacity: 0, unit: 'pax', speedKmh: 80, cost: 0, running: 0, power: 'none' } };
  }
  // coaches: tall, raked, big luggage bays
  const L = (year < 1970 ? 10.0 : year < 1995 ? 12.0 : r() < 0.25 ? 13.8 : 12.8) * jit(), W = year < 1970 ? 2.44 : 2.55, H = year < 1980 ? 3.2 : 3.65;
  const tri = L > 13;
  const xf = L / 2 - 2.6;
  const d = dims(L, W, H, tri ? [xf, xf - 6.3, xf - 7.65] : [xf, xf - 6.2], 0.52, 0.3);
  design.front = year < 1975 ? 'flat' : 'raked';
  return { dims: d, design, stats: { capacity: tri ? 63 : 53, unit: 'pax', speedKmh: 100, cost: 320000, running: 38000, power: 'diesel' } };
}

// ---------------- rail ----------------
// UK loading gauge: about 2.8 m wide and 3.8–3.9 m tall above the rail.
export function railSpec(style: BodyStyle, year: number, r: Rand): Spec {
  const design: Design = { year };
  const jit = () => range(r, 0.985, 1.015);
  const W = 2.75, H = 3.85;
  const bogies = (_L: number, centres: number) => [centres / 2, -centres / 2];
  switch (style) {
    case 'steam-tank': {
      const L = range(r, 9.2, 11.6), wr = 0.7;
      const d = dims(L, 2.6, 3.9, [1.6, 0, -1.6], wr, 0.1);
      design.drivers = 3; design.tanks = true;
      return { dims: d, design, stats: { capacity: 350, unit: 't', speedKmh: 70, cost: 180000, running: 30000, power: 'steam' } };
    }
    case 'steam-tender': {
      const L = range(r, 13, 14.5), wr = byYear(year, [[1905, 0.95], [1950, 0.95]]);
      const d = dims(L, 2.7, 3.95, [3.2, 1.3, -0.95, -3.2], wr, 0.1);
      design.drivers = 3;
      return { dims: d, design, stats: { capacity: 500, unit: 't', speedKmh: 145, cost: 320000, running: 52000, power: 'steam' } };
    }
    case 'tender': {
      const L = 8.2;
      const d = dims(L, 2.7, 3.2, [2.2, 0, -2.2], 0.55, 0.1);
      return { dims: d, design, stats: { capacity: 0, unit: 't', speedKmh: 145, cost: 0, running: 0, power: 'none' } };
    }
    case 'shunter': {
      const L = range(r, 8.8, 9.8);
      const d = dims(L, 2.6, 3.7, [1.9, 0, -1.9], 0.63, 0.15);
      return { dims: d, design, stats: { capacity: 600, unit: 't', speedKmh: 30, cost: 150000, running: 18000, power: 'diesel' } };
    }
    case 'diesel-loco': case 'electric-loco': {
      const L = byYear(year, [[1958, 18.5], [1970, 19.4], [1995, 21.0]]) * jit();
      const d = dims(L, W, 3.9, bogies(L, L * 0.62), 0.55, 0.15);
      design.nose = year < 1968 && r() < 0.5 ? 'short' : year < 1995 ? 'flat' : 'angled';
      const elec = style === 'electric-loco';
      return { dims: d, design, stats: { capacity: elec ? 1500 : 1800, unit: 't', speedKmh: elec ? byYear(year, [[1960, 160], [1990, 200]]) : byYear(year, [[1958, 120], [1990, 150]]), cost: elec ? 2600000 : 2200000, running: 180000, power: elec ? 'electric' : 'diesel' } };
    }
    case 'dmu-car': case 'emu-car': {
      const L = (year < 1980 ? 20 : year < 2010 ? 23 : 24) * jit();
      const d = dims(L, W, H, bogies(L, L * 0.7), 0.42, 0.25);
      design.cab = true; design.nose = year < 1975 ? 'flat' : year < 2005 ? 'raked' : 'curved';
      design.slam = year < 1985;
      design.doors = year < 1985 ? 0 : 2;
      design.panto = style === 'emu-car' && r() < 0.6;
      return { dims: d, design, stats: { capacity: year < 1985 ? 75 : 70, unit: 'pax', speedKmh: byYear(year, [[1955, 110], [1990, 145], [2015, 160]]), cost: 1400000, running: 90000, power: style === 'emu-car' ? 'electric' : 'diesel' } };
    }
    case 'hs-power': {
      const high = year >= 2008;
      const L = high ? 25.5 : 17.8;
      const d = dims(L, high ? 2.9 : 2.74, high ? 3.9 : 3.85, bogies(L, L * (high ? 0.68 : 0.6)), 0.52, 0.2);
      design.noseLen = high ? 8 : 4.6; design.panto = high;
      return { dims: d, design, stats: { capacity: high ? 40 : 0, unit: 'pax', speedKmh: high ? 320 : 200, cost: high ? 6000000 : 3000000, running: 300000, power: high ? 'electric' : 'diesel' } };
    }
    case 'hs-coach': case 'coach-stock': {
      const L = style === 'hs-coach' ? (year >= 2008 ? 25 : 23) : byYear(year, [[1900, 15], [1930, 18.3], [1951, 19.7], [1972, 23]]) * jit();
      const d = dims(L, W, H, style === 'coach-stock' && year < 1910 ? [L * 0.3, -L * 0.3] : bogies(L, L * 0.7), 0.46, 0.25);
      design.slam = year < 1975; design.panelled = year < 1950;
      return { dims: d, design, stats: { capacity: year < 1950 ? 56 : 64, unit: 'pax', speedKmh: byYear(year, [[1900, 110], [1975, 200]]), cost: 900000, running: 30000, power: 'none' } };
    }
    case 'metro-car': {
      // a sub-surface metro car: shorter and lower than main-line stock, third-rail fed
      const L = byYear(year, [[1960, 16.0], [2000, 17.2]]) * jit();
      const d = dims(L, 2.85, 3.65, bogies(L, L * 0.62), 0.4, 0.2);
      design.cab = true; design.nose = year < 1990 ? 'flat' : 'raked';
      design.slam = false; design.panto = false;
      return { dims: d, design, stats: { capacity: 130, unit: 'pax', speedKmh: byYear(year, [[1960, 80], [2000, 100]]), cost: 1100000, running: 70000, power: 'electric' } };
    }
    case 'tram': {
      const L = 10;
      const d = dims(L, 2.65, 3.4, [L / 2 - 2.2, -L / 2 + 2.2], 0.33, 0.2);
      design.panto = true;
      return { dims: d, design, stats: { capacity: 70, unit: 'pax', speedKmh: 80, cost: 900000, running: 60000, power: 'electric' } };
    }
    case 'tram-heritage': {
      const L = 10.4;
      const d = dims(L, 2.2, 4.9, [1.1, -1.1], 0.38, 0.35);
      return { dims: d, design, stats: { capacity: 60, unit: 'pax', speedKmh: 30, cost: 200000, running: 20000, power: 'electric' } };
    }
    case 'rack-car': {
      const L = 15;
      const d = dims(L, 2.6, 3.6, bogies(L, 9), 0.38, 0.25);
      design.cab = true; design.nose = 'flat';
      return { dims: d, design, stats: { capacity: 60, unit: 'pax', speedKmh: 55, cost: 1200000, running: 80000, power: year < 1960 ? 'steam' : 'electric' } };
    }
    case 'wagon-hopper': {
      const four = year < 1965 || r() < 0.3;
      const L = four ? 6.5 : 16.5;
      const d = dims(L, 2.6, four ? 2.6 : 3.7, four ? [1.6, -1.6] : bogies(L, 11.2), 0.46, 0.25);
      design.four = four;
      return { dims: d, design, stats: { capacity: four ? 16 : 75, unit: 't', speedKmh: four ? 70 : 100, cost: four ? 40000 : 140000, running: 4000, power: 'none' } };
    }
    case 'wagon-box': {
      const four = year < 1975;
      const L = four ? 6.4 : 15.5;
      const d = dims(L, 2.6, 3.6, four ? [1.6, -1.6] : bogies(L, 10.5), 0.46, 0.25);
      design.four = four;
      return { dims: d, design, stats: { capacity: four ? 12 : 60, unit: 't', speedKmh: 90, cost: 60000, running: 4000, power: 'none' } };
    }
    case 'brake-van': {
      const d = dims(7.3, 2.6, 3.5, [1.8, -1.8], 0.46, 0.25);
      return { dims: d, design, stats: { capacity: 0, unit: 't', speedKmh: 70, cost: 30000, running: 2000, power: 'none' } };
    }
    case 'wagon-tank': {
      const L = year < 1965 ? 7.2 : 18;
      const d = dims(L, 2.7, 3.9, L < 10 ? [1.8, -1.8] : bogies(L, 12.5), 0.46, 0.25);
      design.four = L < 10;
      return { dims: d, design, stats: { capacity: L < 10 ? 20 : 80, unit: 't', speedKmh: 90, cost: 120000, running: 4000, power: 'none' } };
    }
    case 'wagon-flat': {
      const L = r() < 0.5 ? 19.7 : 13.9;
      const d = dims(L, 2.6, 3.9, bogies(L, L * 0.72), 0.42, 0.25);
      design.boxes = L > 18 ? pick(r, [2, 3, 1]) : 1;
      return { dims: d, design, stats: { capacity: L > 18 ? 60 : 40, unit: 't', speedKmh: 120, cost: 110000, running: 4000, power: 'none' } };
    }
    case 'wagon-car': {
      const L = 26;
      const d = dims(L, 2.75, 3.95, bogies(L, 19), 0.42, 0.25);
      return { dims: d, design, stats: { capacity: 10, unit: 'pax', speedKmh: 120, cost: 200000, running: 6000, power: 'none' } };
    }
    default: { // wagon-timber
      const L = 20;
      const d = dims(L, 2.6, 3.3, bogies(L, 14), 0.42, 0.25);
      return { dims: d, design, stats: { capacity: 60, unit: 't', speedKmh: 100, cost: 100000, running: 4000, power: 'none' } };
    }
  }
}

// ---------------- boats and aircraft ----------------
export function boatSpec(style: BodyStyle, year: number, r: Rand): Spec {
  const design: Design = { year };
  const S: Partial<Record<BodyStyle, [number, number, number, number, number]>> = {
    // length, beam, height above water, capacity, speed
    narrowboat: [range(r, 17, 21), 2.08, 1.8, 25, 6], barge: [range(r, 32, 50), range(r, 5.5, 7), 3.2, 600, 12],
    coaster: [range(r, 60, 85), range(r, 10, 13), 17, 2500, 22], 'container-ship': [range(r, 180, 260), range(r, 28, 36), 34, 60000, 40], ferry: [range(r, 110, 160), range(r, 20, 26), 26, 1500, 38],
  };
  const [L, B, H, cap, sp] = S[style] ?? [20, 3, 2, 10, 10];
  const d = dims(L, B, H, [], 0, 0);
  const pax = style === 'ferry' || (style === 'narrowboat' && year >= 1970);
  return { dims: d, design, stats: { capacity: Math.round(cap), unit: pax ? 'pax' : 't', speedKmh: sp, cost: Math.round(L * L * (style === 'container-ship' ? 1200 : 2500)), running: Math.round(L * 1500), power: 'diesel' } };
}
export function airSpec(style: BodyStyle, year: number, r: Rand): Spec {
  const design: Design = { year };
  const S: Partial<Record<BodyStyle, [number, number, number, number, number, number]>> = {
    // length, span, height, fuselage diameter, seats, speed
    'light-aircraft': [7.3, 10.6, 2.4, 1.2, 4, 220], turboprop: [27, 27, 7.6, 2.6, 70, 510], airliner: [37.6, 35.8, 12, 3.95, 180, 830], widebody: [63.7, 60.3, 17, 5.9, 350, 900],
  };
  const [L, span, H, dia, seats, sp] = S[style] ?? S.airliner!;
  const j = range(r, 0.97, 1.03);
  const d = dims(L * j, span * j, H, [L * 0.35 * j, -L * 0.05], dia * 0.18, 0);
  design.dia = dia; design.span = span * j;
  design.engines = style === 'widebody' ? (year < 1995 && r() < 0.5 ? 4 : 2) : style === 'light-aircraft' ? 1 : 2;
  design.highWing = style === 'turboprop' || (style === 'light-aircraft' && r() < 0.5);
  return { dims: d, design, stats: { capacity: seats, unit: 'pax', speedKmh: sp, cost: Math.round(seats * seats * 400 + 80000), running: seats * 9000, power: style === 'light-aircraft' || style === 'turboprop' ? 'prop' : 'jet' } };
}

export const inRange = (v: number, a: number, b: number) => clamp(v, a, b) === v;
