// The catalogue of roads and railways. Rather than a handful of fixed types, cross-sections are
// generated from a few real-world rules (how many lanes, how fast, what's at the kerb), which
// gives around a hundred variants. Players narrow them down with a few filters instead of
// scrolling through them all; the four everyday ones are presets.

export type Cls = 'road' | 'rail';
export type Family = 'Street' | 'Avenue' | 'Boulevard' | 'Arterial' | 'Rural' | 'Dual' | 'Motorway' | 'Rail';
export interface RoadDef {
  id: string; label: string; icon: string; cls: Cls; family: Family;
  // per side of the centreline, from the middle out: half the reservation, the general lanes,
  // a bus lane, a cycle lane, parking bays, a hard shoulder; then pavement or grass verge
  lanes: number; lane: number; median: number; medianKind: 'none' | 'hatch' | 'barrier' | 'grass' | 'trees';
  bus: number; cycle: number; parking: number; shoulder: number; pave: number; verge: number;
  mph: number; speed: number; cost: number; minR: number; maxGrade: number; frontage: boolean; trees: boolean;
  tracks: number; rack: boolean; electric: boolean; blurb: string;
}

// centreline to the kerb (the edge of the carriageway, or the edge of the ballast for track)
export const kerbOf = (d: RoadDef) => (d.cls === 'rail' ? (d.tracks === 2 ? 4.3 : 2.4) : d.median / 2 + d.lanes * d.lane + d.bus + d.cycle + d.parking + d.shoulder);
// centreline to the back of the pavement or verge
export const halfOf = (d: RoadDef) => kerbOf(d) + d.pave + d.verge;

const MIN_R: Record<number, number> = { 20: 10, 30: 14, 40: 40, 50: 80, 60: 130, 70: 180 };
const GRADE: Record<number, number> = { 20: 0.08, 30: 0.08, 40: 0.07, 50: 0.06, 60: 0.06, 70: 0.05 };
const ICON: Record<Family, string> = { Street: '🏘️', Avenue: '🌳', Boulevard: '🌳', Arterial: '🚌', Rural: '🌾', Dual: '🛣️', Motorway: '🚀', Rail: '🚆' };

function road(id: string, family: Family, o: Partial<RoadDef> & { lanes: number; mph: number }): RoadDef {
  const d: RoadDef = {
    id, label: '', icon: ICON[family], cls: 'road', family, lane: 3.25, median: 0, medianKind: 'none', bus: 0, cycle: 0, parking: 0, shoulder: 0, pave: 2.4, verge: 0,
    speed: o.mph * 0.447, cost: 0, minR: MIN_R[o.mph], maxGrade: GRADE[o.mph], frontage: family !== 'Motorway' && o.mph <= 50, trees: false, tracks: 0, rack: false, electric: false, blurb: '',
    ...o,
  };
  d.trees ||= d.pave >= 5 || d.medianKind === 'trees';
  const width = halfOf(d) * 2;
  // wider, faster roads cost more per metre (barriers, drainage, lighting)
  d.cost = Math.round((width * 22 * (1 + Math.max(0, d.mph - 30) / 20)) / 10) * 10;
  const bits = [
    d.lanes === 1 ? '1 lane each way' : `${d.lanes} lanes each way`,
    d.bus ? 'bus lanes' : '', d.cycle ? 'cycle lanes' : '', d.parking ? 'parking bays' : '',
    d.medianKind === 'barrier' ? 'central barrier' : d.medianKind === 'trees' ? 'tree-lined centre' : d.medianKind === 'hatch' ? 'hatched centre' : d.medianKind === 'grass' ? 'grass reservation' : '',
    d.shoulder ? 'hard shoulders' : '', d.pave >= 5 ? 'tree-lined pavements' : d.pave >= 4 ? 'wide pavements' : d.pave ? '' : 'grass verges',
  ].filter(Boolean);
  d.blurb = `${bits.join(' · ')} · ${d.mph} mph`;
  const extras = [d.bus && 'bus lanes', d.cycle && 'cycle lanes', d.parking && 'parking', d.pave >= 4 && family === 'Street' && 'wide pavements'].filter(Boolean);
  d.label = `${family}${d.lanes > 1 && family !== 'Dual' && family !== 'Motorway' ? ` ${d.lanes}+${d.lanes}` : family === 'Dual' || family === 'Motorway' ? ` ${d.lanes}+${d.lanes}` : ''} · ${d.mph} mph${extras.length ? ` · ${extras.join(', ')}` : ''}`;
  return d;
}

function rail(id: string, label: string, o: Partial<RoadDef> & { mph: number }): RoadDef {
  return {
    id, label, icon: o.rack ? '⛰️' : '🚆', cls: 'rail', family: 'Rail', lanes: 0, lane: 0, median: 0, medianKind: 'none', bus: 0, cycle: 0, parking: 0, shoulder: 0, pave: 0, verge: 2,
    speed: o.mph * 0.447, cost: 2000, minR: 150, maxGrade: 0.035, frontage: false, trees: false, tracks: 2, rack: false, electric: false, blurb: '', ...o,
  };
}

export const ROADS: Record<string, RoadDef> = {};
const add = (d: RoadDef) => { ROADS[d.id] = d; };
// the presets everyone reaches for
add(road('street', 'Street', { lanes: 1, mph: 30 }));
add(road('avenue', 'Avenue', { lanes: 1, mph: 30, lane: 3.5, pave: 5 }));
add(road('dual', 'Dual', { lanes: 2, mph: 50, lane: 3.5, median: 2.4, medianKind: 'barrier', pave: 2.6 }));
add(road('motorway', 'Motorway', { lanes: 3, mph: 70, lane: 3.65, median: 3, medianKind: 'grass', shoulder: 3.3, pave: 0, verge: 3 }));
// and the rest, from the rules
for (const mph of [20, 30]) for (const pave of [2.4, 4]) for (const parking of [0, 2.2]) for (const cycle of [0, 1.5]) {
  const id = `street-${mph}-${pave}-${parking}-${cycle}`;
  if (mph === 30 && pave === 2.4 && !parking && !cycle) continue;
  add(road(id, 'Street', { lanes: 1, mph, pave, parking, cycle }));
}
for (const parking of [0, 2.2]) for (const cycle of [0, 1.8]) if (parking || cycle) add(road(`avenue-${parking}-${cycle}`, 'Avenue', { lanes: 1, mph: 30, lane: 3.5, pave: 5, parking, cycle }));
for (const mph of [30, 40]) for (const bus of [0, 3.2]) for (const cycle of [0, 1.8])
  add(road(`boulevard-${mph}-${bus}-${cycle}`, 'Boulevard', { lanes: 2, mph, lane: 3.25, median: 4, medianKind: 'trees', pave: 5, bus, cycle }));
for (const lanes of [1, 2]) for (const mph of [30, 40]) for (const bus of [0, 3.2]) for (const cycle of [0, 1.8]) for (const parking of [0, 2.2]) {
  if (bus && parking) continue; // a bus lane and parking don't share the kerb
  add(road(`arterial-${lanes}-${mph}-${bus}-${cycle}-${parking}`, 'Arterial', { lanes, mph, lane: mph === 40 ? 3.65 : 3.5, median: lanes === 1 && mph === 40 ? 1.2 : 0, medianKind: lanes === 1 && mph === 40 ? 'hatch' : 'none', pave: 2.6, bus, cycle, parking }));
}
for (const mph of [40, 50, 60]) add(road(`rural-${mph}`, 'Rural', { lanes: 1, mph, lane: mph === 60 ? 3.65 : 3.5, pave: 0, verge: 2.5 }));
for (const lanes of [2, 3]) for (const mph of [40, 50, 60, 70]) for (const bus of [0, 3.2]) {
  if (bus && mph > 40) continue;
  if (lanes === 2 && mph === 50 && !bus) continue; // that's the preset
  const fast = mph >= 60;
  add(road(`dual-${lanes}-${mph}-${bus}`, 'Dual', { lanes, mph, lane: fast ? 3.65 : 3.5, median: fast ? 4 : 2.4, medianKind: fast ? 'grass' : 'barrier', pave: fast ? 0 : 2.6, verge: fast ? 3 : 0, bus }));
}
for (const lanes of [2, 4]) add(road(`motorway-${lanes}`, 'Motorway', { lanes, mph: 70, lane: 3.65, median: 3, medianKind: 'grass', shoulder: 3.3, pave: 0, verge: 3 }));
add(road('motorway-smart', 'Motorway', { lanes: 4, mph: 70, lane: 3.65, median: 3, medianKind: 'barrier', shoulder: 0, pave: 0, verge: 3 }));
// railways: how steep they can climb matters as much as how fast they are
add(rail('rail-branch', 'Branch line', { mph: 60, tracks: 1, maxGrade: 0.035, minR: 150, cost: 1600, blurb: 'Single track · 60 mph · up to 3.5% (adhesion trains)' }));
add(rail('rail-main', 'Main line', { mph: 100, tracks: 2, maxGrade: 0.025, minR: 300, cost: 3200, electric: true, blurb: 'Double track, electrified · 100 mph · up to 2.5%' }));
add(rail('rail-hs', 'High speed', { mph: 186, tracks: 2, maxGrade: 0.035, minR: 600, cost: 7000, electric: true, blurb: 'Double track, electrified · 186 mph · up to 3.5% (powerful trains)' }));
add(rail('rail-light', 'Light rail', { mph: 50, tracks: 2, maxGrade: 0.06, minR: 40, cost: 2200, electric: true, blurb: 'Double track, electrified · 50 mph · up to 6% · tight curves' }));
add(rail('rail-rack', 'Rack railway', { mph: 25, tracks: 1, maxGrade: 0.2, minR: 60, cost: 2600, rack: true, blurb: 'Single track with a toothed rack · up to 20% · rack trains only, slow on the rack' }));

export const PRESETS = ['street', 'avenue', 'dual', 'motorway'];
export const RAIL_PRESETS = ['rail-branch', 'rail-main', 'rail-hs', 'rail-light', 'rail-rack'];

export interface RoadFilter { family?: Family; lanes?: number; mph?: number; trees?: boolean; bus?: boolean; cycle?: boolean; parking?: boolean }
export function filterRoads(f: RoadFilter) {
  return Object.values(ROADS).filter((d) => d.cls === 'road'
    && (f.family === undefined || d.family === f.family) && (f.lanes === undefined || d.lanes === f.lanes) && (f.mph === undefined || d.mph === f.mph)
    && (f.trees === undefined || d.trees === f.trees) && (f.bus === undefined || !!d.bus === f.bus) && (f.cycle === undefined || !!d.cycle === f.cycle) && (f.parking === undefined || !!d.parking === f.parking))
    .sort((a, b) => halfOf(a) - halfOf(b));
}

// Rolling stock. Adhesion trains are limited by how steep the line is and slow on climbs; rack
// railcars can take a rack railway's gradients, but crawl on the rack and are slow elsewhere.
// accel and brake (m/s²): how hard it pulls away and how hard its service brake stops it; signals
// are sighted and trains brake for them with these (rail/sim.ts). Sets from the vehicle library
// leave them out and get their kind's usual figures (trainBraking).
export interface TrainDef { id: string; label: string; icon: string; mph: number; maxGrade: number; rack: boolean; cars: number; carLen: number; color: string; stripe: string; needsWires: boolean; blurb: string; accel?: number; brake?: number }
export const TRAINS: Record<string, TrainDef> = {
  dmu: { accel: 0.8, brake: 0.9, id: 'dmu', label: 'Local diesel', icon: '🚃', mph: 75, maxGrade: 0.035, rack: false, cars: 2, carLen: 20, color: '#2f6f9e', stripe: '#e0c14a', needsWires: false, blurb: '75 mph · climbs up to 3.5%, slowing on the way up' },
  intercity: { accel: 0.5, brake: 0.7, id: 'intercity', label: 'Intercity', icon: '🚄', mph: 125, maxGrade: 0.03, rack: false, cars: 5, carLen: 23, color: '#e8e6e0', stripe: '#c9302c', needsWires: false, blurb: '125 mph · up to 3% · heavy, loses speed on gradients' },
  hs: { accel: 0.6, brake: 0.75, id: 'hs', label: 'High-speed', icon: '🚅', mph: 186, maxGrade: 0.035, rack: false, cars: 8, carLen: 25, color: '#f2f2f2', stripe: '#1f4f9e', needsWires: true, blurb: '186 mph on high-speed lines · electric only' },
  tram: { accel: 1.2, brake: 1.3, id: 'tram', label: 'Light rail', icon: '🚋', mph: 50, maxGrade: 0.07, rack: false, cars: 2, carLen: 16, color: '#c9302c', stripe: '#f2f2f2', needsWires: true, blurb: '50 mph · climbs 7% · electric only' },
  rack: { accel: 0.6, brake: 0.9, id: 'rack', label: 'Rack railcar', icon: '⛰️', mph: 35, maxGrade: 0.2, rack: true, cars: 2, carLen: 15, color: '#b0463a', stripe: '#f2e0a0', needsWires: false, blurb: '35 mph, 12 mph on the rack · climbs 20% · can use any line' },
};
// How hard a train pulls away and brakes (m/s²), for sets that don't say: trams sharpest, heavy
// expresses gentlest.
export function trainBraking(t: TrainDef) {
  const tram = t.maxGrade >= 0.06 && !t.rack, fast = t.mph >= 110;
  return { accel: t.accel ?? (tram ? 1.2 : fast ? 0.5 : 0.8), brake: t.brake ?? (tram ? 1.3 : fast ? 0.7 : 0.9) };
}
// How fast a train can go on a stretch of track with a given climb.
export function trainSpeed(t: TrainDef, track: RoadDef, grade: number) {
  let v = Math.min(t.mph, track.mph) * 0.447;
  if (track.rack && grade > 0.04) return Math.min(v, 12 * 0.447); // on the rack
  const climb = Math.max(0, grade);
  // adhesion: speed falls away as the climb approaches what the train can manage
  v *= Math.max(0.3, 1 - (climb / t.maxGrade) * 0.6);
  return v;
}
