// Real names the invented ones must stay clear of: car, van, lorry, bus, rail, ship and aircraft
// makers past and present, well-known model names (especially British ones), and UK bus, coach,
// rail, freight and haulage operators, ferry lines and airlines. The test in vehicles.test.ts
// flags any invented name within two edits of one of these (exact matches for names of three
// letters or fewer, where two edits would match almost anything).
export const REAL_MAKES = [
  // cars
  'Abarth', 'AC', 'Acura', 'Alfa Romeo', 'Allard', 'Alpina', 'Alpine', 'Alvis', 'AMC', 'Ariel', 'Armstrong Siddeley', 'Aston Martin', 'Audi', 'Austin', 'Austin-Healey', 'Autobianchi',
  'Bentley', 'BMW', 'Bond', 'Borgward', 'Bristol', 'Bugatti', 'Buick', 'BYD', 'Cadillac', 'Caterham', 'Chery', 'Chevrolet', 'Chrysler', 'Citroen', 'Cupra', 'Dacia', 'Daewoo', 'Daihatsu',
  'Daimler', 'Datsun', 'De Tomaso', 'DeLorean', 'DeSoto', 'Dodge', 'DS', 'Duesenberg', 'Facel Vega', 'Ferrari', 'Fiat', 'Fisker', 'Ford', 'Genesis', 'Ginetta', 'GMC', 'Gordon-Keeble',
  'Healey', 'Hillman', 'Holden', 'Honda', 'Hudson', 'Humber', 'Hummer', 'Hyundai', 'Infiniti', 'Innocenti', 'Isuzu', 'Iso', 'Jaguar', 'Jensen', 'Jeep', 'Jowett', 'Kia', 'Koenigsegg',
  'Lada', 'Lagonda', 'Lamborghini', 'Lanchester', 'Lancia', 'Land Rover', 'Lea-Francis', 'Lexus', 'Lincoln', 'Lotus', 'Lucid', 'Lynk', 'Marcos', 'Maserati', 'Matra', 'Maybach', 'Mazda',
  'McLaren', 'Mercedes', 'Mercedes-Benz', 'Mercury', 'MG', 'Mini', 'Mitsubishi', 'Morgan', 'Morris', 'Moskvich', 'Nash', 'Nissan', 'NSU', 'Oldsmobile', 'Opel', 'Packard', 'Pagani',
  'Panhard', 'Peugeot', 'Plymouth', 'Polestar', 'Pontiac', 'Porsche', 'Proton', 'Range Rover', 'Rambler', 'Reliant', 'Renault', 'Riley', 'Rivian', 'Rolls-Royce', 'Rover', 'Saab',
  'Saturn', 'Scion', 'Seat', 'Simca', 'Singer', 'Skoda', 'Smart', 'SsangYong', 'Standard', 'Studebaker', 'Subaru', 'Sunbeam', 'Suzuki', 'Talbot', 'Tata', 'Tatra', 'Tesla', 'Toyota',
  'Trabant', 'Triumph', 'Turner', 'TVR', 'Vanden Plas', 'Vauxhall', 'Venturi', 'Volkswagen', 'Volvo', 'Wartburg', 'Wolseley', 'Yugo', 'Zastava', 'Zil', 'Zotye', 'Geely', 'Great Wall',
  'Haval', 'Nio', 'Xpeng', 'Mahindra', 'Perodua', 'Lotus', 'Noble', 'Radical', 'Ariel', 'Westfield', 'Morgan', 'Invicta', 'Frazer Nash', 'Swallow', 'Vale', 'Clyno', 'Crossley', 'Argyll',
  'Arrol-Johnston', 'Belsize', 'Calthorpe', 'Straker-Squire', 'Sheffield-Simplex', 'Napier', 'Deasy', 'Siddeley', 'Star', 'Trojan', 'Peel', 'Gilbern', 'Elva', 'Piper', 'Rochdale',
  // vans, lorries and buses
  'Bedford', 'Commer', 'Karrier', 'Dennis', 'Leyland', 'Foden', 'ERF', 'Seddon', 'Atkinson', 'Seddon Atkinson', 'Scammell', 'Guy', 'AEC', 'Albion', 'Thornycroft', 'Maudslay', 'Tilling-Stevens',
  'Bristol Commercial Vehicles', 'Daimler Buses', 'Scania', 'MAN', 'Iveco', 'DAF', 'Renault Trucks', 'Mack', 'Kenworth', 'Peterbilt', 'Freightliner', 'International', 'Western Star', 'Hino',
  'Fuso', 'UD Trucks', 'Magirus', 'Magirus-Deutz', 'Büssing', 'Henschel', 'Krupp', 'Hanomag', 'Unimog', 'Tatra', 'Kamaz', 'Volvo Trucks', 'Sisu', 'Pegaso', 'Berliet', 'Saviem', 'Unic',
  'LDV', 'Sherpa', 'Transit', 'Sprinter', 'Crafter', 'Ducato', 'Boxer', 'Relay', 'Master', 'Movano', 'Vivaro', 'Trafic', 'Kangoo', 'Berlingo', 'Partner', 'Caddy', 'Combo', 'Doblo',
  'Wright', 'Wrightbus', 'Alexander', 'Alexander Dennis', 'Plaxton', 'Duple', 'ECW', 'Eastern Coach Works', 'Park Royal', 'Weymann', 'MCW', 'Metro-Cammell', 'Northern Counties', 'Roe',
  'Willowbrook', 'Marshall', 'Optare', 'Caetano', 'Van Hool', 'Neoplan', 'Setra', 'Irizar', 'Bova', 'VDL', 'Solaris', 'Mercedes-Benz Citaro', 'Enviro', 'Routemaster', 'Olympian',
  'Atlantean', 'Fleetline', 'Titan', 'Regent', 'Bristol Lodekka', 'Lodekka', 'Metrobus', 'Dominator', 'Trident', 'Dart', 'Lance', 'Javelin', 'Leopard', 'Tiger', 'Royal Tiger', 'Reliance',
  'National', 'Lynx', 'Olympic', 'StreetLite', 'StreetDeck', 'Gemini', 'Eclipse', 'Excalibur', 'Paramount', 'Panorama', 'Supreme', 'Viceroy', 'Dominant', 'Laser', 'Levante', 'Panther',
  // rail
  'Alstom', 'Bombardier', 'Siemens', 'Hitachi', 'CAF', 'Stadler', 'Talgo', 'Brush', 'English Electric', 'BREL', 'British Rail Engineering', 'Metropolitan-Vickers', 'Beyer Peacock',
  'Hunslet', 'Bagnall', 'Peckett', 'Andrew Barclay', 'Robert Stephenson', 'North British', 'Vulcan Foundry', 'Swindon Works', 'Crewe Works', 'Derby Works', 'Doncaster Works', 'Eastleigh',
  'Wolverton', 'Ashford', 'Horwich', 'Darlington', 'Gateshead', 'Kitson', 'Sharp Stewart', 'Neilson', 'Dick Kerr', 'Brush Traction', 'Wabtec', 'Electro-Motive', 'EMD', 'General Electric',
  'Pullman', 'Wagons-Lits', 'Gloucester Railway Carriage', 'Cravens', 'Pressed Steel', 'Birmingham RC&W', 'Hurst Nelson', 'Charles Roberts', 'Procor', 'Tiphook', 'VTG', 'Greenbrier',
  'SLM', 'Pesa', 'Skoda Transportation', 'Kawasaki', 'Nippon Sharyo', 'CRRC', 'Ansaldo', 'Pendolino', 'Voyager', 'Azuma', 'Javelin', 'Sprinter', 'Pacer', 'Turbostar', 'Electrostar',
  'Desiro', 'Networker', 'Juniper', 'Aventra', 'Civity', 'Flirt', 'Intercity 125', 'InterCity', 'Deltic', 'Western', 'Warship', 'Hymek', 'Peak', 'Castle', 'King', 'Hall', 'Manor',
  'Grange', 'Star', 'Saint', 'Duke', 'Schools', 'Merchant Navy', 'West Country', 'Battle of Britain', 'Britannia', 'Coronation', 'Princess Royal', 'Royal Scot', 'Patriot', 'Jubilee',
  'Black Five', 'Mallard', 'Flying Scotsman', 'Gresley', 'Stanier', 'Bulleid', 'Pannier', 'Terrier', 'Jinty', 'Austerity', 'Eurostar', 'Shinkansen', 'Hikari', 'Nozomi', 'Hayabusa',
  // ships and aircraft
  'Harland and Wolff', 'Cammell Laird', 'Swan Hunter', 'Vickers', 'John Brown', 'Yarrow', 'Scott Lithgow', 'Ailsa', 'Appledore', 'Hyundai Heavy', 'Samsung Heavy', 'Daewoo Shipbuilding',
  'Maersk', 'MSC', 'CMA CGM', 'Hapag-Lloyd', 'Evergreen', 'COSCO', 'Hanjin', 'ONE', 'Yang Ming', 'P&O', 'Stena', 'Brittany Ferries', 'DFDS', 'Wightlink', 'Red Funnel', 'CalMac',
  'Caledonian MacBrayne', 'Condor', 'Irish Ferries', 'Isle of Man Steam Packet', 'Sealink', 'Townsend Thoresen', 'Hoverspeed', 'Boeing', 'Airbus', 'Embraer', 'Bombardier Aerospace',
  'ATR', 'de Havilland', 'Hawker Siddeley', 'Handley Page', 'Avro', 'Vickers-Armstrongs', 'BAC', 'British Aerospace', 'BAE', 'Short Brothers', 'Shorts', 'Britten-Norman', 'Piper',
  'Cessna', 'Beechcraft', 'Fokker', 'Saab Aircraft', 'Dornier', 'Lockheed', 'McDonnell Douglas', 'Douglas', 'Convair', 'Sud Aviation', 'Tupolev', 'Ilyushin', 'Antonov', 'Comet',
  'Viscount', 'Vanguard', 'Trident', 'Concorde', 'Herald', 'Dart Herald', 'Islander', 'Trislander', 'Dash 8', 'Twin Otter', 'Tiger Moth', 'Chipmunk', 'Auster', 'Miles', 'Percival',
  'Slingsby', 'Skylark', 'Spitfire', 'Hurricane', 'Lancaster', 'Dakota', 'Jetstream', 'Airbus A320', 'Boeing 737',
];

// Model names, mostly British and European, since those are the ones an invented name is most
// likely to echo by accident.
export const REAL_MODELS = [
  'Cortina', 'Escort', 'Anglia', 'Capri', 'Consul', 'Zephyr', 'Zodiac', 'Granada', 'Sierra', 'Mondeo', 'Fiesta', 'Focus', 'Prefect', 'Popular', 'Pilot', 'Corsair', 'Orion', 'Puma',
  'Kuga', 'Mustang', 'Bronco', 'Thunderbird', 'Galaxy', 'Galaxie', 'Fairlane', 'Falcon', 'Torino', 'Maverick', 'Ranger', 'Explorer', 'Transit', 'Viva', 'Victor', 'Velox', 'Cresta',
  'Wyvern', 'Chevette', 'Cavalier', 'Carlton', 'Senator', 'Royale', 'Belmont', 'Nova', 'Astra', 'Corsa', 'Vectra', 'Omega', 'Calibra', 'Tigra', 'Zafira', 'Meriva', 'Insignia', 'Frontera',
  'Monterey', 'Kadett', 'Rekord', 'Ascona', 'Manta', 'Admiral', 'Diplomat', 'Kapitan', 'Minx', 'Hunter', 'Imp', 'Avenger', 'Husky', 'Super Snipe', 'Hawk', 'Sceptre', 'Rapier', 'Alpine',
  'Tiger', 'Herald', 'Vitesse', 'Spitfire', 'Stag', 'Dolomite', 'Toledo', 'Acclaim', 'Mayflower', 'Renown', 'Vanguard', 'Ensign', 'Minor', 'Oxford', 'Cambridge', 'Isis', 'Marina',
  'Ital', 'Maxi', 'Allegro', 'Princess', 'Ambassador', 'Metro', 'Maestro', 'Montego', 'Westminster', 'Hereford', 'Somerset', 'Devon', 'Dorset', 'Seven', 'Ruby', 'Mini', 'Clubman',
  'Moke', 'Magnette', 'Midget', 'Sprite', 'Elf', 'Hornet', 'Kestrel', 'Pathfinder', 'Elan', 'Elise', 'Esprit', 'Europa', 'Eclat', 'Excel', 'Evora', 'Exige', 'Cortina Lotus', 'Interceptor',
  'Healey', 'Scimitar', 'Robin', 'Regal', 'Kitten', 'Rialto', 'Fox', 'Sabre', 'Griffith', 'Chimaera', 'Cerbera', 'Tuscan', 'Sagaris', 'Vixen', 'Plus Four', 'Aero', 'Discovery',
  'Defender', 'Freelander', 'Evoque', 'Velar', 'Sport', 'Series', 'Mark 2', 'E-Type', 'XJ', 'XK', 'XJS', 'XF', 'XE', 'F-Pace', 'Sovereign', 'Silver Shadow', 'Silver Ghost', 'Silver Cloud',
  'Phantom', 'Ghost', 'Wraith', 'Dawn', 'Cullinan', 'Corniche', 'Camargue', 'Mulsanne', 'Arnage', 'Continental', 'Bentayga', 'Turbo R', 'DB5', 'Vantage', 'Virage', 'Rapide', 'Lagonda',
  'Golf', 'Polo', 'Passat', 'Jetta', 'Scirocco', 'Corrado', 'Beetle', 'Touareg', 'Tiguan', 'Touran', 'Sharan', 'Phaeton', 'Arteon', 'Lupo', 'Bora', 'Vento', 'Santana', 'Derby', 'Amarok',
  'Caravelle', 'Kombi', 'Karmann', 'Quattro', 'Coupe', 'Cabriolet', 'Uno', 'Punto', 'Panda', 'Tipo', 'Tempra', 'Brava', 'Bravo', 'Stilo', 'Multipla', 'Croma', 'Regata', 'Ritmo', 'Strada',
  'Mirafiori', 'Seicento', 'Cinquecento', 'Topolino', 'Delta', 'Prisma', 'Thema', 'Dedra', 'Beta', 'Gamma', 'Fulvia', 'Flavia', 'Aurelia', 'Stratos', 'Ypsilon', 'Giulia', 'Giulietta',
  'Alfetta', 'Alfasud', 'Spider', 'Brera', 'Mito', 'Stelvio', 'Testarossa', 'Dino', 'Daytona', 'Enzo', 'Countach', 'Miura', 'Diablo', 'Murcielago', 'Gallardo', 'Aventador', 'Huracan',
  'Urus', 'Espada', 'Jarama', 'Urraco', 'Ghibli', 'Quattroporte', 'Bora', 'Merak', 'Khamsin', 'Biturbo', 'Mangusta', 'Pantera', 'Clio', 'Megane', 'Laguna', 'Scenic', 'Espace', 'Twingo',
  'Safrane', 'Fuego', 'Dauphine', 'Caravelle', 'Kangoo', 'Captur', 'Kadjar', 'Zoe', 'Fluence', 'Vel Satis', 'Avantime', 'Modus', 'Traction', 'Ami', 'Dyane', 'Mehari', 'Visa', 'Xsara',
  'Picasso', 'Saxo', 'Xantia', 'Xantia', 'Cactus', 'Pluriel', 'Berlingo', 'Partner', 'Expert', 'Horizon', 'Solara', 'Sunbeam', 'Samba', 'Tagora', 'Matra Rancho', 'Rancho', 'Murena',
  'Bagheera', 'Civic', 'Accord', 'Prelude', 'Integra', 'Legend', 'Jazz', 'Insight', 'Concerto', 'Ballade', 'Quintet', 'Shuttle', 'Stream', 'Corolla', 'Carina', 'Corona', 'Celica',
  'Supra', 'Starlet', 'Yaris', 'Prius', 'Camry', 'Avensis', 'Crown', 'Cressida', 'Previa', 'Hilux', 'Land Cruiser', 'Picnic', 'Aygo', 'Auris', 'Verso', 'Sunny', 'Cherry', 'Bluebird',
  'Primera', 'Almera', 'Micra', 'Laurel', 'Cedric', 'Skyline', 'Silvia', 'Patrol', 'Navara', 'Qashqai', 'Juke', 'Leaf', 'Prairie', 'Serena', 'Colt', 'Lancer', 'Galant', 'Sapporo',
  'Shogun', 'Pajero', 'Carisma', 'Space Wagon', 'Swift', 'Vitara', 'Alto', 'Jimny', 'Ignis', 'Baleno', 'Legacy', 'Impreza', 'Forester', 'Outback', 'Justy', 'Charade', 'Cuore', 'Sirion',
  'Fourtrak', 'Pony', 'Stellar', 'Accent', 'Sonata', 'Lantra', 'Getz', 'Pride', 'Rio', 'Sportage', 'Sorento', 'Ceed', 'Picanto', 'Favorit', 'Felicia', 'Octavia', 'Fabia', 'Superb', 'Estelle',
  'Riva', 'Samara', 'Niva', 'Sierra', 'Kharkov', 'Volga', 'Pobeda', 'Trabant', 'Amazon', 'Estate', 'Duett', 'Viking', 'Sonett', 'Aero', 'Monte Carlo', 'Bel Air', 'Impala', 'Caprice',
  'Chevelle', 'Camaro', 'Corvette', 'Stingray', 'El Camino', 'Silverado', 'Tahoe', 'Suburban', 'Charger', 'Challenger', 'Dart', 'Viper', 'Ram', 'Durango', 'Barracuda', 'Road Runner',
  'Fury', 'Belvedere', 'Valiant', 'Newport', 'Imperial', 'Firebird', 'Trans Am', 'GTO', 'Bonneville', 'Catalina', 'LeMans', 'Riviera', 'Skylark', 'Wildcat', 'Electra', 'Eldorado',
  'DeVille', 'Fleetwood', 'Escalade', 'Navigator', 'Town Car', 'Continental', 'Cougar', 'Marauder', 'Wrangler', 'Cherokee', 'Wagoneer', 'Scout', 'Hummer', 'Model S', 'Model T',
  'Countryman', 'Traveller', 'Clubman', 'Shooting Brake', 'Fairway', 'TX4', 'Metrocab', 'FX4', 'Oxford', 'Carbodies', 'Beardmore',
];

// UK operators: bus and coach, rail passenger and freight, hauliers, ferry lines and airlines.
export const REAL_OPERATORS = [
  'London Transport', 'London General', 'London Buses', 'Transport for London', 'TfL', 'Arriva', 'First', 'FirstGroup', 'First Bus', 'Stagecoach', 'Go-Ahead', 'National Express', 'Megabus',
  'Metroline', 'Abellio', 'RATP', 'Transdev', 'Keolis', 'Rotala', 'Wellglade', 'Trentbarton', 'Brighton & Hove', 'Southern Vectis', 'Oxford Bus', 'Reading Buses', 'Lothian', 'Nottingham City Transport',
  'Blackpool Transport', 'Cardiff Bus', 'Newport Transport', 'Ipswich Buses', 'Warrington', 'Midland Red', 'Crosville', 'Ribble', 'Southdown', 'Eastern National', 'Western National',
  'United Automobile Services', 'Northern General', 'Yorkshire Traction', 'West Yorkshire', 'Bristol Omnibus', 'Maidstone & District', 'East Kent', 'Hants & Dorset', 'Wilts & Dorset',
  'Thames Valley', 'Alder Valley', 'Aldershot & District', 'Potteries', 'PMT', 'Trent', 'Barton', 'Lincolnshire Road Car', 'Eastern Counties', 'United Counties', 'City of Oxford',
  'Western SMT', 'Scottish Bus Group', 'Midland Scottish', 'Highland Omnibuses', 'Ulsterbus', 'Citybus', 'Translink', 'Bus Eireann', 'Dublin Bus', 'Capital Citybus', 'Kentish Bus',
  'London Country', 'Green Line', 'SELNEC', 'GM Buses', 'Merseyside PTE', 'West Midlands Travel', 'Travel West Midlands', 'South Yorkshire Transport', 'Tyne and Wear', 'Nexus',
  'Strathclyde Buses', 'Grampian', 'Busways', 'Badgerline', 'Yellow Buses', 'Go North East', 'Go South Coast', 'Konectbus', 'Hedingham', 'Pennine', 'Harrogate Bus', 'Transpennine Express',
  'Shearings', 'Wallace Arnold', 'Parks of Hamilton', 'Scottish Citylink', 'Flixbus', 'Greyhound', 'Oxford Tube', 'Trathens', 'Ellisons', 'Clarkes of London', 'Leger Holidays', 'Coach USA',
  // rail
  'Great Western Railway', 'GWR', 'LMS', 'London Midland and Scottish', 'LNER', 'London and North Eastern', 'Southern Railway', 'Southern', 'Midland Railway', 'Great Northern', 'Great Eastern',
  'Great Central', 'North Eastern Railway', 'LNWR', 'London and North Western', 'Caledonian Railway', 'Highland Railway', 'North British Railway', 'Lancashire and Yorkshire', 'Furness Railway',
  'Cambrian Railways', 'Taff Vale', 'Metropolitan Railway', 'District Railway', 'London Underground', 'British Railways', 'British Rail', 'BR', 'InterCity', 'Network SouthEast',
  'Regional Railways', 'Railfreight', 'Trainload Freight', 'Railfreight Distribution', 'Rail Express Systems', 'Parcels', 'Loadhaul', 'Mainline Freight', 'Transrail', 'EWS', 'English Welsh & Scottish',
  'DB Cargo', 'DB Schenker', 'Freightliner', 'GB Railfreight', 'GBRf', 'Direct Rail Services', 'DRS', 'Colas Rail', 'Rail Operations Group', 'Harry Needle', 'Europorte', 'Fastline',
  'Avanti', 'Avanti West Coast', 'Virgin Trains', 'Virgin CrossCountry', 'CrossCountry', 'GNER', 'Great North Eastern', 'East Coast', 'National Express East Coast', 'Grand Central',
  'Hull Trains', 'Lumo', 'Chiltern', 'Chiltern Railways', 'c2c', 'LTS Rail', 'Thameslink', 'Govia Thameslink', 'Great Northern', 'Southeastern', 'South Eastern', 'Connex', 'South West Trains',
  'South Western Railway', 'Island Line', 'Gatwick Express', 'Heathrow Express', 'Stansted Express', 'Greater Anglia', 'Anglia Railways', 'One', 'Silverlink', 'London Overground',
  'Elizabeth line', 'Crossrail', 'Merseyrail', 'Northern', 'Northern Rail', 'Northern Spirit', 'Arriva Trains Northern', 'First North Western', 'TransPennine', 'First TransPennine',
  'East Midlands Railway', 'East Midlands Trains', 'Midland Mainline', 'Central Trains', 'London Midland', 'West Midlands Trains', 'Wessex Trains', 'Wales & Borders', 'Transport for Wales',
  'Arriva Trains Wales', 'Valley Lines', 'ScotRail', 'Caledonian Sleeper', 'First Great Western', 'Great Western', 'Thames Trains', 'Anglia', 'Eurostar', 'Le Shuttle', 'Eurotunnel',
  'Metrolink', 'Manchester Metrolink', 'Tramlink', 'Croydon Tramlink', 'Supertram', 'Sheffield Supertram', 'Midland Metro', 'West Midlands Metro', 'Nottingham Express Transit', 'NET',
  'Edinburgh Trams', 'Tyne and Wear Metro', 'Docklands Light Railway', 'DLR', 'Blackpool Tramway', 'Snowdon Mountain Railway', 'Great Orme Tramway', 'Ffestiniog', 'Talyllyn', 'Bluebell Railway',
  'Severn Valley Railway', 'North Yorkshire Moors Railway', 'Brightline', 'Amtrak', 'SNCF', 'Deutsche Bahn', 'NS', 'SBB', 'OBB', 'Trenitalia', 'Renfe', 'JR', 'Iarnrod Eireann',
  // hauliers, ferries and airlines
  'Eddie Stobart', 'Stobart', 'Norbert Dentressangle', 'XPO', 'Wincanton', 'DHL', 'Gist', 'Culina', 'Maritime', 'Knights of Old', 'Turners', 'W H Malcolm', 'John Mitchell', 'Suttons',
  'Hoyer', 'Bibby', 'Pickfords', 'Fowler Welch', 'Kuehne Nagel', 'Christian Salvesen', 'Tesco', 'Sainsbury', 'Asda', 'Morrisons', 'Ceva', 'Yodel', 'Hermes', 'Royal Mail', 'Parcelforce',
  'P&O Ferries', 'Stena Line', 'Brittany Ferries', 'DFDS', 'Condor Ferries', 'Irish Ferries', 'Red Funnel', 'Wightlink', 'CalMac', 'NorthLink', 'Western Ferries', 'Townsend Thoresen',
  'British Airways', 'BOAC', 'BEA', 'British Caledonian', 'Dan-Air', 'Laker', 'British Midland', 'bmi', 'Britannia Airways', 'Monarch', 'Air UK', 'Loganair', 'Flybe', 'easyJet', 'Ryanair',
  'Jet2', 'TUI', 'Thomson', 'Virgin Atlantic', 'Aer Lingus', 'Aurigny', 'Eastern Airways', 'KLM', 'Lufthansa', 'Air France',
  // emergency services named in the brief's spirit: stay clear of real forces
  'Metropolitan Police', 'Thames Valley Police', 'West Mercia', 'West Midlands Police', 'Avon and Somerset', 'Devon and Cornwall', 'Sussex Police', 'Kent Police', 'Essex Police', 'Police Scotland',
];

export const REAL_NAMES = [...REAL_MAKES, ...REAL_MODELS, ...REAL_OPERATORS];
