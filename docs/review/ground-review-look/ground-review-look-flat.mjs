// Is open pasture in the game still one flat colour? The user asked for grass with "some character"
// and "different textures" instead of plain green. Screenshots the game (High tier, phone) over a
// pasture parcel at the Close (35 m) and 120 m zooms, and measures the luminance spread of the grass
// filling the middle of the screen. Fails when the new pasture has less visible variation than the
// old speckled grass it replaced (measured the same way on the pre-change build, 5.5 at 35 m) or
// less than 6 at either zoom.
// usage: node ground-review-look-flat.mjs [port=4263] [oldPort=4272]
import { chromium } from 'playwright-core';
const [port = '4263', oldPort = '4272'] = process.argv.slice(2);
const SP = new URL('..', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const stats = async (buf) => {
  const p = await browser.newPage();
  const r = await p.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(60, 450, 700, 1000).data; // the middle of the screen, clear of the HUD
    let n = 0, L = 0, L2 = 0, S = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2], mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); n++; L += l; L2 += l * l; S += mx ? (mx - mn) / mx : 0; }
    const m = L / n; return { std: +Math.sqrt(L2 / n - m * m).toFixed(2), lum: +m.toFixed(1), sat: +(S / n).toFixed(3) };
  }, `data:image/png;base64,${buf.toString('base64')}`);
  await p.close();
  return r;
};
async function measure(port, tag) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // keep the High tier: frames look fast to the game's auto-tiering (software rendering is slow)
  await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => cb(t / 40)); });
  try { await page.goto(`http://127.0.0.1:${port}/proto.html`, { timeout: 15000 }); } catch { await page.close(); return null; }
  await page.waitForTimeout(10000);
  const out = {};
  // a pasture parcel west of the town, away from roads and hedges (grass, edge > 60 m)
  for (const h of [35, 120]) {
    await page.evaluate((h) => { const v = window.proto.view; v.x = -540; v.z = 250; v.h = h; window.proto.setTier(0); }, h);
    await page.waitForTimeout(4000);
    const buf = await page.screenshot();
    if (tag === 'new') await page.screenshot({ path: `${SP}/ground/review-look-flat-${h}.png` });
    out[h] = await stats(buf);
  }
  await page.close();
  return out;
}
const now = await measure(port, 'new');
const old = await measure(oldPort, 'old');
await browser.close();
console.log('new', JSON.stringify(now), 'old', JSON.stringify(old));
const fails = [];
for (const h of [35, 120]) {
  // (the old build has trees scattered over this spot at 120 m, so it's only compared at 35 m)
  const floor = Math.max(6, h === 35 ? (old ? old[35].std : 5.5) : 0);
  if (now[h].std < floor) fails.push(`pasture at ${h} m: luminance spread ${now[h].std} < ${floor} (old grass at 35 m ${old ? old[35].std : 5.5}): one flat colour`);
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS');
