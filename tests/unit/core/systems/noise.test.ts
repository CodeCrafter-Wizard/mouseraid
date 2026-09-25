import { describe, expect, it } from 'vitest';

import { NOISE_RING } from '../../../../src/core/sim/state';
import type { Player } from '../../../../src/core/sim/state';
import { noise } from '../../../../src/core/systems/noise';
import type { TestWorld } from '../testWorld';
import { activate, makeWorld, player } from '../testWorld';

/** Spieler in Bewegung versetzen, ohne playerMove zu brauchen. */
function moving(p: Player, loudness: number, vx = 0.2): void {
  p.vel.x = vx;
  p.vel.z = 0;
  p.loudness = loudness;
}

/** Ein Tick des Systems inklusive des Tick-Zählers, den step() am ENDE erhöht. */
function tickNoise(w: TestWorld, times = 1): void {
  for (let i = 0; i < times; i += 1) {
    noise(w.state, w.ctx, [], w.events);
    w.state.tick += 1;
  }
}

describe('noise', () => {
  it('schreibt je bewegtem Spieler genau eine Probe in den Ringpuffer', () => {
    const w = makeWorld();
    activate(w.state, 1);
    const p = player(w.state, 0);
    moving(p, 0.4);
    tickNoise(w);

    expect(w.state.noiseHead).toBe(1);
    expect(w.state.noiseCount).toBe(1);
    expect(w.state.noise[0]).toEqual({ tick: 0, slot: 0, x: p.pos.x, z: p.pos.z, loudness: 0.4 });
  });

  it('schreibt nichts für einen stehenden Spieler', () => {
    const w = makeWorld();
    activate(w.state, 1);
    player(w.state, 0).loudness = 1;
    tickNoise(w, 5);

    expect(w.state.noiseHead).toBe(0);
    expect(w.state.noiseCount).toBe(0);
    expect(w.state.noise[0]?.tick).toBe(-1);
    expect(w.events).toHaveLength(0);
  });

  it('überspringt inaktive Plätze', () => {
    const w = makeWorld();
    activate(w.state, 4);
    for (let i = 0; i < 4; i += 1) moving(player(w.state, i), 0.3);
    player(w.state, 1).active = false;
    player(w.state, 2).active = false;
    tickNoise(w);

    expect(w.state.noiseCount).toBe(2);
    expect(w.state.noise[0]?.slot).toBe(0);
    expect(w.state.noise[1]?.slot).toBe(3);
  });

  it('schreibt vier Proben je Tick, wenn alle vier laufen', () => {
    const w = makeWorld();
    activate(w.state, 4);
    for (let i = 0; i < 4; i += 1) moving(player(w.state, i), 0.3);
    tickNoise(w, 3);

    expect(w.state.noiseHead).toBe(12);
    expect(w.state.noiseCount).toBe(12);
  });

  it('läuft bei NOISE_RING um und überschreibt die ältesten Proben', () => {
    const w = makeWorld();
    activate(w.state, 1);
    const p = player(w.state, 0);
    moving(p, 0.4);
    tickNoise(w, NOISE_RING + 5);

    expect(w.state.noiseHead).toBe(5);
    expect(w.state.noiseCount).toBe(NOISE_RING);
    // Die ersten fünf Plätze tragen schon die NEUEN Proben …
    expect(w.state.noise[0]?.tick).toBe(NOISE_RING);
    expect(w.state.noise[4]?.tick).toBe(NOISE_RING + 4);
    // … Platz 5 ist der älteste, der noch steht.
    expect(w.state.noise[5]?.tick).toBe(5);
    expect(w.state.noise).toHaveLength(NOISE_RING);
  });

  it('meldet ein noise-Ereignis erst ab noiseEventMinLoudness', () => {
    const w = makeWorld();
    activate(w.state, 1);
    const min = w.ctx.balance.noiseEventMinLoudness;
    const p = player(w.state, 0);

    moving(p, min - 1e-9);
    tickNoise(w);
    expect(w.events).toHaveLength(0);

    moving(p, min);
    tickNoise(w);
    expect(w.events).toEqual([
      { kind: 'noise', tick: 1, slot: 0, x: p.pos.x, z: p.pos.z, loudness: min },
    ]);
  });

  it('hält Probe und Ereignis auch nach dem Umlauf beisammen', () => {
    const w = makeWorld();
    activate(w.state, 1);
    const p = player(w.state, 0);
    moving(p, 1);
    tickNoise(w, NOISE_RING + 1);

    expect(w.events).toHaveLength(NOISE_RING + 1);
    expect(w.state.noise[0]).toEqual({ tick: NOISE_RING, slot: 0, x: p.pos.x, z: p.pos.z, loudness: 1 });
  });
});
