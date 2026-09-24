// Does the whole landscape change colour when the game's quality tier changes? The game switches
// tiers on its own as the frame rate moves (judgeFrames), so any difference between the ground's
// quality levels shows as the entire screen of grass popping lighter/darker every so often: a
// flash the user is sensitive to. Renders one pasture view (120 m) and one mixed view (400 m) at
// High, Good and Fast and compares the mean colour of the middle of the screen.
// Fails if any tier differs from High by more than 2 levels (of 255) in any channel.
// usage: node ground-review-look-tierpop.mjs [port=4263]
import { chromium } from 'playwright-core';
const [port = '4263'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// hold the chosen tier: frames look fast to the game's auto-tiering (software rendering is slow)
await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => cb(t / 40)); });
await page.goto(`http://127.0.0.1:${port}/proto.html`);
await page.waitForTimeout(10000);
const mean = async (buf) => {
  const p = await browser.newPage();
  const r = await p.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(60, 450, 700, 1000).data;
    let n = 0, R = 0, G = 0, B = 0;
    for (let i = 0; i < d.length; i += 4) { n++; R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    return [R / n, G / n, B / n].map((v) => +v.toFixed(1));
  }, `data:image/png;base64,${buf.toString('base64')}`);
  await p.close();
  return r;
};
const views = { pasture: [-540, 250, 120], mixed: [-420, 300, 400] };
const tiers = { High: 0, Good: 1, Fast: 3 };
const res = {};
for (const [vn, [x, z, h]] of Object.entries(views)) {
  res[vn] = {};
  for (const [tn, t] of Object.entries(tiers)) {
    await page.evaluate(([x, z, h, t]) => { const v = window.proto.view; v.x = x; v.z = z; v.h = h; window.proto.setTier(t); }, [x, z, h, t]);
    await page.waitForTimeout(3500);
    res[vn][tn] = await mean(await page.screenshot());
  }
}
await browser.close();
console.log(JSON.stringify(res));
const fails = [];
for (const [vn, r] of Object.entries(res)) for (const tn of ['Good', 'Fast']) {
  const d = Math.max(...r[tn].map((v, i) => Math.abs(v - r.High[i])));
  if (d > 2) fails.push(`${vn}: ${tn} differs from High by ${d.toFixed(1)} levels (${JSON.stringify(r[tn])} vs ${JSON.stringify(r.High)})`);
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS');
