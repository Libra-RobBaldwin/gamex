// New game > Region: the choices a generated region is made from, before it's made (like a
// Transport Fever new-game screen). The options and their limits are the region's own
// (region/options.ts, pure, no three.js); the same options always make the same map, and the
// game reads them from the address (?map=region&seed=…). The last region started is remembered.

import { DEFAULT_OPTIONS, LIMITS, STYLES, optionsFromQuery, optionsQuery, regionOptions, type RegionOptions, type Style } from '../proto/region/options';
import { icon } from '../proto/ui/icons';
import { KEYS, load, save } from './store';

const STYLE_NAMES: Record<Style, [string, string]> = {
  temperate: ['Temperate', 'Green fields, woods and hedgerows'],
  desert: ['Desert', 'Dry, open land with few trees'],
  arctic: ['Arctic', 'Snow, and thin woods'],
};

/** The options last started (or the defaults). */
export function lastRegion(): RegionOptions {
  const q = load(KEYS.region);
  return q ? optionsFromQuery(new URLSearchParams(q)) : regionOptions();
}

type Counted = 'rivers' | 'lakes' | 'towns' | 'villages';
const COUNTS: [Counted, string, string][] = [
  ['rivers', 'Rivers', 'Each runs right across the map'],
  ['lakes', 'Lakes', ''],
  ['towns', 'Market towns', ''],
  ['villages', 'Villages', ''],
];
// lakes and villages can be left to the seed (−1)
const AUTO: Partial<Record<Counted, true>> = { lakes: true, villages: true };

// The setup is a few simple steps, one question each, a tap on a card answering it and moving
// on (the user: "simple, easy to follow steps", not everything on one screen), then a summary
// with the one big button, and the finer settings folded away under More options.
// Kinds of place (landforms: region/options.ts will carry more as the generator grows them)
interface Pick { id: string; name: string; note: string; ic: Parameters<typeof icon>[0]; patch: Partial<RegionOptions> }
const PLACES: Pick[] = [
  { id: 'rolling', name: 'Rolling country', note: 'Gentle hills, a river through the valley, woods and farms', ic: 'trees', patch: { relief: 'rolling', rivers: 1, lakes: -1 } },
  { id: 'vale', name: 'Wide vale', note: 'Flat, open farmland with slow rivers', ic: 'wheat', patch: { relief: 'lowland', rivers: 2, lakes: 1 } },
  { id: 'uplands', name: 'Hills and lakes', note: 'High ground, deep valleys, lakes in the hollows', ic: 'mountain', patch: { relief: 'upland', rivers: 1, lakes: 3 } },
  { id: 'mountains', name: 'Mountains', note: 'Big peaks and passes; towns squeeze into the valleys', ic: 'mountain', patch: { relief: 'mountain', rivers: 1, lakes: 2 } },
];
const CLIMATES: [Style, string, string, Parameters<typeof icon>[0]][] = [
  ['temperate', 'Temperate', 'Green fields, woods and hedgerows', 'trees'],
  ['arctic', 'Cold', 'Snow, and dark pine woods', 'mountain'],
  ['desert', 'Dry', 'Sun-baked land with few trees', 'sparkles'],
];
const SIZES: Pick[] = [
  { id: 'villages', name: 'Villages', note: 'A market town and lots of small places to link up', ic: 'home', patch: { city: false, towns: 1, villages: 10 } },
  { id: 'towns', name: 'Market towns', note: 'A few towns and the villages round them', ic: 'building', patch: { city: false, towns: 4, villages: -1 } },
  { id: 'city', name: 'A city and towns', note: 'A city in the middle, where the lines meet', ic: 'building', patch: { city: true, towns: 3, villages: -1 } },
];
const STEPS = ['Kind of place', 'Climate', 'Towns', 'Ready'];
let step = 0;
/** Open the setup: at the first step, or at the summary with the choices kept if a region has
 *  been made before (coming back from one, say), where each line still changes its step. */
export function regionFirst(o: RegionOptions) { step = load(KEYS.region) ? STEPS.length - 1 : 0; return regionBody(o); }
const same = (o: RegionOptions, patch: Partial<RegionOptions>) => Object.entries(patch).every(([k, v]) => (o as unknown as Record<string, unknown>)[k] === v);
const cards = (list: { id: string; name: string; note: string; ic: Parameters<typeof icon>[0]; on: boolean }[], attr: string) =>
  `<div class="picks">${list.map((c) => `<button class="pick${c.on ? ' on' : ''}" ${attr}="${c.id}"><i>${icon(c.ic)}</i><span><b>${c.name}</b><small>${c.note}</small></span>${c.on ? icon('check', 'tick') : ''}</button>`).join('')}</div>`;

export function regionBody(o: RegionOptions) {
  const dots = `<div class="steps" aria-label="Step ${step + 1} of ${STEPS.length}">${STEPS.map((_, i) => `<span class="${i === step ? 'on' : i < step ? 'done' : ''}">${i < step ? icon('check') : i + 1}</span>`).join('')}</div>`;
  const nav = (next: string) => `<div class="stepnav">${step ? `<button class="act" data-prev>${icon('arrowLeft')}<span>Back</span></button>` : '<span></span>'}${next}</div>`;
  if (step === 0) return `${dots}<h3 class="q">What kind of place?</h3>
    ${cards(PLACES.map((p) => ({ ...p, on: same(o, p.patch) })), 'data-place')}
    <button class="act wide lib-link" data-surprise>${icon('sparkles')}<span>Surprise me</span></button>
    ${nav(`<button class="act primary" data-next>${icon('play')}<span>Next</span></button>`)}`;
  if (step === 1) return `${dots}<h3 class="q">What's the climate?</h3>
    ${cards(CLIMATES.map(([id, name, note, ic]) => ({ id, name, note, ic, on: o.style === id })), 'data-climate')}
    ${nav(`<button class="act primary" data-next>${icon('play')}<span>Next</span></button>`)}`;
  if (step === 2) return `${dots}<h3 class="q">How big are the places?</h3>
    ${cards(SIZES.map((p) => ({ ...p, on: same(o, p.patch) })), 'data-size')}
    ${nav(`<button class="act primary" data-next>${icon('play')}<span>Next</span></button>`)}`;
  // the summary: what was picked (tap a line to change it), the big button, and the rest folded away
  const place = PLACES.find((p) => same(o, p.patch)), size = SIZES.find((p) => same(o, p.patch)), clim = CLIMATES.find((c) => c[0] === o.style)!;
  const count = (k: Counted, label: string, note: string) => {
    const v = o[k], [lo, hi] = LIMITS[k], auto = AUTO[k] && v === -1;
    return `<div class="stepper" data-count="${k}">
        <span class="t"><b>${label}</b>${note ? `<small>${note}</small>` : AUTO[k] ? '<small>Auto lets the seed decide</small>' : ''}</span>
        <button class="act sm" data-step="-1" aria-label="Fewer ${label.toLowerCase()}" ${(AUTO[k] ? auto : v <= lo) ? 'disabled' : ''}>${icon('minus')}</button>
        <output aria-live="polite">${auto ? 'Auto' : v}</output>
        <button class="act sm" data-step="1" aria-label="More ${label.toLowerCase()}" ${v >= hi ? 'disabled' : ''}>${icon('plus')}</button>
      </div>`;
  };
  return `${dots}<h3 class="q">Your region</h3>
    <div class="summary">
      <button data-goto="0">${icon(place?.ic ?? 'adjustments')}<span><small>Place</small><b>${place?.name ?? 'Your own mix'}</b></span>${icon('chevronDown', 'go')}</button>
      <button data-goto="1">${icon(clim[3])}<span><small>Climate</small><b>${clim[1]}</b></span>${icon('chevronDown', 'go')}</button>
      <button data-goto="2">${icon(size?.ic ?? 'building')}<span><small>Towns</small><b>${size?.name ?? 'Your own mix'}</b></span>${icon('chevronDown', 'go')}</button>
    </div>
    <button class="act primary wide big" data-start>${icon('play')}<span>Make this region</span></button>
    <details class="more"><summary>${icon('adjustments')}<span>More options</span></summary>
      <div class="seedrow"><input id="rg-seed" type="number" inputmode="numeric" min="0" value="${o.seed}" aria-label="Seed">
        <button class="act" data-shuffle>${icon('refresh')}<span>New seed</span></button></div>
      <p class="fine">The same seed and choices always make the same map, so a seed is a way to share one.</p>
      <div class="opts" role="radiogroup" aria-label="Climate" hidden>${STYLES.map((st) => `<label class="opt"><input type="radio" name="rg-style" value="${st}" ${o.style === st ? 'checked' : ''}><span><b>${STYLE_NAMES[st][0]}</b></span></label>`).join('')}</div>
      <label class="opt"><input type="checkbox" id="rg-city" ${o.city ? 'checked' : ''}><span><b>A city in the middle</b><small>The biggest place, where the lines meet</small></span></label>
      ${COUNTS.map(([k, l, n]) => count(k, l, n)).join('')}
      <button class="act wide lib-link" data-defaults>${icon('restore')}<span>Back to the defaults</span></button>
    </details>
    ${nav('')}`;
}

/** Wire the screen; `start` gets the query that makes the map. */
export function bindRegion(root: HTMLElement, o0: RegionOptions, redraw: (o: RegionOptions) => void, start: (query: string) => void) {
  let o = { ...o0 };
  const set = (patch: Partial<RegionOptions>, draw = true) => { o = regionOptions({ ...o, ...patch }); if (draw) redraw(o); };
  const go = (n: number) => { step = Math.max(0, Math.min(STEPS.length - 1, n)); redraw(o); };
  const on = (sel: string, f: (el: HTMLElement) => void) => root.querySelectorAll<HTMLElement>(sel).forEach((el) => el.addEventListener('click', () => f(el)));
  // (a card answers its step and moves on)
  on('[data-place]', (el) => { const p = PLACES.find((x) => x.id === el.dataset.place)!; o = regionOptions({ ...o, ...p.patch }); go(step + 1); });
  on('[data-climate]', (el) => { o = regionOptions({ ...o, style: el.dataset.climate as Style }); go(step + 1); });
  on('[data-size]', (el) => { const p = SIZES.find((x) => x.id === el.dataset.size)!; o = regionOptions({ ...o, ...p.patch }); go(step + 1); });
  on('[data-surprise]', () => {
    const r = (n: number) => Math.floor(Math.random() * n);
    o = regionOptions({ ...o, ...PLACES[r(PLACES.length)].patch, ...SIZES[r(SIZES.length)].patch, style: CLIMATES[r(CLIMATES.length)][0], seed: r(99999) + 1 });
    go(STEPS.length - 1);
  });
  on('[data-next]', () => go(step + 1));
  on('[data-prev]', () => go(step - 1));
  on('[data-goto]', (el) => go(Number(el.dataset.goto)));
  const seed = root.querySelector<HTMLInputElement>('#rg-seed');
  seed?.addEventListener('change', () => set({ seed: Number(seed.value) }));
  on('[data-shuffle]', () => set({ seed: Math.floor(Math.random() * 99999) + 1 }));
  root.querySelectorAll<HTMLInputElement>('input[name="rg-style"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) set({ style: r.value as Style }, false); }));
  root.querySelector<HTMLInputElement>('#rg-city')?.addEventListener('change', (e) => set({ city: (e.target as HTMLInputElement).checked }));
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((row) => {
    const k = row.dataset.count as Counted;
    row.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const st = Number(b.dataset.step), [lo, hi] = LIMITS[k], v = o[k];
      // (Auto sits below the lowest count: stepping up from it starts at the lowest)
      const next = AUTO[k] ? (v === -1 ? lo : v + st < lo ? -1 : Math.min(hi, v + st)) : Math.max(lo, Math.min(hi, v + st));
      set({ [k]: next } as Partial<RegionOptions>);
    }));
  });
  on('[data-defaults]', () => set({ ...DEFAULT_OPTIONS }));
  // (the folded options stay open while they're being changed)
  const more = root.querySelector<HTMLDetailsElement>('details.more');
  if (more && openMore) more.open = true;
  more?.addEventListener('toggle', () => { openMore = more.open; });
  on('[data-start]', () => {
    if (seed) set({ seed: Number(seed.value) }, false);
    const q = optionsQuery(o);
    save(KEYS.region, q);
    start(q);
  });
}
let openMore = false;
