// Render-Kadenz – REIN: keine Uhr, kein rAF, kein Babylon. Die Zeitstempel kommen von aussen
// (`src/modes/fixedLoop.ts` reicht die rAF-Abstände herein), damit die Tabelle in Vitest gepinnt
// werden kann. `engine.getFps()` wird NICHT benutzt: gemessen 60, während 132 Bilder je Sekunde
// gezeichnet wurden.

/** Zielrate des Spiels in Bildern je Sekunde. */
export const TARGET_HZ = 60;
/** So viele Bilder werden vor der Messung verworfen (Shader-Kompilat, erstes Layout). */
export const PANEL_WARMUP_FRAMES = 10;
/** So viele Abstände bilden den Median. */
export const PANEL_SAMPLE_FRAMES = 60;
/** Panel-Rate noch nicht gemessen – auch der Wert bei `?clock=manual`. */
export const PANEL_HZ_UNKNOWN = 0;
/**
 * Die optionale Halbierung aus M17 (`fpsLimit`); jeder andere Wert lässt den Teiler in Ruhe.
 *
 * RESERVIERT für M17 (Akku-/Budget-Schalter): die Produktion ruft `renderDivider` heute immer mit
 * EINEM Argument (`gameMain.ts`), der zweite Parameter hat also nur Tests als Abnehmer. Beides bleibt
 * stehen, weil die Tabelle mit Halbierung schon gepinnt ist und der Schalter genau hier andockt –
 * eine Kadenz-Entscheidung gehört nicht in zwei Module.
 */
export const FPS_LIMIT_HALF = 30;

/**
 * Bild-Teiler: `max(1, floor(panelHz / TARGET_HZ))`, mit `fpsLimit === FPS_LIMIT_HALF` verdoppelt.
 * `floor`, NICHT `round` (Q1): mit `round` ergäbe 90 Hz den Teiler 2 und damit 45 fps, und die Spec
 * will „90 ungedrosselt". Gepinnte Tabelle: 60/90/100 -> 1 · 120/137/144 -> 2 · 240 -> 4.
 * Eine noch nicht gemessene Panel-Rate (`PANEL_HZ_UNKNOWN`) drosselt NICHTS – auch nicht mit
 * `fpsLimit`: ohne gemessene Rate fehlt die Grundlage zum Halbieren.
 */
export function renderDivider(panelHz: number, fpsLimit?: number): number {
  if (!Number.isFinite(panelHz) || panelHz <= 0) return 1;
  const divider = Math.max(1, Math.floor(panelHz / TARGET_HZ));
  return fpsLimit === FPS_LIMIT_HALF ? divider * 2 : divider;
}

/**
 * Median über eine KOPIE (die Liste des Aufrufers bleibt in ihrer Reihenfolge); leere Liste -> 0,
 * gerade Länge -> Mittel der beiden Mittleren. `.toSorted` ist verboten (es-library-guard).
 */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const high = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return high;
  return ((sorted[mid - 1] ?? 0) + high) / 2;
}

/**
 * Panel-Rate aus rAF-Abständen: `1000 / Median`, auf eine Ganzzahl gerundet. Median <= 0 ->
 * `PANEL_HZ_UNKNOWN`. GEMESSEN: dieser PC 137 Hz (7,30 ms Median), Headless 60 Hz (16,80 ms).
 */
export function panelHzFromDeltas(deltas: readonly number[]): number {
  const median = medianOf(deltas);
  if (median <= 0) return PANEL_HZ_UNKNOWN;
  return Math.round(1000 / median);
}

export interface PanelMeter {
  /** Ein rAF-Abstand. Die ersten `warmup` Werte werden verworfen, danach zählt `sample` Werte. */
  push(deltaMs: number): void;
  /** `PANEL_HZ_UNKNOWN`, solange `ready()` false ist. */
  hz(): number;
  ready(): boolean;
  /** Nach `visibilitychange` -> sichtbar: Aufwärmen und Sammeln beginnen von vorn (Q1). */
  restart(): void;
}

export function createPanelMeter(warmup = PANEL_WARMUP_FRAMES, sample = PANEL_SAMPLE_FRAMES): PanelMeter {
  const deltas: number[] = [];
  let warmedUp = 0;
  let cached = PANEL_HZ_UNKNOWN;
  return {
    push(deltaMs: number): void {
      // Fertig gemessen: weiter zählen kostet nur Arbeit. Erst `restart()` sammelt neu.
      if (deltas.length >= sample) return;
      if (warmedUp < warmup) {
        warmedUp += 1;
        return;
      }
      deltas.push(deltaMs);
      if (deltas.length >= sample) cached = panelHzFromDeltas(deltas);
    },
    hz(): number {
      return cached;
    },
    ready(): boolean {
      return deltas.length >= sample;
    },
    restart(): void {
      deltas.length = 0;
      warmedUp = 0;
      cached = PANEL_HZ_UNKNOWN;
    },
  };
}
