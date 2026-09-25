import { cloneRng } from '../math/rng';
import type { Vec2 } from '../math/vec';
import type { Cat, ClockState, LootState, NoiseSample, Player, PlayerIntent, RoomState, WorldState } from './state';

/**
 * Tiefenkopie des Weltzustands – je Typ eine ausgeschriebene Kopierfunktion.
 *
 * Bewusst KEIN `structuredClone` (fehlt in der Core-Bibliothek und ist zusätzlich per Textscan
 * gesperrt), KEIN JSON-Rundlauf (gemessen 45,8x langsamer) und KEIN `Object.assign`/Spread über
 * unbekannte Felder: die Feldfolge steht hier im Quelltext, damit ein neues Feld im Zustand den
 * Übersetzer auf den Plan ruft, statt still ungeklont zu bleiben.
 *
 * `ctx`, `level` und `colliders` werden NICHT kopiert – Leveldaten sind unveränderlich und werden
 * geteilt.
 */

function copyVec2(v: Vec2): Vec2 {
  return { x: v.x, z: v.z };
}

function copyIntent(intent: PlayerIntent): PlayerIntent {
  return { moveX: intent.moveX, moveZ: intent.moveZ, mag: intent.mag, sprint: intent.sprint, interact: intent.interact };
}

function copyPlayer(player: Player): Player {
  return {
    slot: player.slot,
    active: player.active,
    pos: copyVec2(player.pos),
    vel: copyVec2(player.vel),
    facing: player.facing,
    room: player.room,
    weakened: player.weakened,
    caught: player.caught,
    prevButtons: player.prevButtons,
    sprinting: player.sprinting,
    loudness: player.loudness,
    intent: copyIntent(player.intent),
  };
}

function copyClock(clock: ClockState): ClockState {
  return {
    phase: clock.phase,
    phaseTick: clock.phaseTick,
    dayCount: clock.dayCount,
    skipVotes: clock.skipVotes.slice(),
  };
}

function copyCat(cat: Cat): Cat {
  return {
    pos: copyVec2(cat.pos),
    facing: cat.facing,
    state: cat.state,
    stateTick: cat.stateTick,
    awareness: cat.awareness.slice(),
    targetSlot: cat.targetSlot,
  };
}

function copyRoom(room: RoomState): RoomState {
  return { id: room.id, playerMask: room.playerMask };
}

function copyLoot(loot: LootState): LootState {
  return { id: loot.id, kind: loot.kind, pos: copyVec2(loot.pos), carriedBy: loot.carriedBy };
}

function copyNoise(sample: NoiseSample): NoiseSample {
  return { tick: sample.tick, slot: sample.slot, x: sample.x, z: sample.z, loudness: sample.loudness };
}

export function cloneState(state: WorldState): WorldState {
  const players: Player[] = [];
  for (const player of state.players) players.push(copyPlayer(player));

  const rooms: RoomState[] = [];
  for (const room of state.rooms) rooms.push(copyRoom(room));

  const loot: LootState[] = [];
  for (const item of state.loot) loot.push(copyLoot(item));

  const noise: NoiseSample[] = [];
  for (const sample of state.noise) noise.push(copyNoise(sample));

  return {
    version: state.version,
    tick: state.tick,
    rng: cloneRng(state.rng),
    clock: copyClock(state.clock),
    players,
    cat: copyCat(state.cat),
    rooms,
    loot,
    noise,
    noiseHead: state.noiseHead,
    noiseCount: state.noiseCount,
  };
}
