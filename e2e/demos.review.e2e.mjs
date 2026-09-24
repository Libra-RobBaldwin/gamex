// Review checks for the demo pages after their move onto the shared camera kit (src/proto/kit),
// in a phone-sized touch browser (412x915, DPR 2), in the style of nav.e2e.mjs. Each check
// failed when it was written and describes what the user sees; see the review report.
//
//   npx vite --port 4271 &                     (or set BASE to a running server)
//   npm i --no-save playwright-core@1.56       (or put it anywhere on NODE_PATH)
//   node e2e/demos.review.e2e.mjs [page ...]   pages: water vehicles bridges industries
//
// Exits 1 if anything fails.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:4271';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WAIT = Number(process.env.WAIT ?? 10000);

let failed = 0;
const check = (page, name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${page.padEnd(10)} ${name.padEnd(52)} ${JSON.stringify(info)}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});

async function open(url) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + url, { timeout: 180000 });
  await page.waitForFunction('!!window.nav', null, { timeout: 120000 });
  await page.waitForTimeout(WAIT);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const view = () => page.evaluate(() => ({ ...window.nav.view }));
  const settle = async (ms = 30000) => { await page.waitForTimeout(200); await page.waitForFunction('!window.nav.busy', null, { timeout: ms }).catch(() => {}); };
  const frames = async (n = 2) => { for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); };
  const rect = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }, sel);
  return { page, touch, view, settle, frames, rect, errors };
}
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const PAGES = {
  async water() {
    const t = await open('/water-demo.html?preset=valley');
    // the kit's buttons are meant to be 44 px targets; the page's `button { flex: 1 }` squashes them
    const sizes = await t.page.evaluate(() => [...document.querySelectorAll('.kit-nav button')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    check('water', 'kit buttons are 44 px touch targets', sizes.length > 0 && sizes.every(([w, h]) => w >= 44 && h >= 44), { sizes });
    // picking another place frames that place (the old place's bounds must not clamp it)
    const want = { coast: [2050, 5550], uplands: [7050, 4050] };
    for (const [k, [x, z]] of Object.entries(want)) {
      await t.page.click(`[data-preset=${k}]`);
      await t.page.waitForTimeout(3000);
      await t.settle();
      await t.frames(2);
      const v = await t.view();
      const off = Math.hypot(v.x - x, v.z - z);
      check('water', `preset ${k} frames its own spot`, off < 5, { want: [x, z], got: [+v.x.toFixed(1), +v.z.toFixed(1)], offM: +off.toFixed(1) });
      if (k === 'coast') {
        // the coast's description wraps to two lines: the controls must not sit on the panel
        const top = await t.rect('#top'), kit = await t.rect('.kit-nav');
        check('water', 'kit controls clear of the top panel (coast)', overlap(top, kit) === 0, { topBottom: +top.bottom.toFixed(1), kitTop: kit.top });
      }
    }
    await t.page.close();
    return t.errors;
  },

  async vehicles() {
    const t = await open('/vehicles-demo.html?mode=turntable&spin=0');
    const { touch } = t;
    // pinch to zoom the turntable, lift one finger, then drag the other sideways: on the turntable
    // one finger turns the vehicle (as it did before the kit); it should not slide the view
    const m = [206, 450];
    await touch('touchStart', [[m[0] - 40, m[1] - 40, 1]]);
    await touch('touchStart', [[m[0] - 40, m[1] - 40, 1], [m[0] + 40, m[1] + 40, 2]]);
    for (let i = 1; i <= 6; i++) { const d = 40 + 6 * i; await touch('touchMove', [[m[0] - d, m[1] - d, 1], [m[0] + d, m[1] + d, 2]]); }
    await touch('touchEnd', [[m[0] + 76, m[1] + 76, 2]]);
    const a = await t.view();
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[m[0] - 76 + 15 * i, m[1] - 76, 1]]);
    await t.page.waitForTimeout(200);
    await touch('touchEnd', [[m[0] - 76 + 150, m[1] - 76, 1]]);
    await t.settle();
    const b = await t.view();
    const px = (Math.hypot(b.x - a.x, b.z - a.z) * 915) / b.h;
    check('vehicles', 'turntable: finger left after a pinch turns, not pans', px < 2, { viewMovedPx: +px.toFixed(1) });
    await t.page.close();
    return t.errors;
  },

  async bridges() {
    const errors = [];
    for (const url of ['/bridges-demo.html?type=bascule', '/bridges-demo.html?mode=chooser']) {
      const t = await open(url);
      const top = await t.rect('#top'), kit = await t.rect('.kit-nav');
      check('bridges', `kit controls clear of the top panel ${url.split('?')[1]}`, overlap(top, kit) === 0, { topBottom: +top.bottom.toFixed(1), kitTop: kit.top });
      errors.push(...t.errors);
      await t.page.close();
    }
    return errors;
  },

  async industries() {
    // the catchment ring's width follows the zoom it is shown at
    const t = await open('/industries-demo.html?ring=1');
    const ringHalfWidth = () => t.page.evaluate(() => {
      let w = null;
      window.demo.scene.traverse((o) => {
        if (o.isMesh && o.material?.transparent && o.material.opacity === 0.85) { const p = o.geometry.attributes.position.array; w = Math.hypot(p[15] - p[0], p[17] - p[2]) / 2; }
      });
      return w;
    });
    await t.page.click('#next');
    await t.settle();
    await t.frames(2);
    const v = await t.view(), w = await ringHalfWidth(), want = Math.max(1.5, v.h / 180);
    check('industries', 'ring width follows the zoom after next', w !== null && Math.abs(w - want) < 0.1, { h: +v.h.toFixed(1), halfWidth: +w.toFixed(2), want: +want.toFixed(2) });
    // turn the view with the rotate button (five eighths of a turn), then go to the next site: the
    // move back to the isometric angle should take the short way round, not spin the world
    for (let i = 0; i < 5; i++) await t.page.click('.kit-nav button[title="Rotate right"]');
    await t.settle();
    const az0 = (await t.view()).az;
    await t.page.click('#next');
    await t.settle();
    const az1 = (await t.view()).az;
    check('industries', 'next turns back the short way round', Math.abs(az1 - az0) <= Math.PI + 1e-6, { azBefore: +az0.toFixed(3), azAfter: +az1.toFixed(3), turnedDeg: Math.round(((az1 - az0) * 180) / Math.PI) });
    await t.page.close();

    // focus: the whole site in the space between the title bar and the panel
    const f = await open('/industries-demo.html?focus=coal_mine');
    const r = await f.page.evaluate(() => {
      const s = window.demo.sites.find((q) => q.id === 'coal_mine'), fr = s.model.frame;
      const c = Math.cos(fr.rot ?? 0), sn = Math.sin(fr.rot ?? 0);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
        const dx = (i * fr.w) / 2, dz = (j * fr.d) / 2;
        return window.nav.groundToScreen({ x: fr.cx + dx * c - dz * sn, y: 0, z: fr.cz + dx * sn + dz * c });
      });
      const top = document.getElementById('top').getBoundingClientRect(), panel = document.getElementById('panel').getBoundingClientRect();
      return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)), W: innerWidth, top: top.bottom, bottom: panel.top };
    });
    const ok = r.x0 >= 0 && r.x1 <= r.W && r.y0 >= r.top && r.y1 <= r.bottom;
    check('industries', 'focus: the whole site is in view, clear of the panels', ok, Object.fromEntries(Object.entries(r).map(([k, x]) => [k, Math.round(x)])));
    await f.page.close();
    return [...t.errors, ...f.errors];
  },
};

const only = process.argv.slice(2);
for (const name of only.length ? only : Object.keys(PAGES)) {
  const errors = await PAGES[name]();
  if (errors.length) console.log(`      ${name} page errors: ${JSON.stringify(errors)}`);
}
await browser.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
