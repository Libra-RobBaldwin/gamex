// The app's front door (index.html): the start menu, then the game. The menu is plain DOM and
// paints at once; the 3D game (src/proto/main.ts) is a dynamic import, loaded only when a map is
// picked or a deep link (`/?map=<id>`, `/?place=<id>`) asks for one.
//
// The game can't be taken down and started again in the same page (its module runs once, with
// its own frame loop and listeners), so leaving a game reloads the page into the menu. History:
// the menu's screens are entries of their own (#new, #how, …), and a game sits one entry after
// the menu, so the phone's back button steps back out of a game to the menu, asking first.

import './app.css';
import '../proto/ui/fonts';
import { icon } from '../proto/ui/icons';
import { mapById, type MapInfo } from '../proto/maps';
import { deleteAllSaves, deleteSave, listSaves, saveSearch, type SaveEntry } from '../proto/game/savedb';
import type { Shell } from '../proto/ui/shell';
import { goneSave, loading, render, type MenuHost } from './menu';
import { gameSearch, route, screenOf, type Screen } from './route';
import { forgetSettings, guideSeen, quality, setQuality } from './store';

// a menu entry's depth: 0 for the home screen (or a screen opened by a link), 1 for one opened from it
type AppState = { app: 'menu'; depth: number } | { app: 'game' };
const root = document.querySelector<HTMLElement>('#app')!;
const menuUrl = () => location.pathname;
let inGame = false, leaving = false, gameUrl = '';

// Saved towns (game/savedb.ts) are read as the menu opens; Continue and Saved towns appear once
// they're in (a moment later: IndexedDB answers after the first paint).
let current: Screen = 'home';
function readSaves() {
  listSaves().then((list) => {
    host.saves = list;
    if (!inGame && (current === 'home' || current === 'saves')) show(current);
  }, () => { /* no storage here: no saves to offer */ });
}

const host: MenuHost = {
  go(screen) {
    history.pushState({ app: 'menu', depth: screen === 'home' ? 0 : 1 } satisfies AppState, '', screen === 'home' ? menuUrl() : `${menuUrl()}#${screen}`);
    show(screen);
  },
  back() {
    const st = history.state as AppState | null;
    if (st?.app === 'menu' && st.depth > 0) history.back();
    else { history.replaceState({ app: 'menu', depth: 0 } satisfies AppState, '', menuUrl()); show('home'); }
  },
  play(map, guide, query) {
    if (inGame) return; // (a second tap on Play while the first loads)
    gameUrl = `${menuUrl()}${gameSearch(map, query)}`;
    history.pushState({ app: 'game' } satisfies AppState, '', gameUrl);
    void startGame(map, guide || !guideSeen());
  },
  saves: [],
  open(e: SaveEntry) {
    if (inGame || goneSave(e)) return; // (a town on a map the game no longer has: it can only be deleted)
    const map = mapById(new URLSearchParams(e.map.query).get('map') ?? e.map.id) ?? mapById(e.map.id);
    if (!map) return;
    gameUrl = `${menuUrl()}${saveSearch(e)}`;
    history.pushState({ app: 'game' } satisfies AppState, '', gameUrl);
    void startGame(map, false);
  },
  remove(e: SaveEntry) {
    deleteSave(e.id).then(readSaves, readSaves);
  },
  async wipe() {
    // every saved town, the menu's settings, and the offline worker and its caches, then a fresh start
    await deleteAllSaves().catch(() => {});
    forgetSettings();
    try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* no caches here */ }
    try { for (const r of (await navigator.serviceWorker?.getRegistrations()) ?? []) await r.unregister(); } catch { /* no worker */ }
    location.replace(menuUrl());
  },
};

function show(screen: Screen, notice?: string) {
  current = screen;
  render(root, screen, host, notice);
  if (!performance.getEntriesByName('menu-shown').length) performance.mark('menu-shown'); // (for e2e/menu.e2e.mjs)
  root.scrollTop = 0;
}

// ---------------- the game ----------------
async function startGame(map: MapInfo, guide: boolean) {
  inGame = true;
  loading(root, map);
  // let the loading screen paint before the game's module (and three.js) is fetched and run
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    await map.load?.();
    document.body.dataset.app = 'game';
    // (the guide's small module comes down alongside the game's, so it's ready when the game is)
    const wantGuide = guide && !!map.guide;
    const [game, g] = await Promise.all([import('../proto/main'), wantGuide ? import('./guide') : null]);
    // (the first save puts the town's id in the address: keep the game's entry at it, so back and forward find the same town)
    game.linkMenu({ quality: quality(), onQuality: setQuality, onMenu: askLeave, onSaved: (e) => { gameUrl = `${menuUrl()}${saveSearch(e)}`; } });
    // hold the loading screen until the game has drawn its first frames (the first can be slow
    // while shaders compile), so the town appears rather than a moment of empty sky
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
    root.replaceChildren();
    root.hidden = true;
    g?.runGuide();
  } catch (e) {
    // most often: offline, and the game was never downloaded on this device
    console.warn('The game did not load', e);
    document.body.dataset.app = 'menu';
    const msg = root.querySelector('[data-load-msg]');
    if (msg) {
      msg.innerHTML = `${navigator.onLine ? 'The game couldn’t load. Try again.' : 'You’re offline, and the game hasn’t been downloaded on this device yet. Connect once to play offline.'}`;
      root.querySelector('.bar-anim')?.remove();
      const again = Object.assign(document.createElement('button'), { className: 'act primary' });
      again.innerHTML = `${icon('refresh')}<span>Back to the menu</span>`;
      again.addEventListener('click', () => location.replace(menuUrl()));
      root.querySelector('.load')!.append(again);
    }
  }
}

const shell = () => (window as unknown as { proto?: { shell?: Shell } }).proto?.shell;

// Leaving saves the town first (Continue on the menu opens it again), so ask; a second press of
// back while asked leaves.
const saveNow = () => (window as unknown as { proto?: { saveGame?: (why: string) => Promise<boolean> } }).proto?.saveGame?.('auto') ?? Promise.resolve(false);
function askLeave() {
  const s = shell();
  if (!s) return leave();
  const el = s.openSheet({
    key: 'leave', title: 'Back to the start menu?', icon: 'home', from: 'menu',
    body: `<div class="grp"><small>Your town is saved as you go. Continue on the start menu opens it again where you left it.</small>
      <button data-leave class="act primary">${icon('home')}<span>Save and leave</span></button>
      <button data-stay class="act">${icon('play')}<span>Keep playing</span></button></div>`,
  });
  el.querySelector('[data-leave]')!.addEventListener('click', async (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    await saveNow();
    leave();
  });
  el.querySelector('[data-stay]')!.addEventListener('click', () => s.closeSheet());
}
const asking = () => shell()?.sheetKey === 'leave';

function leave() {
  leaving = true;
  // step back to the menu's entry, and reload there (popstate below); if there's none, go directly
  if (history.state?.app === 'game') {
    history.back();
    // (if the step back didn't happen, the address still names the game: go to the menu directly)
    setTimeout(() => { if (new URLSearchParams(location.search).has('map')) location.replace(menuUrl()); }, 800);
  } else location.replace(menuUrl());
}

window.addEventListener('popstate', (e) => {
  const st = e.state as AppState | null;
  if (inGame) {
    if (leaving || asking()) { leaving = true; void saveNow().finally(() => location.reload()); return; }
    // back from a game: stay on the game's entry while asking
    history.pushState({ app: 'game' } satisfies AppState, '', gameUrl);
    askLeave();
    return;
  }
  // forward into a game from the menu: start it as a deep link would
  if (st?.app === 'game' || new URLSearchParams(location.search).has('map')) { location.reload(); return; }
  show(screenOf(location.hash));
});

// ---------------- start ----------------
const r = route(location.search, location.hash);
if (r.kind === 'game') {
  // a deep link: put the menu behind the game, so back leads there (not on a reload, which
  // already has it: history.state survives reloads)
  gameUrl = location.pathname + location.search;
  if (history.state?.app !== 'game') {
    history.replaceState({ app: 'menu', depth: 0 } satisfies AppState, '', menuUrl());
    history.pushState({ app: 'game' } satisfies AppState, '', gameUrl);
  }
  void startGame(r.map, r.guide);
} else {
  // (a map that isn't there, or isn't ready, opens the list of maps, saying so)
  const keep = (history.state as AppState | null)?.app === 'menu' ? history.state : { app: 'menu', depth: 0 };
  history.replaceState(keep, '', r.notice ? `${menuUrl()}#region` : location.pathname + location.hash);
  show(r.notice ? 'region' : r.screen, r.notice);
  readSaves();
}

// the site's offline worker (public/sw.js), registered from the menu so a visit that never
// starts a game still gets it
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
