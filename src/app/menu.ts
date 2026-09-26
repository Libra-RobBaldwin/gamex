// The start menu's screens: home (Continue, Saved towns, New game, How to play, Settings, About) and one page
// for each. Plain DOM with no three.js, so it paints at once; the game loads only when a map is
// picked (main.ts). Brand: docs/hud.md (forest, lime, gold; League Spartan and Archivo; Tabler icons).
// Like the start screens of the city builders it borrows from, home is the town itself: a picture of
// the starter town (art/, taken from the game) drifting slowly behind a short stack of choices,
// with the one that matters most (Continue, or New game) the biggest.

import { MAPS, type MapInfo } from '../proto/maps';
import { REAL_REGION_LIST } from '../proto/real/list';
import { NAME, markSvg } from '../proto/ui/brand';
import { icon, type Icon } from '../proto/ui/icons';
import { EXPLORERS, libraryHref } from './library';
import { bindRegion, lastRegion, regionBody, regionFirst } from './regionsetup';
import { describe, when } from '../proto/game/save';
import type { SaveEntry } from '../proto/game/savedb';
import type { Screen } from './route';
import heroTall from './art/hero-tall.webp';
import heroWide from './art/hero-wide.webp';
import mapTown from './art/map-town.webp';
import mapRegion from './art/map-region.webp';
import mapPlace from './art/map-place.webp';
import mapSandbox from './art/map-sandbox.webp';
import { TIER_NAMES, TIER_NOTES, guideSeen, quality, setGuideSeen, setQuality } from './store';

export interface MenuHost {
  go(screen: Screen): void;
  back(): void;
  /** start a map; `query` is the whole address query when the map has options (the region's) */
  play(map: MapInfo, guide: boolean, query?: string): void;
  /** the towns saved on this device, newest first (game/savedb.ts); Continue opens the first */
  saves: SaveEntry[];
  open(save: SaveEntry): void;
  remove(save: SaveEntry): void;
  /** delete every save, setting and offline copy on this device, then start afresh */
  wipe(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

// a picture of each map, for its card (and a saved town's); a map without one shows its icon
const MAP_ART: Record<string, string> = { town: mapTown, region: mapRegion, place: mapPlace, sandbox: mapSandbox, ...Object.fromEntries(REAL_REGION_LIST.map((r) => [r.id, `${import.meta.env.BASE_URL}${r.thumb}`])) }; // (the real regions: their baked map, proto/real/list.ts)
const artFor = (id: string) => MAP_ART[id];
// a saved town's map: its query names it (the sandbox is saved on the town's map)
const savedMap = (e: SaveEntry) => new URLSearchParams(e.map.query).get('map') ?? e.map.id;
// a region saved before 50 km maps: it still opens as the old 6 km map (game/save.ts), so say so
const oldMap = (e: SaveEntry) => savedMap(e) === 'region' && (new URLSearchParams(e.map.query).get('size') ?? '6') === '6';
const oldNote = (e: SaveEntry) => (oldMap(e) ? ' · old 6 km map' : '');

// the town behind the menu: a tall picture for a phone held upright, a wide one otherwise
const hero = (cls: string, src?: string) => src
  ? `<picture class="${cls}" aria-hidden="true"><img src="${src}" alt="" decoding="async"></picture>`
  : `<picture class="${cls}" aria-hidden="true"><source media="(min-aspect-ratio: 1/1)" srcset="${heroWide}"><img src="${heroTall}" alt="" decoding="async"></picture>`;

function tile(id: string, ic: Icon, label: string) {
  return `<button class="tile" data-go="${id}">${icon(ic)}<span>${label}</span></button>`;
}

function home(h: MenuHost) {
  const s = h.saves[0];
  return `<div class="home">
    <header class="brand">
      ${markSvg('bigmark')}
      <h1>${NAME}</h1>
      <p>Build the roads, buses and trains. Watch the town grow.</p>
    </header>
    <nav class="dock" aria-label="Start">
      ${s ? `<button class="cont" data-continue>
          ${artFor(savedMap(s)) ? `<img class="thumb" src="${artFor(savedMap(s))}" alt="" decoding="async">` : ''}
          <span class="t"><small>Continue</small><b>${esc(s.name)}</b><em>${esc(describe(s.summary))} · saved ${esc(when(s.savedAt))}${oldNote(s)}</em></span>
          <i class="playc">${icon('play')}</i></button>` : ''}
      <button class="newgame${s ? '' : ' primary'}" data-go="new">${icon(s ? 'plus' : 'play')}<span>New game</span></button>
      <div class="tiles">
        ${h.saves.length > 1 ? tile('saves', 'clock', 'Saved') : ''}
        ${tile('how', 'finger', 'How to play')}
        ${tile('library', 'layers', 'Library')}
        ${tile('settings', 'cog', 'Settings')}
        ${tile('about', 'info', 'About')}
      </div>
    </nav>
  </div>`;
}

// every saved town: open it, or delete it (a second tap confirms)
function saves(h: MenuHost) {
  if (!h.saves.length) return `<p class="fine">No saved towns yet. A town saves itself as you play, every few game hours and when you leave it.</p>`;
  return `<ul class="maps saves">${h.saves.map((e, i) => `<li class="map ready">
      ${art({ id: savedMap(e), icon: 'clock', ready: true })}
      <div class="t"><b>${esc(e.name)}</b><small>${esc(describe(e.summary))}</small><small>Saved ${esc(when(e.savedAt))}${oldNote(e)}</small></div>
      <div class="go"><button class="act primary" data-open="${i}">${icon('play')}<span>Open</span></button><button class="act" data-del="${i}" aria-label="Delete ${esc(e.name)}, saved ${esc(when(e.savedAt))}">${icon('trash')}</button></div>
    </li>`).join('')}</ul>
    <p class="fine">Saved towns are kept in this browser on this device.</p>`;
}

// a map's card art: its picture, or its icon on a tile
const art = (m: Pick<MapInfo, 'id' | 'icon' | 'ready'>) => artFor(m.id)
  ? `<i class="art pic${m.ready ? '' : ' off'}"><img src="${artFor(m.id)}" alt="" decoding="async" loading="lazy"></i>`
  : `<i class="art${m.ready ? '' : ' off'}">${icon(m.icon)}</i>`;

function newGame(notice?: string) {
  return `${notice ? `<p class="notice" role="status">${icon('info')}<span>${esc(notice)}</span></p>` : ''}
    <ul class="maps">${MAPS.filter((m) => !m.inRegion).map((m) => `<li class="map${m.ready ? ' ready' : ''}">
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
    </section>
    <section class="grp danger"><h3>Saved data</h3>
      <p class="fine">Deletes every saved town, the settings above and the app's offline copy on this device, so the game starts completely fresh with the latest version. It can't be undone.</p>
      <button class="act wide" data-wipe>${icon('trash')}<span>Delete all saved data</span></button>
    </section>`;
}

function about() {
  return `<section class="grp about">
      <p><b>${NAME}</b> is a working title. It’s a prototype of a transport game: build roads, bus lines and railways, and the town grows around the service you give it.</p>
      <h3>Credits</h3>
      <ul class="credits">
        <li><b>Map data</b> © OpenStreetMap contributors, under the Open Database Licence (ODbL). Real Town Plans builds its plans from it: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a></li>
        <li><b>Real regions</b> Contains OS data © Crown copyright and database right ${new Date().getFullYear()}: OS OpenMap - Local, Terrain 50, Open Rivers, Open Names and Open Greenspace, under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">Open Government Licence</a></li>
        <li><b>Icons</b> Tabler Icons, MIT licence</li>
        <li><b>Type</b> League Spartan and Archivo, SIL Open Font Licence</li>
        <li><b>3D</b> three.js, MIT licence</li>
        <li><b>Maps on Real Town Plans</b> Leaflet, BSD licence</li>
      </ul>
      <p class="fine">Vehicle makers and brands in the game are invented.</p>
    </section>`;
}

const TITLES: Record<Exclude<Screen, 'home'>, [string, Icon]> = {
  saves: ['Saved towns', 'clock'],
  new: ['New game', 'play'],
  region: ['Region', 'map'],
  how: ['How to play', 'finger'],
  library: ['Library', 'layers'],
  settings: ['Settings', 'cog'],
  about: ['About', 'info'],
};

/** Draw a screen into the menu's root, and wire it. */
export function render(root: HTMLElement, screen: Screen, h: MenuHost, notice?: string) {
  const body = screen === 'home' ? home(h) : screen === 'saves' ? saves(h) : screen === 'new' ? newGame(notice) : screen === 'region' ? regionFirst(lastRegion()) : screen === 'how' ? how() : screen === 'library' ? library() : screen === 'settings' ? settings() : about();
  const [title, ic] = screen === 'home' ? ['', 'home' as Icon] : TITLES[screen];
  root.innerHTML = `<div class="scr scr-${screen}">
      ${hero(screen === 'home' ? 'hero' : 'hero dim')}
      ${screen === 'home' ? '' : `<header class="bar"><button class="back" data-back aria-label="Back">${icon('arrowLeft')}</button><h2 tabindex="-1">${icon(ic)}<span>${title}</span></h2></header>`}
      <main class="body">${body}</main>
    </div>`;
  root.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => b.addEventListener('click', () => h.go(b.dataset.go as Screen)));
  root.querySelector('[data-back]')?.addEventListener('click', () => h.back());
  root.querySelector('[data-continue]')?.addEventListener('click', () => { if (h.saves[0]) h.open(h.saves[0]); });
  root.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => h.open(h.saves[+b.dataset.open!])));
  root.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.innerHTML = `${icon('trash')}<span>Delete?</span>`; return; }
    h.remove(h.saves[+b.dataset.del!]);
  }));
  root.querySelectorAll<HTMLElement>('[data-play]').forEach((b) => b.addEventListener('click', () => h.play(MAPS.find((m) => m.id === b.dataset.play)!, false)));
  root.querySelector('[data-guide]')?.addEventListener('click', () => h.play(MAPS.find((m) => m.guide && m.ready)!, true));
  root.querySelectorAll<HTMLInputElement>('input[name="q"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) setQuality(r.value === 'auto' ? 'auto' : +r.value); }));
  // (a second tap confirms, as with a saved town's delete)
  const wipe = root.querySelector<HTMLButtonElement>('[data-wipe]');
  wipe?.addEventListener('click', () => {
    if (wipe.dataset.sure !== '1') { wipe.dataset.sure = '1'; wipe.classList.add('primary'); wipe.innerHTML = `${icon('trash')}<span>Tap again to delete everything</span>`; return; }
    wipe.disabled = true;
    wipe.innerHTML = `${icon('trash')}<span>Deleting…</span>`;
    h.wipe();
  });
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
    }, (q) => h.play(MAPS.find((m) => m.id === new URLSearchParams(q).get('map')) ?? region, false, q));
    wire(lastRegion());
  }
  // move focus to the new screen's heading, so a screen reader reads where it landed
  root.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/** The screen shown while the game loads, and if it fails to. */
const TIPS = [
  'Stops about a three-minute walk apart catch the most riders.',
  'Tap a line’s card to see what it earns a day.',
  'Overlays shows who your stops reach, and where traffic is heavy.',
  'Busy stops mean a line needs another bus.',
  'A town that’s well served grows taller and denser.',
  'Tap anything on the map to see what it is.',
];

export function loading(root: HTMLElement, map: MapInfo) {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  root.innerHTML = `<div class="scr scr-load" role="status" aria-live="polite">
      ${hero('hero loadart', artFor(map.id))}
      <div class="load">${markSvg('bigmark')}<b>${esc(map.name)}</b><span data-load-msg>Building the town…</span><i class="bar-anim"></i>
        <p class="tip">${icon('info')}<span>${esc(tip)}</span></p></div>
    </div>`;
}
