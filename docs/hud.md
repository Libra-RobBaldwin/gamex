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

A half-height sheet with category tabs:

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

Put the shell in `src/proto/ui/shell.ts`. Every system that needs UI registers with it instead
of adding its own panel markup:

- `openSheet({ title, sub, body, actions })`
- `closeSheet()`
- `addBuildCategory` / `addBuildItem`
- `startTool({ name, spec, options, onDone, onCancel })`
- `addLayer`
- `addMenuItem`

This includes the industry info panel, the bridge editor and the vehicle purchase list that
are being wired in now. The shell has to work at 412×915, at 360×780 and in landscape at
915×412, with tap targets of at least 44 px.
