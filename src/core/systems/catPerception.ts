import type { SystemFn } from '../sim/state';

/**
 * Stumpf für M7 (Sehen und Hören der Katze, `cat.awareness`). Lässt den Zustand unverändert;
 * der Geräusch-Ringpuffer wird schon in M3 gefüllt, gelesen wird er erst hier.
 */
export const catPerception: SystemFn = () => {
  // Absichtlich leer (Kopf-Abweichung 9): Verhalten entsteht in M7.
};
