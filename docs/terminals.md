# Terminals

Loading and unloading facilities a player buys for an industry, one ladder of three tiers per
transport mode. A terminal is that site's station for that mode, and what it can move caps how
far the industry can grow. So terminals are the upgrade path: when a site's output presses
against them, the next tier becomes available to buy and the game says why ("Colliery output is
stockpiling: a lorry depot would move 4.5x more").

Everything lives in `src/proto/terminals/`. It reads the industries catalogue and draws with the
industries kit, and nothing outside the demo depends on it yet. The plan for the live game is
at the end.

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
   the chains (industries/chains.ts): what each site makes and takes an hour at level 1, this year
                  │
                  ▼
           production level (1..4, the 2D game's rate multiplier)
                  │ x1.12 a monthly review while over 60% of output is collected
                  ▼
   output ──▶ terminals vehicles can reach (berths x t/h, per mode) ──▶ vehicles on lines
                  │ can't move more? the level stops rising ("capped"), or eases back to what they can
                  ▼
   pressure: stockyard full with berths busy, berths flat out, vehicles queueing, or growth capped
                  │ and a terminal of the current grade has worked (open, reachable, called at)
                  ▼
   grade + 1: the next rank opens in every mode the site can use, where the site needs it
```

## The catalogue

Three modes, `road`, `rail` and `water`. An industry's `serve` kinds map onto them (`lorry`,
`rail`, `quay`). A mode the industry can't use is never offered.

| Tier | Mode | Rank | From | Cost | Upkeep/day | Build days | Berths | t/h per berth | Nominal | Coal, stops and all | Stock | Catchment + | Land |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Loading bay (`loading_bay`) | road | 1 | 1800 | £1,000 | £150 | 2 | 2 | 160 | 320 t/h | 195 t/h | 200 t | 0 m | on the site |
| Lorry depot (`lorry_depot`) | road | 2 | 1910 | £5,000 | £500 | 6 | 4 | 180 | 720 t/h | 479 t/h | 600 t | 20 m | 38 × 42 m beside |
| Road freight terminal (`road_terminal`) | road | 3 | 1955 | £24,000 | £1,800 | 20 | 8 | 200 | 1,600 t/h | 1,143 t/h | 1,500 t | 60 m | 66 × 56 m beside |
| Private sidings (`sidings`) | rail | 1 | 1830 | £6,000 | £500 | 8 | 1 | 255 | 255 t/h | 167 t/h | 800 t | 0 m | on the site |
| Rail freight terminal (`rail_terminal`) | rail | 2 | 1870 | £40,000 | £2,000 | 30 | 2 | 300 | 600 t/h | 417 t/h | 3,000 t | 40 m | 140 × 24 m beside |
| Marshalling yard (`marshalling_yard`) | rail | 3 | 1930 | £140,000 | £6,000 | 60 | 4 | 320 | 1,280 t/h | 960 t/h | 8,000 t | 120 m | 220 × 58 m beside |
| Jetty (`jetty`) | water | 1 | 1800 | £8,000 | £600 | 10 | 1 | 150 | 150 t/h | 115 t/h | 1,000 t | 0 m | 44 × 12 m out into the water |
| Quay (`quay`) | water | 2 | 1800 | £45,000 | £3,000 | 40 | 2 | 250 | 500 t/h | 357 t/h | 4,000 t | 40 m | 120 × 26 m out into the water |
| Bulk or container terminal (`port_terminal`) | water | 3 | 1960 | £180,000 | £10,000 | 90 | 3 | 600 | 1,800 t/h | 1,125 t/h | 15,000 t | 150 m | 180 × 50 m out into the water |

"Nominal" is berths x t/h per berth. "Coal, stops and all" is what the berths really move when
turning round the mode's typical vehicle (a 20 t lorry, a 240 t train, a 1,000 t coaster), with
the fixed part of each stop included (see `berthRate`).

Each tier also has `queue` (vehicles that can wait off the road or the main line) and
`manoeuvre` (1, 0.7 or 0.5 down the ladder: reversing into a kerbside bay, or running round,
takes longer than driving through). The starter tiers keep the 2D stations' cost and cap: a
loading bay costs £1,000 and holds 200, a lorry depot £5,000 and 600, private sidings (the 2D
rail station) £6,000 and 800. `station2D` names the 2D kind. Each starter moves a level-1 site
of every 2D industry at standard handling. Upkeep is at least a hundredth of what one vehicle
using the terminal costs to run a day, so an idle terminal is worth closing.

### Cargo classes and handling fits

Each cargo is `bulk` (coal, stone, ore, grain), `general` (timber, sawn timber, steel, goods,
food, beer, livestock) or `liquid` (crude oil, fuel, chemicals). Standard handling moves bulk and
general at the tier's rate and liquids at 0.35 of it (in drums). A tier can be fitted with kit
that suits one class. The other classes stay at the standard rate, and no rate is ever zero.
Bulk unloads twice as fast as it loads by road and rail (it tips out, or drops through a hopper
wagon's doors). A ship's hold still has to be grabbed out.

| Fit | Suits | Rate | Stop time | Extra cost | From | On |
|---|---|---|---|---|---|---|
| Conveyor and hopper | bulk | x1.6 | x0.7 | +30% | 1880 | lorry depot, road terminal, sidings, jetty, quay |
| Rapid loader | bulk (general x0.5) | x2.5 | x0.35 | +60% | 1965 | rail freight terminal, marshalling yard |
| Loading gantry | general | x1.6 | x0.7 | +40% | 1880 | rail freight terminal, marshalling yard |
| Tank farm | liquid | x1.5 (from 0.35) | x0.6 | +50% | 1890 | every tier but the loading bay |
| Grab cranes | bulk | x1.8 | x0.6 | +40% | 1900 | quay, bulk or container terminal |
| Container cranes | general | x2 | x0.4 | +50% | 1968 | bulk or container terminal |

The loading bay takes no special kit: a hopper or a tank farm is what a lorry depot is for.
`offers()` recommends the fit that moves most of the site's own traffic (a refinery's road
terminal comes with a tank farm, a colliery's sidings with a conveyor). It picks the cheaper fit
unless the better one moves more than 5% more, and never offers a fit from a later era.

### Units and the clock

The clock is the economy layer's (`claude/work-economy`, `TUNE.monthDays = 30`):

- flows are tonnes (or the cargo's own unit) per game hour;
- durations are game days;
- production is reviewed once a game month (`REVIEW_DAYS = 30`);
- `tick()` runs once a game day.

The 2D rates are per simulated second, so one game hour is taken to be
`SIM_SECONDS_PER_HOUR = 60` of them. A colliery at level 1 (1.1 a second) makes 66 t an hour.
Money is the 2D game's, and so is a vehicle's running cost per game hour (the 2D minute).
`dwellFactor()` converts a stop into multiples of the 2D game's `LOAD_TIME`, for anything still
on the 2D clock.

## The rules (`rules.ts`)

These are pure functions over plain data. Nothing mutates its input, so a save needs only a
`SiteTerminals` per site, and the economy can call anything speculatively.

### What a site moves: from the chains

`specFor(type, variant, year)` turns an industry type into a `SiteSpec`: its outputs and inputs
in t/h at level 1, the modes it can use, whether it's waterside, and its catchment. The numbers
are what the chains' `runCycles` (`industries/chains.ts`) makes and uses in a game hour at
level 1, with every input the chain can supply that year:

- Only flows running that year count: an input someone else makes, an output someone else
  takes. The docks export coal until 1984 and import it from 1985. A goods factory in 1800 has
  only sawn timber.
- An `all` processor needs every input. An optional boost (the steelworks' limestone) counts,
  with the extra output it makes, when something supplies it.
- An `any` processor's cycles are shared equally between the inputs it can get.
- Sinks and hubs move `rate x level` in all, shared between what they take.
- The docks import `rate x level` of each import. Exports are taken in full, sized as a level's
  worth of each.

The test "moves what the chains' production rule makes and uses in an hour at level 1, every
year" holds this to `runCycles`, for every type, every variant and every era.

`townSpec(name, population, waterside)` does the same for a town's goods depot. It only unloads,
taking goods, food, beer, fuel, stone and sawn timber per thousand people.

### No tier bigger than the chain can supply

`enoughIn(spec, mode, year)` finds the smallest tier in a mode that, with the best kit of the
year, moves everything the site will ever make or take (its traffic at level 4). Anything
bigger is sized for more than the chain can supply there. It isn't offered (`not_offered`,
block `oversized`, "Not needed: a lorry depot with conveyor and hopper can move all the colliery
makes at full production"). So a colliery never sees a marshalling yard.

Two tests keep this honest:

- "offers no tier bigger than the smallest that moves all a site will ever make", for every
  type every 10 years;
- "still lets every site reach full production with what it is offered".

The most any offered terminal moves, over all its site will ever make, is under 5x. That's a
colliery's rail freight terminal with a rapid loader, which fills a train in minutes and then
waits for the next one.

### Capacity, reach and the level cap

A terminal's berths either load or unload, so a site's traffic both ways shares them:

```
levels per hour = berths / Σ over the site's cargoes (flow at level 1 / berthRate(tier, fit, cargo, direction))
```

Terminals work in parallel, so a site's `levelCap` is the sum over its **working** terminals:
open, and reachable by their vehicles. `reachOf(spec, ctx, served)` decides reach:

- a rail terminal with no rail line to the site counts for nothing;
- so does a road terminal with no road;
- so does a water terminal off the water;
- when the economy says which modes were called at (`served`), so does one nobody called at.

A terminal that is building or mothballed also counts for nothing.

`capacity(spec, st, reach)` reports:

- the cap, and what it means in t/h each way and per cargo;
- each mode's tier, berths, stock and whether it's reached;
- the site's catchment, with the best working terminal's bonus added (a big terminal gathers
  from further off).

`dwellHours(handling, cargo, load)` is how long a vehicle stands at the terminal. It's the mode's
fixed stop (0.08 h for a lorry, 0.5 h for a train, 2 h for a ship), times the tier's `manoeuvre`
and the fit's `dwell`, plus the load over the berth's handling rate. `berthRate` is the same stop
turned into t/h for the mode's typical vehicle. Capacity is worked out from `berthRate`, so a
berth's rating and the time vehicles stand in it can't disagree.

### Growth

`review(spec, st, ctx, level, flows)` is the 2D game's monthly review, held to what the working
terminals can move:

- **More than they can move** (a terminal was demolished, cut off or mothballed): the level
  eases back x0.96 a review to what they can move, and counts as capped.
- **Over 60% collected:** the level rises x1.12, up to 4, but not past `max(1, levelCap)`. If it
  would have gone further, `capped` is set.
- **Under 15% collected:** it falls x0.96, not below 1.
- **Otherwise it holds steady,** unless the stockyard is full. Then what's made is going to
  waste, so it eases back x0.96 until what's collected is 60% of it.

Sinks and towns use how much of their input capacity was unloaded instead.

### Pressure and unlocking

`pressure(spec, st, flows)` reads what the economy saw over the month (`SiteFlows`): t/h
produced, moved, arrived and unloaded, how full the stockyard is, and vehicles waiting per mode.

- **stockpiling**: the stockyard is over 90% full.
- **saturated**: the berths are 95% busy, or 85% busy with vehicles waiting. A site that only
  takes cargo in (a power station, a town) has no stockyard to fill, so this is how it shows it
  needs more.
- **queueing**: on average half a vehicle or more is waiting for a berth in some mode.
- **capped**: growth was held back at this review.
- **pressing** = (stockpiling with the berths over 85% busy), or saturated, or queueing, or
  capped.
- **underused** = stockpiling with the berths under 50% busy. The site needs vehicles, not
  concrete.

Each site has a `grade`, the highest rank growth has made available. It starts at 1 (at 2 for the
docks, which come with a quay) and only rises. When a review finds the site pressing, and a
terminal of the current grade **has worked** (open, reachable, and called at by the economy's
word, or failing that not idle for a month), the grade goes up one. A terminal that is building
or mothballed hasn't worked. So a site nobody serves can't be walked up the ladder by ordering
and cancelling. The review returns the tiers `unlocked`, which are only the ones the site could buy
now (not a rail tier with no rail line, nor one it will never need), and a news event with the
reason.

### Offers

`offers(spec, st, ctx)` lists all nine tiers for the site. Each has a `status`, a price, what it
would move, and a reason in plain words:

| Status | Meaning | `block` | Example reason |
|---|---|---|---|
| `owned`, `building` | the current terminal, or the one being built | | "Moves 224 t/h", "Being built: opens on day 36" |
| `superseded` | a lower rank than the one owned | `superseded` | "Part of the lorry depot" |
| `available` | can be bought now | | "Moves 500 t/h: 11x what the site can move now" |
| `locked` | above the site's grade | `grade` | "Unlocks when output presses against what the terminals can move" |
| `era` | not invented yet | `era` | "From 1955" |
| `blocked` | allowed, but something's in the way | `rail`, `road`, `room`, `busy` | "Needs a rail line to the site", "No room beside the site (it needs 38 × 42 m)", "Wait for the lorry depot to open" |
| `not_offered` | the site can't use this mode, or doesn't need this big a terminal | `mode`, `water`, `oversized` | "A colliery isn't built by the water", "Not on the water: the plot needs a waterside edge", "Not needed: …" |

An upgrade costs the new tier (with its fit) less half the current one, because the ground works
and track are reused. There's no trade-in on a terminal the site came with (the docks' quay),
since the player never paid for it. `gain` is the site's capacity with the offer in place of the
mode's current terminal, over its capacity now. `SiteContext` says what the world knows: the
year, today, whether a rail line reaches the site, whether it has a road and water, and a
`room(mode, tier)` callback (see `roomCheck` below) for whether there's land.

### Suggestions

`suggest(spec, st, ctx, level, flows)` returns the one thing worth saying, if anything, in this
order:

1. a terminal idle for 30 days: "The loading bay has had no lorries for 45 days and costs £150 a day";
2. only mothballed terminals: "The lorry depot is mothballed: reopening it costs £500";
3. open terminals, none of which a vehicle can reach: "No train can reach the rail freight
   terminal: it needs a rail line to the site";
4. underused: "Add lorries: the lorry depot is only 15% used";
5. nothing open yet: "Nothing collects from the colliery yet: a loading bay would move 195 t/h";
6. pressing, with the cheapest available offer that lets the site take its next growth step, or
   failing that the one that moves most:
   - "Colliery output is stockpiling: a lorry depot would move 2.5x more"
   - "Trains are queueing at the private sidings: a rail freight terminal serves 2 at once" (a
     queue is answered with a bigger terminal of the same mode where there is one)
   - "Colliery can't grow past 212% until more can be moved: private sidings would move 1.9x more"
7. pressing with nothing to buy: what stands in the way of the smallest bigger terminal, as in
   "Lorries are queueing at the lorry depot. Private sidings: needs a rail line to the site".

### Buying

`apply(spec, st, ctx, purchase)` returns `{ ok, st, cost, events }`, or `{ ok: false, reason }`
with the same reason the offer gives. `cost` is negative for a refund.

| Purchase | What happens | Money |
|---|---|---|
| `{ kind: 'build', mode, tier, fit? }` | A new terminal opens after its build days. An upgrade is built alongside (`pending`): the old terminal keeps working until the new one opens, and nothing else can be ordered in that mode meanwhile. | tier + fit, less half the current terminal (none for a built-in one) |
| `{ kind: 'refit', mode, fit }` | New handling kit, fitted in a third of the build time. On an upgrade under way, it changes the kit ordered. | the kit's share of the tier's cost |
| `{ kind: 'cancel', mode }` | Stops unfinished work. A new terminal goes altogether. An upgrade or refit is dropped, and the old terminal stays. | half of what was paid comes back |
| `{ kind: 'remove', mode }` | Demolished. An upgrade under way is cancelled with it. At the docks, a terminal built on the quay goes back to the quay, which can't itself be removed. | 25% of the list price back, plus half of any unfinished work |
| `{ kind: 'reopen', mode }` | A mothballed terminal back in use. | 10% of its price |

Every route back pays out less than went in, so no order of build, upgrade, refit, cancel and
remove makes money. The review tests try all of them.

### Idle terminals

`tick(spec, st, days, served, day)` passes time:

- it opens what has finished building, and completes upgrades and refits;
- it adds up upkeep (none while building, a fifth while mothballed);
- it ages terminals no vehicle called at.

Work under way doesn't age, so an upgrade the player paid for is never cut back before it opens.

| Days without traffic | What happens |
|---|---|
| 30 | a warning, once, with what it costs a day |
| 90 | mothballed: it serves nothing, and upkeep drops to a fifth |
| 365 | cut back a rank (keeping its fit if the lower tier takes it); a rank-1 terminal closes |

A cut-back terminal stays mothballed, and its clock restarts at 90 days. An abandoned marshalling
yard becomes a rail freight terminal, then private sidings, then nothing, over about three
years. Grade is never lost. A served terminal's idle days reset. The docks' own quay is only ever
mothballed, and a bigger terminal built on it is cut back to the quay and no further.

### Several terminals at one site

Their capacities add. `shareOutput(st, available, demand)` splits an hour's output (or the
stockyard) between the terminals vehicles are calling at. Each cargo leans towards the terminal
that is comparatively best at it, not just the fastest. A rapid loader outpaces a lorry depot even
at crates, but it's far better at coal, so the coal goes by rail and the crates by road.

- No terminal gets more than its berths can move or its vehicles want (`demand`, t/h per mode).
- What one terminal can't take is offered again to those with berths and vehicles to spare.
- A mode with no vehicles gets nothing, and what nobody can take stays in the stockyard.

This replaces the 2D rule of an even split between stations, each capped by its `cap`.

### One call for the economy

`report(spec, st, ctx, level, flows?)` returns:

- `capacity`;
- `production` (t/h in and out at the level);
- `dwell(mode, cargo, load)` (hours, or null with no working terminal there);
- `offers`;
- the `suggestion`.

`estimateFlows(spec, st, level, { lift, supply, stockFill, hours }, ctx)` makes a plausible month
of `SiteFlows` from the level and the terminals, for previews ("what if I built this?") and the
demo, until the economy reports its own. Only terminals vehicles can reach work in it. Nothing is
served or queued at when nothing calls.

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
Tank farms cost the most triangles, as each tank is a lathe with an inside wall. The tested
budgets per terminal are 700, 1,600 and 2,600 by rank. All of one site's terminals together
stay within `SITE_TERMINAL_TRIS` (4,000), on top of the site's own 1,000 to 1,600. That is
tested with the heaviest tier and kit each mode could be sold.

## Plan for the live game

The industries are being wired into the game on `claude/work-int-industries`, the economy is on
`claude/work-economy` (`src/proto/economy.ts`), and the HUD is in `src/proto/ui/shell.ts`
(`docs/hud.md`). Terminals join them in the steps below. Each step can land and be played on its
own, and each names the file it touches and what proves it works.

### 1. State and saves (economy)

- `IState` (economy.ts) gains `terminals: SiteTerminals`. It starts from
  `startingTerminals(typeId)`, which gives the docks their quay, and nothing to anyone else.
- `ind.rate` stays the production level, 1 to 4.
- `Economy.save()` writes `terminals` with each industry, and `restore` reads it back. A save
  from before terminals gets `startingTerminals`, plus a starter terminal in each mode the site
  already has a freight stop for, so an existing game keeps working.
- `specFor(typeId, variant, year)` is cached per industry and recomputed when the year crosses
  one of the chains' era edges (the docks' coal flips in 1985).
- The economy's 2D `IndustryKind` maps to the 3D catalogue's `IndustryId`. Where
  `claude/work-int-industries` keeps both, the mapping lives in one table next to `specFor`'s
  call, not in the rules.
- **Test:** save, load and compare; an old save gets its starters.

### 2. Production: the economy feeds the rules, the rules set the level

- **Monthly review** (`reviewIndustries`, every `TUNE.monthDays`). Build `SiteFlows` from what
  the economy already counts, divided by the hours in the month:
  - `produced`, `moved` and `received` → `arrived`/`unloaded`;
  - `stockFill` = stock over the terminal's `stock`;
  - `queue[mode]` = average vehicles waiting at the site's stop in that mode (econlines knows
    when a vehicle arrives and when it leaves);
  - `served[mode]` = whether any vehicle loaded or unloaded there this month.

  Call `review(spec, st, ctx, ind.rate, flows)`. Set `ind.rate = r.level` and
  `ind.terminals = r.st`, and emit `r.events` as news (an `unlocked` event carries the industry
  id, so tapping it opens the sheet below). This replaces the 2D up/down rule there, which
  `review` already contains, held to what the terminals can move.
- **Daily** (when the economy's clock crosses a day): call
  `tick(spec, st, 1, servedToday, day)`. Charge `upkeep` to the company's money under
  "Terminals", and emit its events (opened, idle warning, mothballed, cut back).
- **Handing output over** (`industryStep`). Replace the even split between stops, each capped
  by `st.def.cap`, with `shareOutput(st, stock, demand)`, where `demand[mode]` is t/h the lines
  calling at the site's stop in that mode would lift. A mode's stop holds at most its terminal's
  `stock`.
- **Vehicles.** A vehicle's stop time is `report(...).dwell(mode, cargo, load)` hours (on the 2D
  clock, `LOAD_TIME x dwellFactor`). Berths are how many vehicles load at once. More vehicles
  wait, up to `queue`, then on the road or the main line.
- **Test:** an economy run where a colliery with only a loading bay stops at its cap, unlocks
  the lorry depot, and grows once the depot opens.

### 3. The industry's info sheet

Tapping an industry opens `shell.openInfo`:

- **title:** the site name;
- **sub:** the variant;
- **facts:** "Makes 66 t/h coal", "Terminals move 195 t/h: enough for level 2.9", "Upkeep
  £150 a day";
- **meter:** `level / 4`;
- **note:** `suggest()`'s line;
- **actions:** **Terminals** (primary) and **Catchment**.

**Terminals** opens `shell.openSheet({ key: 'terminals:<id>', back: <the info sheet>, tabs: Road
· Rail · Water, tone: 'look' })`, one tab per mode the site can use (tabs for modes it can't use
are left out, not greyed). Each tab is that mode's ladder, rendered from `offers()`:

- the owned terminal with its throughput, berths and stock, and the actions **Fit**, **Cancel**
  (while building) and **Demolish** (with the refund in the button);
- the other tiers as cards: price for `available`; a lock and the reason for `locked`, `era` and
  `blocked`; "Not needed" for `oversized`.

Buying asks once ("Lorry depot, conveyor and hopper: £6,500, opens in 6 days"), then calls
`apply` and charges `cost` (a refund comes back the same way). It rebuilds the site's model and
re-renders the sheet in place (the same key).

The markup and wiring come out of the demo's `panel.ts` as a `terminalsSheet(el, site)`
function that both the demo and the game call, so there is one UI. It keeps the panel's rule of
Tabler icons (`terminals/icons.ts`) and no emoji.

### 4. Build → Freight

`main.ts` already registers the Freight category with a locked "Freight terminals" card. Once
step 3 is in:

- The card unlocks. Picking it starts `shell.startTool({ name: 'Freight terminal', spec: 'Tap an
  industry' })`. The industries light up, and those with an unlock waiting get a badge. Tapping
  one ends the tool and opens its Terminals sheet.
- Under it goes one card per industry whose `suggest()` has an `offer` (for example "Colliery ·
  stockpiling · Lorry depot £6,500"), sorted by how much growth is waiting. Picking one opens
  that sheet on the offered tier.
- Build → Stops' locked "Lorry depot" card goes. A freight stop at an industry *is* its
  terminal, so there's nothing to place by hand.

### 5. Land, reach and rendering

- **Land.** `Land`'s `Owner` gains `'terminal'`. `SiteContext.room` is
  `roomCheck(model, shownFor(st), { water }, (poly) => land.free(poly))`. On purchase, claim the
  placement's `land` as `terminal:<siteId>:<mode>`. Release it on demolition, and re-claim it
  smaller when a terminal is cut back.
- **Reach.** Each is worked out once per service change, not per frame:
  - `ctx.rail`: a player's track comes within 10 m of the plot outline;
  - `ctx.road`: the site's gate is on the road network;
  - `ctx.water`: the plot touches navigable water (`waterside: 'required'` types always do).
  Once the world has coastlines, `waterline()` comes from it.
- **Models.** Industries under economy control are built `bare: true`. `buildTerminals(...).group`
  is baked into the site's chunk with the same material, so there are no extra draw calls, and
  `fxModel(...)` goes into the shared `IndustryFx`. The chunk is rebuilt when `shownFor(st)`
  changes: on purchase, refit, cancel, demolition, cut-back, or when an upgrade starts (the
  upgrade is drawn from the day it's ordered). A whole site's terminals stay under
  `SITE_TERMINAL_TRIS` (4,000).
- **Catchment.** `capacity(...).catchment` replaces the type's catchment when choosing which
  neighbours and towns a site gathers from, and the catchment ring is drawn at that radius.

### 6. Order of work

| Step | Needs | Proves it |
|---|---|---|
| 1 state + 2 production | economy branch merged | an economy test: capped, unlock, grow |
| 3 info sheet | int-industries (tapping an industry) | a Playwright shot of the sheet on a phone |
| 4 Build → Freight | 3 | a shot of the tool and suggestion cards |
| 5 land, reach, models | 3 | shots of a colliery before and after a lorry depot, with `?anchors=1` |

`docs/reports/terminals/anchors-*.png` shows the demo doing step 5's models today. Tiers are
bought, then some demolished, on seven sites, with the site anchors in magenta.

## Viewing

Run `npx vite --port 4241`, open `/industries-demo.html` and press **Terminals**. The selected
site is shown alone with its terminals.

- Tap a tier to buy it, or to upgrade to it. A locked or blocked tier shows its reason.
- **Fit** cycles the handling kit, **Cancel** stops work under way, and the cross demolishes.
- **Review** runs one month of the stand-in economy, **Auto** keeps going, and **Idle a month**
  passes a month with no vehicles.
- **Rail line**, **Neighbours** (the land either side is taken) and **Waterside** change the
  world. **Service** is how much of the output the player's vehicles try to lift.

The panel uses Tabler icons (`terminals/icons.ts`) and no emoji.

Query parameters for screenshots:

```
?focus=coal_mine&terminals=1&tset=road:lorry_depot:conveyor,rail:rail_terminal:rapid_loader
 &level=2&fill=0.9&service=1&rail=0&water=1&crowded=1&reviews=3&idle=120&night=1&ui=0&zoom=260
 &anchors=1&zoomk=0.85
```

- `anchors=1` marks the site's gate, lorry bays, sidings and quay in magenta, above everything,
  so a screenshot shows whether the terminals sit on them.
- `zoomk` scales the fitted view.

`window.demo.terminals` has `buy(mode, tier, fit)`, `do(purchase)`, `step(days, idle)`,
`set({...})`, `preset(spec)` and `state()`.

### Screenshots

These are in `docs/reports/terminals/`, taken at 412 × 915 and 2x, with the anchors marked.
Each site is shown with its tiers bought, then again after some are demolished:

| Site | Bought | Then demolished |
|---|---|---|
| Colliery | lorry depot (conveyor), rail freight terminal (rapid loader) | the rail terminal |
| Steelworks, waterside | road freight terminal, marshalling yard (gantry), quay (grab cranes) | the quay and the road terminal |
| Docks, 1985 | container terminal on the quay, rail freight terminal (tank farm) | the container terminal, which leaves the docks' own quay |
| Refinery, waterside | lorry depot, rail freight terminal and jetty, all with tank farms | the depot and the jetty |
| Quarry | loading bay, private sidings (conveyor) | the sidings |
| Power station, waterside | rail freight terminal (rapid loader), quay (grab cranes) | the rail terminal |
| Sawmill | road freight terminal, private sidings | the road terminal |

The files are `anchors-<site>-bought.png` and `anchors-<site>-removed.png`, plus `panel.png` for
the panel itself.
