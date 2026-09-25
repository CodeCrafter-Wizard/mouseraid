import type { CatState, Phase, WorldState } from './state';

/**
 * Was die Darstellung vom Zustand sieht.
 *
 * `RenderView` ist in M3 NUR ein Typ – gebaut wird er erst von `fixedLoop` in M5, das `prev`,
 * `curr` und den Mischanteil `alpha` zwischen zwei Ticks kennt. `SlowView` dagegen entsteht schon
 * hier: er trägt genau die Werte, die eine Anzeige ein paar Mal je Sekunde braucht (Uhr, Zustand
 * der Mäuse, Katzenlage) – nicht die, die in jedem Bild neu gezeichnet werden.
 */

export interface SlowPlayer { slot: number; active: boolean; weakened: boolean; caught: boolean;
                              room: number; loudness: number }

export interface SlowView { tick: number; phase: Phase; phaseTick: number; dayCount: number;
                            skipVotes: boolean[]; players: SlowPlayer[]; catState: CatState; awareness: number[] }

export interface RenderView { prev: WorldState; curr: WorldState; alpha: number; slow: SlowView }

/**
 * REIN: liest den Zustand und gibt ein neues Objekt zurück. Alle Arrays werden kopiert – die
 * Anzeige darf an ihrer Sicht herumschreiben, ohne die Simulation zu verändern.
 */
export function makeSlowView(state: WorldState): SlowView {
  const players: SlowPlayer[] = [];
  for (const player of state.players) {
    players.push({
      slot: player.slot,
      active: player.active,
      weakened: player.weakened,
      caught: player.caught,
      room: player.room,
      loudness: player.loudness,
    });
  }

  return {
    tick: state.tick,
    phase: state.clock.phase,
    phaseTick: state.clock.phaseTick,
    dayCount: state.clock.dayCount,
    skipVotes: state.clock.skipVotes.slice(),
    players,
    catState: state.cat.state,
    awareness: state.cat.awareness.slice(),
  };
}
