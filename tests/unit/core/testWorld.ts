// Gemeinsame Bühne der System-Tests (T5). Liegt AUSSERHALB von src/core und darf deshalb
// Math.* als Referenz benutzen. Die Fixtures sind eingefroren (T2) – kein Test liest
// src/data/balance.json.
import { loadBalance } from '../../../src/core/data/balanceLoad';
import type { Balance } from '../../../src/core/data/balanceTypes';
import type { GameEvent } from '../../../src/core/sim/events';
import type { InputFrame } from '../../../src/core/sim/input';
import { createInitialState } from '../../../src/core/sim/state';
import type { Player, StepContext, WorldState } from '../../../src/core/sim/state';
import { ALL_MASKS } from '../../../src/core/world/colliderTypes';
import type { Collider } from '../../../src/core/world/colliderTypes';
import { generateColliders } from '../../../src/core/world/generateColliders';
import { loadLevel } from '../../../src/core/world/levelLoad';
import { CM_PER_UNIT } from '../../../src/core/world/levelTypes';
import type { LevelDef, LevelRoom } from '../../../src/core/world/levelTypes';
import balanceFixture from '../../fixtures/core/test-balance.json';
import levelFixture from '../../fixtures/core/mini-level.json';

/** Eine Testbühne: Zustand, injizierter Kontext, Ereignispuffer des Aufrufers. */
export interface TestWorld { state: WorldState; ctx: StepContext; events: GameEvent[] }

/**
 * `noUncheckedIndexedAccess` macht jeden Index optional – hier wird daraus ein harter Fehler.
 * Stand bis zur Feinschliff-Runde byte-gleich in vier `sim/`-Tests; eine Fehlermeldung statt vier.
 * `player(state, slot)` unten ist die spezialisierte Fassung derselben Idee.
 */
export function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`Index ${index} fehlt`);
  return value;
}

/** Balance aus der eingefrorenen Fixture. */
export function testBalance(): Balance {
  return loadBalance(balanceFixture);
}

/** Mini-Level aus der eingefrorenen Fixture. */
export function miniLevel(): LevelDef {
  return loadLevel(levelFixture);
}

/** Welt aus den Fixtures: vier aktive Spieler an den Maus-Spawns, alle Kollider erzeugt. */
export function makeWorld(seed: number | string = 'T5'): TestWorld {
  const level = miniLevel();
  const balance = testBalance();
  return {
    state: createInitialState(level, balance, seed),
    ctx: { balance, level, colliders: generateColliders(level) },
    events: [],
  };
}

/**
 * Ein von HAND gebautes `LevelDef` mit allen Pflichtfeldern – `patch` überschreibt genau das, worum
 * es im Test geht. Die Pflichtfeld-Litanei (`walls/shelves/boxes/plants/lootSpawns/nav/spawns/
 * mouseHole`) stand vorher in VIER Bauern derselben Testsuite; ein neues `LevelDef`-Feld kostet
 * damit eine Stelle statt vier.
 *
 * Vorgaben: keine Räume und keine Grundformen (die Bühnen stellen ihre Kollider meist selbst), ein
 * Maus-Spawn und ein Katzen-Spawn im Ursprung, und ein Mauseloch mit den Maßen eines gewöhnlichen
 * Wandlochs – für die meisten Bühnen zählt davon nur `x`/`z` (dort parkt `createInitialState`
 * Plätze ohne Spawn).
 */
export function emptyLevel(patch: Partial<LevelDef> = {}): LevelDef {
  return {
    id: 'leer', scale: CM_PER_UNIT,
    rooms: [], walls: [], shelves: [], boxes: [],
    plants: [], lootSpawns: [], nav: { points: [] },
    spawns: { mice: [{ x: 0, z: 0 }], cat: { x: 0, z: 0 } },
    mouseHole: { x: 0, z: 0, widthCm: 20, heightCm: 200, thicknessCm: 10, rot: 0 },
    ...patch,
  };
}

/** Freie Bühne: selbst gewählte Räume und Kollider, damit Bewegungstests nicht an der Fixture hängen. */
export function makeStage(rooms: readonly LevelRoom[], colliders: readonly Collider[],
  balance: Balance = testBalance()): TestWorld {
  const level: LevelDef = emptyLevel({ id: 'stage', rooms });
  return { state: createInitialState(level, balance, 'stage'), ctx: { balance, level, colliders }, events: [] };
}

/** Rechteckiger Raum. */
export function room(id: string, x0: number, z0: number, x1: number, z1: number): LevelRoom {
  return { id, name: id, bounds: { x0, z0, x1, z1 }, cameraMode: 'follow' };
}

/**
 * Ein Kollider von Hand, mit Vorgaben für alles, worum es im Test nicht geht: Halbmaße 1, auf dem
 * Boden stehend, 100 Einheiten hoch, ungedreht, hält alles auf, eigene `occluderGroup`.
 *
 * `rc`/`rs` werden hier vorgerechnet – genau wie in `generateColliders`; bei `rot === 0` sind
 * `Math.cos/ sin` exakt 1 und 0. Drei Testdateien hatten dafür je eine eigene Fabrik mit derselben
 * Feld-Litanei (`validateLevel.test.ts`, `draw.test.ts` und `box` unten).
 */
export interface ColliderOpts { hx?: number; hz?: number; y0?: number; y1?: number; rot?: number; blocks?: number }

export function collider(id: number, cx: number, cz: number, opts: ColliderOpts = {}): Collider {
  const rot = opts.rot ?? 0;
  const y0 = opts.y0 ?? 0;
  return {
    id, cx, cz,
    hx: opts.hx ?? 1, hz: opts.hz ?? 1,
    y0, y1: opts.y1 ?? 100,
    rot, rc: Math.cos(rot), rs: Math.sin(rot),
    blocks: opts.blocks ?? ALL_MASKS, occluderGroup: id + 1,
  };
}

/** Achsenparalleler Kasten als Kollider – die häufigste Form, mit Halbmaßen als Pflichtangabe. */
export function box(id: number, cx: number, cz: number, hx: number, hz: number,
  blocks: number, y1 = 100): Collider {
  return collider(id, cx, cz, { hx, hz, y1, blocks });
}

/** Eingaberahmen bauen. */
export function frame(tick: number, mx: number, mz: number, buttons = 0, seq = 0): InputFrame {
  return { seq, tick, mx, mz, buttons };
}

/** Spieler eines Slots, ohne optionales Lesen im Test. */
export function player(state: WorldState, slot: number): Player {
  const p = state.players[slot];
  if (p === undefined) throw new Error(`Slot ${slot} fehlt`);
  return p;
}

/** Die ersten `count` Plätze aktiv schalten, alle anderen still. */
export function activate(state: WorldState, count: number): void {
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p !== undefined) p.active = i < count;
  }
}

/** Willen von Hand setzen (playerIntent wird in Bewegungstests nicht gebraucht). */
export function setIntent(p: Player, moveX: number, moveZ: number, mag: number, sprint = false): void {
  p.intent.moveX = moveX;
  p.intent.moveZ = moveZ;
  p.intent.mag = mag;
  p.intent.sprint = sprint;
  p.intent.interact = false;
}

/** Betrag der Geschwindigkeit. */
export function speedOf(p: Player): number {
  return Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
}
