import { open } from './lib.mjs';
const { browser, page } = await open();
console.log(await page.evaluate(() => { const out = []; for (const s of proto.net.segs.values()) { const p = proto.net.path(s); out.push([proto.net.def(s).cls, p.length, JSON.stringify(proto.toScreen(p[0]))]); if (out.length > 5) break; } return JSON.stringify(out) + ' segs ' + proto.net.segs.size; }));
await browser.close();
