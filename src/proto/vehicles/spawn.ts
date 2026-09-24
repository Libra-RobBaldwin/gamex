// A realistic mix of traffic for a place and a year: the city centre gets taxis and buses,
// industrial estates lorries and vans, the motorway artics and coaches, the countryside pickups,
// Land-Rover-type off-roaders and livestock floats. Each pick is a chain of models (a car is one;
// an artic is a tractor and a trailer; a bendy bus two halves) and a look (owner, livery, plate).
import type { BodyStyle, Category, Model } from './types';
import { MODELS, MODEL } from './models';
import { lookFor, type Look } from './appearance';
import { BRAND } from './brands';
import { byYear, pick, rng, weighted, type Rand } from './util';

export type Area = 'centre' | 'suburb' | 'industrial' | 'rural' | 'motorway';
export interface Spawn { chain: Model[]; look: Look; lead: Model }

// How much of each kind of traffic an area sees (relative weights).
const MIX: Record<Area, [Category | 'artic' | BodyStyle, number][]> = {
  centre: [['car', 52], ['taxi', 9], ['bus', 12], ['van', 14], ['lorry', 4], ['police', 1.2], ['ambulance', 0.6], ['refuse', 0.8], ['ice-cream', 0.2]],
  suburb: [['car', 74], ['van', 12], ['bus', 5], ['lorry', 2], ['police', 0.6], ['refuse', 0.8], ['ice-cream', 0.6], ['taxi', 1]],
  industrial: [['car', 34], ['van', 20], ['lorry', 16], ['artic', 26], ['bus', 3], ['refuse', 1]],
  rural: [['car', 58], ['suv', 9], ['pickup', 6], ['van', 9], ['artic', 7], ['lorry', 6], ['bus', 3], ['police', 0.4]],
  motorway: [['car', 55], ['artic', 24], ['van', 12], ['coach', 5], ['lorry', 4], ['police', 0.6]],
};

// Body styles go in and out of fashion (weights by year).
function styleWeight(s: BodyStyle, y: number) {
  switch (s) {
    case 'hatchback': return byYear(y, [[1955, 0.2], [1975, 3], [1995, 4], [2020, 3]]);
    case 'saloon': return byYear(y, [[1940, 5], [1975, 4], [2000, 2.5], [2020, 1]]);
    case 'estate': return byYear(y, [[1955, 0.8], [1985, 1.5], [2020, 0.8]]);
    case 'coupe': return 0.5;
    case 'convertible': return 0.25;
    case 'suv': return byYear(y, [[1970, 0.2], [1995, 0.6], [2010, 2], [2025, 4]]);
    case 'pickup': return 0.25;
    case 'mpv': return byYear(y, [[1985, 0.1], [1998, 1.2], [2010, 0.8], [2025, 0.3]]);
    case 'sports': return 0.25;
    case 'supercar': return 0.04;
    case 'classic': return 2;
    default: return 1;
  }
}
// Volume makers sell far more cars than coachbuilders.
const BRAND_VOLUME: Record<string, number> = { ashcombe: 4, morikawa: 4, varnholt: 3, lavergne: 3, norrvik: 1.5, dravnik: 1.2, tollworth: 1.5, hardesty: 0.5, fellgate: 1, chalcott: 0.3, hallbrook: 0.4, vessanti: 0.15, novaform: 1, ludgate: 0 };

// Models on the road in a year: built that year or up to about fifteen years before, fading out.
function onRoad(m: Model, y: number) {
  if (y < m.from) return 0;
  const age = y - m.to;
  return age <= 0 ? 1 : age < 15 ? 1 - age / 15 : 0;
}

const pools = new Map<string, [Model, number][]>();
function pool(kind: string, y: number) {
  const key = `${kind}|${y}`;
  let p = pools.get(key);
  if (p) return p;
  const want = (m: Model) => {
    if (m.style === 'bus-bendy-rear' || m.style === 'tender' || m.style.startsWith('trailer-')) return false;
    if (kind === 'car') return m.category === 'car' && m.style !== 'police' && m.style !== 'taxi';
    if (kind === 'lorry') return m.category === 'lorry' && m.style !== 'tractor' && m.style !== 'refuse' && m.style !== 'gritter';
    if (kind === 'artic') return m.style === 'tractor';
    if (kind === 'van') return m.category === 'van' && m.style !== 'ambulance' && m.style !== 'ice-cream';
    if (kind === 'bus') return m.category === 'bus' && m.style !== 'coach';
    return m.style === kind;
  };
  p = MODELS.filter(want).map((m) => {
    let w = onRoad(m, y);
    if (kind === 'car') w *= styleWeight(m.style, y) * (BRAND_VOLUME[m.brand] ?? 1);
    // heritage buses linger on as preserved vehicles at a trickle
    if (m.category === 'bus' && y - m.to > 15 && y - m.to < 60) w = Math.max(w, 0.02);
    return [m, w] as [Model, number];
  }).filter(([, w]) => w > 0);
  pools.set(key, p);
  return p;
}

const trailers = (y: number) => MODELS.filter((m) => m.category === 'trailer' && y >= m.from && y <= m.to + 20);

// Pick one vehicle (or articulated set) for an area and year.
export function pickVehicle(r: Rand, area: Area, year: number): Spawn | undefined {
  for (let tries = 0; tries < 6; tries++) {
    const kind = weighted(r, MIX[area]);
    const p = pool(kind, year);
    if (!p.length) continue;
    const lead = weighted(r, p);
    const seed = Math.floor(r() * 2 ** 31);
    const chain = [lead];
    if (lead.style === 'tractor') {
      const ts = trailers(year).filter((t) => area !== 'rural' || ['trailer-logging', 'trailer-livestock', 'trailer-tipper', 'trailer-flatbed', 'trailer-curtain'].includes(t.style));
      if (ts.length) chain.push(pick(r, ts));
    }
    if (lead.consist) for (const id of lead.consist.slice(1)) if (MODEL[id]) chain.push(MODEL[id]);
    const look = lookFor(lead, year, seed);
    return { chain, look, lead };
  }
  return undefined;
}

// A train for a year: a locomotive and its rake, a multiple unit, a high-speed set, or freight.
export function pickTrain(r: Rand, year: number, operatorId?: string): { chain: Model[]; look: Look } | undefined {
  const rail = MODELS.filter((m) => m.category === 'rail' && year >= m.from && year <= m.to + 25);
  if (!rail.length) return undefined;
  const has = (s: BodyStyle) => rail.filter((m) => m.style === s);
  const kinds: [string, number][] = [
    ['unit', has('dmu-car').length + has('emu-car').length ? 4 : 0], ['hs', has('hs-power').length ? 2 : 0],
    ['loco', has('diesel-loco').length + has('electric-loco').length + has('steam-tender').length + has('steam-tank').length ? 3 : 0],
    ['freight', 3],
  ];
  const kind = weighted(r, kinds);
  const seed = Math.floor(r() * 2 ** 31);
  const expand = (m: Model) => (m.consist ?? [m.id]).map((id) => MODEL[id]).filter(Boolean);
  let chain: Model[] = [];
  if (kind === 'unit') {
    const cabs = rail.filter((m) => (m.style === 'dmu-car' || m.style === 'emu-car') && m.design.cab);
    const a = pick(r, cabs), mid = MODEL[a.consist?.[1] ?? a.id];
    const n = 2 + Math.floor(r() * 4);
    chain = [a, ...Array(Math.max(0, n - 2)).fill(mid), a];
  } else if (kind === 'hs') chain = expand(pick(r, has('hs-power')));
  else {
    const locos = [...has('diesel-loco'), ...has('electric-loco'), ...has('steam-tender'), ...has('steam-tank'), ...(kind === 'freight' ? has('shunter') : [])];
    if (!locos.length) return undefined;
    const loco = pick(r, locos);
    chain = expand(loco);
    const stock = kind === 'loco' ? has('coach-stock') : rail.filter((m) => m.style.startsWith('wagon-'));
    if (!stock.length) return undefined;
    const n = kind === 'loco' ? 4 + Math.floor(r() * 6) : 6 + Math.floor(r() * 14);
    const kindOf = pick(r, stock);
    for (let i = 0; i < n; i++) chain.push(kind === 'freight' && r() < 0.25 ? pick(r, stock) : kindOf);
    if (kind === 'freight' && year < 1990) { const bv = has('brake-van'); if (bv.length) chain.push(bv[0]); }
  }
  const look = lookFor(chain[0], year, seed, operatorId);
  return { chain, look };
}

// The make-up of traffic for the docs and the showroom: share of each category for an area.
export function mixSummary(area: Area, year: number, n = 2000, seed = 1) {
  const r = rng(seed);
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const s = pickVehicle(r, area, year);
    if (!s) continue;
    const k = s.lead.style === 'tractor' ? 'artic' : s.lead.style === 'taxi' ? 'taxi' : s.lead.category;
    out[k] = (out[k] ?? 0) + 1 / n;
  }
  return out;
}
export const brandName = (m: Model) => BRAND[m.brand]?.name ?? m.brand;
