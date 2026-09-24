// Floating origin. World positions are doubles in metres from the region origin, exact to well
// under a millimetre across any region. The GPU only has 32-bit floats: 50 km out a float32 steps
// in 4 mm, and after the camera's matrices are applied the error is worse, so vertices jitter.
// The render origin sits near the camera; everything drawn is placed relative to it. When the
// camera wanders more than `threshold` from it, it jumps to the tile corner nearest the camera and
// subscribers shift what they draw by the same amount.
//
// Tile meshes should keep their vertices relative to their own tile's corner (never more than a
// kilometre, so float32 is good to 0.06 mm) and be placed at (tile corner − render origin). A
// rebase then only moves a few hundred group positions, never a vertex.

import { Emitter } from './events';
import { TILE } from './tiles';

export interface XZ { x: number; z: number }
export interface Rebase { from: XZ; to: XZ; dx: number; dz: number } // dx = to.x − from.x

export class FloatingOrigin extends Emitter<{ rebase: Rebase }> {
  x = 0; z = 0;
  rebases = 0;
  constructor(readonly threshold = 2 * TILE, readonly snap = TILE) { super(); }

  // Call once a frame with the camera's world position (its look-at point for an orbit camera).
  // Returns true when it rebased.
  update(camX: number, camZ: number) {
    if (Math.abs(camX - this.x) <= this.threshold && Math.abs(camZ - this.z) <= this.threshold) return false;
    this.moveTo(Math.round(camX / this.snap) * this.snap, Math.round(camZ / this.snap) * this.snap);
    return true;
  }
  moveTo(x: number, z: number) {
    if (x === this.x && z === this.z) return;
    const from = { x: this.x, z: this.z };
    this.x = x; this.z = z; this.rebases++;
    this.emit('rebase', { from, to: { x, z }, dx: x - from.x, dz: z - from.z });
  }
  // world (double) → render (small, float32-safe)
  toRender(p: XZ): XZ { return { x: p.x - this.x, z: p.z - this.z }; }
  toWorld(p: XZ): XZ { return { x: p.x + this.x, z: p.z + this.z }; }
}
