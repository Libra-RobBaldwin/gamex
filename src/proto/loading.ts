// The loading screen: shown while a map is laid out, built and painted, with a bar that moves as
// the work does and a line saying what's being done ("Laying out Harrowley's streets"). A big map
// can take a minute; being able to watch it come together is part of the fun (as in TF2).
//
//   const loading = new Loading('Region', 'seed 7 · 11 places · 1 river');
//   await loading.stage('Laying out the streets', 0.1);   // label, and its share of the whole
//   for (…) { …; await loading.tick(i / n); }               // progress within the stage (yields now and then)
//   loading.finish(); …; loading.done();                   // built; then after the first frame is drawn
//
// Work between yields runs flat out: the page only repaints when a stage starts or a tick finds
// it's been a while, so the screen costs next to nothing.
import { markSvg, NAME } from './ui/brand';

const CSS = `
.loading { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; justify-content: center; align-items: center;
  gap: 18px; padding: 24px; background: radial-gradient(120% 90% at 50% 30%, #1f5e3f 0%, #0f3322 70%); color: #f2f5ef;
  font-family: 'Archivo', system-ui, sans-serif; transition: opacity 0.35s ease; touch-action: none; }
.loading.gone { opacity: 0; pointer-events: none; }
.loading .mark { width: 64px; height: 64px; }
.loading h1 { margin: 0; font: 700 34px/1 'League Spartan', 'Archivo', system-ui, sans-serif; letter-spacing: 0.01em; }
.loading .map { margin: -8px 0 0; font: 600 16px/1.3 'League Spartan', 'Archivo', system-ui, sans-serif; color: #e3c47e; text-align: center; }
.loading .sub { margin: -12px 0 0; font-size: 13px; color: #b3cbbc; text-align: center; }
.loading .bar { width: min(320px, 78vw); height: 10px; background: rgba(255, 255, 255, 0.1); clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 0 100%); }
.loading .fill { height: 100%; width: 0; background: #5cb83a; transition: width 0.15s linear; }
.loading .what { min-height: 1.3em; font-size: 14px; color: #f2f5ef; text-align: center; }
.loading .pct { font: 600 13px/1 'Archivo', system-ui, sans-serif; color: #b3cbbc; font-variant-numeric: tabular-nums; }
`;

// let the page paint (a frame, or a moment if frames aren't coming, as in a hidden tab)
const breathe = () => new Promise<void>((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(() => setTimeout(go, 0));
  setTimeout(go, 120);
});

export class Loading {
  private el: HTMLDivElement;
  private fill: HTMLDivElement;
  private what: HTMLDivElement;
  private pct: HTMLDivElement;
  private base = 0; // share done before this stage
  private share = 0; // this stage's share
  private shown = 0; // what the bar shows (it never goes back)
  private last = 0; // when the page last repainted
  readonly started = performance.now();
  // stage timings (ms), for tuning the shares and for tests
  readonly times: { label: string; ms: number }[] = [];
  private stageAt = 0;

  constructor(map: string, sub = '') {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.innerHTML = `${markSvg()}<h1>${NAME}</h1><p class="map"></p><p class="sub"></p><div class="bar"><div class="fill"></div></div><div class="what"></div><div class="pct">0%</div>`;
    (this.el.querySelector('.map') as HTMLElement).textContent = map;
    (this.el.querySelector('.sub') as HTMLElement).textContent = sub;
    this.fill = this.el.querySelector('.fill') as HTMLDivElement;
    this.what = this.el.querySelector('.what') as HTMLDivElement;
    this.pct = this.el.querySelector('.pct') as HTMLDivElement;
    document.body.appendChild(this.el);
  }

  // A new stage: `share` of the whole (the shares add up to about 1). Always lets the page repaint.
  async stage(label: string, share: number) {
    this.close();
    this.base = Math.min(1, this.base + this.share);
    this.share = share;
    this.what.textContent = label;
    this.stageAt = performance.now();
    this.times.push({ label, ms: 0 });
    this.show(this.base);
    await this.paint();
  }
  // Progress through the current stage (0–1). Repaints if it's been a while, else carries straight on.
  async tick(f: number) {
    this.show(this.base + this.share * Math.max(0, Math.min(1, f)));
    if (performance.now() - this.last > 80) await this.paint();
  }
  // Everything's built and the first frame is being drawn (the page can't repaint till it's done):
  // most of the way through the last stage, saying so.
  finish(label = 'Drawing the first frame') {
    this.close();
    this.what.textContent = label;
    this.show(this.base + this.share * 0.6);
  }
  // The first frame is drawn: full, and the screen fades away.
  done() {
    this.close();
    this.show(1);
    this.el.classList.add('gone');
    setTimeout(() => this.el.remove(), 400);
  }
  get total() { return performance.now() - this.started; }

  private close() { const t = this.times[this.times.length - 1]; if (t && !t.ms) t.ms = performance.now() - this.stageAt; }
  private show(v: number) {
    this.shown = Math.max(this.shown, Math.min(1, v));
    const p = Math.round(this.shown * 100);
    this.fill.style.width = `${(this.shown * 100).toFixed(1)}%`;
    this.pct.textContent = `${p}%`;
    this.el.setAttribute('aria-valuenow', String(p));
  }
  private async paint() { await breathe(); this.last = performance.now(); }
}
