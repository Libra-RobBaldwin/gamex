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

export type StationKind = 'road' | 'rail' | 'metro' | 'airport';

export const STATIONS: Record<StationKind, { name: string; cost: number; radius: number; cap: number; tech: Tech; layer: Layer | null }> = {
  road: { name: 'Road station', cost: 1500, radius: 3, cap: 250, tech: 'road', layer: 'road' },
  rail: { name: 'Rail station', cost: 6000, radius: 4, cap: 800, tech: 'rail', layer: 'rail' },
  metro: { name: 'Metro station', cost: 14000, radius: 3, cap: 1200, tech: 'metro', layer: 'metro' },
  airport: { name: 'Airport', cost: 160000, radius: 5, cap: 3000, tech: 'airport', layer: null },
};

export type VehicleId = 'bus' | 'truck' | 'coach' | 'hgv' | 'train' | 'freight' | 'intercity' | 'metro' | 'plane';

export interface VehicleDef {
  name: string;
  station: StationKind;
  pax: boolean; // passenger vehicle, otherwise freight
  capacity: number;
  speed: number; // tiles per second at full speed
  cost: number;
  running: number; // per minute
  tech: Tech;
  cars: number;
  color: string;
  color2: string;
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  bus: { name: 'City bus', station: 'road', pax: true, capacity: 35, speed: 1.4, cost: 9000, running: 250, tech: 'bus', cars: 1, color: '#d8342c', color2: '#f2f2f2' },
  truck: { name: 'Lorry', station: 'road', pax: false, capacity: 20, speed: 1.3, cost: 11000, running: 300, tech: 'truck', cars: 1, color: '#2f6fb8', color2: '#e8e8e8' },
  coach: { name: 'Coach', station: 'road', pax: true, capacity: 55, speed: 2.4, cost: 30000, running: 700, tech: 'coach', cars: 1, color: '#f2f2f2', color2: '#3b6cd4' },
  hgv: { name: 'HGV', station: 'road', pax: false, capacity: 40, speed: 2.2, cost: 34000, running: 800, tech: 'coach', cars: 1, color: '#e0a526', color2: '#f0f0f0' },
  train: { name: 'Commuter train', station: 'rail', pax: true, capacity: 180, speed: 2.6, cost: 70000, running: 1400, tech: 'train', cars: 3, color: '#2f9e5b', color2: '#f3d23b' },
  freight: { name: 'Freight train', station: 'rail', pax: false, capacity: 240, speed: 2.0, cost: 80000, running: 1500, tech: 'freight', cars: 5, color: '#e0662a', color2: '#6b4a32' },
  intercity: { name: 'Intercity train', station: 'rail', pax: true, capacity: 360, speed: 4.6, cost: 180000, running: 3500, tech: 'intercity', cars: 6, color: '#f4f4f4', color2: '#c8262e' },
  metro: { name: 'Metro train', station: 'metro', pax: true, capacity: 300, speed: 2.8, cost: 110000, running: 2200, tech: 'metro', cars: 4, color: '#1f5fbf', color2: '#dfe7f5' },
  plane: { name: 'Airliner', station: 'airport', pax: true, capacity: 180, speed: 7, cost: 450000, running: 6000, tech: 'plane', cars: 1, color: '#f5f7fa', color2: '#1d4f91' },
};

export const START_MONEY = 60000;
export const OFFLINE_CAP_SECONDS = 4 * 3600;
export const PAX_GEN = 0.003; // passengers per resident per second, shared between stations
export const TOWN_ACCEPT_MIN_BUILDINGS = 2;

// Building levels on town tiles.
export const LEVEL_POP = [0, 25, 110, 420];
