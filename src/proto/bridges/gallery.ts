// One crossing per bridge type, each a river and a road or railway of the size that type is for,
// in a year it could be built. Used by the demo's gallery and by the tests (every type must be
// buildable on its own showcase crossing).
import { ROADS } from '../catalog';
import type { BridgeId } from './catalogue';
import { scenario, type ScenarioOpts } from './scenario';

export const GALLERY: Record<BridgeId, ScenarioOpts> = {
  trestle: { length: 300, road: ROADS['rail-branch'], year: 1880, valley: { s0: 70, s1: 250, depth: 13 }, river: { s0: 145, s1: 175, depth: 1.5 }, under: [{ s: 198, kind: 'road', half: 3 }] },
  masonry: { length: 520, road: ROADS['rail-main'], year: 1880, valley: { s0: 110, s1: 410, depth: 16 }, river: { s0: 235, s1: 285, depth: 3, channel: { width: 18, clear: 6 } }, under: [{ s: 320, kind: 'road', half: 5 }] },
  girder: { length: 420, road: ROADS['rail-main'], year: 1905, valley: { s0: 80, s1: 340, depth: 12 }, river: { s0: 175, s1: 235, channel: { width: 30, clear: 6 } }, under: [{ s: 262, kind: 'road', half: 6 }] },
  'truss-through': { length: 1300, road: ROADS['rail-main'], year: 1925, river: { s0: 520, s1: 720, depth: 6, channel: { width: 110, clear: 8 } }, under: [{ s: 748, kind: 'road', half: 6 }] },
  'truss-deck': { length: 560, road: ROADS['rural-60'], year: 1935, valley: { s0: 110, s1: 450, depth: 38 }, river: { s0: 250, s1: 310, channel: { width: 40, clear: 5 } }, under: [{ s: 350, kind: 'rail', half: 5 }] },
  beam: { length: 420, road: ROADS.dual, year: 1990, river: { s0: 170, s1: 245, channel: { width: 30, clear: 6 } }, under: [{ s: 272, kind: 'road', half: 6 }] },
  box: { length: 1100, road: ROADS.motorway, year: 2000, valley: { s0: 200, s1: 900, depth: 30 }, river: { s0: 470, s1: 630, depth: 6, channel: { width: 140, clear: 10 } }, under: [{ s: 700, kind: 'rail', half: 6 }] },
  'arch-concrete': { length: 520, road: ROADS['rural-60'], year: 1965, valley: { s0: 100, s1: 420, depth: 55 }, river: { s0: 235, s1: 285, depth: 3 }, under: [{ s: 305, kind: 'road', half: 5 }] },
  'arch-tied': { length: 620, road: ROADS['arterial-2-40-0-0-0'] ?? ROADS.dual, year: 1995, river: { s0: 230, s1: 360, depth: 5, channel: { width: 100, clear: 9 } }, under: [{ s: 385, kind: 'road', half: 6 }] },
  'cable-stayed': { length: 1900, road: ROADS.dual, year: 2012, river: { s0: 680, s1: 1220, depth: 10, channel: { width: 260, clear: 28 } }, under: [{ s: 1270, kind: 'road', half: 6 }] },
  suspension: { length: 3500, road: ROADS.motorway, year: 1975, river: { s0: 1150, s1: 2350, depth: 14, channel: { width: 700, clear: 38 } }, under: [{ s: 2410, kind: 'road', half: 6 }] },
  bascule: { length: 320, road: ROADS.street, year: 1905, river: { s0: 125, s1: 195, depth: 4, channel: { width: 34, clear: 20, tallPerHour: 1, inProfile: false } }, under: [{ s: 215, kind: 'road', half: 5 }] },
};

export const galleryScenario = (id: BridgeId) => scenario(GALLERY[id]);

// The chooser's showcase: a busy river crossed by a dual carriageway today.
export const RIVER_CROSSING: ScenarioOpts = { length: 900, road: ROADS.dual, year: 2025, river: { s0: 300, s1: 560, depth: 7, channel: { width: 120, clear: 12, tallPerHour: 1 } }, under: [{ s: 600, kind: 'road', half: 6 }], bend: 60 };
