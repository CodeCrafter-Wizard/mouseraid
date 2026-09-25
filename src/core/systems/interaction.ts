import type { SystemFn } from '../sim/state';

/**
 * Stumpf für M13 (Aufnehmen, Ablegen, Schalter). Lässt den Zustand unverändert und deklariert
 * keinen Parameter – eine Funktion mit weniger Parametern ist zu `SystemFn` typkompatibel.
 * Der Eintrag existiert nur, damit Reihenfolge und Naht jetzt festliegen.
 */
export const interaction: SystemFn = () => {
  // Absichtlich leer (Kopf-Abweichung 9): Verhalten entsteht in M13.
};
