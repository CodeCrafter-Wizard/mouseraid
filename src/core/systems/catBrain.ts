import type { SystemFn } from '../sim/state';

/**
 * Stumpf für M7 (Zustandsmaschine der Katze: schlafen, patrouillieren, lauern, jagen …).
 * Lässt `cat.state`, `cat.stateTick` und `cat.targetSlot` unverändert – die Katze schläft.
 */
export const catBrain: SystemFn = () => {
  // Absichtlich leer (Kopf-Abweichung 9): Verhalten entsteht in M7.
};
