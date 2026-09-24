// Running tile loaders in a Web Worker. The streaming manager only sees a Loader (request in,
// promise out, abort signal), so moving generation off the main thread is a matter of wrapping
// the same pure function on both sides of a message port:
//
//   // tile.worker.ts
//   serveLoader(self, generateTile);
//   // main thread
//   const loader = workerLoader(new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' }));
//   new StreamManager({ loader, ... });
//
// Cancelling sends a message so the worker can skip work it hasn't started; a generator that
// takes an AbortSignal can also stop part-way. Results should be plain data (arrays, typed
// arrays); pass `transfer` to hand typed-array buffers over without copying.

import type { LoadRequest, Loader } from './stream';

export interface Port {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  start?(): void;
}
type ToWorker = { t: 'load'; id: number; req: LoadRequest } | { t: 'cancel'; id: number };
type FromWorker = { t: 'done'; id: number; data: unknown } | { t: 'fail'; id: number; error: string };

export function workerLoader<T>(port: Port): Loader<T> {
  let next = 1;
  const waiting = new Map<number, { resolve: (v: T) => void; reject: (e: unknown) => void }>();
  port.addEventListener('message', (e) => {
    const m = e.data as FromWorker, w = waiting.get(m.id);
    if (!w) return; // cancelled meanwhile
    waiting.delete(m.id);
    if (m.t === 'done') w.resolve(m.data as T); else w.reject(new Error(m.error));
  });
  port.start?.();
  return (req, signal) => new Promise<T>((resolve, reject) => {
    const id = next++;
    waiting.set(id, { resolve, reject });
    signal.addEventListener('abort', () => {
      if (!waiting.delete(id)) return;
      port.postMessage({ t: 'cancel', id } satisfies ToWorker);
      reject(new DOMException('cancelled', 'AbortError'));
    }, { once: true });
    port.postMessage({ t: 'load', id, req } satisfies ToWorker);
  });
}

// The worker side. Requests are handled one at a time in arrival order; a cancel that arrives
// first means the job is skipped, and a running job's signal is aborted.
export function serveLoader<T>(port: Port, gen: (req: LoadRequest, signal: AbortSignal) => T | Promise<T>, transfer?: (data: T) => Transferable[]) {
  const queue: { id: number; req: LoadRequest; ctrl: AbortController }[] = [];
  const byId = new Map<number, AbortController>();
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift()!;
      if (job.ctrl.signal.aborted) { byId.delete(job.id); continue; }
      try {
        const data = await gen(job.req, job.ctrl.signal);
        if (!job.ctrl.signal.aborted) port.postMessage({ t: 'done', id: job.id, data } satisfies FromWorker, transfer?.(data));
      } catch (err) {
        if (!job.ctrl.signal.aborted) port.postMessage({ t: 'fail', id: job.id, error: String((err as Error)?.message ?? err) } satisfies FromWorker);
      }
      byId.delete(job.id);
    }
    busy = false;
  };
  port.addEventListener('message', (e) => {
    const m = e.data as ToWorker;
    if (m.t === 'cancel') { byId.get(m.id)?.abort(); return; }
    const ctrl = new AbortController();
    byId.set(m.id, ctrl);
    queue.push({ id: m.id, req: m.req, ctrl });
    void pump();
  });
  port.start?.();
}
