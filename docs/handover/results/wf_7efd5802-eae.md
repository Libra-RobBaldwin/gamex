## a5cddc5372833ea2e

```json
{
 "branch": "ui-overhaul",
 "sha": "fd0d1a0abb02c9763adb57a38aa64e70e5afb786",
 "summary": "The prototype's HUD now uses the \"Untitled\" brand, and there are no emoji left in the UI. It's committed on branch ui-overhaul in the worktree /home/user/gamex/.claude/worktrees/wf_7efd5802-eae-2 and has not been pushed. tsc passes, all 60 vitest tests pass, and the phone-size screenshot pass (412x915 at 2x) found no overlaps, no horizontal scroll, no buttons under 44 px and no console errors.\n\nIcons: every emoji is now a Tabler icon (MIT). Each SVG is imported on its own as raw text, so only those icons are bundled and the page works offline. This covers the tools dock, the shape, road-type and rail chips, the height, gradient and crossing controls, the rotate and top-down buttons, the stats line, the hints, the blueprint and demolition warning, and the road picker, vehicles, junction and stop panels. Icons are sized from the surrounding text and hidden from screen readers; icon-only buttons carry aria-labels. Junction forms get their own icons: an inverted give-way triangle, traffic lights, and a roundabout arrow that goes round clockwise, as in the UK. The compass is now a two-tone red/white needle I drew myself (so not from Tabler), because the plain arrow was hard to read as north.\n\nFonts: League Spartan 700 for the wordmark, headings and tabs, and Archivo 400/600/700 for everything else, both from @fontsource. Only the Latin subset in woff2 is bundled, about 56 kB in all. The Google Fonts link is gone.\n\nDesign: proto.css is rewritten around CSS custom properties for colours, type and sizes. Panels have faceted cut corners, section labels sit on slanted lime tabs, headers have a thin gold rule, and a faint low-poly ridge sits behind headings. The whole HUD changes colour with the mode: green for roads and Look, blue for rail, orange for stops. The stop planner is orange; the vehicles panel stays green whatever the mode.\n\nHeader: the \"UNTITLED\" wordmark with our own mark (a lime tile with one corner cut, a two-peak faceted ridge and a white road along its foot; nothing taken from Rock Face). Next to it is the speed control (pause, 1x, 2x, 4x). Below is the stats line: clock with AM peak / PM peak / night / paused, cars, buses, trains, population. Tapping it still opens the performance readout.\n\nGame speed: it scales the game clock (GAME_MIN_PER_S), the town's growth and the traffic together. At 1x traffic steps exactly as before. Faster than 1x it is split into steps of 1/30 s or less. Paused, traffic and signals freeze but you can still build.\n- Traffic runs on its own time base that never falls behind real time. traffic.ts stamps some cars with performance.now(), so a lagging clock would have left stranded cars on screen.\n- Measured: the clock stood still when paused and moved about 3.7 to 5 times as far at 4x as at 1x (headless timing is rough).\n- In the slow headless renderer, simulation cost was about 1.6 ms per frame at 1x and 12.8 ms at 4x. That is the worst case (12 sub-steps a frame); at 60 fps on a phone, 4x needs only 2.\n\nOther UI changes:\n- Mode, type and shape rows are now one build drawer with a vertical ROAD/RAIL tab.\n- Hints can run to two lines and take an icon.\n- The road picker says so when no road type matches the filters.\n- The stop panel's \"Can't put a stop here\" reason used to sit inside the title; it is now in the panel body.\n- An inline SVG favicon of the mark stops a favicon 404.\n- #top, #px, #g-*, #bp, #bpb/#bpc and the data-* selectors that other scripts use are unchanged.\n- The panel width and focusOn logic are untouched, so the side panel still lines up with the road.\n\nFiles changed: src/proto/main.ts (UI parts only), src/proto/proto.css, proto.html, package.json and package-lock.json, plus new src/proto/ui/icons.ts, fonts.ts and brand.ts. I did not touch traffic.ts, roaddraw.ts, roads.ts, jshape.ts, junction.ts, buildgen.ts, xsection.ts or catalog.ts.",
 "files_changed": [
  "src/proto/main.ts",
  "src/proto/proto.css",
  "proto.html",
  "package.json",
  "package-lock.json",
  "src/proto/ui/icons.ts",
  "src/proto/ui/fonts.ts",
  "src/proto/ui/brand.ts"
 ],
 "evidence": "Commands:\n- npx tsc --noEmit: clean.\n- npx vitest run: 7 files, 60 tests passed.\n- npx vite build: builds; adds four woff2 fonts (12.9 + 14.7 + 13.8 + 14.5 kB). Build output: /tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/ui/dist, served on port 4211.\n\nEmoji checks: a grep for emoji and symbol code points (U+2190-2BFF, U+1F000-1FAFF, FE0F, U+3000-303F, U+FF00-FFEF, U+2300-23FF) over src/proto/main.ts, src/proto/ui/*.ts and proto.css finds nothing. The in-page check of #ui innerText also found none in every state.\n\nUI check script /tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/ui/shots.mjs runs at 412x915, deviceScaleFactor 2, isMobile, hasTouch. It checks:\n- no horizontal scroll\n- no overlaps between #info, #card, #side, #panel, #hint, #bp, #build and #tools\n- nothing off screen\n- every visible button at least 44x44 (the stats line is 36 px tall and its hit area is extended by 8 px)\n- icon-only buttons have names\n- no text spilling out of its box\n- no emoji\n\nResult: all 11 states \"ok\"; \"errors none\". The only console warning is THREE \"toNonIndexed(): BufferGeometry is already non-indexed\" from the building code; I didn't touch that code, but I didn't check it against the old build. After the favicon was added, no HTTP 404s.\n\nSpeed check (clock over 2 s): 0x 08:51 -> 08:51, 1x 08:51 -> 08:54, 4x 08:55 -> 09:12.\n\nSpeed cost (/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/ui/speed.mjs), in simulation ms per frame: 1x 1.6, 2x 6.8, 4x 12.8, paused 0.3.\n\nScreenshots (/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/ui/):\n- 01-default.png: default view\n- 02-road.png: Road mode with road-type chips and the grade row\n- 03-rail.png: Rail mode in blue\n- 04-picker.png: road picker\n- 05-picker-filtered.png: road picker with with/without filters and a kind\n- 06-junction.png: junction editor on a roundabout\n- 07-blueprint-demolish.png: road blueprint with the demolition warning (\"Demolish 4 & build\")\n- 08-stop.png: stop planner in orange\n- 09-vehicles.png: vehicles panel\n- 10-perf-paused.png: performance readout while paused\n- 11-bright-card.png: building card over the bright lake and beach, top-down at 4x\n\nClose-ups at 1x, 2x and 3x pixel density (crispness): z-info-1x.png, z-info-2x.png, z-info-3x.png, z-side-1x.png, z-side-2x.png, z-side-3x.png, z-dock-1x.png, z-dock-2x.png, z-dock-3x.png.\n\nContact sheet: /tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/ui/sheet.png\n\nOther helper scripts: zoom.mjs, sheet.mjs, speed.mjs (all in the same folder).",
 "known_issues": [
  "catalog.ts still has emoji in its RoadDef.icon and TrainDef.icon fields. The UI no longer shows them (src/proto/ui/icons.ts maps road family, rail id and train id to Tabler icons instead). I left catalog.ts alone because it isn't a file I was cleared to edit; whoever owns it can drop those fields.",
  "The header, with the speed control, is hidden while a side panel is open, as the old info box was. The speed setting stays in force.",
  "In the road picker, filter rows that don't fit the 230 px panel at 44 px per chip wrap onto a second line (for example lanes 'Any 1 2 3' then '4'). I kept the 44 px tap size rather than shrink the chips.",
  "The blueprint's Cancel and 'Demolish N & build' buttons drop to a second line when the demolition label is long. That is by design (they right-align) but it makes the blueprint panel taller.",
  "Speed figures come from headless SwiftShader at about 6 fps, where frame time is capped at 0.1 s, so the absolute clock rates are low; the ratios between speeds are what matter. On a phone at 60 fps, 4x needs 2 traffic sub-steps a frame. traffic.update also redraws the vehicles at every sub-step (I can't change that in traffic.ts), so 4x costs about twice as much as 1x per frame.",
  "main.ts is being edited by other streams, so expect merge conflicts in the UI section (the HUD markup, openPanel's new signature openPanel(kind, title, icon, body), hint(text, icon)) and in the frame loop's clock/traffic block."
 ]
}
```

## a0e0df19502f44f4e

```json
{
 "branch": "economy-model",
 "sha": "9294af48bde6570689be8b112659c0043ce49526",
 "summary": "I built the economy as a model layer for the 3D prototype. Towns now grow and shrink according to how well they are fed with goods, building materials and passengers, and how easily their people can reach work, shops and leisure; there is no fixed growth speed. All new code is under src/proto. The only existing file touched is docs/ENGINE.md, which gets an \"economy layer\" section. Nothing is wired into the live game yet, and I didn't run or look at the 3D page (no UI changed).\n\nFiles:\n- `/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/econdefs.ts`: reference data (cargo, industries, stops, vehicles, building sizes), tuning, and the contracts with the game. The game hands in towns, zones of buildings, industries, stops, lines, and two travel-time functions (vehicle stop-to-stop, car zone-to-zone). It gets back build/densify/vacate/abandon/restore/demolish actions, money and news events, and per-town, per-line and per-stop reports.\n- `.../src/proto/econlines.ts`: each line is simulated as a flow rather than as individual vehicles. Every hour, its fleet's capacity goes round the loop: people get off (or change lines), then others get on. Cycle time comes from the game's journey times plus dwell, and dwell grows with crowds. Freight works the same way. Vehicle positions and loads are worked out when the game asks, for drawing buses, trains and lorries.\n- `.../src/proto/econaccess.ts`: transit journey times between stops, door-to-door times between zones (walk, car, your lines), reach with competition (a job reached by many workers is shared among them), and trips spread over destinations and modes, then loaded onto lines.\n- `.../src/proto/econtowns.ts`: monthly demand per town and building use. Homes follow reach, shops need goods, offices need passengers arriving, works need materials. Towns build or densify after 2 months of excess demand and abandon the emptiest buildings after 3 months of low demand, clearing them 6 months later. A check on lumpy buildings prevents build/abandon cycles. Also writes the plain-English status and reasons.\n- `.../src/proto/economy.ts`: the `Economy` class (setup, `advance(minutes)`, reviews, the ported 2D industry rules, save/load, performance timings).\n- `.../src/proto/econkit.ts`: builds synthetic worlds with simple travel-time functions; used by the tests.\n\nHow it behaves in the tests:\n- An unserved balanced town holds for a month, stalls in months 2\u20133, then declines and settles about a third smaller after roughly 20 months, with buildings abandoned and later cleared. Its reasons include \"no bus or rail service\" and \"shops only 67% supplied with goods\".\n- A well-served town grows by about half and builds flats, then settles as \"Stable\" with reasons such as \"nowhere left to build offices\".\n- When a commuter town loses its railway, nobody leaves in the first month and no homes are abandoned for two months; after that it declines steeply.\n- 50 towns, 500 stops, 200 lines and 1,000 vehicles run a game month in about 0.25 s in node (the test limit is 1 s).\n\nDecisions for you:\n- **Starting balance.** Towns are treated as in balance when the map is made (calibration only lifts a town that starts short, never scales one down). An unserved town settles about 34% smaller. This is set by the \"what a town finds for itself\" shares in `TUNE.local`; raise them for gentler shrinkage.\n- **Calendar.** A review \"month\" defaults to 30 game days, which is about 3 real hours at the prototype's clock. Setting `monthDays` to 1 makes towns change every game day (6 real minutes) with no other retuning. I left the default as a real month.\n\nChain changes: I added a quarry and brickworks (stone to building materials, which feed town works) and a lorry-to-train freight transfer at a nearby goods yard. The rest keep their 2D roles (sawmill and food plant to goods). The ENGINE.md section also lists the integration steps for the live game.",
 "files_changed": [
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/docs/ENGINE.md",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/econdefs.ts",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/econlines.ts",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/econaccess.ts",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/econtowns.ts",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/economy.ts",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/econkit.ts",
  "/home/user/gamex/.claude/worktrees/wf_7efd5802-eae-1/src/proto/economy.test.ts"
 ],
 "evidence": "- `npx tsc --noEmit`: clean.\n- `npx vitest run`: 8 test files, 83 tests, all pass, including 23 new ones in src/proto/economy.test.ts. The economy file was re-run twice more with no failures.\n- Ported 2D behaviours: buses carry passengers between towns and pay their way; multi-stop lines visit stops in order; passengers change lines; slower roads lengthen the timetable; a line that loses its route says why and resumes when restored; vehicles are refused at stops they can't use; lorries haul coal to a power station; coal goes by lorry to a railhead and on by train; a sawmill turns timber into goods that feed a town's shops; industry production rises when its output is collected and falls when not.\n- New behaviours: an unserved town stagnates, then declines, shrinks, abandons and clears buildings, and gives its reasons; a well-served town grows over 25% and densifies (flats appear); goods deliveries raise shop demand more than 1.5 times; after a line is cut, no homes are abandoned for two months and the town then declines below 80%; towns settle without oscillating over 36 months; the town report shows plain-English reasons and panel numbers; the build request/answer/decline contract works; vehicle positions are valid and lorries run loaded out and empty back; every train id in catalog.ts has economy figures.\n- Determinism and cost: the same seed gives an identical save and a different seed does not; save, load and save again gives identical output, and 3 more months stay within 2%; per-step work is identical with 4 times the population; the scale run logged \"set-up 75\u201398 ms, a month 243\u2013306 ms, 37600 people, 1668496 journeys\" against a 1000 ms limit.\n- Profiling: a CPU profile via a rolldown-bundled benchmark (scratch files in /tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/economy) cut a steady month from about 420 ms to about 180 ms.",
 "known_issues": [
  "Not wired into the live game yet: main.ts and traffic.ts are untouched, as instructed. The adapter (zones from lots, stops from seg.stops, oracles from traffic-graph journey-time tables, applying actions, drawing buses and trains from vehicles()) is listed in docs/ENGINE.md.",
  "Balance numbers (fares, running costs, production rates, local shares, hysteresis months) are first guesses tuned against synthetic towns. An unserved town settles about 34% smaller and a dormitory town that loses its only rail link collapses steeply; soften via TUNE.local and TUNE.homeBase if that's too harsh.",
  "Lines are flows: passengers arrive in the same hour they board, even on long rides, and there are no timetables by time of day. Fares still use the true ride time.",
  "Zone pairs are zone-to-zone within 25 km, so review cost grows with zones times the zones near them. For many-city maps, distant zones should pair at town level; this is noted as the next step in ENGINE.md.",
  "Freight can only change vehicles at the same stop or a freight stop within 250 m; passengers can change at stops within 250 m. Goods and materials supply is per town, not per catchment.",
  "Saving stores the model's own state. The derived parts (catchments, transit journey times, trip tables) are rebuilt on load, so a loaded game continues closely but not bit-for-bit.",
  "Building capacities default to buildgen.ts USE, where terrace (5) is barely more than house (4), so house-to-terrace densifying is weak. The game can pass real capacities when it confirms a densify.",
  "econkit.ts is a test/headless helper module living in src/proto, not a test file."
 ]
}
```

## a00dd79f47f1030ff

```json
{
 "verdict": "I found 15 problems. Each has a focused failing test in /home/user/gamex/.claude/worktrees/wf_7efd5802-eae-3/src/proto/economy.review.test.ts, committed on local branch economy-review at 5dc8cb373d9a7d1de8bfcd8c06b537d03ab02518, on top of the builder's 9294af4 (not pushed). All 15 fail, and each fails at the first assertion the finding is about. `npx tsc --noEmit` is clean.\n\n**Not ready for the live game.** Three problems are serious:\n- A freight shuttle between neighbouring depots is a money farm.\n- Town growth ignores how many seats a line has.\n- A second line on the same stops carries nobody.\n\nThe town explanations are often wrong: \"Growing\" with nothing happening turned up in 16 of 60 random worlds and in the builder's own twin towns. The claims \"floor rather than vanishing\" and \"in balance when the map is made\" hold only for the BALANCED kit town.\n\n**Claims that held up:**\n- Same seed and same inputs give an identical save. Shuffling the order of the input buildings only changes floats in the last digit.\n- Setting `monthDays` to 1 gives exactly the same town paths as 30, both unserved and served.\n- Per-step work doesn't depend on population.\n- The builder's 23 tests pass when run alone.\n\n**Timing caveat:** the builder's 1 s scale test took 1673 ms in one full-suite run, with my two heavy cost tests in parallel and machine load around 6 from other agents. Alone it ran in 402\u2013552 ms, so that timing test is sensitive to load.\n\n**Integration gaps with no test** (from reading roads.ts, traffic.ts and main.ts):\n- The 3D game has only one-direction kerb or lay-by bus stops on road segments. Rail stations are \"coming soon\", and there are no lorry depots, goods yards or source industries.\n- There is no line concept: buses tour the network and trains wander.\n- The game grows the town itself from a plot queue whose lot kinds are fixed by distance from the centre. Buildings it adds without a request arrive at occupancy 1, so the adapter must switch that growth off.\n- The economy only ever asks to add houses, shops, offices and works, while the game's central plots are towers, offices and flats.\n\nThe scratch probes I ran were deleted and are not in the commit.",
 "findings": [
  {
   "title": "Freight shuttle between two neighbouring depots farms fares on the same coal and starves the real delivery",
   "severity": "high",
   "where": "src/proto/economy.ts freightRoutes() (second pass sends cargo to any stop whose `near` has an onward route) and freightArrives() (unconsumed cargo goes into the pool the same line loads from). Test: 'exploits > a lorry shuttling between two neighbouring depots can\u2019t farm fares on the same coal'",
   "detail": "Setup: a coal mine and a power station 6 km apart, a 2-lorry line delivering, and one more lorry on [depot 1, depot 3], where depot 3 is 200 m away. The extra lorry's line gets a destination in both directions, because each end is 'near' a stop with an onward route. At each end the coal isn't consumed, so it drops into that end's pool and the same lorry picks it up again. It pays the \u00a30.6/t base fare on every leg, for ever. The 2D game's `wants` excludes the line itself (via `seen`), so it never did this.",
   "evidence": "10 days: the shuttle carried 36,571 t while the mine produced 7,200 t. The shuttle made \u00a319,194 profit on \u00a33,360 running. The real line's profit fell from +\u00a36,332 to \u2212\u00a3143, and the power station received 3,628 t instead of 7,200 t. Test fails with 'expected 36571.39 to be less than or equal to 7200'.",
   "confirmed": true
  },
  {
   "title": "Town growth ignores line capacity: 1-seat buses grow a dormitory exactly like 60-seat buses",
   "severity": "high",
   "where": "src/proto/econaccess.ts Skim/Pairs/reach (times use only headway and wait; seats never count) and economy.ts step() (queues over a stop's capacity are dropped). Test: 'towns and service > a line far over capacity doesn\u2019t give a town the growth of one with room'",
   "detail": "Reach, and so home demand, comes from skim times, which know headways but not seats. People turned away at full stops are discarded, and reach still counts transit as fully available. A player can 'serve' a whole commuter town with a trickle of capacity and get full growth. Visitors do use real arrivals, but homes and jobs reach don't.",
   "evidence": "Dormitory served by 6 buses. With 60 seats: 1170\u21921252 residents, load factor 0.05, 58,356 carried a month. With 1 seat: 1170\u21921252 month by month (identical), load factor 1.00, 19,224 carried and 19,579 turned away, report still '100% of workers can get to a job within 30 min' and 'Growing'. Test fails with 'expected 1252 to be less than 1189.4'.",
   "confirmed": true
  },
  {
   "title": "A second line on the same stops carries no passengers, and parallel frequency isn't combined",
   "severity": "high",
   "where": "src/proto/econaccess.ts Skim (`nd < dist[v]` keeps a single best edge) and assignTrips() (all-or-nothing onto that one path). Test: 'exploits > two lines on the same stops share the passengers'",
   "detail": "Each stop pair keeps only its first-found best ride edge, and trips go all-or-nothing onto that path. An identical or overlapping second line gets zero generated passengers but still pays running costs, while the first line overflows. Each line's wait is also its own headway/2, so adding a parallel service doesn't shorten anyone's wait. In 2D, anyone waiting boarded whichever vehicle came first. Players routinely add parallel services on a busy corridor, so this will look like a bug.",
   "evidence": "Twin towns, two identical bus lines with 2 buses each, 7 days: line 1 carried 5,201 and line 2 carried 0, with load factor 0. Test fails with 'expected 0 to be greater than 1560.3'.",
   "confirmed": true
  },
  {
   "title": "Freight with two transfers (lorry \u2192 train \u2192 lorry) delivers nothing; 2D allowed it",
   "severity": "medium",
   "where": "src/proto/economy.ts freightRoutes(): `onward` is built only from lines that reach a consumer directly, so a route can only look one line ahead. Test: 'ported 2D behaviour > coal goes lorry \u2192 train \u2192 lorry to a power station'",
   "detail": "The 2D `wants(st, c, from, depth = 2)` recursion allows two hand-overs. Here the first lorry line never gets a destination, so the mine's coal is never loaded. Railheads at both ends (lorry to yard, train, lorry to the works) is the normal UK pattern.",
   "evidence": "5 days: line 1 carried 0, the train carried 0, the last lorry carried 0, and the power station received 0. Test fails with 'expected 0 to be greater than 1000'.",
   "confirmed": true
  },
  {
   "title": "A 300 m minibus hop inside a village is profitable, takes 25% of all trips and makes offices read 5x supplied",
   "severity": "medium",
   "where": "src/proto/econaccess.ts assignTrips() (logit on minutes with no constant against boarding; intra-zone and next-zone trips can ride) with econdefs CARGO.pax.base = \u00a31 per ride, and economy.ts ctx.arrive (every arrival near any workplace counts as a visitor). Test: 'exploits > a 300 m minibus hop inside a village neither pays nor takes a big share of trips'",
   "detail": "Stops 300 m apart are just beyond the 250 m walk link, so the skim rides the bus. With beta 0.15/min, walking and the bus split trips almost evenly. Each ride pays the \u00a31 base fare, and people returning home also count as office visitors.",
   "evidence": "BALANCED town (752 people) with one minibus on a 300 m shuttle. Month 1: 12,611 carried (25% of all the town's trips) and \u00a37,414 profit. Headline 'Growing: offices busy with visitors (311 passengers a day)'. Offices visitor supply rose from 3.3 to 5.8x over the first three months (8x by month 24) while residents later fell 752\u2192629. Test fails with 'expected 0.253 to be less than 0.1'.",
   "confirmed": true
  },
  {
   "title": "No floor: an unserved town with no jobs in reach empties almost completely (720 \u2192 about 20)",
   "severity": "medium",
   "where": "src/proto/econtowns.ts reviewTown()/decide(): home demand = bias \u00d7 pHome \u00d7 capacity; local shares (TUNE.local) only cap shops, offices and works. ENGINE.md says 'an unserved town shrinks towards a floor rather than vanishing'. Test: 'towns and service > an unserved housing estate shrinks towards a floor rather than vanishing'",
   "detail": "pHome for an estate with no reachable jobs stays around 0.3 at any size. bias is capped at 1.6, so demand sits below the 0.86 decline threshold for ever and the estate sheds about 6% a month until one building is left. A village with only shops fell 846\u2192165 (\u221280%). Fuzzing found many towns losing 85\u201395% in 4 years. The builder's '34% smaller' holds only for the BALANCED kit town.",
   "evidence": "Estate (20 houses per zone plus 1 community building), 60 months: 720\u219219, still 'Declining'. Test fails with 'expected 19 to be greater than 180'.",
   "confirmed": true
  },
  {
   "title": "A job-rich town grows with no service at all (+110% in two years)",
   "severity": "medium",
   "where": "src/proto/econtowns.ts calibration: `t.bias[u] = clamp(C/struct, 1, 1.6)` only lifts a town, never lowers one. Contradicts 'Towns are treated as in balance when the map is made'. Test: 'towns and service > a town with no service at all doesn\u2019t grow'",
   "detail": "An isolated town with no stops, lines or roads, but more jobs than homes, has pHome above 1, so it builds homes from month 2. The 3D seed town's centre plots are towers and offices, so the live town may grow on its own. The player's service isn't what drives it, which contradicts the game's premise (in 2D, towns grew only from deliveries).",
   "evidence": "Offices-rich isolated town: 72\u2192151 residents in 24 months, 'Growing' most months, settling at 161 after about 33 months. Test fails with 'expected 151 to be less than or equal to 79.2'.",
   "confirmed": true
  },
  {
   "title": "A served town without free plots falls 40% and then climbs back 40% with no change in service",
   "severity": "medium",
   "where": "src/proto/econtowns.ts decide()/candidates(), with demolish after TUNE.demolishAfter freeing plots (economy.ts ctx.demolish \u2192 zone.plots++). Found by fuzzing. Test: 'towns and service > a served town without free plots doesn\u2019t fall and then climb back'",
   "detail": "Passengers arriving by rail make offices wanted, but zones have plots 0 and offices can't densify, so there's nowhere to build. Homes empty for want of jobs. Six months after abandonment, homes are demolished, the freed plots become offices, jobs rise and homes regrow by densifying. The builder's own 'settles' criterion (min(ups, downs) = 0 after month 4) fails. With 1 plot per zone the same world goes 2910\u21922434\u21922673.",
   "evidence": "Town 3 residents: 2910 \u2192 1745 (month 10) \u2192 2449 (month 35). Offices went 360\u21921560, starting in month 10 when demolitions began. Test fails with 'expected 7 to be +0'.",
   "confirmed": true
  },
  {
   "title": "Town reads 'Growing' for months while nothing is built and nobody moves",
   "severity": "medium",
   "where": "src/proto/econtowns.ts statusOf() clause `GROWN.some(u => up > 0 && ratio >= growAt && !stuck)`, together with decide()'s lumpiness guard `fits`. Test: 'what the town panel says > a town where nothing is built and nobody moves for eight months isn\u2019t \"Growing\"'",
   "detail": "Office demand is 281 against 240 capacity (ratio 1.17), but the guard won't add a 120-job office for about 40 jobs of demand. Candidates exist, so `stuck` stays false and there's no 'nowhere to build' reason; the office `up` counter reached 30. The headline stays positive ('Growing: offices busy with visitors (315 passengers a day)') for a year and more. It happens in the builder's own twin towns with 2 buses, and in 16 of 60 random worlds (runs of 6 to 34 months).",
   "evidence": "Months 22\u201329: no add, densify, restore, abandon or demolish in town 1; residents constant at 630; every status 'growing'. Test fails with \"expected ['growing', ...] to not include 'growing'\".",
   "confirmed": true
  },
  {
   "title": "When the game declines densify requests (fixed-size roads.ts lots), the same buildings are re-asked monthly, counted as built, and the town reads 'Growing' for a year",
   "severity": "medium",
   "where": "src/proto/economy.ts decline() (only a declined add blocks its zone; densify just clears b.densify), econtowns.ts decide() (`built += cand.gain` on request) and statusOf(). Interface: roads.ts lotSpec gives terraces 6\u20137.5 m and flats 12\u201318 m wide, so densifying in place often can't fit. Test: 'what the live game can supply > when the game declines every densify, it isn\u2019t asked again at once and the town doesn\u2019t read \"Growing\"'",
   "detail": "Nothing rests the building or zone after a decline, so decide() re-requests the same candidates every month. Requested (not confirmed) gain counts as built in `recent`, so statusOf() says growing. The builder's claimed 'well-served town grows by about half and builds flats' depends heavily on densify, which the 3D lots can rarely supply.",
   "evidence": "servedTown with 0 free plots and no autoBuild; the game declines everything. About 16 densify requests every month, 16 buildings re-asked within 3 months, residents flat at 752 for 12 months, status 'growing' every month. Test fails with 'expected 16 to be +0'.",
   "confirmed": true
  },
  {
   "title": "A declining town's review costs the square of its size",
   "severity": "medium",
   "where": "src/proto/econtowns.ts decide() decline loop: `rehouse(live.filter(x => !x.abandoned), movers)` runs once per abandoned building, over all live buildings of that use; up to 6% are abandoned a month. Test: 'cost > a declining town\u2019s review costs in proportion to its size, not its square'",
   "detail": "The number abandoned per month grows with town size, and each abandonment re-filters and rehouses into the whole list, so cost is O(n\u00b2). A realistic 30k-person UK town made of houses costs hundreds of ms per declining month on desktop node, and several times that on a Pixel.",
   "evidence": "12 months of decline: the town review took 134\u2013167 ms at 7k people and 1,800\u20133,474 ms at 30k (4x the buildings, 13\u201321x the time); worst single month 310 ms. Test fails with 'expected 20.86 to be less than 8'.",
   "confirmed": true
  },
  {
   "title": "Zone pairs are all zones within 25 km, so a conurbation costs seconds per month",
   "severity": "medium",
   "where": "src/proto/econaccess.ts Pairs (25 km grid and radius), plus reach() and assignTrips() looping over every pair. Test: 'cost > a month for a conurbation of 144 towns runs well under a second'",
   "detail": "The builder listed this as a known next step, but it breaks their own 1 s budget at modest sizes. With street-row or 150 m zones as ENGINE.md suggests, a real city would have tens of thousands of zones and hundreds of millions of pairs.",
   "evidence": "144 towns 2 km apart with 16 zones each (2,304 zones, about 217k people): 5.23M pairs, set-up 5.6 s, a month 2.7\u20133.1 s on desktop node. Test fails with 'expected 2706.69 to be less than 1000'.",
   "confirmed": true
  },
  {
   "title": "Unserved industry falls to 50% production; the 2D rule stops at 100%",
   "severity": "low",
   "where": "src/proto/economy.ts reviewIndustries() with TUNE.industry.min = 0.5, against sim.ts `Math.max(1, ind.rate * 0.96)`. Test: 'ported 2D behaviour > an unserved industry falls back to its starting production, not below'",
   "detail": "The knock-on effect is that an industry's jobs (def.jobs \u00d7 rate) count for nearby zones. An unserved colliery halves its 60 jobs and drags nearby towns' reach down, which the 2D game never did.",
   "evidence": "A lone coal mine after 24 months has rate 0.5. Test fails with 'expected 0.5 to be greater than or equal to 1'.",
   "confirmed": true
  },
  {
   "title": "Settled towns read 'Stalling' for ever",
   "severity": "low",
   "where": "src/proto/econtowns.ts statusOf(): `f.ratio.home < recoverAt` returns 'stalling'; at the floor, home pressure stays at 0.919. Test: 'what the town panel says > a town that has settled reads \"Stable\"'",
   "detail": "The decline rules stop abandoning just below recoverAt, so a town that has settled keeps showing 'Stalling', which suggests something is still about to happen.",
   "evidence": "Unserved BALANCED town: residents 498 from month 16 to 40, still 'Stalling: works only 55% supplied\u2026'. Test fails with \"expected 'stalling' to be 'stable'\".",
   "confirmed": true
  },
  {
   "title": "A loaded game changes town status and re-announces news (the town's recent built/lost isn't saved)",
   "severity": "low",
   "where": "src/proto/economy.ts save()/load() leave out TState.recent, which statusOf() reads; townNews() then fires on the changed status. Test: 'what the town panel says > a loaded game gives the same town status and news as the one that was saved'",
   "detail": "After load, `recent` is empty, so a declining town reads 'stalling' for 1\u20132 reviews. News for 'stalling' and then 'declining' fires for every town.",
   "evidence": "Twin towns saved at month 4. Original: declining \u00d73 with no news. Loaded: stalling, stalling, declining, and 4 news items ('Town 1: stalling\u2026', 'Town 2: stalling\u2026', 'Town 1: declining\u2026', 'Town 2: declining\u2026'). Both soft assertions fail.",
   "confirmed": true
  }
 ]
}
```

## acb5550da02d275d9

```json
{
 "verdict": "The branch is mostly sound, and fine in portrait at 412 px (the likely Pixel width), but it needs work before merging. The builder claimed a clean pass; it has two real layout bugs the builder's 412x915 run could not see.\n\nSetup: branch ui-overhaul is checked out in worktree -2, so I reviewed a detached HEAD at fd0d1a0 in my own worktree. I committed nothing and the tree is clean. Build is in uirev/build, served on port 4212. For comparison I built the parent commit beab203 from a git archive into uirev/basebuild, served on port 4213. tsc is clean and 60/60 vitest tests pass.\n\nWhat passes, with evidence:\n- **Emoji:** none on screen in any state, at 412x915, 360x780 and 915x412 (in-page innerText scan). A grep of every file under src/proto, plus proto.css and proto.html, finds emoji only in catalog.ts's icon data fields, which nothing renders (the known issue).\n- **Icons:** all Tabler icons draw. I checked every visible svg.ic for shapes, a non-zero bounding box and a stroke or fill: 0 blank across all states. The roundabout icon does go round clockwise (checked from the SVG path's arc direction and arrowhead). The give-way icon is the inverted triangle.\n- **Fonts:** League Spartan 700 and Archivo 400/600/700 all report loaded. The page makes no Google Fonts request and no longer 404s (the base build had both failures).\n- **Tap targets:** every visible button is at least 44x44 in every state at all three sizes (the stats line is 36 px plus its 8 px hit strip).\n- **Contrast:** I composited each panel over both a white and a dark map. The worst text ratio is about 6.5:1, so contrast holds over the bright lake and the dark town.\n- **Console:** no errors. The one THREE toNonIndexed warning also appears on the base build, so it is not new.\n- **Side panel alignment:** the junction node lands in the middle of the clear area at every size: x 84 vs 86.5 expected at 412, 73 vs 75 at 360, 292 vs 293.5 at 915, with y at 0.44 of the height. The stop planner lines the road up the same way.\n- **Pause:** cars freeze, and you can still build while paused.\n- **Bundle weight added:** JS +33.5 kB (+6.1 kB gzip), CSS +6.5 kB (+1.7 kB gzip), and four woff2 fonts totalling 55.9 kB. The 49 icons come to 25.8 kB of raw SVG.\n- **Look:** coherent and distinctive: faceted corners, lime tabs, gold rule, and a colour per mode (green roads, blue rail, orange stops). It is clearly branded, not a stock theme.\n- **Rock Face:** I could not get a reference to the Rock Face logo, so I cannot confirm or rule out resemblance. I found no evidence of copying: the mark and ridge are hand-written SVG paths in brand.ts, and the wordmark is plain League Spartan (open font licence).\n\n**Screenshot caveat:** at about 5 fps headless, the first seconds show only sky. The builder's 01-default.png is blank for that reason, so it is no evidence about contrast over the map.\n\nScreenshots are under /tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/uirev/ in p412/, p360/, land/, cmp/ and extra/, plus hdr-*.png. The scripts that made them are in the same folder: rev.mjs, cmp.mjs, hdr.mjs, grow.mjs and extra.mjs.\n\n**Sources** (my web search for the Rock Face logo found nothing usable):\n- [Rock Face (Logopedia)](https://logos.fandom.com/wiki/Rock_Face) (returned HTTP 402, not readable)\n- [Introducing Rock Face (Soldier Systems)](https://soldiersystems.net/2018/08/06/introducing-rock-face-a-clothing-brand-specializing-in-under-layers/)\n- [Rockface (TV series), Wikipedia](https://en.wikipedia.org/wiki/Rockface_(TV_series))",
 "findings": [
  {
   "title": "Landscape: the build drawer and blueprint cover the map, the header, the speed buttons and the camera buttons",
   "severity": "high",
   "where": "src/proto/proto.css: #topbar (line 82), #dock (line 130), #build, #bp. There is no landscape or short-height rule.",
   "detail": "At 915x412 in Road mode only 52 px of map (13%) is left between the header (bottom at 104 px) and the drawer (top at 156 px). The base build left 108 px (26%). While dragging or reviewing a blueprint the dock rises above the header. It overlaps #info by 400x42 px and #side by 44x123 px, and #build overlaps #side by 44x11 px. The hint then sits right over the pause/1x/2x/4x buttons and the stats line is hidden. The hint has pointer-events none, so taps land on speed buttons you cannot see, while the blueprint blocks the stats line and the rotate and top-down buttons. You cannot see the road you are drawing. The base layout already overlapped by 12 px, but the taller header and the new speed control make it much worse. Suggested fix: a max-height 500px rule that lays the drawer rows out side by side or collapses them, shrinks the header to one row, and moves the blueprint into the side-panel column.",
   "evidence": "Screenshots: uirev/land/10-dragging.png, uirev/land/10b-blueprint-demolish.png, uirev/cmp/new-915-road.png, uirev/cmp/new-915-bp.png, and base uirev/cmp/base-915-bp.png. rev.mjs report for 10b: 'overlap info/hint 92x29 | overlap info/bp 400x42 | overlap side/bp 44x123 | overlap side/build 44x11'. cmp.mjs, map left between header and dock (new vs base): road mode 52 px vs 108 px; blueprint -77 px vs -12 px.",
   "confirmed": true
  },
  {
   "title": "On phones 384 px wide or less, the UNTITLED wordmark runs under the pause button",
   "severity": "medium",
   "where": "src/proto/proto.css lines 86-89: '#info .bar' (space-between), '.brand {min-width:0}', '.wm {white-space:nowrap}'. #speed is a fixed 4 x 44 = 179 px.",
   "detail": ".brand shrinks, but the nowrap wordmark keeps its 97 px width and spills out. It overlaps the pause button by 8 px at 384, 17 px at 375, 32 px at 360 and 72 px at 320. At 375 it reads 'UNTITLEDII'; at 360 the pause bars sit on the 'D'. The button still takes the tap (checked with elementFromPoint), but the header looks broken on common 360 and 384 px Android widths. Suggested fix: below about 400 px show only the mark (or shrink the letter-spacing and size), or move the speed control onto the stats row.",
   "evidence": "Screenshots uirev/hdr-360.png and uirev/hdr-375.png. hdr.mjs measured the wordmark's right edge minus the pause button's left edge: 412 -20, 393 -1, 384 +8, 375 +17, 360 +32, 320 +72.",
   "confirmed": true
  },
  {
   "title": "The AM peak / PM peak / paused label gets cut to 'A\u2026' on narrower phones, and at 412 once the town grows",
   "severity": "low",
   "where": "src/proto/proto.css lines 101-102: '.st.clk {flex:0 1 auto; min-width:0}' and '.st em {overflow:hidden; text-overflow:ellipsis}'",
   "detail": "The clock group is the only part of the stats line that can shrink, so the peak label absorbs every lost pixel. It needs 46 px and gets 37 px at 375, 22 px at 360 ('A\u2026') and 2 px at 320. At 412, with grown-town figures (214 cars, 12 buses, 14 trains, population 23,480), it gets 45 of 46 px and starts to ellipsise. The label is also only 9.5 px. Suggested fix: let the stats line wrap, or drop a lower-priority stat before the peak label.",
   "evidence": "Screenshots uirev/hdr-360.png and uirev/hdr-375.png, plus uirev/p360/05-rail-grade-hint.png ('08:07 A..'). hdr.mjs rush widths: 375 {sw:46,cw:37}, 360 {sw:46,cw:22}. grow.mjs at 412 with large figures: {rushW:45,rushSW:46}; at 360: {rushW:2}.",
   "confirmed": true
  },
  {
   "title": "The two-line hint limit cuts off long hints at 360 px",
   "severity": "low",
   "where": "src/proto/proto.css line 135: '#hint span { -webkit-line-clamp: 2 }'",
   "detail": "At 360 wide the rail gradient hint loses its end ('\u2026light rail 7%, rack\u2026'), so the rack railcar's 20% limit is never shown. The Motorway chip hint is clipped too. Two lines is better than the old single-line ellipsis, but the information is still lost on 360 px phones. Shorter hint copy or a three-line limit on narrow screens would fix it.",
   "evidence": "Screenshot uirev/p360/05-rail-grade-hint.png. rev.mjs at 360: 'clamped \"Steepest 5% (this line allows 20%) \u00b7 int\u2026\" 51>34' and 'clamped \"Motorway 3+3 \u00b7 70 mph: 3 lanes each way \u2026\" 51>34'.",
   "confirmed": true
  },
  {
   "title": "Accessibility: aria-current is set empty (which means false), shape buttons have no pressed state, and speed labels omit the visible text",
   "severity": "low",
   "where": "src/proto/main.ts line 501 (b.toggleAttribute('aria-current', \u2026)), the #kinds buttons, and lines 437-440 (speed aria-labels)",
   "detail": "toggleAttribute writes aria-current=\"\", and ARIA treats an empty value as false, so the active tool is never announced. It should be setAttribute('aria-current','true') or removeAttribute. The Straight/Curve/Smooth buttons get only the 'on' class and no aria-pressed, unlike the other chip groups. The speed buttons are labelled 'Normal speed', 'Double speed' and so on while they show '1\u00d7', '2\u00d7', '4\u00d7', which fails WCAG 2.5.3 (label in name) for voice control.",
   "evidence": "extra.mjs DOM dump: aria-current [[\"look\",null],[\"road\",\"\"],\u2026]; kinds [[\"straight\",null,\"on\"],[\"curve\",null,\"\"],\u2026]. grep main.ts:438 'data-sp=\"1\" aria-label=\"Normal speed\"'.",
   "confirmed": true
  },
  {
   "title": "A few icons are unclear or reused: US-style motorway sign, one mountain for three meanings, and the same refresh icon for Reset and Re-optimise",
   "severity": "low",
   "where": "src/proto/ui/icons.ts lines 72-74; src/proto/main.ts lines 485 and 536",
   "detail": "Motorway uses Tabler's road-sign, a diamond with a turn arrow. That is a US warning-sign shape, not a UK motorway symbol. The same mountain icon stands for the Auto height setting, the Rack line and the Rack railcar, and the brand mark is mountains too. The Reset tool uses the refresh icon, which also marks the harmless 'Re-optimise lanes'. Reset actually calls location.reload() with no confirmation and wipes the player's work. That behaviour predates this branch, but the new look makes it an ordinary-looking dock tool.",
   "evidence": "grep icons.ts:72 \"Motorway: 'roadSign'\", :73 \"'rail-rack': 'mountain'\", :74 \"rack: 'mountain'\"; main.ts:536 \"if (t === 'reset') location.reload();\". Screenshots uirev/p412/03-road-chip-hint.png (diamond motorway chip), uirev/p412/05-rail-grade-hint.png (the same mountain on Auto and Rack), uirev/p412/09-junction.png (refresh on Re-optimise).",
   "confirmed": true
  },
  {
   "title": "The name 'Untitled' in the wordmark and page title looks like a placeholder",
   "severity": "low",
   "where": "src/proto/ui/brand.ts line 5 (NAME = 'Untitled' // working title); proto.html line 8 (<title>Untitled</title>)",
   "detail": "The visual language is distinctive, but a wordmark reading UNTITLED, and a browser tab or artifact title of 'Untitled', look exactly like an unnamed document. That works against looking branded rather than generic. If the user chose 'Untitled' on purpose, consider a descriptive page title such as 'Untitled \u00b7 transport game' so it is not mistaken for a missing title.",
   "evidence": "grep brand.ts:5 and proto.html:8; screenshot uirev/p412/01-look.png.",
   "confirmed": true
  },
  {
   "title": "The road picker's empty message says 'Set one of the filters back to Any', but the With filters have no Any",
   "severity": "low",
   "where": "src/proto/main.ts line 685",
   "detail": "The Trees, Bus lanes, Cycle lanes and Parking chips cycle with / without / either, with no 'Any' chip. A player who got to zero matches through those chips is told to do something they cannot do. The tri-state chips also change width as they gain a tick or cross, so Parking jumps to a second row. Suggested copy: '\u2026Set a filter back to Any, or tap a With chip until it is plain.'",
   "evidence": "Screenshot uirev/p412/07b-picker-tri.png shows '0 of 69 road types' with the message and the tri-state chips; grep main.ts:685.",
   "confirmed": true
  },
  {
   "title": "After a notch inset on the right, the side panel moves but the camera still aims for the old clear area",
   "severity": "low",
   "where": "src/proto/proto.css line 178 (#panel right: calc(var(--edge) + var(--safe-r))) vs src/proto/main.ts line 646 (focusOn uses W - panelWidth() - 8)",
   "detail": "The panel's right offset now includes safe-area-inset-right (the old CSS was a fixed 8 px), but focusOn does not. With a simulated 40 px right inset in landscape, the junction lands 18 px off the middle of the clear area. It only matters on devices that report insets; inside an iframe these are usually 0.",
   "evidence": "extra.mjs at 915x412 with --safe-r:40px: 'panel [547,867] node x 292 clear-area centre 274'. Screenshot uirev/extra/safe-landscape-junction.png.",
   "confirmed": true
  },
  {
   "title": "After running faster than 1x, traffic's clock stays ahead of real time for good, so vehicles pop in and out without fading",
   "severity": "low",
   "where": "src/proto/main.ts line 1438 (simNow = Math.max(simNow, now - gdt*1000)) with src/proto/traffic.ts line 84 (c.gone ??= performance.now()) and line 200 (born: performance.now())",
   "detail": "At 2x or 4x, simNow gains (speed-1) x real time on every frame and never gives it back at 1x. Traffic.ts stamps some vehicles with the real performance.now(), which then looks far in the past to the fade code. So cars on a rebuilt road vanish in one frame instead of over 600 ms, and a new bus or train skips its 500 ms fade-in. Nothing gets stuck, which was the builder's worry, but the fades are lost for the rest of the session. The clean fix is a traffic.now() that traffic.ts uses in place of performance.now().",
   "evidence": "Code reading only (grep lines above). I did not capture it on screen.",
   "confirmed": false
  },
  {
   "title": "Pre-existing: a reopened side panel keeps the previous panel's scroll position",
   "severity": "low",
   "where": "src/proto/main.ts openPanel (lines 615-625): the #panel element is reused and scrollTop is never reset",
   "detail": "After scrolling the road picker, opening the junction editor in landscape starts part-way down the list. The busiest-lane score and the start of the Form list are hidden under the sticky header. The old openPanel behaved the same way. Fix: set el.scrollTop = 0 when kind differs from the panel already open.",
   "evidence": "Screenshot uirev/land/09-junction.png: the panel opens on '201% busiest lane', with the score scrolled out of view.",
   "confirmed": true
  },
  {
   "title": "@tabler/icons adds 50 MB to node_modules to supply 49 icons",
   "severity": "low",
   "where": "package.json dependencies (@tabler/icons ^3.48.0)",
   "detail": "Only the 49 imported SVGs, 25.8 kB, reach the bundle, so players are unaffected. But every fresh worktree's npm install pulls in 50 MB, and many parallel worktrees are in use. Copying the 49 MIT SVGs into src/proto/ui/icons/ with the licence would drop the dependency.",
   "evidence": "du -sh node_modules/@tabler/icons reports 50M; the 49 imported SVG files total 25,829 bytes.",
   "confirmed": true
  }
 ]
}
```

