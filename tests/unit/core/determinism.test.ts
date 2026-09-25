import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../../src/core/data/balanceLoad';
import { cloneState } from '../../../src/core/sim/clone';
import { hashState } from '../../../src/core/sim/hash';
import { createInitialState } from '../../../src/core/sim/state';
import { step } from '../../../src/core/sim/step';
import type { WorldState } from '../../../src/core/sim/state';
import { generateColliders } from '../../../src/core/world/generateColliders';
import { loadLevel } from '../../../src/core/world/levelLoad';
import { scriptedInputs } from '../../helpers/scriptedInputs';
import type { BotPattern } from '../../helpers/scriptedInputs';
import type { GameEvent } from '../../../src/core/sim/events';
import balanceJson from '../../fixtures/core/test-balance.json';
import levelJson from '../../fixtures/core/mini-level.json';

// Die Determinismus-Naht cloneState <-> step <-> hashState. M17 ("Save/Reload mitten im Lauf ->
// gleicher Hash", Spec Zeile 154) benutzt genau diesen Test wieder.
//
// Die Fixtures kommen per JSON-IMPORT herein, nicht ueber node:fs: tests/unit/** laeuft im
// DOM-Projekt mit `types: []` – `node:fs` gaebe dort TS2591 (gemessen, siehe oben Punkt 1).
// `resolveJsonModule` steht in tsconfig.base.json.

const balance = loadBalance(balanceJson);
const level = loadLevel(levelJson);
const colliders = generateColliders(level);
const ctx = { balance, level, colliders };

const SEED = 20260925;
const SLOTS: BotPattern[] = ['walk-circle', 'sprint-bursts', 'wall-hugger', 'idle'];
const TICKS = 600;

function advance(state: WorldState, ticks: number): void {
  const events: GameEvent[] = [];
  for (let i = 0; i < ticks; i += 1) {
    events.length = 0;
    step(state, scriptedInputs(SEED, SLOTS, state.tick), ctx, events);
  }
}

describe('Determinismus-Naht', () => {
  it('zwei unabhaengige Laeufe mit derselben Saat liefern denselben Hash', () => {
    const a = createInitialState(level, balance, SEED);
    const b = createInitialState(level, balance, SEED);
    advance(a, TICKS);
    advance(b, TICKS);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.tick).toBe(TICKS);
  });

  it('eine andere Saat liefert einen anderen Hash', () => {
    const a = createInitialState(level, balance, SEED);
    const b = createInitialState(level, balance, SEED + 1);
    advance(a, TICKS);
    advance(b, TICKS);
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('Klon bei der Haelfte: beide Seiten weitergerechnet ergeben denselben Hash', () => {
    const original = createInitialState(level, balance, SEED);
    advance(original, TICKS / 2);
    const copy = cloneState(original);
    expect(hashState(copy)).toBe(hashState(original));
    advance(original, TICKS / 2);
    advance(copy, TICKS / 2);
    expect(hashState(copy)).toBe(hashState(original));
  });

  it('der Klon ist tief: eine Mutation am Klon laesst den Hash des Originals stehen', () => {
    const original = createInitialState(level, balance, SEED);
    advance(original, 120);
    const before = hashState(original);
    const copy = cloneState(original);
    const player = copy.players[0];
    const sample = copy.noise[0];
    expect(player).toBeDefined();
    expect(sample).toBeDefined();
    if (player !== undefined) player.pos.x += 1;
    if (sample !== undefined) sample.loudness = 0.5;
    copy.cat.awareness[0] = 0.5;
    copy.clock.skipVotes[0] = true;
    copy.rng.a = (copy.rng.a ^ 1) >>> 0;
    expect(hashState(original)).toBe(before);
    expect(hashState(copy)).not.toBe(before);
  });
});
