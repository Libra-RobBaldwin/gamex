// Runs the vehicle material's real vertex-shader code (as render.ts patches it into three's
// Lambert shader) through WebGL2 transform feedback, for every tagged vertex of one model per
// body style, over a spread of door, odometer, curvature and flag states, and compares the
// moved positions with motion.ts's moveVertex and the moved normals with the face normals of the
// moved triangles. Exits non-zero on any mismatch.
//   node review-cost-glsl.mjs [http://127.0.0.1:4284]
// (serve the repo with: npx vite --port 4284 --strictPort --host 127.0.0.1)
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://127.0.0.1:4284';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(`${base}/vehicles-demo.html?mode=turntable`);
await page.waitForTimeout(2000);
const res = await page.evaluate(async () => {
  const V = await import('/src/proto/vehicles/index.ts');
  const M = await import('/src/proto/vehicles/motion.ts');
  // the shader code exactly as render.ts patches it
  const { material } = V.vehicleMaterial();
  const sh = { uniforms: {}, vertexShader: '#include <common>\nvoid main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\noPos = transformed; oNrm = objectNormal; gl_Position = vec4(0.0);\n}', fragmentShader: '' };
  material.onBeforeCompile(sh);
  const vs = '#version 300 es\n#define attribute in\n#define varying out\nprecision highp float; precision highp int;\nin vec3 position; in vec3 normal; out vec3 oPos; out vec3 oNrm;\n' +
    sh.vertexShader.replace('#include <common>', '').replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normal;').replace('#include <begin_vertex>', 'vec3 transformed = position;');
  const fs = '#version 300 es\nprecision highp float; out vec4 c; void main() { c = vec4(1.0); }';
  const gl = document.createElement('canvas').getContext('webgl2');
  const mk = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) + '\n' + s); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
  gl.transformFeedbackVaryings(prog, ['oPos', 'oNrm'], gl.SEPARATE_ATTRIBS);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const loc = (n) => gl.getAttribLocation(prog, n);
  const run = (g, data) => {
    const n = g.getAttribute('position').count;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    for (const [name, size] of [['position', 3], ['normal', 3], ['vk', 4], ['vd', 4]]) {
      const l = loc(name); if (l < 0) continue;
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, g.getAttribute(name).array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0);
    }
    const li = loc('iData'); if (li >= 0) { gl.disableVertexAttribArray(li); gl.vertexAttrib4f(li, ...data); }
    const outs = [0, 1].map(() => { const b = gl.createBuffer(); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, b); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, n * 12, gl.STREAM_READ); return b; });
    const tf = gl.createTransformFeedback(); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, outs[0]); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, outs[1]);
    gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, n); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    const read = (b) => { const a = new Float32Array(n * 3); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, b); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, a); return a; };
    return [read(outs[0]), read(outs[1])];
  };
  const states = [];
  for (const [l, r] of [[0, 0], [1, 0], [0, 1], [0.37, 0.81], [0.5, 0.5], [0.12, 0.93]])
    for (const odo of [0, 3.7, 123.4]) for (const curve of [0, 0.021, -0.035, 0.3]) for (const flags of [0, M.MOTION && 128]) states.push({ l, r, odo, curve, flags });
  const perStyle = new Map();
  for (const m of V.MODELS) if (!perStyle.has(m.style)) perStyle.set(m.style, m);
  const worst = { pos: 0, nrm: 0 }, bad = [];
  const kinds = {};
  for (const m of perStyle.values()) {
    const g = V.geometry(m, 0);
    const P = g.getAttribute('position').array, vk = g.getAttribute('vk').array, vd = g.getAttribute('vd').array, n = P.length / 3;
    let tagged = false; for (let i = 0; i < n; i++) if (vd[i * 4]) { tagged = true; kinds[vd[i * 4]] = (kinds[vd[i * 4]] ?? 0) + 1; }
    if (!tagged) continue;
    for (const s of states) {
      const packed = s.l || s.r ? M.packDoors(s.l, s.r) : 0;
      const [dl, dr] = M.unpackDoors(packed);
      const [gp, gn] = run(g, [s.flags, s.odo, packed, s.curve]);
      const st = { doorL: dl, doorR: dr, odo: s.odo, curve: s.curve, pantoDown: (s.flags & 128) !== 0 };
      const tp = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) {
        const tag = [vd[i * 4], vd[i * 4 + 1], vd[i * 4 + 2], vd[i * 4 + 3]];
        const wheel = vk[i * 4 + 3] > 0 ? [vk[i * 4 + 2], vk[i * 4 + 3]] : undefined;
        const q = M.moveVertex([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], tag, st, wheel);
        tp.set(q, i * 3);
        if (!tag[0]) continue;
        const e = Math.hypot(q[0] - gp[i * 3], q[1] - gp[i * 3 + 1], q[2] - gp[i * 3 + 2]);
        if (e > worst.pos) worst.pos = e;
        if (e > 2e-3 && bad.length < 12) bad.push({ what: 'position', model: m.id, kind: tag[0], state: s, rest: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], ts: q, glsl: [gp[i * 3], gp[i * 3 + 1], gp[i * 3 + 2]] });
      }
      // normals: the face normal of the moved triangle (rigid kinds only; the pantograph squashes)
      for (let t = 0; t < n; t += 3) {
        const k = vd[t * 4]; if (!k || k === 9) continue;
        const a = [tp[t * 3], tp[t * 3 + 1], tp[t * 3 + 2]], b = [tp[t * 3 + 3], tp[t * 3 + 4], tp[t * 3 + 5]], c = [tp[t * 3 + 6], tp[t * 3 + 7], tp[t * 3 + 8]];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...cr);
        if (len < 1e-5) continue;
        for (let j = 0; j < 3; j++) {
          const gi = (t + j) * 3; const e = Math.hypot(cr[0] / len - gn[gi], cr[1] / len - gn[gi + 1], cr[2] / len - gn[gi + 2]);
          if (e > worst.nrm) worst.nrm = e;
          if (e > 0.02 && bad.length < 12) bad.push({ what: 'normal', model: m.id, kind: k, state: s, faceNormal: cr.map((x) => x / len), glsl: [gn[gi], gn[gi + 1], gn[gi + 2]] });
        }
      }
    }
  }
  return { styles: perStyle.size, states: states.length, kinds, worst, bad };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
const all = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => !res.kinds[k]);
if (all.length) console.log('kinds not covered:', all);
if (res.bad.length) { console.error(`GLSL and moveVertex disagree (${res.bad.length}+ cases)`); process.exit(1); }
console.log('GLSL matches moveVertex for every kind');
