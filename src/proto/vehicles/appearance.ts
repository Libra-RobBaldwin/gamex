// What a particular vehicle looks like: its owner, its four livery colours, its plate or fleet
// number. Private cars take the colour fashion of their year (era.ts) and sometimes their
// brand's signature colour; fleet vehicles take their operator's livery for the year.
import type { Livery, Model } from './types';
import { carColour, plate, fleetNumber } from './era';
import { BRAND } from './brands';
import { OPERATOR, OPERATORS, liveryFor, operatorsFor, BOX_COLOURS, type Operator } from './operators';
import { hash, pick, rng } from './util';

export interface Look { livery: Livery; operator?: Operator; plate: string; fleet?: string; liveryName?: string }

const CREAM = ['#efe3c2', '#f2f2f0', '#e8e0c8'];
const TRADE = ['#f2f2f0', '#f2f2f0', '#f2f2f0', '#1e2f55', '#b3261e', '#2f5a3a', '#e0b42a', '#6a6e72', '#1a1a1a'];

// The operator a fleet vehicle belongs to in a given year, if any. Taxis, police cars and
// ambulances always have one; buses, lorries and trains usually do.
export function operatorFor(m: Model, year: number, seed: number): Operator | undefined {
  if (m.style === 'police') return OPERATOR['oakshire-police'];
  if (m.style === 'ambulance') return OPERATOR['oakshire-ambulance'];
  if (m.style === 'taxi') return OPERATOR['oakport-hackney'];
  if (m.category === 'car') return undefined;
  const r = rng(seed ^ 0x5bd1e995);
  const style = m.style === 'bus-bendy-rear' ? 'bus-bendy' : m.style === 'tender' ? 'steam-tender' : m.style;
  const ops = operatorsFor(style, year);
  if (m.category === 'van' || m.category === 'lorry' || m.category === 'trailer') {
    // most vans and lorries are owner-drivers and small firms in plain paint
    if (!ops.length || r() < (m.category === 'van' ? 0.8 : 0.45)) return undefined;
  }
  if (!ops.length) {
    // fall back to any operator that runs this style, even outside its years
    const any = OPERATORS.filter((o) => o.fleet.includes(style));
    return any.length ? pick(r, any) : undefined;
  }
  return pick(r, ops);
}

export function lookFor(m: Model, year: number, seed: number, operatorId?: string): Look {
  const r = rng(seed);
  const op = operatorId ? OPERATOR[operatorId] : operatorFor(m, year, seed);
  const reg = plate(Math.max(m.from, Math.min(year, m.to + 12)), seed);
  if (op) {
    const style = m.style === 'bus-bendy-rear' ? 'bus-bendy' : m.style === 'tender' ? 'steam-tender' : m.style;
    const l = liveryFor(op, style, year);
    const livery = (l?.colours ?? ['#f2f2f0', '#f2f2f0', '#f2f2f0', '#f2f2f0']).slice() as Livery;
    // cabs: most are black, a few carry an advertising wrap
    if (op.kind === 'taxi' && l && l.name !== 'Black cab' && r() < 0.8) livery.splice(0, 4, ...op.liveries[0].colours);
    const kind = m.category === 'rail' ? 'rail' : m.category === 'lorry' || m.category === 'trailer' ? 'lorry' : 'bus';
    return { livery, operator: op, plate: reg, fleet: fleetNumber(op.code, seed, kind), liveryName: l?.name };
  }
  if (m.category === 'car') {
    const brand = BRAND[m.brand];
    const body = brand && r() < 0.25 ? pick(r, brand.colours) : carColour(year, r);
    let second = body, roof = body;
    if (m.design.pattern === 'flash') second = pick(r, CREAM);
    if (m.from >= 1966 && m.from <= 1982 && r() < 0.22 && (m.style === 'saloon' || m.style === 'coupe')) roof = '#1a1a1a'; // vinyl roof
    if (m.from >= 2006 && r() < 0.18) roof = pick(r, ['#141414', '#f2f2f0']); // contrast roof
    if (m.style === 'classic') second = r() < 0.7 ? '#151515' : body; // black wings
    return { livery: [body, second, roof, body], plate: reg };
  }
  // plain commercial paint: white vans, and lorries in the owner's colours
  const body = m.category === 'van' ? (r() < 0.55 ? '#f2f2f0' : carColour(year, r)) : pick(r, TRADE);
  const band = r() < 0.5 ? body : pick(r, TRADE);
  const boxes = m.style === 'trailer-container' || m.style === 'wagon-flat' ? pick(r, BOX_COLOURS) : body;
  return { livery: [boxes, band, m.category === 'van' ? body : pick(r, ['#f2f2f0', body]), band], plate: reg };
}

export const lookSeed = (id: string, n: number) => hash(`${id}#${n}`);
