// The Library: the game's building blocks (vehicles, bridges, people, industries, water, ground),
// each on its explorer page (*-demo.html), listed on the start menu's Library screen. Opened from
// there (`?from=library`), a page becomes part of the app: a way back to the Library, no
// developer readouts, and words rather than emoji. Opened directly, a page is left exactly as
// it is, for development and its tests.

import '../proto/ui/fonts';
import { icon, type Icon } from '../proto/ui/icons';

export interface Explorer { id: string; page: string; name: string; blurb: string; icon: Icon }

export const EXPLORERS: Explorer[] = [
  { id: 'vehicles', page: 'vehicles-demo.html', name: 'Vehicles', icon: 'bus', blurb: 'Every car, van, lorry, bus, train, boat and plane: in a parade, a showroom or on a turntable, filtered by kind, maker and year.' },
  { id: 'bridges', page: 'bridges-demo.html', name: 'Bridges', icon: 'bridge', blurb: 'From timber trestles to suspension bridges: what each type costs, how far it spans, and which one a crossing calls for.' },
  { id: 'people', page: 'people-demo.html', name: 'People and animals', icon: 'users', blurb: 'Crowds at a bus stop, on a high street, at a station, a works gate and a park, through the day and across the eras.' },
  { id: 'industries', page: 'industries-demo.html', name: 'Industries', icon: 'warehouse', blurb: 'Pits, mills, farms and works: how each looks as it runs, fills up, falls into neglect or changes with the years.' },
  { id: 'water', page: 'water-demo.html', name: 'Water', icon: 'droplet', blurb: 'Coasts, river valleys, lakes and uplands, and how the water shapes the land around it.' },
  { id: 'ground', page: 'ground-demo.html', name: 'Ground', icon: 'trees', blurb: 'Fields, hedgerows, woods and town edges: the countryside the game is built on, close up and far off.' },
];

export const LIBRARY_PARAM = 'from';
export const libraryHref = (e: Explorer) => `./${e.page}?${LIBRARY_PARAM}=library`;

// ---------------- on an explorer page ----------------
const FLAG = 'untitled.library';
function inLibrary() {
  const key = `${FLAG}:${location.pathname}`;
  if (new URLSearchParams(location.search).get(LIBRARY_PARAM) === 'library') {
    try { sessionStorage.setItem(key, '1'); } catch { /* not remembered: a reload shows the page as it is */ }
    return true;
  }
  // a reload of a page that rewrote its own address (the vehicles page does) stays in the Library
  const reload = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
  try {
    if (reload && sessionStorage.getItem(key) === '1') return true;
    sessionStorage.removeItem(key);
  } catch { /* storage blocked */ }
  return false;
}

// emoji, except the ones that are plain symbols in running text (© ® ™) and the arrows the
// pages use as Previous and Next (◀ ▶)
const EMOJI = /(?![©®™◀▶])\p{Extended_Pictographic}️?\s?/gu;
// buttons that are only a glyph get a word instead
const WORDS: Record<string, string> = { '⏸': 'Pause', '▶': 'Play' };

function tidy(root: Node) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.nodeValue ?? '';
    const whole = t.trim(), parent = n.parentElement;
    if (parent?.id === 'play' && WORDS[whole]) { n.nodeValue = WORDS[whole]; continue; }
    if (EMOJI.test(t)) { EMOJI.lastIndex = 0; n.nodeValue = t.replace(EMOJI, ''); }
    EMOJI.lastIndex = 0;
  }
}

function backButton() {
  const a = document.createElement('a');
  a.id = 'lib-back';
  a.href = './#library';
  a.innerHTML = `${icon('arrowLeft')}<span>Library</span>`;
  a.setAttribute('aria-label', 'Back to the Library');
  a.addEventListener('click', (e) => {
    // came from the menu's Library in this tab: step back to it, so the phone's back button
    // doesn't then return here
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) { e.preventDefault(); history.back(); }
  });
  return a;
}

function enter() {
  document.documentElement.classList.add('in-library');
  const style = document.createElement('style');
  style.textContent = `
    .in-library #stats, .in-library #perf, .in-library #bench { display: none !important; }
    #lib-back { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px 0 8px; margin: 0 10px 6px 0; vertical-align: middle;
      font: 700 13px/1 'League Spartan', 'Archivo', system-ui, sans-serif; letter-spacing: 0.06em; text-transform: uppercase;
      color: #0a2414; background: #5cb83a; text-decoration: none; pointer-events: auto; -webkit-tap-highlight-color: transparent;
      clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%); }
    #lib-back .ic { width: 18px; height: 18px; stroke-width: 2.2; }
    #lib-back.float { position: fixed; z-index: 20; left: calc(8px + env(safe-area-inset-left)); top: calc(8px + env(safe-area-inset-top)); margin: 0; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
    #top > #lib-back { align-self: flex-start; }`;
  document.head.append(style);
  document.title = `${document.title.replace(/\s*(demo|gallery)$/i, '')} · Library · Untitled`;
  // the back button leads its page's top panel (the vehicles page redraws its panel, so it's put back)
  const place = () => {
    const top = document.getElementById('top');
    let a = document.getElementById('lib-back');
    // (already in place: moving it again would set this observer off again, for ever)
    if (a && (top ? a.parentElement === top && top.firstElementChild === a : a.parentElement === document.body)) return;
    a ??= backButton();
    if (top) { a.classList.remove('float'); top.prepend(a); } else { a.classList.add('float'); document.body.append(a); }
  };
  place();
  tidy(document.body);
  // (only what changed is tidied again: some pages rewrite a readout every frame)
  new MutationObserver((records) => {
    place();
    for (const r of records) {
      if (r.type === 'characterData') { if (r.target.parentNode) tidy(r.target.parentNode); }
      else r.addedNodes.forEach((n) => tidy(n.nodeType === Node.TEXT_NODE && n.parentNode ? n.parentNode : n));
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (typeof document !== 'undefined' && /-demo(\.html)?$/.test(location.pathname) && inLibrary()) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enter);
  else enter();
}
