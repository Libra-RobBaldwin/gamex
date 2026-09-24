// The parts of a vehicle that move on their own: door leaves, bogies, steered wheels, coupling
// rods and pantographs. The geometry kit tags their vertices with a motion (kind, a, b, c) and the
// vertex shader moves them from four numbers per vehicle (flags, odometer, doors, curvature), so
// a whole fleet animates without a single extra draw call or per-vehicle mesh.
//
// The maths lives twice: once here in TypeScript, which the tests check and the placement helpers
// use, and once in GLSL below. Keep the two in step: the shader is a line-for-line copy.

export const MOTION = {
  none: 0,
  // a door leaf that steps out then slides (a = slide at full open, signed; b = step, signed z)
  plug: 1,
  // a leaf that slides into a pocket in the body (a = slide, signed; c = x of the pocket's jamb,
  // where the leaf disappears)
  pocket: 2,
  // a leaf on hinges (a, b = hinge x, z; c = swing at full open, signed radians)
  hinge: 3,
  // the two panels of a folding door (a, b = jamb x, z; c = panel width, signed, from the jamb).
  // They fold outward: the body is solid behind a doorway, so panels folded in would vanish.
  foldA: 4,
  foldB: 5,
  // a bogie that swivels under the body (a = pivot x)
  bogie: 6,
  // a steered wheel (a, b = pivot x, z; c = wheelbase)
  steer: 7,
  // a coupling rod carried round by the crank pins (a = crank radius; b = pin angle at rest; c = wheel radius)
  rod: 8,
  // a pantograph that folds down when FLAGS.pantoDown is set (a = the height it folds down to)
  panto: 9,
} as const;

export type Tag = readonly [number, number, number, number];

// Seconds for each kind of door to open fully (closing takes the same time).
// A glider is a leaf that swings out on its arm, as on most buses and coaches since 1990.
export const DOOR_SECONDS = { slam: 1.4, pocket: 2.4, plug: 3.2, fold: 1.8, glider: 2.2 } as const;
export type DoorKind = keyof typeof DOOR_SECONDS;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const ease = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };
// how far a folding door's panels have turned (radians) at t
export const FOLD_MAX = 1.45;
// the pantograph folds down to this share of its height
export const PANTO_DOWN = 0.18;
// how far a bogie or a steered wheel may turn
export const MAX_BOGIE = 0.5, MAX_STEER = 0.6;

// A plug door: out first (the first quarter of the travel), then along (the rest, overlapping a little).
export const plugStep = (t: number) => ease(t / 0.25);
export const plugSlide = (t: number) => ease((t - 0.2) / 0.8);

// Doors on both sides of a vehicle travel as one number per instance: left in the low ten bits,
// right in the next ten. Left is the driver's left (−z), which is the kerb side in Britain.
export function packDoors(left: number, right: number) {
  return Math.round(clamp01(left) * 1023) + 1024 * Math.round(clamp01(right) * 1023);
}
export function unpackDoors(p: number): [number, number] {
  const r = Math.floor(p / 1024);
  return [(p - r * 1024) / 1023, r / 1023];
}

// Wheel turn (radians) for a distance travelled: rolling without slipping.
export const wheelAngle = (odo: number, r: number) => (r > 0 ? -odo / r : 0);
// A bogie at `pivot` metres from the middle of a car whose ends sit on a curve of curvature k
// (1 / radius, positive turning right): the bogie follows the rail's tangent under it.
export const bogieYaw = (pivot: number, k: number) => Math.asin(Math.max(-MAX_BOGIE, Math.min(MAX_BOGIE, pivot * k)));
// A front wheel steered for a curve of curvature k (bicycle model about the rear axle).
export const steerAngle = (wheelbase: number, k: number) => Math.max(-MAX_STEER, Math.min(MAX_STEER, Math.atan(wheelbase * k)));

export interface MotionState { doorL: number; doorR: number; odo: number; curve: number; pantoDown?: boolean }

// Move one vertex the way the shader does. `wheel` is the vertex's wheel centre (vk.zw) if it's
// on a wheel. Returns the new position; used by the tests and by anything that needs to know
// where a moving part is.
export function moveVertex(p: readonly [number, number, number], tag: Tag, s: MotionState, wheel?: readonly [number, number]): [number, number, number] {
  let [x, y, z] = p;
  const [kind, a, b, c] = tag;
  // wheels spin about their centre first
  if (wheel && wheel[1] > 0) {
    const ang = wheelAngle(s.odo, wheel[1]);
    const dx = x - wheel[0], dy = y - wheel[1], co = Math.cos(ang), si = Math.sin(ang);
    x = wheel[0] + co * dx - si * dy; y = wheel[1] + si * dx + co * dy;
  }
  const open = p[2] > 0 ? s.doorR : s.doorL;
  const side = p[2] > 0 ? 1 : -1;
  const yaw = (px: number, pz: number, phi: number) => {
    if (phi === 0) return;
    const dx = x - px, dz = z - pz, co = Math.cos(phi), si = Math.sin(phi);
    x = px + co * dx - si * dz; z = pz + si * dx + co * dz;
  };
  switch (kind) {
    case MOTION.plug: x += a * plugSlide(open); z += b * plugStep(open); break;
    case MOTION.pocket: {
      x += a * ease(open);
      // the part of the leaf past the jamb is inside the pocket: clamping the corners to the
      // jamb is exactly clipping for a rectangle that slides along x
      if (a > 0) x = Math.min(x, c); else if (a < 0) x = Math.max(x, c);
      break;
    }
    case MOTION.hinge: yaw(a, b, c * ease(open)); break;
    case MOTION.foldA: case MOTION.foldB: {
      // both panels turn outward by phi; the second is hinged to the first's far edge and turns
      // back the other way, so its far edge runs along the door line towards the jamb
      const phi = side * Math.sign(c) * FOLD_MAX * ease(open);
      if (kind === MOTION.foldA) yaw(a, b, phi);
      else {
        yaw(a + c, b, -phi);
        x += c * Math.cos(phi) - c; z += c * Math.sin(phi);
      }
      break;
    }
    case MOTION.bogie: yaw(a, 0, bogieYaw(a, s.curve)); break;
    case MOTION.steer: yaw(a, b, steerAngle(c, s.curve)); break;
    case MOTION.rod: {
      const ang = wheelAngle(s.odo, c);
      x += a * (Math.cos(b + ang) - Math.cos(b)); y += a * (Math.sin(b + ang) - Math.sin(b));
      break;
    }
    case MOTION.panto: if (s.pantoDown) y = a + (y - a) * PANTO_DOWN; break;
  }
  return [x, y, z];
}

// The same in GLSL, spliced into the vehicle material. Inputs: `vd` (the tag), `vk` (wheel centre
// in zw), iData = (flags, odometer, packed doors, curvature). It defines mvRot (a turn about y for
// the normal) and moves `transformed`.
export const MOTION_GLSL_COMMON = `
attribute vec4 vd;
float mvEase(float t) { t = clamp(t, 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
vec2 mvDoors(float p) { float r = floor(p / 1024.0 + 0.0001); return vec2(p - r * 1024.0, r) / 1023.0; }
vec2 mvYaw(vec2 p, vec2 c, float a) { vec2 d = p - c; float s = sin(a), co = cos(a); return c + vec2(co * d.x - s * d.y, s * d.x + co * d.y); }
`;
// sets float mvPhi (turn about y of the part, for normals) from the tag
export const MOTION_GLSL_NORMAL = `
int mvKind = int(vd.x + 0.5);
vec2 mvD = mvDoors(iData.z);
float mvOpen = position.z > 0.0 ? mvD.y : mvD.x;
float mvSide = position.z > 0.0 ? 1.0 : -1.0;
float mvPhi = 0.0;
float mvFold = mvSide * sign(vd.w) * ${FOLD_MAX.toFixed(3)} * mvEase(mvOpen);
if (mvKind == ${MOTION.hinge}) mvPhi = vd.w * mvEase(mvOpen);
else if (mvKind == ${MOTION.foldA}) mvPhi = mvFold;
else if (mvKind == ${MOTION.foldB}) mvPhi = -mvFold;
else if (mvKind == ${MOTION.bogie}) mvPhi = asin(clamp(vd.y * iData.w, -${MAX_BOGIE.toFixed(3)}, ${MAX_BOGIE.toFixed(3)}));
else if (mvKind == ${MOTION.steer}) mvPhi = clamp(atan(vd.w * iData.w), -${MAX_STEER.toFixed(3)}, ${MAX_STEER.toFixed(3)});
if (mvPhi != 0.0) objectNormal.xz = mvYaw(objectNormal.xz, vec2(0.0), mvPhi);
`;
export const MOTION_GLSL_VERTEX = `
if (mvKind == ${MOTION.plug}) {
  transformed.x += vd.y * mvEase((mvOpen - 0.2) / 0.8);
  transformed.z += vd.z * mvEase(mvOpen / 0.25);
} else if (mvKind == ${MOTION.pocket}) {
  transformed.x += vd.y * mvEase(mvOpen);
  if (vd.y > 0.0) transformed.x = min(transformed.x, vd.w); else if (vd.y < 0.0) transformed.x = max(transformed.x, vd.w);
} else if (mvKind == ${MOTION.hinge} || mvKind == ${MOTION.foldA}) {
  transformed.xz = mvYaw(transformed.xz, mvKind == ${MOTION.hinge} ? vd.yz : vd.yz, mvPhi);
} else if (mvKind == ${MOTION.foldB}) {
  transformed.xz = mvYaw(transformed.xz, vec2(vd.y + vd.w, vd.z), mvPhi);
  transformed.x += vd.w * cos(mvFold) - vd.w; transformed.z += vd.w * sin(mvFold);
} else if (mvKind == ${MOTION.bogie}) {
  transformed.xz = mvYaw(transformed.xz, vec2(vd.y, 0.0), mvPhi);
} else if (mvKind == ${MOTION.steer}) {
  transformed.xz = mvYaw(transformed.xz, vd.yz, mvPhi);
} else if (mvKind == ${MOTION.rod}) {
  float mvA = vd.w > 0.0 ? -iData.y / vd.w : 0.0;
  transformed.xy += vd.y * vec2(cos(vd.z + mvA) - cos(vd.z), sin(vd.z + mvA) - sin(vd.z));
} else if (mvKind == ${MOTION.panto} && (int(iData.x + 0.5) & 128) != 0) {
  transformed.y = vd.y + (transformed.y - vd.y) * ${PANTO_DOWN.toFixed(3)};
}
`;
