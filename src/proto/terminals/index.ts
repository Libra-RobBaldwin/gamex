// Terminals: loading facilities bought as add-ons for industries (and towns' goods depots), one
// ladder of three tiers per mode, that cap how far an industry can grow. See docs/terminals.md.
export * from './catalogue';
export * from './rules';
export { place, roomCheck, bounds, waterBehind, waterline, overlaps, type Box, type Placement, type Side, type LayoutOpts, type Wanted } from './layout';
export { buildTerminals, fxModel, type Shown, type TerminalsModel, type TerminalBuildOpts } from './models';
