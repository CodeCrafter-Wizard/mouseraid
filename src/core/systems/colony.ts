import type { SystemFn } from '../sim/state';

/**
 * Stumpf für M16 (Kolonie: Vorrat, Hunger, Geschwächte, Ausbau des Baus zwischen den Nächten).
 * Lässt den Zustand unverändert.
 */
export const colony: SystemFn = () => {
  // Absichtlich leer (Kopf-Abweichung 9): Verhalten entsteht in M16.
};
