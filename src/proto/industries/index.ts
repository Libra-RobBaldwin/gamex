// 3D industries: the catalogue, procedural site models, instanced production effects and
// supply-area overlays. See docs/industries.md for how they plug into the game.
export * from './catalogue';
export * from './state';
export { fitPlot, plotFromLot, plotRect, toWorld, toLocal, type Plot, type SiteFrame, type WXZ } from './site';
export { buildIndustry, defaultPlot, type IndustryModel, type BuildOpts } from './models';
export { IndustryFx, type FxHandle, type FxOptions } from './fx';
export { catchmentOverlay, overlayFor, offsetRing, serves, linkCargo, chainFrom, type CatchmentOverlay, type OverlayIcon } from './overlay';
