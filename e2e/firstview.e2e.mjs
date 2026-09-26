// The start view, cold, on a phone (412x915, deviceScaleFactor 2, touch): the region is opened fresh N
// times, and each time the screen is shot again and again through its first 20 s, as the game settles
// on its quality tier. No shot may be mostly the page's own background (the sky blue behind the canvas,
// which is all that shows when the canvas is cleared and not yet drawn again), and at the end the view
// looks at the start town: ground under the middle of the screen, near the town's centre.
// node e2e/firstview.e2e.mjs [url] [starts] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/proto.html?map=region';
const N = +(process.argv[3] ?? 4);
const out = process.argv[4] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const BODY = [0xa9, 0xcb, 0xe3]; // (proto.css: html, body { background })
for (let i = 0; i < N; i++) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.proto?.town, null, { timeout: 180000 });
  const t0 = Date.now(), seen = [];
  let worst = 0;
  while (Date.now() - t0 < 20000) {
    const buf = await page.screenshot({ scale: 'css' });
    // (the share of the map's part of the screen, between the status strip and the bar, that is the page's background)
    const r = await page.evaluate(async ({ b64, bg }) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
      const g = cv.getContext('2d'); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let s = 0, n = 0;
      for (let y = Math.floor(cv.height * 0.3); y < cv.height * 0.8; y += 3) for (let x = 0; x < cv.width; x += 3) { const p = (y * cv.width + x) * 4; n++; if (Math.abs(d[p] - bg[0]) < 8 && Math.abs(d[p + 1] - bg[1]) < 8 && Math.abs(d[p + 2] - bg[2]) < 8) s++; }
      return { blank: s / n, tier: window.__perf?.tier ?? '-' };
    }, { b64: buf.toString('base64'), bg: BODY });
    seen.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.tier} ${Math.round(r.blank * 100)}%`);
    if (r.blank > worst) worst = r.blank;
    if (r.blank > 0.5) { await page.screenshot({ path: `${out}/firstview-${i}-blank.png` }); fail(`start ${i + 1}: the screen was ${Math.round(r.blank * 100)}% blank sky ${seen[seen.length - 1]} after load`); }
  }
  // and it settles looking at the start town, not the sky
  const look = await page.evaluate(() => {
    const P = window.proto, c = P.view;
    const g = P.nav.screenToGround(206, 457);
    return { g: g && { x: Math.round(g.x), z: Math.round(g.z) }, at: { x: Math.round(c.x), z: Math.round(c.z) } };
  });
  if (!look.g) fail(`start ${i + 1}: the middle of the screen is sky`);
  else if (Math.hypot(look.g.x - look.at.x, look.g.z - look.at.z) > 400) fail(`start ${i + 1}: the middle of the screen is ${JSON.stringify(look.g)}, far from the view's ${JSON.stringify(look.at)}`);
  // the scenery round it: each tile asked for once and built once (a tile asked for again while its
  // data waited to be built piled that data up, gigabytes a minute on a slow phone: worldmap/view.ts)
  const tiles = await page.evaluate(() => { const V = window.proto.worldGame?.view; if (!V) return null; let pending = 0; for (const n of V.nodes.values()) pending += n.pending.size; return { requested: V.stats.requested, built: V.stats.built, pending, heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6) }; });
  if (tiles && tiles.requested > tiles.built + tiles.pending + 2) fail(`start ${i + 1}: ${tiles.requested} scenery tiles asked for, ${tiles.built} built and ${tiles.pending} on the way: tiles are asked for more than once`);
  if (i === 0) await page.screenshot({ path: `${out}/firstview-settled.png` });
  console.log(`start ${i + 1}: scenery`, JSON.stringify(tiles));
  console.log(`start ${i + 1}: worst ${Math.round(worst * 100)}% blank ·`, seen.join(' · '), errs.length ? `· errors ${errs.slice(0, 2).join(' | ')}` : '');
  if (errs.length) fail(`start ${i + 1}: page errors`);
  await ctx.close();
}
await browser.close();
