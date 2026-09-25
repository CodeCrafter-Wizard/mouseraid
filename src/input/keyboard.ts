/**
 * Tastatur als REINER Reducer (D5): kein DOM, kein Ereignis-Abonnement, kein Timer, kein Zustand
 * ausserhalb dieses Moduls. `src/render/view2d/main.ts` haengt `keydown`/`keyup` an `window` und
 * reicht nur `KeyboardEvent.code` herein; M5 ersetzt diese Verdrahtung durch `src/modes/soloSession.ts`
 * und macht die Eingabe kamerarelativ. Deshalb ist hier NICHTS kamerabezogen.
 *
 * WARUM `code` und nicht `key`: `code` ist die PHYSISCHE Taste und damit layoutunabhaengig – auf
 * AZERTY liegt `KeyW` dort, wo auf QWERTZ das W ist. `key` waere ausserdem mit gehaltenem Shift ein
 * anderer Buchstabe, und Shift ist bei uns die Sprint-Taste.
 *
 * Richtungen folgen dem BILD (Entscheidung 16): die 2D-Ansicht ist ein Grundriss mit +X nach rechts
 * und +Z nach UNTEN, also ist `W`/Pfeil-hoch = -Z und `S`/Pfeil-runter = +Z.
 */
import { BUTTON_INTERACT, BUTTON_SPRINT } from '../core/sim/input';
import type { InputFrame } from '../core/sim/input';

/**
 * Gerade Achse beim GEHEN. 112/127 = 0,88189.
 *
 * WARUM nicht 127: `playerIntent` rechnet `mag = min(1, Laenge)` und setzt
 * `sprint = Knopf ODER mag >= sprintRingMag`. Bei voller Auslenkung waere `mag = 1` und damit JEDER
 * Tastenschritt ein Sprint – mit `sprintRingMag` 0,95 (echte Balance) wie mit 0,9 (Fixture).
 * Gehen bleibt deshalb unter BEIDEN Aussenringen; die Skript-Bots der Golden-Tests benutzen aus
 * demselben Grund 90 bzw. 100 statt 127.
 */
export const KEY_AXIS_WALK = 112;
/** Diagonale beim GEHEN: 79 = floor(112/sqrt2). Betrag 79*sqrt2/127 = 0,87971 – ebenfalls unter beiden Ringen. */
export const KEY_AXIS_WALK_DIAG = 79;
/** Gerade Achse beim SPRINT: volle Auslenkung. Das Sprint-Bit wird zusaetzlich gesetzt (Weg 1 UND Weg 2). */
export const KEY_AXIS_SPRINT = 127;
/** Diagonale beim SPRINT: 89 = floor(127/sqrt2). Betrag 0,99106 – knapp unter 1, nie darueber. */
export const KEY_AXIS_SPRINT_DIAG = 89;

// Je Richtung ZWEI Tasten. Sie werden einzeln gehalten, nicht zu einem Richtungs-Bit verschmolzen:
// wer W und Pfeil-hoch drueckt und W loslaesst, laeuft weiter.
const UP_CODES: readonly string[] = ['KeyW', 'ArrowUp'];
const DOWN_CODES: readonly string[] = ['KeyS', 'ArrowDown'];
const LEFT_CODES: readonly string[] = ['KeyA', 'ArrowLeft'];
const RIGHT_CODES: readonly string[] = ['KeyD', 'ArrowRight'];
const SPRINT_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight'];
const INTERACT_CODES: readonly string[] = ['KeyE', 'Space'];
const ALL_CODES: readonly string[] = [
  ...UP_CODES, ...DOWN_CODES, ...LEFT_CODES, ...RIGHT_CODES, ...SPRINT_CODES, ...INTERACT_CODES,
];

/** Ist eine der Tasten aus `codes` gehalten? */
function anyHeld(held: ReadonlySet<string>, codes: readonly string[]): boolean {
  for (const code of codes) {
    if (held.has(code)) return true;
  }
  return false;
}

export interface Keyboard {
  /** `true` = die Taste gehoert uns (der Aufrufer ruft dann `preventDefault`, sonst scrollt Space). */
  onKeyDown(code: string): boolean;
  onKeyUp(code: string): boolean;
  /** Der Rahmen fuer genau diesen Tick. Liest und LOESCHT dabei die Interact-Marke. */
  frame(tick: number, seq: number): InputFrame;
  /** Keine Taste gehalten UND keine Interact-Marke offen. */
  idle(): boolean;
}

export function createKeyboard(): Keyboard {
  const held = new Set<string>();
  // GERASTET (Entscheidung 12): ein Druck, der zwischen zwei Ticks beginnt und endet, waere sonst
  // verloren – die Anzeige laeuft mit 60 Hz, die Simulation mit 30 Hz. Die Marke ueberlebt bis zum
  // naechsten `frame()`; der gibt sie EINMAL aus, also sieht `playerIntent` genau eine Flanke.
  let interactLatch = false;

  return {
    onKeyDown(code: string): boolean {
      if (!ALL_CODES.includes(code)) return false;
      // Die Autowiederholung des Systems schickt `keydown` ohne zwischenzeitliches `keyup`. Das ist
      // KEIN neuer Druck – sonst raeste die gehaltene Taste die Marke nach jedem Auslesen neu und
      // ein Festhalten von E loeste in jedem zweiten Tick aus.
      if (held.has(code)) return true;
      held.add(code);
      if (INTERACT_CODES.includes(code)) interactLatch = true;
      return true;
    },

    onKeyUp(code: string): boolean {
      if (!ALL_CODES.includes(code)) return false;
      held.delete(code);
      return true;
    },

    frame(tick: number, seq: number): InputFrame {
      // Gegentasten heben sich auf – kein „die letzte gewinnt": wer A und D haelt, steht.
      const dirX = (anyHeld(held, RIGHT_CODES) ? 1 : 0) - (anyHeld(held, LEFT_CODES) ? 1 : 0);
      const dirZ = (anyHeld(held, DOWN_CODES) ? 1 : 0) - (anyHeld(held, UP_CODES) ? 1 : 0);
      const sprint = anyHeld(held, SPRINT_CODES);
      const diagonal = dirX !== 0 && dirZ !== 0;
      const walkAxis = diagonal ? KEY_AXIS_WALK_DIAG : KEY_AXIS_WALK;
      const sprintAxis = diagonal ? KEY_AXIS_SPRINT_DIAG : KEY_AXIS_SPRINT;
      const axis = sprint ? sprintAxis : walkAxis;

      let buttons = 0;
      if (sprint) buttons |= BUTTON_SPRINT;
      if (interactLatch) {
        buttons |= BUTTON_INTERACT;
        interactLatch = false;
      }
      return { seq, tick, mx: dirX * axis, mz: dirZ * axis, buttons };
    },

    idle(): boolean {
      return held.size === 0 && !interactLatch;
    },
  };
}
