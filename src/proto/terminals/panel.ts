// The "Terminals" panel of the industries demo: for the selected site, each mode's ladder of
// tiers with prices and reasons, buy, refit and remove to see the models change, and a readout
// of what the site makes against what its terminals can move, with a stand-in economy (a review
// every 30 days) so the unlock and idle rules can be watched working.
import * as THREE from 'three';
import { INDUSTRY_TYPES, type IndustryId } from '../industries/catalogue';
import type { IndustryFx, FxHandle } from '../industries/fx';
import type { IndustryModel } from '../industries/models';
import { toLocal, toWorld } from '../industries/site';
import type { IndustryVisualState } from '../industries/state';
import { FITS, LADDER, MODE_NAME, MODES, TIERS, type FitId, type Mode, type TierId } from './catalogue';
import { roomCheck, waterBehind, waterline, bounds } from './layout';
import { buildTerminals, fxModel, type TerminalsModel } from './models';
import {
  apply, estimateFlows, report, review, shownFor, specFor, startingTerminals, terminalFor, tick,
  type Offer, type Purchase, type SiteCapacity, type SiteContext, type SiteTerminals, type TerminalEvent,
} from './rules';

export interface PanelHost {
  scene: THREE.Scene;
  fx: IndustryFx;
  site(): { key: string; id: IndustryId; model: IndustryModel; handle: FxHandle };
  rebuildSite(bare: boolean): void; // rebuild the focused site, bare while the panel is open
  setVisual(patch: Partial<IndustryVisualState>): void; // the focused site's visual state
  fit(box: { x0: number; x1: number; z0: number; z1: number }): void; // frame the camera on a world box
  year(): number;
  el(id: string): HTMLElement;
}

interface SiteSim {
  st: SiteTerminals;
  level: number;
  fill: number;
  day: number;
  spent: number;
  upkeep: number;
  rail: boolean;
  water: boolean;
  crowded: boolean; // the land either side of the site belongs to someone else
  service: number;
  log: string[];
  note: string; // a reason shown after tapping something that can't be bought
}

const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const t_h = (n: number) => `${Math.round(n).toLocaleString('en-GB')} t/h`;

export class TerminalsPanel {
  on = false;
  instant = true;
  private sims = new Map<string, SiteSim>();
  private mesh: TerminalsModel | null = null;
  private handle: FxHandle | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private timer = 0;
  private readonly waterMat = new THREE.MeshLambertMaterial({ color: '#3d6c89' });

  constructor(private h: PanelHost) {}

  private sim(): SiteSim {
    const s = this.h.site();
    let x = this.sims.get(s.key);
    if (!x) {
      const t = INDUSTRY_TYPES[s.id];
      x = { st: startingTerminals(s.id), level: 1, fill: 0.5, day: 0, spent: 0, upkeep: 0, rail: true, water: t.waterside === 'required', crowded: false, service: 1, log: [], note: '' };
      this.sims.set(s.key, x);
    }
    return x;
  }
  private spec() { const s = this.h.site(); return specFor(INDUSTRY_TYPES[s.id], s.model.variant); }
  private ctx(x = this.sim()): SiteContext {
    const m = this.h.site().model, B = bounds(m);
    // with neighbours either side, only land behind the site (or out over the water) is free
    const beside = (poly: { x: number; z: number }[]) => { const L = poly.map((p) => toLocal(m.frame, p)); return L.every((p) => p[0] >= B.x1 - 0.5) || L.every((p) => p[0] <= B.x0 + 0.5); };
    const landFree = x.crowded ? (poly: { x: number; z: number }[]) => !beside(poly) : undefined;
    return { year: this.h.year(), day: x.day, rail: x.rail, water: x.water, room: roomCheck(m, shownFor(x.st), { water: x.water }, landFree) };
  }

  toggle(on: boolean) {
    this.on = on;
    if (!on) this.auto(false);
    this.h.el('tpanel').style.display = on ? '' : 'none';
    for (const el of document.querySelectorAll<HTMLElement>('.sliders')) el.style.display = on ? 'none' : '';
    this.h.rebuildSite(on);
    this.refresh(true);
  }

  // The site was rebuilt or the focus moved: redraw the terminals for it.
  refresh(frame = false) {
    this.clearModels();
    if (!this.on) return;
    const x = this.sim(), s = this.h.site();
    const water = waterBehind(s.model, { water: x.water });
    this.mesh = buildTerminals(s.model, shownFor(x.st), { water: x.water, year: this.h.year() });
    this.h.scene.add(this.mesh.group);
    this.handle = this.h.fx.add(fxModel(s.model, this.mesh), s.handle.state);
    if (water) this.addWater(s.model);
    if (frame) this.frame();
    this.visual();
    this.render();
  }

  private clearModels() {
    if (this.mesh) { this.h.scene.remove(this.mesh.group); (this.mesh.group.children[0] as THREE.Mesh).geometry.dispose(); this.mesh = null; }
    if (this.handle) { this.h.fx.remove(this.handle); this.handle = null; }
    if (this.waterMesh) { this.h.scene.remove(this.waterMesh); this.waterMesh.geometry.dispose(); this.waterMesh = null; }
  }

  // The world's water behind a waterside site: a stand-in until the map has real coastlines.
  private addWater(m: IndustryModel) {
    const B = bounds(m), wl = waterline(m), w = B.x1 - B.x0 + 240, d = 75; // short of the gallery row behind
    const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    this.waterMesh = new THREE.Mesh(g, this.waterMat);
    const c = toWorld(m.frame, (B.x0 + B.x1) / 2, wl - d / 2);
    this.waterMesh.position.set(c.x, 0.035, c.z);
    this.waterMesh.rotation.y = -m.frame.rot;
    this.waterMesh.receiveShadow = true;
    this.h.scene.add(this.waterMesh);
  }

  private frame() {
    const m = this.h.site().model, B = bounds(m);
    let box = { ...B };
    for (const p of this.mesh?.placements ?? []) {
      const q = p.over ? { x0: Math.min(p.pad.x0, p.over.x0), x1: Math.max(p.pad.x1, p.over.x1), z0: Math.min(p.pad.z0, p.over.z0), z1: Math.max(p.pad.z1, p.over.z1) } : p.pad;
      box = { x0: Math.min(box.x0, q.x0), x1: Math.max(box.x1, q.x1), z0: Math.min(box.z0, q.z0), z1: Math.max(box.z1, q.z1) };
    }
    const corners = [[box.x0, box.z0], [box.x1, box.z0], [box.x1, box.z1], [box.x0, box.z1]].map(([x, z]) => toWorld(m.frame, x, z));
    this.h.fit({ x0: Math.min(...corners.map((p) => p.x)), x1: Math.max(...corners.map((p) => p.x)), z0: Math.min(...corners.map((p) => p.z)), z1: Math.max(...corners.map((p) => p.z)) });
  }

  // Drive the site's own look from the stand-in economy: level, how full the stockyard is, and
  // vehicles at the berths while anything calls.
  private visual() {
    const x = this.sim(), open = x.st.terminals.some((t) => t.status === 'open');
    const patch: Partial<IndustryVisualState> = { production: x.level, output: x.fill, input: 0.3 + 0.5 * x.service, recentlyDelivered: open && x.service > 0, running: true };
    this.h.setVisual(patch);
    if (this.handle) this.h.fx.setState(this.handle, { ...this.h.site().handle.state });
  }

  // ---------------- actions ----------------
  private events(ev: TerminalEvent[]) { const x = this.sim(); for (const e of ev) x.log.unshift(`Day ${x.day}: ${e.text}`); x.log.length = Math.min(x.log.length, 4); }

  do(p: Purchase) {
    const x = this.sim(), r = apply(this.spec(), x.st, this.ctx(), p);
    if (!r.ok) { x.note = r.reason; this.render(); return false; }
    x.st = r.st; x.spent += r.cost; x.note = '';
    this.events(r.events);
    if (this.instant) {
      const done = tick(this.spec(), x.st, 0, {}, x.day + 10000); // finish building now, without ageing anything
      x.st = done.st;
      this.events(done.events);
    }
    this.refresh();
    return true;
  }

  // One review period: 30 days of upkeep and idle ageing, then the 2D-style production review.
  step(days = 30, idle = false) {
    const x = this.sim(), spec = this.spec();
    x.day += days;
    const served: Partial<Record<Mode, boolean>> = {};
    if (!idle && x.service > 0) for (const t of x.st.terminals) served[t.mode] = true;
    const tk = tick(spec, x.st, days, served, x.day);
    x.st = tk.st; x.upkeep = tk.upkeep / days; x.spent += tk.upkeep;
    this.events(tk.events);
    if (!idle) {
      const flows = estimateFlows(spec, x.st, x.level, { lift: x.service, supply: x.service, stockFill: x.fill, hours: days * 24 });
      const rv = review(spec, x.st, this.ctx(x), x.level, flows);
      x.level = rv.level; x.fill = flows.stockFill; x.st = rv.st;
      this.events(rv.events);
    }
    x.note = '';
    const changed = tk.events.some((e) => e.kind !== 'idle');
    if (changed) this.refresh(); else { this.visual(); this.render(); }
  }

  auto(on: boolean) {
    clearInterval(this.timer);
    this.timer = on ? window.setInterval(() => this.step(), 700) : 0;
  }

  set(patch: Partial<Pick<SiteSim, 'rail' | 'water' | 'crowded' | 'service' | 'level' | 'fill'>>) {
    const x = this.sim();
    const rebuild = patch.water !== undefined && patch.water !== x.water;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (x as unknown as Record<string, unknown>)[k] = v;
    if (rebuild) this.refresh(true); else { this.visual(); this.render(); }
  }

  state() { const x = this.sim(); return { ...x, report: report(this.spec(), x.st, this.ctx(x), x.level), tris: this.mesh?.tris ?? 0, detail: this.mesh?.detail ?? '' }; }

  // ---------------- drawing the panel ----------------
  render() {
    if (!this.on) return;
    const x = this.sim(), spec = this.spec(), ctx = this.ctx(x);
    const flows = estimateFlows(spec, x.st, x.level, { lift: x.service, supply: x.service, stockFill: x.fill });
    const rep = report(spec, x.st, ctx, x.level, flows);
    const cap = rep.capacity, prod = rep.production;
    // the berths load and unload, so a processor's readout is its traffic both ways
    const makes = prod.out > 0, need = prod.out + prod.in, can = cap.load + cap.unload, both = makes && prod.in > 0;
    // the bar runs to what the site would handle at level 4: production fills it, the green mark is
    // what the terminals can move (pinned at the end when that's enough for level 4)
    const scale = Math.max(need, (need / Math.max(0.01, x.level)) * 4) || 1;
    const el = this.h.el('tpanel');
    const pills = [
      flows.stockFill >= 0.9 ? '<span class="pill warn">stockpiling</span>' : '',
      Object.entries(flows.queue ?? {}).some(([, v]) => (v ?? 0) >= 0.5) ? '<span class="pill warn">queueing</span>' : '',
      cap.levelCap < Math.min(4, x.level * 1.12) - 1e-6 ? '<span class="pill">capped</span>' : '',
    ].join('');
    const levelTxt = `Level ${x.level.toFixed(2)} of 4 · ${makes ? `makes ${t_h(prod.out)}` : `takes ${t_h(prod.in)}`}${makes && prod.in > 0 ? `, takes ${t_h(prod.in)}` : ''}`;
    const enough = cap.levelCap >= 4 ? 'enough for level 4' : `enough for level ${cap.levelCap.toFixed(2)}`;
    const capTxt = cap.levelCap > 0 ? `terminals ${both ? 'handle' : 'move'} ${t_h(can)}${both ? ' in and out' : ''}: ${enough}` : x.st.terminals.length ? 'no terminal open' : 'no terminal yet';
    const rows = MODES.map((mode) => this.modeRow(mode, rep.offers.filter((o) => o.mode === mode), x, cap)).join('');
    el.innerHTML = `
      <div class="thead"><b>${levelTxt}</b><span>${capTxt}</span></div>
      <div class="bar" title="production against what the terminals can move"><i style="width:${Math.min(100, (need / scale) * 100)}%"></i><b style="left:${Math.min(100, (can / scale) * 100)}%"></b></div>
      <div class="tline">${pills}<span class="money">Day ${x.day} · ${money(x.spent)} spent · ${money(x.upkeep)}/day</span></div>
      <div class="suggest">${x.note ? `⚠ ${x.note}` : rep.suggestion ? `💡 ${rep.suggestion.text}` : '✓ The terminals keep up'}</div>
      ${rows}
      <div class="row tog">
        <button data-a="review">Review ▶</button><button data-a="auto" class="${this.timer ? 'on' : ''}">Auto</button><button data-a="idle">Idle 30 days</button>
      </div>
      <div class="row tog">
        <button data-a="rail" class="${x.rail ? 'on' : ''}">Rail line</button><button data-a="crowd" class="${x.crowded ? 'on' : ''}">Neighbours</button>
        ${INDUSTRY_TYPES[this.h.site().id].waterside === 'optional' ? `<button data-a="water" class="${x.water ? 'on' : ''}">Waterside</button>` : ''}
      </div>
      <div class="row"><label>Service</label><input data-a="service" type="range" min="0" max="1" step="0.05" value="${x.service}" /><output>${Math.round(x.service * 100)}%</output></div>
      <div class="log">${x.log.map((l) => `<div>${l}</div>`).join('')}</div>
      <small class="tstats">${this.mesh ? `${this.mesh.tris.toLocaleString('en-GB')} terminal triangles${this.mesh.detail ? ` · ${this.mesh.detail}` : ''}` : ''}</small>`;
    this.bind(el);
  }

  private modeRow(mode: Mode, offs: Offer[], x: SiteSim, cap: SiteCapacity) {
    const M = MODE_NAME[mode];
    if (offs.every((o) => o.status === 'not_offered')) return `<div class="tmode off"><span class="g">${M.glyph}</span><div class="info"><b>${M.name}</b><small>${offs[0].reason}</small></div></div>`;
    const cur = terminalFor(x.st, mode);
    const c = cap.byMode[mode];
    const head = cur
      ? `<b>${M.name} · ${TIERS[cur.pending?.tier ?? cur.tier].name}</b><small>${FITS[cur.pending?.fit ?? cur.fit].name} · ${cur.status === 'open' ? `${t_h(c?.tph ?? 0)} · ${TIERS[cur.tier].berths} ${TIERS[cur.tier].berths > 1 ? M.vehicles : M.vehicle} at once · stock ${TIERS[cur.tier].stock.toLocaleString('en-GB')} t` : cur.status}${cur.idle >= 1 ? ` · idle ${Math.floor(cur.idle)} d` : ''}</small>`
      : `<b>${M.name}</b><small>No terminal</small>`;
    const chips = offs.map((o) => {
      const short: Record<string, string> = { era: o.reason.toLowerCase(), grade: '🔒', rail: 'no rail line', road: 'no road', room: 'no room', busy: 'wait', superseded: '·' };
      const lab = o.status === 'owned' ? '✓' : o.status === 'building' ? '⏳' : o.status === 'available' ? money(o.cost) : short[o.block ?? 'grade'] ?? '🔒';
      return `<button class="chip ${o.status}" data-a="buy" data-m="${mode}" data-t="${o.tier}" title="${o.reason}">${TIERS[o.tier].name}<i>${lab}</i></button>`;
    }).join('');
    const acts = cur ? [
      TIERS[cur.pending?.tier ?? cur.tier].fits.length > 1 ? `<button data-a="fit" data-m="${mode}">Fit ▸</button>` : '',
      cur.status === 'mothballed' ? `<button data-a="reopen" data-m="${mode}">Reopen</button>` : '',
      cur.builtIn ? '' : `<button data-a="rm" data-m="${mode}">✕</button>`,
    ].join('') : '';
    return `<div class="tmode"><span class="g">${M.glyph}</span><div class="info">${head}</div>${acts}</div><div class="chips">${chips}</div>`;
  }

  private bind(el: HTMLElement) {
    el.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => {
      const a = b.dataset.a!, mode = b.dataset.m as Mode | undefined;
      if (a === 'service') { b.addEventListener('input', () => { const v = Number((b as HTMLInputElement).value); (b.nextElementSibling as HTMLElement).textContent = `${Math.round(v * 100)}%`; this.sim().service = v; }); b.addEventListener('change', () => this.set({})); return; }
      b.addEventListener('click', () => {
        if (a === 'review') this.step();
        else if (a === 'auto') { this.auto(!this.timer); this.render(); }
        else if (a === 'idle') this.step(30, true);
        else if (a === 'rail') this.set({ rail: !this.sim().rail });
        else if (a === 'crowd') this.set({ crowded: !this.sim().crowded });
        else if (a === 'water') this.set({ water: !this.sim().water });
        else if (a === 'rm' && mode) this.do({ kind: 'remove', mode });
        else if (a === 'reopen' && mode) this.do({ kind: 'reopen', mode });
        else if (a === 'fit' && mode) this.cycleFit(mode);
        else if (a === 'buy' && mode) this.buy(mode, b.dataset.t as TierId);
      });
    });
  }

  buy(mode: Mode, tier: TierId, fit?: FitId) {
    const x = this.sim(), o = report(this.spec(), x.st, this.ctx(x), x.level).offers.find((q) => q.mode === mode && q.tier === tier)!;
    if (o.status === 'owned' || o.status === 'building') { x.note = o.reason; this.render(); return false; }
    return this.do({ kind: 'build', mode, tier, fit });
  }

  cycleFit(mode: Mode) {
    const x = this.sim(), cur = terminalFor(x.st, mode);
    if (!cur) return;
    const tier = cur.pending?.tier ?? cur.tier, fits = TIERS[tier].fits.filter((f) => FITS[f].era[0] <= this.h.year());
    const next = fits[(fits.indexOf(cur.pending?.fit ?? cur.fit) + 1) % fits.length];
    this.do({ kind: 'refit', mode, fit: next });
  }

  // Set up a site's terminals directly (for screenshots): "road:lorry_depot:conveyor,rail:sidings".
  // The grade rises only as far as the tiers placed, so the next unlock can still be watched.
  preset(spec: string) {
    const x = this.sim();
    for (const part of spec.split(',').filter(Boolean)) {
      const [mode, tier, fit] = part.split(':') as [Mode, TierId, FitId | undefined];
      if (!LADDER[mode]?.includes(tier)) continue;
      const cur = terminalFor(x.st, mode);
      x.st = {
        grade: Math.max(x.st.grade, TIERS[tier].rank) as SiteTerminals['grade'],
        terminals: [...x.st.terminals.filter((t) => t !== cur), { mode, tier, fit: fit ?? 'standard', status: 'open', ready: 0, idle: 0, builtIn: cur?.builtIn && cur.tier === tier }],
      };
    }
    this.refresh(true);
  }
}
