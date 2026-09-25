import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../src/core/data/balanceLoad';
import { hashState } from '../../src/core/sim/hash';
import { createInitialState } from '../../src/core/sim/state';
import { step } from '../../src/core/sim/step';
import type { WorldState } from '../../src/core/sim/state';
import { generateColliders } from '../../src/core/world/generateColliders';
import { loadLevel } from '../../src/core/world/levelLoad';
import type { Collider } from '../../src/core/world/colliderTypes';
import { ALL_MASKS } from '../../src/core/world/colliderTypes';
import { nextRange, seedRng } from '../../src/core/math/rng';
import { cos, sin } from '../../src/core/math/trig';
import { scriptedInputs } from '../helpers/scriptedInputs';
import type { BotPattern } from '../helpers/scriptedInputs';
import type { GameEvent } from '../../src/core/sim/events';

// MESSLAUF, kein Test: im Normallauf übersprungen (`npm run core:bench` setzt MB_BENCH=1).
// Er sichert NICHTS über die Laufzeit zu – eine Zeitschranke wäre auf fremder Hardware falsch-rot.
// Die Zahlen gehören mit dem Vorbehalt „diese Maschine" nach docs/decisions.md (T7).

const COLLIDERS = 200;
const LOOT = 300;
const WARMUP = 300;
const MEASURED = 3000;
const SLOTS: BotPattern[] = ['walk-circle', 'sprint-bursts', 'wall-hugger', 'walk-circle'];

/** Fixture-Pfad relativ zu DIESER Datei – nicht zum Arbeitsverzeichnis (wie golden-guard/golden). */
function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/core/${name}`, import.meta.url));
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Füllt die Kollider-Liste des Mini-Levels mit gesäten Kästen auf COLLIDERS auf. */
function padColliders(base: Collider[], count: number): Collider[] {
  const rng = seedRng('bench-colliders');
  const out = base.slice();
  while (out.length < count) {
    const rot = nextRange(rng, -3.14159, 3.14159);
    out.push({
      id: out.length,
      cx: nextRange(rng, -19, 19), cz: nextRange(rng, -14, 14),
      hx: nextRange(rng, 0.3, 1.2), hz: nextRange(rng, 0.3, 1.2),
      y0: 0, y1: nextRange(rng, 1, 3),
      rot, rc: cos(rot), rs: sin(rot),
      blocks: ALL_MASKS, occluderGroup: 900 + out.length,
    });
  }
  return out;
}

function fillLoot(state: WorldState, count: number): void {
  const rng = seedRng('bench-loot');
  for (let i = 0; i < count; i += 1) {
    state.loot.push({ id: i, kind: i % 5, pos: { x: nextRange(rng, -19, 19), z: nextRange(rng, -14, 14) }, carriedBy: -1 });
  }
}

describe('Kern-Messlauf', () => {
  it.skipIf(process.env['MB_BENCH'] !== '1')('misst step() und hashState()', () => {
    const balance = loadBalance(readJson(fixture('test-balance.json')));
    const level = loadLevel(readJson(fixture('mini-level.json')));
    const colliders = padColliders(generateColliders(level), COLLIDERS);
    const ctx = { balance, level, colliders };
    const events: GameEvent[] = [];

    const state = createInitialState(level, balance, 1);
    fillLoot(state, LOOT);
    const players = state.players.filter((p) => p.active).length;

    // `hash` wird zurueckgegeben und unten geprueft: so kann keine Optimierung den Hash-Aufruf
    // wegwerfen, und der Messlauf braucht keinen Kunstgriff gegen tote Zweige.
    const run = (ticks: number, withHash: boolean): { micros: number; hash: number } => {
      let hash = 0;
      const started = performance.now();
      for (let i = 0; i < ticks; i += 1) {
        events.length = 0;
        step(state, scriptedInputs(1, SLOTS, state.tick), ctx, events);
        if (withHash) hash = hashState(state);
      }
      return { micros: ((performance.now() - started) * 1000) / ticks, hash };
    };

    run(WARMUP, true);
    const stepOnly = run(MEASURED, false).micros;
    const hashed = run(MEASURED, true);
    const withHash = hashed.micros;

    process.stdout.write(
      `\nKern-Messlauf (${players} Spieler, ${colliders.length} Kollider, ${state.loot.length} Loot-Stuempfe, ` +
      `${MEASURED} Ticks je Messung, nach ${WARMUP} Aufwaermticks):\n` +
      `  step()                 ${stepOnly.toFixed(2)} us/Tick\n` +
      `  step() + hashState()   ${withHash.toFixed(2)} us/Tick\n` +
      `  hashState() allein     ${(withHash - stepOnly).toFixed(2)} us/Tick\n` +
      '  Vorbehalt: nur diese Maschine; auf dem Handy ist mit dem 4-8-fachen zu rechnen.\n' +
      '  Diese Zahlen gehoeren nach docs/decisions.md – der Messlauf sichert NICHTS zu.\n',
    );

    // Struktur, nicht Zeit: die Messung lief ueber die versprochene Groesse.
    expect(colliders.length).toBe(COLLIDERS);
    expect(state.loot).toHaveLength(LOOT);
    expect(players).toBe(4);
    expect(Number.isInteger(hashed.hash)).toBe(true);
  });
});
