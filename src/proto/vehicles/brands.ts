// The brand bible: invented marques, coachbuilders, truck, bus, rail, boat and aircraft makers.
// Every name here is original. Each brand has a national flavour and a design language that the
// builders read (grille, lamps, typical colours, how sporty or upright), and a list of model
// lines; the catalogue (models.ts) expands each line into generations and body styles.
import type { BodyStyle, Category } from './types';

export type Grille = 'oval' | 'bar' | 'tall' | 'bars3' | 'slot' | 'mouth' | 'crate' | 'mesh' | 'closed' | 'wide';
export type SizeClass = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

export interface Line {
  family: string; // the model name, without the brand
  styles: BodyStyle[];
  from: number; to: number;
  gen: number; // years per generation: a long-running line becomes Mk I, Mk II…
  size?: SizeClass;
  blurb?: string;
}

export interface Brand {
  id: string; name: string; country: string; flavour: string;
  from: number; to: number;
  makes: Category[];
  grille: Grille;
  colours: string[]; // the colours the brand is known for
  accent: string; // badge colour; badges are plain shapes, never lookalike logos
  sporty: number; // 0 upright and practical … 1 low and fast
  lines: Line[];
  blurb: string;
}

export const BRANDS: Brand[] = [
  // ---------------- cars ----------------
  {
    id: 'hallbrook', name: 'Hallbrook', country: 'GB', flavour: 'British sports cars', from: 1928, to: 2030, makes: ['car'],
    grille: 'oval', colours: ['#1f4a33', '#b9bdc0', '#f2f2f0', '#9a1f1f', '#e0b42a', '#1e2f55'], accent: '#c9a33a', sporty: 0.9,
    blurb: 'A small works in the Welsh Marches that has built open two-seaters since the late twenties. Long bonnets, short tails, an oval mouth and wire wheels until the seventies; racing green is the house colour.',
    lines: [
      { family: 'Coldharbour', styles: ['convertible', 'classic'], from: 1928, to: 1955, gen: 9, size: 'small' },
      { family: 'Brantley', styles: ['sports', 'coupe'], from: 1956, to: 1981, gen: 9, size: 'small' },
      { family: 'Scarrow', styles: ['coupe', 'sports'], from: 1972, to: 1998, gen: 9, size: 'medium' },
      { family: 'Ridgemont', styles: ['sports', 'convertible'], from: 1995, to: 2030, gen: 9, size: 'small' },
      { family: 'Fennick', styles: ['supercar'], from: 2004, to: 2030, gen: 10, size: 'medium' },
    ],
  },
  {
    id: 'pennard', name: 'Pennard', country: 'GB', flavour: 'British family cars', from: 1922, to: 2005, makes: ['car', 'van'],
    grille: 'bar', colours: ['#2b4a73', '#b3261e', '#f2efe6', '#6b4a2b', '#2f5a3a'], accent: '#c9cdd0', sporty: 0.25,
    blurb: 'The Midlands volume maker: the car your uncle had. Honest saloons and estates, a wide bar grille, later a string of hatchbacks, and vans for every trade. Went under in 2005.',
    lines: [
      { family: 'Thorley', styles: ['classic', 'saloon'], from: 1922, to: 1954, gen: 8, size: 'medium' },
      { family: 'Kelsall', styles: ['saloon', 'estate'], from: 1948, to: 1984, gen: 9, size: 'medium' },
      { family: 'Marden', styles: ['hatchback', 'saloon'], from: 1959, to: 2005, gen: 9, size: 'small' },
      { family: 'Hepworth', styles: ['hatchback', 'saloon', 'estate'], from: 1976, to: 2005, gen: 8, size: 'medium' },
      { family: 'Radcot', styles: ['saloon'], from: 1962, to: 1999, gen: 10, size: 'large' },
      { family: 'Coverdale', styles: ['van-small', 'van-panel'], from: 1955, to: 2005, gen: 12 },
    ],
  },
  {
    id: 'chalcott', name: 'Chalcott', country: 'GB', flavour: 'British luxury', from: 1908, to: 2030, makes: ['car'],
    grille: 'tall', colours: ['#4a1c22', '#1e2a45', '#151515', '#b9bdc0', '#e8e0c8', '#2a3a2f'], accent: '#d9dde0', sporty: 0.35,
    blurb: 'Coachbuilt saloons for people with drivers. A tall upright grille, round lamps long after everyone else, deep paint in claret, navy and black, and plenty of chrome.',
    lines: [
      { family: 'Ormond', styles: ['classic'], from: 1908, to: 1939, gen: 10, size: 'large' },
      { family: 'Highcombe', styles: ['saloon'], from: 1946, to: 2030, gen: 11, size: 'large' },
      { family: 'Carlyon', styles: ['coupe', 'convertible'], from: 1955, to: 2030, gen: 12, size: 'large' },
      { family: 'Aldwych', styles: ['suv'], from: 2016, to: 2030, gen: 8, size: 'large' },
    ],
  },
  {
    id: 'varnholt', name: 'Varnholt', country: 'DE', flavour: 'German executive', from: 1926, to: 2030, makes: ['car', 'van'],
    grille: 'bars3', colours: ['#b9bdc0', '#141414', '#1e2f55', '#f2f2f0', '#6a6e72'], accent: '#8a969e', sporty: 0.55,
    blurb: 'Stuttgart-flavoured engineering from a fictional Swabian town. A three-bar grille in a chrome frame, rectangular then slim lamps, silver and black paint, and a van range that tradespeople swear by.',
    lines: [
      { family: 'Kaltern', styles: ['saloon'], from: 1950, to: 2030, gen: 9, size: 'large' },
      { family: 'Staufen', styles: ['saloon', 'estate'], from: 1955, to: 2030, gen: 8, size: 'medium' },
      { family: 'Lindach', styles: ['hatchback'], from: 1974, to: 2030, gen: 8, size: 'small' },
      { family: 'Reisach', styles: ['coupe', 'convertible'], from: 1962, to: 2030, gen: 10, size: 'medium' },
      { family: 'Oberau', styles: ['suv'], from: 1998, to: 2030, gen: 7, size: 'large' },
      { family: 'Lastwerk', styles: ['van-panel', 'minibus', 'ambulance'], from: 1965, to: 2030, gen: 10 },
    ],
  },
  {
    id: 'norrvik', name: 'Norrvik', country: 'SE', flavour: 'Swedish estates', from: 1944, to: 2030, makes: ['car'],
    grille: 'wide', colours: ['#f2f2f0', '#1e2f55', '#c8b48a', '#2a3a2f', '#b9bdc0', '#6b2f2a'], accent: '#2f6fb8', sporty: 0.2,
    blurb: 'Boxy, safe and long-lived, from a works on the Baltic coast. Square estates with near-vertical tailgates, a wide flat grille and big rectangular lamps; beige and navy in the eighties.',
    lines: [
      { family: 'Tornby', styles: ['estate', 'saloon'], from: 1956, to: 1996, gen: 10, size: 'medium' },
      { family: 'Vallen', styles: ['estate', 'saloon'], from: 1990, to: 2030, gen: 8, size: 'large' },
      { family: 'Halsa', styles: ['hatchback'], from: 1995, to: 2030, gen: 9, size: 'small' },
      { family: 'Fjallby', styles: ['suv'], from: 2003, to: 2030, gen: 8, size: 'large' },
    ],
  },
  {
    id: 'vessanti', name: 'Vessanti', country: 'IT', flavour: 'Italian supercars', from: 1955, to: 2030, makes: ['car'],
    grille: 'mouth', colours: ['#c21a1a', '#f2c01a', '#f2f2f0', '#141414', '#e86a1a', '#1f6a3a'], accent: '#f2c01a', sporty: 1,
    blurb: 'A Modenese-flavoured house of mid-engined wedges and front-engined grand tourers. A low wide mouth, pop-up lamps in the seventies and eighties, and red, yellow or orange paint.',
    lines: [
      { family: 'Brivido', styles: ['sports'], from: 1955, to: 1985, gen: 10, size: 'small' },
      { family: 'Ostrega', styles: ['coupe'], from: 1962, to: 2030, gen: 11, size: 'large' },
      { family: 'Talmira', styles: ['supercar'], from: 1968, to: 2030, gen: 9, size: 'medium' },
      { family: 'Corvenza', styles: ['supercar'], from: 1990, to: 2030, gen: 8, size: 'large' },
    ],
  },
  {
    id: 'morikawa', name: 'Morikawa', country: 'JP', flavour: 'Japanese reliability', from: 1960, to: 2030, makes: ['car', 'van', 'rail', 'boat'],
    grille: 'slot', colours: ['#f2f2f0', '#b9bdc0', '#cbbd96', '#b3261e', '#1e2f55'], accent: '#b3261e', sporty: 0.4,
    blurb: 'Never breaks down. Neat hatchbacks and saloons with a thin slot grille and wraparound lamps, pickups that outlive their owners, and a heavy-industry arm that builds trains and ships.',
    lines: [
      { family: 'Kiyora', styles: ['saloon', 'estate'], from: 1966, to: 2030, gen: 7, size: 'medium' },
      { family: 'Aobaru', styles: ['hatchback'], from: 1968, to: 2030, gen: 7, size: 'small' },
      { family: 'Tessai', styles: ['coupe', 'sports'], from: 1970, to: 2010, gen: 8, size: 'small' },
      { family: 'Ranzo', styles: ['pickup', 'suv'], from: 1978, to: 2030, gen: 9, size: 'large' },
      { family: 'Harukaze', styles: ['mpv'], from: 1990, to: 2030, gen: 9, size: 'large' },
      { family: 'Nimotsu', styles: ['van-small'], from: 1975, to: 2030, gen: 9 },
    ],
  },
  {
    id: 'hardesty', name: 'Hardesty', country: 'US', flavour: 'American muscle and pickups', from: 1910, to: 2030, makes: ['car'],
    grille: 'crate', colours: ['#b3261e', '#141414', '#f2f2f0', '#1c2a55', '#8a5a2a', '#7aa82a'], accent: '#d9dde0', sporty: 0.6,
    blurb: 'Detroit-flavoured and proud of it. An egg-crate chrome grille, twin round lamps, big V8 coupés with bonnet scoops and pickups the size of a garage.',
    lines: [
      { family: 'Boulevardier', styles: ['classic', 'saloon'], from: 1910, to: 1975, gen: 10, size: 'large' },
      { family: 'Centerfire', styles: ['coupe'], from: 1964, to: 2030, gen: 8, size: 'large' },
      { family: 'Tallgrass', styles: ['pickup'], from: 1948, to: 2030, gen: 9, size: 'huge' },
      { family: 'Mesaline', styles: ['suv'], from: 1985, to: 2030, gen: 9, size: 'huge' },
    ],
  },
  {
    id: 'lavergne', name: 'Lavergne', country: 'FR', flavour: 'French people-carriers', from: 1919, to: 2030, makes: ['car', 'van'],
    grille: 'slot', colours: ['#8fb0cf', '#e8e0c8', '#b3261e', '#c89a2a', '#6d7a86', '#f2f2f0'], accent: '#e0b42a', sporty: 0.2,
    blurb: 'Soft suspension and softer shapes from a Loire valley works. One-box people-carriers, quirky small hatchbacks and tall little vans, in pastel blue, cream and mustard.',
    lines: [
      { family: 'Grenadine', styles: ['hatchback'], from: 1948, to: 1990, gen: 12, size: 'tiny' },
      { family: 'Sillage', styles: ['saloon', 'estate'], from: 1955, to: 2010, gen: 9, size: 'medium' },
      { family: 'Passerelle', styles: ['hatchback'], from: 1972, to: 2030, gen: 8, size: 'small' },
      { family: 'Escale', styles: ['mpv'], from: 1984, to: 2030, gen: 8, size: 'large' },
      { family: 'Bivouac', styles: ['van-small'], from: 1996, to: 2030, gen: 8 },
    ],
  },
  {
    id: 'fellgate', name: 'Fellgate', country: 'GB', flavour: 'British off-roaders', from: 1948, to: 2030, makes: ['car'],
    grille: 'mesh', colours: ['#6f7a5a', '#c8b48a', '#f2f2f0', '#23392a', '#141414'], accent: '#6f7a5a', sporty: 0.1,
    blurb: 'Farm and fell machines from Cumbria-flavoured country. Flat panels, a plain mesh grille, round lamps in the wings and sage green paint; later, leather-lined estates for the school run.',
    lines: [
      { family: 'Ghyllside', styles: ['suv'], from: 1948, to: 2016, gen: 17, size: 'medium' },
      { family: 'Tarnhow', styles: ['suv'], from: 1970, to: 2030, gen: 12, size: 'large' },
      { family: 'Scarthwaite', styles: ['pickup'], from: 1956, to: 2030, gen: 15, size: 'medium' },
    ],
  },
  {
    id: 'tollworth', name: 'Tollworth', country: 'GB', flavour: 'British small cars', from: 1946, to: 1985, makes: ['car'],
    grille: 'bar', colours: ['#9bb6c9', '#e8e0c8', '#b3261e', '#a7c0a0', '#e0b43a'], accent: '#f2f2f0', sporty: 0.2,
    blurb: 'Tiny post-war runabouts built to beat petrol rationing: minimal bonnets, ten-inch wheels and cheerful colours.',
    lines: [
      { family: 'Minnowby', styles: ['hatchback'], from: 1950, to: 1985, gen: 12, size: 'tiny' },
      { family: 'Sprocketts', styles: ['saloon'], from: 1946, to: 1968, gen: 11, size: 'tiny' },
    ],
  },
  {
    id: 'ludgate', name: 'Ludgate', country: 'GB', flavour: 'London-style cabs', from: 1948, to: 2030, makes: ['car'],
    grille: 'tall', colours: ['#141414'], accent: '#f2c14a', sporty: 0,
    blurb: 'The Ludgate Cab Company builds purpose-made hackney carriages: upright, tall enough for a top hat, with a turning circle tighter than a bus. A lit sign on the roof, black paint by default.',
    lines: [{ family: 'Hailer', styles: ['taxi'], from: 1948, to: 2030, gen: 17, size: 'medium' }],
  },
  {
    id: 'lumora', name: 'Lumora', country: 'US', flavour: 'Electric newcomer', from: 2018, to: 2030, makes: ['car'],
    grille: 'closed', colours: ['#f2f2f0', '#141414', '#80858a', '#2a4f8a', '#b3261e'], accent: '#6ec1e4', sporty: 0.5,
    blurb: 'A software company that makes cars. Closed fronts, a light strip nose to tail, glass roofs and flush handles.',
    lines: [
      { family: 'Aurelle', styles: ['saloon'], from: 2018, to: 2030, gen: 6, size: 'large' },
      { family: 'Vantis', styles: ['suv'], from: 2020, to: 2030, gen: 6, size: 'large' },
      { family: 'Solenne', styles: ['hatchback'], from: 2022, to: 2030, gen: 6, size: 'small' },
    ],
  },
  {
    id: 'dravnik', name: 'Dravnik', country: 'YU', flavour: 'Eastern-bloc bargains', from: 1966, to: 1998, makes: ['car'],
    grille: 'bar', colours: ['#c89a2a', '#6f7a32', '#e8e0c8', '#9a2a1e', '#8fb0cf'], accent: '#c9cdd0', sporty: 0.1,
    blurb: 'The cheapest new car in the showroom, built under licence in a Balkan river town. Boxy, square-lamped and painted whatever came off the line that week.',
    lines: [
      { family: 'Kosava', styles: ['saloon', 'estate'], from: 1966, to: 1998, gen: 10, size: 'medium' },
      { family: 'Branica', styles: ['hatchback'], from: 1978, to: 1998, gen: 10, size: 'small' },
    ],
  },
  // ---------------- vans ----------------
  {
    id: 'bramwell', name: 'Bramwell', country: 'GB', flavour: 'British commercials', from: 1930, to: 2030, makes: ['van'],
    grille: 'bar', colours: ['#f2f2f0', '#2b4a73', '#b3261e', '#e0b42a'], accent: '#f2f2f0', sporty: 0,
    blurb: 'Luton-built vans, minibuses and conversions. If a plumber, a removals firm or a school owns it, it is probably a Bramwell.',
    lines: [
      { family: 'Drayman', styles: ['van-panel'], from: 1935, to: 2030, gen: 12 },
      { family: 'Roundsman', styles: ['van-luton'], from: 1950, to: 2030, gen: 13 },
      { family: 'Tallyman', styles: ['minibus'], from: 1960, to: 2030, gen: 12 },
      { family: 'Parlour', styles: ['ice-cream'], from: 1955, to: 2030, gen: 15 },
      { family: 'Paramed', styles: ['ambulance'], from: 1975, to: 2030, gen: 12 },
    ],
  },
  // ---------------- lorries and trailers ----------------
  {
    id: 'dunmore', name: 'Dunmore', country: 'GB', flavour: 'British heavy lorries', from: 1925, to: 2005, makes: ['lorry'],
    grille: 'bar', colours: ['#2f5a8a', '#b3261e', '#2f5a3a', '#f2f2f0'], accent: '#d9dde0', sporty: 0,
    blurb: 'Lancashire-flavoured heavy lorries: bonneted until the fifties, then square steel cabs, then the long-haul sleepers of the eighties. Also the council\'s bin lorries and gritters.',
    lines: [
      { family: 'Tollgate', styles: ['rigid-box', 'rigid-curtain', 'rigid-flatbed', 'rigid-tipper', 'rigid-tanker'], from: 1930, to: 2005, gen: 12 },
      { family: 'Ironbridge', styles: ['tractor'], from: 1955, to: 2005, gen: 12 },
      { family: 'Wardline', styles: ['refuse', 'gritter'], from: 1950, to: 2005, gen: 14 },
    ],
  },
  {
    id: 'stalberg', name: 'Stalberg', country: 'SE', flavour: 'Swedish trucks and buses', from: 1950, to: 2030, makes: ['lorry', 'bus'],
    grille: 'wide', colours: ['#f2f2f0', '#b3261e', '#1e2f55', '#e0b42a'], accent: '#c9cdd0', sporty: 0,
    blurb: 'Tall cabs, big engines, chrome lamp bars on the roof. The long-distance driver\'s favourite, and a line of city buses.',
    lines: [
      { family: 'Hovraby', styles: ['tractor'], from: 1960, to: 2030, gen: 10 },
      { family: 'Tundrik', styles: ['rigid-tipper', 'mixer', 'rigid-box'], from: 1965, to: 2030, gen: 10 },
      { family: 'Glidare', styles: ['bus-single', 'bus-double'], from: 1995, to: 2030, gen: 10 },
    ],
  },
  {
    id: 'oostvaart', name: 'Oostvaart', country: 'NL', flavour: 'Dutch distribution trucks', from: 1950, to: 2030, makes: ['lorry'],
    grille: 'slot', colours: ['#f2f2f0', '#2f6fb8', '#b9bdc0', '#1a1a1a'], accent: '#2f6fb8', sporty: 0,
    blurb: 'Neat flat-fronted cabs from the polders, built for supermarket rounds and ports.',
    lines: [
      { family: 'Polderman', styles: ['tractor'], from: 1962, to: 2030, gen: 10 },
      { family: 'Dijkman', styles: ['rigid-box', 'rigid-curtain', 'refuse', 'recovery'], from: 1960, to: 2030, gen: 10 },
    ],
  },
  {
    id: 'hessling', name: 'Hessling', country: 'DE', flavour: 'German construction trucks', from: 1930, to: 2030, makes: ['lorry'],
    grille: 'bars3', colours: ['#f2f2f0', '#e0b42a', '#6a6e72', '#2f5a3a'], accent: '#8a969e', sporty: 0,
    blurb: 'Tippers, mixers and crane lorries with a three-bar grille, built like the bridges they help build.',
    lines: [
      { family: 'Fernfahrer', styles: ['tractor'], from: 1965, to: 2030, gen: 11 },
      { family: 'Baulast', styles: ['rigid-tipper', 'mixer', 'rigid-flatbed', 'recovery', 'gritter'], from: 1955, to: 2030, gen: 11 },
    ],
  },
  {
    id: 'kettleby', name: 'Kettleby', country: 'GB', flavour: 'Trailers', from: 1945, to: 2030, makes: ['trailer'],
    grille: 'bar', colours: ['#f2f2f0', '#b9bdc0'], accent: '#b3261e', sporty: 0,
    blurb: 'Every kind of semi-trailer: boxes, curtain-siders, tankers, tippers, flats, skeletals, car transporters, timber bolsters and livestock floats.',
    lines: [
      { family: 'Box', styles: ['trailer-box'], from: 1950, to: 2030, gen: 20 },
      { family: 'Curtainside', styles: ['trailer-curtain'], from: 1968, to: 2030, gen: 20 },
      { family: 'Tanker', styles: ['trailer-tanker'], from: 1950, to: 2030, gen: 20 },
      { family: 'Tipper', styles: ['trailer-tipper'], from: 1955, to: 2030, gen: 20 },
      { family: 'Flat', styles: ['trailer-flatbed'], from: 1945, to: 2030, gen: 25 },
      { family: 'Skeletal', styles: ['trailer-container'], from: 1968, to: 2030, gen: 20 },
      { family: 'Transporter', styles: ['trailer-car'], from: 1960, to: 2030, gen: 20 },
      { family: 'Bolster', styles: ['trailer-logging'], from: 1950, to: 2030, gen: 25 },
      { family: 'Stockfloat', styles: ['trailer-livestock'], from: 1955, to: 2030, gen: 25 },
    ],
  },
  // ---------------- buses and coaches ----------------
  {
    id: 'aldermoor', name: 'Aldermoor', country: 'GB', flavour: 'British buses', from: 1920, to: 2030, makes: ['bus'],
    grille: 'bar', colours: ['#b3261e', '#2f5a3a', '#e07a1f'], accent: '#f2f2f0', sporty: 0,
    blurb: 'Bus builder to half the corporations in the country: bonneted saloons, front-engined half-cab double-deckers with open platforms, then rear-engined deckers and low-floor single-deckers.',
    lines: [
      { family: 'Burgess', styles: ['bus-heritage'], from: 1920, to: 1950, gen: 10 },
      { family: 'Townsman', styles: ['bus-halfcab'], from: 1945, to: 1968, gen: 12 },
      { family: 'Kerbline', styles: ['bus-double'], from: 1968, to: 2030, gen: 11 },
      { family: 'Paradeway', styles: ['bus-single'], from: 1965, to: 2030, gen: 11 },
    ],
  },
  {
    id: 'penrose', name: 'Penrose', country: 'GB', flavour: 'Coachbuilders', from: 1925, to: 2030, makes: ['bus'],
    grille: 'wide', colours: ['#f2f2f0', '#e8e0c8'], accent: '#c9a33a', sporty: 0.2,
    blurb: 'Coach bodies with sweeping side mouldings and raked screens, for tours, holidays and the motorway network.',
    lines: [
      { family: 'Tourette', styles: ['bus-heritage'], from: 1925, to: 1949, gen: 12 },
      { family: 'Stargazer', styles: ['coach'], from: 1950, to: 2030, gen: 10 },
    ],
  },
  {
    id: 'vellmar', name: 'Vellmar', country: 'DE', flavour: 'Continental buses, trams and trains', from: 1990, to: 2030, makes: ['bus', 'rail'],
    grille: 'closed', colours: ['#f2f2f0', '#b9bdc0'], accent: '#6ec1e4', sporty: 0.3,
    blurb: 'Articulated buses, low-floor trams, electric multiple units and high-speed sets from a Hessian-flavoured works.',
    lines: [
      { family: 'Lindwurm', styles: ['bus-bendy'], from: 1990, to: 2030, gen: 10 },
      { family: 'Kurvenlauf', styles: ['tram'], from: 1995, to: 2030, gen: 12 },
      { family: 'Pendelzug', styles: ['emu-car'], from: 1995, to: 2030, gen: 12 },
      { family: 'Pfeilzug', styles: ['hs-power', 'hs-coach'], from: 2008, to: 2030, gen: 11 },
    ],
  },
  // ---------------- rail ----------------
  {
    id: 'kingsholme', name: 'Kingsholme Works', country: 'GB', flavour: 'Steam and wooden stock', from: 1850, to: 1965, makes: ['rail'],
    grille: 'bar', colours: ['#1f4a2f', '#1f3060', '#151515'], accent: '#c9a33a', sporty: 0,
    blurb: 'A railway-town works that built tank engines, express engines, panelled carriages and four-wheeled wagons for a century.',
    lines: [
      { family: 'Beacon class', styles: ['steam-tank'], from: 1900, to: 1962, gen: 20 },
      { family: 'Wolds class', styles: ['steam-tender'], from: 1905, to: 1962, gen: 18 },
      { family: 'Panelled coach', styles: ['coach-stock'], from: 1900, to: 1962, gen: 20 },
      { family: 'Goods van', styles: ['wagon-box'], from: 1900, to: 1985, gen: 30 },
      { family: 'Mineral wagon', styles: ['wagon-hopper'], from: 1900, to: 1990, gen: 30 },
      { family: 'Brake van', styles: ['brake-van'], from: 1900, to: 1990, gen: 30 },
    ],
  },
  {
    id: 'brackwell', name: 'Brackwell Traction', country: 'GB', flavour: 'Diesel and electric', from: 1950, to: 2030, makes: ['rail'],
    grille: 'bar', colours: ['#2f5a3a', '#1f3f6a'], accent: '#f2c21a', sporty: 0,
    blurb: 'Diesel shunters, main-line diesels and electrics, railcars, suburban electrics, high-speed power cars and modern freight wagons.',
    lines: [
      { family: 'Yardman', styles: ['shunter'], from: 1953, to: 1995, gen: 21 },
      { family: 'Haulmaster', styles: ['diesel-loco'], from: 1958, to: 2030, gen: 12 },
      { family: 'Voltmaster', styles: ['electric-loco'], from: 1960, to: 2030, gen: 14 },
      { family: 'Branchliner', styles: ['dmu-car'], from: 1955, to: 2030, gen: 15 },
      { family: 'Suburbia', styles: ['emu-car'], from: 1955, to: 2012, gen: 19 },
      { family: 'Expressliner', styles: ['hs-power', 'hs-coach'], from: 1976, to: 2012, gen: 18 },
      { family: 'Standard coach', styles: ['coach-stock'], from: 1951, to: 2030, gen: 15 },
      { family: 'Bogie hopper', styles: ['wagon-hopper'], from: 1965, to: 2030, gen: 22 },
      { family: 'Tank wagon', styles: ['wagon-tank'], from: 1950, to: 2030, gen: 25 },
      { family: 'Container flat', styles: ['wagon-flat'], from: 1965, to: 2030, gen: 22 },
      { family: 'Car carrier', styles: ['wagon-car'], from: 1970, to: 2030, gen: 30 },
      { family: 'Timber flat', styles: ['wagon-timber'], from: 1960, to: 2030, gen: 35 },
    ],
  },
  {
    id: 'hurlstone', name: 'Hurlstone Car Works', country: 'GB', flavour: 'Heritage trams', from: 1895, to: 1955, makes: ['rail'],
    grille: 'bar', colours: ['#7a1f24', '#efe3c2'], accent: '#c9a33a', sporty: 0,
    blurb: 'Double-deck street tramcars with open balconies and trolley poles.',
    lines: [{ family: 'Balcony car', styles: ['tram-heritage'], from: 1900, to: 1955, gen: 20 }],
  },
  {
    id: 'almstaig', name: 'Almstaig', country: 'CH', flavour: 'Mountain railways', from: 1890, to: 2030, makes: ['rail'],
    grille: 'bar', colours: ['#9a2a1e', '#efe3c2'], accent: '#c9a33a', sporty: 0,
    blurb: 'Alpine rack railcars with a cog under the floor and a body built for steep hills.',
    lines: [{ family: 'Gipfelwagen', styles: ['rack-car'], from: 1900, to: 2030, gen: 32 }],
  },
  {
    id: 'morikawa-rail', name: 'Morikawa Heavy Industries', country: 'JP', flavour: 'Modern trains and ships', from: 2005, to: 2030, makes: ['rail', 'boat'],
    grille: 'closed', colours: ['#f2f2f0'], accent: '#b3261e', sporty: 0.3,
    blurb: 'The heavy-industry side of Morikawa: aluminium bi-mode units and the container ships that bring the cars over.',
    lines: [
      { family: 'Kaido', styles: ['dmu-car', 'emu-car'], from: 2012, to: 2030, gen: 10 },
      { family: 'Oceanrunner', styles: ['container-ship'], from: 2005, to: 2030, gen: 12 },
    ],
  },
  // ---------------- water and air ----------------
  {
    id: 'tamewater', name: 'Tamewater', country: 'GB', flavour: 'Canal boats', from: 1880, to: 2030, makes: ['boat'],
    grille: 'bar', colours: ['#2f5a3a', '#7a1f24', '#1e2f55'], accent: '#e0b42a', sporty: 0,
    blurb: 'Narrowboats: working boats with cloths over the hold, later hire and live-aboard boats with roses and castles.',
    lines: [{ family: 'Narrowboat', styles: ['narrowboat'], from: 1900, to: 2030, gen: 40 }],
  },
  {
    id: 'saltmarsh', name: 'Saltmarsh Yard', country: 'GB', flavour: 'Coastal shipbuilders', from: 1900, to: 2030, makes: ['boat'],
    grille: 'bar', colours: ['#2b2f33', '#f2f2f0'], accent: '#b3261e', sporty: 0,
    blurb: 'River barges, coasters and car ferries from an estuary yard.',
    lines: [
      { family: 'Lighter', styles: ['barge'], from: 1900, to: 2030, gen: 40 },
      { family: 'Coaster', styles: ['coaster'], from: 1920, to: 2030, gen: 30 },
      { family: 'Crossway', styles: ['ferry'], from: 1960, to: 2030, gen: 25 },
    ],
  },
  {
    id: 'pellingham', name: 'Pellingham Aircraft', country: 'GB', flavour: 'Light aircraft and turboprops', from: 1920, to: 2030, makes: ['air'],
    grille: 'bar', colours: ['#f2f2f0', '#b3261e'], accent: '#1e2f55', sporty: 0.5,
    blurb: 'Club monoplanes and regional turboprops from a grass airfield in the Home Counties.',
    lines: [
      { family: 'Fairmead', styles: ['light-aircraft'], from: 1930, to: 2030, gen: 25 },
      { family: 'Cloudrunner', styles: ['turboprop'], from: 1960, to: 2030, gen: 20 },
    ],
  },
  {
    id: 'aerovance', name: 'Aerovance', country: 'EU', flavour: 'Jet airliners', from: 1970, to: 2030, makes: ['air'],
    grille: 'closed', colours: ['#f2f2f0'], accent: '#2f6fb8', sporty: 0.5,
    blurb: 'A European consortium building narrow-body and wide-body jets.',
    lines: [
      { family: 'Contrail', styles: ['airliner'], from: 1972, to: 2030, gen: 18 },
      { family: 'Oceanic', styles: ['widebody'], from: 1975, to: 2030, gen: 20 },
    ],
  },
];

export const BRAND = Object.fromEntries(BRANDS.map((b) => [b.id, b])) as Record<string, Brand>;
