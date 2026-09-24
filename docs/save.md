# Saving and loading

A town saves itself as you play, and a saved town carries on exactly where it was. Saves are
kept in the browser's IndexedDB on the phone, so they're there offline and after the page closes.

## What the player sees

- **Autosave.** Every 4 game hours (a minute at 1×), and whenever the page is hidden: the phone
  locks, another app comes up, or the tab closes. Leaving for the start menu saves first.
- **Menu > Save town** saves now, and the hint says so: "Town saved · Day 3 · 14:20 · 1,204 people
  · £412,300". Its card says when it last saved.
- **Menu > Load town** lists every saved town, newest first. Opening one saves this town first.
  The delete button asks a second time.
- **The start menu.** Continue opens the newest save. Saved towns lists them all, with Open and
  Delete, once there's more than one.
- **Menu > New town** saves this town, then starts a fresh one on the same map. The old town
  stays in Load town.
- Each town has one save, made when it starts and kept up to date. A loaded town saves over the
  save it came from.

A save is played at its map's address with `&save=<id>`, e.g. `/?map=town&save=…` or
`/?map=region&seed=42&save=…`. A save that's gone, or one this version can't read, opens a new
town with a hint saying why.

## What's in a save (`src/proto/game/save.ts`, `GameSave`)

- The map's id and the query that makes it (maps are data: `src/proto/region`, `?map=`). The
  land, water and trees are made again from those.
- The network (`NetSave`):
  - nodes and roads, with their stops, bridges and bridge types, one-way carriageways and slip
    lanes;
  - the lots with buildings on them;
  - every land claim, except the water's (the map makes it again) and industrial sites' (the
    sites make their own);
  - its id counter and random stream.
- The plots still free, in the order the town takes them. The game's own random stream, which
  lays out new roads' plots.
- The junctions the player designed. The rest design themselves again on load.
- Motorway junctions (`Interchange`). Industrial sites: plot, type, seed and variant.
- The railway (`rail/railway.ts`): stations, rail lines and each line's trains. The loop's
  simple stations (`game/rail.ts`).
- The player's lines (`game/lines.ts`): stops in order, circular or not, bus model or train, and
  how many vehicles run each. Also the stops' names.
- The economy (`TownSave`): the library's own `EconomySave`, and what the game's glue remembers
  (each line's riders so far, the day, the counters).
- The purse (`PurseSave`), the clock, and the game speed (paused, and the rate).

Not saved, because the game makes it again as it runs:
- the traffic: cars start again, and each line's buses and trains start spread along it, as a
  new line's do;
- the people on the footways;
- the ground's paint;
- the parks and car parks in the gaps.

## Exactly as saved

`game/save.test.ts` runs the starter town with two bus lines for five game days and saves part
way through a day. It loads the save into a fresh world and runs both on for five more days. The
economy's whole state, the purse, the buildings standing and the plots free must be identical. It
also checks against a third copy that was never saved: saving mustn't change anything. It must
make the same buildings and decisions, with numbers equal to a millionth.

The economy keeps working tables it doesn't save (trip tables, catchments), rebuilt on load in a
slightly different order. On their own they'd drift apart in the last digits. So a save is a
round trip for the game that saved too: `TownEconomy.save()` makes its economy again from the
save, as a load does (docs/ENGINE.md, "The economy layer").

`e2e/save.e2e.mjs` does the same in the browser, by touch at 412×915:
1. It changes the town (a road, a stop, a line, a junction of the player's design) and saves
   from the Menu.
2. It opens the save in a second tab and compares everything.
3. It runs both on two days and compares again.
4. It checks Load town, autosave on hiding the page, and Continue.

## Versions

Every save has `v`, its format's version (`SAVE_VERSION`). When the format changes:
1. bump `SAVE_VERSION`;
2. add `MIGRATIONS[old]`, taking a save of the old version to the next.

Old saves then load through every step since. A save from a newer version of the game is refused
rather than half-read. The database has its own version too (`DB_VERSION` in `game/savedb.ts`),
with an upgrade step per version. It has two stores: `saves` holds the towns, and `index` holds
a small entry per town, for the lists.

## Cost

In the starter town a save takes about 2 ms on the main thread, measured by `e2e/save.e2e.mjs`
under SwiftShader. That covers the snapshot, the economy's round trip and IndexedDB copying it.
The write itself finishes in the background.
