import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Alles, was `labHook.ts` exportiert, landet über `import type { LabHook }` im Typgraphen der
// E2E-Specs (tests/e2e/lab-rtc.spec.ts). Erreicht dieser Graph `src/platform/buildInfo.ts`, fehlt dem
// Node-Projekt die Vite-Konstante `__BUILD_ID__` und `npm run typecheck` bricht ab; erreicht er eine
// `.css`-Datei, bricht er mit TS2882. Beides wird im MODUL repariert, nie in tsconfig.node.json.
const ROOT = resolve(__dirname, '../..');
const FORBIDDEN = ['src/platform/buildInfo.ts', 'src/net/environment.ts', 'src/lab/report.ts', 'src/lab/labSession.ts'];

/**
 * Jede Import-Angabe einer Datei – statisch (`from '…'`, `import '…'`) UND dynamisch
 * (`import("…")`), in einfachen wie doppelten Anführungszeichen. Relative Pfade werden aufgelöst,
 * Pakete übersprungen. Ein `await import("./report")` würde report.ts genauso in den Graphen holen
 * wie ein statischer Import und darf dem Wächter deshalb nicht entgehen.
 */
const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/** Statische `from '…'`-Importe einer Datei, relative Pfade aufgelöst; Pakete werden übersprungen. */
function walk(entry: string): { files: Set<string>; styles: string[] } {
  const files = new Set<string>();
  const styles: string[] = [];
  const queue = [resolve(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      const spec = match[1] ?? '';
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(file), spec);
      if (/\.css$/.test(spec)) { styles.push(relative(ROOT, target).replaceAll('\\', '/')); continue; }
      for (const candidate of [`${target}.ts`, join(target, 'index.ts'), target]) {
        if (existsSync(candidate) && candidate.endsWith('.ts')) { queue.push(candidate); break; }
      }
    }
  }
  return { files, styles };
}

const asRel = (files: Set<string>): string[] => [...files].map((file) => relative(ROOT, file).replaceAll('\\', '/'));

describe('Importgraph von src/lab/labHook.ts', () => {
  it('erreicht weder buildInfo noch environment, report oder labSession', () => {
    const reached = asRel(walk('src/lab/labHook.ts').files);
    expect(reached.filter((file) => FORBIDDEN.includes(file))).toEqual([]);
  });

  it('erreicht kein Stylesheet (R14: CSS wird nur aus labMain.ts importiert)', () => {
    expect(walk('src/lab/labHook.ts').styles).toEqual([]);
  });

  it('die Gegenprobe greift: über labMain.ts sind ALLE verbotenen Module erreichbar', () => {
    const main = walk('src/lab/labMain.ts');
    // Nicht nur buildInfo: fände der Wächter nur eines der vier, wäre er für die anderen drei blind.
    expect(asRel(main.files)).toEqual(expect.arrayContaining(FORBIDDEN));
    expect(main.styles.length).toBeGreaterThan(0);
  });

  it('sieht auch dynamische Importe und doppelte Anführungszeichen', () => {
    // Gegenprobe ohne Repo-Datei: ein `await import("./report")` darf dem Wächter nicht entgehen,
    // sonst könnte genau so ein Import report.ts in den Haken-Graphen holen, ohne aufzufallen.
    const dir = mkdtempSync(join(tmpdir(), 'labhook-graph-'));
    try {
      writeFileSync(join(dir, 'report.ts'), 'export const marker = 1;\n', 'utf8');
      writeFileSync(join(dir, 'entry.ts'), 'export async function load() {\n  return await import("./report");\n}\n', 'utf8');
      expect([...walk(join(dir, 'entry.ts')).files]).toContain(resolve(dir, 'report.ts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
