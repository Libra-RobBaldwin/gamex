export const meta = {
  name: 'roads-and-traffic-realism',
  description: 'Fix road joins/dual-to-single tapers and make traffic collision-free, then adversarially verify and fix',
  phases: [
    { title: 'Build', detail: 'road geometry builder + traffic builder in parallel (disjoint files)' },
    { title: 'Verify', detail: 'traffic refuter, in-browser collision measurement, visual join audit' },
    { title: 'Fix', detail: 'address verified findings per area' },
    { title: 'Confirm', detail: 'final measurement and checks' },
  ],
}

const SP = args.sp
const COMMON = `
Project: "Tracks & Towns", a TypeScript + three.js 3D transport/city prototype. Repo /home/user/gamex; the prototype lives in src/proto (entry src/proto/main.ts, page proto.html). The user plays it on an Android phone; realism is judged against UK / European road practice (Manual for Streets, DMRB, UK road markings). We drive on the LEFT.

Key modules (read what you need):
- roads.ts: Network (nodes, segs, lots), build/check/split, claimSeg (land claims per road), plotsFor. segsAt(n) is O(all segs) — never call it per car per frame.
- catalog.ts: RoadDef (lanes per side, lane width, median, medianKind, bus/cycle/parking/shoulder, pave/verge, mph, speed), kerbOf/halfOf.
- xsection.ts: THE CONTRACT for tapers where two roads of different kinds meet end to end (e.g. dual carriageway -> street). taperOf(net, seg), sectionAt(net, seg, t) (cross-section anywhere along a road), laneSpan(net, seg, fromNode, lane) (where a general lane is usable in a travel direction; lane 0 = nearside, offside lanes drop first). Its API and the meaning of laneSpan are FROZEN: the road builder draws exactly this taper and traffic obeys exactly this laneSpan. Tests in xsection.test.ts.
- standards.ts: design reference numbers (corner radii, slip lanes, roundabout sizes, taperLength).
- land.ts: land registry (claims, spatial hash). jshape.ts: junction shapes (apron, pave, islands, slip, mouths, stop lines). junction.ts: junction designer (forms: join, merge, priority, signals, mini, roundabout; lanes; flows; j.reach = stop line distances; j.shape; j.slip).
- roaddraw.ts: draws roads (section(), endsOf(), Flat/Solid builders, drawRoads) and junctions from shapes.
- traffic.ts: cars, lorries, buses, trains. Car = {seg, from, s (metres from 'from'), lane, off, v, route, turn?...}; update(dt, now); turnPath; mayEnter; enter; draw (instanced meshes).
- main.ts: seed town (seedTown), commitRoads pipeline, UI; window.proto exposes net, junctions, traffic, view {x,z,h,el,az}, buildRoad(a,b,type), growAll(), setTier(i), rebuild().

Tooling:
- Type check: cd /home/user/gamex && npx tsc --noEmit. Tests: npx vitest run (vitest; test files src/proto/*.test.ts).
- Browser checks: build into YOUR OWN outDir and serve on YOUR OWN port (other agents run concurrently): npx vite build --outDir <dir> --emptyOutDir ; then npx vite preview --outDir <dir> --port <port> --strictPort (run in background). Page: http://localhost:<port>/proto.html.
- Headless Chromium: executablePath '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']. playwright-core is installed in ${SP}/pw/node_modules — put your .mjs scripts in ${SP}/pw (or a subfolder with a symlink to that node_modules). Examples to copy from: ${SP}/pw/audit.mjs (top-down junction screenshots; env H, EL, ALL), ${SP}/pw/joins.mjs (lists every node and screenshots 2-leg/dead-end nodes), ${SP}/pw/sheet.mjs (contact sheet: node sheet.mjs out.png a.png b.png ...), ${SP}/pw/flow2.mjs. Software rendering is slow (~3-6 fps) — for simulation checks, drive traffic.update(dt, now) yourself inside page.evaluate in a loop rather than waiting on real frames. Set view.az: 0 for comparable top-down shots. View screenshots with the Read tool.
- Write scratch files only under ${SP} (scratchpad). Do NOT git commit, push, or touch git state. Do NOT edit files outside your ownership list. Match the surrounding code style: concise, comments explaining why in plain UK English, same naming idioms.
- Before finishing: npx tsc --noEmit must pass and npx vitest run must pass for your own tests (report any failures in other agents' areas without fixing them).
`

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'what you changed and why, concisely' },
    files_changed: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', description: 'measurements, test names, screenshot paths proving it works' },
    known_issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'files_changed', 'evidence', 'known_issues'],
}

const ROADS_BRIEF = `${COMMON}
YOUR ROLE: road geometry builder. The user says: "Roads still don't join up properly — and where a dual carriage turns into a single, the shape isn't right — needs to be realistic." Their phone screenshot showed the seed-town bypass dual carriageway meeting a street at node (110,110): the dual just stops at a bend, a round pavement blob covers the joint, the central reservation ends square, no taper, no lane drop. Same at (170,-98). Dead ends are round caps, including the motorway/dual at the map edge (±510). Top-down shots of these are ${SP}/jn-38.png, jn-11.png, jn-63.png, jn-66.png, jn-1.png, jn-4.png.

YOUR FILES (you may edit): roaddraw.ts, roads.ts (claimSeg and anything purely geometric; do not change build/check semantics beyond what joins need), jshape.ts, standards.ts (add numbers), land.ts, main.ts ONLY the seedTown road list if a seed road is itself badly placed, new test files (e.g. joins.test.ts). NOT traffic.ts, NOT junction.ts' design logic, NOT xsection.ts's API/semantics (you may add new exports to xsection.ts).

DO:
1. Tapers: where taperOf() reports a taper, draw the road from sectionAt() along its length: kerbs, footways/verges, asphalt all follow the varying widths; the opening reservation is a UK ghost island (diagonal hatching / chevrons inside solid-bounded edges, not a kerbed median), with the kerbed median beginning with a rounded nose where it reaches full width; the offside lane(s) taper away with the lane line converging, and UK 'lane ends' merge arrows (the bent diagonal arrows) on the ending lane before the taper for traffic heading into the narrower road; the opposite direction gains its lane. Lane lines, edge lines, centre line all continuous across the join into the narrower road. The land claim (claimSeg) must follow the varying width too.
2. Plain joins (2 legs, form 'join', including same-type bends and type changes at an angle): no blob. The joint should read as one continuous road: kerbs meet properly (inside of the bend: kerb lines meet; outside: a proper arc of the right radius), footways continuous, markings continuous (centre line and lane lines across the bend), median continuous for dual-to-dual bends. Use the same tolerance for straight-through joins (e.g. node (0,-200)) so there's no visible seam.
3. Dead ends: a street dead end may be a turning head, but a dual carriageway or motorway that runs to the edge of the map should look like it carries on off the map (e.g. run the seed roads to the map/ground edge, or end without a cap at the edge), never a hairpin loop in a field. Look for any other odd road end (e.g. the high street avenue ending at (-230,0) right beside the (-215,*) flyover) and make it sensible.
4. Audit every node in the seed town (joins.mjs lists them all) with top-down before/after screenshots, and also do the user's viewpoint (view {x:120,z:60,h:170,el:0.75,az:2.4} roughly matches their screenshot of the bypass). Fix every join defect you find. Make sure nothing regresses at junctions (roundabouts, priority Ts, signals + slip via the editor, mini).
5. Add unit tests for any new geometry (e.g. taper widths drawn match sectionAt at samples, claims widen with the taper, join kerbs have no gaps).
Return the report with screenshot paths of before/after for each defect you fixed.`

const TRAFFIC_BRIEF = `${COMMON}
YOUR ROLE: traffic builder. The user says: "Traffic isn't right, vehicles driving straight through each other." Make vehicles NEVER overlap, while traffic still flows (no gridlock) and it stays cheap enough for big maps.

YOUR FILES (you may edit): traffic.ts, new files you create (e.g. conflicts.ts, traffic.test.ts). NOT roads.ts, junction.ts, jshape.ts, roaddraw.ts, xsection.ts, main.ts (read them freely). If you truly need a one-line export added elsewhere, note it in known_issues instead of editing.

Scouted root causes (verify each, and find others):
- Car-following only looks for the car ahead in the same (seg, from, lane) bucket: a car at the end of one segment doesn't see the car just past a plain join, or queued on the exit lane after a junction, so it drives into it.
- Cars on a junction turn path (c.turn) aren't in any lane bucket and don't follow each other; two cars on the same or merging paths pass through each other; nothing checks the exit lane has room before entering (no 'don't block the box').
- Priority junctions: major-road traffic never yields, and minor-road cars only check cars already inside the junction, not major-road cars approaching — so they pull out in front and get driven through. Need gap acceptance (time-to-arrival of conflicting approaching vehicles) and a safety check for conflicting paths physically occupied.
- Signals: right turners vs oncoming is approximate; left/right paths from opposite approaches may cross; amber/red handling; cars inside when phase changes.
- Roundabouts: circulating cars don't follow each other; entry uses coarse sectors; entry should accept gaps in circulating traffic arriving from the right (upstream), and circulating cars must never pass through each other.
- Slip lanes: cars on a slip merge into the exit road without checking it.
- Lane changes check only +-12 m in the target lane; need proper gap checks ahead and behind accounting for speed.
- Lane drops/gains where a dual becomes single: use xsection.laneSpan(net, seg, from, lane) — cars in a lane that ends must merge (zip, with gap checks) before it ends; a lane that only opens later can't be used before it opens; at the node lanes map by index (0 = nearside).
- Speed/decel limits must guarantee stopping behind a stopped leader (use a proper car-following law, e.g. IDM-like, with the lookahead crossing segment and junction boundaries along the car's route).
- Spawning must not place a vehicle on top of another.
- Buses pulling in/out of stops and lay-bys; lorries are longer (13 m vs 7).
- Hot-path cost: legsAt()/segsAt() are O(segs) and are called per car per frame; cache per node (invalidate when the network changes — there's an invalidate() hook) and use lane/segment indexes, not all-pairs.
Also opposite-direction vehicles on single-carriageway roads must not overlap (lane offsets), and turning vehicles crossing the opposite lane must not clip oncoming ones.

HOW:
1. First build a measurement: a function that computes each vehicle's world-space footprint exactly as drawn (same position/heading/offset logic as draw()) and counts overlapping pairs (oriented rectangles, small tolerance e.g. 0.3 m). Expose it (e.g. traffic.poses() / traffic.overlaps()) so the browser can use it too.
2. Write a vitest harness (traffic.test.ts) that builds networks covering: roundabout (single and dual-lane approaches), priority T, signals with a slip lane, mini-roundabout, dual-carriageway-to-street taper join, plain bend join, a long multi-lane road with lane changes; designs junctions with junction.design (see junction.test.ts / land.test.ts for how), constructs Traffic with a THREE.Scene, feeds it demand (you can call generate() with fake Places built from lots, or spawn deterministically), steps update() for several simulated minutes at heavy demand, and asserts: zero overlaps at every sample; vehicles complete trips (throughput > some floor) and few give-ups (wait timeouts). Measure BEFORE your changes to confirm the harness catches the bug (record the before counts), then fix until zero.
3. Also measure in the real seed town in the browser (build your own outDir/port; drive traffic.update in page.evaluate for ~3 simulated minutes at the busiest level) — report overlaps before/after, throughput, and update() cost per frame.
Return the report with before/after overlap counts per scenario.`

phase('Build')
const [roads, traffic] = await parallel([
  () => agent(ROADS_BRIEF, { label: 'build:roads', phase: 'Build', schema: REPORT }),
  () => agent(TRAFFIC_BRIEF, { label: 'build:traffic', phase: 'Build', schema: REPORT }),
])
log(`Roads: ${roads?.summary?.slice(0, 200) ?? 'no report'}`)
log(`Traffic: ${traffic?.summary?.slice(0, 200) ?? 'no report'}`)

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string', enum: ['traffic', 'roads'] },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string', description: 'file:line or map location / node' },
          scenario: { type: 'string', description: 'concrete reproduction: inputs, what happens, what should happen' },
          evidence: { type: 'string', description: 'failing test name, measurement, or screenshot path' },
          reproduced: { type: 'boolean' },
        },
        required: ['area', 'title', 'severity', 'where', 'scenario', 'evidence', 'reproduced'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings', 'notes'],
}

const built = `Builders' reports:\nROADS: ${JSON.stringify(roads)}\nTRAFFIC: ${JSON.stringify(traffic)}\nThe working tree now contains both builders' uncommitted changes (git diff shows them; the baseline commit is c581fc3).`

phase('Verify')
const verdicts = await parallel([
  () => agent(`${COMMON}\n${built}\nYOUR ROLE: adversarial traffic reviewer. Read the traffic changes (git diff c581fc3 -- src/proto/traffic.ts and any new traffic files) and try hard to find every remaining way two vehicles can overlap, pass through each other, or deadlock/gridlock (e.g. a car entering a junction whose exit is full, a roundabout where every entry waits for the next, lane drop with a queue alongside, signals changing while cars are inside, buses leaving lay-bys, spawns, very short segments shorter than a car, a segment deleted or split while cars are on it, cars on a turn when the junction is redesigned, a car whose route ends mid-junction). For each suspected issue, try to REPRODUCE it by writing a focused failing vitest case in a new file src/proto/traffic.refute.test.ts (you own only that file; do not edit traffic.ts). Report only real, reproduced issues as reproduced=true; list unreproduced suspicions with reproduced=false and why. Default to skepticism about the builder's claims — re-run their harness yourself.`, { label: 'verify:traffic-refuter', phase: 'Verify', schema: FINDINGS }),
  () => agent(`${COMMON}\n${built}\nYOUR ROLE: in-browser collision and flow measurement on the real seed town. Build into ${SP}/vbuild and serve on port 4181. Using the builder's overlap measurement (or your own if absent — compute footprints exactly as drawn), drive traffic for at least 5 simulated minutes at the 'Busy' level (see LEVELS in main.ts; you can call traffic.generate/update yourself inside page.evaluate), sampling overlaps every 0.2 s of sim time. Then repeat after player actions: proto.buildRoad a new crossroads through town (e.g. {x:-60,z:-90} to {x:-60,z:90}), a new dual carriageway ending into a street, and switching a roundabout to signals with a slip in the junction editor (see ${SP}/pw/edit.mjs for how the editor is driven). Report every overlap: location (world x,z, which node/segment, which movement), vehicle kinds, and take a close top-down screenshot of the worst ones at the moment they happen (pause by not stepping). Also report throughput (trips completed per sim minute), give-ups, and average/worst traffic.update() cost in ms. Report each defect as a finding with reproduced=true when observed. You own no source files — do not edit src.`, { label: 'verify:collisions-in-town', phase: 'Verify', schema: FINDINGS }),
  () => agent(`${COMMON}\n${built}\nYOUR ROLE: visual realism auditor for road joins and junctions, judged against UK practice. Build into ${SP}/abuild and serve on port 4182. Screenshot, top-down (el 1.5, az 0, h 70-110) and oblique (el 0.8, varying az), EVERY node in the seed town (joins.mjs lists them) plus the user's viewpoint {x:120,z:60,h:170,el:0.75,az:2.4}, plus a new dual->street join you build with proto.buildRoad, plus a signals+slip junction set via the editor (${SP}/pw/edit.mjs). Look closely (use contact sheets and zoomed crops) for: gaps or overlaps in kerbs/footways, blobs, markings running through islands/reservations/footways, markings missing where they should continue, wrong hatch/chevron/lane-drop markings, wrong side (we drive on the left), buildings/trees/parks on roads, roads that don't meet, z-fighting/flicker, abrupt width changes, dead ends that look wrong. Compare against the before shots in ${SP}/jn-*.png and ${SP}/au-d-*.png. Report each defect with a screenshot path and exact location. You own no source files — do not edit src.`, { label: 'verify:visual-audit', phase: 'Verify', schema: FINDINGS }),
])

const all = verdicts.filter(Boolean).flatMap((v) => v.findings || [])
const real = all.filter((f) => f.reproduced && f.severity !== 'low')
const lows = all.filter((f) => f.reproduced && f.severity === 'low')
log(`Verify: ${all.length} findings, ${real.length} reproduced medium/high, ${lows.length} reproduced low, ${all.length - real.length - lows.length} unreproduced`)

phase('Fix')
const byArea = (a) => [...real, ...lows].filter((f) => f.area === a)
const fixBrief = (area, files) => `${COMMON}\n${built}\nYOUR ROLE: fixer for the ${area} area. Verified findings to fix (reproduced by independent verifiers):\n${JSON.stringify(byArea(area), null, 1)}\nAll verifier notes: ${JSON.stringify(verdicts.filter(Boolean).map((v) => v.notes))}\nYOUR FILES: ${files}. Fix the root cause of every medium/high finding, and the low ones where cheap. For each, re-run the reproduction (failing test in src/proto/traffic.refute.test.ts, the in-browser measurement, or a screenshot) and show it now passes. Keep all existing tests green. Report per finding: fixed or not and the evidence.`
const fixes = await parallel([
  () => (byArea('traffic').length ? agent(fixBrief('traffic', 'traffic.ts, conflicts.ts or other new traffic files, traffic.test.ts, traffic.refute.test.ts'), { label: 'fix:traffic', phase: 'Fix', schema: REPORT }) : Promise.resolve({ summary: 'no traffic findings', files_changed: [], evidence: '', known_issues: [] })),
  () => (byArea('roads').length ? agent(fixBrief('roads', 'roaddraw.ts, roads.ts (geometry/claims), jshape.ts, standards.ts, land.ts, xsection.ts (new exports only), main.ts seedTown road list only, road test files'), { label: 'fix:roads', phase: 'Fix', schema: REPORT }) : Promise.resolve({ summary: 'no road findings', files_changed: [], evidence: '', known_issues: [] })),
])

phase('Confirm')
const confirm = await agent(`${COMMON}\n${built}\nFix reports: ${JSON.stringify(fixes)}\nYOUR ROLE: final independent confirmation. 1) npx tsc --noEmit and npx vitest run — report exact results. 2) Build into ${SP}/cbuild, serve on port 4183, run the seed town for 5 simulated minutes at 'Busy' plus the player-action scenarios (new crossroads, new dual->street join); report overlap count (must be 0), throughput, give-ups, update() cost. 3) Take final screenshots: the user's viewpoint {x:120,z:60,h:170,el:0.75,az:2.4}, top-down of nodes (110,110) and (170,-98), a roundabout and a signals junction with cars on them; build a contact sheet at ${SP}/final-sheet.png. 4) List anything still wrong, honestly. Do not edit src.`, { label: 'confirm', phase: 'Confirm', schema: REPORT })

return { roads, traffic, findings: all, fixes, confirm }
