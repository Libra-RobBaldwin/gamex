// The industry catalogue: what each industry takes in and sends out, how fast, how big its site
// is, when it can appear and which kinds of station can serve it. Pure data, so the economy, the
// tests and the models all read the same numbers.
//
// Ids follow the 2D game (src/defs.ts INDUSTRIES) where one exists, so the economy being ported
// from there can adopt these definitions without renaming anything; the new ones get plain ids.
// Two 2D chains change shape: the sawmill now makes planks and the food plant makes food, rather
// than both making "goods". CARGO_2D maps every cargo back to the 2D set for anything that still
// only knows those five.
import type { CargoId as Cargo2D, IndustryKind as Industry2D, StationKind } from '../../defs';

export type CargoId =
  | 'coal' | 'wood' | 'grain' | 'goods' // as in the 2D game
  | 'stone' | 'iron_ore' | 'steel' | 'livestock' | 'planks' | 'oil' | 'fuel' | 'chemicals' | 'food' | 'beer';

// How a cargo is shown when it's stockpiled on site.
//  heap   - loose bulk in a pile that grows with an angle of repose (coal, ore, stone)
//  logs   - bundles of logs in rows
//  stack  - pallets, crates, bundles or containers stacked in a grid
//  tank   - a floating roof that rises inside an open-topped tank or silo
//  herd   - animals in a field; how many stand about shows the stock
export type PileKind = 'heap' | 'logs' | 'stack' | 'tank' | 'herd';

export interface CargoDef { name: string; unit: string; pay: number; colour: string; glyph: string; pile: PileKind }

export const CARGO: Record<CargoId, CargoDef> = {
  coal: { name: 'Coal', unit: 't', pay: 3.2, colour: '#2c2c2e', glyph: '⛏', pile: 'heap' },
  wood: { name: 'Timber', unit: 't', pay: 3.2, colour: '#8a5a32', glyph: '🪵', pile: 'logs' },
  grain: { name: 'Grain', unit: 't', pay: 3.2, colour: '#e3c25a', glyph: '🌾', pile: 'tank' },
  goods: { name: 'Goods', unit: 'crates', pay: 7.5, colour: '#d7659b', glyph: '📦', pile: 'stack' },
  stone: { name: 'Stone', unit: 't', pay: 2.6, colour: '#bdb7aa', glyph: '🪨', pile: 'heap' },
  iron_ore: { name: 'Iron ore', unit: 't', pay: 3.4, colour: '#8e4a35', glyph: '🟤', pile: 'heap' },
  steel: { name: 'Steel', unit: 't', pay: 8, colour: '#7d8a96', glyph: '🔩', pile: 'stack' },
  livestock: { name: 'Livestock', unit: 'head', pay: 4, colour: '#f1ede4', glyph: '🐄', pile: 'herd' },
  planks: { name: 'Sawn timber', unit: 't', pay: 4.5, colour: '#d9b98a', glyph: '🪚', pile: 'stack' },
  oil: { name: 'Crude oil', unit: 'kl', pay: 4, colour: '#1d1d1f', glyph: '🛢', pile: 'tank' },
  fuel: { name: 'Fuel', unit: 'kl', pay: 6, colour: '#d2a23a', glyph: '⛽', pile: 'tank' },
  chemicals: { name: 'Chemicals', unit: 'kl', pay: 6.5, colour: '#6fb39a', glyph: '⚗', pile: 'tank' },
  food: { name: 'Food', unit: 'crates', pay: 7, colour: '#e38b4a', glyph: '🥫', pile: 'stack' },
  beer: { name: 'Beer', unit: 'casks', pay: 7, colour: '#b86b2a', glyph: '🍺', pile: 'stack' },
};

// Each cargo's nearest equivalent in the 2D game's five.
export const CARGO_2D: Record<CargoId, Cargo2D> = {
  coal: 'coal', wood: 'wood', grain: 'grain', goods: 'goods', stone: 'coal', iron_ore: 'coal', steel: 'goods',
  livestock: 'grain', planks: 'goods', oil: 'coal', fuel: 'goods', chemicals: 'goods', food: 'goods', beer: 'goods',
};

// What towns take in: shops, pubs, petrol stations and builders' merchants.
export const TOWN_ACCEPTS: CargoId[] = ['goods', 'food', 'beer', 'fuel', 'stone', 'planks'];

export type IndustryId =
  | Industry2D
  | 'quarry' | 'iron_ore_mine' | 'steelworks' | 'oil_well' | 'refinery' | 'brewery' | 'goods_factory' | 'port' | 'warehouse';

// How an industry turns inputs into outputs.
//  primary   - produces from the ground; no inputs
//  processor - converts inputs to outputs. mix 'all' needs every required input for a cycle
//              (steel needs coal and ore); mix 'any' runs a cycle on whichever input is there
//  sink      - consumes and makes nothing you can carry (a power station makes electricity)
//  hub       - stores what comes in and sends the same cargo on (a distribution warehouse)
//  gateway   - trades with the world: takes exports in, sends imports out, independently (docks)
export type Role = 'primary' | 'processor' | 'sink' | 'hub' | 'gateway';

// Station kinds in the 3D game. 'quay' is new: ships tie up at it.
export type ServeKind = 'lorry' | 'rail' | 'quay';
export const SERVE_2D: Record<ServeKind, StationKind[]> = { lorry: ['loading_bay', 'lorry_depot', 'road'], rail: ['rail'], quay: [] };

export interface Flow { cargo: CargoId; amount: number; optional?: boolean }

export interface Variant {
  id: string;
  name: string;
  era: [number, number | null]; // years new ones are built
  size?: { w: number; d: number }; // overrides the type's preferred site size
  // multiplies a type's outputs, e.g. a livestock farm makes more livestock than grain
  outputScale?: Partial<Record<CargoId, number>>;
}

export interface IndustryType {
  id: IndustryId;
  name: string;
  blurb: string;
  role: Role;
  mix?: 'all' | 'any';
  inputs: Flow[]; // amount consumed per production cycle
  outputs: Flow[]; // amount made per production cycle
  boost?: number; // output multiplier while every optional input is supplied
  rate: number; // cycles per second at production level 1 (the 2D game's rate)
  size: { w: number; d: number }; // preferred site in metres, w along the road frontage
  minSize: { w: number; d: number };
  era: [number, number | null];
  serve: ServeKind[];
  waterside?: 'required' | 'optional';
  catchment: number; // metres from the site boundary a station can be and still serve it
  variants: Variant[];
}

const V = (id: string, name: string, era: [number, number | null], extra: Partial<Variant> = {}): Variant => ({ id, name, era, ...extra });

export const INDUSTRY_TYPES: Record<IndustryId, IndustryType> = {
  coal_mine: {
    id: 'coal_mine', name: 'Colliery', blurb: 'Deep coal brought up the shaft by the winding engine and tipped on the stockyard.',
    role: 'primary', inputs: [], outputs: [{ cargo: 'coal', amount: 1 }], rate: 1.1,
    size: { w: 90, d: 70 }, minSize: { w: 60, d: 48 }, era: [1800, 2015], serve: ['lorry', 'rail'], catchment: 80,
    variants: [V('victorian', 'Victorian pit', [1800, 1920]), V('steel_headframe', 'Twin headframes', [1900, 1990]), V('tower_winder', 'Tower winder', [1950, 2015])],
  },
  quarry: {
    id: 'quarry', name: 'Quarry', blurb: 'Stone blasted from stepped benches, crushed and graded. Builders and steelworks want it.',
    role: 'primary', inputs: [], outputs: [{ cargo: 'stone', amount: 1 }], rate: 1.2,
    size: { w: 110, d: 90 }, minSize: { w: 70, d: 60 }, era: [1800, null], serve: ['lorry', 'rail'], catchment: 90,
    variants: [V('limestone', 'Limestone quarry', [1800, null]), V('granite', 'Granite quarry', [1850, null]), V('slate', 'Slate quarry', [1800, 1970])],
  },
  forest: {
    id: 'forest', name: 'Forest', blurb: 'Managed woodland with a timber yard where felled logs are stacked for collection.',
    role: 'primary', inputs: [], outputs: [{ cargo: 'wood', amount: 1 }], rate: 0.9,
    size: { w: 120, d: 100 }, minSize: { w: 70, d: 60 }, era: [1800, null], serve: ['lorry', 'rail'], catchment: 120,
    variants: [V('conifer', 'Conifer plantation', [1920, null]), V('broadleaf', 'Broadleaf wood', [1800, null]), V('clearfell', 'Clear-fell', [1920, null])],
  },
  farm: {
    id: 'farm', name: 'Farm', blurb: 'Fields, barns and silos. Arable farms grow grain; livestock farms raise cattle and sheep.',
    role: 'primary', inputs: [], outputs: [{ cargo: 'grain', amount: 1 }, { cargo: 'livestock', amount: 0.5 }], rate: 0.9,
    size: { w: 110, d: 90 }, minSize: { w: 70, d: 60 }, era: [1800, null], serve: ['lorry', 'rail'], catchment: 100,
    variants: [
      V('arable', 'Arable farm', [1800, null], { outputScale: { grain: 1.2, livestock: 0.3 } }),
      V('livestock', 'Livestock farm', [1800, null], { outputScale: { grain: 0.3, livestock: 2 } }),
      V('mixed', 'Mixed farm', [1800, null]),
    ],
  },
  sawmill: {
    id: 'sawmill', name: 'Sawmill', blurb: 'Logs in, sawn and seasoned timber out.',
    role: 'processor', mix: 'all', inputs: [{ cargo: 'wood', amount: 1 }], outputs: [{ cargo: 'planks', amount: 0.8 }], rate: 1.5,
    size: { w: 80, d: 60 }, minSize: { w: 55, d: 42 }, era: [1800, null], serve: ['lorry', 'rail'], waterside: 'optional', catchment: 80,
    variants: [V('riverside', 'Riverside mill', [1800, 1960]), V('modern', 'Modern sawmill', [1950, null]), V('estate', 'Estate sawmill', [1800, null], { size: { w: 60, d: 45 } })],
  },
  steelworks: {
    id: 'steelworks', name: 'Steelworks', blurb: 'Blast furnaces need both coal and iron ore; limestone flux makes them run harder.',
    role: 'processor', mix: 'all',
    inputs: [{ cargo: 'coal', amount: 1 }, { cargo: 'iron_ore', amount: 2 }, { cargo: 'stone', amount: 0.5, optional: true }],
    outputs: [{ cargo: 'steel', amount: 1.5 }], boost: 1.25, rate: 1,
    size: { w: 150, d: 110 }, minSize: { w: 110, d: 80 }, era: [1850, null], serve: ['lorry', 'rail', 'quay'], waterside: 'optional', catchment: 110,
    variants: [V('bessemer', 'Bessemer works', [1850, 1930]), V('integrated', 'Integrated works', [1920, null]), V('electric_arc', 'Electric arc works', [1970, null])],
  },
  iron_ore_mine: {
    id: 'iron_ore_mine', name: 'Ironstone mine', blurb: 'Iron ore dug from open pits or haematite shafts, and roasted in kilns.',
    role: 'primary', inputs: [], outputs: [{ cargo: 'iron_ore', amount: 1 }], rate: 1,
    size: { w: 90, d: 75 }, minSize: { w: 60, d: 50 }, era: [1850, 1985], serve: ['lorry', 'rail'], catchment: 80,
    variants: [V('opencast', 'Opencast ironstone', [1850, 1985]), V('shaft', 'Haematite shaft', [1850, 1980]), V('calcining', 'Calcining kilns', [1850, 1960])],
  },
  power_station: {
    id: 'power_station', name: 'Power station', blurb: 'Burns coal by the trainload. Makes electricity, not freight, so it takes all the coal you bring.',
    role: 'sink', inputs: [{ cargo: 'coal', amount: 1 }], outputs: [], rate: 4,
    size: { w: 150, d: 120 }, minSize: { w: 100, d: 80 }, era: [1900, 2025], serve: ['lorry', 'rail', 'quay'], waterside: 'optional', catchment: 120,
    variants: [V('compact', 'Town power station', [1900, 1960], { size: { w: 90, d: 70 } }), V('classic', 'Brick cathedral', [1925, 1970]), V('cooling_towers', 'Cooling towers', [1955, 2025])],
  },
  refinery: {
    id: 'refinery', name: 'Refinery', blurb: 'Crude oil distilled into fuel, with chemicals as a by-product.',
    role: 'processor', mix: 'all', inputs: [{ cargo: 'oil', amount: 2 }], outputs: [{ cargo: 'fuel', amount: 1 }, { cargo: 'chemicals', amount: 0.6 }], rate: 1,
    size: { w: 140, d: 110 }, minSize: { w: 100, d: 80 }, era: [1920, null], serve: ['lorry', 'rail', 'quay'], waterside: 'optional', catchment: 110,
    variants: [V('refinery', 'Oil refinery', [1920, null]), V('chemical_works', 'Chemical works', [1920, null]), V('tank_farm', 'Coastal refinery', [1950, null])],
  },
  oil_well: {
    id: 'oil_well', name: 'Oil field', blurb: 'Onshore wells: nodding donkeys, a gathering station and a tank or two.',
    role: 'primary', inputs: [], outputs: [{ cargo: 'oil', amount: 1 }], rate: 1,
    size: { w: 80, d: 65 }, minSize: { w: 50, d: 40 }, era: [1950, null], serve: ['lorry', 'rail'], catchment: 80,
    variants: [V('nodding_donkeys', 'Nodding donkeys', [1950, null]), V('wellsite', 'Wellsite with rig', [1960, null]), V('screened', 'Screened wellsite', [1975, null])],
  },
  brewery: {
    id: 'brewery', name: 'Brewery', blurb: 'Malts barley and brews it. Every town has pubs to fill.',
    role: 'processor', mix: 'all', inputs: [{ cargo: 'grain', amount: 1 }], outputs: [{ cargo: 'beer', amount: 0.6 }], rate: 1,
    size: { w: 70, d: 55 }, minSize: { w: 48, d: 38 }, era: [1800, null], serve: ['lorry', 'rail'], catchment: 70,
    variants: [V('tower', 'Victorian tower brewery', [1800, null]), V('maltings', 'Brewery and maltings', [1800, null]), V('modern', 'Modern brewery', [1960, null])],
  },
  food_plant: {
    id: 'food_plant', name: 'Food plant', blurb: 'Mills grain and processes livestock into food for the shops. Either will do.',
    role: 'processor', mix: 'any', inputs: [{ cargo: 'grain', amount: 1 }, { cargo: 'livestock', amount: 1 }], outputs: [{ cargo: 'food', amount: 0.8 }], rate: 1.5,
    size: { w: 80, d: 60 }, minSize: { w: 55, d: 42 }, era: [1850, null], serve: ['lorry', 'rail'], catchment: 80,
    variants: [V('flour_mill', 'Flour mill', [1850, null]), V('biscuit_works', 'Biscuit works', [1900, null]), V('modern', 'Food processing plant', [1960, null])],
  },
  goods_factory: {
    id: 'goods_factory', name: 'Factory', blurb: 'Makes finished goods from steel, sawn timber or chemicals, whichever arrives.',
    role: 'processor', mix: 'any', inputs: [{ cargo: 'steel', amount: 0.5 }, { cargo: 'planks', amount: 1 }, { cargo: 'chemicals', amount: 0.8 }], outputs: [{ cargo: 'goods', amount: 1 }], rate: 1.5,
    size: { w: 90, d: 65 }, minSize: { w: 60, d: 45 }, era: [1800, null], serve: ['lorry', 'rail'], catchment: 80,
    variants: [V('mill', 'Mill', [1800, 1950]), V('works', 'Engineering works', [1880, null]), V('modern', 'Modern factory', [1960, null])],
  },
  port: {
    id: 'port', name: 'Docks', blurb: 'Exports steel, goods and coal; imports iron ore and crude oil. Ships tie up at the quay.',
    role: 'gateway',
    inputs: [{ cargo: 'steel', amount: 1 }, { cargo: 'goods', amount: 1 }, { cargo: 'coal', amount: 1 }],
    outputs: [{ cargo: 'iron_ore', amount: 1 }, { cargo: 'oil', amount: 1 }], rate: 1,
    size: { w: 150, d: 90 }, minSize: { w: 100, d: 60 }, era: [1800, null], serve: ['lorry', 'rail', 'quay'], waterside: 'required', catchment: 150,
    variants: [V('victorian_dock', 'Victorian dock', [1800, 1970]), V('bulk', 'Bulk terminal', [1900, null]), V('container', 'Container terminal', [1968, null])],
  },
  warehouse: {
    id: 'warehouse', name: 'Distribution centre', blurb: 'Takes finished goods in bulk and sends them on to towns in smaller loads.',
    role: 'hub', inputs: [{ cargo: 'goods', amount: 1 }, { cargo: 'food', amount: 1 }, { cargo: 'beer', amount: 1 }, { cargo: 'fuel', amount: 1 }],
    outputs: [{ cargo: 'goods', amount: 1 }, { cargo: 'food', amount: 1 }, { cargo: 'beer', amount: 1 }, { cargo: 'fuel', amount: 1 }], rate: 3,
    size: { w: 100, d: 70 }, minSize: { w: 70, d: 50 }, era: [1900, null], serve: ['lorry', 'rail'], catchment: 90,
    variants: [V('railhead', 'Railhead warehouse', [1900, null]), V('distribution', 'Distribution centre', [1965, null]), V('cold_store', 'Cold store', [1930, null])],
  },
};

export const INDUSTRY_IDS = Object.keys(INDUSTRY_TYPES) as IndustryId[];

// Pick the variant a site built in `year` would most likely be, stably for a seed.
export function variantFor(type: IndustryType, year: number, seed: number): Variant {
  const ok = type.variants.filter((v) => v.era[0] <= year && (v.era[1] === null || year <= v.era[1]));
  const list = ok.length ? ok : type.variants;
  return list[Math.abs(Math.floor(seed * 7919)) % list.length];
}

// Output per second at a production level, for a variant (primaries) or at full input (processors).
export function outputRate(type: IndustryType, level: number, variant?: Variant): Partial<Record<CargoId, number>> {
  const out: Partial<Record<CargoId, number>> = {};
  for (const f of type.outputs) out[f.cargo] = f.amount * type.rate * level * (variant?.outputScale?.[f.cargo] ?? 1);
  return out;
}

// Who accepts a cargo: industries, and whether towns do.
export function consumersOf(c: CargoId) {
  return { industries: INDUSTRY_IDS.filter((id) => INDUSTRY_TYPES[id].inputs.some((f) => f.cargo === c)), towns: TOWN_ACCEPTS.includes(c) };
}
export function producersOf(c: CargoId) {
  return INDUSTRY_IDS.filter((id) => INDUSTRY_TYPES[id].outputs.some((f) => f.cargo === c));
}
