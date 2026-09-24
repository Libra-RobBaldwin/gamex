// node montage.mjs out.png colW img1 img2 ...
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const [out, colW, ...imgs] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
const html = `<body style="margin:0;background:#222;display:flex;flex-wrap:wrap;gap:4px;width:1400px">${imgs.map((f) => `<figure style="margin:0;color:#fff;font:12px sans-serif"><img style="width:${colW}px;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${f.split('/').pop()}</figcaption></figure>`).join('')}</body>`;
await p.setContent(html); await p.waitForTimeout(300);
await p.screenshot({ path: out, fullPage: true });
await b.close();
