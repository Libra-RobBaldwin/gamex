// The railway in the game's HUD (docs/rail.md): Build > Stops > Railway station, a line tool for
// trains, the station, line and train sheets, and Transport > Railway. main.ts creates one of these
// and hands it taps; everything else about stations and trains lives in src/proto/rail/.
import * as THREE from 'three';
import { TRAINS, type TrainDef } from '../catalog';
import type { Lot, Network, P } from '../roads';
import type { Shell, ToolHandle } from '../ui/shell';
import { icon } from '../ui/icons';
import type { TownCrowds } from '../game/crowds';
import type { QueueSite } from '../people/flows';
import { LENGTHS, type Station, type StationConfig, type StationPlan } from './station';
import type { Railway } from './railway';
import type { RailDraw } from './draw';
import { callOrder, type RailLine, type Train } from './sim';
import type { Purse } from '../game/money';
import { VEHICLES, type LineIn, type StopIn, type VehicleKind } from '../econdefs';
import type { RailHooks } from '../game/econ';

export interface RailGameCtx {
  net: Network; shell: Shell; railway: Railway; draw: RailDraw; people: TownCrowds; scene: THREE.Scene;
  toScreen(p: P): { x: number; y: number };
  focusOn(p: P, h: number, dir?: P): void;
  rebuildRoads(): void;
  clear(lots: Lot[]): void; // take these buildings down (a station or its siding is built on their plots)
  hint(text: string, ic?: Parameters<typeof icon>[0]): void;
  purse?: Purse; // stations and trains are paid for (game/money.ts)
}
// the economy's ids for stations and rail lines, clear of the bus stops' and lines'
export const RAIL_ID = 1_000_000;
const kindOf = (t: TrainDef): VehicleKind => (t.id === 'intercity' || t.cars >= 4 ? 'intercity' : t.id === 'hs' ? 'hs' : t.id === 'tram' ? 'tram' : t.id === 'rack' ? 'rack' : 'dmu');
const RUN: Partial<Record<VehicleKind, number>> = { dmu: 4000, intercity: 9000, hs: 12000, tram: 3000, rack: 3500 }; // £ a game day (its month)
const money = (n: number) => `${n < 0 ? '−' : ''}£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const CAR_SEATS = 75;

export class RailGame {
  private active: 'station' | 'line' | null = null;
  private tool: ToolHandle | null = null;
  private len: number | undefined; // the platform length picked in the station tool
  private tapAt: { seg: number; s: number; side: 1 | -1 } | null = null;
  private ghost = new THREE.Group();
  private badges = new THREE.Group();
  private draft: number[] = [];
  private loop = false;
  private lastLine: RailLine | null = null;
  private seenVersion = -1;

  constructor(private c: RailGameCtx) {
    c.scene.add(c.draw.group, this.ghost, this.badges);
    this.ghost.renderOrder = 5;
    // a train pulls up: the people on the platform board through its doors, and it waits for them
    c.railway.sim.onCall = (t, station) => {
      const id = this.platformOf(t, station);
      if (!id) return 0;
      return c.people.trainAt(id, c.draw.doorsOf(t), t.id, t.def.cars * CAR_SEATS);
    };
  }
  get busy() { return this.active !== null; }
  private price(list: number) { return this.c.purse ? this.c.purse.price(list) : list; }
  private can(n: number) { return !this.c.purse || this.c.purse.can(n); }
  private short(n: number) { return `Not enough money · ${money(n)} needed, ${money(this.c.purse?.balance ?? 0)} in the bank`; }
  trainPrice(t: TrainDef) { return this.price(VEHICLES[kindOf(t)].cost); }
  // a train for a line, paid for (a reason if it can't run it, or there isn't the money)
  private buy(l: RailLine, def: TrainDef): Train | string {
    const cost = this.trainPrice(def);
    if (!this.can(cost)) return this.short(cost);
    const r = this.c.railway.addTrain(l, def);
    if (typeof r !== 'string') this.c.purse?.spend(cost, 'vehicles');
    return r;
  }

  // ---------- the starter town: a line between two stations on the main line ----------
  starter() {
    const { net, railway } = this.c;
    const seg = [...net.segs.values()].filter((s) => net.def(s).cls === 'rail').sort((a, b) => net.length(b) - net.length(a))[0];
    if (!seg) return;
    const L = net.length(seg), made: Station[] = [];
    for (const s of [80, L - 80]) {
      const plans = [1, -1].flatMap((side) => railway.plan(seg.id, s, side as 1 | -1, 130).plans).filter((p) => p.ok && p.clears.length === 0);
      if (plans[0]) made.push(railway.build(plans[0]).station);
    }
    if (made.length === 2) {
      const l = railway.addLine(made.map((s) => s.id), false, [TRAINS.intercity, TRAINS.dmu], { depot: false });
      if (typeof l !== 'string') this.lastLine = l;
    }
  }

  // ---------- taps ----------
  // A tap on the map while one of our tools is in use (true: it was ours).
  tap(sx: number, sy: number, g: P): boolean {
    if (this.active === 'station') { this.stationTap(g); return true; }
    if (this.active === 'line') { this.lineTap(sx, sy, g); return true; }
    return false;
  }
  // With no tool: a train or a station, if the tap landed on one.
  inspect(g: P): boolean {
    const t = this.trainNear(g);
    if (t) { this.showTrain(t); return true; }
    const st = this.c.railway.stationAt(g);
    if (st) { this.showStation(st); return true; }
    return false;
  }
  trainNear(g: P, r = 9): Train | null {
    const sim = this.c.railway.sim;
    let best: Train | null = null, bd = r;
    for (const t of sim.trains) for (let back = 0; back <= t.length; back += 10) {
      const q = sim.pose(t, back), d = Math.hypot(q.x - g.x, q.z - g.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // ---------- Build > Stops > Railway station ----------
  startStationTool() {
    const { shell } = this.c;
    this.end();
    this.active = 'station';
    this.tool = shell.startTool({ name: 'Railway station', spec: 'Platforms on a straight, level run of track', icon: 'train', tone: 'rail', onDone: () => this.end(), onCancel: () => this.end() });
    this.c.hint('Tap a straight, level stretch of railway, on the side for the station building', 'train');
  }
  private stationTap(g: P) {
    const { net } = this.c;
    const q = net.nearestSeg(g, 30, (s) => net.def(s).cls === 'rail');
    if (!q) { this.c.hint('Tap on a railway · lay track from Build > Rail first', 'alert'); return; }
    this.tapAt = { seg: q.seg.id, s: q.s, side: net.sideOf(q.seg, g) };
    this.cfg = null;
    this.planSheet();
    this.c.focusOn({ x: q.x, z: q.z }, 260, { x: q.ux, z: q.uz });
  }
  // The station sheet: quick picks (the layouts that suit this line), then every choice on its own
  // row (tracks, platforms, style, how people cross, canopies, length) and the one blueprint they
  // make, with its price. The blueprint shows on the map as the choices change.
  private planSheet() {
    const { railway, shell, net } = this.c, at = this.tapAt!;
    const seg = net.segs.get(at.seg), lineTracks = seg && net.def(seg).tracks === 2 ? 2 : 1;
    const presets = railway.plan(at.seg, at.s, at.side, this.len);
    if (!this.cfg || this.cfg.seg !== at.seg) {
      const rec = presets.plans.find((p) => p.recommended && p.ok) ?? presets.plans.find((p) => p.ok) ?? presets.plans[0];
      this.cfg = { seg: at.seg, ...(rec?.config ?? { tracks: lineTracks === 2 ? 2 : 2, layout: 'island', style: 'victorian', access: 'footbridge', canopy: true }) };
    }
    const cfg = this.cfg;
    const res = presets.reason ? presets : railway.plan(at.seg, at.s, at.side, this.len, cfg);
    const p = res.plans[0];
    this.preview(p ?? null);
    const row = (label: string, key: string, opts: [string | number | boolean, string, boolean?][], on: unknown) => `<div class="grp"><span class="tab">${label}</span><div class="row3" role="group" aria-label="${label}">${opts.map(([v, t, off]) => `<button data-opt="${key}" data-v="${v}" class="${v === on ? 'on' : ''}" aria-pressed="${v === on}" ${off ? 'disabled' : ''}>${esc(t)}</button>`).join('')}</div></div>`;
    const len = this.len ?? p?.station.len ?? presets.plans[0]?.station.len;
    const choices = [
      presets.plans.length ? `<div class="grp"><span class="tab">Quick picks</span><div class="row3">${presets.plans.map((q, i) => `<button data-preset="${i}" class="${q.config.tracks === cfg.tracks && q.config.layout === cfg.layout ? 'on' : ''}">${esc(q.title)}</button>`).join('')}</div></div>` : '',
      row('Tracks', 'tracks', [1, 2, 3, 4].map((n) => [n, n === 1 ? '1 track' : `${n} tracks`, n < lineTracks]), cfg.tracks),
      row('Platforms', 'layout', [['side', 'At the sides'], ['island', 'Island', cfg.tracks === 1], ['both', 'Both sides']], cfg.layout),
      row('Style', 'style', [['victorian', 'Brick hall'], ['modern', 'Glass hall'], ['halt', 'Halt']], cfg.style),
      row('Crossing the tracks', 'access', [['footbridge', 'Footbridge'], ['subway', 'Subway']], cfg.access),
      row('Canopies', 'canopy', [[true, 'Canopies'], [false, 'None']], cfg.canopy),
      `<div class="grp"><span class="tab">Platform length</span><div class="row3" role="group" aria-label="Platform length">${LENGTHS.map((l) => `<button data-len="${l.len}" class="${len === l.len ? 'on' : ''}">${l.label} · ${l.len} m</button>`).join('')}</div></div>`,
    ].join('');
    const plan = p ? `<div class="plan${p.ok ? '' : ' no'}"><div class="row"><span class="tab">${esc(p.title)}</span><span class="cost">${money(this.price(p.cost))}</span></div>
          <ul>${p.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>${p.blocked ? `<div class="bad">${icon('alert')}<span>${esc(p.blocked)}</span></div>` : ''}
          <button class="act primary tone-rail" data-build="1" ${p.ok && this.can(this.price(p.cost)) ? '' : 'disabled'} ${this.can(this.price(p.cost)) ? '' : `title="${esc(this.short(this.price(p.cost)))}"`}>${icon('check')}<span>Build this station</span></button></div>`
      : `<div class="bad">${icon('alert')}<span>${esc(res.reason ?? 'That doesn’t fit here')}</span></div>`;
    const body = presets.reason ? `<div class="bad">${icon('alert')}<span>${esc(presets.reason)}</span></div>${choices}` : `${plan}${choices}`;
    const el = shell.openSheet({ key: 'rail-station', title: presets.reason ? 'Can’t build a station here' : 'Railway station', icon: 'train', tone: 'rail', body, onClose: () => { this.preview(null); this.cfg = null; } });
    el.querySelectorAll<HTMLButtonElement>('[data-len]').forEach((b) => b.addEventListener('click', () => { this.len = +b.dataset.len!; this.planSheet(); }));
    el.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => { Object.assign(cfg, presets.plans[+b.dataset.preset!].config); this.planSheet(); }));
    el.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.opt as 'tracks' | 'layout' | 'style' | 'access' | 'canopy', v = b.dataset.v!;
      (cfg as unknown as Record<string, unknown>)[k] = k === 'tracks' ? +v : k === 'canopy' ? v === 'true' : v;
      if (cfg.tracks === 1 && cfg.layout === 'island') cfg.layout = 'side';
      this.planSheet();
    }));
    el.querySelector<HTMLButtonElement>('[data-build]')?.addEventListener('click', () => p && this.buildStation(p));
  }
  private cfg: (StationConfig & { seg: number }) | null = null;
  private buildStation(p: StationPlan) {
    const { railway, shell } = this.c;
    if (this.c.purse && !this.c.purse.spend(this.price(p.cost), 'building')) { this.c.hint(this.short(this.price(p.cost)), 'alert'); return; }
    const { station, cleared } = railway.build(p);
    this.c.clear(cleared);
    this.c.rebuildRoads();
    this.preview(null);
    shell.closeSheet();
    this.end();
    this.c.hint(`${station.name} built${cleared.length ? ` · ${cleared.length} building${cleared.length === 1 ? '' : 's'} cleared` : ''} · start a line from its sheet`, 'check');
    this.showStation(station);
  }
  // the blueprint: the platforms and the building, lit green (or red where it's blocked)
  private preview(p: StationPlan | null) {
    for (const c of [...this.ghost.children]) { this.ghost.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    if (!p) return;
    const pos: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const pl of p.shape.platforms) for (let i = 1; i < pl.edge.length; i++) {
      const e0 = pl.edge[i - 1], e1 = pl.edge[i], b0 = pl.back[i - 1], b1 = pl.back[i], y = pl.y + 0.3;
      quad([e0.x, y, e0.z], [e1.x, y, e1.z], [b1.x, y, b1.z], [b0.x, y, b0.z]);
    }
    const b = p.shape.building, c = Math.cos(b.rot), s = Math.sin(b.rot), P = (i: number, j: number) => [b.x + c * i * b.w / 2 - s * j * b.d / 2, b.y + 8, b.z + s * i * b.w / 2 + c * j * b.d / 2];
    quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: p.ok ? '#5cb83a' : '#e0463a', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    m.renderOrder = 5;
    this.ghost.add(m);
  }

  // ---------- the line tool: tap stations in the order trains call ----------
  startLineTool(first?: number) {
    const { shell, railway } = this.c;
    this.end();
    if (railway.shapes.size < 2) { this.c.hint('A line needs two stations · build them from Build > Stops', 'alert'); return; }
    this.active = 'line';
    this.draft = first !== undefined ? [first] : [];
    this.loop = false;
    this.tool = shell.startTool({ name: 'New rail line', spec: 'Trains call only at the stations you tap', icon: 'transport', tone: 'rail', onUndo: () => { if (this.loop) this.loop = false; else this.draft.pop(); this.lineChanged(); }, onDone: () => this.end(), onCancel: () => this.end() });
    this.lineChanged();
  }
  private lineTap(sx: number, sy: number, g: P) {
    const { railway } = this.c;
    let id: number | null = railway.stationAt(g)?.id ?? null, bd = 44;
    if (id === null) for (const [sid, sh] of railway.shapes) { const q = this.c.toScreen(sh.mid), d = Math.hypot(q.x - sx, q.y - sy); if (d < bd) { bd = d; id = sid; } }
    if (id === null) { this.c.hint('Tap one of the stations (the blue badges)', 'alert'); return; }
    if (this.draft.length && this.draft[this.draft.length - 1] === id) return;
    if (this.draft.length >= 3 && this.draft[0] === id) { this.loop = !this.loop; this.lineChanged(); return; }
    if (this.draft.includes(id)) { this.c.hint('That station is on the line already', 'alert'); return; }
    this.loop = false;
    this.draft.push(id);
    this.lineChanged();
  }
  private lineChanged() {
    const { railway } = this.c, n = this.draft.length;
    this.tool?.setUndo(n > 0);
    this.tool?.setPrimary({ label: 'Create', icon: 'check', kind: 'primary', disabled: n < 2, onClick: () => this.finishLine() });
    this.tool?.setPanel(n ? `<div class="what">${icon('transport')}<span>${this.draft.map((id, i) => `<b>${i + 1}</b> ${esc(railway.station(id)?.name ?? '')}`).join(' · ')}${this.loop ? ' · <b>back to 1</b>' : n > 2 ? ' · and back' : ''}</span></div>` : null);
    this.c.hint(n === 0 ? 'Tap the station the line starts from' : n === 1 ? 'Tap the next station' : 'Tap more stations, or Create', 'transport');
    this.showBadges(this.draft);
  }
  private finishLine() {
    const { railway } = this.c;
    const stops = [...this.draft], loop = this.loop;
    const long = stops.every((s) => (railway.station(s)?.len ?? 0) >= 130);
    const trains: TrainDef[] = long ? [TRAINS.intercity, TRAINS.dmu] : [TRAINS.dmu, TRAINS.dmu];
    // (as many of them as there's the money for: one at least)
    while (trains.length > 1 && !this.can(trains.reduce((a, t) => a + this.trainPrice(t), 0))) trains.pop();
    if (!this.can(this.trainPrice(trains[0]))) { this.c.hint(this.short(this.trainPrice(trains[0])), 'alert'); return; }
    const l = railway.addLine(stops, loop, trains);
    this.end();
    if (typeof l === 'string') { this.c.hint(l, 'alert'); return; }
    this.c.purse?.spend(trains.slice(0, railway.sim.capacity(l)).reduce((a, t) => a + this.trainPrice(t), 0), 'vehicles');
    this.lastLine = l;
    this.c.hint(`Line ${l.num} is running · ${railway.trainsOn(l).length + railway.sim.waiting} train${trains.length === 1 ? '' : 's'}${l.depot ? ', out of the depot' : ''}`, 'train');
    this.showLine(l);
  }
  // numbered badges on the stations while a line is drawn or looked at (the same size on screen at any zoom)
  private showBadges(order: number[] | null) {
    for (const s of [...this.badges.children]) { this.badges.remove(s); ((s as THREE.Sprite).material as THREE.SpriteMaterial).map?.dispose(); ((s as THREE.Sprite).material as THREE.Material).dispose(); }
    if (!order) return;
    for (const [id, sh] of this.c.railway.shapes) {
      const k = order.indexOf(id);
      const m = new THREE.SpriteMaterial({ map: badge(k >= 0 ? String(k + 1) : '', k >= 0), depthTest: false, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(m);
      s.position.set(sh.mid.x, sh.mid.y + 9, sh.mid.z);
      s.userData.px = k >= 0 ? 40 : 32; // css pixels across (kept so in frame())
      s.renderOrder = 21;
      this.badges.add(s);
    }
  }
  end() {
    if (!this.active) return;
    this.active = null;
    this.tool?.end();
    this.tool = null;
    this.c.shell.endTool();
    this.preview(null);
    this.showBadges(null);
    this.draft = [];
  }

  // ---------- sheets ----------
  showStation(st: Station) {
    const { railway, shell } = this.c;
    const lines = railway.lines.filter((l) => l.stops.includes(st.id));
    const sh = railway.shapes.get(st.id);
    const use = (sh?.platforms ?? []).map((_, i) => this.c.people.platformUse(`plat:${st.id}:${i}`)).reduce((a, u) => ({ waiting: a.waiting + u.waiting, boarded: a.boarded + u.boarded, alighted: a.alighted + u.alighted }), { waiting: 0, boarded: 0, alighted: 0 });
    const n = st.tracks ?? (st.loop ? 2 : 1), lay = `${n} track${n === 1 ? '' : 's'}${st.loop ? ' (a passing loop)' : ''} · ${st.layout === 'side' ? 'side platforms' : st.layout === 'island' ? 'island' : 'platforms both sides'} · ${st.style === 'modern' ? 'glass hall' : st.style === 'halt' ? 'halt' : 'brick hall'}${(sh?.platforms.length ?? 0) > 1 || n > 1 ? ` · ${st.access === 'subway' ? 'subway' : 'footbridge'}` : ''}`;
    shell.openInfo({
      key: `station:${st.id}`, title: st.name, sub: 'Railway station', icon: 'train', tone: 'rail',
      facts: [['Layout', lay], ['Platforms', `${sh?.platforms.length ?? 0} × ${st.len} m`], ['Lines', lines.map((l) => `${l.num}`).join(', ') || 'None yet'], ['Waiting', `${use.waiting}`], ['Boarded today', `${use.boarded}`], ['Got off today', `${use.alighted}`]],
      note: sh ? undefined : 'The track here has changed: the station is closed until it’s straight and clear again',
      actions: [
        { label: 'New line from here', icon: 'transport', kind: 'primary', onClick: () => { shell.closeSheet(); this.startLineTool(st.id); } },
        ...lines.slice(0, 2).map((l) => ({ label: `Line ${l.num}`, icon: 'train' as const, onClick: () => this.showLine(l) })),
        { label: 'Demolish', icon: 'trash', kind: 'danger', onClick: () => { railway.remove(st.id); this.c.rebuildRoads(); shell.closeSheet(); this.c.hint(`${st.name} demolished`, 'trash'); } },
      ],
    });
  }
  showLine(l: RailLine) {
    const { railway, shell } = this.c;
    if (!railway.lines.includes(l)) { shell.closeSheet(); return; }
    this.lastLine = l;
    const trains = railway.trainsOn(l), names = callOrder(l.stops, l.loop).map((id) => railway.station(id)?.name ?? '?');
    this.showBadges(l.stops);
    shell.openInfo({
      key: `rail-line:${l.id}`, title: `Line ${l.num}`, sub: `${railway.station(l.stops[0])?.name} – ${railway.station(l.stops[l.loop ? 0 : l.stops.length - 1])?.name}`, icon: 'train', tone: 'rail',
      facts: [['Calls', names.join(' · ')], ['Runs', l.loop ? 'Round and round' : 'There and back'], ['Trains', `${trains.length}`],
        ...(this.c.purse ? [['Last day', (() => { const b = this.c.purse!.line(RAIL_ID + l.id); return `${money(b.lastFares)} fares · ${money(-b.lastRunning)} running`; })()] as [string, string]] : []), ['Depot', l.depot ? `Siding at ${railway.station(l.depot)?.name}` : 'None: trains start at a platform']],
      note: 'Trains run under signals: one train to a block, points set along each train’s route, and on a single line they pass only at loops.',
      actions: [
        { label: `Add a train · ${money(this.trainPrice(trains[0]?.def ?? TRAINS.dmu))}`, icon: 'plus', kind: 'primary', disabled: !this.can(this.trainPrice(trains[0]?.def ?? TRAINS.dmu)), onClick: () => { const r = this.buy(l, trains[0]?.def ?? TRAINS.dmu); this.c.hint(typeof r === 'string' ? r : `A train joins line ${l.num}`, typeof r === 'string' ? 'alert' : 'train'); this.showLine(l); } },
        { label: 'Remove a train', icon: 'minus', disabled: !trains.length, onClick: () => { railway.removeTrain(trains[trains.length - 1]); this.showLine(l); } },
        { label: 'Delete line', icon: 'trash', kind: 'danger', onClick: () => { railway.removeLine(l); shell.closeSheet(); this.c.hint(`Line ${l.num} withdrawn`, 'train'); } },
      ],
      onClose: () => { if (this.active !== 'line') this.showBadges(null); },
    });
  }
  showTrain(t: Train) {
    const { railway, shell } = this.c, l = t.line;
    const at = t.state === 'dwell' && t.station !== undefined ? railway.station(t.station)?.name : undefined, next = t.stop ? railway.station(t.stop.station)?.name : undefined;
    const waiting = t.state !== 'dwell' && t.v < 0.1 && t.waited > 3;
    shell.openInfo({
      key: `train:${t.id}`, title: (t.def as { label?: string }).label ?? 'Train', sub: l ? `Line ${l.num}` : 'Train', icon: 'train', tone: 'rail',
      facts: [['Line', l ? `${l.num}` : 'None'], [at ? 'At' : 'Next station', at ?? next ?? '—'], ['Doing', t.state === 'dwell' ? (t.doors ? 'Doors open' : 'About to leave') : waiting ? 'Waiting at a red signal' : 'Running'], ['Speed', `${Math.round(t.v * 2.237)} mph`], ['On board', `${this.c.people.aboardTrain(t.id)}`], ['Cars', `${t.def.cars} · ${Math.round(t.length)} m`]],
      actions: l ? [{ label: `Line ${l.num}`, icon: 'train', onClick: () => this.showLine(l) }] : [],
    });
  }
  // Transport > Railway: the lines and stations
  renderTab(el: HTMLElement) {
    const { railway } = this.c;
    el.innerHTML = `<p class="note">${railway.lines.length ? 'Trains call only at their line’s stations. Tap a line to see it.' : 'No rail lines yet. Build two stations on a railway (Build > Stops), then a line between them.'}</p>
      ${railway.lines.map((l, i) => `<button class="lrow tone-rail" data-rline="${i}"><span class="num">${l.num}</span><b>${esc(l.stops.map((s) => railway.station(s)?.name ?? '?').join(' – '))}</b><span>${l.stops.length} stations · ${railway.trainsOn(l).length} trains · ${l.loop ? 'circular' : 'there and back'}</span></button>`).join('')}
      <div class="acts"><button class="act primary tone-rail" data-rnew="1" ${railway.shapes.size < 2 ? 'disabled' : ''}>${icon('transport')}<span>New rail line</span></button><button class="act" data-rstation="1">${icon('plus')}<span>Add a station</span></button></div>
      <div class="grp"><span class="tab">Stations</span><small>${railway.stations.length ? `${railway.stations.length} station${railway.stations.length === 1 ? '' : 's'}` : 'There are no stations yet.'}</small>
      ${railway.stations.map((s, i) => `<button class="lrow tone-rail" data-rst="${i}"><span class="num">${icon('train')}</span><b>${esc(s.name)}</b><span>${s.len} m platforms · ${railway.lines.filter((l) => l.stops.includes(s.id)).length} lines</span></button>`).join('')}</div>`;
    el.querySelector('[data-rnew]')?.addEventListener('click', () => { this.c.shell.closeSheet(); this.startLineTool(); });
    el.querySelector('[data-rstation]')?.addEventListener('click', () => { this.c.shell.closeSheet(); this.startStationTool(); });
    el.querySelectorAll<HTMLButtonElement>('[data-rline]').forEach((b) => b.addEventListener('click', () => this.showLine(railway.lines[+b.dataset.rline!])));
    el.querySelectorAll<HTMLButtonElement>('[data-rst]').forEach((b) => b.addEventListener('click', () => { const s = railway.stations[+b.dataset.rst!]; this.showStation(s); this.c.focusOn(s, 300, { x: s.hx, z: s.hz }); }));
  }
  // Transport > Buy vehicles: a train for the line last looked at (or the first)
  buyTrain(def: TrainDef, name: string) {
    const { railway } = this.c, l = this.lastLine && railway.lines.includes(this.lastLine) ? this.lastLine : railway.lines[0];
    if (!l) { this.c.hint('Build two stations and a rail line first · then trains can run it', 'alert'); return; }
    const r = this.buy(l, def);
    this.c.hint(typeof r === 'string' ? `${name}: ${r}` : `${name} joins line ${l.num}`, typeof r === 'string' ? 'alert' : 'train');
  }

  // ---------- the economy (game/econ.ts): stations are stops, rail lines are lines ----------
  econ(): RailHooks {
    const rw = this.c.railway;
    return {
      stops: (): StopIn[] => [...rw.shapes.keys()].map((id) => { const s = rw.station(id)!; return { id: RAIL_ID + id, kind: 'rail_station', x: s.x, z: s.z, name: s.name }; }),
      lines: (): LineIn[] => rw.lines.map((l) => { const ts = rw.trainsOn(l); return { id: RAIL_ID + l.id, name: `Rail line ${l.num}`, stops: callOrder(l.stops, l.loop).map((s) => RAIL_ID + s), vehicle: kindOf(ts[0]?.def ?? TRAINS.dmu), count: ts.length }; }),
      // (along the track, which runs about as straight as the stations are apart, at most of the train's speed, with a stop)
      time: (a, b, v) => {
        if (a < RAIL_ID || b < RAIL_ID) return undefined;
        const p = rw.station(a - RAIL_ID), q = rw.station(b - RAIL_ID);
        if (!p || !q) return Infinity;
        return (Math.hypot(p.x - q.x, p.z - q.z) * 1.15) / ((VEHICLES[v].kmh * 0.7 * 1000) / 60) + 1;
      },
      running: (v) => RUN[v] ?? 4000,
    };
  }

  // ---------- each frame ----------
  // (cam and cssH: the camera and the canvas's css height, to keep the badges their size on screen)
  frame(dt: number, cam?: THREE.Camera, cssH = 915) {
    const { railway, draw, people } = this.c;
    draw.frame(dt);
    if (cam && this.badges.children.length) {
      const o = cam as THREE.OrthographicCamera, pc = cam as THREE.PerspectiveCamera, v = new THREE.Vector3();
      for (const b of this.badges.children) {
        let perPx: number;
        if (o.isOrthographicCamera) perPx = (o.top - o.bottom) / o.zoom / cssH;
        else { v.copy(b.position).applyMatrix4(cam.matrixWorldInverse); perPx = (2 * -v.z * Math.tan((pc.fov * Math.PI) / 360)) / pc.zoom / cssH; }
        const k = (b.userData.px as number) * perPx;
        b.scale.set(k, k, 1);
      }
    }
    if (railway.cleared.length) { this.c.clear(railway.cleared.splice(0)); }
    if (this.seenVersion !== railway.version) {
      this.seenVersion = railway.version;
      // a queue along each platform, busier where more people live near the station
      const homes = (p: P) => this.c.net.lots.filter((l) => (l.kind === 'house' || l.kind === 'terrace' || l.kind === 'flats' || l.kind === 'tower') && Math.hypot(l.x - p.x, l.z - p.z) < 600).length;
      const list: { id: string; site: QueueSite; rate: number }[] = [];
      for (const [id, sh] of railway.shapes) {
        const n = homes(sh.mid);
        sh.platforms.forEach((pl, i) => {
          const e0 = pl.edge[0], e1 = pl.edge[pl.edge.length - 1], m = pl.edge[Math.floor(pl.edge.length / 2)], mb = pl.back[Math.floor(pl.back.length / 2)];
          const along = Math.atan2(e1.z - e0.z, e1.x - e0.x), facing = Math.atan2(m.z - mb.z, m.x - mb.x);
          const inset = 1.2; // (the middle of the queue, back from the edge)
          const at = { x: m.x + (mb.x - m.x) * (inset / pl.width), z: m.z + (mb.z - m.z) * (inset / pl.width) };
          list.push({ id: `plat:${id}:${i}`, site: { id: `plat:${id}:${i}`, kind: 'platform', at, along, facing, y: pl.y, length: Math.hypot(e1.x - e0.x, e1.z - e0.z) * 0.8, depth: [1.0, Math.max(1.5, pl.width - 0.8)] }, rate: Math.min(2.5, 0.15 + n / 120) / sh.platforms.length });
        });
      }
      people.setPlatforms(list);
    }
  }
  // which platform (its crowd's id) a train stands at: the one whose edge is nearest its front
  private platformOf(t: Train, station: number) {
    const sh = this.c.railway.shapes.get(station);
    if (!sh) return null;
    const q = this.c.railway.sim.pose(t, Math.min(20, t.length / 2));
    let best = -1, bd = Infinity;
    sh.platforms.forEach((pl, i) => { for (const e of pl.edge) { const d = Math.hypot(e.x - q.x, e.z - q.z); if (d < bd) { bd = d; best = i; } } });
    return best >= 0 ? `plat:${station}:${best}` : null;
  }
}

// a round badge, rail blue: numbered once the station is on the line being drawn
const tex = new Map<string, THREE.Texture>();
function badge(label: string, on: boolean) {
  const key = `${label}|${on}`;
  let t = tex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = on ? '#2f7fd0' : '#e8eef5'; g.fill();
  g.lineWidth = 6; g.strokeStyle = on ? '#0f2a45' : '#2f7fd0'; g.stroke();
  if (label) { g.fillStyle = '#fff'; g.font = '700 30px "League Spartan", Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 32, 35); }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  tex.set(key, t);
  return t;
}
