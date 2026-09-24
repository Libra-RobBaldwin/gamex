// Eras: how the look of vehicles changes from 1900 to 2030. Builders read styling from here
// (lamp shapes, bumpers, wheel sizes, windscreen rake), the spawner reads the colour of the
// street, and plates follow the real sequence of UK registration formats.
import { byYear, pick, rng, weighted, type Rand } from './util';

export interface Era { id: string; label: string; from: number; to: number; blurb: string }
export const ERAS: Era[] = [
  { id: 'veteran', label: 'Veteran and vintage', from: 1900, to: 1929, blurb: 'Separate wings, running boards, brass lamps, spoked wheels, black paint.' },
  { id: 'thirties', label: 'Between the wars', from: 1930, to: 1949, blurb: 'Streamlining arrives: flowing wings, chrome grilles, headlamps on the wings.' },
  { id: 'fifties', label: 'Post-war', from: 1950, to: 1964, blurb: 'Full-width pontoon bodies, chrome bumpers, round lamps, two-tone paint.' },
  { id: 'sixties', label: 'Swinging sixties and seventies', from: 1965, to: 1979, blurb: 'Crisp boxes and wedges, rectangular lamps, vinyl roofs, browns and oranges.' },
  { id: 'eighties', label: 'Aero eighties', from: 1980, to: 1994, blurb: 'Flush glass, black plastic bumpers, aerodynamic wedges, pop-up lamps.' },
  { id: 'noughties', label: 'Jellybean years', from: 1995, to: 2009, blurb: 'Rounded bodies, body-coloured bumpers, teardrop lamps, silver everywhere.' },
  { id: 'modern', label: 'Modern', from: 2010, to: 2030, blurb: 'Sharp creases, slim LED lamps, big wheels, tall grilles; closed fronts on electrics.' },
];
export const eraOf = (year: number) => ERAS.find((e) => year >= e.from && year <= e.to) ?? (year < 1900 ? ERAS[0] : ERAS[ERAS.length - 1]);

export type LampShape = 'round' | 'twin-round' | 'rect' | 'wrap' | 'slim' | 'strip' | 'popup';
export type BumperKind = 'chrome' | 'rubber' | 'body' | 'none';
export type WheelKind = 'spoke' | 'steel' | 'hubcap' | 'alloy' | 'aero';

// Styling defaults for a year; brands and body styles override some of them.
export function eraStyle(year: number, r: Rand = Math.random) {
  const lamps: LampShape = year < 1960 ? 'round' : year < 1972 ? pick(r, ['round', 'twin-round', 'rect'] as const) : year < 1995 ? pick(r, ['rect', 'rect', 'wrap'] as const) : year < 2012 ? pick(r, ['wrap', 'wrap', 'slim'] as const) : pick(r, ['slim', 'strip'] as const);
  const bumper: BumperKind = year < 1972 ? 'chrome' : year < 1994 ? 'rubber' : 'body';
  const wheel: WheelKind = year < 1935 ? 'spoke' : year < 1975 ? pick(r, ['steel', 'hubcap', 'hubcap'] as const) : year < 2000 ? pick(r, ['hubcap', 'alloy', 'steel'] as const) : year < 2020 ? pick(r, ['alloy', 'alloy', 'hubcap'] as const) : pick(r, ['alloy', 'aero'] as const);
  return {
    lamps, bumper, wheel,
    // windscreen rake: how far back the top of the screen sits, as a share of length
    rake: byYear(year, [[1930, 0.045], [1955, 0.07], [1975, 0.09], [1990, 0.12], [2010, 0.14], [2030, 0.15]]),
    // wheel radius for an ordinary car
    wheelR: byYear(year, [[1930, 0.36], [1950, 0.33], [1965, 0.29], [1985, 0.29], [2000, 0.31], [2015, 0.335], [2030, 0.35]]),
    // how much narrower the roof is than the body
    tumble: byYear(year, [[1930, 0.04], [1960, 0.07], [1990, 0.1], [2010, 0.13]]),
    // how rounded the nose and tail are, 0–1
    round: byYear(year, [[1935, 0.6], [1955, 0.7], [1968, 0.25], [1985, 0.35], [2000, 0.8], [2015, 0.55]]),
    twoTone: year >= 1950 && year < 1964 ? 0.35 : year < 1935 ? 0.8 : 0.03,
    chromeTrim: year < 1975,
    cladding: year >= 1982 && year < 2000 ? 0.4 : year >= 2014 ? 0.25 : 0,
  };
}

// ---------------- colour popularity ----------------
// What colour the cars on the street are, decade by decade, loosely after UK registration
// surveys: black before the war, pastels and two-tones in the fifties, browns, oranges and
// harvest gold in the seventies, reds and blues in the eighties, greens and purples in the
// nineties, silver in the noughties, then white, grey and black.
export const CAR_PALETTES: [number, [string, number][]][] = [
  [1900, [['#151515', 60], ['#3a1a1a', 10], ['#1f2f22', 10], ['#1c2438', 10], ['#5a4a35', 5]]],
  [1930, [['#151515', 45], ['#4a1c22', 12], ['#23392a', 12], ['#1e2a45', 12], ['#b9ab8a', 8], ['#6d6e70', 6]]],
  [1950, [['#1a1a1a', 14], ['#e8e0c8', 14], ['#9bb6c9', 12], ['#a7c0a0', 10], ['#6e1f2a', 10], ['#7d8185', 10], ['#2b4a73', 8], ['#c8b48a', 8]]],
  [1960, [['#f2efe6', 18], ['#b3261e', 14], ['#8fb0cf', 12], ['#d8c9a0', 10], ['#2f5a3a', 10], ['#1a1a1a', 8], ['#6d7a86', 8], ['#e0b43a', 5]]],
  [1970, [['#6b4a2b', 14], ['#d0631d', 12], ['#c89a2a', 12], ['#6f7a32', 10], ['#f2efe6', 10], ['#9a2a1e', 8], ['#d8c9a0', 8], ['#2f5a8a', 6], ['#8a6a3a', 6]]],
  [1980, [['#b3261e', 16], ['#f2efe6', 14], ['#a5a9ad', 12], ['#1e2f55', 12], ['#5a1e26', 8], ['#1a1a1a', 8], ['#6b5a45', 6], ['#8a9aa8', 6]]],
  [1990, [['#1f4a38', 14], ['#1e2f55', 14], ['#b3261e', 12], ['#4a2a55', 8], ['#a5a9ad', 10], ['#1a1a1a', 8], ['#2a6a7a', 8], ['#f2efe6', 6]]],
  [2000, [['#b9bdc0', 28], ['#1a1a1a', 14], ['#2a4f8a', 12], ['#6d7277', 12], ['#b3261e', 8], ['#f2efe6', 6], ['#2a3a2f', 4]]],
  [2010, [['#f2f2f0', 22], ['#6a6e72', 18], ['#141414', 16], ['#b9bdc0', 12], ['#2a4f8a', 10], ['#b3261e', 8], ['#8a8f93', 6]]],
  [2020, [['#80858a', 24], ['#f2f2f0', 18], ['#141414', 16], ['#2a4f8a', 10], ['#1f3d34', 6], ['#b3261e', 6], ['#d86a1c', 4], ['#b9bdc0', 8]]],
];

// Blend the two nearest decades so the fashion changes gradually.
export function carColour(year: number, r: Rand) {
  let i = 0;
  while (i < CAR_PALETTES.length - 1 && CAR_PALETTES[i + 1][0] <= year) i++;
  const j = Math.min(CAR_PALETTES.length - 1, i + 1);
  const t = j === i ? 0 : Math.max(0, Math.min(1, (year - CAR_PALETTES[i][0]) / (CAR_PALETTES[j][0] - CAR_PALETTES[i][0])));
  return weighted(r, r() < t ? CAR_PALETTES[j][1] : CAR_PALETTES[i][1]);
}
// the most popular colours of a year, for the showroom and the docs
export function palette(year: number) {
  let i = 0;
  while (i < CAR_PALETTES.length - 1 && CAR_PALETTES[i + 1][0] <= year) i++;
  return CAR_PALETTES[i][1].slice().sort((a, b) => b[1] - a[1]);
}

// ---------------- registration plates ----------------
// UK formats by year: "ABC 123" before 1963, the year-suffix "ABC 123D" to 1983, the prefix
// "A123 BCD" to 2001, then the current "AB51 CDE". Letters I, Q and Z are avoided as the DVLA does.
const L = 'ABCDEFGHJKLMNOPRSTUVWXY';
const SUFFIX = 'ABCDEFGHJKLMNPRSTVWXY'; // 1963 (A) to 1983 (Y)
const PREFIX = 'ABCDEFGHJKLMNPRSTVWXY'; // 1983 (A) to 2001 (Y)
const letters = (r: Rand, n: number) => Array.from({ length: n }, () => pick(r, L.split(''))).join('');
const digits = (r: Rand, n: number, lead = true) => Array.from({ length: n }, (_, i) => String(i === 0 && lead ? 1 + Math.floor(r() * 9) : Math.floor(r() * 10))).join('');

export function plate(year: number, seed: number) {
  const r = rng(seed);
  if (year < 1963) return `${letters(r, 3)} ${digits(r, 1 + Math.floor(r() * 3))}`;
  if (year < 1983) return `${letters(r, 3)} ${digits(r, 3)}${SUFFIX[Math.min(SUFFIX.length - 1, year - 1963)]}`;
  if (year < 2001) return `${PREFIX[Math.min(PREFIX.length - 1, year - 1983)]}${digits(r, 3)} ${letters(r, 3)}`;
  // March plates carry the year (02), September ones the year plus 50 (52)
  const half = r() < 0.5 ? 0 : 50;
  const age = year === 2001 ? 51 : ((year % 100) + half) % 100;
  return `${letters(r, 2)}${String(age).padStart(2, '0')} ${letters(r, 3)}`;
}

// Fleet numbers: buses carry the operator's code and a number; trains a class and serial.
export function fleetNumber(code: string, seed: number, style: 'bus' | 'rail' | 'lorry' = 'bus') {
  const r = rng(seed);
  if (style === 'rail') return `${code} ${2 + Math.floor(r() * 7)}${digits(r, 3, false)}`;
  if (style === 'lorry') return `${code}${digits(r, 3)}`;
  return `${code} ${digits(r, 1 + Math.floor(r() * 3))}`;
}

// A plate or fleet number drawn to a canvas, for close-ups (the turntable) or a texture atlas.
export function plateCanvas(text: string, rear = false, w = 208, h = 44) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = rear ? '#f0c419' : '#f2f2ee';
  x.fillRect(0, 0, w, h);
  x.strokeStyle = '#111'; x.lineWidth = 2; x.strokeRect(1, 1, w - 2, h - 2);
  x.fillStyle = '#111';
  x.font = `bold ${Math.round(h * 0.72)}px "Arial Narrow", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 1);
  return c;
}
