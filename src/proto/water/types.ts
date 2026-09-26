// Shared vocabulary of the water system: what kinds of water there are, the river classes and
// what each asks of anything crossing or using it, and the tunable numbers.

export type WaterKind = 'sea' | 'lake' | 'river' | 'estuary' | 'canal';
// numeric codes for rasters and vertex attributes (0 is dry land)
export const KIND_CODE: Record<WaterKind, number> = { sea: 1, lake: 2, river: 3, estuary: 4, canal: 5 };
export const KIND_OF = [null, 'sea', 'lake', 'river', 'estuary', 'canal'] as const;

export type RiverClass = 'stream' | 'river' | 'navigable' | 'canal' | 'estuary';

// What each class of watercourse means for the things that cross it and use it. Bridges keep
// piers out of the navigation channel and their soffit at least `clearance` above the design
// level; ships and boats need `draught` of water. Numbers after UK practice:
//   - streams: culverts or footbridges, a freeboard over the flood level;
//   - rivers: canoes and small craft, and room for floods;
//   - navigable rivers: the Thames above Teddington has about 4 m headroom and 1.8 m draught;
//   - canals: broad canals keep about 2.7 m headroom (narrow ones 2.1 m) and 1.2 m of water;
//   - estuaries: coasters and small sea-going ships (Humber and Severn bridges give 30 m or more;
//     18 m is a sensible floor for a crossing that keeps a port behind it open).
export interface NavRule {
  clearance: number; // m, soffit above the design water level
  draught: number; // m, depth a boat needs (0 = not navigable)
  channel: number; // share of the width kept clear of piers
  minChannel: number; // m, narrowest channel kept clear (if the water is that wide)
  freeboard: number; // m, the design (flood) level above the normal surface
  label: string;
}
export const NAV: Record<RiverClass | 'lake' | 'sea', NavRule> = {
  stream: { clearance: 0.6, draught: 0, channel: 0, minChannel: 0, freeboard: 0.6, label: 'stream' },
  river: { clearance: 2.5, draught: 0, channel: 0.5, minChannel: 4, freeboard: 1.5, label: 'river' },
  navigable: { clearance: 4.5, draught: 1.8, channel: 0.6, minChannel: 12, freeboard: 1.5, label: 'navigable river' },
  canal: { clearance: 2.7, draught: 1.2, channel: 0.7, minChannel: 6, freeboard: 0.3, label: 'canal' },
  estuary: { clearance: 18, draught: 4, channel: 0.4, minChannel: 40, freeboard: 3, label: 'estuary' },
  lake: { clearance: 3, draught: 1, channel: 0.5, minChannel: 10, freeboard: 0.5, label: 'lake' },
  sea: { clearance: 30, draught: 6, channel: 0.5, minChannel: 100, freeboard: 4, label: 'sea' },
};

export interface WaterParams {
  sea: number | null; // sea level, or none
  // hydrology works on regions: `region` metres a side (a whole number of 1 km tiles), with
  // `margin` metres of ground either side so catchments reaching in from outside are counted,
  // on a grid `cell` metres apart
  region: number;
  margin: number;
  cell: number;
  riverArea: number; // km² of catchment where a stream begins
  // hydraulic geometry (Leopold and Maddock): width = widthK·A^widthExp, depth = depthK·A^depthExp,
  // with A the catchment in km². Scaled up from nature so rivers read at the game's scale.
  widthK: number; widthExp: number;
  depthK: number; depthExp: number;
  maxWidth: number; // m, the widest river channel
  bankSlope: number; // rise over run of a river bank above the water
  // closed hollows fill to their spill level (a humid climate): only those this deep and big
  // become lakes, so small noise pits don't turn into ponds
  // A hollow a river runs through is cut through instead (it erodes its sill) unless it is deeper
  // than basinDepth + breach·√(catchment in km²), so big rivers don't pond behind every dip.
  basinDepth: number; // m
  basinArea: number; // km²
  breach: number;
  drawdown: number; // m a lake stands below its spill point (so flats at that level stay dry)
  seaArea: number; // km²: below sea level and connected, but not touching the region's edge: a lagoon or polder
  estuaryRise: number; // m above sea level up to which a river mouth is tidal
  estuaryLength: number; // m, the longest estuary
  estuaryMouth: number; // m, the widest mouth
  estuaryArea: number; // km² of catchment a river needs to have a tidal mouth
  manning: number; // Manning's roughness, for flow speed
  meander: number; // meander amplitude in channel widths (0 = rivers keep to the smoothed line)
}

export const DEFAULT_WATER: WaterParams = {
  sea: null, region: 8000, margin: 2000, cell: 32,
  riverArea: 0.5, widthK: 3.2, widthExp: 0.5, depthK: 0.45, depthExp: 0.4, maxWidth: 120, bankSlope: 0.6,
  basinDepth: 4, basinArea: 0.1, breach: 1.2, drawdown: 0.3, seaArea: 2,
  estuaryRise: 3, estuaryLength: 2500, estuaryMouth: 420, estuaryArea: 4, manning: 0.035, meander: 1,
};

export interface Flow { x: number; z: number; speed: number } // unit direction (x, z) and m/s

// Where a point stands with respect to water.
export interface WaterPoint {
  ground: number; // the bed, or the ground if dry
  level: number | null; // water surface, or null when dry
  kind: WaterKind | null;
  body: string | null; // stable id of the water body
}

// The river (or canal) at a point: what a bridge or a boat needs to know.
export interface Watercourse {
  cls: RiverClass;
  reach: string; // stable id
  width: number; // m, bank to bank at the waterline
  depth: number; // m, at the centre
  surface: number; // normal water level, absolute
  design: number; // design (flood) level: surface + freeboard
  flow: Flow;
  offset: number; // m from the centre line (+ to the left looking downstream)
  channel: number; // m, half-width of the navigation channel kept clear of piers (0 if none)
  clearance: number; // m above the design level a bridge soffit must be
  draught: number; // m a boat needs (0 = not navigable)
  area: number; // km² of catchment
}
