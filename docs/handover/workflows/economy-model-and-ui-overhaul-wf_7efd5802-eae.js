export const meta = {
  name: 'economy-model-and-ui-overhaul',
  description: 'In isolated worktrees: port the 2D economy to a 3D-engine model layer, and overhaul the UI (icons, branded HUD); review and fix each',
  phases: [
    { title: 'Build', detail: 'economy model layer + UI overhaul, each in its own worktree branch' },
    { title: 'Review', detail: 'adversarial review of each branch' },
    { title: 'Fix', detail: 'apply verified review findings on follow-up branches' },
  ],
}

const SP = args.sp
const ISO = `
ISOLATION RULES (important — other agents are editing /home/user/gamex right now):
- You are running in your own fresh git worktree (your current working directory). Work ONLY there. Never cd into or modify /home/user/gamex (the main checkout) and never touch other worktrees.
- First, in your worktree: run "git status" and "git log --oneline -3" to confirm where you are, then "npm install" (your worktree has no node_modules).
- When done, commit your work in your worktree on a NEW local branch named exactly as instructed (git checkout -b <branch>; git add -A; git commit). Commit message style: a short summary line, blank line, a few bullet lines, then these two trailer lines exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EDn6ScXmNn8wUEBAmG2GGU
- NEVER push. Never rebase or touch other branches. Report the branch name and the commit sha.
- Scratch files only under ${SP} (use a subfolder named after your role).
`
const COMMON = `
Project: a TypeScript + three.js transport/city game. Two versions live in the repo:
- The ORIGINAL 2D game: src/sim.ts (Game class: stations with catchments, lines and vehicles with loads, passengers generated at stations with a passenger line, freight chains coal->power station, wood->sawmill->goods, grain->food plant->goods, transfers, payments, deliveries give towns growth points (pax 1, cargo 3), towns grow/densify/push streets, industries raise production when >60% of output is collected), src/defs.ts (cargo, industries, stations, vehicles), src/scenarios.ts (challenges), src/save.ts, src/sim.test.ts (behaviour tests). Tile-grid based.
- The NEW 3D prototype in src/proto (entry main.ts, page proto.html, styles proto.css): free-form curved roads (roads.ts Network with nodes/segs/lots/plots, catalog.ts road types, xsection.ts tapers), land registry (land.ts), junction design (junction.ts, jshape.ts), drawing (roaddraw.ts), procedural buildings (buildgen.ts), leftover-land infill (infill.ts), traffic (traffic.ts: cars, buses, trains as visible agents), architecture doc docs/ENGINE.md (read it: authorities vs derived layers, "simulate flows, show agents", tiles/LOD for many-city maps).
The user plays on an Android phone (Pixel) in a claude.ai artifact page. Realism follows UK practice; we drive on the left. Comments are concise, plain UK English, explaining why; match surrounding code style.
Tooling: npx tsc --noEmit ; npx vitest run. Headless Chromium for UI checks: executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']; playwright-core is installed at ${SP}/pw/node_modules (import it via an absolute path or symlink that node_modules into your scratch folder). Example scripts: ${SP}/pw/edit.mjs (drives the junction editor), ${SP}/pw/over.mjs (screenshots at views), ${SP}/pw/sheet.mjs (contact sheets). Build with: npx vite build --outDir <your own dir under ${SP}> --emptyOutDir ; serve with npx vite preview --outDir <dir> --port <your port> --strictPort (background). Page: http://localhost:<port>/proto.html. View screenshots with the Read tool at phone size (viewport 412x915, deviceScaleFactor 2, isMobile, hasTouch).
`
const REPORT = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, sha: { type: 'string' },
    summary: { type: 'string' },
    files_changed: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'tests run and results, screenshot paths' },
    known_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'sha', 'summary', 'files_changed', 'evidence', 'known_issues'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      where: { type: 'string' }, detail: { type: 'string' }, evidence: { type: 'string' }, confirmed: { type: 'boolean' },
    }, required: ['title', 'severity', 'where', 'detail', 'evidence', 'confirmed'] } },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}

const ECON = `${ISO}${COMMON}
YOUR ROLE: economy model builder. Branch name: economy-model.
The user: "Town growth and shrinkage should be down to how well the towns are fed with materials and passengers (think Transport Fever 3) — not just a set growth speed." The 2D game already has most of the economy mechanics; port them into the 3D engine as a MODEL LAYER, and extend them.

Build NEW files only under src/proto (e.g. economy.ts, econdefs.ts, economy.test.ts; split as you see fit). Do NOT edit existing src/proto files (main.ts, traffic.ts, roads.ts etc. are being changed by others; integration into the live game happens later). You may read everything, including src/sim.ts, src/defs.ts, src/sim.test.ts.

Design requirements:
1. Pure, deterministic (seeded), renderer-free, testable in node. It runs on a GAME-TIME tick (e.g. each game minute / game hour, with a monthly review), never per frame. Its cost must scale with zones + stops + lines + vehicles, not with population ("simulate flows, show agents" from docs/ENGINE.md).
2. Inputs it is given (define clean interfaces; the live game will adapt to them later): towns as zones of buildings/plots (id, position, kind: house/terrace/flats/tower/shop/office/industry/civic, capacity: residents or jobs, occupancy); chain industries (coal mine, power station, forest, sawmill, farm, food plant … port from defs.ts) placed in the world; stops/stations (position, kind: bus stop, rail station, lorry/freight depot, with catchment radius); lines (ordered stops, vehicle type, number of vehicles); a travel-time oracle travelTime(fromStop, toStop, vehicleType) the game supplies from the road/rail network and congestion; and a car travel-time oracle between zones (for people who drive).
3. Mechanics to port (keep the 2D behaviour where sensible): passengers generated at stops served by passenger lines in proportion to catchment population, with destinations weighted by jobs/shops reachable; vehicles operate lines mesoscopically (time along route from the oracle, dwell, capacity, load/unload, transfers); freight chains with production, collection by freight lines, conversion at processors, delivery of goods to towns; payments per delivery (distance/time based like the 2D game) and running costs; industry production up when well collected, down when not.
4. Extend it, Transport Fever style:
   - Accessibility-based demand. Homes grow when residents can reach jobs/shops/leisure in reasonable time (by car via the car oracle, or by your lines). Shops/offices grow with residents who can reach them, and shops also need goods supplied. Industry grows with inputs delivered and outputs collected.
   - GROWTH AND SHRINKAGE. Per town and per building class, demand vs capacity decides: grow (new plot or densify: house->terrace->flats), hold, or decline (vacancy rises; after sustained poor service buildings are abandoned, then demolished). Use hysteresis and sensible rates (towns change over game months), no runaway growth, no oscillation.
   - Explanations. Each town reports why it's growing, stalling or shrinking in plain words ("82% of residents reach work within 30 min", "shops only 40% supplied with goods", "no bus or rail service"), plus numbers for a town panel.
   - Outputs the game needs: per-tick actions (addBuilding(zone, kind) / densify(building) / vacate(building, fraction) / abandon(building) / demolish(building)), money events, per-line stats (load factor, profit), per-stop waiting counts, and vehicle positions along lines (for showing visible buses/trains/lorries).
5. Tests (economy.test.ts): port the relevant behaviours from src/sim.test.ts, and add: an unserved town stagnates, then declines and shrinks; a well-served town grows and densifies; supplying goods raises shop demand; collecting output raises industry production; cutting a line makes a town decline after a delay (hysteresis, not instantly); determinism (same seed, same result); a scale test (e.g. 50 towns, 500 stops, 200 lines, 1000 vehicles: a simulated game-month runs in well under a second).
6. Append a short section to docs/ENGINE.md describing the economy layer and how the live game will plug into it (that's the only existing file you may edit).
Return REPORT.`

const UI = `${ISO}${COMMON}
YOUR ROLE: UI overhaul builder. Branch name: ui-overhaul. Serve previews on port 4211 only.
The user: "The emoji buttons look tacky, would be better as an icon set (use an established library please)... The black rounded boxes are a little basic, would like more of a branded HUD... new name: 'Untitled'." Brand inspiration: the user's Rock Face deodorant bottle (photo: /root/.claude/uploads/77896564-364e-5bd3-afef-740e87f2acff/a159f9cd-image.png — view it with Read). Take the LOOK only: deep forest green (#1f5e3f-ish), mid green, bright lime accent (#5cb83a-ish) as tabs/bars, white, a thin gold/tan rule, faceted low-poly mountain/ridge shapes, a heavy geometric sans (Futura-like, e.g. League Spartan) for headings with small-caps labels on lime tabs. Colour variants per mode like their range: green = roads, blue = rail, orange = stops. Do NOT copy their wordmark, logo, or the peak-shaped letter A; the name is "Untitled" (working title) with our own simple original mark.

Files you may edit: src/proto/main.ts (UI parts only: the HUD/dock/panels/buttons markup and wiring, stats line, hints; do NOT change simulation, road-building, junction or traffic logic beyond what UI needs), src/proto/proto.css, proto.html, package.json/package-lock.json (dependencies), new files like src/proto/ui/*.ts. Do NOT edit traffic.ts, roaddraw.ts, roads.ts, jshape.ts, junction.ts, buildgen.ts, xsection.ts.

Do:
1. Icons: use Tabler Icons (MIT) — npm install @tabler/icons, import only the SVGs you use (e.g. import x from '@tabler/icons/icons/outline/road.svg?raw') so it's bundled and works offline. Replace EVERY emoji in the prototype UI (tools dock, road-type chips, grade/height/crossing controls, compass/rotate/map buttons, stats line, panels: blueprint, junction editor, stop planner, road picker filters, vehicles panel, hints, demolition warnings). grep src/proto/main.ts for emoji to be sure none remain; icons must be crisp at 1x/2x/3x, have accessible labels, and tap targets >= 44px.
2. Fonts: bundle via @fontsource (e.g. @fontsource/league-spartan for display, and a clean readable UI face such as @fontsource/inter or @fontsource/archivo) — no remote font loading needed. Keep total added weight modest (subset/latin, only the weights used).
3. Branded HUD: replace the plain black rounded boxes with a coherent design system (CSS custom properties for colours/spacing/type): faceted panel shapes (clip-path polygons or SVG), lime tabs for section labels, a thin gold rule, the mode colour variants, a proper header wordmark "Untitled" with a small original ridge mark. Keep the 3D view uncluttered on a phone: compact, legible over the map (contrast), respects safe areas, no horizontal scroll, the side panel still aligns with the road as before (focusOn logic stays). Include a game-speed control (pause, 1x, 2x, 4x) in the HUD: it scales the game clock (GAME_MIN_PER_S in main.ts) and growth; if you also scale traffic, sub-step traffic.update so each step stays <= 1/30 s.
4. Verify at phone size (412x915 @2x) with screenshots of: the default view, Road mode with road-type chips and grade row, the road picker panel, a junction editor panel (tap a junction in Road mode; see ${SP}/pw/edit.mjs), the stop planner, the vehicles panel, a road blueprint with a demolition warning, the perf readout. Check nothing overlaps, text is legible over bright and dark map areas, no console errors. Contact sheet at ${SP}/ui/sheet.png.
Return REPORT (evidence must list the screenshot paths).`

phase('Build')
const [econ, ui] = await parallel([
  () => agent(ECON, { label: 'build:economy-model', phase: 'Build', schema: REPORT, isolation: 'worktree' }),
  () => agent(UI, { label: 'build:ui-overhaul', phase: 'Build', schema: REPORT, isolation: 'worktree' }),
])
log(`economy: ${econ?.branch} ${econ?.sha} — ${econ?.summary?.slice(0, 160)}`)
log(`ui: ${ui?.branch} ${ui?.sha} — ${ui?.summary?.slice(0, 160)}`)

phase('Review')
const [econRev, uiRev] = await parallel([
  () => econ ? agent(`${ISO.replace('commit your work in your worktree on a NEW local branch named exactly as instructed (git checkout -b <branch>; git add -A; git commit)', 'you may commit tests on a NEW local branch economy-review based on economy-model (git checkout -b economy-review economy-model)')}${COMMON}
YOUR ROLE: adversarial economy reviewer. The builder's report: ${JSON.stringify(econ)}. In your worktree run: git checkout -b economy-review ${econ.branch} (that branch holds the builder's commit), npm install, npx vitest run.
Try hard to break the model: runaway growth or collapse; oscillation (grow/shrink/grow); exploits (e.g. a 1-stop line, a line between adjacent stops, circular transfers farming payments, duplicate lines); towns growing with no service at all; shrinkage that's instant or never happens; ports that lost 2D behaviour (compare with src/sim.ts and src/sim.test.ts); non-determinism; scaling cost that grows with population; interfaces the live 3D game can't actually supply (compare with src/proto/roads.ts lots/plots, traffic.ts buses/trains, stops on roads); unclear or wrong town explanations. For each suspected issue write a focused failing test in src/proto/economy.review.test.ts and mark confirmed=true only if it fails for the stated reason. Commit that test file on economy-review (it may fail — that's the point). Return FINDINGS.`, { label: 'review:economy', phase: 'Review', schema: FINDINGS, isolation: 'worktree' }) : null,
  () => ui ? agent(`${ISO}${COMMON}
YOUR ROLE: adversarial UI reviewer (read-only on source; don't commit anything). The builder's report: ${JSON.stringify(ui)}. In your worktree: git checkout ${ui.branch}, npm install, build to ${SP}/uirev/build and serve on port 4212. At phone size (412x915 @2x, isMobile, hasTouch) and also 360x780 and a landscape 915x412, exercise every UI flow: all tools, road-type chips and More picker with filters, grade/height/crossing controls, drawing a road (drag) and its blueprint panel incl. demolition warning, junction editor (tap a junction in Road mode), stop planner, vehicles panel, perf readout, game speed control. Check: any emoji left (grep the source too), icons from Tabler actually rendering (not blank boxes), tap targets >= 44px, text contrast over bright/dark map, overlaps/clipping, safe areas, the side panel still aligns the road, console errors, bundle weight added (fonts/icons), that nothing copies the Rock Face wordmark/logo, and that the look is coherent and genuinely branded rather than generic. Screenshots under ${SP}/uirev/. Mark confirmed=true only with a screenshot or grep as evidence. Return FINDINGS.`, { label: 'review:ui', phase: 'Review', schema: FINDINGS, isolation: 'worktree' }) : null,
])

phase('Fix')
const conf = (r) => (r?.findings ?? []).filter((f) => f.confirmed)
const [econFix, uiFix] = await parallel([
  () => econ && conf(econRev).length ? agent(`${ISO}${COMMON}
YOUR ROLE: economy fixer. Branch name: economy-model-2. In your worktree: git checkout -b economy-model-2 economy-review (it contains the builder's work plus the reviewer's failing tests in src/proto/economy.review.test.ts), npm install.
Confirmed findings: ${JSON.stringify(conf(econRev))}. Reviewer verdict: ${econRev?.verdict}.
Fix the root cause of each (in the new economy files only), make every test pass (including the review tests; if a review test itself is wrong, fix the test and explain why), keep the scale test fast. Commit on economy-model-2. Return REPORT.`, { label: 'fix:economy', phase: 'Fix', schema: REPORT, isolation: 'worktree' }) : null,
  () => ui && conf(uiRev).length ? agent(`${ISO}${COMMON}
YOUR ROLE: UI fixer. Branch name: ui-overhaul-2. Serve previews on port 4213 only. In your worktree: git checkout -b ui-overhaul-2 ${ui.branch}, npm install.
Confirmed findings: ${JSON.stringify(conf(uiRev))}. Reviewer verdict: ${uiRev?.verdict}. Same file rules as the UI builder: src/proto/main.ts UI parts only, proto.css, proto.html, package files, src/proto/ui/*. Fix each finding; re-take the screenshots that showed it and show it fixed; update the contact sheet at ${SP}/ui/sheet-2.png. Commit on ui-overhaul-2. Return REPORT.`, { label: 'fix:ui', phase: 'Fix', schema: REPORT, isolation: 'worktree' }) : null,
])

return { econ, econRev, econFix, ui, uiRev, uiFix }
