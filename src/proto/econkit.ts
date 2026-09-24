// A small kit for building economy worlds without the 3D game: towns laid out as a grid of
// zones with a mix of buildings, stops, lines and industries, and straight-line oracles
// (vehicles at their book speed along a slightly bent route; cars on town streets and on the
// roads you join towns with). The tests use it, and it's a stand-in until the live game plugs in.
import { VEHICLES, type BuildingIn, type BuildingKind, type IndustryIn, type IndustryKind, type LineIn, type Oracles, type StopIn, type StopKind, type TownIn, type VehicleKind, type WorldIn, type ZoneIn } from './econdefs';

export type Mix = Partial<Record<BuildingKind, number>>;
// `mix` goes in every zone; `centre` is added to the middle zone (the high street) and `edge`
// to the last one, which is zoned for industry if `edge` has any.
export interface TownSpec { id: number; x: number; z: number; name?: string; grid?: number; step?: number; mix: Mix; centre?: Mix; edge?: Mix; plots?: number; carShare?: number }

// A town of about 750 people with jobs for most of its workers: homes all round, shops,
// offices, a school and a pub in the middle, a works at the edge.
export const BALANCED: Pick<TownSpec, 'mix' | 'centre' | 'edge'> = {
  mix: { house: 16, terrace: 6 },
  centre: { office: 2, shop: 5, civic: 2 },
  edge: { industry: 1 },
};

export class Kit {
  towns: TownIn[] = [];
  zones: ZoneIn[] = [];
  buildings: BuildingIn[] = [];
  stops: StopIn[] = [];
  lines: LineIn[] = [];
  industries: IndustryIn[] = [];
  private roads = new Set<string>();
  private cut = new Set<number>(); // stops whose routes have been severed
  private stopById = new Map<number, StopIn>();
  private zoneById = new Map<number, ZoneIn>();
  private bid = 1;
  carKmh = 40;
  slow = 1; // congestion: vehicle journey times are multiplied by this

  // Zones on a grid round the centre (grid x grid, `step` m apart), each holding `mix`.
  town(s: TownSpec) {
    this.towns.push({ id: s.id, name: s.name ?? `Town ${s.id}`, x: s.x, z: s.z, carShare: s.carShare });
    const g = s.grid ?? 3, step = s.step ?? 220;
    for (let a = 0; a < g; a++)
      for (let b = 0; b < g; b++) {
        const n0 = a * g + b, id = s.id * 1000 + n0, x = s.x + (a - (g - 1) / 2) * step, z = s.z + (b - (g - 1) / 2) * step;
        const centre = n0 === (g * g - 1) >> 1, edge = n0 === g * g - 1 && !!s.edge;
        const zone: ZoneIn = { id, town: s.id, x, z, r: step / 2, plots: s.plots ?? 2 };
        if (edge) zone.allow = ['industry', 'shop', 'civic'];
        this.zones.push(zone);
        this.zoneById.set(id, zone);
        const mix: Mix = { ...s.mix };
        for (const [kind, count] of Object.entries((centre ? s.centre : edge ? s.edge : undefined) ?? {}) as [BuildingKind, number][]) mix[kind] = (mix[kind] ?? 0) + count;
        if (edge) { delete mix.house; delete mix.terrace; }
        let n = 0;
        for (const [kind, count] of Object.entries(mix) as [BuildingKind, number][])
          for (let i = 0; i < count; i++, n++) {
            const ang = n * 2.39996, rr = (step / 2) * 0.9 * Math.sqrt((n + 0.5) / 40);
            this.buildings.push({ id: this.bid++, zone: id, x: x + Math.cos(ang) * rr, z: z + Math.sin(ang) * rr, kind });
          }
      }
    return this;
  }
  road(a: number, b: number) { this.roads.add(`${Math.min(a, b)}-${Math.max(a, b)}`); return this; }
  stop(id: number, kind: StopKind, x: number, z: number, name?: string) {
    const s: StopIn = { id, kind, x, z, name };
    this.stops.push(s);
    this.stopById.set(id, s);
    return this;
  }
  line(id: number, stops: number[], vehicle: VehicleKind, count: number) { this.lines.push({ id, stops, vehicle, count }); return this; }
  industry(id: number, kind: IndustryKind, x: number, z: number) { this.industries.push({ id, kind, x, z }); return this; }
  sever(stop: number) { this.cut.add(stop); }

  world(): WorldIn {
    return {
      towns: this.towns.map((t) => ({ ...t })), zones: this.zones.map((z) => ({ ...z })), buildings: this.buildings.map((b) => ({ ...b })),
      industries: this.industries.map((i) => ({ ...i })), stops: this.stops.map((s) => ({ ...s })), lines: this.lines.map((l) => ({ ...l, stops: [...l.stops] })),
    };
  }

  oracles(): Oracles {
    return {
      travelTime: (a, b, v) => {
        const p = this.stopById.get(a), q = this.stopById.get(b);
        if (!p || !q || this.cut.has(a) || this.cut.has(b)) return Infinity;
        return ((Math.hypot(p.x - q.x, p.z - q.z) * 1.25) / ((VEHICLES[v].kmh * 1000) / 60) + 0.5) * this.slow;
      },
      carTime: (a, b) => {
        const p = this.zoneById.get(a), q = this.zoneById.get(b);
        if (!p || !q) return Infinity;
        if (p.town !== q.town && !this.roads.has(`${Math.min(p.town, q.town)}-${Math.max(p.town, q.town)}`)) return Infinity;
        return (Math.hypot(p.x - q.x, p.z - q.z) * 1.3) / ((this.carKmh * 1000) / 60) + 1;
      },
    };
  }
}
