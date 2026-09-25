import { describe, expect, it } from 'vitest';

import { clock } from '../../../../src/core/systems/clock';
import type { TestWorld } from '../testWorld';
import { makeWorld, player } from '../testWorld';

/**
 * `step()` erhöht den Tick am ENDE; hier wird das von Hand nachgezogen, damit die Tick-Nummer
 * in den Ereignissen dieselbe ist wie im echten Lauf.
 */
function runClock(world: TestWorld, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    clock(world.state, world.ctx, [], world.events);
    world.state.tick += 1;
  }
}

/** Alle vier Plätze stimmen für das Überspringen. */
function voteAll(world: TestWorld): void {
  const votes = world.state.clock.skipVotes;
  for (let i = 0; i < votes.length; i += 1) votes[i] = true;
}

describe('clock', () => {
  it('startet in der Nacht bei Tag 1 – das Spiel beginnt mit dem Beutezug', () => {
    const w = makeWorld();
    expect(w.state.clock.phase).toBe('night');
    expect(w.state.clock.dayCount).toBe(1);
    expect(w.state.clock.phaseTick).toBe(0);
  });

  it('zählt phaseTick hoch und wechselt erst im Tick nightTicks', () => {
    const w = makeWorld();
    const nightTicks = w.ctx.balance.nightTicks;

    runClock(w, nightTicks - 1);
    expect(w.state.clock.phase).toBe('night');
    expect(w.state.clock.phaseTick).toBe(nightTicks - 1);
    expect(w.events).toHaveLength(0);

    runClock(w, 1);
    expect(w.state.clock.phase).toBe('day');
    expect(w.state.clock.phaseTick).toBe(0);
    expect(w.state.clock.dayCount).toBe(2);
  });

  it('meldet beim Nachtende erst phase-changed, dann day-started – beide mit dem laufenden Tick', () => {
    const w = makeWorld();
    const nightTicks = w.ctx.balance.nightTicks;
    runClock(w, nightTicks);
    expect(w.events).toEqual([
      { kind: 'phase-changed', tick: nightTicks - 1, phase: 'day', dayCount: 2 },
      { kind: 'day-started', tick: nightTicks - 1, dayCount: 2 },
    ]);
  });

  it('beendet den Tag nach dayTicks OHNE dayCount zu erhöhen und ohne day-started', () => {
    const w = makeWorld();
    runClock(w, w.ctx.balance.nightTicks);
    w.events.length = 0;

    runClock(w, w.ctx.balance.dayTicks - 1);
    expect(w.state.clock.phase).toBe('day');
    expect(w.events).toHaveLength(0);

    runClock(w, 1);
    expect(w.state.clock.phase).toBe('night');
    expect(w.state.clock.dayCount).toBe(2);
    expect(w.events).toEqual([
      { kind: 'phase-changed', tick: w.ctx.balance.nightTicks + w.ctx.balance.dayTicks - 1, phase: 'night', dayCount: 2 },
    ]);
  });

  it('beendet die Phase sofort, wenn ALLE aktiven Spieler abstimmen', () => {
    const w = makeWorld();
    voteAll(w);
    runClock(w, 1);
    expect(w.state.clock.phase).toBe('day');
    expect(w.state.clock.phaseTick).toBe(0);
    expect(w.state.clock.skipVotes).toEqual([false, false, false, false]);
  });

  it('lässt eine fehlende Stimme die Phase NICHT beenden', () => {
    const w = makeWorld();
    voteAll(w);
    w.state.clock.skipVotes[3] = false;
    runClock(w, 1);
    expect(w.state.clock.phase).toBe('night');
    expect(w.state.clock.phaseTick).toBe(1);
    expect(w.events).toHaveLength(0);
  });

  it('verlangt von inaktiven Plätzen keine Stimme', () => {
    const w = makeWorld();
    player(w.state, 3).active = false;
    voteAll(w);
    w.state.clock.skipVotes[3] = false;
    runClock(w, 1);
    expect(w.state.clock.phase).toBe('day');
  });

  it('zählt die Abstimmung nicht, wenn kein Spieler aktiv ist', () => {
    const w = makeWorld();
    for (let i = 0; i < 4; i += 1) player(w.state, i).active = false;
    voteAll(w);
    runClock(w, 1);
    expect(w.state.clock.phase).toBe('night');
    expect(w.state.clock.phaseTick).toBe(1);
  });

  it('erhöht dayCount nur beim Wechsel Nacht → Tag', () => {
    const w = makeWorld();
    const counts: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      voteAll(w);
      runClock(w, 1);
      counts.push(w.state.clock.dayCount);
    }
    // Nacht→Tag→Nacht→Tag→Nacht: nur die beiden Tagesanfänge zählen.
    expect(counts).toEqual([2, 2, 3, 3]);
    const started = w.events.filter((e) => e.kind === 'day-started');
    expect(started).toHaveLength(2);
  });
});
