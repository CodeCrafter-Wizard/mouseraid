import { describe, expect, it } from 'vitest';

import { hashState } from '../../../../src/core/sim/hash';
import { BUTTON_INTERACT, BUTTON_SPRINT } from '../../../../src/core/sim/input';
import { playerIntent } from '../../../../src/core/systems/playerIntent';
import type { TestWorld } from '../testWorld';
import { frame, makeWorld, player } from '../testWorld';

/** Ein Rahmen für Slot 0; die übrigen drei bleiben ohne Rahmen und damit unberührt. */
function drive(world: TestWorld, mx: number, mz: number, buttons = 0): void {
  playerIntent(world.state, world.ctx, [frame(world.state.tick, mx, mz, buttons)], world.events);
}

// Die Schwellen kommen aus der Fixture-Balance, nicht aus fest verdrahteten Zahlen: so bleibt der
// Test auch dann richtig, wenn T2 die (provisorischen) Werte anfasst. Geklemmt auf [0,127],
// damit auch die Randfälle deadZone = 0 und sprintRingMag = 1 noch prüfbar sind.
/** Größte ganze Auslenkung UNTER einem Verhältnis, und kleinste darüber. */
function below(ratio: number): number { return Math.max(0, Math.floor(ratio * 127) - 1); }
function above(ratio: number): number { return Math.min(127, Math.ceil(ratio * 127) + 1); }

describe('playerIntent', () => {
  it('rechnet die Auslenkung auf [-1,1] und normiert die Richtung', () => {
    const w = makeWorld();
    drive(w, 127, 0);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBeCloseTo(1, 12);
    expect(p.intent.moveX).toBeCloseTo(1, 12);
    expect(p.intent.moveZ).toBe(0);
  });

  it('klemmt den Betrag bei 1, auch beim Randwert mx = -128', () => {
    const w = makeWorld();
    drive(w, -128, 0);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBe(1);
    expect(p.intent.moveX).toBeCloseTo(-1, 12);
  });

  it('normiert die Diagonale auf Länge 1 – schräg ist nicht schneller', () => {
    const w = makeWorld();
    drive(w, 127, 127);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBe(1);
    expect(p.intent.moveX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(p.intent.moveZ).toBeCloseTo(Math.SQRT1_2, 12);
    // Bewusst ohne `**`: die Regel gilt zwar nur fuer src/**, aber der naechste Leser soll nicht
    // erst die ESLint-Konfiguration aufschlagen muessen.
    expect(Math.sqrt(p.intent.moveX * p.intent.moveX + p.intent.moveZ * p.intent.moveZ)).toBeCloseTo(1, 12);
  });

  it('nullt alles unterhalb der Totzone', () => {
    const w = makeWorld();
    const dz = w.ctx.balance.mouse.deadZone;
    drive(w, below(dz), 0);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBe(0);
    expect(p.intent.moveX).toBe(0);
    expect(p.intent.moveZ).toBe(0);
  });

  it('lässt knapp oberhalb der Totzone die volle Richtung durch', () => {
    const w = makeWorld();
    const dz = w.ctx.balance.mouse.deadZone;
    drive(w, above(dz), 0);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBeGreaterThanOrEqual(dz);
    expect(p.intent.mag).toBeLessThan(dz + 0.05);
    expect(p.intent.moveX).toBe(1);
  });

  it('sprintet über den Außenring auch ohne Knopf', () => {
    const w = makeWorld();
    const ring = w.ctx.balance.mouse.sprintRingMag;
    drive(w, above(ring), 0);
    expect(player(w.state, 0).intent.sprint).toBe(true);
  });

  it('sprintet knapp unter dem Außenring ohne Knopf nicht', () => {
    const w = makeWorld();
    const ring = w.ctx.balance.mouse.sprintRingMag;
    drive(w, below(ring), 0);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBeLessThan(ring);
    expect(p.intent.sprint).toBe(false);
  });

  it('sprintet per Knopf auch bei kleiner Auslenkung – Ring ODER Knopf, nicht UND', () => {
    const w = makeWorld();
    const dz = w.ctx.balance.mouse.deadZone;
    drive(w, above(dz), 0, BUTTON_SPRINT);
    const p = player(w.state, 0);
    expect(p.intent.mag).toBeLessThan(w.ctx.balance.mouse.sprintRingMag);
    expect(p.intent.sprint).toBe(true);
  });

  it('meldet interact nur auf der Flanke und merkt sich die Knöpfe', () => {
    const w = makeWorld();
    const p = player(w.state, 0);

    drive(w, 0, 0, BUTTON_INTERACT);
    expect(p.intent.interact).toBe(true);
    expect(p.prevButtons).toBe(BUTTON_INTERACT);

    drive(w, 0, 0, BUTTON_INTERACT);
    expect(p.intent.interact).toBe(false);

    drive(w, 0, 0, 0);
    expect(p.intent.interact).toBe(false);
    expect(p.prevButtons).toBe(0);

    drive(w, 0, 0, BUTTON_INTERACT | BUTTON_SPRINT);
    expect(p.intent.interact).toBe(true);
    expect(p.intent.sprint).toBe(true);
  });

  it('lässt inaktive Plätze unberührt', () => {
    const w = makeWorld();
    const p = player(w.state, 1);
    p.active = false;
    playerIntent(w.state, w.ctx, [
      frame(0, 127, 0), frame(0, 127, 0), frame(0, 127, 0), frame(0, 127, 0),
    ], w.events);
    expect(p.intent).toEqual({ moveX: 0, moveZ: 0, mag: 0, sprint: false, interact: false });
    expect(p.prevButtons).toBe(0);
    expect(player(w.state, 2).intent.mag).toBe(1);
  });

  it('schreibt keine Ereignisse', () => {
    const w = makeWorld();
    drive(w, 127, 0, BUTTON_INTERACT);
    expect(w.events).toHaveLength(0);
  });

  it('schreibt AUSSCHLIESSLICH intent und prevButtons (Minor 4, Task-5-Review, Hash-Beweis)', () => {
    // Der Kommentar in playerIntent.ts behauptet das schon; bewacht war bisher nur, dass ein
    // INAKTIVER Platz unberührt bleibt (siehe Test oben) – ein Schreibzugriff auf pos/vel/facing/
    // loudness/die Uhr fiel in keinem der Fälle auf. hashState() deckt den GESAMTEN Zustand ab
    // (T4): läuft playerIntent, setzt intent/prevButtons von Hand auf den Ausgangswert zurück,
    // und der Hash muss wieder exakt der Ausgangshash sein.
    const w = makeWorld();
    const vorher = hashState(w.state);
    playerIntent(w.state, w.ctx, [
      frame(w.state.tick, 127, 64, BUTTON_INTERACT | BUTTON_SPRINT),
      frame(w.state.tick, -80, 20, BUTTON_SPRINT),
      frame(w.state.tick, 10, -10, 0),
      frame(w.state.tick, 0, 0, BUTTON_INTERACT),
    ], w.events);
    for (let i = 0; i < w.state.players.length; i += 1) {
      const p = player(w.state, i);
      p.intent = { moveX: 0, moveZ: 0, mag: 0, sprint: false, interact: false };
      p.prevButtons = 0;
    }
    expect(hashState(w.state)).toBe(vorher);
  });
});
