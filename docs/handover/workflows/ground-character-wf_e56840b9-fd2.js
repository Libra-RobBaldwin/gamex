export const meta = {
  name: 'ground-character',
  description: 'Realistic, characterful ground (grass, fields, hedges, lawns, slopes) shared by the game and demos, phone-cheap',
  phases: [
    { title: 'Build', detail: 'shared ground material, cover painting, fields and hedges, main game integration, demo page' },
    { title: 'Review', detail: 'two independent adversarial reviewers: look/realism and performance/shimmer/robustness' },
    { title: 'Fix', detail: 'address every confirmed finding' },
    { title: 'Confirm', detail: 'fresh verification of the final branch, contact sheet' },
  ],
}

const SP = '/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad'
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\nClaude-Session: https://claude.ai/code/session_01EDn6ScXmNn8wUEBAmG2GGU'

const CONTEXT = `
PROJECT: "Untitled", a TypeScript + three.js transport/city-building game (think Transport Fever / OpenTTD / SimCity), played mostly on an Android Pixel phone in portrait. The 3D prototype is src/proto (entry proto.html -> src/proto/main.ts). The repo is /home/user/gamex; you work in your own git worktree (you are already in it).

THE USER'S REQUEST (verbatim): "Bright green grass with no texture seems to currently be the default - can we add some character to it, some different textures and make it a bit more realistic?"
Earlier the same user said about other visuals: "I just want it to be good but again need to respect all the resource constraints so it's not laggy." They are also very sensitive to flashing/shimmer (they reported flashing roof triangles). So: realistic, with character, calm, no shimmer, cheap on a phone.

CURRENT STATE
- src/proto/main.ts ~lines 88-116: canvasTex() makes a 256x256 canvas "grassTex" (flat #6f9e48 with 5000 random 2px speckles), repeated 60x60 over one PlaneGeometry quad of BOUND*2.6 (BOUND = 520 m, so ~1352 m square), MeshLambertMaterial({ map: grassTex }), receiveShadow, stencilWrite=true, stencilRef=1, stencilFunc=NotEqualStencilFunc, renderOrder=-9 (roads/railways in cuttings mark the stencil first so the ground leaves a hole: KEEP this behaviour). A beach circle and lake circle (LAKE {x:250,z:-190,r:90}) sit on it. Trees are instanced (a 'trees' array, woods on the outskirts). Lighting: HemisphereLight('#e8f3ff','#5d7040',1.25) + DirectionalLight sun with PCF soft shadows; scene.background #a9cbe3. Renderer: antialias, stencil, pixel ratio min(2, dpr). Adaptive quality TIERS in main.ts (High/Good/Balanced/Fast/Fastest, setTier()) change pixel ratio and shadows.
- Camera: orthographic; visible height view.h ranges H_MIN=35 m to H_MAX=900 m; elevation 0.35-1.52 rad; azimuth rotates. On a 412x915 CSS px phone at DPR 2: at 35 m that's ~50 device px per metre (close-up needs real texture detail); at 900 m ~2 px per metre (needs macro variation and no visible tiling).
- The same speckle grass is copy-pasted into other demos on other branches (water demo on claude/water-system uses a grass() function and a patchGroundMaterial() that chains onBeforeCompile to overlay shore colours by vertex-colour alpha; the terrain library on claude/terrain-lib builds ground tiles with world-space UVs (uvScale 16 m) placed at an offset (floating origin) and says tiles share the game's ground material; bridges/industries/people/vehicles demos have their own flat ground). Those branches are not merged; your module must be easy for them to adopt (document a one-line swap for each) and must work on terrain tiles (world-space sampling, slope from the normal, height from world y, precision far from the origin via an offset/floating-origin uniform - world tiles may be 100+ km from the origin).
- The land registry is src/proto/land.ts (class Land, claims with owner road/junction/slip/island and polygons). The road network is src/proto/roads.ts (Network: lots/plots, lotFree, etc.). Buildings grow over time (spawnLot, refreshTrees in main.ts; window.proto.growAll() grows everything at once for testing). Read the code to find plots, roads, trees and the lake.
- Other streams are editing main.ts in parallel (roads/traffic, a UI overhaul). Keep your main.ts edits SMALL and LOCALISED (swap the grass texture/material, call your painter at start-up and when the town grows, hook quality into setTier). Put all logic in new files under src/proto/ground/.

ENVIRONMENT
- Playwright: playwright-core is installed in ${SP}/pw/node_modules; put your scripts in ${SP}/pw/ with a unique prefix (e.g. ${SP}/pw/ground-<you>-*.mjs) so imports resolve. Launch chromium with executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' and args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']; newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }). SwiftShader is software rendering: absolute fps is meaningless, compare old vs new frame times under the same setup. The machine has 4 CPUs shared with other agents: keep headless runs short and close browsers.
- Serve your worktree with 'npx vite --port <PORT> --strictPort --host 127.0.0.1' in the background (vite.config.ts lists the pages; add yours). Stop your servers when done.
- Tests: run 'npx vitest run --dir <your worktree>/src' (a plain 'npx vitest run' also picks up other agents' worktrees under .claude/worktrees and fails on their tests). 'npx tsc --noEmit' must pass.
- No PIL/ImageMagick. To make a contact sheet, open an HTML page of <img> tiles in playwright and screenshot it.
- Commit with a clear message ending with these two lines exactly:
${TRAILER}
  Never put model names or IDs in commits, code or docs. Do not push. Do not touch branches other than your own.
`

const BRIEF = `
ART BRIEF (British countryside and market-town edge, seen from above in an orthographic view)
- The ground is a calm backdrop. Roads, railways, vehicles and buildings must stay the most readable things on screen: keep ground contrast and saturation moderate, never busier than the roads. Muted, natural colours (olive, sage, yellow-green, blue-green in shade, straw, earth browns), not bright lime.
- No single flat colour anywhere: macro variation at several scales (~400 m, ~120 m, ~30 m) so the far view has gentle patches, and fine texture (grass blades/strokes, clover clumps, tufts, the odd daisy/buttercup speck, soil specks) that shows only when close.
- Visible tiling is a failure at every zoom: sample detail at two scales/rotations, modulate by macro noise, or similar anti-tiling.
- Different ground covers, blended softly where they meet (not pixelated, not hard-edged except where a hedge or road hides the edge):
  - pasture/meadow (the default), with rougher tussocky patches;
  - mown lawn in the town: gardens round houses, parks, road verges (finer, slightly brighter; faint mowing stripes on bigger lawns like parks and playing fields);
  - rough grassland on outskirts and embankments;
  - arable fields in the countryside as a patchwork of parcels (irregular, not a grid; 2-8 ha each): ploughed soil with furrows, wheat/barley in gold-straw with drill rows, green leys and pasture, the odd bright rapeseed field; rows follow each field's own direction; tramlines are a nice touch;
  - hedgerows between fields (and along country roads) as low instanced 3D hedges with a few hedgerow trees and gaps for gateways (one or two draw calls total), sitting on the ground without z-fighting and never crossing roads, rail, water or building plots;
  - woodland floor under clumps of trees (darker, brown-green leaf litter);
  - worn/bare earth where people walk or build (e.g. building sites while a lot is under construction, worn corners), and earthworks/cuttings;
  - wet, lusher grass near water;
  - on terrain: rock/scree on steep slopes and heather/moorland at height (use the world normal and world y; the current main map is flat, so show this in the demo's hills scene).
- When the town grows onto a field, the field and hedges there give way to gardens (repaint just the changed area).
- Dusk/night-ready: don't bake lighting into the textures; work with the scene's Lambert lighting and shadows.

PERFORMANCE BUDGET (Pixel phone, ground covers most of the screen, so fragment cost is what matters)
- Keep MeshLambertMaterial (patched via onBeforeCompile, chaining any previous onBeforeCompile and setting customProgramCacheKey) so shadows, fog, stencil and the water shore overlay keep working.
- High tier: at most 6 texture samples per ground fragment; Fast/Fastest: at most 3. No per-pixel noise loops. Expose setGroundQuality(level) and call it from setTier.
- New texture memory at most 4 MB including mips. Textures generated at start-up deterministically from a seed with typed arrays (so tests run in Node), not downloaded; generation at most 40 ms on desktop Chrome.
- Painting the cover map for the whole current map at most 30 ms; an incremental repaint after one building at most 2 ms (texSubImage of the changed rect, or equivalent). No leaks (dispose replaced textures).
- Draw calls: +0 for the ground itself, at most +2 for hedges/extras; at most +60k triangles in the worst view. Frame time in SwiftShader at each tier within about 15% of the old ground.
- No shimmer or crawling while panning/zooming: mipmaps + anisotropy, no high-contrast sub-pixel detail; fine detail fades with zoom.
`

const BUILD = `${CONTEXT}
${BRIEF}
YOUR JOB: build it. Create branch 'ground' in your worktree (git checkout -b ground).
1. src/proto/ground/: texture generation (seamless, deterministic), cover classes and palette, the cover map (low-res world-space textures of cover weights plus whatever per-field data you need for crop type and row direction), the painter that fills it from the game's land registry/plots/roads/trees/lake and procedural field parcels and hedgerows, the patched material with quality levels and an origin/offset uniform for precision, and the hedge instancing. Clean, commented in the style of the surrounding code (short plain comments explaining why).
2. Integrate into the main game with small, local edits to main.ts: the new ground replaces the speckle grass; paint at start-up; repaint when lots are claimed/built and trees change; quality from setTier; keep the stencil behaviour for cuttings.
3. ground-demo.html + src/proto/ground/demo.ts: a phone-first page with a branded HUD (brand colours: forest #1f5e3f, darker #0f3322, lime #5cb83a, gold #b8964e; no emoji; plain text buttons), scenes Countryside (patchwork fields, hedges, woods, a lane), Town edge (houses with gardens, a park with stripes, verges, a building site), Hills (a procedural height mesh showing slopes rock/scree/heather), Gallery (every cover type as labelled swatches), zoom presets Close 35 m / Mid 200 m / Far 900 m, a Before/After toggle (old speckle vs new), a quality selector, Day/Dusk, and a perf readout (fps, frame ms, draw calls, triangles, texture MB). One-finger pan anchored to the ground, pinch zoom, two-finger rotate, like the main game.
4. docs/ground.md: API, cover classes, painting, adopting it in terrain tiles and in the water/bridges/industries/people/vehicles demos (a one-line swap each), and measured performance.
5. Tests (vitest, Node): seamless wrap of generated textures, determinism, valid weights, field parcels and hedges avoid roads/plots/water/each other, incremental repaint equals full repaint over the changed rect, timing budgets. Browser checks (playwright): shaders compile at every quality tier with no errors, frame time old vs new per tier, a shimmer metric (mean abs pixel difference on ground-only pixels between frames under slow sub-pixel pans and a slow zoom, at 35/200/900 m; new must not be worse than old), and a tiling check at the far zoom.
6. Look-dev: iterate at least three rounds. Each round take phone screenshots of the main game at Close/Mid/Far in the town centre, the town edge and open countryside, plus the demo scenes, LOOK at them critically against the brief, and improve. Save the final set as ${SP}/ground/after-*.png with the matching old ones as ${SP}/ground/before-*.png, and a contact sheet at ${SP}/ground/sheet.png.
7. npx tsc --noEmit and your vitest run must pass. Commit on 'ground'.
Return the branch, the final commit sha, the worktree path, a plain-language summary of what you built and how it looks, the measured numbers against every budget, the screenshot paths, and anything you could not do.`

const BUILD_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, sha: { type: 'string' }, worktree: { type: 'string' },
    summary: { type: 'string' }, budgets: { type: 'string' }, screenshots: { type: 'string' }, gaps: { type: 'string' },
  },
  required: ['branch', 'sha', 'worktree', 'summary', 'budgets', 'screenshots', 'gaps'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, sha: { type: 'string' },
    verdict: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          title: { type: 'string' }, evidence: { type: 'string' }, test: { type: 'string' },
        },
        required: ['id', 'severity', 'title', 'evidence', 'test'],
      },
    },
  },
  required: ['branch', 'sha', 'verdict', 'findings'],
}

phase('Build')
const built = await agent(BUILD, { label: 'build:ground', phase: 'Build', schema: BUILD_SCHEMA, isolation: 'worktree' })
if (!built) return { error: 'builder failed' }
log('Built ' + built.branch + ' @ ' + built.sha.slice(0, 8))

const LENSES = [
  {
    key: 'look', port: 4263, branch: 'ground-review-look',
    brief: `LENS: look and realism. Judge the result as the demanding user would on their phone. Take your own screenshots (412x915 DPR 2) of the main game at 35/200/900 m in the town centre, town edge and countryside, at several azimuths and at dusk, and of every demo scene, and compare with the old ground. Hunt for: visible tiling or repetition; regular or grid-like fields; uniform, floating, z-fighting or road-crossing hedges; hedges or fields overlapping plots, roads, rail, the lake or trees; harsh, stair-stepped or pixelated cover borders; colours that are oversaturated, muddy, too dark or unnatural; ground that is busier or higher-contrast than the roads (roads, vehicles and buildings must stay the most readable things); lawns, rock or heath in the wrong places; the town growing onto a field and leaving field or hedge behind; anything that makes it look less realistic than it should. Be specific: the screen position, zoom and screenshot path for each problem.`,
  },
  {
    key: 'perf', port: 4264, branch: 'ground-review-perf',
    brief: `LENS: performance, shimmer and robustness. Verify every budget yourself rather than trusting the builder's numbers: count texture samples per quality tier from the actual compiled fragment shader (gl.getShaderSource on the ground program), measure frame time old vs new per tier in SwiftShader, draw calls and triangles in the worst view, texture memory, start-up generation time, full paint and incremental repaint time (window.proto.growAll and single growth steps), leaks across many repaints (renderer.info.memory.textures). Measure shimmer yourself (frame-to-frame differences on ground pixels during slow sub-pixel pans and slow zooms at 35/200/900 m, old vs new). Check the stencil hole for roads/railways in cuttings still works, that the material composes with a chained onBeforeCompile like the water system's patchGroundMaterial (vertex colours with alpha), that precision holds far from the origin (a mesh at 100 km offset must not swim or band), that low tiers really are cheaper, and API edge cases (regions not at the origin, repaint at map edges, empty town).`,
  },
]

phase('Review')
const reviews = await parallel(LENSES.map((L) => () => agent(`${CONTEXT}
${BRIEF}
A builder has implemented this on local branch '${built.branch}' (commit ${built.sha}, worktree ${built.worktree}). Its own account, which you must NOT take on trust:
${built.summary}
Budgets it claims: ${built.budgets}
Gaps it admits: ${built.gaps}

YOU ARE AN ADVERSARIAL REVIEWER. ${L.brief}
Work in your own worktree: git checkout -b ${L.branch} ${built.sha}. Serve on port ${L.port}. For every real problem write a focused FAILING test where it can be automated (vitest in src/proto/ground/review.${L.key}.test.ts, or a playwright script in ${SP}/pw/ground-review-${L.key}-*.mjs that exits non-zero), commit the tests on ${L.branch}, and record the evidence. Do not fix the code yourself. Do not report style nits or matters of taste without evidence; do report anything the user would notice. Return the branch, the sha of your commit, an overall verdict, and the findings (severity blocker/major/minor, evidence with screenshot paths or numbers, and the test that shows it or 'manual').`,
  { label: 'review:' + L.key, phase: 'Review', schema: REVIEW_SCHEMA, isolation: 'worktree' })))

const found = reviews.filter(Boolean)
const allFindings = found.flatMap((r, i) => r.findings.map((f) => ({ ...f, lens: LENSES[i].key, reviewBranch: r.branch, reviewSha: r.sha })))
log(allFindings.length + ' findings (' + allFindings.filter((f) => f.severity !== 'minor').length + ' blocker/major)')

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, sha: { type: 'string' }, worktree: { type: 'string' }, summary: { type: 'string' },
    fixed: { type: 'array', items: { type: 'string' } },
    disputed: { type: 'array', items: { type: 'string' } },
    budgets: { type: 'string' }, screenshots: { type: 'string' },
  },
  required: ['branch', 'sha', 'worktree', 'summary', 'fixed', 'disputed', 'budgets', 'screenshots'],
}

let head = { branch: built.branch, sha: built.sha, worktree: built.worktree }
let fix = null
phase('Fix')
if (allFindings.length) {
  fix = await agent(`${CONTEXT}
${BRIEF}
The ground work is on local branch '${built.branch}' (commit ${built.sha}). Two adversarial reviewers found these problems; their failing tests are committed on their branches (listed per finding):
${JSON.stringify(allFindings, null, 1)}

YOUR JOB: fix every finding. Work in your own worktree: git checkout -b ground-2 ${built.sha}, then merge in the reviewers' branches (${found.map((r) => r.branch + ' @ ' + r.sha).join(', ')}) so their tests come with you. Make each failing test pass by fixing the real cause, never by weakening the test (if a test is itself wrong, fix it and say why). You may dispute a finding only with evidence. Keep every budget. Re-do the look-dev screenshots after your changes (overwrite ${SP}/ground/after-*.png and ${SP}/ground/sheet.png) and look at them critically. Serve on port 4265. npx tsc --noEmit and 'npx vitest run --dir <worktree>/src' must pass, and every reviewer playwright script must exit 0. Commit on ground-2. Return the branch, sha, worktree, a summary, the findings fixed (by id), the findings disputed with evidence, the re-measured budgets, and the screenshot paths.`,
  { label: 'fix:ground', phase: 'Fix', schema: FIX_SCHEMA, isolation: 'worktree' })
  if (fix) head = { branch: fix.branch, sha: fix.sha, worktree: fix.worktree }
}

const CONFIRM_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' }, summary: { type: 'string' },
    remaining: { type: 'array', items: { type: 'string' } },
    budgets: { type: 'string' }, sheet: { type: 'string' },
  },
  required: ['ok', 'summary', 'remaining', 'budgets', 'sheet'],
}

phase('Confirm')
let confirm = await agent(`${CONTEXT}
${BRIEF}
The final ground work is on local branch '${head.branch}' (commit ${head.sha}, worktree ${head.worktree}).${fix ? ' Fixer summary (do not trust it): ' + fix.summary + ' Disputed: ' + JSON.stringify(fix.disputed) : ''}
Review findings that were meant to be fixed: ${JSON.stringify(allFindings.map((f) => f.id + ' [' + f.severity + '] ' + f.title))}

YOU ARE THE FINAL, INDEPENDENT CHECK. In your own worktree check out ${head.sha} (detached is fine), serve on port 4266, and verify for yourself: tsc and the vitest run pass; every reviewer playwright script under ${SP}/pw/ground-review-* exits 0; each finding is really fixed (look at fresh screenshots yourself); every budget holds (texture samples per tier from the compiled shader, frame time old vs new per tier, draw calls, triangles, texture MB, paint and repaint times, no leaks); shimmer is no worse than the old ground; the stencil hole for cuttings still works; the main game still plays (build a road, grow the town with window.proto.growAll(), no console errors). Then build a final contact sheet at ${SP}/ground/final-sheet.png: before vs after, main game at Close/Mid/Far in town centre, town edge and countryside, plus the demo scenes. Do not change code. Return ok (true only if nothing blocker/major remains), a plain summary of how it looks and performs, what remains, the verified budgets, and the sheet path.`,
{ label: 'confirm:ground', phase: 'Confirm', schema: CONFIRM_SCHEMA, isolation: 'worktree' })

if (confirm && !confirm.ok && confirm.remaining.length) {
  const fix2 = await agent(`${CONTEXT}
${BRIEF}
The ground work is on local branch '${head.branch}' (commit ${head.sha}). A final independent check found these remaining problems:
${JSON.stringify(confirm.remaining, null, 1)}
Its measured budgets: ${confirm.budgets}
YOUR JOB: fix them all at the root. Work in your own worktree: git checkout -b ground-3 ${head.sha}. Serve on port 4267. Keep every budget, keep all tests passing (tsc, 'npx vitest run --dir <worktree>/src', every ${SP}/pw/ground-review-* script), refresh ${SP}/ground/after-*.png and ${SP}/ground/final-sheet.png and look at them. Commit on ground-3. Return the branch, sha, worktree, a summary, the items fixed, anything disputed with evidence, the budgets and screenshot paths.`,
  { label: 'fix2:ground', phase: 'Fix', schema: FIX_SCHEMA, isolation: 'worktree' })
  if (fix2) {
    head = { branch: fix2.branch, sha: fix2.sha, worktree: fix2.worktree }
    confirm = await agent(`${CONTEXT}
${BRIEF}
Re-check local branch '${head.branch}' (commit ${head.sha}) after a second fix round. Previously remaining: ${JSON.stringify(confirm.remaining)}. Fixer says (do not trust it): ${fix2.summary}
In your own worktree check out ${head.sha}, serve on port 4268, verify each item yourself, re-run tsc, 'npx vitest run --dir <worktree>/src' and every ${SP}/pw/ground-review-* script, re-measure the budgets, and refresh ${SP}/ground/final-sheet.png. Do not change code. Return ok, summary, remaining, budgets, sheet.`,
    { label: 'confirm2:ground', phase: 'Confirm', schema: CONFIRM_SCHEMA, isolation: 'worktree' })
  }
}

return { built, reviews: found, fix, head, confirm }