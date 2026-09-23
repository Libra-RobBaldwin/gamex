// Static definitions: cargo, industries, infrastructure, stations, vehicles, technologies.

export type CargoId = 'pax' | 'coal' | 'wood' | 'grain' | 'goods';

export const CARGO: Record<CargoId, { name: string; unit: string; pay: number; color: string }> = {
  pax: { name: 'Passengers', unit: '', pay: 4, color: '#4cc3ff' },
  coal: { name: 'Coal', unit: 't', pay: 3.2, color: '#3a3a3a' },
  wood: { name: 'Timber', unit: 't', pay: 3.2, color: '#9a6b3c' },
  grain: { name: 'Grain', unit: 't', pay: 3.2, color: '#e3c25a' },
  goods: { name: 'Goods', unit: 'crates', pay: 7.5, color: '#d7659b' },
};

export type IndustryKind = 'coal_mine' | 'power_station' | 'forest' | 'sawmill' | 'farm' | 'food_plant';

export interface IndustryDef {
  name: string;
  produces?: CargoId;
  rate?: number; // base units per second
  accepts: CargoId[];
  converts?: { from: CargoId; to: CargoId; ratio: number };
}

export const INDUSTRIES: Record<IndustryKind, IndustryDef> = {
  coal_mine: { name: 'Coal Mine', produces: 'coal', rate: 1.1, accepts: [] },
  power_station: { name: 'Power Station', accepts: ['coal'] },
  forest: { name: 'Forest', produces: 'wood', rate: 0.9, accepts: [] },
  sawmill: { name: 'Sawmill', accepts: ['wood'], converts: { from: 'wood', to: 'goods', ratio: 0.8 } },
  farm: { name: 'Farm', produces: 'grain', rate: 0.9, accepts: [] },
  food_plant: { name: 'Food Plant', accepts: ['grain'], converts: { from: 'grain', to: 'goods', ratio: 0.8 } },
};

// Chains used when choosing freight challenges.
export const CHAINS: [IndustryKind, IndustryKind][] = [
  ['coal_mine', 'power_station'],
  ['forest', 'sawmill'],
  ['farm', 'food_plant'],
];

export type Tech =
  | 'road' | 'bus' | 'truck'
  | 'rail' | 'train' | 'freight'
  | 'motorway' | 'coach'
  | 'metro'
  | 'airport' | 'plane'
  | 'intercity';

export const START_TECH: Tech[] = ['road', 'bus', 'truck'];

export const TECH_NAME: Record<Tech, string> = {
  road: 'Roads', bus: 'Buses', truck: 'Lorries', rail: 'Railways', train: 'Passenger trains',
  freight: 'Freight trains', motorway: 'Motorways', coach: 'Coaches & HGVs', metro: 'Metro',
  airport: 'Airports', plane: 'Airliners', intercity: 'Intercity trains',
};

// Network layers. Road layer values: 1 = street, 2 = motorway.
export type Layer = 'road' | 'rail' | 'metro';

export type BuildKind = 'street' | 'motorway' | 'rail' | 'metro';

export const BUILD: Record<BuildKind, { name: string; layer: Layer; value: number; cost: number; tech: Tech }> = {
  street: { name: 'Street', layer: 'road', value: 1, cost: 250, tech: 'road' },
  motorway: { name: 'Motorway', layer: 'road', value: 2, cost: 1600, tech: 'motorway' },
  rail: { name: 'Railway', layer: 'rail', value: 1, cost: 900, tech: 'rail' },
  metro: { name: 'Metro tunnel', layer: 'metro', value: 1, cost: 3200, tech: 'metro' },
};

export const BRIDGE_MULT = 4;
export const DEMOLISH_BUILDING_COST = 1500;

// How a station sits in the network:
//  kerb    - on a street tile; vehicles stop and carry on in the same direction
//  offroad - beside a street with its own driveway; vehicles can turn round inside
//  track   - on rail / metro track (trains reverse at stations)
//  site    - its own 3x3 site (airports)
export type StationKind =
  | 'bus_stop' | 'bus_station' | 'bus_interchange' | 'loading_bay' | 'lorry_depot' | 'road'
  | 'rail' | 'metro' | 'airport';

export type Mode = 'road' | 'rail' | 'metro' | 'air';

export interface StationDef {
  name: string;
  mode: Mode;
  cargo: 'pax' | 'freight' | 'any';
  place: 'kerb' | 'offroad' | 'track' | 'site';
  size: number; // footprint edge in tiles
  turnaround: boolean;
  cost: number;
  radius: number;
  cap: number;
  tech: Tech;
  layer: Layer | null;
  blurb: string;
  hidden?: boolean;
}

export const STATIONS: Record<StationKind, StationDef> = {
  bus_stop: { name: 'Bus stop', mode: 'road', cargo: 'pax', place: 'kerb', size: 1, turnaround: false, cost: 800, radius: 3, cap: 120, tech: 'road', layer: 'road', blurb: 'A kerbside stop on a street. Buses pull in and carry on the same way, so routes loop round the roads (or U-turn at a dead end).' },
  bus_station: { name: 'Bus station', mode: 'road', cargo: 'pax', place: 'offroad', size: 1, turnaround: true, cost: 4000, radius: 3, cap: 400, tech: 'road', layer: 'road', blurb: 'Off-road bays beside a street, with its own driveway. Buses can turn round here, which makes it a good end of the line.' },
  bus_interchange: { name: 'Bus interchange', mode: 'road', cargo: 'pax', place: 'offroad', size: 2, turnaround: true, cost: 16000, radius: 4, cap: 1200, tech: 'road', layer: 'road', blurb: 'A big 2×2 terminus for busy town centres. Lots of capacity, a wider catchment, and buses turn round inside.' },
  loading_bay: { name: 'Loading bay', mode: 'road', cargo: 'freight', place: 'kerb', size: 1, turnaround: false, cost: 1000, radius: 3, cap: 200, tech: 'truck', layer: 'road', blurb: 'A kerbside bay for lorries. Lorries load and carry on in the same direction.' },
  lorry_depot: { name: 'Lorry depot', mode: 'road', cargo: 'freight', place: 'offroad', size: 1, turnaround: true, cost: 5000, radius: 3, cap: 600, tech: 'truck', layer: 'road', blurb: 'An off-road yard with a driveway. Lorries can turn round here, so it suits mines and factories at the end of a road.' },
  road: { name: 'Street stop', mode: 'road', cargo: 'any', place: 'kerb', size: 1, turnaround: true, cost: 1500, radius: 3, cap: 250, tech: 'road', layer: 'road', blurb: 'Older all-purpose stop.', hidden: true },
  rail: { name: 'Rail station', mode: 'rail', cargo: 'any', place: 'track', size: 1, turnaround: true, cost: 6000, radius: 4, cap: 800, tech: 'rail', layer: 'rail', blurb: 'Platforms on your track. Trains reverse here.' },
  metro: { name: 'Metro station', mode: 'metro', cargo: 'pax', place: 'track', size: 1, turnaround: true, cost: 14000, radius: 3, cap: 1200, tech: 'metro', layer: 'metro', blurb: 'An entrance above a metro tunnel.' },
  airport: { name: 'Airport', mode: 'air', cargo: 'pax', place: 'site', size: 3, turnaround: true, cost: 160000, radius: 5, cap: 3000, tech: 'airport', layer: null, blurb: 'A runway and terminal on a clear 3×3 site.' },
};

export type VehicleGroup = 'bus' | 'coach' | 'lorry' | 'train' | 'metro' | 'plane';

export const GROUPS: { id: VehicleGroup; name: string; icon: string }[] = [
  { id: 'bus', name: 'Buses', icon: '🚌' },
  { id: 'coach', name: 'Coaches', icon: '🚍' },
  { id: 'lorry', name: 'Lorries', icon: '🚚' },
  { id: 'train', name: 'Trains', icon: '🚆' },
  { id: 'metro', name: 'Metro', icon: 'Ⓜ️' },
  { id: 'plane', name: 'Planes', icon: '✈️' },
];

export type VehicleId =
  | 'minibus' | 'bus' | 'bendy' | 'decker' | 'coach' | 'decker_coach'
  | 'van' | 'truck' | 'hgv'
  | 'train' | 'freight' | 'intercity' | 'metro' | 'plane';

export interface VehicleDef {
  name: string;
  group: VehicleGroup;
  mode: Mode;
  pax: boolean; // passenger vehicle, otherwise freight
  capacity: number;
  speed: number; // tiles per second at full speed
  cost: number;
  running: number; // per minute
  tech: Tech;
  cars: number;
  len: number; // body length in tiles (per car)
  height: number; // body height in px
  color: string;
  color2: string;
  blurb: string;
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  minibus: { name: 'Minibus', group: 'bus', mode: 'road', pax: true, capacity: 16, speed: 1.8, cost: 5000, running: 150, tech: 'bus', cars: 1, len: 0.34, height: 10, color: '#f2f2f2', color2: '#2d9c6a', blurb: 'Nippy and cheap. Good for quiet routes and new suburbs.' },
  bus: { name: 'City bus', group: 'bus', mode: 'road', pax: true, capacity: 35, speed: 1.4, cost: 9000, running: 250, tech: 'bus', cars: 1, len: 0.5, height: 11, color: '#d8342c', color2: '#f4f4f4', blurb: 'The all-rounder single-decker.' },
  bendy: { name: 'Bendy bus', group: 'bus', mode: 'road', pax: true, capacity: 60, speed: 1.3, cost: 16000, running: 400, tech: 'bus', cars: 2, len: 0.4, height: 11, color: '#e8a21f', color2: '#2b2b2b', blurb: 'Articulated, so it takes a big crowd without adding height.' },
  decker: { name: 'Double-decker', group: 'bus', mode: 'road', pax: true, capacity: 75, speed: 1.25, cost: 21000, running: 480, tech: 'bus', cars: 1, len: 0.52, height: 19, color: '#c62828', color2: '#f7e8b0', blurb: 'The classic. Lots of seats, a bit slow away from the lights.' },
  coach: { name: 'Coach', group: 'coach', mode: 'road', pax: true, capacity: 55, speed: 2.4, cost: 30000, running: 700, tech: 'coach', cars: 1, len: 0.58, height: 13, color: '#f2f2f2', color2: '#3b6cd4', blurb: 'Fast between towns, best on motorways.' },
  decker_coach: { name: 'Double-deck coach', group: 'coach', mode: 'road', pax: true, capacity: 80, speed: 2.2, cost: 44000, running: 950, tech: 'coach', cars: 1, len: 0.6, height: 19, color: '#1e3d73', color2: '#e8c33a', blurb: 'High capacity for long intercity runs.' },
  van: { name: 'Van', group: 'lorry', mode: 'road', pax: false, capacity: 8, speed: 1.9, cost: 6000, running: 180, tech: 'truck', cars: 1, len: 0.3, height: 10, color: '#f2f2f2', color2: '#7a7f86', blurb: 'Small and quick. Fine for light loads.' },
  truck: { name: 'Lorry', group: 'lorry', mode: 'road', pax: false, capacity: 20, speed: 1.3, cost: 11000, running: 300, tech: 'truck', cars: 1, len: 0.48, height: 13, color: '#2f6fb8', color2: '#e8e8e8', blurb: 'The workhorse rigid lorry.' },
  hgv: { name: 'HGV', group: 'lorry', mode: 'road', pax: false, capacity: 40, speed: 2.2, cost: 34000, running: 800, tech: 'coach', cars: 2, len: 0.36, height: 14, color: '#e0a526', color2: '#f0f0f0', blurb: 'An articulated tractor and trailer. Built for motorways.' },
  train: { name: 'Commuter train', group: 'train', mode: 'rail', pax: true, capacity: 180, speed: 2.6, cost: 70000, running: 1400, tech: 'train', cars: 3, len: 0.56, height: 11, color: '#2f9e5b', color2: '#f3d23b', blurb: 'Three-car units for town-to-town hops.' },
  freight: { name: 'Freight train', group: 'train', mode: 'rail', pax: false, capacity: 240, speed: 2.0, cost: 80000, running: 1500, tech: 'freight', cars: 5, len: 0.56, height: 9, color: '#e0662a', color2: '#6b4a32', blurb: 'A heavy haul locomotive and wagons.' },
  intercity: { name: 'Intercity train', group: 'train', mode: 'rail', pax: true, capacity: 360, speed: 4.6, cost: 180000, running: 3500, tech: 'intercity', cars: 6, len: 0.56, height: 11, color: '#f4f4f4', color2: '#c8262e', blurb: 'Fast long-distance express.' },
  metro: { name: 'Metro train', group: 'metro', mode: 'metro', pax: true, capacity: 300, speed: 2.8, cost: 110000, running: 2200, tech: 'metro', cars: 4, len: 0.56, height: 11, color: '#1f5fbf', color2: '#dfe7f5', blurb: 'Runs in tunnels under the city.' },
  plane: { name: 'Airliner', group: 'plane', mode: 'air', pax: true, capacity: 180, speed: 7, cost: 450000, running: 6000, tech: 'plane', cars: 1, len: 1, height: 6, color: '#f5f7fa', color2: '#1d4f91', blurb: 'Flies point to point between airports.' },
};

export function canServe(v: VehicleDef, st: StationDef) {
  return v.mode === st.mode && (st.cargo === 'any' || (st.cargo === 'pax') === v.pax);
}

export const START_MONEY = 60000;
export const OFFLINE_CAP_SECONDS = 4 * 3600;
export const PAX_GEN = 0.003; // passengers per resident per second, shared between stations
export const TOWN_ACCEPT_MIN_BUILDINGS = 2;

// Building levels on town tiles.
export const LEVEL_POP = [0, 25, 110, 420];
