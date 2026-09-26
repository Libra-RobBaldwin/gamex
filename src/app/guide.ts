// The guided start: a few steps over the live game, each ticked off when the player does it
// (moves the map, places a stop, starts a line). It says what the game's own goal strip would, so that
// strip hides while the guide is up (proto.css). It watches the game through
// window.proto rather than hooking into it, so the game needs no changes for it. Skippable at any
// step; finishing or skipping it is remembered (store.ts), and How to play starts it again.

import { icon, type Icon } from '../proto/ui/icons';
import { setGuideSeen } from './store';

interface Game {
  view: { x: number; z: number; h: number; az: number; el: number };
  net: { segs: Map<number, { stops: unknown[] }> };
  lines?: { list: unknown[] };
  startLineTool?: () => void;
  shell: { dismissFirstRun(): void };
}
interface Step { id: string; icon: Icon; title: string; text: string; done?: (g: Game) => boolean }

const stops = (g: Game) => { let n = 0; for (const s of g.net.segs.values()) n += s.stops.length; return n; };

function steps(g: Game): Step[] {
  const v0 = { ...g.view }, stops0 = stops(g), lines0 = g.lines?.list.length ?? 0;
  const out: Step[] = [
    {
      id: 'move', icon: 'finger', title: 'Move the map',
      text: 'Drag with one finger to look around. Pinch to zoom, and twist two fingers to turn.',
      done: (x) => Math.hypot(x.view.x - v0.x, x.view.z - v0.z) > 25 || Math.abs(Math.log(x.view.h / v0.h)) > 0.2 || Math.abs(Math.atan2(Math.sin(x.view.az - v0.az), Math.cos(x.view.az - v0.az))) > 0.25,
    },
    {
      id: 'stop', icon: 'busStop', title: 'Place a bus stop',
      text: 'Tap <b>Build</b>, open <b>Stops</b> and pick the bus stop. Tap beside a road to put one there. Two stops make a line.',
      done: (x) => stops(x) > stops0,
    },
  ];
  // the line tool (loop M1): only once the game has it
  if (g.lines && g.startLineTool) out.push({
    id: 'line', icon: 'route', title: 'Start a bus line',
    text: 'Tap <b>Transport</b>, then <b>New line</b> under Lines. Tap orange stops in the order the bus calls, then <b>Create</b>.',
    done: (x) => (x.lines?.list.length ?? 0) > lines0,
  });
  out.push({ id: 'end', icon: 'trendUp', title: 'That’s the loop', text: 'People walk to your stops and ride your buses, and good service makes the town grow. Roads and railways are in <b>Build</b> too. <b>Menu</b> has quality and the way back to the start.' });
  return out;
}

let running: (() => void) | null = null;

export function runGuide() {
  const g = (window as unknown as { proto?: Game }).proto;
  if (!g || running) return;
  g.shell.dismissFirstRun(); // (the guide says what the one-line first-run pill would)
  const list = steps(g);
  const el = document.createElement('aside');
  el.id = 'guide';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Guided start');
  document.body.append(el);
  let i = 0, ticked = false, timer = 0;

  const draw = () => {
    const s = list[i], last = i === list.length - 1;
    el.innerHTML = `<div class="g-head"><i class="g-ic">${icon(ticked ? 'check' : s.icon)}</i>
        <div class="g-t"><small>Step ${i + 1} of ${list.length}</small><b>${s.title}</b></div>
        ${last ? '' : `<button class="g-skip" data-skip>Skip guide</button>`}</div>
      <p>${s.text}</p>
      <div class="g-foot"><span class="g-dots" aria-hidden="true">${list.map((_, k) => `<i class="${k < i ? 'd' : k === i ? 'on' : ''}"></i>`).join('')}</span>
        <button class="g-next${ticked || last ? ' primary' : ''}" data-next>${last ? 'Start playing' : ticked ? 'Done · next' : 'Next'}${last ? icon('play') : icon('chevronDown', 'g-arr')}</button></div>`;
    el.classList.toggle('ticked', ticked);
    el.querySelector('[data-skip]')?.addEventListener('click', () => end());
    el.querySelector('[data-next]')!.addEventListener('click', () => next());
  };
  const next = () => {
    clearTimeout(timer);
    if (i >= list.length - 1) return end();
    i++; ticked = false; draw();
  };
  const end = () => {
    setGuideSeen(true);
    clearInterval(watch); clearTimeout(timer);
    el.remove();
    running = null;
  };
  // tick a step off when it's done, then move on after a moment to read the tick
  const watch = window.setInterval(() => {
    const s = list[i];
    if (ticked || !s.done) return;
    let did = false;
    try { did = s.done(g); } catch { /* the game changed shape: leave it to Next */ }
    if (!did) return;
    ticked = true; draw();
    timer = window.setTimeout(next, 1400);
  }, 400);
  running = end;
  draw();
}
