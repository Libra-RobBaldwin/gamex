# Parking (`game/parking.ts`)

Drives, car parks and kerbside bays hold real vehicles from the traffic's own fleet, and trips
start and end in them.

- **Spaces.** `buildgen.ts` hands each building's parking spaces over as `Bay`s: drives and parking
  pads at houses, car parks behind flats and offices, in front of surgeries and halls, beside works,
  and lorry bays at works and depots. Each has the way in from the road: the gate, the aisle and the
  space. With `setParkedCars(false)` (the game) nothing is drawn in them; demos and galleries still
  draw the old stand-in cars.
- **Drawn as traffic.** Parked cars go through `Fleet.drawCar` with `parked` set (no lamps), so they
  use the same instanced models as the cars on the road: no draw calls of their own. Only spaces in
  the cells round the view are drawn; the fleet culls to the frustum.
- **Arriving.** A trip that ends at a plot with a free space isn't faded out at the kerb: the traffic
  hands the car over where it stands, and it drives in along the gate, the aisle and into the
  space nose first.
- **Leaving.** A trip from a plot with a car parked there starts with that car reversing out and
  driving to the gate. There it waits until the traffic has room for it on the road; the traffic
  car stands unseen (`held`) in that gap while the parked car drives onto it, then carries on. If
  there's no room for 45 s (a queue past the gate) it parks again.
- **Time of day.** Off screen, plots drift towards the hour's share of cars: homes full at night and
  half empty by day, offices and works full by day and empty at night. Nothing appears or vanishes
  on screen.
- **Kerbside bays.** A street with parking bays (`RoadDef.parking`) has a kerbside space every
  6 m along each side's band, nose along the kerb the way that side's traffic drives (traffic
  keeps left, so the left band from a to b is that way's), only where the road has its own full
  width, and never on the stretch a stop paints out or on a pedestrian crossing's zig-zags
  (`roaddraw.ts kerbsideBays`; the drawer marks each space with a dash from the same list, and
  draws no cars of its own). The traffic keeps the spots for the roads near the view
  (`Traffic.syncKerbs`: once a second, for any road not yet done since the network last changed;
  roads gone or far away are dropped), filled like the plots along the street (a homes' street
  fills at night and half empties by day). A road rebuilt or split keeps its cars: a dropped
  spot's cars wait a moment for the spots that replace it and go back into the nearest space
  within half a space's length, so nothing vanishes on screen but a car whose space went.
- **Arriving at the kerb.** A trip ending at a plot with no free space of its own (or none at
  all) makes, on its last road, for the free kerbside space on its side of the street nearest
  the plot within 60 m: it stops ten metres short and pulls in nose first from the running
  lane. A space taken meanwhile is simply missed (the car fades out as ever).
- **Leaving from the kerb.** A trip from a plot with no car of its own starts with a car parked
  at the kerb within 60 m, on the side the trip sets off along, pulling out forwards into the
  lane; the traffic car stands unseen (`held`) a car's length or two ahead of the space, as at
  a gate. A parked car is never in the running lane: the band is beyond the lane, and the
  spaces lie clear of every stop's kerb.
- **Vehicles.** Parked cars are the area's mix for the year, without taxis, police cars or service
  vehicles; lorry bays get rigid lorries. Kerbside spaces get cars only.

Stats: `traffic.parking.stats` (parked in, pulled out, and of those at the kerb: `kerbIn`,
`kerbOut`) and `traffic.stats` (`pulledOut`, `noRoom`, `noPlan`). Tests: `game/parking.test.ts`
(spaces clear of the stop, the crossings and the lane; a trip that parks at the kerb; a kerbside
car that pulls out and joins the traffic; a split street keeping its cars).
