import { describe, expect, it } from 'vitest';

import type { InputFrame } from '../../../../src/core/sim/input';
import { neutralInput } from '../../../../src/core/sim/input';
import { SYSTEM_ORDER, SYSTEMS, step, stepPlayerMovement } from '../../../../src/core/sim/step';
import type { MoveModifiers, StepContext } from '../../../../src/core/sim/step';
import { catchSystem } from '../../../../src/core/systems/catch';
import { stepPlayerMovement as fromPlayerMove } from '../../../../src/core/systems/playerMove';
import type { TestWorld } from '../testWorld';
import { activate, frame, makeWorld, player } from '../testWorld';

/** Vier neutrale Rahmen für den aktuellen Tick. */
function neutralFour(w: TestWorld): InputFrame[] {
  const t = w.state.tick;
  return [neutralInput(t, 0), neutralInput(t, 0), neutralInput(t, 0), neutralInput(t, 0)];
}

describe('SYSTEMS / SYSTEM_ORDER', () => {
  it('hält genau die Reihenfolge der Spec (Zeile 109)', () => {
    expect([...SYSTEM_ORDER]).toEqual([
      'clock', 'playerIntent', 'playerMove', 'interaction', 'noise',
      'catPerception', 'catBrain', 'catMove', 'catch', 'colony',
    ]);
  });

  it('pinnt die Reihenfolge über das name-Feld, nicht über Function.name', () => {
    expect(SYSTEMS.map((s) => s.name)).toEqual([...SYSTEM_ORDER]);
    expect(SYSTEMS).toHaveLength(SYSTEM_ORDER.length);
    for (const entry of SYSTEMS) expect(typeof entry.run).toBe('function');
  });

  it('vergibt jeden Namen genau einmal', () => {
    expect(new Set(SYSTEMS.map((s) => s.name)).size).toBe(SYSTEMS.length);
  });

  it('nennt den Eintrag catch, obwohl die Funktion catchSystem heißt', () => {
    // Tragende Richtung: hinter dem Namen `catch` steckt GENAU `catchSystem`. Die frühere Fassung
    // (`run.name` ist nicht `catch`) konnte nicht rot werden – `catch` ist ein reserviertes Wort,
    // eine Funktion kann gar nicht so heißen.
    const entry = SYSTEMS.find((s) => s.name === 'catch');
    expect(entry).toBeDefined();
    expect(entry?.run).toBe(catchSystem);
  });
});

describe('step', () => {
  it('erhöht den Tick am ENDE – die Systeme sehen noch den alten Wert', () => {
    const w = makeWorld();
    activate(w.state, 1);
    step(w.state, [frame(0, 127, 0)], w.ctx, w.events);
    expect(w.state.tick).toBe(1);
    // Die Probe, die noise WÄHREND des Schritts geschrieben hat, trägt den alten Tick.
    expect(w.state.noise[0]?.tick).toBe(0);
    expect(w.state.noiseCount).toBe(1);
  });

  it('ist mit vier Spielern und neutraler Eingabe ein Nichts-Tun außer Tick und Uhr', () => {
    const w = makeWorld();
    // Erster Schritt: die Raumzuordnung entsteht (vorher NO_ROOM) – das ist kein Nichts-Tun.
    step(w.state, neutralFour(w), w.ctx, w.events);
    for (let i = 0; i < 4; i += 1) expect(player(w.state, i).room).toBe(0);
    expect(w.state.rooms[0]?.playerMask).toBe(15);

    const before = JSON.parse(JSON.stringify(w.state)) as Record<string, unknown>;
    w.events.length = 0;
    step(w.state, neutralFour(w), w.ctx, w.events);

    before.tick = 2;
    (before.clock as { phaseTick: number }).phaseTick = 2;
    expect(JSON.parse(JSON.stringify(w.state))).toEqual(before);
    expect(w.events).toHaveLength(0);
  });

  it('setzt für fehlende Slots neutralInput ein', () => {
    const a = makeWorld();
    const b = makeWorld();
    step(a.state, [], a.ctx, a.events);
    step(b.state, neutralFour(b), b.ctx, b.events);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it('bedient auch eine zu kurze Eingabeliste', () => {
    const w = makeWorld();
    step(w.state, [frame(0, 127, 0)], w.ctx, w.events);
    expect(player(w.state, 0).intent.mag).toBe(1);
    expect(player(w.state, 3).intent.mag).toBe(0);
  });

  it('läuft die Uhr über die volle Nacht und meldet den Wechsel im richtigen Tick', () => {
    const w = makeWorld();
    const nightTicks = w.ctx.balance.nightTicks;
    for (let t = 0; t < nightTicks; t += 1) step(w.state, [], w.ctx, w.events);
    expect(w.state.tick).toBe(nightTicks);
    expect(w.state.clock.phase).toBe('day');
    expect(w.events).toEqual([
      { kind: 'phase-changed', tick: nightTicks - 1, phase: 'day', dayCount: 2 },
      { kind: 'day-started', tick: nightTicks - 1, dayCount: 2 },
    ]);
  });

  it('liefert bei gleicher Eingabe zweimal denselben Zustand', () => {
    function run(): string {
      const w = makeWorld('gleiche-saat');
      for (let t = 0; t < 200; t += 1) {
        const mx = t % 40 < 20 ? 127 : -90;
        step(w.state, [
          frame(t, mx, 40), frame(t, -mx, 0), frame(t, 0, mx, 1), frame(t, 30, -30, 2),
        ], w.ctx, w.events);
      }
      return JSON.stringify(w.state);
    }
    expect(run()).toBe(run());
  });

  it('lässt den injizierten Kontext unberührt', () => {
    const w = makeWorld();
    const before = JSON.stringify(w.ctx);
    for (let t = 0; t < 200; t += 1) step(w.state, [frame(t, 127, 127, 1)], w.ctx, w.events);
    expect(JSON.stringify(w.ctx)).toBe(before);
  });
});

describe('Naht für die Client-Vorhersage', () => {
  it('reicht stepPlayerMovement unverändert durch', () => {
    expect(stepPlayerMovement).toBe(fromPlayerMove);
  });

  it('reicht StepContext und MoveModifiers als Typen durch', () => {
    const w = makeWorld();
    const ctx: StepContext = w.ctx;
    const modifiers: MoveModifiers = { speedMul: 0.7 };
    const p = player(w.state, 0);
    p.intent.moveX = 1;
    p.intent.mag = 1;
    stepPlayerMovement(p, p.intent, ctx, modifiers);
    expect(p.vel.x).toBeGreaterThan(0);
  });
});
