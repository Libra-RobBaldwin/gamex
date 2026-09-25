// The vehicle library in the game. traffic.ts runs the simulation; this decides what each vehicle
// is and draws it: which real model a trip gets (a realistic mix for where it starts and the game
// year), its true size for the traffic's footprints, its owner and livery, the player's buses in
// one company livery with fleet numbers, trains made up from the year's sets, and every lamp from
// what the vehicle is doing (headlamps after dark, brake lamps, indicators for the turn it has
// claimed). Everything is drawn by the library's instanced renderer: one draw call per model and
// level of detail on screen, so the fleet on the road is kept to a few dozen models a year.
import * as THREE from 'three';
import {
  DoorStates, FLAGS, MODEL, doorSeconds, MODELS, OPERATOR, VehicleRenderer, doorPositions, consistOffsets, liveryColours, liveryFor, lodFor, lookFor, operatorsFor, pickVehicle, purchaseList,
  type Area, type DoorPlace, type Livery, type Look, type Model, type Offer, type Operator,
} from '../vehicles';
import { hash, rng, weighted, type Rand } from '../vehicles/util';
import { registerBody, type Body, type Kind, type Rect } from '../footprint';
import type { TrainDef } from '../catalog';
import type { Network, RSeg } from '../roads';
import { gameYear } from './era';

// ---------- where a trip starts: the area it's in ----------
// From what fronts the road (shops and offices make a centre, works an industrial estate, homes a
// suburb), the zone, and the road itself (motorways, fast dual carriageways and country roads).
export function areaOfRoad(net: Network, seg: RSeg, lotsOn: { kind: string }[] = []): Area {
  const d = net.def(seg), p = net.path(seg), mid = p[Math.floor(p.length / 2)];
  if (net.zoneAt(mid) === 'industrial') return 'industrial';
  if (lotsOn.length) {
    let centre = 0, works = 0, homes = 0;
    for (const l of lotsOn) {
      if (l.kind === 'industry') works++;
      else if (l.kind === 'shop' || l.kind === 'office' || l.kind === 'tower' || l.kind === 'civic') centre++;
      else homes++;
    }
    return works > centre && works > homes ? 'industrial' : centre > homes ? 'centre' : 'suburb';
  }
  if (d.family === 'Motorway' || (d.family === 'Dual' && d.mph >= 60)) return 'motorway';
  if (d.family === 'Rural') return 'rural';
  return Math.hypot(mid.x, mid.z) > 330 ? 'rural' : 'suburb';
}

// ---------- the year's fleet: a few models of each sort ----------
// Every different model on screen costs a draw call (two with shadows), so the town's traffic is
// drawn from a palette: the commonest few of each sort for the year, as the library's own mix
// picks them. Colours still vary vehicle by vehicle, so the streets don't look cloned.
export function slotOf(m: Model): string {
  switch (m.style) {
    case 'taxi': case 'police': case 'ambulance': case 'ice-cream': case 'tractor': case 'coach': case 'pickup': case 'suv': case 'estate': case 'van-luton': return m.style;
    case 'hatchback': case 'saloon': return m.style;
    case 'mpv': case 'coupe': case 'convertible': case 'sports': case 'supercar': case 'classic': return 'other-car';
    case 'van-small': case 'van-panel': return 'van';
    case 'minibus': return 'minibus';
    case 'refuse': case 'gritter': case 'mixer': case 'recovery': return 'special';
  }
  return m.category === 'lorry' ? 'rigid' : m.category;
}
const KEEP: Record<string, number> = {
  hatchback: 2, saloon: 2, estate: 1, suv: 1, pickup: 1, 'other-car': 1, van: 2, minibus: 1, 'van-luton': 1, rigid: 2, special: 1,
  tractor: 2, trailer: 3, bus: 1, coach: 1, taxi: 1, police: 1, ambulance: 1, 'ice-cream': 1,
};
const AREAS: [Area, number][] = [['suburb', 3], ['centre', 2], ['industrial', 1], ['rural', 1], ['motorway', 1]];
export function paletteFor(year: number, samples = 3000) {
  const r = rng(hash(`palette-${year}`)), count = new Map<string, Map<Model, number>>();
  const note = (m: Model) => {
    const s = slotOf(m);
    let c = count.get(s);
    if (!c) count.set(s, (c = new Map()));
    c.set(m, (c.get(m) ?? 0) + 1);
  };
  for (let i = 0; i < samples; i++) {
    const sp = pickVehicle(r, weighted(r, AREAS), year);
    // (an 18 m bendy bus is the player's to buy for a busy route, not background traffic)
    if (!sp || sp.lead.style === 'bus-bendy') continue;
    note(sp.lead);
    if (sp.lead.style === 'tractor' && sp.chain[1]) note(sp.chain[1]);
  }
  const out = new Map<string, [Model, number][]>();
  for (const [s, c] of count) out.set(s, [...c].sort((a, b) => b[1] - a[1]).slice(0, KEEP[s] ?? 1));
  return out;
}

// ---------- the player's bus company ----------
export const OWN_LIVERY: Livery = ['#1f5e3f', '#5cb83a', '#f2f2f0', '#b8964e']; // Untitled: forest, lime, white roof, gold
export interface Company { name: string; code: string; livery: Livery; operator?: string }

// ---------- a vehicle's dress: what it is, and the state of its lamps ----------
export interface Dress {
  chain: Model[]; look: Look; cols: THREE.Color[][]; // colours per vehicle in the chain
  mine?: boolean; fleetNo?: string; // one of the player's buses
  offs?: number[]; flip?: boolean[]; length: number; // trains: each car's middle back from the front
  odo: number; lastV: number; brake: number; lampAt: number; beacons: boolean; sign: boolean;
}
export interface Dressed { kind: Kind; heavy: boolean; cls: number; front: number; back: number; hw: number; top: number; dress: Dress }
// What the fleet reads of a vehicle in the traffic to set its lamps (traffic.ts's Car has all of it).
export interface Driven {
  id: number; v: number; s: number; lane: number; oldLane?: number; merge?: number; bus?: boolean; dwell?: number; inBay?: boolean;
  served?: number; bay?: { id: number }; gone?: number;
  plan?: { node: number; path: { move: string; lineS: number } };
  turn?: { node: number; t: number; path: { move: string; ext1: number } };
  dress?: Dress;
}

const up = (x: number, q: number) => Math.ceil(x / q - 1e-9) * q;
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
// The body the traffic uses for a chain: its true length and width (rounded up a touch, so near
// enough the same sizes share a body and its conflict tables), and for an artic or a bendy bus
// the trailer on its hitch. The reference point is the middle of the whole vehicle.
// (axles: the steered front one and the middle of those behind it, from the model's middle, to the
// half metre so that near enough the same vehicles still share a body)
const halfM = (x: number) => Math.round(x * 2) / 2;
function axlesOf(m: Model, off = 0): { fa?: number; ra?: number } {
  const ax = m.dims.axles;
  if (ax.length < 2) return {};
  return { fa: halfM(ax[0] - off), ra: halfM(mean(ax.slice(1)) - off) };
}
export function bodyFor(chain: Model[]): Body {
  const lead = chain[0], tr = chain[1];
  if (!tr || lead.hitch?.rear === undefined || tr.hitch?.front === undefined) {
    const L = up(lead.dims.length, 0.25), hw = up(lead.dims.width / 2, 0.05);
    return { parts: [{ a: -L / 2, b: L / 2, hw, ...axlesOf(lead) }], front: L / 2, back: L / 2, hw };
  }
  const Lt = up(lead.dims.length, 0.05), Ltr = up(tr.dims.length, 0.05), hwt = up(lead.dims.width / 2, 0.05), hwr = up(tr.dims.width / 2, 0.05);
  const hitch = lead.hitch.rear, front = tr.hitch.front, axle = mean(tr.dims.axles);
  // nose and tail, lined up, from the tractor's middle
  const nose = Lt / 2, tail = hitch - front - Ltr / 2, mid = (nose + tail) / 2, half = (nose - tail) / 2;
  return {
    parts: [{ a: -Lt / 2 - mid, b: Lt / 2 - mid, hw: hwt, ...axlesOf(lead, mid) }], trailer: { hitch, front, axle: halfM(axle), len: Ltr, hw: hwr },
    front: half, back: half, hw: Math.max(hwt, hwr),
  };
}

// Lamps are lit from dusk to dawn, each driver switching on at a slightly different moment.
const dark = (hour: number, lampAt: number) => hour < 6.6 + lampAt || hour > 19.4 + lampAt;
const nightOf = (h: number) => (h >= 7.5 && h <= 18.5 ? 0 : h > 18.5 && h < 21 ? (h - 18.5) / 2.5 : h > 5 && h < 7.5 ? (7.5 - h) / 2.5 : 1);
const LIFT = 0.27; // the carriageway's surface above the path (roaddraw.ts lays asphalt at +0.25)
const RAIL_TOP = 0.44; // the railhead above the path (roaddraw.ts)

export class Fleet {
  readonly vr = new VehicleRenderer({ shadows: true });
  readonly doors = new DoorStates(); // buses' doors, by the traffic's vehicle id
  readonly group = this.vr.group;
  company: Company = { name: 'Untitled Transport', code: 'UT', livery: OWN_LIVERY };
  // set by the game each frame: how many screen pixels a metre is, the hour, and what's in view
  ppm = 3;
  hour = 12;
  formAt: (node: number) => string | undefined = () => undefined;
  private frustum: THREE.Frustum | null = null;
  private rand: Rand;
  private year = NaN;
  private palette = new Map<string, [Model, number][]>();
  private areas = new Map<number, Area>();
  private lotsSeen = -1;
  private nextFleet = 101;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(0, 0, 0, 'YZX');
  private p = new THREE.Vector3(); private sc = new THREE.Vector3(); private sphere = new THREE.Sphere();
  private time = 0;

  constructor(private net: Network, seed = 1) {
    this.rand = rng(seed);
  }

  // the game's view this frame, for levels of detail, culling and the lamps
  frame(cam: THREE.Camera | null, ppm: number, hour: number) {
    this.ppm = ppm; this.hour = hour;
    if (cam) {
      this.frustum ??= new THREE.Frustum();
      this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    }
    this.vr.uniforms.uNight.value = nightOf(hour);
  }

  private yearNow() {
    const y = gameYear();
    if (y !== this.year) { this.year = y; this.palette = paletteFor(y); }
    return y;
  }
  // the area a road's trips start in (worked out again as the town grows)
  areaOf(seg: RSeg): Area {
    if (this.net.lots.length !== this.lotsSeen) { this.areas.clear(); this.lotsSeen = this.net.lots.length; }
    let a = this.areas.get(seg.id);
    if (!a) this.areas.set(seg.id, (a = areaOfRoad(this.net, seg, this.net.lots.filter((l) => l.seg === seg.id))));
    return a;
  }
  // a model of the same sort from the year's palette (keeping it if it's in there)
  private snap(m: Model) {
    const p = this.palette.get(slotOf(m));
    if (!p?.length || p.some(([x]) => x === m)) return m;
    return weighted(this.rand, p);
  }

  // A vehicle for a trip starting on this road: the area's mix for the year. A trip from a works
  // (heavy) is a goods vehicle of that area's sort: vans and rigid lorries in town, artics from
  // the industrial estate, the motorway and the country roads.
  dress(seg: RSeg, heavy: boolean): Dressed {
    const year = this.yearNow(), area = this.areaOf(seg);
    // (bin lorries, gritters and ice-cream vans work rounds rather than carry goods from a works)
    const goods = (s?: { lead: Model }) => !!s && slotOf(s.lead) !== 'special' && (s.lead.category === 'lorry' || (s.lead.category === 'van' && s.lead.style !== 'minibus' && s.lead.style !== 'ice-cream'));
    // (buses in the suburbs and the country are the player's to run; other companies' come into the centre)
    const ok = (s?: { lead: Model }) => (heavy ? goods(s) : !(s?.lead.category === 'bus' && s.lead.style !== 'coach' && (area === 'suburb' || area === 'rural')));
    let sp = pickVehicle(this.rand, area, year);
    for (let i = 0; i < 12 && !ok(sp); i++) sp = pickVehicle(this.rand, area, year);
    // (the area hardly sees goods vehicles: one of the year's, of a size for the area)
    if (heavy && !goods(sp)) {
      const big = area === 'industrial' || area === 'motorway' || area === 'rural';
      const pool = (big ? ['tractor', 'rigid'] : ['van', 'van-luton', 'rigid']).flatMap((k) => this.palette.get(k) ?? []);
      if (pool.length) sp = { lead: weighted(this.rand, pool), chain: [] } as unknown as typeof sp;
    }
    if (!sp) return this.dressChain([this.snap(MODELS.find((m) => m.category === 'car' && year >= m.from)!)], year);
    const lead = this.snap(sp.lead), chain = [lead];
    if (lead.style === 'tractor') chain.push(this.snap(sp.chain[1] ?? MODELS.find((m) => m.category === 'trailer')!));
    else if (lead.consist) for (const id of lead.consist.slice(1)) chain.push(MODEL[id]);
    return this.dressChain(chain, year);
  }
  private dressChain(chain: Model[], year: number, look?: Look): Dressed {
    const lead = chain[0], seed = Math.floor(this.rand() * 2 ** 31);
    look ??= lookFor(lead, year, seed);
    const own = liveryColours(look.livery);
    // a haulier's artic is in its colours throughout; a trailer on hire has its own
    const cols = chain.map((m, i) => (i === 0 || lead.category === 'bus' || look!.operator ? own : liveryColours(lookFor(m, year, seed + i).livery)));
    const body = bodyFor(chain), cls = registerBody(body);
    const kind: Kind = lead.category === 'bus' ? 'bus' : lead.category === 'lorry' ? 'lorry' : 'car';
    const r = rng(seed ^ 0x2545f491);
    const dress: Dress = {
      chain, look, cols, length: body.front + body.back, odo: 0, lastV: 0, brake: 0, lampAt: (r() - 0.5) * 0.7,
      beacons: (lead.style === 'police' || lead.style === 'ambulance') ? r() < 0.25 : slotOf(lead) === 'special' ? r() < 0.5 : false,
      sign: lead.style === 'taxi' ? r() < 0.5 : lead.category === 'bus',
    };
    return { kind, heavy: kind !== 'car', cls, front: body.front, back: body.back, hw: body.hw, top: lead.stats.speedKmh / 3.6, dress };
  }

  // ---------- the player's buses ----------
  busOffers(year = this.yearNow()) { return purchaseList(year, ['bus', 'coach']); }
  // the bus the game adds when you don't choose one: a double-decker of the day if there is one
  defaultBus(year = this.yearNow()) {
    const offers = this.busOffers(year).filter((o) => o.kind === 'bus');
    const deck = offers.filter((o) => MODEL[o.models[0]].style === 'bus-double' || MODEL[o.models[0]].style === 'bus-halfcab');
    return (deck.length ? deck : offers)[0];
  }
  dressBus(offerId?: string): Dressed {
    const year = this.yearNow();
    const offer = (offerId && this.busOffers(year).find((o) => o.id === offerId)) || this.defaultBus(year);
    const chain = offer ? offer.models.map((id) => MODEL[id]) : [MODELS.find((m) => m.category === 'bus')!];
    const fleetNo = `${this.company.code} ${this.nextFleet++}`;
    const look: Look = { livery: this.company.livery, plate: fleetNo, fleet: fleetNo, liveryName: this.company.name };
    const d = this.dressChain(chain, year, look);
    d.dress.mine = true; d.dress.fleetNo = fleetNo; d.dress.sign = true; d.dress.beacons = false;
    return d;
  }
  // bus liveries the player can run in: their own, or any bus company's of the year
  liveries(year = this.yearNow()): { id: string; name: string; livery: Livery }[] {
    const seen = new Set<string>(), out = [{ id: 'own', name: 'Untitled Transport', livery: OWN_LIVERY }];
    for (const style of ['bus-double', 'bus-single'] as const) for (const op of operatorsFor(style, year)) {
      if (seen.has(op.id)) continue;
      seen.add(op.id);
      const l = liveryFor(op, style, year);
      if (l) out.push({ id: op.id, name: op.name, livery: l.colours });
    }
    return out;
  }
  // repaint the player's fleet (the dresses given; the game passes its buses)
  setLivery(id: string, dresses: Dress[]) {
    const op: Operator | undefined = OPERATOR[id];
    const l = this.liveries().find((x) => x.id === id);
    if (!l) return;
    this.company = { name: l.name, code: op?.code ?? 'UT', livery: l.livery, operator: op?.id };
    const cols = liveryColours(l.livery);
    for (const d of dresses) if (d.mine) { d.look.livery = l.livery; d.look.liveryName = l.name; d.cols = d.chain.map(() => cols); }
  }

  // ---------- trains ----------
  trainOffers(year = this.yearNow()) { return purchaseList(year, ['train', 'tram']); }
  // The game's train kinds (catalog.ts) as the year's real sets: a diesel unit, an express, a
  // high-speed set, a tram, a rack railcar. What an offer can do on the track goes in its def.
  offerFor(kind: string, year = this.yearNow()): Offer | undefined {
    const offers = this.trainOffers(year), lead = (o: Offer) => MODEL[o.models[0]];
    const by = (f: (o: Offer) => boolean) => offers.filter(f);
    const want: Record<string, Offer[]> = {
      dmu: by((o) => lead(o).style === 'dmu-car' && o.models.length === 2),
      intercity: [...by((o) => lead(o).style === 'hs-power' && lead(o).stats.power !== 'electric'), ...by((o) => lead(o).style === 'hs-power')],
      hs: by((o) => lead(o).style === 'hs-power' && lead(o).stats.power === 'electric'),
      tram: by((o) => o.kind === 'tram'),
      rack: by((o) => lead(o).style === 'rack-car'),
    };
    // (before there are express sets, an intercity is a locomotive and coaches: see madeUp)
    return want[kind]?.[0] ?? (kind === 'dmu' ? by((o) => lead(o).style === 'dmu-car' || lead(o).style === 'emu-car')[0] : undefined);
  }
  // what a set can manage: how fast, how steep, whether it needs wires or a rack
  defFor(o: Offer): TrainDef & { offer: string } {
    const m = MODEL[o.models[0]], st = m.style;
    const rack = st === 'rack-car', tram = st === 'tram' || st === 'tram-heritage';
    const maxGrade = rack ? 0.2 : tram ? 0.07 : st === 'dmu-car' || st === 'emu-car' ? 0.035 : st === 'hs-power' ? (m.stats.power === 'electric' ? 0.035 : 0.03) : 0.03;
    const mph = Math.round(o.speedKmh / 1.609);
    const n = o.models.length, carLen = (o.lengthM - (n - 1) * 0.9) / n;
    return {
      id: o.id, offer: o.id, label: o.name, icon: '', mph, maxGrade, rack, cars: n, carLen, color: '', stripe: '',
      needsWires: o.models.some((id) => MODEL[id].stats.power === 'electric'), blurb: `${n} cars · ${mph} mph`,
    };
  }
  // A train of one of the game's kinds when no set of the year fits: a locomotive of the day (a
  // steam engine before the diesels) and its carriages, never electric unless the kind needs wires.
  private madeUp(def: TrainDef, year: number): Model[] {
    const offers = this.trainOffers(year).concat(purchaseList(year, ['locomotive', 'carriage']));
    const ok = (o: Offer) => def.needsWires || o.models.every((id) => MODEL[id].stats.power !== 'electric');
    const locos = offers.filter((o) => o.kind === 'locomotive' && ok(o) && MODEL[o.models[0]].style !== 'shunter');
    const tank = locos.find((o) => MODEL[o.models[0]].style === 'steam-tank');
    const loco = (def.id === 'dmu' ? tank : undefined) ?? locos.sort((a, b) => b.speedKmh - a.speedKmh)[0];
    const coach = offers.find((o) => o.kind === 'carriage');
    const chain = loco ? loco.models.map((id) => MODEL[id]) : [];
    if (coach) for (let i = 0; i < (def.id === 'dmu' ? 2 : 5); i++) chain.push(MODEL[coach.models[0]]);
    return chain.length ? chain : [MODELS.filter((m) => m.category === 'rail' && m.from <= year).sort((a, b) => b.from - a.from)[0] ?? MODELS.find((m) => m.category === 'rail')!];
  }
  dressTrain(def: TrainDef): Dress {
    const year = this.yearNow();
    const offerId = (def as { offer?: string }).offer;
    let o = (offerId && allTrain(year, offerId)) || this.offerFor(def.id, year);
    // (a game kind that runs without wires is never drawn as an electric set)
    if (o && !offerId && !def.needsWires && o.models.some((id) => MODEL[id].stats.power === 'electric')) o = undefined;
    const chain = o ? o.models.map((id) => MODEL[id]) : this.madeUp(def, year);
    const seed = Math.floor(this.rand() * 2 ** 31), look = lookFor(chain[0], year, seed);
    // each type of vehicle in the set in the operator's livery for it (blue-and-grey coaches behind a blue engine)
    const cols = chain.map((m) => liveryColours((look.operator && liveryFor(look.operator, m.style, year)?.colours) || look.livery));
    const { offsets, length } = consistOffsets(chain);
    const last = chain.length - 1, cab = (m: Model) => m.design.cab === true || m.style === 'hs-power' || m.style === 'rack-car';
    return {
      chain, look, cols, offs: offsets, flip: chain.map((m, i) => i === last && last > 0 && cab(m) && cab(chain[0])), length,
      odo: 0, lastV: 0, brake: 0, lampAt: 0, beacons: false, sign: false,
    };
  }

  // ---------- drawing ----------
  begin(dt = 0) { this.vr.begin(); if (dt > 0) this.doors.update(dt); }
  // Where a road vehicle's doors are on its kerb side (the driver's left), front first, from the
  // body parts traffic.ts last drew it with: where people get on and off a bus.
  kerbDoors(c: Driven, parts: Rect[]): DoorPlace[] {
    const m = c.dress?.chain[0], r = parts[0];
    if (!m || !r) return [];
    return doorPositions(m, { x: r.x, z: r.z, heading: Math.atan2(r.hz, r.hx) }, 'left').sort((a, b) => (b.x - a.x) * r.hx + (b.z - a.z) * r.hz);
  }
  end(nowMs: number) {
    this.time = nowMs / 1000;
    this.vr.end(this.time);
    // buckets with nothing in them this frame are left out of the scene's lists altogether
    for (const o of this.vr.group.children) o.visible = (o as THREE.InstancedMesh).count > 0;
  }
  private seen(x: number, y: number, z: number, r: number) {
    return !this.frustum || this.frustum.intersectsSphere(this.sphere.set(this.p.set(x, y, z), r + 6));
  }
  private put(m: Model, x: number, y: number, z: number, heading: number, pitch: number, k: number, cols: THREE.Color[], flags: number, odo: number, dl = 0, dr = 0) {
    if (!this.seen(x, y, z, m.dims.length / 2)) return;
    this.e.set(0, -heading, pitch);
    this.q.setFromEuler(this.e);
    const s = Math.max(0.01, k);
    this.m4.compose(this.p.set(x, y, z), this.q, this.sc.set(s, s, s));
    this.vr.add(m, lodFor(m.dims.length, this.ppm), this.m4, cols, flags, odo, dl, dr);
  }
  // one road vehicle, on the body parts traffic.ts worked out for it (the trailer, if any, last)
  drawCar(c: Driven, parts: Rect[], y: number, pitch: number, k: number, dt: number) {
    const d = c.dress;
    if (!d || k <= 0.01) return;
    d.odo += c.v * dt;
    // brake lamps: braking harder than gently, or held on while standing in a queue (with a
    // moment's hold, so stop-start traffic doesn't flicker)
    if (dt > 0) {
      if ((d.lastV - c.v) / dt > 1 || c.v < 0.3) d.brake = 0.6;
      else d.brake -= dt;
      d.lastV = c.v;
    }
    const lead = d.chain[0], r0 = parts[0];
    // a bus's doors open on the kerb side (the driver's left) while it stands at a stop, and are
    // shut again (they take doorSeconds) by the time it pulls away
    if (c.bus && dt > 0) this.doors.setDoors(c.id, c.dwell !== undefined && c.dwell > doorSeconds(lead) + 0.2 && c.gone === undefined ? 1 : 0, 'left', { model: lead });
    // (off screen: nothing more to work out)
    if (!r0 || !this.seen(r0.x, y, r0.z, d.length)) return;
    let f = (d.brake > 0 ? FLAGS.brake : 0) | this.indicators(c);
    if (dark(this.hour, d.lampAt)) f |= FLAGS.lights | (lead.category === 'bus' ? FLAGS.interior : 0);
    if (d.beacons) f |= FLAGS.beacons;
    if (d.sign) f |= FLAGS.sign;
    const dl = c.bus ? this.doors.get(c.id)[0] : 0;
    for (let i = 0; i < d.chain.length && i < parts.length; i++) {
      const r = parts[i];
      this.put(d.chain[i], r.x, y + LIFT, r.z, Math.atan2(r.hz, r.hx), pitch, k, d.cols[i], f, d.odo, dl, 0);
    }
  }
  // Indicators for what the driver is about to do: moving over (lane 0 is the nearside; we drive
  // on the left, so a higher lane is to the right), the turn claimed at the junction ahead, and on a
  // roundabout left as they come off it. Buses signal right to pull away from a stop.
  private indicators(c: Driven) {
    const L = FLAGS.indL, R = FLAGS.indR;
    if (c.gone !== undefined) return 0;
    if (c.oldLane !== undefined) return c.lane > c.oldLane ? R : L;
    if (c.merge !== undefined) return c.merge > c.lane ? R : L;
    if (c.bus && ((c.dwell !== undefined && c.dwell < 2) || (c.inBay && c.dwell === undefined && c.served === c.bay?.id))) return R;
    const T = c.turn;
    if (T) {
      const form = this.formAt(T.node), mv = T.path.move;
      if (form === 'roundabout' || form === 'mini') return T.path.ext1 - T.t < 9 ? L : mv === 'R' ? R : mv === 'L' ? L : 0;
      return mv === 'L' ? L : mv === 'R' ? R : 0;
    }
    const pl = c.plan;
    if (pl && pl.path.lineS - c.s < 45) return pl.path.move === 'L' ? L : pl.path.move === 'R' ? R : 0;
    return 0;
  }
  // one car of a train, at its place on the track; v for the wheels and the lamps
  // (doors: how far open its left and right doors are, as rail/draw.ts has them; `lead` and `tail`:
  // the cars at the front and the back, for a train whose driver has changed ends)
  drawRail(d: Dress, i: number, x: number, y: number, z: number, heading: number, pitch: number, v: number, dt: number, doors: [number, number] = [0, 0], lead = i === 0, tail = i === d.chain.length - 1 && i > 0) {
    if (i === 0) d.odo += v * dt;
    const m = d.chain[i], flip = d.flip?.[i];
    // white lamps lead and red ones trail; a driving car at the back is turned end for end
    let f = dark(this.hour, 0) ? FLAGS.interior : 0;
    if (lead) f |= FLAGS.lights;
    if (tail) f |= FLAGS.brake;
    this.put(m, x, y + RAIL_TOP, z, flip ? heading + Math.PI : heading, flip ? -pitch : pitch, 1, d.cols[i], f, flip ? -d.odo : d.odo, doors[0], doors[1]);
  }
  get stats() { return this.vr.stats; }
}

const allTrain = (year: number, id: string) => purchaseList(year, ['train', 'tram']).find((o) => o.id === id);
