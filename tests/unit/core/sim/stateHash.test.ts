import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { NaNError } from '../../../../src/core/math/hash';
import { hashState } from '../../../../src/core/sim/hash';
import { NOISE_RING, createInitialState } from '../../../../src/core/sim/state';
import type { WorldState } from '../../../../src/core/sim/state';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import balanceJson from '../../../fixtures/core/test-balance.json';
import levelJson from '../../../fixtures/core/mini-level.json';

const level = loadLevel(levelJson);
const balance = loadBalance(balanceJson);

/** `noUncheckedIndexedAccess` macht jeden Index optional – hier wird daraus ein harter Fehler. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`Index ${index} fehlt`);
  return value;
}

function fresh(): WorldState {
  const state = createInitialState(level, balance, 'hash');
  // Ein paar Felder vom Anfangswert wegbewegen, damit die Mutationen unten etwas verändern, das
  // vorher nicht schon null war.
  state.loot = [{ id: 1, kind: 2, pos: { x: 3, z: 4 }, carriedBy: -1 }];
  at(state.noise, 7).tick = 5;
  at(state.noise, 7).loudness = 0.5;
  return state;
}

const BASIS = hashState(fresh());

describe('hashState – Form und Stabilität', () => {
  it('liefert eine vorzeichenlose 32-Bit-Zahl', () => {
    expect(Number.isInteger(BASIS)).toBe(true);
    expect(BASIS).toBeGreaterThanOrEqual(0);
    expect(BASIS).toBeLessThanOrEqual(4294967295);
  });

  it('ist rein: zweimal derselbe Zustand, zweimal derselbe Wert', () => {
    const state = fresh();
    expect(hashState(state)).toBe(hashState(state));
  });

  it('ist über zwei unabhängige Läufe stabil', () => {
    expect(hashState(fresh())).toBe(hashState(fresh()));
    expect(hashState(fresh())).toBe(BASIS);
  });

  it('unterscheidet zwei Saaten', () => {
    const a = createInitialState(level, balance, 'saat-a');
    const b = createInitialState(level, balance, 'saat-b');
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

describe('hashState – jede einzelne Feldänderung ändern den Wert', () => {
  const MUTATIONEN: readonly { name: string; mutate: (s: WorldState) => void }[] = [
    { name: 'version', mutate: (s) => { s.version = 2; } },
    { name: 'tick', mutate: (s) => { s.tick = 1; } },
    { name: 'rng.a', mutate: (s) => { s.rng.a = s.rng.a + 1; } },
    { name: 'rng.b', mutate: (s) => { s.rng.b = s.rng.b + 1; } },
    { name: 'rng.c', mutate: (s) => { s.rng.c = s.rng.c + 1; } },
    { name: 'rng.d', mutate: (s) => { s.rng.d = s.rng.d + 1; } },
    { name: 'clock.phase', mutate: (s) => { s.clock.phase = 'day'; } },
    { name: 'clock.phaseTick', mutate: (s) => { s.clock.phaseTick = 1; } },
    { name: 'clock.dayCount', mutate: (s) => { s.clock.dayCount = 2; } },
    { name: 'clock.skipVotes[0]', mutate: (s) => { s.clock.skipVotes[0] = true; } },
    { name: 'clock.skipVotes[3]', mutate: (s) => { s.clock.skipVotes[3] = true; } },
    { name: 'players[0].slot', mutate: (s) => { at(s.players, 0).slot = 9; } },
    { name: 'players[0].active', mutate: (s) => { at(s.players, 0).active = false; } },
    { name: 'players[0].pos.x', mutate: (s) => { at(s.players, 0).pos.x += 1; } },
    { name: 'players[0].pos.z', mutate: (s) => { at(s.players, 0).pos.z += 1; } },
    { name: 'players[0].vel.x', mutate: (s) => { at(s.players, 0).vel.x = 0.5; } },
    { name: 'players[0].vel.z', mutate: (s) => { at(s.players, 0).vel.z = 0.5; } },
    { name: 'players[0].facing', mutate: (s) => { at(s.players, 0).facing = 1; } },
    { name: 'players[0].room', mutate: (s) => { at(s.players, 0).room = 0; } },
    { name: 'players[0].weakened', mutate: (s) => { at(s.players, 0).weakened = true; } },
    { name: 'players[0].caught', mutate: (s) => { at(s.players, 0).caught = true; } },
    { name: 'players[0].prevButtons', mutate: (s) => { at(s.players, 0).prevButtons = 1; } },
    { name: 'players[0].sprinting', mutate: (s) => { at(s.players, 0).sprinting = true; } },
    { name: 'players[0].loudness', mutate: (s) => { at(s.players, 0).loudness = 0.25; } },
    { name: 'players[0].intent.moveX', mutate: (s) => { at(s.players, 0).intent.moveX = 1; } },
    { name: 'players[0].intent.moveZ', mutate: (s) => { at(s.players, 0).intent.moveZ = 1; } },
    { name: 'players[0].intent.mag', mutate: (s) => { at(s.players, 0).intent.mag = 1; } },
    { name: 'players[0].intent.sprint', mutate: (s) => { at(s.players, 0).intent.sprint = true; } },
    { name: 'players[0].intent.interact', mutate: (s) => { at(s.players, 0).intent.interact = true; } },
    { name: 'players[3].pos.x (letzter Platz)', mutate: (s) => { at(s.players, 3).pos.x += 1; } },
    { name: 'players (ein Platz weniger)', mutate: (s) => { s.players.pop(); } },
    { name: 'cat.pos.x', mutate: (s) => { s.cat.pos.x += 1; } },
    { name: 'cat.pos.z', mutate: (s) => { s.cat.pos.z += 1; } },
    { name: 'cat.facing', mutate: (s) => { s.cat.facing = 1; } },
    { name: 'cat.state', mutate: (s) => { s.cat.state = 'patrol'; } },
    { name: 'cat.stateTick', mutate: (s) => { s.cat.stateTick = 1; } },
    { name: 'cat.awareness[2]', mutate: (s) => { s.cat.awareness[2] = 0.5; } },
    { name: 'cat.awareness (ein Eintrag weniger)', mutate: (s) => { s.cat.awareness.pop(); } },
    { name: 'cat.targetSlot', mutate: (s) => { s.cat.targetSlot = 0; } },
    { name: 'rooms[0].id', mutate: (s) => { at(s.rooms, 0).id = 'anders'; } },
    { name: 'rooms[0].playerMask', mutate: (s) => { at(s.rooms, 0).playerMask = 1; } },
    { name: 'rooms (einer mehr)', mutate: (s) => { s.rooms.push({ id: 'neu', playerMask: 0 }); } },
    { name: 'loot[0].id', mutate: (s) => { at(s.loot, 0).id = 2; } },
    { name: 'loot[0].kind', mutate: (s) => { at(s.loot, 0).kind = 3; } },
    { name: 'loot[0].pos.x', mutate: (s) => { at(s.loot, 0).pos.x += 1; } },
    { name: 'loot[0].pos.z', mutate: (s) => { at(s.loot, 0).pos.z += 1; } },
    { name: 'loot[0].carriedBy', mutate: (s) => { at(s.loot, 0).carriedBy = 0; } },
    { name: 'loot (leer)', mutate: (s) => { s.loot = []; } },
    { name: 'noise[7].tick', mutate: (s) => { at(s.noise, 7).tick = 6; } },
    { name: 'noise[7].slot', mutate: (s) => { at(s.noise, 7).slot = 1; } },
    { name: 'noise[7].x', mutate: (s) => { at(s.noise, 7).x = 1; } },
    { name: 'noise[7].z', mutate: (s) => { at(s.noise, 7).z = 1; } },
    { name: 'noise[7].loudness', mutate: (s) => { at(s.noise, 7).loudness = 0.75; } },
    { name: 'noise[63] (letzte Probe)', mutate: (s) => { at(s.noise, NOISE_RING - 1).tick = 0; } },
    { name: 'noise (eine Probe weniger)', mutate: (s) => { s.noise.pop(); } },
    { name: 'noiseHead', mutate: (s) => { s.noiseHead = 1; } },
    { name: 'noiseCount', mutate: (s) => { s.noiseCount = 1; } },
    { name: 'ein ULP in einer Position', mutate: (s) => {
      const p = at(s.players, 0);
      p.pos.x = p.pos.x * (1 + Number.EPSILON);   // benachbarter double, nicht eine andere Zahl
    } },
  ];

  it.each(MUTATIONEN)('$name ändert den Hash', ({ mutate }) => {
    const state = fresh();
    mutate(state);
    expect(hashState(state)).not.toBe(BASIS);
  });

  it('die Tabelle deckt alle Felder ab, die im Zustand stehen', () => {
    // Zählprobe gegen das Vergessen: 11 Kopffelder (version, tick, 4x rng, 4x clock, noiseHead,
    // noiseCount) + 18 Spielerfelder + 6 Katzenfelder + 2 Raumfelder + 5 Lootfelder +
    // 5 Lärmfelder = 47 Felder, dazu Längen und Sonderfälle.
    expect(MUTATIONEN.length).toBeGreaterThanOrEqual(47);
  });

  it('unterscheidet vertauschte Feldwerte – die Laufordnung ist Teil des Vertrags', () => {
    const a = fresh();
    at(a.players, 0).pos.x = 1;
    at(a.players, 0).pos.z = 2;
    const b = fresh();
    at(b.players, 0).pos.x = 2;
    at(b.players, 0).pos.z = 1;
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('unterscheidet zwei Plätze mit vertauschten Werten', () => {
    const a = fresh();
    at(a.players, 0).loudness = 0.3;
    const b = fresh();
    at(b.players, 1).loudness = 0.3;
    expect(hashState(a)).not.toBe(hashState(b));
  });
});

describe('hashState – Sonderfälle der Zahlen', () => {
  it('hasht -0 wie +0 – sonst hinge der Wert am Vorzeichen einer Null', () => {
    const plus = fresh();
    at(plus.players, 0).pos.x = 0;
    at(plus.players, 0).vel.z = 0;
    const minus = fresh();
    at(minus.players, 0).pos.x = -0;
    at(minus.players, 0).vel.z = -0;
    // Gegenprobe, dass die Werte wirklich verschieden sind:
    expect(Object.is(at(minus.players, 0).pos.x, -0)).toBe(true);
    expect(hashState(minus)).toBe(hashState(plus));
  });

  it.each([
    { name: 'players[0].pos.x', pfad: 'players[0].pos.x', mutate: (s: WorldState) => { at(s.players, 0).pos.x = Number.NaN; } },
    { name: 'players[2].vel.z', pfad: 'players[2].vel.z', mutate: (s: WorldState) => { at(s.players, 2).vel.z = Number.NaN; } },
    { name: 'players[1].intent.mag', pfad: 'players[1].intent.mag', mutate: (s: WorldState) => { at(s.players, 1).intent.mag = Number.NaN; } },
    { name: 'cat.awareness[2]', pfad: 'cat.awareness[2]', mutate: (s: WorldState) => { s.cat.awareness[2] = Number.NaN; } },
    { name: 'cat.pos.z', pfad: 'cat.pos.z', mutate: (s: WorldState) => { s.cat.pos.z = Number.NaN; } },
    { name: 'noise[7].loudness', pfad: 'noise[7].loudness', mutate: (s: WorldState) => { at(s.noise, 7).loudness = Number.POSITIVE_INFINITY; } },
    { name: 'rooms[0].playerMask', pfad: 'rooms[0].playerMask', mutate: (s: WorldState) => { at(s.rooms, 0).playerMask = Number.NEGATIVE_INFINITY; } },
    { name: 'loot[0].pos.z', pfad: 'loot[0].pos.z', mutate: (s: WorldState) => { at(s.loot, 0).pos.z = Number.NaN; } },
    { name: 'tick', pfad: 'tick', mutate: (s: WorldState) => { s.tick = Number.NaN; } },
    { name: 'rng.c', pfad: 'rng.c', mutate: (s: WorldState) => { s.rng.c = Number.NaN; } },
    { name: 'clock.phaseTick', pfad: 'clock.phaseTick', mutate: (s: WorldState) => { s.clock.phaseTick = Number.NaN; } },
  ])('wirft NaNError mit dem Feldpfad $pfad', ({ pfad, mutate }) => {
    const state = fresh();
    mutate(state);
    let gefangen: unknown = null;
    try {
      hashState(state);
    } catch (error) {
      gefangen = error;
    }
    expect(gefangen).toBeInstanceOf(NaNError);
    expect((gefangen as NaNError).path).toBe(pfad);
  });
});
