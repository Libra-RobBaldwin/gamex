# The HUD: how the game's controls are organised

The user approved this structure on 24 Sep 2026 after trying the clickable mock-up in
`docs/hud/mockup.html`. Open it with the Vite dev server (`/docs/hud/mockup.html`) or as a
file. It follows Cities: Skylines and Transport Fever, which keep four jobs apart:
**build**, **manage**, **inspect** and **overlays**. It keeps the "Untitled" brand from the
first HUD overhaul: forest, darker green, lime and gold; League Spartan and Archivo; Tabler
icons; faceted panels. There is no emoji anywhere.

The first HUD covered about a quarter of the screen's height, plus a column of side buttons.
This one covers about 12% when nothing is open: a 44 px strip at the top and a 64 px bar at the
bottom, on a 412×915 phone.

## At rest

- **Status strip (top, 44 px).**
  - The mark, the clock and the time of day ("AM peak").
  - Money, once the economy is wired. Until then, leave the slot empty rather than faking it.
  - Pause, and one speed button that cycles 1×, 2× and 4×.
  - Tapping the clock opens a small stats drawer: people, cars, buses, trains. The perf readout
    lives there too, behind a tap.
- **Compass (one round button under the strip).** Tap it to face north. Rotating is by
  gesture. The rotate and map buttons go.
- **Bottom bar (64 px), four buttons:** Build · Transport · Layers · Menu.
- **Tapping anything inspects it.** There is no "Look" mode: inspecting is simply what a tap
  does when no tool is active. A first-run pill says so once.

## Build

A compact strip over the bar (about a seventh of a phone screen): one row of category tabs with Close, and one row of small cards that scrolls sideways.

| Tab | What's in it |
|---|---|
| Roads | Cards for the presets, plus "More road types", which opens the existing road picker and its filters inside the sheet |
| Rail | Cards for the rail presets |
| Stops | Bus stop, bus station, railway station, lorry depot: whatever the game has |
| Freight | Terminals, once the terminals stream lands. Until then, shown disabled with the reason |
| Bulldoze | Bulldoze |
| Landscape | Disabled until terrain is in the game |

Picking a card closes the sheet and swaps the bottom bar for a **tool strip**:

- the tool's name and spec, and Cancel;
- its options, such as the existing height and grade and crossing controls;
- Undo and Done.

The map is left clear for drawing. The blueprint's confirm step and its demolition warnings
work inside this flow.

## Transport

A sheet with two tabs:

- **Lines:** the existing stop planner and routes, plus "New line": tap stops in order, then
  pick vehicles.
- **Buy vehicles:** the existing vehicles panel. Once the vehicle library is wired, it lists
  `purchaseList(gameYear())`.

## Inspect

Tapping a building, junction, stop, vehicle, industry or bridge opens an **info sheet**:

- a title and sub-title;
- facts;
- actions, such as "Edit junction", which opens the existing junction editor inside the sheet.

The map stays visible above the sheet. Tapping the map closes it.

## Layers

A small pop-over above the bar:

- **Overlays**, as toggles: traffic flow, stop catchments, demand, land use. Show only those that
  exist; the rest are disabled with a reason.
- **View:** 3D, Low or Plan. The existing low and plan views move here from the map button.

## Menu

- quality (the adaptive tiers);
- the perf readout;
- New town (the old Reset);
- save and load, when they exist.

## One shell for everything

The shell is built: `src/proto/ui/shell.ts`, styled by `src/proto/proto.css`. `main.ts` makes
one (`const shell = new Shell($('#ui'), { onCompass, onPause, onRate, onPerf })`) and every piece
of UI registers with it. Nothing else adds panel markup. `window.proto.shell` exposes it for
scripts and tests.

### API

| Call | What it does |
|---|---|
| `openSheet({ key, title, sub?, icon?, tone?, tabs?, tab?, onTab?, body, actions?, back?, onClose?, fresh?, from?, fixed? })` | Opens a bottom sheet (a panel down the right in landscape). Returns the body element, so wire it with `querySelectorAll`. Re-opening the same `key` re-renders in place and keeps the scroll position. `onClose` runs once, when the sheet closes or a sheet with another key replaces it. `back` shows a back arrow. `from` lights a bar button. `fixed` holds the sheet at full height, so switching its tabs doesn't move them. `compact` puts the tabs and Close in one header row with no title block (the Build sheet uses it, so it's a strip over the bar rather than half the screen). `tone` is `'road' \| 'rail' \| 'stop' \| 'look'`. |
| `closeSheet()` | Closes it (and runs its `onClose`). |
| `openInfo({ key?, title, sub?, icon?, tone?, facts?, meter?, note?, html?, actions?, onClose? })` | The info sheet for something tapped: a title, `[label, value]` facts, an optional 0..1 meter, a note and action buttons. |
| `addBuildCategory({ id, label, icon, disabled?, note? })` | A tab in the Build sheet. |
| `addBuildItem(cat, { id, label, spec?, name?, short?, icon?, tone?, locked?, on?, onPick? })` | A card in that tab. The cards are small (one row that scrolls sideways), so `name` and `short` give a shorter name and one line of detail in place of `label` and `spec`; the full text stays in the card's label for screen readers. `locked` shows it disabled with the reason. `on()` marks the current choice. `onPick` runs after the sheet closes (return `false` to keep it open, e.g. to show a picker in the sheet). |
| `startTool({ name, spec?, icon?, tone?, options?, bind?, onUndo?, onDone?, onCancel? })` | Swaps the bar for the tool strip: name and spec, the options row (HTML, wired in `bind(el)`), Undo (shown if `onUndo` is given), Cancel and Done. Returns a handle: `set({ name, spec, icon, tone, options })`, `setUndo(on)`, `setPrimary(action \| null)` (e.g. Build while a blueprint waits), `setPanel(html \| null, bind?)` (the card above the strip), `avoid(points)` (screen points the card must not cover) and `end()`. |
| `guardTap()` | Call from a map tap that opens a sheet: it swallows that tap's click, so it can't also press a button the new sheet puts under the finger. `tapMap()` does this already. |
| `endTool()` | Leaves the tool quietly. `toolActive` says whether one is in use. |
| `addTransportTab({ id, label, icon, sub?, render(el) })` | A tab in the Transport sheet. `render` fills the body. `refreshTransport()` re-renders the tab that's showing. |
| `addLayer({ id, label, icon, disabled?, on?, onToggle? })` | An overlay toggle in the Layers pop-over. |
| `setViews({ options, current, pick })` | The 3D / Low / Plan picker. `syncView()` is cheap to call every frame. |
| `addMenuItem({ id, label, icon, sub?, disabled?, onClick })` | A card in the Menu sheet. `sub` can be a function (e.g. the current quality). |
| `hint(html \| null, ms?)` | A line of help over the clear map. With `ms` it clears itself. |
| `firstRun(key, text)` | A pill shown once ever on this device (localStorage), until the first tap or 15 s. |
| `setSpeed(paused, rate)`, `setPerf(on)`, `setMoney(text)`, `toggleDrawer(open?)` | The status strip. The game writes its readouts straight into `#st-clock`, `#st-rush`, `#st-pop`, `#st-cars`, `#st-buses`, `#st-trains` and `#perf-t`. |
| `clearRect()` | The part of the screen the chrome leaves clear, for framing the camera (`focusOn` in main.ts uses it). |

The shell does no work per frame. It measures layout only when something changes size.

### Moving a panel into it

A panel built on the old HUD's `#panel` styles moves over almost unchanged. The old side-panel
content classes (`.grp`, `.tab`, `small`, `.plan`, `.fl`, `.rl`, `.row3`, `.score`, `.warn`,
`.bad`, `.xs`) are styled inside a sheet's body. Use `.act`, `.act.primary` and `.act.danger` for
buttons. For example, an industry info panel becomes:

```ts
function showIndustry(ind: Industry) {
  const el = shell.openInfo({
    key: `industry:${ind.id}`, title: ind.name, sub: ind.kind, icon: 'warehouse',
    facts: [['Produces', `${ind.rate} t a month`], ['Stock', `${ind.stock} t`]],
    actions: [{ label: 'Buy a terminal', icon: 'plus', kind: 'primary', onClick: () => openTerminals(ind) }],
  });
  // el is the sheet's body, if there's more to wire up
}
```

Then add it to `tapMap()` in main.ts, where a tap with no tool in use is inspected. A bridge editor
is an `openSheet` with `back` to the bridge's info sheet, like the junction editor. A vehicle
purchase list is a `render` in the `buy` Transport tab.

### In the game now

- **At rest.** The status strip, the compass and the bar. They cover 11.8% of a 412×915 screen,
  measured by sampling what's under every other pixel. They cover 13.9% at 360×780 and 9.0% in
  landscape at 915×412.
- **Build.** Roads (the four presets and "More road types", which opens the road picker and
  filters in the sheet), Rail (the five presets) and Stops (a working bus stop; bus station,
  railway station and lorry depot are locked with "Not in the game yet"). Freight, Bulldoze and
  Landscape have a locked card each, with the reason.
- **Tool strip.** The options are Straight, Curve and Smooth; Height; Gradient; Join, Over and
  Under. A blueprint shows as a card above the strip: length, cost, demolition warning, lift
  and the long section. The strip's Done button turns into Build, which goes red with a
  bulldozer icon when the road would demolish buildings. Undo steps back through the blueprint
  and the curve's taps. The old HUD had no way to undo a road once it was built, and the network
  can't remove one yet, so Undo doesn't go further back than that.
- **While drawing.** The bar is hidden, so a round View button under the compass cycles 3D, Low
  and Plan. The blueprint card moves across if it would cover the road's ends: to the other side
  in landscape, or under the status strip in portrait. A new blueprint closes any sheet the tool
  opened (such as the junction editor). Escape cancels the tool.
- **Inspect.** Tapping a stop, junction, building or open space opens its info sheet. A
  junction's sheet has Edit junction, which opens the editor (lane arrows still work on the map).
  Tapping empty map closes the sheet.
- **Transport.** Lines lists every stop (tap one to see it) and has Add a bus stop. New line is
  disabled until routes exist. Buy vehicles is the old vehicles panel: buses, trains and
  background traffic.
- **Layers.** The four overlays are disabled ("Not in the game yet"). View is 3D, Low or Plan.
- **Menu.** Quality (Auto, or hold one tier), Performance (the readout, which shows in the
  stats drawer), New town (confirm step), Save and Load (disabled).
- **Speed.** Pause, and one button that cycles 1×, 2× and 4×. The old blinking clock is gone:
  "paused" shows in gold instead.
