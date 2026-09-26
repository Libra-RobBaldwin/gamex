# Parking (`game/parking.ts`)

Drives and car parks hold real vehicles from the traffic's own fleet, and trips start and end in
them.

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
- **Vehicles.** Parked cars are the area's mix for the year, without taxis, police cars or service
  vehicles; lorry bays get rigid lorries.

Stats: `traffic.parking.stats` (parked in, pulled out) and `traffic.stats` (`pulledOut`, `noRoom`,
`noPlan`).
