// Region stats of screenshots: node ground-review-look-stats.mjs '<json [[file,x,y,w,h],...]>'
// prints mean sRGB, luminance std (texture), mean HSV saturation per region
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const list = JSON.parse(process.argv[2]);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
for (const [f, x, y, w, h] of list) {
  const url = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const r = await p.evaluate(async ([url, x, y, w, h]) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(x, y, w, h).data;
    let n = 0, R = 0, G = 0, B = 0, L = 0, L2 = 0, S = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], bb = d[i + 2], mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      const l = 0.2126 * r + 0.7152 * gg + 0.0722 * bb;
      n++; R += r; G += gg; B += bb; L += l; L2 += l * l; S += mx ? (mx - mn) / mx : 0;
    }
    const m = L / n;
    return { rgb: [R / n, G / n, B / n].map(Math.round), lum: +m.toFixed(1), std: +Math.sqrt(L2 / n - m * m).toFixed(2), sat: +(S / n).toFixed(3) };
  }, [url, x, y, w, h]);
  console.log(f.split('/').pop(), [x, y, w, h].join(','), JSON.stringify(r));
}
await b.close();
