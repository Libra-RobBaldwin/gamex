// The rule behind the shared kit (docs/kit.md): the game and every demo page move their camera
// with kit/camera.ts. None of them may listen for pointers, touches or the wheel on the canvas,
// or place the camera itself. This test reads the source and fails if one does, so a new demo
// with its own navigation can't slip in.
import { describe, expect, it } from 'vitest';

// every module in src/proto and every page at the top of the repo, as text
const SOURCES = import.meta.glob(['/src/proto/**/*.ts', '!/src/proto/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const HTML = import.meta.glob('/*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const KIT = '/src/proto/kit/';

// comments say what used to happen; only code counts
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// Gesture and camera code, as it looks when a page rolls its own.
const RULES: [string, RegExp][] = [
  ['listens for pointers, touches or the wheel on the canvas or window',
    /\b(canvas|cv|el|element|domElement|renderer\.domElement|window|document|body)\s*\.\s*addEventListener\(\s*['"`](pointer(down|move|up|cancel)|lostpointercapture|touch(start|move|end|cancel)|wheel|mousewheel|gesture(start|change|end)|mouse(down|move|up))['"`]/],
  ['sets a pointer or wheel handler property on the canvas',
    /\b(canvas|cv|domElement)\s*\.\s*on(pointer\w+|touch\w+|wheel|mouse\w+)\s*=/],
  ['captures the pointer itself', /\.setPointerCapture\(/],
  ['places the camera itself', /\b(cam|camera)\s*\.\s*(position|quaternion|rotation|up)\s*\.\s*(set|copy|add|applyMatrix4)\(|\b(cam|camera)\s*\.\s*lookAt\(/],
  ['sizes the camera frustum itself', /\b(cam|camera)\s*\.\s*(left|right|top|bottom|zoom|fov)\s*=[^=]/],
  ['uses a three.js controls add-on', /three\/examples\/jsm\/controls\//],
];

function offences(src: string): string[] {
  const c = code(src);
  return RULES.filter(([, re]) => re.test(c)).map(([why]) => why);
}

// Every page: the html files at the top of the repo and the script each one loads. index.html is
// the old 2D canvas prototype (src/main.ts), which has no three.js camera and is not the game;
// places.html is Real Town Plans (src/places), a Leaflet map and flat plans with no 3D scene.
const LEGACY = new Set(['index.html', 'places.html']);
const pages = Object.entries(HTML).filter(([f]) => !LEGACY.has(f.slice(1))).map(([f, text]) => {
  const src = text.match(/<script[^>]*type="module"[^>]*src="(\/?[^"]+)"/)?.[1];
  return { html: f.slice(1), script: src ? (src.startsWith('/') ? src : `/${src}`) : null };
});

describe('one camera for the game and every demo (docs/kit.md)', () => {
  it('finds the game and the demos', () => {
    const names = pages.map((p) => p.html);
    for (const want of ['proto.html', 'water-demo.html', 'vehicles-demo.html', 'people-demo.html', 'bridges-demo.html', 'industries-demo.html', 'ground-demo.html']) expect(names).toContain(want);
  });

  for (const p of pages) {
    it(`${p.html} moves its camera with the kit`, () => {
      expect(p.script, `${p.html} has no module script`).toBeTruthy();
      const src = SOURCES[p.script!];
      expect(src, `${p.script} should be a module in src/proto`).toBeTypeOf('string');
      expect(src, `${p.script} should import the shared camera from kit/camera`).toMatch(/from\s+['"](\.\.?\/)+(proto\/)?kit\/camera['"]/);
      expect(code(src), `${p.script} should make a NavRig`).toMatch(/new\s+NavRig\(/);
      expect(offences(src), p.script!).toEqual([]);
    });
  }

  it('no other module in src/proto has its own gesture or camera code', () => {
    const bad = Object.entries(SOURCES).filter(([f]) => !f.startsWith(KIT)).map(([f, src]) => ({ f, why: offences(src) })).filter((x) => x.why.length);
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(bad).toEqual([]);
  });

  it('catches the patterns it is meant to', () => {
    // the kinds of code the demos had before they moved to the kit
    expect(offences(`canvas.addEventListener('pointermove', (e) => { view.x -= e.movementX; });`)).toHaveLength(1);
    expect(offences(`canvas.addEventListener("wheel", f, { passive: false });`)).toHaveLength(1);
    expect(offences(`renderer.domElement.addEventListener('touchstart', f);`)).toHaveLength(1);
    expect(offences(`canvas.setPointerCapture(e.pointerId);`)).toHaveLength(1);
    expect(offences(`cam.position.set(view.x + d, d, view.z); cam.lookAt(view.x, 0, view.z);`)).toHaveLength(1);
    expect(offences(`cam.left = -h * a; cam.right = h * a;`)).toHaveLength(1);
    expect(offences(`import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';`)).toHaveLength(1);
    // and leaves alone what isn't navigation
    expect(offences(`button.addEventListener('click', go); sun.position.set(1, 2, 3); // canvas.addEventListener('wheel', f)`)).toEqual([]);
  });
});
