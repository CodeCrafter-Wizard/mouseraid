import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { seedRng } from '../../../../src/core/math/rng';
import { MAX_PLAYERS, NOISE_RING, NO_ROOM, NO_TARGET, STATE_VERSION, createInitialState } from '../../../../src/core/sim/state';
import type { WorldState } from '../../../../src/core/sim/state';
import { loadLevel } from '../../../../src/core/world/levelLoad';
import balanceJson from '../../../fixtures/core/test-balance.json';
import levelJson from '../../../fixtures/core/mini-level.json';

// Eingefrorene Fixtures, NIE src/data/balance.json (CLAUDE.md: Golden-Tests gegen Fixtures).
const level = loadLevel(levelJson);
const balance = loadBalance(balanceJson);

/** `noUncheckedIndexedAccess` macht jeden Index optional – hier wird daraus ein harter Fehler. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`Index ${index} fehlt`);
  return value;
}

function fresh(seed: number | string = 'maeusebau'): WorldState {
  return createInitialState(level, balance, seed);
}

describe('Konstanten', () => {
  it('stehen fest – feste Arraygrößen sind die Bedingung für einen stabilen Hash-Lauf', () => {
    expect(STATE_VERSION).toBe(1);
    expect(MAX_PLAYERS).toBe(4);
    expect(NOISE_RING).toBe(64);
    expect(NO_TARGET).toBe(-1);
    expect(NO_ROOM).toBe(-1);
  });
});

describe('createInitialState – Kopf und Uhr', () => {
  it('setzt Version und Tick', () => {
    const state = fresh();
    expect(state.version).toBe(STATE_VERSION);
    expect(state.tick).toBe(0);
  });

  it('beginnt mit der NACHT und Tag 1 – das Spiel startet mit dem Beutezug', () => {
    expect(fresh().clock).toEqual({ phase: 'night', phaseTick: 0, dayCount: 1, skipVotes: [false, false, false, false] });
  });

  it('legt für jeden Slot eine eigene Abstimmung an (kein geteiltes Array)', () => {
    const state = fresh();
    expect(state.clock.skipVotes).toHaveLength(MAX_PLAYERS);
    state.clock.skipVotes[0] = true;
    expect(state.clock.skipVotes).toEqual([true, false, false, false]);
  });

  it('sät den Zufall aus der übergebenen Saat', () => {
    expect(fresh('maeusebau').rng).toEqual(seedRng('maeusebau'));
    expect(fresh(7).rng).toEqual(seedRng(7));
    expect(fresh('a').rng).not.toEqual(fresh('b').rng);
  });

  it('liefert bei gleicher Saat zweimal denselben Zustand', () => {
    expect(fresh('gleich')).toEqual(fresh('gleich'));
  });
});

describe('createInitialState – Spieler', () => {
  it('hat immer MAX_PLAYERS Plätze mit fortlaufenden Slots', () => {
    const state = fresh();
    expect(state.players).toHaveLength(MAX_PLAYERS);
    expect(state.players.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
  });

  it('setzt jeden Spieler auf seinen Maus-Spawn', () => {
    const state = fresh();
    expect(state.players.map((p) => p.active)).toEqual([true, true, true, true]);
    for (let i = 0; i < MAX_PLAYERS; i += 1) {
      expect(at(state.players, i).pos).toEqual(at(level.spawns.mice, i));
    }
  });

  it('kopiert den Spawn, statt ihn zu teilen – sonst verändert der erste Tick das Level', () => {
    const state = fresh();
    const player = at(state.players, 0);
    expect(player.pos).not.toBe(at(level.spawns.mice, 0));
    player.pos.x = 999;
    expect(at(level.spawns.mice, 0).x).not.toBe(999);
  });

  it('gibt jedem Platz eigene Objekte für pos, vel und intent', () => {
    const state = fresh();
    const a = at(state.players, 0);
    const b = at(state.players, 1);
    expect(a).not.toBe(b);
    expect(a.pos).not.toBe(b.pos);
    expect(a.vel).not.toBe(b.vel);
    expect(a.intent).not.toBe(b.intent);
    expect(a.pos).not.toBe(a.vel);
  });

  it('startet jeden Spieler in Ruhe, ohne Raum und mit leerer Absicht', () => {
    const player = at(fresh().players, 2);
    expect(player.vel).toEqual({ x: 0, z: 0 });
    expect(player.facing).toBe(0);
    expect(player.room).toBe(NO_ROOM);
    expect(player.weakened).toBe(false);
    expect(player.caught).toBe(false);
    expect(player.prevButtons).toBe(0);
    expect(player.sprinting).toBe(false);
    expect(player.loudness).toBe(0);
    expect(player.intent).toEqual({ moveX: 0, moveZ: 0, mag: 0, sprint: false, interact: false });
  });

  it('parkt Plätze ohne Spawn inaktiv am Mauseloch', () => {
    const zweiSpawns = loadLevel({ ...levelJson, spawns: { ...levelJson.spawns, mice: levelJson.spawns.mice.slice(0, 2) } });
    const state = createInitialState(zweiSpawns, balance, 'zwei');
    expect(state.players.map((p) => p.active)).toEqual([true, true, false, false]);
    expect(at(state.players, 2).pos).toEqual(level.mouseHole);
    expect(at(state.players, 3).pos).toEqual(level.mouseHole);
    expect(at(state.players, 2).pos).not.toBe(at(state.players, 3).pos);
  });

  it('nimmt höchstens MAX_PLAYERS Spawns, auch wenn das Level mehr anbietet', () => {
    const mice = [...levelJson.spawns.mice, { x: 0, z: 0 }, { x: 1, z: 1 }];
    const state = createInitialState(loadLevel({ ...levelJson, spawns: { ...levelJson.spawns, mice } }), balance, 'viele');
    expect(state.players).toHaveLength(MAX_PLAYERS);
  });
});

describe('createInitialState – Katze, Räume, Beute', () => {
  it('setzt die Katze schlafend auf ihren Spawn, ohne Ziel', () => {
    const state = fresh();
    expect(state.cat.pos).toEqual(level.spawns.cat);
    expect(state.cat.pos).not.toBe(level.spawns.cat);
    expect(state.cat.facing).toBe(0);
    expect(state.cat.state).toBe('sleeping');
    expect(state.cat.stateTick).toBe(0);
    expect(state.cat.targetSlot).toBe(NO_TARGET);
  });

  it('gibt der Katze für jeden Slot einen Aufmerksamkeitswert', () => {
    expect(fresh().cat.awareness).toEqual([0, 0, 0, 0]);
    expect(fresh().cat.awareness).toHaveLength(MAX_PLAYERS);
  });

  it('übernimmt die Räume in Definitionsreihenfolge, noch ohne Spieler darin', () => {
    const state = fresh();
    expect(state.rooms.map((r) => r.id)).toEqual(level.rooms.map((r) => r.id));
    expect(state.rooms.map((r) => r.playerMask)).toEqual(level.rooms.map(() => 0));
  });

  it('startet ohne Beute – Loot entsteht erst in M13', () => {
    expect(fresh().loot).toEqual([]);
  });
});

describe('createInitialState – Lärm-Ringpuffer', () => {
  it('legt NOISE_RING Leerproben an, jede als eigenes Objekt', () => {
    const state = fresh();
    expect(state.noise).toHaveLength(NOISE_RING);
    expect(at(state.noise, 0)).toEqual({ tick: -1, slot: -1, x: 0, z: 0, loudness: 0 });
    expect(at(state.noise, 0)).not.toBe(at(state.noise, 1));
    at(state.noise, 0).x = 5;
    expect(at(state.noise, 1).x).toBe(0);
  });

  it('beginnt mit leerem Ring', () => {
    const state = fresh();
    expect(state.noiseHead).toBe(0);
    expect(state.noiseCount).toBe(0);
    expect(state.noise.every((sample) => sample.tick === -1)).toBe(true);
  });
});

describe('createInitialState – Startprüfung aus der Balance', () => {
  it('wirft, wenn ein Körperradius nicht positiv ist', () => {
    const kaputt = { ...balance, mouse: { ...balance.mouse, radius: 0 } };
    expect(() => createInitialState(level, kaputt, 'x')).toThrow(/balance\.mouse\.radius/);
  });

  it('wirft, wenn ein Höhenband verkehrt herum steht', () => {
    const kaputt = { ...balance, cat: { ...balance.cat, yRange: { y0: 3, y1: 1 } } };
    expect(() => createInitialState(level, kaputt, 'x')).toThrow(/balance\.cat\.yRange/);
  });

  it('wirft mit dem Feldpfad, wenn eine Spawn-Koordinate nicht endlich ist', () => {
    const kaputt = { ...level, spawns: { ...level.spawns, cat: { x: Number.NaN, z: 0 } } };
    expect(() => createInitialState(kaputt, balance, 'x')).toThrow(/level\.spawns\.cat\.x/);
  });
});
