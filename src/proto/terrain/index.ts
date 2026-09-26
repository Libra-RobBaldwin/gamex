// The terrain library: one import for the rest of the game. See docs/terrain.md.
export * from './height';
export * from './noise';
export * from './raster';
export { align, alignRoute, alignSpec, resample, ALIGN_COSTS, type AlignCosts, type AlignInput, type AlignSpec, type Alignment, type Kind, type RouteAlignment, type RouteOpts, type Span, type Structure } from './align';
export * from './earthworks';
export { levelPad, rectPoly, PAD_COSTS, PAD_RULES, type Pad, type PadCosts, type PadOpts, type PadRule, type Wall } from './platform';
export { cutHoles, drapeStrip, raycast, tileMesh, waterMesh, type MeshData, type Stitch, type TileOpts } from './mesh';
