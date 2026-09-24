// Slip roads joining and leaving a one-way carriageway part-way along (DMRB CD 122 taper merge and
// taper diverge). The network has a node on the carriageway where the slip road meets it; this is
// the junction there. Its shape says where the slip road's own drawing stops (the nose, where its
// kerb parts from the carriageway's), the course its lane takes alongside the nearside lane and
// into or out of it, the extra carriageway that takes, and the markings: a hatched nose, the
// broken line along the taper, the edge lines. Drawing, traffic and the land registry all read it.
import type { Leg } from '../junction';
import { closestOnPath, pathLength, pointAt, type Network, type P } from '../roads';
import { kerbOf, laneBase } from '../catalog';
import { STD } from '../standards';
import type { Shape, SlipMarks, SlipShape } from '../jshape';
import type { XZ } from '../land';

// main: the carriageway arriving and leaving; slip: the slip road
export interface SlipRoles { kind: 'merge' | 'diverge'; main: [Leg, Leg]; slip: Leg }

const dot = (a: XZ, b: XZ) => a.x * b.x + a.z * b.z;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// Three one-way roads at a node, two in and one out (a merge) or one in and two out (a diverge),
// where one in and one out run straight on and the third is on their nearside.
export function slipRoles(net: Network, legs: Leg[]): SlipRoles | null {
  if (legs.length !== 3 || legs.some((l) => !l.seg.oneway || net.def(l.seg).cls !== 'road')) return null;
  const ins = legs.filter((l) => l.into), outs = legs.filter((l) => l.out);
  const through = (a: Leg, b: Leg) => -dot(a.dir, b.dir);
  let kind: SlipRoles['kind'], mi: Leg, mo: Leg, sl: Leg;
  if (ins.length === 2 && outs.length === 1) {
    kind = 'merge'; mo = outs[0];
    [mi, sl] = through(ins[0], mo) >= through(ins[1], mo) ? [ins[0], ins[1]] : [ins[1], ins[0]];
  } else if (ins.length === 1 && outs.length === 2) {
    kind = 'diverge'; mi = ins[0];
    [mo, sl] = through(mi, outs[0]) >= through(mi, outs[1]) ? [outs[0], outs[1]] : [outs[1], outs[0]];
  } else return null;
  if (through(mi, mo) < 0.95) return null;
  // (on the nearside: the left of the traffic going through)
  const u = { x: -mi.dir.x, z: -mi.dir.z }, left = { x: u.z, z: -u.x };
  if (dot(sl.dir, left) <= 0.02) return null;
  return { kind, main: [mi, mo], slip: sl };
}

// The junction's shape, or null if the slip road doesn't meet the carriageway the way a merge or
// diverge needs to (running alongside it, with room for the taper).
export function slipShape(net: Network, node: number, r: SlipRoles): Shape | null {
  const n = net.node(node), y = n.y;
  const [mi, mo] = r.main, sl = r.slip, merge = r.kind === 'merge';
  const inP = net.path(mi.seg), outP = net.path(mo.seg); // (one way: the one ends here, the other starts here)
  const main = [...inP, ...outP.slice(1)], Lin = pathLength(inP), Lout = pathLength(outP);
  const Min = net.def(mi.seg), Mout = net.def(mo.seg), S = net.def(sl.seg), M = merge ? Mout : Min;
  const K = Math.max(kerbOf(Min), kerbOf(Mout)), Ks = kerbOf(S);
  // lateral offsets from the carriageway's centreline, left of travel positive: its nearside lane's
  // centre and edge, the slip lane's centre where it runs alongside, the slip lane's own centre
  const lane0 = laneBase(M) + (M.lanes - 0.5) * M.lane, gen = laneBase(M) + M.lanes * M.lane, ec = lane0 + M.lane;
  const s0 = laneBase(S) + (S.lanes - 0.5) * S.lane, wS = S.lane;
  const frame = (rho: number, e: number): P => { const q = pointAt(main, Lin + rho); return { x: q.x + q.uz * e, z: q.z - q.ux * e, y }; };
  const proj = (p: P) => { const c = closestOnPath(p, main); return { rho: c.s - Lin, lat: (p.x - c.x) * c.uz - (p.z - c.z) * c.ux }; };
  // the nose: the first point out along the slip road where its offside kerb is clear of the
  // carriageway's nearside kerb by the nose's tip
  const sp = net.pathFrom(sl.seg, node), Ls = pathLength(sp);
  let mouth = -1;
  for (let s = 0; s <= Ls; s += 0.5) { const pr = proj(pointAt(sp, s)); if (pr.lat - Ks >= K + STD.noseTip - 0.01) { mouth = s; break; } }
  if (mouth < 0 || mouth > Ls - 10) return null;
  const q0 = pointAt(sp, mouth), dir = merge ? -1 : 1; // (the slip road's travel along sp)
  const start: P = { x: q0.x + q0.uz * dir * s0, z: q0.z - q0.ux * dir * s0, y };
  const pn = proj(start), rhoN = pn.rho, eN = pn.lat;
  // a taper, or (a slip road with an auxiliary lane) a stretch alongside at full width, then a short taper
  const P = sl.seg.aux ?? 0, T = P > 0 ? STD.parallel(M.mph).taper : (merge ? STD.merge(M.mph) : STD.diverge(M.mph)).taper, TP = T + P;
  // (the nose on the far side of the node from the taper, and both on the carriageway)
  if (merge ? rhoN > -10 || -rhoN > Lin - 10 || TP > Lout - 10 : rhoN < 10 || rhoN > Lout - 10 || TP > Lin - 10) return null;
  // where the slip lane's centre is, along the carriageway (the taper is straight, as CD 122 draws it;
  // the lane eases across the nose)
  const lin = (x: number) => Math.max(0, Math.min(1, x));
  const e = (rho: number) => merge
    ? (rho < 0 ? eN + (ec - eN) * smooth((rho - rhoN) / -rhoN) : ec + (lane0 - ec) * lin((rho - P) / T))
    : (rho < 0 ? lane0 + (ec - lane0) * lin((rho + TP) / T) : ec + (eN - ec) * smooth(rho / rhoN));
  const [r0, r1] = merge ? [rhoN, TP] : [-TP, rhoN];
  const at: number[] = [];
  for (let rho = r0; rho < r1 - 0.5; rho += 2) at.push(rho);
  at.push(r1);
  const path = at.map((rho) => frame(rho, e(rho)));
  if (merge) path[0] = start; else path[path.length - 1] = start;
  // the carriageway it takes, out from the nearside kerb to the slip lane's nearside edge, and its verge
  const outer = (rho: number) => e(rho) + (Ks - s0);
  const aprons: XZ[][] = [], paves: XZ[][] = [];
  for (let i = 1; i < at.length; i++) {
    const a = at[i - 1], b = at[i], oa = outer(a), ob = outer(b);
    if (oa <= K + 0.02 && ob <= K + 0.02) continue;
    const A = Math.max(K, oa), B = Math.max(K, ob);
    aprons.push([frame(a, K), frame(b, K), frame(b, B), frame(a, A)]);
    paves.push([frame(a, A), frame(b, B), frame(b, B + S.verge), frame(a, A + S.verge)]);
  }
  // the markings
  const line = (r0: number, r1: number, off: (rho: number) => number) => { const pts: XZ[] = []; for (let rho = r0; rho < r1; rho += 2) pts.push(frame(rho, off(rho))); pts.push(frame(r1, off(r1))); return pts; };
  const W = M.mph >= 60 ? 0.15 : 0.1, edge = 0.1;
  const [nose0, nose1] = merge ? [rhoN, 0] : [0, rhoN], [tap0, tap1] = merge ? [0, TP] : [-TP, 0];
  const H = STD.hatch(M.mph), hatch: XZ[][] = [];
  const inner = (rho: number) => e(rho) - wS / 2;
  for (let c = nose0 + H.spacing / 2; c < nose1; c += H.spacing) {
    const a = gen + edge + 0.15, b = inner(c) - edge - 0.15;
    if (b - a < 0.4) continue;
    // a stripe at 45°, leaning the way the traffic goes
    const d = (b - a) * (merge ? 1 : -1), w = H.stripe / 2;
    hatch.push([frame(c - w, a), frame(c + w, a), frame(c + d + w, b), frame(c + d - w, b)]);
  }
  const marks: SlipMarks = {
    solid: [
      { pts: line(nose0, nose1, () => gen), w: edge }, // the carriageway's edge, along the nose
      // the slip lane's offside edge and its nearside edge (closing in along the taper), run on a metre
      // past the nose to where the slip road's own lines start
      { pts: line(nose0 - (merge ? 1 : 0), nose1 + (merge ? 0 : 1), inner), w: edge },
      { pts: line(r0 - (merge ? 1 : 0), r1 + (merge ? 0 : 1), (rho) => e(rho) + wS / 2), w: edge },
    ],
    broken: [{ pts: line(tap0, tap1, () => gen), w: W, dash: 1, gap: 1 }], // TSRGD diagram 1010, where the lanes meet
    hatch,
    edgeGap: { [mi.seg.id]: [Math.max(0, Lin + r0), Lin], [mo.seg.id]: [0, Math.min(Lout, r1)] },
  };
  const slip: SlipShape = { from: merge ? sl.seg.id : mi.seg.id, to: merge ? mo.seg.id : sl.seg.id, path, island: [], outer: [], R: 0, centre: { x: n.x, z: n.z }, kind: r.kind, len: pathLength(path) };
  const ids = [mi.seg.id, mo.seg.id, sl.seg.id];
  const mouthOf: Record<number, number> = { [mi.seg.id]: 0, [mo.seg.id]: 0, [sl.seg.id]: mouth };
  const trim: Record<number, [number, number]> = { [mi.seg.id]: [0, 0], [mo.seg.id]: [0, 0], [sl.seg.id]: [mouth, mouth] };
  return {
    form: r.kind, mouth: mouthOf, line: { ...mouthOf }, paveTrim: trim, medianTrim: Object.fromEntries(ids.map((id) => [id, 0])),
    apron: [], pave: [], aprons, paves, islands: [], splitter: {}, slip, R: 0, island: 0, claims: [...paves, ...aprons], marks,
  };
}
