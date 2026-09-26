import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Engine } from '@babylonjs/core/Engines/engine.pure';
import type { Scene } from '@babylonjs/core/scene.pure';
// TYP-Import aus dem IMPORTFREIEN Haken-Modul: kein Zyklus, und der Haken bleibt importfrei.
import type { MbStats } from '../modes/hook';
import { S } from '../ui/strings';

/** F3 schaltet das Overlay. Verdrahtet wird die Taste in `gameMain` – das Overlay hört nichts ab. */
export const OVERLAY_TOGGLE_CODE = 'F3';
/** Fenster des p95 in Bildern (bei 60 Hz also zwei Sekunden). */
export const P95_WINDOW = 120;
/**
 * Aufwärmfenster des GPU-Zählers in Bildern: `createDebugOverlay` zeigt `gpuMs` die ersten
 * GPU_PROBE_FRAMES Bilder lang als Strich, egal was der Zähler meldet – in diesen Bildern stecken
 * die Shader-Kompilate (gemessen 1542 ms für das erste kalte Bild), ein Wert daraus wäre Unsinn.
 * Nach dem Fenster gilt auch eine 0 als endgültig (Q2): GEMESSEN blieb
 * `gpuFrameTimeCounter.current` auch nach 396 Bildern 0 – unter SwiftShader (kein
 * `EXT_disjoint_timer_query_webgl2`) UND unter Intel/D3D11 (Erweiterung vorhanden). `gpuMs` wird
 * deshalb nur gezeigt, wenn der Wert größer 0 ist. Dieselbe Zahl ist der Anker für M8s Perf-Bank.
 */
export const GPU_PROBE_FRAMES = 60;

const MS_PER_NS = 1e-6;

/**
 * Rang des p95 in einer AUFSTEIGEND sortierten Liste von `count` Werten: nächstgrößerer Rang,
 * kein Interpolieren. `count <= 0` -> -1 (kein Wert). GEMESSEN für count = 1 … 400: `ceil(0.95 * n)`
 * und `ceil(19 * n / 20)` stimmen überall überein – die Fließkomma-Schreibweise ist hier
 * unbedenklich.
 */
function rank95(count: number): number {
  return count <= 0 ? -1 : Math.ceil(0.95 * count) - 1;
}

/** REIN: p95 über eine KOPIE, die Liste des Aufrufers bleibt unangetastet. Leer -> 0. */
export function percentile95(samples: readonly number[]): number {
  const rank = rank95(samples.length);
  if (rank < 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[rank] ?? 0;
}

export interface Percentiles {
  push(value: number): void;
  p95(): number;
  reset(): void;
}

/**
 * Ringpuffer der letzten `window` Werte. Er allokiert einmal beim Bauen und dann nie wieder: der
 * Puffer ist ein `Float64Array`, die Sortierfläche ein festes `number[]`, das je Abfrage nur neu
 * gefüllt wird. Ohne diese Vorsorge legte ein Overlay je Bild eine Kopie an.
 */
export function createPercentiles(window: number = P95_WINDOW): Percentiles {
  // LAUT abweisen, nicht klemmen: `Math.max(1, Math.floor(NaN))` ist NaN, und
  // `new Float64Array(NaN).length` ist 0 – der Ring verschluckte dann jeden Wert und meldete für
  // immer 0 (gemessen an 200 Werten). Ein p95, der still zur Dauer-Null wird, ist schlimmer als ein
  // Wurf beim Bauen; dasselbe Argument steht bei `gpuMs` (Q2). `Infinity` warf schon vorher, nur mit
  // dem Text der Typed-Array-Länge statt mit einer eigenen Aussage.
  if (!Number.isFinite(window)) {
    throw new RangeError(`createPercentiles: Fenster erwartet eine endliche Zahl, bekam ${String(window)}`);
  }
  const size = Math.max(1, Math.floor(window));
  const ring = new Float64Array(size);
  const scratch: number[] = [];
  let count = 0;
  let next = 0;
  return {
    push(value: number): void {
      ring[next] = value;
      next = (next + 1) % size;
      if (count < size) count += 1;
    },
    p95(): number {
      const rank = rank95(count);
      if (rank < 0) return 0;
      scratch.length = 0;
      // Die Reihenfolge im Ring ist nach dem Überlauf gedreht – das ist gleichgültig, es wird
      // ohnehin sortiert. Gelesen werden genau die `count` beschriebenen Plätze.
      for (let index = 0; index < count; index += 1) scratch.push(ring[index] ?? 0);
      scratch.sort((a, b) => a - b);
      return scratch[rank] ?? 0;
    },
    reset(): void {
      count = 0;
      next = 0;
    },
  };
}

export interface Instrumentation {
  /** `SceneInstrumentation.drawCallsCounter.current` – NACH `scene.render()` lesen (je Bild genullt). */
  drawCalls(): number;
  /** `scene.getActiveIndices() / 3`; unter `NullEngine` immer 0, weil dort nichts rastert. */
  triangles(): number;
  /** 0, solange `gpuFrameTimeCounter.current` 0 bleibt – siehe GPU_PROBE_FRAMES. */
  gpuMs(): number;
  dispose(): void;
}

/**
 * Verdrahtet die beiden Babylon-Zähler. Die Nebenwirkungs-Importe dafür
 * (`Engines/Extensions/engine.query` und `Engines/AbstractEngine/abstractEngine.timeQuery`) stehen in
 * `src/render/babylonRegistry.ts` und kommen über `src/render/engine.ts` in die Seite. OHNE sie
 * WIRFT die Zeile `captureGPUFrameTime = true` zur Laufzeit („captureGPUFrameTime is not a function") –
 * kein Build- und kein Typfehler. Hier wird ABSICHTLICH nicht gefangen: ein fehlender
 * Nebenwirkungs-Import soll laut auffallen (das Fehler-Panel zeigt ihn), statt still eine Null zu
 * melden. Genau daran starb der erste Prototyp-Lauf.
 */
export function createInstrumentation(engine: Engine, scene: Scene): Instrumentation {
  const engineMeter = new EngineInstrumentation(engine);
  engineMeter.captureGPUFrameTime = true;
  const sceneMeter = new SceneInstrumentation(scene);
  return {
    drawCalls: (): number => sceneMeter.drawCallsCounter.current,
    triangles: (): number => Math.round(scene.getActiveIndices() / 3),
    gpuMs: (): number => {
      // Der Zähler liefert NANOsekunden.
      const nanos = engineMeter.gpuFrameTimeCounter.current;
      return nanos > 0 ? nanos * MS_PER_NS : 0;
    },
    dispose: (): void => {
      sceneMeter.dispose();
      engineMeter.dispose();
    },
  };
}

interface Row { label: string; value: string }

/** Ganzzahl; alles, was keine endliche Zahl ist, wird zum Strich – nie „NaN“ auf dem Bildschirm. */
function integer(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : S.debug.none;
}

/** Zeit in Millisekunden mit zwei Stellen; die EINHEIT steht im Bezeichner (`S.debug.frameMs`). */
function millis(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : S.debug.none;
}

/** Die Stufe kommt als nackter String aus dem importfreien Haken – ein Tippfehler wird zum Strich. */
function tierLabel(tier: string): string {
  if (tier === 'low') return S.debug.tierLow;
  if (tier === 'medium') return S.debug.tierMedium;
  if (tier === 'high') return S.debug.tierHigh;
  return S.debug.none;
}

/**
 * REIN: der ganze Text des Overlays. Die BEZEICHNER kommen aus `S.debug.*` (Q3), die ZAHLENFORMATE
 * stehen hier. Die Spaltenbreite wird aus den Bezeichnern GERECHNET, nicht gepinnt – so bleibt die
 * Tafel ausgerichtet, wenn ein Text in `strings.ts` länger wird.
 */
export function formatOverlay(stats: MbStats): string {
  const rows: readonly Row[] = [
    { label: S.debug.tick, value: integer(stats.tick) },
    { label: S.debug.fps, value: integer(stats.fps) },
    { label: S.debug.panelHz, value: stats.panelHz > 0 ? integer(stats.panelHz) : S.debug.none },
    { label: S.debug.frameMs, value: millis(stats.frameMs) },
    { label: S.debug.cpuP95, value: millis(stats.cpuMsP95) },
    { label: S.debug.gpuMs, value: stats.gpuMs > 0 ? millis(stats.gpuMs) : S.debug.none },
    { label: S.debug.drawCalls, value: integer(stats.drawCalls) },
    { label: S.debug.triangles, value: integer(stats.triangles) },
    { label: S.debug.tickRate, value: integer(stats.tickRate) },
    { label: S.debug.steps, value: integer(stats.steps) },
    { label: S.debug.tier, value: tierLabel(stats.tier) },
    // `storage` und `buildId` sind technische Kennungen ('idb'/'memory', Kurz-SHA) – sie stehen so im
    // Haken und werden hier nur zitiert, nicht übersetzt.
    { label: S.debug.storage, value: stats.storage },
    { label: S.debug.build, value: stats.buildId },
  ];
  let width = 0;
  for (const row of rows) if (row.label.length > width) width = row.label.length;
  const lines: string[] = [S.debug.title];
  for (const row of rows) lines.push(`${row.label.padEnd(width, ' ')}  ${row.value}`);
  return lines.join('\n');
}

export interface DebugOverlay {
  visible(): boolean;
  setVisible(visible: boolean): void;
  /** Liefert den NEUEN Zustand – `gameMain` schreibt ihn in die Einstellungen. */
  toggle(): boolean;
  update(stats: MbStats): void;
  dispose(): void;
}

/**
 * Ein `<pre class="debug-overlay">` über der Leinwand (Stil in `src/ui/shell.css`, T6:
 * `position: fixed`, `pointer-events: none`). Es hört selbst nichts ab – F3 verdrahtet `gameMain`,
 * damit es genau EINEN Tastaturweg auf der Seite gibt.
 */
export function createDebugOverlay(host: HTMLElement): DebugOverlay {
  const pre = document.createElement('pre');
  pre.className = 'debug-overlay';
  pre.dataset['testid'] = 'debug-overlay';
  pre.hidden = true;
  host.append(pre);
  let shown = false;
  let last = '';
  /** Bilder seit dem Bauen – gezählt werden ALLE `update`-Aufrufe, auch die verborgenen. */
  let frames = 0;

  function setVisible(visible: boolean): void {
    shown = visible;
    pre.hidden = !visible;
  }

  return {
    visible: (): boolean => shown,
    setVisible,
    toggle: (): boolean => {
      setVisible(!shown);
      return shown;
    },
    update: (stats: MbStats): void => {
      // ERST zählen, dann der Sparweg: das Aufwärmfenster des GPU-Zählers hängt an BILDERN, nicht
      // an sichtbaren Bildern – sonst wärmte ein F3 nach zehn Minuten noch einmal 60 Bilder auf.
      if (frames <= GPU_PROBE_FRAMES) frames += 1;
      // Verborgen kostet das Overlay nichts: kein Formatieren, kein Schreiben in den DOM.
      if (!shown) return;
      // Im Aufwärmfenster wird `gpuMs` auf 0 gesetzt, und `formatOverlay` macht daraus den Strich
      // (Q2). Die Kopie fällt nur in diesen höchstens GPU_PROBE_FRAMES Bildern an; danach geht das
      // Objekt des Aufrufers unverändert durch, und je Bild wird nichts mehr allokiert.
      const text = formatOverlay(frames <= GPU_PROBE_FRAMES ? { ...stats, gpuMs: 0 } : stats);
      // Gleicher Text -> kein Schreiben: `textContent` wirft sonst je Bild einen Layout-Lauf an.
      if (text === last) return;
      pre.textContent = text;
      last = text;
    },
    dispose: (): void => {
      pre.remove();
    },
  };
}
