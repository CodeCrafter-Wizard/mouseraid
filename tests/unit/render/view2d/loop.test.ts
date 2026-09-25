import { describe, expect, it } from 'vitest';
import { FRAME_CLAMP_MS, MAX_STEPS_PER_FRAME, createLoop } from '../../../../src/render/view2d/loop';
import type { Loop, LoopHooks } from '../../../../src/render/view2d/loop';
import { TICK_MS } from '../../../../src/core/sim/tick';

/**
 * Uhr, Zeitplan und Zaehler von Hand – kein rAF, keine Wartezeit, keine echte Zeit.
 * Gerechnet wird immer in VIELFACHEN von TICK_MS: 1000/30 ist keine glatte Dualzahl, und eine
 * Erwartung wie „100 ms sind 3 Ticks" waere um genau ein Bit falsch.
 */
interface Harness {
  loop: Loop;
  ticks: number[];
  draws: number;
  scheduled: (() => void)[];
  cancelled: number[];
  setNow(value: number): void;
  addNow(delta: number): void;
}

function harness(): Harness {
  let now = 0;
  const ticks: number[] = [];
  const scheduled: (() => void)[] = [];
  const cancelled: number[] = [];
  let draws = 0;
  let nextHandle = 0;
  const hooks: LoopHooks = {
    advance: (count) => { ticks.push(count); },
    draw: () => { draws += 1; },
    now: () => now,
    schedule: (run) => { scheduled.push(run); nextHandle += 1; return nextHandle; },
    cancel: (handle) => { cancelled.push(handle); },
  };
  const loop = createLoop(hooks);
  return {
    loop, ticks, scheduled, cancelled,
    get draws() { return draws; },
    setNow(value) { now = value; },
    addNow(delta) { now += delta; },
  };
}

describe('loop: Akkumulator', () => {
  it('rechnet erst dann einen Tick, wenn TICK_MS zusammengekommen sind', () => {
    const h = harness();
    expect(h.loop.pump()).toBe(0);            // die erste Differenz ist 0
    h.addNow(TICK_MS * 0.9);
    expect(h.loop.pump()).toBe(0);
    h.addNow(TICK_MS * 0.9);                  // zusammen 1,8 Ticks
    expect(h.loop.pump()).toBe(1);
  });

  it('behaelt den Rest und holt ihn im naechsten Bild nach', () => {
    const h = harness();
    h.loop.pump();
    // ABSOLUTE Zeitpunkte statt Summen: `now` ist eine Gleitkommazahl, und zwei addierte
    // Vielfache von 1000/30 landen sonst um ein Bit neben der Tickgrenze.
    h.setNow(TICK_MS * 1.6);
    expect(h.loop.pump()).toBe(1);            // 1,6 Ticks -> 1, Rest 0,6
    h.setNow(TICK_MS * 3.2);                  // wieder 1,6 dazu -> Rest 2,2
    expect(h.loop.pump()).toBe(2);
    expect(h.ticks).toEqual([1, 2]);
  });

  it('zeichnet in JEDEM Bild genau einmal, auch ohne gerechneten Tick', () => {
    const h = harness();
    h.loop.pump();
    h.loop.pump();
    h.addNow(TICK_MS * 6);
    h.loop.pump();
    expect(h.draws).toBe(3);
  });

  it('meldet `advance` nur, wenn es etwas zu rechnen gibt', () => {
    const h = harness();
    h.loop.pump();
    h.loop.pump();
    expect(h.ticks).toEqual([]);
  });
});

describe('loop: Deckel und Klammer', () => {
  it('rechnet hoechstens MAX_STEPS_PER_FRAME Schritte je Bild', () => {
    const h = harness();
    h.loop.pump();
    h.addNow(FRAME_CLAMP_MS);                 // 250 ms = 7,5 Ticks
    expect(h.loop.pump()).toBe(MAX_STEPS_PER_FRAME);
  });

  it('klemmt einen Zeitsprung auf FRAME_CLAMP_MS – ein Tab-Wechsel rechnet keine Stunde nach', () => {
    const h = harness();
    h.loop.pump();
    h.addNow(3600_000);                       // eine Stunde im Hintergrund
    expect(h.loop.pump()).toBe(MAX_STEPS_PER_FRAME);
    // Ohne Klammer laegen jetzt 3 600 000 ms im Akkumulator und JEDES weitere Bild liefe am
    // Deckel. Mit Klammer bleiben von 250 ms nach 5 Schritten 83,3 ms – also genau 2 Ticks, dann 0.
    expect(h.loop.pump()).toBe(2);
    expect(h.loop.pump()).toBe(0);
  });

  it('verkraftet eine rueckwaerts laufende Uhr, ohne Zeit zu verlieren', () => {
    const h = harness();
    h.loop.pump();
    h.setNow(-1000);
    expect(h.loop.pump()).toBe(0);
    h.setNow(-1000 + TICK_MS * 1.6);
    expect(h.loop.pump()).toBe(1);
  });
});

describe('loop: start/stop', () => {
  it('startet nicht von selbst – vor `start()` laeuft nichts (das ist `?clock=manual`)', () => {
    const h = harness();
    expect(h.loop.running()).toBe(false);
    expect(h.scheduled).toHaveLength(0);
    expect(h.draws).toBe(0);
  });

  it('`start()` plant ein Bild ein und meldet sich als laufend', () => {
    const h = harness();
    h.loop.start();
    expect(h.loop.running()).toBe(true);
    expect(h.scheduled).toHaveLength(1);
  });

  it('`start()` zweimal plant nicht zweimal ein', () => {
    const h = harness();
    h.loop.start();
    h.loop.start();
    expect(h.scheduled).toHaveLength(1);
  });

  it('der erste Frame nach `start()` rechnet keinen Rueckstand nach', () => {
    const h = harness();
    h.setNow(10_000);                         // die Seite lief schon zehn Sekunden
    h.loop.start();
    h.scheduled[0]?.();
    expect(h.ticks).toEqual([]);
    expect(h.draws).toBe(1);
  });

  it('`stop()` sagt den eingeplanten Frame ab und haelt einen laufenden auf', () => {
    const h = harness();
    h.loop.start();
    const frame = h.scheduled[0];
    h.loop.stop();
    expect(h.loop.running()).toBe(false);
    expect(h.cancelled).toEqual([1]);
    frame?.();                                // ein schon geplanter Frame darf nichts mehr tun
    expect(h.draws).toBe(0);
    expect(h.scheduled).toHaveLength(1);
  });

  it('`stop()` ohne `start()` tut nichts', () => {
    const h = harness();
    h.loop.stop();
    expect(h.cancelled).toEqual([]);
  });

  it('ein laufender Frame plant den naechsten ein', () => {
    const h = harness();
    h.loop.start();
    h.setNow(TICK_MS * 3.2);
    h.scheduled[0]?.();
    expect(h.scheduled).toHaveLength(2);
    expect(h.ticks).toEqual([3]);
  });
});
