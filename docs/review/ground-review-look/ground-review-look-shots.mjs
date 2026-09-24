// Phone screenshots of the main game. usage: node ground-review-look-shots.mjs <prefix> <port> <json list of [name,x,z,h,az]> [grow=1] [clock]
import { chromium } from 'playwright-core';
const [prefix, port, list, grow = '1', clock = ''] = process.argv.slice(2);
const SP = new URL('..', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
// keep the chosen quality tier: frames look fast to the game's auto-tiering (software rendering is slow)
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => cb(t / 40)); });
await page.goto(`http://127.0.0.1:${port}/proto.html`);
await page.waitForTimeout(10000);
await page.evaluate(([g, c, t]) => { window.proto.setTier(Number(t)); if (g === '1') window.proto.growAll(); if (c) window.proto.setClock(Number(c)); }, [grow, clock, process.env.TIER ?? "0"]);
await page.waitForTimeout(2000);
for (const [name, x, z, h, az] of JSON.parse(list)) {
  await page.evaluate(([x, z, h, az]) => { const v = window.proto.view; v.x = x; v.z = z; v.h = h; if (az !== undefined && az !== null) v.az = az; }, [x, z, h, az]);
  await page.waitForTimeout(1500);
  await page.evaluate((t) => window.proto.setTier(Number(t)), process.env.TIER ?? '0');
  await page.waitForTimeout(1800);
  const tier = await page.evaluate(() => window.proto.perf().tier);
  console.log(name, tier);
  await page.screenshot({ path: `${SP}/ground/${prefix}-${name}.png` });
}
console.log('errors', JSON.stringify(errs));
await browser.close();
