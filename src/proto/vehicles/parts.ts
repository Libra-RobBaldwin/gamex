// Parts shared by several builders: wheels, axle blocks for the mid level of detail, beacons,
// mirrors, the far-distance box, and small readers for the design record.
import { Kit, C, asWheel, fixed, paint, type Style } from './kit';
import type { Design, Model } from './types';
import { LIGHT } from './types';

export const num = (g: Design, k: string, d: number) => (typeof g[k] === 'number' ? (g[k] as number) : d);
export const str = <T extends string = string>(g: Design, k: string, d: NoInfer<T>): T => (typeof g[k] === 'string' ? (g[k] as T) : d);
export const flag = (g: Design, k: string) => g[k] === true;

export type Hub = 'spoke' | 'steel' | 'hubcap' | 'alloy' | 'aero' | 'truck' | 'rail' | 'plain';
const HUB: Record<Hub, Style> = {
  spoke: fixed('#c9c2a8'), steel: fixed('#5f6368'), hubcap: fixed('#b9bdc0'), alloy: fixed('#c9cdd0'), aero: fixed('#3a3d41'),
  truck: fixed('#8a8f94'), rail: fixed('#4a4d52'), plain: fixed('#2c2d30'),
};

// A pair of wheels on one axle. zOut is the outer face of the tyre; the tyre runs inward by tw.
// Near: an octagon with a hub; mid: a hexagon; far: nothing (the far box covers it).
export function wheels(k: Kit, x: number, r: number, zOut: number, tw: number, hub: Hub, twin = false) {
  if (k.lod === 2) return;
  const sides = k.lod === 0 ? 8 : 6;
  const tyre = asWheel(C.tyre, x, r);
  const hs = asWheel(HUB[hub], x, r);
  for (const s of [1, -1]) {
    const z0 = s * zOut, z1 = s * (zOut - tw * (twin ? 2.1 : 1));
    k.cylZ(x, r, r, z0, z1, sides, tyre, k.lod === 0 && hub !== 'plain' ? tyre : hs, null);
    if (k.lod === 0 && hub !== 'plain') {
      k.disc([x, r, z0 + s * 0.008], 'z', s as 1 | -1, r * (hub === 'truck' || hub === 'rail' ? 0.6 : hub === 'spoke' ? 0.78 : 0.66), hub === 'alloy' || hub === 'spoke' ? 8 : 6, hs, Math.PI / 8);
    }
  }
}
// The mid level's stand-in for a pair of wheels: one dark block through the body, poking out
// either side, so it reads as wheels without costing any.
export function axleBlock(k: Kit, x: number, r: number, hw: number, len = 1.8) {
  k.box(x - r * len / 2, x + r * len / 2, 0, r * 1.9, -hw - 0.012, hw + 0.012, C.tyre, { nx: null, px: null });
}

// Mirrors on stalks by the windscreen.
export function mirrors(k: Kit, x: number, y: number, hw: number, st: Style, big = false) {
  if (k.lod !== 0) return;
  const h = big ? 0.45 : 0.12, w = big ? 0.28 : 0.16;
  for (const s of [1, -1]) k.box(x - 0.12, x, y, y + h, s > 0 ? hw - 0.02 : -hw - w, s > 0 ? hw + w : -hw + 0.02, st);
}

// A light bar or single beacon on a roof.
export function lightBar(k: Kit, x: number, y: number, len: number, w: number, blue = true) {
  const b = blue ? C.beaconBlue : C.beaconAmber;
  k.box(x - len / 2, x + len / 2, y, y + 0.1, -w / 2, w / 2, C.trim, { py: null });
  // the lenses: the two halves flash in turn (the shader alternates by side)
  k.box(x - len / 2 + 0.02, x + len / 2 - 0.02, y + 0.1, y + 0.18, -w / 2 + 0.03, w / 2 - 0.03, b);
}
export function beacon(k: Kit, x: number, y: number, z: number, blue = false) {
  const b = blue ? C.beaconBlue : C.beaconAmber;
  if (k.lod === 0) k.cylY(x, z, y, y + 0.16, 0.09, 0.07, 6, b, b);
  else k.box(x - 0.08, x + 0.08, y, y + 0.14, z - 0.08, z + 0.08, b);
}

// The far level: one box in the body colour with the roof colour on top. Ten triangles.
export function farBox(k: Kit, m: Model, y0 = m.dims.clearance, h = m.dims.height) {
  const { length: L, width: W } = m.dims;
  k.box(-L / 2, L / 2, y0, h, -W / 2, W / 2, paint(1), { py: paint(3) });
}

// Head and tail lamps for boxy fronts (vans, lorries, buses): flat quads on the end faces.
export function endLamps(k: Kit, x: number, dir: 1 | -1, hw: number, y: number, h = 0.16, w = 0.28) {
  const st = dir > 0 ? C.head : C.tail;
  for (const s of [1, -1]) k.end(x, dir, s > 0 ? hw - 0.08 - w : -hw + 0.08, s > 0 ? hw - 0.08 : -hw + 0.08 + w, y, y + h, st);
  if (k.lod !== 0) return;
  // indicators outboard, left on −z
  for (const s of [1, -1]) {
    const ind = s < 0 ? C.indL : C.indR;
    k.end(x, dir, s > 0 ? hw - 0.07 : -hw + 0.02, s > 0 ? hw - 0.02 : -hw + 0.07, y, y + h, ind, 0.014);
  }
  if (dir < 0) for (const s of [1, -1]) k.end(x, dir, s > 0 ? hw - 0.08 - w : -hw + 0.08, s > 0 ? hw - 0.08 : -hw + 0.08 + w, y + h + 0.02, y + h + 0.1, C.brake);
}
export const plateF = (k: Kit, x: number, y: number) => { if (k.lod === 0) k.end(x, 1, -0.26, 0.26, y, y + 0.11, C.plateF); };
export const plateR = (k: Kit, x: number, y: number) => { if (k.lod === 0) k.end(x, -1, -0.26, 0.26, y, y + 0.11, C.plateR); };

export { LIGHT };
