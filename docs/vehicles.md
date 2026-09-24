# The vehicle library

`src/proto/vehicles/` replaces the boxes in `traffic.ts` with real-looking vehicles. It is a
procedural library: 966 models from 32 invented makers and 37 invented operators, built from a
small kit of low-poly parts at three levels of detail, and drawn with one instanced mesh per
model and level. Every model has true UK dimensions (length, width, height, wheelbase, axle
positions, hitch points), so the traffic sim can use them, and economy stats (capacity, speed,
price, running cost), so the library doubles as the fleet the player buys.

The game's traffic is drawn with it (`src/proto/game/fleet.ts`); see "In the game" at the end.

- **Showroom:** `npx vite --port 5199`, then open `/vehicles-demo.html`. Parade, Showroom and
  Turntable views; filters for category, maker, operator and year; day and night.
- **Report:** what was built, the numbers and the screenshots are in
  [`docs/reports/vehicles.md`](reports/vehicles.md).

## The rules for names and shapes

Everything is invented, in the spirit of GTA: marques and operators with a national or period
flavour and loose links to the real world, but nobody's trademark.

- **Names are original.** No near-homophones, puns or one-letter changes of real makes, models or
  operators. `realnames.ts` lists about 1,300 real makes, models (British ones especially), and UK
  bus, coach, rail, freight, haulage, ferry and airline operators. A test compares every invented
  brand, operator, livery and model name with it and fails on anything within two edits (exact
  matches only for real names of three letters or fewer). Plain English words used descriptively
  (colours, "express", "coaches", "timber") may match; invented words may not. It caught about
  forty of my first-draft names (Pennard ≈ Panhard, Lumora ≈ Lumo, Brantley ≈ Bentley,
  Oakshire ≈ Yorkshire, Pellow ≈ Yellow Buses, Wessex & Mercia ≈ Wessex Trains and West Mercia,
  Aurelle ≈ Aurelia, Kinetta ≈ Ginetta, and more), which were renamed.
- **No lookalike badges.** A brand's badge is a plain colour (`accent`); grilles are generic
  shapes (a bar, an oval mouth, three bars, an egg-crate) rather than any maker's signature.
- **Shapes evoke eras, not models.** A 1960s saloon has a slab side, round lamps and chrome
  bumpers; a 1990s hatch a flush nose and black plastic; the half-cab decker has its open
  platform; the 1970s-style high-speed power car a long wedge nose. No model copies a specific
  real vehicle's distinctive design.
- **Places are fictional too.** The city is Oakport, the county Thornshire.

## Brand bible

Each maker has a country, a flavour and a design language the builders read: its grille, the
colours it's known for, and how sporty or upright its cars sit. Model lines expand into
generations (Mk I, Mk II… for road vehicles, or the build year for rail, boats and aircraft) and
body styles. The tables below are generated from `brands.ts`.

### Cars

**Hallbrook** · GB · British sports cars · 1928–2030  
A small works in the Welsh Marches that has built open two-seaters since the late twenties. Long bonnets, short tails, an oval mouth and wire wheels until the seventies; racing green is the house colour.  
Grille: oval · colours: `#1f4a33` `#b9bdc0` `#f2f2f0` `#9a1f1f` `#e0b42a` `#1e2f55` · badge: `#c9a33a`  
Lines: Coldharbour (convertible, vintage; 1928–1955) · Scarbeck (sports car, coupé; 1956–1981) · Quillon (coupé, sports car; 1972–1998) · Ridgemont (sports car, convertible; 1995–2030) · Fennick (supercar; 2004–2030)

**Ashcombe** · GB · British family cars · 1922–2005  
The Midlands volume maker: the car your uncle had. Honest saloons and estates, a wide bar grille, later a string of hatchbacks, and vans for every trade. Went under in 2005.  
Grille: bar · colours: `#2b4a73` `#b3261e` `#f2efe6` `#6b4a2b` `#2f5a3a` · badge: `#c9cdd0`  
Lines: Thorley (vintage, saloon; 1922–1954) · Kelsall (saloon, estate; 1948–1984) · Wickmoor (hatchback, saloon; 1959–2005) · Thursby (hatchback, saloon, estate; 1976–2005) · Radcot (saloon; 1962–1999) · Coverdale (small van, panel van; 1955–2005)

**Chalcott** · GB · British luxury · 1908–2030  
Coachbuilt saloons for people with drivers. A tall upright grille, round lamps long after everyone else, deep paint in claret, navy and black, and plenty of chrome.  
Grille: tall · colours: `#4a1c22` `#1e2a45` `#151515` `#b9bdc0` `#e8e0c8` `#2a3a2f` · badge: `#d9dde0`  
Lines: Ravelston (vintage; 1908–1939) · Highcombe (saloon; 1946–2030) · Wrenhaven (coupé, convertible; 1955–2030) · Aldwych (suv; 2016–2030)

**Varnholt** · DE · German executive · 1926–2030  
Stuttgart-flavoured engineering from a fictional Swabian town. A three-bar grille in a chrome frame, rectangular then slim lamps, silver and black paint, and a van range that tradespeople swear by.  
Grille: bars3 · colours: `#b9bdc0` `#141414` `#1e2f55` `#f2f2f0` `#6a6e72` · badge: `#8a969e`  
Lines: Tannfeld (saloon; 1950–2030) · Staufen (saloon, estate; 1955–2030) · Lindach (hatchback; 1974–2030) · Reisach (coupé, convertible; 1962–2030) · Oberau (suv; 1998–2030) · Lastwerk (panel van, minibus, ambulance; 1965–2030)

**Norrvik** · SE · Swedish estates · 1944–2030  
Boxy, safe and long-lived, from a works on the Baltic coast. Square estates with near-vertical tailgates, a wide flat grille and big rectangular lamps; beige and navy in the eighties.  
Grille: wide · colours: `#f2f2f0` `#1e2f55` `#c8b48a` `#2a3a2f` `#b9bdc0` `#6b2f2a` · badge: `#2f6fb8`  
Lines: Tornby (estate, saloon; 1956–1996) · Skarholm (estate, saloon; 1990–2030) · Lillvik (hatchback; 1995–2030) · Fjallby (suv; 2003–2030)

**Vessanti** · IT · Italian supercars · 1955–2030  
A Modenese-flavoured house of mid-engined wedges and front-engined grand tourers. A low wide mouth, pop-up lamps in the seventies and eighties, and red, yellow or orange paint.  
Grille: mouth · colours: `#c21a1a` `#f2c01a` `#f2f2f0` `#141414` `#e86a1a` `#1f6a3a` · badge: `#f2c01a`  
Lines: Brivido (sports car; 1955–1985) · Ostrega (coupé; 1962–2030) · Tuonare (supercar; 1968–2030) · Corvenza (supercar; 1990–2030)

**Morikawa** · JP · Japanese reliability · 1960–2030  
Never breaks down. Neat hatchbacks and saloons with a thin slot grille and wraparound lamps, pickups that outlive their owners, and a heavy-industry arm that builds trains and ships.  
Grille: slot · colours: `#f2f2f0` `#b9bdc0` `#cbbd96` `#b3261e` `#1e2f55` · badge: `#b3261e`  
Lines: Kiyora (saloon, estate; 1966–2030) · Kotori (hatchback; 1968–2030) · Kazenari (coupé, sports car; 1970–2010) · Takumaru (pickup, suv; 1978–2030) · Harukaze (people-carrier; 1990–2030) · Nimotsu (small van; 1975–2030)

**Hardesty** · US · American muscle and pickups · 1910–2030  
Detroit-flavoured and proud of it. An egg-crate chrome grille, twin round lamps, big V8 coupés with bonnet scoops and pickups the size of a garage.  
Grille: crate · colours: `#b3261e` `#141414` `#f2f2f0` `#1c2a55` `#8a5a2a` `#7aa82a` · badge: `#d9dde0`  
Lines: Boulevardier (vintage, saloon; 1910–1975) · Centerfire (coupé; 1964–2030) · Tallgrass (pickup; 1948–2030) · Mesaline (suv; 1985–2030)

**Lavergne** · FR · French people-carriers · 1919–2030  
Soft suspension and softer shapes from a Loire valley works. One-box people-carriers, quirky small hatchbacks and tall little vans, in pastel blue, cream and mustard.  
Grille: slot · colours: `#8fb0cf` `#e8e0c8` `#b3261e` `#c89a2a` `#6d7a86` `#f2f2f0` · badge: `#e0b42a`  
Lines: Grenadine (hatchback; 1948–1990) · Sillage (saloon, estate; 1955–2010) · Passerelle (hatchback; 1972–2030) · Promenade (people-carrier; 1984–2030) · Bivouac (small van; 1996–2030)

**Fellgate** · GB · British off-roaders · 1948–2030  
Farm and fell machines from Cumbria-flavoured country. Flat panels, a plain mesh grille, round lamps in the wings and sage green paint; later, leather-lined estates for the school run.  
Grille: mesh · colours: `#6f7a5a` `#c8b48a` `#f2f2f0` `#23392a` `#141414` · badge: `#6f7a5a`  
Lines: Ghyllside (suv; 1948–2016) · Tarnhow (suv; 1970–2030) · Scarthwaite (pickup; 1956–2030)

**Tollworth** · GB · British small cars · 1946–1985  
Tiny post-war runabouts built to beat petrol rationing: minimal bonnets, ten-inch wheels and cheerful colours.  
Grille: bar · colours: `#9bb6c9` `#e8e0c8` `#b3261e` `#a7c0a0` `#e0b43a` · badge: `#f2f2f0`  
Lines: Minnowby (hatchback; 1950–1985) · Sprocketts (saloon; 1946–1968)

**Ludgate** · GB · London-style cabs · 1948–2030  
The Ludgate Cab Company builds purpose-made hackney carriages: upright, tall enough for a top hat, with a turning circle tighter than a bus. A lit sign on the roof, black paint by default.  
Grille: tall · colours: `#141414` · badge: `#f2c14a`  
Lines: Kerbsider (cab; 1948–2030)

**Novaform** · US · Electric newcomer · 2018–2030  
A software company that makes cars. Closed fronts, a light strip nose to tail, glass roofs and flush handles.  
Grille: closed · colours: `#f2f2f0` `#141414` `#80858a` `#2a4f8a` `#b3261e` · badge: `#6ec1e4`  
Lines: Meridor (saloon; 2018–2030) · Aperture (suv; 2020–2030) · Solenne (hatchback; 2022–2030)

**Dravnik** · YU · Eastern-bloc bargains · 1966–1998  
The cheapest new car in the showroom, built under licence in a Balkan river town. Boxy, square-lamped and painted whatever came off the line that week.  
Grille: bar · colours: `#c89a2a` `#6f7a32` `#e8e0c8` `#9a2a1e` `#8fb0cf` · badge: `#c9cdd0`  
Lines: Kosava (saloon, estate; 1966–1998) · Branica (hatchback; 1978–1998)


### Vans and commercials

**Bramwell** · GB · British commercials · 1930–2030  
Luton-built vans, minibuses and conversions. If a plumber, a removals firm or a school owns it, it is probably a Bramwell.  
Grille: bar · colours: `#f2f2f0` `#2b4a73` `#b3261e` `#e0b42a` · badge: `#f2f2f0`  
Lines: Drayman (panel van; 1935–2030) · Roundsman (luton van; 1950–2030) · Tallyman (minibus; 1960–2030) · Parlour (ice-cream van; 1955–2030) · Paramed (ambulance; 1975–2030)


### Lorries and trailers

**Dunmore** · GB · British heavy lorries · 1925–2005  
Lancashire-flavoured heavy lorries: bonneted until the fifties, then square steel cabs, then the long-haul sleepers of the eighties. Also the council's bin lorries and gritters.  
Grille: bar · colours: `#2f5a8a` `#b3261e` `#2f5a3a` `#f2f2f0` · badge: `#d9dde0`  
Lines: Tollgate (box lorry, curtain-sider, flatbed, tipper, tanker; 1930–2005) · Ironbridge (tractor unit; 1955–2005) · Wardline (bin lorry, gritter; 1950–2005)

**Stalberg** · SE · Swedish trucks and buses · 1950–2030  
Tall cabs, big engines, chrome lamp bars on the roof. The long-distance driver's favourite, and a line of city buses.  
Grille: wide · colours: `#f2f2f0` `#b3261e` `#1e2f55` `#e0b42a` · badge: `#c9cdd0`  
Lines: Hovraby (tractor unit; 1960–2030) · Tundrik (tipper, mixer, box lorry; 1965–2030) · Glidare (single-decker, double-decker; 1995–2030)

**Oostvaart** · NL · Dutch distribution trucks · 1950–2030  
Neat flat-fronted cabs from the polders, built for supermarket rounds and ports.  
Grille: slot · colours: `#f2f2f0` `#2f6fb8` `#b9bdc0` `#1a1a1a` · badge: `#2f6fb8`  
Lines: Polderman (tractor unit; 1962–2030) · Dijkman (box lorry, curtain-sider, bin lorry, recovery truck; 1960–2030)

**Hessling** · DE · German construction trucks · 1930–2030  
Tippers, mixers and crane lorries with a three-bar grille, built like the bridges they help build.  
Grille: bars3 · colours: `#f2f2f0` `#e0b42a` `#6a6e72` `#2f5a3a` · badge: `#8a969e`  
Lines: Fernfahrer (tractor unit; 1965–2030) · Baulast (tipper, mixer, flatbed, recovery truck, gritter; 1955–2030)

**Kettleby** · GB · Trailers · 1945–2030  
Every kind of semi-trailer: boxes, curtain-siders, tankers, tippers, flats, skeletals, car transporters, timber bolsters and livestock floats.  
Grille: bar · colours: `#f2f2f0` `#b9bdc0` · badge: `#b3261e`  
Lines: Box (box trailer; 1950–2030) · Curtainside (curtain trailer; 1968–2030) · Tanker (tank trailer; 1950–2030) · Tipper (tipper trailer; 1955–2030) · Flat (flat trailer; 1945–2030) · Skeletal (container skeletal; 1968–2030) · Transporter (car transporter; 1960–2030) · Bolster (timber trailer; 1950–2030) · Stockfloat (livestock trailer; 1955–2030)


### Buses and coaches

**Aldermoor** · GB · British buses · 1920–2030  
Bus builder to half the corporations in the country: bonneted saloons, front-engined half-cab double-deckers with open platforms, then rear-engined deckers and low-floor single-deckers.  
Grille: bar · colours: `#b3261e` `#2f5a3a` `#e07a1f` · badge: `#f2f2f0`  
Lines: Chapelgate (vintage bus; 1920–1950) · Townsman (half-cab decker; 1945–1968) · Kerbline (double-decker; 1968–2030) · Paradeway (single-decker; 1965–2030)

**Penrose** · GB · Coachbuilders · 1925–2030  
Coach bodies with sweeping side mouldings and raked screens, for tours, holidays and the motorway network.  
Grille: wide · colours: `#f2f2f0` `#e8e0c8` · badge: `#c9a33a`  
Lines: Excursion (vintage bus; 1925–1949) · Stargazer (coach; 1950–2030)

**Kronhagen** · DE · Continental buses, trams and trains · 1990–2030  
Articulated buses, low-floor trams, electric multiple units and high-speed sets from a Hessian-flavoured works.  
Grille: closed · colours: `#f2f2f0` `#b9bdc0` · badge: `#6ec1e4`  
Lines: Lindwurm (bendy bus; 1990–2030) · Kurvenlauf (tram section; 1995–2030) · Pendelzug (electric unit car; 1995–2030) · Pfeilzug (high-speed power car, high-speed coach; 2008–2030)


### Rail

**Kingsholme Works** · GB · Steam and wooden stock · 1850–1965  
A railway-town works that built tank engines, express engines, panelled carriages and four-wheeled wagons for a century.  
Grille: bar · colours: `#1f4a2f` `#1f3060` `#151515` · badge: `#c9a33a`  
Lines: Beacon class (tank engine; 1900–1962) · Heathland class (tender engine; 1905–1962) · Panelled coach (coach; 1900–1962) · Goods van (van wagon; 1900–1985) · Mineral wagon (hopper wagon; 1900–1990) · Brake van (brake van; 1900–1990)

**Brackwell Traction** · GB · Diesel and electric · 1950–2030  
Diesel shunters, main-line diesels and electrics, railcars, suburban electrics, high-speed power cars and modern freight wagons.  
Grille: bar · colours: `#2f5a3a` `#1f3f6a` · badge: `#f2c21a`  
Lines: Yardman (shunter; 1953–1995) · Haulmaster (diesel locomotive; 1958–2030) · Voltmaster (electric locomotive; 1960–2030) · Branchliner (diesel unit car; 1955–2030) · Stopper (electric unit car; 1955–2012) · Expressliner (high-speed power car, high-speed coach; 1976–2012) · Standard coach (coach; 1951–2030) · Bogie hopper (hopper wagon; 1965–2030) · Tank wagon (tank wagon; 1950–2030) · Container flat (container flat; 1965–2030) · Car carrier (car carrier; 1970–2030) · Timber flat (timber wagon; 1960–2030)

**Hurlstone Car Works** · GB · Heritage trams · 1895–1955  
Double-deck street tramcars with open balconies and trolley poles.  
Grille: bar · colours: `#7a1f24` `#efe3c2` · badge: `#c9a33a`  
Lines: Balcony car (heritage tram; 1900–1955)

**Almstaig** · CH · Mountain railways · 1890–2030  
Alpine rack railcars with a cog under the floor and a body built for steep hills.  
Grille: bar · colours: `#9a2a1e` `#efe3c2` · badge: `#c9a33a`  
Lines: Gipfelwagen (rack railcar; 1900–2030)

**Morikawa Heavy Industries** · JP · Modern trains and ships · 2005–2030  
The heavy-industry side of Morikawa: aluminium bi-mode units and the container ships that bring the cars over.  
Grille: closed · colours: `#f2f2f0` · badge: `#b3261e`  
Lines: Kaido (diesel unit car, electric unit car; 2012–2030) · Oceanrunner (container ship; 2005–2030)


### Water and air

**Tamewater** · GB · Canal boats · 1880–2030  
Narrowboats: working boats with cloths over the hold, later hire and live-aboard boats with roses and castles.  
Grille: bar · colours: `#2f5a3a` `#7a1f24` `#1e2f55` · badge: `#e0b42a`  
Lines: Narrowboat (narrowboat; 1900–2030)

**Saltmarsh Yard** · GB · Coastal shipbuilders · 1900–2030  
River barges, coasters and car ferries from an estuary yard.  
Grille: bar · colours: `#2b2f33` `#f2f2f0` · badge: `#b3261e`  
Lines: Lighter (barge; 1900–2030) · Coaster (coaster; 1920–2030) · Seaway (car ferry; 1960–2030)

**Pellingham Aircraft** · GB · Light aircraft and turboprops · 1920–2030  
Club monoplanes and regional turboprops from a grass airfield in the Home Counties.  
Grille: bar · colours: `#f2f2f0` `#b3261e` · badge: `#1e2f55`  
Lines: Fairmead (light aircraft; 1930–2030) · Cloudrunner (turboprop; 1960–2030)

**Aerovance** · EU · Jet airliners · 1970–2030  
A European consortium building narrow-body and wide-body jets.  
Grille: closed · colours: `#f2f2f0` · badge: `#2f6fb8`  
Lines: Stratoline (airliner; 1972–2030) · Longreach (wide-body jet; 1975–2030)


## Operators and liveries

A livery is four colours, one per paint zone: **body**, **secondary** (the band between a
decker's decks, a waistband, a two-tone flash, a skirt), **roof**, and **accent** (warning-yellow
cab ends, doors, lettering, the second colour of a chequered pattern). Each builder decides where
the zones fall, so one livery reads right on a bus, a van or a train. Rail operators give
different vehicle types different liveries in the same year (green steam, blue diesels with
yellow ends, blue-and-grey coaches). Generated from `operators.ts`:

| Operator | Kind | Code | Years | Liveries (body · band · roof · accent) |
|---|---|---|---|---|
| **Greyfield Omnibus Company** — The big city company: red double-deckers with a cream band, conductors until the seventies. | bus | GOC | 1920–1986 | Red and cream (1920–1969): `#b3261e` `#efe3c2` `#b3261e` `#efe3c2`<br>All-over red (1970–1986): `#b3261e` `#b3261e` `#f2f2f0` `#b3261e` |
| **Oakport Corporation Transport** — The council's own buses, until deregulation in 1986 sold them off. | bus | OCT | 1930–1986 | Corporation green (1930–1969): `#2f5a3a` `#efe3c2` `#2f5a3a` `#efe3c2`<br>Sunrise orange (1970–1986): `#e07a1f` `#f2f2f0` `#f2f2f0` `#5a3a22` |
| **Blackthorn Travel** — A post-deregulation group that bought up the corporation fleets. | bus | RT | 1987–2030 | Blackthorn swoops (1987–2008): `#1f7a4a` `#f2c21a` `#f2f2f0` `#1f7a4a`<br>Blackthorn leaf (2009–2030): `#1f7a4a` `#9ad04a` `#1f7a4a` `#f2f2f0` |
| **Tidewell Buses** — Blue and white buses along the coast and into Oakport. | bus | TB | 1987–2030 | Tidewell blue (1987–2030): `#1f4f9e` `#f2f2f0` `#f2f2f0` `#6ec1e4` |
| **Oakport Metro Buses** — Franchised city buses in a single plum livery, whoever runs them. | bus | OM | 2008–2030 | Metro plum (2008–2030): `#5a2a7a` `#b9bdc0` `#5a2a7a` `#f2c21a` |
| **Longways Coaches** — The national coach network: white coaches with red and blue stripes on every motorway. | coach | LW | 1972–2030 | Longways stripes (1972–2003): `#f2f2f0` `#c8262e` `#f2f2f0` `#1f3f8a`<br>Longways white (2004–2030): `#f2f2f0` `#1f3f8a` `#f2f2f0` `#c8262e` |
| **Sunward Tours** — Holiday coaches to the seaside and the Lakes. | coach | ST | 1950–2030 | Cream and tangerine (1950–1985): `#efe3c2` `#e07a1f` `#efe3c2` `#5a3a22`<br>Sunburst (1986–2030): `#f2f2f0` `#f2a81a` `#f2f2f0` `#e05a1f` |
| **Oakport Corporation Tramways** — Open-balcony double-deck trams, scrapped in 1955 and missed ever since. | tram | OCT | 1900–1955 | Crimson and cream (1900–1955): `#7a1f24` `#efe3c2` `#3a3c3f` `#c9a33a` |
| **Oakport Metro Tram** — The trams came back in 1995: low-floor cars on-street and on old railway lines. | tram | OMT | 1995–2030 | Metro plum (1995–2030): `#b9bdc0` `#5a2a7a` `#6e7378` `#f2c21a` |
| **Southmoor & Cotswold Railway** — A pre-nationalisation company running from the south coast to the Midlands. | rail | SCR | 1900–1947 | Locomotive blue (1900–1947, tank engine/tender engine/tender): `#1f3060` `#151515` `#151515` `#b3261e`<br>Claret and gold (1900–1947, coach): `#5a1f2a` `#5a1f2a` `#3a3c3f` `#c9a33a`<br>Goods grey (1900–1947): `#6e7378` `#6e7378` `#3a3c3f` `#f2f2f0` |
| **High Fells Railway** — The northern company: coal trains, fast expresses and teak carriages. | rail | HFR | 1900–1947 | Moss green (1900–1947, tank engine/tender engine/tender): `#4a6a2a` `#151515` `#151515` `#c9a33a`<br>Varnished teak (1900–1947, coach): `#7a4a26` `#7a4a26` `#3a3c3f` `#c9a33a`<br>Goods brown (1900–1947): `#5a3a22` `#5a3a22` `#3a3c3f` `#f2f2f0` |
| **Kingdom Railways** — The nationalised railway. Green, then blue with yellow ends, then the sector liveries of the late eighties. | rail | KR | 1948–1996 | Lined green (1948–1967, tank engine/tender engine/tender): `#1f4a2f` `#151515` `#151515` `#c9a33a`<br>Traction green (1955–1966, shunter/diesel locomotive/electric locomotive/diesel unit car/electric unit car): `#2f5a3a` `#9ab08a` `#6e7378` `#f2c21a`<br>Coaching maroon (1948–1965, coach): `#6e1f24` `#6e1f24` `#3a3c3f` `#c9a33a`<br>Rail blue (1966–1986, shunter/diesel locomotive/electric locomotive/diesel unit car/electric unit car): `#1f3f6a` `#1f3f6a` `#6e7378` `#f2c21a`<br>Blue and grey (1966–1986, coach/high-speed coach/diesel unit car/electric unit car): `#1f3f6a` `#c9cdd0` `#6e7378` `#f2c21a`<br>Express yellow (1976–1986, high-speed power car): `#1f3f6a` `#c9cdd0` `#6e7378` `#f2c21a`<br>Express grey (1987–1996, diesel locomotive/electric locomotive/high-speed power car/high-speed coach/coach): `#3f4449` `#b9bdc0` `#3f4449` `#c8262e`<br>Suburban stripes (1987–1996, diesel unit car/electric unit car): `#f2f2f0` `#1f3f8a` `#6e7378` `#c8262e`<br>Freight triple grey (1987–1996, diesel locomotive/shunter): `#9aa0a4` `#3f4449` `#6e7378` `#f2c21a`<br>Wagon bauxite (1948–1996, van wagon/hopper wagon/tank wagon/container flat/car carrier/brake van): `#7a3a24` `#7a3a24` `#3a3c3f` `#f2f2f0` |
| **Waymark Express** — The long-distance franchise on the east side of the country. | rail | PX | 1997–2030 | Waymark green and gold (1997–2030): `#123d33` `#c9a33a` `#3f4449` `#c9a33a` |
| **Chalkline** — Commuter electrics across the downs into the capital. | rail | CL | 1996–2030 | Chalk and lime (1996–2030): `#f2f2f0` `#8ac43a` `#6e7378` `#3f4449` |
| **Moorland Trains** — Rural and regional trains across the northern hills. | rail | MT | 1997–2030 | Heather (1997–2030): `#4a2a6a` `#2a8ac4` `#6e7378` `#f2c21a` |
| **Harbour & Hills** — Valley lines and the coast route in the west. | rail | HV | 2003–2030 | Red and teal (2003–2030): `#c42a2a` `#1f8a8a` `#3f4449` `#f2c21a` |
| **Arrowline High Speed** — The new high-speed line and its white trains. | rail | AHS | 2009–2030 | Arrow white (2009–2030): `#f2f2f0` `#1f6fe0` `#3f4449` `#1a2a4a` |
| **Ironway Freight** — The biggest freight operator after privatisation. | freight-rail | IF | 1996–2030 | Ironway maroon (1996–2030, diesel locomotive/electric locomotive/shunter): `#6e1f2a` `#e0b42a` `#3f4449` `#e0b42a`<br>Ironway wagons (1996–2030): `#6e1f2a` `#6e1f2a` `#3a3c3f` `#f2f2f0` |
| **Blackstone Rail Haulage** — Aggregates, intermodal and anything heavy. | freight-rail | BRH | 2000–2030 | Orange and black (2000–2030, diesel locomotive): `#e0661f` `#1a1a1a` `#1a1a1a` `#f2c21a`<br>Blackstone wagons (2000–2030): `#3a3c3f` `#e0661f` `#3a3c3f` `#f2f2f0` |
| **Garthmoor Mountain Railway** — A rack railway to the summit café. | rack | GMR | 1896–2030 | Mountain red (1896–2030): `#9a2a1e` `#efe3c2` `#3a3c3f` `#c9a33a` |
| **Brackenridge & Sons** — The haulier every child waves at; each cab has a name on the front. | haulier | B | 1950–2030 | Green, red and white (1950–2030): `#1f5a3a` `#c42a2a` `#f2f2f0` `#1f5a3a` |
| **Cairnmoor Logistics** — Supermarket distribution out of the big sheds by the motorway. | haulier | CM | 1995–2030 | White and blue (1995–2030): `#f2f2f0` `#1f4f9e` `#f2f2f0` `#1f4f9e` |
| **Ashby Tankers** — Fuel, milk and chemicals in stainless barrels. | haulier | PT | 1960–2030 | White and red (1960–2030): `#f2f2f0` `#c42a2a` `#f2f2f0` `#c42a2a` |
| **Quarrymoor Aggregates** — Stone, sand and ready-mixed concrete from the quarries. | haulier | QA | 1955–2030 | Quarry yellow (1955–2030): `#e0b42a` `#2f4a2a` `#e0b42a` `#2f4a2a` |
| **Northfold Timber** — Logs from the forestry plantations to the sawmills. | haulier | NT | 1950–2030 | Forest (1950–2030): `#2f4a2a` `#8a5a2a` `#2f4a2a` `#f2f2f0` |
| **Dalesmoor Livestock** — Sheep and cattle to market. | haulier | DL | 1950–2030 | Farm maroon (1950–2030): `#6e1f2a` `#c9cdd0` `#6e1f2a` `#f2f2f0` |
| **Dockside Vehicle Logistics** — New cars from the docks and the factories to the dealers. | haulier | CV | 1965–2030 | Blue and white (1965–2030): `#1f3f8a` `#f2f2f0` `#1f3f8a` `#f2f2f0` |
| **Ferrous Box Lines** — A container line whose boxes turn up on lorries, trains and ships. | shipping | FBL | 1968–2030 | Rust and cream (1968–2030): `#a8452a` `#efe3c2` `#2b2f33` `#efe3c2` |
| **Oakport City Council** — Bin lorries, gritters and the parks department. | council | OCC | 1950–2030 | Municipal green (1950–1985): `#2f5a3a` `#2f5a3a` `#2f5a3a` `#f2c21a`<br>White with swoosh (1986–2030): `#f2f2f0` `#1f7a4a` `#f2f2f0` `#e09a1c` |
| **Thornshire Constabulary** — The county force of the fictional Thornshire. | police | TC | 1920–2030 | Black (1920–1964): `#151515` `#151515` `#151515` `#f2f2f0`<br>White with a red stripe (1965–1994): `#f2f2f0` `#c42a2a` `#f2f2f0` `#1f3f8a`<br>Blue and yellow checks (1995–2030): `#f2f2f0` `#1f3fbf` `#f2f2f0` `#e8d21a` |
| **Thornshire Ambulance Service** — Emergency ambulances for Thornshire. | ambulance | TAS | 1948–2030 | Cream (1948–1985): `#efe3c2` `#efe3c2` `#efe3c2` `#1f3f8a`<br>White with green (1986–2004): `#f2f2f0` `#1f8a3a` `#f2f2f0` `#1f8a3a`<br>Yellow and green checks (2005–2030): `#e8d21a` `#1f8a3a` `#e8d21a` `#1f8a3a` |
| **Oakport Hackney Carriages** — Licensed cabs on the ranks outside the stations. | taxi | OH | 1948–2030 | Black cab (1948–2030): `#141414` `#141414` `#141414` `#f2c14a`<br>Advertising wrap (1990–2030): `#1f6fb8` `#f2c21a` `#1f6fb8` `#f2f2f0` |
| **Fiorella Ices** — Ice-cream vans with a chime and a cone on the roof. | ice-cream | NB | 1955–2030 | Strawberry and cream (1955–2030): `#f2c4c8` `#efe3c2` `#efe3c2` `#b3261e`<br>Mint (1970–2030): `#b9e0c8` `#f2f2f0` `#f2f2f0` `#2f7a4a` |
| **Tamewater Carrying Co.** — Working boats on the cut: coal, grain and beer. | canal | TCC | 1900–1970 | Carrying red and green (1900–1970): `#2f5a3a` `#7a1f24` `#2b2f33` `#e0b42a` |
| **Driftwood Hire Boats** — Holiday narrowboats by the week. | canal | DH | 1970–2030 | Holiday blue (1970–2030): `#1e2f55` `#e0b42a` `#2b2f33` `#b3261e` |
| **Estuary Crossways Ferries** — Car ferries to the islands. | ferry | SCF | 1960–2030 | White and blue (1960–2030): `#f2f2f0` `#1f3f8a` `#f2f2f0` `#c42a2a` |
| **Larkspur Airways** — Regional and holiday flights from the city airport. | airline | LA | 1950–2030 | Silver and blue (1950–1985): `#d9dde0` `#1f3f8a` `#d9dde0` `#1f3f8a`<br>Larkspur violet (1986–2030): `#f2f2f0` `#5a3a9a` `#f2f2f0` `#9a7ad0` |

### Colour fashion

Private cars take their colour from the year (`carColour(year, rand)`), blending the two
nearest decades, and sometimes from their brand's signature colours. Loosely after UK
registration surveys: black before the war, pastels and two-tones in the fifties, browns,
oranges and harvest gold in the seventies, reds and blues in the eighties, greens and purples in
the nineties, silver in the noughties, then white, grey and black.

| From | Colours, most popular first |
|---|---|
| 1900 | `#151515` 60% · `#3a1a1a` 10% · `#1f2f22` 10% · `#1c2438` 10% · `#5a4a35` 5% |
| 1930 | `#151515` 45% · `#4a1c22` 12% · `#23392a` 12% · `#1e2a45` 12% · `#b9ab8a` 8% · `#6d6e70` 6% |
| 1950 | `#1a1a1a` 14% · `#e8e0c8` 14% · `#9bb6c9` 12% · `#a7c0a0` 10% · `#6e1f2a` 10% · `#7d8185` 10% · `#2b4a73` 8% · `#c8b48a` 8% |
| 1960 | `#f2efe6` 18% · `#b3261e` 14% · `#8fb0cf` 12% · `#d8c9a0` 10% · `#2f5a3a` 10% · `#1a1a1a` 8% · `#6d7a86` 8% · `#e0b43a` 5% |
| 1970 | `#6b4a2b` 14% · `#d0631d` 12% · `#c89a2a` 12% · `#6f7a32` 10% · `#f2efe6` 10% · `#9a2a1e` 8% · `#d8c9a0` 8% · `#2f5a8a` 6% · `#8a6a3a` 6% |
| 1980 | `#b3261e` 16% · `#f2efe6` 14% · `#a5a9ad` 12% · `#1e2f55` 12% · `#5a1e26` 8% · `#1a1a1a` 8% · `#6b5a45` 6% · `#8a9aa8` 6% |
| 1990 | `#1f4a38` 14% · `#1e2f55` 14% · `#b3261e` 12% · `#a5a9ad` 10% · `#4a2a55` 8% · `#1a1a1a` 8% · `#2a6a7a` 8% · `#f2efe6` 6% |
| 2000 | `#b9bdc0` 28% · `#1a1a1a` 14% · `#2a4f8a` 12% · `#6d7277` 12% · `#b3261e` 8% · `#f2efe6` 6% · `#2a3a2f` 4% |
| 2010 | `#f2f2f0` 22% · `#6a6e72` 18% · `#141414` 16% · `#b9bdc0` 12% · `#2a4f8a` 10% · `#b3261e` 8% · `#8a8f93` 6% |
| 2020 | `#80858a` 24% · `#f2f2f0` 18% · `#141414` 16% · `#2a4f8a` 10% · `#b9bdc0` 8% · `#1f3d34` 6% · `#b3261e` 6% · `#d86a1c` 4% |

On top of that: a vinyl roof on some saloons and coupés of 1966–82, a contrast roof on some cars
from 2006, black wings on most vintage cars, and a cream flash on post-war two-tones.

### Plates and fleet numbers

`plate(year, seed)` follows the real sequence of UK formats: `ABC 123` before 1963, the
year-suffix `ABC 123D` to 1983, the prefix `A123 BCD` to 2001, then `AB51 CDE` with its March and
September age identifiers. I, Q and Z are left out as the DVLA does. `fleetNumber(code, seed)`
gives a bus `TB 270`, a lorry `B412`, a train `KR 7412`. `plateCanvas(text, rear)` draws either
to a canvas for close-ups or an atlas; on the models themselves plates are plain white or yellow
quads, since the text is unreadable at game distances.

## How a vehicle is made

**The kit** (`kit.ts`) is a small mesh builder. Every face is wound to face outward, so the
builders never think about winding. Its parts:

| Part | Used for |
|---|---|
| `prism(profile, halfWidth)` | a side profile swept across the width; the half-width can vary with height (a greenhouse leaning in). Car, van, lorry-cab and bus bodies, with the wheel arches cut into the profile |
| `loftX(section, sections)` | a cross-section swept along the length through scaled sections. Rail bodies (the loading gauge's curved roof), noses (a run of shrinking sections), hulls, fuselages, the mixer drum, the bin-lorry body |
| `box`, `cylX/Y/Z`, `disc` | chassis, bumpers, tanks, boilers, chimneys, logs, buffers, beacons, wheels, lamps and fans |
| `edgeDecal`, `edgeDisc`, `side`, `end`, `top` | flat decals lifted just off a surface: glass, lamps, grilles, plates, stripes, doors, livery panels |
| `clip(profile, box)` | cuts a stripe, a two-tone band or a chequer block out of a side profile so it always fits the body |

**Builders** (`cars.ts`, `vans.ts`, `lorries.ts`, `buses.ts`, `rail.ts`, `craft.ts`) read a model's
dimensions and design record and assemble the parts. One parametric car body covers every style
from the 1935 saloon to the 2030 electric SUV (windscreen base and rake, roof line, rear pillar,
nose and bonnet heights, lamps, grille, bumpers, wheels, tumblehome, options); veteran cars have
their own builder with separate wings, running boards and spoked wheels. Lorries are a cab (bonneted, flat day cab, sleeper, high-roof) plus a body kit: box, curtain-sider, tipper, flatbed with pallets,
bricks, steel coils or timber and an optional loader crane, tanker, bin lorry, gritter, mixer,
recovery truck, and nine trailer bodies including a two-deck car transporter carrying cars and a
timber bolster trailer with logs.

**Specs** (`specs.ts`) give each style its real dimensions for its year and size class, and the
design knobs; `models.ts` expands the brand bible's lines into models, adds police cars on the
family cars the force would have bought, driving and intermediate cars for multiple units, tram
sections, high-speed sets, bendy-bus halves and tenders. Every model is seeded from its id, so
the catalogue and every geometry are the same on every run.

## The API

```ts
import { MODELS, MODEL, geometry, VehicleRenderer, lookFor, liveryColours, lodFor, FLAGS,
  pickVehicle, pickTrain, follow, purchaseList } from './vehicles';

// the catalogue
const bus = MODEL['aldermoor-kerbline-3-bus-double'];
bus.dims;   // { length: 10.23, width: 2.55, height: 4.3, wheelbase: 5.62, axles: [2.82, -2.8], wheelR: 0.5, clearance: 0.25 }
bus.stats;  // { capacity: 85, unit: 'pax', speedKmh: 80, cost: 290000, running: 30000, power: 'diesel' }

// what one particular vehicle looks like: owner, livery, plate or fleet number
const look = lookFor(bus, 1990, seed);           // or lookFor(bus, 1990, seed, 'tidewell')
const colours = liveryColours(look.livery);      // THREE.Color[4], cached

// drawing: one renderer for the whole city
const vr = new VehicleRenderer({ shadows: true });
scene.add(vr.group);
// every frame
vr.begin();
vr.add(bus, lodFor(bus.dims.length, pixelsPerMetre), matrix, colours, FLAGS.lights | FLAGS.interior, odometer);
vr.end(timeSeconds);
vr.uniforms.uNight.value = 1; // lamps glow harder at night
vr.stats;                     // { calls, tris, instances, buckets }
```

- **Coordinates.** +x forward, +y up, +z the driver's right; the origin is on the ground under
  the middle of the length. That's what `traffic.ts` already assumes: its `place()` builds the
  matrix from `Euler(0, -heading, pitch)` with `heading = atan2(uz, ux)`.
- **Geometry.** `geometry(model, lod)` returns one cached, flat-shaded, non-indexed
  `BufferGeometry` with `position`, `normal`, `color`, `vk` (paint zone, light code,
  wheel-centre x, wheel-centre y) and `vd` (a motion tag, see Doors and moving parts). The renderer shares these attributes between buckets.
- **Levels of detail.** 0 near (full detail), 1 middle (no arches, wheels as axle blocks, window
  bands as strips, lamps kept so night traffic still twinkles), 2 far (a coloured box, or two for
  lorries, ships and aircraft). `lodFor(length, pixelsPerMetre)` picks near above about 40 px
  long and far below about 12 px. Budgets, enforced by tests:

  | Category | Near | Middle | Far |
  |---|---|---|---|
  | Cars | 400 | 120 | 12 |
  | Vans | 450 | 140 | 12 |
  | Lorries | 700 | 200 | 24 |
  | Trailers | 600 | 160 | 12 |
  | Buses and coaches | 800 | 220 | 12 |
  | Rail (per vehicle) | 900 | 250 | 12 |
  | Boats, aircraft | 900 | 240 | 24 |

- **Per-instance data.** `instanceColor` is the body colour; three more instanced colours carry
  zones 2–4; `iData` carries the flags, the odometer, the doors (left and right, packed) and the curvature. Wheels spin by `odometer / radius`.
- **Lights.** Baked light codes: head 1, tail 2 (dim with lights, bright when braking), brake 3,
  indicators 4 (left, −z) and 5 (right), interior 6 (bus, train and cab windows), blue beacon 7,
  amber beacon 8, sign 9 (cab "for hire" lamp, destination blinds). Per-instance `FLAGS`:
  `lights`, `brake`, `indL`, `indR`, `hazard`, `interior`, `beacons`, `sign`. Indicators blink and
  beacons flash in the shader, so the sim only sets a bit. Trains: white lamps are code 1 and
  red ones code 3, so set `lights` on the leading vehicle and `brake` on the last (turn a
  trailing driving car end for end).
- **Ground glow.** `new Glow('beam' | 'pool')` is an instanced additive quad for headlamp beams
  and street-lamp pools: one draw call for a whole city at night.
- **Articulation.** Tractors, bendy fronts and anything that tows have `hitch.rear`; trailers
  and bendy rears `hitch.front` (x from the model's middle). `follow(leadPose, lead, trailer,
  lastTrailerPose)` drags the trailer's axle group towards the hitch, which gives realistic
  off-tracking on bends; `articulationAngle()` is there to stop jack-knifes. Rail cars instead sit
  on the track by their bogie centres; `consistOffsets(models)` gives each car's offset from the
  front of the train.
- **Sets.** `model.consist` lists the models a set runs with: tender engine and tender,
  power car–coaches–power car, driving–intermediate–driving, bendy front and rear.
- **Spawning.** `pickVehicle(rand, area, year)` returns `{ chain, look, lead }` for one of
  `centre | suburb | industrial | rural | motorway`, with the right share of taxis, buses, vans,
  rigid lorries and artics for the area and only vehicles of the period (built that year or up to
  fifteen years before, fading out; preserved heritage buses at a trickle). `pickTrain(rand,
  year)` makes a multiple unit, a high-speed set, a loco and coaches, or a freight train.
- **The buyable fleet.** `purchaseList(year, kinds?)` lists what's on sale: buses, coaches,
  vans, rigid lorries, tractors and trailers separately, multiple units as 2-, 3- and 4-car sets,
  high-speed sets, locomotives, carriages, wagons, trams, boats and planes, each with capacity,
  unit, speed, price, running cost and length.

## Doors and moving parts

Every passenger door is laid out once, in `doors.ts`, and the geometry, the tests and the
placement helpers all read that layout. The parts that move (door leaves, bogies, steered front
wheels, steam coupling rods, pantographs) carry a motion tag per vertex (`vd`), and the vertex
shader moves them from four numbers per vehicle, so none of it costs a draw call or a
per-vehicle mesh.

| Stock | Doors a side | Kind |
|---|---|---|
| Compartment coaches (panelled, pre-1950) and slam-door electrics | one per compartment or bay (7–9) | hinged slam doors, swing out |
| Corridor coaches (1950–74) and slam-door railcars | 4 | slam |
| High-speed coaches before 1990 | 2, at the ends | slam |
| Electric units 1985–99, rack railcars | 2 pairs | pocket (slide into the body) |
| Electric units from 2000 | 2 pairs, a third of the way along | plug (step out, then slide) |
| Diesel units and coaches from 1985 | 2 single leaves by the ends | plug (pocket on 1985–99 diesels) |
| Metro cars | 3 wide pairs | pocket |
| Tram sections | 2 pairs | plug |
| Balcony trams, half-cab buses | open platforms | none |
| Buses: front door (and a centre door on long single-deckers, bendies and some deckers) | kerb side only | folding before 1990, plug after |
| Coaches | one single leaf at the front | folding before 1980, plug after |

Near level: a dark doorway (lit at night) with a tread plate, a seal round the frame, the leaves
with their windows, a seal on the meeting edge, open buttons (green once released) and an amber
lamp over the door (lit while open); slam doors have a droplight and a handle. Middle level: a
panel in the door colour on modern stock, nothing on slam stock and buses. Far level: nothing.

```ts
import { doorsOf, DoorStates, dwellDoors, doorPositions, platformSide, FLAGS } from './vehicles';

doorsOf(model);          // [{ x, width, y0, y1, leaves, kind, sides, dir }], front to back

// stateful: keyed by any id, opens at each door kind's own speed
const doors = new DoorStates();
doors.setDoors(vehicleId, 1, 'left', { model, delay: carIndex * 0.2 }); // 0 shut … 1 open
doors.update(dt);
const [left, right] = doors.get(vehicleId);

// or stateless, through a stop: t seconds since it came to rest, standing for dwell seconds
const open = dwellDoors(t, dwell, model, carIndex); // opens after 0.6 s, shut 0.8 s before it leaves

// drawing: doors, and the path's curvature for bogies and steering (1/radius, + turning right)
vr.add(model, lod, matrix, colours, flags, odometer, left, right, curvature);
// FLAGS.pantoDown folds the pantograph

// where passengers go: every door's sill in the world, just outside the body, with its side
doorPositions(model, { x, z, heading, y }, platformPoint); // → [{ index, side, x, y, z, nx, nz, width, kind }]
platformSide({ x, z, heading }, platformPoint);          // 'left' | 'right'
```

- **Sides.** Left is the driver's left (−z), which is the kerb side in Britain; buses only have
  doors there. A reversed car (the trailing driving car of a unit) is drawn with heading + π, so
  pass that same heading to `doorPositions`/`platformSide` and its sides come out right; pass it
  −curvature too.
- **Wheels** turn by odometer / radius. **Bogies** swivel by asin(pivot × curvature), which is
  exactly where the rail's tangent is under a bogie when the car's ends are on the curve.
  **Front wheels** steer by atan(wheelbase × curvature). **Coupling rods** ride the crank pins.
- **Articulation.** Bendy buses and trams have real bellows (each half carries its half, out to
  the turntable, closed with a dark diaphragm so a bend never shows daylight). `follow()` drags
  a trailer in quarter-metre steps, so it tracks a curve the same at any frame rate, and holds
  the angle to `maxAngle` (1.3 rad) so it never folds through the tractor.
- **The demo.** Turntable: *Doors* opens and shuts them, *Close-up* frames the front door on the
  kerb side (`?close=1&doors=1`). Parade: *Station* (`?at=stop`) shows the platforms and the bus
  lay-by, where trains stop and open their doors on the platform side and buses pull in, open
  up, and wait for a gap before pulling out.

## Integration plan

The order matters: each step is shippable on its own and the game keeps working between them.

1. **Draw the existing traffic with the library (no sim changes).** In `Traffic`, replace the
   eleven `im()` boxes with one `VehicleRenderer`. Give each `Car` a `model` and `colours` when it
   spawns: lorries from `pickVehicle(rand, 'industrial', year)` filtered to lorries, cars from
   `pickVehicle` filtered to cars, buses from the bus operator's fleet. In `draw()`, keep building
   the matrix with `place()` and call `vr.add(model, lodFor(length, pixelsPerMetre), matrix,
   colours, flags, odometer)`; `pixelsPerMetre` is `canvas.clientHeight / view.h` for the
   orthographic camera. Keep `castShadow` on the renderer's buckets and let the adaptive-quality
   tiers switch it off with the rest of the shadows. Delete `carBody`, `trailer`, `busBody`…
2. **Articulated lorries and bendy buses.** Store the trailer model and its last pose on the
   car. After placing the tractor, call `follow()` and add the trailer as a second instance. The
   car-following gap becomes the whole chain's length.
3. **True lengths in car-following.** Replace the `13 : 7` in the gap test with
   `ahead.length + 2.5` (see `followGap()`); an artic's length is tractor plus trailer from the
   front bumper to the hitch-offset trailer rear (`consistOffsets` does the sum). Junction
   clearing, bus-bay lengths and queue storage all then use real lengths.
4. **Lights and signals from the sim.** Flags per car: `lights` when `demand()` says it's
   night (or from the day-night cycle), `brake` when the car-following deceleration exceeds about
   1 m/s², `indL`/`indR` from the turn it has claimed at the next junction (`turn.move`), `hazard`
   for a broken-down vehicle, `beacons` for emergency vehicles, `interior` and `sign` for buses and
   cabs at night. Add the `Glow` layers at night.
5. **Buses and trains by operator and era.** Bus routes pick an operator from
   `operatorsFor(style, year)` (or the player's own company livery, which is just a `Livery`);
   buses on a route share its livery and get fleet numbers. `TRAINS` in `catalog.ts` becomes a
   view over `purchaseList(year, ['train', 'tram'])`: map `dmu`, `intercity`, `hs`, `tram` and
   `rack` to the matching sets, and take `cars` and `carLen` from the set's models. Draw each
   car at its offset with `consistOffsets`, flipping the trailing driving car.
6. **A realistic mix by area.** Tag each road segment (or zone) with an `Area` from the land
   registry: shops and offices → `centre`, homes → `suburb`, works → `industrial`, rural roads →
   `rural`, motorways and dual carriageways → `motorway`. Spawn with `pickVehicle(rand, area,
   year)`: industrial estates get lorries and artics, the city centre taxis and buses, the
   countryside pickups, off-roaders and livestock floats. Trips that start at a works can bias
   to lorries directly.
7. **Eras.** A game year drives everything: `modelsIn(year)`, the colour fashion, plates, the
   operators that exist, the liveries they wear, the cab styles of lorries. Advancing the year
   ages the fleet on the road naturally, because spawns favour new models and old ones fade out
   over fifteen years.
8. **The economy.** The vehicle-purchase screen lists `purchaseList(year, kinds)` with capacity,
   speed, price and running cost. Bought vehicles take the player's livery. The 2D game's
   `VEHICLES` (`defs.ts`) map onto offers: `minibus` → a Tallyman, `bus` → a Paradeway,
   `decker` → a Kerbline, `coach` → a Stargazer, `van`/`truck`/`hgv` → Drayman, Tollgate and a
   tractor with a curtain trailer, `train`/`freight`/`intercity`/`metro` → units, freight rakes,
   high-speed sets and trams.
9. **Performance guard rails.** Keep the number of distinct models on screen bounded (the
   spawner's pools do this: a street sees a few dozen models, not hundreds), since draw calls are
   one per visible model and level. Past a few hundred metres everything is the far box. For
   county-sized maps, LOD 2 buckets can move into a single `BatchedMesh` or a merged far-traffic
   mesh per tile if draw calls ever bite.

## In the game

Steps 1–7 of the plan above are in, through `src/proto/game/fleet.ts`. `traffic.ts` keeps only
the simulation, the spawning and each vehicle's size.

- **What a trip gets:** `Fleet.dress(seg, heavy)` picks a model for the area the trip starts in and
  for `gameYear()`.
  - The area comes from `areaOfRoad`: what fronts the road, `net.zoneAt`, and the road itself.
  - Models come from `paletteFor(year)`: the commonest few of each sort that year, which keeps the
    number of draw calls bounded.
  - A trip from a works is always a goods vehicle.
- **Bodies:** each vehicle's true length and width are registered as a body
  (`footprint.registerBody`). The conflict tables are worked out for each body.
  - An artic or bendy bus is its tractor plus a trailer hung on the hitch, with the trailer's tail
    on the course. On a bend the trailer angles away from the tractor and cuts inside, but it never
    swings out of its lane.
  - The trailer's position is a function of the course alone, so the tables allow for exactly
    what's drawn.
  - A bus longer than a lay-by's stand calls from the lane.
- **Lamps:**
  - Headlamps come on from the game hour, each driver at a slightly different moment.
  - Brake lamps show when decelerating harder than 1 m/s², and are held for 0.6 s.
  - Indicators come from a lane change, a merge, the turn claimed at the next junction (a left
    signal when leaving a roundabout), and a bus pulling out.
- **Doors:** a bus's kerb-side doors open while it stands at a stop (`DoorStates`).
  `Fleet.kerbDoors` gives the door positions where `game/crowds.ts` boards and alights people.
- **The player's buses and trains:**
  - Buses are in the company livery (`OWN_LIVERY`) with fleet numbers.
  - Trains are made up from `purchaseList` sets with `consistOffsets`.
  - Before there are express sets, a train is a locomotive and coaches.
- **HUD:** Transport → Buy vehicles lists `purchaseList(gameYear())`. Buses and trains from it run
  now.
- **Culling:** only vehicles in view are drawn (`Fleet.frame` each frame). While the game is paused,
  `traffic.redraw()` keeps panning honest.
- **Tests:** `src/proto/game/*.review.test.ts` (artics and bendy buses, goods trips, period
  trains) and `fleet.doors.test.ts`.

## Screenshots

The report's screenshots come from the showroom in headless Chromium. Install `playwright-core`
in a scratch folder (not in `package.json`), start `npx vite --port 5199`, and load
`/vehicles-demo.html?…` with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`
and `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
The URL carries the whole state:

- `mode=parade|showroom|turntable`, `cat`, `brand`, `op`, `year`;
- `night=1`, `n` (the number of vehicles), `area`, `lod=0|1|2`, `zoom` (view height in metres);
- `fit` (turntable framing), `model`, `angle`, `spin=0`, `ui=0` (hide the panels),
  `filters=1`, `seed`.

For example `?mode=parade&year=1975&area=industrial&n=500&night=1`. The stats line (and
`window.__stats`) gives fps, draw calls, triangles, vehicles drawn and JS time per frame.

## Adding to the library

- **A model line:** add `{ family, styles, from, to, gen, size }` to a brand in `brands.ts`. It
  expands into generations and styles on its own. Run the tests: the name check, budgets and
  dimension limits will catch mistakes.
- **A brand or operator:** add it to `brands.ts` or `operators.ts` with a blurb, colours and
  (for operators) liveries by year and vehicle type.
- **A body style:** add it to `BodyStyle` in `types.ts`, `CATEGORY` and `STYLE_LABEL` in
  `models.ts`, a spec in `specs.ts`, and a case in the category's builder, then add it to a line.
