// Text cut off: tool spec (cost hidden by ellipsis) and Build tabs clipped with no fade
import { open } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, shot } = await open(w, h);
await page.tap('[data-bar="build"]'); await page.waitForTimeout(400);
const tabs = await page.evaluate(() => { const s = document.querySelector('.stabs'); const cs = getComputedStyle(s); return { sw: s.scrollWidth, cw: s.clientWidth, mask: cs.webkitMaskImage || cs.maskImage, clipped: [...s.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().right > s.getBoundingClientRect().right + 1).map((b) => b.textContent.trim()) }; });
console.log(`${tabs.clipped.length && (!tabs.mask || tabs.mask === 'none') ? 'FAIL' : 'PASS'} Build tabs off the edge without a fade: ${JSON.stringify(tabs)}`);
await page.tap('.card:has-text("Street")'); await page.waitForTimeout(500);
const sp = await page.evaluate(() => { const e = document.querySelector('#tool .tw span'); return { text: e.textContent, sw: e.scrollWidth, cw: e.clientWidth }; });
console.log(`${sp.sw > sp.cw ? 'FAIL' : 'PASS'} tool spec fits (the price is the last item): ${JSON.stringify(sp)}`);
await shot('tool-spec');
await browser.close();
