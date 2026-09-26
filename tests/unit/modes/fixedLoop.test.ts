import { describe, expect, it } from 'vitest';
import { FRAME_CLAMP_MS, MAX_STEPS_PER_FRAME, createFixedLoop } from '../../../src/modes/fixedLoop';
import type { FixedLoop, FixedLoopHooks, FrameStats } from '../../../src/modes/fixedLoop';
import { TICK_MS } from '../../../src/core/sim/tick';
import { fakeFrameClock } from '../../helpers/fakeFrameClock';

/**
 * Zaehler von Hand, Uhr und rAF-Planer aus `tests/helpers/fakeFrameClock.ts` (Abschlussreview
 * MIN-14: die Attrappe stand wörtlich zweimal im Repo).
 * Gerechnet wird immer in VIELFACHEN von TICK_MS: 1000/30 ist keine glatte Dualzahl, und eine
 * Erwartung wie "100 ms sind 3 Ticks" waere um genau ein Bit falsch.
 *
 * Diese Datei ist der umgezogene `render/view2d/loop.test.ts` aus M4, erweitert um `alpha`,
 * `dropped`, `pause`/`resume` und den Kadenz-Teiler. `src/render/view2d/loop.ts` ist geloescht.
 */
interface Harness {
  loop: FixedLoop;
  ticks: number[];
  alphas: number[];
  stats: FrameStats[];
  scheduled: (() => void)[];
  cancelled: number[];
  draws: number;
  setNow(value: number): void;
  addNow(delta: number): void;
  /** Haengt einen Rueckruf IN `render` – `render` und `onFrame` duerfen die Schleife anhalten. */
  onRender(run: () => void): void;
}

function harness(divider?: number): Harness {
  const ticks: number[] = [];
  const alphas: number[] = [];
  const stats: FrameStats[] = [];
  const timer = fakeFrameClock();
  let inRender: (() => void) | undefined = undefined;
  const hooks: FixedLoopHooks = {
    advance: (count) => { ticks.push(count); },
    render: (alpha) => { alphas.push(alpha); inRender?.(); },
    onFrame: (entry) => { stats.push(entry); },
  };
  const loop = createFixedLoop(hooks, timer.clock, divider);
  return {
    loop, ticks, alphas, stats, scheduled: timer.scheduled, cancelled: timer.cancelled,
    get draws() { return alphas.length; },
    setNow: timer.setNow,
    addNow: timer.addNow,
    onRender(run: () => void) { inRender = run; },
  };
}

describe('fixedLoop: Akkumulator', () => {
  it('rechnet erst dann einen Tick, wenn TICK_MS zusammengekommen sind', () => {
    const h = harness();
    expect(h.loop.pump().steps).toBe(0);      // die erste Differenz ist 0
    h.addNow(TICK_MS * 0.9);
    expect(h.loop.pump().steps).toBe(0);
    h.addNow(TICK_MS * 0.9);                  // zusammen 1,8 Ticks
    expect(h.loop.pump().steps).toBe(1);
  });

  it('behaelt den Rest und holt ihn im naechsten Bild nach', () => {
    const h = harness();
    h.loop.pump();
    // ABSOLUTE Zeitpunkte statt Summen: `now` ist eine Gleitkommazahl, und zwei addierte
    // Vielfache von 1000/30 landen sonst um ein Bit neben der Tickgrenze.
    h.setNow(TICK_MS * 1.6);
    expect(h.loop.pump().steps).toBe(1);      // 1,6 Ticks -> 1, Rest 0,6
    h.setNow(TICK_MS * 3.2);                  // wieder 1,6 dazu -> Rest 2,2
    expect(h.loop.pump().steps).toBe(2);
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

  it('meldet die GEKLEMMTE Zeitdifferenz des Bildes, nicht die rohe', () => {
    const h = harness();
    h.loop.pump();
    h.addNow(TICK_MS * 1.6);
    expect(h.loop.pump().deltaMs).toBeCloseTo(TICK_MS * 1.6, 9);
    h.addNow(3600_000);
    expect(h.loop.pump().deltaMs).toBe(FRAME_CLAMP_MS);
  });
});

describe('fixedLoop: alpha', () => {
  it('ist der Rest NACH den Schritten und liegt in [0, 1]', () => {
    const h = harness();
    h.loop.pump();
    h.setNow(TICK_MS * 1.6);
    const first = h.loop.pump();
    expect(first.steps).toBe(1);
    expect(first.alpha).toBeCloseTo(0.6, 9);
    h.setNow(TICK_MS * 2.25);
    const second = h.loop.pump();
    expect(second.steps).toBe(1);
    expect(second.alpha).toBeCloseTo(0.25, 9);
  });

  it('gibt `render` genau diesen Mischanteil weiter', () => {
    const h = harness();
    h.loop.pump();
    h.setNow(TICK_MS * 1.5);
    const stats = h.loop.pump();
    expect(h.alphas).toEqual([0, stats.alpha]);
    expect(stats.alpha).toBeCloseTo(0.5, 9);
  });

  it('ist 0, solange kein Bruchteil eines Ticks aufgelaufen ist', () => {
    const h = harness();
    expect(h.loop.pump().alpha).toBe(0);
    h.setNow(TICK_MS * 2);
    const stats = h.loop.pump();
    expect(stats.steps).toBe(2);
    expect(stats.alpha).toBeCloseTo(0, 9);
  });
});

describe('fixedLoop: Deckel, verworfene Ticks und Klammer', () => {
  it('rechnet hoechstens MAX_STEPS_PER_FRAME Schritte je Bild', () => {
    const h = harness();
    h.loop.pump();
    h.addNow(FRAME_CLAMP_MS);                 // 250 ms = 7,5 Ticks
    expect(h.loop.pump().steps).toBe(MAX_STEPS_PER_FRAME);
  });

  it('verwirft den Ueberschuss ueber dem Deckel und ZAEHLT ihn', () => {
    // 250 ms sind 7,5 Ticks: 5 werden gerechnet, 2 verworfen, 0,5 bleiben als `alpha` liegen.
    // Ohne das Verwerfen liefe das naechste Bild erneut am Deckel und die Simulation blieb
    // dauerhaft hinter der Wanduhr – MIT dem Verwerfen steht sie nach EINEM Bild wieder still.
    const h = harness();
    h.loop.pump();
    h.addNow(FRAME_CLAMP_MS);
    const jump = h.loop.pump();
    expect(jump.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(jump.dropped).toBe(2);
    expect(jump.alpha).toBeCloseTo(0.5, 9);
    const after = h.loop.pump();
    expect(after.steps).toBe(0);
    expect(after.dropped).toBe(2);            // LAUFENDE Summe, nicht die dieses Bildes
  });

  it('klemmt einen Zeitsprung auf FRAME_CLAMP_MS – ein Tab-Wechsel rechnet keine Stunde nach', () => {
    const h = harness();
    h.loop.pump();
    h.addNow(3600_000);                       // eine Stunde im Hintergrund
    const jump = h.loop.pump();
    expect(jump.steps).toBe(MAX_STEPS_PER_FRAME);
    // Ohne Klammer laegen jetzt 3 600 000 ms im Akkumulator und JEDES weitere Bild liefe am
    // Deckel. Mit Klammer bleiben von 250 ms nach 5 Schritten 83,3 ms; davon werden 2 Ticks
    // verworfen, und danach steht die Schleife still.
    expect(jump.dropped).toBe(2);
    expect(h.loop.pump().steps).toBe(0);
    expect(h.loop.pump().steps).toBe(0);
  });

  it('verkraftet eine rueckwaerts laufende Uhr, ohne Zeit zu verlieren', () => {
    const h = harness();
    h.loop.pump();
    h.setNow(-1000);
    const backwards = h.loop.pump();
    expect(backwards.steps).toBe(0);
    expect(backwards.deltaMs).toBe(0);
    h.setNow(-1000 + TICK_MS * 1.6);
    expect(h.loop.pump().steps).toBe(1);
  });
});

describe('fixedLoop: Kadenz-Teiler', () => {
  it('zeichnet ohne Teiler in jedem Bild', () => {
    const h = harness();
    expect(h.loop.divider()).toBe(1);
    h.loop.pump();
    h.loop.pump();
    expect(h.stats.map((entry) => entry.rendered)).toEqual([true, true]);
    expect(h.draws).toBe(2);
  });

  it('ueberspringt mit Teiler 2 jedes zweite Bild – das erste faellt', () => {
    const h = harness(2);
    expect(h.loop.divider()).toBe(2);
    for (let i = 0; i < 4; i += 1) h.loop.pump();
    expect(h.stats.map((entry) => entry.rendered)).toEqual([true, false, true, false]);
    expect(h.draws).toBe(2);
  });

  it('rechnet auch in einem uebersprungenen Bild weiter – nur gezeichnet wird nicht', () => {
    const h = harness(2);
    h.loop.pump();                            // Bild 0, gezeichnet
    h.setNow(TICK_MS * 2);
    const skipped = h.loop.pump();            // Bild 1, uebersprungen
    expect(skipped.rendered).toBe(false);
    expect(skipped.steps).toBe(2);
    expect(h.ticks).toEqual([2]);
    expect(h.draws).toBe(1);
  });

  it('klemmt einen unsinnigen Teiler auf 1', () => {
    for (const bad of [0, -3, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const h = harness(bad);
      expect(h.loop.divider(), `Teiler ${bad}`).toBe(1);
    }
    const h = harness();
    h.loop.setDivider(4);
    expect(h.loop.divider()).toBe(4);
    h.loop.setDivider(0);
    expect(h.loop.divider()).toBe(1);
    h.loop.setDivider(2.9);                   // ganze Zahlen: 2,9 Bilder gibt es nicht
    expect(h.loop.divider()).toBe(2);
  });
});

describe('fixedLoop: start/stop', () => {
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

  it('`start()` setzt den Akkumulator zurueck – genau das trennt es von `resume()`', () => {
    const h = harness();
    h.loop.pump();
    h.setNow(TICK_MS * 0.9);
    h.loop.pump();                            // 0,9 Ticks liegen im Akkumulator
    h.loop.start();
    h.setNow(TICK_MS * 1.5);                  // 0,6 Ticks seit `start()`
    expect(h.loop.pump().steps).toBe(0);      // mit behaltenem Rest waeren es 1
  });
});

describe('fixedLoop: pause/resume', () => {
  it('`pause()` sagt den Frame ab, bleibt aber `running()`', () => {
    const h = harness();
    h.loop.start();
    h.loop.pause();
    expect(h.loop.paused()).toBe(true);
    expect(h.loop.running()).toBe(true);
    expect(h.cancelled).toEqual([1]);
  });

  it('ein pausiertes `pump()` rechnet nichts und zeichnet nichts', () => {
    const h = harness();
    h.loop.start();
    h.loop.pause();
    h.addNow(FRAME_CLAMP_MS);
    const stats = h.loop.pump();
    expect(stats).toEqual({ deltaMs: 0, steps: 0, dropped: 0, alpha: 0, rendered: false, cpuMs: 0, frameMs: 0 });
    expect(h.draws).toBe(0);
    expect(h.ticks).toEqual([]);
  });

  // Task-2-Review, Minor 3: der Fall oben laeuft direkt nach `start()`, der Akkumulator ist also
  // ohnehin 0 – `alpha: 0` war dort eine Folge des Aufbaus, keine Aussage ueber das pausierte Bild.
  // Ein pausiertes Bild BEHAELT den Mischanteil: derselbe Grund wie bei `resume()`, der angefangene
  // Tick ist nicht verschenkt. Ohne diesen Fall liesse sich `alpha: alphaNow()` in `pump()` unbemerkt
  // auf `alpha: 0` aendern.
  it('ein pausiertes `pump()` BEHAELT den stehengebliebenen Mischanteil', () => {
    const h = harness();
    h.loop.start();
    h.setNow(TICK_MS * 1.5);
    expect(h.loop.pump().alpha).toBeCloseTo(0.5, 9);
    h.loop.pause();
    h.addNow(3600_000);
    const stats = h.loop.pump();
    expect(stats.alpha).toBeCloseTo(0.5, 9);
    expect(stats.steps).toBe(0);
    expect(stats.rendered).toBe(false);
  });

  // Task-2-Review, Minor 1: `frame()` prueft `active`/`halted` nur VOR `pump()`. Ein `pause()` aus
  // `render` oder `onFrame` heraus sagte das laufende Bild ab – und `frame()` bestellte danach ein
  // NEUES, das den abgesagten Handle ueberschrieb. GEMESSEN lagen nach `resume()` dann ZWEI offene
  // Rueckrufe in der Warteschlange, und beide planten je einen Nachfolger: die Schleife zeichnete ab
  // da zweimal je Bildschirmbild. Auf dem M5-Weg unerreichbar (`pause()` kommt nur aus
  // `visibilitychange`), aber M6 pausiert aus dem Bild heraus.
  it('`pause()` AUS DEM BILD HERAUS bestellt kein neues Bild – nach `resume()` laeuft EINE Kette', () => {
    const h = harness();
    h.loop.start();
    h.onRender(() => { h.loop.pause(); });
    // Das geplante Bild ausloesen: es zeichnet, pausiert dabei – und darf nichts nachbestellen.
    h.scheduled[0]?.();
    expect(h.draws).toBe(1);
    expect(h.scheduled).toHaveLength(1);
    // `resume()` plant genau EIN Bild. Waere oben eines nachbestellt worden, liefen jetzt zwei Ketten.
    h.onRender(() => undefined);
    h.loop.resume();
    expect(h.scheduled).toHaveLength(2);
    const before = h.scheduled.length;
    h.scheduled[1]?.();
    expect(h.scheduled.length - before, 'genau EIN Nachfolger je Bild').toBe(1);
  });

  it('`stop()` aus dem Bild heraus hinterlaesst kein totes rAF', () => {
    const h = harness();
    h.loop.start();
    h.onRender(() => { h.loop.stop(); });
    h.scheduled[0]?.();
    expect(h.loop.running()).toBe(false);
    expect(h.scheduled).toHaveLength(1);
  });

  it('ein schon geplanter Frame tut nach `pause()` nichts mehr', () => {
    const h = harness();
    h.loop.start();
    const frame = h.scheduled[0];
    h.loop.pause();
    frame?.();
    expect(h.draws).toBe(0);
    expect(h.scheduled).toHaveLength(1);
  });

  it('`resume()` rebasiert die Uhr – die Zeit im Hintergrund wird NICHT nachgerechnet', () => {
    const h = harness();
    h.loop.start();
    h.loop.pause();
    h.addNow(3600_000);                       // eine Stunde im Hintergrund
    h.loop.resume();
    expect(h.loop.paused()).toBe(false);
    expect(h.scheduled).toHaveLength(2);
    const stats = h.loop.pump();
    expect(stats.steps).toBe(0);
    expect(stats.dropped).toBe(0);            // nicht einmal verworfen – es lief keine Zeit auf
  });

  it('`resume()` BEHAELT den Akkumulator – ein angefangener Tick ist nicht verschenkt', () => {
    const h = harness();
    h.loop.start();
    h.setNow(TICK_MS * 0.9);
    h.loop.pump();                            // 0,9 Ticks liegen im Akkumulator
    h.loop.pause();
    h.addNow(3600_000);
    h.loop.resume();
    h.addNow(TICK_MS * 0.2);                  // 0,9 + 0,2 = 1,1 Ticks
    expect(h.loop.pump().steps).toBe(1);
  });

  it('`pause()`/`resume()` ohne laufende Schleife tun nichts', () => {
    const h = harness();
    h.loop.pause();
    h.loop.resume();
    expect(h.loop.paused()).toBe(false);
    expect(h.scheduled).toHaveLength(0);
    expect(h.cancelled).toEqual([]);
  });

  it('`resume()` ohne `pause()` plant nicht ein zweites Bild ein', () => {
    const h = harness();
    h.loop.start();
    h.loop.resume();
    expect(h.scheduled).toHaveLength(1);
  });

  it('`stop()` hebt den Pausenzustand auf', () => {
    const h = harness();
    h.loop.start();
    h.loop.pause();
    h.loop.stop();
    expect(h.loop.paused()).toBe(false);
    expect(h.loop.running()).toBe(false);
  });
});

describe('fixedLoop: advance', () => {
  it('rechnet die Ticks in EINEM Aufruf und zeichnet danach mit alpha = 1', () => {
    // `alpha = 1` ist der Kern der Sache: nur so ist "Mesh == Zustand nach n Ticks" wahr, und
    // genau so liest das E2E-Tor. Mit alpha 0 stand das Mesh einen Tick in der Vergangenheit.
    const h = harness();
    h.loop.advance(60);
    expect(h.ticks).toEqual([60]);
    expect(h.alphas).toEqual([1]);
  });

  it('umgeht den Fuenf-Schritt-Deckel – `advance(60)` rechnet 60 Ticks, nicht fuenf', () => {
    const h = harness();
    h.loop.advance(60);
    expect(h.ticks).toEqual([60]);
  });

  it('zeichnet auch bei 0 Ticks genau EIN Bild und rechnet nichts', () => {
    const h = harness();
    h.loop.advance(0);
    expect(h.ticks).toEqual([]);
    expect(h.alphas).toEqual([1]);
  });

  it('rechnet AUCH im Pausenzustand – `?clock=manual` haengt an nichts anderem', () => {
    const h = harness();
    h.loop.start();
    h.loop.pause();
    h.loop.advance(3);
    expect(h.ticks).toEqual([3]);
    expect(h.alphas).toEqual([1]);
  });

  it('meldet KEINE Bildstatistik – `onFrame` bleibt dem echten Bild vorbehalten', () => {
    // Sonst stuende in `FrameStats.steps` eine Zahl ueber MAX_STEPS_PER_FRAME, und der
    // dokumentierte Wertebereich waere eine Luege.
    const h = harness();
    h.loop.advance(60);
    expect(h.stats).toEqual([]);
  });

  it('beruehrt den Akkumulator nicht – das naechste echte Bild rechnet wie zuvor', () => {
    const h = harness();
    h.loop.pump();
    h.setNow(TICK_MS * 0.9);
    h.loop.pump();
    h.loop.advance(2);
    h.setNow(TICK_MS * 1.1);                  // 0,9 + 0,2 = 1,1 Ticks
    expect(h.loop.pump().steps).toBe(1);
  });

  it('uebergeht eine negative Tickzahl, statt `advance(-1)` weiterzureichen', () => {
    const h = harness();
    h.loop.advance(-1);
    expect(h.ticks).toEqual([]);
    expect(h.alphas).toEqual([1]);
  });
});

describe('fixedLoop: onFrame', () => {
  it('laeuft je Bild genau einmal und NACH `render`', () => {
    const order: string[] = [];
    let now = 0;
    const loop = createFixedLoop(
      {
        advance: () => { order.push('advance'); },
        render: () => { order.push('render'); },
        onFrame: () => { order.push('onFrame'); },
      },
      { now: () => now, requestFrame: () => 1, cancelFrame: () => {} },
    );
    loop.pump();
    now = TICK_MS;
    loop.pump();
    expect(order).toEqual(['render', 'onFrame', 'advance', 'render', 'onFrame']);
  });

  it('bekommt DASSELBE Objekt, das `pump()` zurueckgibt – und je Bild ein NEUES', () => {
    const h = harness();
    const first = h.loop.pump();
    const second = h.loop.pump();
    expect(h.stats[0]).toBe(first);
    expect(h.stats[1]).toBe(second);
    expect(first).not.toBe(second);
  });

  it('meldet cpuMs und frameMs aus der INJIZIERTEN Uhr', () => {
    // Die gestellte Uhr steht still, also sind beide 0 – geprueft wird, dass sie ueberhaupt aus
    // der injizierten Uhr kommen und nicht aus `performance.now()`.
    const h = harness();
    const stats = h.loop.pump();
    expect(stats.cpuMs).toBe(0);
    expect(stats.frameMs).toBe(0);
  });
});
