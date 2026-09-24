// Overpass JSON in, an indexed OSM dataset out: nodes by id, ways with their node lists, and
// relations. Multipolygons (land use, big buildings, the canal) are joined back into rings here,
// because Overpass hands them over as loose member ways in any order and direction.
// Data read through this module is © OpenStreetMap contributors, under the ODbL.

export type Tags = Record<string, string>;
export interface OsmNode { type: 'node'; id: number; lat: number; lon: number; tags?: Tags }
export interface OsmWay { type: 'way'; id: number; nodes: number[]; tags?: Tags }
export interface OsmMember { type: 'node' | 'way' | 'relation'; ref: number; role: string }
export interface OsmRelation { type: 'relation'; id: number; members: OsmMember[]; tags?: Tags }
export type OsmElement = OsmNode | OsmWay | OsmRelation;
export interface OverpassJson { version?: number; generator?: string; elements: OsmElement[]; bbox?: number[]; attribution?: string }

export interface OsmData {
  nodes: Map<number, OsmNode>;
  ways: Map<number, OsmWay>;
  relations: Map<number, OsmRelation>;
  // how many ways use each node: a node on two roads is a junction
  wayCount: Map<number, number>;
}

export function parseOverpass(json: OverpassJson): OsmData {
  const nodes = new Map<number, OsmNode>(), ways = new Map<number, OsmWay>(), relations = new Map<number, OsmRelation>();
  for (const e of json.elements) {
    // `out body; >; out skel` repeats nodes without their tags: keep the tagged copy
    if (e.type === 'node') { const had = nodes.get(e.id); if (!had || (!had.tags && e.tags)) nodes.set(e.id, e); }
    else if (e.type === 'way') { if (!ways.get(e.id)?.tags) ways.set(e.id, e); }
    else if (e.type === 'relation') relations.set(e.id, e);
  }
  const wayCount = new Map<number, number>();
  for (const w of ways.values()) for (const n of new Set(w.nodes)) wayCount.set(n, (wayCount.get(n) ?? 0) + 1);
  return { nodes, ways, relations, wayCount };
}

export const isClosed = (w: OsmWay) => w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1];

// Join loose member ways into closed rings of node ids. Ways are chained end to end, reversed
// where needed; anything left that won't close (clipped at the edge of the download) is dropped.
export function joinRings(parts: number[][]): number[][] {
  const open = parts.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings: number[][] = [];
  while (open.length) {
    const ring = open.shift()!;
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        if (p[0] === end) ring.push(...p.slice(1));
        else if (p[p.length - 1] === end) ring.push(...p.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) rings.push(ring);
  }
  return rings;
}

// The area features: closed ways and multipolygon relations, as outer rings (with inner rings for
// holes). Each carries the tags that describe it (a multipolygon's own, or failing that its way's).
export interface Area { id: string; tags: Tags; outer: number[][]; inner: number[][] }
export function areas(d: OsmData, want: (t: Tags) => boolean): Area[] {
  const out: Area[] = [];
  const used = new Set<number>();
  for (const r of d.relations.values()) {
    const t = r.tags ?? {};
    if (t.type !== 'multipolygon' || !want(t)) continue;
    const ring = (role: string) => joinRings(r.members.filter((m) => m.type === 'way' && (m.role || 'outer') === role).map((m) => d.ways.get(m.ref)?.nodes ?? []));
    const outer = ring('outer');
    if (!outer.length) continue;
    for (const m of r.members) if (m.type === 'way' && !d.ways.get(m.ref)?.tags) used.add(m.ref);
    out.push({ id: `r${r.id}`, tags: t, outer, inner: ring('inner') });
  }
  for (const w of d.ways.values()) {
    if (!w.tags || used.has(w.id) || !isClosed(w) || !want(w.tags)) continue;
    out.push({ id: `w${w.id}`, tags: w.tags, outer: [w.nodes], inner: [] });
  }
  return out;
}
