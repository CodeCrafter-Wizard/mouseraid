export type UpdateCheckOutcome = 'loading' | 'ready' | 'upToDate';

/**
 * Was eine aufgelöste `registration.update()` tatsächlich bedeutet.
 *
 * `update()` löst auch dann erfolgreich auf, wenn ein NEUER Worker gefunden wurde – die Antwort
 * steht danach nur an der Registrierung: `installing` (Download läuft) bzw. `waiting` (bereit).
 * Rein gehalten, damit die drei Fälle ohne Browser testbar sind.
 */
export function updateCheckOutcome(reg: { installing: unknown; waiting: unknown }): UpdateCheckOutcome {
  if (reg.installing !== null && reg.installing !== undefined) return 'loading';
  if (reg.waiting !== null && reg.waiting !== undefined) return 'ready';
  return 'upToDate';
}
