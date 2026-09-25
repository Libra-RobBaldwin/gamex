// The start menu and the guided start (src/app, docs/region.md step F), by touch on a phone:
//   npm run build && node e2e/menu.e2e.mjs [screenshot dir]
// (or BASE=http://localhost:5173 node e2e/menu.e2e.mjs to use a running server instead of dist)
// Checks: a fresh visit shows the menu, fast, without the game's code; every ready map starts;
// back (and Menu > Main menu) returns to the menu; deep links go straight in; the guide shows
// once and again on request; and it all works with storage blocked. No console errors anywhere.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ?? join(tmpdir(), 'menu-e2e');
mkdirSync(shots, { recursive: true });
let BASE = process.env.BASE, server;
if (!BASE) {
  if (!existsSync(join(root, 'dist/index.html'))) { console.error('Run npm run build first (or set BASE).'); process.exit(1); }
  const PORT = 4183;
  BASE = `http://127.0.0.1:${PORT}`;
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'pipe' });
  for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/`)).ok) break; } catch { /* not up yet */ } if (i > 100) throw new Error('vite preview did not start'); await new Promise((r) => setTimeout(r, 100)); }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

// a fresh phone: a new context, so nothing is remembered from an earlier run
async function phone({ blockStorage = false, landscape = false } = {}) {
  const ctx = await browser.newContext({ viewport: landscape ? { width: 915, height: 412 } : { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', serviceWorkers: 'block' });
  if (blockStorage) await ctx.addInitScript(() => {
    const no = () => { throw new DOMException('blocked', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: no, configurable: true });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  return { ctx, page };
}
const inGame = (page, timeout = 120000) => page.waitForFunction(() => window.proto?.shell && document.body.dataset.app === 'game' && document.querySelector('#app').hidden, null, { timeout });
const atMenu = (page) => page.waitForSelector('#app .scr:not(.scr-load)', { timeout: 60000 });
const noErrors = (page, what) => check(page.errors.length === 0, `${what}: no console errors${page.errors.length ? ` (${page.errors.slice(0, 3).join(' | ')})` : ''}`);

// ---- 1. a fresh visit: the menu, fast, and none of the game's code ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/');
  await atMenu(page);
  const t = await page.evaluate(() => ({
    // the first paint with content, or (where the browser doesn't report paints) when the menu was drawn
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? performance.getEntriesByName('menu-shown')[0]?.startTime ?? -1,
    js: performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'script' || r.name.endsWith('.js')).reduce((s, r) => s + (r.encodedBodySize || r.transferSize || 0), 0),
    game: !!window.proto, canvas: getComputedStyle(document.querySelector('#c')).display,
  }));
  check(await page.$('.scr-home') !== null, 'a fresh visit shows the start menu');
  check(!t.game && t.canvas === 'none', 'the game is not loaded behind the menu');
  check(t.fcp > 0 && t.fcp < 1000, `the menu's first frame arrives in under 1 s (${Math.round(t.fcp)} ms)`);
  if (!process.env.BASE) check(t.js < 200_000, `the menu loads under 200 kB of script (${Math.round(t.js / 1000)} kB)`);
  check(await page.$('[data-continue]') === null, 'no Continue while nothing is saved');
  check((await page.$$('.mrow')).length === 5, 'New game, How to play, Library, Settings and About');
  await page.screenshot({ path: `${shots}/1-home.png` });
  for (const s of ['how', 'library', 'settings', 'about', 'new']) {
    await page.tap(`[data-go="${s}"]`);
    await page.waitForSelector(`.scr-${s}`);
    await page.screenshot({ path: `${shots}/1-${s}.png` });
    if (s !== 'new') { await page.goBack(); await page.waitForSelector('.scr-home'); }
  }
  check(await page.evaluate(() => document.querySelector('.scr-about') === null), 'back steps from a screen to the home screen');
  const cards = await page.$$eval('.map', (els) => els.map((e) => ({ ready: e.classList.contains('ready'), text: e.textContent })));
  check(cards.length >= 4 && cards.some((c) => /Region/.test(c.text) && c.ready) && cards.some((c) => !c.ready && /Plans only/i.test(c.text)), 'New game lists the maps: the region ready, real towns as plans only');
  await page.goto(BASE + '/#about');
  await atMenu(page);
  check(/OpenStreetMap contributors/.test(await page.textContent('.scr-about')), 'About credits © OpenStreetMap contributors');
  check(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(await page.textContent('#app')), 'no emoji');
  await page.tap('[data-back]');
  await page.waitForSelector('.scr-home');
  check(true, 'a screen opened by a link goes back to the home screen');
  noErrors(page, 'menu');
  await ctx.close();
}

// ---- 2. every ready map starts, and back returns to the menu ----
for (const id of ['town', 'sandbox']) {
  const { ctx, page } = await phone();
  await page.goto(BASE + '/#new');
  await atMenu(page);
  await page.tap(`[data-play="${id}"]`);
  await inGame(page);
  await page.waitForTimeout(2500);
  const segs = await page.evaluate(() => window.proto.net.segs.size);
  check(new URL(page.url()).search === `?map=${id}`, `${id}: the address is ?map=${id}`);
  check(id === 'town' ? segs > 10 : segs === 0, `${id}: starts (${segs} roads)`);
  if (id === 'town') await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  check((id === 'town') === (await page.$('#guide') !== null), `${id}: the guide ${id === 'town' ? 'shows on a first visit' : 'is only for the starter town'}`);
  await page.screenshot({ path: `${shots}/2-${id}.png` });
  // the phone's back button asks first...
  await page.goBack();
  await page.waitForFunction(() => window.proto.shell.sheetKey === 'leave', null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.proto.shell.sheetKey) === 'leave', `${id}: back asks before leaving the town`);
  check(new URL(page.url()).search === `?map=${id}`, `${id}: ...and stays in the game while it asks`);
  await page.screenshot({ path: `${shots}/2-${id}-leave.png` });
  // ...and a second back leaves
  await page.goBack();
  await atMenu(page);
  check(await page.evaluate(() => !window.proto && document.body.dataset.app === 'menu'), `${id}: a second back returns to the menu, with the game gone`);
  noErrors(page, id);
  await ctx.close();
}

// ---- 3. Menu > Main menu in the HUD; Keep playing stays ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/?map=town');
  await inGame(page);
  check(await page.$('#app .scr-home') === null && await page.$('#guide') === null, 'a deep link goes straight in, with no menu and no guide');
  await page.tap('[data-bar="menu"]');
  await page.waitForTimeout(400);
  const home = await page.$('[data-menu]:has-text("Main menu")');
  check(home !== null, 'the HUD Menu has Main menu');
  await home.tap();
  await page.waitForTimeout(300);
  await page.tap('[data-stay]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.proto.shell.sheetKey === null && document.body.dataset.app === 'game'), 'Keep playing stays in the game');
  await page.tap('[data-bar="menu"]');
  await page.waitForTimeout(400);
  await (await page.$('[data-menu]:has-text("Main menu")')).tap();
  await page.waitForTimeout(300);
  await page.tap('[data-leave]');
  await atMenu(page);
  check(await page.$('.scr-home') !== null, 'Main menu > Leave returns to the start menu');
  // forward again goes back into the game
  await page.goForward();
  await inGame(page);
  check(true, 'forward from the menu reopens the game');
  noErrors(page, 'HUD menu');
  await ctx.close();
}

// ---- 4. deep links ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/?place=horley-demo');
  await inGame(page);
  check(true, '?place= goes straight into the game');
  await page.goto(BASE + '/?map=place');
  await atMenu(page);
  check(await page.$('.scr-new .notice') !== null && /Plans only/i.test(await page.textContent('.notice')), '?map=place (not ready) opens New game, saying so');
  await page.goto(BASE + '/?map=nowhere');
  await atMenu(page);
  check(await page.$('.scr-new .notice') !== null, 'an unknown ?map= opens New game, saying so');
  noErrors(page, 'deep links');
  await ctx.close();
}

// ---- 5. the guide: once, skippable, and again on request ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/#new');
  await atMenu(page);
  await page.tap('[data-play="town"]');
  await inGame(page);
  await page.waitForSelector('#guide', { timeout: 10000 });
  check(/Move the map/.test(await page.textContent('#guide')), 'the guide starts with moving the map');
  // do it: drag the map, and the step ticks itself off
  await page.evaluate(() => window.proto.focusOn({ x: 120, z: 90 }, 260));
  await page.waitForFunction(() => /Build a road/.test(document.querySelector('#guide')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check(/Build a road/.test(await page.textContent('#guide')), 'moving the map ticks step 1 and moves on to building a road');
  await page.screenshot({ path: `${shots}/5-guide-road.png` });
  // build one (as the road tool would), and place a stop
  await page.evaluate(() => window.proto.buildRoad({ x: -300, z: 300 }, { x: -300, z: 420 }));
  await page.waitForFunction(() => /bus stop/i.test(document.querySelector('#guide')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check(/bus stop/i.test(await page.textContent('#guide')), 'building a road moves on to the bus stop');
  await page.tap('#guide [data-next]');
  await page.waitForTimeout(200);
  const steps = await page.$$eval('#guide .g-dots i', (d) => d.length);
  check(steps >= 3 && steps <= 5, `the guide has 3–5 steps (${steps})`);
  await page.screenshot({ path: `${shots}/5-guide-next.png` });
  await page.tap('#guide [data-skip]');
  check(await page.$('#guide') === null, 'Skip guide closes it');
  noErrors(page, 'guide');
  // a second game: no guide
  await page.goto(BASE + '/#new');
  await atMenu(page);
  await page.tap('[data-play="town"]');
  await inGame(page);
  await page.waitForTimeout(1500);
  check(await page.$('#guide') === null, 'the guide shows only once');
  // How to play > Start the guided game shows it again
  await page.goto(BASE + '/#how');
  await atMenu(page);
  await page.tap('[data-guide]');
  await inGame(page);
  await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  check(await page.$('#guide') !== null, 'How to play starts the guide again');
  // Settings > Show the guide again
  await page.goto(BASE + '/#settings');
  await atMenu(page);
  await page.tap('[data-guide-reset]');
  await page.tap('[data-back]');
  await page.tap('[data-go="new"]');
  await page.tap('[data-play="town"]');
  await inGame(page);
  await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  check(await page.$('#guide') !== null, 'Settings > Show the guide again brings it back');
  noErrors(page, 'guide again');
  await ctx.close();
}

// ---- 6. storage blocked: everything still works ----
{
  const { ctx, page } = await phone({ blockStorage: true });
  await page.goto(BASE + '/');
  await atMenu(page);
  await page.tap('[data-go="settings"]');
  await page.tap('input[name="q"][value="3"]');
  await page.tap('[data-back]');
  await page.tap('[data-go="new"]');
  await page.tap('[data-play="town"]');
  await inGame(page);
  check(await page.evaluate(() => window.proto.perf().tier) === 'Fast', 'with storage blocked, the menu works and its quality setting reaches the game');
  noErrors(page, 'storage blocked');
  await ctx.close();
}

// ---- 7. landscape ----
{
  const { ctx, page } = await phone({ landscape: true });
  await page.goto(BASE + '/');
  await atMenu(page);
  const fits = await page.evaluate(() => [...document.querySelectorAll('.mrow')].every((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; }));
  check(fits, 'landscape: every menu button is on screen');
  await page.screenshot({ path: `${shots}/7-landscape.png` });
  await page.tap('[data-go="new"]');
  await page.tap('[data-play="town"]');
  await inGame(page);
  await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/7-landscape-game.png` });
  noErrors(page, 'landscape');
  await ctx.close();
}

// ---- 9. the region: set up, started from the menu with its options, and back to its setup ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/#new');
  await atMenu(page);
  await page.tap('[data-go="region"]');
  await page.waitForSelector('.scr-region');
  await page.tap('[data-count="rivers"] [data-step="1"]');
  await page.tap('input[name="rg-style"][value="arctic"]');
  await page.fill('#rg-seed', '42');
  await page.dispatchEvent('#rg-seed', 'change');
  check(await page.textContent('[data-count="rivers"] output') === '2', 'region setup: the steppers change the counts');
  await page.screenshot({ path: `${shots}/9-region-setup.png`, fullPage: true });
  await page.tap('[data-start]');
  await inGame(page, 300000).catch(() => {}); // (a 6 km map is slow to build under software rendering)
  const q = new URLSearchParams(new URL(page.url()).search);
  check(q.get('map') === 'region' && q.get('seed') === '42' && q.get('rivers') === '2' && q.get('style') === 'arctic', `the region starts from the menu with its options (${new URL(page.url()).search})`);
  check(await page.evaluate(() => !!window.proto?.shell && document.body.dataset.app === 'game'), 'the region loads');
  // a finger dragged over the map moves it (the place names' layer once caught every touch)
  {
    await page.waitForTimeout(3000);
    const at = () => page.evaluate(() => ({ x: window.proto.nav.view.x, z: window.proto.nav.view.z }));
    const v0 = await at(), cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await touch('touchStart', [{ x: 200, y: 450 }]);
    for (let i = 1; i <= 12; i++) { await touch('touchMove', [{ x: 200 + i * 10, y: 450 + i * 15 }]); await page.waitForTimeout(40); }
    await touch('touchEnd', []);
    await page.waitForTimeout(1500);
    const v1 = await at();
    check(Math.hypot(v1.x - v0.x, v1.z - v0.z) > 20, `dragging moves the region map (moved ${Math.round(Math.hypot(v1.x - v0.x, v1.z - v0.z))} m)`);
    await cdp.detach();
  }
  await page.screenshot({ path: `${shots}/9-region.png` });
  await page.goBack();
  await page.waitForTimeout(800);
  await page.goBack();
  await page.waitForSelector('#app .scr-region', { timeout: 60000 }).catch(() => {});
  check(await page.$('.scr-region') !== null && await page.inputValue('#rg-seed') === '42', 'back returns to the region setup, with the choices kept');
  noErrors(page, 'region');
  await ctx.close();
}

// ---- 8. the Library: every explorer opens from the menu, as part of the app, and back returns ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/#library');
  await atMenu(page);
  const ids = await page.$$eval('[data-explorer]', (as) => as.map((a) => a.dataset.explorer));
  check(ids.length === 6, `the Library lists the six explorers (${ids.join(', ')})`);
  for (const id of ids) {
    await page.tap(`[data-explorer="${id}"]`);
    const shown = await page.waitForSelector('#lib-back', { state: 'visible', timeout: 90000 }).then(() => true, () => false);
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => {
      const b = document.querySelector('#lib-back')?.getBoundingClientRect();
      return {
        emoji: (document.body.innerText.replace(/[©®™◀▶]/g, '').match(/\p{Extended_Pictographic}/gu) ?? []).join(''),
        perf: [...document.querySelectorAll('#stats, #perf')].some((e) => e.offsetParent !== null),
        onScreen: !!b && b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.width >= 44 && b.height >= 32,
        top: b && document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.closest('#lib-back') !== null,
      };
    });
    check(shown && r.onScreen && r.top, `${id}: opens with a Library button on top, in reach`);
    check(!r.perf && !r.emoji, `${id}: no developer readouts and no emoji${r.emoji ? ` (${r.emoji})` : ''}`);
    await page.screenshot({ path: `${shots}/8-${id}.png` });
    await page.tap('#lib-back');
    await page.waitForSelector('#app .scr-library', { timeout: 30000 });
  }
  check(true, 'the Library button returns to the Library each time');
  // the phone's back button does too
  await page.tap('[data-explorer="bridges"]');
  await page.waitForSelector('#lib-back', { timeout: 90000 });
  await page.goBack();
  await page.waitForSelector('#app .scr-library', { timeout: 30000 }).then(() => check(true, 'back from an explorer returns to the Library'), () => check(false, 'back from an explorer returns to the Library'));
  noErrors(page, 'library');
  // opened directly, an explorer page is left as it was, for development
  await page.goto(BASE + '/bridges-demo.html');
  await page.waitForTimeout(3000);
  check(await page.$('#lib-back') === null, 'opened directly, an explorer has no Library button');
  await ctx.close();
}

await browser.close();
server?.kill();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed', `· screenshots in ${shots}`);
process.exit(failures.length ? 1 : 0);
