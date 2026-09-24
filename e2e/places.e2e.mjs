// The whole Real Town Plans flow in a phone-sized browser, with the network mocked, so it runs
// offline and never touches the public servers:
//   npm run build && node e2e/places.e2e.mjs [screenshot dir]
// postcodes.io answers with a spot in Banbury, the map tiles are plain squares, and Overpass
// answers every tile with the Banbury fixture (its first request with a 429, to show the back-off).
// Any other request outside the page's own origin fails the test, as does the postcode turning up
// anywhere but the one request to postcodes.io.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ?? join(tmpdir(), 'places-e2e');
mkdirSync(shots, { recursive: true });
const PORT = 4179, BASE = `http://127.0.0.1:${PORT}`;
const POSTCODE = 'OX16 0AA'; // any postcode: postcodes.io is mocked
const fixture = readFileSync(join(root, 'src/proto/osm/fixtures/banbury.json'), 'utf8');

// ---- a plain map tile: pale ground with a grid line on two sides ----
function tilePng() {
  const w = 256, rows = [];
  for (let y = 0; y < w; y++) {
    const r = [0];
    for (let x = 0; x < w; x++) { const line = x < 2 || y < 2; r.push(...(line ? [200, 196, 184] : [232, 228, 216])); }
    rows.push(Buffer.from(r));
  }
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d])), 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
function crc(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
const TILE = tilePng();

// ---- the server: vite preview of dist ----
if (!existsSync(join(root, 'dist/places.html'))) { console.error('Run npm run build first.'); process.exit(1); }
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'pipe' });
for (let i = 0; ; i++) { try { if ((await fetch(`${BASE}/places.html`)).ok) break; } catch { /* not up yet */ } if (i > 100) throw new Error('vite preview did not start'); await new Promise((r) => setTimeout(r, 100)); }

const exe = process.env.CHROMIUM ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--ignore-certificate-errors'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', acceptDownloads: true });
const page = await ctx.newPage();

const failures = [], leaks = [], errors = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/status of 429/.test(m.text())) errors.push(m.text()); });

// ---- the mocked outside world ----
let overpass = 0;
const compact = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
await ctx.route('**/*', async (route) => {
  const req = route.request(), url = new URL(req.url());
  const body = req.postData() ?? '';
  if (compact(decodeURIComponent(url.href)).includes(compact(POSTCODE)) && url.hostname !== 'api.postcodes.io') leaks.push(url.href);
  if (compact(decodeURIComponent(body)).includes(compact(POSTCODE))) leaks.push(`body of ${url.href}`);
  if (url.origin === BASE) return route.continue();
  if (url.hostname === 'api.postcodes.io') {
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ status: 200, result: { postcode: POSTCODE, latitude: 52.0615, longitude: -1.332, admin_district: 'Cherwell', admin_ward: 'Banbury Cross and Neithrop', parish: 'Banbury', country: 'England' } }) });
  }
  if (url.hostname === 'tile.openstreetmap.org') return route.fulfill({ status: 200, contentType: 'image/png', body: TILE });
  if (/overpass|maps\.mail\.ru/.test(url.hostname)) {
    overpass++;
    if (overpass === 1) return route.fulfill({ status: 429, headers: { 'Access-Control-Allow-Origin': '*', 'Retry-After': '1' }, body: 'rate limited' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: fixture });
  }
  leaks.push(`unexpected request: ${url.href}`);
  return route.abort();
});

const shot = async (name) => { await page.screenshot({ path: join(shots, `${name}.png`) }); console.log(`     shot ${name}.png`); };

try {
  // ---- 1: the postcode ----
  await page.goto(`${BASE}/places.html`);
  await page.waitForSelector('#pc');
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  check(await page.isVisible('text=Saved on this device'), 'the find step shows, with the saved list');
  await shot('1-find');
  await page.fill('#pc', 'JE2 3AB');
  await page.click('#pc-go');
  await page.waitForFunction(() => /Jersey/.test(document.querySelector('#pc-msg').textContent));
  check(true, 'a Channel Islands postcode is explained, not looked up');
  await page.fill('#pc', 'not a postcode');
  await page.click('#pc-go');
  await page.waitForFunction(() => /doesn’t look like/.test(document.querySelector('#pc-msg').textContent));
  await shot('1b-bad-postcode');
  await page.fill('#pc', POSTCODE.toLowerCase());
  await page.click('#pc-go');

  // ---- 2: the area ----
  await page.waitForSelector('#area:not([hidden]) .leaflet-tile-loaded');
  await page.waitForTimeout(400);
  check(await page.inputValue('#pc') === '', 'the postcode box is cleared once found');
  check(await page.inputValue('#area-name') === 'Banbury', 'the name is suggested from the place, not the postcode');
  check(/OpenStreetMap/.test(await page.textContent('.leaflet-control-attribution')), 'the map credits OpenStreetMap');
  const attrBox = await page.locator('.leaflet-control-attribution').boundingBox();
  const sheetBox = await page.locator('#area .sheet').boundingBox();
  check(attrBox && sheetBox && attrBox.y + attrBox.height <= sheetBox.y + 1, 'the map credit sits above the sheet, not under it');
  check(await page.locator('.area-pin').count() === 1, 'a pin marks the postcode');
  await shot('2-area');

  // drag the square's handle with one finger: the square moves, the map doesn't
  const cdp = await ctx.newCDPSession(page);
  const before = await page.evaluate(() => ({ h: document.querySelector('.area-handle').getBoundingClientRect(), tile: document.querySelector('.leaflet-tile').getBoundingClientRect().x }));
  const hx = before.h.x + before.h.width / 2, hy = before.h.y + before.h.height / 2;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await touch('touchStart', [[hx, hy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[hx - 8 * i, hy - 5 * i]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ h: document.querySelector('.area-handle').getBoundingClientRect(), tile: document.querySelector('.leaflet-tile').getBoundingClientRect().x }));
  check(Math.abs(after.h.x - (before.h.x - 80)) < 3 && Math.abs(after.h.y - (before.h.y - 50)) < 3, `dragging the handle moves the square (${Math.round(after.h.x - before.h.x)}, ${Math.round(after.h.y - before.h.y)})`);
  check(Math.abs(after.tile - before.tile) < 1, 'dragging the handle leaves the map where it was');
  // a finger inside the square pans the map
  await touch('touchStart', [[200, 300]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[200 + 6 * i, 300]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const panned = await page.evaluate(() => document.querySelector('.leaflet-tile').getBoundingClientRect().x);
  check(panned - after.tile > 30, 'a finger inside the square pans the map');
  // "Square here" puts it back in the middle; the size chips resize it
  await page.click('#square-here');
  await page.click('.chip[data-size="1.5"]');
  check(await page.getAttribute('.chip[data-size="1.5"]', 'aria-checked') === 'true', 'the size picker shows 1.5 km');
  check(/4 requests/.test(await page.textContent('#area-note')), 'a 1.5 km square is four requests');
  await page.fill('#area-name', 'Banbury centre');
  await shot('2b-area-moved');

  // ---- 3: fetching, with a busy server ----
  await page.click('#area-build');
  await page.waitForFunction(() => /Trying .* in \d+ s/.test(document.querySelector('#f-server').textContent), null, { timeout: 5000 });
  check(true, 'a 429 shows which server is next and a countdown');
  await shot('3-fetch-busy');
  await page.waitForFunction(() => /Building the plan/.test(document.querySelector('#f-title').textContent) || !document.querySelector('#plans').hidden, null, { timeout: 30000 });
  if (!(await page.isVisible('#plans'))) await shot('3b-building');

  // ---- 4: the plans ----
  await page.waitForSelector('#plans:not([hidden])', { timeout: 60000 });
  await page.waitForFunction(() => { const i = document.querySelector('.viewer img'); return i && i.complete && i.naturalWidth > 0; });
  check(overpass === 5, `four tiles fetched, one after a 429 (${overpass} requests)`);
  const stats = await page.$$eval('#p-stats div', (d) => Object.fromEntries(d.map((x) => [x.querySelector('dt').textContent, x.querySelector('dd').textContent])));
  console.log('     stats', JSON.stringify(stats));
  check(+stats['Road and rail pieces'].replace(/,/g, '') > 300 && +stats['Building plots'].replace(/,/g, '') > 1000, 'the counts are Banbury’s');
  check(+stats.Roundabouts > 0 && +stats['Dual carriageways paired'] > 0 && /s$/.test(stats['Import time']), 'roundabouts, paired duals and the import time show');
  check(/one-way street/i.test(await page.textContent('#p-unsup')), 'what’s unsupported is listed');
  check(/OpenStreetMap contributors/.test(await page.textContent('.view-credit')), 'the plan credits OpenStreetMap');
  await shot('4-plans-game');
  // pinch to zoom in on the plan
  const vb = await page.locator('.viewer').boundingBox();
  const w0 = await page.evaluate(() => document.querySelector('.viewer img').getBoundingClientRect().width);
  const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
  await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx - 30 - 8 * i, cy], [cx + 30 + 8 * i, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(300);
  const w1 = await page.evaluate(() => document.querySelector('.viewer img').getBoundingClientRect().width);
  check(w1 / w0 > 2, `pinching zooms the plan (×${(w1 / w0).toFixed(1)})`);
  await shot('4b-plans-zoomed');
  await page.click('#t-raw');
  await page.waitForFunction(() => { const i = document.querySelector('.viewer img'); return i.complete && i.naturalWidth > 0; });
  check(await page.getAttribute('#t-raw', 'aria-selected') === 'true', 'the raw data tab shows');
  await shot('4c-plans-raw');
  await page.locator('#p-stats').scrollIntoViewIfNeeded();
  await shot('4d-stats');
  await page.locator('#p-download').scrollIntoViewIfNeeded();
  await shot('4e-actions');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#p-download')]);
  const file = join(shots, dl.suggestedFilename());
  await dl.saveAs(file);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  check(dl.suggestedFilename() === 'banbury-centre-osm.json', `the download is named after the area (${dl.suggestedFilename()})`);
  check(/ODbL/.test(data.attribution) && data.bbox.length === 4 && data.elements.length > 10000, 'the download is the trimmed data, with its box and the ODbL credit');

  // ---- saved: instant reopen, and delete ----
  await page.click('#p-back');
  await page.waitForSelector('#saved .open');
  check(/Banbury centre/.test(await page.textContent('#saved')), 'the area is saved on the device');
  await shot('5-saved');
  const t0 = Date.now();
  await page.click('#saved .open');
  await page.waitForSelector('#plans:not([hidden])');
  check(Date.now() - t0 < 1500 && overpass === 5, `reopening is instant and fetches nothing (${Date.now() - t0} ms)`);
  await page.click('#p-back');
  await page.click('#saved .del');
  await page.click('#saved .del');
  await page.waitForFunction(() => /Areas you build are kept here/.test(document.querySelector('#saved').textContent));
  check(true, 'deleting asks once more, then removes the area');

  // ---- privacy ----
  const stored = await page.evaluate(async () => {
    const out = [location.href, document.cookie, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.body.innerHTML];
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((res) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); });
      for (const s of db.objectStoreNames) out.push(JSON.stringify(await new Promise((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); })));
      db.close();
    }
    return out.join('\n');
  });
  check(!compact(stored).includes(compact(POSTCODE)), 'the postcode is nowhere in the URL, storage, IndexedDB or the page');
  check(leaks.length === 0, `no request leaks the postcode or leaves the mocks${leaks.length ? `: ${leaks.join(', ')}` : ''}`);

  // ---- a phone on its side ----
  await page.setViewportSize({ width: 915, height: 412 });
  await page.fill('#pc', 'OX16');
  await page.click('#pc-go');
  await page.waitForSelector('#area:not([hidden]) .leaflet-tile-loaded');
  await page.waitForTimeout(300);
  const sq = await page.locator('.area-square').boundingBox(), sh = await page.locator('#area .sheet').boundingBox();
  check(sq && sh && sq.x + sq.width <= sh.x + 2, 'on its side, the square stays clear of the sheet');
  await shot('6-landscape');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  failures.push(String(e?.stack ?? e));
  console.error(e);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failed` : `\nall passed; screenshots in ${shots}`);
process.exit(failures.length ? 1 : 0);
