// The vertex shaders that place and pose every figure. Nothing is stepped on the CPU: each
// instance carries its route leg, speed, timings and looks, and the shader works out where it
// is and what its limbs are doing from the clock. Walking is keyed to distance travelled, so
// feet don't slide. The game's own Lambert material is patched rather than replaced, so people
// are lit, shadowed and fogged like everything else. Fades use a screen-door dither, so
// figures stay in the opaque pass (no sorting) and shadows fade with them.
import * as THREE from 'three';
import { BODY, P, A, B, Q } from './geometry';

// Per-instance attributes, four floats each. See `Rec` in store.ts for what goes in them.
export const ATTRS = ['iLeg', 'iMove', 'iTime', 'iRoute', 'iLook', 'iColA', 'iColB', 'iStyle'] as const;
export const STRIDE = ATTRS.length * 4;

export type Kind = 'person' | 'personMid' | 'card' | 'animal' | 'animalMid' | 'bird' | 'bike' | 'pushchair' | 'wheelchair';
const KIND_ID: Record<Kind, number> = { person: 0, personMid: 0, card: 1, animal: 2, animalMid: 2, bird: 3, bike: 4, pushchair: 4, wheelchair: 4 };

const COMMON = /* glsl */ `
attribute float aPart;
${ATTRS.map((a) => `attribute vec4 ${a};`).join('\n')}
attribute vec4 iShow; // count, index, shown, hidden
uniform float uTime;
uniform float uRain;
flat varying float vFade;
flat varying float vSel;
flat varying vec3 vColA;
flat varying vec3 vColB;
flat varying vec3 vColC;
varying vec3 vLocal;

vec3 unpackCol(float c) {
  c = floor(c + 0.5);
  vec3 v = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0;
  return pow(v, vec3(2.2));
}
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c + v.z * s, -v.y * s + v.z * c); }
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 aboutX(vec3 p, vec3 pivot, float a) { return pivot + rotX(p - pivot, a); }

// where along its route a figure is (the CPU twin is routeS() in track.ts)
float gSr; float gMoving; float gA; vec2 gP;
float trackEval(float extraS) {
  float t = uTime, mode = iTime.w, Ltot = iRoute.x, v = iMove.y;
  float sr, moving;
  if (mode < 1.5) { sr = mod(iMove.z + v * t, Ltot); moving = step(0.01, v); }
  else if (mode < 2.5) {
    float raw = iMove.z + v * max(0.0, t - iTime.x);
    sr = min(raw, Ltot);
    moving = (t > iTime.x && raw < Ltot && v > 0.01) ? 1.0 : 0.0;
  } else { sr = iMove.z; moving = 0.0; }
  int flags = int(iRoute.z + 0.5);
  float s = sr - iRoute.y + extraS, L = iMove.x;
  float on = 1.0;
  if (extraS == 0.0) {
    if (s < 0.0) on = 0.0;
    if (s >= L && !((flags & 2) != 0 && mode > 1.5)) on = 0.0;
  }
  float sc = extraS == 0.0 ? clamp(s, 0.0, L) : s;
  float a = iLeg.z + iLeg.w * sc;
  vec2 p;
  if (abs(iLeg.w) < 1e-6) p = iLeg.xy + vec2(cos(iLeg.z), sin(iLeg.z)) * sc;
  else p = iLeg.xy + vec2(sin(a) - sin(iLeg.z), cos(iLeg.z) - cos(a)) / iLeg.w;
  if (extraS == 0.0) { gSr = sr; gMoving = moving; gA = a; gP = p + vec2(sin(a), -cos(a)) * iMove.w; }
  else gP = p;
  // fades: route ends (open loops), the time window, the crowd's count, the group's LOD fade
  float al = on;
  if (mode < 0.5) al *= smoothstep(0.0, 1.2, sr) * smoothstep(0.0, 1.2, Ltot - sr);
  if (iTime.z > iTime.y) {
    al *= (flags & 4) != 0 ? step(iTime.y, t) : smoothstep(iTime.y, iTime.y + 0.6, t);
    al *= (flags & 8) != 0 ? 1.0 - step(iTime.z, t) : 1.0 - smoothstep(iTime.z - 0.5, iTime.z, t);
  }
  al *= clamp(iShow.x - iShow.y, 0.0, 1.0);
  al *= smoothstep(iShow.z, iShow.z + 0.6, t);
  if (iShow.w > 0.0) al *= 1.0 - smoothstep(iShow.w, iShow.w + 0.6, t);
  return al;
}
// heading angle (travel direction a) to a rotation about y taking local +z onto it
float yawOf(float a) { return 1.5707963 - a; }
vec3 place(vec3 local, float yaw) { return rotY(local, yaw) + vec3(gP.x, iRoute.w, gP.y); }
const vec3 HIDDEN = vec3(0.0, -10000.0, 0.0);
`;

const PERSON = /* glsl */ `
const vec4 HATC[13] = vec4[13](vec4(0.0), vec4(1.04, 0.4, 1.05, 0.95), vec4(1.0, 1.0, 1.0, 0.8), vec4(1.02, 0.85, 1.05, 0.75), vec4(1.18, 0.9, 1.15, 0.72), vec4(1.12, 0.6, 1.12, 1.12), vec4(1.05, 0.8, 1.05, 0.7), vec4(1.18, 0.65, 1.32, 0.8), vec4(1.05, 2.3, 1.1, 0.6), vec4(0.9, 0.55, 0.6, 1.0), vec4(1.0, 0.55, 1.0, 1.0), vec4(1.03, 0.5, 1.05, 0.95), vec4(1.15, 0.7, 1.18, 0.9));
const vec4 HATD[13] = vec4[13](vec4(0.0), vec4(-0.005, 0.015, 0.62, 0.5), vec4(0.0, 0.0, 0.85, 0.8), vec4(0.0, 0.0, 1.0, 0.95), vec4(-0.01, 0.0, 0.9, 0.9), vec4(0.0, 0.0, 0.6, 0.45), vec4(-0.04, 0.0, 0.0, 0.0), vec4(-0.005, -0.01, 0.0, 0.0), vec4(0.0, 0.0, 0.75, 0.78), vec4(0.02, -0.03, 0.0, 0.0), vec4(0.0, 0.0, 1.1, 1.05), vec4(-0.005, 0.01, 0.6, 0.45), vec4(-0.06, -0.01, 0.0, 0.0));
const float HATZ[13] = float[13](0.0, 0.1, 0.0, 0.0, 0.02, 0.12, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0);

void figure(inout vec3 Pp, inout vec3 Nn, out float fade) {
  int part = int(aPart + 0.5);
  fade = trackEval(0.0);
  float H = iLook.x / 1.75, Bw = iLook.y, ph = iLook.w;
  int idle = int(iLook.z + 0.5);
  int style = int(iStyle.x + 0.5), hair = style % 16, hat = style / 16;
  int bits = int(iStyle.y + 0.5), prop = int(iStyle.z + 0.5);
  bool elderly = (bits & 128) != 0;
  float child = clamp((1.35 - iLook.x) / 0.45, 0.0, 1.0);
  float tau = uTime + ph * 41.0;
  bool umb = (bits & 8) != 0 && uRain > fract(ph * 7.31) * 0.7 + 0.15 && prop != 1;
  float v = iMove.y;
  bool moving = gMoving > 0.5;
  bool run = moving && v > 2.2 && prop == 0;

  // ---- pose: joint angles (positive swings a limb's lower end forward)
  float thL = 0.0, thR = 0.0, shL = 0.0, shR = 0.0, arL = 0.04, arR = 0.04, lean = 0.0, bob = 0.0, drop = 0.0, yaw = 0.0, pitch = 0.0, sway = 0.0, armLen = 1.0;
  vec3 offset = vec3(0.0);
  float phi = gSr / (1.45 * H * (run ? 1.55 : 1.0)) * 6.2831853 + ph * 6.2831853;
  if (prop == 1) {
    // cycling: each foot follows its pedal round the crank (two-bone IK), leaning to the bars
    offset = vec3(0.0, 0.95 - ${BODY.hipY} * H, -0.2);
    float c = gSr / 4.0 * 6.2831853 + ph * 6.2831853;
    if (!moving) c = 0.6;
    for (int k = 0; k < 2; k++) {
      float ck = c + float(k) * 3.14159265;
      vec2 foot = vec2(0.32 + 0.16 * cos(ck), 0.02 + 0.16 * sin(ck));
      vec2 D = (foot - vec2(0.95, -0.2)) / H;
      float d = clamp(length(D), 0.2, 0.85);
      float beta = atan(D.y, -D.x);
      float L1 = ${(BODY.hipY - BODY.kneeY).toFixed(3)}, L2 = 0.47;
      float al = acos(clamp((L1 * L1 + d * d - L2 * L2) / (2.0 * L1 * d), -1.0, 1.0));
      float ga = acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2.0 * L1 * L2), -1.0, 1.0));
      if (k == 0) { thL = beta + al; shL = -(3.14159265 - ga); } else { thR = beta + al; shR = -(3.14159265 - ga); }
    }
    lean = 0.42; arL = arR = 1.2;
  } else if (prop == 3 || (idle == 3 && !moving)) {
    // sitting: on a bench, or in a wheelchair pushing the rims
    thL = thR = 1.5; shL = shR = -1.5;
    drop = ${BODY.hipY} - (prop == 3 ? 0.5 : 0.46) / H;
    arL = arR = 0.55;
    if (prop == 3 && moving) { float c = gSr / 1.3 * 6.2831853; arL = arR = 0.25 + 0.35 * sin(c); lean = 0.12 + 0.08 * sin(c); }
  } else if (moving) {
    float amp = run ? 0.72 : (elderly ? 0.28 : 0.42);
    float sp = sin(phi), cp = cos(phi);
    thL = amp * sp; thR = -amp * sp;
    float kk = run ? 1.5 : 0.75;
    shL = -kk * max(0.0, cp) - (run ? 0.35 : 0.04);
    shR = -kk * max(0.0, -cp) - (run ? 0.35 : 0.04);
    arL = -thL * (run ? 1.1 : 0.8); arR = -thR * (run ? 1.1 : 0.8);
    bob = (run ? 0.06 : 0.02) * (cos(2.0 * phi) + 1.0) * 0.5;
    lean = run ? 0.2 : 0.04;
    if (child > 0.5 && idle == 5) bob += 0.03 * abs(sin(phi));
  } else {
    sway = 0.012 * sin(tau * 0.8);
    yaw = 0.25 * sin(tau * 0.13);
    if (idle == 1) {
      // waiting: shifting weight, the odd small step, looking up the road
      sway = 0.03 * sin(tau * 0.5);
      float st = pow(max(0.0, sin(tau * 0.7)), 12.0);
      thL = 0.25 * st; shL = -0.4 * st;
      yaw = 0.7 * sin(tau * 0.21) * step(0.0, sin(tau * 0.09));
    } else if (idle == 2) {
      arR = 1.05; armLen = 0.6; pitch = 0.35; yaw = 0.0;
    } else if (idle == 4) {
      arR = 0.15 + 0.35 * max(0.0, sin(tau * 1.7)) * step(0.3, sin(tau * 0.4));
      yaw = 0.35 * sin(tau * 0.3); pitch = 0.05 * sin(tau * 2.3);
    } else if (idle == 5) {
      float j = abs(sin(tau * 4.0));
      bob = 0.1 * j; arL = arR = 0.4 + 2.2 * j * step(0.0, sin(tau * 0.9));
      thL = thR = 0.15 * j; shL = shR = -0.3 * j;
    }
  }
  if (elderly && prop != 3) lean += 0.18;
  if (prop == 2) { arL = arR = 1.05 - lean; }
  if ((bits & 3) != 0 && !umb) arR *= 0.35;
  if ((bits & 16) != 0 && !umb && prop == 0) arR = 0.28;
  if (umb) arR = 2.75;

  // ---- shape the parts for this figure
  vec3 p = Pp, n = Nn;
  bool headPart = part == ${P.Head} || part == ${P.Hair} || part == ${P.Crown} || part == ${P.Brim} || part == ${P.HeadM};
  bool upper = headPart || part == ${P.Chest} || part == ${P.ArmL} || part == ${P.ArmR} || part == ${P.Bag} || part == ${P.Pack} || part == ${P.Umbrella} || part == ${P.Body};
  bool collapse = false;
  if (part == ${P.Hips} || part == ${P.Body}) {
    // skirts and long coats flare out and down from the hips
    float lo = 0.8, fx = 1.0;
    if ((bits & 256) != 0) { lo = 0.56; fx = 1.12; }
    if ((bits & 512) != 0) { lo = min(lo, 0.5); fx = max(fx, 1.25); }
    if ((bits & 1024) != 0) { lo = 0.08; fx = 1.45; }
    if (p.y < 0.85) { p.y = lo; p.x *= fx; p.z *= mix(1.0, fx, 0.8); }
  } else if (part == ${P.Hair}) {
    if (hair == 0) collapse = true;
    bool low = p.y < 1.6;
    if (hair == 2 && low) { p.y = 1.47; p.x *= 1.08; }
    if (hair == 3 && low) { p.y = p.z < 0.0 ? 1.28 : 1.45; p.x *= 1.06; }
    if (hair == 4 && p.y > 1.7 && p.z < 0.0) { p.z -= 0.08; p.y += 0.02; }
  } else if (part == ${P.Crown}) {
    vec4 c = HATC[hat], d = HATD[hat];
    if (hat == 0) collapse = true;
    p.y = 1.7 + (p.y - 1.7) * c.y + d.x;
    p.x *= c.x; p.z = p.z * c.z + d.y;
    if (p.y > 1.71 + d.x) { p.x *= c.w; p.z = (p.z - d.y) * c.w + d.y; }
  } else if (part == ${P.Brim}) {
    vec4 d = HATD[hat];
    if (d.z == 0.0) collapse = true;
    p.x *= d.z; p.z = p.z * d.w + HATZ[hat]; p.y += d.x;
  } else if (part == ${P.Bag}) {
    if ((bits & 3) == 0 || umb) collapse = true;
    if ((bits & 2) != 0) { p.y = p.y < 0.6 ? 0.52 : 0.74; p.x -= 0.005; p.z *= 1.15; } // briefcase
  } else if (part == ${P.Pack}) {
    if ((bits & 4) == 0) collapse = true;
  } else if (part == ${P.Umbrella}) {
    if (!umb) collapse = true;
  } else if (part == ${P.Stick}) {
    if ((bits & 16) == 0 || umb || prop != 0) collapse = true;
  }
  if (collapse) { Pp = HIDDEN; fade = 0.0; return; }
  if (!headPart) p.x *= Bw;
  if (part == ${P.Hips} || part == ${P.Chest} || part == ${P.Body} || part == ${P.Pack}) p.z *= mix(1.0, Bw, 0.7);
  // children have bigger heads for their size
  vec3 neck = vec3(0.0, ${BODY.neckY}, 0.0);
  if (headPart) {
    p = neck + (p - neck) * (1.0 + 0.3 * child);
    p = neck + rotY(rotX(p - neck, -pitch), yaw); n = rotY(rotX(n, -pitch), yaw);
  }
  // limbs about their joints
  vec3 hip = vec3(0.0, ${BODY.hipY}, 0.0), knee = vec3(0.0, ${BODY.kneeY}, 0.0), sh = vec3(0.0, ${BODY.shoulderY}, 0.0);
  if (part == ${P.ThighL} || part == ${P.LegL}) { p = aboutX(p, hip, thL); n = rotX(n, thL); }
  else if (part == ${P.ThighR} || part == ${P.LegR}) { p = aboutX(p, hip, thR); n = rotX(n, thR); }
  else if (part == ${P.ShinL}) { p = aboutX(aboutX(p, knee, shL), hip, thL); n = rotX(n, shL + thL); }
  else if (part == ${P.ShinR}) { p = aboutX(aboutX(p, knee, shR), hip, thR); n = rotX(n, shR + thR); }
  else if (part == ${P.ArmL}) { p = aboutX(p, sh, arL); n = rotX(n, arL); }
  else if (part == ${P.ArmR} || part == ${P.Bag}) {
    if (part == ${P.ArmR}) p.y = sh.y + (p.y - sh.y) * armLen;
    p = aboutX(p, sh, arR); n = rotX(n, arR);
  }
  if (upper) { p = aboutX(p, vec3(0.0, 0.9, 0.0), -lean); n = rotX(n, -lean); }
  p.x += sway;
  p.y += bob - drop;
  p = p * H + offset;
  float yw = yawOf(gA);
  Pp = place(p, yw);
  Nn = rotY(n, yw);

  // ---- colours (picked per pixel in the fragment shader where one part has two)
  vec3 top = unpackCol(iColA.x), bottom = unpackCol(iColA.y), skin = unpackCol(iColA.z), hairc = unpackCol(iColA.w);
  vec3 hatc = unpackCol(iColB.x), carryc = unpackCol(iColB.y), trim = unpackCol(iColB.z), shoes = unpackCol(iColB.w);
  bool coat = (bits & 256) != 0, skirt = (bits & 1536) != 0;
  vec3 hipsC = coat ? top : bottom;
  vec3 legC = skirt && !coat ? vec3(0.012) : bottom;
  if (skirt && coat) legC = vec3(0.012);
  vColA = top; vColB = trim; vColC = skin; vSel = 0.0;
  if (part == ${P.Hips}) { vColA = hipsC; vSel = (bits & 2048) != 0 ? 5.0 : 0.0; }
  else if (part == ${P.Chest}) { vSel = (bits & 32) != 0 ? 3.0 : (bits & 64) != 0 ? 4.0 : (bits & 2048) != 0 ? 5.0 : 0.0; }
  else if (part == ${P.Head}) vColA = skin;
  else if (part == ${P.Hair}) vColA = hairc;
  else if (part == ${P.ThighL} || part == ${P.ThighR}) vColA = legC;
  else if (part == ${P.ShinL} || part == ${P.ShinR} || part == ${P.LegL} || part == ${P.LegR}) { vColA = legC; vColB = shoes; vSel = 1.0; }
  else if (part == ${P.ArmL} || part == ${P.ArmR}) { vColB = skin; vSel = 2.0; }
  else if (part == ${P.Crown} || part == ${P.Brim}) vColA = hatc;
  else if (part == ${P.Bag} || part == ${P.Pack}) vColA = part == ${P.Pack} ? carryc * 0.8 : carryc;
  else if (part == ${P.Umbrella}) vColA = carryc;
  else if (part == ${P.Stick}) vColA = vec3(0.12, 0.05, 0.02);
  else if (part == ${P.Body}) { vColB = hipsC; vSel = 7.0; }
  else if (part == ${P.HeadM}) { vColA = skin; vColB = hairc; vSel = hair == 0 ? 0.0 : 8.0; }
}
`;

const CARD = /* glsl */ `
void figure(inout vec3 Pp, inout vec3 Nn, out float fade) {
  fade = trackEval(0.0);
  float H = iLook.x / 1.75;
  int bits = int(iStyle.y + 0.5), prop = int(iStyle.z + 0.5);
  bool seated = prop == 3 || (int(iLook.z + 0.5) == 3 && gMoving < 0.5);
  float bob = gMoving > 0.5 ? 0.03 * abs(sin(gSr * 4.3 / H)) : 0.0;
  vec3 p = Pp;
  p.y = p.y * H * (seated ? 0.72 : 1.0) + bob + (prop == 1 ? 0.3 : 0.0);
  p.x *= iLook.y * (seated ? 1.3 : 1.0);
  // turn to face the camera
  vec3 w = vec3(gP.x, iRoute.w, gP.y);
  vec3 toCam = isOrthographic ? vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]) : cameraPosition - w;
  float yw = atan(toCam.x, toCam.z);
  Pp = rotY(p, yw) + w;
  Nn = rotY(Nn, yw);
  vec3 top = unpackCol(iColA.x), bottom = unpackCol(iColA.y);
  bool coat = (bits & 256) != 0, skirt = (bits & 1536) != 0;
  vColA = top; vColB = coat ? top : bottom; vColC = unpackCol(iColA.z); vSel = 6.0;
  if (skirt) vColB = coat ? top : bottom;
}
`;

// Dog breeds, a cat, sheep and a cow, as proportions of one body plan.
// SA: body width, height, length, leg length. SB: head size, snout length, ear style, tail style.
// SC: head raised above the back, tail length, leg thickness, ear size.
export const SPECIES = ['labrador', 'dachshund', 'terrier', 'spaniel', 'whippet', 'collie', 'bulldog', 'poodle', 'cat', 'sheep', 'cow'] as const;
export type Species = (typeof SPECIES)[number];
export const DOGS: Species[] = ['labrador', 'dachshund', 'terrier', 'spaniel', 'whippet', 'collie', 'bulldog', 'poodle'];
const SA = [[0.26, 0.3, 0.62, 0.34], [0.15, 0.17, 0.56, 0.1], [0.17, 0.2, 0.34, 0.17], [0.21, 0.25, 0.48, 0.26], [0.15, 0.23, 0.55, 0.42], [0.22, 0.27, 0.58, 0.32], [0.3, 0.25, 0.42, 0.17], [0.19, 0.24, 0.4, 0.33], [0.14, 0.16, 0.4, 0.18], [0.44, 0.46, 0.82, 0.3], [0.62, 0.72, 1.75, 0.66]];
const SB = [[0.19, 0.1, 1, 1], [0.13, 0.1, 1, 1], [0.14, 0.05, 0, 2], [0.16, 0.07, 3, 2], [0.12, 0.12, 0, 1], [0.16, 0.1, 0, 3], [0.22, 0.03, 0, 2], [0.15, 0.08, 1, 2], [0.11, 0.02, 0, 4], [0.2, 0.1, 5, 2], [0.3, 0.22, 5, 1]];
const SC = [[0.1, 0.35, 0.07, 0.08], [0.06, 0.25, 0.05, 0.07], [0.07, 0.12, 0.05, 0.05], [0.08, 0.14, 0.06, 0.11], [0.12, 0.38, 0.04, 0.04], [0.1, 0.35, 0.06, 0.06], [0.02, 0.08, 0.08, 0.05], [0.12, 0.14, 0.05, 0.08], [0.08, 0.36, 0.04, 0.05], [0.08, 0.1, 0.08, 0.06], [0.12, 0.75, 0.13, 0.1]];
const vec4s = (rows: number[][]) => rows.map((r) => `vec4(${r.map((x) => x.toFixed(3)).join(', ')})`).join(', ');

const ANIMAL = /* glsl */ `
const vec4 SA[${SA.length}] = vec4[${SA.length}](${vec4s(SA)});
const vec4 SB[${SB.length}] = vec4[${SB.length}](${vec4s(SB)});
const vec4 SC[${SC.length}] = vec4[${SC.length}](${vec4s(SC)});
// idle: 0 stand, 1 sniff, 2 sit, 3 graze, 4 lie
void figure(inout vec3 Pp, inout vec3 Nn, out float fade) {
  int part = int(aPart + 0.5);
  fade = trackEval(0.0);
  vec2 myP = gP; float myA = gA, mySr = gSr;
  bool moving = gMoving > 0.5;
  float sz = iLook.x, ph = iLook.w, tau = uTime + ph * 37.0;
  int sp = int(iLook.y + 0.5), idle = int(iLook.z + 0.5);
  vec4 a = SA[sp], b = SB[sp], c = SC[sp];
  float w = a.x, h = a.y, len = a.z, leg = a.w, head = b.x, snout = b.y, legT = c.z;
  int ear = int(b.z + 0.5), tail = int(b.w + 0.5);
  float v = iMove.y;
  // gait by distance: diagonal pairs, trotting when quick
  float stride = leg * 4.2 + 0.25;
  float phi = mySr / stride * 6.2831853 + ph * 6.2831853;
  float amp = moving ? (v > 1.8 ? 0.62 : 0.42) : 0.0;
  float legA = amp * sin(phi);
  float bodyPitch = 0.0, bodyDrop = moving ? -0.012 * cos(2.0 * phi) : 0.0, headPitch = 0.0, wag = sin(tau * (sp == 8 ? 1.5 : 9.0)) * (sp >= 9 ? 0.2 : 0.55);
  float fl = legA, fr = -legA, bl = -legA, br = legA, hindFold = 1.0;
  if (!moving) {
    if (idle == 1) headPitch = 0.75 * smoothstep(0.2, 0.6, sin(tau * 0.35));
    else if (idle == 3) { headPitch = 0.9 + 0.1 * sin(tau * 0.7); wag *= 0.3; }
    else if (idle == 2) { bodyPitch = 0.5; bodyDrop = -leg * 0.7; hindFold = 0.3; fl = fr = 0.0; }
    else if (idle == 4) { bodyDrop = -leg * 0.85; fl = fr = 1.35; bl = br = -1.35; wag *= 0.4; }
  } else if (sp < 8) headPitch = 0.25 * smoothstep(0.7, 0.95, sin(tau * 0.5));
  vec3 p = Pp, n = Nn;
  float topY = leg + h;
  vec3 neck = vec3(0.0, leg + h * 0.8, len * 0.5);
  float headY = leg + h * 0.85 + c.x, headZ = len * 0.5 + head * 0.3;
  if (part == ${A.Body}) {
    p = vec3(p.x * w, leg + p.y * h, p.z * len);
    if (sp == 9) { p.x *= 1.08; p.y += 0.02; }
  } else if (part == ${A.Head} || part == ${A.Snout} || part == ${A.EarL} || part == ${A.EarR}) {
    if (part == ${A.Head}) p = vec3(p.x * head * 0.9, headY - head * 0.5 + p.y * head, headZ + p.z * head);
    else if (part == ${A.Snout}) { if (snout < 0.01) { Pp = HIDDEN; fade = 0.0; return; } p = vec3(p.x * head * 0.55, headY - head * 0.45 + p.y * head * 0.5, headZ + head * 0.5 + snout * 0.5 + p.z * snout); }
    else {
      float s = part == ${A.EarL} ? 1.0 : -1.0, e = c.w;
      if (ear == 0) p = vec3(s * head * 0.3 + p.x * e * 0.5, headY + head * 0.45 + p.y * e, headZ - head * 0.1 + p.z * e * 0.4);
      else if (ear == 5) p = vec3(s * (head * 0.45 + e * 0.5) + p.x * e, headY + head * 0.2 + p.y * e * 0.35, headZ - head * 0.1 + p.z * e * 0.5);
      else { float L = ear == 3 ? e * 1.6 : e; p = vec3(s * head * 0.5 + p.x * e * 0.3, headY + head * 0.35 - L + p.y * L, headZ + p.z * e * 0.7); }
    }
    p = neck + rotX(p - neck, -headPitch); n = rotX(n, -headPitch);
  } else if (part == ${A.Tail}) {
    float tl = c.y, th = legT * 0.8;
    float e = tail == 1 ? -0.5 : tail == 2 ? 1.0 : tail == 3 ? -0.9 : 1.2;
    if (tail == 4 && !moving && idle == 2) e = -1.4; // a cat's tail hanging down the wall
    vec3 d = vec3(sin(wag) * cos(e), sin(e), -cos(wag) * cos(e));
    p = vec3(0.0, leg + h * 0.8, -len * 0.5) + d * (Pp.y * tl) + vec3(Pp.x * th, Pp.z * th, 0.0);
  } else if (part >= ${A.LegFL} && part <= ${A.LegBR}) {
    bool front = part <= ${A.LegFR};
    float s = (part == ${A.LegFL} || part == ${A.LegBL}) ? 1.0 : -1.0;
    float ang = part == ${A.LegFL} ? fl : part == ${A.LegFR} ? fr : part == ${A.LegBL} ? bl : br;
    float L = front ? (bodyPitch > 0.0 ? leg * 0.3 + len * 0.46 : leg) : leg * hindFold;
    if (front) ang -= bodyPitch;
    vec3 pivot = vec3(s * (w * 0.5 - legT * 0.5), leg, (front ? 1.0 : -1.0) * (len * 0.5 - legT * 0.7));
    p = pivot + vec3(p.x * legT, p.y * L, p.z * legT);
    p = aboutX(p, pivot, ang); n = rotX(n, ang);
  } else if (part == ${A.Lead}) {
    // from the collar to the owner's hand: the owner is the same walk, lagging behind
    if (iStyle.z <= 0.0) { Pp = HIDDEN; fade = 0.0; return; }
    vec3 collar = place(vec3(0.0, leg + h * 0.9, len * 0.45) * sz, yawOf(myA));
    trackEval(-iStyle.z);
    vec2 side = vec2(sin(myA), -cos(myA)) * (iMove.w > iStyle.w ? 1.0 : -1.0);
    vec2 o = gP + vec2(sin(myA), -cos(myA)) * iStyle.w + side * 0.24;
    gP = myP;
    vec3 hand = vec3(o.x, iRoute.w + 0.78, o.y);
    float t = p.x;
    vec3 dir = normalize(hand - collar + vec3(1e-4));
    vec3 across = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
    Pp = mix(collar, hand, t) + vec3(0.0, -0.22 * 4.0 * t * (1.0 - t), 0.0) + vec3(0.0, p.y * 0.012, 0.0) + across * p.z * 0.012;
    Nn = vec3(0.0, 1.0, 0.0);
    vColA = vec3(0.05, 0.03, 0.02); vSel = 0.0; vColB = vColA; vColC = vColA;
    return;
  }
  {
    vec3 hipPivot = vec3(0.0, leg, -len * 0.5);
    p = aboutX(p, hipPivot, bodyPitch); n = rotX(n, bodyPitch);
  }
  p.y += bodyDrop;
  float yw = yawOf(myA);
  Pp = place(p * sz, yw);
  Nn = rotY(n, yw);
  // coat, markings (patches on collies, cows and spaniels; a white chest and socks)
  vColA = unpackCol(iColA.x); vColB = unpackCol(iColA.y); vColC = unpackCol(iColA.w);
  int pat = int(iColA.z + 0.5);
  vSel = 10.0 + float(pat);
  if (part == ${A.Snout} || (part == ${A.Head} && sp == 9)) { vColA = vColC; vSel = 0.0; }
  if ((part == ${A.EarL} || part == ${A.EarR}) && sp == 9) { vColA = vColC; vSel = 0.0; }
  if (part >= ${A.LegFL} && part <= ${A.LegBR} && sp == 9) { vColA = vColC; vSel = 0.0; }
}
`;

const BIRD = /* glsl */ `
// iLook: size, species (0 pigeon, 1 duck), idle (0 peck about, 1 swim), phase
void figure(inout vec3 Pp, inout vec3 Nn, out float fade) {
  int part = int(aPart + 0.5);
  fade = trackEval(0.0);
  float sz = iLook.x, ph = iLook.w, tau = uTime + ph * 23.0;
  int sp = int(iLook.y + 0.5);
  bool moving = gMoving > 0.5;
  bool duck = sp == 1;
  float L = duck ? 0.4 : 0.3, W = duck ? 0.2 : 0.13, Hh = duck ? 0.14 : 0.13, y0 = duck ? -0.04 : 0.07, hs = duck ? 0.085 : 0.07;
  float bobZ = moving && !duck ? 0.03 * sin(gSr / 0.09 * 6.2831853) : 0.0;
  float peck = !moving ? smoothstep(0.5, 0.9, sin(tau * (duck ? 0.5 : 2.3))) : 0.0;
  vec3 p = Pp, n = Nn;
  vec3 neck = vec3(0.0, y0 + Hh, L * 0.35);
  if (part == ${B.Body}) p = vec3(p.x * W, y0 + p.y * Hh, p.z * L);
  else if (part == ${B.Head} || part == ${B.Beak}) {
    vec3 hc = vec3(0.0, y0 + Hh + hs * 0.6, L * 0.45 + bobZ);
    if (part == ${B.Head}) p = hc + vec3(p.x * hs, (p.y - 0.5) * hs * 1.1, p.z * hs);
    else p = hc + vec3(p.x * hs * (duck ? 0.55 : 0.3), (p.y - 0.8) * hs * 0.35, hs * 0.5 + (p.z + 0.5) * hs * (duck ? 0.6 : 0.4));
    p = neck + rotX(p - neck, -peck * (duck ? 1.6 : 1.1)); n = rotX(n, -peck);
  } else if (part == ${B.Tail}) p = vec3(p.x * W * 0.8, y0 + Hh * 0.55 + p.y * 0.03, -L * 0.5 - (p.z + 0.5) * L * 0.35);
  else {
    float s = part == ${B.WingL} ? 1.0 : -1.0;
    p = vec3(s * W * 0.5 + p.x * 0.03, y0 + Hh * 0.35 + p.y * Hh * 0.6, -0.04 + p.z * L * 0.85);
    float flap = moving && iMove.y > 1.5 ? sin(tau * 18.0) * 0.9 : 0.0;
    p = vec3(0.0, y0 + Hh, 0.0) + rotZ(p - vec3(0.0, y0 + Hh, 0.0), s * flap);
  }
  if (duck && !moving) p.y += 0.01 * sin(tau * 1.3);
  float yw = yawOf(gA);
  Pp = place(p * sz, yw);
  Nn = rotY(n, yw);
  vColA = unpackCol(part == ${B.Head} ? iColA.y : part == ${B.WingL} || part == ${B.WingR} || part == ${B.Tail} ? iColA.z : part == ${B.Beak} ? iColA.w : iColA.x);
  vColB = vColA; vColC = vColA; vSel = 0.0;
}
`;

const PROP = /* glsl */ `
void figure(inout vec3 Pp, inout vec3 Nn, out float fade) {
  int part = int(aPart + 0.5);
  fade = trackEval(0.0);
  int prop = int(iStyle.z + 0.5);
  vec3 p = Pp;
  if (prop == 1 && gMoving < 0.5) p = rotZ(p, 0.12); // leaning over onto a foot at a stop
  float yw = yawOf(gA);
  Pp = place(p, yw);
  Nn = rotY(prop == 1 && gMoving < 0.5 ? rotZ(Nn, 0.12) : Nn, yw);
  vec3 frame = unpackCol(iColB.y);
  vColA = part == ${Q.Frame} ? (prop == 3 ? vec3(0.55) : frame) : part == ${Q.Seat} ? (prop == 2 ? frame * 0.85 : vec3(0.03)) : part == ${Q.Bar} ? vec3(0.02) : vec3(0.015);
  vColB = vColA; vColC = vColA; vSel = 0.0;
}
`;

const FRAG_PARS = /* glsl */ `
flat varying float vFade;
flat varying float vSel;
flat varying vec3 vColA;
flat varying vec3 vColB;
flat varying vec3 vColC;
varying vec3 vLocal;
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int k = i.x + i.y * 4;
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[k] + 0.5) / 16.0;
}
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 peopleColour() {
  vec3 c = vColA, L = vLocal;
  int s = int(vSel + 0.5);
  if (s == 1) { if (L.y < 0.085) c = vColB; }
  else if (s == 2) { if (L.y < 0.84) c = vColB; }
  else if (s == 3) { if (abs(L.y - 1.16) < 0.03 || abs(L.y - 1.3) < 0.025) c = vColB; }
  else if (s == 4) { if (L.z > 0.08 && abs(L.x) < 0.028 && L.y > 1.1) c = vColB; }
  else if (s == 5) { if (L.z > 0.07 && L.y < 1.3) c = vColB; }
  else if (s == 6) { c = L.y > 1.5 ? vColC : L.y > 0.86 ? vColA : vColB; }
  else if (s == 7) { if (L.y < 1.02) c = vColB; }
  else if (s == 8) { if (L.y > 1.645 || (L.z < -0.07 && L.y > 1.5)) c = vColB; }
  else if (s == 11) { if (hash3(floor(L * vec3(2.2, 2.0, 2.6) + 0.5)) > 0.55) c = vColB; }
  else if (s == 12) { if (L.y < 0.35 || (L.z > 0.3 && L.y < 0.7)) c = vColB; }
  return c;
}
`;
const DITHER = /* glsl */ `if (vFade < bayer4(gl_FragCoord.xy)) discard;`;

const FIGURE: Record<number, string> = { 0: PERSON, 1: CARD, 2: ANIMAL, 3: BIRD, 4: PROP };

export interface Uniforms { uTime: { value: number }; uRain: { value: number } }
export function makeUniforms(): Uniforms { return { uTime: { value: 0 }, uRain: { value: 0 } }; }

function patchVertex(src: string, kind: number) {
  return src
    .replace('#include <common>', `#include <common>\n${COMMON}\n${FIGURE[kind]}`)
    .replace('#include <begin_vertex>', `vec3 transformed = position;\n{ vec3 nn = normal; float f; figure(transformed, nn, f); if (f <= 0.003) transformed = HIDDEN; vFade = f; vLocal = position; }`);
}
// The game's Lambert material, taught to pose figures. Shadows come from a matching depth material.
export function makeMaterials(kind: Kind, u: Uniforms) {
  const k = KIND_ID[kind];
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime; sh.uniforms.uRain = u.uRain;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON}\n${FIGURE[k]}`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normal;\nvec3 pPos = position;\n{ float f; figure(pPos, objectNormal, f); if (f <= 0.003) pPos = HIDDEN; vFade = f; vLocal = position; }`)
      .replace('#include <begin_vertex>', 'vec3 transformed = pPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `${DITHER}\ndiffuseColor.rgb *= peopleColour();`);
  };
  mat.customProgramCacheKey = () => `people-${k}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = u.uTime; sh.uniforms.uRain = u.uRain;
    sh.vertexShader = patchVertex(sh.vertexShader, k);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DITHER}`);
  };
  depth.customProgramCacheKey = () => `people-depth-${k}`;
  return { mat, depth };
}
