// The library as the buyable fleet: every bus, coach, van, lorry, trainset, tram, boat and
// aircraft on sale in a year, with capacity, speed, price and running cost. Multiple units and
// high-speed sets are sold as whole sets; trams as three-section cars; tractors and trailers
// separately, because a haulier matches them to the job.
import type { Model } from './types';
import { MODELS, MODEL, STYLE_LABEL } from './models';
import { BRAND } from './brands';

export type OfferKind = 'bus' | 'coach' | 'van' | 'lorry' | 'tractor' | 'trailer' | 'train' | 'locomotive' | 'carriage' | 'wagon' | 'tram' | 'boat' | 'plane';
export interface Offer {
  id: string; name: string; kind: OfferKind;
  models: string[]; // in running order
  from: number; to: number;
  capacity: number; unit: 'pax' | 't';
  speedKmh: number; cost: number; running: number;
  lengthM: number;
  blurb: string;
}

const sum = (ms: Model[], f: (m: Model) => number) => ms.reduce((s, m) => s + f(m), 0);
function offer(id: string, kind: OfferKind, ms: Model[], name?: string): Offer {
  const lead = ms[0];
  const b = BRAND[lead.brand];
  const cap = sum(ms, (m) => m.stats.capacity);
  const unit = ms.some((m) => m.stats.unit === 'pax' && m.stats.capacity > 0) && kind !== 'wagon' && kind !== 'locomotive' ? 'pax' : 't';
  return {
    id, kind, name: name ?? lead.name, models: ms.map((m) => m.id), from: lead.from, to: lead.to,
    capacity: Math.round(cap), unit, speedKmh: Math.min(...ms.map((m) => m.stats.speedKmh || Infinity)),
    cost: sum(ms, (m) => m.stats.cost), running: sum(ms, (m) => m.stats.running),
    lengthM: Math.round((sum(ms, (m) => m.dims.length) + (ms.length - 1) * 0.9) * 10) / 10,
    blurb: `${STYLE_LABEL[lead.style]} from ${b?.name ?? lead.brand}${ms.length > 1 ? `, ${ms.length} vehicles` : ''}.`,
  };
}

let all: Offer[] | null = null;
export function allOffers(): Offer[] {
  if (all) return all;
  const out: Offer[] = [];
  for (const m of MODELS) {
    const c = m.category, s = m.style;
    if (c === 'car' || s === 'bus-bendy-rear' || s === 'tender' || s === 'hs-coach' || s === 'police' || s === 'ambulance') continue;
    const chain = (m.consist ?? [m.id]).map((id) => MODEL[id]);
    if (c === 'bus') out.push(offer(m.id, s === 'coach' ? 'coach' : 'bus', s === 'bus-bendy' ? chain : [m]));
    else if (c === 'van') out.push(offer(m.id, s === 'minibus' ? 'bus' : 'van', [m]));
    else if (c === 'lorry') out.push(offer(m.id, s === 'tractor' ? 'tractor' : 'lorry', [m]));
    else if (c === 'trailer') out.push(offer(m.id, 'trailer', [m]));
    else if (c === 'boat') out.push(offer(m.id, 'boat', [m]));
    else if (c === 'air') out.push(offer(m.id, 'plane', [m]));
    else if (c === 'rail') {
      if (s === 'dmu-car' || s === 'emu-car') {
        if (m.design.cab === false) continue;
        // sold as two-, three- and four-car sets
        const mid = MODEL[m.consist?.[1] ?? ''];
        for (const n of [2, 3, 4]) {
          const set = n === 2 || !mid ? [m, m] : [m, ...Array(n - 2).fill(mid), m];
          out.push(offer(`${m.id}-x${n}`, 'train', set, `${m.name.replace(' driving car', '')} (${n}-car)`));
        }
      } else if (s === 'tram') {
        if (m.design.cab === false) continue;
        out.push(offer(m.id, 'tram', chain, m.name.replace(' end section', '')));
      } else if (s === 'hs-power') out.push(offer(m.id, 'train', chain, `${m.name.replace(' power car', '')} set`));
      else if (s === 'steam-tender') out.push(offer(m.id, 'locomotive', chain));
      else if (s === 'steam-tank' || s === 'shunter' || s === 'diesel-loco' || s === 'electric-loco') out.push(offer(m.id, 'locomotive', [m]));
      else if (s === 'rack-car' || s === 'tram-heritage') out.push(offer(m.id, s === 'rack-car' ? 'train' : 'tram', [m]));
      else if (s === 'coach-stock') out.push(offer(m.id, 'carriage', [m]));
      else out.push(offer(m.id, 'wagon', [m]));
    }
  }
  all = out;
  return out;
}

// What's on sale in a year: new models, and a few years after they stop being built.
export const purchaseList = (year: number, kinds?: OfferKind[]) =>
  allOffers().filter((o) => year >= o.from && year <= o.to + 3 && (!kinds || kinds.includes(o.kind)));
