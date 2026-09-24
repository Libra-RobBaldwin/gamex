// Regression checks for the game (proto.html) after its own camera and gesture code was replaced
// by the shared kit (src/proto/kit/camera.ts). Each check passes on the game as it was before
// (origin/claude/cloud-session-history-rvqkm1) and measures something a player would notice.
//
//   npx vite --port 4282 &                     (or set BASE to a running server)
//   npm i --no-save playwright-core@1.56       (or run a copy from a folder that has it)
//   node e2e/game.review.e2e.mjs [check ...]   checks: keys wheel offset
//
// Exits 1 if anything fails.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:4282';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const WAIT = Number(process.env.WAIT ?? 10000);
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

const results = [];
let failed = 0;
const check = (name, ok, info) => {
  results.push({ name, ok, ...info });
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(46)} ${JSON.stringify(info)}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});
const open = async (opts) => {
  const page = await browser.newPage(opts);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/proto.html');
  await page.waitForFunction('!!window.proto', null, { timeout: 60000 });
  await page.waitForTimeout(WAIT);
  // Software rendering takes a second or more a frame: around taps the page's frame loop is
  // paused (the next frame is held back, then released), as in nav.e2e.mjs.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    let held = null;
    window.__freeze = false;
    window.requestAnimationFrame = (f) => (window.__freeze ? ((held = f), 0) : raf(f));
    window.__thaw = () => { window.__freeze = false; if (held) { const f = held; held = null; raf(f); } };
  });
  return { page, errors };
};
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// Desktop: with focus in the side panel (the road picker, a long list), the arrow keys and
// Page Down scroll the list, as they always have, and leave the map where it is.
if (want('keys')) {
  const { page } = await open({ viewport: { width: 1000, height: 800 } });
  // (the HUD's Build sheet, then "More road types": a long list in the sheet's scrolling body)
  await page.evaluate(() => window.proto.shell.openBuild('roads'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => [...document.querySelectorAll('#sheet button')].find((b) => /More road types/.test(b.textContent ?? ''))?.click());
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const p = document.querySelector('#sheet .sb');
    (p.querySelector('[data-pick]') ?? p.querySelector('button'))?.focus();
    return { open: !document.querySelector('#sheet').hidden, scrollable: p.scrollHeight > p.clientHeight + 100, focused: document.activeElement?.tagName };
  });
  const v0 = await page.evaluate(() => ({ ...window.proto.view }));
  for (const k of ['PageDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) { await page.keyboard.down(k); await page.waitForTimeout(400); await page.keyboard.up(k); }
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => ({ scroll: document.querySelector('#sheet .sb').scrollTop, v: { ...window.proto.view } }));
  const moved = Math.hypot(r.v.x - v0.x, r.v.z - v0.z) + Math.abs(r.v.h - v0.h);
  check('keys in the side panel scroll it, not the map', info.open && info.scrollable && r.scroll > 100 && moved < 1e-6, { ...info, scrollTop: r.scroll, mapMoved: +moved.toFixed(2) });
  await page.close();
}

// Phone-sized page at DPR 2: one notch of a mouse wheel (the browser reports it as fewer than
// 100 px) zooms by the game's usual step, 1.12, not half of it.
if (want('wheel')) {
  const { page } = await open(PHONE);
  const cdp = await page.context().newCDPSession(page);
  const h0 = await page.evaluate(() => window.proto.view.h);
  await page.evaluate(() => addEventListener('wheel', (e) => { window.__wheel = [e.deltaY, e.deltaMode]; }, { once: true, capture: true }));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 400, deltaX: 0, deltaY: 100 });
  await page.waitForTimeout(1500);
  const h = await page.evaluate(() => window.proto.view.h), got = await page.evaluate(() => window.__wheel);
  check('one wheel notch zooms by the usual step', h / h0 > 1.1, { ratio: +(h / h0).toFixed(4), want: 1.12, deltaY: got?.[0], deltaMode: got?.[1] });
  await page.close();
}

// The canvas not at the page's top left (a frame, a banner above the map): a tap on a building
// still opens that building's card. The kit hands the game element-relative points; pickBuilding
// (through ndc) still takes page points and subtracts the canvas offset a second time.
if (want('offset')) {
  const { page, errors } = await open(PHONE);
  const cdp = await page.context().newCDPSession(page);
  let clock = Date.now() / 1000;
  const touch = (type, pts, dt) => { clock += dt; return cdp.send('Input.dispatchTouchEvent', { type, timestamp: clock, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) }); };
  await page.evaluate(() => { const c = document.querySelector('#c'); c.style.top = '60px'; c.style.left = '30px'; dispatchEvent(new Event('resize')); });
  await page.evaluate(() => Object.assign(window.proto.view, { el: 1.1, h: 160 }));
  await page.waitForTimeout(4000);
  const spot = await page.evaluate(() => {
    const P = window.proto, r = document.querySelector('#c').getBoundingClientRect();
    for (const b of P.buildings) {
      if (b.dying) continue;
      // aim at the roof, in canvas pixels, then turn that into page pixels for the finger
      const s = P.toScreen({ x: b.lot.x, y: b.height * 0.9, z: b.lot.z });
      if (s.x < 60 || s.x > r.width - 60 || s.y < 200 || s.y > r.height - 300) continue;
      return { x: s.x + r.left, y: s.y + r.top, name: b.name };
    }
    return null;
  });
  if (!spot) check('offset canvas: tap a building opens its card', false, { reason: 'no building on screen' });
  else {
    await page.evaluate(() => { window.__freeze = true; });
    await page.waitForTimeout(3000);
    // (event timestamps given, so the kit sees a quick tap however slow the page is)
    await touch('touchStart', [[spot.x, spot.y, 1]], 0.5);
    await touch('touchEnd', [[spot.x, spot.y, 1]], 0.08);
    await page.evaluate(() => window.__thaw());
    await page.waitForTimeout(1500);
    // (the building's info sheet names it)
    const card = await page.evaluate(() => { const c = document.querySelector('#sheet'); return c.hidden ? null : c.textContent ?? ''; });
    const first = spot.name.split(' · ')[0];
    check('offset canvas: tap a building opens its card', !!card && card.includes(first), { tapped: spot.name, card: card?.slice(0, 80) });
  }
  check('no page errors', errors.length === 0, { errors: errors.slice(0, 3) });
  await page.close();
}

await browser.close();
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
