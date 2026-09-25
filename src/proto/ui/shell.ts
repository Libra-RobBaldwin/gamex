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
import { NAME, needleSvg } from './brand';

export type Tone = 'road' | 'rail' | 'stop' | 'look' | 'bulldoze';
export type BarKey = 'build' | 'transport' | 'layers' | 'stats' | 'menu';

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
  /** Hold the sheet at its full height, so switching tabs doesn't move the tabs under the finger. */
  fixed?: boolean;
  /** One row for the tabs and Close, no title block: for a sheet that should leave most of the map clear. */
  compact?: boolean;
}
export interface BuildCategory { id: string; label: string; icon: Icon; disabled?: string; note?: string }
export interface BuildItem {
  id: string;
  label: string;
  spec?: string;
  /** A shorter name and a few words for the card, in place of `label` and `spec` (it has room for one short line of each). */
  name?: string;
  short?: string;
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
  /** HTML for the options drawer (type, shape, height, crossing...), folded away behind one
   *  button until wanted. Wire it up in `bind`. */
  options?: string;
  /** What the drawer's button says it holds (the name and spec also open it). */
  optionsLabel?: string;
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
  /** Open or fold away the options drawer. */
  setOpen(open: boolean): void;
  /** Replace the Done button (e.g. with Build while a blueprint waits); null puts Done back. */
  setPrimary(a: Action | null): void;
  /** A card above the strip, for the blueprint and its warnings; null hides it. */
  setPanel(html: string | null, bind?: (el: HTMLElement) => void): void;
  /** Screen points the card must not cover (the blueprint's ends); it moves across if it would. */
  avoid(points: { x: number; y: number }[]): void;
  /** Leave the tool without calling onDone or onCancel. */
  end(): void;
}
export interface Layer { id: string; label: string; icon: Icon; disabled?: string; on?: boolean; onToggle?: (on: boolean) => void }
export interface ViewPicker { options: { id: string; label: string }[]; current: () => string; pick: (id: string) => void }
export interface MenuItem { id: string; label: string; sub?: string | (() => string); icon: Icon; disabled?: string; onClick: () => void }
/** Something the player should know about, with where to go to deal with it. */
export interface Alert { id: string; icon: Icon; text: string; sub?: string; tone?: Tone; onClick?: () => void }
export interface TransportTab { id: string; label: string; icon: Icon; sub?: string; render: (el: HTMLElement) => void }
export interface Info {
  key?: string;
  title: string;
  sub?: string;
  icon?: Icon;
  tone?: Tone;
  facts?: [string, string][];
  /** The few numbers that matter, as big tiles above the facts: [label, value] */
  stats?: [string, string][];
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
  /** The town panel, from the drawer's button. */
  onTown?: () => void;
  /** The underground view button, under the view button: the ground fades so tunnels show. */
  onUnderground?: () => void;
}
export interface Rect { left: number; top: number; right: number; bottom: number }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const html = (el: Element, s: string) => { el.innerHTML = s; };
// fade a sideways-scrolling row's far edge while there's more of it out of sight
const fade = (o: HTMLElement) => { o.classList.toggle('more', o.scrollWidth > o.clientWidth + 1); o.classList.toggle('end', o.scrollLeft + o.clientWidth >= o.scrollWidth - 2); };
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
  private stabs2: TransportTab[] = [];
  private stab = '';
  private layers: Layer[] = [];
  private views: ViewPicker | null = null;
  private menu: MenuItem[] = [];
  private sheet: SheetSpec | null = null;
  private tool: (ToolSpec & { primary: Action | null; undo: boolean; open: boolean }) | null = null;
  private hintTimer = 0;
  private firstRunKey = '';
  private viewShown = '';
  private viewBtnShown = '';
  private tabScroll = 0;
  private guardUntil = 0;

  constructor(root: HTMLElement, opts: ShellOptions) {
    this.root = root;
    html(root, `
      <div id="hud-top">
        <header id="status">
          <span class="vh">${NAME}</span>
          <button id="clockbtn" aria-expanded="false" aria-controls="drawer" title="Town at a glance">
            <span class="sm"><span id="money" class="money"></span><em id="trend"></em></span>
            <span class="sp"><span id="popc">${icon('users')}<b id="st-popc">0</b><i id="popdir"></i></span><span class="clk"><b id="st-clock">07:00</b><em id="st-rush"></em></span></span>
          </button>
          <span class="spd">
            <button id="alertbtn" hidden aria-label="Alerts" title="Alerts">${icon('bell')}<b id="alertn"></b></button>
            <button id="sp-pause" aria-pressed="false" aria-label="Pause" title="Pause">${icon('pause')}</button>
            <button id="sp-rate" aria-label="Game speed 1×, tap for faster" title="Game speed">1×</button>
          </span>
        </header>
        <div id="drawer" class="facet" hidden>
          <div class="sts">
            <span class="st">${said('users', 'population')}<b id="st-pop">0</b> people</span>
            <span class="st">${said('car', 'cars')}<b id="st-cars">0</b> cars</span>
            <span class="st">${said('bus', 'buses')}<b id="st-buses">0</b> buses</span>
            <span class="st">${said('train', 'trains')}<b id="st-trains">0</b> trains</span>
          </div>
          <button id="townbtn">${icon('building')}<span>Town panel</span></button>
          <button id="perfbtn" aria-expanded="false" aria-controls="perf">${icon('activity')}<span>Performance</span></button>
          <div id="perf" role="status" hidden><span id="perf-t">measuring…</span></div>
        </div>
        <button id="compass" aria-label="Face north and reset the tilt" title="Face north"><span id="needle">${needleSvg()}</span></button>
        <button id="viewbtn" class="round" hidden aria-label="View" title="View">${icon('map')}<span></span></button>
        <button id="ugbtn" class="round" ${opts.onUnderground ? '' : 'hidden'} aria-pressed="false" aria-label="Underground view" title="Underground view">${icon('tunnel')}</button>
        <div id="firstrun" role="status" hidden></div>
        <button id="goal" hidden></button>
      </div>
      <section id="sheet" class="sheet facet" role="dialog" hidden></section>
      <div id="layers" class="facet" role="dialog" aria-label="Map layers" hidden></div>
      <div id="tpanel" class="facet" hidden></div>
      <div id="tool" hidden></div>
      <nav id="bar" aria-label="Main">
        <button data-bar="transport" aria-expanded="false">${icon('transport')}<span>Transport</span></button>
        <button data-bar="layers" aria-expanded="false">${icon('layers')}<span>Overlays</span></button>
        <button data-bar="build" class="fab" aria-expanded="false">${icon('hammer')}<span>Build</span></button>
        <button data-bar="stats" aria-expanded="false">${icon('activity')}<span>Stats</span></button>
        <button data-bar="menu" aria-expanded="false">${icon('menu')}<span>Menu</span></button>
      </nav>
      <div id="hint" role="status" aria-live="polite" hidden></div>
      <div id="safe" aria-hidden="true"></div>`);
    this.$('#compass').addEventListener('click', () => opts.onCompass());
    this.$('#sp-pause').addEventListener('click', () => opts.onPause());
    this.$('#sp-rate').addEventListener('click', () => opts.onRate());
    this.$('#perfbtn').addEventListener('click', () => opts.onPerf());
    this.$('#alertbtn').addEventListener('click', () => (this.sheet?.key === 'alerts' ? this.closeSheet() : this.openAlerts()));
    this.$('#townbtn').addEventListener('click', () => { this.toggleDrawer(false); opts.onTown?.(); });
    this.$('#ugbtn').addEventListener('click', () => opts.onUnderground?.());
    this.$('#clockbtn').addEventListener('click', () => this.toggleDrawer());
    // while a tool hides the bar (and with it Layers), this cycles 3D, Low and Plan
    this.$('#viewbtn').addEventListener('click', () => {
      if (!this.views) return;
      const o = this.views.options, i = o.findIndex((x) => x.id === this.views!.current());
      const next = o[(i + 1) % o.length];
      this.views.pick(next.id);
      this.labelViewBtn(next.id);
    });
    this.root.querySelectorAll<HTMLButtonElement>('#bar button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.bar as BarKey;
      if (b.getAttribute('aria-expanded') === 'true') return k === 'layers' ? this.closeLayers() : this.closeSheet();
      if (k === 'build') this.openBuild();
      else if (k === 'transport') this.openTransport();
      else if (k === 'layers') this.openLayers();
      else if (k === 'stats') this.openStats();
      else this.openMenu();
    }));
    // A tap on the map opens a sheet on pointerup; the click from that same tap must not then
    // press whatever the new sheet put under the finger (see guardTap).
    window.addEventListener('click', (e) => { if (performance.now() < this.guardUntil && root.contains(e.target as Node)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.$('#layers').hidden) this.closeLayers();
      else if (this.sheet) this.closeSheet();
      else if (this.tool) { const t = this.tool; this.stopTool(); t.onCancel?.(); }
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
  /** Money, once the economy is wired; empty hides it. `trend`: what the day's running made or lost. */
  setMoney(text: string, trend?: { text: string; dir: 1 | 0 | -1 }) {
    this.$('#money').textContent = text;
    const t = this.$('#trend');
    t.textContent = trend?.text ?? '';
    t.className = trend ? (trend.dir > 0 ? 'up' : trend.dir < 0 ? 'down' : '') : '';
  }
  /** Population in the status pill, with which way it's heading. */
  setPop(text: string, dir: 1 | 0 | -1) {
    this.$('#st-popc').textContent = text;
    const d = this.$('#popdir');
    d.className = dir > 0 ? 'up' : dir < 0 ? 'down' : '';
    d.textContent = dir > 0 ? '▲' : dir < 0 ? '▼' : '';
  }

  /** Call when a map tap is about to open or change a sheet: swallows that tap's click. */
  guardTap(ms = 400) { this.guardUntil = performance.now() + ms; }

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
  /** The next thing to do, as a small card under the status strip: tapping it gets on with it
   *  (null hides it). It stays out of the way while a tool is in use. */
  goal(g: { step: string; text: string; icon: Icon; onClick: () => void } | null) {
    const el = this.$('#goal') as HTMLButtonElement;
    if (!g) { if (!el.hidden) { el.hidden = true; html(el, ''); } return; }
    const h = `${icon(g.icon)}<span><small>${esc(g.step)}</small>${esc(g.text)}</span>${icon('chevronDown', 'go')}`;
    if (el.innerHTML !== h) html(el, h);
    el.onclick = g.onClick;
    el.hidden = false;
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
    if (!was || was.key !== spec.key) this.toggleDrawer(false);
    const el = this.$('#sheet');
    const body = el.querySelector('.sb');
    const keep = was && was.key === spec.key && !spec.fresh && body ? body.scrollTop : 0;
    this.sheet = spec;
    const compact = !!spec.compact && !!spec.tabs;
    el.className = `sheet facet tone-${spec.tone ?? 'look'}${spec.fixed && !compact ? ' fixed' : ''}${compact ? ' compact' : ''}`;
    el.setAttribute('aria-label', spec.sub ? `${spec.title}: ${spec.sub}` : spec.title);
    const tabs = spec.tabs ? `<div class="stabs" role="tablist">${spec.tabs.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === spec.tab}" ${t.disabled ? `disabled title="${esc(t.disabled)}"` : ''}>${t.icon ? icon(t.icon) : ''}<span>${esc(t.label)}</span></button>`).join('')}</div>` : '';
    const close = `<button class="close" aria-label="Close" title="Close">${icon('x')}</button>`;
    html(el, `${compact ? `<header>${tabs}${close}</header>` : `<header>
        ${spec.back ? `<button class="back" aria-label="Back" title="Back">${icon('arrowLeft')}</button>` : ''}
        ${spec.icon ? `<i class="badge">${icon(spec.icon)}</i>` : ''}
        <div class="ttl"><h2>${esc(spec.title)}</h2>${spec.sub ? `<span class="sub">${esc(spec.sub)}</span>` : ''}</div>
        ${close}
      </header>
      ${tabs}`}
      <div class="sb">${spec.body}${spec.actions?.length ? `<div class="acts">${spec.actions.map((a, i) => actionHtml(a, i, 'act')).join('')}</div>` : ''}</div>`);
    if (el.hidden) { el.classList.add('enter'); el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true }); }
    el.hidden = false;
    el.querySelector('.close')!.addEventListener('click', () => this.closeSheet());
    el.querySelector('.back')?.addEventListener('click', () => spec.back!());
    el.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => spec.onTab?.(b.dataset.tab!)));
    const tabRow = el.querySelector<HTMLElement>('.stabs');
    if (tabRow) {
      tabRow.scrollLeft = this.tabScroll;
      const more = () => { this.tabScroll = tabRow.scrollLeft; fade(tabRow); };
      tabRow.addEventListener('scroll', more, { passive: true });
      requestAnimationFrame(more);
    }
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
    const stats = i.stats?.length ? `<div class="tiles">${i.stats.map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>` : '';
    const facts = stats + (i.facts?.length ? `<dl class="facts">${i.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '');
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
      key: `build:${this.buildCat}`, title: 'Build', sub: 'Pick something, then draw it on the map', from: 'build', compact: true,
      tabs: this.cats.map((x) => ({ id: x.id, label: x.label, icon: x.icon, disabled: x.disabled })), tab: this.buildCat,
      onTab: (id) => this.openBuild(id),
      // one row of small cards that scrolls sideways, so the sheet stays a strip over the bar
      body: `<div class="strip">${list.map((it, i) => {
          const what = it.locked ?? it.short ?? it.spec ?? '';
          const full = [it.label, it.spec, it.locked].filter(Boolean).join(' · ');
          return `<button class="card mini${it.locked ? ' locked' : ''}${it.on?.() ? ' on' : ''} tone-${it.tone ?? 'look'}" data-item="${i}" ${it.locked ? 'aria-disabled="true"' : ''} title="${esc(full)}" aria-label="${esc(full)}">
          <b>${it.icon ? icon(it.icon) : ''}<span>${esc(it.name ?? it.label)}</span></b>${what ? `<span class="${it.locked ? 'why' : ''}">${esc(what)}</span>` : ''}</button>`;
        }).join('')}</div>
        ${c?.note ? `<p class="note">${esc(c.note)}</p>` : ''}`,
    });
    const strip = body.querySelector<HTMLElement>('.strip')!;
    const fadeStrip = () => fade(strip);
    strip.addEventListener('scroll', fadeStrip, { passive: true });
    strip.querySelector<HTMLElement>('.card.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    requestAnimationFrame(fadeStrip);
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
      key: `transport:${this.ttab}`, title: 'Transport', sub: t?.sub ?? 'Your lines and vehicles', from: 'transport', fixed: true,
      tabs: this.ttabs.map((x) => ({ id: x.id, label: x.label, icon: x.icon })), tab: this.ttab,
      onTab: (id) => this.openTransport(id), body: '',
    });
    t?.render(body);
  }
  /** Re-render whichever transport tab is showing (e.g. after a vehicle is added). */
  refreshTransport() { if (this.sheet?.key.startsWith('transport:')) this.openTransport(this.ttab); }

  // ---------------- alerts: what wants attention, one tap from dealing with it ----------------
  private alerts: Alert[] = [];
  private alertSig = '';
  setAlerts(list: Alert[]) {
    const sig = list.map((a) => `${a.id}|${a.text}|${a.sub ?? ''}`).join('\n');
    if (sig === this.alertSig) return;
    const grew = list.some((a) => !this.alerts.some((b) => b.id === a.id));
    this.alertSig = sig;
    this.alerts = list;
    const b = this.$('#alertbtn');
    b.hidden = !list.length;
    this.$('#alertn').textContent = list.length ? String(list.length) : '';
    b.setAttribute('aria-label', `${list.length} alert${list.length === 1 ? '' : 's'}`);
    if (grew) { b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); }
    if (this.sheet?.key === 'alerts') { if (list.length) this.openAlerts(); else this.closeSheet(); }
  }
  openAlerts() {
    const body = this.openSheet({
      key: 'alerts', title: 'Alerts', sub: this.alerts.length ? 'Tap one to go and deal with it' : 'All running smoothly', icon: 'bell',
      body: this.alerts.length ? this.alerts.map((a, i) => `<button class="lrow alrow tone-${a.tone ?? 'look'}" data-al="${i}"><span class="num">${icon(a.icon)}</span><b>${esc(a.text)}</b>${a.sub ? `<span>${esc(a.sub)}</span>` : '<span></span>'}</button>`).join('') : '<p class="note">Nothing needs you just now.</p>',
    });
    body.querySelectorAll<HTMLButtonElement>('[data-al]').forEach((b) => b.addEventListener('click', () => { const a = this.alerts[+b.dataset.al!]; this.closeSheet(); a?.onClick?.(); }));
  }

  // ---------------- stats: money, lines, the town ----------------
  addStatsTab(t: TransportTab) {
    const at = this.stabs2.findIndex((x) => x.id === t.id);
    if (at >= 0) this.stabs2[at] = t; else this.stabs2.push(t);
  }
  openStats(tab?: string) {
    this.stab = tab ?? (this.stabs2.some((t) => t.id === this.stab) ? this.stab : this.stabs2[0]?.id ?? '');
    const t = this.stabs2.find((x) => x.id === this.stab);
    const body = this.openSheet({
      key: `stats:${this.stab}`, title: 'Stats', sub: t?.sub ?? 'How your company and towns are doing', from: 'stats', fixed: true,
      tabs: this.stabs2.map((x) => ({ id: x.id, label: x.label, icon: x.icon })), tab: this.stab,
      onTab: (id) => this.openStats(id), body: '',
    });
    t?.render(body);
  }
  refreshStats() { if (this.sheet?.key.startsWith('stats:')) this.openStats(this.stab); }

  // ---------------- layers ----------------
  addLayer(l: Layer) {
    const at = this.layers.findIndex((x) => x.id === l.id);
    if (at >= 0) this.layers[at] = l; else this.layers.push(l);
    if (!this.$('#layers').hidden) this.openLayers();
  }
  setViews(v: ViewPicker) { this.views = v; }
  /** Light the underground view button while the view is on. */
  setUnderground(on: boolean) {
    const b = this.$('#ugbtn');
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Underground view on, tap to show the surface' : 'Underground view');
  }
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
    if (this.tool && id !== this.viewBtnShown) this.labelViewBtn(id);
    if (id === this.viewShown || this.$('#layers').hidden) return;
    this.viewShown = id;
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
  }

  private labelViewBtn(id = this.views?.current() ?? '') {
    const o = this.views?.options.find((x) => x.id === id);
    const b = this.$('#viewbtn');
    this.viewBtnShown = id;
    b.querySelector('span')!.textContent = o?.label ?? '';
    b.setAttribute('aria-label', `View: ${o?.label ?? ''}, tap for the next`);
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
    this.tool = { ...spec, primary: null, undo: false, open: false };
    const el = this.$('#tool');
    const t = this.tool;
    const draw = () => {
      const was = (el.querySelector('.opts') as HTMLElement | null)?.scrollLeft ?? 0;
      el.className = `tone-${t.tone ?? 'look'}`;
      el.setAttribute('role', 'toolbar');
      el.setAttribute('aria-label', t.name);
      const hasOpts = !!t.options;
      el.classList.toggle('open', hasOpts && t.open);
      const what = `${t.icon ? `<i class="badge">${icon(t.icon)}</i>` : ''}<div class="tw"><b>${esc(t.name)}${hasOpts ? icon('chevronDown') : ''}</b>${t.spec ? `<span>${esc(t.spec)}</span>` : ''}</div>`;
      html(el, `${hasOpts ? `<button class="what" id="t-what" aria-expanded="${t.open}" aria-label="${esc(t.name)}: ${esc(t.optionsLabel ?? 'options')}">${what}</button>` : `<div class="what">${what}</div>`}
        <div class="opts"${hasOpts && t.open ? '' : ' hidden'}>${t.open ? t.options ?? '' : ''}</div>
        <div class="acts">
          ${hasOpts ? `<button class="act" id="t-opts" aria-label="${esc(t.optionsLabel ?? 'Options')}" title="${esc(t.optionsLabel ?? 'Options')}" aria-pressed="${t.open}">${icon('adjustments')}</button>` : ''}
          ${t.onUndo ? `<button class="act" id="t-undo" aria-label="Undo" title="Undo" ${t.undo ? '' : 'disabled'}>${icon('undo')}</button>` : ''}
          <button class="act" id="t-cancel" aria-label="Cancel" title="Cancel">${icon('x')}</button>
          <span id="t-prim"></span>
        </div>`);
      const flip = () => { t.open = !t.open; draw(); this.layout(); };
      el.querySelector('#t-what')?.addEventListener('click', flip);
      el.querySelector('#t-opts')?.addEventListener('click', flip);
      el.querySelector('#t-undo')?.addEventListener('click', () => t.onUndo?.());
      el.querySelector('#t-cancel')!.addEventListener('click', () => { this.stopTool(); t.onCancel?.(); });
      drawPrimary();
      const o = el.querySelector('.opts') as HTMLElement;
      o.scrollLeft = was;
      if (t.open) t.bind?.(o);
      // fade the edge while there are options scrolled out of sight
      const more = () => fade(o);
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
    this.$('#viewbtn').hidden = !this.views;
    this.labelViewBtn();
    document.body.classList.add('tooling');
    this.layout();
    const handle: ToolHandle = {
      el,
      set: (p) => { if (this.tool !== t) return; Object.assign(t, p); draw(); },
      setUndo: (on) => { if (this.tool !== t) return; t.undo = on; const u = el.querySelector<HTMLButtonElement>('#t-undo'); if (u) u.disabled = !on; },
      setOpen: (on) => { if (this.tool !== t || t.open === on) return; t.open = on; draw(); this.layout(); },
      setPrimary: (a) => { if (this.tool !== t) return; t.primary = a; drawPrimary(); },
      setPanel: (h, bind) => {
        if (this.tool !== t) return;
        const p = this.$('#tpanel');
        if (h === null) { if (!p.hidden) { p.hidden = true; html(p, ''); } return; }
        p.className = `facet tone-${t.tone ?? 'look'}${p.classList.contains('alt') && !p.hidden ? ' alt' : ''}`;
        html(p, h);
        p.hidden = false;
        bind?.(p);
      },
      avoid: (pts) => {
        const p = this.$('#tpanel');
        if (this.tool !== t || p.hidden) return;
        const hits = () => { const r = p.getBoundingClientRect(); return pts.filter((q) => q.x > r.left - 12 && q.x < r.right + 12 && q.y > r.top - 12 && q.y < r.bottom + 12).length; };
        const here = hits();
        if (!here) return;
        p.classList.toggle('alt');
        if (hits() >= here) p.classList.toggle('alt'); // no better over there: stay
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
    this.$('#viewbtn').hidden = true;
    document.body.classList.remove('tooling');
    this.hint(null);
    this.layout();
  }

  // ---------------- layout ----------------
  /** The part of the screen the chrome leaves clear, in CSS pixels (for framing the camera). */
  clearRect(): Rect {
    const W = window.innerWidth, H = window.innerHeight;
    // (#safe is padded by the safe-area insets, so its computed padding is them in pixels)
    const sp = getComputedStyle(this.$('#safe'));
    const r: Rect = { left: parseFloat(sp.paddingLeft) || 0, top: 0, right: W - (parseFloat(sp.paddingRight) || 0), bottom: H - (parseFloat(sp.paddingBottom) || 0) };
    const status = this.$('#status').getBoundingClientRect();
    r.top = status.bottom;
    for (const s of ['#bar', '#tool', '#tpanel', '#sheet']) {
      const el = this.$(s);
      if (el.hidden) continue;
      const b = { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight };
      if (!b.width || !b.height) continue;
      // full width and sitting on the bottom (the bar, a sheet, the blueprint): the map ends above
      // it, however tall; narrower and on the right (landscape): the map ends beside it
      const low = b.top + b.height > H * 0.6;
      if (b.width >= W * 0.6) { if (low) r.bottom = Math.min(r.bottom, b.top); }
      else if (b.left > W * 0.35) r.right = Math.min(r.right, b.left);
      else if (low) r.bottom = Math.min(r.bottom, b.top);
    }
    return r;
  }
  private layout() {
    const bar = this.$('#bar'), tool = this.$('#tool');
    const el = !tool.hidden ? tool : bar;
    const b = el.offsetHeight ? Math.round(window.innerHeight - el.getBoundingClientRect().top) : 0;
    this.root.style.setProperty('--chrome-b', `${b}px`);
    const h = this.$('#hint');
    if (h.hidden) return;
    const c = this.clearRect();
    h.style.left = `${(c.left + c.right) / 2}px`;
    h.style.bottom = `${window.innerHeight - c.bottom + 8}px`;
    h.style.maxWidth = `${Math.max(160, c.right - c.left - 16)}px`;
    // and keeps clear of the compass and view buttons, if it reaches up beside them
    const hr = h.getBoundingClientRect();
    for (const s of ['#compass', '#viewbtn', '#ugbtn']) {
      const b = this.$(s);
      if (b.hidden) continue;
      const br = b.getBoundingClientRect();
      if (hr.right > br.left - 4 && hr.left < br.right && hr.bottom > br.top && hr.top < br.bottom) {
        const right = br.left - 8;
        h.style.left = `${(c.left + right) / 2}px`;
        h.style.maxWidth = `${Math.max(120, right - c.left - 8)}px`;
        break;
      }
    }
  }
}
