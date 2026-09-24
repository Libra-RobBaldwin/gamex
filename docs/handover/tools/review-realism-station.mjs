// Review check (realism): in the Parade's Station preset only trains with passenger doors should
// stand at the platform. Polls window.__stops for up to 90 s and exits non-zero if a train whose
// vehicles have no doors at all (a freight train) dwells at the station.
// Needs: a vite server on 127.0.0.1:4281 and playwright-core (npm i playwright-core@1.56).
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4281/vehicles-demo.html?mode=parade&at=stop&ui=0');
let bad = null;
for (let t = 0; t < 90 && !bad; t += 3) {
  await page.waitForTimeout(3000);
  const stops = await page.evaluate(() => window.__stops ?? []);
  const f = stops.find((s) => s.rail && s.st === 'dwell' && s.doors.every((n) => n === 0));
  if (f) bad = { after: t + 3, ...f, doors: `${f.doors.length} vehicles, none with doors` };
}
await browser.close();
if (bad) { console.error('FAIL: a train with no passenger doors dwells at the platform:', JSON.stringify(bad)); process.exit(1); }
console.log('ok: only passenger trains dwelt at the platform');
