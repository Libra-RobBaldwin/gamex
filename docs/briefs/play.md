# Play brief: the 50 km region played as a player (26 Sep 2026)

Session: https://claude.ai/code/session_01DGEkjY29QMXCGUF7EoXkuj. Branch `claude/work-play`, PR into
`claude/cloud-session-history-rvqkm1`. Screenshots in `docs/reports/play/`, all 412×915, DPR 2, touch,
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

- Done in this PR, each its own commit: 1 (building tap, with a lines e2e step), 2 (line framing), 2b (stop
  badges), 3 (one guide, with menu e2e checks), 5 (rail Join), 9 (loading counts). Each is checked on a
  screenshot named above; "live" once the PR is merged and the integration branch is deployed.
- Done in this PR too: 12 (fields stay fields, no ponds, paths from the gates), 13 (park walls and gates).
- Reported for their owners, not done: 4 (a short bridge is refused), 6 (money), 7 (real regions decline),
  8 (riders label), 10 (buildings and scenery), the `/assets/regions` fetch, a pond in a real hollow (12).
- From the logic review: rows 3, 4, 2 (play half), the half-built village, 8, 7, 10 and the rest of the play
  list are fixed in this PR, each its own commit (table above). Row 9's test stays expected-to-fail (world50's
  activation radius); row 2's two tests wait on the vehicles session.

## Test results

Filled in at each push.
