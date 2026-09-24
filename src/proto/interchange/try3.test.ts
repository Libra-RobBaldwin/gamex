import { it } from 'vitest';
import { SCENARIOS, simulate } from '../trafficsim';
it('try3', () => {
  for (const sc of SCENARIOS.filter((s) => s.name.startsWith('motorway'))) {
    let wrong = 0, seen = '', mw = 0;
    const r = simulate(sc, 180, 1 / 30, (t, time) => {
      for (const c of (t as any).cars) {
        if (c.gone !== undefined) continue;
        if (c.seg.oneway && c.from !== c.seg.a) wrong++;
        if (c.turn && c.turn.next.oneway && c.turn.node !== c.turn.next.a) wrong++;
        if (c.seg.type === 'motorway') mw++;
      }
      if (time > 179.9) { const out: string[] = []; for (const [node, m] of t.seen) { const j = t.junctions.get(node); if (j && (j.form === 'merge' || j.form === 'diverge')) out.push(`${j.form}@${node}: ${[...m].map(([k, v]) => `${k}=${v}`).join(' ')}`); } seen = out.join(' | '); }
    });
    console.log(`${sc.name.padEnd(36)} wrong=${wrong} carFramesOnMotorway=${mw} arrived=${r.arrived} gaveUp=${r.gaveUp}\n  ${seen}`);
  }
}, 600000);
