import type { Phase } from './state';

/**
 * Ereignisse verlassen den Schritt im PUFFER DES AUFRUFERS – der Zustand merkt sie sich nicht.
 * Sonst wüchse der Zustand innerhalb eines Ticks, und Klon wie Hash müssten eine Liste mitführen,
 * die für die Simulation selbst bedeutungslos ist.
 *
 * Genau diese drei Arten erzeugt M3. Es gibt bewusst KEIN 'player-blocked': ob eine Bewegung an
 * einer Wand endete, ist eine Frage der Darstellung und steht in `MoveResult.blockedX/blockedZ`.
 */

/** Tag wurde Nacht oder Nacht wurde Tag. `phase` ist die Phase NACH dem Wechsel. */
export interface PhaseChanged { kind: 'phase-changed'; tick: number; phase: Phase; dayCount: number }

/** Zusätzlich zum Wechsel night -> day: ein neuer Tag hat begonnen (der 7. ist der Invasionstag). */
export interface DayStarted { kind: 'day-started'; tick: number; dayCount: number }

/** Nur für LAUTE Proben (loudness >= balance.noiseEventMinLoudness). Der leise Rest steht im
 *  Ringpuffer `state.noise`, den die Katzenwahrnehmung ab M7 liest. */
export interface NoiseEvent { kind: 'noise'; tick: number; slot: number; x: number; z: number; loudness: number }

export type GameEvent = PhaseChanged | DayStarted | NoiseEvent;
