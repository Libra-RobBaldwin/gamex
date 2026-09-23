import './style.css';
import {
  BUILDINGS, CARGO, INFRA, SKILLS, STATIONS, VEHICLES, levelForXp, levelUnlocks, nextUnlock, xpForLevel,
  OFFLINE_CAP_SECONDS, type CargoId, type Mode, type SkillId, type VehicleId,
} from './data';
import { Renderer, TILE, type Float, type Overlay } from './render';
import { load, save, wipe } from './save';
import { Game, newGame, vehiclePos, type Station, type Vehicle } from './sim';
import { TASKS, checkTasks, currentTask } from './tasks';
import type { Building } from './world';

type Tool = 'look' | 'road' | 'rail' | 'station' | 'vehicle' | 'clear';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `${Math.floor(a / 1e6)}M` : a >= 1e5 ? `${Math.floor(a / 1e3)}K` : Math.floor(a).toLocaleString('en-GB');
  return (n < 0 ? '-' : '') + s;
};
const cargoList = (m: Partial<Record<CargoId, number>>) => {
  const items = (Object.entries(m) as [CargoId, number][]).filter(([, n]) => n >= 1);
  return items.length ? items.map(([c, n]) => `${Math.floor(n)} ${CARGO[c].name}`).join(', ') : '<span class="muted">empty</span>';
};
const skillName = (id: SkillId) => SKILLS.find((s) => s.id === id)!.name;
const skillIcon = (id: SkillId) => SKILLS.find((s) => s.id === id)!.icon;

class App {
  game: Game;
  r: Renderer;
  tool: Tool = 'look';
  stationMode: Mode = 'road';
  vehicleType: VehicleId = 'ox_cart';
  routeFirst: number | null = null;
  sel: { kind: 'station' | 'building' | 'vehicle' | 'skills' | 'tasks' | 'menu'; id?: number } | null = null;
  floats: Float[] = [];
  preview: { tiles: number[]; ok: boolean } | null = null;
  catchPreview: { x: number; y: number; r: number } | null = null;
  pendingXp: Partial<Record<SkillId, number>> = {};
  lastXpFlush = 0;
  chatLines: { text: string; color?: string }[] = [];
  incomeSamples: { t: number; earned: number }[] = [];
  speed = 1;
  last = performance.now();
  hiddenAt: number | null = null;
  sheetRefresh = 0;

  constructor() {
    const saved = load();
    this.game = new Game(saved ? saved.state : newGame());
    this.buildDom();
    this.r = new Renderer($('#map'), this.game);
    this.bindInput();
    window.addEventListener('resize', () => this.r.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => save(this.game.s));
    setInterval(() => save(this.game.s), 10_000);

    this.say('Welcome to Gielinor Haulage.', '#000080');
    if (saved) {
      const away = Math.min(OFFLINE_CAP_SECONDS, (Date.now() - saved.savedAt) / 1000);
      if (away > 30) this.offline(away);
    } else {
      this.say('Link resources to industries and towns to earn coins and XP.');
    }
    this.setTool('look');
    this.renderTask();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------- DOM ----------------
  buildDom() {
    $('#ui').innerHTML = `
      <div id="top">
        <div id="purse" class="panel-box"><div id="coins"></div><div id="rate"></div></div>
        <div id="task" class="panel-box"></div>
        <div id="topbtns">
          <button id="b-skills" title="Skills">📊</button>
          <button id="b-menu" title="Menu">☰</button>
        </div>
      </div>
      <div id="xpdrops"></div>
      <div id="levelup"></div>
      <div id="dock">
        <div id="hint"></div>
        <div id="chat" class="min"></div>
        <div id="sub"></div>
        <div id="tools" class="panel-box">
          <button data-tool="look"><span class="i">✋</span>Look</button>
          <button data-tool="road"><span class="i">🟫</span>Road</button>
          <button data-tool="rail"><span class="i">🛤️</span>Rail</button>
          <button data-tool="station"><span class="i">🚏</span>Stop</button>
          <button data-tool="vehicle"><span class="i">🐂</span>Vehicle</button>
          <button data-tool="clear"><span class="i">💥</span>Clear</button>
        </div>
      </div>
      <div id="sheet" class="panel-box hidden"></div>
      <div id="modal" class="hidden"></div>`;
    document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) =>
      b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool)));
    $('#b-skills').addEventListener('click', () => this.open({ kind: 'skills' }));
    $('#b-menu').addEventListener('click', () => this.open({ kind: 'menu' }));
    $('#task').addEventListener('click', () => this.open({ kind: 'tasks' }));
    $('#chat').addEventListener('click', () => $('#chat').classList.toggle('min'));
  }

  setTool(t: Tool) {
    this.tool = t;
    this.routeFirst = null;
    this.preview = null;
    this.catchPreview = null;
    document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    this.renderSub();
    this.renderHint();
    if (t !== 'look') this.close();
  }

  renderSub() {
    const sub = $('#sub');
    const lvl = this.game.level('transport');
    if (this.tool === 'station') {
      sub.innerHTML = (Object.keys(STATIONS) as Mode[]).map((m) => {
        const d = STATIONS[m];
        const locked = lvl < d.level;
        return `<button data-m="${m}" class="${m === this.stationMode ? 'on' : ''} ${locked ? 'locked' : ''}">${d.name}<small>${locked ? `🔒 Transport ${d.level}` : `${d.cost} gp`}</small></button>`;
      }).join('');
      sub.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
        this.stationMode = b.dataset.m as Mode;
        this.renderSub();
        this.renderHint();
      }));
    } else if (this.tool === 'vehicle') {
      sub.innerHTML = (Object.keys(VEHICLES) as VehicleId[]).map((id) => {
        const d = VEHICLES[id];
        const locked = lvl < d.level;
        return `<button data-v="${id}" class="${id === this.vehicleType ? 'on' : ''} ${locked ? 'locked' : ''}">${d.name}<small>${locked ? `🔒 Transport ${d.level}` : `${fmt(d.cost)} gp · ${d.capacity} cap`}</small></button>`;
      }).join('');
      sub.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
        this.vehicleType = b.dataset.v as VehicleId;
        this.routeFirst = null;
        this.renderSub();
        this.renderHint();
      }));
    } else sub.innerHTML = '';
  }

  renderHint() {
    const h = $('#hint');
    const t = this.tool;
    if (t === 'road' || t === 'rail') {
      const d = INFRA[t];
      h.textContent = this.game.level('transport') < d.level
        ? `🔒 ${d.name} needs Transport ${d.level}`
        : `Drag to lay ${d.name.toLowerCase()} · ${d.cost} gp/tile · 2 fingers to pan`;
    } else if (t === 'station') h.textContent = `Tap to place a ${STATIONS[this.stationMode].name.toLowerCase()} · covers ${STATIONS[this.stationMode].radius} tiles`;
    else if (t === 'vehicle') {
      const d = VEHICLES[this.vehicleType];
      h.textContent = this.routeFirst == null ? `${d.name}: tap the first ${STATIONS[d.mode].name.toLowerCase()}` : `${d.name}: now tap the second stop`;
    } else if (t === 'clear') h.textContent = 'Tap or drag to demolish (50% refund on stops)';
    else h.textContent = '';
  }

  renderTask() {
    const t = currentTask(this.game);
    $('#task').innerHTML = t
      ? `<div class="t">📜 ${esc(t.title)} <span class="gold">+${fmt(t.reward)}</span></div><div class="h">${esc(t.hint)}</div>`
      : '<div class="t">📜 All tasks complete!</div><div class="h">Keep expanding your empire.</div>';
  }

  say(text: string, color?: string) {
    this.chatLines.push({ text, color });
    if (this.chatLines.length > 6) this.chatLines.shift();
    $('#chat').innerHTML = this.chatLines.map((l) => `<div class="line" style="${l.color ? `color:${l.color}` : ''}">${esc(l.text)}</div>`).join('');
  }

  xpDrop(drops: [SkillId, number][]) {
    const el = document.createElement('div');
    el.className = 'drop';
    el.innerHTML = drops.map(([k, v]) => `<div>${skillIcon(k)} +${fmt(Math.round(v))}</div>`).join('');
    $('#xpdrops').appendChild(el);
    setTimeout(() => el.remove(), 1900);
  }

  levelUp(skill: SkillId, level: number) {
    const unlocks = levelUnlocks(skill, level);
    this.say(`Congratulations, you just advanced a ${skillName(skill)} level. You are now level ${level}.`, '#0000c0');
    for (const u of unlocks) this.say(`Unlocked: ${u}`, '#7a1f9a');
    $('#levelup').innerHTML = `<div class="card panel-box"><div class="big">${skillIcon(skill)} ${skillName(skill)} level ${level}!</div>${unlocks.map((u) => `<div class="u">Unlocked: ${esc(u)}</div>`).join('')}</div>`;
    if (skill === 'transport') this.renderSub();
    try { navigator.vibrate?.(60); } catch { /* ignore */ }
  }

  // ---------------- sheets ----------------
  open(sel: NonNullable<App['sel']>) {
    this.sel = sel;
    this.renderSheet();
  }

  close() {
    this.sel = null;
    $('#sheet').classList.add('hidden');
  }

  renderSheet() {
    const el = $('#sheet');
    if (!this.sel) { el.classList.add('hidden'); return; }
    const g = this.game;
    let html = '';
    const sel = this.sel;
    if (sel.kind === 'station') {
      const st = g.station(sel.id!);
      if (!st) return this.close();
      html = this.stationHtml(st);
    } else if (sel.kind === 'building') {
      const b = g.s.buildings.find((x) => x.id === sel.id);
      if (!b) return this.close();
      html = this.buildingHtml(b);
    } else if (sel.kind === 'vehicle') {
      const v = g.s.vehicles.find((x) => x.id === sel.id);
      if (!v) return this.close();
      html = this.vehicleHtml(v);
    } else if (sel.kind === 'skills') html = this.skillsHtml();
    else if (sel.kind === 'tasks') html = this.tasksHtml();
    else html = this.menuHtml();
    el.innerHTML = `<button class="close" data-a="close">✕</button>${html}`;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLButtonElement>('[data-a]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.a!, b.dataset.id)));
  }

  stationHtml(st: Station) {
    const g = this.game;
    const cat = g.catchmentOf(st);
    const vs = g.vehiclesAt(st);
    return `<h2>${esc(st.name)}</h2>
      <div class="muted">${STATIONS[st.mode].name} · catchment ${STATIONS[st.mode].radius} tiles</div>
      <h3>Waiting cargo</h3><div>${cargoList(st.cargo)}</div>
      <h3>Serves</h3><div>${cat.length ? cat.map((b) => esc(b.name || BUILDINGS[b.kind].name)).join(', ') : '<span class="bad">Nothing nearby — move closer to a resource, industry or town.</span>'}</div>
      <h3>Vehicles (${vs.length})</h3>
      ${vs.map((v) => `<div class="row"><span>${VEHICLES[v.type].name} → ${esc(g.station(v.stops[0] === st.id ? v.stops[1] : v.stops[0])?.name ?? '?')}</span><span class="${v.profit >= 0 ? 'good' : 'bad'}">${fmt(v.profit)} gp</span></div>`).join('') || '<div class="muted">None yet.</div>'}
      <div class="actions">
        <button data-a="route-from" data-id="${st.id}">🐂 New route from here</button>
        <button data-a="demolish-st" data-id="${st.id}">💥 Demolish</button>
      </div>`;
  }

  buildingHtml(b: Building) {
    const g = this.game;
    const def = BUILDINGS[b.kind];
    const served = g.stationsOf(b).length > 0;
    let body = '';
    if (def.type === 'node') {
      const lvl = g.level(def.skill);
      const locked = lvl < def.level;
      body = `<div>${skillIcon(def.skill)} Requires ${skillName(def.skill)} ${def.level} ${locked ? `<span class="bad">(you: ${lvl})</span>` : '<span class="good">✓</span>'}</div>
        <div>Produces <b>${CARGO[def.produces].name}</b> · ${(def.rate * 60).toFixed(0)}/min</div>
        <div>Stockpile: ${Math.floor(b.stock[def.produces] ?? 0)} / ${def.cap}</div>
        <div class="${served ? 'good' : 'bad'}">${served ? 'Served by a stop — gathering trains your skill.' : 'No stop nearby: place one within 2 tiles.'}</div>
        <div class="actions"><button data-a="gather" data-id="${b.id}" ${locked ? 'disabled' : ''}>${def.skill === 'woodcutting' ? '🪓 Chop' : def.skill === 'mining' ? '⛏️ Mine' : '🎣 Fish'} (+${def.xp} xp)</button></div>`;
    } else if (def.type === 'industry') {
      body = `<h3>Recipes</h3>${def.recipes.map((r) => {
        const ok = g.level(r.skill) >= r.level;
        const ins = Object.entries(r.inputs).map(([c, n]) => `${n} ${CARGO[c as CargoId].name}`).join(' + ');
        const outs = Object.entries(r.outputs).map(([c, n]) => `${n} ${CARGO[c as CargoId].name}`).join(' + ');
        return `<div class="${ok ? '' : 'muted'}">${ins} → ${outs} ${ok ? '' : `🔒 ${skillName(r.skill)} ${r.level}`}</div>`;
      }).join('')}
        <h3>Input stock</h3><div>${cargoList(b.input)}</div>
        <h3>Output waiting</h3><div>${cargoList(b.stock)}</div>
        <div class="${served ? 'good' : 'bad'}">${served ? 'Served by a stop.' : 'No stop nearby.'}</div>`;
    } else {
      body = `<div>Buys: ${def.accepts.map((c) => `${CARGO[c].name} (${CARGO[c].value} gp)`).join(', ')}</div>
        <div class="muted">Payment grows with distance travelled.</div>
        <div class="${served ? 'good' : 'bad'}">${served ? 'Served by a stop.' : 'No stop nearby.'}</div>`;
    }
    return `<h2>${esc(b.name || def.name)}</h2>${body}`;
  }

  vehicleHtml(v: Vehicle) {
    const g = this.game;
    const d = VEHICLES[v.type];
    const a = g.station(v.stops[0]), b = g.station(v.stops[1]);
    const tgt = g.station(v.stops[v.target]);
    const state = v.state === 'lost' ? '<span class="bad">Lost — no route! Reconnect the track.</span>'
      : v.state === 'load' ? `Loading at ${esc(tgt?.name ?? '')}` : `Heading to ${esc(tgt?.name ?? '')}`;
    return `<h2>${d.name}</h2>
      <div>${esc(a?.name ?? '?')} ⇄ ${esc(b?.name ?? '?')}</div>
      <div>${state}</div>
      <div>Cargo: ${cargoList(v.cargo)} <span class="muted">(cap ${d.capacity})</span></div>
      <div>Trips: ${v.trips} · Profit: <span class="${v.profit >= 0 ? 'good' : 'bad'}">${fmt(v.profit)} gp</span> · Upkeep ${d.upkeep} gp/min</div>
      <div class="actions">
        <button data-a="clone" data-id="${v.id}">➕ Add another (${fmt(d.cost)} gp)</button>
        <button data-a="sell" data-id="${v.id}">💰 Sell (+${fmt(Math.floor(d.cost / 2))})</button>
      </div>`;
  }

  skillsHtml() {
    const g = this.game;
    const total = SKILLS.reduce((a, s) => a + g.level(s.id), 0);
    return `<h2>Skills <span class="muted">· total ${total}</span></h2><div id="skills">${SKILLS.map((s) => {
      const xp = g.s.xp[s.id];
      const l = levelForXp(xp);
      const a = xpForLevel(l), b = xpForLevel(l + 1);
      const pct = l >= 99 ? 100 : Math.floor(((xp - a) / (b - a)) * 100);
      const nx = nextUnlock(s.id, l);
      return `<div class="skill"><div class="top"><span>${s.icon} ${s.name}</span><span class="lvl">${l}</span></div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="nx">${fmt(xp)} xp${l < 99 ? ` · ${fmt(b - xp)} to go` : ''}</div>
        ${nx ? `<div class="nx">Lv ${nx.level}: ${esc(nx.names.join(', '))}</div>` : ''}</div>`;
    }).join('')}</div>`;
  }

  tasksHtml() {
    const done = this.game.s.stats.tasksDone;
    return `<h2>Task list</h2><div class="tasklist">${TASKS.map((t, i) =>
      `<div class="${i < done ? 'done' : i === done ? 'cur' : 'todo'}">${i < done ? '✔' : i === done ? '▶' : '·'} ${esc(t.title)} <span class="gold">+${fmt(t.reward)}</span>${i === done ? `<div class="muted">${esc(t.hint)}</div>` : ''}</div>`).join('')}</div>`;
  }

  menuHtml() {
    return `<h2>Menu</h2>
      <div class="muted">Your progress saves on this device. Vehicles keep working for up to ${OFFLINE_CAP_SECONDS / 3600}h while you're away.</div>
      <div class="actions">
        <button data-a="speed">⏩ Speed: ${this.speed}x</button>
        <button data-a="home">🏠 Back to start</button>
        <button data-a="tasks">📜 Tasks</button>
        <button data-a="reset">🗑️ New world</button>
      </div>
      <h3>How to play</h3>
      <div class="muted">Place stops within reach of resources, industries and towns. Join stops with road or rail, then buy a vehicle to run between two stops. Vehicles only pick up cargo the other end can use. Leave cargo at a stop with nothing nearby and another route can collect it (a transfer hub). Longer trips pay more and give more Transport XP.</div>`;
  }

  action(a: string, idStr?: string) {
    const g = this.game;
    const id = idStr ? Number(idStr) : NaN;
    if (a === 'close') return this.close();
    if (a === 'route-from') {
      const st = g.station(id)!;
      this.setTool('vehicle');
      const pick = (Object.keys(VEHICLES) as VehicleId[]).filter((v) => VEHICLES[v].mode === st.mode && g.level('transport') >= VEHICLES[v].level).pop();
      if (pick) this.vehicleType = pick;
      this.routeFirst = st.id;
      this.renderSub();
      this.renderHint();
      return;
    }
    if (a === 'demolish-st') {
      const st = g.station(id)!;
      g.bulldoze(st.x, st.y);
      this.say(`Demolished ${st.name}.`);
      return this.close();
    }
    if (a === 'gather') {
      const b = g.s.buildings.find((x) => x.id === id)!;
      const err = g.gather(b);
      const def = BUILDINGS[b.kind];
      if (err) this.say(err, '#a00000');
      else if (def.type === 'node') this.say(`${def.verb} You get some ${CARGO[def.produces].name.toLowerCase()}.`);
      return this.renderSheet();
    }
    if (a === 'clone') {
      const v = g.s.vehicles.find((x) => x.id === id)!;
      const err = g.buyVehicle(v.type, g.station(v.stops[0])!, g.station(v.stops[1])!);
      this.say(err ?? `You buy another ${VEHICLES[v.type].name}.`, err ? '#a00000' : undefined);
      return this.renderSheet();
    }
    if (a === 'sell') {
      const v = g.s.vehicles.find((x) => x.id === id)!;
      const r = g.sellVehicle(v);
      this.say(`Sold ${VEHICLES[v.type].name} for ${r} gp.`);
      return this.close();
    }
    if (a === 'speed') {
      this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
      return this.renderSheet();
    }
    if (a === 'home') {
      this.r.cam.x = g.s.start.x * TILE;
      this.r.cam.y = g.s.start.y * TILE;
      return this.close();
    }
    if (a === 'tasks') return this.open({ kind: 'tasks' });
    if (a === 'reset') {
      this.modal(`<h2>New world?</h2><p>This wipes your progress on this device.</p>
        <div class="actions" style="justify-content:center;display:flex;gap:8px"><button data-m="yes">Yes, start over</button><button data-m="no">Cancel</button></div>`,
        (m) => {
          if (m !== 'yes') return;
          wipe();
          this.game = new Game(newGame());
          this.r.setGame(this.game);
          this.chatLines = [];
          this.say('A new world awaits.');
          this.renderTask();
          this.close();
          save(this.game.s);
        });
    }
  }

  modal(html: string, onPick?: (m: string) => void) {
    const el = $('#modal');
    el.innerHTML = `<div class="box panel-box">${html}</div>`;
    el.classList.remove('hidden');
    el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.addEventListener('click', () => {
      el.classList.add('hidden');
      onPick?.(b.dataset.m!);
    }));
  }

  offline(seconds: number) {
    const r = this.game.catchUp(seconds);
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
    const xp = (Object.entries(r.xp) as [SkillId, number][]).map(([k, v]) => `<div>${skillIcon(k)} ${skillName(k)} +${fmt(v)} xp</div>`).join('');
    if (Math.abs(r.coins) < 1 && !xp) return;
    this.modal(`<h2>While you were away</h2><p class="muted">${h ? `${h}h ` : ''}${m}m of hauling</p>
      <p class="${r.coins >= 0 ? 'gold' : 'bad'}" style="font-size:26px">${r.coins >= 0 ? '+' : ''}${fmt(r.coins)} gp</p>${xp}
      <div style="margin-top:10px"><button data-m="ok">Lovely</button></div>`);
  }

  onVisibility() {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      save(this.game.s);
    } else if (this.hiddenAt) {
      const away = Math.min(OFFLINE_CAP_SECONDS, (Date.now() - this.hiddenAt) / 1000);
      this.hiddenAt = null;
      this.last = performance.now();
      if (away > 5) this.offline(away);
    }
  }

  // ---------------- input ----------------
  bindInput() {
    const cv = this.r.canvas;
    const pts = new Map<number, { x: number; y: number }>();
    let gesture: 'none' | 'maybe' | 'pan' | 'draw' | 'pinch' = 'none';
    let start = { x: 0, y: 0, t: 0 };
    let lastTile = -1;
    let pinch = { d: 0, cx: 0, cy: 0 };
    let drawTiles: number[] = [];

    const tileIdx = (sx: number, sy: number) => {
      const t = this.r.screenToTile(sx, sy);
      return this.game.inBounds(t.x, t.y) ? this.game.idx(t.x, t.y) : -1;
    };
    const addLine = (from: number, to: number) => {
      // 4-connected line between tiles so fast swipes don't leave gaps
      const w = this.game.s.w;
      let x = from % w, y = (from / w) | 0;
      const tx = to % w, ty = (to / w) | 0;
      while (x !== tx || y !== ty) {
        if (Math.abs(tx - x) >= Math.abs(ty - y)) x += Math.sign(tx - x);
        else y += Math.sign(ty - y);
        const t = y * w + x;
        if (drawTiles[drawTiles.length - 1] !== t) drawTiles.push(t);
      }
    };
    const updatePreview = () => {
      if (this.tool === 'clear') { this.preview = { tiles: drawTiles, ok: false }; return; }
      const mode = this.tool as 'road' | 'rail';
      const okTiles = drawTiles.filter((t) => this.game.canBuildInfra(t));
      const cost = this.game.infraCost(okTiles, mode);
      this.preview = { tiles: drawTiles, ok: okTiles.length === drawTiles.length && this.game.canAfford(cost) };
      $('#hint').textContent = `${drawTiles.length} tiles · ${fmt(cost)} gp${okTiles.length < drawTiles.length ? ' · some tiles blocked' : ''}`;
    };

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        start = { x: e.clientX, y: e.clientY, t: performance.now() };
        gesture = 'maybe';
        if (this.tool === 'station') {
          const t = this.r.screenToTile(e.clientX, e.clientY);
          this.catchPreview = { x: t.x, y: t.y, r: STATIONS[this.stationMode].radius };
        }
        if (this.tool === 'road' || this.tool === 'rail' || this.tool === 'clear') {
          const t = tileIdx(e.clientX, e.clientY);
          if (t >= 0) { drawTiles = [t]; lastTile = t; }
        }
      } else if (pts.size === 2) {
        // second finger: switch to pinch/pan, cancel any drawing
        gesture = 'pinch';
        drawTiles = [];
        this.preview = null;
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
        const before = this.r.screenToWorld(cx, cy);
        this.r.cam.zoom *= d / (pinch.d || d);
        this.r.clampCam();
        const after = this.r.screenToWorld(cx, cy);
        this.r.cam.x += before.x - after.x - (cx - pinch.cx) / this.r.cam.zoom;
        this.r.cam.y += before.y - after.y - (cy - pinch.cy) / this.r.cam.zoom;
        this.r.clampCam();
        pinch = { d, cx, cy };
        return;
      }
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      const drawTool = this.tool === 'road' || this.tool === 'rail' || this.tool === 'clear';
      if (gesture === 'maybe' && moved > 8) gesture = drawTool && drawTiles.length ? 'draw' : 'pan';
      if (gesture === 'pan') {
        this.r.cam.x -= (e.clientX - prev.x) / this.r.cam.zoom;
        this.r.cam.y -= (e.clientY - prev.y) / this.r.cam.zoom;
        this.r.clampCam();
        if (this.tool === 'station') this.catchPreview = null;
      } else if (gesture === 'draw') {
        const t = tileIdx(e.clientX, e.clientY);
        if (t >= 0 && t !== lastTile) {
          addLine(lastTile, t);
          lastTile = t;
          updatePreview();
        }
      }
    });

    const end = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (gesture === 'pinch') {
        if (pts.size === 0) gesture = 'none';
        return;
      }
      if (pts.size > 0) return;
      const quick = performance.now() - start.t < 600;
      if (gesture === 'maybe' && quick && e.type === 'pointerup') this.tap(e.clientX, e.clientY);
      else if (gesture === 'draw' && e.type === 'pointerup') this.commitDraw(drawTiles);
      gesture = 'none';
      drawTiles = [];
      this.preview = null;
      this.catchPreview = null;
      if (this.tool !== 'vehicle') this.renderHint();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.r.screenToWorld(e.clientX, e.clientY);
      this.r.cam.zoom *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.r.clampCam();
      const after = this.r.screenToWorld(e.clientX, e.clientY);
      this.r.cam.x += before.x - after.x;
      this.r.cam.y += before.y - after.y;
      this.r.clampCam();
    }, { passive: false });
  }

  commitDraw(tiles: number[]) {
    const g = this.game;
    if (!tiles.length) return;
    if (this.tool === 'clear') {
      for (const t of tiles) if (!g.stationAt(t % g.s.w, (t / g.s.w) | 0)) g.bulldoze(t % g.s.w, (t / g.s.w) | 0);
      return;
    }
    const mode = this.tool as 'road' | 'rail';
    const err = g.buildInfra(tiles, mode);
    if (err) this.say(err, '#a00000');
  }

  tap(sx: number, sy: number) {
    const g = this.game;
    const t = this.r.screenToTile(sx, sy);
    if (!g.inBounds(t.x, t.y)) return;
    const w = this.r.screenToWorld(sx, sy);
    if (this.tool === 'look') {
      // vehicles first (generous radius for fingers)
      let best: Vehicle | null = null, bd = 0.9;
      for (const v of g.s.vehicles) {
        const d = VEHICLES[v.type];
        const p = vehiclePos(g.s.w, v, d.mode);
        const dist = Math.hypot(p.x - w.x / TILE, p.y - (d.mode === 'air' ? -0.5 : 0) - w.y / TILE);
        if (dist < bd) { bd = dist; best = v; }
      }
      if (best) return this.open({ kind: 'vehicle', id: best.id });
      const st = g.stationAt(t.x, t.y);
      if (st) return this.open({ kind: 'station', id: st.id });
      const b = g.buildingAt(t.x, t.y);
      if (b) return this.open({ kind: 'building', id: b.id });
      return this.close();
    }
    if (this.tool === 'road' || this.tool === 'rail') return this.commitDraw([g.idx(t.x, t.y)]);
    if (this.tool === 'clear') {
      const err = g.bulldoze(t.x, t.y);
      if (err) this.say(err);
      return;
    }
    if (this.tool === 'station') {
      const err = g.placeStation(t.x, t.y, this.stationMode);
      if (err) return this.say(err, '#a00000');
      const st = g.stationAt(t.x, t.y)!;
      const cat = g.catchmentOf(st);
      this.say(cat.length ? `Built ${st.name}. Serves: ${cat.map((b) => b.name || BUILDINGS[b.kind].name).join(', ')}.` : `Built ${st.name}. Nothing in range yet.`);
      return;
    }
    if (this.tool === 'vehicle') {
      const st = g.stationAt(t.x, t.y);
      if (!st) return this.say('Tap a stop or station.');
      const def = VEHICLES[this.vehicleType];
      if (st.mode !== def.mode) return this.say(`A ${def.name} needs a ${STATIONS[def.mode].name.toLowerCase()}.`, '#a00000');
      if (this.routeFirst == null) {
        this.routeFirst = st.id;
        this.renderHint();
        return;
      }
      const a = g.station(this.routeFirst);
      this.routeFirst = null;
      if (!a) return this.renderHint();
      const err = g.buyVehicle(this.vehicleType, a, st);
      if (err) this.say(err, '#a00000');
      else this.say(`Your ${def.name} sets off from ${a.name}.`);
      this.renderHint();
    }
  }

  // ---------------- loop ----------------
  frame(now: number) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    g.tick(dt * this.speed);

    for (const e of g.events) {
      if (e.t === 'xp') this.pendingXp[e.skill] = (this.pendingXp[e.skill] ?? 0) + e.amount;
      else if (e.t === 'level') this.levelUp(e.skill, e.level);
      else if (e.t === 'chat') this.say(e.text, e.color);
      else if (e.t === 'coins') this.floats.push({ x: (e.x + 0.5) * TILE, y: e.y * TILE, text: `+${e.amount}`, color: '#ffd84a', t: 0 });
    }
    g.events.length = 0;
    if (now - this.lastXpFlush > 1500) {
      this.lastXpFlush = now;
      const drops = (Object.entries(this.pendingXp) as [SkillId, number][]).filter(([, v]) => v >= 1);
      if (drops.length) this.xpDrop(drops);
      this.pendingXp = {};
    }
    for (const t of checkTasks(g)) {
      this.say(`Task complete: ${t.title}! +${fmt(t.reward)} gp`, '#006000');
      this.renderTask();
    }
    for (const f of this.floats) f.t += dt;
    this.floats = this.floats.filter((f) => f.t < 1.6);

    // HUD
    const coins = $('#coins');
    coins.textContent = `🪙 ${fmt(g.s.coins)}`;
    coins.classList.toggle('neg', g.s.coins < 0);
    if (!this.incomeSamples.length || now - this.incomeSamples[this.incomeSamples.length - 1].t > 5000) {
      this.incomeSamples.push({ t: now, earned: g.s.stats.earned });
      if (this.incomeSamples.length > 13) this.incomeSamples.shift();
      const a = this.incomeSamples[0], b = this.incomeSamples[this.incomeSamples.length - 1];
      const perMin = b.t > a.t ? ((b.earned - a.earned) / (b.t - a.t)) * 60000 : 0;
      $('#rate').textContent = `${fmt(perMin)} gp/min${this.speed > 1 ? ` · ${this.speed}x` : ''}`;
    }
    if (this.sel && now - this.sheetRefresh > 1000 && ['station', 'vehicle', 'building'].includes(this.sel.kind)) {
      this.sheetRefresh = now;
      this.renderSheet();
    }

    const ov: Overlay = {
      preview: this.preview,
      catchment: this.catchPreview,
      selectedStation: this.sel?.kind === 'station' ? this.sel.id! : this.routeFirst,
      selectedBuilding: this.sel?.kind === 'building' ? this.sel.id! : null,
      selectedVehicle: this.sel?.kind === 'vehicle' ? this.sel.id! : null,
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
