import { describe, expect, it } from 'vitest';
import { serveLoader, workerLoader, type Port } from './worker';
import { StreamManager, type LoadRequest } from './stream';
import { tileSeed } from './seed';

// A MessageChannel (global in browsers and Node) stands in for a worker: same structured-clone boundary, same async delivery.
function channel() {
  const c = new MessageChannel();
  return { main: c.port1 as unknown as Port, worker: c.port2 as unknown as Port, close: () => { c.port1.close(); c.port2.close(); } };
}
const gen = (req: LoadRequest) => ({ key: req.key, lod: req.lod, seed: req.seed, heights: new Float32Array(4).fill(req.i + req.j) });
const until = async (test: () => boolean) => { for (let k = 0; k < 200 && !test(); k++) await new Promise((r) => setTimeout(r, 2)); };

describe('worker loaders', () => {
  it('runs a pure generator across a message port, data intact', async () => {
    const ch = channel();
    serveLoader(ch.worker, gen);
    const load = workerLoader<ReturnType<typeof gen>>(ch.main);
    const req: LoadRequest = { key: '3,4', i: 3, j: 4, lod: 'near', seed: tileSeed(1, '3,4'), size: 1000 };
    const out = await load(req, new AbortController().signal);
    expect(out).toEqual(gen(req));
    expect(out.heights).toBeInstanceOf(Float32Array);
    ch.close();
  });
  it('drives the streaming manager, and cancels jobs the worker has not started', async () => {
    const ch = channel();
    const ran: string[] = [];
    serveLoader(ch.worker, async (req) => { ran.push(req.key); await new Promise((r) => setTimeout(r, 5)); return gen(req); });
    const m = new StreamManager({ loader: workerLoader<ReturnType<typeof gen>>(ch.main), rings: [{ lod: 'near', radius: 1200 }], margin: 0, budget: { items: 100 } });
    m.update({ x: 500, z: 500 }); // 9 tiles queued in the worker
    m.update({ x: 50500, z: 500 }); // gone before most of them ran
    await until(() => m.pending().length === 0 && m.stats().ready === 0);
    for (let k = 0; k < 50 && !m.settled(); k++) { m.update({ x: 50500, z: 500 }); await new Promise((r) => setTimeout(r, 5)); }
    expect(m.settled()).toBe(true);
    expect(m.loaded('50,0')?.data.key).toBe('50,0');
    expect(m.loaded('0,0')).toBeUndefined();
    // the first job was already running; the rest of the old queue was skipped
    expect(ran.filter((k) => !k.startsWith('49') && !k.startsWith('50') && !k.startsWith('51')).length).toBeLessThanOrEqual(1);
    m.dispose(); ch.close();
  });
});
