# Shopping complexes (`complexes.ts`, `buildgen.ts`)

A town centre's shopping is a few coherent buildings, not a clump of small ones. A complex is a `shop` lot
whose `arch` names its kind; `unitsOf(lot)` is how many shops it holds. The economy and the crowds multiply a
shop's jobs by it (`game/econ.ts`, `game/crowdsites.ts`), so the totals match the shops it replaces.

| `arch` | What it is | Where it comes from |
|---|---|---|
| `parade` | A terrace of shops under one roof: pilasters between the units, a fascia board over each in its own colours, often flats above and a canopy along the front. Pitched and chimneyed in older streets, parapet-roofed in newer ones, in the town's walling. | Neighbouring shop plots merged (`groupShops`) |
| `arcade` | A grand front on the high street, a tall opening into a glazed passage lined with small shops, cornices, and a glass roof running back. | Longer runs of shop plots (60 m and more) |
| `retailpark` | Big stores in a row at the back of their car park: glazed entrances in each store's colours, name boards, a canopy along the fronts, trolley shelters, trees in islands. The car park is real parking (docs/parking.md). | The shop-plot planner in towns and cities, out past the centre (`roads.ts` `lotSpec`) |
| `mall` | A covered centre: anchor stores at each end, a glazed mall roof and a dome where the ways cross, glazed entrances under canopies off the car park, lorry bays behind. | The planner, in city centres |

- **Stretches of shops.** Centre streets are shopping stretches or not by where they are, so shops come in
  runs that make complexes. The choice is made by position, not from the random stream, so every other plot
  comes out as it always has.
- **No overlaps.** A merged plot is only used where it has room (`net.lotFree`); otherwise its plots stay as
  they were.
- **Real maps.** The OS importer can give a big retail footprint `arch` to use these recipes.
- **Gallery.** `/buildings-demo.html` has a row of the four, in each tradition.
