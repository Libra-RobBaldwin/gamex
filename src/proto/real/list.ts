// The real regions that can be played (public/regions, docs/real.md), for a menu to offer as a
// choice: one card each. Pure data: no fetch, no three.js. `thumb` is a 320 px map of the square
// (tools/os/preview.mjs), under the page's base URL.
export interface RealRegionInfo { id: string; name: string; blurb: string; home: string; thumb: string; credit: string }
const CREDIT = 'Contains OS data © Crown copyright and database right';
export const REAL_REGION_LIST: RealRegionInfo[] = [
  { id: 'exe', name: 'Exeter', blurb: 'A cathedral city on the Exe, with Devon’s coast and hills round it.', home: 'Exeter', thumb: 'regions/exe/thumb.jpg', credit: CREDIT },
  { id: 'teme', name: 'Ludlow', blurb: 'A market town under its castle on the Teme, in the Shropshire Hills.', home: 'Ludlow', thumb: 'regions/teme/thumb.jpg', credit: CREDIT },
];
