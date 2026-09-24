import { chromium } from 'playwright-core';
const [url, out, want] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url);
await page.waitForTimeout(3500);
for (let i = 0; i < 12; i++) { const t = await page.textContent('#title'); if (t.includes(want)) break; await page.click('#next'); await page.waitForTimeout(1500); }
await page.waitForTimeout(2000);
console.log(await page.textContent('#title'), errs);
await page.screenshot({ path: out });
await browser.close();
