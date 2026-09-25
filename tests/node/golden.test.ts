import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBalance } from '../../src/core/data/balanceLoad';
import { hashState } from '../../src/core/sim/hash';
import { createInitialState } from '../../src/core/sim/state';
import { step } from '../../src/core/sim/step';
import { generateColliders } from '../../src/core/world/generateColliders';
import { loadLevel } from '../../src/core/world/levelLoad';
import { BOT_PATTERNS, scriptedInputs } from '../helpers/scriptedInputs';
import type { BotPattern } from '../helpers/scriptedInputs';
import type { GameEvent } from '../../src/core/sim/events';

// Golden-Hash gegen EINGEFRORENE Fixtures (CLAUDE.md) – nie gegen src/data/balance.json.
// Schreibmodus: `npm run core:rebaseline` setzt MB_REBASELINE=1 und startet genau diese Datei;
// dann wird nichts zugesichert, sondern neu gerechnet, alt -> neu gedruckt und golden.json geschrieben.

interface GoldenCase {
  name: string;
  seed: number;
  slots: BotPattern[];
  ticks: number;
  hash: number;
  playerPos: [number, number][];
}
interface GoldenFile { version: number; cases: GoldenCase[] }

const GOLDEN_PATH = fileURLToPath(new URL('../fixtures/core/golden.json', import.meta.url));
const BALANCE_PATH = fileURLToPath(new URL('../fixtures/core/test-balance.json', import.meta.url));
const LEVEL_PATH = fileURLToPath(new URL('../fixtures/core/mini-level.json', import.meta.url));

const HINT = [
  'Golden-Abweichung. Wenn die Aenderung gewollt ist:',
  '1. `npm run core:rebaseline` ausfuehren (druckt alt -> neu je Fall und schreibt die Fixture neu),',
  '2. in docs/decisions.md eine Zeile `Rebaseline: <Grund>` ergaenzen –',
  '   tests/node/golden-guard.test.ts laesst eine nackte Fixture-Aenderung nicht durch.',
].join('\n');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Als Hex-Zeichenkette vergleichen: der Fehlerbericht zeigt dann den Hash, nicht eine nackte Zahl. */
function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * `-0` auf `+0` ziehen. `JSON.stringify(-0)` ergibt `0`, `toEqual` unterscheidet die beiden aber
 * (Object.is). Ohne diese Normalisierung waere ein Fall, dessen Spieler exakt auf einer Achse endet,
 * nach dem Rebaseline dauerhaft rot. `hashF64` macht im Kern genau dieselbe Normalisierung.
 */
function norm(value: number): number {
  return value === 0 ? 0 : value;
}

const balance = loadBalance(readJson(BALANCE_PATH));
const level = loadLevel(readJson(LEVEL_PATH));
const colliders = generateColliders(level);
const golden = readJson(GOLDEN_PATH) as GoldenFile;

function runCase(entry: GoldenCase): { hash: number; playerPos: [number, number][] } {
  const state = createInitialState(level, balance, entry.seed);
  const events: GameEvent[] = [];
  for (let i = 0; i < entry.ticks; i += 1) {
    // Ereignisse gehoeren dem Aufrufer (Spec Zeile 65); der Golden-Lauf leert den Puffer je Tick,
    // damit er bei 3000 Ticks nicht unbegrenzt waechst.
    events.length = 0;
    step(state, scriptedInputs(entry.seed, entry.slots, state.tick), { balance, level, colliders }, events);
  }
  return {
    hash: hashState(state),
    playerPos: state.players.map((player): [number, number] => [norm(player.pos.x), norm(player.pos.z)]),
  };
}

const rebaseline = process.env['MB_REBASELINE'] === '1';

describe('Golden-Hash gegen die eingefrorene Fixture', () => {
  it('die Fixture deckt die vier Tick-Stufen und alle vier Bot-Muster ab', () => {
    expect(golden.version).toBe(1);
    for (const ticks of [1, 30, 300, 3000]) {
      expect(golden.cases.some((entry) => entry.ticks === ticks)).toBe(true);
    }
    const used = new Set<string>();
    for (const entry of golden.cases) {
      for (const slot of entry.slots) {
        // U7 (2): JEDER Eintrag muss ein gueltiges Muster sein, nicht nur jedes Muster irgendwo
        // vorkommen. Die Fixture wird nur `as GoldenFile` gelesen – ein Tippfehler faellt sonst
        // erst `scriptedInputs` auf, und das auch nur seit es wirft.
        expect(BOT_PATTERNS, `Fall ${entry.name}: unbekanntes Bot-Muster "${slot}"`).toContain(slot);
        used.add(slot);
      }
    }
    for (const pattern of BOT_PATTERNS) expect(used.has(pattern)).toBe(true);
  });

  if (rebaseline) {
    it('MB_REBASELINE=1: rechnet jeden Fall neu und schreibt die Fixture', () => {
      const next: GoldenCase[] = [];
      process.stdout.write(`\nGolden-Baseline neu gerechnet (${golden.cases.length} Faelle):\n`);
      for (const entry of golden.cases) {
        const actual = runCase(entry);
        const changed = actual.hash !== entry.hash;
        process.stdout.write(`  ${entry.name.padEnd(16)} ${hex(entry.hash)} -> ${hex(actual.hash)}`);
        process.stdout.write(changed ? '\n' : '   (unveraendert)\n');
        for (let slot = 0; slot < actual.playerPos.length; slot += 1) {
          const before = entry.playerPos[slot];
          const after = actual.playerPos[slot];
          if (after === undefined) continue;
          const oldText = before === undefined ? '-' : `(${before[0]}, ${before[1]})`;
          const newText = `(${after[0]}, ${after[1]})`;
          if (oldText !== newText) process.stdout.write(`    Platz ${slot}: ${oldText} -> ${newText}\n`);
        }
        next.push({ ...entry, hash: actual.hash, playerPos: actual.playerPos });
      }
      // Das Feld `hinweis` der Entwurfsfassung faellt hier heraus: ab jetzt sind die Zahlen echt.
      writeFileSync(GOLDEN_PATH, `${JSON.stringify({ version: 1, cases: next }, null, 2)}\n`, 'utf8');
      process.stdout.write(`Fixture geschrieben: ${GOLDEN_PATH}\n`);
      process.stdout.write('Nicht vergessen: `Rebaseline: <Grund>` in docs/decisions.md.\n');
      expect(next).toHaveLength(golden.cases.length);
    });
  } else {
    for (const entry of golden.cases) {
      it(`Fall ${entry.name}: Hash und Endlagen nach ${entry.ticks} Ticks`, () => {
        const actual = runCase(entry);
        expect(hex(actual.hash), HINT).toBe(hex(entry.hash));
        expect(actual.playerPos, HINT).toEqual(entry.playerPos);
      });
    }
  }
});
