// Operators and their liveries: bus companies, coach lines, railways by era, hauliers, the
// council, a police force, an ambulance service, cabs, ice-cream vans, boats and an airline.
// All invented. A livery is four colours for the four paint zones: body, secondary (band,
// skirt, stripe), roof, accent (warning ends, lettering). The builders decide where the zones
// fall on each vehicle, so one livery reads right on a bus, a van or a train.
import type { BodyStyle, Livery } from './types';
import { rng, pick } from './util';

export type OperatorKind = 'bus' | 'coach' | 'tram' | 'rail' | 'freight-rail' | 'haulier' | 'council' | 'police' | 'ambulance' | 'taxi' | 'ice-cream' | 'canal' | 'ferry' | 'shipping' | 'airline' | 'rack';

export interface LiveryDef { name: string; from: number; to: number; colours: Livery; styles?: BodyStyle[] }
export interface Operator {
  id: string; name: string; kind: OperatorKind; code: string;
  from: number; to: number;
  area: 'city' | 'regional' | 'national';
  liveries: LiveryDef[];
  fleet: BodyStyle[]; // the kinds of vehicle it runs
  blurb: string;
}

const Y = '#f2c21a'; // warning yellow
const W = '#f2f2f0';

export const OPERATORS: Operator[] = [
  // ---------------- buses and coaches ----------------
  {
    id: 'greyfield', name: 'Greyfield Omnibus Company', kind: 'bus', code: 'GOC', from: 1920, to: 1986, area: 'city',
    fleet: ['bus-heritage', 'bus-halfcab', 'bus-double', 'bus-single'],
    liveries: [
      { name: 'Red and cream', from: 1920, to: 1969, colours: ['#b3261e', '#efe3c2', '#b3261e', '#efe3c2'] },
      { name: 'All-over red', from: 1970, to: 1986, colours: ['#b3261e', '#b3261e', W, '#b3261e'] },
    ],
    blurb: 'The big city company: red double-deckers with a cream band, conductors until the seventies.',
  },
  {
    id: 'oakport-ct', name: 'Oakport Corporation Transport', kind: 'bus', code: 'OCT', from: 1930, to: 1986, area: 'city',
    fleet: ['bus-halfcab', 'bus-double', 'bus-single'],
    liveries: [
      { name: 'Corporation green', from: 1930, to: 1969, colours: ['#2f5a3a', '#efe3c2', '#2f5a3a', '#efe3c2'] },
      { name: 'Sunrise orange', from: 1970, to: 1986, colours: ['#e07a1f', W, W, '#5a3a22'] },
    ],
    blurb: 'The council\'s own buses, until deregulation in 1986 sold them off.',
  },
  {
    id: 'rowan', name: 'Rowan Travel', kind: 'bus', code: 'RT', from: 1987, to: 2030, area: 'regional',
    fleet: ['bus-single', 'bus-double', 'minibus', 'coach'],
    liveries: [
      { name: 'Rowan swoops', from: 1987, to: 2008, colours: ['#1f7a4a', '#f2c21a', W, '#1f7a4a'] },
      { name: 'Rowan leaf', from: 2009, to: 2030, colours: ['#1f7a4a', '#9ad04a', '#1f7a4a', W] },
    ],
    blurb: 'A post-deregulation group that bought up the corporation fleets.',
  },
  {
    id: 'tidewell', name: 'Tidewell Buses', kind: 'bus', code: 'TB', from: 1987, to: 2030, area: 'regional',
    fleet: ['bus-single', 'bus-double', 'bus-bendy', 'minibus'],
    liveries: [
      { name: 'Tidewell blue', from: 1987, to: 2030, colours: ['#1f4f9e', W, W, '#6ec1e4'] },
    ],
    blurb: 'Blue and white buses along the coast and into Oakport.',
  },
  {
    id: 'oakport-metro', name: 'Oakport Metro Buses', kind: 'bus', code: 'OM', from: 2008, to: 2030, area: 'city',
    fleet: ['bus-single', 'bus-double', 'bus-bendy'],
    liveries: [{ name: 'Metro plum', from: 2008, to: 2030, colours: ['#5a2a7a', '#b9bdc0', '#5a2a7a', Y] }],
    blurb: 'Franchised city buses in a single plum livery, whoever runs them.',
  },
  {
    id: 'longways', name: 'Longways Coaches', kind: 'coach', code: 'LW', from: 1972, to: 2030, area: 'national',
    fleet: ['coach'],
    liveries: [
      { name: 'Longways stripes', from: 1972, to: 2003, colours: [W, '#c8262e', W, '#1f3f8a'] },
      { name: 'Longways white', from: 2004, to: 2030, colours: [W, '#1f3f8a', W, '#c8262e'] },
    ],
    blurb: 'The national coach network: white coaches with red and blue stripes on every motorway.',
  },
  {
    id: 'sunward', name: 'Sunward Tours', kind: 'coach', code: 'ST', from: 1950, to: 2030, area: 'regional',
    fleet: ['coach', 'bus-heritage'],
    liveries: [
      { name: 'Cream and tangerine', from: 1950, to: 1985, colours: ['#efe3c2', '#e07a1f', '#efe3c2', '#5a3a22'] },
      { name: 'Sunburst', from: 1986, to: 2030, colours: [W, '#f2a81a', W, '#e05a1f'] },
    ],
    blurb: 'Holiday coaches to the seaside and the Lakes.',
  },
  // ---------------- trams ----------------
  {
    id: 'oakport-trams', name: 'Oakport Corporation Tramways', kind: 'tram', code: 'OCT', from: 1900, to: 1955, area: 'city',
    fleet: ['tram-heritage'],
    liveries: [{ name: 'Crimson and cream', from: 1900, to: 1955, colours: ['#7a1f24', '#efe3c2', '#3a3c3f', '#c9a33a'] }],
    blurb: 'Open-balcony double-deck trams, scrapped in 1955 and missed ever since.',
  },
  {
    id: 'oakport-metrotram', name: 'Oakport Metro Tram', kind: 'tram', code: 'OMT', from: 1995, to: 2030, area: 'city',
    fleet: ['tram'],
    liveries: [{ name: 'Metro plum', from: 1995, to: 2030, colours: ['#b9bdc0', '#5a2a7a', '#6e7378', Y] }],
    blurb: 'The trams came back in 1995: low-floor cars on-street and on old railway lines.',
  },
  // ---------------- railways ----------------
  {
    id: 'wessex-mercia', name: 'Wessex & Mercia Railway', kind: 'rail', code: 'WMR', from: 1900, to: 1947, area: 'national',
    fleet: ['steam-tank', 'steam-tender', 'tender', 'coach-stock', 'wagon-box', 'wagon-hopper', 'brake-van'],
    liveries: [
      { name: 'Locomotive blue', from: 1900, to: 1947, colours: ['#1f3060', '#151515', '#151515', '#b3261e'], styles: ['steam-tank', 'steam-tender', 'tender'] },
      { name: 'Claret and gold', from: 1900, to: 1947, colours: ['#5a1f2a', '#5a1f2a', '#3a3c3f', '#c9a33a'], styles: ['coach-stock'] },
      { name: 'Goods grey', from: 1900, to: 1947, colours: ['#6e7378', '#6e7378', '#3a3c3f', W] },
    ],
    blurb: 'A pre-nationalisation company running from the south coast to the Midlands.',
  },
  {
    id: 'north-pennine', name: 'North Pennine Railway', kind: 'rail', code: 'NPR', from: 1900, to: 1947, area: 'national',
    fleet: ['steam-tank', 'steam-tender', 'tender', 'coach-stock', 'wagon-box', 'wagon-hopper', 'brake-van'],
    liveries: [
      { name: 'Moss green', from: 1900, to: 1947, colours: ['#4a6a2a', '#151515', '#151515', '#c9a33a'], styles: ['steam-tank', 'steam-tender', 'tender'] },
      { name: 'Varnished teak', from: 1900, to: 1947, colours: ['#7a4a26', '#7a4a26', '#3a3c3f', '#c9a33a'], styles: ['coach-stock'] },
      { name: 'Goods brown', from: 1900, to: 1947, colours: ['#5a3a22', '#5a3a22', '#3a3c3f', W] },
    ],
    blurb: 'The northern company: coal trains, fast expresses and teak carriages.',
  },
  {
    id: 'kingdom', name: 'Kingdom Railways', kind: 'rail', code: 'KR', from: 1948, to: 1996, area: 'national',
    fleet: ['steam-tank', 'steam-tender', 'tender', 'shunter', 'diesel-loco', 'electric-loco', 'dmu-car', 'emu-car', 'hs-power', 'hs-coach', 'coach-stock', 'wagon-box', 'wagon-hopper', 'wagon-tank', 'wagon-flat', 'wagon-car', 'brake-van'],
    liveries: [
      { name: 'Lined green', from: 1948, to: 1967, colours: ['#1f4a2f', '#151515', '#151515', '#c9a33a'], styles: ['steam-tank', 'steam-tender', 'tender'] },
      { name: 'Traction green', from: 1955, to: 1966, colours: ['#2f5a3a', '#9ab08a', '#6e7378', Y], styles: ['shunter', 'diesel-loco', 'electric-loco', 'dmu-car', 'emu-car'] },
      { name: 'Coaching maroon', from: 1948, to: 1965, colours: ['#6e1f24', '#6e1f24', '#3a3c3f', '#c9a33a'], styles: ['coach-stock'] },
      { name: 'Rail blue', from: 1966, to: 1986, colours: ['#1f3f6a', '#1f3f6a', '#6e7378', Y], styles: ['shunter', 'diesel-loco', 'electric-loco', 'dmu-car', 'emu-car'] },
      { name: 'Blue and grey', from: 1966, to: 1986, colours: ['#1f3f6a', '#c9cdd0', '#6e7378', Y], styles: ['coach-stock', 'hs-coach', 'dmu-car', 'emu-car'] },
      { name: 'Express yellow', from: 1976, to: 1986, colours: ['#1f3f6a', '#c9cdd0', '#6e7378', Y], styles: ['hs-power'] },
      { name: 'Express grey', from: 1987, to: 1996, colours: ['#3f4449', '#b9bdc0', '#3f4449', '#c8262e'], styles: ['diesel-loco', 'electric-loco', 'hs-power', 'hs-coach', 'coach-stock'] },
      { name: 'Suburban stripes', from: 1987, to: 1996, colours: [W, '#1f3f8a', '#6e7378', '#c8262e'], styles: ['dmu-car', 'emu-car'] },
      { name: 'Freight triple grey', from: 1987, to: 1996, colours: ['#9aa0a4', '#3f4449', '#6e7378', Y], styles: ['diesel-loco', 'shunter'] },
      { name: 'Wagon bauxite', from: 1948, to: 1996, colours: ['#7a3a24', '#7a3a24', '#3a3c3f', W], styles: ['wagon-box', 'wagon-hopper', 'wagon-tank', 'wagon-flat', 'wagon-car', 'brake-van'] },
    ],
    blurb: 'The nationalised railway. Green, then blue with yellow ends, then the sector liveries of the late eighties.',
  },
  {
    id: 'pennant', name: 'Pennant Express', kind: 'rail', code: 'PX', from: 1997, to: 2030, area: 'national',
    fleet: ['hs-power', 'hs-coach', 'electric-loco', 'coach-stock', 'emu-car'],
    liveries: [{ name: 'Pennant green and gold', from: 1997, to: 2030, colours: ['#123d33', '#c9a33a', '#3f4449', '#c9a33a'] }],
    blurb: 'The long-distance franchise on the east side of the country.',
  },
  {
    id: 'chalkline', name: 'Chalkline', kind: 'rail', code: 'CL', from: 1996, to: 2030, area: 'regional',
    fleet: ['emu-car', 'dmu-car'],
    liveries: [{ name: 'Chalk and lime', from: 1996, to: 2030, colours: [W, '#8ac43a', '#6e7378', '#3f4449'] }],
    blurb: 'Commuter electrics across the downs into the capital.',
  },
  {
    id: 'moorland', name: 'Moorland Trains', kind: 'rail', code: 'MT', from: 1997, to: 2030, area: 'regional',
    fleet: ['dmu-car', 'emu-car'],
    liveries: [{ name: 'Heather', from: 1997, to: 2030, colours: ['#4a2a6a', '#2a8ac4', '#6e7378', Y] }],
    blurb: 'Rural and regional trains across the northern hills.',
  },
  {
    id: 'harbour-valleys', name: 'Harbour & Valleys', kind: 'rail', code: 'HV', from: 2003, to: 2030, area: 'regional',
    fleet: ['dmu-car', 'emu-car', 'coach-stock', 'diesel-loco'],
    liveries: [{ name: 'Red and teal', from: 2003, to: 2030, colours: ['#c42a2a', '#1f8a8a', '#3f4449', Y] }],
    blurb: 'Valley lines and the coast route in the west.',
  },
  {
    id: 'arrowline', name: 'Arrowline High Speed', kind: 'rail', code: 'AHS', from: 2009, to: 2030, area: 'national',
    fleet: ['hs-power', 'hs-coach'],
    liveries: [{ name: 'Arrow white', from: 2009, to: 2030, colours: [W, '#1f6fe0', '#3f4449', '#1a2a4a'] }],
    blurb: 'The new high-speed line and its white trains.',
  },
  {
    id: 'ironway', name: 'Ironway Freight', kind: 'freight-rail', code: 'IF', from: 1996, to: 2030, area: 'national',
    fleet: ['diesel-loco', 'electric-loco', 'shunter', 'wagon-hopper', 'wagon-tank', 'wagon-flat', 'wagon-car', 'wagon-timber', 'wagon-box'],
    liveries: [
      { name: 'Ironway maroon', from: 1996, to: 2030, colours: ['#6e1f2a', '#e0b42a', '#3f4449', '#e0b42a'], styles: ['diesel-loco', 'electric-loco', 'shunter'] },
      { name: 'Ironway wagons', from: 1996, to: 2030, colours: ['#6e1f2a', '#6e1f2a', '#3a3c3f', W] },
    ],
    blurb: 'The biggest freight operator after privatisation.',
  },
  {
    id: 'blackstone', name: 'Blackstone Rail Haulage', kind: 'freight-rail', code: 'BRH', from: 2000, to: 2030, area: 'national',
    fleet: ['diesel-loco', 'wagon-hopper', 'wagon-flat', 'wagon-tank'],
    liveries: [
      { name: 'Orange and black', from: 2000, to: 2030, colours: ['#e0661f', '#1a1a1a', '#1a1a1a', Y], styles: ['diesel-loco'] },
      { name: 'Blackstone wagons', from: 2000, to: 2030, colours: ['#3a3c3f', '#e0661f', '#3a3c3f', W] },
    ],
    blurb: 'Aggregates, intermodal and anything heavy.',
  },
  {
    id: 'garthmoor', name: 'Garthmoor Mountain Railway', kind: 'rack', code: 'GMR', from: 1896, to: 2030, area: 'regional',
    fleet: ['rack-car'],
    liveries: [{ name: 'Mountain red', from: 1896, to: 2030, colours: ['#9a2a1e', '#efe3c2', '#3a3c3f', '#c9a33a'] }],
    blurb: 'A rack railway to the summit café.',
  },
  // ---------------- road freight ----------------
  {
    id: 'brackenridge', name: 'Brackenridge & Sons', kind: 'haulier', code: 'B', from: 1950, to: 2030, area: 'national',
    fleet: ['tractor', 'trailer-box', 'trailer-curtain', 'rigid-box', 'rigid-curtain'],
    liveries: [{ name: 'Green, red and white', from: 1950, to: 2030, colours: ['#1f5a3a', '#c42a2a', W, '#1f5a3a'] }],
    blurb: 'The haulier every child waves at; each cab has a name on the front.',
  },
  {
    id: 'cairnmoor', name: 'Cairnmoor Logistics', kind: 'haulier', code: 'CM', from: 1995, to: 2030, area: 'national',
    fleet: ['tractor', 'trailer-curtain', 'trailer-box', 'rigid-curtain'],
    liveries: [{ name: 'White and blue', from: 1995, to: 2030, colours: [W, '#1f4f9e', W, '#1f4f9e'] }],
    blurb: 'Supermarket distribution out of the big sheds by the motorway.',
  },
  {
    id: 'pellow', name: 'Pellow Tankers', kind: 'haulier', code: 'PT', from: 1960, to: 2030, area: 'national',
    fleet: ['tractor', 'trailer-tanker', 'rigid-tanker'],
    liveries: [{ name: 'White and red', from: 1960, to: 2030, colours: [W, '#c42a2a', W, '#c42a2a'] }],
    blurb: 'Fuel, milk and chemicals in stainless barrels.',
  },
  {
    id: 'quarrymoor', name: 'Quarrymoor Aggregates', kind: 'haulier', code: 'QA', from: 1955, to: 2030, area: 'regional',
    fleet: ['rigid-tipper', 'mixer', 'tractor', 'trailer-tipper'],
    liveries: [{ name: 'Quarry yellow', from: 1955, to: 2030, colours: ['#e0b42a', '#2f4a2a', '#e0b42a', '#2f4a2a'] }],
    blurb: 'Stone, sand and ready-mixed concrete from the quarries.',
  },
  {
    id: 'northfold', name: 'Northfold Timber', kind: 'haulier', code: 'NT', from: 1950, to: 2030, area: 'regional',
    fleet: ['tractor', 'trailer-logging', 'rigid-flatbed', 'trailer-flatbed'],
    liveries: [{ name: 'Forest', from: 1950, to: 2030, colours: ['#2f4a2a', '#8a5a2a', '#2f4a2a', W] }],
    blurb: 'Logs from the forestry plantations to the sawmills.',
  },
  {
    id: 'dalesmoor', name: 'Dalesmoor Livestock', kind: 'haulier', code: 'DL', from: 1950, to: 2030, area: 'regional',
    fleet: ['tractor', 'trailer-livestock'],
    liveries: [{ name: 'Farm maroon', from: 1950, to: 2030, colours: ['#6e1f2a', '#c9cdd0', '#6e1f2a', W] }],
    blurb: 'Sheep and cattle to market.',
  },
  {
    id: 'carbridge', name: 'Carbridge Vehicle Logistics', kind: 'haulier', code: 'CV', from: 1965, to: 2030, area: 'national',
    fleet: ['tractor', 'trailer-car'],
    liveries: [{ name: 'Blue and white', from: 1965, to: 2030, colours: ['#1f3f8a', W, '#1f3f8a', W] }],
    blurb: 'New cars from the docks and the factories to the dealers.',
  },
  {
    id: 'ferrous-box', name: 'Ferrous Box Lines', kind: 'shipping', code: 'FBL', from: 1968, to: 2030, area: 'national',
    fleet: ['trailer-container', 'container-ship', 'wagon-flat'],
    liveries: [{ name: 'Rust and cream', from: 1968, to: 2030, colours: ['#a8452a', '#efe3c2', '#2b2f33', '#efe3c2'] }],
    blurb: 'A container line whose boxes turn up on lorries, trains and ships.',
  },
  // ---------------- public services ----------------
  {
    id: 'oakport-council', name: 'Oakport City Council', kind: 'council', code: 'OCC', from: 1950, to: 2030, area: 'city',
    fleet: ['refuse', 'gritter', 'van-panel', 'van-small', 'rigid-tipper', 'minibus'],
    liveries: [
      { name: 'Municipal green', from: 1950, to: 1985, colours: ['#2f5a3a', '#2f5a3a', '#2f5a3a', Y] },
      { name: 'White with swoosh', from: 1986, to: 2030, colours: [W, '#1f7a4a', W, '#e09a1c'] },
    ],
    blurb: 'Bin lorries, gritters and the parks department.',
  },
  {
    id: 'oakshire-police', name: 'Oakshire Constabulary', kind: 'police', code: 'OC', from: 1920, to: 2030, area: 'regional',
    fleet: ['police'],
    liveries: [
      { name: 'Black', from: 1920, to: 1964, colours: ['#151515', '#151515', '#151515', W] },
      { name: 'White with a red stripe', from: 1965, to: 1994, colours: [W, '#c42a2a', W, '#1f3f8a'] },
      { name: 'Blue and yellow checks', from: 1995, to: 2030, colours: [W, '#1f3fbf', W, '#e8d21a'] },
    ],
    blurb: 'The county force of the fictional Oakshire.',
  },
  {
    id: 'oakshire-ambulance', name: 'Oakshire Ambulance Service', kind: 'ambulance', code: 'OAS', from: 1948, to: 2030, area: 'regional',
    fleet: ['ambulance'],
    liveries: [
      { name: 'Cream', from: 1948, to: 1985, colours: ['#efe3c2', '#efe3c2', '#efe3c2', '#1f3f8a'] },
      { name: 'White with green', from: 1986, to: 2004, colours: [W, '#1f8a3a', W, '#1f8a3a'] },
      { name: 'Yellow and green checks', from: 2005, to: 2030, colours: ['#e8d21a', '#1f8a3a', '#e8d21a', '#1f8a3a'] },
    ],
    blurb: 'Emergency ambulances for Oakshire.',
  },
  {
    id: 'oakport-hackney', name: 'Oakport Hackney Carriages', kind: 'taxi', code: 'OH', from: 1948, to: 2030, area: 'city',
    fleet: ['taxi'],
    liveries: [
      { name: 'Black cab', from: 1948, to: 2030, colours: ['#141414', '#141414', '#141414', '#f2c14a'] },
      { name: 'Advertising wrap', from: 1990, to: 2030, colours: ['#1f6fb8', '#f2c21a', '#1f6fb8', W] },
    ],
    blurb: 'Licensed cabs on the ranks outside the stations.',
  },
  {
    id: 'nonna-bruna', name: 'Nonna Bruna Ices', kind: 'ice-cream', code: 'NB', from: 1955, to: 2030, area: 'city',
    fleet: ['ice-cream'],
    liveries: [
      { name: 'Strawberry and cream', from: 1955, to: 2030, colours: ['#f2c4c8', '#efe3c2', '#efe3c2', '#b3261e'] },
      { name: 'Mint', from: 1970, to: 2030, colours: ['#b9e0c8', W, W, '#2f7a4a'] },
    ],
    blurb: 'Ice-cream vans with a chime and a cone on the roof.',
  },
  // ---------------- water and air ----------------
  {
    id: 'tamewater-carrying', name: 'Tamewater Carrying Co.', kind: 'canal', code: 'TCC', from: 1900, to: 1970, area: 'regional',
    fleet: ['narrowboat'],
    liveries: [{ name: 'Carrying red and green', from: 1900, to: 1970, colours: ['#2f5a3a', '#7a1f24', '#2b2f33', '#e0b42a'] }],
    blurb: 'Working boats on the cut: coal, grain and beer.',
  },
  {
    id: 'driftwood', name: 'Driftwood Hire Boats', kind: 'canal', code: 'DH', from: 1970, to: 2030, area: 'regional',
    fleet: ['narrowboat'],
    liveries: [{ name: 'Holiday blue', from: 1970, to: 2030, colours: ['#1e2f55', '#e0b42a', '#2b2f33', '#b3261e'] }],
    blurb: 'Holiday narrowboats by the week.',
  },
  {
    id: 'solent-crossways', name: 'Solent Crossways Ferries', kind: 'ferry', code: 'SCF', from: 1960, to: 2030, area: 'regional',
    fleet: ['ferry', 'coaster'],
    liveries: [{ name: 'White and blue', from: 1960, to: 2030, colours: [W, '#1f3f8a', W, '#c42a2a'] }],
    blurb: 'Car ferries to the islands.',
  },
  {
    id: 'larkspur', name: 'Larkspur Airways', kind: 'airline', code: 'LA', from: 1950, to: 2030, area: 'national',
    fleet: ['light-aircraft', 'turboprop', 'airliner', 'widebody'],
    liveries: [
      { name: 'Silver and blue', from: 1950, to: 1985, colours: ['#d9dde0', '#1f3f8a', '#d9dde0', '#1f3f8a'] },
      { name: 'Larkspur violet', from: 1986, to: 2030, colours: [W, '#5a3a9a', W, '#9a7ad0'] },
    ],
    blurb: 'Regional and holiday flights from the city airport.',
  },
];

export const OPERATOR = Object.fromEntries(OPERATORS.map((o) => [o.id, o])) as Record<string, Operator>;

// The livery an operator gave a kind of vehicle in a given year, or undefined if none fits.
export function liveryFor(op: Operator, style: BodyStyle, year: number): LiveryDef | undefined {
  const inYear = op.liveries.filter((l) => year >= l.from && year <= l.to);
  return inYear.find((l) => l.styles?.includes(style)) ?? inYear.find((l) => !l.styles) ?? inYear[0] ?? op.liveries[0];
}
export function operatorsFor(style: BodyStyle, year: number) {
  return OPERATORS.filter((o) => o.fleet.includes(style) && year >= o.from && year <= o.to);
}

// Shipping-container colours: every box in a stack a different line's colour.
export const BOX_COLOURS = ['#a8452a', '#1f5a8a', '#2f6a3a', '#b9bdc0', '#d8a11f', '#6e1f2a', '#1f3f6a', '#e0661f', '#f2f2f0', '#5a6a7a'];
export const boxColour = (seed: number) => pick(rng(seed), BOX_COLOURS);
