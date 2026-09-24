// The edge of the map: a cut face, like a slice through the ground (the bridges demo's look). A
// lip of turf, dark topsoil, a band of subsoil, then bedrock down to a level base. Where a road or
// railway runs off the map, the slice shows it too: the surface and the stone it's laid on. One
// mesh with vertex colours, so one draw call. (A paper-thin edge gives the game away.)
import * as THREE from 'three';
import { EARTH_COLOURS } from '../bridges/earthworks';
import { kerbOf } from '../catalog';
import { STD } from '../standards';
import type { Network } from '../roads';

// bands by depth below the surface (m); the edges between them wander a little, as real strata do
const BANDS: [string, number, number][] = [[EARTH_COLOURS.turf, 0, 0.35], [EARTH_COLOURS.topsoil, 0.35, 1.4], [EARTH_COLOURS.subsoil, 1.4, 5], [EARTH_COLOURS.bedrock, 5, Infinity]];
export const EDGE_BASE = -26; // how far down the slice goes
const ROAD = { asphalt: '#3d4046', footway: '#b3a996', subbase: '#8a8378', ballast: '#8f887c' };
const STEP = 4; // metres between the face's columns

// How much a band's lower edge wanders (m) at distance s along the perimeter: a few gentle waves
const wander = (s: number, k: number) => 0.18 * Math.sin(s * 0.031 + k * 1.7) + 0.12 * Math.sin(s * 0.093 + k * 4.1) + 0.06 * Math.sin(s * 0.27 + k);

// A road or railway crossing the edge: where along the side (u, across it), its half-widths, its level.
export interface EdgeCrossing { side: number; u: number; half: number; kerb: number; y: number; rail: boolean }

// Roads that run off the map (ending near the buildable edge, heading out) cross the cut face
// at `edge` where they'd reach it running straight on.
export function edgeCrossings(net: Network, edge: number): EdgeCrossing[] {
  const out: EdgeCrossing[] = [], near = net.bound - STD.mapEdge - 1;
  for (const s of net.segs.values()) {
    const path = net.path(s);
    if (path.length < 2) continue;
    for (const [p, q] of [[path[path.length - 1], path[path.length - 2]], [path[0], path[1]]]) {
      if (Math.max(Math.abs(p.x), Math.abs(p.z)) < near) continue;
      const L = Math.hypot(p.x - q.x, p.z - q.z) || 1, dx = (p.x - q.x) / L, dz = (p.z - q.z) / L;
      // which side it's heading out through, and where it meets it
      const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 2) : dz > 0 ? 1 : 3;
      const along = side === 0 || side === 2 ? dx : dz;
      const pos = side === 0 || side === 2 ? p.x : p.z;
      const t = (Math.sign(along) * edge - pos) / along;
      if (!(t >= 0)) continue;
      const hit = { x: p.x + dx * t, z: p.z + dz * t };
      const d = net.def(s), cos = Math.abs(along) || 1; // (a road meeting the edge at a slant is wider along it)
      out.push({ side, u: [-hit.z, hit.x, hit.z, -hit.x][side], half: net.half(s) / cos, kerb: (d.cls === 'rail' ? net.half(s) : kerbOf(d)) / cos, y: p.y ?? 0, rail: d.cls === 'rail' });
    }
  }
  return out;
}

export function edgeMesh(edge: number, crossings: EdgeCrossing[] = []) {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const c = new THREE.Color();
  // side k's frame: a point u along it (-edge..edge) and its outward normal
  const P = (k: number, u: number, y: number): [number, number, number] =>
    k === 0 ? [edge, y, -u] : k === 1 ? [u, y, edge] : k === 2 ? [-edge, y, u] : [-u, y, -edge];
  const out = (k: number, d: number): [number, number] => (k === 0 ? [d, 0] : k === 1 ? [0, d] : k === 2 ? [-d, 0] : [0, -d]);
  // a quad on side k from u0 to u1, heights ya0..ya1 at u0 and yb0..yb1 at u1, pushed out by `d`
  const quad = (k: number, u0: number, u1: number, ya0: number, ya1: number, yb0: number, yb1: number, hex: string, d = 0) => {
    if (ya1 - ya0 < 1e-3 && yb1 - yb0 < 1e-3) return;
    const [ox, oz] = out(k, d), a = P(k, u0, ya0), b = P(k, u1, yb0), e = P(k, u1, yb1), f = P(k, u0, ya1);
    for (const v of [a, b, e, a, e, f]) pos.push(v[0] + ox, v[1], v[2] + oz);
    // lit as if tipped back towards the sky a little: a face turned from the sun would otherwise
    // be nearly black, and the slice should read from every side
    const [nx, nz] = out(k, 0.6);
    for (let i = 0; i < 6; i++) nor.push(nx, 0.8, nz);
    c.set(hex);
    for (let i = 0; i < 6; i++) col.push(c.r, c.g, c.b);
  };
  // (sides are walked so each quad faces outwards; u runs the same way round for every side)
  for (let k = 0; k < 4; k++) {
    for (let u = -edge; u < edge - 1e-6; u += STEP) {
      const u1 = Math.min(edge, u + STEP), s0 = k * 2 * edge + u, s1 = s0 + (u1 - u);
      for (let b = 0; b < BANDS.length; b++) {
        const [hex, d0, d1] = BANDS[b];
        const top0 = b === 0 ? 0 : -(d0 + wander(s0, b - 1)), top1 = b === 0 ? 0 : -(d0 + wander(s1, b - 1));
        const bot0 = d1 === Infinity ? EDGE_BASE : -(d1 + wander(s0, b)), bot1 = d1 === Infinity ? EDGE_BASE : -(d1 + wander(s1, b));
        quad(k, u, u1, bot0, top0, bot1, top1, hex);
      }
    }
  }
  // roads and railways running off the map, in section: laid a few centimetres proud of the face
  // (so they never fight it for the same pixels)
  for (const x of crossings) {
    const lay = (h0: number, h1: number, y0: number, y1: number, hex: string, d: number) => quad(x.side, x.u + h0, x.u + h1, x.y + y0, x.y + y1, x.y + y0, x.y + y1, hex, d);
    if (x.rail) { lay(-x.half, x.half, -0.5, 0.35, ROAD.ballast, 0.04); continue; }
    lay(-x.half, x.half, -0.35, 0.15, ROAD.footway, 0.03); // footways (or verges) on their base
    lay(-x.kerb, x.kerb, -0.75, 0.25, ROAD.subbase, 0.05); // the carriageway's stone...
    lay(-x.kerb, x.kerb, 0.02, 0.25, ROAD.asphalt, 0.07); // ...and its surface
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'map edge';
  return m;
}
