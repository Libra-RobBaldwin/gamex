// A minimal typed event emitter: the world scaffold has no DOM or three.js dependency, so it can
// run in tests, a worker or a headless benchmark.
export class Emitter<E extends Record<string, unknown>> {
  private subs: { [K in keyof E]?: Set<(e: E[K]) => void> } = {};
  on<K extends keyof E>(type: K, fn: (e: E[K]) => void): () => void {
    const s = (this.subs[type] ??= new Set());
    s.add(fn);
    return () => { s.delete(fn); };
  }
  emit<K extends keyof E>(type: K, e: E[K]) { for (const fn of this.subs[type] ?? []) fn(e); }
  has<K extends keyof E>(type: K) { return (this.subs[type]?.size ?? 0) > 0; }
}
