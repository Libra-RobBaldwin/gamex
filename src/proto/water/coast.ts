// A coast for procedural terrain. ProceduralTerrain has a sea level but no seaward fall, so its sea
// only floods low valleys. This adapter lowers the land towards one side over a few kilometres,
// so part of the map becomes open sea with a proper coastline: headlands where the hills run out,
// drowned valleys and estuaries where the rivers do. It passes the river field through untouched,
// so the water system still keeps its rivers on the terrain's valleys.
//
//   const land = new Coastal(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 3, lakes: 0 }), { dir: [1, 0], at: 2500 });
//   const water = new WaterSystem(land);
//
// Keep the inner terrain's lakes off (lakes: 0): their levels are set before the fall, so they
// would tilt. Closed hollows still fill as lakes in the water system.

import { BaseHeight, type GridSpec } from '../terrain/height';
import { Noise2, hash32, smoothstep } from '../terrain/noise';
import type { RiverTerrain } from './region';

export interface CoastOpts {
  dir: [number, number]; // unit vector pointing out to sea
  at: number; // metres along dir where the fall begins (the coast is a little beyond)
  width: number; // metres over which the land falls
  fall: number; // metres it falls by (about the height of the valley floors, to drown them)
  deep: number; // metres more it falls over the next 1.5 widths, out to open sea
  sea: number; // sea level
  wobble: number; // metres the start of the fall wanders, so the coast isn't a ruled line
}

export class Coastal extends BaseHeight implements RiverTerrain {
  readonly o: CoastOpts;
  readonly p: { seed: number; sea: number | null; rivers: number };
  private n: Noise2;
  constructor(readonly inner: RiverTerrain, o: Partial<CoastOpts> = {}) {
    super();
    this.o = { dir: [1, 0], at: 0, width: 3500, fall: 45, deep: 60, sea: 0, wobble: 500, ...o };
    const l = Math.hypot(this.o.dir[0], this.o.dir[1]) || 1;
    this.o.dir = [this.o.dir[0] / l, this.o.dir[1] / l];
    this.p = { seed: inner.p.seed, sea: this.o.sea, rivers: inner.p.rivers };
    this.n = new Noise2(hash32(inner.p.seed, 0xc0a5));
  }
  // how far the land is lowered here
  fallAt(x: number, z: number) {
    const o = this.o, u = x * o.dir[0] + z * o.dir[1] - o.at + o.wobble * this.n.fbm(x / 1700, z / 1700, 3);
    return o.fall * smoothstep(0, o.width, u) + o.deep * smoothstep(o.width, 2.5 * o.width, u);
  }
  heightAt(x: number, z: number) { return this.inner.heightAt(x, z) - this.fallAt(x, z); }
  waterLevel(x: number, z: number) { return this.heightAt(x, z) < this.o.sea ? this.o.sea : null; }
  sample(g: GridSpec, out = new Float32Array(g.nx * g.nz)) { this.inner.sample(g, out); return this.lower(g, out); }
  sampleBase(g: GridSpec, out = new Float32Array(g.nx * g.nz), water?: Float32Array, river?: Float32Array) {
    this.inner.sampleBase(g, out, undefined, river);
    this.lower(g, out);
    if (water) water.fill(NaN);
    return out;
  }
  baseAt(x: number, z: number) { return { h: this.inner.baseAt(x, z).h - this.fallAt(x, z), water: null }; }
  riverField(x: number, z: number) { return this.inner.riverField(x, z); }
  private lower<T extends Float32Array>(g: GridSpec, out: T): T {
    for (let j = 0, k = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++, k++) out[k] -= this.fallAt(g.x0 + i * g.step, g.z0 + j * g.step);
    return out;
  }
}
