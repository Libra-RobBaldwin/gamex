// A 50 km map in the game (docs/streaming.md): what main.ts asks of it, in one place. It holds the
// streamed scenery (view.ts) and its workers, the whole map's height field (made in a worker while
// the start town is laid out, then copied into the drape's texture), the places of the live play
// area that aren't live yet (drawn as scenery, and given to the live ground as gardens and
// verges), which of them to bring to life next, and the coarse economy of every place on the map.
import * as THREE from 'three';
import type { ReliefField } from '../region/terrain';
import type { SettlementInfo } from '../region/mapspec';
import type { XZ } from '../region/water';
import type { Drape } from '../drape';
import { bandPoly } from './country';
import { LiveTowns } from './live';
import { settlementInfo, type WorldPlan } from './plan';
import { settlementScene } from './towns';
import { WorldView, type ViewState, type WorldViewHost } from './view';
import { CoarseEconomy } from './econ';

export interface WorldGameHost extends Omit<WorldViewHost, 'options' | 'half'> {
  plan: WorldPlan;
  field: ReliefField | null; // (the live play area's part filled in: terrain.ts partField)
  drape: Drape | null;
  live: number[]; // places live from the start (the start town, or a save's)
}

export class WorldGame {
  readonly view: WorldView;
  readonly towns: LiveTowns;
  readonly econ: CoarseEconomy;
  readonly infos: SettlementInfo[]; // every place on the map, for the names over it and the Places list
  private extraCache: { key: string; v: { plots: { poly: XZ[]; kind: 'garden' | 'yard' }[]; blocked: XZ[][] } } | null = null;
  times = { field: 0, fieldAt: 0 };
  constructor(private host: WorldGameHost) {
    const p = host.plan;
    this.view = new WorldView({ ...host, options: p.options, half: p.half });
    this.towns = new LiveTowns(p, host.live);
    this.econ = new CoarseEconomy(p);
    this.infos = p.settlements.map(settlementInfo);
    this.view.setPlaces(this.inactive());
    // the whole map's heights, from a worker (the main thread has only the live area's)
    const t0 = performance.now();
    if (host.field) {
      void this.view.field(host.field.step).then((f) => {
        host.field!.h.set(f.h);
        if (host.drape) host.drape.texture.needsUpdate = true;
        this.times = { field: f.ms, fieldAt: performance.now() - t0 };
        this.view.ready = true;
      });
    } else this.view.ready = true;
  }
  // the places of the live area not live yet (drawn as scenery)
  inactive() { return this.towns.places.filter((q) => !q.live).map((q) => q.id); }
  // What the not-yet-live places put on the live area's ground: their gardens and their streets'
  // verges (ground/game.ts GameWorld.extra), so their scenery stands on gardens, not in a field.
  extra() {
    const ids = this.inactive(), key = ids.join(',');
    if (this.extraCache?.key === key) return this.extraCache.v;
    const plots: { poly: XZ[]; kind: 'garden' | 'yard' }[] = [], blocked: XZ[][] = [];
    for (const id of ids) {
      const sc = settlementScene(this.host.plan, this.host.plan.settlements[id]);
      plots.push(...sc.plots);
      for (const st of sc.streets) blocked.push(bandPoly(st.path, st.half));
    }
    this.extraCache = { key, v: { plots, blocked } };
    return this.extraCache.v;
  }
  // a place has come to life: its scenery goes
  lived(id: number) {
    const q = this.towns.places.find((x) => x.id === id);
    if (q) { q.live = true; q.busy = false; }
    this.view.setPlaces(this.inactive());
  }
  // Each frame: the scenery for the view; and the next place to bring to life, if the view is close over one.
  frame(v: ViewState, aspect: number, pick = true): number | null {
    this.view.update(v, aspect);
    if (!pick) return null;
    const reach = Math.hypot((v.h * aspect) / 2, v.h / Math.max(0.2, Math.sin(v.el)) / 2);
    const next = this.towns.next(v, reach + 1500); // (before it's on screen, mostly)
    if (!next) return null;
    next.busy = true;
    return next.id;
  }
  // how many people live in a place that isn't live (the coarse economy's figure)
  people(id: number, day: number) { return this.econ.pop(id, day); }
  dispose() { this.view.root.removeFromParent(); }
  static group(): THREE.Group { return new THREE.Group(); }
}
