// usage: node flows-all.mjs WxH [t,r,b,l]
import { open, audit, report, insets, demolishingBlueprint, OUT } from './lib.mjs';
const [w, h] = process.argv[2].split('x').map(Number);
const ins = (process.argv[3] || '0,0,0,0').split(',').map(Number);
const tag = `${w}x${h}` + (ins.some(Boolean) ? `-i${ins.join('_')}` : '');
const { browser, page, errs } = await open(w, h);
if (ins.some(Boolean)) await insets(page, ...ins);
const all = [];
const shot = (n) => page.screenshot({ path: `${OUT}${tag}-${n}.png` });
const A = async (n) => { await page.waitForTimeout(350); all.push(...report(await audit(page, n)).map((i) => `${n}: ${i}`)); await shot(n); };
const tryTap = async (sel) => { try { await page.tap(sel, { timeout: 8000 }); return true; } catch (e) { console.log('   CANNOT TAP', sel, e.message.split('\n').filter(l => /intercept|not visible|outside|Timeout/.test(l)).slice(-2).join(' | ')); all.push(`cannot tap ${sel}`); return false; } };
await A('rest');
await tryTap('#clockbtn'); await tryTap('#perfbtn'); await page.waitForTimeout(1500); await A('drawer-perf');
// with the drawer still open, open Build (does the sheet collide with the drawer?)
await tryTap('[data-bar="build"]'); await A('build-with-drawer');
await tryTap('#perfbtn'); await tryTap('#clockbtn');
for (const t of ['roads', 'rail', 'stops', 'freight', 'bulldoze', 'landscape']) { await tryTap(`[data-tab="${t}"]`); await A(`build-${t}`); }
await tryTap('[data-tab="roads"]'); await tryTap('.card:has-text("More road types")'); await A('picker');
await page.evaluate(() => { const b = document.querySelector('.sheet .sb'); b.scrollTop = b.scrollHeight; }); await A('picker-scrolled');
await tryTap('.sheet .back'); await tryTap('.card:has-text("Street")'); await A('road-tool');
const bp = await demolishingBlueprint(page); console.log('   demolishing blueprint', !!bp);
await A('blueprint');
await tryTap('#t-cancel');
await tryTap('[data-bar="build"]'); await tryTap('[data-tab="rail"]'); await tryTap('.card >> nth=0'); await A('rail-tool');
await tryTap('#t-cancel');
// stop tool + planner
await tryTap('[data-bar="build"]'); await tryTap('[data-tab="stops"]'); await tryTap('.card:has-text("Bus stop")'); await A('stop-tool');
const r = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const s of p.net.segs.values()) { if (p.net.def(s).cls !== 'road') continue; for (const m of p.net.path(s)) { const q = p.toScreen(m); if (q.x > c.left + 40 && q.x < c.right - 40 && q.y > c.top + 40 && q.y < c.bottom - 40) { const n = p.net.nearestSeg(p.groundAt(q.x, q.y), 30, (x) => p.net.def(x).cls === 'road'); if (n) { const pl = p.net.planStop(n.seg.id, n.s, 1); if (!pl.reason && pl.plans.some(x => x.ok)) return { q, P: { x: m.x, z: m.z } }; } } } } });
if (r) { await page.touchscreen.tap(r.q.x, r.q.y); await page.waitForTimeout(3500); await A('stop-planner');
  const f = await page.evaluate((P) => { const p = proto, s = p.toScreen(P), c = p.shell.clearRect(); return { s, c, cx: (c.left + c.right) / 2, cy: (c.top + c.bottom) / 2 }; }, r.P);
  const dx = f.s.x - f.cx, dy = f.s.y - f.cy; console.log('   focus stop: target', f.s.x.toFixed(0), f.s.y.toFixed(0), 'clear centre', f.cx.toFixed(0), f.cy.toFixed(0), 'off', dx.toFixed(0), dy.toFixed(0), JSON.stringify(f.c));
  if (Math.hypot(dx, dy) > 40 || f.s.x < f.c.left || f.s.x > f.c.right || f.s.y < f.c.top || f.s.y > f.c.bottom) all.push(`focus stop off by ${dx.toFixed(0)},${dy.toFixed(0)}`);
} else all.push('no stop spot');
await tryTap('#t-cancel');
await tryTap('[data-bar="transport"]'); await A('transport-lines');
await tryTap('[data-tab="buy"]'); await A('transport-buy');
await page.evaluate(() => { const b = document.querySelector('.sheet .sb'); b.scrollTop = b.scrollHeight; }); await A('transport-buy-scrolled');
await tryTap('[data-bar="transport"]');
await tryTap('[data-bar="layers"]'); await A('layers');
await tryTap('[data-bar="layers"]');
await tryTap('[data-bar="menu"]'); await A('menu');
await tryTap('.card:has-text("Quality")'); await A('quality');
await tryTap('.sheet .back'); await tryTap('.card:has-text("New town")'); await A('newtown');
await tryTap('[data-keep]');
// junction info + editor
await page.evaluate(() => { const p = proto; let best = null, bd = 1e9; for (const j of p.junctions.values()) { if (j.form === 'join' || j.form === 'merge') continue; const n = p.net.node(j.node); const d = Math.hypot(n.x - p.view.x, n.z - p.view.z); if (d < bd) { bd = d; best = n; } } const c = p.shell.clearRect(); const g = p.groundAt((c.left + c.right) / 2, (c.top + c.bottom) / 2); p.view.x += best.x - g.x; p.view.z += best.z - g.z; }); await page.waitForTimeout(1500);
const j = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); const ok = (q) => q.x > c.left + 50 && q.x < c.right - 50 && q.y > c.top + 50 && q.y < c.bottom - 50; for (const j of p.junctions.values()) { if (j.form === 'join' || j.form === 'merge') continue; const n = p.net.node(j.node); const q = p.toScreen(n); if (ok(q)) return { q, n: { x: n.x, z: n.z } }; } });
if (j) { await page.touchscreen.tap(j.q.x, j.q.y); await A('junction-info');
  await tryTap('.sheet .act.primary'); await page.waitForTimeout(3500); await A('junction-edit');
  const f = await page.evaluate((P) => { const p = proto, s = p.toScreen(P), c = p.shell.clearRect(); return { s, c, cx: (c.left + c.right) / 2, cy: (c.top + c.bottom) / 2 }; }, j.n);
  const dx = f.s.x - f.cx, dy = f.s.y - f.cy; console.log('   focus junction: target', f.s.x.toFixed(0), f.s.y.toFixed(0), 'clear centre', f.cx.toFixed(0), f.cy.toFixed(0), 'off', dx.toFixed(0), dy.toFixed(0), JSON.stringify(f.c));
  if (Math.hypot(dx, dy) > 40) all.push(`focus junction off by ${dx.toFixed(0)},${dy.toFixed(0)}`);
  await page.evaluate(() => { const b = document.querySelector('.sheet .sb'); b.scrollTop = b.scrollHeight; }); await A('junction-edit-scrolled');
  await tryTap('.sheet .close');
} else all.push('no junction spot');
// building info
const b = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const b of p.buildings) { if (b.dying || b.region) continue; const q = p.toScreen({ x: b.lot.x, z: b.lot.z, y: b.height / 2 }); if (q.x > c.left + 40 && q.x < c.right - 40 && q.y > c.top + 40 && q.y < c.bottom - 40 && p.pickBuilding(q.x, q.y) === b) return q; } });
if (b) { await page.touchscreen.tap(b.x, b.y); await A('building-info'); await tryTap('.sheet .close'); } else all.push('no building spot');
console.log(`SUMMARY ${tag}: ${all.length} issues`); for (const i of all) console.log('  ' + i);
console.log('errors', JSON.stringify(errs));
await browser.close();
