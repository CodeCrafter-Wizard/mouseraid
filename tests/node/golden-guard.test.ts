import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Golden-Wächter (D13 in der einfachsten zuverlässigen Fassung, Kopfentscheidung 21):
// Unterscheidet sich `tests/fixtures/core/golden.json` im Arbeitsbaum von `git show HEAD:<pfad>`,
// dann MUSS `docs/decisions.md` im Arbeitsbaum MEHR Zeilen enthalten, die auf /^Rebaseline:/ passen,
// als die HEAD-Fassung. Bewusst NICHT geprüft werden Commit-Nachrichten (bei Amend/Rebase falsch-rot)
// und der Index-Zustand (vor `git add` falsch-grün). Fehlt git oder die Datei in HEAD, geht der
// Wächter durch und sagt das – er ersetzt nicht das Lesen des Diffs, er erinnert an den Grund.

const GOLDEN = 'tests/fixtures/core/golden.json';
const DECISIONS = 'docs/decisions.md';
const REBASELINE_LINE = /^Rebaseline:/gm;

interface GuardState {
  git: boolean;
  workGolden: string | null;
  headGolden: string | null;
  workDecisions: string;
  headDecisions: string;
}
interface Verdict { ok: boolean; reason: string }

/** Zeilenenden vereinheitlichen: `git show` liefert den Blob, der Arbeitsbaum ggf. CRLF. */
function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function gitShow(dir: string, ref: string): string | null {
  try {
    return normalise(execFileSync('git', ['show', ref], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

function readWork(dir: string, file: string): string | null {
  const full = join(dir, file);
  return existsSync(full) ? normalise(readFileSync(full, 'utf8')) : null;
}

function hasGit(dir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function readGuardState(dir: string): GuardState {
  const git = hasGit(dir);
  return {
    git,
    workGolden: readWork(dir, GOLDEN),
    headGolden: git ? gitShow(dir, `HEAD:${GOLDEN}`) : null,
    workDecisions: readWork(dir, DECISIONS) ?? '',
    headDecisions: (git ? gitShow(dir, `HEAD:${DECISIONS}`) : null) ?? '',
  };
}

function countRebaseline(text: string): number {
  return text.match(REBASELINE_LINE)?.length ?? 0;
}

function verdict(state: GuardState): Verdict {
  if (!state.git) return { ok: true, reason: 'kein Git-Checkout mit HEAD – der Waechter prueft nichts' };
  if (state.headGolden === null) return { ok: true, reason: `${GOLDEN} liegt noch nicht in HEAD (erster Commit der Fixture)` };
  if (state.workGolden === null) return { ok: false, reason: `${GOLDEN} fehlt im Arbeitsbaum, liegt aber in HEAD` };
  if (state.workGolden === state.headGolden) return { ok: true, reason: 'Baseline unveraendert' };
  const head = countRebaseline(state.headDecisions);
  const work = countRebaseline(state.workDecisions);
  if (work > head) return { ok: true, reason: `Baseline geaendert, ${DECISIONS} hat ${work} statt ${head} Rebaseline-Zeilen` };
  return {
    ok: false,
    reason: `${GOLDEN} weicht von HEAD ab, ${DECISIONS} hat aber weiterhin ${work} Zeile(n) "Rebaseline:". `
      + 'Eine Golden-Aenderung braucht ihren Grund: `npm run core:rebaseline` ausfuehren und in '
      + `${DECISIONS} eine Zeile "Rebaseline: <Grund>" ergaenzen.`,
  };
}

/**
 * Baut das Wegwerf-Repo in einem BEREITS angelegten Ordner auf, in dem der Waechter selbst rot werden
 * kann. Der Ordner entsteht ausserhalb (U7): wirft `git init`/`git commit` – etwa wegen einer
 * erzwungenen Signatur –, greift trotzdem das `finally` des Aufrufers und raeumt ihn weg.
 */
function initRepo(dir: string): void {
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  };
  const write = (file: string, text: string): void => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text, 'utf8');
  };
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  write(GOLDEN, '{ "version": 1, "cases": [] }\n');
  write(DECISIONS, '# Entscheidungen\n\nRebaseline: erste Baseline\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Basis');
}

describe('Golden-Waechter', () => {
  it('geht ohne Git-Checkout durch, statt zu werfen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maeusebau-kein-git-'));
    try {
      const result = verdict(readGuardState(dir));
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('kein Git-Checkout');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('wird in einem Wegwerf-Repo ROT bei nackter Fixture-Aenderung und GRUEN mit Rebaseline-Zeile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'maeusebau-golden-'));
    try {
      initRepo(dir);

      // 1. unveraendert -> gruen
      expect(verdict(readGuardState(dir)).ok).toBe(true);

      // 2. Fixture geaendert, decisions.md unberuehrt -> rot
      writeFileSync(join(dir, GOLDEN), '{ "version": 1, "cases": [{ "name": "x" }] }\n', 'utf8');
      const bare = verdict(readGuardState(dir));
      expect(bare.ok).toBe(false);
      expect(bare.reason).toContain('Rebaseline:');

      // 3. eine zusaetzliche Rebaseline-Zeile -> gruen
      const decisions = readFileSync(join(dir, DECISIONS), 'utf8');
      writeFileSync(join(dir, DECISIONS), `${decisions}Rebaseline: Kollision auf TOI umgestellt\n`, 'utf8');
      const excused = verdict(readGuardState(dir));
      expect(excused.ok).toBe(true);
      expect(excused.reason).toContain('2 statt 1');

      // 4. eine Zeile, die nur ERWAEHNT wird, zaehlt nicht – der Anker steht am Zeilenanfang
      writeFileSync(join(dir, DECISIONS), `${decisions}siehe Rebaseline: nein\n`, 'utf8');
      expect(verdict(readGuardState(dir)).ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('die Baseline dieses Arbeitsbaums ist entweder unveraendert oder begruendet', (context) => {
    const state = readGuardState(process.cwd());
    const result = verdict(state);
    if (!state.git || state.headGolden === null) {
      process.stderr.write(`\nGolden-Waechter UEBERSPRUNGEN: ${result.reason}\n`);
      context.skip(result.reason);
      return;
    }
    expect(result.ok, result.reason).toBe(true);
  });
});
