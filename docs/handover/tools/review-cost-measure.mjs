// Measure draw calls, triangles and JS ms per frame in the vehicles demo, before and after.
// Serve 7d37af6 on 4283 and this branch on 4284 (npx vite --port 428x --strictPort --host 127.0.0.1).
//   node review-cost-measure.mjs ["mode=parade|mode=showroom|..."]  (prints medians; no pass/fail)
import { chromium } from 'playwright-core';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ports = { before: 4283, after: 4284 };
const scenes = (process.argv[2] ?? 'mode=parade|mode=showroom|mode=parade&n=2000|mode=parade&at=stop|mode=showroom&cat=rail|mode=showroom&cat=bus|mode=parade&cat=rail').split('|');
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = {};
for (const sc of scenes) for (const [name, port] of Object.entries(ports)) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/vehicles-demo.html?${sc}`);
  await page.waitForTimeout(13000);
  const samples = [];
  for (let i = 0; i < 5; i++) { samples.push(await page.evaluate(() => window.__stats)); await page.waitForTimeout(1100); }
  const med = (k) => { const v = samples.map((s) => s?.[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  out[`${sc} :: ${name}`] = { calls: med('calls'), vehicleCalls: med('vehicleCalls'), tris: med('tris'), instances: med('instances'), total: med('total'), cpuMs: med('cpuMs'), fps: med('fps'), errs: errs.slice(0, 2) };
  console.log(sc, name, JSON.stringify(out[`${sc} :: ${name}`]));
  await ctx.close();
}
await browser.close();
