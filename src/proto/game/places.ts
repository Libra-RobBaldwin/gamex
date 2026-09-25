// Finding your way round a big map (docs/region.md, R5): every settlement's name floats over it
// once you're zoomed out far enough to lose track, and a Places list jumps the camera to any of
// them. Labels are plain DOM (crisp text, no draw calls), placed each frame from the camera.
//
//   const labels = new PlaceLabels(root, map.settlements, { toScreen, onPick });
//   labels.update(view.h);             // each frame (cheap: only moves what's shown)
//   openPlaces(shell, places, onPick)  // the list, nearest first, with how many live there
import type { SettlementInfo } from '../region';
import type { Shell } from '../ui/shell';

const CSS = `
/* (the HUD gives its children pointer events, #ui > *: this layer covers the map, so it must win
   that back, or every drag lands on it instead of the camera; only a shown label takes a tap) */
#ui > .place-labels, .place-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.place-label { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; margin: 0; transform: translate(-50%, -50%); white-space: nowrap; pointer-events: none; cursor: pointer;
  font: 700 15px/1 'League Spartan', 'Archivo', system-ui, sans-serif; color: #fff; letter-spacing: 0.02em; padding: 6px 8px; border: 0; background: none;
  text-shadow: 0 0 3px #0f3322, 0 0 6px rgba(15, 51, 34, 0.9), 0 1px 2px #0f3322; transition: opacity 0.25s ease; }
.place-label.on { pointer-events: auto; }
.place-label.city { font-size: 20px; text-transform: uppercase; letter-spacing: 0.06em; }
.place-label.town { font-size: 16px; }
.place-label.village { font: 600 13px/1 'Archivo', system-ui, sans-serif; }
.place-label small { display: block; margin-top: 4px; font: 500 11px/1 'Archivo', system-ui, sans-serif; color: #e3c47e; text-transform: none; letter-spacing: 0; }
`;
const RANK = { city: 0, town: 1, village: 2 } as const;
// from how far out (the view's height in metres) each kind's name shows, and when villages give way
export const SHOW = { city: 420, town: 480, village: 560, villagesUntil: 3800 };

export interface PlaceLabelOpts {
  toScreen: (p: { x: number; z: number }) => { x: number; y: number };
  onPick: (s: SettlementInfo) => void;
  count?: (s: SettlementInfo) => number | undefined; // people living there, for the second line
}

export class PlaceLabels {
  readonly el: HTMLDivElement;
  private items: { s: SettlementInfo; el: HTMLButtonElement; on: boolean; w: number; h: number }[];
  private lastH = -1;
  constructor(parent: HTMLElement, places: SettlementInfo[], private o: PlaceLabelOpts) {
    if (!document.getElementById('place-labels-css')) { const st = document.createElement('style'); st.id = 'place-labels-css'; st.textContent = CSS; document.head.appendChild(st); }
    this.el = document.createElement('div');
    this.el.className = 'place-labels';
    parent.prepend(this.el); // (first, so the HUD's own panels draw over it)
    // biggest first: they win when two would overlap
    this.items = [...places].sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.r - a.r).map((s) => {
      const el = document.createElement('button');
      el.className = `place-label ${s.kind}`;
      el.type = 'button';
      el.textContent = s.name;
      el.setAttribute('aria-label', `${s.name}, ${s.kind}: go there`);
      el.style.opacity = '0';
      el.hidden = true;
      el.addEventListener('click', (e) => { e.stopPropagation(); o.onPick(s); });
      this.el.appendChild(el);
      return { s, el, on: false, w: 0, h: 0 };
    });
  }
  // Each frame: which names show at this height, and where. Overlapping names give way to bigger places.
  update(viewH: number, force = false) {
    const W = this.el.clientWidth, H = this.el.clientHeight, taken: [number, number, number, number][] = [];
    for (const it of this.items) {
      const want = viewH >= SHOW[it.s.kind] && !(it.s.kind === 'village' && viewH > SHOW.villagesUntil);
      if (!want) { this.hide(it); continue; }
      const p = this.o.toScreen(it.s);
      if (it.el.hidden) { it.el.hidden = false; this.refresh(it); }
      if (!it.w || force || Math.abs(viewH - this.lastH) > 1) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; }
      const box: [number, number, number, number] = [p.x - it.w / 2, p.y - it.h / 2, p.x + it.w / 2, p.y + it.h / 2];
      const off = box[2] < 0 || box[0] > W || box[3] < 0 || box[1] > H;
      const clash = taken.some((t) => box[0] < t[2] + 4 && box[2] > t[0] - 4 && box[1] < t[3] + 2 && box[3] > t[1] - 2);
      if (off || clash) { this.hide(it, true); continue; }
      taken.push(box);
      it.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
      if (!it.on) { it.on = true; it.el.style.opacity = '1'; it.el.classList.add('on'); }
    }
    this.lastH = viewH;
  }
  // the second line (how many live there): refreshed when a label comes into view, or on request
  refresh(it = undefined as undefined | (typeof this.items)[number]) {
    for (const x of it ? [it] : this.items) {
      const n = this.o.count?.(x.s);
      const small = x.el.querySelector('small');
      if (n === undefined) { small?.remove(); continue; }
      const text = `${Math.round(n).toLocaleString('en-GB')} people`;
      if (small) small.textContent = text; else { const e = document.createElement('small'); e.textContent = text; x.el.appendChild(e); }
      x.w = 0;
    }
  }
  private hide(it: (typeof this.items)[number], keep = false) {
    if (it.on) { it.on = false; it.el.style.opacity = '0'; it.el.classList.remove('on'); } // (and no longer takes taps)
    if (!keep) it.el.hidden = true;
  }
  dispose() { this.el.remove(); }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);
const KIND_WORD = { city: 'City', town: 'Market town', village: 'Village' } as const;

// The Places sheet: every settlement, the one you're looking at first, then by distance; tap one to go there.
export function openPlaces(shell: Shell, places: SettlementInfo[], at: { x: number; z: number }, onPick: (s: SettlementInfo) => void, count?: (s: SettlementInfo) => number | undefined) {
  const d = (s: SettlementInfo) => Math.hypot(s.x - at.x, s.z - at.z);
  const list = [...places].sort((a, b) => d(a) - d(b));
  const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
  const rows = list.map((s, i) => {
    const n = count?.(s);
    return `<button class="row" data-place="${i}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 4px;background:none;border:0;border-bottom:1px solid var(--faint);color:inherit;font:inherit;cursor:pointer">
      <span style="flex:1"><b style="font-family:var(--font-display);font-size:16px">${esc(s.name)}</b><br><small style="color:var(--muted)">${KIND_WORD[s.kind]}${n !== undefined ? ` · ${Math.round(n).toLocaleString('en-GB')} people` : ''}</small></span>
      <small style="color:var(--gold-text)">${d(s) < s.r ? 'here' : km(d(s))}</small></button>`;
  }).join('');
  const body = shell.openSheet({ key: 'places', title: 'Places', sub: `${places.length} on this map`, icon: 'pin', body: `<div role="list">${rows}</div>` });
  body.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) => b.addEventListener('click', () => onPick(list[+b.dataset.place!])));
}
