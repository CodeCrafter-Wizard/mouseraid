import type { SystemFn } from '../sim/state';

/**
 * Stumpf für M7 (Fangen: `player.caught`, `player.weakened`). Lässt den Zustand unverändert.
 *
 * Die Funktion heißt `catchSystem`, weil `catch` ein reserviertes Wort ist; im Eintrag der
 * Systemliste steht trotzdem der Spec-Name `'catch'` (Kopf-Abweichung 14).
 */
export const catchSystem: SystemFn = () => {
  // Absichtlich leer (Kopf-Abweichung 9): Verhalten entsteht in M7.
};
