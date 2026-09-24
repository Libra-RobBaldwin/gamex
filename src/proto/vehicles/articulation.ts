// Articulation for the traffic layer: where a trailer or a bendy bus's rear half sits, given the
// vehicle pulling it. Models carry their hitch points (hitch.rear on the tractor or front half,
// hitch.front on the trailer, both measured from the model's middle), so this is geometry only.
import type { Model } from './types';

export interface Pose { x: number; z: number; heading: number } // heading: atan2(uz, ux), as traffic.ts uses

// World position of a point `along` metres forward of a pose's origin.
export const ahead = (p: Pose, along: number) => ({ x: p.x + Math.cos(p.heading) * along, z: p.z + Math.sin(p.heading) * along });

// The trailing axle of a trailer is dragged towards the hitch: move the hitch, and the trailer
// swings round it without sliding sideways. `prev` is last frame's trailer pose, or undefined the
// first time (then it lines up behind). Works for any step size; small steps track curves best.
export function follow(tractor: Pose, lead: Model, trailer: Model, prev?: Pose): Pose {
  const hitchLead = lead.hitch?.rear ?? -lead.dims.length / 2;
  const hitchTrail = trailer.hitch?.front ?? trailer.dims.length / 2;
  // the trailer's pivot is its rear axle group
  const axles = trailer.dims.axles;
  const axleX = axles.length ? axles.reduce((s, a) => s + a, 0) / axles.length : -trailer.dims.length / 4;
  const h = ahead(tractor, hitchLead);
  let heading = tractor.heading;
  if (prev) {
    const rear = ahead(prev, axleX);
    const dx = h.x - rear.x, dz = h.z - rear.z;
    if (dx * dx + dz * dz > 1e-6) heading = Math.atan2(dz, dx);
  }
  // place the trailer so its hitch is on the tractor's and it points along heading
  const x = h.x - Math.cos(heading) * hitchTrail, z = h.z - Math.sin(heading) * hitchTrail;
  return { x, z, heading };
}

// The angle between tractor and trailer, to limit jack-knifing in the traffic layer.
export function articulationAngle(a: Pose, b: Pose) {
  let d = a.heading - b.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Train cars on a path: each car's middle is offset back from the front of the train by the
// lengths ahead of it plus the coupler gaps.
export function consistOffsets(models: Model[], gap = 0.9) {
  const out: number[] = [];
  let s = 0;
  for (const m of models) { out.push(s + m.dims.length / 2); s += m.dims.length + gap; }
  return { offsets: out, length: s - gap };
}
