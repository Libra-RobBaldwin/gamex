# The shared kit

`src/proto/kit/` holds the pieces that the game and every demo page share. The user asked for
this after each preview grew its own slightly different, slightly buggy copy:

> "Everything also seems to have its own version of buggy nav... Again, this really needs to be
> consistent please."

## The rule

**The game and every demo page use the kit, never their own copy.** If a page needs something
the kit lacks, add it to the kit, with tests, and every page gets it.

`src/proto/kit/architecture.test.ts` enforces this for the camera. It reads every `*.html` page
at the top of the repo and the module it loads, and every module in `src/proto` outside the kit.
It fails if any of them:
- listens for pointers, touches or the wheel on the canvas, window or document;
- captures the pointer itself;
- places or sizes the camera itself (`cam.position.set`, `cam.lookAt`, `cam.left = ...`);
- uses a three.js controls add-on.

It also fails if a page doesn't import `kit/camera` and make a `NavRig`. A new demo page is
checked as soon as its `.html` file exists. The one exception is `index.html`, the old 2D canvas
prototype (`src/main.ts`). It has no three.js camera and isn't the game.

## Registry

| Module | What it is | Used by |
|---|---|---|
| `kit/viewmath.ts` | The view maths: pure functions, no DOM, no three.js. A view is `{x, z, h, az, el, y?}`. It covers screen↔ground (flat, or terrain via a height function), keeping a ground point under a screen point, clamps and bounds, fitting a box, easing, and the texel-snapped shadow frame. Everything is worked out relative to the view target, so it is exactly as precise 100 km from the origin. | `kit/camera.ts` |
| `kit/camera.ts` `NavCore` | The gesture state machine and view, with no DOM. Feed it pointer events and it moves `view`. Unit-tested with scripted fingers. | `NavRig` |
| `kit/camera.ts` `NavRig` | `NavCore` bound to an element's pointer, wheel and key events, driving an orthographic or perspective three.js camera. It supports a floating origin (`origin`, `rebaseAt`, `onRebase`). | the game, every demo |
| `kit/camera.ts` `SunFollow` | Keeps a directional light's shadow on the view. The box grows in big steps and slides in whole shadow-map texels, so shadow edges don't shimmer. | the game, people, vehicles, industries |
| `kit/camera.ts` `mountNavControls` | Optional on-screen buttons in the brand's colours: a compass that shows north and resets the view, rotate left and right, zoom in and out. Page CSS can't restyle them. `below: el` keeps them under a page's panel however tall it grows. | water, bridges, industries |

## What the navigation does

The gestures are the same on every page (Google Maps style):

| Input | Does |
|---|---|
| One finger drag | Pans. The ground under the finger stays under it at any tilt, turn or distance from the origin. |
| Two fingers pinch | Zooms about the midpoint of the fingers. |
| Two fingers twist | Turns about the midpoint, once the twist passes 12°, so pinches don't wobble. |
| Two fingers sliding up/down together | Tilts. Fingers up makes the view steeper. |
| Double tap | Zooms in on the spot. The host can take it over. |
| Quick two-finger tap | Zooms out. |
| Flick | Glides to a stop. This is the `fling` option, on by default as in the game. |
| Mouse drag | Pans. |
| Right, middle or ctrl/alt drag | Turns and tilts about where the drag began. |
| Wheel | Zooms at the cursor, ×1.12 per notch of 100 px. A trackpad pinch tracks the fingers. |
| Arrows / WASD | Pan. |
| Q / E | Turn. |
| + / − | Zoom. |

Robustness:
- Fingers can land and lift in any order. A third finger is ignored.
- `pointercancel` and `lostpointercapture` end a gesture cleanly.
- A tap may wobble up to 8 px and still count as a tap.

The host hears about `onTap`, `onDoubleTap`, `onLongPress` and `onHover`. It can **claim** a
gesture:
- `onPointerDown` returns true to take the finger at once (dragging a handle).
- `onDragStart` returns true to take it once it moves past the tap slop (drawing a road).

The camera then leaves that finger alone and passes its moves to `onClaimMove`. A second finger
hands control back to the camera for a pinch (`onClaimEnd(p, 'second-finger')`). When one finger
of a pinch lifts, `onRemaining` can take back the finger that is left; otherwise it pans.

Limits push back without dead zones. After pinching, tilting or panning past a limit, the
gesture counts from the limit, so turning back works at once. A flick that lifts past its last
move pans to where it lifted. A touch that stops a glide only stops it: it is not a tap.

Limits come from `limits: { hMin, hMax, elMin, elMax, bounds }`. Presets and buttons use
`animateTo(view, ms)`, `framing(point, sx, sy, patch)`, `fit(box, pad)`, `zoomAt`, `rotateBy`,
`tiltTo` and `resetNorth`. Any touch interrupts them.

## Adopting it on a page

```ts
import { NavRig, SunFollow, mountNavControls } from '../kit/camera';

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: 0, h: 120, az: Math.PI / 4, el: 0.6 },   // h: metres visible top to bottom
  limits: { hMin: 20, hMax: 900 },
  shadow: new SunFollow(sun, { dir: { x: -160, y: 260, z: 110 } }),   // optional
  onTap: (p) => pick(p.sx, p.sy, p.ground),                  // optional hooks
});
mountNavControls(nav);                                        // optional buttons
(window as unknown as { nav: NavRig }).nav = nav;             // for the gesture tests

function frame(now: number) {
  nav.update(dt, now);          // animations, glides, keys, clamps; places the camera
  renderer.render(scene, cam);
}
```

Read `nav.view` any time. To jump somewhere, call `nav.setView({...})`. To move there smoothly,
call `nav.animateTo({...})`. For screen↔world, use `nav.groundUnder(sx, sy)` (never null) and
`nav.groundToScreen(p)`. On a resize, call `nav.apply()`.

Variations:
- **Terrain**: pass `groundAt: (x, z) => height` (or call `nav.setGround(fn, [lo, hi])` once it
  is built). Panning then grabs the hillside under the finger, and once the view comes to rest
  it pivots on the ground in the middle of the screen. The water demo does this.
- **Perspective camera**: pass a `THREE.PerspectiveCamera`. Here `h` is the visible height at
  the target, and everything else is the same.
- **A host that draws or drags**: return true from `onPointerDown` or `onDragStart`, and handle
  `onClaimMove` and `onClaimEnd`. The game does this in its build modes. The vehicle turntable
  claims the drag to turn the vehicle, and uses `onRemaining` for the finger left after a pinch.
- **Framing a subject clear of panels**: use `nav.fitting(box, { top, bottom })` or
  `nav.framing(point, sx, sy, { h })`. The bridges and industries demos use these.
- **Object viewer**: `oneFinger: 'orbit'` makes one finger turn and tilt instead of pan. No page
  uses it at the moment, because every page now pans like the game.

## Tests

- `kit/viewmath.test.ts` checks the maths. screen↔ground are inverses (orthographic and
  perspective, 100 km out) and match a three.js camera. The anchor stays under the finger for
  pan, zoom, twist and tilt across a grid of tilts, turns and positions. It also covers clamps,
  easing and the shadow frame.
- `kit/camera.test.ts` checks the gestures with scripted fingers: taps and slop, double and long
  press, fling, pinch, twist threshold, tilt hand-over, a third finger, lift order, cancel,
  claims, mouse, wheel, keys, limits, `animateTo` and reset north.
- `kit/architecture.test.ts` checks the rule above.
- The `*.review.*` files hold the failing tests from four adversarial reviews (kit core, the
  game against its old behaviour, every demo, and real phone touch in the browser). All of them
  pass now. Keep them; they are regression tests.
- `e2e/nav.e2e.mjs` runs in a real phone-sized touch browser (412×915, DPR 2) on the game and
  every demo. It scripts fingers through the DevTools protocol and measures, in screen pixels,
  that the ground grabbed stays under the finger. It also checks double tap, wheel, keyboard,
  limits, a build-mode drag and a tap on a building. It isn't part of `vitest run`, because it
  needs a browser and a dev server:

  ```sh
  npx vite --port 4271 &
  npm i --no-save playwright-core@1.56
  node e2e/nav.e2e.mjs            # or: node e2e/nav.e2e.mjs game water
  ```
