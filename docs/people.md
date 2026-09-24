# People and animals

`src/proto/people/` shows the town's people, dogs and livestock without simulating any of
them. The economy works out flows: how many are waiting at a stop, how many are walking from
the station to the works at a shift change, how many shoppers are on a stretch of high street,
how many dog walkers are in a park. This library turns those numbers into figures near the
camera, poses and moves them on the GPU, and fades them out with distance. The figures cost
nothing beyond drawing them. It follows the rule in `ENGINE.md`: simulate flows, show agents.

Try it with `npx vite --port 5199` and open `/people-demo.html`.

## The pieces

| File | Role |
|---|---|
| `flows.ts` | **Placement.** `Crowds` takes flows (below) and the clock and produces groups of figures. It also has helpers that build sites from road geometry (`footwaysOf`, `stopSite`, `parkLoop`) and `board()`/`alight()` for vehicles at stops. |
| `store.ts` | **Drawing.** `PeopleStore` owns the instanced meshes. Each frame it chooses a level of detail per group from how tall a person would look on screen, keeps to a budget, fades groups in and out, and uploads per-group numbers. `recordAt()` and `figures()` are the CPU twin of the shader, used for tests and picking. |
| `shaders.ts` | **Motion and pose.** Patches the game's Lambert material so the vertex shader places each instance along its route from the clock and poses it: walking (keyed to distance, so feet don't slide), running, waiting, sitting, cycling, pushing a pushchair, wheeling a wheelchair, dogs trotting and sniffing, cows grazing, pigeons pecking. Hats, hair, skirts and coats are reshaped per figure. Fades use a screen-door dither, so figures stay in the opaque pass and shadows fade with them. |
| `geometry.ts` | Low-poly bodies. A near person has at most about 150 triangles, 90–110 of them showing. Hidden optional parts (hats, bags, umbrellas) collapse to nothing. A middle-distance person has 52, and a far one is a camera-facing card of 2. There are also a quadruped (8 dog breeds, cat, sheep, cow), a bird (pigeon, duck), and a bike, pushchair and wheelchair. |
| `wardrobe.ts` | Who someone is. A role and a year (1900–2030) give their height, build, hair, clothes, hat, what they carry and their walking speed. The police are a made-up force (the Shire Constabulary: navy with a teal band), and the bus and rail liveries are invented. |
| `track.ts` | Routes as chains of straight and arc legs (`fitRoute`, `straightRoute`, `circleRoute`, `reverseRoute`), plus the CPU copy of the motion maths. |
| `schedule.ts` | Rough shapes of the day (shops, pub, rush hours, dog walkers) for places the economy doesn't yet give numbers for. |

### How a figure moves without the CPU

Each instance is 32 floats. They hold the route leg it's on (start, heading, curvature,
length), its speed and starting offset, its sideways offset, its timings (a one-off walk's
start, or when it appears and disappears), the route's length and where this leg starts, its
ground height, and its looks. The shader works out the distance along the route from `uTime`:

- **Loop:** round and round, fading at the route's ends. Used for footways, streams and crossings.
- **Closed:** a ring with no ends. Used for park loops, dogs running round their owner, and ducks.
- **Once:** waits at the start until `t0`, walks, then stands at the end until `tHide`. Used for boarding, alighting and shuffling up a queue.
- **Still:** stands, sits or idles on the spot.

A route with several legs has one record per leg, and only the leg a figure is on draws it.
Every leg therefore costs a full draw, so routes are fitted with as few arcs as possible (a
straight footway is one leg, a park loop is four).

## API

```ts
import { PeopleStore, BUDGETS } from './people/store';
import { Crowds, footwaysOf, stopSite } from './people/flows';

const store = new PeopleStore();
scene.add(store.root);
const crowds = new Crowds(store);
crowds.year = 1965;        // the era people dress for
crowds.timeScale = 240;    // game seconds per real second (main.ts: 4 game minutes a second)

// every frame (or every few frames for set()):
crowds.set(flows, clockMinutes);           // flows matched by id; counts ease, shapes rebuild
store.update(camera, canvasCssHeight, dt); // dt in real seconds; 0 when paused
store.rain = raining ? 1 : 0;              // umbrellas go up

// when a bus or train is at a stop:
const { n, until } = crowds.board(stopId, doors, capacityLeft); // first n walk to the doors
crowds.alight(stopId, doors, gettingOff);                       // step off, walk away
// keep the vehicle until `until` (store time), and take n off the economy's waiting count
```

### Flows

Every flow has a stable `id` (the same place must always use the same id). Counts are how many
people are **there at once**. The exception is `commute`, which takes a total and a time
window.

| Kind | Fields | What you see |
|---|---|---|
| `queue` | `site: QueueSite`, `waiting` | A bus queue running back along the pavement from the flag. The first three sit in the shelter, and a long queue doubles up. On a platform (`site.kind = 'platform'`), people spread along its length, thicker near the middle, standing back from the edge. Some have a dog sitting at their feet. |
| `walk` | `footway: {line, width, y}`, `count`, `mix?`, `dogs?` | Pedestrians both ways along a footway, loosely keeping left, with some dog walkers. Pushchairs and wheelchairs keep nearer the middle. The footway is split into ~90 m pieces, each culled on its own. |
| `ride` | `line`, `count` | Cyclists along a lane, in the direction the line runs. |
| `commute` | `path`, `total`, `window: [start, end]` (minutes after midnight), `mix?`, `width?` | A stream along the path while the window is open. It eases up as the window opens and away after it closes. |
| `cross` | `a`, `b`, `count` | People crossing between two kerbs, both ways. |
| `loiter` | `at`, `facing`, `width`, `count`, `venue` | Standing about in front of a building. At a `shop`, people look in the window. At a `pub`, people stand in rings, chatting. At a `gate`, parents wait. A `square` has loose clusters. |
| `park` | `area`, `paths?`, `benches?`, `walkers`, `dogWalkers`, `looseDogs?`, `joggers?`, `sitters?`, `kids?` | Strolls on a loop path (or the paths given), dog walkers with dogs on leads, dogs off the lead running rings round their owner or nosing about, people on benches, and children playing. |
| `school` | `gate`, `yard`, `approaches`, `pupils`, `arrive`, `leave`, `school?` | Pupils in the school's colours stream in along the approaches, younger ones with a parent. The yard fills as they arrive and empties at the bell. It fills again at break, dinner time and home time, and parents wait at the gate. |
| `animals` | `species` (`sheep`, `cow`, `pigeon`, `duck`, `cat`), `count`, `area?`, `spots?`, `lines?` | Livestock graze in loose knots, drifting slowly. Pigeons peck and potter about, ducks paddle, and cats sit on walls or walk along them. |

**Why commute is a stream, not a schedule.** The game's clock runs about 240 times faster
than people walk, so a 200 m walk takes more than 13 game hours at walking pace. A figure that
set off at 05:40 could never reach the works by 06:10. So the stream is sampled from its rate,
as traffic is. The path carries as many people at once as the flow implies (rate × time to
walk it, never more than the total). Those people appear at one end and are gone at the other.
Bursts tied to a particular vehicle use `alight()`.

### Levels of detail and budgets

`store.setBudget(BUDGETS[i])` sets these values:

| Setting | Meaning |
|---|---|
| `nearPx` | A person taller than this on screen (in CSS pixels) is drawn in full: limbs, hats, bags, umbrellas, and shadows if `shadows` is set. |
| `midPx` | Taller than this and shorter than `nearPx`: body, head, two legs and hat. |
| `farPx` | Taller than this: a camera-facing card, coloured head, top and legs. Shorter than this: nothing. |
| `near`, `mid`, `far` | The most figures each level may draw. Groups nearest the middle of the view are served first. Past the near budget, groups drop a level. Past the far budget, a group shows only its first few figures. |
| `buildsPerFrame` | How many groups may be built for the first time in one frame. The rest wait a frame and then fade in. |

A group changing level fades out at one level while it fades in at the next (0.6 s). A group
coming onto the screen appears at once, because it's culled with a margin and so is still off
screen when it appears. A count change eases in one figure at a time. Figures are numbered, and
only the first *count* show, so going from 12 to 13 adds one person and nobody else moves.

## Integration plan

The steps, in order. Each is small and can be tested on its own.

1. **Add the store to the scene** in `main.ts`, beside `Traffic`. Call
   `store.update(cam, canvas.clientHeight, dt)` in `frame()` after the camera is placed.
   Pass `dt = 0` when the game is paused. Set `crowds.timeScale = GAME_MIN_PER_S * 60`.
   Add the store's draw calls and triangles to the performance readout (`store.stats`).

2. **Tie budgets to the quality tiers.** `BUDGETS` uses the same five names as `TIERS` in
   `main.ts`. In `setTier(t)`, call `store.setBudget(BUDGETS[t])`. The lower tiers draw
   fewer, simpler figures, raise the size thresholds and drop people's shadows. Use
   `store.stats.updateMs` in `judgeFrames` if people ever dominate.

3. **Stops from `roads.ts`.** For each `RSeg` and each of its `stops`:
   - site id: `` `stop:${seg.id}:${st.id}` ``
   - point and heading: `pointAt(net.path(seg), st.s)`
   - kerb and back of pavement: `section(net, seg, st.s)` in `roaddraw.ts`, using `L` when
     `st.side === 1` and `R` otherwise, so lay-bys and narrowed pavements are respected.

   Then call `stopSite(id, p, atan2(uz, ux), st.side, kerb, back, { shelter: true })`.
   `st.side === 1` is the left of the road's a→b direction, the same as `stopSite`'s side.
   The economy supplies `waiting` per stop.

4. **Boarding synced with buses in `traffic.ts`.** Where a bus sets `c.dwell = 7` on reaching
   a stop (the `nextStop` branch in `step`):
   - Call `crowds.alight(siteId, [door], off)`.
   - Call `crowds.board(siteId, [door], capacity)`, where `door` is the bus position plus
     about 4 m forward and half its width towards the kerb.
   - Set `c.dwell = Math.max(7, until - store.time)`, so the bus waits while people are
     still walking to it.
   - Report `n` back to the economy as boarded.

   Trains at stations work the same way, with a list of doors: every car's door positions on
   the platform side.

5. **Footways from road cross-sections.** For each road segment with a pavement
   (`def.pave > 0`), call `footwaysOf(net.path(seg), kerbOf(def), halfOf(def))`. Roads with
   varying sections (lay-bys, tapers) can sample `section()` along the path and offset by
   `(kerb + back) / 2` instead. Give each side a `walk` flow whose `count` comes from the
   economy's footfall for that segment, by hour. Use `MIXES.highStreet` where the fronting
   lots are shops. Trim the footway back from junction corners by `jshape.ts`'s footway
   radius, so people don't walk through the corner radii.

6. **Crossings at junctions.** For each junction arm from `jshape.ts`, add a `cross` flow a
   few metres back from the stop line, from kerb to kerb. Scale its count with the footfall of
   the two footways it joins. Signalled crossings could later gate it on the pedestrian phase
   (see limits).

7. **Parks and yards from `infill.ts` regions.**
   - `park` and `pocket` regions: `park` flows with `area` as the outline of `region.cells`
     (or their bounding box). Put benches where `makeRegion` puts them, which is along the
     centre path every other cell.
   - `playground` regions: `park` with `kids`.
   - `allotments`: a few `loiter` figures.
   - A `pond` in a park: an `animals` flow of ducks.
   - Civic lots with `arch === 'school'`: a `school` flow with its gate on the frontage.
   - Pubs: `loiter` with `venue: 'pub'`.

8. **Works gates and shifts.** When the economy places staff at an industry, route from the
   nearest stop or station to the gate, along footways, with the road graph. Add a `commute`
   flow per shift: arrival inbound, and departure outbound from the gate. Its `total` comes
   from the jobs filled by public transport, which is the gameplay point: a works with a good
   station nearby shows crowds walking in at 06:00. Farms supply `sheep`/`cow` `animals`
   flows over their fields.

9. **The clock.** Pass the game clock (minutes) to `crowds.set()` every frame, or every few
   frames. It's cheap: flows are diffed by id, and only changed shapes rebuild. Use the
   economy's hourly numbers in place of `schedule.ts` as they arrive. Set `crowds.year` from
   the game's date. Changing the year rebuilds everyone, so do it on a year boundary.

10. **Streaming tiles.** Give flows tile-prefixed ids and remove a tile's flows when it
    unloads. Groups aren't built until first seen, and are cheap to drop.

## Limits and next steps

- Crossings aren't gated by signal phases yet. They'd need a periodic time window per
  instance, which the record has no slot for.
- People don't avoid each other. Streams are spread sideways, and loops at different speeds
  pass through each other. That's rarely visible at game zoom.
- Footways don't know about street furniture (lamp posts, bins, shelter posts).
- There are no seasons. Coats are by era, not month.
- A figure on a multi-leg route is drawn once per leg, with all but one collapsed. That's why
  routes are kept to a few arcs.
- Swiftshader timings in `docs/reports/people.md` are pessimistic. Measure on a phone before
  tuning the budgets.
