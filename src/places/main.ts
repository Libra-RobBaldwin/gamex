// Real Town Plans: a postcode, an area on the map, and the game's OpenStreetMap importer building
// that area's plan, all in the browser. Four steps, one screen each: find, pick, fetch, plans.
//
// PRIVACY: the postcode lives in the input box and in one request to postcodes.io (postcode.ts).
// It is never stored, logged or put in the URL; built areas are saved by area and name only.
// Map data © OpenStreetMap contributors (ODbL): credited on the map, on the plans and in the file.

import '../proto/ui/fonts';
import './places.css';
import { markSvg } from '../proto/ui/brand';
import { fixtureText, mergeTiles, trimJson } from '../proto/osm/fetch';
import type { LatLon } from '../proto/osm/projection';
import { SIZES_KM, areaId, bboxCentre, tilesOf } from './area';
import type { Built } from './build';
import { icon } from './icons';
import { AreaMap } from './map';
import { FetchError, MIRRORS, fetchTiles, type Progress } from './overpass';
import { PostcodeError, lookupPostcode } from './postcode';
import { deleteArea, getArea, getFiles, listAreas, saveArea, type AreaMeta } from './store';
import { PlanViewer } from './viewer';

/**
 * "Play it in 3D" opens the game on an area. The game has to be able to start from an imported
 * world first (the real-town stream: src/proto/town). Until it can, the button says so. Flip this
 * once proto.html reads `?place=<id>` and loads it with store.ts placeData(): see docs/places.md.
 */
const GAME_READS_PLACES = false;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const km = (v: number) => `${v} km`;
const bytes = (n: number) => (n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area';

// ---------------- the page ----------------

document.body.innerHTML = `
<header class="top">
  ${markSvg('mark')}
  <div class="brand"><span class="name">Untitled</span><span class="what">Real Town Plans</span></div>
</header>
<main>
  <section id="find" class="step">
    <div class="card facet">
      <span class="tab">Step 1</span>
      <h1>Find your town</h1>
      <p class="lede">Type a UK postcode. The game’s map importer will build a plan of the area around it, right here in your browser.</p>
      <form id="pc-form" autocomplete="off" novalidate>
        <label for="pc">Postcode</label>
        <div class="row">
          <input id="pc" name="pc-lookup" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="10" placeholder="e.g. OX16 5QA" aria-describedby="pc-msg pc-privacy" />
          <button class="act primary" type="submit" id="pc-go">${icon('search')}<span>Find</span></button>
        </div>
        <p id="pc-msg" class="msg" role="status" aria-live="polite"></p>
      </form>
      <p id="pc-privacy" class="fine">${icon('info', 'ic sm')}Your postcode goes only to <a href="https://postcodes.io" target="_blank" rel="noopener">postcodes.io</a> to find the spot. This page never saves it, and it isn’t kept with your areas.</p>
    </div>
    <div class="card facet" id="saved-card">
      <span class="tab">Saved on this device</span>
      <ul id="saved" class="saved"></ul>
    </div>
    <p class="credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, under the Open Database Licence.</p>
  </section>

  <section id="area" class="step" hidden>
    <div id="map" aria-label="Map: move the square to the area you want"></div>
    <div class="sheet facet" role="group" aria-label="Choose the area">
      <p class="hint">${icon('move', 'ic sm')}Drag the handle, or tap the map, to move the square.</p>
      <div class="sizes" role="radiogroup" aria-label="Size of the square">
        ${SIZES_KM.map((s) => `<button type="button" role="radio" class="chip" data-size="${s}" aria-checked="false">${km(s)}</button>`).join('')}
      </div>
      <div class="row">
        <label for="area-name" class="vh">Name</label>
        <input id="area-name" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Name this area" />
        <button type="button" class="act" id="square-here" title="Move the square to the middle of the map">${icon('here')}<span>Square here</span></button>
      </div>
      <p id="area-note" class="msg"></p>
      <div class="row end">
        <button type="button" class="act ghost" id="area-back">${icon('back')}<span>Back</span></button>
        <button type="button" class="act primary" id="area-build">${icon('check')}<span>Build plan</span></button>
      </div>
    </div>
  </section>

  <section id="fetch" class="step" hidden>
    <div class="card facet">
      <span class="tab">Step 3</span>
      <h1 id="f-title">Fetching the map</h1>
      <p id="f-what" class="lede"></p>
      <div class="bar" role="progressbar" aria-labelledby="f-title" aria-valuemin="0" id="f-bar"><i></i></div>
      <p id="f-count" class="big"></p>
      <p id="f-server" class="msg" role="status" aria-live="polite"></p>
      <p class="fine">The map comes from the public Overpass servers, which volunteers run. The page asks for one tile at a time and waits when a server is busy.</p>
      <p id="f-error" class="msg bad" role="alert"></p>
      <div class="row end">
        <button type="button" class="act ghost" id="f-cancel">${icon('close')}<span>Cancel</span></button>
        <button type="button" class="act primary" id="f-retry" hidden>${icon('refresh')}<span>Try again</span></button>
      </div>
    </div>
  </section>

  <section id="plans" class="step" hidden>
    <div class="plans-head">
      <button type="button" class="act ghost icon-only" id="p-back" aria-label="Back to your areas">${icon('back')}</button>
      <h1 id="p-name"></h1>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" role="tab" id="t-game" aria-selected="true" aria-controls="p-view">Game build</button>
      <button type="button" role="tab" id="t-raw" aria-selected="false" aria-controls="p-view">Raw map data</button>
    </div>
    <div class="view-wrap" id="p-view" role="tabpanel">
      <div class="zoom">
        <button type="button" class="act icon-only" id="z-in" aria-label="Zoom in">${icon('plus')}</button>
        <button type="button" class="act icon-only" id="z-out" aria-label="Zoom out">${icon('minus')}</button>
        <button type="button" class="act icon-only" id="z-fit" aria-label="Show the whole plan">${icon('fit')}</button>
      </div>
      <p class="view-credit">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></p>
    </div>
    <p class="fine center">Pinch or double-tap to zoom, drag to pan.</p>
    <div class="card facet">
      <span class="tab">What the importer built</span>
      <dl id="p-stats" class="stats"></dl>
    </div>
    <div class="card facet">
      <span class="tab">What the game can’t do yet</span>
      <ul id="p-unsup" class="unsup"></ul>
    </div>
    <div class="card facet actions">
      <button type="button" class="act primary" id="p-play">${icon('cube')}<span>Play it in 3D</span></button>
      <p id="p-play-note" class="fine"></p>
      <button type="button" class="act" id="p-download">${icon('download')}<span>Download the map data</span></button>
      <p class="fine" id="p-file"></p>
      <button type="button" class="act ghost" id="p-new">${icon('pin')}<span>Pick another area</span></button>
    </div>
    <p class="credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noopener">Open Database Licence</a>. The downloaded file is too.</p>
  </section>
</main>`;

type Step = 'find' | 'area' | 'fetch' | 'plans';
function go(step: Step) {
  for (const s of ['find', 'area', 'fetch', 'plans'] as Step[]) $(`#${s}`).hidden = s !== step;
  document.body.dataset.step = step;
  window.scrollTo(0, 0);
  if (step === 'area') areaMap?.resize();
  if (step === 'find') refreshSaved();
}

// ---------------- step 1: the postcode ----------------

const pcInput = $<HTMLInputElement>('#pc');
const pcMsg = $('#pc-msg');

$<HTMLFormElement>('#pc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>('#pc-go');
  if (btn.disabled) return;
  btn.disabled = true;
  pcMsg.className = 'msg';
  pcMsg.innerHTML = `${icon('spinner', 'ic sm spin')}Looking it up…`;
  try {
    const place = await lookupPostcode(pcInput.value);
    // the postcode has done its job: clear it so nothing on the page holds it any longer
    pcInput.value = '';
    pcMsg.textContent = '';
    openArea({ lat: place.lat, lon: place.lon }, place.suggest);
  } catch (err) {
    pcMsg.className = 'msg bad';
    pcMsg.textContent = err instanceof PostcodeError ? err.message : 'Something went wrong looking that up. Try again.';
  } finally {
    btn.disabled = false;
  }
});

async function refreshSaved() {
  const ul = $('#saved');
  let list: AreaMeta[];
  try { list = await listAreas(); } catch (err) {
    ul.innerHTML = `<li class="empty">${esc(err instanceof Error ? err.message : 'This browser can’t keep areas.')}</li>`;
    return;
  }
  if (!list.length) { ul.innerHTML = '<li class="empty">Areas you build are kept here, so they open instantly next time.</li>'; return; }
  ul.innerHTML = list.map((a) => `<li>
    <button type="button" class="open" data-id="${esc(a.id)}"><strong>${esc(a.name)}</strong><span>${km(a.sizeKm)} square · ${a.segments} road pieces · ${a.plots} plots · ${bytes(a.bytes)} · ${when(a.savedAt)}</span></button>
    <button type="button" class="act ghost icon-only del" data-id="${esc(a.id)}" aria-label="Delete ${esc(a.name)}">${icon('trash')}</button>
  </li>`).join('');
}
$('#saved').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
  if (!b) return;
  const id = b.dataset.id!;
  if (b.classList.contains('del')) {
    const li = b.closest('li')!;
    if (!li.classList.contains('confirm')) {
      li.classList.add('confirm');
      b.setAttribute('aria-label', 'Tap again to delete');
      b.innerHTML = `${icon('trash')}<span>Delete?</span>`;
      setTimeout(() => refreshSaved(), 4000);
      return;
    }
    await deleteArea(id).catch(() => {});
    refreshSaved();
    return;
  }
  openSaved(id);
});

// ---------------- step 2: the area ----------------

let areaMap: AreaMap | undefined;
const sheet = $('#area .sheet');
new ResizeObserver(() => document.body.style.setProperty('--sheet-h', `${sheet.offsetHeight}px`)).observe(sheet);
let sizeKm = 1.5;
const nameInput = $<HTMLInputElement>('#area-name');

function openArea(at: LatLon, suggest: string) {
  go('area');
  if (!areaMap) {
    areaMap = new AreaMap($('#map'), at, sizeKm);
    areaMap.onChange = () => areaNote();
    areaMap.cover = () => {
      const m = $('#map').getBoundingClientRect(), s = sheet.getBoundingClientRect();
      return s.top > m.top + 10 ? { bottom: Math.max(0, m.bottom - s.top), right: 0 } : { bottom: 0, right: Math.max(0, m.right - s.left) };
    };
    areaMap.fit();
  } else {
    areaMap.moveTo(at);
    areaMap.fit();
  }
  areaMap.setPin(at);
  nameInput.value = suggest;
  setSize(sizeKm);
}

function setSize(s: number) {
  sizeKm = s;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.chip')) b.setAttribute('aria-checked', String(+b.dataset.size! === s));
  areaMap?.setSize(s);
  areaNote();
}
function areaNote() {
  const n = tilesOf(areaMap?.bbox() ?? [0, 0, 0, 0], sizeKm).length;
  $('#area-note').textContent = `${km(sizeKm)} × ${km(sizeKm)}: ${n === 1 ? 'one request' : `${n} requests`} to the map servers.${sizeKm >= 2.5 ? ' Big areas take a while on a busy day.' : ''}`;
}
$('.sizes').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip'); if (b) setSize(+b.dataset.size!); });
$('#square-here').addEventListener('click', () => areaMap?.here());
$('#area-back').addEventListener('click', () => go('find'));
$('#area-build').addEventListener('click', () => {
  if (!areaMap) return;
  const name = nameInput.value.trim() || 'My area';
  startBuild(areaMap.bbox(), sizeKm, name);
});

// ---------------- step 3: fetching and building ----------------

let job: AbortController | undefined;
let tick = 0;
let lastRequest: { bbox: ReturnType<AreaMap['bbox']>; sizeKm: number; name: string } | undefined;

function progress(p: Progress) {
  const bar = $('#f-bar');
  bar.setAttribute('aria-valuemax', String(p.total));
  bar.setAttribute('aria-valuenow', String(p.done));
  (bar.firstElementChild as HTMLElement).style.width = `${(p.done / p.total) * 100}%`;
  $('#f-count').textContent = `${p.done} of ${p.total} ${p.total === 1 ? 'tile' : 'tiles'} done`;
  clearInterval(tick);
  const srv = $('#f-server');
  if (p.state === 'asking') srv.innerHTML = `${icon('spinner', 'ic sm spin')}Asking ${esc(p.server)} for tile ${p.tile}${p.attempt > 1 ? ` (try ${p.attempt})` : ''}…`;
  else if (p.state === 'waiting') {
    const show = () => { const s = Math.max(0, Math.ceil((p.until - Date.now()) / 1000)); srv.innerHTML = `${icon('alert', 'ic sm')}${esc(p.reason)}. Trying ${esc(p.server)} in ${s} s…`; };
    show();
    tick = window.setInterval(show, 250);
  } else srv.textContent = `Tile ${p.tile} came from ${p.server}.`;
}

async function startBuild(bbox: ReturnType<AreaMap['bbox']>, size: number, name: string) {
  const id = areaId(bbox, name);
  lastRequest = { bbox, sizeKm: size, name };
  // built before: open the saved copy straight away
  if (await getArea(id).catch(() => undefined)) { openSaved(id); return; }
  go('fetch');
  $('#f-title').textContent = 'Fetching the map';
  $('#f-what').textContent = `${name}: a ${km(size)} square.`;
  $('#f-error').textContent = '';
  $('#f-retry').hidden = true;
  $('#f-cancel').hidden = false;
  const tiles = tilesOf(bbox, size);
  progress({ state: 'asking', tile: 1, total: tiles.length, done: 0, server: MIRRORS[0].name, attempt: 1 });
  job?.abort();
  const ctl = (job = new AbortController());
  try {
    const parts = await fetchTiles(tiles, { signal: ctl.signal, onProgress: progress, firstMirror: Math.floor(Math.random() * MIRRORS.length) });
    clearInterval(tick);
    const trimmed = trimJson(mergeTiles(parts), bbox);
    if (!trimmed.elements.length) throw new FetchError('OpenStreetMap has nothing to build in this square: no roads, buildings or land use. Try moving it onto a town.', 'gave-up');
    const text = fixtureText(trimmed);
    $('#f-title').textContent = 'Building the plan';
    $('#f-server').innerHTML = `${icon('spinner', 'ic sm spin')}Running the game’s importer on ${trimmed.elements.length.toLocaleString('en-GB')} map features…`;
    const built = await runImport(text, ctl.signal);
    const meta: AreaMeta = { id, name, bbox, sizeKm: size, savedAt: Date.now(), osmBase: trimmed.osm3s?.timestamp_osm_base, bytes: text.length, segments: built.stats.segments, plots: built.stats.plots };
    let saved = true;
    await saveArea(meta, { id, data: text, built }).catch(() => { saved = false; });
    showPlans(meta, text, built, saved);
  } catch (err) {
    clearInterval(tick);
    if (err instanceof FetchError && err.kind === 'cancelled') return;
    $('#f-title').textContent = 'Couldn’t build this area';
    $('#f-server').textContent = '';
    $('#f-error').textContent = err instanceof Error ? err.message : String(err);
    $('#f-retry').hidden = false;
  } finally {
    if (job === ctl) job = undefined;
  }
}

function runImport(text: string, signal: AbortSignal): Promise<Built> {
  return new Promise((res, rej) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const stop = () => { w.terminate(); rej(new FetchError('Cancelled', 'cancelled')); };
    signal.addEventListener('abort', stop, { once: true });
    w.onmessage = (e) => {
      signal.removeEventListener('abort', stop);
      w.terminate();
      if (e.data.ok) res(e.data.built); else rej(new Error(`The importer failed on this area: ${e.data.error}`));
    };
    w.onerror = (e) => { signal.removeEventListener('abort', stop); w.terminate(); rej(new Error(`The importer failed on this area: ${e.message || 'the worker stopped'}`)); };
    w.postMessage({ json: JSON.parse(text) });
  });
}

$('#f-cancel').addEventListener('click', () => { job?.abort(); clearInterval(tick); go(areaMap ? 'area' : 'find'); });
$('#f-retry').addEventListener('click', () => { if (lastRequest) startBuild(lastRequest.bbox, lastRequest.sizeKm, lastRequest.name); });

// ---------------- step 4: the plans ----------------

const viewer = new PlanViewer('Plan of the area');
$('#p-view').prepend(viewer.el);
let current: { meta: AreaMeta; text: string; built: Built } | undefined;

function showTab(which: 'game' | 'raw') {
  if (!current) return;
  $('#t-game').setAttribute('aria-selected', String(which === 'game'));
  $('#t-raw').setAttribute('aria-selected', String(which === 'raw'));
  viewer.el.setAttribute('aria-label', which === 'game' ? 'Plan: what the game built' : 'Plan: the raw OpenStreetMap data');
  viewer.show(which === 'game' ? current.built.gameSvg : current.built.rawSvg);
}
$('#t-game').addEventListener('click', () => showTab('game'));
$('#t-raw').addEventListener('click', () => showTab('raw'));
$('#z-in').addEventListener('click', () => viewer.zoomBy(1.6));
$('#z-out').addEventListener('click', () => viewer.zoomBy(1 / 1.6));
$('#z-fit').addEventListener('click', () => viewer.reset());

function showPlans(meta: AreaMeta, text: string, built: Built, saved = true) {
  current = { meta, text, built };
  go('plans');
  $('#p-name').textContent = meta.name;
  const s = built.stats;
  const rows: [string, string][] = [
    ['Road and rail pieces', `${s.segments.toLocaleString('en-GB')}`],
    ['Roads · railways', `${s.roads} · ${s.railways}`],
    ['Junctions', `${s.junctions}`],
    ['Building plots', `${s.plots.toLocaleString('en-GB')}`],
    ['Roundabouts', `${s.roundabouts}`],
    ['Dual carriageways paired', `${s.pairedDuals}`],
    ['Stations', `${s.stations}`],
    ['Import time', `${(s.importMs / 1000).toFixed(1)} s`],
  ];
  $('#p-stats').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#p-unsup').innerHTML = built.unsupported.length
    ? built.unsupported.map((u) => `<li><strong>${u.count} × ${esc(u.kind)}</strong><span>${esc(u.example)}</span></li>`).join('')
    : '<li class="empty">Nothing: the game can build everything in this area.</li>';
  $('#p-file').textContent = `${meta.name}: ${bytes(meta.bytes)} of trimmed OpenStreetMap data${meta.osmBase ? `, as of ${when(Date.parse(meta.osmBase))}` : ''}${saved ? ', saved on this device' : ' (couldn’t be saved on this device)'}.`;
  const play = $<HTMLButtonElement>('#p-play');
  play.disabled = !GAME_READS_PLACES;
  $('#p-play-note').textContent = GAME_READS_PLACES ? 'Opens the game on this area.' : 'Coming soon: the game is learning to start from a real town.';
  showTab('game');
}

async function openSaved(id: string) {
  const [meta, files] = await Promise.all([getArea(id), getFiles(id)]).catch(() => [undefined, undefined]);
  if (!meta || !files) { refreshSaved(); return; }
  showPlans(meta, files.data, files.built);
}

$('#p-download').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([current.text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${slug(current.meta.name)}-osm.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
$('#p-play').addEventListener('click', () => {
  if (!current || !GAME_READS_PLACES) return;
  location.href = `proto.html?place=${encodeURIComponent(current.meta.id)}`;
});
$('#p-new').addEventListener('click', () => {
  if (areaMap && current) { areaMap.moveTo(bboxCentre(current.meta.bbox)); setSize(current.meta.sizeKm); nameInput.value = current.meta.name; go('area'); areaMap.fit(); }
  else if (current) openArea(bboxCentre(current.meta.bbox), current.meta.name);
  else go('find');

// the site's offline worker (public/sw.js, shared with the game): with it, this page and every area
// saved on the device open without a connection
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
});
$('#p-back').addEventListener('click', () => { viewer.dispose(); go('find'); });

go('find');

// the site's offline worker (public/sw.js, shared with the game): with it, this page and every area
// saved on the device open without a connection
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
