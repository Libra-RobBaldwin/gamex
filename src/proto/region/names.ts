// Invented, plausibly English place names, and the check that none is a real UK place.
//
// Names are built the way English ones were: a first element (a person, a tree, a bird, a colour,
// a landmark) and a second saying what the place was (-ford, -ham, -ley, -wick…), with villages
// sometimes "Little …", "Upper …" or "… Green". Plenty of those combinations are real, so every
// name is checked against REAL_PLACES (below) the way the vehicles library checks its brands: no
// exact match, and nothing one letter off a real name of seven letters or more.
import type { Rand } from './random';

const FIRST = [
  'Alder', 'Amble', 'Aven', 'Barrow', 'Bedwin', 'Birch', 'Blean', 'Bourne', 'Brack', 'Bramble', 'Brindle', 'Brook', 'Bullen', 'Burdock', 'Cawder', 'Chalk', 'Charn', 'Cobble',
  'Coldwin', 'Colne', 'Crake', 'Crest', 'Culver', 'Dapple', 'Deven', 'Dorne', 'Elder', 'Elm', 'Fallow', 'Farn', 'Fell', 'Fern', 'Flint', 'Foss', 'Fox', 'Gorse', 'Gosling', 'Hallow',
  'Harrow', 'Hazel', 'Heron', 'Holly', 'Hunder', 'Ivel', 'Kestle', 'Kettle', 'Kingfish', 'Lark', 'Lavender', 'Linnet', 'Lodden', 'Lynch', 'Mallow', 'Marl', 'Meadow', 'Medlar', 'Merrow',
  'Moor', 'Nettle', 'Oaken', 'Orrin', 'Osier', 'Otter', 'Pebble', 'Pinder', 'Plover', 'Quarn', 'Quill', 'Raven', 'Reed', 'Rowan', 'Rush', 'Saffron', 'Sallow', 'Sedge', 'Sheldon',
  'Silver', 'Sloe', 'Sorrel', 'Sparrow', 'Stoat', 'Swale', 'Tansy', 'Teal', 'Teasel', 'Thistle', 'Tolling', 'Tumble', 'Umber', 'Vetch', 'Wade', 'Wensum', 'Whin', 'Willow', 'Winnow',
  'Withy', 'Wold', 'Wren', 'Yarrow', 'Yew',
];
const SECOND = ['bury', 'by', 'combe', 'cote', 'den', 'don', 'field', 'ford', 'gate', 'ham', 'hurst', 'ley', 'mere', 'minster', 'stead', 'stoke', 'stow', 'thorpe', 'ton', 'well', 'wick', 'worth', 'brook', 'holme', 'marsh', 'bridge', 'wood'];
const BEFORE = ['Little', 'Great', 'Upper', 'Lower', 'Nether', 'Long', 'East', 'West', 'North', 'South'];
const AFTER = ['Green', 'End', 'Common', 'Heath', 'Cross', 'St Mary', 'Magna', 'Parva'];

// Real UK places the invented names mustn't be: the towns everyone knows, and the real places the
// elements above make (Ashford, Bramley, Stanton, Thornbury…). It's a small list, not a gazetteer:
// the elements were chosen to be rare in real names, and this catches the ones that aren't.
export const REAL_PLACES = [
  // towns and cities everyone knows
  'London', 'Birmingham', 'Manchester', 'Liverpool', 'Leeds', 'Sheffield', 'Bristol', 'Newcastle', 'Nottingham', 'Leicester', 'Coventry', 'Bradford', 'Hull', 'Stoke', 'Wolverhampton',
  'Derby', 'Southampton', 'Portsmouth', 'Plymouth', 'Reading', 'Oxford', 'Cambridge', 'York', 'Bath', 'Exeter', 'Norwich', 'Ipswich', 'Brighton', 'Swindon', 'Luton', 'Northampton',
  'Peterborough', 'Milton Keynes', 'Watford', 'Slough', 'Guildford', 'Woking', 'Crawley', 'Horley', 'Redhill', 'Reigate', 'Dorking', 'Horsham', 'Maidstone', 'Canterbury', 'Dover',
  'Ashford', 'Chelmsford', 'Colchester', 'Basildon', 'Southend', 'Stevenage', 'Harlow', 'Bedford', 'Aylesbury', 'High Wycombe', 'Banbury', 'Bicester', 'Witney', 'Abingdon', 'Didcot',
  'Newbury', 'Basingstoke', 'Andover', 'Winchester', 'Salisbury', 'Bournemouth', 'Poole', 'Weymouth', 'Dorchester', 'Yeovil', 'Taunton', 'Wells', 'Glastonbury', 'Gloucester',
  'Cheltenham', 'Worcester', 'Hereford', 'Shrewsbury', 'Telford', 'Stafford', 'Lichfield', 'Tamworth', 'Burton', 'Chester', 'Crewe', 'Stockport', 'Bolton', 'Wigan', 'Preston',
  'Blackpool', 'Lancaster', 'Kendal', 'Carlisle', 'Durham', 'Sunderland', 'Middlesbrough', 'Darlington', 'Harrogate', 'Scarborough', 'Whitby', 'Lincoln', 'Grantham', 'Boston',
  'Kings Lynn', 'Cromer', 'Lowestoft', 'Bury St Edmunds', 'Sudbury', 'Hastings', 'Eastbourne', 'Lewes', 'Chichester', 'Worthing', 'Bognor', 'Cardiff', 'Swansea', 'Newport',
  'Wrexham', 'Bangor', 'Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness', 'Perth', 'Stirling', 'Belfast', 'Derry', 'Armagh', 'Newry', 'Lisburn',
  // real places the elements make
  'Alderley', 'Alderton', 'Aldermaston', 'Alderholt', 'Alderminster', 'Alderbury', 'Alderford', 'Amblecote', 'Ambleside', 'Barrowby', 'Barrowden', 'Barrowford', 'Barrow', 'Birchington',
  'Birchwood', 'Birchley', 'Blean', 'Bourne', 'Bournemouth', 'Bourne End', 'Brackley', 'Bracknell', 'Brackenfield', 'Brookwood', 'Brookland', 'Brooke', 'Chalkwell', 'Chalton', 'Charnwood',
  'Charlton', 'Cobham', 'Colnbrook', 'Colne', 'Coldharbour', 'Crakehall', 'Culverstone', 'Culworth', 'Elmley', 'Elmstead', 'Elmswell', 'Elmsted', 'Elmore', 'Elmdon', 'Elmton',
  'Elmbridge', 'Elm', 'Fallowfield', 'Farnham', 'Farnborough', 'Farncombe', 'Farndon', 'Farnley', 'Farnworth', 'Fernhurst', 'Ferndown', 'Fernham', 'Flintham', 'Fosston', 'Foxton',
  'Foxley', 'Foxham', 'Foxwood', 'Foxholes', 'Gorsley', 'Hazelwood', 'Hazelbury Bryan', 'Hazleton', 'Heronsgate', 'Hollybush', 'Hollingbourne', 'Kettlewell', 'Kettleby', 'Kettering',
  'Larkfield', 'Larkhill', 'Lynch', 'Marlow', 'Marlborough', 'Marldon', 'Marston', 'Meadowfield', 'Merrow', 'Moreton', 'Moorland', 'Moortown', 'Moorby', 'Nettleham', 'Nettlebed',
  'Nettleton', 'Nettlestead', 'Oakham', 'Oakley', 'Oakford', 'Oakworth', 'Oakwood', 'Otterton', 'Otterbourne', 'Ottery St Mary', 'Otterburn', 'Otterham', 'Otterford', 'Pinder',
  'Quarndon', 'Ravensthorpe', 'Ravenstone', 'Ravensden', 'Ravenfield', 'Ravensworth', 'Reedham', 'Reedness', 'Rowanburn', 'Rushden', 'Rushton', 'Rushmere', 'Rushbrooke', 'Rushwick',
  'Rushford', 'Rushall', 'Saffron Walden', 'Sedgefield', 'Sedgeford', 'Sedgemoor', 'Sedgebrook', 'Sheldon', 'Silverdale', 'Silverstone', 'Silverton', 'Sloley', 'Sparrowpit',
  'Swaledale', 'Swaleby', 'Tealby', 'Thistleton', 'Tumby', 'Wadebridge', 'Wadhurst', 'Wadworth', 'Wadenhoe', 'Wensley', 'Whinburgh', 'Willoughby', 'Willowbrook', 'Withycombe',
  'Withington', 'Withyham', 'Woldingham', 'Wrentham', 'Wrenbury', 'Yarmouth', 'Yarm', 'Yarnton', 'Yeovil', 'Yewdale', 'Brookmans Park', 'Ivelet', 'Coleford', 'Culverden',
  'Hollingworth', 'Hallow', 'Harrow', 'Harrowden', 'Harrow Weald', 'Hunderthwaite', 'Kestle Mill', 'Fellbeck', 'Fellside', 'Linnet', 'Mallowdale', 'Barrowford', 'Burdock',
  'Cawdor', 'Charnock', 'Crestwood', 'Dappleby', 'Devenish', 'Dornoch', 'Elderslie', 'Farnsfield', 'Fossdyke', 'Gosberton', 'Heronden', 'Moorhouse', 'Osierfield', 'Pebmarsh',
  'Ploverfield', 'Quilton', 'Reedley', 'Rowanfield', 'Sallowfield', 'Sorrelby', 'Stoatley', 'Tansley', 'Teesdale', 'Umberleigh', 'Vetchfield', 'Whinfield', 'Winnowfield',
  'Yarrowford', 'Brackenborough', 'Brookhurst', 'Elmstone', 'Foxhurst', 'Hazelhurst', 'Oakhurst', 'Oakhanger', 'Silverley', 'Swalecliffe', 'Tumbledown', 'Wrenwick', 'Kingsbridge',
  'Kingston', 'Kingsley', 'Kingswood', 'Stanton', 'Stanford', 'Stanley', 'Ashton', 'Ashby', 'Ashley', 'Bramley', 'Brampton', 'Thornbury', 'Thornton', 'Langley', 'Langford', 'Norton',
  'Sutton', 'Newton', 'Weston', 'Easton', 'Aston', 'Preston', 'Milton', 'Hinton', 'Burford', 'Bradwell', 'Whitchurch', 'Whitwell', 'Wickham', 'Woodbridge', 'Woodstock', 'Woodford',
  'Silverdale', 'Elmham', 'Elmsett', 'Elmswell', 'Hollingbury', 'Orrell', 'Alderwasley', 'Ambleston', 'Birchover', 'Bramblefield', 'Burdocks', 'Chalkfield', 'Culverhouse',
  'Birchfield', 'Brookfield', 'Fernwood', 'Foxcote', 'Foxford', 'Heronbridge', 'Holywell', 'Moorgate', 'Nettleden', 'Otterden', 'Rushbury', 'Sedgwick',
  'Willowfield', 'Withybrook', 'Felbridge', 'Elmfield', 'Silverwood', 'Moorside', 'Oakenshaw', 'Birchgrove', 'Elmhurst', 'Hazelford', 'Larkhall', 'Brackenhurst',
  'Great Barrow', 'Little Barrow', 'Long Marston', 'Little Marlow', 'Great Marlow', 'Upper Heyford', 'Lower Heyford', 'Nether Stowey', 'East Grinstead', 'West Wycombe',
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
const REAL = new Set(REAL_PLACES.map(norm));
// (only the longer names get the one-letter check: at six letters or fewer it would forbid far too much)
const LONG = REAL_PLACES.map(norm).filter((n) => n.length >= 7);

function oneEditApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Is this (too close to) a real UK place name?
export function isRealPlace(name: string) {
  const n = norm(name);
  if (REAL.has(n)) return true;
  if (n.length >= 7) for (const r of LONG) if (oneEditApart(n, r)) return true;
  // and "Little Otterton" is still Otterton: check the main word on its own too
  const words = name.split(/\s+/).filter((w) => !BEFORE.includes(w) && !AFTER.some((a) => a.split(' ').includes(w)));
  if (words.length && words.length < name.split(/\s+/).length) return isRealPlace(words.join(' '));
  return false;
}

// One invented name. `village` names sometimes get "Little …" or "… Green".
export function placeName(rand: Rand, village: boolean, taken: Set<string>): string {
  for (let tries = 0; tries < 400; tries++) {
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const second = SECOND[Math.floor(rand() * SECOND.length)];
    // (nothing that reads badly across the join: "Brookbrook", "Fellley")
    if (first.toLowerCase().endsWith(second.slice(0, 3))) continue;
    let name = first + second;
    if (/(.)\1\1/.test(name.toLowerCase())) continue;
    if (village) {
      const r = rand();
      if (r < 0.2) name = `${BEFORE[Math.floor(rand() * BEFORE.length)]} ${name}`;
      else if (r < 0.35) name = `${name} ${AFTER[Math.floor(rand() * AFTER.length)]}`;
    }
    // (and no two places on a map share their first part: Withygate and Withystoke would be confusing)
    if (taken.has(norm(name)) || taken.has(`first:${first}`) || [...taken].some((t) => t.includes(norm(first + second)) || norm(first + second).includes(t))) continue;
    if (isRealPlace(name)) continue;
    taken.add(norm(name));
    taken.add(`first:${first}`);
    return name;
  }
  throw new Error('placeName: ran out of names');
}
