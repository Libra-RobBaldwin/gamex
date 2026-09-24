// How long is the first-run pill actually on screen after the page is usable?
import { chromium } from 'playwright-core';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const t0 = Date.now(); await page.goto('http://127.0.0.1:5173/proto.html');
let shownAt = null, goneAt = null;
for (let i = 0; i < 60; i++) { const v = await page.evaluate(() => { const e = document.getElementById('firstrun'); return !!e && !e.hidden; }).catch(() => false); if (v && shownAt === null) shownAt = Date.now() - t0; if (!v && shownAt !== null && goneAt === null) goneAt = Date.now() - t0; if (goneAt) break; await page.waitForTimeout(500); }
console.log('pill shown at', shownAt, 'ms, gone at', goneAt, 'ms, on screen', goneAt && shownAt ? goneAt - shownAt : null, 'ms');
await page.screenshot({ path: new URL('./shots/', import.meta.url).pathname + `${w}x${h}-firstrun-early.png` });
await browser.close();
