import './style.css';
import {
  BUILD, CARGO, GROUPS, INDUSTRIES, LEVEL_POP, OFFLINE_CAP_SECONDS, STATIONS, TECH_NAME, VEHICLES, canServe,
  type BuildKind, type CargoId, type StationKind, type VehicleGroup, type VehicleId,
} from './defs';
import { Renderer, type Float, type Overlay } from './render';
import { load, save, wipe } from './save';
import { Scenarios, type Offer, type ScenarioDef } from './scenarios';
import { Game, PROBLEM_TEXT, UNDO_REFUND, loadOf, newGame, type Station, type Vehicle } from './sim';
import type { Industry, Town } from './world';

type Tool = 'look' | 'road' | 'rail' | 'station' | 'line' | 'clear';

const STATION_GROUPS: { id: string; name: string; icon: string; kinds: StationKind[] }[] = [
  { id: 'bus', name: 'Bus stops', icon: '🚏', kinds: ['bus_stop', 'bus_station', 'bus_interchange'] },
  { id: 'freight', name: 'Freight', icon: '📦', kinds: ['loading_bay', 'lorry_depot'] },
  { id: 'rail', name: 'Rail station', icon: '🚉', kinds: ['rail'] },
  { id: 'metro', name: 'Metro', icon: 'Ⓜ️', kinds: ['metro'] },
  { id: 'air', name: 'Airport', icon: '✈️', kinds: ['airport'] },
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const money = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e4 ? `${Math.round(a / 1e3)}k` : Math.round(a).toLocaleString('en-GB');
  return `${n < 0 ? '−' : ''}£${s}`;
};
const num = (n: number) => Math.floor(n).toLocaleString('en-GB');
const cargoList = (m: Partial<Record<CargoId, number>>) => {
  const items = (Object.entries(m) as [CargoId, number][]).filter(([, n]) => n >= 1);
  return items.length ? items.map(([c, n]) => `${num(n)} ${CARGO[c].name.toLowerCase()}`).join(', ') : '<span class="muted">none</span>';
};

class App {
  game: Game;
  sc: Scenarios;
  r: Renderer;
  tool: Tool = 'look';
  buildKind: BuildKind = 'street';
  stationKind: StationKind = 'bus_stop';
  vehicleType: VehicleId | null = null;
  lineStops: number[] = [];
  sel: { kind: 'station' | 'vehicle' | 'industry' | 'town' | 'challenge' | 'menu'; id?: number } | null = null;
  floats: Float[] = [];
  stroke: { nodes: number[]; bad: number; color: string } | null = null;
  blueprint: number[][] = [];
  catchPreview: { x: number; y: number; r: number } | null = null;
  speed = 1;
  last = performance.now();
  hiddenAt: number | null = null;
  sheetAt = 0;
  incomeSamples: { t: number; earned: number }[] = [];

  constructor() {
    const saved = load();
    this.game = new Game(saved ? saved.state : newGame());
    this.sc = this.wireScenarios();
    this.buildDom();
    this.r = new Renderer($('#map'), this.game);
    this.bindInput();
    window.addEventListener('resize', () => this.r.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => save(this.game.s));
    setInterval(() => save(this.game.s), 10_000);
    this.setTool('look');
    if (saved) {
      const away = Math.min(OFFLINE_CAP_SECONDS, (Date.now() - saved.savedAt) / 1000);
      if (away > 30) this.offline(away);
    } else this.welcome();
    requestAnimationFrame((t) => this.frame(t));
  }

  wireScenarios() {
    const sc = new Scenarios(this.game);
    sc.onComplete = (def, reward) => this.completed(def, reward);
    sc.onFail = (def) => this.modal(`<div class="big">⏱️</div><h2>Out of time</h2><p>${def.icon} The challenge has ended. You can still repair things, but there's no reward now.</p><button class="primary" data-m="board">Choose a challenge</button>`, (m) => m === 'board' && this.board());
    return sc;
  }

  // ---------------- DOM ----------------
  buildDom() {
    $('#ui').innerHTML = `
      <div id="top">
        <div id="purse" class="glass"><div id="money"></div><div id="rate"></div></div>
        <div id="card" class="glass"></div>
        <div id="topbtns">
          <button id="b-speed" class="glass icon" title="Speed">▶</button>
          <button id="b-menu" class="glass icon" title="Menu">☰</button>
        </div>
      </div>
      <div id="toasts"></div>
      <div id="dock">
        <div id="hint"></div>
        <div id="route" class="glass hidden"></div>
        <div id="buildbar" class="glass hidden"></div>
        <div id="sub"></div>
        <div id="tools" class="glass">
          <button data-tool="look"><i>👆</i>Inspect</button>
          <button data-tool="road"><i>🛣️</i>Road</button>
          <button data-tool="rail"><i>🛤️</i>Rail</button>
          <button data-tool="station"><i>🚉</i>Station</button>
          <button data-tool="line"><i>🚌</i>Vehicle</button>
          <button data-tool="clear"><i>🧨</i>Demolish</button>
        </div>
      </div>
      <div id="sheet" class="glass hidden"></div>
      <div id="picker" class="hidden"></div>
      <div id="modal" class="hidden"></div>`;
    document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) =>
      b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool)));
    $('#b-menu').addEventListener('click', () => this.open({ kind: 'menu' }));
    $('#b-speed').addEventListener('click', () => {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      $('#b-speed').textContent = this.speed === 1 ? '▶' : this.speed === 2 ? '▶▶' : '▶▶▶';
    });
    $('#card').addEventListener('click', () => (this.sc.active ? this.open({ kind: 'challenge' }) : this.board()));
  }

  setTool(t: Tool) {
    this.tool = t;
    this.lineStops = [];
    if (t !== 'line') this.vehicleType = null;
    this.stroke = null;
    if (t !== 'road' && t !== 'rail') this.blueprint = [];
    this.catchPreview = null;
    document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    if (t === 'road' && !['street', 'motorway'].includes(this.buildKind)) this.buildKind = 'street';
    if (t === 'rail' && !['rail', 'metro'].includes(this.buildKind)) this.buildKind = this.game.has('rail') ? 'rail' : 'metro';
    this.renderSub();
    this.renderHint();
    this.renderRoute();
    this.renderBuildBar();
    if (t !== 'look') this.close();
  }

  chip(label: string, sub: string, on: boolean, locked: boolean, data: string) {
    return `<button class="chip ${on ? 'on' : ''} ${locked ? 'locked' : ''}" ${data}><b>${label}</b><small>${sub}</small></button>`;
  }

  renderSub() {
    const g = this.game, sub = $('#sub');
    let html = '';
    if (this.tool === 'road' || this.tool === 'rail') {
      const kinds: BuildKind[] = this.tool === 'road' ? ['street', 'motorway'] : ['rail', 'metro'];
      html = kinds.map((k) => {
        const d = BUILD[k];
        const locked = !g.has(d.tech);
        return this.chip(d.name, locked ? '🔒 via challenge' : `${money(d.cost)}/tile`, k === this.buildKind, locked, `data-b="${k}"`);
      }).join('');
    } else if (this.tool === 'station') {
      html = STATION_GROUPS.map((grp) => {
        const on = grp.kinds.includes(this.stationKind);
        const locked = grp.kinds.every((k) => !g.has(STATIONS[k].tech));
        const sub = locked ? '🔒 via challenge' : on ? STATIONS[this.stationKind].name : grp.kinds.length > 1 ? `${grp.kinds.length} types` : money(STATIONS[grp.kinds[0]].cost);
        return this.chip(`${grp.icon} ${grp.name}`, sub, on, locked, `data-sg="${grp.id}"`);
      }).join('');
    } else if (this.tool === 'line') {
      html = GROUPS.map((grp) => {
        const models = (Object.keys(VEHICLES) as VehicleId[]).filter((k) => VEHICLES[k].group === grp.id);
        const locked = models.every((k) => !g.has(VEHICLES[k].tech));
        const on = !!this.vehicleType && VEHICLES[this.vehicleType].group === grp.id;
        return this.chip(`${grp.icon} ${grp.name}`, locked ? '🔒 via challenge' : on ? VEHICLES[this.vehicleType!].name : `${models.length} models`, on, locked, `data-vg="${grp.id}"`);
      }).join('');
    }
    sub.innerHTML = html;
    sub.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.b && b.dataset.b !== this.buildKind) { this.buildKind = b.dataset.b as BuildKind; this.blueprint = []; this.renderBuildBar(); }
      if (b.dataset.sg) return this.stationPicker(b.dataset.sg);
      if (b.dataset.vg) return this.vehiclePicker(b.dataset.vg as VehicleGroup);
      this.renderSub();
      this.renderHint();
    }));
  }

  renderHint(text?: string) {
    const h = $('#hint');
    if (text !== undefined) { h.textContent = text; return; }
    const t = this.tool;
    if (t === 'road' || t === 'rail') {
      const d = BUILD[this.buildKind];
      h.textContent = this.buildKind === 'street'
        ? 'Drag to draw a street blueprint · two fingers to move the map'
        : `Drag to draw a ${d.name.toLowerCase()} blueprint · max 45° turn per tile`;
    } else if (t === 'station') {
      const d = STATIONS[this.stationKind];
      h.textContent = d.place === 'site' ? 'Tap the centre of a clear 3×3 site'
        : d.place === 'kerb' ? `Tap a street (not a junction) to add a ${d.name.toLowerCase()}`
        : d.place === 'offroad' ? `Tap a clear tile right beside a street${d.size > 1 ? ' (needs 2×2)' : ''}`
        : `Tap ${this.stationKind === 'rail' ? 'track' : 'a metro tunnel'} to add a ${d.name.toLowerCase()}`;
    } else if (t === 'line') {
      if (!this.vehicleType) h.textContent = 'Choose a vehicle type';
      else {
        const d = VEHICLES[this.vehicleType];
        h.textContent = !this.lineStops.length ? `${d.name}: tap the stops in the order to visit them` : 'Tap more stops, then Start service';
      }
    } else if (t === 'clear') h.textContent = 'Tap to demolish · drag along track or road to remove it';
    else h.textContent = '';
  }

  renderRoute() {
    const el = $('#route');
    const g = this.game;
    if (this.tool !== 'line' || !this.vehicleType || !this.lineStops.length) { el.classList.add('hidden'); return; }
    const d = VEHICLES[this.vehicleType];
    const stops = this.lineStops.map((id) => g.station(id)).filter((x): x is Station => !!x);
    const err = stops.length >= 2 ? g.checkLine(this.vehicleType, stops) : null;
    el.innerHTML = `<div class="stops">${stops.map((st, i) => `<span class="stop"><b>${i + 1}</b>${esc(st.name)}</span>`).join('<span class="arr">→</span>')}${stops.length >= 2 ? '<span class="arr">↺</span>' : ''}</div>
      ${err ? `<div class="bad small">${esc(err)}</div>` : ''}
      <div class="rbtns"><button data-r="undo">Undo</button><button data-r="cancel">Cancel</button>
      <button class="primary" data-r="go" ${stops.length < 2 || err ? 'disabled' : ''}>Start service · ${money(d.cost)}</button></div>`;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => b.addEventListener('click', () => {
      const r = b.dataset.r;
      if (r === 'undo') this.lineStops.pop();
      if (r === 'cancel') this.lineStops = [];
      if (r === 'go') {
        const e2 = g.buyVehicle(this.vehicleType!, stops);
        if (e2) this.toast(e2);
        else { this.toast(`${d.name} now running ${stops.map((x) => x.name).join(' → ')}`); this.lineStops = []; }
      }
      this.renderRoute();
      this.renderHint();
    }));
  }

  picker(title: string, cards: string, onPick: (id: string) => void) {
    const el = $('#picker');
    el.innerHTML = `<div class="pk glass"><div class="pkh"><h2>${title}</h2><button data-p="x" class="close">✕</button></div><div class="pkl">${cards}</div></div>`;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLElement>('[data-p]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      el.classList.add('hidden');
      if (b.dataset.p !== 'x') onPick(b.dataset.p!);
    }));
    el.onclick = (e) => { if (e.target === el) el.classList.add('hidden'); };
  }

  stat(label: string, value: string, frac: number) {
    return `<div class="st"><span>${label}</span><div class="sb"><i style="width:${Math.round(Math.max(0.06, Math.min(1, frac)) * 100)}%"></i></div><b>${value}</b></div>`;
  }

  vehiclePicker(group: VehicleGroup, then?: () => void) {
    const g = this.game;
    const models = (Object.keys(VEHICLES) as VehicleId[]).filter((k) => VEHICLES[k].group === group);
    const maxSp = Math.max(...models.map((k) => VEHICLES[k].speed));
    const maxCap = Math.max(...models.map((k) => VEHICLES[k].capacity));
    const maxRun = Math.max(...models.map((k) => VEHICLES[k].running));
    const cards = models.map((k) => {
      const d = VEHICLES[k];
      const locked = !g.has(d.tech);
      return `<div class="card ${locked ? 'locked' : ''} ${k === this.vehicleType ? 'on' : ''}" ${locked ? '' : `data-p="${k}"`}>
        <img alt="" src="${this.r.thumbVehicle(k)}" />
        <div class="cb"><div class="ch"><b>${d.name}</b><span class="price">${money(d.cost)}</span></div>
        <div class="muted small">${locked ? `🔒 Unlocks with ${TECH_NAME[d.tech]}` : esc(d.blurb)}</div>
        ${this.stat('Speed', `${Math.round(d.speed * 40)} km/h`, d.speed / maxSp)}
        ${this.stat('Capacity', `${d.capacity}${d.pax ? ' pax' : ' t'}`, d.capacity / maxCap)}
        ${this.stat('Running', `${money(d.running)}/min`, d.running / maxRun)}</div></div>`;
    }).join('');
    const name = GROUPS.find((x) => x.id === group)!.name;
    this.picker(`Choose ${name.toLowerCase()}`, cards, (id) => {
      this.vehicleType = id as VehicleId;
      then?.();
      this.renderSub();
      this.renderHint();
      this.renderRoute();
    });
  }

  stationPicker(groupId: string) {
    const g = this.game;
    const grp = STATION_GROUPS.find((x) => x.id === groupId)!;
    const cards = grp.kinds.map((k) => {
      const d = STATIONS[k];
      const locked = !g.has(d.tech);
      const where = d.place === 'kerb' ? 'On the street' : d.place === 'offroad' ? `Beside the street${d.size > 1 ? ' · 2×2' : ''}` : d.place === 'site' ? '3×3 site' : 'On track';
      return `<div class="card ${locked ? 'locked' : ''} ${k === this.stationKind ? 'on' : ''}" ${locked ? '' : `data-p="${k}"`}>
        <img alt="" src="${this.r.thumbStation(k)}" />
        <div class="cb"><div class="ch"><b>${d.name}</b><span class="price">${money(d.cost)}</span></div>
        <div class="muted small">${locked ? `🔒 Unlocks with ${TECH_NAME[d.tech]}` : esc(d.blurb)}</div>
        <div class="tags"><span class="tag">${where}</span><span class="tag ${d.turnaround ? 'blue' : ''}">${d.turnaround ? '↩ Turn round here' : '→ Drive through'}</span><span class="tag">${d.cargo === 'pax' ? 'Passengers' : d.cargo === 'freight' ? 'Freight' : 'Any cargo'}</span></div>
        ${this.stat('Waiting space', num(d.cap), d.cap / 1200)}
        ${this.stat('Catchment', `${d.radius} tiles`, d.radius / 5)}</div></div>`;
    }).join('');
    const pick = (id: string) => { this.stationKind = id as StationKind; this.renderSub(); this.renderHint(); };
    if (grp.kinds.length === 1 && g.has(STATIONS[grp.kinds[0]].tech)) return pick(grp.kinds[0]);
    this.picker(grp.name, cards, pick);
  }

  renderCard() {
    const el = $('#card');
    const def = this.sc.active;
    if (!def) {
      el.innerHTML = `<div class="ct">🎯 Choose a challenge</div><div class="cs">Tap to see what's on offer</div>`;
      el.classList.add('pulse');
      return;
    }
    el.classList.remove('pulse');
    const g = this.game, st = g.s.scenario!;
    const objs = this.sc.objectives();
    const timer = st.deadline !== undefined ? ` · ⏱️ ${Math.max(0, Math.ceil(st.deadline - g.s.time))}s` : '';
    el.innerHTML = `<div class="ct">${def.icon} ${esc(def.title(g, st.params))}${timer}</div>` +
      objs.map((o) => `<div class="obj"><span>${esc(o.label)}</span><span class="${o.value >= o.target ? 'ok' : ''}">${o.target === 1 ? (o.value ? '✓' : '—') : `${num(o.value)}/${num(o.target)}`}</span></div><div class="bar"><i style="width:${Math.min(100, (o.value / o.target) * 100)}%"></i></div>`).join('');
  }

  toast(text: string, at?: { x: number; y: number }) {
    const el = document.createElement('div');
    el.className = 'toast glass';
    el.textContent = text;
    if (at) el.addEventListener('click', () => this.focus(at.x, at.y));
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild!.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  focus(x: number, y: number) {
    const p = { x: (x - y) * 32, y: (x + y) * 16 };
    this.r.cam.x = p.x;
    this.r.cam.y = p.y;
  }

  // ---------------- modals ----------------
  modal(html: string, onPick?: (m: string) => void) {
    const el = $('#modal');
    el.innerHTML = `<div class="box glass">${html}</div>`;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
      el.classList.add('hidden');
      onPick?.(b.dataset.m!);
    }));
  }

  welcome() {
    this.modal(`<div class="big">🚉</div><h2>Tracks &amp; Towns</h2>
      <p>You run the transport for a whole region. Take on challenges one at a time, such as linking towns, hauling freight, building motorways, metros and airports. Everything you build keeps running.</p>
      <p class="muted">Good service makes towns grow and industries produce more, and that brings new bottlenecks to solve.</p>
      <button class="primary" data-m="go">Show me the challenges</button>`, () => this.board());
  }

  board() {
    this.sc.refreshBoard();
    const g = this.game;
    const offers = this.sc.offers;
    const card = (o: Offer, i: number) => {
      const d = o.def;
      const tag = d.kind === 'disaster' ? '<span class="tag red">Disaster</span>' : d.kind === 'dynamic' ? '<span class="tag amber">Live</span>' : '<span class="tag">Story</span>';
      const unlock = d.unlocks.filter((t) => !g.has(t)).map((t) => `<span class="tag blue">Unlocks ${TECH_NAME[t]}</span>`).join('');
      return `<div class="offer">
        <div class="oh"><span class="oi">${d.icon}</span><div><div class="ot">${esc(d.title(g, o.params))}</div><div>${tag}${unlock}${d.timed ? `<span class="tag red">⏱️ ${Math.round(d.timed / 60)} min</span>` : ''}</div></div></div>
        <p>${esc(d.brief(g, o.params))}</p>
        <div class="orow"><span>Grant <b>${money(d.grant(g, o.params))}</b> · Reward <b>${money(d.reward(g, o.params))}</b></span><button class="primary" data-m="${i}">Accept</button></div>
      </div>`;
    };
    this.modal(`<h2>Challenges</h2>
      ${offers.length ? offers.map(card).join('') : '<p class="muted">Nothing new right now. Keep growing your network and more will turn up.</p>'}
      <button data-m="x">Not now</button>`, (m) => {
      const o = offers[Number(m)];
      if (!o) return;
      if (g.s.scenario) { this.toast('Finish or abandon your current challenge first.'); return; }
      const err = this.sc.accept(o);
      if (err) { this.toast(err); return; }
      const st = g.s.scenario!;
      this.toast(`Challenge accepted: ${o.def.title(g, st.params)}`);
      this.focusScenario();
      this.renderSub();
    });
  }

  focusScenario() {
    const g = this.game, st = g.s.scenario;
    if (!st) return;
    const p = st.params;
    const pts: { x: number; y: number }[] = [];
    for (const k of ['a', 'b', 't', 'parent', 'sub']) if (p[k] !== undefined && g.s.towns[p[k]]) pts.push({ x: g.s.towns[p[k]].cx, y: g.s.towns[p[k]].cy });
    for (const k of ['src', 'dst']) { const i = g.s.industries.find((x) => x.id === p[k]); if (p[k] !== undefined && i) pts.push({ x: i.x + 1, y: i.y + 1 }); }
    for (const k of ['st', 'ap']) { const s = p[k] !== undefined ? g.station(p[k]) : undefined; if (s) pts.push(s); }
    if (p.v !== undefined) { const v = g.s.vehicles.find((x) => x.id === p.v); const s = v && g.station(v.stops[0]); if (s) pts.push(s); }
    if (!pts.length) return;
    const cx = pts.reduce((a, b) => a + b.x, 0) / pts.length, cy = pts.reduce((a, b) => a + b.y, 0) / pts.length;
    this.focus(cx, cy);
    const span = Math.max(...pts.map((q) => Math.abs(q.x - cx) + Math.abs(q.y - cy)), 4);
    this.r.cam.zoom = Math.max(0.4, Math.min(1.4, this.r.cssW / (span * 2 * 64 + 120)));
  }

  completed(def: ScenarioDef, reward: number) {
    try { navigator.vibrate?.([40, 60, 40]); } catch { /* ignore */ }
    this.modal(`<div class="big">🏆</div><h2>Challenge complete!</h2><p>${esc(def.icon)} Reward: <b class="gold">${money(reward)}</b></p>
      <p class="muted">Your network keeps running. Towns you serve will keep growing.</p>
      <button class="primary" data-m="board">Next challenge</button> <button data-m="x">Keep building</button>`, (m) => m === 'board' && this.board());
  }

  offline(seconds: number) {
    const r = this.game.catchUp(seconds);
    if (Math.abs(r.money) < 1) return;
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    this.modal(`<div class="big">🌙</div><h2>While you were away</h2><p class="muted">${h ? `${h}h ` : ''}${m}m of service</p>
      <p class="${r.money >= 0 ? 'gold' : 'bad'}" style="font-size:28px;font-weight:700">${r.money >= 0 ? '+' : ''}${money(r.money)}</p>
      <p>${num(r.pax)} passengers carried</p><button class="primary" data-m="ok">Back to work</button>`);
  }

  onVisibility() {
    if (document.hidden) { this.hiddenAt = Date.now(); save(this.game.s); return; }
    if (!this.hiddenAt) return;
    const away = Math.min(OFFLINE_CAP_SECONDS, (Date.now() - this.hiddenAt) / 1000);
    this.hiddenAt = null;
    this.last = performance.now();
    if (away > 5) this.offline(away);
  }

  // ---------------- sheets ----------------
  open(sel: NonNullable<App['sel']>) { this.sel = sel; this.renderSheet(); }
  close() { this.sel = null; $('#sheet').classList.add('hidden'); }

  renderSheet() {
    const el = $('#sheet');
    const sel = this.sel;
    if (!sel) return this.close();
    const g = this.game;
    let html = '';
    if (sel.kind === 'station') { const st = g.station(sel.id!); if (!st) return this.close(); html = this.stationHtml(st); }
    else if (sel.kind === 'vehicle') { const v = g.s.vehicles.find((x) => x.id === sel.id); if (!v) return this.close(); html = this.vehicleHtml(v); }
    else if (sel.kind === 'industry') { const i = g.s.industries.find((x) => x.id === sel.id); if (!i) return this.close(); html = this.industryHtml(i); }
    else if (sel.kind === 'town') html = this.townHtml(g.s.towns[sel.id!]);
    else if (sel.kind === 'challenge') html = this.challengeHtml();
    else html = this.menuHtml();
    el.innerHTML = `<button class="close" data-a="close">✕</button>${html}`;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.a!, b.dataset.id)));
  }

  stationHtml(st: Station) {
    const g = this.game;
    const c = g.catchment(st);
    const vs = g.vehiclesAt(st);
    const cap = STATIONS[st.kind].cap;
    const waiting = Object.values(st.waiting).reduce((a, b) => a + (b ?? 0), 0);
    const towns = [...c.towns].map((t) => g.s.towns[t].name);
    return `<h2>${esc(st.name)}</h2>
      <div class="muted">${STATIONS[st.kind].name} · serves ${num(c.pop)} residents${towns.length ? ` in ${esc(towns.join(', '))}` : ''}</div>
      <h3>Waiting <span class="muted">(${num(waiting)} / ${num(cap)})</span></h3><div>${cargoList(st.waiting)}</div>
      ${st.overflow > 1 ? `<div class="bad">${num(st.overflow)} gave up waiting. Add more capacity!</div>` : ''}
      ${c.industries.length ? `<h3>Industries</h3><div>${c.industries.map((i) => esc(i.name)).join(', ')}</div>` : ''}
      <h3>Vehicles (${vs.length})</h3>
      ${vs.map((v) => `<div class="row"><span>${VEHICLES[v.type].name} · ${v.stops.length} stops · ${loadOf(v)}/${VEHICLES[v.type].capacity}</span><span class="${v.profit >= 0 ? 'ok' : 'bad'}">${money(v.profit)}</span></div>`).join('') || '<div class="muted">None yet.</div>'}
      <div class="actions"><button class="primary" data-a="line-from" data-id="${st.id}">➕ New line from here</button><button data-a="demolish" data-id="${st.id}">🧨 Demolish</button></div>`;
  }

  vehicleHtml(v: Vehicle) {
    const g = this.game, d = VEHICLES[v.type];
    const tgt = g.station(v.stops[v.target]);
    const route = v.stops.map((id, i) => `<span class="stop ${i === v.target ? 'cur' : ''}"><b>${i + 1}</b>${esc(g.station(id)?.name ?? '?')}</span>`).join('<span class="arr">→</span>');
    const state = v.state === 'lost'
      ? `<span class="bad">No route. ${d.mode === 'road' ? 'Road vehicles can only turn round at a dead end or a bus station. Add a loop, a dead end or an off-road station.' : 'Check the track, or look for turns sharper than 45°.'}</span>`
      : v.state === 'load' ? `Loading at ${esc(tgt?.name ?? '')}` : `Heading to ${esc(tgt?.name ?? '')}`;
    const load = loadOf(v);
    return `<h2>${d.name}</h2><div class="stops">${route}<span class="arr">↺</span></div><div>${state}</div>
      <div>Carrying <b>${load}</b> / ${d.capacity}${d.pax ? ' passengers' : 't'} (${Math.round((load / d.capacity) * 100)}%)</div><div class="bar big"><i style="width:${Math.round((load / d.capacity) * 100)}%"></i></div>
      <div>Trips ${v.trips} · Profit <span class="${v.profit >= 0 ? 'ok' : 'bad'}">${money(v.profit)}</span> · Running ${money(d.running)}/min</div>
      <div class="actions"><button class="primary" data-a="clone" data-id="${v.id}">➕ Add another (${money(d.cost)})</button><button data-a="sell" data-id="${v.id}">Sell (+${money(d.cost / 2)})</button></div>`;
  }

  industryHtml(i: Industry) {
    const d = INDUSTRIES[i.kind];
    const g = this.game;
    const served = g.s.stations.some((s) => g.catchment(s).industries.includes(i));
    return `<h2>${esc(i.name)}</h2>
      ${d.produces ? `<div>Produces <b>${CARGO[d.produces].name}</b> · ${num((d.rate ?? 0) * i.rate * 60)} per min (${Math.round(i.rate * 100)}%)</div>` : ''}
      ${d.accepts.length ? `<div>Accepts <b>${d.accepts.map((c) => CARGO[c].name).join(', ')}</b>${d.converts ? ` → makes ${CARGO[d.converts.to].name}` : ''}</div>` : ''}
      <div>Stockpile: ${cargoList(i.stock)}</div>
      <div class="${served ? 'ok' : 'bad'}">${served ? 'Served by a station.' : 'Not served yet. Build a station within reach.'}</div>
      <div class="muted">Production goes up when you move more than 60% of the output.</div>`;
  }

  townHtml(t: Town) {
    const g = this.game;
    const pop = g.pop(t);
    const need = 25 + 1.2 * g.buildings(t);
    return `<h2>${esc(t.name)}</h2><div>Population <b>${num(pop)}</b> · ${g.buildings(t)} buildings</div>
      <div>Growth</div><div class="bar big"><i style="width:${Math.min(100, (t.growth / need) * 100)}%"></i></div>
      <div class="muted">Towns grow when you carry their passengers and deliver goods. Houses turn into flats, and flats into towers.</div>
      <div>Carried so far: ${num(t.served)}</div>`;
  }

  challengeHtml() {
    const g = this.game, def = this.sc.active, st = g.s.scenario;
    if (!def || !st) return '<p>No active challenge.</p>';
    const objs = this.sc.objectives();
    return `<h2>${def.icon} ${esc(def.title(g, st.params))}</h2><p>${esc(def.brief(g, st.params))}</p>
      ${objs.map((o) => `<div class="row"><span>${esc(o.label)}</span><span class="${o.value >= o.target ? 'ok' : ''}">${o.target === 1 ? (o.value ? '✓' : '—') : `${num(o.value)} / ${num(o.target)}`}</span></div><div class="bar"><i style="width:${Math.min(100, (o.value / o.target) * 100)}%"></i></div>`).join('')}
      <div class="muted">Reward ${money(def.reward(g, st.params))}</div>
      <div class="actions"><button data-a="find">📍 Show me</button><button data-a="abandon">Abandon</button></div>`;
  }

  menuHtml() {
    const g = this.game;
    const pop = g.s.towns.reduce((a, t) => a + g.pop(t), 0);
    return `<h2>Tracks &amp; Towns</h2>
      <div>Region population <b>${num(pop)}</b> · ${g.s.vehicles.length} vehicles · ${g.s.completed.length} challenges done</div>
      <div class="muted">Saved on this device. Your network keeps earning for up to ${OFFLINE_CAP_SECONDS / 3600}h while you're away.</div>
      <div class="actions"><button class="primary" data-a="board">🎯 Challenges</button><button data-a="home">🏠 Home</button><button data-a="reset">🗑️ New region</button></div>
      <h3>Tips</h3>
      <div class="muted">• Rail, metro and motorways can only turn 45° per tile, so sweep around corners. Streets can turn any way.<br>
      • Vehicles only load what the far end can use. Stations with nothing nearby act as transfer hubs.<br>
      • Busy streets slow traffic down. Motorways carry far more.<br>
      • Metro tunnels run under buildings. Demolishing a building costs ${money(1500)} per storey level.</div>`;
  }

  action(a: string, idStr?: string) {
    const g = this.game, id = Number(idStr);
    if (a === 'close') return this.close();
    if (a === 'line-from') {
      const st = g.station(id)!;
      this.setTool('line');
      const sd = STATIONS[st.kind];
      const freight = sd.cargo === 'freight' || (sd.cargo === 'any' && g.catchment(st).industries.some((i) => INDUSTRIES[i.kind].produces));
      const opts = (Object.keys(VEHICLES) as VehicleId[]).filter((k) => canServe(VEHICLES[k], sd) && VEHICLES[k].pax !== freight && g.has(VEHICLES[k].tech));
      if (!opts.length) { this.toast('No unlocked vehicles can use this station yet.'); return; }
      return this.vehiclePicker(VEHICLES[opts[0]].group, () => { this.lineStops = [st.id]; });
    }
    if (a === 'demolish') { const st = g.station(id)!; g.removeStation(st); this.toast(`Demolished ${st.name}`); return this.close(); }
    if (a === 'clone') {
      const v = g.s.vehicles.find((x) => x.id === id)!;
      const err = g.buyVehicle(v.type, v.stops.map((sid) => g.station(sid)!).filter(Boolean));
      this.toast(err ?? `Another ${VEHICLES[v.type].name} added`);
      return this.renderSheet();
    }
    if (a === 'sell') { const v = g.s.vehicles.find((x) => x.id === id)!; this.toast(`Sold for ${money(g.sellVehicle(v))}`); return this.close(); }
    if (a === 'find') { this.focusScenario(); return this.close(); }
    if (a === 'abandon') { this.sc.abandon(); this.close(); return this.board(); }
    if (a === 'board') { this.close(); return this.board(); }
    if (a === 'home') { this.focus(g.s.start.x, g.s.start.y); this.r.cam.zoom = 1.2; return this.close(); }
    if (a === 'reset') {
      this.modal('<h2>Start a new region?</h2><p>This wipes your progress on this device.</p><button class="danger" data-m="yes">Yes, start over</button> <button data-m="no">Cancel</button>', (m) => {
        if (m !== 'yes') return;
        wipe();
        this.game = new Game(newGame());
        this.sc = this.wireScenarios();
        this.r.setGame(this.game);
        this.close();
        save(this.game.s);
        this.setTool('look');
        this.welcome();
      });
    }
  }

  // ---------------- input ----------------
  bindInput() {
    const cv = this.r.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let gesture: 'none' | 'maybe' | 'pan' | 'draw' | 'pinch' = 'none';
    let start = { x: 0, y: 0, t: 0 };
    let pinch = { d: 0, cx: 0, cy: 0 };
    let nodes: number[] = [];

    const w = () => this.game.s.w;
    const pushLine = (to: number) => {
      // 8-connected Bresenham from the last node to `to`
      const last = nodes[nodes.length - 1];
      let x = last % w(), y = Math.floor(last / w());
      const tx = to % w(), ty = Math.floor(to / w());
      const dx = Math.abs(tx - x), dy = Math.abs(ty - y), sx = Math.sign(tx - x), sy = Math.sign(ty - y);
      let err = dx - dy;
      while (x !== tx || y !== ty) {
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
        const n = y * w() + x;
        // stepping back onto the previous node undoes the last step
        if (nodes.length >= 2 && nodes[nodes.length - 2] === n) nodes.pop();
        else nodes.push(n);
      }
    };
    const updateStroke = () => {
      const g = this.game;
      if (this.tool === 'clear') { this.stroke = { nodes, bad: -1, color: 'rgba(255,80,60,0.6)' }; return; }
      const plan = g.planBlueprint([...this.blueprint, nodes], this.buildKind);
      const mine = plan.strokes[plan.strokes.length - 1];
      this.stroke = { nodes, bad: mine.bad, color: 'rgba(76,195,255,0.6)' };
      this.renderHint(mine.bad >= 0 ? PROBLEM_TEXT[mine.reason!] : `Blueprint: ${plan.tiles} tiles · ${money(plan.cost)} · lift to add, then Build`);
    };
    const drawing = () => this.tool === 'road' || this.tool === 'rail' || this.tool === 'clear';

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        start = { x: e.clientX, y: e.clientY, t: performance.now() };
        gesture = 'maybe';
        const t = this.r.screenToTile(e.clientX, e.clientY);
        if (this.tool === 'station') this.catchPreview = { x: t.x, y: t.y, r: STATIONS[this.stationKind].radius };
        if (drawing() && this.game.inBounds(t.x, t.y)) nodes = [this.game.idx(t.x, t.y)];
      } else if (pts.size === 2) {
        gesture = 'pinch';
        nodes = [];
        this.stroke = null;
        this.renderHint();
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      }
    });

    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId)!;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const before = this.r.screenToIso(cx, cy);
        this.r.cam.zoom *= d / (pinch.d || d);
        this.r.clampCam();
        const after = this.r.screenToIso(cx, cy);
        this.r.cam.x += before.x - after.x - (cx - pinch.cx) / this.r.cam.zoom;
        this.r.cam.y += before.y - after.y - (cy - pinch.cy) / this.r.cam.zoom;
        this.r.clampCam();
        pinch = { d, cx, cy };
        return;
      }
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (gesture === 'maybe' && moved > 8) gesture = drawing() && nodes.length ? 'draw' : 'pan';
      if (gesture === 'pan') {
        this.r.cam.x -= (e.clientX - prev.x) / this.r.cam.zoom;
        this.r.cam.y -= (e.clientY - prev.y) / this.r.cam.zoom;
        this.r.clampCam();
        this.catchPreview = null;
      } else if (gesture === 'draw') {
        const f = this.r.screenToTileF(e.clientX, e.clientY);
        const tx = Math.floor(f.x), ty = Math.floor(f.y);
        // only commit to a tile once the finger is near its centre (reduces wobble)
        if (!this.game.inBounds(tx, ty) || Math.hypot(f.x - tx - 0.5, f.y - ty - 0.5) > 0.36) return;
        const n = this.game.idx(tx, ty);
        if (n !== nodes[nodes.length - 1]) { pushLine(n); updateStroke(); }
      }
    });

    const end = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (gesture === 'pinch') { if (!pts.size) gesture = 'none'; return; }
      if (pts.size) return;
      const quick = performance.now() - start.t < 600;
      if (gesture === 'maybe' && quick && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
      else if (gesture === 'draw' && e.type === 'pointerup') this.commitStroke(nodes);
      if (gesture === 'draw') this.renderBuildBar();
      gesture = 'none';
      nodes = [];
      this.stroke = null;
      this.catchPreview = null;
      if (this.tool !== 'line') this.renderHint();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.r.screenToIso(e.clientX, e.clientY);
      this.r.cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.r.clampCam();
      const after = this.r.screenToIso(e.clientX, e.clientY);
      this.r.cam.x += before.x - after.x;
      this.r.cam.y += before.y - after.y;
      this.r.clampCam();
    }, { passive: false });
  }

  commitStroke(nodes: number[]) {
    const g = this.game;
    if (nodes.length < 2) return;
    if (this.tool === 'clear') { if (!g.bulldozeStroke(nodes)) this.toast('Nothing to remove along there.'); return; }
    // road and rail strokes go into the blueprint; nothing is built until you press Build
    this.blueprint.push(nodes.slice());
  }

  renderBuildBar() {
    const el = $('#buildbar');
    const g = this.game;
    const last = g.lastBuild();
    if ((this.tool !== 'road' && this.tool !== 'rail') || (!this.blueprint.length && !last)) { el.classList.add('hidden'); return; }
    let html = '';
    if (this.blueprint.length) {
      const plan = g.planBlueprint(this.blueprint, this.buildKind);
      const bad = plan.strokes.find((x) => x.bad >= 0);
      const short = g.s.money < plan.cost;
      html = `<div class="bl"><b>📐 Blueprint</b><span>${plan.tiles} tile${plan.tiles === 1 ? '' : 's'} of ${BUILD[this.buildKind].name.toLowerCase()} · <b class="gold">${money(plan.cost)}</b></span></div>
        ${bad ? `<div class="bad small">${esc(PROBLEM_TEXT[bad.reason!])} Undo the red part.</div>` : short ? '<div class="bad small">Not enough money for all of it.</div>' : ''}
        <div class="rbtns"><button data-b="undo">↶ Undo</button><button data-b="clear">Clear</button><button class="primary" data-b="build" ${bad || short || !plan.tiles ? 'disabled' : ''}>Build · ${money(plan.cost)}</button></div>`;
    } else if (last) {
      html = `<div class="bl"><span class="muted">Last build: ${last.edges.length} tile${last.edges.length === 1 ? '' : 's'} of ${last.name.toLowerCase()}</span></div>
        <div class="rbtns"><button data-b="undobuild">↶ Undo build (refund ${money(Math.floor(last.cost * UNDO_REFUND))})</button></div>`;
    }
    el.innerHTML = html;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLButtonElement>('[data-b]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.b;
      if (a === 'undo') this.blueprint.pop();
      if (a === 'clear') this.blueprint = [];
      if (a === 'build') {
        const err = g.buildBlueprint(this.blueprint, this.buildKind);
        if (err) this.toast(err);
        else { this.toast(`Built ${BUILD[this.buildKind].name.toLowerCase()}`); this.blueprint = []; }
      }
      if (a === 'undobuild' && last) {
        const refund = Math.floor(last.cost * UNDO_REFUND);
        return this.modal(`<h2>Undo last build?</h2><p>This removes the last ${esc(last.name.toLowerCase())} you built (${last.edges.length} tiles). It cost ${money(last.cost)}; you get <b>${money(refund)}</b> back.</p><button class="danger" data-m="y">Undo build</button> <button data-m="n">Keep it</button>`, (m) => {
          if (m === 'y') this.toast(g.undoBuild());
          this.renderBuildBar();
        });
      }
      this.renderBuildBar();
      this.renderHint();
    }));
  }

  tap(sx: number, sy: number) {
    const g = this.game;
    const t = this.r.screenToTile(sx, sy);
    if (this.tool === 'look') {
      let best: Vehicle | null = null, bd = 26;
      for (const v of g.s.vehicles) {
        const def = VEHICLES[v.type];
        const c = g.curveOf(v);
        const p = c.at(v.dist);
        const alt = def.mode === 'air' && v.state === 'move' ? Math.min(1, (v.dist / c.length) * 5, (1 - v.dist / c.length) * 5) * 90 : 6;
        const q = this.r.tileToScreen(p.x, p.y, alt);
        const d = Math.hypot(q.x - sx, q.y - sy);
        if (d < bd) { bd = d; best = v; }
      }
      if (best) return this.open({ kind: 'vehicle', id: best.id });
      if (!g.inBounds(t.x, t.y)) return this.close();
      const st = g.stationAt(t.x, t.y) ?? g.airportAt(t.x, t.y);
      if (st) return this.open({ kind: 'station', id: st.id });
      const ind = g.industryAt(t.x, t.y);
      if (ind) return this.open({ kind: 'industry', id: ind.id });
      const town = g.townAt(t.x, t.y);
      if (town) return this.open({ kind: 'town', id: town.id });
      return this.close();
    }
    if (!g.inBounds(t.x, t.y)) return;
    if (this.tool === 'clear') {
      const n = g.idx(t.x, t.y);
      const hasNet = g.road.any(n) || g.rail.any(n) || g.metro.any(n) || g.stationAt(t.x, t.y) || g.airportAt(t.x, t.y);
      if (!hasNet && g.s.bld[n]) {
        const cost = 1500 * g.s.bld[n];
        return this.modal(`<h2>Demolish this building?</h2><p>${LEVEL_POP[g.s.bld[n]]} residents will move out. Compulsory purchase costs <b>${money(cost)}</b>.</p><button class="danger" data-m="y">Demolish</button> <button data-m="n">Cancel</button>`,
          (m) => { if (m === 'y') { const r = g.bulldoze(t.x, t.y); if (r) this.toast(r); } });
      }
      const r = g.bulldoze(t.x, t.y);
      if (r) this.toast(r);
      return;
    }
    if (this.tool === 'station') {
      const err = g.placeStation(t.x, t.y, this.stationKind);
      if (err) return this.toast(err);
      const st = g.stationAt(t.x, t.y)!;
      const c = g.catchment(st);
      this.toast(`${st.name} opened, serving ${num(c.pop)} residents${c.industries.length ? ` and ${c.industries.map((i) => i.name).join(', ')}` : ''}`);
      return;
    }
    if (this.tool === 'line') {
      const st = g.stationAt(t.x, t.y) ?? g.airportAt(t.x, t.y);
      if (!st) return this.toast('Tap a station.');
      if (!this.vehicleType) return this.toast('Choose a vehicle type first.');
      const def = VEHICLES[this.vehicleType];
      if (!canServe(def, STATIONS[st.kind])) return this.toast(`A ${def.name} can't use a ${STATIONS[st.kind].name.toLowerCase()}.`);
      if (this.lineStops[this.lineStops.length - 1] === st.id) return;
      this.lineStops.push(st.id);
      this.renderRoute();
      this.renderHint();
    }
  }

  blueprintOverlay() {
    const out: { nodes: number[]; bad: number; color: string }[] = [];
    if (this.blueprint.length) {
      const plan = this.game.planBlueprint(this.blueprint, this.buildKind);
      this.blueprint.forEach((nodes, i) => out.push({ nodes, bad: plan.strokes[i].bad, color: 'rgba(76,195,255,0.6)' }));
    }
    if (this.stroke) out.push(this.stroke);
    return out;
  }

  // ---------------- loop ----------------
  frame(now: number) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    const step = dt * this.speed;
    g.tick(step);
    this.sc.update(step);
    for (const e of g.events) {
      if (e.t === 'news') this.toast(e.text, e.x !== undefined ? { x: e.x, y: e.y! } : undefined);
      else if (e.t === 'money') this.floats.push({ x: e.x + 0.5, y: e.y + 0.5, text: `+${money(e.amount)}`, color: '#7dffa8', t: 0 });
    }
    g.events.length = 0;
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < 1.6);
    if (this.floats.length > 30) this.floats.splice(0, this.floats.length - 30);

    const m = $('#money');
    m.textContent = money(g.s.money);
    m.classList.toggle('bad', g.s.money < 0);
    if (!this.incomeSamples.length || now - this.incomeSamples[this.incomeSamples.length - 1].t > 5000) {
      this.incomeSamples.push({ t: now, earned: g.s.earned });
      if (this.incomeSamples.length > 13) this.incomeSamples.shift();
      const a = this.incomeSamples[0], b = this.incomeSamples[this.incomeSamples.length - 1];
      $('#rate').textContent = `${money(b.t > a.t ? ((b.earned - a.earned) / (b.t - a.t)) * 60000 : 0)}/min`;
    }
    if (now - this.sheetAt > 500) {
      this.sheetAt = now;
      this.renderCard();
      if (this.sel && this.sel.kind !== 'menu') this.renderSheet();
    }
    const ov: Overlay = {
      strokes: this.blueprintOverlay(),
      catchment: this.catchPreview,
      selStation: this.sel?.kind === 'station' ? this.sel.id! : null,
      lineStops: this.tool === 'line' ? this.lineStops : this.sel?.kind === 'vehicle' ? (g.s.vehicles.find((v) => v.id === this.sel!.id)?.stops ?? []) : [],
      selVehicle: this.sel?.kind === 'vehicle' ? this.sel.id! : null,
      selIndustry: this.sel?.kind === 'industry' ? this.sel.id! : null,
      grid: this.tool !== 'look',
      floats: this.floats,
    };
    this.r.draw(now, ov);
    requestAnimationFrame((t) => this.frame(t));
  }
}

(window as unknown as { app: App }).app = new App();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
