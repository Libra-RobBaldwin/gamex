import { chromium } from 'playwright-core';
export async function open(w = 412, h = 915, wait = 11000) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--ignore-certificate-errors'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://127.0.0.1:5173/proto.html');
  await page.waitForTimeout(wait);
  return { browser, page, errs };
}
// fraction of the viewport covered by visible chrome (union, by sampling a grid)
export async function coverage(page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight; let hit = 0, n = 0;
    for (let y = 0.5; y < H; y += 2) for (let x = 0.5; x < W; x += 2) {
      n++;
      const el = document.elementFromPoint(x, y);
      if (el && el.id !== 'c' && el.closest('#ui') ) hit++;
    }
    return hit / n;
  });
}
