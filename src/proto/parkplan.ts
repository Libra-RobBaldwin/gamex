// A park's entrances and paths, from its edge along the roads (infill.ts finds the edge pieces as
// it finds the gap). Worked out here, once, so the drawing (buildgen makeRegion) and the crowds
// (game/crowdsites) agree: people walk in at the gates and along the gravel that's drawn.
//
// The edge comes as short pieces, walked along each road; chained end to end they make runs, one
// per road side the park fronts. A run of any length gets a gate in its middle, and a path runs
// from each gate to the park's centre cell (or straight between the gates, when there are two).
export interface XZ { x: number; z: number }
export type EdgePiece = [number, number, number, number];
export interface Entrance { at: XZ; in: XZ; dir: XZ } // on the edge; a step inside; the edge's direction

export const GATE_W = 3; // m clear at each entrance
const MIN_RUN = 9; // m of edge before a run earns a gate
const JOIN = 3.5; // m: pieces this close chain (the edge skips a metre or two where a drive or a lamp post is)

// the edge's pieces chained into runs (pieces touching end to start, in either order)
export function edgeRuns(edges: EdgePiece[]): XZ[][] {
  const runs: XZ[][] = [];
  const left = edges.map(([x0, z0, x1, z1]) => [{ x: x0, z: z0 }, { x: x1, z: z1 }] as [XZ, XZ]);
  const near = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z) < JOIN;
  while (left.length) {
    const run = [...left.shift()!];
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const [a, b] = left[i];
        if (near(run[run.length - 1], a)) { run.push(b); left.splice(i, 1); grew = true; break; }
        if (near(run[0], b)) { run.unshift(a); left.splice(i, 1); grew = true; break; }
      }
    }
    runs.push(run);
  }
  return runs;
}

const lengthOf = (r: XZ[]) => { let L = 0; for (let i = 1; i < r.length; i++) L += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z); return L; };
function along(r: XZ[], s: number): { p: XZ; dir: XZ } {
  let acc = 0;
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1], b = r[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= s || i === r.length - 1) { const t = L ? Math.max(0, Math.min(1, (s - acc) / L)) : 0; return { p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, dir: { x: (b.x - a.x) / (L || 1), z: (b.z - a.z) / (L || 1) } }; }
    acc += L;
  }
  return { p: r[0], dir: { x: 1, z: 0 } };
}

// one gate in the middle of each run long enough for one, stepped 2.5 m into the park (towards its centre)
export function parkEntrances(edges: EdgePiece[], centre: XZ): Entrance[] {
  const out: Entrance[] = [];
  for (const run of edgeRuns(edges)) {
    const L = lengthOf(run);
    if (L < MIN_RUN) continue;
    const { p, dir } = along(run, L / 2);
    let nx = -dir.z, nz = dir.x; // (a normal, turned to point into the park)
    if ((centre.x - p.x) * nx + (centre.z - p.z) * nz < 0) { nx = -nx; nz = -nz; }
    out.push({ at: p, in: { x: p.x + nx * 2.5, z: p.z + nz * 2.5 }, dir });
  }
  return out;
}

// the paths: gate to gate when there are two, otherwise each gate to the centre
export function parkPaths(entrances: Entrance[], centre: XZ): XZ[][] {
  if (entrances.length === 2) return [[entrances[0].in, entrances[1].in]];
  return entrances.map((e) => [e.in, centre]);
}

// is this point in one of the gates' gaps (for leaving the wall open there)
export const inGate = (p: XZ, entrances: Entrance[], half = GATE_W / 2) => entrances.some((e) => Math.hypot(p.x - e.at.x, p.z - e.at.z) < half);
