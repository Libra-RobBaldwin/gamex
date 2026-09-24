// Gesture tests for the shared camera (src/proto/kit) on the game and on every demo page, in a
// phone-sized touch browser (412x915, DPR 2). Fingers are scripted through the DevTools protocol,
// so they land, move and lift in exactly the order written here.
//
//   npx vite --port 4271 &                     (or set BASE to a running server)
//   npm i --no-save playwright-core@1.56       (or put it anywhere on NODE_PATH)
//   node e2e/nav.e2e.mjs [page ...]            pages: game water vehicles people bridges industries
//
// Each check moves the view and measures what matters: that the ground grabbed stays under the
// finger (in screen pixels), that zoom, turn and tilt change the way they should, that taps fire
// once and that build-mode drags draw instead of panning. Exits 1 if anything fails.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:4271';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WAIT = Number(process.env.WAIT ?? 10000);

// how each page exposes its camera rig (NavRig) for measuring
const PAGES = {
  game: { url: '/proto.html', rig: 'window.proto.nav' },
  water: { url: '/water-demo.html?preset=valley', rig: 'window.nav' },
  vehicles: { url: '/vehicles-demo.html', rig: 'window.nav' },
  people: { url: '/people-demo.html', rig: 'window.nav' },
  bridges: { url: '/bridges-demo.html', rig: 'window.nav' },
  industries: { url: '/industries-demo.html', rig: 'window.nav' },
};
const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(PAGES);

const results = [];
let failed = 0;
const check = (page, name, ok, info) => {
  results.push({ page, name, ok, ...info });
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${page.padEnd(10)} ${name.padEnd(34)} ${JSON.stringify(info)}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});

for (const name of names) {
  const P = PAGES[name];
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + P.url);
  await page.waitForFunction(`!!(${P.rig})`, null, { timeout: 60000 });
  await page.waitForTimeout(WAIT);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const rig = (fn, arg) => page.evaluate(([src, f, a]) => new Function('nav', 'a', `return (${f})(nav, a)`)(eval(src), a), [P.rig, fn.toString(), arg]);
  const view = () => rig((nav) => ({ ...nav.view }));
  // the rig's element may not sit at the page's top left (a phone frame on desktop)
  const off = await rig((nav) => { const r = nav.element.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const at = (sx, sy) => [off.x + sx, off.y + sy];
  // where the ground grabbed at (sx, sy) is on the screen now, in element pixels
  const grab = (sx, sy) => rig((nav, a) => nav.groundUnder(a[0], a[1]), [sx, sy]);
  const where = (g) => rig((nav, g) => nav.groundToScreen(g), g);
  const err = async (g, sx, sy) => { const s = await where(g); return Math.hypot(s.x - sx, s.y - sy); };
  // a fresh start for every check: stop any glide, face the page's own starting view
  const home = await view();
  const reset = async (patch = {}) => { await rig((nav, v) => { nav.stop(); nav.setView(v); nav.update(0); }, { ...home, ...patch }); await page.waitForTimeout(50); };
  const cx = off.w / 2, cy = off.h * 0.55;
  // software rendering draws a few frames a second at most: wait for animations to finish
  const settle = async (ms = 20000) => { await page.waitForTimeout(100); await page.waitForFunction(`!(${P.rig}).busy`, null, { timeout: ms }).catch(() => {}); };
  // Software rendering takes a second or more a frame, and touches wait behind it, so a quick tap
  // would arrive looking like a long press. Around taps the page's frame loop is paused (the
  // next frame is held back, then released).
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let held = null;
    window.__freeze = false;
    window.requestAnimationFrame = (f) => (window.__freeze ? ((held = f), 0) : raf(f));
    window.__thaw = () => { window.__freeze = false; if (held) { const f = held; held = null; raf(f); } };
  });
  const freeze = async () => { await page.evaluate(() => { window.__freeze = true; }); await page.waitForTimeout(3000); };
  const thaw = () => page.evaluate(() => window.__thaw());
  // hold a key until the view has moved (a slow frame loop may take a while to notice it)
  const hold = async (code) => {
    const v0 = JSON.stringify(await view());
    await page.keyboard.down(code);
    for (let i = 0; i < 50 && JSON.stringify(await view()) === v0; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(200);
    await page.keyboard.up(code);
  };
  const lerp = (a, b, k) => a + (b - a) * k;

  // one finger pan at several tilts and turns: the ground grabbed stays under the finger
  for (const [el, az] of [[home.el, home.az], [0.4, 2.5], [1.45, -1.2]]) {
    await reset({ el, az });
    const g = await grab(cx, cy);
    const x1 = cx - 90, y1 = cy - 160;
    await touch('touchStart', [[...at(cx, cy), 1]]);
    let worst = 0;
    for (let i = 1; i <= 12; i++) {
      const x = lerp(cx, x1, i / 12), y = lerp(cy, y1, i / 12);
      await touch('touchMove', [[...at(x, y), 1]]);
      worst = Math.max(worst, await err(g, x, y));
    }
    await page.waitForTimeout(150); // slow the lift so it doesn't fling
    await touch('touchEnd', [[...at(x1, y1), 1]]);
    const v = await view();
    check(name, `pan el=${el.toFixed(2)} az=${az.toFixed(2)}`, worst < 1.5 && (v.x !== home.x || v.z !== home.z), { worstPx: +worst.toFixed(3) });
  }

  // pinch out about a point off centre: zooms in, the ground under the midpoint stays put
  {
    await reset();
    const m = [cx + 40, cy - 60], g = await grab(...m), h0 = (await view()).h;
    await touch('touchStart', [[...at(m[0] - 50, m[1] - 50), 1]]);
    await touch('touchStart', [[...at(m[0] - 50, m[1] - 50), 1], [...at(m[0] + 50, m[1] + 50), 2]]);
    let worst = 0;
    for (let i = 1; i <= 10; i++) {
      const d = 50 + 5 * i;
      await touch('touchMove', [[...at(m[0] - d, m[1] - d), 1], [...at(m[0] + d, m[1] + d), 2]]);
      worst = Math.max(worst, await err(g, ...m));
    }
    const v = await view();
    await touch('touchEnd', [[...at(m[0] - 100, m[1] - 100), 1], [...at(m[0] + 100, m[1] + 100), 2]]);
    const lim = await rig((nav) => nav.limits);
    const want = Math.max(lim.hMin, h0 / 2);
    check(name, 'pinch zoom about the midpoint', worst < 1.5 && Math.abs(v.h - want) / want < 0.02, { worstPx: +worst.toFixed(3), h0, h: v.h, want });
  }

  // twist: past the threshold the view turns with the fingers; the midpoint stays put
  {
    await reset();
    const m = [cx, cy], g = await grab(...m), az0 = (await view()).az, r = 80;
    const pts = (a) => [[...at(m[0] - r * Math.cos(a), m[1] - r * Math.sin(a)), 1], [...at(m[0] + r * Math.cos(a), m[1] + r * Math.sin(a)), 2]];
    await touch('touchStart', [pts(0)[0]]);
    await touch('touchStart', pts(0));
    let worst = 0;
    const turn = (50 * Math.PI) / 180;
    for (let i = 1; i <= 15; i++) { await touch('touchMove', pts((turn * i) / 15)); worst = Math.max(worst, await err(g, ...m)); }
    const v = await view();
    await touch('touchEnd', pts(turn));
    const th = await rig((nav) => nav.o.rotateThreshold);
    const d = Math.atan2(Math.sin(v.az - az0), Math.cos(v.az - az0));
    // fingers turning clockwise on screen turn the map with them
    check(name, 'twist rotate', worst < 1.5 && Math.abs(Math.abs(d) - (turn - th)) < 0.02 && Math.abs(v.h - home.h) / home.h < 0.02, { worstPx: +worst.toFixed(3), dAz: +d.toFixed(4), want: +(turn - th).toFixed(4) });
  }

  // two fingers sliding up together tilt the view steeper, without zooming or turning
  {
    await reset({ el: 0.6 });
    const y0 = cy + 60;
    await touch('touchStart', [[...at(cx - 60, y0), 1]]);
    await touch('touchStart', [[...at(cx - 60, y0), 1], [...at(cx + 60, y0), 2]]);
    for (let i = 1; i <= 12; i++) await touch('touchMove', [[...at(cx - 60, y0 - 10 * i), 1], [...at(cx + 60, y0 - 10 * i), 2]]);
    const v = await view();
    await touch('touchEnd', [[...at(cx - 60, y0 - 120), 1], [...at(cx + 60, y0 - 120), 2]]);
    const lim = await rig((nav) => nav.limits);
    check(name, 'two-finger tilt', v.el > 0.6 + 0.3 && v.el <= lim.elMax + 1e-9 && Math.abs(v.h - home.h) / home.h < 0.03 && Math.abs(v.az - home.az) < 1e-6, { el: +v.el.toFixed(3), h: v.h });
  }

  // lift the first finger of a pinch and carry on with the second: no jump, and it pans
  {
    await reset();
    await touch('touchStart', [[...at(cx - 60, cy), 1]]);
    await touch('touchStart', [[...at(cx - 60, cy), 1], [...at(cx + 60, cy), 2]]);
    await touch('touchMove', [[...at(cx - 70, cy), 1], [...at(cx + 70, cy), 2]]);
    const before = await view();
    await touch('touchEnd', [[...at(cx - 70, cy), 1]]);
    const after = await view();
    const g = await grab(cx + 70, cy);
    let worst = 0;
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[...at(cx + 70 - 10 * i, cy + 12 * i), 2]]); worst = Math.max(worst, await err(g, cx + 70 - 10 * i, cy + 12 * i)); }
    await page.waitForTimeout(150);
    await touch('touchEnd', [[...at(cx - 10, cy + 96), 2]]);
    const jump = Math.hypot(after.x - before.x, after.z - before.z) + Math.abs(after.h - before.h);
    check(name, 'first finger lifts, second pans', jump < 1e-6 && worst < 1.5, { jump, worstPx: +worst.toFixed(3) });
  }

  // a third finger landing and moving doesn't disturb the pinch; lifting everything ends cleanly
  {
    await reset();
    const m = [cx, cy], g = await grab(...m);
    await touch('touchStart', [[...at(m[0] - 60, m[1]), 1]]);
    await touch('touchStart', [[...at(m[0] - 60, m[1]), 1], [...at(m[0] + 60, m[1]), 2]]);
    await touch('touchStart', [[...at(m[0] - 60, m[1]), 1], [...at(m[0] + 60, m[1]), 2], [...at(100, 200), 3]]);
    const v0 = await view();
    await touch('touchMove', [[...at(m[0] - 60, m[1]), 1], [...at(m[0] + 60, m[1]), 2], [...at(160, 320), 3]]);
    const v1 = await view();
    await touch('touchMove', [[...at(m[0] - 90, m[1]), 1], [...at(m[0] + 90, m[1]), 2], [...at(160, 320), 3]]);
    const e = await err(g, ...m);
    await touch('touchEnd', [[...at(160, 320), 3]]);
    await touch('touchEnd', [[...at(m[0] - 90, m[1]), 1], [...at(m[0] + 90, m[1]), 2]]);
    const idle = await rig((nav) => nav.gesture === 'idle' && nav.pointers === 0);
    check(name, 'third finger ignored', Math.abs(v1.x - v0.x) + Math.abs(v1.z - v0.z) + Math.abs(v1.h - v0.h) < 1e-6 && e < 1.5 && idle, { errPx: +e.toFixed(3), idle });
  }

  // the browser cancels a pan (a system gesture): nothing sticks, the next pan works
  {
    await reset();
    await touch('touchStart', [[...at(cx, cy), 1]]);
    await touch('touchMove', [[...at(cx + 40, cy + 40), 1]]);
    await touch('touchCancel', []);
    const idle = await rig((nav) => nav.gesture === 'idle' && nav.pointers === 0);
    const g = await grab(cx, cy);
    await touch('touchStart', [[...at(cx, cy), 1]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[...at(cx - 10 * i, cy), 1]]);
    const e = await err(g, cx - 60, cy);
    await page.waitForTimeout(150);
    await touch('touchEnd', [[...at(cx - 60, cy), 1]]);
    check(name, 'pointercancel then pan', idle && e < 1.5, { idle, errPx: +e.toFixed(3) });
  }

  // a tap with a little jitter doesn't pan; a double tap zooms in about the spot
  {
    await reset();
    // (the zoom centres on where the second tap lifted)
    const s = [cx + 30, cy + 20], g = await grab(s[0] - 3, s[1] + 3), h0 = (await view()).h;
    const tap = async (j) => {
      await touch('touchStart', [[...at(s[0], s[1]), 1]]);
      await touch('touchMove', [[...at(s[0] + j, s[1] - j), 1]]);
      await touch('touchEnd', [[...at(s[0] + j, s[1] - j), 1]]);
    };
    await freeze();
    await tap(3);
    const afterOne = await view();
    await page.waitForTimeout(80);
    await tap(-3);
    await thaw();
    await settle();
    const v = await view();
    const lim = await rig((nav) => nav.limits);
    const want = Math.max(lim.hMin, h0 * (await rig((nav) => nav.o.doubleTapZoom)));
    const e = await err(g, s[0] - 3, s[1] + 3);
    const still = Math.abs(afterOne.x - home.x) + Math.abs(afterOne.z - home.z) < 1e-6;
    // the game keeps double tap for zooming only while looking round, as before
    check(name, 'jittery tap stays; double tap zooms', still && Math.abs(v.h - want) / want < 0.02 && e < 1.5, { still, h: v.h, want, errPx: +e.toFixed(3) });
  }

  // mouse wheel zooms about the cursor
  {
    await reset();
    const s = [cx - 50, cy - 100], g = await grab(...s), h0 = (await view()).h;
    // (what a wheel notch reports depends on the device; the zoom follows what the page is told)
    await page.evaluate(() => addEventListener('wheel', (e) => { window.__wheel = e.deltaY; }, { once: true, capture: true }));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at(...s)[0], y: at(...s)[1], deltaX: 0, deltaY: 100 });
    await page.waitForTimeout(100);
    const v = await view(), dy = await page.evaluate(() => window.__wheel);
    const e = await err(g, ...s), want = Math.pow(1.12, dy / 100);
    check(name, 'wheel zooms about the cursor', dy > 0 && Math.abs(v.h / h0 - want) < 0.005 && e < 1.5, { ratio: +(v.h / h0).toFixed(4), want: +want.toFixed(4), deltaY: dy, errPx: +e.toFixed(3) });
  }

  // limits: pinching far out stops at hMax, and a flick far away stays inside the bounds
  {
    await reset();
    await touch('touchStart', [[...at(cx - 150, cy), 1]]);
    await touch('touchStart', [[...at(cx - 150, cy), 1], [...at(cx + 150, cy), 2]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[...at(cx - 150 + 14 * i, cy), 1], [...at(cx + 150 - 14 * i, cy), 2]]);
    await touch('touchEnd', [[...at(cx - 10, cy), 1], [...at(cx + 10, cy), 2]]);
    const v = await view(), lim = await rig((nav) => nav.limits);
    check(name, 'zoom stops at the limit', v.h <= lim.hMax + 1e-6 && v.h >= lim.hMin - 1e-6, { h: v.h, hMax: lim.hMax });
  }

  // keyboard: an arrow key pans, Q turns
  {
    await reset();
    await hold('ArrowRight');
    const mid = await view();
    await hold('KeyQ');
    await settle();
    const v = await view();
    // the right arrow moves the view to the right on screen, and Q turns the map anticlockwise
    const r = { x: Math.cos(home.az), z: -Math.sin(home.az) };
    const along = (mid.x - home.x) * r.x + (mid.z - home.z) * r.z;
    check(name, 'keyboard pans and turns', along > 1 && v.az - mid.az < -0.05, { along: +along.toFixed(2), dAz: +(v.az - mid.az).toFixed(3) });
  }

  if (name === 'game') {
    // a build-mode drag draws a road and never pans
    await reset({ el: 0.9, h: 200 });
    const n0 = await page.evaluate(() => window.proto.net.segs.size);
    await page.evaluate(() => window.proto.setMode('road'));
    await page.waitForTimeout(100);
    const v0 = await view();
    await touch('touchStart', [[...at(cx - 80, cy + 120), 1]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[...at(cx - 80 + 16 * i, cy + 120 - 4 * i), 1]]);
    await touch('touchEnd', [[...at(cx + 80, cy + 80), 1]]);
    await page.waitForTimeout(500);
    const v1 = await view();
    // the drawn road waits in the blueprint bar: tap Build
    const btn = await page.evaluate(() => { const b = document.querySelector('#bpb'); if (!b || b.disabled) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (btn) { await freeze(); await touch('touchStart', [[btn.x, btn.y, 1]]); await touch('touchEnd', [[btn.x, btn.y, 1]]); await thaw(); await page.waitForTimeout(800); }
    const n1 = await page.evaluate(() => window.proto.net.segs.size);
    check(name, 'build-mode drag draws, no pan', Math.abs(v1.x - v0.x) + Math.abs(v1.z - v0.z) < 1e-6 && n1 > n0, { segs: [n0, n1] });
    // a two-finger pinch still works in build mode
    const h0 = v1.h;
    await touch('touchStart', [[...at(cx - 40, cy), 1]]);
    await touch('touchStart', [[...at(cx - 40, cy), 1], [...at(cx + 40, cy), 2]]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[...at(cx - 40 - 8 * i, cy), 1], [...at(cx + 40 + 8 * i, cy), 2]]);
    await touch('touchEnd', [[...at(cx - 88, cy), 1], [...at(cx + 88, cy), 2]]);
    const v2 = await view();
    const n2 = await page.evaluate(() => window.proto.net.segs.size);
    check(name, 'build-mode pinch zooms, draws nothing', v2.h < h0 * 0.8 && n2 === n1, { h0, h: v2.h, segs: n2 });
    await page.evaluate(() => window.proto.setMode('look'));

    // a tap on a building opens its card
    await reset({ el: 1.1, h: 160 });
    await page.waitForTimeout(200);
    const spot = await page.evaluate(() => {
      const P = window.proto, W = innerWidth, H = innerHeight;
      for (const b of P.buildings) {
        if (b.dying) continue;
        // aim at the roof, which nothing stands in front of from above
        const s = P.toScreen({ x: b.lot.x, y: b.height * 0.9, z: b.lot.z });
        if (s.x < 60 || s.x > W - 60 || s.y < 200 || s.y > H - 250) continue;
        if (P.pickBuilding(s.x, s.y)) return s;
      }
      return null;
    });
    if (!spot) check(name, 'tap a building opens its card', false, { reason: 'no building on screen' });
    else {
      await freeze();
      await touch('touchStart', [[spot.x, spot.y, 1]]);
      await touch('touchEnd', [[spot.x, spot.y, 1]]);
      await thaw();
      await page.waitForTimeout(400);
      const shown = await page.evaluate(() => { const c = document.querySelector('#card'); const p = document.querySelector('#panel'); return (!!c && !c.classList.contains('hidden')) || (!!p && !p.classList.contains('hidden')); });
      check(name, 'tap a building opens its card', shown, { at: spot });
    }
  }
  check(name, 'no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
  await page.close();
}
await browser.close();
console.log(`\n${results.length - failed}/${results.length} passed`);
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
process.exit(failed ? 1 : 0);
