import { MAX_PLAYERS } from './state';
import type { CatState, Phase, WorldState } from './state';

/**
 * Was die Darstellung vom Zustand sieht – in ZWEI Rhythmen.
 *
 * `FastSnapshot` trägt genau die Werte, die in JEDEM Bild gebraucht werden (Ort, Blickrichtung,
 * Sichtbarkeit), und zwar in Typed Arrays: `src/modes/soloSession.ts` legt ZWEI Schnappschüsse an
 * und tauscht sie je Tick, danach kostet die Interpolation keine Allokation mehr. `SlowView` trägt
 * die Werte, die eine Anzeige ein paar Mal je Sekunde braucht (Uhr, Zustand der Mäuse,
 * Katzenlage) – nicht die, die in jedem Bild neu gezeichnet werden.
 *
 * WARUM `prev` KEIN vollständiger `WorldState` ist (M5/D5): Tempo ist nicht der Grund – eine
 * Vollkopie kostet gemessen 2,05 µs, also 0,006 % eines 33-ms-Ticks. Der Grund ist Korrektheit:
 * ein `prev` als voller Zustand verleitet die Renderschicht dazu, LANGSAME Felder daraus zu lesen
 * (die dürfen nur aus `slow` kommen), und eine Vollkopie legt je Tick ein Objekt an (GC-Druck über
 * Stunden).
 */

/** Zahlen je Figur im Schnappschuss: `x`, `z`, `facing`. */
export const SNAPSHOT_STRIDE = 3;
/** Vier Mäuse und die Katze. */
export const SNAPSHOT_ACTORS = MAX_PLAYERS + 1;
/** Index der Katze in `values`/`visible` – sie steht hinter den vier Plätzen. */
export const SNAPSHOT_CAT = MAX_PLAYERS;

export interface FastSnapshot {
  /** `-1` heißt »nie beschrieben« – ein echter Tick ist nie negativ. */
  tick: number;
  /** `SNAPSHOT_ACTORS * SNAPSHOT_STRIDE` Zahlen, je Figur `x`, `z`, `facing`. */
  values: Float64Array;
  /** 1 = aktiv UND nicht gefangen; die Katze ist immer 1. */
  visible: Uint8Array;
}

export interface SlowPlayer { slot: number; active: boolean; weakened: boolean; caught: boolean;
                              room: number; loudness: number }

export interface SlowView { tick: number; phase: Phase; phaseTick: number; dayCount: number;
                            skipVotes: boolean[]; players: SlowPlayer[]; catState: CatState; awareness: number[] }

export interface RenderView { prev: FastSnapshot; curr: FastSnapshot; alpha: number; slow: SlowView }

/** Ein leerer Schnappschuss mit den Arrays in voller Länge. Wird EINMAL je Sitzung gerufen. */
export function createSnapshot(): FastSnapshot {
  return {
    tick: -1,
    values: new Float64Array(SNAPSHOT_ACTORS * SNAPSHOT_STRIDE),
    visible: new Uint8Array(SNAPSHOT_ACTORS),
  };
}

/**
 * REIN: schreibt `out` VOLLSTÄNDIG und gibt es zurück – allokiert nichts. Jeder Platz landet an
 * seinem `slot`-Index, damit ein inaktiver Platz die Reihenfolge nicht verschiebt; die Katze steht
 * an `SNAPSHOT_CAT`.
 *
 * `visible` mischt bewusst ZWEI Fragen (aktiv und nicht gefangen) zu einer Zahl: die Renderschicht
 * hat genau eine Entscheidung zu treffen – Mesh an oder aus –, und beide Gründe führen zu
 * demselben Bild. Der Unterschied steht in `SlowView.players`, wo ihn ein HUD lesen kann.
 */
export function snapshotFast(state: WorldState, out: FastSnapshot): FastSnapshot {
  out.tick = state.tick;
  for (const player of state.players) {
    const base = player.slot * SNAPSHOT_STRIDE;
    out.values[base] = player.pos.x;
    out.values[base + 1] = player.pos.z;
    out.values[base + 2] = player.facing;
    out.visible[player.slot] = player.active && !player.caught ? 1 : 0;
  }
  const cat = SNAPSHOT_CAT * SNAPSHOT_STRIDE;
  out.values[cat] = state.cat.pos.x;
  out.values[cat + 1] = state.cat.pos.z;
  out.values[cat + 2] = state.cat.facing;
  out.visible[SNAPSHOT_CAT] = 1;
  return out;
}

/**
 * REIN: liest den Zustand und gibt ein neues Objekt zurück. Alle Arrays werden kopiert – die
 * Anzeige darf an ihrer Sicht herumschreiben, ohne die Simulation zu verändern.
 *
 * Wird NUR gerufen, wenn wirklich ein Tick gerechnet wurde: gemessen legt es sonst je Bild ein
 * Objekt mit vier Unterobjekten an, sechzig Mal je Sekunde für einen unveränderten Inhalt.
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
