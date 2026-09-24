// 3D industries: the catalogue, how the industries link into supply chains, procedural site
// models, instanced production effects and supply-area overlays. See docs/industries.md for how
// they plug into the game.
export * from './catalogue';
export * from './state';
export { fitPlot, plotFromLot, plotRect, toWorld, toLocal, type Plot, type SiteFrame, type WXZ } from './site';
export { buildIndustry, defaultPlot, type IndustryModel, type BuildOpts } from './models';
export { IndustryFx, type FxHandle, type FxOptions } from './fx';
export { catchmentOverlay, overlayFor, offsetRing, serves, linkCargo, chainFrom, type CatchmentOverlay, type OverlayIcon } from './overlay';
export {
  chainGraph, links, chains, chainsIn, chainsTo, chainsThrough, openIn, whyClosed, explainIndustry, explainChain,
  stepValues, chainPay, perSite, suppliers, chainSites, runCycles, feedable, audit, buildable, inputsIn, outputsIn, makers, takers,
  FIRST_YEAR, LAST_YEAR, REPORT_YEARS, THIN_MARGIN, MAX_SUPPLIERS,
  type Chain, type ChainEdge, type ChainEnd, type ChainGraph, type ChainNode, type ChainSites, type CycleResult, type Era, type Finding,
  type InputNeed, type Link, type NodeId, type Option, type Step, type StepValue, type Supply,
} from './chains';
