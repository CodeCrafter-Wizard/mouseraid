import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../../src/core/data/balanceLoad';
import { cloneState } from '../../../../src/core/sim/clone';
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

/**
 * Ein Zustand, in dem KEIN Feld mehr auf seinem Anfangswert steht – sonst prüft der Klon-Test
 * lauter Nullen gegen lauter Nullen und merkt nicht, wenn ein Feld gar nicht kopiert wird.
 */
function dirty(): WorldState {
  const state = createInitialState(level, balance, 'klon');
  state.version = 1;
  state.tick = 1234;
  state.rng.a = 11; state.rng.b = 22; state.rng.c = 33; state.rng.d = 44;
  state.clock.phase = 'day';
  state.clock.phaseTick = 55;
  state.clock.dayCount = 3;
  state.clock.skipVotes[1] = true;
  for (let slot = 0; slot < state.players.length; slot += 1) {
    const player = at(state.players, slot);
    player.pos.x = 1 + slot; player.pos.z = 2 + slot;
    player.vel.x = 0.25 + slot; player.vel.z = -0.5 - slot;
    player.facing = 0.75 + slot;
    player.room = slot === 3 ? -1 : 0;
    player.weakened = slot === 1;
    player.caught = slot === 2;
    player.prevButtons = slot;
    player.sprinting = slot === 0;
    player.loudness = 0.1 * slot;
    player.intent = { moveX: 0.3 + slot, moveZ: -0.4 - slot, mag: 0.5, sprint: slot === 0, interact: slot === 1 };
  }
  state.cat.pos.x = -7; state.cat.pos.z = 8;
  state.cat.facing = 1.5;
  state.cat.state = 'chase';
  state.cat.stateTick = 9;
  state.cat.awareness = [0.1, 0.2, 0.3, 0.4];
  state.cat.targetSlot = 2;
  for (let i = 0; i < state.rooms.length; i += 1) at(state.rooms, i).playerMask = 1 + i;
  state.loot = [
    { id: 1, kind: 2, pos: { x: 3, z: 4 }, carriedBy: -1 },
    { id: 2, kind: 5, pos: { x: -6, z: 7 }, carriedBy: 0 },
  ];
  for (let i = 0; i < NOISE_RING; i += 1) {
    const sample = at(state.noise, i);
    sample.tick = i; sample.slot = i % 4; sample.x = 0.5 * i; sample.z = -0.25 * i; sample.loudness = i / NOISE_RING;
  }
  state.noiseHead = 17;
  state.noiseCount = NOISE_RING;
  return state;
}

describe('cloneState – Gleichheit', () => {
  it('liefert einen wertgleichen Zustand', () => {
    const original = dirty();
    expect(cloneState(original)).toEqual(original);
  });

  it('liefert denselben Hash – die Naht zu Speichern/Laden (M17)', () => {
    const original = dirty();
    expect(hashState(cloneState(original))).toBe(hashState(original));
  });

  it('kopiert auch den Anfangszustand wertgleich', () => {
    const start = createInitialState(level, balance, 'start');
    expect(cloneState(start)).toEqual(start);
  });
});

describe('cloneState – kein einziges Objekt wird geteilt', () => {
  const original = dirty();
  const copy = cloneState(original);

  it.each([
    ['der Zustand selbst', (s: WorldState): unknown => s],
    ['rng', (s: WorldState): unknown => s.rng],
    ['clock', (s: WorldState): unknown => s.clock],
    ['clock.skipVotes', (s: WorldState): unknown => s.clock.skipVotes],
    ['players', (s: WorldState): unknown => s.players],
    ['players[0]', (s: WorldState): unknown => at(s.players, 0)],
    ['players[0].pos', (s: WorldState): unknown => at(s.players, 0).pos],
    ['players[0].vel', (s: WorldState): unknown => at(s.players, 0).vel],
    ['players[0].intent', (s: WorldState): unknown => at(s.players, 0).intent],
    ['players[3]', (s: WorldState): unknown => at(s.players, 3)],
    ['players[3].pos', (s: WorldState): unknown => at(s.players, 3).pos],
    ['cat', (s: WorldState): unknown => s.cat],
    ['cat.pos', (s: WorldState): unknown => s.cat.pos],
    ['cat.awareness', (s: WorldState): unknown => s.cat.awareness],
    ['rooms', (s: WorldState): unknown => s.rooms],
    ['rooms[0]', (s: WorldState): unknown => at(s.rooms, 0)],
    ['loot', (s: WorldState): unknown => s.loot],
    ['loot[0]', (s: WorldState): unknown => at(s.loot, 0)],
    ['loot[0].pos', (s: WorldState): unknown => at(s.loot, 0).pos],
    ['noise', (s: WorldState): unknown => s.noise],
    ['noise[0]', (s: WorldState): unknown => at(s.noise, 0)],
    ['noise[63]', (s: WorldState): unknown => at(s.noise, 63)],
  ])('%s ist ein eigenes Objekt', (_name, pick) => {
    expect(pick(copy)).not.toBe(pick(original));
    expect(pick(copy)).toEqual(pick(original));
  });
});

describe('cloneState – Tiefe: eine Änderung am Klon lässt das Original in Ruhe', () => {
  it('überlebt eine Mutation JEDES Arrays und jedes verschachtelten Objekts', () => {
    const original = dirty();
    const copy = cloneState(original);
    // JSON ist hier erlaubt: das ist ein Test, kein Kern-Modul. Der Vergleich deckt jedes Feld ab,
    // auch eines, das dieser Test einzeln zu prüfen vergisst.
    const before = JSON.stringify(original);

    copy.version = 99;
    copy.tick = 99;
    copy.rng.a = 99; copy.rng.b = 99; copy.rng.c = 99; copy.rng.d = 99;
    copy.clock.phase = 'night';
    copy.clock.phaseTick = 99;
    copy.clock.dayCount = 99;
    copy.clock.skipVotes[0] = true;
    copy.clock.skipVotes[1] = false;
    copy.clock.skipVotes.push(true);
    at(copy.players, 0).pos.x = 99;
    at(copy.players, 0).vel.z = 99;
    at(copy.players, 0).intent.mag = 99;
    at(copy.players, 0).intent.sprint = false;
    at(copy.players, 1).active = false;
    at(copy.players, 2).weakened = true;
    at(copy.players, 3).slot = 99;
    copy.players.pop();
    copy.cat.pos.x = 99;
    copy.cat.pos.z = 99;
    copy.cat.facing = 99;
    copy.cat.state = 'lurk';
    copy.cat.stateTick = 99;
    copy.cat.awareness[1] = 99;
    copy.cat.awareness.push(99);
    copy.cat.targetSlot = 99;
    at(copy.rooms, 0).id = 'anders';
    at(copy.rooms, 0).playerMask = 99;
    copy.rooms.push({ id: 'neu', playerMask: 7 });
    at(copy.loot, 0).pos.x = 99;
    at(copy.loot, 0).carriedBy = 99;
    copy.loot.push({ id: 9, kind: 9, pos: { x: 9, z: 9 }, carriedBy: 9 });
    copy.loot.pop();
    copy.loot.pop();
    at(copy.noise, 0).x = 99;
    at(copy.noise, 5).loudness = 99;
    at(copy.noise, 63).tick = 99;
    copy.noise.push({ tick: 9, slot: 9, x: 9, z: 9, loudness: 9 });
    copy.noiseHead = 99;
    copy.noiseCount = 99;

    expect(JSON.stringify(original)).toBe(before);
    expect(hashState(original)).toBe(hashState(dirty()));
  });

  it('funktioniert auch andersherum: eine Änderung am Original lässt den Klon in Ruhe', () => {
    const original = dirty();
    const copy = cloneState(original);
    const before = JSON.stringify(copy);
    at(original.players, 0).pos.z = -99;
    original.cat.awareness[0] = -99;
    at(original.noise, 2).loudness = -99;
    at(original.rooms, 0).playerMask = -99;
    at(original.loot, 1).pos.z = -99;
    original.clock.skipVotes[2] = true;
    original.rng.d = -99;
    expect(JSON.stringify(copy)).toBe(before);
  });

  it('bleibt auch nach zwei Generationen unabhängig', () => {
    const original = dirty();
    const enkel = cloneState(cloneState(original));
    at(enkel.players, 0).pos.x = 42;
    expect(at(original.players, 0).pos.x).toBe(1);
    expect(hashState(cloneState(cloneState(original)))).toBe(hashState(original));
  });
});
