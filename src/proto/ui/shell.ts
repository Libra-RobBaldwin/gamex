// The one UI shell (see docs/hud.md). It owns every piece of chrome over the map: the status
// strip and its stats drawer, the compass, the bottom bar (Build · Transport · Layers · Menu), the
// bottom sheets, the tool strip that replaces the bar while drawing, the layers pop-over and the
// menu. Game systems don't add their own markup: they register build items, transport tabs,
// layers and menu items, open sheets and start tools through the API below.
//
// It does no work per frame. The game writes its readouts straight into the drawer's elements
// (#st-clock and friends) a few times a second, and layout is only measured when something changes
// size (a ResizeObserver) or when the game asks where the clear map is.
import { icon, type Icon } from './icons';
import { NAME, markSvg, needleSvg } from './brand';

export type Tone = 'road' | 'rail' | 'stop' | 'look';
export type BarKey = 'build' | 'transport' | 'layers' | 'menu';

/** A button in a sheet's action row or the tool strip. */
export interface Action { label: string; icon?: Icon; kind?: 'primary' | 'danger'; disabled?: boolean; title?: string; onClick: () => void }
export interface SheetTab { id: string; label: string; icon?: Icon; disabled?: string }
export interface SheetSpec {
  /** What the sheet is. Re-opening the same key re-renders in place and keeps the scroll position. */
  key: string;
  title: string;
  sub?: string;
  icon?: Icon;
  tone?: Tone;
  /** Tabs under the title; `tab` is the selected one and `onTab` is called with the tapped one. */
  tabs?: SheetTab[];
  tab?: string;
  onTab?: (id: string) => void;
  /** HTML for the body. Wire it up through the element openSheet returns. */
  body: string;
  actions?: Action[];
  /** Shows a back arrow before the title. */
  back?: () => void;
  /** Called once, when this sheet closes or a sheet with another key replaces it. */
  onClose?: () => void;
  /** Start at the top even if the key is the same. */
  fresh?: boolean;
  /** Which bar button it belongs to (lit while it is open). */
  from?: BarKey;
}
export interface BuildCategory { id: string; label: string; icon: Icon; disabled?: string; note?: string }
export interface BuildItem {
  id: string;
  label: string;
  spec?: string;
  icon?: Icon;
  tone?: Tone;
  /** Shown disabled, with this reason. */
  locked?: string;
  /** Marks the card as the current choice. */
  on?: () => boolean;
  /** Called after the sheet has closed (usually to start a tool). Return false to keep it open. */
  onPick?: () => void | false;
}
export interface ToolSpec {
  name: string;
  spec?: string;
  icon?: Icon;
  tone?: Tone;
  /** HTML for the options row (height, grade, crossing...). Wire it up in `bind`. */
  options?: string;
  bind?: (el: HTMLElement) => void;
  /** Undo is shown when given; enable it with setUndo. */
  onUndo?: () => void;
  onDone?: () => void;
  onCancel?: () => void;
}
export interface ToolHandle {
  readonly el: HTMLElement;
  /** Change the name, spec, icon or options (options are re-bound). */
  set(p: Partial<Pick<ToolSpec, 'name' | 'spec' | 'icon' | 'tone' | 'options'>>): void;
  setUndo(enabled: boolean): void;
  /** Replace the Done button (e.g. with Build while a blueprint waits); null puts Done back. */
  setPrimary(a: Action | null): void;
  /** A card above the strip, for the blueprint and its warnings; null hides it. */
  setPanel(html: string | null, bind?: (el: HTMLElement) => void): void;
  /** Leave the tool without calling onDone or onCancel. */
  end(): void;
}
export interface Layer { id: string; label: string; icon: Icon; disabled?: string; on?: boolean; onToggle?: (on: boolean) => void }
export interface ViewPicker { options: { id: string; label: string }[]; current: () => string; pick: (id: string) => void }
export interface MenuItem { id: string; label: string; sub?: string | (() => string); icon: Icon; disabled?: string; onClick: () => void }
export interface TransportTab { id: string; label: string; icon: Icon; sub?: string; render: (el: HTMLElement) => void }
export interface Info {
  key?: string;
  title: string;
  sub?: string;
  icon?: Icon;
  tone?: Tone;
  facts?: [string, string][];
  /** 0..1, drawn as a bar under the facts */
  meter?: number;
  note?: string;
  html?: string;
  actions?: Action[];
  onClose?: () => void;
}
export interface ShellOptions {
  onCompass: () => void;
  onPause: () => void;
  onRate: () => void;
  onPerf: () => void;
}
export interface Rect { left: number; top: number; right: number; bottom: number }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const html = (el: Element, s: string) => { el.innerHTML = s; };
const said = (ic: Icon, words: string) => `${icon(ic)}<span class="vh">${words}</span>`;
function actionHtml(a: Action, i: number, prefix: string) {
  const cls = ['act', a.kind ?? ''].join(' ').trim();
  return `<button class="${cls}" data-${prefix}="${i}" ${a.disabled ? 'disabled' : ''} ${a.title ? `title="${esc(a.title)}" aria-label="${esc(a.title)}"` : ''}>${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`;
}

export class Shell {
  readonly root: HTMLElement;
  private cats: BuildCategory[] = [];
  private items = new Map<string, BuildItem[]>();
  private buildCat = '';
  private ttabs: TransportTab[] = [];
  private ttab = '';
  private layers: Layer[] = [];
  private views: ViewPicker | null = null;
  private menu: MenuItem[] = [];
  private sheet: SheetSpec | null = null;
  private tool: (ToolSpec & { primary: Action | null; undo: boolean }) | null = null;
  private hintTimer = 0;
  private firstRunKey = '';
  private viewShown = '';

  constructor(root: HTMLElement, opts: ShellOptions) {
    this.root = root;
    html(root, `
      <div id="hud-top">
        <header id="status" class="facet">
          <span class="mk">${markSvg()}<span class="vh">${NAME}</span></span>
          <button id="clockbtn" aria-expanded="false" aria-controls="drawer" title="Town at a glance">
            <b id="st-clock">07:00</b><em id="st-rush"></em><span id="money" class="money"></span><span class="chev">${icon('chevronDown')}</span>
          </button>
          <button id="sp-pause" aria-pressed="false" aria-label="Pause" title="Pause">${icon('pause')}</button>
          <button id="sp-rate" aria-label="Game speed 1×, tap for faster" title="Game speed">1×</button>
        </header>
        <div id="drawer" class="facet" hidden>
          <div class="sts">
            <span class="st">${said('users', 'population')}<b id="st-pop">0</b> people</span>
            <span class="st">${said('car', 'cars')}<b id="st-cars">0</b> cars</span>
            <span class="st">${said('bus', 'buses')}<b id="st-buses">0</b> buses</span>
            <span class="st">${said('train', 'trains')}<b id="st-trains">0</b> trains</span>
          </div>
          <button id="perfbtn" aria-expanded="false" aria-controls="perf">${icon('activity')}<span>Performance</span></button>
          <div id="perf" role="status" hidden><span id="perf-t">measuring…</span></div>
        </div>
        <button id="compass" aria-label="Face north" title="Face north"><span id="needle">${needleSvg()}</span></button>
        <div id="firstrun" role="status" hidden></div>
      </div>
      <div id="hint" role="status" aria-live="polite" hidden></div>
      <section id="sheet" class="sheet facet" role="dialog" hidden></section>
      <div id="layers" class="facet" role="dialog" aria-label="Map layers" hidden></div>
      <div id="tpanel" class="facet" hidden></div>
      <div id="tool" hidden></div>
      <nav id="bar" aria-label="Main">
        <button data-bar="build" aria-expanded="false">${icon('hammer')}<span>Build</span></button>
        <button data-bar="transport" aria-expanded="false">${icon('transport')}<span>Transport</span></button>
        <button data-bar="layers" aria-expanded="false">${icon('layers')}<span>Layers</span></button>
        <button data-bar="menu" aria-expanded="false">${icon('menu')}<span>Menu</span></button>
      </nav>`);
    this.$('#compass').addEventListener('click', () => opts.onCompass());
    this.$('#sp-pause').addEventListener('click', () => opts.onPause());
    this.$('#sp-rate').addEventListener('click', () => opts.onRate());
    this.$('#perfbtn').addEventListener('click', () => opts.onPerf());
    this.$('#clockbtn').addEventListener('click', () => this.toggleDrawer());
    this.root.querySelectorAll<HTMLButtonElement>('#bar button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.bar as BarKey;
      if (b.getAttribute('aria-expanded') === 'true') return k === 'layers' ? this.closeLayers() : this.closeSheet();
      if (k === 'build') this.openBuild();
      else if (k === 'transport') this.openTransport();
      else if (k === 'layers') this.openLayers();
      else this.openMenu();
    }));
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.$('#layers').hidden) this.closeLayers();
      else if (this.sheet) this.closeSheet();
    });
    const ro = new ResizeObserver(() => this.layout());
    for (const s of ['#bar', '#tool', '#tpanel', '#sheet', '#hud-top']) ro.observe(this.$(s));
    window.addEventListener('resize', () => this.layout());
  }

  private $<T extends HTMLElement = HTMLElement>(s: string) { return this.root.querySelector(s) as T; }

  // ---------------- status strip ----------------
  /** Reflect the game speed: 0 is paused, otherwise the rate the cycle button shows. */
  setSpeed(paused: boolean, rate: number) {
    const p = this.$('#sp-pause'), r = this.$('#sp-rate');
    p.setAttribute('aria-pressed', String(paused));
    p.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
    p.title = paused ? 'Resume' : 'Pause';
    html(p, icon(paused ? 'play' : 'pause'));
    r.textContent = `${rate}×`;
    r.setAttribute('aria-label', `Game speed ${rate}×, tap for ${rate === 4 ? '1×' : `${rate * 2}×`}`);
    r.classList.toggle('on', !paused);
    document.body.classList.toggle('paused', paused);
  }
  toggleDrawer(open = this.$('#drawer').hidden) {
    this.$('#drawer').hidden = !open;
    this.$('#clockbtn').setAttribute('aria-expanded', String(open));
  }
  setPerf(on: boolean) {
    this.$('#perf').hidden = !on;
    this.$('#perfbtn').setAttribute('aria-expanded', String(on));
    this.$('#perfbtn').classList.toggle('on', on);
    if (on) this.toggleDrawer(true);
  }
  /** Money, once the economy is wired; empty hides it. */
  setMoney(text: string) { this.$('#money').textContent = text; }

  // ---------------- hint and first run ----------------
  /** A line of help over the map. With `ms` it clears itself; without, it stays until replaced. */
  hint(content: string | null, ms = 0) {
    clearTimeout(this.hintTimer);
    const el = this.$('#hint');
    if (!content) { el.hidden = true; html(el, ''); return; }
    html(el, content);
    el.hidden = false;
    this.layout();
    if (ms) this.hintTimer = window.setTimeout(() => { el.hidden = true; }, ms);
  }
  /** A pill shown once ever (remembered on this device), until dismissFirstRun or 15 s after the first frame. */
  firstRun(key: string, text: string) {
    let seen = false;
    try { seen = localStorage.getItem(key) === '1'; } catch { /* storage blocked: show it this once */ }
    if (seen) return;
    this.firstRunKey = key;
    const el = this.$('#firstrun');
    html(el, `${icon('finger')}<span>${esc(text)}</span>`);
    el.hidden = false;
    requestAnimationFrame(() => window.setTimeout(() => { if (this.firstRunKey === key) this.dismissFirstRun(); }, 15000));
  }
  dismissFirstRun() {
    if (!this.firstRunKey) return;
    this.$('#firstrun').hidden = true;
    try { localStorage.setItem(this.firstRunKey, '1'); } catch { /* not remembered */ }
    this.firstRunKey = '';
  }

  // ---------------- sheets ----------------
  get sheetKey() { return this.sheet?.key ?? null; }
  openSheet(spec: SheetSpec): HTMLElement {
    this.dismissFirstRun();
    this.closeLayers();
    const was = this.sheet;
    if (was && was.key !== spec.key) { this.sheet = null; was.onClose?.(); }
    const el = this.$('#sheet');
    const body = el.querySelector('.sb');
    const keep = was && was.key === spec.key && !spec.fresh && body ? body.scrollTop : 0;
    this.sheet = spec;
    el.className = `sheet facet tone-${spec.tone ?? 'look'}`;
    el.setAttribute('aria-label', spec.title);
    html(el, `<header>
        ${spec.back ? `<button class="back" aria-label="Back" title="Back">${icon('arrowLeft')}</button>` : ''}
        ${spec.icon ? `<i class="badge">${icon(spec.icon)}</i>` : ''}
        <div class="ttl"><h2>${esc(spec.title)}</h2>${spec.sub ? `<span class="sub">${esc(spec.sub)}</span>` : ''}</div>
        <button class="close" aria-label="Close" title="Close">${icon('x')}</button>
      </header>
      ${spec.tabs ? `<div class="stabs" role="tablist">${spec.tabs.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === spec.tab}" ${t.disabled ? `disabled title="${esc(t.disabled)}"` : ''}>${t.icon ? icon(t.icon) : ''}<span>${esc(t.label)}</span></button>`).join('')}</div>` : ''}
      <div class="sb">${spec.body}${spec.actions?.length ? `<div class="acts">${spec.actions.map((a, i) => actionHtml(a, i, 'act')).join('')}</div>` : ''}</div>`);
    if (el.hidden) { el.classList.add('enter'); el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true }); }
    el.hidden = false;
    el.querySelector('.close')!.addEventListener('click', () => this.closeSheet());
    el.querySelector('.back')?.addEventListener('click', () => spec.back!());
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => spec.onTab?.(b.dataset.tab!)));
    el.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => spec.actions![+b.dataset.act!].onClick()));
    el.querySelector('.sb')!.scrollTop = keep;
    this.markBar(spec.from ?? null);
    this.layout();
    return el.querySelector('.sb') as HTMLElement;
  }
  closeSheet() {
    const was = this.sheet;
    if (!was) return;
    this.sheet = null;
    this.$('#sheet').hidden = true;
    html(this.$('#sheet'), '');
    this.markBar(null);
    this.layout();
    was.onClose?.();
  }
  /** An info sheet for something tapped on the map: title, facts, a note and actions. */
  openInfo(i: Info) {
    const facts = i.facts?.length ? `<dl class="facts">${i.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
    const meter = i.meter === undefined ? '' : `<div class="meter" aria-hidden="true"><i style="width:${Math.round(Math.min(1, Math.max(0, i.meter)) * 100)}%"></i></div>`;
    return this.openSheet({
      key: i.key ?? `info:${i.title}`, title: i.title, sub: i.sub, icon: i.icon ?? 'info', tone: i.tone, fresh: true,
      body: `${facts}${meter}${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}${i.html ?? ''}`,
      actions: i.actions, onClose: i.onClose,
    });
  }
  private markBar(k: BarKey | null) {
    this.root.querySelectorAll<HTMLButtonElement>('#bar button').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.bar === k)));
  }

  // ---------------- build ----------------
  addBuildCategory(c: BuildCategory) {
    const at = this.cats.findIndex((x) => x.id === c.id);
    if (at >= 0) this.cats[at] = c; else this.cats.push(c);
    if (!this.items.has(c.id)) this.items.set(c.id, []);
  }
  addBuildItem(cat: string, item: BuildItem) {
    if (!this.items.has(cat)) throw new Error(`no build category ${cat}`);
    const list = this.items.get(cat)!;
    const at = list.findIndex((x) => x.id === item.id);
    if (at >= 0) list[at] = item; else list.push(item);
  }
  openBuild(cat?: string) {
    const first = this.cats.find((c) => !c.disabled)?.id ?? '';
    this.buildCat = cat ?? (this.cats.some((c) => c.id === this.buildCat && !c.disabled) ? this.buildCat : first);
    const c = this.cats.find((x) => x.id === this.buildCat);
    const list = this.items.get(this.buildCat) ?? [];
    const body = this.openSheet({
      key: `build:${this.buildCat}`, title: 'Build', sub: 'Pick something, then draw it on the map', from: 'build',
      tabs: this.cats.map((x) => ({ id: x.id, label: x.label, icon: x.icon, disabled: x.disabled })), tab: this.buildCat,
      onTab: (id) => this.openBuild(id),
      body: `<div class="grid">${list.map((it, i) => `<button class="card${it.locked ? ' locked' : ''}${it.on?.() ? ' on' : ''} tone-${it.tone ?? 'look'}" data-item="${i}" ${it.locked ? 'aria-disabled="true"' : ''}>
          <b>${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span></b>${it.spec ? `<span>${esc(it.spec)}</span>` : ''}${it.locked ? `<span class="why">${esc(it.locked)}</span>` : ''}</button>`).join('')}</div>
        ${c?.note ? `<p class="note">${esc(c.note)}</p>` : ''}`,
    });
    body.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((b) => b.addEventListener('click', () => {
      const it = list[+b.dataset.item!];
      if (it.locked) { this.hint(`${icon('info')}<span>${esc(it.label)}: ${esc(it.locked)}</span>`, 3500); return; }
      const before = this.sheet;
      if (it.onPick?.() === false) return;
      if (this.sheet === before) this.closeSheet();
    }));
  }

  // ---------------- transport ----------------
  addTransportTab(t: TransportTab) {
    const at = this.ttabs.findIndex((x) => x.id === t.id);
    if (at >= 0) this.ttabs[at] = t; else this.ttabs.push(t);
  }
  openTransport(tab?: string) {
    this.ttab = tab ?? (this.ttabs.some((t) => t.id === this.ttab) ? this.ttab : this.ttabs[0]?.id ?? '');
    const t = this.ttabs.find((x) => x.id === this.ttab);
    const body = this.openSheet({
      key: `transport:${this.ttab}`, title: 'Transport', sub: t?.sub ?? 'Your lines and vehicles', from: 'transport',
      tabs: this.ttabs.map((x) => ({ id: x.id, label: x.label, icon: x.icon })), tab: this.ttab,
      onTab: (id) => this.openTransport(id), body: '',
    });
    t?.render(body);
  }
  /** Re-render whichever transport tab is showing (e.g. after a vehicle is added). */
  refreshTransport() { if (this.sheet?.key.startsWith('transport:')) this.openTransport(this.ttab); }

  // ---------------- layers ----------------
  addLayer(l: Layer) {
    const at = this.layers.findIndex((x) => x.id === l.id);
    if (at >= 0) this.layers[at] = l; else this.layers.push(l);
    if (!this.$('#layers').hidden) this.openLayers();
  }
  setViews(v: ViewPicker) { this.views = v; }
  openLayers() {
    this.dismissFirstRun();
    this.closeSheet();
    const el = this.$('#layers');
    const cur = this.views?.current() ?? '';
    html(el, `<h3>Overlays</h3>${this.layers.map((l, i) => `<button class="toggle" data-layer="${i}" aria-pressed="${!!l.on}" ${l.disabled ? 'disabled' : ''}>${icon(l.icon)}<span class="tl"><span>${esc(l.label)}</span>${l.disabled ? `<small>${esc(l.disabled)}</small>` : ''}</span><span class="dot"></span></button>`).join('')}
      ${this.views ? `<h3>View</h3><div class="seg" role="group" aria-label="View">${this.views.options.map((o) => `<button data-view="${o.id}" aria-pressed="${o.id === cur}">${esc(o.label)}</button>`).join('')}</div>` : ''}`);
    this.viewShown = cur;
    el.hidden = false;
    this.markBar('layers');
    el.querySelectorAll<HTMLButtonElement>('[data-layer]').forEach((b) => b.addEventListener('click', () => {
      const l = this.layers[+b.dataset.layer!];
      l.on = !l.on;
      b.setAttribute('aria-pressed', String(l.on));
      l.onToggle?.(l.on);
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => {
      this.views!.pick(b.dataset.view!);
      this.syncView(b.dataset.view!);
    }));
  }
  closeLayers() {
    if (this.$('#layers').hidden) return;
    this.$('#layers').hidden = true;
    this.markBar(null);
  }
  /** Light the view that's showing (cheap: only touches the DOM when it changes). */
  syncView(id = this.views?.current() ?? '') {
    if (id === this.viewShown || this.$('#layers').hidden) return;
    this.viewShown = id;
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
  }

  // ---------------- menu ----------------
  addMenuItem(m: MenuItem) {
    const at = this.menu.findIndex((x) => x.id === m.id);
    if (at >= 0) this.menu[at] = m; else this.menu.push(m);
    if (this.sheet?.key === 'menu') this.openMenu();
  }
  openMenu() {
    const body = this.openSheet({
      key: 'menu', title: NAME, sub: 'A transport game', icon: undefined, from: 'menu',
      body: `<div class="grid">${this.menu.map((m, i) => {
        const sub = typeof m.sub === 'function' ? m.sub() : m.sub;
        return `<button class="card${m.disabled ? ' locked' : ''}" data-menu="${i}" ${m.disabled ? 'aria-disabled="true"' : ''}><b>${icon(m.icon)}<span>${esc(m.label)}</span></b>${sub ? `<span>${esc(sub)}</span>` : ''}${m.disabled ? `<span class="why">${esc(m.disabled)}</span>` : ''}</button>`;
      }).join('')}</div>`,
    });
    body.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((b) => b.addEventListener('click', () => {
      const m = this.menu[+b.dataset.menu!];
      if (m.disabled) { this.hint(`${icon('info')}<span>${esc(m.label)}: ${esc(m.disabled)}</span>`, 3500); return; }
      m.onClick();
    }));
  }

  // ---------------- tools ----------------
  get toolActive() { return !!this.tool; }
  startTool(spec: ToolSpec): ToolHandle {
    if (this.tool) { const t = this.tool; this.stopTool(); t.onCancel?.(); }
    this.dismissFirstRun();
    this.closeSheet();
    this.closeLayers();
    this.tool = { ...spec, primary: null, undo: false };
    const el = this.$('#tool');
    const t = this.tool;
    const draw = () => {
      el.className = `tone-${t.tone ?? 'look'}`;
      html(el, `<div class="what">${t.icon ? `<i class="badge">${icon(t.icon)}</i>` : ''}<div class="tw"><b>${esc(t.name)}</b>${t.spec ? `<span>${esc(t.spec)}</span>` : ''}</div></div>
        <div class="opts">${t.options ?? ''}</div>
        <div class="acts">
          ${t.onUndo ? `<button class="act" id="t-undo" aria-label="Undo" title="Undo" ${t.undo ? '' : 'disabled'}>${icon('undo')}</button>` : ''}
          <button class="act" id="t-cancel" aria-label="Cancel" title="Cancel">${icon('x')}</button>
          <span id="t-prim"></span>
        </div>`);
      el.querySelector('#t-undo')?.addEventListener('click', () => t.onUndo?.());
      el.querySelector('#t-cancel')!.addEventListener('click', () => { this.stopTool(); t.onCancel?.(); });
      drawPrimary();
      const o = el.querySelector('.opts') as HTMLElement;
      t.bind?.(o);
      // fade the edge while there are options scrolled out of sight
      const more = () => { o.classList.toggle('more', o.scrollWidth > o.clientWidth + 1); o.classList.toggle('end', o.scrollLeft + o.clientWidth >= o.scrollWidth - 2); };
      o.addEventListener('scroll', more, { passive: true });
      requestAnimationFrame(more);
    };
    const drawPrimary = () => {
      const slot = el.querySelector('#t-prim')!;
      const a = t.primary ?? { label: 'Done', icon: 'check' as Icon, kind: 'primary' as const, onClick: () => { this.stopTool(); t.onDone?.(); } };
      slot.outerHTML = `<span id="t-prim">${actionHtml(a, 0, 'prim')}</span>`;
      el.querySelector('#t-prim button')!.addEventListener('click', () => a.onClick());
    };
    draw();
    el.hidden = false;
    el.classList.add('enter');
    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
    this.$('#bar').hidden = true;
    document.body.classList.add('tooling');
    this.layout();
    const handle: ToolHandle = {
      el,
      set: (p) => { if (this.tool !== t) return; Object.assign(t, p); draw(); },
      setUndo: (on) => { if (this.tool !== t) return; t.undo = on; const u = el.querySelector<HTMLButtonElement>('#t-undo'); if (u) u.disabled = !on; },
      setPrimary: (a) => { if (this.tool !== t) return; t.primary = a; drawPrimary(); },
      setPanel: (h, bind) => {
        if (this.tool !== t) return;
        const p = this.$('#tpanel');
        if (h === null) { if (!p.hidden) { p.hidden = true; html(p, ''); } return; }
        p.className = `facet tone-${t.tone ?? 'look'}`;
        html(p, h);
        p.hidden = false;
        bind?.(p);
      },
      end: () => { if (this.tool === t) this.stopTool(); },
    };
    return handle;
  }
  /** Leave the current tool (if any) quietly. */
  endTool() { this.stopTool(); }
  private stopTool() {
    if (!this.tool) return;
    this.tool = null;
    const el = this.$('#tool');
    el.hidden = true;
    html(el, '');
    const p = this.$('#tpanel');
    p.hidden = true;
    html(p, '');
    this.$('#bar').hidden = false;
    document.body.classList.remove('tooling');
    this.hint(null);
    this.layout();
  }

  // ---------------- layout ----------------
  /** The part of the screen the chrome leaves clear, in CSS pixels (for framing the camera). */
  clearRect(): Rect {
    const W = window.innerWidth, H = window.innerHeight;
    const r: Rect = { left: 0, top: 0, right: W, bottom: H };
    const status = this.$('#status').getBoundingClientRect();
    r.top = status.bottom;
    for (const s of ['#bar', '#tool', '#tpanel', '#sheet']) {
      const el = this.$(s);
      if (el.hidden) continue;
      const b = { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight };
      if (!b.width || !b.height) continue;
      if (b.width >= W * 0.6) { if (b.top > H / 2) r.bottom = Math.min(r.bottom, b.top); }
      else if (b.left > W * 0.35) r.right = Math.min(r.right, b.left);
      else if (b.top > H / 2) r.bottom = Math.min(r.bottom, b.top);
    }
    return r;
  }
  private layout() {
    const bar = this.$('#bar'), tool = this.$('#tool');
    const b = !tool.hidden ? tool.offsetHeight : bar.offsetHeight;
    this.root.style.setProperty('--chrome-b', `${b}px`);
    const h = this.$('#hint');
    if (h.hidden) return;
    const c = this.clearRect();
    h.style.left = `${(c.left + c.right) / 2}px`;
    h.style.bottom = `${window.innerHeight - c.bottom + 8}px`;
    h.style.maxWidth = `${Math.max(160, c.right - c.left - 16)}px`;
  }
}
