// Adversarial touch review of the shared camera (src/proto/kit/camera.ts) in a phone-sized touch
// browser (412x915, DPR 2), fingers scripted through the DevTools protocol as in nav.e2e.mjs.
// Each check here failed when it was written; it describes what the navigation should do.
//
//   npx vite --port 4271 &                     (or set BASE to a running server)
//   npm i --no-save playwright-core@1.56       (or put it anywhere on NODE_PATH)
//   node e2e/touch.review.e2e.mjs
//
// Exits 1 if anything fails.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:4271';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WAIT = Number(process.env.WAIT ?? 10000);

const results = [];
let failed = 0;
const check = (page, name, ok, info) => {
  results.push({ page, name, ok, ...info });
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${page.padEnd(8)} ${name.padEnd(44)} ${JSON.stringify(info)}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});

async function openPage(url, rigSrc) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + url);
  await page.waitForFunction(`!!(${rigSrc})`, null, { timeout: 60000 });
  await page.waitForTimeout(WAIT);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const rig = (fn, arg) => page.evaluate(([src, f, a]) => new Function('nav', 'a', `return (${f})(nav, a)`)(eval(src), a), [rigSrc, fn.toString(), arg]);
  const view = () => rig((nav) => ({ ...nav.view }));
  const rect = () => rig((nav) => { const r = nav.element.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const off = await rect();
  const at = (sx, sy) => [off.x + sx, off.y + sy];
  const grab = (sx, sy) => rig((nav, a) => nav.groundUnder(a[0], a[1]), [sx, sy]);
  const where = (g) => rig((nav, g) => nav.groundToScreen(g), g);
  const err = async (g, sx, sy) => { const s = await where(g); return Math.hypot(s.x - sx, s.y - sy); };
  const home = await view();
  const reset = async (patch = {}) => { await rig((nav, v) => { nav.stop(); nav.setView(v); nav.update(0); }, { ...home, ...patch }); await page.waitForTimeout(50); };
  const settle = async (ms = 20000) => { await page.waitForTimeout(100); await page.waitForFunction(`!(${rigSrc}).busy`, null, { timeout: ms }).catch(() => {}); };
  // hold the page's frame loop around quick finger sequences (software rendering takes a second
  // or more a frame, and touches wait behind it)
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let held = null;
    window.__freeze = false;
    window.requestAnimationFrame = (f) => (window.__freeze ? ((held = f), 0) : raf(f));
    window.__thaw = () => { window.__freeze = false; if (held) { const f = held; held = null; raf(f); } };
  });
  const freeze = async () => { await page.evaluate(() => { window.__freeze = true; }); await page.waitForTimeout(3000); };
  const thaw = () => page.evaluate(() => window.__thaw());
  return { page, cdp, touch, rig, view, rect, off, at, grab, where, err, home, reset, settle, freeze, thaw, errors, cx: off.w / 2, cy: off.h * 0.55 };
}

// ---------------- the game ----------------
{
  const G = await openPage('/?map=town', 'window.proto.nav');
  const { page, touch, rig, view, at, grab, err, reset, settle, freeze, thaw, cx, cy } = G;
  // count the taps the game hears
  await page.evaluate(() => {
    const h = window.proto.nav.hooks, t = h.onTap;
    window.__taps = 0;
    h.onTap = (p) => { window.__taps++; return t?.(p); };
  });
  const taps = () => page.evaluate(() => window.__taps);

  // A finger put down to stop a glide is catching the map, not tapping it. (In the game a tap
  // opens or closes a building's card, places a bus stop or a curve point.)
  {
    await reset({ h: 300 });
    await freeze();
    await touch('touchStart', [[...at(cx, cy + 200), 1]]);
    await touch('touchMove', [[...at(cx, cy), 1]]);
    await touch('touchMove', [[...at(cx, cy - 200), 1]]);
    await touch('touchMove', [[...at(cx, cy - 400), 1]]);
    await touch('touchEnd', [[...at(cx, cy - 400), 1]]);
    await thaw();
    await page.waitForTimeout(1200);
    await freeze();
    const gliding = await rig((nav) => nav.busy && nav.pointers === 0);
    const n0 = await taps(), v0 = await view();
    await touch('touchStart', [[...at(cx + 30, cy), 1]]);
    const v1 = await view();
    await touch('touchEnd', [[...at(cx + 30, cy), 1]]);
    await thaw();
    await page.waitForTimeout(2000);
    const v2 = await view(), n1 = await taps();
    const jump = Math.hypot(v1.x - v0.x, v1.z - v0.z), drift = Math.hypot(v2.x - v1.x, v2.z - v1.z);
    check('game', 'a touch that stops a glide is not a tap', gliding && jump < 1e-9 && drift < 1e-9 && n1 === n0, { gliding, jump, drift, taps: n1 - n0 });
  }

  // Pushed against the edge of the map, the ground slips from under the finger. Dragging back the
  // other way should move the map back at once, not only once the finger has retraced the overshoot.
  {
    await reset({ az: 0, el: 1.5, x: 480, z: 0, h: 300 });
    await touch('touchStart', [[...at(cx, cy), 1]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[...at(cx - 30 * i, cy), 1]]);
    const edge = await view();
    const g = await grab(cx - 300, cy);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[...at(cx - 300 + 20 * i, cy), 1]]);
    const back = await view();
    const e = await err(g, cx - 200, cy);
    await page.waitForTimeout(150);
    await touch('touchEnd', [[...at(cx - 200, cy), 1]]);
    const want = (100 * back.h) / G.off.h; // metres the map should have come back by
    check('game', 'dragging back off the edge moves at once', edge.x - back.x > want * 0.9 && e < 1.5, { atEdge: edge.x, after: +back.x.toFixed(2), wantBack: +want.toFixed(2), errPx: +e.toFixed(2) });
    await settle();
  }

  // Two fingers land and one lifts at once, the other staying down: that isn't a two-finger tap
  // yet. The finger left down pans, so the ground under it stays under it, and nothing zooms.
  {
    await reset();
    await freeze();
    await touch('touchStart', [[...at(cx - 60, cy), 1]]);
    await touch('touchStart', [[...at(cx - 60, cy), 1], [...at(cx + 60, cy), 2]]);
    await touch('touchEnd', [[...at(cx - 60, cy), 1]]);
    await thaw();
    const g = await grab(cx + 60, cy), h0 = G.home.h;
    let worst = 0, hMaxSeen = h0;
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [[...at(cx + 60 - 5 * i, cy + 5 * i), 2]]);
      for (const ms of [0, 250, 500]) {
        await page.waitForTimeout(ms && 250);
        worst = Math.max(worst, await err(g, cx + 60 - 5 * i, cy + 5 * i));
        hMaxSeen = Math.max(hMaxSeen, (await view()).h);
      }
    }
    await page.waitForTimeout(150);
    await touch('touchEnd', [[...at(cx + 20, cy + 40), 2]]);
    check('game', 'finger left after a two-finger touch pans', worst < 1.5 && Math.abs(hMaxSeen - h0) < 1e-6, { worstPx: +worst.toFixed(2), h0, hMaxSeen });
    await settle();
  }
  check('game', 'no page errors', G.errors.length === 0, { errors: G.errors.slice(0, 3) });
  await G.page.close();
}

// ---------------- the water demo (terrain, 5 km from the origin) ----------------
{
  const W = await openPage('/water-demo.html?preset=valley', 'window.nav');
  const { page, touch, rig, rect, grab, reset } = W;

  // The phone turns to landscape mid-pan. On a wide screen the demo shows its phone frame, so the
  // canvas moves across the page under the finger. The ground grabbed should still follow the
  // finger (in the canvas's own pixels) once it moves again.
  {
    await reset();
    const f = [300, 300]; // client px: inside the canvas before and after
    const g = await grab(f[0] - W.off.x, f[1] - W.off.y);
    await touch('touchStart', [[f[0], f[1], 1]]);
    for (let i = 1; i <= 4; i++) await touch('touchMove', [[f[0], f[1] - 5 * i, 1]]);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.waitForTimeout(1500);
    const r = await rect();
    let worst = 0;
    for (let i = 1; i <= 4; i++) {
      const c = [f[0] - 5 * i, f[1] - 20 - 5 * i];
      await touch('touchMove', [[c[0], c[1], 1]]);
      const s = await rig((nav, g) => nav.groundToScreen(g), g);
      worst = Math.max(worst, Math.hypot(s.x - (c[0] - r.x), s.y - (c[1] - r.y)));
    }
    await page.waitForTimeout(150);
    await touch('touchEnd', [[f[0] - 20, f[1] - 40, 1]]);
    check('water', 'canvas moves mid-pan: ground stays under finger', worst < 1.5, { canvasLeft: r.x, worstPx: +worst.toFixed(1) });
  }
  check('water', 'no page errors', W.errors.length === 0, { errors: W.errors.slice(0, 3) });
  await W.page.close();
}

await browser.close();
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
