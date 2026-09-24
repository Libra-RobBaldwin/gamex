import { chromium } from 'playwright-core';
const [port, js = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${port}/proto.html`);
await page.waitForTimeout(10000);
const r = await page.evaluate(js || (() => { const p = window.proto; const lots = [...p.net.lots]; let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9; for (const l of lots) { x0=Math.min(x0,l.x);x1=Math.max(x1,l.x);z0=Math.min(z0,l.z);z1=Math.max(z1,l.z);} return { n: lots.length, x0,x1,z0,z1, view: {...p.view}, speed: p.speed(), hedges: p.ground.ground.hedges.children.map(c=>c.count) }; }));
console.log(JSON.stringify(r));
await browser.close();
