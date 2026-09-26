import type { FixedLoopClock } from '../../src/modes/fixedLoop';

/**
 * Uhr, rAF-Planer und Abbesteller von Hand – kein echtes `requestAnimationFrame`, keine echte Zeit,
 * keine Wartezeit.
 *
 * Sie stand wörtlich zweimal im Repo (`tests/unit/modes/fixedLoop.test.ts` und
 * `.../soloSession.test.ts`, Abschlussreview MIN-14); gemessen sind das auch die einzigen zwei
 * Stellen mit `requestFrame:`. Hier steht sie einmal, beide Harnesses bauen darauf auf.
 *
 * Gerechnet wird in den Tests immer in VIELFACHEN von `TICK_MS`: 1000/30 ist keine glatte Dualzahl,
 * und eine Erwartung wie „100 ms sind 3 Ticks" wäre um genau ein Bit falsch. Deshalb gibt es
 * `setNow` (absolute Zeitpunkte, bevorzugt) neben `addNow`.
 */
export interface FakeFrameClock {
  /** Zum Durchreichen an `createFixedLoop` bzw. `createSoloSession`. */
  clock: FixedLoopClock;
  /** Die bestellten, noch nicht ausgelösten rAF-Rückrufe – in der Reihenfolge der Bestellung. */
  scheduled: (() => void)[];
  /** Die Nummern, die `cancelFrame` bekommen hat (die Nummern zählen ab 1). */
  cancelled: number[];
  now(): number;
  /** ABSOLUTER Zeitpunkt – die genaue Form für Tickgrenzen. */
  setNow(value: number): void;
  addNow(delta: number): void;
}

export function fakeFrameClock(): FakeFrameClock {
  let now = 0;
  const scheduled: (() => void)[] = [];
  const cancelled: number[] = [];
  let nextHandle = 0;
  return {
    clock: {
      now: () => now,
      requestFrame: (run) => { scheduled.push(run); nextHandle += 1; return nextHandle; },
      cancelFrame: (handle) => { cancelled.push(handle); },
    },
    scheduled,
    cancelled,
    now: () => now,
    setNow(value: number) { now = value; },
    addNow(delta: number) { now += delta; },
  };
}
