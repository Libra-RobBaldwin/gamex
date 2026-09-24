import { describe, expect, it } from 'vitest';
import { localProjection } from '../proto/osm/projection';
import { SIZES_KM, TILE_KM, areaId, squareBbox, tilesOf } from './area';
import { MIRRORS, backoffMs, fetchTiles, judge, type Deps, type Progress } from './overpass';
import { parsePostcode, lookupPostcode } from './postcode';

const banbury = { lat: 52.0615, lon: -1.332 };

describe('the square', () => {
  it.each(SIZES_KM)('%s km is that many km a side on the ground, centred on the point', (km) => {
    const b = squareBbox(banbury, km), p = localProjection(banbury);
    const sw = p.toLocal(b[0], b[1]), ne = p.toLocal(b[2], b[3]);
    expect(ne.x - sw.x).toBeCloseTo(km * 1000, -0.5); // within a metre or so (rounded to 1e-6°)
    expect(sw.z - ne.z).toBeCloseTo(km * 1000, -0.5);
    expect((b[0] + b[2]) / 2).toBeCloseTo(banbury.lat, 5);
    expect((b[1] + b[3]) / 2).toBeCloseTo(banbury.lon, 5);
  });

  it('is wider in degrees of longitude the further north it is', () => {
    const south = squareBbox({ lat: 50, lon: 0 }, 1), north = squareBbox({ lat: 58.5, lon: 0 }, 1);
    expect(north[3] - north[1]).toBeGreaterThan(south[3] - south[1]);
  });

  it('stays sane at the edge of the map', () => {
    const b = squareBbox({ lat: 89.9, lon: 181 }, 3);
    expect(b.every(Number.isFinite)).toBe(true);
    expect(b[2]).toBeLessThan(85);
    expect(b[1]).toBeGreaterThanOrEqual(-180);
  });
});

describe('tiling', () => {
  it.each([[1, 1], [1.3, 1], [1.5, 4], [2, 4], [2.5, 4], [3, 9]])('%s km is %s tiles', (km, n) => {
    expect(tilesOf(squareBbox(banbury, km), km)).toHaveLength(n);
  });

  it.each(SIZES_KM)('%s km: tiles are at most 1.3 km, cover the square exactly and share edges', (km) => {
    const b = squareBbox(banbury, km), t = tilesOf(b, km), p = localProjection(banbury);
    for (const [s, w, n, e] of t) {
      const a = p.toLocal(s, w), c = p.toLocal(n, e);
      expect(c.x - a.x).toBeLessThanOrEqual(TILE_KM * 1000 + 1);
      expect(a.z - c.z).toBeLessThanOrEqual(TILE_KM * 1000 + 1);
    }
    expect(Math.min(...t.map((x) => x[0]))).toBe(b[0]);
    expect(Math.min(...t.map((x) => x[1]))).toBe(b[1]);
    expect(Math.max(...t.map((x) => x[2]))).toBe(b[2]);
    expect(Math.max(...t.map((x) => x[3]))).toBe(b[3]);
    // every inner edge is some other tile's edge: no gaps, no overlaps
    const lats = new Set(t.flatMap((x) => [x[0], x[2]])), lons = new Set(t.flatMap((x) => [x[1], x[3]]));
    const n = Math.round(Math.sqrt(t.length));
    expect(lats.size).toBe(n + 1);
    expect(lons.size).toBe(n + 1);
  });

  it('keys the cache by area and name, never anything else', () => {
    const b = squareBbox(banbury, 1.5);
    expect(areaId(b, ' Banbury ')).toBe(areaId(b, 'banbury'));
    expect(areaId(b, 'Banbury')).not.toBe(areaId(b, 'Bodicote'));
    expect(areaId(b, 'x')).not.toMatch(/OX16/i);
  });
});

describe('back-off', () => {
  it('doubles from 4 s to a minute, with up to a second of jitter', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((a) => backoffMs(a, () => 0))).toEqual([4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    expect(backoffMs(1, () => 0.999)).toBe(4999);
  });
  it('honours a server’s Retry-After, up to two minutes', () => {
    expect(backoffMs(1, () => 0, 30)).toBe(30000);
    expect(backoffMs(1, () => 0, 9999)).toBe(120000);
    expect(backoffMs(3, () => 0, 2)).toBe(16000);
    expect(backoffMs(1, () => 0, NaN)).toBe(4000);
  });
  it('judges answers', () => {
    expect(judge(429, '')).toMatchObject({ ok: false, retry: true });
    expect(judge(504, '')).toMatchObject({ ok: false, retry: true });
    expect(judge(400, '')).toMatchObject({ ok: false, retry: false });
    expect(judge(200, '<html>busy</html>')).toMatchObject({ ok: false, retry: true });
    expect(judge(200, '{"elements":[],"remark":"runtime error: Query timed out in \\"query\\" at line 3"}')).toMatchObject({ ok: false, retry: true });
    expect(judge(200, '{"elements":[]}')).toMatchObject({ ok: true });
  });
});

// a fake network and clock: `answers` is consumed one per request
function fake(answers: (number | 'hang' | 'offline')[], online = () => true) {
  const calls: { url: string; body: string }[] = [], sleeps: number[] = [];
  let t = 0;
  const deps: Deps = {
    fetch: async (url, init) => {
      calls.push({ url, body: String(init.body) });
      const a = answers.shift() ?? 200;
      if (a === 'offline') throw new TypeError('Failed to fetch');
      if (a === 'hang') return new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
      return new Response(a === 200 ? JSON.stringify({ elements: [{ type: 'node', id: calls.length, lat: 0, lon: 0 }] }) : 'busy', { status: a, headers: a === 429 ? { 'Retry-After': '5' } : {} });
    },
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
    random: () => 0,
    online,
  };
  return { deps, calls, sleeps };
}

describe('fetching tiles', () => {
  const tiles = tilesOf(squareBbox(banbury, 2), 2);

  it('asks for one tile at a time and stays on a mirror that answers', async () => {
    const f = fake([]);
    const seen: Progress[] = [];
    const out = await fetchTiles(tiles, { deps: f.deps, onProgress: (p) => seen.push(p) });
    expect(out).toHaveLength(4);
    expect(new Set(f.calls.map((c) => c.url))).toEqual(new Set([MIRRORS[0].url]));
    expect(decodeURIComponent(f.calls[0].body.replace(/\+/g, ' '))).toContain(`[bbox:${tiles[0].join(',')}]`);
    expect(seen.filter((p) => p.state === 'done').map((p) => p.done)).toEqual([1, 2, 3, 4]);
  });

  it('moves to the next mirror and backs off on 429, 504 and a timeout', async () => {
    const f = fake([429, 504, 'hang', 200, 200, 200, 200]);
    const seen: Progress[] = [];
    const out = await fetchTiles(tiles, { deps: f.deps, timeoutMs: 20, onProgress: (p) => seen.push(p) });
    expect(out).toHaveLength(4);
    expect(f.calls.slice(0, 4).map((c) => c.url)).toEqual([MIRRORS[0].url, MIRRORS[1].url, MIRRORS[2].url, MIRRORS[3].url]);
    expect(f.sleeps).toEqual([5000, 8000, 16000]); // the 429 asked for 5 s, then 8 and 16
    const waits = seen.filter((p) => p.state === 'waiting');
    expect(waits.map((w) => w.server)).toEqual([MIRRORS[1].name, MIRRORS[2].name, MIRRORS[3].name]);
    expect(waits[0]).toMatchObject({ until: 5000, reason: expect.stringContaining('429') });
    expect(waits[2].reason).toMatch(/no answer/);
  });

  it('gives up after eight tries with a clear message', async () => {
    const f = fake(Array(20).fill(429));
    await expect(fetchTiles(tiles, { deps: f.deps })).rejects.toMatchObject({ kind: 'gave-up', message: expect.stringMatching(/Gave up on tile 1 of 4 after 8 tries/) });
    expect(f.calls).toHaveLength(8);
  });

  it('stops at once on a rejected query, when offline, and when cancelled', async () => {
    await expect(fetchTiles(tiles, { deps: fake([400]).deps })).rejects.toMatchObject({ kind: 'bad-query' });
    await expect(fetchTiles(tiles, { deps: fake([], () => false).deps })).rejects.toMatchObject({ kind: 'offline' });
    const ctl = new AbortController(); ctl.abort();
    await expect(fetchTiles(tiles, { deps: fake([]).deps, signal: ctl.signal })).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('retries a network failure elsewhere', async () => {
    const f = fake(['offline', 200, 200, 200, 200]);
    expect(await fetchTiles(tiles, { deps: f.deps })).toHaveLength(4);
    expect(f.calls[1].url).toBe(MIRRORS[1].url);
  });
});

describe('postcodes', () => {
  it('reads full postcodes and districts, in any spacing and case', () => {
    expect(parsePostcode(' ox16 5qa ')).toEqual({ kind: 'full', text: 'OX16 5QA' });
    expect(parsePostcode('sw1a1aa')).toEqual({ kind: 'full', text: 'SW1A 1AA' });
    expect(parsePostcode('BT1 5GS')).toEqual({ kind: 'full', text: 'BT1 5GS' }); // Northern Ireland is in the data
    expect(parsePostcode('m1')).toEqual({ kind: 'outward', text: 'M1' });
    expect(parsePostcode('JE2 3AB')).toEqual({ kind: 'crown' });
    expect(parsePostcode('GY1 1AA')).toEqual({ kind: 'crown' });
    expect(parsePostcode('IM1 1AA')).toEqual({ kind: 'crown' });
    for (const bad of ['', 'hello', '12345', 'OX16 5QAA', '<script>']) expect(parsePostcode(bad)).toEqual({ kind: 'bad' });
  });

  const reply = (status: number, result?: object) => ({ status, json: async () => ({ status, result }) });

  it('asks postcodes.io, and nothing else', async () => {
    const urls: string[] = [];
    const place = await lookupPostcode('ox16 5qa', async (u) => { urls.push(u); return reply(200, { latitude: 52.06, longitude: -1.33, admin_district: 'Cherwell', parish: 'Banbury' }); });
    expect(urls).toEqual(['https://api.postcodes.io/postcodes/OX16%205QA']);
    expect(place).toMatchObject({ lat: 52.06, lon: -1.33, suggest: 'Banbury' });
    await lookupPostcode('OX16', async (u) => { urls.push(u); return reply(200, { latitude: 52, longitude: -1, admin_district: ['Cherwell'] }); });
    expect(urls[1]).toBe('https://api.postcodes.io/outcodes/OX16');
  });

  it('falls back to retired postcodes, and explains what it can’t find', async () => {
    const retired = await lookupPostcode('AB1 0AA', async (u) => (u.includes('terminated') ? reply(200, { latitude: 57.1, longitude: -2.2 }) : reply(404)));
    expect(retired).toMatchObject({ lat: 57.1 });
    await expect(lookupPostcode('ZZ9 9ZZ', async () => reply(404))).rejects.toThrow(/wasn’t found/);
    await expect(lookupPostcode('JE2 3AB', async () => { throw new Error('must not be asked'); })).rejects.toThrow(/Jersey/);
    await expect(lookupPostcode('nope', async () => { throw new Error('must not be asked'); })).rejects.toThrow(/doesn’t look like/);
    await expect(lookupPostcode('SW1A 1AA', async () => reply(200, { latitude: null, longitude: null }))).rejects.toThrow(/no location/);
    await expect(lookupPostcode('SW1A 1AA', async () => { throw new TypeError('offline'); })).rejects.toThrow(/reach the postcode service|offline/);
  });
});
