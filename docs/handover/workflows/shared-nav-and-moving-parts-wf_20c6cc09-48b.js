export const meta = {
  name: 'shared-nav-and-moving-parts',
  description: 'One shared, tested camera/navigation module for the game and every demo; detailed animated doors, wheels, bogies and pantographs in the vehicle library',
  phases: [
    { title: 'Build', detail: 'kit/camera extracted from the main game; vehicle moving parts' },
    { title: 'Review', detail: 'adversarial review with failing tests' },
    { title: 'Fix', detail: 'fix every confirmed finding' },
  ],
}

const SP = '/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad'
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01EDn6ScXmNn8wUEBAmG2GGU'

const ENV = `
PROJECT: "Untitled", a TypeScript + three.js transport/city game played mostly on an Android Pixel phone in portrait. The 3D prototype is src/proto (main game: proto.html -> src/proto/main.ts). Repo /home/user/gamex; you work in your own git worktree (you are already in it).
ENVIRONMENT
- Playwright: playwright-core is installed in ${SP}/pw/node_modules; put scripts in ${SP}/pw/ with a unique prefix so imports resolve. chromium executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']; newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }). Multi-touch: use CDP Input.dispatchTouchEvent with several touchPoints (page.context().newCDPSession(page)). SwiftShader is slow software rendering: absolute fps is meaningless; compare before/after. 4 CPUs shared with other agents: keep runs short, close browsers.
- Serve with 'npx vite --port <PORT> --strictPort --host 127.0.0.1' in the background; stop it when done.
- Tests: 'npx vitest run --dir <your worktree>/src' (plain 'npx vitest run' picks up other agents' worktrees). 'npx tsc --noEmit' must pass.
- No PIL/ImageMagick: for contact sheets open an HTML page of <img> tiles in playwright and screenshot it.
- Commit with a clear message ending with exactly these two lines:
${TRAILER}
  Never put model names or IDs in commits, code or docs. Do not push. Do not touch branches other than your own.
`

const TRACKS = [
  {
    key: 'nav', branch: 'kit-nav', port: 4271, base: 'HEAD',
    build: `THE USER: "Everything also seems to have its own version of buggy nav... Again, this really needs to be consistent please." Earlier: "The industry preview screen nav is wrong - back to front compared to general game nav and a bit tricky to use."
TODAY: the main game (src/proto/main.ts, around lines 40-80 placeCamera/resize and 1010-1240 groundAt, pointer handlers, keepUnder, animateZoom, wheel) has its own gesture code: orthographic camera with a view {x, z, h (visible height 35-900 m), az, el (0.35-1.52 rad)}; one finger pans with the ground point staying under the finger; two fingers pinch-zoom about their midpoint keeping the ground under it, twist to rotate (after a threshold ROT_START), vertical two-finger drag tilts; double tap zooms; wheel zooms; the sun's shadow camera follows the view in texel steps; in build mode a one-finger drag draws roads instead of panning (tap and drag go to the tool). Six demos on other branches (water, vehicles, people, bridges, industries (incl. chains/terminals), and more coming: ground, bridges-track) each hand-roll their own pointer code, and the industries one is reversed.
YOUR JOB (branch kit-nav from HEAD):
1. src/proto/kit/camera.ts (+ pure maths in src/proto/kit/viewmath.ts): ONE navigation module for the game and every demo. The same gesture model as the main game, with its bugs fixed: ground-anchored one-finger pan (the point under the finger stays under the finger at any tilt/rotation), pinch zoom anchored at the finger midpoint, twist rotate with a start threshold, two-finger vertical drag tilt, double-tap zoom, mouse drag/right-drag rotate-tilt/wheel zoom at the cursor, keyboard (arrows/WASD pan, Q/E rotate, +/- zoom), optional gentle fling inertia (off by default if the main game has none; make it an option), clamps (h, el, optional bounds), animateTo(view, ms) for presets, screenToGround/groundToScreen with an optional height function groundAt(x,z) for terrain, a floating-origin friendly design (views far from 0,0), pointercancel/lost-capture/third-finger/finger-order robustness, tap vs drag disambiguation with a small slop, onTap/onDoubleTap/onLongPress callbacks, and a way for the host to CLAIM a gesture (e.g. build mode: onPointerDown returns true to take the pointer so the rig doesn't pan). Optional on-screen controls (rotate left/right, zoom in/out, reset north) as a small helper that any page can mount. Also an optional shadow-follow helper for a DirectionalLight (the main game's texel-snapped logic).
2. Adopt it in the main game: replace main.ts's gesture/camera code with the kit, keeping behaviour identical or better (build mode, junction editor, taps, double tap, wheel all still work). Keep main.ts edits localised to that code (other streams edit main.ts's seedTown, HUD and traffic).
3. docs/kit.md: the start of the shared-kit registry: what lives in src/proto/kit and the rule that every demo and the game use the kit's camera rather than their own; the exact adoption snippet for a demo page (a few lines) and for perspective or non-orthographic cases if any.
4. Tests: vitest unit tests of the view maths (anchor stays under finger for pan/zoom/rotate/tilt at many tilts, azimuths and positions incl. 100 km from the origin; clamps; animateTo). Playwright gesture tests against the main game BEFORE (HEAD) and AFTER (your branch) with scripted one-finger pans, pinches, twists, tilts, double taps, wheel, a build-mode drag and a tap on a building: record the resulting view and the ground point under the finger; the after results must match before (or be better where before was buggy: say where).
5. npx tsc --noEmit and the vitest run pass; commit on kit-nav. Return branch, sha, worktree, summary, evidence (numbers), and gaps.`,
    lens: `LENS: navigation correctness and feel. Try hard to break it on a phone: scripted multi-touch via CDP (one finger, two fingers landing at different times, lifting in either order, a third finger, pointercancel mid-gesture, very fast flicks, tiny jitter during a tap, pinch while twisting, tilt at the elevation limits, zoom at h limits, pan at the map bounds, rotating through +-pi), mouse and wheel, keyboard. Check the ground point under the finger really stays put (measure it), that build-mode drags never pan, taps and double taps fire exactly once, the junction editor and building taps still work, the shadow follows without shimmer, and there are no regressions against HEAD's behaviour. Also judge the API: could each of the six demos adopt it with a few lines (read their demo.ts on branches origin/claude/water-system, origin/claude/vehicles-lib, origin/claude/people-lib, origin/claude/bridges-lib, origin/claude/industries-3d, local terminals: git show <ref>:<path>)? Name anything a demo needs that the kit lacks.`,
  },
  {
    key: 'vehicles', branch: 'vehicles-moving', port: 4274, base: 'origin/claude/vehicles-lib',
    build: `THE USER: "The doors on passenger vehicles don't look great - especially the trains... Could we put some more details into the bits that move/animate." And always: "respect all the resource constraints so it's not laggy."
TODAY: the vehicle library lives on remote branch origin/claude/vehicles-lib (src/proto/vehicles/*: brands, models, kit, parts, build, rail, buses, cars, lorries, vans, craft, articulation, render (instanced), spawn, demo, vehicles-demo.html; docs in the branch). A cloud session is still polishing it (LOD/perf tuning), so FETCH AND MERGE origin/claude/vehicles-lib again right before you finish and resolve any conflicts keeping both sides' intent.
YOUR JOB (branch vehicles-moving from origin/claude/vehicles-lib; git fetch origin claude/vehicles-lib first):
1. Study how vehicles are built, instanced and animated today, and the demo (Parade, Showroom, Turntable). Look closely at the doors on trains, trams, buses and coaches at the Showroom/Turntable zooms.
2. Make the moving parts convincing, era-appropriate and cheap:
   - Train, tram and metro doors: proper door leaves set into the body with a visible frame/seam, door windows, handles or open buttons, the correct count and spacing per car type (slam doors on old stock (hinged, many), sliding pocket or plug doors on modern stock (plug doors step out then slide), bi-parting on metro), door-open indicator lights, and an animation (open/close with the right motion, step-out for plug doors, staggered slightly between cars) driven by a 'doors' state per vehicle (e.g. dwelling at a stop).
   - Bus and coach doors: folding (bi-fold/jack-knife) doors on older buses, plug or sliding doors on modern ones, a front door and a centre door where the type has one, with glazing and frames; animated.
   - Wheels that turn at the right speed for the distance travelled, bogies that swivel on curves, pantographs up on electric stock (and down when not electric), articulation joints/bellows on bendy buses and trams, lorry trailer articulation (keep whatever exists and improve it), and indicator lights if cheap.
   - Detail only on the near level of detail; mid and far LODs keep a simple suggestion (a darker seam line) or nothing. Animation in the vertex shader (instance attributes for door phase, wheel angle, bogie yaw) or by a bounded number of per-instance matrices, NOT per-vehicle meshes; no extra draw calls where avoidable (state the before/after draw calls and triangles for Parade and Showroom). The public API should expose e.g. setDoors(id, open 0..1) or a stop/dwell helper so the traffic, rail and people systems can drive boarding.
3. Update the demo so it shows this: a Doors control (open/close), a station platform or bus stop moment where doors open while stopped, and a close-up preset on doors. Keep the demo's nav as it is (a separate stream is building a shared camera kit that every demo will switch to).
4. Tests: door counts and positions per car/bus type, animation state maths, LOD budgets (triangles per vehicle per LOD), draw calls unchanged or budgeted. Phone screenshots (412x915 DPR 2) before (origin/claude/vehicles-lib) and after of: a modern EMU with doors closed and open, a 1960s slam-door carriage, a metro car, a tram, a double-deck bus, a bendy bus, a coach, at close zoom, plus Parade at normal zoom. Save to ${SP}/vehicles-moving/ with a contact sheet sheet.png.
5. tsc and the vitest run pass; commit on vehicles-moving. Return branch, sha, worktree, summary, evidence (numbers), gaps.`,
    lens: `LENS: realism and cost of the moving parts. Look at the doors and moving parts yourself at close zoom on every passenger vehicle type (all eras): are door counts, spacing, frames, windows, handles and indicator lights right and tidy? Do doors clip through the body, z-fight with it, float, open the wrong way, open on the wrong side at a platform, or leave holes? Do plug doors step out before sliding? Are wheels turning at a rate matching distance travelled, bogies swivelling correctly on curves, pantographs sensible, articulation joints not tearing? Is it all within budget: count triangles per LOD and draw calls before/after in Parade and Showroom, and check mid/far LODs aren't paying for near detail. Check the API lets traffic/rail/people drive doors. Also check the merge with the latest origin/claude/vehicles-lib didn't lose the other session's work.`,
  },
]

const OUT = {
  type: 'object',
  properties: { branch: { type: 'string' }, sha: { type: 'string' }, worktree: { type: 'string' }, summary: { type: 'string' }, evidence: { type: 'string' }, gaps: { type: 'string' } },
  required: ['branch', 'sha', 'worktree', 'summary', 'evidence', 'gaps'],
}
const REVIEW = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, sha: { type: 'string' }, verdict: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, title: { type: 'string' }, evidence: { type: 'string' }, test: { type: 'string' } }, required: ['id', 'severity', 'title', 'evidence', 'test'] } },
  },
  required: ['branch', 'sha', 'verdict', 'findings'],
}
const FIX = {
  type: 'object',
  properties: { branch: { type: 'string' }, sha: { type: 'string' }, worktree: { type: 'string' }, summary: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, disputed: { type: 'array', items: { type: 'string' } }, evidence: { type: 'string' } },
  required: ['branch', 'sha', 'worktree', 'summary', 'fixed', 'disputed', 'evidence'],
}

const results = await pipeline(
  TRACKS,
  (t) => agent(`${ENV}\n${t.build}\nCreate your branch: ${t.base === 'HEAD' ? 'git checkout -b ' + t.branch : 'git fetch origin claude/vehicles-lib && git checkout -b ' + t.branch + ' ' + t.base}. Serve on port ${t.port}.`, { label: 'build:' + t.key, phase: 'Build', schema: OUT, isolation: 'worktree' }),
  (b, t) => agent(`${ENV}\nA builder did this work on local branch '${b.branch}' (commit ${b.sha}, worktree ${b.worktree}). The brief it had:\n${t.build}\nIts own account, which you must NOT take on trust:\n${b.summary}\nEvidence it claims: ${b.evidence}\nGaps it admits: ${b.gaps}\n\nYOU ARE AN ADVERSARIAL REVIEWER. ${t.lens}\nWork in your own worktree: git checkout -b ${t.branch}-review ${b.sha}. Serve on port ${t.port + 1}. For every real problem write a focused FAILING test where it can be automated (vitest, or a playwright script in ${SP}/pw/${t.key}-review-*.mjs that exits non-zero), commit tests on ${t.branch}-review, record evidence (numbers, screenshot paths). Do not fix code. No taste-only nits without evidence; report anything the user would notice. Return branch, sha, verdict, findings.`, { label: 'review:' + t.key, phase: 'Review', schema: REVIEW, isolation: 'worktree' }).then((r) => ({ b, r })),
  (x, t) => {
    if (!x || !x.r) return x ? { build: x.b, review: null, fix: null } : null
    if (!x.r.findings.length) return { build: x.b, review: x.r, fix: null }
    return agent(`${ENV}\nThe work is on local branch '${x.b.branch}' (commit ${x.b.sha}). Its brief:\n${t.build}\nAn adversarial reviewer found these problems (failing tests committed on ${x.r.branch} @ ${x.r.sha}):\n${JSON.stringify(x.r.findings, null, 1)}\n\nYOUR JOB: fix every finding at its root. In your own worktree: git checkout -b ${t.branch}-2 ${x.b.sha} && git merge ${x.r.sha}. Make each failing test pass by fixing the real cause, never by weakening the test (fix a wrong test and say why). Dispute a finding only with evidence. ${t.key === 'vehicles' ? 'Fetch and merge origin/claude/vehicles-lib again before finishing. ' : ''}Re-take the screenshots and look at them. Serve on port ${t.port + 2}. tsc, the vitest run and every ${SP}/pw/${t.key}-review-* script must pass. Commit on ${t.branch}-2. Return branch, sha, worktree, summary, fixed ids, disputed with evidence, evidence.`, { label: 'fix:' + t.key, phase: 'Fix', schema: FIX, isolation: 'worktree' }).then((f) => ({ build: x.b, review: x.r, fix: f }))
  },
)
return results