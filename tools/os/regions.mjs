// The real regions the bake knows (docs/real.md). Each is a square on the British National Grid:
// its south-west corner (e, n, metres) and its size (50 km as standard). `home` is the place the
// game starts over. Never anywhere tied to a player personally.
export const REGIONS = {
  exe: {
    name: 'Exe Estuary',
    blurb: 'Exeter and its cathedral, the Exe and Teign estuaries, Dartmoor’s eastern edge and the Haldon Hills, the coast from Sidmouth to Torbay',
    e: 265000, n: 50000, size: 50000,
    home: 'Exeter',
  },
  teme: {
    name: 'Teme Valley',
    blurb: 'Ludlow and its castle on the Teme, the Shropshire Hills and the Clee Hills, Leominster, Tenbury Wells and the Marches line',
    e: 326000, n: 250000, size: 50000,
    home: 'Ludlow',
  },
};
