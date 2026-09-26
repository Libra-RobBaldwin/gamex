#!/usr/bin/env node
// Draw a baked region (or part of it) as a PNG map, to check a bake against the OS map.
//
//   node tools/os/preview.mjs exe out.png [x0 z0 x1 z1] [--px 2000] [--bare]   (--bare: no names or credit, for a menu card's thumbnail)
//
// Game metres (x east, z south, the region's centre at 0, 0). Draws hill shading, the sea and
// foreshore, woods, green space, water, roads by class, railways, buildings and place names.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { decodeTile, tileFile } from '../../src/proto/real/format.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const BARE = args.includes('--bare'); if (BARE) args.splice(args.indexOf('--bare'), 1);
const pxi = args.indexOf('--px'), PX = pxi >= 0 ? Number(args.splice(pxi, 2)[1]) : 2000;
const [id = 'exe', out = 'preview.png', ...box] = args;
const dir = join(ROOT, 'public/regions', id), m = JSON.parse(readFileSync(join(dir, 'region.json'), 'utf8'));
const [x0, z0, x1, z1] = box.length === 4 ? box.map(Number) : [-m.size / 2, -m.size / 2, m.size / 2, m.size / 2];
const tiles = [];
for (let j = 0; j < m.n; j++) for (let i = 0; i < m.n; i++) {
  const tx = -m.size / 2 + i * m.tile, tz = -m.size / 2 + j * m.tile;
  if (tx > x1 || tx + m.tile < x0 || tz > z1 || tz + m.tile < z0) continue;
  const t = decodeTile(new Uint8Array(readFileSync(join(dir, tileFile(i, j)))));
  const L = {};
  for (const [k, fs] of Object.entries(t.layers)) L[k] = fs.map((f) => ({ c: f.c, h: f.holes ?? null, p: f.parts.map((a) => Array.from(a, (v) => Math.round(v * 2) / 2)) }));
  tiles.push({ heights: t.heights && { ...t.heights, h: Array.from(t.heights.h) }, L });
}
const W = PX, H = Math.round((PX * (z1 - z0)) / (x1 - x0));
const html = `<canvas id=c width=${W} height=${H}></canvas><script>
const T = ${JSON.stringify(tiles)}, P = ${BARE ? '[]' : JSON.stringify(m.places.filter((p) => p.kind !== 'hamlet' && p.kind !== 'suburb'))}, B = [${x0}, ${z0}, ${x1}, ${z1}];
const c = document.getElementById('c'), g = c.getContext('2d'), s = ${W} / (B[2] - B[0]);
const X = (x) => (x - B[0]) * s, Z = (z) => (z - B[1]) * s;
// hill shading: each height post a square, lit from the north-west
for (const t of T) { const h = t.heights; if (!h) continue;
  for (let j = 0; j < h.n - 1; j++) for (let i = 0; i < h.n - 1; i++) {
    const k = j * h.n + i, v = h.h[k], dx = h.h[k + 1] - v, dz = h.h[k + h.n] - v, sh = Math.max(0, Math.min(1, 0.55 - (dx + dz) / h.step * 1.6));
    const e = Math.max(0, Math.min(1, v / 450)), r = 200 - 60 * e, gg = 214 - 40 * e, b = 170 - 50 * e;
    // (at sea level or below is the sea, as the game reads it: OpenMap Local's tidal water stops near the shore)
    g.fillStyle = v <= 0.2 ? '#8fb8d8' : 'rgb(' + (r * (0.55 + sh * 0.6) | 0) + ',' + (gg * (0.55 + sh * 0.6) | 0) + ',' + (b * (0.55 + sh * 0.6) | 0) + ')';
    g.fillRect(X(h.x0 + i * h.step), Z(h.z0 + j * h.step), h.step * s + 1, h.step * s + 1);
  } }
const poly = (L, fill) => { for (const t of T) for (const f of t.L[L] ?? []) { g.beginPath(); for (const p of f.p) { g.moveTo(X(p[0]), Z(p[1])); for (let k = 2; k < p.length; k += 2) g.lineTo(X(p[k]), Z(p[k + 1])); g.closePath(); } g.fillStyle = typeof fill === 'function' ? fill(f.c) : fill; g.fill('evenodd'); } };
const line = (L, style) => { for (const t of T) for (const f of t.L[L] ?? []) { const st = style(f.c); if (!st) continue; g.beginPath(); for (const p of f.p) { g.moveTo(X(p[0]), Z(p[1])); for (let k = 2; k < p.length; k += 2) g.lineTo(X(p[k]), Z(p[k + 1])); } g.strokeStyle = st[0]; g.lineWidth = Math.max(0.6, st[1] * s); g.setLineDash(st[2] ?? []); g.stroke(); } g.setLineDash([]); };
poly('sea', '#8fb8d8'); poly('foreshore', '#e4dcc0'); poly('woods', 'rgba(60,120,60,0.75)'); poly('green', 'rgba(140,200,110,0.7)');
poly('water', '#8fb8d8'); line('streams', () => ['#6f9fcc', 2]);
const RC = ['#3a6fd8', '#2e8b57', '#d84a3a', '#e08a2a', '#f4e27a', '#ffffff', '#ffffff', '#dddddd', '#ffffff'];
const RW = [18, 14, 12, 10, 7, 5, 4, 3, 4];
line('roads', (c) => ['#555', RW[c & 15] + 3]); line('roads', (c) => [RC[c & 15], RW[c & 15]]);
line('rail', (c) => c >= 3 ? ['#444', 3, [8, 8]] : ['#222', 4]);
poly('buildings', (c) => c ? '#7a5a8a' : '#8a7d73');
g.font = 'bold ' + Math.max(11, Math.min(28, 900 * s)) + 'px sans-serif'; g.textAlign = 'center';
for (const p of P) { const fs = p.kind === 'city' ? 1.6 : p.kind === 'town' ? 1.2 : 0.85; g.font = 'bold ' + Math.round(Math.max(10, Math.min(26, 700 * s)) * fs) + 'px sans-serif'; g.lineWidth = 3; g.strokeStyle = '#fff'; g.strokeText(p.name, X(p.x), Z(p.z)); g.fillStyle = '#111'; g.fillText(p.name, X(p.x), Z(p.z)); }
${BARE ? '' : `g.font = '14px sans-serif'; g.textAlign = 'left'; g.fillStyle = '#000'; g.fillText(${JSON.stringify(m.attribution)}, 8, ${H} - 8);`}
document.title = 'done';
</script>`;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html);
await page.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
writeFileSync(out, await page.locator('#c').screenshot(/\.jpe?g$/i.test(out) ? { type: 'jpeg', quality: 72 } : {}));
await browser.close();
console.log('wrote', out, `${W}×${H}`);
