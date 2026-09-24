import { chromium } from 'playwright-core';
const [url, outp] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url); await page.waitForTimeout(9000);
await page.screenshot({ path: outp + '-default.png' });
const presets = await page.$$eval('[data-preset]', (b) => b.map((x) => x.dataset.preset));
for (const p of presets) { await page.click(`[data-preset="${p}"]`); await page.waitForTimeout(8000); await page.screenshot({ path: `${outp}-${p}.png` }); console.log(p, await page.textContent('#stats')); }
console.log('errors', JSON.stringify(errs)); await browser.close();
