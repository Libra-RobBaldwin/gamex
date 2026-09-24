// The vehicle library's public face. See docs/vehicles.md for the brand bible, the API and the
// plan for wiring it into traffic.ts.
export type { Model, Dims, Hitch, Stats, Livery, Lod, Category, BodyStyle } from './types';
export { LIGHT, FLAGS } from './types';
export { MODELS, MODEL, CATEGORY, STYLE_LABEL, modelsIn, buildCatalogue } from './models';
export { BRANDS, BRAND, type Brand, type Line } from './brands';
export { OPERATORS, OPERATOR, liveryFor, operatorsFor, type Operator, type LiveryDef } from './operators';
export { ERAS, eraOf, eraStyle, carColour, palette, plate, fleetNumber, plateCanvas } from './era';
export { geometry, buildKit, triangles, BUDGET, clearGeometryCache } from './build';
export { VehicleRenderer, Glow, vehicleMaterial, liveryColours, lodFor } from './render';
export { lookFor, operatorFor, type Look } from './appearance';
export { pickVehicle, pickTrain, mixSummary, type Area, type Spawn } from './spawn';
export { follow, articulationAngle, consistOffsets, ahead, type Pose } from './articulation';
export { purchaseList, allOffers, type Offer, type OfferKind } from './economy';
// doors and moving parts: where every door is, how to open them, where they are in the world
export { doorsOf, DoorStates, dwellDoors, doorSeconds, doorPositions, platformSide, type Door, type DoorKind, type DoorPlace, type Side, type Placed } from './doors';
export { MOTION, DOOR_SECONDS, packDoors, unpackDoors, wheelAngle, bogieYaw, steerAngle, moveVertex, type MotionState } from './motion';

import { MODEL } from './models';
// True lengths for car-following: the gap to leave behind a vehicle is its length plus a margin
// (traffic.ts uses 7 m for every car and 13 m for every lorry or bus today).
export const followGap = (id: string, margin = 2.5) => (MODEL[id]?.dims.length ?? 4.5) + margin;
