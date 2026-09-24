// A UK postcode to a point on the map, through postcodes.io (open data from the ONS and Ordnance
// Survey; it allows requests straight from the browser).
//
// PRIVACY: the postcode goes to api.postcodes.io and nowhere else. It is never stored (no
// localStorage, no IndexedDB, no URL, no history), never logged, and the request carries no
// referrer or cookies. Callers must keep it that way: see docs/places.md.

import type { LatLon } from '../proto/osm/projection';

// the full postcode, and the outward half on its own (a district is enough to find a town)
const FULL = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})$/;
const OUTWARD = /^[A-Z]{1,2}[0-9][A-Z0-9]?$/;
const CROWN = /^(GY|JE|IM)[0-9]/; // Guernsey, Jersey, the Isle of Man: outside postcodes.io's data

export type Parsed = { kind: 'full' | 'outward'; text: string } | { kind: 'crown' } | { kind: 'bad' };

export function parsePostcode(input: string): Parsed {
  // "M1 1" is a postcode half typed, not the district M11: the space says where the halves meet
  const words = input.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().split(/\s+/);
  if (words.length === 2 && OUTWARD.test(words[0]) && /^[0-9][A-Z]?$/.test(words[1])) return { kind: 'bad' };
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return { kind: 'bad' };
  if (CROWN.test(s)) return { kind: 'crown' };
  const m = FULL.exec(s);
  if (m) return { kind: 'full', text: `${m[1]} ${m[2]}` };
  if (OUTWARD.test(s)) return { kind: 'outward', text: s };
  return { kind: 'bad' };
}

export interface Place extends LatLon { label: string; suggest: string }
export class PostcodeError extends Error {}

const API = 'https://api.postcodes.io';
type Get = (url: string) => Promise<{ status: number; json: () => Promise<any> }>;
const browserGet: Get = (url) => fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });

const first = (...v: unknown[]) => { for (const x of v) { const s = Array.isArray(x) ? x[0] : x; if (typeof s === 'string' && s.trim()) return s.trim(); } return ''; };
const tidy = (s: string) => s.replace(/,? unparished area$/i, '').replace(/ (Ward|Division)$/i, '');

/** Where a postcode (or a postcode district) is. Throws PostcodeError with a message to show. */
export async function lookupPostcode(input: string, get: Get = browserGet): Promise<Place> {
  const p = parsePostcode(input);
  if (p.kind === 'crown') throw new PostcodeError('Postcodes in Guernsey, Jersey and the Isle of Man aren’t in the open postcode data. Try a nearby town on the UK mainland, or type its postcode district.');
  if (p.kind === 'bad') throw new PostcodeError('That doesn’t look like a UK postcode. Try something like “SW1A 1AA”, or just the first half, like “SW1A”.');
  const enc = encodeURIComponent(p.text);
  let res: Awaited<ReturnType<Get>>;
  try {
    res = await get(p.kind === 'full' ? `${API}/postcodes/${enc}` : `${API}/outcodes/${enc}`);
  } catch {
    throw new PostcodeError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'You’re offline. Connect to look up a postcode; areas you’ve built before still open.' : 'Couldn’t reach the postcode service. Check your connection and try again.');
  }
  if (res.status === 200) {
    const r = (await res.json())?.result;
    if (r && typeof r.latitude === 'number' && typeof r.longitude === 'number') {
      const suggest = tidy(first(r.parish, r.admin_ward, r.admin_district));
      return { lat: r.latitude, lon: r.longitude, label: first(r.admin_district, r.region, r.country) || 'Found', suggest };
    }
    throw new PostcodeError('That postcode exists but has no location in the open data. Try a neighbour’s postcode, or just the first half.');
  }
  if (res.status === 404 && p.kind === 'full') {
    // a postcode that has been retired still has a place
    try {
      const t = await get(`${API}/terminated_postcodes/${enc}`);
      if (t.status === 200) {
        const r = (await t.json())?.result;
        if (r && typeof r.latitude === 'number') return { lat: r.latitude, lon: r.longitude, label: 'A retired postcode', suggest: '' };
      }
    } catch { /* fall through to not found */ }
    throw new PostcodeError('That postcode wasn’t found. Check it, or try just the first half (the part before the space).');
  }
  if (res.status === 404) throw new PostcodeError('That postcode district wasn’t found. Check it and try again.');
  if (res.status === 429) throw new PostcodeError('The postcode service is busy. Wait a moment and try again.');
  throw new PostcodeError('The postcode service had a problem. Try again in a moment.');
}
