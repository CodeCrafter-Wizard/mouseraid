import { createHasher } from '../math/hash';
import type { Hasher } from '../math/hash';
import type { CatState, Phase, WorldState } from './state';

/**
 * Zustandshash über eine HANDGESCHRIEBENE Feldfolge.
 *
 * Die Laufordnung ist Teil des Vertrags: derselbe Zustand ergibt denselben Wert, zwei vertauschte
 * Felder ergeben verschiedene. Deshalb kein `Object.keys`, kein `for…in`, kein `JSON.stringify` –
 * eine Feldumbenennung soll den Übersetzer stören und nicht still den Hash verschieben.
 *
 * Aufzählungen gehen als Index in den Strom, nicht als Text: so kostet eine Umbenennung von
 * 'chase' zu 'jagd' keinen neuen Golden-Wert, eine Umsortierung der Liste dagegen schon – und
 * genau das ist gewollt, weil die Reihenfolge Bedeutung trägt.
 */

// Reihenfolge = Kodierung. NIE umsortieren, nur hinten anhängen (sonst: Rebaseline).
const PHASES: readonly Phase[] = ['day', 'night'];
const CAT_STATES: readonly CatState[] = ['sleeping', 'patrol', 'alert', 'chase', 'lurk', 'search', 'return'];

function hashEnum(hasher: Hasher, values: readonly string[], value: string, path: string): void {
  const index = values.indexOf(value);
  if (index < 0) throw new RangeError(`${path}: unbekannter Wert '${value}'`);
  hasher.hashU8(index);
}

/**
 * Der Feldpfad wird hier je Zahl zusammengesetzt. Das kostet Zeichenketten, macht aber die
 * Fehlermeldung des NaN-Wächters brauchbar ("players[2].vel.z" statt "irgendwo eine 2000. Zahl").
 * Gemessen wird der Preis in `npm run core:bench`, nicht in einem Test.
 */
export function hashState(state: WorldState): number {
  const h = createHasher();

  h.hashF64(state.version, 'version');
  h.hashF64(state.tick, 'tick');

  h.hashF64(state.rng.a, 'rng.a');
  h.hashF64(state.rng.b, 'rng.b');
  h.hashF64(state.rng.c, 'rng.c');
  h.hashF64(state.rng.d, 'rng.d');

  hashEnum(h, PHASES, state.clock.phase, 'clock.phase');
  h.hashF64(state.clock.phaseTick, 'clock.phaseTick');
  h.hashF64(state.clock.dayCount, 'clock.dayCount');
  h.hashLen(state.clock.skipVotes.length);
  for (const vote of state.clock.skipVotes) h.hashBool(vote);

  h.hashLen(state.players.length);
  for (let i = 0; i < state.players.length; i += 1) {
    const player = state.players[i];
    if (player === undefined) continue;
    const p = `players[${i}]`;
    h.hashF64(player.slot, `${p}.slot`);
    h.hashBool(player.active);
    h.hashF64(player.pos.x, `${p}.pos.x`);
    h.hashF64(player.pos.z, `${p}.pos.z`);
    h.hashF64(player.vel.x, `${p}.vel.x`);
    h.hashF64(player.vel.z, `${p}.vel.z`);
    h.hashF64(player.facing, `${p}.facing`);
    h.hashF64(player.room, `${p}.room`);
    h.hashBool(player.weakened);
    h.hashBool(player.caught);
    h.hashF64(player.prevButtons, `${p}.prevButtons`);
    h.hashBool(player.sprinting);
    h.hashF64(player.loudness, `${p}.loudness`);
    h.hashF64(player.intent.moveX, `${p}.intent.moveX`);
    h.hashF64(player.intent.moveZ, `${p}.intent.moveZ`);
    h.hashF64(player.intent.mag, `${p}.intent.mag`);
    h.hashBool(player.intent.sprint);
    h.hashBool(player.intent.interact);
  }

  h.hashF64(state.cat.pos.x, 'cat.pos.x');
  h.hashF64(state.cat.pos.z, 'cat.pos.z');
  h.hashF64(state.cat.facing, 'cat.facing');
  hashEnum(h, CAT_STATES, state.cat.state, 'cat.state');
  h.hashF64(state.cat.stateTick, 'cat.stateTick');
  h.hashLen(state.cat.awareness.length);
  for (let i = 0; i < state.cat.awareness.length; i += 1) {
    h.hashF64(state.cat.awareness[i] ?? 0, `cat.awareness[${i}]`);
  }
  h.hashF64(state.cat.targetSlot, 'cat.targetSlot');

  h.hashLen(state.rooms.length);
  for (let i = 0; i < state.rooms.length; i += 1) {
    const room = state.rooms[i];
    if (room === undefined) continue;
    h.hashStr(room.id);
    h.hashF64(room.playerMask, `rooms[${i}].playerMask`);
  }

  h.hashLen(state.loot.length);
  for (let i = 0; i < state.loot.length; i += 1) {
    const item = state.loot[i];
    if (item === undefined) continue;
    const l = `loot[${i}]`;
    h.hashF64(item.id, `${l}.id`);
    h.hashF64(item.kind, `${l}.kind`);
    h.hashF64(item.pos.x, `${l}.pos.x`);
    h.hashF64(item.pos.z, `${l}.pos.z`);
    h.hashF64(item.carriedBy, `${l}.carriedBy`);
  }

  h.hashLen(state.noise.length);
  for (let i = 0; i < state.noise.length; i += 1) {
    const sample = state.noise[i];
    if (sample === undefined) continue;
    const n = `noise[${i}]`;
    h.hashF64(sample.tick, `${n}.tick`);
    h.hashF64(sample.slot, `${n}.slot`);
    h.hashF64(sample.x, `${n}.x`);
    h.hashF64(sample.z, `${n}.z`);
    h.hashF64(sample.loudness, `${n}.loudness`);
  }

  h.hashF64(state.noiseHead, 'noiseHead');
  h.hashF64(state.noiseCount, 'noiseCount');

  return h.digest();
}
