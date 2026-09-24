// A plan on screen with pan and pinch-zoom. The SVG is shown as an image, not as thousands of DOM
// nodes: during a gesture only a CSS transform changes (cheap, smooth on a phone), and when the
// fingers lift the image is laid out again at the new size, so the browser redraws it sharp.

const MAX_ZOOM = 16;

export class PlanViewer {
  readonly el: HTMLDivElement;
  private img = new Image();
  private url = '';
  private aspect = 1; // height / width
  private fit = 1; // the committed width that fits the box, css px
  private w = 1; // committed width, css px
  private x = 0; private y = 0; // committed offset
  private s = 1; private dx = 0; private dy = 0; // the live gesture on top of that
  private pts = new Map<number, { x: number; y: number }>();
  private start?: { pts: [number, number, number, number] | [number, number]; x: number; y: number };
  private lastTap = 0;
  private tapAt = { x: 0, y: 0 };

  constructor(label: string) {
    this.el = document.createElement('div');
    this.el.className = 'viewer';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', label);
    this.img.alt = '';
    this.img.draggable = false;
    this.img.decoding = 'async';
    this.el.append(this.img);
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.el.addEventListener(t, (e) => this.up(e));
    this.el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX, e.offsetY); }, { passive: false });
    new ResizeObserver(() => this.refit()).observe(this.el);
  }

  /** Shows a plan. `keepView` keeps the zoom and position, for another drawing of the same area. */
  show(svg: string, keepView = false) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const m = /width="(\d+)" height="(\d+)"/.exec(svg);
    this.aspect = m ? +m[2] / +m[1] : 1;
    this.img.src = this.url;
    if (keepView && this.w > this.fit + 0.5) this.apply(true); else this.reset();
  }

  dispose() { if (this.url) URL.revokeObjectURL(this.url); this.url = ''; this.img.removeAttribute('src'); }

  reset() {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    this.fit = Math.min(r.width, r.height / this.aspect);
    this.w = this.fit;
    this.x = (r.width - this.w) / 2; this.y = (r.height - this.w * this.aspect) / 2;
    this.s = 1; this.dx = this.dy = 0;
    this.apply(true);
  }

  zoomBy(k: number) { const r = this.el.getBoundingClientRect(); this.zoomAt(k, r.width / 2, r.height / 2); }

  private refit() { if (this.w <= this.fit + 0.5) this.reset(); else this.apply(true); }

  private zoomAt(k: number, cx: number, cy: number) {
    const w = Math.max(this.fit, Math.min(this.fit * MAX_ZOOM, this.w * k)), f = w / this.w;
    this.x = cx - (cx - this.x) * f; this.y = cy - (cy - this.y) * f; this.w = w;
    this.clamp();
    this.apply(true);
  }

  // keep some of the plan on screen
  private clamp() {
    const r = this.el.getBoundingClientRect(), h = this.w * this.aspect, m = 60;
    this.x = Math.min(r.width - m, Math.max(m - this.w, this.x));
    this.y = Math.min(r.height - m, Math.max(m - h, this.y));
  }

  private apply(commit: boolean) {
    if (commit) {
      this.img.style.width = `${this.w}px`;
      this.img.style.height = `${this.w * this.aspect}px`;
      this.img.style.transform = `translate(${this.x}px, ${this.y}px)`;
    } else {
      this.img.style.transform = `translate(${this.x + this.dx}px, ${this.y + this.dy}px) scale(${this.s})`;
    }
  }

  private local(e: PointerEvent) { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private begin() {
    const p = [...this.pts.values()];
    this.start = { pts: p.length >= 2 ? [p[0].x, p[0].y, p[1].x, p[1].y] : [p[0].x, p[0].y], x: this.x, y: this.y };
    this.s = 1; this.dx = this.dy = 0;
  }

  private down(e: PointerEvent) {
    if (e.button > 0) return;
    this.el.setPointerCapture(e.pointerId);
    if (this.pts.size && this.start) this.commit();
    this.pts.set(e.pointerId, this.local(e));
    if (this.pts.size > 2) return;
    this.begin();
    this.img.style.transformOrigin = '0 0';
    if (this.pts.size === 1) {
      const now = performance.now(), here = this.local(e);
      if (now - this.lastTap < 300 && Math.hypot(here.x - this.tapAt.x, here.y - this.tapAt.y) < 30) { const p = this.local(e); this.zoomAt(this.w >= this.fit * MAX_ZOOM * 0.99 ? 0 : 2, p.x, p.y); this.pts.clear(); this.start = undefined; this.lastTap = 0; return; }
      this.lastTap = now; this.tapAt = here;
    }
  }

  private move(e: PointerEvent) {
    if (!this.pts.has(e.pointerId) || !this.start) return;
    this.pts.set(e.pointerId, this.local(e));
    const p = [...this.pts.values()], a = this.start.pts;
    if (p.length >= 2 && a.length === 4) {
      const d0 = Math.hypot(a[2] - a[0], a[3] - a[1]) || 1, d1 = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      const s = Math.max(this.fit / this.w, Math.min((this.fit * MAX_ZOOM) / this.w, d1 / d0));
      const m0 = { x: (a[0] + a[2]) / 2, y: (a[1] + a[3]) / 2 }, m1 = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      // the point under the first midpoint stays under the fingers' midpoint
      this.s = s;
      this.dx = m1.x - m0.x + (m0.x - this.x) * (1 - s);
      this.dy = m1.y - m0.y + (m0.y - this.y) * (1 - s);
    } else if (a.length === 2) {
      this.dx = p[0].x - a[0]; this.dy = p[0].y - a[1];
      if (Math.hypot(this.dx, this.dy) > 8) this.lastTap = 0;
    }
    this.apply(false);
  }

  private commit() {
    this.x += this.dx; this.y += this.dy; this.w *= this.s;
    this.s = 1; this.dx = this.dy = 0;
    this.clamp();
    // lay it out at the new size, so the browser redraws it sharp
    this.img.style.transform = `translate(${this.x}px, ${this.y}px)`;
    this.img.style.width = `${this.w}px`;
    this.img.style.height = `${this.w * this.aspect}px`;
  }

  private up(e: PointerEvent) {
    if (!this.pts.delete(e.pointerId)) return;
    if (this.start) this.commit();
    this.start = undefined;
    if (this.pts.size) this.begin();
  }
}
