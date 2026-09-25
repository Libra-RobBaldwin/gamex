// Farmsteads: a farmhouse, a barn and a shed round a worn yard, beside a lane (region/fields.ts
// says where). Every farm on the map is one merged, flat-shaded, vertex-coloured mesh: one draw
// call, a hundred-odd triangles a farm. Heights are above the ground (a map with hills drapes it).
import * as THREE from 'three';
import { hash2 } from './noise';
import type { XZ } from './layout';

export interface FarmSpot { x: number; z: number; a: number; side: number; seed: number; track?: [XZ, XZ] }

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

// its drive, if it stands back from the road: a strip of worn earth 3.5 m wide
export function farmTrack(f: FarmSpot): XZ[] | null {
  if (!f.track) return null;
  const [a, b] = f.track, L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = (-(b.z - a.z) / L) * 1.75, nz = ((b.x - a.x) / L) * 1.75;
  return [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }];
}

interface Part { u: number; v: number; w: number; d: number; h: number; ridge: number; wall: string; roof: string }
const WALLS = ['#b9a888', '#a4674a', '#c2b59b', '#8f5a42'], BARN = ['#6e5d4b', '#7b8078', '#5f6b5a'], ROOFS = ['#56514d', '#6a4a3c', '#4d5552'];
function partsOf(f: FarmSpot): Part[] {
  const r = (k: number) => hash2(f.seed & 0xffff, f.seed >>> 16, k), m = r(1) < 0.5 ? 1 : -1;
  const house: Part = { u: -12 * m, v: -7, w: 10 + r(2) * 3, d: 7, h: 5.6, ridge: 3, wall: WALLS[Math.floor(r(3) * WALLS.length)], roof: ROOFS[Math.floor(r(4) * ROOFS.length)] };
  const barn: Part = { u: 9 * m, v: 5, w: 22 + r(5) * 8, d: 12 + r(6) * 3, h: 6 + r(7), ridge: 3.2, wall: BARN[Math.floor(r(8) * BARN.length)], roof: '#4a504b' };
  const shed: Part = { u: -8 * m, v: 13, w: 14 + r(9) * 6, d: 7, h: 4.2, ridge: 1.4, wall: BARN[Math.floor(r(10) * BARN.length)], roof: '#5b5f58' };
  return r(11) < 0.3 ? [house, barn] : [house, barn, shed];
}

// One mesh for every farm (null for none).
export function farmMesh(farms: FarmSpot[]): THREE.Mesh | null {
  if (!farms.length) return null;
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  const tri = (a: number[], b: number[], d: number[], hex: string, k = 1) => { c.set(hex).multiplyScalar(k); pos.push(...a, ...b, ...d); for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b); };
  const quad = (a: number[], b: number[], d: number[], e: number[], hex: string, k = 1) => { tri(a, b, d, hex, k); tri(a, d, e, hex, k); };
  for (const f of farms) {
    const at = frame(f);
    for (const p of partsOf(f)) {
      const hw = p.w / 2, hd = p.d / 2, top = p.h, peak = p.h + p.ridge;
      const P = (u: number, v: number, y: number) => { const q = at(p.u + u, p.v + v); return [q.x, y, q.z]; };
      const g = -0.6; // (walls go a little into the ground)
      // walls: long sides, then the gable ends (up to the ridge)
      const A = [-hw, -hd], B = [hw, -hd], C = [hw, hd], D = [-hw, hd];
      for (const [p0, p1] of [[A, B], [B, C], [C, D], [D, A]]) {
        const s = hash2(Math.round(p0[0] * 10), Math.round(p0[1] * 10), 3) * 0.08;
        quad(P(p0[0], p0[1], g), P(p1[0], p1[1], g), P(p1[0], p1[1], top), P(p0[0], p0[1], top), p.wall, 0.92 + s);
      }
      // (the gables' triangles, and the roof's two slopes, overhanging a little)
      tri(P(hw, -hd, top), P(hw, 0, peak), P(hw, hd, top), p.wall);
      tri(P(-hw, hd, top), P(-hw, 0, peak), P(-hw, -hd, top), p.wall);
      const o = 0.5;
      quad(P(-hw - o, -hd - o, top - 0.3), P(-hw - o, 0, peak), P(hw + o, 0, peak), P(hw + o, -hd - o, top - 0.3), p.roof);
      quad(P(hw + o, hd + o, top - 0.3), P(hw + o, 0, peak), P(-hw - o, 0, peak), P(-hw - o, hd + o, top - 0.3), p.roof);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'farms';
  return mesh;
}
