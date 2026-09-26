/**
 * Solo-Partie: laden, rechnen, Schnappschüsse tauschen – ohne DOM und ohne Babylon.
 *
 * Das ist die Logik, die in M4 in `src/render/view2d/main.ts` zwischen Leinwand und Tastatur
 * eingeklemmt war. Hier steht sie allein, und genau deshalb ist sie in Vitest im Node-Umfeld
 * prüfbar: `src/modes` kennt weder `src/render` noch Babylon, und ESLint erzwingt das – statisch wie
 * dynamisch (`tests/node/eslint-boundaries.test.ts`). Aus `src/platform` importiert dieses Modul
 * heute nichts; das ist Absicht, aber keine erzwungene Grenze (die Schicht darf es).
 *
 * Der Kern liest nie eine Datei (D12): `levelJson` und `balanceJson` kommen als `unknown` herein
 * und gehen unverändert in die Loader.
 */
import { loadBalance } from '../core/data/balanceLoad';
import type { Balance } from '../core/data/balanceTypes';
import type { GameEvent } from '../core/sim/events';
import { hashState } from '../core/sim/hash';
import type { InputFrame } from '../core/sim/input';
import { MAX_PLAYERS, createInitialState } from '../core/sim/state';
import type { StepContext, WorldState } from '../core/sim/state';
import { step } from '../core/sim/step';
import { createSnapshot, makeSlowView, snapshotFast } from '../core/sim/views';
import type { RenderView } from '../core/sim/views';
import { loadLevel } from '../core/world/levelLoad';
import type { LevelDef } from '../core/world/levelTypes';
import { buildLevelRuntime } from '../core/world/levelRuntime';
import type { LevelRuntime } from '../core/world/levelRuntime';
import type { Keyboard } from '../input/keyboard';
import { createFixedLoop } from './fixedLoop';
import type { FixedLoopClock, FrameStats } from './fixedLoop';
import { MAX_ADVANCE } from './hook';
import { EVENT_BUFFER_MAX } from './session';
import type { SoloSession } from './session';

/** Saat der Vorgabe. `seedRng` hasht den Saat-TEXT: `seedRng('1')` und `seedRng(1)` sind gleich. */
export const DEFAULT_SEED = 1;

export interface SoloSessionOptions {
  /** Ausgabe von `JSON.parse` bzw. ein JSON-Import – der Kern liest nie eine Datei (D12). */
  levelJson: unknown;
  balanceJson: unknown;
  seed: number | string;
  /** `src/input/keyboard.ts` – reiner Reducer, kein DOM. */
  keyboard: Keyboard;
  clock: FixedLoopClock;
  /** Gestellt von `src/render/gameMain.ts` (bzw. von `view2d/main.ts`). */
  render(alpha: number): void;
  /**
   * Die ganze Bildstatistik, nicht zwei Zahlen (R9): `gameMain` braucht `steps` UND `frameMs`, und
   * ein Rückruf, der nur zwei Zahlen sieht, müsste beim nächsten Feld erneut geändert werden.
   * `FrameStats` kommt als TYP aus `./fixedLoop`.
   */
  onFrame?(stats: FrameStats): void;
  /** `?clock=manual`: die Schleife wird gebaut, aber NIE gestartet. */
  manual?: boolean;
  /** An `buildLevelRuntime` weitergereicht (Vorgabe NAV_MAX_EDGE). */
  maxEdge?: number;
}

interface StickyInput { mx: number; mz: number; buttons: number }

/**
 * Grenzen des DRAHTFORMATS: `packInput` schreibt `mx`/`mz` als i8 und `buttons` als ein Byte.
 * Geprüft wird hier aus demselben Grund wie bei `advance`: ein `setInput(0, NaN, 0, 0)` fiele sonst
 * erst Ticks später als `NaNError` aus `hashState` auf – weit weg von der Ursache.
 */
function needAxis(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -127 || value > 127) {
    throw new RangeError(`setInput: ${name} erwartet eine ganze Zahl in [-127, 127], bekam ${String(value)}`);
  }
}

function needFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`teleport: ${name} erwartet eine endliche Zahl, bekam ${String(value)}`);
  }
}

/**
 * EINE Stelle für die Grenzen von `setInput`. `src/render/gameMain.ts` prüft am Haken noch einmal –
 * er ist der äußere Rand, `cmd.setInput` nimmt `unknown[]` –, benutzt dafür aber genau diese
 * Funktion: die beiden Kopien standen Zeile für Zeile in beiden Dateien und liefen beim ersten neuen
 * Grenzwert auseinander (Abschlussreview MIN-15).
 */
export function assertInputRange(mx: number, mz: number, buttons: number): void {
  needAxis(mx, 'mx');
  needAxis(mz, 'mz');
  if (!Number.isInteger(buttons) || buttons < 0 || buttons > 255) {
    throw new RangeError(`setInput: buttons erwartet eine ganze Zahl in [0, 255], bekam ${String(buttons)}`);
  }
}

/** Dasselbe für `advance(n)`: ganze Zahl in [0, MAX_ADVANCE], sonst `RangeError` mit dem Wert. */
export function assertAdvanceRange(ticks: number): void {
  if (!Number.isInteger(ticks) || ticks < 0 || ticks > MAX_ADVANCE) {
    throw new RangeError(`advance erwartet eine ganze Zahl in [0, ${String(MAX_ADVANCE)}], bekam ${String(ticks)}`);
  }
}

export function createSoloSession(options: SoloSessionOptions): SoloSession {
  const level: LevelDef = loadLevel(options.levelJson);
  const balance: Balance = loadBalance(options.balanceJson);
  const runtime: LevelRuntime = buildLevelRuntime(level, balance, options.maxEdge);
  const world: WorldState = createInitialState(level, balance, options.seed);
  const stepCtx: StepContext = { balance, level, colliders: runtime.colliders };

  const events: GameEvent[] = [];
  let droppedEventCount = 0;
  const sticky: StickyInput[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) sticky.push({ mx: 0, mz: 0, buttons: 0 });
  const frames: InputFrame[] = [];

  // ZWEI Schnappschüsse, beide auf den Anfangszustand: ab jetzt wird nur noch getauscht und
  // überschrieben, die Interpolation kostet keine Allokation mehr.
  const view: RenderView = {
    prev: snapshotFast(world, createSnapshot()),
    curr: snapshotFast(world, createSnapshot()),
    alpha: 0,
    slow: makeSlowView(world),
  };

  /** `prev` wird das alte `curr`, das freigewordene Objekt nimmt den neuen Zustand auf. */
  function swapSnapshots(): void {
    const recycled = view.prev;
    view.prev = view.curr;
    view.curr = snapshotFast(world, recycled);
  }

  /**
   * Ein Stapel Ticks. Klebende Rahmen für ALLE vier Plätze; die Tastatur überschreibt Platz 0 NUR,
   * wenn sie nicht ruht – sonst wischte sie in einem Playwright-Lauf jeden `setInput(0, …)` im
   * nächsten Tick weg.
   */
  function advanceTicks(ticks: number): void {
    events.length = 0;
    for (let i = 0; i < ticks; i += 1) {
      frames.length = 0;
      for (let slot = 0; slot < sticky.length; slot += 1) {
        const held = sticky[slot];
        if (held === undefined) continue;
        frames.push({ seq: 0, tick: world.tick, mx: held.mx, mz: held.mz, buttons: held.buttons });
      }
      if (!options.keyboard.idle()) frames[0] = options.keyboard.frame(world.tick, 0);
      step(world, frames, stepCtx, events);
      if (events.length > EVENT_BUFFER_MAX) {
        droppedEventCount += events.length - EVENT_BUFFER_MAX;
        events.length = EVENT_BUFFER_MAX;
      }
      swapSnapshots();
    }
    // NUR hier, also nur bei wirklich gerechneten Ticks: gemessen legt `makeSlowView` sonst je Bild
    // ein Objekt mit vier Unterobjekten an.
    view.slow = makeSlowView(world);
  }

  const loop = createFixedLoop(
    {
      advance: advanceTicks,
      render(alpha: number) {
        view.alpha = alpha;
        options.render(alpha);
      },
      onFrame(stats) {
        options.onFrame?.(stats);
      },
    },
    options.clock,
  );

  const session: SoloSession = {
    kind: 'solo',
    runtime,
    view,
    events,
    loop,
    droppedEvents: () => droppedEventCount,
    state: () => world,
    tick: () => world.tick,
    hash: () => hashState(world),

    advance(ticks: number): number {
      assertAdvanceRange(ticks);
      // HIER und nicht nur in `advanceTicks`: der Vertrag verspricht das Leeren fuer JEDEN
      // `advance()`, und `loop.advance(0)` meldet `hooks.advance` nicht (richtig – es gibt nichts zu
      // rechnen). Ohne diese Zeile bekaeme ein Abnehmer nach einem `advance(0)` dieselben Ereignisse
      // ein zweites Mal (Task-2-Review, Minor 2); genau so wartet der Tor-Spec auf das erste Bild.
      events.length = 0;
      loop.advance(ticks);
      return world.tick;
    },

    setInput(slot: number, mx: number, mz: number, buttons: number): void {
      const held = sticky[slot];
      if (held === undefined) throw new RangeError(`setInput: Platz ${slot} gibt es nicht`);
      assertInputRange(mx, mz, buttons);
      held.mx = mx;
      held.mz = mz;
      held.buttons = buttons;
    },

    keyDown: (code: string) => options.keyboard.onKeyDown(code),
    keyUp: (code: string) => options.keyboard.onKeyUp(code),

    resetInput(): void {
      options.keyboard.reset();
      for (const held of sticky) {
        held.mx = 0;
        held.mz = 0;
        held.buttons = 0;
      }
    },

    teleport(slot: number, x: number, z: number): void {
      const player = world.players[slot];
      if (player === undefined) throw new RangeError(`teleport: Platz ${slot} gibt es nicht`);
      needFinite(x, 'x');
      needFinite(z, 'z');
      player.pos.x = x;
      player.pos.z = z;
      // `vel` wird genullt, `facing` bleibt stehen; den Raum löst der nächste Tick auf (Q7).
      player.vel.x = 0;
      player.vel.z = 0;
      // BEIDE Schnappschüsse: sonst zöge die Figur im nächsten Bild sichtbar über das halbe Level,
      // weil `prev` noch am alten Ort steht.
      snapshotFast(world, view.prev);
      snapshotFast(world, view.curr);
    },

    roomOf(slot: number): number {
      const player = world.players[slot];
      if (player === undefined) throw new RangeError(`roomOf: Platz ${slot} gibt es nicht`);
      return player.room;
    },
  };

  // Ein erstes Bild fällt erst, wenn die Schleife läuft – der Aufrufer baut vorher seine Szene.
  // `?clock=manual` startet NIE: gerechnet wird dann nur über `__mb.advance`, damit ein
  // Playwright-Lauf ohne Wartezeit deterministisch bleibt.
  if (options.manual !== true) loop.start();

  return session;
}
