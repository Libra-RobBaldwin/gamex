# Play brief: the 50 km region played as a player (26 Sep 2026)

Session: https://claude.ai/code/session_01DGEkjY29QMXCGUF7EoXkuj. Branch `claude/work-play`. PR #63 (the
play-through, six loop fixes and the review's tests) and PR #66 (the parks, the walls and the review's play
rows) are merged into `claude/cloud-session-history-rvqkm1`; round 2 (the radial town, below) follows on a
third PR from the same branch. Screenshots in `docs/reports/play/` (round 2 in `round2/`), all 412×915, DPR 2, touch,
Chromium with SwiftShader, on the production build (`npm run build`, `vite preview`).

What was played, in order: Start menu > New game > Region (Lowland vale, Temperate, Villages, seed 42) with
the guide; a road; two bus stops; a bus line; six and then sixteen game days; the town panel; a bus, a stop,
a building; the road tool over the river (a bridge); bulldoze; a branch line and two stations by touch;
Menu > Save town, reload, Main menu, Continue; pinch and zoom out across the region, a city, a portal;
and the real Teme region (`?map=region&real=teme`).

## Verdict as a player

- **The first view is a town.** Stoatbury, the start town, fills the screen at 07:12 with the guide over it
  (`08-first-view-10s.png`). The region takes 20 s to make under SwiftShader (`06-loading.png`).
- **The loop works on the seeded region.** Two stops and a line cost £58,000, the goal strip moves to
  "Buses running · watch the town grow", and the town grows: 2,188 people to 2,366 in 16 days, 11 builds and
  32 densified (`52-town-after-16-days.png`, `53-town-panel-16-days.png`).
- **Saving works.** Menu > Save town, a reload, Main menu and Continue all bring back the same clock, balance,
  lines and roads (`107-reloaded.png`, `109-back-at-menu.png`).
- **The HUD is readable** and the cards are small: a bus, a stop, a line, a bridge, a portal and the town each
  show a name, two or three numbers and one action (`54-bus-card.png`, `44-stop-card.png`,
  `102-bridge-card.png`, `104-portal-card.png`).
- **Tapping a building did nothing** on the region: fixed below.
- **Money is meaningless** after the first line: fixed? No, reported below with the numbers; it is a tuning
  decision.
- **The real region does not play**: Ludlow declines from day one whatever you build (below).

## Problems

Severity: **breaks the loop** / **confusing** / **cosmetic**. "Fixed" means live on the integration branch and
checked on a screenshot; until then it says what it says.

### 1. Tapping a building opens nothing (confusing, fixed in this PR)

`45-building-card.png`, `55-building-card.png`: tapping the tower blocks and offices in the town centre
opened nothing, or a junction. `docs/hud.md`: "Tapping anything inspects it".

Cause: on a hilly map every mesh is lifted by the ground's height in its vertex shader (`drape.ts`), and the
drape widens each chunk's bounding sphere up to where it's drawn. The pick ray from the camera passed through
the drawn building, met the lifted bounds, and missed the triangles, which are still at height 0. Fixed in
`main.ts` (`cityHit`): each chunk is raycast lifted by the ground's height under the finger. Checked:
`111-building-card-fixed.png` ("Modern apartments · 8 storeys · Housing · Residents 45 · Add a bus stop").
The lines e2e now taps a building after its bus. Industry sites had the same pick and get the same fix.

### 2. The line tool frames the stops half off the screen (confusing, fixed in this PR)

`41-line-tool-framing.png`: New line zooms to fit every stop, but fits them to the screen's height, so with
two stops 200 m apart on the 45° view one badge is at x = 3 and the other at x = 409 of 412, and the hint
says "Tap the stop the line starts from" with nothing to tap in the clear part of the screen. Cause:
`startLineTool` picks a view height from the stops' extent alone; portrait phones are less than half as wide
as they are tall. Fixed in `startLineTool`: it zooms out by how far apart the stops are on the screen until
they all fit the clear rect with room for their badges. Checked: `112-line-tool-framing-fixed.png`.

### 2b. The stop badges went missing in the top half of the screen (confusing, fixed in this PR)

`28-line-tool.png`: two stops, a hint saying "Tap the stop the line starts from", and no orange badge on
either. Cause: the drape draws every mesh lifted by the ground's height in its shader, but three.js culls a
sprite where it thinks it is, about 200 m below where it's drawn, so a badge in the top half of a phone's
screen was tested as off the bottom. Fixed in `game/lines.ts`: the badge sprites are drawn uncut. Checked:
`112-line-tool-framing-fixed.png`, all three badges.

### 3. Two guides at once (confusing, fixed in this PR)

`13-build-sheet.png` next to `10-after-drag.png`: on a first game the app's guide says "Step 2 of 5 · Build a
road" while the game's own goal strip under it says "Step 1 of 3 · Build bus stops where people live and
work". Two step counters that disagree, and the guide's road step isn't part of the loop (the first line
needs no road). Fixed: the guide goes move, stop, line, done, and the goal strip hides while the guide is up
(`proto.css`); the menu e2e checks both.

### 4. A first bridge fails with a grade message (confusing, reported)

`74-bridge-draft.png`: a street dragged across the river beside the town, 180 m long, is refused: "Can't
climb 6.0 m to clear the water in 72 m: at 6% it needs 100 m. Start further back, or allow a steeper climb in
the options". The message is good, and starting further back works (`99-bridge-draft-long.png`, 320 m,
£24,500, a concrete beam bridge of 42 m: `101-bridge-close.png`, `102-bridge-card.png`). But a first player
drags a short road across a small stream and gets refused. Suggestion for the road tool: when the only
problem is the climb, lengthen the approaches for the player rather than refuse. Owner: the road tool
(main.ts) with bridges.

### 5. The rail tool bridged every road (confusing, fixed in this PR)

A branch line dragged across the lane north of town was refused: "Can't climb 7.8 m to clear the road
straight from the start: at 3.5% it needs 223 m". `setMode('rail')` forced the crossing option to Over,
and its hint said "roads are always bridged", while `docs/rail.md` says Join gives a level crossing (single
carriageway, up to 100 mph, square-on). The rail e2e lays its branch with Join and gets a crossing; the tool
didn't let a player. Fixed: rail keeps Join as its default, with a hint that says what it does.

### 6. Money is out of scale (confusing, reported with numbers; a tuning decision)

`50-line-card.png`, `47-town-panel.png`: one two-stop line 200 m long, two buses, in a town of 2,188:

| | |
|---|---|
| Riders a day (line card) | 21,791 |
| Fares yesterday | £43,582 |
| Running costs yesterday | £2,603 |
| Balance, day 1 | £400,000 |
| Balance, day 17 | £1,074,142 |

"21,791 riders a day" in a town of 2,188 reads as nonsense, and profit is 17× running costs (docs/loop.md
said 4× and "tune it after playing"). Rail (£520,000 for two stations and a train) is affordable on day 4.
Cause: a game day is the town's month, so the card shows a month's riders as "a day", and fares are riders ×
30 × £2 while running costs are a bus's day rate not scaled by the month. Owner: the coordinator's economy
decision; the knobs are `MONTH`, `FARE` and `RUNNING` in `game/money.ts`. Suggestion: scale running costs
by the same month (×30) so a two-bus line makes about £43k − £78k = a loss until it carries more, or halve
the fare and show riders ÷ 30 as "a day".

### 7. The real region declines from the start (breaks the loop on real regions, reported)

`85-real-town-panel.png`: Ludlow (`?map=region&real=teme`, 44 s to load) starts "Declining": "only 43% of
workers can get to a job within 30 min; not enough jobs: 9,481 workers for 5,060 jobs". 19,979 people fall to
18,963 in six days whatever is built; a two-stop line carries 44 riders (£88 of fares) and "Homes near a
stop" reads 0%. On the seeded region the loop e2e forbids a town that declines before the player builds.
Owner: OS (the real live pack's jobs) and the economy. The seeded start is taken as balanced
(`GAME_TUNE`); a real town needs the same.

Also on the real region: a console error `Unexpected token '<' ... is not valid JSON`: something fetches
`/assets/regions/teme/region.json` (under the built assets folder, which serves the page instead) as well as
the right `/regions/teme/region.json`. A relative `regions/` path resolved from inside a built chunk or the
tile worker. Owner: OS (`real/worldmap.ts` builds its base from `import.meta.env.BASE_URL`).

### 8. The line card's "Riders a day" (cosmetic, reported)

See 6. If the month stays, "Riders a month" is the honest label.

### 9. The loading screen counts the wrong things (cosmetic, fixed in this PR)

`06-loading.png`: "seed 42 · 6 places · 1 river · 0 lakes · temperate" for a region with 203 places and
16 rivers. The text counted the live area. Fixed in `mapLine`: a 50 km map counts the whole plan's places and rivers.

### 10. Buildings and scenery (cosmetic, for their owners)

- A "market town" start with "Villages" chosen is a city centre of 15-storey towers and a glass skyscraper
  (`08-first-view-10s.png`). Decent buildings, wrong place. Owner: world50/vernacular.
- The next city, Wensumbrook, close up is flat dark boxes with black window squares
  (`93-city-close.png`): the scenery houses, not `buildgen`. Tapping them opens nothing. Owner: world50 /
  vernacular (the plan says one building generator).
- Zoomed right out (`90-zoom-max.png`) the place names and populations are good, but one name sits under
  the status pill.
- The home screen's picture is the old starter town, which no longer exists (`01-home.png`). Owner:
  world50, ONE MAP step 4.

### 12. Ponds and diagonal paths in every green a road encloses (the user, 21:50; fixed in this PR)

`113-fields-road-before.png`, `114-fields-road-before-close.png`: four streets round a field beside the start
town made 219 cells of park, a playground, allotments and three round ponds with sand rims and diagonal gravel
paths. Cause: `infill.ts` counted the plots a new road plans along itself as town, so the land between them
was a gap to fill; `crowdsites.ts` and `makeRegion` gave every park a fixed disc pond on the first free 4×4
block and a path along a grid row, which reads as a diagonal on a rotated town. Fixed: only land within a few
metres of buildings that stand is town (`113-fields-road-after.png`: the field stays grass; the countryside's
own field pattern inside the square is the ground painter's, countryside's); no park has a pond; paths run
from the gates (`parkplan.ts`). Tests in `infill.test.ts` and `parkplan.test.ts`.

**Ponds and the water rules** (the user, 21:58): a park pond must be a level surface in a hollow with an
irregular outline, never a circle. The water system (`src/proto/water`, `docs/water.md`) derives its lakes from
the ground and has no way to take a small hollow the park makes, and the region's terrain is the terrain
owner's, so ponds are off until it can: none is drawn or placed. Owner for the hollow: terrain and water.

### 13. Parks need walls and gates (the user, 21:58; fixed in this PR)

`115-town-park-before.png` → `115-town-park-after.png`: a park's edge along its roads is now a wall in the
town's tradition (the garden walls' materials from `vernacular.ts`: dry stone, flint, brick, white-washed,
Cornish hedge) with railings on it, or a hedge, open at each gate with a pier either side; a playground gets
a green fence and a gate, allotments posts and wire. Paths run gate to gate. All in the park's one merged
shape, so no extra draw calls. Shared file: `buildgen.ts` (`makeRegion` only). The wall reads as a thin dark
line at the phone's usual zoom; if the user wants it bolder, the wall's height and the railings' weight are
one line each in `makeRegion`.

## The logic review's play rows (`docs/reports/review-2026-09-26.md`, 21:20)

Its tests are in the branch: `game/review.play.test.ts` and `review.play.flow.test.ts`. A row's test is a real
test once its fix is in; the rest are `it.fails` (expected to fail), so CI stays green in between.

| Row | What | Done |
|---|---|---|
| 3 | "Riders a day" ×30 on the line sheet and Lines tab; the milestone ladder judged the same number and paid about £900k of grants at once | Fixed: the count is a town-day's riders, shown plain and judged plain. The 500-rider first milestone still comes with the first line (a two-stop line carries about 700 a day in a town of 2,200); 2,000, 5,000 and 12,000 now take a network. |
| 4 | Bulldozing a lane the map gave refunded half its price, about £100k | Fixed: the game keeps and saves the ids of the roads the player paid for; only those refund. The save e2e checks both. |
| 2 (play half) | A road joined where a stop stands took the stop, the line and its buses with no warning or refund | Fixed here: the blueprint card names the stop and the line the join takes, Build turns red, and a line left with one stop is withdrawn with its buses sold back at Sell's price. Keeping the stop across the split is the vehicles session's half: the review's two tests stay expected-to-fail until it lands. |
| village | A place half built at a hide-save reloaded as finished | Fixed: busy, not live, until it stands; tests that a busy place isn't saved live and that its streets aren't laid twice on the reload. |
| 8 | The goal card asked for a line between two stops that are one place | Fixed: it counts places. |
| 7 | The economy put each stop at the wrong point on its road | Fixed: `pointAt` by arc length, as the overlay. |
| 9 | The guide's road step ticked when a village came to life | The road step is gone (fix 3 above), so nothing of the guide's ticks on activation. The review's test measures the world's activation radius (3.3 km at a 2 km view, `worldmap/game.ts`), which is world50's call: it stays expected-to-fail with a note. |
| 10 | Continue offered an old real-region save the game refuses | Fixed in `menu.ts`, with the same rule as `isOldRealSave`. |
| rest | "No route" line problem never shown; goalDone/firstLineAt not saved; real-region saves named "Region"; track and stations can't be bulldozed | Fixed: the line sheet leads with the economy's problem; the goal card's progress is saved; a real region's town is named after its place; the bulldozer takes track that no station stands on (a station comes away from its own sheet, as before). |

### 11. Bulldoze refuses a road with a reason (fine)

`58-bulldoze-road-preview.png`: "Buildings face this road, and it's their only way in", Remove disabled.
`57-bulldoze-stop-on-line.png`: "Line 1 calls here · withdraw it first". Both right.

## Done and not done

- Done and merged (PR #63), each its own commit: 1 (building tap, with a lines e2e step), 2 (line framing),
  2b (stop badges), 3 (one guide, with menu e2e checks), 5 (rail Join), 9 (loading counts). Each is checked
  on a screenshot named above; live once the integration branch is deployed.
- On the second PR: 12 (fields stay fields, no ponds, paths from the gates), 13 (park walls and gates).
- Reported for their owners, not done: 4 (a short bridge is refused), 6 (money), 7 (real regions decline),
  8 (riders label), 10 (buildings and scenery), the `/assets/regions` fetch, a pond in a real hollow (12).
- From the logic review, on the second PR: rows 3, 4, 2 (play half), the half-built village, 8, 7, 10 and the
  rest of the play list, each its own commit (table above). Row 9's test stays expected-to-fail (world50's
  activation radius); row 2's two tests pass since the vehicles session's PR #64 keeps stops across a split.
- Round 2, on the third PR, each its own commit: 14 (the address names the saved town, with a save e2e
  reload), 15 (the card's actions wrap), 16 (the line tool's framing, with a lines e2e check), 17 (the
  slanted-crossing hint), 18 (the rail blueprint's name and the bulldoze card's), 20 (the activation jump).
  Reported, not done: the money ratio (eight times running), the town's look (towers on a lawn, streets
  ending in the fields), a slanted rail crossing, the Teme region (below).

## Also fixed after PR #66: the activation jump

A far place's count over the map (and in Places) was the coarse economy's plan figure, about 7,900 for a
town, and dropped to its built homes' 2,300 the moment it came to life. `countIn` now scales the coarse
figure by what the live places show (built homes against plan population), so the towns round Stoatbury
read 2,100–2,350 beside its 2,196 (`round2/00-labels-scaled.png`).

## Round 2: the radial town (27 Sep 2026)

Played after PR #67 (the town grown along its radials) and PR #69 (vehicles round 2) landed, exactly as
round 1: the start menu, New game > Region (seed 42) with the guide, two stops by touch, a line, twelve
game days, the town panel, the cards, a bridge, bulldoze, rail by touch, Menu > Save town, a reload, Main
menu, Continue, pinch and zoom out, a city, a portal, the real Teme region. Head played: the integration
branch at 89f6662 (PR #68) with #67 and #69 merged in locally, built and served with `vite preview`
(#70's farmsteads came after; the fixes below were then checked on the merged integration head 28593b5).
Screenshots in `docs/reports/play/round2/`, 412×915, DPR 2, touch, SwiftShader.

### The new town as a player

- **Stops go where a player would put them.** The high street (150 m, 37 buildings on it) takes a stop
  anywhere from 30 m to 120 m along it, a lay-by or kerbside, and a radial 300 m out (186 m, 28 buildings)
  from 30 m to 155 m: the 30 m at each end are the junction's (`11-stop1-preview.png`,
  `12-stop2-built.png`). The first tap of round 1's script, at a street's very middle, was "Too close to
  a junction" on a short high-street piece; a player nudges along and it takes. Fixed after round 3
  (below, 25): the tool nudges for them.
- **The line earns and the town grows.** Two stops 300 m apart, two buses: 307 riders on day one, 381 on
  day twelve; Stoatbury "Growing" from day three, 1,858 to 2,061 people, 96% of homes near a stop
  (`15-town-after-12-days.png`, `16-town-panel.png`). The goal strip moves as in round 1.
- **The town reads as towers on a lawn.** The first view (`08-first-view-10s.png`) is a cluster of
  office towers and car parks on open grass, one long terrace, a strip of allotments, and houses along the
  radials further out; a lone tower stands 300 m out on grass (`15-town-after-12-days.png`, top left). Side
  streets end in the fields without a turning head (`64b-station-b-card.png`, left). That is the
  buildings' and the town plan's owners' to look at; the streets themselves are easy to read and to
  place stops on.

### Money, now that riders a day is honest

| day | status | people | balance | fares | running | riders a day |
|---|---|---|---|---|---|---|
| 1 | stable | 1,858 | £357,618 | £16,267 | £1,635 | 307 |
| 2 | stable | 1,858 | £374,449 | £19,399 | £2,601 | 323 |
| 4 | growing | 1,858 | £408,888 | £20,109 | £2,601 | 337 |
| 8 | growing | 1,944 | £480,934 | £20,858 | £2,602 | 348 |
| 12 | growing | 2,061 | £559,854 | £22,839 | £2,601 | 381 |

One two-stop line with two buses (£58,000 with the stops) pays for itself in three days and then makes
£20,000 a day against £2,600 running: about eight times its running costs. `docs/loop.md` says a busy
line should make about four times. The line card's numbers agree with the purse
(`17-line-card.png`: 381 riders a day, £20,238 profit a day, "the buses cost £2,601 a day to run").
The tuning is the coordinator's (round 1's item 6): the fare or the month multiplier, halved, would give
the four times loop.md wants; the balance rises so fast that money never constrains a player.

### Problems found in round 2

14. **A reload of the page starts a new town** (breaks the loop, fixed in this PR). Save town, then reload
    the tab: day one, £400,000, no stops, no line (`21-reloaded.png`); the start menu's Continue then
    offered that fresh town, "saved just now" (`22-menu-continue.png`), with the real one only under Load
    town. The address of a town started from the menu named only its map, so a phone restoring a
    discarded tab, or a pull to refresh, opened a new one. The first save now puts the save's id in the
    address and the app keeps its game entry at it; the save e2e checks the address and reloads the page.
15. **The line card's four actions ran off the edge** (confusing, fixed in this PR). "Bus · £29,000",
    "Sell", "Even gaps · on" (from #69) and "Withdraw" on one row overflowed the sheet
    (`17-line-card.png`); the actions row wraps now (`18-line-card-wrapped-dev.png`).
16. **The line tool's badges sat under the chrome** (confusing, fixed in this PR). One badge at the top
    edge under the status bar, the other half under the "Tap the stop the line starts from" hint
    (`13-line-tool.png`). The framing now leaves the hint's band under the badges and a tenth to spare;
    the lines e2e checks every badge is inside the clear part of the screen.
17. **A railway across a radial at a slant is refused with a grade message** (confusing, hint added). A
    branch line dragged across the fields met a radial at 30° and the blueprint said "Can't climb 7.8 m to
    clear the road in 44 m" (`62-rail-draft.png`), as if a bridge were the only way. The same track square
    across the radial, clear of its junctions, is a level crossing and builds (`62b-rail-draft-square.png`,
    `63b-rail-built.png`). The blueprint now adds "Or cross the road square-on, clear of its junctions, and
    the track gets a level crossing instead". Whether a slanted crossing should be allowed is the rail
    owner's call.
18. **The rail blueprint said "New road 460 m"** (cosmetic, fixed in this PR): "New railway" now, and the
    bulldoze card names railways as its hint does.
19. **Rail by touch on the new town** (fine, as far as it got). Build > Rail > Branch line, a finger
    dragged square across a radial 450 m out: a level crossing, "Built for £73,600"
    (`63b-rail-built.png`). Build > Stops > Railway station, a tap on the track: the card offers a
    passing loop with two platforms for £166,500 or one platform for £53,800, and "Central" builds with
    its sheet and "New line from here" (`64b-station-a-card.png`, `65b-station-a-built.png`). A tap at
    the track's very end is refused with "Not enough track here · a station needs about 180 m of level
    line", which is right. The second station, the line and the train were not reached by touch this
    round: the script's second tap missed the track twice (its aim, not the game's), and the rail e2e on
    the merged head covers two stations, a line and a train calling at both.
20. **A far place's count jumped when it came to life** (confusing, fixed before this round: the section
    above).

Also seen: the bridge that round 1's item 4 refused builds here: a 320 m road over the river gets a 42 m
concrete beam and a 6% approach (`23-bridge-draft.png`, `24-bridge-built.png`). The bulldozer, a pinch
out to the region and the full zoom out (`26-pinched-out.png`, `27-zoom-max.png`), a city close up
(`28-city-close.png`: its roads still unmarked, the buildings' owners'), and a portal sign's card
(`30-portal-card.png`: "Little Vetchton · Lane · north · 6 miles off the map · 422 in a day") all work as
in round 1. No console errors in any stage beyond the SwiftShader shader-compile warning.

### The real Teme region, again

As in round 1 (item 7): Ludlow loads in 37 s, 19,900 people, but declines from day one whatever is built.
Two stops (£600 each, kerbside) and a line with two buses (`83-real-stop2.png`, `84-real-line.png`), six
days on: "Declining", 19,979 to 18,801 people, fares £0, "Homes near a stop 0%" with the stops on its
streets, "only 43% of workers can get to a job within 30 min; not enough jobs: 9,400 workers for 5,054
jobs" (`85-real-town-panel.png`). The console still logs `Unexpected token '<' … is not valid JSON` from
a fetch that gets the page instead of a region file. Nothing here is the play session's: the real-region
economy and its fetch are the real-region and economy owners' (round 1's item 7 stands).

## Test results (second PR, on the rebased branch)

- `npx tsc --noEmit`: clean.
- The six phone e2es on a production build of the branch before the rebase onto the merged #63, #64 and #65
  (lines with the building tap, loop, rail, save with the bulldoze-refund step, stations, menu on the build):
  all pass. CI runs them again on the PR.
- `npx vitest run --no-file-parallelism` on the rebased tree: see the PR.

## The park pond's game side (the coordinator, 02:33)

PR #71 gave the world's water `addPond` (a small lake shape with a wandering shore at the ground's height,
the ground laid level to it with a hollow) and left the game's side to this session. Done, one commit:

- **Where.** `parkplan.ts` `parkPond`: a park of 2,000 m² or more gets a pond at its lowest spot where the
  water lies a metre inside the park and its bank (4 m) is clear of the roads and the paths; a sixth of
  the park's width across, within the water system's 8–30 m. The seed-42 start town's parks are too
  ragged for even the smallest pond (the two over 2,000 m² are 35 m wide strips with roads both
  sides), so it has none; seeds 2, 5, 7 and 13 have one to three.
- **What.** `main.ts` `addInfill` asks the plan's water for the pond and `applyPonds` puts it in the game:
  the relief grid round it taken again from the terrain (the drape draws from the same heights), the
  ground mesh made again over it, the live water given the pond (`game/water.ts` `addPond`: its tile
  built again with its surface and reeds, its land claimed so plots, paths and trees keep off), the
  ground's paint and the trees round it redone. The park's lawn, trees, beds and bandstand keep off the
  pond and its bank (`buildgen.ts` `makeRegion`). A park found again keeps its pond.
- **Seen** at 412×915 on seed 2's 3,350 m² park: `pond-before.png` → `pond-after.png` (from 130 m) and
  `pond2-close.png` (45 m) and `pond2-130m.png`: a level surface with an irregular outline, never a
  circle, the paths and the hedge clear of it, reeds on its bank. (The black discs by the garden fences
  in those views are the gardens' trampolines, not ponds.) One thing for the water owner: the bed under
  a garden pond is a lake's, 4.2 m down (`worldmap/water.ts` `lakeGroundOf`); a pond wants a metre or so.
- **Not done:** a pond is never taken away. A park bulldozed or cut by a road keeps the pond in the
  field; the plan's water has no `removePond`, and the terrain would need laying back.

## Round 3: the trunk after #73, with the money tuned (27 Sep 2026, 04:30)

Played on the integration branch at 8abea60 (PRs #69, #70 and #73 in; `game/money.ts` tuned: a bus's
running cost doubled, the start balance £250,000, the fare £2), plus the one-line fare import below, built
and served with `vite preview`; the same stages as rounds 1 and 2, by touch at 412×915, DPR 2, SwiftShader.
Screenshots in `docs/reports/play/round3/`. PR #71 (the park pond's water side) landed at 04:19, after
the round; the pond's game side (above) is on this branch with it.

### The loop

- **Start:** £250,000 in the bank, the guide over the start town (`08-first-view-10s.png`). Two stops
  (£600 each) on the high street and a radial, a line with two buses: £58,000, leaving £190,800.
- **Save and reload** (the fix from #73): Save town, reload the tab, and the same town comes back (day 2,
  £186,800, the line and both stops); Continue on the start menu opens it too (`21-reloaded.png`,
  `22-menu-continue.png`).
- **Rail by touch, the whole way this time:** a branch line square across a radial reads "New railway
  460 m · £73,600" and builds with a level crossing (`62-rail-draft-square.png`, `63-rail-built.png`);
  two stations from Build > Stops by tapping the track, Central and Parkway (£166,500 each as a passing
  loop, £53,800 with one platform); New line from here, Create, two trains for £240,000, and a train is
  standing at a platform 19 s later (`68-rail-line-created.png`, `69-train-at-platform.png`).
- **The bridge, bulldoze, a pinch out, the city, a portal sign:** as round 2 (`23-bridge-draft.png`,
  `26-pinched-out.png`, `30-portal-card.png`).

### Money, with the tuning

| day | status | people | balance | fares | running | riders a day |
|---|---|---|---|---|---|---|
| 1 | stable | 1,858 | £185,583 | £0 | £3,265 | 0 |
| 2 | stable | 1,858 | £199,812 | £16,267 | £5,201 | 307 |
| 3 | stable | 1,858 | £214,042 | £19,399 | £5,200 | 323 |
| 4 | growing | 1,858 | £228,280 | £19,432 | £5,201 | 324 |
| 6 | growing | 1,858 | £258,291 | £20,200 | £5,201 | 337 |
| 8 | growing | 1,907 | £289,232 | £20,807 | £5,203 | 347 |
| 12 | growing | 2,049 | £355,773 | £22,582 | £5,201 | 377 |
| 16 | stable | 2,074 | £427,098 | £23,140 | £5,201 | 386 |
| 20 | stable | 2,077 | £499,086 | £23,212 | £5,200 | 387 |
| 24 | stable | 2,078 | £571,161 | £23,221 | £5,201 | 387 |

(Day 1 is the line's first part-day: the fares land at the next review.) The two-bus line makes
£19,000–23,000 a day against £5,200 running: 3.7 to 4.5 times, loop.md's four. It pays for itself in
four days. **The pace to a railway:** the branch line above cost £73,600, two one-platform stations
£107,600 and two trains £240,000, about £420,000; at £14,000–18,000 a day net the player who built the
first line on day 1 has that on day 16 or so, a fortnight of game days. The town grows from 1,858 to
2,078 by day 16 and then stops, "Steady": 100% of workers reach a job, but "shops within 20 min can serve
only 29% of residents" (`16-town-panel.png`); the next thing a player is asked for is shops, which no tool
gives them. That is the economy owner's (round 1's item 6, and the coordinator's).

### Problems

21. **Tapping a house, a shop or an office opened nothing** (confusing, fixed in this PR). On the start
    town, a tap on the flats by the centre opened their card, but a 1930s semi, a shopping parade and a
    1960s office opened nothing wherever they were tapped (`55-building-house.png`). Round 1's fix lifted
    each chunk by the hill under the tap before casting the ray; the drape had already widened every
    chunk's bounding sphere by the hills for culling, so lifted once more the sphere sat above the mesh
    and the ray missed every chunk but the centre's. The pick now tests each geometry's own sphere. The
    lines e2e taps a house, a shop and an office on their plots.
22. **The bulldozer on a stop a line calls at** (fine): "Market Place · kerbside stop · Line 1 calls here ·
    withdraw it first", Remove greyed (`57-bulldoze-stop-on-line.png`); a road with houses on it: "Buildings
    face this road, and it's their only way in" (`58-bulldoze-road-preview.png`).
23. **The bus card** (fine): "Bus UT 101 · Line 1 · Stalberg Glidare Mk III double-decker · next stop Market
    Place · on board 0 · 5 mph" (`54-bus-card.png`).
24. **The real Teme region** (unchanged, for its owners): Ludlow loads in 25 s, two stops and a line, and
    six days on it is "Declining", 19,979 to 18,832, fares £57 a day, "Homes near a stop 0%", the JSON
    fetch error still in the console (`85-real-town-panel.png`).

### Fixed here

- The line card's note reads the fare from `game/money.ts` instead of a literal "£2" (the coordinator's
  ask).

### After round 3: what was still confusing in the play session's files (the coordinator, 06:44)

25. **A stop tapped a little too close to a junction was refused** (confusing, fixed). "Too close to a
    junction or the end of the road — stops need about 35 m clear" was the first thing rounds 2 and 3's
    first tap met on a short high-street piece, and a player has to guess which way and how far to move.
    The stop tool now walks along the road, 2.5 m at a time up to 40 m either way, to the nearest spot
    that is clear, puts the blueprint there and says "Moved 14 m along the road, clear of the junction";
    a tap that has no clear spot within reach is refused as before. The loop e2e taps 15 m from a
    junction and expects the moved blueprint with Build enabled.
- **The review's row 9** (a pinch-out over the start town brings a village to life) is world50's
  activation reach, not this session's; its test stays expected-to-fail.
- Everything else still open from rounds 1 to 3 is another owner's: a short bridge refused on a grade
  (4), the real Teme region declining (7), the town's look (10), a slanted rail crossing (17), the pond's
  bed depth and removal, and the economy's growth ceiling, which the coordinator has since fixed on the
  trunk (shops follow their customers).

## Test results (third PR, round 2, on the branch merged with integration at 28593b5)

- `npx tsc --noEmit`: clean.
- `npx vitest run --no-file-parallelism`: 128 files, 1,128 passed, 1 expected fail (row 9's pinch-out
  test), 8 skipped, none failed.
- The phone e2es on a production build of the merged branch (`vite preview`, 412×915, DPR 2, touch,
  SwiftShader): lines (with the framing check), rail (with the touch-drawn blueprint), save (with the
  address and the reload), stations and loop pass; menu passed after the address fix's follow-up (a
  save on the way out had rewritten the menu's entry), and save was run again on that build. CI runs
  them all on the PR.
