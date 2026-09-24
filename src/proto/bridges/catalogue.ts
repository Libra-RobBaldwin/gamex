// The bridge catalogue: every kind of bridge the player can build, as data. Like the road
// catalogue, the numbers are loosely real (UK practice and prices from the 2020s), so that the
// choice between types falls out of the crossing rather than being scripted: a timber trestle is
// cheap but short-spanned, weak and slow; a suspension bridge crosses an estuary but can't carry
// a railway. Money is in real pounds here and turned into game money with COST_SCALE in one place.

export type BridgeId =
  | 'trestle' | 'masonry' | 'girder' | 'truss-through' | 'truss-deck' | 'beam' | 'box'
  | 'arch-concrete' | 'arch-tied' | 'cable-stayed' | 'suspension' | 'bascule';
export type Material = 'timber' | 'stone' | 'steel' | 'concrete';
// multi: a row of similar spans on piers. main: one big span (between pylons, towers, arch
// springings or the moving leaves) with ordinary approach spans either side.
export type Layout = 'multi' | 'main';

export interface BridgeDef {
  id: BridgeId; label: string; icon: string; material: Material; layout: Layout; blurb: string;
  // clear distance between supports, and the whole bridge end to end (metres)
  span: { min: number; max: number };
  length: { min: number; max: number };
  // structural depth below the road surface for a span of `len`: max(min, len / ratio)
  depth: { min: number; ratio: number };
  // arches: how far the arch drops from its crown to its springings, as a fraction of the span
  rise?: number;
  // height of the structure above the deck (trusses, arch ribs, pylons, towers) for a span of `len`
  above?: (len: number) => number;
  maxPier: number; // tallest pier it can stand on (m)
  maxGrade: number; // steepest deck it can be built to
  // what it can carry: gross road vehicle (t) and rail axle load (t; 0 = no railway)
  roadTonnes: number; railAxle: number;
  roadMph?: number; railMph?: number; // speed limit on the bridge, if any
  era: { from: number; to?: number }; // years it can be built in
  // cost (real £): deck per m², growing towards the longest spans; each pier (fixed + per metre
  // of height); each end; and upkeep per m² of deck a year
  cost: { deck: number; pier: number; pierPerM: number; abutment: number; maint: number; main?: number; mainPerM?: number };
  // movable bridges: seconds the road is shut for each opening (warn, lift, boat passes, lower)
  opening?: { lift: number; pass: number; warn: number };
}

// Real pounds to game money. Chosen so a 60 m three-span concrete bridge carrying a street over a
// road costs about what the flat RAISE_COST in roads.ts charges today (£90k against £77k), so
// integrating doesn't upset the balance. Unlike RAISE_COST it grows with the deck's width.
export const COST_SCALE = 0.03;
// What a year of upkeep is worth when comparing whole-life cost (30 years, undiscounted: simple
// enough for a player to follow).
export const LIFE_YEARS = 30;

// Deck price rises towards the longest spans a type can manage (heavier sections, harder erection).
export const deckRate = (d: BridgeDef, len: number) => d.cost.deck * (1 + 0.8 * Math.min(1.2, len / d.span.max) ** 2);
export const depthOf = (d: BridgeDef, len: number) => Math.max(d.depth.min, len / d.depth.ratio);

const B: BridgeDef[] = [
  {
    id: 'trestle', label: 'Timber trestle', icon: '🪵', material: 'timber', layout: 'multi',
    blurb: 'Cheap and quick. Short spans on splayed timber bents; light loads, slow, rots',
    span: { min: 4, max: 12 }, length: { min: 15, max: 600 }, depth: { min: 0.9, ratio: 12 },
    maxPier: 30, maxGrade: 0.04, roadTonnes: 18, railAxle: 20, roadMph: 30, railMph: 30,
    era: { from: 1830, to: 1930 },
    cost: { deck: 1400, pier: 25000, pierPerM: 3000, abutment: 60000, maint: 45 },
  },
  {
    id: 'masonry', label: 'Masonry arch viaduct', icon: '🧱', material: 'stone', layout: 'multi',
    blurb: 'Stone arches on tall piers. Carries anything for ever, but slow and costly to build',
    span: { min: 6, max: 40 }, length: { min: 20, max: 1200 }, depth: { min: 1.1, ratio: 40 }, rise: 0.5,
    maxPier: 50, maxGrade: 0.04, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1750, to: 1940 },
    cost: { deck: 5200, pier: 120000, pierPerM: 22000, abutment: 250000, maint: 6 },
  },
  {
    id: 'girder', label: 'Steel girder', icon: '🟩', material: 'steel', layout: 'multi',
    blurb: 'Plate girders on piers: the workhorse railway bridge. Needs painting',
    span: { min: 8, max: 50 }, length: { min: 10, max: 1500 }, depth: { min: 1.2, ratio: 16 },
    maxPier: 70, maxGrade: 0.08, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1845 },
    cost: { deck: 3800, pier: 110000, pierPerM: 12000, abutment: 200000, maint: 20 },
  },
  {
    id: 'truss-through', label: 'Steel truss (through)', icon: '🔺', material: 'steel', layout: 'multi',
    blurb: 'Trusses either side, traffic runs between them. Long spans with a shallow floor',
    span: { min: 30, max: 180 }, length: { min: 30, max: 3500 }, depth: { min: 1.5, ratio: 90 },
    above: (len) => Math.min(16, Math.max(6, len / 7)),
    maxPier: 80, maxGrade: 0.06, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1850 },
    cost: { deck: 5600, pier: 180000, pierPerM: 16000, abutment: 250000, maint: 30 },
  },
  {
    id: 'truss-deck', label: 'Steel truss (deck)', icon: '🔻', material: 'steel', layout: 'multi',
    blurb: 'Trusses under the deck: open views, but deep, so the deck sits high',
    span: { min: 30, max: 150 }, length: { min: 30, max: 2500 }, depth: { min: 3, ratio: 9 },
    maxPier: 90, maxGrade: 0.06, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1860 },
    cost: { deck: 5000, pier: 170000, pierPerM: 16000, abutment: 250000, maint: 28 },
  },
  {
    id: 'beam', label: 'Concrete beam', icon: '⬜', material: 'concrete', layout: 'multi',
    blurb: 'Precast prestressed beams on columns. The cheapest modern bridge',
    span: { min: 8, max: 45 }, length: { min: 10, max: 3000 }, depth: { min: 1.2, ratio: 20 },
    maxPier: 60, maxGrade: 0.08, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1950 },
    cost: { deck: 2900, pier: 90000, pierPerM: 9000, abutment: 150000, maint: 8 },
  },
  {
    id: 'box', label: 'Concrete box girder', icon: '🟫', material: 'concrete', layout: 'multi',
    blurb: 'Haunched box built out from each pier. Long spans, tall piers, low upkeep',
    span: { min: 40, max: 250 }, length: { min: 60, max: 5000 }, depth: { min: 2.2, ratio: 18 }, // at the piers; about half that at midspan
    maxPier: 120, maxGrade: 0.08, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1965 },
    cost: { deck: 4300, pier: 350000, pierPerM: 20000, abutment: 250000, maint: 10 },
  },
  {
    id: 'arch-concrete', label: 'Concrete arch', icon: '🌉', material: 'concrete', layout: 'main',
    blurb: 'One arch springing from the valley sides, the deck on columns above it. Needs a deep gap',
    span: { min: 40, max: 250 }, length: { min: 60, max: 1500 }, depth: { min: 1.6, ratio: 60 }, rise: 0.2,
    maxPier: 60, maxGrade: 0.06, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1905 },
    cost: { deck: 5200, pier: 90000, pierPerM: 9000, abutment: 250000, maint: 8, main: 900000, mainPerM: 0 },
  },
  {
    id: 'arch-tied', label: 'Steel tied arch', icon: '🌈', material: 'steel', layout: 'main',
    blurb: 'A bowstring arch over the deck, hangers holding it up. No deep gap needed',
    span: { min: 45, max: 250 }, length: { min: 50, max: 1500 }, depth: { min: 1.6, ratio: 120 },
    above: (len) => len / 6,
    maxPier: 60, maxGrade: 0.05, roadTonnes: 150, railAxle: 25.5,
    era: { from: 1885 },
    cost: { deck: 7200, pier: 90000, pierPerM: 9000, abutment: 250000, maint: 22, main: 600000, mainPerM: 0 },
  },
  {
    id: 'cable-stayed', label: 'Cable-stayed', icon: '🎐', material: 'concrete', layout: 'main',
    blurb: 'Fans of cables from tall pylons. Big spans at a fair price; the modern landmark',
    span: { min: 110, max: 650 }, length: { min: 200, max: 5000 }, depth: { min: 2.5, ratio: 250 },
    above: (len) => Math.max(30, len * 0.22),
    maxPier: 70, maxGrade: 0.05, roadTonnes: 150, railAxle: 22.5, railMph: 125,
    era: { from: 1970 },
    cost: { deck: 8000, pier: 150000, pierPerM: 12000, abutment: 250000, maint: 25, main: 4000000, mainPerM: 120000 },
  },
  {
    id: 'suspension', label: 'Suspension', icon: '🪢', material: 'steel', layout: 'main',
    blurb: 'Main cables over two towers. The longest spans of all; too lively for trains',
    span: { min: 150, max: 1450 }, length: { min: 300, max: 6000 }, depth: { min: 3, ratio: 400 },
    above: (len) => len / 10 + 4,
    maxPier: 70, maxGrade: 0.04, roadTonnes: 44, railAxle: 0,
    era: { from: 1826 },
    // abutments here are the cable anchorages: enormous blocks of concrete
    cost: { deck: 9500, pier: 150000, pierPerM: 12000, abutment: 12000000, maint: 35, main: 6000000, mainPerM: 160000 },
  },
  {
    id: 'bascule', label: 'Bascule (lifting)', icon: '🚢', material: 'steel', layout: 'main',
    blurb: 'Two leaves that lift for tall boats. Low and cheap to approach, but shuts the road',
    span: { min: 15, max: 80 }, length: { min: 25, max: 1500 }, depth: { min: 1.5, ratio: 40 },
    maxPier: 30, maxGrade: 0.02, roadTonnes: 44, railAxle: 22.5, roadMph: 40, railMph: 25,
    era: { from: 1890 },
    cost: { deck: 12000, pier: 90000, pierPerM: 9000, abutment: 200000, maint: 120, main: 3500000, mainPerM: 60000 },
    opening: { warn: 30, lift: 75, pass: 150 },
  },
];

export const BRIDGES = Object.fromEntries(B.map((d) => [d.id, d])) as Record<BridgeId, BridgeDef>;
export const BRIDGE_IDS = B.map((d) => d.id);

export const availableIn = (d: BridgeDef, year: number) => year >= d.era.from && (d.era.to === undefined || year <= d.era.to);

// The ordinary spans either side of a big main span, built in what that era would use.
export function approachFor(year: number): BridgeDef {
  return year >= 1950 ? BRIDGES.beam : year >= 1845 ? BRIDGES.girder : BRIDGES.masonry;
}

// Seconds the road is shut for one opening of a movable bridge.
export const closedPerOpening = (d: BridgeDef) => (d.opening ? d.opening.warn + d.opening.lift * 2 + d.opening.pass : 0);
