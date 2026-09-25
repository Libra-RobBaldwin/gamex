// New game > Region: the choices a generated region is made from, before it's made (like a
// Transport Fever new-game screen). The options and their limits are the region's own
// (region/options.ts, pure, no three.js); the same options always make the same map, and the
// game reads them from the address (?map=region&seed=…). The last region started is remembered.

import { DEFAULT_OPTIONS, SIZES, STYLES, limitsFor, optionsFromQuery, optionsQuery, regionOptions, type RegionOptions, type Style } from '../proto/region/options';
import { icon } from '../proto/ui/icons';
import { KEYS, load, save } from './store';

// the map's size: 50 km is the standard map (streamed round you: docs/streaming.md); larger ones later
const SIZE_NAMES: Record<number, [string, string]> = {
  50: ['50 km', 'The standard map: cities, market towns, villages, hills and a coast, streamed round you'],
  6: ['6 km', 'The first region: a city and a few towns, all built before you start'],
};
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
// lakes and villages can be left to the seed (−1), and on a 50 km map the towns too
const AUTO: Partial<Record<Counted, true>> = { lakes: true, villages: true };
const auto = (k: Counted, o: RegionOptions) => AUTO[k] || (k === 'towns' && o.size > 6);

export function regionBody(o: RegionOptions) {
  const count = (k: Counted, label: string, note: string) => {
    const v = o[k], [lo, hi] = limitsFor(o.size)[k], au = auto(k, o), isAuto = au && v === -1;
    return `<div class="stepper" data-count="${k}">
        <span class="t"><b>${label}</b>${note ? `<small>${note}</small>` : au ? '<small>Auto lets the seed decide</small>' : ''}</span>
        <button class="act sm" data-step="-1" aria-label="Fewer ${label.toLowerCase()}" ${(au ? isAuto : v <= lo) ? 'disabled' : ''}>${icon('minus')}</button>
        <output aria-live="polite">${isAuto ? 'Auto' : v}</output>
        <button class="act sm" data-step="1" aria-label="More ${label.toLowerCase()}" ${v >= hi ? 'disabled' : ''}>${icon('plus')}</button>
      </div>`;
  };
  return `<p class="fine">${o.size > 6 ? 'A map is 50 km across: cities, a dozen market towns and a hundred or more villages, hills, rivers and a coast, linked by motorways, A roads and railways. You start in a market town in the middle; the rest streams in round you.' : 'A region is about 6 km across: a city, market towns and villages, linked by roads and a railway.'} The same choices always make the same map.</p>
    <section class="grp"><h3>Size</h3>
      <div class="opts" role="radiogroup" aria-label="Size">${SIZES.map((k) => `<label class="opt"><input type="radio" name="rg-size" value="${k}" ${o.size === k ? 'checked' : ''}><span><b>${SIZE_NAMES[k][0]}</b><small>${SIZE_NAMES[k][1]}</small></span></label>`).join('')}</div>
    </section>
    <section class="grp"><h3>Seed</h3>
      <div class="seedrow"><input id="rg-seed" type="number" inputmode="numeric" min="0" value="${o.seed}" aria-label="Seed">
        <button class="act" data-shuffle>${icon('refresh')}<span>Shuffle</span></button></div>
      <p class="fine">Each seed is a different region. Share a seed and the choices below to share the map.</p>
    </section>
    <section class="grp"><h3>Landscape</h3>
      <div class="opts" role="radiogroup" aria-label="Landscape">${STYLES.map((s) => `<label class="opt"><input type="radio" name="rg-style" value="${s}" ${o.style === s ? 'checked' : ''}><span><b>${STYLE_NAMES[s][0]}</b><small>${STYLE_NAMES[s][1]}</small></span></label>`).join('')}</div>
    </section>
    <section class="grp"><h3>Places and water</h3>
      <label class="opt"><input type="checkbox" id="rg-city" ${o.city ? 'checked' : ''}><span><b>${o.size > 6 ? 'Cities' : 'A city in the middle'}</b><small>${o.size > 6 ? 'Two, the biggest places, where the lines meet' : 'The biggest place, where the lines meet'}</small></span></label>
      ${o.size > 6 ? `<label class="opt"><input type="checkbox" id="rg-sea" ${o.sea ? 'checked' : ''}><span><b>A coast</b><small>The sea along one edge, and the rivers running down to it</small></span></label>` : ''}
      ${COUNTS.map(([k, l, n]) => count(k, l, n)).join('')}
    </section>
    <button class="act primary wide" data-start>${icon('play')}<span>Make this region</span></button>
    <button class="act wide lib-link" data-defaults>${icon('restore')}<span>Back to the defaults</span></button>`;
}

/** Wire the screen; `start` gets the query that makes the map. */
export function bindRegion(root: HTMLElement, o0: RegionOptions, redraw: (o: RegionOptions) => void, start: (query: string) => void) {
  let o = { ...o0 };
  const set = (patch: Partial<RegionOptions>, draw = true) => { o = regionOptions({ ...o, ...patch }); if (draw) redraw(o); };
  const seed = root.querySelector<HTMLInputElement>('#rg-seed')!;
  seed.addEventListener('change', () => set({ seed: Number(seed.value) }));
  root.querySelector('[data-shuffle]')!.addEventListener('click', () => set({ seed: Math.floor(Math.random() * 99999) + 1 }));
  root.querySelectorAll<HTMLInputElement>('input[name="rg-style"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) set({ style: r.value as Style }, false); }));
  root.querySelector<HTMLInputElement>('#rg-city')!.addEventListener('change', (e) => set({ city: (e.target as HTMLInputElement).checked }));
  root.querySelector<HTMLInputElement>('#rg-sea')?.addEventListener('change', (e) => set({ sea: (e.target as HTMLInputElement).checked }));
  // (a new size starts from its own defaults for the counts)
  root.querySelectorAll<HTMLInputElement>('input[name="rg-size"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) { const d = regionOptions({ seed: o.seed, size: Number(r.value) }); set({ size: d.size, rivers: d.rivers, lakes: d.lakes, towns: d.towns, villages: d.villages }); } }));
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((row) => {
    const k = row.dataset.count as Counted;
    row.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const step = Number(b.dataset.step), [lo, hi] = limitsFor(o.size)[k], v = o[k];
      // (Auto sits below the lowest count: stepping up from it starts at the lowest)
      const next = auto(k, o) ? (v === -1 ? lo : v + step < lo ? -1 : Math.min(hi, v + step)) : Math.max(lo, Math.min(hi, v + step));
      set({ [k]: next } as Partial<RegionOptions>);
    }));
  });
  root.querySelector('[data-defaults]')!.addEventListener('click', () => set(regionOptions({ ...DEFAULT_OPTIONS, size: o.size })));
  root.querySelector('[data-start]')!.addEventListener('click', () => {
    set({ seed: Number(seed.value) }, false);
    const q = optionsQuery(o);
    save(KEYS.region, q);
    start(q);
  });
}
