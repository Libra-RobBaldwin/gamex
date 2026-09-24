// The catalogue: every brand's model lines expanded into generations and body styles, plus the
// fleet specials (police cars, driving and intermediate cars of multiple units, tram sections)
// and the sets that run together (tractor and trailer, power cars and coaches, bendy halves).
// It's built from rules, the way catalog.ts builds its roads, so adding a line adds a family
// of models; ids and dimensions are stable because every model is seeded from its id.
import { BRANDS, BRAND, type Brand, type Line } from './brands';
import type { BodyStyle, Category, Model } from './types';
import { carSpec, vanSpec, lorrySpec, busSpec, railSpec, boatSpec, airSpec, type Spec } from './specs';
import { hash, rng } from './util';

export const CATEGORY: Record<BodyStyle, Category> = {} as Record<BodyStyle, Category>;
const set = (c: Category, ss: BodyStyle[]) => { for (const s of ss) CATEGORY[s] = c; };
set('car', ['hatchback', 'saloon', 'estate', 'coupe', 'convertible', 'suv', 'pickup', 'mpv', 'sports', 'supercar', 'classic', 'taxi', 'police']);
set('van', ['van-small', 'van-panel', 'van-luton', 'minibus', 'ice-cream', 'ambulance']);
set('lorry', ['rigid-box', 'rigid-curtain', 'rigid-tipper', 'rigid-flatbed', 'rigid-tanker', 'refuse', 'gritter', 'mixer', 'recovery', 'tractor']);
set('trailer', ['trailer-box', 'trailer-curtain', 'trailer-tanker', 'trailer-tipper', 'trailer-flatbed', 'trailer-container', 'trailer-car', 'trailer-logging', 'trailer-livestock']);
set('bus', ['bus-single', 'bus-double', 'bus-bendy', 'bus-bendy-rear', 'coach', 'bus-heritage', 'bus-halfcab']);
set('rail', ['steam-tank', 'steam-tender', 'tender', 'shunter', 'diesel-loco', 'electric-loco', 'dmu-car', 'emu-car', 'hs-power', 'hs-coach', 'tram', 'tram-heritage', 'rack-car', 'coach-stock', 'wagon-hopper', 'wagon-box', 'wagon-tank', 'wagon-flat', 'wagon-car', 'wagon-timber', 'brake-van']);
set('boat', ['narrowboat', 'barge', 'coaster', 'container-ship', 'ferry']);
set('air', ['light-aircraft', 'turboprop', 'airliner', 'widebody']);

export const STYLE_LABEL: Record<BodyStyle, string> = {
  hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', coupe: 'Coupé', convertible: 'Convertible', suv: 'SUV', pickup: 'Pickup', mpv: 'People-carrier',
  sports: 'Sports car', supercar: 'Supercar', classic: 'Vintage', taxi: 'Cab', police: 'Police car', ambulance: 'Ambulance',
  'van-small': 'Small van', 'van-panel': 'Panel van', 'van-luton': 'Luton van', minibus: 'Minibus', 'ice-cream': 'Ice-cream van',
  'rigid-box': 'Box lorry', 'rigid-curtain': 'Curtain-sider', 'rigid-tipper': 'Tipper', 'rigid-flatbed': 'Flatbed', 'rigid-tanker': 'Tanker', refuse: 'Bin lorry', gritter: 'Gritter', mixer: 'Mixer', recovery: 'Recovery truck',
  tractor: 'Tractor unit', 'trailer-box': 'Box trailer', 'trailer-curtain': 'Curtain trailer', 'trailer-tanker': 'Tank trailer', 'trailer-tipper': 'Tipper trailer', 'trailer-flatbed': 'Flat trailer',
  'trailer-container': 'Container skeletal', 'trailer-car': 'Car transporter', 'trailer-logging': 'Timber trailer', 'trailer-livestock': 'Livestock trailer',
  'bus-single': 'Single-decker', 'bus-double': 'Double-decker', 'bus-bendy': 'Bendy bus', 'bus-bendy-rear': 'Bendy bus (rear)', coach: 'Coach', 'bus-heritage': 'Vintage bus', 'bus-halfcab': 'Half-cab decker',
  'steam-tank': 'Tank engine', 'steam-tender': 'Tender engine', tender: 'Tender', shunter: 'Shunter', 'diesel-loco': 'Diesel locomotive', 'electric-loco': 'Electric locomotive',
  'dmu-car': 'Diesel unit car', 'emu-car': 'Electric unit car', 'hs-power': 'High-speed power car', 'hs-coach': 'High-speed coach', tram: 'Tram section', 'tram-heritage': 'Heritage tram', 'rack-car': 'Rack railcar',
  'coach-stock': 'Coach', 'wagon-hopper': 'Hopper wagon', 'wagon-box': 'Van wagon', 'wagon-tank': 'Tank wagon', 'wagon-flat': 'Container flat', 'wagon-car': 'Car carrier', 'wagon-timber': 'Timber wagon', 'brake-van': 'Brake van',
  narrowboat: 'Narrowboat', barge: 'Barge', coaster: 'Coaster', 'container-ship': 'Container ship', ferry: 'Car ferry',
  'light-aircraft': 'Light aircraft', turboprop: 'Turboprop', airliner: 'Airliner', widebody: 'Wide-body jet',
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function specFor(style: BodyStyle, year: number, line: Line, brand: Brand, seed: number): Spec {
  const r = rng(seed);
  const cat = CATEGORY[style];
  if (cat === 'car') return carSpec(style, year, line.size ?? 'medium', brand, r);
  if (cat === 'van') return vanSpec(style, year, r);
  if (cat === 'lorry' || cat === 'trailer') return lorrySpec(style, year, r, brand.id);
  if (cat === 'bus') return busSpec(style, year, r);
  if (cat === 'rail') return railSpec(style, year, r);
  if (cat === 'boat') return boatSpec(style, year, r);
  return airSpec(style, year, r);
}

function make(brand: Brand, line: Line, style: BodyStyle, from: number, to: number, g: number, gens: number, extra: Partial<Model> = {}, idSuffix = ''): Model {
  const cat = CATEGORY[style];
  const road = cat === 'car' || cat === 'van' || cat === 'lorry' || cat === 'bus';
  const mark = gens > 1 ? (road ? ` Mk ${ROMAN[g] ?? g + 1}` : ` (${from})`) : '';
  // one line in several body styles gets a suffix (the Kelsall estate), the main style none
  const variant = line.styles.length > 1 && style !== line.styles[0] && cat === 'car' ? ` ${STYLE_LABEL[style].toLowerCase()}` : '';
  const family = `${line.family}${mark}${variant}`;
  const id = `${brand.id}-${slug(line.family)}-${g + 1}-${style}${idSuffix}`;
  const seed = hash(id);
  const spec = specFor(style, from, line, brand, seed);
  return {
    id, family, name: `${brand.name} ${family}`, brand: brand.id, category: cat, style, from, to,
    dims: spec.dims, hitch: spec.hitch, seed, design: { ...spec.design, year: from }, stats: spec.stats, tags: [], ...extra,
  };
}

export function buildCatalogue(): Model[] {
  const out: Model[] = [];
  for (const brand of BRANDS) for (const line of brand.lines) {
    const gens = Math.max(1, Math.ceil((line.to - line.from + 1) / line.gen));
    for (let g = 0; g < gens; g++) {
      const from = line.from + g * line.gen, to = Math.min(line.to, from + line.gen - 1);
      for (const style of line.styles) {
        // a vintage line turns into a modern body when the era moves on
        if (style === 'classic' && from >= 1935) continue;
        if (style !== 'classic' && line.styles.includes('classic') && from < 1935) continue;
        if (style === 'hs-coach' || style === 'hs-power') continue; // added below as a set
        if (style === 'dmu-car' || style === 'emu-car' || style === 'tram') {
          // multiple units and trams: a driving (or end) car and an intermediate one
          const a = make(brand, line, style, from, to, g, gens, {}, '-cab');
          const b = make(brand, line, style, from, to, g, gens, {}, '-mid');
          a.family += style === 'tram' ? ' end section' : ' driving car'; a.name = `${brand.name} ${a.family}`;
          b.family += style === 'tram' ? ' centre section' : ' intermediate'; b.name = `${brand.name} ${b.family}`;
          b.design = { ...b.design, cab: false, panto: style === 'tram' ? true : b.design.panto };
          a.design = { ...a.design, cab: true, panto: style === 'tram' ? false : a.design.panto };
          a.consist = style === 'tram' ? [a.id, b.id, a.id] : [a.id, b.id, a.id];
          b.consist = a.consist;
          out.push(a, b);
          continue;
        }
        const m = make(brand, line, style, from, to, g, gens);
        if (style === 'bus-bendy') {
          const rear = make(brand, line, 'bus-bendy-rear', from, to, g, gens);
          rear.family = `${m.family} rear section`; rear.name = `${brand.name} ${rear.family}`;
          m.consist = [m.id, rear.id]; rear.consist = m.consist;
          out.push(m, rear);
          continue;
        }
        if (style === 'steam-tender') {
          const t = make(brand, line, 'tender', from, to, g, gens);
          t.family = `${m.family} tender`; t.name = `${brand.name} ${t.family}`;
          m.consist = [m.id, t.id]; t.consist = m.consist;
          out.push(m, t);
          continue;
        }
        out.push(m);
      }
      // high-speed sets: power cars at both ends of a rake of coaches
      if (line.styles.includes('hs-power')) {
        const p = make(brand, line, 'hs-power', from, to, g, gens);
        const c = make(brand, line, 'hs-coach', from, to, g, gens);
        c.family = `${line.family}${gens > 1 ? ` (${from})` : ''} coach`; c.name = `${brand.name} ${c.family}`;
        p.family = `${line.family}${gens > 1 ? ` (${from})` : ''} power car`; p.name = `${brand.name} ${p.family}`;
        const n = from >= 2008 ? 6 : 7;
        p.consist = [p.id, ...Array(n).fill(c.id), p.id]; c.consist = p.consist;
        out.push(p, c);
      }
    }
  }
  // Police cars: the force buys whatever family cars and estates suit the decade.
  const POLICE_FAMILIES = ['Kelsall', 'Hepworth', 'Staufen', 'Vallen', 'Tornby', 'Tarnhow', 'Kiyora', 'Marden', 'Highcombe', 'Oberau'];
  for (const m of out.slice()) {
    if (m.category !== 'car' || !POLICE_FAMILIES.some((f) => m.family.startsWith(f))) continue;
    if (m.style !== 'saloon' && m.style !== 'estate' && m.style !== 'suv' && m.style !== 'hatchback') continue;
    if (m.to < 1930) continue;
    const brand = BRAND[m.brand];
    const r = rng(hash(m.id + '-police'));
    const spec = carSpec('police', m.from, lineOf(m)?.size ?? 'medium', brand, r, m.style);
    out.push({ ...m, id: `${m.id}-police`, style: 'police', family: `${m.family} police car`, name: `${m.name} police car`, dims: m.dims, design: { ...m.design, ...spec.design, ...pickShape(m) }, seed: hash(m.id + '-police'), tags: ['oakshire-police'], stats: { ...m.stats, cost: Math.round(m.stats.cost * 1.3) } });
  }
  return out;
}
// keep the police car's body exactly the same as the car it's based on
function pickShape(m: Model) {
  const keep = ['ws', 'roofF', 'roofR', 'cBase', 'noseH', 'bonnetFH', 'bonnetH', 'beltH', 'tailH', 'tailLow', 'noseR', 'tailR', 'tumble', 'lamps', 'bumper', 'grille', 'tyreW', 'doors'];
  return Object.fromEntries(keep.filter((k) => m.design[k] !== undefined).map((k) => [k, m.design[k]]));
}
function lineOf(m: Model) {
  return BRAND[m.brand]?.lines.find((l) => m.family.startsWith(l.family));
}

export const MODELS: Model[] = buildCatalogue();
export const MODEL: Record<string, Model> = Object.fromEntries(MODELS.map((m) => [m.id, m]));
export const modelsIn = (year: number, filter: (m: Model) => boolean = () => true) => MODELS.filter((m) => year >= m.from && year <= m.to + 12 && filter(m));
