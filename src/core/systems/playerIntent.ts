import { sqrt } from '../math/trig';
import { BUTTON_INTERACT, BUTTON_SPRINT } from '../sim/input';
import type { SystemFn } from '../sim/state';

/** Größter Betrag einer Achse im 8-Bit-Rahmen; −128 wird dadurch auf knapp über 1 abgebildet. */
const AXIS_MAX = 127;

/**
 * Rechnet die analogen Rahmen in den Willen jedes aktiven Spielers um.
 *
 * Analoge Auslenkung ist Tempo UND Lautstärke (Spec-Abweichung 7: es gibt keinen Schleich-Knopf).
 * Sprint ist „Knopf ODER Außenring" – zwei WEGE, nicht eine Bedingung (D9, Spec Zeile 118).
 * `interact` ist eine FLANKE: gehalten zählt nur der erste Rahmen, sonst löste ein gedrückt
 * gehaltener Knopf in jedem Tick aus.
 *
 * Schreibt ausschließlich `player.intent` und `player.prevButtons`; `out` bleibt deshalb
 * undeklariert – dieses System erzeugt kein Ereignis.
 */
export const playerIntent: SystemFn = (state, ctx, inputs) => {
  const mouse = ctx.balance.mouse;
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p === undefined || !p.active) continue;
    const f = inputs[i];
    if (f === undefined) continue;

    const rx = f.mx / AXIS_MAX;
    const rz = f.mz / AXIS_MAX;
    const raw = sqrt(rx * rx + rz * rz);
    let mag = raw > 1 ? 1 : raw;
    let moveX = 0;
    let moveZ = 0;
    if (raw > 0) {
      moveX = rx / raw;
      moveZ = rz / raw;
    }
    // Totzone: die Ruhelage des Daumens ist kein Gehbefehl. Richtung UND Betrag fallen auf 0 –
    // die Figur dreht sich trotzdem nicht zurück, weil playerMove `facing` nur bei Tempo setzt.
    if (mag < mouse.deadZone) {
      mag = 0;
      moveX = 0;
      moveZ = 0;
    }

    p.intent.moveX = moveX;
    p.intent.moveZ = moveZ;
    p.intent.mag = mag;
    p.intent.sprint = (f.buttons & BUTTON_SPRINT) !== 0 || mag >= mouse.sprintRingMag;
    p.intent.interact = (f.buttons & ~p.prevButtons & BUTTON_INTERACT) !== 0;
    p.prevButtons = f.buttons;
  }
};
