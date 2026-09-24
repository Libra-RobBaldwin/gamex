import { chromium } from 'playwright-core';
export const OUT = new URL('./shots/', import.meta.url).pathname;
export async function open(w = 412, h = 915, { wait = 11000, fresh = true, firstRunSeen = true } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--ignore-certificate-errors'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (firstRunSeen) await ctx.addInitScript(() => { try { localStorage.setItem('untitled.hint.inspect', '1'); } catch {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('toNonIndexed')) errs.push(m.type() + ': ' + m.text()); });
  await page.goto('http://127.0.0.1:5173/proto.html');
  await page.waitForTimeout(wait);
  return { browser, ctx, page, errs, w, h, shot: (n) => page.screenshot({ path: `${OUT}${w}x${h}-${n}.png` }) };
}
export async function coverage(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight; let hit = 0, n = 0;
    for (let y = 0.5; y < H; y += 2) for (let x = 0.5; x < W; x += 2) { n++; const el = document.elementFromPoint(x, y); if (el && el.id !== 'c' && el.closest('#ui')) hit++; }
    return hit / n;
  });
}
// count mutations inside #ui over ms, grouped by target, ignoring #st-* and #perf-t
export async function mutations(page, ms = 5000) {
  await page.evaluate(() => {
    window.__mut = [];
    window.__mo?.disconnect();
    const desc = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; if (!e) return '?'; let s = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : ''); const p = e.closest('[id]'); if (p && p !== e) s = '#' + p.id + ' > ' + s; return s; };
    window.__mo = new MutationObserver((recs) => { for (const r of recs) window.__mut.push({ t: r.type, at: desc(r.target), a: r.attributeName, ign: !!(r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest('[id^="st-"],#perf-t') }); });
    window.__mo.observe(document.getElementById('ui'), { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.waitForTimeout(ms);
  return page.evaluate(() => { window.__mo.disconnect(); const g = {}; for (const m of window.__mut) { if (m.ign) continue; const k = `${m.t}${m.a ? '[' + m.a + ']' : ''} ${m.at}`; g[k] = (g[k] || 0) + 1; } return g; });
}
// all visible buttons with their boxes
export async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('#ui button, #ui [role=tab]')].filter((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && b.offsetParent !== null; }).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.dataset.bar || b.dataset.tab || b.dataset.k || b.dataset.x || b.className || b.textContent.trim().slice(0, 20), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), off: r.right > innerWidth + 0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.top < -0.5 }; }).filter((b) => b.w < 44 || b.h < 44 || b.off));
}
// a point on screen in clear map
export async function clearPoint(page, fx = 0.5, fy = 0.35) { return { x: page.viewportSize().width * fx, y: page.viewportSize().height * fy }; }
export async function drag(page, a, b, steps = 12) {
  await page.evaluate(({ a, b, steps }) => {
    const c = document.getElementById('c'); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
    ev('pointerdown', a.x, a.y); for (let i = 1; i <= steps; i++) ev('pointermove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); ev('pointerup', b.x, b.y);
  }, { a, b, steps });
}
export const vis = (page, s) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width > 0 && r.height > 0; }, s);
export const box = (page, s) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }, s);
// is the element's centre actually hit-testable (not covered by something else)?
export const onTop = (page, s) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden) return 'missing'; const r = e.getBoundingClientRect(); const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.top + r.height / 2]]; return pts.map(([x, y]) => { const t = document.elementFromPoint(x, y); return t && (t === e || e.contains(t)) ? 'top' : (t ? (t.id || t.className || t.tagName) : 'none'); }).join(','); }, s);
