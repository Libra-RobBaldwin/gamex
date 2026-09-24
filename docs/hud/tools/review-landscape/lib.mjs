import { chromium } from 'playwright-core';
export const OUT = new URL('./shots/', import.meta.url).pathname;
export async function open(w = 412, h = 915, wait = 11000) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--ignore-certificate-errors'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: process.env.MOTION ? 'no-preference' : 'reduce' });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:5173/proto.html');
  await page.waitForTimeout(wait);
  return { browser, page, errs };
}
export async function insets(page, t = 0, r = 0, b = 0, l = 0) {
  await page.evaluate(([t, r, b, l]) => { const s = document.documentElement.style; s.setProperty('--safe-t', t + 'px'); s.setProperty('--safe-r', r + 'px'); s.setProperty('--safe-b', b + 'px'); s.setProperty('--safe-l', l + 'px'); window.dispatchEvent(new Event('resize')); }, [t, r, b, l]);
  await page.waitForTimeout(300);
}
// Audit the visible chrome: off-screen, pairwise overlaps between panels, small or occluded buttons, safe-area intrusions
export async function audit(page, label = '') {
  return page.evaluate((label) => {
    const W = innerWidth, H = innerHeight, cs = getComputedStyle(document.documentElement);
    const px = (v) => parseFloat(cs.getPropertyValue(v)) || 0;
    const safe = { t: px('--safe-t'), r: px('--safe-r'), b: px('--safe-b'), l: px('--safe-l') };
    const vis = (el) => el && !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const R = (el) => { const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1) }; };
    const issues = [];
    const panels = ['#status', '#drawer', '#compass', '#viewbtn', '#firstrun', '#hint', '#sheet', '#layers', '#tpanel', '#tool', '#bar'];
    const pr = {};
    for (const s of panels) { const el = document.querySelector(s); if (vis(el)) pr[s] = R(el); }
    for (const [s, r] of Object.entries(pr)) if (r.l < -0.5 || r.t < -0.5 || r.r > W + 0.5 || r.b > H + 0.5) issues.push(`OFFSCREEN ${s} ${JSON.stringify(r)}`);
    const ks = Object.keys(pr);
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = pr[ks[i]], b = pr[ks[j]];
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      if (ox > 1 && oy > 1) issues.push(`OVERLAP ${ks[i]} x ${ks[j]} by ${ox.toFixed(0)}x${oy.toFixed(0)}`);
    }
    // buttons
    for (const b of document.querySelectorAll('#ui button')) {
      if (!vis(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // visible part inside scroll ancestors
      let vl = r.left, vt = r.top, vr = r.right, vb = r.bottom;
      for (let p = b.parentElement; p && p.id !== 'ui'; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (/(auto|scroll|hidden)/.test(st.overflowX + st.overflowY)) { const q = p.getBoundingClientRect(); vl = Math.max(vl, q.left); vt = Math.max(vt, q.top); vr = Math.min(vr, q.right); vb = Math.min(vb, q.bottom); }
      }
      const name = (b.id ? '#' + b.id : '') + (b.dataset.bar ? `[bar=${b.dataset.bar}]` : '') + (b.className ? '.' + String(b.className).trim().split(/\s+/).join('.') : '') + ' "' + (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 24) + '"';
      if (vr - vl < 1 || vb - vt < 1) continue; // scrolled out of view
      if (r.width < 43.5 || r.height < 43.5) issues.push(`SMALL ${name} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
      if (vl < -0.5 || vt < -0.5 || vr > W + 0.5 || vb > H + 0.5) issues.push(`BTN-OFFSCREEN ${name} ${JSON.stringify(R(b))}`);
      const cx = (vl + vr) / 2, cy = (vt + vb) / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && !b.contains(hit) && cx >= 0 && cy >= 0 && cx < W && cy < H) issues.push(`OCCLUDED ${name} by ${hit.id ? '#' + hit.id : hit.tagName + '.' + hit.className} at ${cx.toFixed(0)},${cy.toFixed(0)}`);
      const inset = (safe.t && vt < safe.t - 0.5) || (safe.b && vb > H - safe.b + 0.5) || (safe.l && vl < safe.l - 0.5) || (safe.r && vr > W - safe.r + 0.5);
      if (inset) issues.push(`IN-INSET ${name} ${JSON.stringify(R(b))}`);
    }
    // text that must be readable: sheet title, hint text, tool name, firstrun, stats
    if (safe.t + safe.b + safe.l + safe.r) for (const s of ['#hint span', '#firstrun span', '#tool .tw b', '.sheet h2', '#tpanel .what', '.st', '#layers h3']) for (const el of document.querySelectorAll(s)) {
      if (!vis(el)) continue; const r = el.getBoundingClientRect();
      if ((r.top < safe.t - 0.5) || (r.bottom > H - safe.b + 0.5) || (r.left < safe.l - 0.5) || (r.right > W - safe.r + 0.5)) issues.push(`TEXT-IN-INSET ${s} ${JSON.stringify(R(el))}`);
    }
    return { label, W, H, panels: pr, issues };
  }, label);
}
export function report(a) { console.log(`== ${a.label} ${a.W}x${a.H} ${a.issues.length ? 'ISSUES' : 'ok'}`); for (const i of a.issues) console.log('   ' + i); return a.issues; }
// pick a clear-map screen point near the chrome's clear rect
export async function dragAcross(page, k = 0) {
  return page.evaluate((k) => {
    const p = window.proto, c = p.shell.clearRect();
    const inClear = (q) => q.x > c.left + 30 && q.x < c.right - 30 && q.y > c.top + 30 && q.y < c.bottom - 30;
    const bs = p.buildings.filter((b) => !b.dying && !b.region && b.lot.id >= 0);
    let n = 0;
    for (const b of bs) {
      for (const ang of [0, 0.8, 1.6, 2.4]) {
        const d = 45, A = { x: b.lot.x - Math.cos(ang) * d, z: b.lot.z - Math.sin(ang) * d }, B = { x: b.lot.x + Math.cos(ang) * d, z: b.lot.z + Math.sin(ang) * d };
        const a = p.toScreen(A), bb = p.toScreen(B);
        if (!inClear(a) || !inClear(bb)) continue;
        if (n++ < k) continue;
        const cv = document.getElementById('c'); const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
        ev('pointerdown', a.x, a.y); for (let i = 1; i <= 12; i++) ev('pointermove', a.x + (bb.x - a.x) * i / 12, a.y + (bb.y - a.y) * i / 12); ev('pointerup', bb.x, bb.y);
        return { a, b: bb };
      }
    }
    return null;
  }, k);
}
export async function demolishingBlueprint(page) {
  for (let k = 0; k < 25; k++) {
    const r = await dragAcross(page, k * 3);
    if (!r) return null;
    await page.waitForTimeout(700);
    if (await page.isVisible('#tpanel .demo')) return r;
    if (await page.isEnabled('#t-undo').catch(() => false)) { await page.tap('#t-undo'); await page.waitForTimeout(200); }
  }
  return null;
}
