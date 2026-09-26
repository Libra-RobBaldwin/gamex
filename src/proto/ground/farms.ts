// Farmsteads' ground: the worn yard round a farm's buildings, and its track to the road (region/fields.ts
// says where farms are; a 50 km map's tiles draw their buildings: worldmap/country.ts farmsIn). Pure.
import type { XZ } from './layout';

export interface FarmSpot { x: number; z: number; a: number; side: number; seed: number; track?: XZ[] }

// the farm's frame: u along the lane, v away from it (the farm's middle is 30 m off the lane)
function frame(f: FarmSpot) {
  const ux = Math.cos(f.a), uz = Math.sin(f.a), vx = -uz * f.side, vz = ux * f.side;
  return (u: number, v: number): XZ => ({ x: f.x + u * ux + v * vx, z: f.z + u * uz + v * vz });
}
// its yard: what the ground paints worn, and keeps hedges and trees off
export function farmYard(f: FarmSpot): XZ[] {
  const at = frame(f);
  return [at(-24, -17), at(24, -17), at(24, 21), at(-24, 21)];
}

// its drive, if it stands back from the road: a strip of worn earth 3.5 m wide along its track
export function farmTrack(f: FarmSpot): XZ[] | null {
  const P = f.track;
  if (!P || P.length < 2) return null;
  const L: XZ[] = [], R: XZ[] = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], d = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = (-(b.z - a.z) / d) * 1.75, nz = ((b.x - a.x) / d) * 1.75;
    L.push({ x: P[i].x + nx, z: P[i].z + nz }); R.push({ x: P[i].x - nx, z: P[i].z - nz });
  }
  return [...L, ...R.reverse()];
}
