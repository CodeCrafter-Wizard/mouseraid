import type { Balance } from '../data/balanceTypes';
import type { RngState } from '../math/rng';
import { seedRng } from '../math/rng';
import type { Vec2 } from '../math/vec';
import type { Collider } from '../world/colliderTypes';
import type { LevelDef } from '../world/levelTypes';
import type { GameEvent } from './events';
import type { InputFrame } from './input';

/** Erhöht sich, sobald ein altes Speicherformat nicht mehr gelesen werden kann (Migration: M17). */
export const STATE_VERSION = 1;
/** Feste Zahl der Plätze. Ungenutzte Plätze bleiben bestehen und sind `active: false` – so ändert
 *  ein Beitritt weder die Arraylänge noch die Laufordnung von Klon und Hash. */
export const MAX_PLAYERS = 4;
/** Feste Länge des Lärm-Ringpuffers. */
export const NOISE_RING = 64;
/** `cat.targetSlot` ohne Ziel. Bewusst eine Zahl statt `null`: der Hash-Lauf bräuchte für `null`
 *  eine eigene Kodierungsregel, `-1` ist eine Zahl wie jede andere. */
export const NO_TARGET = -1;
/** `player.room`, solange der Spieler in keinem Raum steht. */
export const NO_ROOM = -1;

export type Phase = 'day' | 'night';
export type CatState = 'sleeping' | 'patrol' | 'alert' | 'chase' | 'lurk' | 'search' | 'return';

/** Was der Spieler WILL – `playerIntent` schreibt es, `playerMove` liest es. */
export interface PlayerIntent { moveX: number; moveZ: number; mag: number; sprint: boolean; interact: boolean }

export interface Player {
  slot: number; active: boolean; pos: Vec2; vel: Vec2; facing: number;
  room: number; weakened: boolean; caught: boolean;
  prevButtons: number; sprinting: boolean; loudness: number;
  // Die Absicht liegt AM SPIELER und wird mitgehasht. Ein Scratch-Objekt neben dem Zustand wäre
  // weder geklont noch gehasht – und damit die erste Stelle, an der ein Spielstand driftet.
  intent: PlayerIntent;
}

/** `awareness` hat IMMER MAX_PLAYERS Einträge (Index = Slot). */
export interface Cat { pos: Vec2; facing: number; state: CatState; stateTick: number;
                       awareness: number[]; targetSlot: number }

export interface ClockState { phase: Phase; phaseTick: number; dayCount: number; skipVotes: boolean[] }

/** Ein Bit je Slot, von `playerMove` gesetzt. */
export interface RoomState { id: string; playerMask: number }

/** In M3 immer leer – Beute entsteht in M13. */
export interface LootState { id: number; kind: number; pos: Vec2; carriedBy: number }

export interface NoiseSample { tick: number; slot: number; x: number; z: number; loudness: number }

export interface WorldState {
  version: number; tick: number; rng: RngState; clock: ClockState;
  players: Player[];
  cat: Cat; rooms: RoomState[]; loot: LootState[];
  noise: NoiseSample[];
  noiseHead: number; noiseCount: number;
}

/** Was ein Schritt an unveränderlichen Daten braucht. Der Kern importiert nie eine JSON-Datei –
 *  die Werte werden hier hereingereicht (D12). */
export interface StepContext { balance: Balance; level: LevelDef; colliders: readonly Collider[] }

/** Ein System ist eine reine Funktion über den Zustand. Der Typ wohnt HIER und nicht in `step.ts`:
 *  sonst importierten die zehn System-Dateien einen Typ aus dem Modul, das sie selbst importiert. */
export type SystemFn = (state: WorldState, ctx: StepContext, inputs: readonly InputFrame[], out: GameEvent[]) => void;

/** Eine leere Lärmprobe. `tick = -1` heißt »nie beschrieben« – ein echter Tick ist nie negativ. */
function emptyNoise(): NoiseSample {
  return { tick: -1, slot: -1, x: 0, z: 0, loudness: 0 };
}

/** Jede Zahl, die aus dem Level in den Zustand wandert, wird hier geprüft. Ein NaN fiele sonst erst
 *  im Hash auf – dann aber ohne Bezug zu seiner Quelle. */
function finite(value: number, path: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${path} muss endlich sein, ist ${value}`);
  return value;
}

function copySpawn(spawn: Vec2, path: string): Vec2 {
  return { x: finite(spawn.x, `${path}.x`), z: finite(spawn.z, `${path}.z`) };
}

/**
 * Startprüfung aus der Balance. `createInitialState` steht auch von Hand gebauten Balance-Objekten
 * offen (Tests, Stellschrauben in M6); ein Radius 0 oder ein verkehrtes Höhenband macht die erste
 * Kollisionsabfrage sinnlos, und zwar lautlos. Entwickler-Rückkanal, keine Spiel-UI.
 */
function checkBodies(balance: Balance): void {
  if (!(balance.mouse.radius > 0)) throw new RangeError(`balance.mouse.radius muss > 0 sein, ist ${balance.mouse.radius}`);
  if (!(balance.cat.radius > 0)) throw new RangeError(`balance.cat.radius muss > 0 sein, ist ${balance.cat.radius}`);
  if (!(balance.mouse.yRange.y1 > balance.mouse.yRange.y0)) {
    throw new RangeError(`balance.mouse.yRange braucht y1 > y0, ist ${balance.mouse.yRange.y0}..${balance.mouse.yRange.y1}`);
  }
  if (!(balance.cat.yRange.y1 > balance.cat.yRange.y0)) {
    throw new RangeError(`balance.cat.yRange braucht y1 > y0, ist ${balance.cat.yRange.y0}..${balance.cat.yRange.y1}`);
  }
}

/**
 * Der Anfangszustand einer Partie. Das Spiel beginnt in der NACHT mit Tag 1 – die erste Phase ist
 * der Beutezug (Game_Design §8.2). Alle Arrays entstehen hier in voller Länge; innerhalb eines
 * Ticks wächst später keines mehr.
 */
export function createInitialState(level: LevelDef, balance: Balance, seed: number | string): WorldState {
  checkBodies(balance);
  const hole = copySpawn(level.mouseHole, 'level.mouseHole');

  const players: Player[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) {
    const spawn = level.spawns.mice[slot];
    const active = spawn !== undefined;
    players.push({
      slot,
      active,
      // Ohne Spawn steht der Platz inaktiv am Mauseloch – eine Position außerhalb der Welt
      // (etwa 0/0) wäre eine Zahl, die irgendwann jemand ernst nimmt.
      pos: spawn === undefined ? { x: hole.x, z: hole.z } : copySpawn(spawn, `level.spawns.mice[${slot}]`),
      vel: { x: 0, z: 0 },
      facing: 0,
      room: NO_ROOM,
      weakened: false,
      caught: false,
      prevButtons: 0,
      sprinting: false,
      loudness: 0,
      intent: { moveX: 0, moveZ: 0, mag: 0, sprint: false, interact: false },
    });
  }

  const awareness: number[] = [];
  for (let slot = 0; slot < MAX_PLAYERS; slot += 1) awareness.push(0);

  const rooms: RoomState[] = [];
  for (const room of level.rooms) rooms.push({ id: room.id, playerMask: 0 });

  const noise: NoiseSample[] = [];
  for (let i = 0; i < NOISE_RING; i += 1) noise.push(emptyNoise());

  return {
    version: STATE_VERSION,
    tick: 0,
    rng: seedRng(seed),
    // skipVotes wird wie `awareness` aus MAX_PLAYERS gebaut, nicht mit vier Literalen: sonst liefen
    // Stimmen und Plätze auseinander, sobald MAX_PLAYERS sich ändert – und `clock` verlöre still eine
    // Stimme. `new Array<T>(n)` ist erlaubt (R13).
    clock: { phase: 'night', phaseTick: 0, dayCount: 1, skipVotes: new Array<boolean>(MAX_PLAYERS).fill(false) },
    players,
    cat: {
      pos: copySpawn(level.spawns.cat, 'level.spawns.cat'),
      facing: 0,
      state: 'sleeping',
      stateTick: 0,
      awareness,
      targetSlot: NO_TARGET,
    },
    rooms,
    loot: [],
    noise,
    noiseHead: 0,
    noiseCount: 0,
  };
}
