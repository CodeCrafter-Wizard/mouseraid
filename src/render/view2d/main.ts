/**
 * Verdrahtung der Entwickler-Ansicht `?view=2d`: laden, bauen, zeichnen, Haken, Tastatur, Schleife,
 * Raum-Ausschnitt.
 *
 * Das ist die Stelle, die M5 durch `src/modes/soloSession` + `src/modes/fixedLoop` ersetzt. Sie
 * ist auch die erste Stelle im Projekt, die JSON-Dateien importiert – der Kern tut das nie (D12),
 * er bekommt sie hier als `unknown` in die Loader gereicht.
 */
import balanceJson from '../../data/balance.json';
import levelJson from '../../data/levels/feinkost.json';
import { loadBalance } from '../../core/data/balanceLoad';
import type { Balance } from '../../core/data/balanceTypes';
import type { GameEvent } from '../../core/sim/events';
import { hashState } from '../../core/sim/hash';
import type { InputFrame } from '../../core/sim/input';
import { MAX_PLAYERS, createInitialState } from '../../core/sim/state';
import type { StepContext, WorldState } from '../../core/sim/state';
import { step } from '../../core/sim/step';
import { buildLevelRuntime } from '../../core/world/levelRuntime';
import type { LevelRuntime } from '../../core/world/levelRuntime';
import { loadLevel } from '../../core/world/levelLoad';
import type { LevelDef } from '../../core/world/levelTypes';
import { createKeyboard } from '../../input/keyboard';
import { VIEW_MARGIN_PX, fitLevel, fitRoom, levelBounds, worldToScreen } from './camera2d';
import type { ScreenPoint, View2d } from './camera2d';
import { drawFrame, layerText, parseLayers } from './draw';
import type { LayerMask } from './draw';
import { MAX_ADVANCE, installHook } from './hook';
import type { MbHook, MbStats } from './hook';
import { createLoop } from './loop';

export const DEFAULT_WIDTH = 960;
export const DEFAULT_HEIGHT = 720;
/** Als ZEICHENKETTE: `seedRng` hasht den Saat-TEXT, `seedRng('1')` und `seedRng(1)` sind gleich. */
export const DEFAULT_SEED = '1';

/** Die Saat der injizierten Fixtures ist fest 1 – der Golden-Fall hat die Saat 1, und ein zweiter
 *  Weg, sie zu setzen, waere eine zweite Stelle, an der Node und Browser auseinanderlaufen. */
const FIXTURE_SEED = 1;
const MIN_SIZE = 64;
const MAX_SIZE = 4096;

interface StickyInput { mx: number; mz: number; buttons: number }

function readSize(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < MIN_SIZE || value > MAX_SIZE) return fallback;
  return value;
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${path}: endliche Zahl erwartet, bekam ${String(value)}`);
  }
  return value;
}

/**
 * Grenzen des DRAHTFORMATS: `packInput` schreibt `mx`/`mz` als i8 und `buttons` als ein Byte.
 * Geprueft wird hier, aus demselben Grund wie bei `advance`: `setInput(0, NaN, 0, 0)` fiel sonst erst
 * Ticks spaeter als `NaNError` aus `hashState` auf – weit weg von der Ursache –, und ein nicht
 * ganzzahliges `buttons` setzte gar kein Bit und fiel gar nicht auf.
 */
function needAxis(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -127 || value > 127) {
    throw new RangeError(`setInput: ${name} erwartet eine ganze Zahl in [-127, 127], bekam ${String(value)}`);
  }
}

function hex2(value: number | undefined): string {
  const byte = value === undefined ? 0 : value;
  return byte < 16 ? `0${byte.toString(16)}` : byte.toString(16);
}

function countEdges(runtime: LevelRuntime): number {
  let sum = 0;
  for (const list of runtime.nav.adjacency) sum += list.length;
  return sum / 2;
}

function countActive(state: WorldState): number {
  let sum = 0;
  for (const player of state.players) {
    if (player.active) sum += 1;
  }
  return sum;
}

/**
 * Haengt die Ansicht unter die Huelle. Reihenfolge: Daten laden -> Runtime -> Zustand -> Leinwand
 * -> erstes Bild -> Haken -> Tastatur -> Schleife (ausser bei `?clock=manual`).
 *
 * URL-Parameter, nur Entwicklung und Tests: `?clock=manual`, `?w=`/`?h=` (Vorgabe 960x720),
 * `?layers=`, `?seed=` (Vorgabe '1') und `?room=<id>` (Raum-Ausschnitt; ein unbekannter Name faellt
 * still auf das ganze Level zurueck – eine Lesehilfe darf keinen Fehler werfen).
 * KEIN `?validate=1`: `validateLevel` bleibt aus dem Bundle.
 */
export function mountView2d(stage: HTMLElement, search: URLSearchParams): void {
  const width = readSize(search.get('w'), DEFAULT_WIDTH);
  const height = readSize(search.get('h'), DEFAULT_HEIGHT);
  const roomId = search.get('room');

  /**
   * EINE Einpass-Regel fuer die Vorgabe UND fuer `cmd.loadFixtures`: nennt `?room=` einen Raum
   * dieses Levels, wird dessen Grenzen eingepasst, sonst die Huelle. Zwei getrennte Regeln waeren
   * zwei Stellen, an denen die injizierte Fixture und die Vorgabe auseinanderlaufen koennten.
   * Das Mini-Level hat bewusst ebenfalls einen Raum `verkaufsraum` – `?room=verkaufsraum` gilt
   * damit fuer beide Level, und ein Test haelt das fest.
   */
  function fitFor(current: LevelDef): View2d {
    if (roomId !== null) {
      for (const room of current.rooms) {
        if (room.id === roomId) return fitRoom(room.bounds, width, height);
      }
    }
    return fitLevel(levelBounds(current), width, height, VIEW_MARGIN_PX);
  }

  let level: LevelDef = loadLevel(levelJson);
  let balance: Balance = loadBalance(balanceJson);
  let runtime: LevelRuntime = buildLevelRuntime(level, balance);
  let state: WorldState = createInitialState(level, balance, search.get('seed') ?? DEFAULT_SEED);
  let stepCtx: StepContext = { balance, level, colliders: runtime.colliders };
  let view: View2d = fitFor(level);
  let layers: LayerMask = parseLayers(search.get('layers'));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // `willReadFrequently: true`, weil `cmd.pixelAt` je Probe `getImageData` ruft – dafuer ist das
  // Flag gemacht. GEMESSEN (M4, vier Flag-Kombinationen in zwei Reihenfolgen): die einmaligen
  // ~1,4–1,5 s des Software-Rasterizers im kalten Chromium beseitigt es NICHT – sie treffen immer
  // die erste Zeichnung, egal mit welchen Flags, und sie sind NICHT streng je Prozess (ein zweiter,
  // unmittelbar danach gestarteter Prozess zahlte 1,8 ms). Dauerkosten hat das Flag keine
  // (`cmd.benchDraw`-Mittel 0,06–0,07 ms je Bild), und ein Pixel aendert es nicht. Die Messreihe
  // selbst steht in `docs/decisions.md` – hier steht bewusst keine zweite, driftende Kopie.
  const maybeCtx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (maybeCtx === null) throw new Error('Canvas-2D-Kontext nicht verfuegbar');
  // Eigene Bindung mit festem Typ: eine Verengung von `null` haelt der Uebersetzer nicht bis in
  // die Rueckrufe unten durch (`draw`, `benchDraw`, `pixelAt` werden erst spaeter aufgerufen).
  const ctx: CanvasRenderingContext2D = maybeCtx;
  stage.append(canvas);

  const keyboard = createKeyboard();
  const events: GameEvent[] = [];
  const sticky: StickyInput[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) sticky.push({ mx: 0, mz: 0, buttons: 0 });
  const frames: InputFrame[] = [];
  const probe: ScreenPoint = { sx: 0, sy: 0 };
  let drawMs = 0;

  function draw(): void {
    const started = performance.now();
    drawFrame(ctx, view, runtime, state, layers);
    drawMs = performance.now() - started;
  }

  function advanceTicks(ticks: number): void {
    for (let i = 0; i < ticks; i += 1) {
      frames.length = 0;
      for (let slot = 0; slot < sticky.length; slot += 1) {
        const held = sticky[slot];
        if (held === undefined) continue;
        frames.push({ seq: 0, tick: state.tick, mx: held.mx, mz: held.mz, buttons: held.buttons });
      }
      // Die Tastatur ueberschreibt Platz 0 NUR, wenn sie nicht ruht – sonst wischte sie in einem
      // Playwright-Lauf jeden `setInput(0, ...)` im naechsten Tick weg.
      if (!keyboard.idle()) frames[0] = keyboard.frame(state.tick, 0);
      step(state, frames, stepCtx, events);
      events.length = 0;
    }
  }

  function benchDraw(...args: unknown[]): unknown {
    const count = asNumber(args[0], 'benchDraw(frames)');
    if (!Number.isInteger(count) || count < 1 || count > 10000) {
      throw new RangeError(`benchDraw erwartet eine ganze Zahl in [1, 10000], bekam ${count}`);
    }
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (let i = 0; i < count; i += 1) {
      const started = performance.now();
      drawFrame(ctx, view, runtime, state, layers);
      const spent = performance.now() - started;
      sum += spent;
      if (spent < min) min = spent;
      if (spent > max) max = spent;
      // `drawMs` ist laut `hook.ts` die Dauer des LETZTEN Bildes – also die des letzten Durchlaufs
      // und NICHT das Maximum der Serie. Mittel und Streuung liefert der Rueckgabewert hier.
      drawMs = spent;
    }
    return { frames: count, meanMs: sum / count, minMs: min, maxMs: max };
  }

  /** Farbe an einem WELT-Punkt – die Naht, mit der der Tor-Spec prueft, ohne `worldToScreen` zu
   *  verdoppeln. Gelesen wird aus dem Puffer der Leinwand, unabhaengig von jeder CSS-Groesse. */
  function pixelAt(...args: unknown[]): unknown {
    worldToScreen(view, asNumber(args[0], 'pixelAt(x)'), asNumber(args[1], 'pixelAt(z)'), probe);
    const px = Math.min(canvas.width - 1, Math.max(0, Math.round(probe.sx)));
    const py = Math.min(canvas.height - 1, Math.max(0, Math.round(probe.sy)));
    const data = ctx.getImageData(px, py, 1, 1).data;
    return `#${hex2(data[0])}${hex2(data[1])}${hex2(data[2])}`;
  }

  /**
   * Baut die Ansicht aus INJIZIERTEN Daten neu auf – die Naht, mit der der Tor-Spec die
   * eingefrorenen Fixtures in die Seite bringt, statt sie ins Bundle zu nehmen. Danach ist die
   * Seite bitgleich in demselben Zustand wie ein frischer Golden-Lauf in Vitest.
   */
  function loadFixtures(...args: unknown[]): unknown {
    level = loadLevel(args[0]);
    balance = loadBalance(args[1]);
    runtime = buildLevelRuntime(level, balance);
    stepCtx = { balance, level, colliders: runtime.colliders };
    state = createInitialState(level, balance, FIXTURE_SEED);
    view = fitFor(level);
    for (const held of sticky) {
      held.mx = 0;
      held.mz = 0;
      held.buttons = 0;
    }
    draw();
    return undefined;
  }

  const hook: MbHook = {
    advance(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_ADVANCE) {
        throw new RangeError(`advance erwartet eine ganze Zahl in [0, ${MAX_ADVANCE}], bekam ${ticks}`);
      }
      advanceTicks(ticks);
      draw();
      return state.tick;
    },
    tick: () => state.tick,
    hash: () => hashState(state),
    stats(): MbStats {
      return {
        tick: state.tick,
        players: countActive(state),
        colliders: runtime.colliders.length,
        navPoints: runtime.nav.points.length,
        navEdges: countEdges(runtime),
        drawMs,
      };
    },
    cmd: { benchDraw, pixelAt, loadFixtures },
    setInput(slot, mx, mz, buttons) {
      const held = sticky[slot];
      if (held === undefined) throw new RangeError(`setInput: Platz ${slot} gibt es nicht`);
      needAxis(mx, 'mx');
      needAxis(mz, 'mz');
      if (!Number.isInteger(buttons) || buttons < 0 || buttons > 255) {
        throw new RangeError(`setInput: buttons erwartet eine ganze Zahl in [0, 255], bekam ${String(buttons)}`);
      }
      held.mx = mx;
      held.mz = mz;
      held.buttons = buttons;
    },
    layers(spec) {
      if (spec !== undefined) {
        layers = parseLayers(spec);
        draw();
      }
      return layerText(layers);
    },
  };

  draw();
  installHook(hook);

  window.addEventListener('keydown', (event) => {
    if (keyboard.onKeyDown(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (keyboard.onKeyUp(event.code)) event.preventDefault();
  });
  // Ohne Fokus kommt kein `keyup` mehr an: eine gehaltene Taste bliebe fuer immer gehalten und die
  // Maus liefe weiter. BEIDE Ereignisse, weil sie verschiedene Faelle treffen – `blur` den
  // Fensterwechsel, `visibilitychange` den Tab-Wechsel und den gesperrten Bildschirm.
  window.addEventListener('blur', () => { keyboard.reset(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') keyboard.reset();
  });

  const loop = createLoop({
    advance: advanceTicks,
    draw,
    now: () => performance.now(),
    schedule: (run) => window.requestAnimationFrame(run),
    cancel: (handle) => { window.cancelAnimationFrame(handle); },
  });
  // `?clock=manual`: die Schleife wird gebaut, aber NIE gestartet – gerechnet wird nur ueber
  // `__mb.advance`, damit ein Playwright-Lauf ohne Wartezeit deterministisch bleibt.
  if (search.get('clock') !== 'manual') loop.start();
}
