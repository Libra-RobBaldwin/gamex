// Terminals: the loading and unloading facilities a player buys for an industry, one ladder per
// transport mode. A terminal is the station for that site in that mode, so its throughput is what
// caps how far the industry can grow. Pure data, read by the rules, the models and the UI.
//
// Units. Flows are tonnes (or the cargo's own unit) per game hour. The 2D game's rates are per
// simulated second and it reviews production once a minute, so one game hour is taken to be 60
// simulated seconds: a colliery at level 1 (1.1 a second) makes 66 t an hour. Durations are game
// days; money is the 2D game's.
import type { CargoId, ServeKind } from '../industries/catalogue';
import type { StationKind } from '../../defs';

export const SIM_SECONDS_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;

export type Mode = 'road' | 'rail' | 'water';
export const MODES: Mode[] = ['road', 'rail', 'water'];
export const MODE_OF: Record<ServeKind, Mode> = { lorry: 'road', rail: 'rail', quay: 'water' };
export const MODE_NAME: Record<Mode, { name: string; vehicle: string; vehicles: string; glyph: string }> = {
  road: { name: 'Road', vehicle: 'lorry', vehicles: 'lorries', glyph: '🚚' },
  rail: { name: 'Rail', vehicle: 'train', vehicles: 'trains', glyph: '🚂' },
  water: { name: 'Water', vehicle: 'ship', vehicles: 'ships', glyph: '🚢' },
};

// How a cargo is handled. Bulk pours (conveyors, hoppers, grabs), general is lifted (cranes,
// forklifts, gantries), liquid is pumped (tanks, loading arms). Livestock walks, which is closest
// to general: ramps and pens rather than anything special.
export type CargoClass = 'bulk' | 'general' | 'liquid';
export const CARGO_CLASS: Record<CargoId, CargoClass> = {
  coal: 'bulk', stone: 'bulk', iron_ore: 'bulk', grain: 'bulk',
  wood: 'general', goods: 'general', steel: 'general', livestock: 'general', planks: 'general', food: 'general', beer: 'general',
  oil: 'liquid', fuel: 'liquid', chemicals: 'liquid',
};

// Handling kit a tier can be fitted with. Each suits one cargo class; the others are handled at
// the standard rates. Nothing is ever zero, so a mixed site can always move everything, slowly.
export type FitId = 'standard' | 'conveyor' | 'rapid_loader' | 'gantry' | 'tank_farm' | 'grab_cranes' | 'container_cranes';

export interface FitDef {
  id: FitId;
  name: string;
  blurb: string;
  suits: Partial<Record<CargoClass, number>>; // overrides STANDARD_SUITS for these classes
  dwell: number; // multiplies the fixed part of a vehicle's stop (coupling, hoses, positioning)
  extra: number; // added to the tier's cost, as a fraction of it
  era: [number, number | null];
}

// Standard handling: shovels, forklifts, a mobile crane. Liquids go in drums, slowly.
export const STANDARD_SUITS: Record<CargoClass, number> = { bulk: 1, general: 1, liquid: 0.35 };

export const FITS: Record<FitId, FitDef> = {
  standard: { id: 'standard', name: 'Standard', blurb: 'Loading shovel, forklifts and a mobile crane.', suits: {}, dwell: 1, extra: 0, era: [1800, null] },
  conveyor: { id: 'conveyor', name: 'Conveyor and hopper', blurb: 'A belt from the stockyard to a hopper over the loading point, for coal, ore, stone and grain.', suits: { bulk: 1.6 }, dwell: 0.7, extra: 0.3, era: [1880, null] },
  rapid_loader: { id: 'rapid_loader', name: 'Rapid loader', blurb: 'A silo straddling the track fills each wagon as the train creeps under it, and a hopper house empties them at the other end: merry-go-round working.', suits: { bulk: 2.5, general: 0.5 }, dwell: 0.35, extra: 0.6, era: [1965, null] },
  gantry: { id: 'gantry', name: 'Loading gantry', blurb: 'An overhead crane on a runway over the tracks lifts steel, timber and crates.', suits: { general: 1.6 }, dwell: 0.7, extra: 0.4, era: [1880, null] },
  tank_farm: { id: 'tank_farm', name: 'Tank farm', blurb: 'Storage tanks, pumps and loading arms for oil, fuel and chemicals.', suits: { liquid: 1.5 }, dwell: 0.6, extra: 0.5, era: [1890, null] },
  grab_cranes: { id: 'grab_cranes', name: 'Grab cranes', blurb: 'Portal cranes with grabs and a belt to the stockyard, for bulk ships.', suits: { bulk: 1.8 }, dwell: 0.6, extra: 0.4, era: [1900, null] },
  container_cranes: { id: 'container_cranes', name: 'Container cranes', blurb: 'Ship-to-shore gantries and a container stack.', suits: { general: 2 }, dwell: 0.4, extra: 0.5, era: [1968, null] },
};

export type TierId = 'loading_bay' | 'lorry_depot' | 'road_terminal' | 'sidings' | 'rail_terminal' | 'marshalling_yard' | 'jetty' | 'quay' | 'port_terminal';
export type Rank = 1 | 2 | 3;

export interface TierDef {
  id: TierId;
  mode: Mode;
  rank: Rank;
  name: string;
  blurb: string;
  era: [number, number | null];
  cost: number;
  upkeep: number; // per game day while open; a fifth of it while mothballed
  buildDays: number;
  berths: number; // vehicles loading or unloading at once
  perBerth: number; // t/h one berth moves at standard handling
  queue: number; // vehicles that can wait off the road or the main line
  stock: number; // tonnes it holds waiting for collection (the 2D station's cap)
  manoeuvre: number; // multiplies the fixed part of a stop: reversing in, running round, warping in
  catchment: number; // metres added to the industry's catchment: it can gather from neighbours
  fits: FitId[]; // handling kit this tier can take, 'standard' first
  footprint: { w: number; d: number } | null; // land beside the site, along the frontage x outwards; null = inside the plot
  station2D?: StationKind; // the 2D station it corresponds to, for anything still reading STATIONS
}

// Throughput is berths x perBerth. The starter tiers' stock matches the 2D stations' cap (a
// loading bay holds 200, a lorry depot 600, a rail station 800), so the economy can port over.
export const TIERS: Record<TierId, TierDef> = {
  loading_bay: {
    id: 'loading_bay', mode: 'road', rank: 1, name: 'Loading bay', blurb: 'Two bays inside the gate and a cabin. Lorries reverse in, so each stop takes a while.',
    era: [1800, null], cost: 1000, upkeep: 40, buildDays: 2, berths: 2, perBerth: 25, queue: 1, stock: 200, manoeuvre: 1, catchment: 0,
    fits: ['standard', 'conveyor', 'tank_farm'], footprint: null, station2D: 'loading_bay',
  },
  lorry_depot: {
    id: 'lorry_depot', mode: 'road', rank: 2, name: 'Lorry depot', blurb: 'A yard beside the site with four bays, a loading dock and room to turn.',
    era: [1910, null], cost: 5000, upkeep: 150, buildDays: 6, berths: 4, perBerth: 35, queue: 4, stock: 600, manoeuvre: 0.7, catchment: 20,
    fits: ['standard', 'conveyor', 'tank_farm'], footprint: { w: 38, d: 42 }, station2D: 'lorry_depot',
  },
  road_terminal: {
    id: 'road_terminal', mode: 'road', rank: 3, name: 'Road freight terminal', blurb: 'Eight bays under a canopy at a cross-dock shed, a lorry park and a weighbridge. HGVs drive through.',
    era: [1955, null], cost: 24000, upkeep: 600, buildDays: 20, berths: 8, perBerth: 50, queue: 10, stock: 1500, manoeuvre: 0.5, catchment: 60,
    fits: ['standard', 'conveyor', 'tank_farm'], footprint: { w: 66, d: 56 },
  },
  sidings: {
    id: 'sidings', mode: 'rail', rank: 1, name: 'Private sidings', blurb: 'Two short sidings off the line with buffer stops and a loading dock. A train has to run round.',
    era: [1830, null], cost: 6000, upkeep: 120, buildDays: 8, berths: 1, perBerth: 150, queue: 1, stock: 800, manoeuvre: 1, catchment: 0,
    fits: ['standard', 'conveyor', 'tank_farm'], footprint: null, station2D: 'rail',
  },
  rail_terminal: {
    id: 'rail_terminal', mode: 'rail', rank: 2, name: 'Rail freight terminal', blurb: 'Longer sidings on a loop behind the works, so two trains load at once without running round.',
    era: [1870, null], cost: 40000, upkeep: 700, buildDays: 30, berths: 2, perBerth: 250, queue: 2, stock: 3000, manoeuvre: 0.7, catchment: 40,
    fits: ['standard', 'rapid_loader', 'gantry', 'tank_farm'], footprint: { w: 140, d: 24 },
  },
  marshalling_yard: {
    id: 'marshalling_yard', mode: 'rail', rank: 3, name: 'Marshalling yard', blurb: 'A fan of sidings where whole block trains are made up and wait, with a control tower and floodlights.',
    era: [1930, null], cost: 140000, upkeep: 2000, buildDays: 60, berths: 4, perBerth: 350, queue: 6, stock: 8000, manoeuvre: 0.5, catchment: 120,
    fits: ['standard', 'rapid_loader', 'gantry', 'tank_farm'], footprint: { w: 220, d: 58 },
  },
  jetty: {
    id: 'jetty', mode: 'water', rank: 1, name: 'Jetty', blurb: 'A timber jetty out to deep water, with a hand crane or a pipe. One coaster at a time.',
    era: [1800, null], cost: 8000, upkeep: 150, buildDays: 10, berths: 1, perBerth: 120, queue: 1, stock: 1000, manoeuvre: 1, catchment: 0,
    fits: ['standard', 'conveyor', 'tank_farm'], footprint: { w: 44, d: 12 },
  },
  quay: {
    id: 'quay', mode: 'water', rank: 2, name: 'Quay', blurb: 'A stone quay wall with an apron, portal cranes and a transit shed. Two ships alongside.',
    era: [1800, null], cost: 45000, upkeep: 800, buildDays: 40, berths: 2, perBerth: 250, queue: 2, stock: 4000, manoeuvre: 0.8, catchment: 40,
    fits: ['standard', 'conveyor', 'grab_cranes', 'tank_farm'], footprint: { w: 120, d: 26 },
  },
  port_terminal: {
    id: 'port_terminal', mode: 'water', rank: 3, name: 'Bulk or container terminal', blurb: 'A deep-water berth for three ships with big cranes and a stockyard or container stack.',
    era: [1960, null], cost: 180000, upkeep: 2800, buildDays: 90, berths: 3, perBerth: 600, queue: 4, stock: 15000, manoeuvre: 0.5, catchment: 150,
    fits: ['standard', 'grab_cranes', 'container_cranes', 'tank_farm'], footprint: { w: 180, d: 50 },
  },
};

export const TIER_IDS = Object.keys(TIERS) as TierId[];
export const LADDER: Record<Mode, [TierId, TierId, TierId]> = {
  road: ['loading_bay', 'lorry_depot', 'road_terminal'],
  rail: ['sidings', 'rail_terminal', 'marshalling_yard'],
  water: ['jetty', 'quay', 'port_terminal'],
};
export const tierAt = (mode: Mode, rank: Rank) => TIERS[LADDER[mode][rank - 1]];

// The fixed part of a stop, in hours, at a rank-1 terminal: positioning, paperwork, sheeting, and
// for trains running round and coupling, for ships warping in and hatches.
export const STOP_HOURS: Record<Mode, number> = { road: 0.15, rail: 0.5, water: 2 };
// A typical vehicle per mode, for dwell factors: the 2D lorry, freight train, and a coaster.
export const REFERENCE_LOAD: Record<Mode, number> = { road: 20, rail: 240, water: 1000 };

export const inEra = (era: [number, number | null], year: number) => era[0] <= year && (era[1] === null || year <= era[1]);
export const suitOf = (fit: FitId, cls: CargoClass) => FITS[fit].suits[cls] ?? STANDARD_SUITS[cls];
export const tierCost = (tier: TierId, fit: FitId = 'standard') => Math.round(TIERS[tier].cost * (1 + FITS[fit].extra));
export const throughput = (tier: TierId) => TIERS[tier].berths * TIERS[tier].perBerth;
