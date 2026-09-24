// The start menu's screens: home (Continue, New game, How to play, Settings, About) and one page
// for each. Plain DOM with no three.js, so it paints at once; the game loads only when a map is
// picked (main.ts). Brand: docs/hud.md (forest, lime, gold; League Spartan and Archivo; Tabler icons).

import { MAPS, type MapInfo } from '../proto/maps';
import { NAME, markSvg, ridgeSvg } from '../proto/ui/brand';
import { icon, type Icon } from '../proto/ui/icons';
import { EXPLORERS, libraryHref } from './library';
import { bindRegion, lastRegion, regionBody } from './regionsetup';
import type { Screen } from './route';
import { TIER_NAMES, TIER_NOTES, guideSeen, quality, setGuideSeen, setQuality } from './store';

export interface MenuHost {
  go(screen: Screen): void;
  back(): void;
  /** start a map; `query` is the whole address query when the map has options (the region's) */
  play(map: MapInfo, guide: boolean, query?: string): void;
  /** the latest save, once the game can save (nothing saves yet) */
  save: { name: string; when: string; open(): void } | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const chev = () => icon('chevronDown', 'chev');

function row(id: string, ic: Icon, label: string, sub: string, primary = false) {
  return `<button class="mrow${primary ? ' primary' : ''}" data-go="${id}">${icon(ic)}<span class="t"><b>${label}</b><small>${sub}</small></span>${chev()}</button>`;
}

function home(h: MenuHost) {
  const s = h.save;
  return `<div class="home">
    <header class="brand">
      ${markSvg('bigmark')}
      <h1>${NAME}</h1>
      <p>A transport game. Build the roads, buses and trains a town grows around.</p>
    </header>
    <nav class="rows" aria-label="Start">
      ${s ? `<button class="mrow primary" data-continue>${icon('play')}<span class="t"><b>Continue</b><small>${esc(s.name)} · ${esc(s.when)}</small></span>${chev()}</button>` : ''}
      ${row('new', s ? 'plus' : 'play', 'New game', 'Pick a map to start on', !s)}
      ${row('how', 'finger', 'How to play', 'The controls, and the guided start')}
      ${row('library', 'layers', 'Library', 'Every vehicle, bridge and building block')}
      ${row('settings', 'cog', 'Settings', 'Quality, and the guide')}
      ${row('about', 'info', 'About', 'Credits and licences')}
    </nav>
  </div>`;
}

// a map's card art: its icon on a faceted tile, over a strip of the ridge
const art = (m: MapInfo) => `<i class="art${m.ready ? '' : ' off'}">${icon(m.icon)}</i>`;

function newGame(notice?: string) {
  return `${notice ? `<p class="notice" role="status">${icon('info')}<span>${esc(notice)}</span></p>` : ''}
    <ul class="maps">${MAPS.map((m) => `<li class="map${m.ready ? ' ready' : ''}">
      ${art(m)}
      <div class="t"><b>${esc(m.name)}</b><small>${esc(m.blurb)}</small>
        ${m.ready ? '' : `<em class="chip">${esc(m.soon ?? 'Coming soon')}</em>`}</div>
      <div class="go">${m.ready
        ? m.setup ? `<button class="act primary" data-go="${m.id}" aria-label="Set up ${esc(m.name)}">${icon('adjustments')}<span>Set up and play</span></button>`
          : `<button class="act primary" data-play="${m.id}" aria-label="Play ${esc(m.name)}">${icon('play')}<span>Play</span></button>`
        : m.link ? `<a class="act" href="${m.link.href}">${icon('map')}<span>${esc(m.link.label)}</span></a>` : ''}</div>
    </li>`).join('')}</ul>`;
}

function how() {
  const item = (ic: Icon, title: string, text: string) => `<li>${icon(ic)}<div><b>${title}</b><p>${text}</p></div></li>`;
  return `<ul class="how">
      ${item('finger', 'Move the map', 'Drag with one finger to look around. Pinch to zoom, twist two fingers to turn, and slide two fingers up or down to tilt. Double-tap zooms in.')}
      ${item('road', 'Build roads and rail', 'Tap <b>Build</b>, pick a road or railway, then drag from where it starts to where it ends. Check the blueprint and tap <b>Build</b> to lay it.')}
      ${item('busStop', 'Place stops', 'In <b>Build</b>, the <b>Stops</b> tab has the bus stop. Tap beside a road to put one there.')}
      ${item('route', 'Run bus lines', 'In <b>Transport</b>, <b>Lines</b> has <b>New line</b>: tap stops in the order the bus should call.')}
      ${item('trendUp', 'Watch the town grow', 'People walk to your stops and ride your buses. Good service brings new homes and jobs.')}
      ${item('menu', 'Everything else', 'Tap anything on the map to see what it is. <b>Layers</b> changes the view, and <b>Menu</b> has quality and the way back here.')}
    </ul>
    <button class="act primary wide" data-guide>${icon('play')}<span>Start the guided game</span></button>
    <button class="act wide lib-link" data-go="library">${icon('layers')}<span>See every vehicle and bridge in the Library</span></button>
    <p class="fine">The guide takes you through your first road, stop and line in the starter town. You can skip it at any point.</p>`;
}

// the game's building blocks, each on its own explorer page (src/app/library.ts)
function library() {
  return `<p class="fine">Everything the game is built from, each on a page of its own to look round. Drag, pinch and twist as in the game.</p>
    <ul class="maps lib">${EXPLORERS.map((e) => `<li class="map ready">
      <i class="art">${icon(e.icon)}</i>
      <div class="t"><b>${esc(e.name)}</b><small>${esc(e.blurb)}</small></div>
      <div class="go"><a class="act" href="${libraryHref(e)}" data-explorer="${e.id}">${icon('play')}<span>Explore</span></a></div>
    </li>`).join('')}</ul>
    <p class="fine">Each opens on its own and loads what it shows, so the first visit to one takes a moment. Back returns here.</p>`;
}

function settings() {
  const q = quality();
  const opt = (v: number | 'auto', name: string, note: string) =>
    `<label class="opt"><input type="radio" name="q" value="${v}" ${q === v ? 'checked' : ''}><span><b>${name}</b><small>${note}</small></span></label>`;
  return `<section class="grp"><h3>Quality</h3>
      <p class="fine">Auto watches how fast frames come and steps down on a slow phone, then back up when there’s room. Pick a level to hold it. You can change it in a game too, from Menu.</p>
      <div class="opts" role="radiogroup" aria-label="Quality">${opt('auto', 'Auto', 'Recommended')}${TIER_NAMES.map((n, i) => opt(i, n, TIER_NOTES[i])).join('')}</div>
    </section>
    <section class="grp"><h3>Guided start</h3>
      <p class="fine" data-guide-state>${guideSeen() ? 'You’ve seen the guide. It can show again the next time you start the starter town.' : 'The guide shows the next time you start the starter town.'}</p>
      <button class="act wide" data-guide-reset ${guideSeen() ? '' : 'disabled'}>${icon('restore')}<span>Show the guide again</span></button>
    </section>`;
}

function about() {
  return `<section class="grp about">
      <p><b>${NAME}</b> is a working title. It’s a prototype of a transport game: build roads, bus lines and railways, and the town grows around the service you give it.</p>
      <h3>Credits</h3>
      <ul class="credits">
        <li><b>Map data</b> © OpenStreetMap contributors, under the Open Database Licence (ODbL). Real Town Plans builds its plans from it: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a></li>
        <li><b>Icons</b> Tabler Icons, MIT licence</li>
        <li><b>Type</b> League Spartan and Archivo, SIL Open Font Licence</li>
        <li><b>3D</b> three.js, MIT licence</li>
        <li><b>Maps on Real Town Plans</b> Leaflet, BSD licence</li>
      </ul>
      <p class="fine">Vehicle makers and brands in the game are invented.</p>
    </section>`;
}

const TITLES: Record<Exclude<Screen, 'home'>, [string, Icon]> = {
  new: ['New game', 'play'],
  region: ['Region', 'map'],
  how: ['How to play', 'finger'],
  library: ['Library', 'layers'],
  settings: ['Settings', 'cog'],
  about: ['About', 'info'],
};

/** Draw a screen into the menu's root, and wire it. */
export function render(root: HTMLElement, screen: Screen, h: MenuHost, notice?: string) {
  const body = screen === 'home' ? home(h) : screen === 'new' ? newGame(notice) : screen === 'region' ? regionBody(lastRegion()) : screen === 'how' ? how() : screen === 'library' ? library() : screen === 'settings' ? settings() : about();
  const [title, ic] = screen === 'home' ? ['', 'home' as Icon] : TITLES[screen];
  root.innerHTML = `<div class="scr scr-${screen}">
      ${screen === 'home' ? '' : `<header class="bar"><button class="back" data-back aria-label="Back">${icon('arrowLeft')}</button><h2 tabindex="-1">${icon(ic)}<span>${title}</span></h2></header>`}
      <main class="body">${body}</main>
      <div class="ridge-wrap" aria-hidden="true">${ridgeSvg('ridge')}</div>
    </div>`;
  root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => h.go(b.dataset.go as Screen)));
  root.querySelector('[data-back]')?.addEventListener('click', () => h.back());
  root.querySelector('[data-continue]')?.addEventListener('click', () => h.save?.open());
  root.querySelectorAll<HTMLElement>('[data-play]').forEach((b) => b.addEventListener('click', () => h.play(MAPS.find((m) => m.id === b.dataset.play)!, false)));
  root.querySelector('[data-guide]')?.addEventListener('click', () => h.play(MAPS.find((m) => m.guide && m.ready)!, true));
  root.querySelectorAll<HTMLInputElement>('input[name="q"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setQuality(r.value === 'auto' ? 'auto' : +r.value); }));
  const reset = root.querySelector<HTMLButtonElement>('[data-guide-reset]');
  reset?.addEventListener('click', () => {
    setGuideSeen(false);
    reset.disabled = true;
    root.querySelector('[data-guide-state]')!.textContent = 'The guide shows the next time you start the starter town.';
  });
  if (screen === 'region') {
    const region = MAPS.find((m) => m.id === 'region')!;
    const wire = (o: ReturnType<typeof lastRegion>) => bindRegion(root.querySelector('.body')!, o, (next) => {
      const y = root.scrollTop;
      root.querySelector('.body')!.innerHTML = regionBody(next);
      wire(next);
      root.scrollTop = y;
    }, (q) => h.play(region, false, q));
    wire(lastRegion());
  }
  // move focus to the new screen's heading, so a screen reader reads where it landed
  root.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/** The screen shown while the game loads, and if it fails to. */
export function loading(root: HTMLElement, map: MapInfo) {
  root.innerHTML = `<div class="scr scr-load" role="status" aria-live="polite">
      <div class="load">${markSvg('bigmark')}<b>${esc(map.name)}</b><span data-load-msg>Building the town…</span><i class="bar-anim"></i></div>
      <div class="ridge-wrap" aria-hidden="true">${ridgeSvg('ridge')}</div>
    </div>`;
}
