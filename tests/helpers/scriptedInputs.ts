import { nextInt, seedRng } from '../../src/core/math/rng';
import { hashNumbers } from '../../src/core/math/hash';
import { TAU, cos, sin } from '../../src/core/math/trig';
import { BUTTON_INTERACT, BUTTON_SPRINT } from '../../src/core/sim/input';
import type { InputFrame } from '../../src/core/sim/input';

// Skript-Bots: (Saat x Muster x Tick) -> InputFrame, ohne aufgezeichnete Frames (Spec Zeile 121).
// REIN und ZUSTANDSLOS: jeder Aufruf rechnet sein Ergebnis allein aus den Argumenten. Der Zufall
// kommt aus `seedRng(hashNumbers([seed, slot, t]))`; `t` ist bei den Mustern mit Abschnitten der
// ANFANGSTICK des Abschnitts (so bleibt eine Richtung innerhalb eines Abschnitts stehen), sonst der
// Tick selbst. Gerechnet wird mit dem Trig des Kerns, nicht mit `Math.sin/cos`: die Bots sind Teil
// der Golden-Baseline und muessen so engine-unabhaengig sein wie der Kern.

export type BotPattern = 'idle' | 'walk-circle' | 'sprint-bursts' | 'wall-hugger';
export const BOT_PATTERNS: readonly BotPattern[] = ['idle', 'walk-circle', 'sprint-bursts', 'wall-hugger'];

/** walk-circle: volle Umdrehung in 120 Ticks = 4 s bei 30 Hz. */
export const CIRCLE_TICKS = 120;
/** walk-circle: Grundauslenkung 90/127 = 0,71 – ueber jeder sinnvollen Totzone, unter jedem Aussenring. */
export const CIRCLE_MAG = 90;
/** walk-circle: Saat-Zittern der Auslenkung, +-3 -> 87..93. Ohne das haenge die Saat am Muster nicht. */
export const CIRCLE_JITTER = 3;
/** sprint-bursts: Abschnittslaenge 90 Ticks = 3 s. */
export const BURST_PERIOD = 90;
/** sprint-bursts: davon die ersten 30 Ticks = 1 s Sprint bei voller Auslenkung. */
export const BURST_TICKS = 30;
/** sprint-bursts: volle Auslenkung im Schub, gemaechliches Gehen dazwischen. */
export const BURST_MAG = 127;
export const BURST_REST_MAG = 35;
/** wall-hugger: 150 Ticks = 5 s je Gerade, dann ein 90-Grad-Wechsel. */
export const LEG_TICKS = 150;
/** wall-hugger: 100/127 = 0,787 – kraeftig gegen die Wand, aber unter dem Aussenring 0,9 der Testbalance. */
export const WALL_MAG = 100;

/** Die vier Achsenrichtungen des wall-hugger, in dieser Reihenfolge von `nextInt(rng, 4)` gewaehlt. */
const AXES: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Abschnittsanfang zu `tick`; `Math.floor` statt `%`, damit auch negative Ticks sauber abschneiden. */
function sectionStart(tick: number, length: number): number {
  return Math.floor(tick / length) * length;
}

/** Ganzzahlige Achsenauslenkung, hart auf den i8-Bereich des InputFrame geklemmt. */
function axis(value: number): number {
  const rounded = Math.round(value);
  if (rounded < -127) return -127;
  return rounded > 127 ? 127 : rounded;
}

function frameFor(seed: number, slot: number, pattern: BotPattern, tick: number): InputFrame {
  const frame: InputFrame = { seq: tick & 0xff, tick, mx: 0, mz: 0, buttons: 0 };
  if (pattern === 'idle') {
    // idle: dauerhaft neutral. Bewusst OHNE Saat-Einfluss – dieses Muster pinnt den Ruhezustand.
    return frame;
  }
  if (pattern === 'walk-circle') {
    // walk-circle: die Richtung dreht mit fester Rate (eine Umdrehung je CIRCLE_TICKS), der Slot
    // versetzt die Phase um ein Viertel je Platz, die Auslenkung zittert saatabhaengig um +-3.
    const rng = seedRng(hashNumbers([seed, slot, tick]));
    const mag = CIRCLE_MAG + nextInt(rng, 2 * CIRCLE_JITTER + 1) - CIRCLE_JITTER;
    const angle = (tick + slot * (CIRCLE_TICKS / 4)) * (TAU / CIRCLE_TICKS);
    frame.mx = axis(mag * cos(angle));
    frame.mz = axis(mag * sin(angle));
    return frame;
  }
  if (pattern === 'sprint-bursts') {
    // sprint-bursts: je BURST_PERIOD Ticks eine saatabhaengige Richtung (eines von 360 Grad); die
    // ersten BURST_TICKS davon mit BUTTON_SPRINT und voller Auslenkung, der Rest gemaechlich.
    const start = sectionStart(tick, BURST_PERIOD);
    const rng = seedRng(hashNumbers([seed, slot, start]));
    const angle = nextInt(rng, 360) * (TAU / 360);
    const sprinting = tick - start < BURST_TICKS;
    const mag = sprinting ? BURST_MAG : BURST_REST_MAG;
    frame.mx = axis(mag * cos(angle));
    frame.mz = axis(mag * sin(angle));
    frame.buttons = sprinting ? BUTTON_SPRINT : 0;
    return frame;
  }
  if (pattern === 'wall-hugger') {
    // wall-hugger: lange Geraden entlang einer Weltachse, alle LEG_TICKS ein saatabhaengiger Wechsel
    // (90 Grad oder Kehrtwende). Am ersten Tick jeder Geraden ein BUTTON_INTERACT-Druck – so laeuft
    // auch die Flankenauswertung in playerIntent durch die Golden-Faelle.
    const legStart = sectionStart(tick, LEG_TICKS);
    const rng = seedRng(hashNumbers([seed, slot, legStart]));
    const direction = AXES[nextInt(rng, AXES.length)];
    frame.mx = axis((direction === undefined ? 0 : direction[0]) * WALL_MAG);
    frame.mz = axis((direction === undefined ? 0 : direction[1]) * WALL_MAG);
    frame.buttons = tick === legStart ? BUTTON_INTERACT : 0;
    return frame;
  }
  // Der letzte Zweig ist BEWUSST kein Rest-Zweig (U7): bis hierher lief ein Tippfehler aus
  // golden.json (`"wall-huger"`) still als wall-hugger durch – `golden.json` wird nur `as GoldenFile`
  // gelesen, der Uebersetzer sieht davon nichts. Nach einem Rebaseline waere daraus eine dauerhaft
  // gueltige Baseline fuer ein Muster geworden, das niemand gemeint hat.
  throw new RangeError(`Unbekanntes Bot-Muster: ${String(pattern)}`);
}

/**
 * Ein InputFrame je Platz fuer genau diesen Tick. `frame.tick` ist der uebergebene Tick,
 * `frame.seq` seine unteren 8 Bit; `mx`/`mz` sind ganzzahlig in [-127, 127].
 */
export function scriptedInputs(seed: number, slots: readonly BotPattern[], tick: number): InputFrame[] {
  const frames: InputFrame[] = [];
  for (let slot = 0; slot < slots.length; slot += 1) {
    frames.push(frameFor(seed, slot, slots[slot] ?? 'idle', tick));
  }
  return frames;
}
