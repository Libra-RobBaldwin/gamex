// Parade JS cost per frame, before (git 7d37af6) and after this work: the demo's update (frame()
// inclusive, minus three's render) from a CPU profile with the CPU throttled 4x to stand in for a
// phone. Exits non-zero if the update costs more than 1.3x what it did before.
//   serve 7d37af6 on 4283 and this branch on 4284 (npx vite --port 428x --strictPort --host 127.0.0.1)
//   node review-cost-cpu.mjs ['mode=parade&n=2000']
import { chromium } from 'playwright-core';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const qs = process.argv[2] ?? 'mode=parade&n=2000';
const ports = (process.env.PORTS ?? 'before:4283,after:4284').split(',').map((x) => x.split(':'));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const upd = {};
for (let round = 0; round < 2; round++) for (const [name, port] of ports) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`http://127.0.0.1:${port}/vehicles-demo.html?${qs}`);
  await page.waitForTimeout(12000);
  await page.evaluate(() => { window.__n = 0; const f = () => { window.__n++; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 50 }); await cdp.send('Profiler.start');
  await page.waitForTimeout(10000);
  const { profile } = await cdp.send('Profiler.stop');
  const nFrames = await page.evaluate(() => window.__n);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const incl = new Map();
  profile.samples.forEach((id, i) => {
    const d = profile.timeDeltas[i] ?? 0; const seen = new Set(); let cur = id;
    while (cur) { const n = byId.get(cur); const k = n.callFrame.functionName + ':' + n.callFrame.url.split('/').pop().split('?')[0].replace(/-[A-Za-z0-9_]+\.js$/, '.js'); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + d); } cur = parent.get(cur); }
  });
  const get = (k) => (incl.get(k) ?? 0) / 1000 / nFrames;
  const frame = get('frame:demo.ts'), render = get('WebGLRenderer.render:three.module.js');
  (upd[name] ??= []).push(frame - render);
  console.log(name, 'frames', nFrames, 'update ms/frame', (frame - render).toFixed(2), 'followLane', get('followLane:demo.ts').toFixed(2), 'oval', get('oval:demo.ts').toFixed(2), 'follow', get('follow:articulation.ts').toFixed(2), 'offsetsOf', get('offsetsOf:demo.ts').toFixed(2), 'add', get('add:render.ts').toFixed(2), 'render', render.toFixed(2));
  await ctx.close();
}
await browser.close();
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const b = avg(upd.before), a = avg(upd.after);
console.log('update ms/frame (4x throttled): before', b.toFixed(2), 'after', a.toFixed(2), 'ratio', (a / b).toFixed(2));
if (a > 1.3 * b) { console.error('the Parade update costs more than 1.3x what it did before'); process.exit(1); }
