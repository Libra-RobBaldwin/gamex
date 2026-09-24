// Lets the tests import the fixture as data (Vite reads JSON natively; tsconfig doesn't enable
// resolveJsonModule, and this keeps the declaration to this one file).
declare module '*/fixtures/banbury.json' {
  const data: import('./overpass').OverpassJson;
  export default data;
}
declare module '*/fixtures/horley.json' {
  const data: import('./overpass').OverpassJson;
  export default data;
}
