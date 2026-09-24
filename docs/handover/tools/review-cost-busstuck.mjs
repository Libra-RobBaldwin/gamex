// In a busy Parade (?n=2000, eight lanes), does the bus that calls at the stop ever pull out
// again? The demo's followLane only lets it go when the car behind is 25 m back, which dense
// traffic never gives. Exits non-zero if a bus has stood at the stop far past its dwell.
//   node review-cost-busstuck.mjs [http://127.0.0.1:4284] [n]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://127.0.0.1:4284', n = process.argv[3] ?? '2000';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// the Station preset starts with the bus standing at the stop; dwell is 10 s
await page.goto(`${base}/vehicles-demo.html?mode=parade&n=${n}&at=stop&shadows=0`);
let worst = 0, log = [];
for (let i = 0; i < 60 && worst < 60; i++) {
  await page.waitForTimeout(5000);
  const buses = await page.evaluate(() => (window.__stops ?? []).filter((m) => !m.rail));
  const dwelling = buses.filter((b) => b.st === 'dwell');
  const t = Math.max(0, ...dwelling.map((b) => b.t));
  if (i > 0 && !dwelling.length && worst > 10) { log.push({ left: worst }); break; }
  worst = Math.max(worst, t);
  log.push({ at: (i + 1) * 5, buses: buses.length, dwelling: dwelling.map((b) => `${b.st} t=${b.t} v=${b.v}`) });
}
console.log(JSON.stringify(log));
await browser.close();
// sim time runs slower than wall time at low fps (dt is capped at 0.1 s), so allow plenty
if (worst >= 60) { console.error(`a bus has stood at the stop for ${worst} s of a 10 s dwell`); process.exit(1); }
console.log('buses leave the stop', worst);
