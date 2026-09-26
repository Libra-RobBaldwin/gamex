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

### 11. Bulldoze refuses a road with a reason (fine)

`58-bulldoze-road-preview.png`: "Buildings face this road, and it's their only way in", Remove disabled.
`57-bulldoze-stop-on-line.png`: "Line 1 calls here · withdraw it first". Both right.

## Done and not done

- Done in this PR, each its own commit: 1 (building tap, with a lines e2e step), 2 (line framing), 2b (stop
  badges), 3 (one guide, with menu e2e checks), 5 (rail Join), 9 (loading counts). Each is checked on a
  screenshot named above; "live" once the PR is merged and the integration branch is deployed.
- Reported for their owners, not done: 4 (a short bridge is refused), 6 (money), 7 (real regions decline),
  8 (riders label), 10 (buildings and scenery), the `/assets/regions` fetch.

## Test results

Filled in at each push.
