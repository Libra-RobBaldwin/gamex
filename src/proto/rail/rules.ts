// Where a road may cross a railway on the level (roads.ts asks, rail/crossing.ts works them).
// No imports, so the road network can ask without pulling in the railway.
export const MIN_SIN = 0.7; // the squarest a road may cross (sin of the angle: 45°)
export const CROSSING_CLEAR = 25; // metres from a road junction to a level crossing, at least

// Can a road cross this railway on the level here? (Reasons in words, or null if it can.)
export function levelCrossingOk(roadFamily: string, roadLanes: number, railMph: number, sin: number, nearJunction: boolean): string | null {
  if (roadFamily === 'Motorway' || roadFamily === 'Dual' || roadFamily === 'Boulevard' || roadLanes > 1) return 'Only single-carriageway roads can cross a railway on the level';
  if (railMph > 100) return 'No level crossings on lines faster than 100 mph';
  if (sin < MIN_SIN) return 'A level crossing has to be nearly square to the track (within 45°)';
  if (nearJunction) return 'Too close to a junction for a level crossing: queues would stand on the track';
  return null;
}

