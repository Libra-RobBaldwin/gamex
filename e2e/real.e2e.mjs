import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5180/proto.html?map=exe';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || /railway|region|real/.test(m.text())) errs.push(m.type() + ': ' + m.text()); });
const t0 = Date.now();
await page.goto(url);
let last = '';
for (let i = 0; i < 240; i++) {
  const s = await page.evaluate(() => ({ town: !!window.proto?.town, stage: (document.querySelector('.loading .what')?.textContent ?? document.body.innerText.slice(0, 120)) })).catch(() => ({}));
  if (s.stage && s.stage !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1), s.stage); last = s.stage; }
  if (s.town) break;
  await page.waitForTimeout(1000);
}
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(4000);
const info = await page.evaluate(() => { const P = window.proto; return { times: P.loading?.times, segs: P.net.segs.size, lots: P.net.lots.length, info: P.renderer?.info?.render }; }).catch((e) => e.message);
console.log(JSON.stringify(info));
await page.screenshot({ path: `${out}/real-0.png` });
console.log(errs.slice(0, 20).join('\n'));
await browser.close();
