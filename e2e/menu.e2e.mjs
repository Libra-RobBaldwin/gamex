// The start menu and the guided start (src/app, docs/region.md step F), by touch on a phone:
//   npm run build && node e2e/menu.e2e.mjs [screenshot dir]
// (or BASE=http://localhost:5173 node e2e/menu.e2e.mjs to use a running server instead of dist)
// Checks: a fresh visit shows the menu, fast, without the game's code; New game is the Region setup,
// and the region starts from it;
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
// New game > the Region setup, answered with the first card at each step and a fixed seed, then Start
async function playRegion(page, seed = '42') {
  if (!(await page.$('.scr-region'))) await page.tap('[data-go="region"]');
  await page.waitForSelector('.scr-region');
  // (a second time it opens on the summary of the last one's answers)
  if (!(await page.$('.summary'))) {
    await page.tap('[data-place]'); await page.waitForSelector('[data-climate]');
    await page.tap('[data-climate]'); await page.waitForSelector('[data-size]');
    await page.tap('[data-size]'); await page.waitForSelector('.summary');
  }
  await page.tap('details.more summary');
  await page.fill('#rg-seed', seed); await page.dispatchEvent('#rg-seed', 'change');
  await page.tap('[data-start]');
  await inGame(page, 300000);
}
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
  check((await page.$$('.scr-home [data-go]')).length === 5, 'New game, How to play, Library, Settings and About');
  check(await page.$eval('.hero img', (i) => i.complete && i.naturalWidth > 0).catch(() => false) || await page.waitForFunction(() => document.querySelector('.hero img')?.naturalWidth > 0, null, { timeout: 5000 }).then(() => true, () => false), 'the town picture behind the menu loads');
  await page.screenshot({ path: `${shots}/1-home.png` });
  for (const s of ['how', 'library', 'settings', 'about', 'region']) {
    await page.tap(`[data-go="${s}"]`);
    await page.waitForSelector(`.scr-${s}`);
    await page.screenshot({ path: `${shots}/1-${s}.png` });
    if (s !== 'region') { await page.goBack(); await page.waitForSelector('.scr-home'); }
  }
  check(await page.evaluate(() => document.querySelector('.scr-about') === null), 'back steps from a screen to the home screen');
  check(await page.$('.scr-region [data-place]') !== null && await page.$('.map [data-play]') === null, 'New game is the Region setup: one map, no map cards');
  check(!/Starter town|Sandbox|Real Town Plans/.test(await page.textContent('#app')), 'no starter town, sandbox or Real Town Plans anywhere in New game');
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

// ---- 2. the region starts from New game (the guide on a first visit), and back returns to the menu ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/');
  await atMenu(page);
  await playRegion(page);
  await page.waitForTimeout(2500);
  const segs = await page.evaluate(() => window.proto.net.segs.size);
  const q = new URLSearchParams(new URL(page.url()).search);
  check(q.get('map') === 'region' && q.get('seed') === '42' && q.get('size') === '50', `the address names the region and its options (${new URL(page.url()).search})`);
  check(segs > 10, `the region starts with its start town (${segs} roads)`);
  // the first view shows the start town, not sky: the ground under the middle of the screen and a
  // quarter of the way down is found, and the middle is in the town
  const look = await page.evaluate(() => {
    const P = window.proto, W = innerWidth, H = innerHeight, st = P.map.world.settlements[0];
    const at = (sx, sy) => { const g = P.nav.screenToGround(sx, sy); return g ? { x: Math.round(g.x), z: Math.round(g.z), d: Math.round(Math.hypot(g.x - st.x, g.z - st.z)) } : null; }; // (null: the ray under that point is sky)
    return { mid: at(W / 2, H / 2), upper: at(W / 2, H / 4), r: st.reach, dpr: devicePixelRatio };
  });
  check(look.dpr === 2 && look.mid && look.upper && look.mid.d < look.r, `the first view at DPR 2 looks at the start town, not the sky (${JSON.stringify(look)})`);
  await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  check(await page.$('#guide') !== null, 'the guide shows on a first visit, in the start town');
  await page.screenshot({ path: `${shots}/2-region.png` });
  // the phone's back button asks first...
  await page.goBack();
  await page.waitForFunction(() => window.proto.shell.sheetKey === 'leave', null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.proto.shell.sheetKey) === 'leave', 'back asks before leaving the town');
  check(new URLSearchParams(new URL(page.url()).search).get('map') === 'region', '...and stays in the game while it asks');
  await page.screenshot({ path: `${shots}/2-region-leave.png` });
  // ...and a second back leaves
  await page.goBack();
  await atMenu(page);
  check(await page.evaluate(() => !window.proto && document.body.dataset.app === 'menu'), 'a second back returns to the menu, with the game gone');
  noErrors(page, 'region from New game');
  await ctx.close();
}

// ---- 3. Menu > Main menu in the HUD; Keep playing stays ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/?map=region&seed=42');
  await inGame(page, 300000);
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
  await inGame(page, 300000);
  check(true, 'forward from the menu reopens the game');
  noErrors(page, 'HUD menu');
  await ctx.close();
}

// ---- 4. deep links to maps the game no longer has: the Region setup, saying so ----
{
  const { ctx, page } = await phone();
  for (const [q, what] of [['?map=town', /starter town is gone/], ['?map=sandbox', /sandbox is gone/], ['?place=horley-demo', /Real Town Plans is gone/], ['?map=nowhere', /nowhere/]]) {
    await page.goto(BASE + '/' + q);
    await atMenu(page);
    check(await page.$('.scr-region .notice') !== null && what.test(await page.textContent('.notice')), `${q} opens the Region setup, saying so`);
  }
  await page.screenshot({ path: `${shots}/4-gone.png` });
  noErrors(page, 'deep links');
  await ctx.close();
}

// ---- 5. the guide: once, skippable, and again on request ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/');
  await atMenu(page);
  await playRegion(page);
  await page.waitForSelector('#guide', { timeout: 10000 });
  check(/Move the map/.test(await page.textContent('#guide')), 'the guide starts with moving the map');
  // do it: drag the map, and the step ticks itself off
  await page.evaluate(() => window.proto.focusOn({ x: 120, z: 90 }, 260));
  await page.waitForFunction(() => /Place a bus stop/.test(document.querySelector('#guide')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check(/Place a bus stop/.test(await page.textContent('#guide')), 'moving the map ticks step 1 and moves on to placing a bus stop');
  check(await page.evaluate(() => { const g = document.querySelector('#goal'); return !g || g.getClientRects().length === 0; }), 'the game\'s own goal strip stays hidden while the guide is up');
  await page.screenshot({ path: `${shots}/5-guide-stop.png` });
  // place one (as the stop tool would), and the guide moves on to the line
  await page.evaluate(() => {
    const P = window.proto, net = P.net, n = net.nearestSeg({ x: -110, z: 30 }, 120, (s) => net.def(s).cls === 'road');
    if (n) for (const side of [1, -1]) for (const d of [0, 15, -15]) { const { plans } = net.planStop(n.seg.id, n.s + d, side); const pl = plans.find((x) => x.ok); if (pl) { net.addStop(n.seg.id, n.s + d, side, pl); P.rebuild(); return; } }
  });
  await page.waitForFunction(() => /Start a bus line/.test(document.querySelector('#guide')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check(/Start a bus line/.test(await page.textContent('#guide')), 'placing a stop moves on to starting a line');
  await page.tap('#guide [data-next]');
  await page.waitForTimeout(200);
  const steps = await page.$$eval('#guide .g-dots i', (d) => d.length);
  check(steps >= 3 && steps <= 5, `the guide has 3–5 steps (${steps})`);
  await page.screenshot({ path: `${shots}/5-guide-next.png` });
  // (Next from the line step lands on the last step, which has Start playing in place of Skip)
  await page.tap('#guide [data-skip], #guide [data-next].primary');
  check(await page.$('#guide') === null, 'Skip guide (or Start playing on the last step) closes it');
  noErrors(page, 'guide');
  // a second game: no guide
  await page.goto(BASE + '/');
  await atMenu(page);
  await playRegion(page);
  await page.waitForTimeout(1500);
  check(await page.$('#guide') === null, 'the guide shows only once');
  // How to play > Start the guided game shows it again
  await page.goto(BASE + '/#how');
  await atMenu(page);
  await page.tap('[data-guide]');
  await inGame(page, 300000);
  await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  check(await page.$('#guide') !== null, 'How to play starts the guide again');
  // Settings > Show the guide again
  await page.goto(BASE + '/#settings');
  await atMenu(page);
  await page.tap('[data-guide-reset]');
  await page.tap('[data-back]');
  await playRegion(page);
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
  await playRegion(page);
  check(await page.evaluate(() => window.proto.perf().tier) === 'Fast', 'with storage blocked, the menu works and its quality setting reaches the game');
  noErrors(page, 'storage blocked');
  await ctx.close();
}

// ---- 7. landscape ----
{
  const { ctx, page } = await phone({ landscape: true });
  await page.goto(BASE + '/');
  await atMenu(page);
  const fits = await page.evaluate(() => [...document.querySelectorAll('.scr-home [data-go]')].every((b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; }));
  check(fits, 'landscape: every menu button is on screen');
  await page.screenshot({ path: `${shots}/7-landscape.png` });
  await playRegion(page);
  await page.waitForSelector('#guide', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${shots}/7-landscape-game.png` });
  noErrors(page, 'landscape');
  await ctx.close();
}

// ---- 8b. Settings > Delete all saved data: every save and setting gone, the app starts afresh ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/');
  await atMenu(page);
  // a saved town (its index entry is what the menu lists) and a remembered setting
  await page.evaluate(() => new Promise((ok, fail) => {
    const r = indexedDB.open('untitled', 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('saves', { keyPath: 'id' }); db.createObjectStore('index', { keyPath: 'id' }).createIndex('savedAt', 'savedAt'); };
    r.onsuccess = () => { const t = r.result.transaction('index', 'readwrite'); t.objectStore('index').put({ id: 'wipe-test', name: 'Wipe test', map: { id: 'region', query: 'map=region&size=50' }, savedAt: Date.now(), summary: { residents: 10, balance: 400000, lines: 0, day: 1, time: '07:00' }, v: 2 }); t.oncomplete = () => { r.result.close(); ok(); }; t.onerror = () => fail(t.error); };
    r.onerror = () => fail(r.error);
  }));
  await page.evaluate(() => localStorage.setItem('untitled.quality', '2'));
  await page.reload(); await atMenu(page);
  await page.waitForSelector('[data-continue]', { timeout: 5000 }).catch(() => {});
  check(await page.$('[data-continue]') !== null, 'wipe: a saved town shows Continue before');
  await page.tap('[data-go="settings"]');
  await page.waitForSelector('[data-wipe]');
  await page.tap('[data-wipe]');
  check(/again/i.test(await page.textContent('[data-wipe]')), 'wipe: the first tap asks to confirm');
  await Promise.all([page.waitForNavigation({ timeout: 15000 }).catch(() => {}), page.tap('[data-wipe]')]);
  await atMenu(page);
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ cont: !!document.querySelector('[data-continue]'), q: localStorage.getItem('untitled.quality') }));
  check(!after.cont && after.q === null, 'wipe: after the second tap, no saved town and no remembered settings');
  noErrors(page, 'wipe');
  await ctx.close();
}

// ---- 9. the region: set up, started from the menu with its options, and back to its setup ----
{
  const { ctx, page } = await phone();
  await page.goto(BASE + '/#new'); // (an old address for New game: the Region setup)
  await atMenu(page);
  await page.waitForSelector('.scr-region');
  // simple steps, one question each: a tap on a card answers it and moves on
  check(await page.$$eval('.steps span', (d) => d.length) === 4 && await page.$('[data-place]') !== null, 'region setup: step 1 asks what kind of place');
  check(await page.$$eval('[data-real]', (d) => d.length) >= 2, 'region setup: real places from OS maps are offered on the first step');
  check(await page.$$eval('[data-place]', (d) => d.length) === 7, 'region setup: the seven landforms (vale to islands) on a 50 km map');
  await page.tap('[data-place="islands"]');
  await page.waitForSelector('[data-climate]');
  await page.tap('[data-climate="arctic"]');
  await page.waitForSelector('[data-size]');
  await page.tap('[data-size="city"]');
  await page.waitForSelector('.summary');
  check(/Islands/.test(await page.textContent('.summary')) && /Cold/.test(await page.textContent('.summary')), 'region setup: the summary shows what was picked');
  // the finer settings are folded away under More options
  await page.tap('details.more summary');
  const rivers0 = Number(await page.textContent('[data-count="rivers"] output'));
  await page.tap('[data-count="rivers"] [data-step="1"]');
  await page.fill('#rg-seed', '42');
  await page.dispatchEvent('#rg-seed', 'change');
  check(await page.textContent('[data-count="rivers"] output') === String(rivers0 + 1), 'region setup: the steppers change the counts');
  await page.screenshot({ path: `${shots}/9-region-setup.png`, fullPage: true });
  await page.tap('[data-start]');
  await inGame(page, 300000).catch(() => {}); // (a 50 km map is slow to build under software rendering)
  const q = new URLSearchParams(new URL(page.url()).search);
  check(q.get('map') === 'region' && q.get('seed') === '42' && q.get('rivers') === String(rivers0 + 1) && q.get('style') === 'arctic', `the region starts from the menu with its options (${new URL(page.url()).search})`);
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
