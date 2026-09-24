// Contrast of text in the HUD (colour x ancestor opacity, over the nearest opaque-ish background). FAIL < 4.5:1 for text under 18px.
import { open } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, shot } = await open(w, h);
const audit = (label) => page.evaluate((label) => {
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const mix = (f, b, a) => ({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
  const out = [];
  const els = [...document.querySelectorAll('#ui *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length && !e.closest('[hidden]') && !e.closest('.vh'));
  for (const e of els) {
    // background: composite ancestor backgrounds from the root down over a mid map colour
    const chain = []; for (let x = e; x && x !== document.body; x = x.parentElement) chain.unshift(x);
    let bg = { r: 110, g: 150, b: 90 };
    let op = 1;
    for (const x of chain) { const cs = getComputedStyle(x); op *= +cs.opacity; const c = parse(cs.backgroundColor); if (c && c.a > 0) bg = mix(c, bg, c.a * op); }
    const cs = getComputedStyle(e); const fg0 = parse(cs.color); const fg = mix(fg0, bg, fg0.a * op);
    const l1 = L(fg), l2 = L(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) out.push({ text: e.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), size, need });
  }
  return out;
}, label);
const report = async (label) => { const r = await audit(label); const seen = new Set(); const u = r.filter((x) => { const k = x.text + x.ratio; if (seen.has(k)) return false; seen.add(k); return true; }); console.log(`${u.length ? 'FAIL' : 'PASS'} ${label}: ${u.length} low-contrast text runs`, JSON.stringify(u.slice(0, 8))); };
await report('rest');
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="stops"]'); await page.waitForTimeout(300); await report('build-stops');
await page.tap('[data-tab="bulldoze"]'); await page.waitForTimeout(300); await report('build-bulldoze');
await page.tap('[data-bar="layers"]'); await page.waitForTimeout(300); await report('layers');
await page.tap('[data-bar="menu"]'); await page.waitForTimeout(300); await report('menu');
await page.tap('[data-bar="transport"]'); await page.waitForTimeout(300); await report('transport-lines');
await page.tap('.sheet .close'); await page.tap('[data-bar="build"]'); await page.tap('[data-tab="roads"]'); await page.tap('.card:has-text("Street")'); await page.waitForTimeout(400); await report('tool');
await browser.close();
