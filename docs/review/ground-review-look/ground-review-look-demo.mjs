// ground-demo screenshots: node ground-review-look-demo.mjs <prefix> '<json [[name, scene, h, js?],...]>'
import { chromium } from 'playwright-core';
const [prefix, list, port = '4263'] = process.argv.slice(2);
const SP = new URL('..', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/ground-demo.html`);
await page.waitForTimeout(10000);
for (const [name, sc, h, js] of JSON.parse(list)) {
  await page.evaluate(([sc, h, js]) => { const d = window.groundDemo; if (sc) d.setScene(sc); if (h) d.view.h = h; if (js) (0, eval)(js); d.place(); }, [sc, h, js ?? '']);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SP}/ground/${prefix}-${name}.png` });
}
console.log('errors', JSON.stringify(errs));
await browser.close();
