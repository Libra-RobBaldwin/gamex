// Articulation for the traffic layer: where a trailer or a bendy bus's rear half sits, given the
// vehicle pulling it. Models carry their hitch points (hitch.rear on the tractor or front half,
// hitch.front on the trailer, both measured from the model's middle), so this is geometry only.
import type { Model } from './types';

export interface Pose { x: number; z: number; heading: number } // heading: atan2(uz, ux), as traffic.ts uses

// World position of a point `along` metres forward of a pose's origin.
export const ahead = (p: Pose, along: number) => ({ x: p.x + Math.cos(p.heading) * along, z: p.z + Math.sin(p.heading) * along });

// The trailing axle of a trailer is dragged towards the hitch: move the hitch, and the trailer
// swings round it without sliding sideways. `prev` is last frame's trailer pose, or undefined the
// first time (then it lines up behind). The hitch's move since last frame is taken in steps of a
// quarter of a metre, so the trailer tracks a curve the same at 10 fps as at 60, and the angle
// between the two is held to maxAngle (radians) so a trailer never folds through its tractor.
export function follow(tractor: Pose, lead: Model, trailer: Model, prev?: Pose, maxAngle = 1.3): Pose {
  const hitchLead = lead.hitch?.rear ?? -lead.dims.length / 2;
  const hitchTrail = trailer.hitch?.front ?? trailer.dims.length / 2;
  // the trailer's pivot is its rear axle group
  const axles = trailer.dims.axles;
  const axleX = axles.length ? axles.reduce((s, a) => s + a, 0) / axles.length : -trailer.dims.length / 4;
  const arm = hitchTrail - axleX; // hitch to pivot
  const h = ahead(tractor, hitchLead);
  let heading = tractor.heading;
  if (prev) {
    const from = ahead(prev, hitchTrail);
    const dx = h.x - from.x, dz = h.z - from.z, dist = Math.hypot(dx, dz);
    // a jump (a teleport, a new route) lines the trailer up again rather than dragging it across
    if (dist < 20) {
      heading = prev.heading;
      let ax = from.x - Math.cos(heading) * arm, az = from.z - Math.sin(heading) * arm;
      const n = Math.min(80, Math.max(1, Math.ceil(dist / 0.25)));
      for (let i = 1; i <= n; i++) {
        const hx = from.x + (dx * i) / n, hz = from.z + (dz * i) / n;
        const ex = hx - ax, ez = hz - az;
        if (ex * ex + ez * ez > 1e-12) heading = Math.atan2(ez, ex);
        ax = hx - Math.cos(heading) * arm; az = hz - Math.sin(heading) * arm;
      }
    }
  }
  const rel = articulationAngle(tractor, { x: 0, z: 0, heading });
  if (Math.abs(rel) > maxAngle) heading = tractor.heading - Math.sign(rel) * maxAngle;
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
