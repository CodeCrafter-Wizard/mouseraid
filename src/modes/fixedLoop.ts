/**
 * Schleife mit festem Simulationsschritt – REIN, mit injizierter Uhr und injiziertem rAF.
 *
 * Dieses Modul kennt KEIN DOM. `visibilitychange` verdrahtet der Aufrufer und ruft `pause()` bzw.
 * `resume()`; der gemessene Grund steht in `src/render/view2d/main.ts`: der Hörer hing dort an
 * `window` und feuerte deshalb nie. Eine Schleife, die selbst am Dokument hängt, wäre in Vitest im
 * Node-Umfeld gar nicht prüfbar – und genau deshalb steht sie hier und nicht in `src/render`.
 *
 * Sie ersetzt `src/render/view2d/loop.ts` aus M4: gleiche Idee, aber mit `alpha` für die
 * Interpolation, mit gezählten verworfenen Ticks, mit `pause`/`resume` und mit dem Kadenz-Teiler.
 */
import { TICK_MS } from '../core/sim/tick';

/** Mehr Schritte je Bild holen die Simulation nicht ein, sie machen den Ruckler nur länger. */
export const MAX_STEPS_PER_FRAME = 5;
/** Ein Tab-Wechsel darf keine Stunde nachrechnen. */
export const FRAME_CLAMP_MS = 250;

export interface FrameStats {
  /** GEKLEMMTE Zeitdifferenz dieses Bildes (0 … FRAME_CLAMP_MS). */
  deltaMs: number;
  /** Gerechnete Ticks, 0 … MAX_STEPS_PER_FRAME. */
  steps: number;
  /** Verworfene Ticks – LAUFENDE Summe über die Sitzung, nicht die dieses Bildes. */
  dropped: number;
  /** `accumulator / TICK_MS`, geklemmt auf [0, 1]. */
  alpha: number;
  /** `false`, wenn der Kadenz-Teiler dieses Bild übersprungen hat. */
  rendered: boolean;
  /** Zeit VOR `render` – nur mit der injizierten Uhr gemessen. */
  cpuMs: number;
  /** Zeit einschließlich `render`. */
  frameMs: number;
}

export interface FixedLoopHooks {
  /** `ticks` Simulationsschritte, KEIN Bild. */
  advance(ticks: number): void;
  /** Genau EIN Bild, mit dem Mischanteil zwischen den beiden letzten Ticks. */
  render(alpha: number): void;
  /** Die Naht für Overlay und `stats()` – läuft NACH `render`, damit `frameMs` es einschließt. */
  onFrame(stats: FrameStats): void;
}

export interface FixedLoopClock {
  now(): number;
  requestFrame(run: () => void): number;
  cancelFrame(handle: number): void;
}

export interface FixedLoop {
  /** Uhr NEU setzen, Akkumulator auf 0, rAF planen. Doppelter Aufruf tut nichts. */
  start(): void;
  /** rAF abbestellen; `running()` false. Ein späteres `start()` setzt frisch auf. */
  stop(): void;
  running(): boolean;
  /** rAF abbestellen, Akkumulator BEHALTEN; `running()` bleibt true. */
  pause(): void;
  /** Uhr NEU setzen (die Zeit im Hintergrund wird NICHT nachgerechnet), planen. */
  resume(): void;
  paused(): boolean;
  /** Genau EIN Bild ohne rAF – die Testnaht. Bei `paused()`: `steps` 0, `rendered` false. */
  pump(): FrameStats;
  /** `?clock=manual`: `ticks` Ticks, danach EIN Bild mit `alpha = 1`. */
  advance(ticks: number): void;
  /** Aus `renderDivider`; kleiner als 1 wird auf 1 geklemmt. */
  setDivider(divider: number): void;
  divider(): number;
}

/** Ein Teiler ist eine ganze Zahl ab 1; alles andere (0, −3, NaN, 1,5) wird geklemmt. */
function clampDivider(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const floored = Math.floor(value);
  return floored < 1 ? 1 : floored;
}

export function createFixedLoop(hooks: FixedLoopHooks, clock: FixedLoopClock, divider = 1): FixedLoop {
  let handle = 0;
  let active = false;
  let halted = false;
  let last = 0;
  let accumulator = 0;
  let dropped = 0;
  let frameIndex = 0;
  let step = clampDivider(divider);

  /** Der Mischanteil zum aktuellen Akkumulator – der Rest ist nach `pump` immer unter TICK_MS. */
  function alphaNow(): number {
    const raw = accumulator / TICK_MS;
    if (!(raw > 0)) return 0;
    return raw > 1 ? 1 : raw;
  }

  /**
   * Rechnet GENAU EIN Bild und liefert die Zahlen dieses Bildes.
   *
   * Der Rückgabewert ist ein FRISCHES Objekt je Bild und kein wiederverwendetes: ein gemeinsames,
   * je Bild überschriebenes Objekt hätte eine Reihe gesammelter `FrameStats` in einem Test lautlos
   * alle gleich gemacht. Sieben Zahlen je Bild sind die Kosten dafür.
   */
  function pump(): FrameStats {
    if (halted) {
      // Pausiert läuft KEINE Zeit auf und fällt KEIN Bild – nur so ist „nach dem Tab-Wechsel
      // rechnet nichts nach" überhaupt eine Aussage.
      return { deltaMs: 0, steps: 0, dropped, alpha: alphaNow(), rendered: false, cpuMs: 0, frameMs: 0 };
    }
    const started = clock.now();
    let delta = started - last;
    last = started;
    // Eine rückwärts laufende oder noch nicht gesetzte Uhr darf keine negative Zeit einbringen.
    if (!(delta > 0)) delta = 0;
    if (delta > FRAME_CLAMP_MS) delta = FRAME_CLAMP_MS;
    accumulator += delta;

    let steps = 0;
    while (accumulator >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      accumulator -= TICK_MS;
      steps += 1;
    }
    // Der ÜBERSCHUSS oberhalb des Deckels wird verworfen und GEZÄHLT; der Rest unter TICK_MS bleibt
    // im Akkumulator (ein verworfener Rest liesse die Simulation dauerhaft hinter der Wanduhr
    // zurückfallen). Ohne das Verwerfen liefen nach einem Zeitsprung mehrere Bilder am Deckel.
    while (accumulator >= TICK_MS) {
      accumulator -= TICK_MS;
      dropped += 1;
    }

    const rendered = frameIndex % step === 0;
    frameIndex += 1;
    const alpha = alphaNow();
    if (steps > 0) hooks.advance(steps);
    const cpuMs = clock.now() - started;
    if (rendered) hooks.render(alpha);
    const stats: FrameStats = {
      deltaMs: delta, steps, dropped, alpha, rendered, cpuMs, frameMs: clock.now() - started,
    };
    hooks.onFrame(stats);
    return stats;
  }

  function frame(): void {
    if (!active || halted) return;
    pump();
    handle = clock.requestFrame(frame);
  }

  return {
    start() {
      if (active) return;
      active = true;
      halted = false;
      // Die erste Zeitdifferenz ist 0, nicht „seit dem Seitenstart" – sonst holte das erste Bild
      // sofort den Deckel ein.
      last = clock.now();
      accumulator = 0;
      frameIndex = 0;
      handle = clock.requestFrame(frame);
    },

    stop() {
      if (!active) return;
      active = false;
      halted = false;
      clock.cancelFrame(handle);
      handle = 0;
    },

    running: () => active,

    pause() {
      if (!active || halted) return;
      halted = true;
      clock.cancelFrame(handle);
      handle = 0;
    },

    resume() {
      if (!active || !halted) return;
      halted = false;
      // NUR die Uhr wird rebasiert, der Akkumulator bleibt: die Zeit im Hintergrund wird nicht
      // nachgerechnet, der angefangene Tick aber auch nicht verschenkt. Genau das trennt `resume`
      // von `start`.
      last = clock.now();
      frameIndex = 0;
      handle = clock.requestFrame(frame);
    },

    paused: () => halted,

    pump,

    advance(ticks: number) {
      // Rechnet AUCH im Pausenzustand und ohne Deckel: das ist der Weg von `?clock=manual`, und ein
      // `advance(60)` soll 60 Ticks rechnen, nicht fünf. Gezeichnet wird mit `alpha = 1`, damit
      // „Mesh == Zustand nach n Ticks" wahr ist – genau so liest es das E2E-Tor.
      if (ticks > 0) hooks.advance(ticks);
      hooks.render(1);
    },

    setDivider(value: number) {
      step = clampDivider(value);
    },

    divider: () => step,
  };
}
