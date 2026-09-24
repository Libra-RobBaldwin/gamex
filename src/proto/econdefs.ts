// Economy reference data and contracts: what each cargo pays, what industries make and take,
// what stops and vehicles carry, how big each kind of building is, the tuning that sets how
// fast towns change, and the shapes of what the game hands the economy and gets back.
// Pure data with no renderer, so the economy runs (and is tested) in node.

// ---------------- cargo ----------------
// Towns take goods (for shops) and materials (for works). Pay is per unit per delivery plus per
// kilometre as the crow flies, scaled by how fast it got there against `refKmh`. The fixed part
// builds up over the first `fullKm`, so a hop of a few hundred metres earns next to nothing
// (the 2D game paid by distance alone) and chaining short hops can't farm it.
export type CargoId = 'pax' | 'coal' | 'wood' | 'grain' | 'stone' | 'goods' | 'materials';
export const FREIGHT: CargoId[] = ['coal', 'wood', 'grain', 'stone', 'goods', 'materials'];
export const CARGO: Record<CargoId, { name: string; unit: string; base: number; fullKm: number; perKm: number; refKmh: number }> = {
  pax: { name: 'Passengers', unit: '', base: 1.0, fullKm: 2, perKm: 0.25, refKmh: 30 },
  coal: { name: 'Coal', unit: 't', base: 0.6, fullKm: 3, perKm: 0.15, refKmh: 25 },
  wood: { name: 'Timber', unit: 't', base: 0.6, fullKm: 3, perKm: 0.15, refKmh: 25 },
  grain: { name: 'Grain', unit: 't', base: 0.6, fullKm: 3, perKm: 0.16, refKmh: 25 },
  stone: { name: 'Stone', unit: 't', base: 0.5, fullKm: 3, perKm: 0.14, refKmh: 25 },
  goods: { name: 'Goods', unit: 'crates', base: 1.2, fullKm: 3, perKm: 0.3, refKmh: 30 },
  materials: { name: 'Building materials', unit: 't', base: 0.9, fullKm: 3, perKm: 0.22, refKmh: 25 },
};

// ---------------- industries ----------------
// Ported from the 2D game (defs.ts), with rates per game hour at 100% production and a quarry
// and brickworks added so towns can be fed building materials. Processors turn up to `perHour`
// of input (times their production level) into output; the power station just burns coal.
// `jobs` is the workforce at 100%: it scales with production and counts towards nearby towns.
export type IndustryKind = 'coal_mine' | 'power_station' | 'forest' | 'sawmill' | 'farm' | 'food_plant' | 'quarry' | 'brickworks';
export interface IndustryDef {
  name: string;
  produces?: CargoId;
  rate?: number;
  accepts: CargoId[];
  converts?: { from: CargoId; to?: CargoId; ratio: number; perHour: number };
  jobs: number;
}
export const INDUSTRIES: Record<IndustryKind, IndustryDef> = {
  coal_mine: { name: 'Colliery', produces: 'coal', rate: 30, accepts: [], jobs: 60 },
  power_station: { name: 'Power Station', accepts: ['coal'], converts: { from: 'coal', ratio: 0, perHour: 60 }, jobs: 40 },
  forest: { name: 'Forest', produces: 'wood', rate: 25, accepts: [], jobs: 20 },
  sawmill: { name: 'Sawmill', accepts: ['wood'], converts: { from: 'wood', to: 'goods', ratio: 0.8, perHour: 40 }, jobs: 50 },
  farm: { name: 'Farm', produces: 'grain', rate: 25, accepts: [], jobs: 15 },
  food_plant: { name: 'Food Plant', accepts: ['grain'], converts: { from: 'grain', to: 'goods', ratio: 0.8, perHour: 40 }, jobs: 60 },
  quarry: { name: 'Quarry', produces: 'stone', rate: 30, accepts: [], jobs: 30 },
  brickworks: { name: 'Brickworks', accepts: ['stone'], converts: { from: 'stone', to: 'materials', ratio: 0.7, perHour: 40 }, jobs: 50 },
};
// Chains, raw material first, for scenario pickers and the tests.
export const CHAINS: [IndustryKind, IndustryKind][] = [
  ['coal_mine', 'power_station'], ['forest', 'sawmill'], ['farm', 'food_plant'], ['quarry', 'brickworks'],
];

// ---------------- stops ----------------
// Catchment radii are walking distances in metres: about 400 m to a bus stop and 800 m to a
// station is the usual UK planning rule of thumb. Freight stops need the industry close by.
export type Mode = 'road' | 'rail';
export type StopKind = 'bus_stop' | 'bus_station' | 'tram_stop' | 'rail_station' | 'lorry_depot' | 'goods_yard';
export interface StopDef { name: string; mode: Mode; pax: boolean; freight: boolean; radius: number; cap: number }
export const STOPS: Record<StopKind, StopDef> = {
  bus_stop: { name: 'Bus stop', mode: 'road', pax: true, freight: false, radius: 400, cap: 150 },
  bus_station: { name: 'Bus station', mode: 'road', pax: true, freight: false, radius: 500, cap: 600 },
  tram_stop: { name: 'Tram stop', mode: 'rail', pax: true, freight: false, radius: 450, cap: 300 },
  rail_station: { name: 'Railway station', mode: 'rail', pax: true, freight: false, radius: 800, cap: 1500 },
  lorry_depot: { name: 'Lorry depot', mode: 'road', pax: false, freight: true, radius: 350, cap: 800 },
  goods_yard: { name: 'Goods yard', mode: 'rail', pax: false, freight: true, radius: 450, cap: 2500 },
};
// How far an industry's site reaches beyond its centre when checking a stop's catchment.
export const INDUSTRY_SITE_M = 80;

// ---------------- vehicles ----------------
// Train ids match TRAINS in catalog.ts. `running` is £ per game hour per vehicle (vehicles run
// round the clock here, so it's below a real operator's hourly cost), `dwell` the base minutes
// at a stop, `board` seconds per passenger (or tonne) through the doors.
export type VehicleKind = 'minibus' | 'bus' | 'decker' | 'coach' | 'lorry' | 'hgv' | 'dmu' | 'intercity' | 'hs' | 'tram' | 'rack' | 'freight';
export interface VehicleDef { name: string; mode: Mode; pax: boolean; capacity: number; kmh: number; cost: number; running: number; dwell: number; board: number }
export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  minibus: { name: 'Minibus', mode: 'road', pax: true, capacity: 16, kmh: 35, cost: 60000, running: 8, dwell: 0.3, board: 3 },
  bus: { name: 'Single-decker', mode: 'road', pax: true, capacity: 60, kmh: 30, cost: 180000, running: 12, dwell: 0.4, board: 2.5 },
  decker: { name: 'Double-decker', mode: 'road', pax: true, capacity: 85, kmh: 28, cost: 280000, running: 16, dwell: 0.5, board: 2.5 },
  coach: { name: 'Coach', mode: 'road', pax: true, capacity: 55, kmh: 60, cost: 250000, running: 20, dwell: 1, board: 4 },
  lorry: { name: 'Lorry', mode: 'road', pax: false, capacity: 20, kmh: 45, cost: 90000, running: 14, dwell: 3, board: 6 },
  hgv: { name: 'HGV', mode: 'road', pax: false, capacity: 29, kmh: 55, cost: 140000, running: 20, dwell: 3, board: 6 },
  dmu: { name: 'Local diesel', mode: 'rail', pax: true, capacity: 150, kmh: 90, cost: 1200000, running: 120, dwell: 0.7, board: 0.6 },
  intercity: { name: 'Intercity', mode: 'rail', pax: true, capacity: 400, kmh: 160, cost: 4000000, running: 400, dwell: 1.5, board: 0.4 },
  hs: { name: 'High-speed', mode: 'rail', pax: true, capacity: 550, kmh: 250, cost: 9000000, running: 700, dwell: 2, board: 0.3 },
  tram: { name: 'Light rail', mode: 'rail', pax: true, capacity: 200, kmh: 50, cost: 1500000, running: 90, dwell: 0.4, board: 0.8 },
  rack: { name: 'Rack railcar', mode: 'rail', pax: true, capacity: 100, kmh: 40, cost: 1000000, running: 90, dwell: 0.6, board: 1 },
  freight: { name: 'Freight train', mode: 'rail', pax: false, capacity: 600, kmh: 70, cost: 2000000, running: 200, dwell: 10, board: 1 },
};
export const canServe = (v: VehicleDef, st: StopDef) => v.mode === st.mode && (v.pax ? st.pax : st.freight);

// ---------------- buildings ----------------
// Kinds match LotKind in roads.ts and the capacities match USE in buildgen.ts; they're only the
// fallback when the game doesn't say how many a building holds. `next` is what it densifies to.
export type BuildingKind = 'house' | 'terrace' | 'flats' | 'tower' | 'shop' | 'office' | 'industry' | 'civic';
export type Use = 'home' | 'shop' | 'office' | 'works' | 'civic';
export const USES: Use[] = ['home', 'shop', 'office', 'works', 'civic'];
// the uses the economy grows and shrinks (civic buildings come from the game's infill)
export const GROWN: Exclude<Use, 'civic'>[] = ['home', 'shop', 'office', 'works'];
export const BUILDINGS: Record<BuildingKind, { use: Use; cap: number; next?: BuildingKind }> = {
  house: { use: 'home', cap: 4, next: 'terrace' },
  terrace: { use: 'home', cap: 5, next: 'flats' },
  flats: { use: 'home', cap: 45, next: 'tower' },
  tower: { use: 'home', cap: 160 },
  shop: { use: 'shop', cap: 6 },
  office: { use: 'office', cap: 120 },
  industry: { use: 'works', cap: 60 },
  civic: { use: 'civic', cap: 10 },
};
// the kind a new building of each use starts as
export const ENTRY: Record<Exclude<Use, 'civic'>, BuildingKind> = { home: 'house', shop: 'shop', office: 'office', works: 'industry' };
export const USE_NAME: Record<Use, [string, string]> = {
  home: ['home', 'homes'], shop: ['shop', 'shops'], office: ['office', 'offices'], works: ['works', 'works'], civic: ['community building', 'community buildings'],
};

// ---------------- tuning ----------------
// Rates are per game hour and changes per review ("month"), so the calendar can be compressed
// (a month per game day, say) without retuning anything else.
export const TUNE = {
  stepMin: 60, // game minutes per simulation step
  monthDays: 30, // game days between reviews
  // getting about
  walkMpm: 80, // walking speed, metres per minute (4.8 km/h)
  detour: 1.3, // real route length over the straight line
  carAccessMin: 3, // walking to the car and parking at the far end
  boardMin: 1, // getting on a vehicle, however frequent
  transferMin: 5, // the dislike of changing, on top of the wait
  maxWaitMin: 30, // people plan round timetables longer than an hour, so waits cap out
  // Routes and modes are chosen on how long a journey feels: time spent walking to a stop and
  // waiting weighs about twice time on board (as in the DfT's WebTAG), and taking a bus or train
  // at all (the fare, the timetable) is worth a few minutes. Reach uses plain minutes.
  walkWeight: 2, waitWeight: 2, ptBiasMin: 5,
  transferWalkM: 250, // stops this close count as one interchange
  maxTransitMin: 150, // longest journey (as it feels) worth working out
  maxPairM: 25000, // places further apart than this don't trade trips (most commutes are shorter)
  // Zones this close pair one to one; beyond, a zone pairs with blocks of zones, three times
  // coarser at each step out, so the pairs grow with the zones, not their square.
  pairCellM: 1000,
  carShare: 0.7, // residents with a car to hand
  // trips
  tripsPerDay: 2.2, // one-way trips per resident per day
  gravityMin: 15, // destinations this many minutes further away are 1/e as attractive
  modeBeta: 0.15, // how sharply people pick the quicker way (per minute)
  carBiasMin: 4, // with a car to hand, bus or rail must beat it by this much to win half
  // reach: can residents get to work, shops and leisure in reasonable time?
  workerShare: 0.5,
  workMin: 30, shopMin: 20, leisureMin: 30,
  customersPerShopJob: 25,
  leisurePerCivicJob: 40, leisurePerShopJob: 8,
  homeBase: 0.15, // pressure for homes even with nothing in reach
  // how much each kind of reach matters to where people live; multiplied, so every one counts
  homeWeights: { work: 0.55, shop: 0.3, leisure: 0.15 },
  reachCap: 2, // plenty in reach counts, but only up to this
  jobCap: 1.3,
  labourSlack: 0.15, // firms open a little ahead of the workers they'll need
  supplySlack: 0.35, // and up to this much further when what they need is delivered to spare
  // what towns need fed to them
  goodsPerShopJobHour: 0.08,
  materialsPerWorksJobHour: 0.06,
  townStoreHours: 48, // a town takes goods and materials until it holds this many hours' use
  visitsPerOfficeJobDay: 0.25, // passengers arriving at the town's workplaces
  // share of what the town started with that it finds for itself: homes for people who don't
  // need to get to work (the retired, those working from home), and supplies for its businesses
  local: { homes: 0.5, goods: 0.55, materials: 0.55, visitors: 0.6 },
  // A town is lifted or held back into balance when the map is made, within this range: one far
  // short of what it needs (an estate with no jobs in reach) still shrinks, towards its floor.
  calibrateMin: 0.5, calibrateMax: 1.6,
  // smoothing and hysteresis
  supplyAlpha: 0.35, // a month's deliveries move the town's view of its supply this far
  demandAlpha: 0.5,
  baseDrift: 0.04, // a town that stays bigger slowly comes to find more for itself
  growAt: 1.04, growAfter: 2, // months of demand above capacity before building
  stopGrowBelow: 1.0,
  declineAt: 0.86, declineAfter: 3, // months of demand well below capacity before abandoning
  recoverAt: 0.92,
  growMax: 0.08, declineMax: 0.06, // of a use's capacity per month
  maxActions: 8, // per town per use per month
  moveIn: 0.4, moveOut: 0.15, // of the gap to the target occupancy, per month
  newOccupancy: 0.3,
  siteSpread: 0.25, // better-placed buildings fill first and empty last
  demolishAfter: 6, // months a building stands abandoned before it's cleared
  pendingMonths: 2, // how long a request to build waits for the game before it lapses
  restMonths: 6, // a zone or building the game couldn't build on isn't asked again for this long
  // industries (2D rules, reviewed monthly): production never falls below where it started
  industry: { up: 1.12, down: 0.96, max: 4, min: 1, collectedUp: 0.6, collectedDown: 0.15, inputUp: 0.5, stockHours: 48 },
  indCommuteM: 3000, // an industry's jobs count for zones this close
  freightHandleMin: 30, // loading, unloading or handing freight between yards, for choosing its route
  dwellAlpha: 0.3,
  roomAlpha: 0.5, // a month's crowding moves a line's share of people finding room this far
};
export type Tune = typeof TUNE;

// How busy trips are through the day (as traffic.ts): two rush hours, a lunchtime bump, quiet
// nights. Scaled so the day averages 1, so daily totals don't depend on the shape.
const rawShape = (h: number) => (h < 5 || h >= 23.5 ? 0.08
  : 0.22 + Math.exp(-(((h - 8.2) / 1.1) ** 2)) + 0.9 * Math.exp(-(((h - 17.4) / 1.3) ** 2)) + 0.35 * Math.exp(-(((h - 13) / 2) ** 2)));
const SHAPE_MEAN = (() => { let s = 0; for (let i = 0; i < 288; i++) s += rawShape(i / 12); return s / 288; })();
export const hourShape = (h: number) => rawShape(((h % 24) + 24) % 24) / SHAPE_MEAN;

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ================= contracts with the game =================
// Positions are metres on the ground plane (x, z), as everywhere in src/proto.
export interface TownIn { id: number; name: string; x: number; z: number; carShare?: number }
// A zone is a patch of a town (a street or a block) that buildings belong to. `plots` is how
// many free plots the game could still build on there; `allow` limits what may go up.
export interface ZoneIn { id: number; town: number; x: number; z: number; r?: number; plots: number; allow?: BuildingKind[] }
export interface BuildingIn { id: number; zone: number; x: number; z: number; kind: BuildingKind; capacity?: number; occupancy?: number }
export interface IndustryIn { id: number; kind: IndustryKind; x: number; z: number; name?: string; zone?: number }
export interface StopIn { id: number; kind: StopKind; x: number; z: number; name?: string; radius?: number }
// Vehicles visit `stops` in order and then start again from the first (A, B runs A-B-A).
export interface LineIn { id: number; name?: string; stops: number[]; vehicle: VehicleKind; count: number }
export interface WorldIn { towns: TownIn[]; zones: ZoneIn[]; buildings: BuildingIn[]; industries?: IndustryIn[]; stops?: StopIn[]; lines?: LineIn[] }
// The game answers these from its road and rail network (and congestion). Minutes of game time,
// Infinity when there's no way through. They should be cheap: cached or link-flow based.
export interface Oracles {
  travelTime(fromStop: number, toStop: number, vehicle: VehicleKind): number;
  carTime(fromZone: number, toZone: number): number;
}

// What the economy asks of the world. `add` and `densify` need the game to find the ground, so
// they're requests (`req`) the game answers by calling addBuilding/updateBuilding, or decline().
// The rest the economy has already applied to its own books; the game only shows them.
export type Action =
  | { t: 'add'; req: number; zone: number; kind: BuildingKind }
  | { t: 'densify'; req: number; building: number; kind: BuildingKind }
  | { t: 'vacate'; building: number; fraction: number } // fraction of the building now empty
  | { t: 'abandon'; building: number }
  | { t: 'restore'; building: number }
  | { t: 'demolish'; building: number };

export type EconEvent =
  | { t: 'money'; amount: number; kind: 'fare' | 'running'; line?: number; stop?: number; x?: number; z?: number }
  | { t: 'news'; text: string; x?: number; z?: number; town?: number; industry?: number };

export interface LineStats {
  id: number; name: string; vehicle: VehicleKind; vehicles: number; ok: boolean; problem?: string;
  cycleMin: number; headwayMin: number; capacityPerHour: number;
  carried: number; carriedLastMonth: number; loadFactor: number;
  revenue: number; running: number; profit: number; revenueLastMonth: number; profitLastMonth: number;
  waiting: number;
}
export interface StopStats { id: number; name: string; waiting: number; cargo: Partial<Record<CargoId, number>>; boarded: number; alighted: number; lines: number[] }
// Where a vehicle is along its line: on leg `leg` from stop `from` to stop `to`, `t` of the
// way (0 while it stands at `from`). x, z are a straight-line guess; the game has the real route.
export interface VehiclePos {
  line: number; index: number; leg: number; from: number; to: number; t: number; dwelling: boolean;
  x: number; z: number; load: number; capacity: number;
}
export type TownStatus = 'growing' | 'stable' | 'stalling' | 'declining';
export interface Reason { text: string; good: boolean; weight: number }
export interface UseReport { capacity: number; occupied: number; demand: number; pressure: number; buildings: number; abandoned: number }
export interface TownReport {
  id: number; name: string; status: TownStatus; headline: string; reasons: Reason[];
  residents: number; homes: number; vacancy: number; jobs: number; workers: number;
  uses: Record<Use, UseReport>;
  reach: { work: number; workCar: number; workNoCar: number; workTransit: number; shop: number; leisure: number };
  supply: { goods: number; materials: number; visitors: number; goodsPerHour: number; materialsPerHour: number; visitorsPerDay: number };
  // plots: free to build on; turnedAway: the share of those who came to board at its stops last
  // month who found no room
  service: { stops: number; lines: number; homesNearStop: number; plots: number; turnedAway: number };
  history: number[]; // residents at each of the last reviews, oldest first
}
