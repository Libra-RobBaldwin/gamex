// Shared types for the vehicle library. Coordinates for every model: +x is forward, +y is up,
// +z is the driver's right. The origin is on the ground under the middle of the vehicle's length,
// which is how traffic.ts already places its boxes.

export type Category = 'car' | 'van' | 'lorry' | 'trailer' | 'bus' | 'rail' | 'boat' | 'air';

export type BodyStyle =
  // cars
  | 'hatchback' | 'saloon' | 'estate' | 'coupe' | 'convertible' | 'suv' | 'pickup' | 'mpv'
  | 'sports' | 'supercar' | 'classic' | 'taxi' | 'police' | 'ambulance'
  // vans
  | 'van-small' | 'van-panel' | 'van-luton' | 'minibus' | 'ice-cream'
  // lorries and trailers
  | 'rigid-box' | 'rigid-curtain' | 'rigid-tipper' | 'rigid-flatbed' | 'rigid-tanker' | 'refuse' | 'gritter' | 'mixer' | 'recovery'
  | 'tractor'
  | 'trailer-box' | 'trailer-curtain' | 'trailer-tanker' | 'trailer-tipper' | 'trailer-flatbed' | 'trailer-container'
  | 'trailer-car' | 'trailer-logging' | 'trailer-livestock'
  // buses
  | 'bus-single' | 'bus-double' | 'bus-bendy' | 'bus-bendy-rear' | 'coach' | 'bus-heritage' | 'bus-halfcab'
  // rail
  | 'steam-tank' | 'steam-tender' | 'tender' | 'shunter' | 'diesel-loco' | 'electric-loco'
  | 'dmu-car' | 'emu-car' | 'metro-car' | 'hs-power' | 'hs-coach' | 'tram' | 'tram-heritage' | 'rack-car'
  | 'coach-stock' | 'wagon-hopper' | 'wagon-box' | 'wagon-tank' | 'wagon-flat' | 'wagon-car' | 'wagon-timber' | 'brake-van'
  // water and air
  | 'narrowboat' | 'barge' | 'coaster' | 'container-ship' | 'ferry'
  | 'light-aircraft' | 'turboprop' | 'airliner' | 'widebody';

export type Lod = 0 | 1 | 2;

// Real dimensions in metres. Axles are x positions from the middle of the length (front positive),
// so the traffic layer can place wheels, bogies, hitches and turning circles properly.
export interface Dims {
  length: number; width: number; height: number;
  wheelbase: number; // front axle to rear axle (or bogie centres for rail)
  axles: number[];
  wheelR: number;
  clearance: number;
}

// Where an articulated vehicle joins the next one: x positions from the middle of this model.
export interface Hitch { front?: number; rear?: number }

// Paint zones: 0 is baked colour, 1–4 take the instance's livery colours.
//  1 body · 2 secondary (band, skirt, two-tone, stripes) · 3 roof · 4 accent (warning ends, beacons' surround, lettering)
export type Zone = 0 | 1 | 2 | 3 | 4;

// Light codes baked into the geometry. Which ones glow is chosen per instance with FLAGS.
export const LIGHT = {
  none: 0, head: 1, tail: 2, brake: 3, indL: 4, indR: 5, interior: 6, beaconBlue: 7, beaconAmber: 8, sign: 9,
  // lit by the doors rather than the flags: amber lamps over train doors that are open, and the
  // passengers' open buttons, green once the doors on that side are released
  doorOpen: 10, doorButton: 11,
} as const;
// Per-instance flags (bit mask) that switch the baked lights on.
export const FLAGS = {
  lights: 1, brake: 2, indL: 4, indR: 8, interior: 16, beacons: 32, sign: 64,
  // pantographs folded down (electric stock running on diesel, or stabled)
  pantoDown: 128,
  hazard: 4 | 8,
} as const;

export type Livery = [string, string, string, string]; // zones 1–4

// Economy stats, so the library doubles as the fleet the player can buy.
export interface Stats {
  capacity: number; // passengers, or tonnes for freight
  unit: 'pax' | 't';
  speedKmh: number;
  cost: number; // purchase price in game pounds (constant prices, not inflated by era)
  running: number; // running cost per year
  power: 'petrol' | 'diesel' | 'electric' | 'steam' | 'hybrid' | 'sail' | 'jet' | 'prop' | 'none';
}

export interface Design {
  // the knobs the builders read; each builder uses the ones that apply to it
  [k: string]: number | string | boolean | undefined;
}

export interface Model {
  id: string;
  name: string; // "Brand Model" as shown to players
  family: string; // model name without the brand
  brand: string; // brand id
  category: Category;
  style: BodyStyle;
  from: number; to: number; // years built
  dims: Dims;
  hitch?: Hitch;
  seed: number;
  design: Design;
  stats: Stats;
  // trainsets and articulated sets list the models that normally run with this one
  consist?: string[];
  tags: string[];
}
