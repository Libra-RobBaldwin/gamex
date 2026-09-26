// The world's tiles, made off the main thread (docs/streaming.md, "The worker"). Each worker makes
// the plan itself from the map's options (the same options always make the same plan, from the same
// source, seeded or real: worldmap/source.ts, so it agrees with the main thread's to the bit), then serves tiles (tilegen.ts) and the height field, handing
// their typed arrays over without copying.
import { serveLoader, type Port } from '../world/worker';
import type { LoadRequest } from '../world/stream';
import type { RegionOptions } from '../region/options';
import { loadPlan, type WorldPlan } from './plan';
import { generateTile, type TileData, type TileRequest } from './tilegen';
import '../real/world'; // (a real region's plan comes from its bake: worldmap/source.ts)

export interface WorkerRequest extends TileRequest { options: RegionOptions; field?: number } // field: the height field's step, instead of a tile
export interface FieldData { field: true; x0: number; z0: number; step: number; n: number; h: Float32Array; max: number; ms: number }

let plan: Promise<WorldPlan> | null = null, planKey = '';
function planFor(o: RegionOptions) {
  const k = JSON.stringify(o);
  if (!plan || k !== planKey) { plan = loadPlan(o); planKey = k; }
  return plan;
}

const self_ = self as unknown as Port;
serveLoader<TileData | FieldData>(self_, async (raw: LoadRequest) => {
  const req = raw as unknown as WorkerRequest, p = await planFor(req.options);
  if (req.field) {
    const t0 = performance.now(), f = p.terrain.field(req.field)!;
    return { field: true, x0: f.x0, z0: f.z0, step: f.step, n: f.n, h: f.h, max: f.max, ms: performance.now() - t0 };
  }
  return generateTile(p, req);
}, (d) => {
  if ('field' in d) return [d.h.buffer as ArrayBuffer];
  const t: Transferable[] = [];
  const add = (a: ArrayBufferView | null | undefined) => { if (a && a.byteLength) t.push(a.buffer as ArrayBuffer); };
  if (d.ground) { add(d.ground.pos); add(d.ground.nor); add(d.ground.idx); add(d.ground.cover); }
  if (d.water) { add(d.water.pos); add(d.water.idx); }
  if (d.solid) { add(d.solid.pos); add(d.solid.nor); add(d.solid.col); add(d.solid.idx); }
  if (d.bld) { add(d.bld.pos); add(d.bld.nor); add(d.bld.col); add(d.bld.idx); }
  add(d.trees);
  if (d.hedges) { add(d.hedges.pieces); add(d.hedges.trees); }
  return t;
});
