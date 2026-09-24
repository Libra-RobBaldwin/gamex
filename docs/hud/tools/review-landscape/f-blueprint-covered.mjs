// Draw a road in the lower right of the clear map (where a right-handed player naturally draws):
// the blueprint card then opens over it, hiding the white handles the hint says to drag.
// usage: node f-blueprint-covered.mjs 915x412
import { open, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '915x412').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await page.evaluate(() => proto.startRoadTool('street')); await page.waitForTimeout(800);
const c = await page.evaluate(() => proto.shell.clearRect());
// a straight drag across the lower-right quarter of the clear map
const a = { x: c.left + (c.right - c.left) * 0.62, y: c.top + (c.bottom - c.top) * 0.62 }, b = { x: c.left + (c.right - c.left) * 0.9, y: c.top + (c.bottom - c.top) * 0.85 };
await page.evaluate(({ a, b }) => { const cv = document.getElementById('c'); const ev = (t, x, y) => cv.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
  ev('pointerdown', a.x, a.y); for (let i = 1; i <= 12; i++) ev('pointermove', a.x + (b.x - a.x) * i / 12, a.y + (b.y - a.y) * i / 12); ev('pointerup', b.x, b.y); }, { a, b });
await page.waitForTimeout(1200);
const r = await page.evaluate(({ a, b }) => {
  const p = document.querySelector('#tpanel'); if (p.hidden) return { card: null };
  const q = p.getBoundingClientRect(); const inside = (s) => s.x > q.left && s.x < q.right && s.y > q.top && s.y < q.bottom;
  return { card: [q.left, q.top, q.right, q.bottom].map(Math.round), hint: document.querySelector('#hint').textContent, aCovered: inside(a), bCovered: inside(b), hitA: document.elementFromPoint(a.x, a.y)?.id || document.elementFromPoint(a.x, a.y)?.tagName, hitB: document.elementFromPoint(b.x, b.y)?.id || document.elementFromPoint(b.x, b.y)?.tagName };
}, { a, b });
console.log('drag', JSON.stringify({ a, b }), 'clear', JSON.stringify(c)); console.log(JSON.stringify(r));
await page.screenshot({ path: `${OUT}blueprint-covered-${w}x${h}.png` });
console.log(!r.card ? 'INCONCLUSIVE: no blueprint' : (r.aCovered || r.bCovered) ? `FAIL: blueprint card covers ${[r.aCovered && 'start', r.bCovered && 'end'].filter(Boolean).join(' and ')} handle of the road just drawn (hint: "${r.hint}")` : 'PASS', errs.length ? JSON.stringify(errs) : '');
await browser.close();
