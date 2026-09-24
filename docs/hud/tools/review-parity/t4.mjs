import { open, check, junctionPt } from './lib.mjs';
const W = +(process.argv[2] || 412), H = +(process.argv[3] || 915);
const { browser, page, errs } = await open(W, H);
const j = await junctionPt(page);
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(800);
check('look tap on junction opens its info sheet', (await page.isVisible('.sheet')) && (await page.textContent('.sheet .acts')).includes('Edit junction'), await page.textContent('.sheet h2'));
await page.tap('.sheet .acts .act'); await page.waitForTimeout(2500);
const st = await page.evaluate((node) => {
  const s = document.querySelector('#sheet').getBoundingClientRect();
  const r = proto.shell.clearRect(); const q = proto.toScreen(proto.net.node(node));
  return { sheetTop: Math.round(s.top), clear: r, jy: Math.round(q.y), jx: Math.round(q.x), H: innerHeight };
}, j.node);
console.log(JSON.stringify(st));
check('clearRect excludes the open junction editor sheet', st.clear.bottom <= st.sheetTop + 1, `clearRect.bottom=${st.clear.bottom}, sheet top=${st.sheetTop}`);
check('junction framed in the clear map above the editor sheet', st.jy < st.sheetTop && st.jy > st.clear.top, `junction y=${st.jy}, sheet top=${st.sheetTop}`);
await page.screenshot({ path: `jed-${W}.png` });
// a hint while the editor is open: where does it land?
await page.evaluate(() => proto.shell.hint('<span>probe hint</span>', 0));
const h = await page.evaluate(() => { const e = document.querySelector('#hint').getBoundingClientRect(); const hh = document.querySelector('#hint'); hh.style.pointerEvents = 'auto'; const top = document.elementFromPoint(e.left + e.width / 2, e.top + e.height / 2); return { top: Math.round(e.top), bottom: Math.round(e.bottom), visibleOnTop: !!top?.closest('#hint'), under: top?.closest('#sheet') ? 'sheet' : top?.id }; });
check('hint is visible (not under the sheet) while the editor is open', h.visibleOnTop, JSON.stringify(h));
check('no page errors', errs.length === 0, JSON.stringify(errs));
await browser.close();
