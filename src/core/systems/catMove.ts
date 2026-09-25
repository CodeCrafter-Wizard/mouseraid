import type { SystemFn } from '../sim/state';

/**
 * Stumpf für M7 (Bewegung der Katze entlang des Nav-Graphen aus M4). Lässt `cat.pos` und
 * `cat.facing` unverändert – die Katze steht still.
 */
export const catMove: SystemFn = () => {
  // Absichtlich leer (Kopf-Abweichung 9): Verhalten entsteht in M7.
};
