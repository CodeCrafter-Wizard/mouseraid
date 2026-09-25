/**
 * Minimale Schleife mit festem Schritt fuer die Entwickler-Ansicht.
 *
 * AUSDRUECKLICH VORLAEUFIG: M5 ersetzt dieses Modul durch `src/modes/fixedLoop.ts` (injizierbare
 * Uhr, Interpolation, `visibilitychange`). Es steht hier, weil eine Ansicht ohne Schleife nichts
 * zeigt – wer hier Interpolation oder Kamera-Relativitaet einbaut, baut M5 zweimal.
 */
import { TICK_MS } from '../../core/sim/tick';

/** Mehr Schritte je Bild holen die Simulation nicht ein, sie machen den Ruckler nur laenger. */
export const MAX_STEPS_PER_FRAME = 5;
/** Ein Tab-Wechsel darf keine Stunde nachrechnen. */
export const FRAME_CLAMP_MS = 250;

export interface LoopHooks {
  advance(ticks: number): void;
  draw(): void;
  /** Uhr – injiziert, damit der Test ohne rAF und ohne Warten laeuft. */
  now(): number;
  schedule(run: () => void): number;
  cancel(handle: number): void;
}

export interface Loop { start(): void; stop(): void; running(): boolean; pump(): number }

export function createLoop(hooks: LoopHooks): Loop {
  let handle = 0;
  let active = false;
  let last = 0;
  let accumulator = 0;

  /**
   * Rechnet GENAU EINEN Frame und liefert die Zahl der gerechneten Ticks – so prueft der Test den
   * Deckel und die Klammer ohne echte Uhr. Der Rest bleibt im Akkumulator; ein verworfener Rest
   * liesse die Simulation gegenueber der Wanduhr dauerhaft zuruecklaufen.
   */
  function pump(): number {
    const now = hooks.now();
    let delta = now - last;
    last = now;
    // Eine rueckwaerts laufende oder noch nicht gesetzte Uhr darf keine negative Zeit einbringen.
    if (!(delta > 0)) delta = 0;
    if (delta > FRAME_CLAMP_MS) delta = FRAME_CLAMP_MS;
    accumulator += delta;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      accumulator -= TICK_MS;
      steps += 1;
    }
    if (steps > 0) hooks.advance(steps);
    hooks.draw();
    return steps;
  }

  function frame(): void {
    if (!active) return;
    pump();
    handle = hooks.schedule(frame);
  }

  return {
    start() {
      if (active) return;
      active = true;
      // Die erste Zeitdifferenz ist 0, nicht "seit dem Seitenstart" – sonst holte der erste Frame
      // sofort den Deckel ein.
      last = hooks.now();
      accumulator = 0;
      handle = hooks.schedule(frame);
    },
    stop() {
      if (!active) return;
      active = false;
      hooks.cancel(handle);
      handle = 0;
    },
    running: () => active,
    pump,
  };
}
