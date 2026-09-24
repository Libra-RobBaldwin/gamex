// Turning a model into geometry: pick the builder for its category, build the level of detail
// asked for, and cache the result. One BufferGeometry per model and level; the renderer shares
// its attributes between every instanced mesh that draws that model.
import * as THREE from 'three';
import { Kit } from './kit';
import type { Category, Lod, Model } from './types';
import { farBox } from './parts';
import { buildCar } from './cars';
import { buildVan } from './vans';
import { buildLorry } from './lorries';
import { buildBus } from './buses';
import { buildRail } from './rail';
import { buildBoat, buildAir } from './craft';

// Triangle budgets per level of detail: near, middle, far. Tests hold every model to these.
export const BUDGET: Record<Category, [number, number, number]> = {
  car: [400, 120, 12],
  van: [450, 140, 12],
  lorry: [700, 200, 24],
  trailer: [600, 160, 12],
  bus: [800, 220, 12],
  rail: [900, 250, 12],
  boat: [900, 240, 24],
  air: [900, 240, 24],
};

export function buildKit(m: Model, lod: Lod) {
  const k = new Kit(lod);
  if (lod === 2) { far(k, m); return k; }
  switch (m.category) {
    case 'car': buildCar(k, m); break;
    case 'van': buildVan(k, m); break;
    case 'lorry': case 'trailer': buildLorry(k, m); break;
    case 'bus': buildBus(k, m); break;
    case 'rail': buildRail(k, m); break;
    case 'boat': buildBoat(k, m); break;
    case 'air': buildAir(k, m); break;
  }
  return k;
}

// The far level is a box, but a few shapes need two to read at all (a ship's hull and bridge,
// an aircraft's fuselage and wings, a lorry's cab and body).
function far(k: Kit, m: Model) {
  const { length: L, width: W, height: H } = m.dims;
  if (m.category === 'air') {
    const dia = (m.design.dia as number) ?? 3;
    k.box(-L / 2, L / 2, H * 0.25, H * 0.25 + dia, -dia / 2, dia / 2, farPaint(1), { py: farPaint(1) });
    k.box(-L * 0.1, L * 0.12, H * 0.25 + dia * 0.3, H * 0.25 + dia * 0.4, -W / 2, W / 2, farPaint(1), { nx: null, px: null });
    return;
  }
  if (m.category === 'boat') {
    k.box(-L / 2, L / 2, -0.5, H * 0.35, -W / 2, W / 2, farPaint(2), { py: farPaint(1) });
    if (m.style !== 'narrowboat' && m.style !== 'barge') k.box(-L / 2 + L * 0.05, -L / 2 + L * 0.2, H * 0.35, H, -W * 0.4, W * 0.4, farPaint(1), { nx: null });
    return;
  }
  if (m.category === 'lorry' && m.style !== 'tractor') {
    const cabL = 2.3;
    k.box(L / 2 - cabL, L / 2, m.dims.clearance, Math.min(H, 3.2), -W / 2, W / 2, farPaint(1), { nx: null });
    k.box(-L / 2, L / 2 - cabL - 0.1, m.dims.clearance, H, -W / 2, W / 2, farPaint(1), { py: farPaint(3) });
    return;
  }
  farBox(k, m);
}
const farPaint = (z: 1 | 2 | 3) => ({ c: [1, 1, 1] as [number, number, number], zone: z, light: 0 });

const cache = new Map<string, THREE.BufferGeometry>();
export function geometry(m: Model, lod: Lod) {
  const key = `${m.id}|${lod}`;
  let g = cache.get(key);
  if (!g) { g = buildKit(m, lod).geometry(); cache.set(key, g); }
  return g;
}
export const triangles = (m: Model, lod: Lod) => buildKit(m, lod).tris;
export function clearGeometryCache() { for (const g of cache.values()) g.dispose(); cache.clear(); }
