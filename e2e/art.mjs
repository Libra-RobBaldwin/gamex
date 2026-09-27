// The start menu's pictures, taken from the game (src/app/art/): the region's start town, framed for a
// phone held upright (hero-tall), for a wide screen (hero-wide), and small for the map's card
// (map-region). Not a test. Retake them when the look changes:
//   npx vite --port 5173 --strictPort --host 127.0.0.1 &
//   node e2e/art.mjs [url] [out dir]        (ART_PNG=1 also keeps a png of each, to look at)
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
const url = process.argv[2] ?? 'http://127.0.0.1:5173/proto.html?map=region&seed=42';
const out = process.argv[3] ?? 'src/app/art';
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// each picture: the screen it's for (CSS px, at DPR 2), where the camera looks (the start town is at 0, 0) and how high
const SHOTS = [
  { name: 'hero-tall', w: 540, h: 960, view: { x: -10, z: -30, h: 470, az: 0.55, el: 0.56 } },
  { name: 'hero-wide', w: 800, h: 450, view: { x: 40, z: -60, h: 560, az: 0.55, el: 0.6 } },
  { name: 'map-region', w: 400, h: 220, view: { x: 60, z: -40, h: 760, az: 0.55, el: 0.62 } },
];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: SHOTS[0].w, height: SHOTS[0].h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('page error', e.message));
await page.goto(url);
await page.waitForFunction(() => window.proto?.town, null, { timeout: 240000 });
await wait(20000); // (the quality tier settles, the scenery tiles round the town build)
await page.evaluate(() => { for (const el of document.querySelectorAll('#ui, #hud-top, #guide, .goal')) el.style.display = 'none'; window.proto.setSpeed?.(0); });
for (const s of SHOTS) {
  await page.setViewportSize({ width: s.w, height: s.h });
  await page.evaluate((v) => { window.proto.nav.setView(v); }, s.view);
  await wait(12000); // (tiles and buildings at this view)
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  const webp = await page.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    cv.getContext('2d').drawImage(im, 0, 0);
    return cv.toDataURL('image/webp', 0.82).split(',')[1];
  }, png);
  writeFileSync(`${out}/${s.name}.webp`, Buffer.from(webp, 'base64'));
  if (process.env.ART_PNG) writeFileSync(`${out}/${s.name}.png`, Buffer.from(png, 'base64')); // (a copy to look at)
  console.log(s.name, `${s.w * 2}x${s.h * 2}`, Math.round(Buffer.from(webp, 'base64').length / 1024), 'kB');
}
await browser.close();
