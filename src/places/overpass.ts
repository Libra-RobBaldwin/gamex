// Fetching an area from the public Overpass servers, politely: one tile at a time, rotating
// between mirrors, and backing off when a server is busy (429), timed out (504, or no answer in
// time) or unreachable. Everything it touches the outside world with is passed in, so the tests
// run it against a fake network and a fake clock.

import { overpassQuery, type Bbox } from '../proto/osm/fetch';

export const MIRRORS = [
  { name: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter' },
  { name: 'overpass.kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter' },
  { name: 'maps.mail.ru', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
  { name: 'overpass.private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
] as const;

export const MAX_ATTEMPTS = 8; // per tile: each mirror twice, then give up
export const TIMEOUT_MS = 100_000; // the query asks the server for 90 s at most

export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  random: () => number;
  online: () => boolean;
}

export type Progress =
  | { state: 'asking'; tile: number; total: number; done: number; server: string; attempt: number }
  | { state: 'waiting'; tile: number; total: number; done: number; server: string; attempt: number; until: number; reason: string }
  | { state: 'done'; tile: number; total: number; done: number; server: string; attempt: number };

export class FetchError extends Error {
  constructor(message: string, readonly kind: 'gave-up' | 'offline' | 'bad-query' | 'cancelled') { super(message); }
}

/** How long to wait before the next try: doubling from 4 s to a minute, a little jitter, and a
 * server's own Retry-After (up to two minutes) when it gives one. */
export function backoffMs(attempt: number, random = Math.random, retryAfterS?: number) {
  const base = Math.min(60_000, 4000 * 2 ** Math.max(0, attempt - 1));
  const asked = retryAfterS !== undefined && Number.isFinite(retryAfterS) && retryAfterS > 0 ? Math.min(120, retryAfterS) * 1000 : 0;
  return Math.round(Math.max(base, asked) + random() * 1000);
}

/**
 * What an answer means: use it, try again (elsewhere, later), or stop. The body is checked, not
 * parsed: a big tile takes a phone a noticeable moment to parse, so that happens in the worker.
 */
export function judge(status: number, body: string): { ok: true; text: string } | { ok: false; retry: boolean; reason: string } {
  if (status === 429) return { ok: false, retry: true, reason: 'too busy (429)' };
  if (status === 504) return { ok: false, retry: true, reason: 'timed out (504)' };
  if (status === 400) return { ok: false, retry: false, reason: 'rejected the query (400)' };
  if (status !== 200) return { ok: false, retry: true, reason: `answered ${status}` };
  const t = body.trim();
  if (!t.startsWith('{') || !t.endsWith('}') || !/"elements"\s*:\s*\[/.test(t.slice(0, 8000))) return { ok: false, retry: true, reason: 'sent something that isn’t map data' };
  // a query that runs out of time or memory still answers 200, with what it had and a remark
  // (Overpass puts the remark after the elements)
  if (/"remark"\s*:\s*"[^"]*(error|timed out|out of memory)/i.test(t.slice(-4000))) return { ok: false, retry: true, reason: 'ran out of time on the server' };
  return { ok: true, text: t };
}

export const browserDeps = (): Deps => ({
  fetch: (url, init) => fetch(url, init),
  sleep: (ms, signal) => new Promise((res, rej) => {
    if (signal?.aborted) return rej(new FetchError('Cancelled', 'cancelled'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); res(); }, ms);
    const stop = () => { clearTimeout(t); rej(new FetchError('Cancelled', 'cancelled')); };
    signal?.addEventListener('abort', stop, { once: true });
  }),
  now: () => Date.now(),
  random: Math.random,
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});

export interface FetchOpts { signal?: AbortSignal; onProgress?: (p: Progress) => void; deps?: Deps; timeoutMs?: number; maxAttempts?: number; firstMirror?: number }

/** Every tile, one after another; each tile's answer (Overpass JSON, as text) in order. Throws FetchError when it can't. */
export async function fetchTiles(tiles: Bbox[], opts: FetchOpts = {}): Promise<string[]> {
  const d = opts.deps ?? browserDeps();
  const max = opts.maxAttempts ?? MAX_ATTEMPTS, timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  let m = opts.firstMirror ?? 0; // stays on a mirror that's answering, moves on from one that isn't
  const out: string[] = [];
  const cancelled = () => { if (opts.signal?.aborted) throw new FetchError('Cancelled', 'cancelled'); };
  for (let i = 0; i < tiles.length; i++) {
    let lastReason = '';
    for (let attempt = 1; ; attempt++) {
      cancelled();
      if (!d.online()) throw new FetchError('You’re offline. Connect and try again; areas you’ve built before still open.', 'offline');
      const mirror = MIRRORS[m % MIRRORS.length];
      const base = { tile: i + 1, total: tiles.length, done: i, server: mirror.name, attempt };
      opts.onProgress?.({ state: 'asking', ...base });
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeoutMs);
      let verdict: ReturnType<typeof judge>, retryAfter: number | undefined;
      try {
        const res = await d.fetch(mirror.url, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(tiles[i]) }), signal: ctl.signal });
        retryAfter = Number(res.headers.get('Retry-After') ?? NaN);
        verdict = judge(res.status, await res.text());
      } catch {
        cancelled();
        verdict = { ok: false, retry: true, reason: timedOut ? `gave no answer in ${Math.round(timeoutMs / 1000)} s` : 'couldn’t be reached' };
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      }
      if (verdict.ok) {
        out.push(verdict.text);
        opts.onProgress?.({ state: 'done', ...base, done: i + 1 });
        break;
      }
      if (!verdict.retry) throw new FetchError(`${mirror.name} ${verdict.reason}. This is a bug in the page, not your area.`, 'bad-query');
      lastReason = `${mirror.name} ${verdict.reason}`;
      if (attempt >= max) {
        throw new FetchError(`Gave up on tile ${i + 1} of ${tiles.length} after ${max} tries on ${MIRRORS.length} servers (last: ${lastReason}). The public Overpass servers are busy; try again in a few minutes, or pick a smaller area.`, 'gave-up');
      }
      m++;
      const wait = backoffMs(attempt, d.random, retryAfter);
      opts.onProgress?.({ state: 'waiting', ...base, server: MIRRORS[m % MIRRORS.length].name, until: d.now() + wait, reason: lastReason });
      await d.sleep(wait, opts.signal);
    }
  }
  return out;
}
