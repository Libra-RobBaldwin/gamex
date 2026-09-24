# Terminals

Loading and unloading facilities a player buys for an industry, one ladder of three tiers per
transport mode. A terminal is that site's station for that mode, and what it can move caps how
far the industry can grow. So terminals are the upgrade path: when a site's output presses
against them, the next tier becomes available to buy and the game says why ("Colliery output is
stockpiling: a lorry depot would move 4.5x more").

Everything lives in `src/proto/terminals/`. It reads the industries catalogue and draws with the
industries kit, and nothing outside the demo depends on it yet.

```
catalogue.ts   modes, cargo classes, tiers, handling fits, units (pure data)
rules.ts       capacity, growth reviews, unlocking, offers, suggestions, purchases, idling, sharing
layout.ts      where each terminal goes: at the site's anchors or on land beside it
models.ts      buildTerminals(): one vertex-coloured mesh per site's terminals, plus moving parts
panel.ts       the Terminals panel in /industries-demo.html
index.ts       the public surface
```

One change was made to the industries code: `buildIndustry(..., { bare: true })` leaves out a
site's own lorry bays, rail sidings and loading canopies but still records their anchors, so a
site with bought terminals doesn't also show the ones its recipe drew.

## The loop

```
           production level (1..4, the 2D game's rate multiplier)
                  │ x1.12 a review while over 60% of output is collected
                  ▼
   output ──▶ terminals (berths x t/h, per mode) ──▶ vehicles on lines
                  │ can't move more? the level stops rising: "capped"
                  ▼
   pressure: stockyard full with berths busy, vehicles queueing, or growth capped
                  │ and the player owns a terminal of the current grade
                  ▼
   grade + 1: the next rank in every mode the site can use becomes available to buy
```

## The catalogue

Three modes, `road`, `rail` and `water`. An industry's `serve` kinds map onto them (`lorry`,
`rail`, `quay`), and a mode an industry can't use is never offered.

| Tier | Mode | Rank | From | Cost | Upkeep/day | Build days | Berths | t/h per berth | Throughput | Stock | Catchment + | Land |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Loading bay (`loading_bay`) | road | 1 | 1800 | £1,000 | £40 | 2 | 2 | 25 | 50 t/h | 200 t | 0 m | on the site |
| Lorry depot (`lorry_depot`) | road | 2 | 1910 | £5,000 | £150 | 6 | 4 | 35 | 140 t/h | 600 t | 20 m | 38 × 42 m beside |
| Road freight terminal (`road_terminal`) | road | 3 | 1955 | £24,000 | £600 | 20 | 8 | 50 | 400 t/h | 1,500 t | 60 m | 66 × 56 m beside |
| Private sidings (`sidings`) | rail | 1 | 1830 | £6,000 | £120 | 8 | 1 | 150 | 150 t/h | 800 t | 0 m | on the site |
| Rail freight terminal (`rail_terminal`) | rail | 2 | 1870 | £40,000 | £700 | 30 | 2 | 250 | 500 t/h | 3,000 t | 40 m | 140 × 24 m beside |
| Marshalling yard (`marshalling_yard`) | rail | 3 | 1930 | £140,000 | £2,000 | 60 | 4 | 350 | 1,400 t/h | 8,000 t | 120 m | 220 × 58 m beside |
| Jetty (`jetty`) | water | 1 | 1800 | £8,000 | £150 | 10 | 1 | 120 | 120 t/h | 1,000 t | 0 m | 44 × 12 m out into the water |
| Quay (`quay`) | water | 2 | 1800 | £45,000 | £800 | 40 | 2 | 250 | 500 t/h | 4,000 t | 40 m | 120 × 26 m out into the water |
| Bulk or container terminal (`port_terminal`) | water | 3 | 1960 | £180,000 | £2,800 | 90 | 3 | 600 | 1,800 t/h | 15,000 t | 150 m | 180 × 50 m out into the water |

Each tier also has `queue` (vehicles that can wait off the road or the main line) and
`manoeuvre` (1, 0.7, 0.5 down the ladder: reversing into a kerbside bay and running round take
longer than driving through). The starter tiers keep the 2D stations' numbers: a loading bay
holds 200 and costs 1,000, a lorry depot 600 and 5,000, private sidings (the 2D rail station)
800 and 6,000. `station2D` names the 2D kind.

### Cargo classes and handling fits

Each cargo is `bulk` (coal, stone, ore, grain), `general` (timber, sawn timber, steel, goods,
food, beer, livestock) or `liquid` (crude oil, fuel, chemicals). Standard handling moves bulk and
general at the tier's rate and liquids at 0.35 of it (drums). A tier can be fitted with kit that
suits one class; the others stay at standard, and nothing is ever zero.

| Fit | Suits | Rate | Stop time | Extra cost | From | On |
|---|---|---|---|---|---|---|
| Conveyor and hopper | bulk | x1.6 | x0.7 | +30% | 1880 | bays, depot, road terminal, sidings, jetty, quay |
| Rapid loader | bulk (general x0.5) | x2.5 | x0.35 | +60% | 1965 | rail freight terminal, marshalling yard |
| Loading gantry | general | x1.6 | x0.7 | +40% | 1880 | rail freight terminal, marshalling yard |
| Tank farm | liquid | x1.5 (from 0.35) | x0.6 | +50% | 1890 | every tier |
| Grab cranes | bulk | x1.8 | x0.6 | +40% | 1900 | quay, bulk or container terminal |
| Container cranes | general | x2 | x0.4 | +50% | 1968 | bulk or container terminal |

`offers()` recommends the fit that moves most of the site's own traffic (a refinery's road
terminal comes with a tank farm, a colliery's sidings with a conveyor), falling back to a
cheaper one unless the better one gains more than 5%, and never one from a later era.

### Units

Flows are tonnes (or the cargo's own unit) per game hour; durations are game days; money is the
2D game's. The 2D rates are per simulated second and it reviews production once a minute, so one
game hour is taken to be `SIM_SECONDS_PER_HOUR = 60` simulated seconds: a colliery at level 1
(1.1 a second) makes 66 t an hour. That constant is the only exchange rate; the economy can
change it.

## The rules (`rules.ts`)

All pure functions over plain data. Nothing mutates its input, so a save needs only
`SiteTerminals` per site and the economy can call anything speculatively.

### What a site moves

`specFor(type, variant)` turns an industry type into a `SiteSpec`: its outputs and inputs in t/h
at level 1, the modes it can use, whether it's waterside and its catchment. A cycle of an `any`
processor, a hub or the docks' exports takes one input, so each input's expected share is split
between them; an `all` processor needs every input (the steelworks: coal, ore and limestone).
`townSpec(name, population, waterside)` does the same for a town's goods depot: it only
unloads, taking goods, food, beer, fuel, stone and sawn timber per thousand people.

### Capacity and the level cap

A terminal's berths either load or unload, so a site's traffic both ways shares them. For one
terminal:

```
levels per hour = berths / Σ over the site's cargoes (flow at level 1 / (t/h per berth x suitability))
```

Terminals work in parallel, so a site's `levelCap` is the sum over its open terminals (a building
or mothballed one counts for nothing). `capacity(spec, st)` reports the cap, what it means in t/h
each way and per cargo, each mode's tier, berths and stock, and the site's catchment with the
best terminal's bonus added: a big terminal gathers from further off.

`dwellHours(handling, cargo, load)` is how long a vehicle stands: the mode's fixed stop (0.15 h
for a lorry, 0.5 h for a train, 2 h for a ship) times the tier's `manoeuvre` and the fit's
`dwell`, plus the load over its berth's rate. `dwellFactor` is the same as a multiple of a starter
terminal's stop for a typical vehicle, the factor to put on the 2D game's `LOAD_TIME`.

### Growth

`review(spec, st, ctx, level, flows)` is the 2D game's review, held to what the terminals can move:

- over 60% of output collected: the level rises x1.12, up to 4, but not past `max(1, levelCap)`.
  If it would have gone further, `capped` is set;
- under 15% collected: it falls x0.96, not below 1;
- sinks and towns use how much of their input capacity was unloaded instead.

### Pressure and unlocking

`pressure(spec, st, flows)` reads what the economy saw over the review window (`SiteFlows`: t/h
produced, moved, arrived and unloaded; how full the stockyard is; vehicles waiting per mode):

- **stockpiling**: the stockyard is over 90% full;
- **queueing**: on average half a vehicle or more is waiting for a berth in some mode;
- **capped**: growth was held back at this review;
- **pressing** = (stockpiling with the berths over 85% busy) or queueing or capped;
- **underused** = stockpiling with the berths under 50% busy: the site needs vehicles, not concrete.

Each site has a `grade`, the highest rank growth has made available. It starts at 1 (the docks,
which come with a quay, at 2) and only rises: when a review finds the site pressing and the player
owns a terminal of the current grade, the grade goes up one and that rank opens in every mode the
site can use, in era. The review returns the tiers `unlocked` and an event with the reason.
Owning one is required so that a site can't race up the ladder while the player ignores it.

### Offers

`offers(spec, st, ctx)` lists all nine tiers for the site with a `status`, a price, what each
would move, and a reason in plain words:

| Status | Meaning | `block` | Example reason |
|---|---|---|---|
| `owned`, `building` | the current terminal, or the one being built | | "Moves 224 t/h", "Being built: opens on day 36" |
| `superseded` | a lower rank than the one owned | `superseded` | "Part of the lorry depot" |
| `available` | can be bought now | | "Moves 500 t/h: 11x what the site can move now" |
| `locked` | above the site's grade | `grade` | "Unlocks when output presses against what the terminals can move" |
| `era` | not invented yet | `era` | "From 1955" |
| `blocked` | allowed, but something's in the way | `rail`, `road`, `room`, `busy` | "Needs a rail line to the site", "No room beside the site (it needs 38 × 42 m)", "Wait for the lorry depot to open" |
| `not_offered` | the site can't use this mode | `mode`, `water` | "A colliery isn't built by the water", "Not on the water: the plot needs a waterside edge" |

The price of an upgrade is the new tier (with its fit) less half the current one: the ground
works and track are reused. `gain` is the site's capacity with the offer in place of the mode's
current terminal over its capacity now. `SiteContext` says what the world knows: the year, today,
whether a rail line reaches the site, whether it has a road and water, and a `room(mode, tier)`
callback (see `roomCheck` below) for whether there's land.

### Suggestions

`suggest(spec, st, ctx, level, flows)` returns the one thing worth saying, if anything, in this
order:

1. a terminal idle for 30 days: "The loading bay has had no lorries for 45 days and costs £40 a day";
2. only mothballed terminals: "The lorry depot is mothballed: reopening it costs £500";
3. underused: "Add lorries: the lorry depot is only 15% used";
4. nothing open yet: "Nothing collects from the colliery yet: a loading bay would move 80 t/h";
5. pressing, with the cheapest available offer that lets the site take its next growth step, or
   failing that the one that moves most:
   - "Colliery output is stockpiling: a lorry depot would move 4.5x more"
   - "Trains are queueing at the private sidings: a rail freight terminal serves 2 at once" (a
     queue is answered with a bigger terminal of the same mode where there is one)
   - "Colliery can't grow past 212% until more can be moved: private sidings would move 2.7x more"
6. pressing with nothing to buy: what stands in the way of the smallest bigger terminal:
   "Lorries are queueing at the lorry depot. Private sidings: needs a rail line to the site".

### Buying

`apply(spec, st, ctx, purchase)` returns `{ ok, st, cost, events }` or `{ ok: false, reason }`
with the same reason the offer gives:

- `{ kind: 'build', mode, tier, fit? }`: a new terminal opens after its build days. An upgrade is
  built alongside: the old terminal keeps working until the new one opens (`pending`), and
  nothing more can be ordered in that mode meanwhile;
- `{ kind: 'refit', mode, fit }`: new handling kit for the kit's share of the tier's cost, fitted
  in a third of the build time;
- `{ kind: 'remove', mode }`: demolished for a 25% refund. The docks' own quay can't be removed;
- `{ kind: 'reopen', mode }`: a mothballed terminal back in use for 10% of its cost.

### Idle terminals

`tick(spec, st, days, served, day)` passes time. It opens what has finished building, completes
upgrades and refits, adds up upkeep (none while building, a fifth while mothballed), and ages
terminals no vehicle called at:

| Days without traffic | What happens |
|---|---|
| 30 | a warning, once, with what it costs a day |
| 90 | mothballed: it serves nothing, upkeep drops to a fifth |
| 365 | cut back a rank (keeping its fit if the lower tier takes it); a rank-1 terminal closes |

A downgraded terminal stays mothballed and its clock restarts at 90 days, so an abandoned
marshalling yard becomes a rail freight terminal, then private sidings, then nothing, over about
three years. Grade is never lost. A served terminal's idle days reset, and the docks' quay is only
ever mothballed.

### Several terminals at one site

Their capacities add. `shareOutput(st, available, demand)` splits an hour's output (or the
stockyard) between the terminals vehicles are calling at. Each cargo leans towards the terminal
that is comparatively best at it, not just fastest: a rapid loader outpaces a lorry depot even at
crates, but it's far better at coal, so the coal goes by rail and the crates by road. No terminal
gets more than its berths can move or its vehicles want (`demand`, t/h per mode), a mode with no
vehicles gets nothing, and the rest stays in the stockyard. It replaces the 2D rule of an even
split between stations capped by each one's `cap`.

### One call for the economy

`report(spec, st, ctx, level, flows?)` returns `capacity`, `production` (t/h in and out at the
level), `dwell(mode, cargo, load)` (hours, or null with no open terminal there), `offers` and the
`suggestion`.

`estimateFlows(spec, st, level, { lift, supply, stockFill, hours })` makes a plausible month of
`SiteFlows` from the level and the terminals, for previews ("what if I built this?") and the demo,
until the economy reports its own.

## Where terminals go (`layout.ts`)

`place(model, wanted, { water })` returns a `Placement` per terminal in site-local metres (+z
towards the road): its pad, its loading line (`spine`), which way it grows, its tracks, the end
where the line leaves, anything out over the water, and the world polygon of land it needs
outside the plot (null inside the plot).

```
                 water (a waterside site, or the docks)
   ┌────────────────── quay / jetty / port terminal, built out from the bank ─────────┐
   └──────────────────────────────────────────────────────────────────────────────────┘
   ┌──────────── rail freight terminal / marshalling yard (behind, if no water) ──────┐
   └──────────────────────────────────────────────────────────────────────────────────┘
                ┌─────────────────────────────┐
     rail yard  │  site          ═══ sidings  │  lorry depot /
     here when  │                             │  road freight terminal,
     the back   │          ▭▭ loading bay     │  on the frontage beside
     is water   └─────────── gate ────────────┘  the site's own bays
   ─────────────────────────── road ─────────────────────────────────────────────────
```

- Starter tiers use the site's anchors: the loading bay goes where the recipe put its lorry bays,
  private sidings on its siding line (up to two tracks). A site with no siding line gets a 12 m
  strip behind it instead, so "no siding space inside" becomes a land question.
- Road rank 2 and 3 go beside the site on the side of its bays, fronting the road.
- Rail rank 2 and 3 go behind the works, parallel to the back fence, at least as long as the site
  is wide. When the back is water they go off the far side from the road, continuing the sidings.
- Water tiers are built out into the water from the bank just behind the back fence. For the
  docks, that's beyond the old basin.
- Placement order is water, rail, road, and an annex that would overlap one already placed is
  pushed further out.

`roomCheck(model, current, opts, landFree)` gives `SiteContext.room`: the proposed tier's land
polygon goes to `landFree(poly, mode)` (the land registry's `free()`), and a refusal becomes
"No room behind the site (it needs 140 × 24 m)".

## Models (`models.ts`)

```ts
import { buildTerminals, fxModel, shownFor } from './terminals';

const t = buildTerminals(siteModel, shownFor(st), { water, year });
scene.add(t.group);                                   // one mesh, placed like the site
const handle = fx.add(fxModel(siteModel, t), state);  // cranes, belts, lamps, parked vehicles
```

Built with the industries `Site` and `Kit`, so the style matches: vertex colours, one material,
flat shading, bottoms left off. What each tier draws:

- **Loading bay**: two painted bays and a cabin; a hopper on legs fed by a belt from the site's
  stockpile (conveyor), or two small tanks and a tanker gantry (tank farm).
- **Lorry depot**: a fenced tarmac yard with a dock shed, four bays at a loading dock, an office,
  a fuel pump and a painted turning circle.
- **Road freight terminal**: a cross-dock shed with eight doors under a green canopy, a lorry
  park, a gatehouse with barrier and a weighbridge, high floodlights.
- **Private sidings**: tracks with buffer stops on the site's siding line, a ground frame hut; a
  loading bunker straddling the track (conveyor) or a loading rack (tank farm).
- **Rail freight terminal**: two loading roads and a run-round loop with crossovers; a goods shed
  and yard crane, an overhead crane runway with a travelling trolley (gantry), a silo on a portal
  fed by a belt and a hopper house (rapid loader; a site that only takes bulk in gets two hopper
  houses instead), or a tank farm and loading rack.
- **Marshalling yard**: the rail freight terminal, plus an arrival line, a six-road fan off a
  ladder, a control tower, a signal gantry and 22 m floodlight masts.
- **Jetty**: an apron, a timber trestle and T-head on piles; a hand crane, a belt and shiploader,
  or a pipe and loading arms with tanks.
- **Quay**: an apron and quay wall with bollards; a transit shed and portal cranes, grab cranes
  over a stockyard, a shiploader, or a tank farm with loading arms.
- **Bulk or container terminal**: three ship-to-shore gantries, container stacks and straddle
  carriers; grab cranes, stockyard heaps and a stacker-reclaimer; or an oil terminal.

Stockpiles on terminals (container stacks, stockyard heaps, tanks) are ordinary piles bound to
the site's own cargo, so they fill with its visual state. Berths grow with the tier (2, 4 and
14 lorry spaces counting the lorry park; wagons on every loading road; one ship per berth).
Triangles, highest at any site: rank 1 up to 656 (an oil jetty), rank 2 up to 1,126, rank 3 up
to 1,716. Tank farms are the dearest, as each tank is a lathe with an inside wall. The tested
budgets are 700, 1,600 and 2,600.

## Integration plan

1. **Economy state.** Keep a `SiteTerminals` per industry, and per town that has a goods depot,
   starting from `startingTerminals(id)`. Save it as it is: plain JSON.
2. **Production.** Replace the 2D hand-over (stock split evenly between stations in catchment with
   freight lines, each capped at its `cap`) with `shareOutput`, using each mode's demand from the
   lines calling there. Per-mode stock is the tier's `stock`.
3. **Reviews.** At the economy's review (the 2D game's minute, a game hour here), fill
   `SiteFlows` from its counters and call `review`. Apply the new level, keep the returned
   `st`, and post its events as news. Call `tick` once a game day with which modes were served,
   and charge its upkeep.
4. **Vehicles.** A vehicle's stop time is `report(...).dwell(mode, cargo, load)`. Berths are how
   many load at once; more wait (up to `queue`, then on the road or main line, which is what
   `queue` in `SiteFlows` counts).
5. **Stations and lines UI.** A line's stop at an industry is the site's terminal for that
   vehicle's mode, so there's no station to place by hand. With no terminal, the stop shows the
   mode's offers as a "Build terminal" card. The site panel shows the three ladders (as the demo's
   panel does), the production against capacity bar, and `suggest()`'s line; a suggestion can open
   the panel on the offered tier. The 2D `StationKind`s map to tiers through `station2D`.
6. **Land.** Pass `roomCheck(model, shownFor(st), { water }, (poly) => land.free(poly))` as
   `SiteContext.room`. On purchase, claim the placement's `land` as `terminal:<siteId>:<mode>`,
   and release it on removal or when a terminal is cut back to a smaller footprint.
7. **Rendering.** Build industries with `bare: true` once they're under economy control, and bake
   `buildTerminals(...).group` into the chunk with the site: same material, no extra draw calls.
   Add `fxModel(...)` to the shared `IndustryFx`. Rebuild on purchase, refit, downgrade or when an
   upgrade starts (`shownFor` shows what's being built).
8. **Catchment.** Use `capacity(...).catchment` in place of the type's catchment when deciding
   which neighbours and towns a site's terminals reach, and draw that ring.
9. **Rail and water.** `SiteContext.rail` is whether a line of the player's reaches the site
   boundary; `water` whether the plot touches navigable water (`waterside: 'required'` types
   always do). Once the map has real coastlines, `waterline()` should come from the world.

## Viewing

`npx vite --port 4241`, then open `/industries-demo.html` and press **Terminals**. The selected site
is shown alone with its terminals. Tap a tier to buy or upgrade (a locked or blocked one shows its
reason), **Fit ▸** to cycle the handling kit, **✕** to demolish. **Review ▶** runs 30 days of the
stand-in economy; **Auto** keeps going; **Idle 30 days** passes a month with no vehicles.
**Rail line**, **Neighbours** (the land either side is taken) and **Waterside** change the world;
**Service** is how much of the output the player's vehicles try to lift.

Query parameters for screenshots:
`?focus=coal_mine&terminals=1&tset=road:lorry_depot:conveyor,rail:rail_terminal:rapid_loader&level=2&fill=0.9&service=1&rail=0&water=1&crowded=1&reviews=3&idle=120&night=1&ui=0&zoom=260`.
`window.demo.terminals` has `buy(mode, tier, fit)`, `do(purchase)`, `step(days, idle)`,
`set({...})`, `preset(spec)` and `state()`.
